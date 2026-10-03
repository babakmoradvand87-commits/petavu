/**
 * مسیرهای کاتالوگ و جست‌وجو (گام ۲۱؛ §19–۲۱، §25، §60).
 *
 * جست‌وجو عمداً یک آداپتور است، نه یک کوئری چسبیده به مسیر: امروز روی
 * PostgreSQL اجرا می‌شود (چون داده همان‌جاست و ایندکس‌ها همان‌جا)، و فردا
 * می‌تواند با همان قرارداد روی موتور جست‌وجوی جداگانه بنشیند. درایور فعلی،
 * در پاسخ گزارش می‌شود تا هیچ‌کس گمان نکند موتور جست‌وجوی کامل فعال است (§102).
 */

import { AppError } from '@petavu/shared';
import { RATE_LIMITS } from '@petavu/security';

import type { ApiResult, RouteDefinition, Scope } from '../types.js';

export const catalogRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: '/api/v1/catalog/business-types',
    name: 'catalog.businessTypes',
    summary: 'انواع کسب‌وکار',
    tags: ['catalog'],
    auth: 'public',
    role: 'pv_public',
    rateLimit: RATE_LIMITS.publicRead,
    handler: async (request, scope) => ({
      body: { types: await scope.repos.catalog.businessTypes({ includeInactive: request.query.get('all') === 'true' }) },
    }),
  },

  {
    method: 'GET',
    path: '/api/v1/catalog/industries',
    name: 'catalog.industries',
    summary: 'تاکسونومی صنعت',
    tags: ['catalog'],
    auth: 'public',
    role: 'pv_public',
    rateLimit: RATE_LIMITS.publicRead,
    handler: async (request, scope) => ({
      body: { industries: await scope.repos.catalog.industries({ includeInactive: request.query.get('all') === 'true' }) },
    }),
  },

  {
    method: 'GET',
    path: '/api/v1/catalog/locations',
    name: 'catalog.locations',
    summary: 'مکان‌ها (استان/شهر/محله)',
    tags: ['catalog'],
    auth: 'public',
    role: 'pv_public',
    rateLimit: RATE_LIMITS.publicRead,
    handler: async (request, scope) => {
      const limit = Number(request.query.get('limit') ?? 100);
      const locations = await scope.repos.catalog.locations({
        parentId: request.query.get('parent_id'),
        kind: request.query.get('kind') ?? undefined,
        limit: Number.isFinite(limit) ? Math.max(1, Math.min(500, limit)) : 100,
      });
      return { body: { locations } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/catalog/locations/:slug',
    name: 'catalog.locationBySlug',
    summary: 'مکان با نامک',
    tags: ['catalog'],
    auth: 'public',
    role: 'pv_public',
    rateLimit: RATE_LIMITS.publicRead,
    handler: async (request, scope) => {
      const slug = String(request.params.slug ?? '');
      const location = await scope.repos.catalog.locationBySlug(slug);
      if (!location) throw new AppError('not_found');
      return { body: { location } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/catalog/categories',
    name: 'catalog.categories',
    summary: 'دسته‌های محتوا و کسب‌وکار',
    tags: ['catalog'],
    auth: 'public',
    role: 'pv_public',
    rateLimit: RATE_LIMITS.publicRead,
    handler: async (request, scope) => {
      const categories = await scope.repos.catalog.categories({
        scope: request.query.get('scope') ?? undefined,
        businessId: request.businessId,
        parentId: request.query.get('parent_id'),
      });
      return { body: { categories } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/catalog/revision',
    name: 'catalog.revision',
    summary: 'مهر تازه‌سازی دادهٔ مرجع (برای کش)',
    tags: ['catalog'],
    auth: 'public',
    role: 'pv_public',
    handler: async (_request, scope) => {
      const revision = await scope.repos.catalog.revision();
      return { body: { revision }, headers: { 'cache-control': 'public, max-age=300' } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/search',
    name: 'search.query',
    summary: 'جست‌وجوی عمومی کسب‌وکار و محتوا',
    tags: ['search'],
    auth: 'public',
    role: 'pv_public',
    rateLimit: RATE_LIMITS.searchPublic,
    handler: async (request, scope) => searchBusinesses(request, scope),
  },
];

/**
 * جست‌وجو، امروز روی PostgreSQL (گام ۲۵).
 *
 * `q` کوتاه‌تر از دو نویسه، جست‌وجو نیست — پاسخ، فهرست خالی با دلیل صریح است،
 * نه خطا: کاربر در حال تایپ است و خطا دادن به او، تجربهٔ بدی می‌سازد.
 *
 * شرط در **پرس‌وجو** است (`app.search_businesses`). نسخهٔ نخست، یک صفحه از
 * فهرست را می‌خواند و در حافظه فیلتر می‌کرد؛ پس کسب‌وکاری که خارج از آن صفحه
 * بود، هرگز پیدا نمی‌شد. فیلتر نوع و صنعت اینجا در همان نتیجه اعمال می‌شود.
 */
async function searchBusinesses(
  request: { query: URLSearchParams; businessId: string | null },
  scope: Scope,
): Promise<ApiResult> {
  const query = (request.query.get('q') ?? '').trim();
  const driver = scope.services.env.search.driver;

  if (query.length < 2) {
    return {
      body: {
        query,
        driver,
        engine: 'postgres',
        results: [],
        reason: 'query_too_short',
      },
    };
  }

  const requested = Number(request.query.get('limit') ?? 24);
  const limit = Number.isFinite(requested) ? Math.max(1, Math.min(50, Math.trunc(requested))) : 24;
  const typeKey = request.query.get('type');
  const industryKey = request.query.get('industry');

  // فیلتر نوع/صنعت بعد از جست‌وجو است، پس از سقف بزرگ‌تری می‌خوانیم و بعد برش می‌دهیم.
  const hits = await scope.repos.catalog.searchBusinesses(query, typeKey || industryKey ? 50 : limit);
  const results = hits
    .filter((hit) => (typeKey ? hit.business_type_key === typeKey : true))
    .filter((hit) => (industryKey ? hit.industry_key === industryKey : true))
    .slice(0, limit);

  return {
    body: {
      query,
      driver,
      engine: 'postgres',
      limit: results.length,
      results,
      has_more: hits.length >= 50,
      // صداقت: تا وقتی درایور جست‌وجو `postgres` است، این «جست‌وجوی کامل» نیست.
      note: driver === 'postgres' ? 'جست‌وجو روی PostgreSQL؛ موتور اختصاصی فعال نیست.' : null,
    },
  };
}
