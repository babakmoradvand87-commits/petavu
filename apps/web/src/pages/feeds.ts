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

import { buildLlmsTxt, buildRobots, type SitemapEntry } from '@petavu/seo';

import { PLATFORM_NAME, PLATFORM_TAGLINE, textPageResponse } from '../chrome.js';
import { buildIndexXml, buildPartXml, type SitemapPartRef } from '../sitemaps.js';
import { industryUrl, locationUrl, typeUrl } from '../taxonomy.js';
import type { PageContext, PageResponse } from './types.js';

/**
 * مسیرهای فنی که همیشه برای خزنده بسته‌اند، صرف‌نظر از تنظیمات:
 *   • `/readyz`: نقطهٔ بررسی آمادگی، نه محتوا.
 *   • `/search`: نتیجهٔ جست‌وجوی آزاد بی‌نهایت نشانی می‌سازد و هیچ‌کدام ارزش
 *     مستقل ندارد (Addendum §۴۴). خودش هم `noindex` است؛ بستنش در robots برای
 *     **صرفه‌جویی در بودجهٔ خزش** است، نه جایگزین noindex.
 *   • `/*?cursor=`: صفحه‌های نشانگری. محتوایشان از راه صفحهٔ اول و نقشهٔ سایت
 *     کشف می‌شود؛ خزش زنجیرهٔ نشانگرها فقط بودجه می‌خورد.
 */
const TECHNICAL_DISALLOW = ['/readyz', '/search', '/*?cursor='] as const;

/** مسیر robots: با `/` شروع شود و هیچ فاصله/خط‌جدید/`#` نداشته باشد (تزریق دستور). */
const ROBOTS_PATH = /^\/[^\s#]{0,199}$/;

export interface RobotsPolicy {
  readonly disallow: readonly string[];
  readonly allowAiCrawlers: boolean | null;
  readonly crawlDelaySeconds: number | null;
}

/**
 * سیاست robots از تنظیمات (`ops.setting` کلید `platform.robots`).
 *
 * داده، منبع حقیقت است (§103)، ولی **ورودی نامعتبر نباید فایل را بشکند یا
 * دستور تزریق کند**: robots.txt خط‌به‌خط خوانده می‌شود و یک مقدار با خط‌جدید،
 * می‌تواند `Allow: /` یا `Sitemap:` جعلی اضافه کند. پس هر مسیر با الگوی سخت
 * سنجیده می‌شود و موارد نامعتبر **دور ریخته** می‌شوند (نه اصلاح).
 */
export function parseRobotsPolicy(raw: unknown): RobotsPolicy {
  const record = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};

  const disallow = Array.isArray(record['disallow'])
    ? [...new Set((record['disallow'] as unknown[]).filter((entry): entry is string => typeof entry === 'string' && ROBOTS_PATH.test(entry)))].slice(0, 50)
    : [];

  const delay = record['crawl_delay_seconds'];
  const crawlDelaySeconds = typeof delay === 'number' && Number.isInteger(delay) && delay > 0 && delay <= 60 ? delay : null;

  return {
    disallow,
    allowAiCrawlers: typeof record['allow_ai_crawlers'] === 'boolean' ? (record['allow_ai_crawlers'] as boolean) : null,
    crawlDelaySeconds,
  };
}

type AiPolicy = 'allow' | 'disallow' | 'search-only';

/**
 * سیاست خزنده‌های هوش مصنوعی: تنظیم سئو (سه‌حالته) ⇒ تنظیم سئو (بولی) ⇒ تنظیم
 * robots پلتفرم ⇒ مجاز. هر لایه فقط وقتی که مقدار معتبر دارد، اثر می‌گذارد.
 */
