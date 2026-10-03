/**
 * خروجی‌های ماشینی: robots، نقشهٔ سایت، llms (گام ۲۲؛ Addendum §۳۸–۴۶).
 *
 * سه تصمیم که ارزش نوشتن دارند:
 *
 *   ۱) **نقشهٔ سایت از پایگاه‌داده ساخته می‌شود، هر بار.** فایل ثابت روی دیسک،
 *      دیر یا زود از محتوا عقب می‌ماند — و نقشهٔ سایتی که نشانی‌های ۴۰۴ دارد،
 *      بدتر از نداشتنِ نقشه است.
 *   ۲) **هر ورودی، `lastmod` واقعی دارد** و ترتیب، از تازه به کهنه است. `lastmod`
 *      دروغین، اعتماد موتور را از بین می‌برد؛ پس اگر تاریخ نداریم، نمی‌نویسیم.
 *   ۳) **robots از سیاست محیط پیروی می‌کند.** در محیط غیرتولیدی، `Disallow: /`؛
 *      در تولید، اجازهٔ عمومی به‌جز مسیرهای ماشینی و دارایی‌ها.
 */

import { buildLlmsTxt, buildRobots, buildUrlset, type SitemapEntry } from '@petavu/seo';

import { PLATFORM_NAME, PLATFORM_TAGLINE, textPageResponse } from '../chrome.js';
import type { PageContext, PageResponse } from './types.js';

const SITEMAP_LIMIT = 5_000;
const STATIC_PATHS: ReadonlyArray<{ path: string; priority: number; changeFrequency: 'daily' | 'weekly' | 'monthly' }> = [
  { path: '/', priority: 1, changeFrequency: 'daily' },
  { path: '/businesses', priority: 0.9, changeFrequency: 'daily' },
];

/**
 * robots.txt.
 *
 * دو لایه تصمیم دارد و ترتیبشان مهم است:
 *   ۱) **خاموشی سراسری.** اگر ایندکس‌گذاری از دادهٔ سئو خاموش شده باشد، کل
 *      سایت بسته می‌شود — حتی در محیط تولید. این کلید توقف اضطراری است و
 *      باید پیش از هر قاعدهٔ دیگری اثر کند.
 *   ۲) **سیاست محیط.** در تولید، اجازهٔ عمومی با فهرست صریح مسیرهای بسته؛ در
 *      غیرتولید، همه‌چیز بسته (که خودِ `@petavu/seo` تصمیم می‌گیرد).
 */
export function robotsPage(context: PageContext, options: { indexingEnabled: boolean }): PageResponse {
  const { config } = context;

  if (!options.indexingEnabled) {
    return textPageResponse(
      200,
      'text',
      [
        '# PETAVU — robots.txt',
        '# ایندکس‌گذاری در تنظیمات سئو خاموش است؛ کل سایت بسته است.',
        'User-agent: *',
        'Disallow: /',
      ].join('\n'),
    );
  }

  const body = buildRobots({
    environment: config.environment,
    baseUrl: config.env.origins.public,
    sitemaps: [`${config.env.origins.public}/sitemap.xml`],
    /*
     * مسیرهای بی‌ارزش برای خزنده — نه محتوای خصوصی. خصوصی هرگز نباید
     * «قابل‌کشف ولی ممنوع» باشد؛ باید از دسترس بیرون باشد.
     */
    disallow: ['/readyz', '/businesses?cursor='],
    // سیاست هوش مصنوعی صریح است، نه با سکوت (Addendum §GEO).
    aiPolicy: 'allow',
  });

  return textPageResponse(200, 'text', body);
}

