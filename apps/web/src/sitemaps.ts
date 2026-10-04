/**
 * نقشهٔ سایت: ایندکس + بخش‌ها (گام ۲۶؛ Addendum §۴۶، §۴۴، §۳۹–۴۷).
 *
 * `/sitemap.xml` **همیشه ایندکس** است و بخش‌ها زیر `/sitemaps/` می‌نشینند. یک نشانی
 * ثابت برای خزنده (که در robots و Search Console ثبت شده) و بخش‌هایی که هر کدام
 * زیر سقف پروتکل می‌مانند:
 *
 *   pages        صفحهٔ اصلی و مرکزها            (فقط آنچه محتوا دارد)
 *   content      محتوای سراسری پلتفرم            (قطعه‌قطعه)
 *   types        انواع کسب‌وکار                  (فقط با دست‌کم یک کسب‌وکار)
 *   industries   صنف‌ها                           ″
 *   locations    استان‌ها و شهرها                 ″
 *   categories   دسته‌های محتوا                   (فقط با دست‌کم یک محتوا)
 *   businesses   پروفایل کسب‌وکارها               (قطعه‌قطعه)
 *
 * قواعد، همه از یک اصل می‌آیند: **نقشهٔ سایت فقط نشانی‌هایی را می‌گوید که
 * صفحه‌شان نمایه‌شدنی است.** صفحه‌ای که خودش `noindex` است و در نقشهٔ سایت هم
 * آمده، به موتور جست‌وجو دو پیام متناقض می‌دهد. پس:
 *
 *   • تاکسونومیِ بی‌عضو نمی‌آید (همان قاعدهٔ محتوای کم‌مایهٔ صفحه، §۴۴).
 *   • فرادادهٔ `is_indexable = false` نمی‌آید (از راه تابع دامنه، نه جدول خام).
 *   • صفحهٔ جست‌وجو، ۴۰۴، و صفحه‌های نشانگری هرگز نمی‌آیند.
 *
 * `lastmod` فقط وقتی هست که **واقعی** است. ایندکسِ بخش‌های قطعه‌قطعه `lastmod`
 * ندارد (قطعه، یک بازهٔ شناسه است و تازه‌ترین تغییرش بی‌پرس‌وجوی اضافه معلوم
 * نیست)؛ دروغ‌گفتن، اعتماد موتور به همهٔ تاریخ‌ها را می‌برد.
 *
 * اندازهٔ قطعه از `seo.settings.extra.indexing.max_sitemap_urls` می‌آید (داده،
 * نه ثابت کد؛ §103) و هرگز از سقف ۵۰٬۰۰۰ پروتکل بیشتر نمی‌شود.
 */

import { SITEMAP_MAX_URLS, buildSitemapIndex, buildUrlset, type SitemapEntry } from '@petavu/seo';

import type { SeoSettingsRow, SitemapTaxonomyFamily } from './data.js';
import type { PageContext } from './pages/types.js';
import { categoryUrl, industryUrl, locationUrl, typeUrl } from './taxonomy.js';

export const SITEMAP_PARTS = ['pages', 'business_content','design', 'content', 'types', 'industries', 'locations', 'categories', 'businesses'] as const;
export type SitemapPartName = (typeof SITEMAP_PARTS)[number];

/** بخش‌هایی که به قطعه‌های شمارهٔ‌دار شکسته می‌شوند. */
const CHUNKED: ReadonlySet<SitemapPartName> = new Set(['content','business_content', 'businesses','design']);

const DEFAULT_CHUNK = 45_000;
const TAXONOMY_PARTS: ReadonlyArray<{
  name: SitemapPartName;
  family: SitemapTaxonomyFamily;
  /** مسیر مرکز این خانواده؛ فقط وقتی در نقشه می‌آید که خانواده عضو داشته باشد. */
  hub: string;
  url: (path: string) => string | null;
}> = [
  { name: 'types', family: 'type', hub: '/t', url: typeUrl },
  { name: 'industries', family: 'industry', hub: '/i', url: industryUrl },
  { name: 'locations', family: 'location', hub: '/l', url: locationUrl },
  { name: 'categories', family: 'category', hub: '/k', url: categoryUrl },
];

