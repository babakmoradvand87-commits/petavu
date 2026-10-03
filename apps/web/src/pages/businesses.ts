/**
 * فهرست کسب‌وکارها (گام ۲۲؛ §19–۲۰، Addendum §۲۰–۲۱، §۵۳).
 *
 * صفحه‌بندی **نشانگری** است، نه `offset`: با `offset`، هر کسب‌وکار تازه‌ای که
 * ثبت می‌شود ردیف‌ها را جابه‌جا می‌کند و صفحهٔ دوم می‌تواند یک مورد را دوبار
 * نشان دهد یا از قلم بیندازد.
 *
 * سئوی صفحه‌بندی، طبق توصیهٔ خود گوگل: صفحهٔ اول `canonical` و `rel=next`؛
 * صفحه‌های بعدی `noindex, follow` و **بدون** کانونیکال به صفحهٔ اول. این‌گونه
 * محتوا نمایه می‌شود، ولی صفحه‌های نشانگری، محتوای تکراری نمی‌سازند.
 */

import { clampDescription } from '@petavu/seo';

import { breadcrumb, container, emptyState, heading, paragraph, section } from '../components.js';
import { PLATFORM_NAME, renderShell } from '../chrome.js';
import { breadcrumbList, jsonLdBlocks } from '../structured.js';
import { buildPageHead } from '../seohead.js';
import { typeUrl } from '../taxonomy.js';
import { PAGE_SIZE, businessGrid, paginationNav } from './landing.js';
import type { PageContext, PageResponse } from './types.js';

/**
 * «یک مفهوم، یک نشانی» (گام ۲۵).
 *
 * `?q=` و `?type=` پیش‌تر روی همین صفحه می‌نشستند، ولی `q` اصلاً اعمال نمی‌شد و
 * `type` یک نسخهٔ تکراری از صفحهٔ نوع می‌ساخت. حالا هر کدام صفحهٔ خودشان را دارند
 * (`/search`، `/t/{نوع}`) و این‌جا فقط هدایت دائمی است — پیوند قدیمی کار می‌کند و
 * موتور جست‌وجو یک صفحهٔ مرجع می‌بیند.
 */
function legacyRedirect(url: URL): PageResponse | null {
  const query = url.searchParams.get('q')?.trim();
  const typeKey = url.searchParams.get('type')?.trim();
  const cursor = url.searchParams.get('cursor');

  let target: string | null = null;
  if (query) {
    target = `/search?q=${encodeURIComponent(query)}`;
  } else if (typeKey) {
    const base = typeUrl(typeKey);
    if (base) target = cursor ? `${base}?cursor=${encodeURIComponent(cursor)}` : base;
  }

  if (!target) return null;
  return { status: 308, kind: 'text', body: '', headers: { location: target }, cacheable: false, seo: false };
}

export async function businessesPage(context: PageContext): Promise<PageResponse> {
  const { config, site, url, settings, requestId } = context;
  const origin = config.env.origins.public;
  const locale = settings?.default_locale ?? 'fa-IR';

  const redirected = legacyRedirect(url);
  if (redirected) return redirected;

  const cursor = url.searchParams.get('cursor');

  const page = await context.data.listPublicBusinesses({ limit: PAGE_SIZE, cursor }, requestId);

  const isFirstPage = !cursor;
  const title = isFirstPage
    ? `کسب‌وکارهای صنعت حیوانات خانگی و اسب | ${PLATFORM_NAME}`
    : `کسب‌وکارها — صفحهٔ بعد | ${PLATFORM_NAME}`;

  const nextUrl = page.nextCursor ? `${origin}/businesses?cursor=${encodeURIComponent(page.nextCursor)}` : null;

  /*
   * کانونیکال این صفحه **همیشه** `/businesses` است، حتی وقتی فیلتر نوع فعال
   * است؛ فیلتر، محتوای تکراری می‌سازد و نشانگرِ «کدام نسخه مرجع است» باید
   * یک‌جا (اینجا) گفته شود. قاعدهٔ عمومی `seo.canonical` هم می‌تواند دستکاری‌اش
   * کند، ولی مسیر صفحه در `path` داده می‌شود تا قاعده با آن سنجیده شود.
   */
  const head = await buildPageHead({
    context,
    site,
    path: '/businesses',
    search: url.searchParams,
    entity: {
      /*
       * جست‌وجوی متنی به `/search` رفته است؛ این صفحه فقط «فهرست» است — راه ورود
       * به پروفایل‌ها — و باید نمایه شود.
       */
      kind: 'listing',
      id: null,
      routeKey: '/businesses',
      values: {
        name: 'کسب‌وکارها',
        type: 'کسب‌وکار',
        title: 'کسب‌وکارهای صنعت حیوانات خانگی و اسب',
        description: `فهرست زندهٔ کسب‌وکارهای فعال در صنعت حیوانات خانگی و اسب — ${PLATFORM_NAME}.`,
      },
    },
    fallbackTitle: title,
    fallbackDescription: clampDescription(
      `${page.items.length > 0 ? page.items.length : PAGE_SIZE} کسب‌وکار فعال در صنعت حیوانات خانگی و اسب — فهرست زندهٔ ${PLATFORM_NAME}.`,
    ),
    // صفحه‌های بعدی: `noindex, follow` — محتوا نمایه می‌شود، صفحهٔ نشانگری نه.
    indexable: site.indexable && isFirstPage,
    nonIndexableReason: isFirstPage ? null : 'paginated',
    extraDirectives: isFirstPage ? [] : ['noindex', 'follow'],
    // نشانگر صفحه‌بندی، بخشی از هویت صفحهٔ دوم است؛ بقیهٔ پارامترها نه.
    canonicalKeepParams: ['cursor'],
    pagination: { next: nextUrl },
    og: { type: 'website' },
  });

  void locale;

  const listing =
    page.items.length > 0
      ? businessGrid(page.items) + (nextUrl ? paginationNav(`/businesses?cursor=${encodeURIComponent(page.nextCursor as string)}`) : '')
      : emptyState('هنوز کسب‌وکاری پروفایل عمومی منتشر نکرده است. به‌زودی این فهرست پر می‌شود.');

  const body = [
    section({
      tight: true,
      children: container(breadcrumb([{ label: 'خانه', href: '/' }, { label: 'کسب‌وکارها' }])),
    }),
    section({
      children: container(
        heading(1, 'کسب‌وکارهای حاضر در شبکه') +
          paragraph('همهٔ کسب‌وکارهایی که پروفایل عمومی فعال دارند. برای دسته‌بندی، از انواع کسب‌وکار، صنف‌ها یا شهرها وارد شوید.', 'field__hint') +
          listing,
      ),
    }),
  ].join('\n');

  const nodes = [
    breadcrumbList(
      [
        { name: 'خانه', url: '/' },
        { name: 'کسب‌وکارها', url: '/businesses' },
      ],
      { baseUrl: origin, brandName: PLATFORM_NAME },
    ),
  ];

  const html = renderShell({
    config,
    site,
    url,
    siteName: PLATFORM_NAME,
    headTags: head.tags,
    theme: context.theme,
    fonts: context.fonts,
    assets: context.assets,
    chrome: context.chrome,
    now: context.now,
    content: body,
    jsonLd: jsonLdBlocks({
      baseUrl: origin,
      brandName: PLATFORM_NAME,
      locale,
      // نودهای سئوی داده‌محور، در همان گراف صفحه ادغام می‌شوند.
      nodes: [...nodes, ...head.structuredNodes],
    }),
    bodyClass: 'page-businesses',
  });

  return { status: 200, kind: 'html', body: html };
}