export function resolveAiPolicy(context: PageContext, policy: RobotsPolicy): AiPolicy {
  const indexing = (context.settings?.extra as { indexing?: { ai_policy?: unknown; allow_ai_crawlers?: unknown } } | undefined)?.indexing;
  const explicit = indexing?.ai_policy;
  if (explicit === 'allow' || explicit === 'disallow' || explicit === 'search-only') return explicit;
  if (typeof indexing?.allow_ai_crawlers === 'boolean') return indexing.allow_ai_crawlers ? 'allow' : 'disallow';
  if (policy.allowAiCrawlers !== null) return policy.allowAiCrawlers ? 'allow' : 'disallow';
  return 'allow';
}

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
export async function robotsPage(context: PageContext, options: { indexingEnabled: boolean }): Promise<PageResponse> {
  const { config, requestId } = context;

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

  const policy = parseRobotsPolicy(await context.data.platformSetting('platform.robots', requestId));

  const body = buildRobots({
    environment: config.environment,
    baseUrl: config.env.origins.public,
    // ایندکس نقشهٔ سایت، تنها نقطهٔ ورود؛ بخش‌ها از همان‌جا کشف می‌شوند.
    sitemaps: [`${config.env.origins.public}/sitemap.xml`],
    /*
     * مسیرهای بی‌ارزش برای خزنده — نه محتوای خصوصی. خصوصی هرگز نباید
     * «قابل‌کشف ولی ممنوع» باشد؛ باید از دسترس بیرون باشد. فهرست از تنظیمات
     * می‌آید و مسیرهای فنی همیشه به آن افزوده می‌شود.
     */
    disallow: [...new Set([...policy.disallow, ...TECHNICAL_DISALLOW])],
    crawlDelaySeconds: policy.crawlDelaySeconds,
    // سیاست هوش مصنوعی صریح است، نه با سکوت (Addendum §GEO).
    aiPolicy: resolveAiPolicy(context, policy),
  });

  return textPageResponse(200, 'text', body);
}

export async function llmsPage(context: PageContext): Promise<PageResponse> {
  const { config, chrome, data, requestId } = context;
  const origin = config.env.origins.public;

  const [types, industries, cities] = await Promise.all([
    data.businessTypes(requestId),
    data.industryChildren(null, requestId),
    data.facetCities({}, 8, requestId),
  ]);

  /*
   * فقط آنچه واقعاً کسب‌وکار دارد: فهرستی که به صفحهٔ خالی اشاره کند، مدل را
   * به «هیچ» می‌فرستد. شمارنده‌ها از همان داده‌ای می‌آیند که صفحه نشان می‌دهد.
   */
  const typeSections = types
    .filter((type) => type.business_count > 0)
    .sort((a, b) => b.business_count - a.business_count)
    .slice(0, 10)
    .flatMap((type) => {
      const path = typeUrl(type.key);
      return path ? [{ title: type.plural_fa ?? type.name_fa, url: `${origin}${path}`, note: `${type.business_count} کسب‌وکار` }] : [];
    });
  const industrySections = industries
    .filter((row) => row.business_count > 0)
    .slice(0, 10)
    .flatMap((row) => {
      const path = industryUrl(row.path);
      return path ? [{ title: row.name_fa, url: `${origin}${path}`, note: `${row.business_count} کسب‌وکار` }] : [];
    });
  const citySections = cities.flatMap((city) => {
    const path = locationUrl(city.path);
    return path ? [{ title: `کسب‌وکارها در ${city.name_fa}`, url: `${origin}${path}`, note: `${city.business_count} کسب‌وکار` }] : [];
  });

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
      { title: 'انواع کسب‌وکار', url: `${origin}/t`, note: 'کسب‌وکارها بر اساس نوع' },
      { title: 'صنف‌ها', url: `${origin}/i`, note: 'کسب‌وکارها بر اساس حوزهٔ فعالیت' },
      { title: 'شهرها و استان‌ها', url: `${origin}/l`, note: 'کسب‌وکارها بر اساس مکان' },
      { title: 'دسته‌های محتوا', url: `${origin}/k`, note: 'مقاله‌ها و راهنماها' },
      ...typeSections,
      ...industrySections,
      ...citySections,
      ...chrome.pages.map((page) => ({
        title: page.title,
        url: `${origin}/${page.slug}`,
        note: page.summary ?? undefined,
      })),
    ],
    disallow: [
      'نتیجهٔ جست‌وجوی داخلی و صفحه‌های نشانگری فهرست (پارامتر cursor) و مسیرهای ماشینی، برای نقل‌قول نیستند.',
      'هیچ ادعایی دربارهٔ یک کسب‌وکار نکنید که در پروفایل عمومی خودش نیامده است.',
    ],
  });

  return textPageResponse(200, 'text', body);
}

/** `/sitemap.xml`: همیشه ایندکس. بخش‌ها زیر `/sitemaps/` هستند. */
export async function sitemapPage(context: PageContext): Promise<PageResponse> {
  return textPageResponse(200, 'xml', await buildIndexXml(context));
}

/** یک بخش؛ نبودنش (بیرون از بازه یا بی‌عضو) ۴۰۴ است و صفحه‌ساز آن را می‌گوید. */
export async function sitemapPartPage(context: PageContext, ref: SitemapPartRef): Promise<PageResponse | null> {
  const xml = await buildPartXml(context, ref);
  return xml === null ? null : textPageResponse(200, 'xml', xml);
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