export interface SitemapPartRef {
  readonly name: SitemapPartName;
  /** شمارهٔ قطعه، از ۱. برای بخش‌های شکسته‌نشدنی همیشه ۱ است. */
  readonly page: number;
}

/** `businesses-2` → `{ name: 'businesses', page: 2 }`؛ هر چیز دیگر `null`. */
export function parseSitemapPart(file: string): SitemapPartRef | null {
  const match = /^(pages|business_content|design|content|types|industries|locations|categories|businesses)(?:-([1-9]\d{0,5}))?$/.exec(file);
  if (!match) return null;
  const name = match[1] as SitemapPartName;
  const page = match[2] ? Number(match[2]) : 1;
  // شماره فقط برای بخش‌های قطعه‌قطعه معنا دارد؛ `types-2` نشانی دوم برای همان فایل نیست.
  if (match[2] && !CHUNKED.has(name)) return null;
  return { name, page };
}

export function sitemapPartPath(name: SitemapPartName, page: number): string {
  return CHUNKED.has(name) ? `/sitemaps/${name}-${page}.xml` : `/sitemaps/${name}.xml`;
}

/** اندازهٔ قطعه: از تنظیمات، با کف ۱ و سقف پروتکل. */
export function sitemapChunkSize(settings: SeoSettingsRow | null): number {
  const raw = (settings?.extra as { indexing?: { max_sitemap_urls?: unknown } } | undefined)?.indexing?.max_sitemap_urls;
  const value = typeof raw === 'number' && Number.isFinite(raw) ? Math.trunc(raw) : DEFAULT_CHUNK;
  return Math.max(1, Math.min(SITEMAP_MAX_URLS, value));
}