export function llmsPage(context: PageContext): PageResponse {
  const { config, chrome } = context;
  const origin = config.env.origins.public;

  /*
   * `llms.txt` فهرست کوتاهی از منابع معتبر است، نه بازتولید محتوا. پس همهٔ
   * پیوندها مطلق‌اند و هر ورودی یک یادداشت کوتاه دارد؛ مدل زبانی باید به
   * صفحهٔ اصلی ارجاع بدهد، نه اینکه محتوای ما را از حافظه بازگو کند.
   */
  const body = buildLlmsTxt({
    siteName: PLATFORM_NAME,
    summary: PLATFORM_TAGLINE,
    sections: [
      { title: 'صفحهٔ اصلی', url: `${origin}/`, note: PLATFORM_TAGLINE },
      { title: 'فهرست کسب‌وکارها', url: `${origin}/businesses`, note: 'فهرست زندهٔ کسب‌وکارهای فعال' },
      ...chrome.pages.map((page) => ({
        title: page.title,
        url: `${origin}/${page.slug}`,
        note: page.summary ?? undefined,
      })),
    ],
    disallow: [
      'صفحه‌های نشانگری فهرست (پارامتر cursor) و مسیرهای ماشینی، برای نقل‌قول نیستند.',
      'هیچ ادعایی دربارهٔ یک کسب‌وکار نکنید که در پروفایل عمومی خودش نیامده است.',
    ],
  });

  return textPageResponse(200, 'text', body);
}

export async function sitemapPage(context: PageContext): Promise<PageResponse> {
  const { config, requestId } = context;
  const origin = config.env.origins.public;

  /*
   * دو خواندن موازی: کسب‌وکارها و محتوا. موازی و نه پشت‌سرهم، چون هر کدام یک
   * رفت‌وبرگشت مستقل است و ترتیبشان اهمیتی ندارد (Addendum §۲۰).
   */
  const [businesses, contents] = await Promise.all([
    context.data.listPublicBusinesses({ limit: SITEMAP_LIMIT }, requestId),
    context.data.contentIndex(SITEMAP_LIMIT, requestId),
  ]);

  const entries: SitemapEntry[] = [
    ...STATIC_PATHS.map((entry) => ({
      url: `${origin}${entry.path}`,
      priority: entry.priority,
      changeFrequency: entry.changeFrequency,
    })),
    ...businesses.items.map((business) => ({
      url: `${origin}/b/${business.slug}`,
      lastModified: business.updated_at,
      changeFrequency: 'weekly' as const,
      priority: business.verification_level === 'none' ? 0.6 : 0.8,
    })),
    ...contents.map((item) => ({
      url: item.business_slug ? `${origin}/b/${item.business_slug}` : `${origin}/${item.slug}`,
      lastModified: item.updated_at,
      changeFrequency: 'monthly' as const,
      priority: 0.5,
    })),
    ...context.chrome.pages.map((page) => ({
      url: `${origin}/${page.slug}`,
      lastModified: page.updated_at,
      changeFrequency: 'monthly' as const,
      priority: 0.4,
    })),
  ];

  const xml = buildUrlset(dedupe(entries));
  return textPageResponse(200, 'xml', xml);
}

/**
 * یکی‌کردن نشانی‌ها.
 *
 * یک نشانی می‌تواند از چند مسیر داده بیاید (مثلاً یک کسب‌وکار و آخرین محتوای
 * همان کسب‌وکار). نقشهٔ سایت با نشانی تکراری، امتیاز منفی می‌گیرد؛ پس اول
 * یکی می‌شوند و **تازه‌ترین** `lastmod` می‌ماند.
 */
export function dedupe(entries: readonly SitemapEntry[]): SitemapEntry[] {
  const byUrl = new Map<string, SitemapEntry>();

  for (const entry of entries) {
    const previous = byUrl.get(entry.url);
    if (!previous) {
      byUrl.set(entry.url, entry);
      continue;
    }
    const previousDate = toMillis(previous.lastModified);
    const nextDate = toMillis(entry.lastModified);
    if (nextDate > previousDate) byUrl.set(entry.url, { ...entry, priority: previous.priority ?? entry.priority });
  }

  return [...byUrl.values()];
}

/** تاریخ به میلی‌ثانیه؛ مقدار نامعتبر (یا تهی) صفر می‌شود، نه `NaN`. */
function toMillis(value: string | Date | null | undefined): number {
  if (!value) return 0;
  const millis = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(millis) ? millis : 0;
}