function toIsoOrNull(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function latest(values: ReadonlyArray<string | null | undefined>): string | null {
  const dates = values.map(toIsoOrNull).filter((value): value is string => value !== null).sort();
  return dates.at(-1) ?? null;
}

/* ------------------------------------------------------------------ ایندکس */

export async function buildIndexXml(context: PageContext): Promise<string> {
  const { data, requestId, settings, config } = context;
  const origin = config.env.origins.public;
  const size = sitemapChunkSize(settings);

  const [contentCount, businessCount, ...taxonomies] = await Promise.all([
    data.sitemapContentCount(requestId),
    data.sitemapBusinessCount(requestId),
    ...TAXONOMY_PARTS.map((part) => data.sitemapTaxonomy(part.family, requestId)),
  ]);

  const businessContentCount=await data.sitemapBusinessContentCount(requestId);
  const designCount=await data.sitemapDesignCount(requestId);
  const files: Array<{ location: string; lastModified?: string | null }> = [{ location: sitemapPartPath('pages', 1) }];

  for(let page=1;page<=Math.ceil(businessContentCount/size);page++)files.push({location:sitemapPartPath('business_content',page)});
  for(let page=1;page<=Math.ceil(designCount/size);page++)files.push({location:sitemapPartPath('design',page)});

  for (let page = 1; page <= Math.ceil(contentCount / size); page += 1) {
    files.push({ location: sitemapPartPath('content', page) });
  }

  TAXONOMY_PARTS.forEach((part, index) => {
    const rows = taxonomies[index] ?? [];
    if (rows.length === 0) return;
    files.push({ location: sitemapPartPath(part.name, 1), lastModified: latest(rows.map((row) => row.last_modified)) });
  });

  for (let page = 1; page <= Math.ceil(businessCount / size); page += 1) {
    files.push({ location: sitemapPartPath('businesses', page) });
  }

  return buildSitemapIndex(files, origin);
}

/* ------------------------------------------------------------------ بخش‌ها */

/**
 * ورودی‌های یک بخش. `null` یعنی «چنین بخشی نیست» (۴۰۴): قطعهٔ بیرون از بازه، یا
 * بخشِ بی‌عضو.
 */
export async function buildPartEntries(context: PageContext, ref: SitemapPartRef): Promise<SitemapEntry[] | null> {
  const { data, requestId, settings, config } = context;
  const origin = config.env.origins.public;
  const size = sitemapChunkSize(settings);

  switch (ref.name) {
    case 'pages':
      return pagesEntries(context);
    case 'business_content': {const rows=await data.sitemapBusinessContent(size,(ref.page-1)*size,requestId);return rows.length?rows.map(v=>({url:origin+v.path,lastModified:v.last_modified,changeFrequency:'monthly' as const,priority:0.5})):null;}
    case 'design': {const rows=await data.sitemapDesignPages(size,(ref.page-1)*size,requestId);return rows.length?rows.map(v=>({url:origin+v.path,lastModified:v.last_modified,changeFrequency:'weekly' as const,priority:0.5})):null;}

    case 'businesses': {
      const rows = await data.sitemapBusinesses(size, (ref.page - 1) * size, requestId);
      if (rows.length === 0) return null;
      return rows.map((row) => ({
        url: `${origin}/b/${row.slug}`,
        lastModified: row.last_modified,
        changeFrequency: 'weekly' as const,
        priority: row.verification_level === 'none' ? 0.6 : 0.8,
      }));
    }

    case 'content': {
      const rows = await data.sitemapContent(size, (ref.page - 1) * size, requestId);
      if (rows.length === 0) return null;
      return rows.map((row) => ({
        url: `${origin}/${row.slug}`,
        lastModified: row.last_modified,
        changeFrequency: 'monthly' as const,
        priority: 0.5,
      }));
    }

    default: {
      const part = TAXONOMY_PARTS.find((candidate) => candidate.name === ref.name);
      if (!part) return null;
      const rows = await data.sitemapTaxonomy(part.family, requestId);
      const candidates = rows.flatMap((row) => {
        const path = part.url(row.path);
        return path ? [{ path, lastModified: row.last_modified }] : [];
      });
      // صفحه‌ای که فرادادهٔ سئویش noindex است، در نقشه نمی‌آید.
      const blocked = await data.noindexRoutes(candidates.map((entry) => entry.path), requestId);
      const entries = candidates
        .filter((entry) => !blocked.has(entry.path))
        .map((entry) => ({
          url: `${origin}${entry.path}`,
          lastModified: entry.lastModified,
          changeFrequency: 'weekly' as const,
          priority: 0.7,
        }));
      return entries.length > 0 ? entries : null;
    }
  }
}

/** صفحهٔ اصلی و مرکزها — هر مرکز فقط وقتی که واقعاً چیزی در آن هست. */
async function pagesEntries(context: PageContext): Promise<SitemapEntry[]> {
  const { data, requestId, config } = context;
  const origin = config.env.origins.public;

  const [businessCount, ...taxonomies] = await Promise.all([
    data.sitemapBusinessCount(requestId),
    ...TAXONOMY_PARTS.map((part) => data.sitemapTaxonomy(part.family, requestId)),
  ]);

  const hubs: Array<{ path: string; priority: number; changeFrequency: 'daily' | 'weekly' }> = [
    { path: '/', priority: 1, changeFrequency: 'daily' },
  ];
  if (businessCount > 0) hubs.push({ path: '/businesses', priority: 0.9, changeFrequency: 'daily' });
  TAXONOMY_PARTS.forEach((part, index) => {
    if ((taxonomies[index] ?? []).length > 0) hubs.push({ path: part.hub, priority: 0.8, changeFrequency: 'weekly' });
  });

  const blocked = await data.noindexRoutes(
    hubs.map((hub) => hub.path),
    requestId,
  );
  return hubs
    .filter((hub) => !blocked.has(hub.path))
    .map((hub) => ({ url: `${origin}${hub.path}`, priority: hub.priority, changeFrequency: hub.changeFrequency }));
}

export async function buildPartXml(context: PageContext, ref: SitemapPartRef): Promise<string | null> {
  const entries = await buildPartEntries(context, ref);
  return entries ? buildUrlset(entries) : null;
}
