/**
 * هد سئوی SSR (گام ۲۴؛ §39–۴۰، §186، Addendum §۳۹–۴۷).
 *
 * پیش از این گام، هر صفحه خودش `buildHead` را صدا می‌زد و زنجیرهٔ «عنوان از
 * کجا می‌آید» در چهار فایل تکرار می‌شد. این ماژول همان زنجیره را **یک‌جا** و
 * **داده‌محور** می‌کند:
 *
 *   ۱. **عنوان**: متادیتای دستی (`seo.metadata.title`) → قالب فعال
 *      (`seo.template`) → قالب عمومی تنظیمات (`seo.settings.title_template`)
 *      → عنوان پیش‌فرض خودِ صفحه. هر پله، شرط ورود دارد؛ و اگر همه خالی
 *      باشند، پلهٔ بعد خطا نمی‌دهد، فقط جلو نمی‌رود.
 *   ۲. **کانونیکال**: نشانی ثبت‌شده در متادیتا → قاعدهٔ `seo.canonical` →
 *      خودنویس. پارامترهای ردیابی (`utm_*`, `fbclid`, …) همیشه کنار می‌روند؛
 *      وگرنه هر کمپین، یک نسخهٔ تکراری از صفحه می‌سازد.
 *   ۳. **hreflang**: از **دادهٔ واقعی** می‌آید. تا وقتی متادیتای زبان دیگری
 *      برای همان موجودیت ثبت نشده، نشانی جانشین ساخته نمی‌شود؛ ساختن مسیر
 *      «حدسی» برای زبانی که وجود ندارد، همان لینک شکسته است (§102).
 *   ۴. **دادهٔ ساخت‌یافته**: گراف پایه (برند + موجودیت) با ردیف‌های
 *      `seo.structured_data` **ادغام** می‌شود — پس یک کسب‌وکار می‌تواند
 *      `FAQPage` یا `Offer` اضافه کند، بدون اینکه موتور رندر عوض شود.
 *
 * قاعدهٔ امنیتی این ماژول: پیلود `seo.structured_data` **داده** است، پس فقط
 * اگر شیء JSON باشد و هیچ کلید/مقدار خطرناکی نداشته باشد می‌پذیریم؛ خروجی هم
 * با `serializeJsonLd` امن‌سازی می‌شود (همان مسیر سریال‌سازی، بدون استثنا).
 */

import {
  buildHead,
  clampDescription,
  renderTemplate,
  resolveCanonical,
  resolveRobots,
  serializeJsonLd,
  stripTrackingParams,
  type HeadTag,
  type JsonLdNode,
  type RobotsDirective,
} from '@petavu/seo';

import type { SitePolicy } from './config.js';
import type { CanonicalRuleRow, SeoMetadataRow, SeoStructuredRow, SeoTemplateRow } from './data.js';
import type { PageContext } from './pages/types.js';
import { resolveAssetSource } from './media.js';
import type { SeoSettingsRow } from './data.js';

const TRACKING_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'msclkid', 'ref', 'yclid'];

export interface HeadEntity {
  readonly kind:
    | 'home'
    | 'business'
    | 'content'
    | 'search'
    | 'listing'
    | 'category'
    | 'location'
    | 'business_type'
    | 'industry'
    | 'index';
  /** شناسهٔ موجودیت در جدول خودش؛ برای `home` تهی است. */
  readonly id: string | null;
  /** کلید مسیر برای صفحه‌های بدون موجودیت (مثلاً فهرست). */
  readonly routeKey: string | null;
  /** دامنهٔ دقیق‌تر قالب: مثلاً `service` برای محتوای خدمت. */
  readonly subtype?: string | null;
  /** مقادیر قالب: `{name}`, `{city}`, `{type}`, `{site}` … */
  readonly values: Readonly<Record<string, unknown>>;
}

export interface PageHeadInput {
  readonly context: PageContext;
  readonly site: SitePolicy;
  /** مسیر موجز صفحه (`/b/pet-shop`) — بدون کوئری. */
  readonly path: string;
  /** کوئری درخواست؛ برای تشخیص پارامترهای نشانگری استفاده می‌شود. */
  readonly search?: URLSearchParams;
  readonly entity: HeadEntity;
  readonly fallbackTitle: string;
  readonly fallbackDescription: string | null;
  readonly indexable: boolean;
  readonly nonIndexableReason?: string | null;
  /** دستورهای robots اضافه (مثلاً `max-image-preview:large`). */
  readonly extraDirectives?: readonly RobotsDirective[];
  readonly pagination?: { prev?: string | null; next?: string | null };
  /**
   * پارامترهایی که بخشی از هویت صفحه‌اند (مثل نشانگر صفحه‌بندی). فقط با سیاست
   * `self_canonical` در کانونیکال می‌مانند؛ با `canonical_to_first` هم حذف می‌شوند.
   */
  readonly canonicalKeepParams?: readonly string[];
  readonly og?: { type?: string; title?: string | null; description?: string | null; image?: string | null };
  readonly imageAlt?: string | null;
}

export interface HeadResult {
  readonly tags: readonly HeadTag[];
  readonly title: string;
  readonly description: string | null;
  readonly canonical: string;
  readonly canonicalReason: 'self' | 'rule' | 'default_locale' | 'explicit';
  readonly indexable: boolean;
  readonly robots: readonly RobotsDirective[];
  readonly alternates: readonly { locale: string; url: string }[];
  /**
   * نودهای ساخت‌یافتهٔ اضافی (از `seo.structured_data`)، برای **ادغام در گراف
   * صفحه** — نه چاپ در بلوک جدا.
   *
   * چرا ادغام: نمودارِ چندتکه، موجودیت‌ها را به هم وصل نمی‌کند. با یک گراف،
   * `FAQPage` می‌تواند به همان `Organization`/`LocalBusiness` صفحه ارجاع بدهد و
   * موتور، «کدام کسب‌وکار صاحب این پرسش‌هاست» را می‌فهمد. (§data-model، Addendum §۴۱)
   */
  readonly structuredNodes: readonly JsonLdNode[];
  readonly findings: readonly string[];
}

/** پیش‌فرض‌های هر نوع صفحه، یک‌جا. */
const DIRECTIVES_BY_KIND: Readonly<Record<HeadEntity['kind'], readonly RobotsDirective[]>> = {
  home: ['max-image-preview:large', 'max-snippet:-1', 'max-video-preview:-1'],
  business: ['max-image-preview:large', 'max-snippet:-1'],
  content: ['max-image-preview:large', 'max-snippet:-1'],
  search: ['noindex', 'follow'],
  listing: ['max-image-preview:large'],
  category: ['max-image-preview:large'],
  location: ['max-image-preview:large'],
  // گام ۲۵: صفحه‌های تاکسونومی، همانند فهرست‌اند — محتوایشان فهرست کسب‌وکارهاست.
  business_type: ['max-image-preview:large'],
  industry: ['max-image-preview:large'],
  index: ['noindex', 'follow'],
};

export async function buildPageHead(input: PageHeadInput): Promise<HeadResult> {
  const { context, site } = input;
  const { config, settings, requestId } = context;
  const origin = config.env.origins.public;
  const locale = settings?.default_locale ?? 'fa-IR';
  const findings: string[] = [];

  const policyTarget = { kind: input.entity.kind, id: input.entity.id, routeKey: input.entity.routeKey, locale };

  const [templates, metadata, policy, rules, alternates, structured] = await Promise.all([
    context.data.seoTemplates(input.entity.kind, input.entity.subtype ?? null, requestId),
    context.data.pageMetadata(policyTarget, requestId),
    context.data.indexPolicy(policyTarget, requestId),
    context.data.canonicalRules(requestId),
    input.entity.id
      ? context.data.pageAlternates({ kind: input.entity.kind, id: input.entity.id, locale }, requestId)
      : Promise.resolve([] as SeoAlternateRowLocal[]),
    context.data.structuredDataRows(
      { kind: input.entity.kind, id: input.entity.id, routeKey: input.entity.routeKey, locale },
      requestId,
    ),
  ]);

  const values: Record<string, unknown> = {
    site: context.siteName,
    brand: context.siteName,
    locale,
    ...input.entity.values,
  };

  /* ---------------------------------------------------------------- عنوان */
  let title = input.fallbackTitle;
  let titleSource: 'metadata' | 'template' | 'settings' | 'fallback' = 'fallback';

  if (metadata?.title) {
    title = metadata.title;
    titleSource = 'metadata';
  } else {
    const rendered = renderFirstTemplate(templates, settings?.title_separator ?? '|', values, (template) => template.title_template);
    if (rendered) {
      title = rendered;
      titleSource = 'template';
    } else if (settings?.title_template) {
      const applied = renderTemplate(settings.title_template, { ...values, page: input.fallbackTitle }, {
        separator: settings.title_separator ?? '|',
      });
      if (applied.text !== '') {
        title = applied.text;
        titleSource = 'settings';
      }
    }
  }

  /* ---------------------------------------------------------------- توضیح */
  let description = input.fallbackDescription;
  if (metadata?.description) {
    description = metadata.description;
  } else {
    const rendered = renderFirstTemplate(templates, settings?.title_separator ?? '|', values, (template) => template.description_template);
    if (rendered) description = rendered;
  }

  /* ---------------------------------------------------------------- کانونیکال */
  /*
   * کانونیکال، نشانی **مرجع** است؛ پس هر پارامتری که «این بازدید» را توصیف
   * می‌کند (فیلتر، مرتب‌سازی، پارامتر ردیابی) از آن می‌رود. فقط پارامترهایی
   * می‌مانند که صفحه آن‌ها را «بخشی از هویت خودش» اعلام کرده باشد
   * (`canonicalKeepParams`، مثل نشانگر صفحه‌بندی) — و آن هم تنها اگر سیاست
   * صفحه‌بندی سایت `self_canonical` باشد. سیاست، داده است (`seo.settings.extra`)،
   * نه تصمیمی که در کد گرفته شود.
   */
  const keep = new Set(input.canonicalKeepParams ?? []);
  const sourceSearch = new URLSearchParams();
  if (paginationPolicy(settings) === 'self_canonical') {
    for (const [key, value] of input.search ?? []) {
      if (keep.has(key)) sourceSearch.set(key, value);
    }
  }
  const sourceQuery = sourceSearch.toString();
  const requestUrl = `${origin}${input.path}${sourceQuery ? `?${sourceQuery}` : ''}`;
  /*
   * بدون فهرست «نگه‌داشتنی»: پارامترهای ردیابی همیشه می‌روند. پارامترهای
   * معنادار (مثل `page` یا `q`) هم در کانونیکال نمی‌مانند، چون کانونیکال
   * نسخهٔ **مرجع** را می‌گوید، نه نسخهٔ دیده‌شده. (آزمون: «صفحه‌بندی».)
   */
  const stripped = stripTrackingParams(requestUrl);
  let canonical: string;
  let canonicalReason: HeadResult['canonicalReason'] = 'self';

  if (metadata?.canonical_url) {
    canonical = metadata.canonical_url;
    canonicalReason = 'explicit';
  } else {
    const resolved = resolveCanonical({
      url: stripped,
      baseUrl: origin,
      trailingSlash: 'strip',
      rules: rules.map((rule) => ({
        sourcePath: rule.source_path,
        canonicalPath: rule.canonical_path,
        matchKind: normalizeMatchKind(rule.match_kind),
      })),
      keepParams: [],
    });
    canonical = reconcileScheme(resolved.url, origin);
    canonicalReason = resolved.reason;

    /*
     * قاعده‌ای که مسیر را به دامنهٔ دیگری می‌برد پذیرفته نیست: کانونیکال باید
     * همان میزبان را بگوید، وگرنه صفحه عملاً به سایت کسی دیگر واگذار می‌شود و
     * (در بدترین حالت) داده‌ای که در پایگاه‌داده ثبت شده، ترافیک ما را می‌برد.
     */
    if (!isSameOrigin(canonical, origin)) {
      findings.push('canonical.rule_outside_origin');
      canonical = stripped;
      canonicalReason = 'self';
    }
  }

  /* ---------------------------------------------------------------- hreflang */
  const alternatesOut: { locale: string; url: string }[] = alternates
    .filter((row) => row.locale !== locale)
    .flatMap((row) => {
      const raw = row.canonical_url ?? row.canonical_path;
      if (typeof raw !== 'string' || raw === '') return [];
      // نشانی نسبی، با مبدأ همین سایت مطلق می‌شود؛ `hreflang` نشانی مطلق می‌خواهد.
      const absolute = raw.startsWith('/') ? `${origin}${raw}` : raw;
      return isSameOrigin(absolute, origin) ? [{ locale: row.locale, url: absolute }] : [];
    });

  if (alternatesOut.length > 0) {
    // `x-default` فقط وقتی معنا دارد که واقعاً چند زبان داشته باشیم.
    alternatesOut.push({ locale: 'x-default', url: canonical });
  }

  /* ---------------------------------------------------------------- robots */
  /*
   * سیاست صفحه از پایگاه‌داده می‌آید (`seo.metadata`)، ولی **فقط در جهت
   * سخت‌گیرانه‌تر**: داده می‌تواند بگوید «نمایه نکن»، نمی‌تواند صفح‌هٔ noindex
   * شده توسط میزبان/محیط را دوباره نمایه‌شدنی کند.
   */
  /*
   * سه دروازه، همه باید باز باشند. دو تای آخر **داده‌اند، نه کد**: تا وقتی
   * `seo.settings.indexing_enabled` روشن نشده و `seo.settings.environment`
   * «production» نشده، هیچ صفحه‌ای نمایه نمی‌شود. این همان پیش‌فرض محافظه‌کارانهٔ
   * seed است که نمی‌گذارد یک staging یا نصب تازه، بی‌خبر در موتور جست‌وجو برود —
   * و همان چیزی که `robots.txt` هم می‌گوید، پس این دو هیچ‌وقت ناهم‌سو نمی‌شوند.
   */
  const settingsIndexable =
    (settings?.indexing_enabled ?? false) && (settings?.environment ?? 'development') === 'production';
  const dataIndexable = policy?.is_indexable ?? input.indexable;
  const indexable = site.indexable && settingsIndexable && input.indexable && dataIndexable;
  const nonIndexableReason = input.nonIndexableReason ?? policy?.non_indexable_reason ?? null;

  const dataDirectives = (policy?.robots_directives ?? []).filter(isKnownDirective);
  if ((policy?.robots_directives?.length ?? 0) !== dataDirectives.length) {
    findings.push('robots.unknown_directive_ignored');
  }

  const directives = orderDirectives(
    resolveRobots({
      indexable,
      nonIndexableReason,
      environment: config.environment,
      robots: [...DIRECTIVES_BY_KIND[input.entity.kind], ...(input.extraDirectives ?? []), ...dataDirectives],
    }),
  );

  /* ---------------------------------------------------------------- دادهٔ ساخت‌یافته */
  const { nodes: structuredNodes, findings: structuredFindings } = readStructuredRows(structured);
  findings.push(...structuredFindings);

  /* ---------------------------------------------------------- og:image و og:متن */
  /*
   * og:image فقط وقتی می‌آید که **دارایی واقعی** داشته باشیم؛ اگر نباشد، تگ
   * چاپ نمی‌شود. تصویر جعلی یا نشانی حدسی، بدتر از نبود تصویر است (§102).
   */
  let shareImage = input.og?.image ?? null;
  if (!shareImage && metadata?.share_asset_id) {
    const assets = await context.data.mediaAssets([metadata.share_asset_id], requestId);
    const asset = assets[0];
    const source = asset ? resolveAssetSource(asset) : null;
    shareImage = source ? absoluteAssetUrl(source.url, origin) : null;
    if (!source) findings.push('og.image_unresolved');
  }

  /*
   * متن کارت اشتراک‌گذاری، قالب جدا دارد (`og_*_template`) چون لحن کارت شبکه‌های
   * اجتماعی با متن نتایج جست‌وجو یکی نیست: کارت باید کوتاه‌تر و دعوتی‌تر باشد.
   * اگر قالب نبود، همان عنوان/توضیح صفحه می‌آید.
   */
  const ogTitle =
    metadata?.share_title ??
    input.og?.title ??
    renderFirstTemplate(templates, settings?.title_separator ?? '|', values, (template) => template.og_title_template) ??
    title;
  const ogDescription =
    input.og?.description ??
    renderFirstTemplate(templates, settings?.title_separator ?? '|', values, (template) => template.og_description_template) ??
    description;

  /* ---------------------------------------------------- تگ‌های اضافهٔ هد (فیلترشده) */
  const extraHeadTags = readExtraHead(metadata?.extra_head ?? null, findings);

  const tags: HeadTag[] = buildHead({
    url: `${origin}${input.path}`,
    title,
    description: clampDescription(description ?? input.fallbackDescription ?? ''),
    canonical,
    indexable,
    nonIndexableReason,
    robots: directives,
    locale,
    alternates: alternatesOut.length > 0 ? alternatesOut : undefined,
    environment: config.environment,
    pagination: input.pagination,
    verification: verificationCodes(settings?.extra),
    og: {
      type: input.og?.type ?? 'website',
      title: ogTitle,
      description: ogDescription,
      image: shareImage,
      imageAlt: input.imageAlt ?? null,
      siteName: context.siteName,
      locale,
    },
    twitter: settings?.twitter_handle ? { site: settings.twitter_handle } : undefined,
  });

  tags.push(...extraHeadTags);

  if (titleSource === 'fallback' && input.entity.kind !== 'home') {
    findings.push('title.used_fallback');
  }

  return {
    tags,
    title,
    description,
    canonical,
    canonicalReason,
    indexable,
    robots: directives,
    alternates: alternatesOut,
    structuredNodes,
    findings,
  };
}

/**
 * دستورهای robots شناخته‌شده. مقدار ناشناخته از داده پذیرفته نمی‌شود، چون
 * `buildHead` فقط همان واژگان را می‌شناسد و مقدار ناشناخته می‌تواند بی‌سروصدا
 * حذف شود یا (بدتر) رشتهٔ دلبخواهی را وارد هد کند.
 */
const KNOWN_DIRECTIVES = new Set<string>([
  'noindex', 'nofollow', 'noarchive', 'nosnippet', 'noimageindex',
  'max-snippet:-1', 'max-image-preview:large', 'max-video-preview:-1', 'index', 'follow',
]);

function isKnownDirective(value: string): value is RobotsDirective {
  return KNOWN_DIRECTIVES.has(value);
}

/** نوع محلی برای خوانایی؛ شکلش همان ردیف `seo.metadata` زبانی دیگر است. */
interface SeoAlternateRowLocal {
  readonly locale: string;
  readonly canonical_url: string | null;
  readonly canonical_path?: string | null;
}

function renderFirstTemplate(
  templates: readonly SeoTemplateRow[],
  separator: string,
  values: Record<string, unknown>,
  pick: (template: SeoTemplateRow) => string | null,
): string | null {
  for (const template of templates) {
    const pattern = pick(template);
    if (!pattern) continue;
    const rendered = renderTemplate(pattern, values, { separator });
    if (rendered.text !== '') return rendered.text;
  }
  return null;
}

/**
 * کدهای بازرسی موتورها (`google-site-verification`, `msvalidate.01`) از
 * `seo.settings.extra` می‌آیند — داده، نه کد. ساختار انتظاری:
 * `{"verification":[{"name":"google-site-verification","content":"…"}]}`.
 */
export function verificationCodes(extra: unknown): { name: string; content: string }[] {
  if (typeof extra !== 'object' || extra === null) return [];
  const list = (extra as Record<string, unknown>)['verification'];
  if (!Array.isArray(list)) return [];

  const out: { name: string; content: string }[] = [];
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const name = typeof record['name'] === 'string' ? record['name'] : null;
    const content = typeof record['content'] === 'string' ? record['content'] : null;
    if (!name || !content) continue;
    // نام متا فقط با حروف کوچک و خط تیره؛ مقدار، بدون نویسهٔ کنترلی.
    if (!/^[a-z][a-z0-9-]{2,40}$/.test(name)) continue;
    if (/[<>"']/u.test(content) || content.length > 200) continue;
    out.push({ name, content });
  }
  return out.slice(0, 5);
}

/**
 * ردیف‌های `seo.structured_data` ⇒ نودهای امن.
 *
 * سه فیلتر: نوع اسکیما در فهرست مجاز باشد، پیلود شیء JSON باشد (نه رشته، نه
 * آرایهٔ نودهای تزریقی)، و هیچ کلید ممنوعی در آن نباشد. هر رد شدن، یافته می‌دهد.
 */
export function readStructuredRows(rows: readonly SeoStructuredRow[]): {
  nodes: JsonLdNode[];
  findings: string[];
} {
  const nodes: JsonLdNode[] = [];
  const findings: string[] = [];

  for (const row of rows) {
    const payload = typeof row.payload === 'string' ? safeJson(row.payload) : row.payload;
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      findings.push(`structured_data.not_object:${row.schema_type}`);
      continue;
    }

    const record = payload as Record<string, unknown>;

    /*
     * پیلود تهی رد می‌شود. دو دلیل: یک نود بدون هیچ ویژگی، اطلاعاتی حمل نمی‌کند
     * و فقط نویزِ پاسخ است؛ و اگر کلیدها «نامرئی» باشند (مثل `__proto__` که در
     * نوشتن با شیء، به پروتوتایپ می‌رود نه به کلید)، تهی‌شدن، نشانهٔ همان دستکاری
     * است. رد کردن، امن‌تر از حدس زدن است.
     */
    if (Object.keys(record).length === 0) {
      findings.push(`structured_data.empty:${row.schema_type}`);
      continue;
    }

    if (findUnsafeKey(record)) {
      findings.push(`structured_data.unsafe_key:${row.schema_type}`);
      continue;
    }

    if (findUnsafeValue(record)) {
      findings.push(`structured_data.unsafe_value:${row.schema_type}`);
      continue;
    }

    if (!/^[A-Za-z][A-Za-z0-9]{1,40}$/.test(row.schema_type)) {
      findings.push(`structured_data.bad_type:${row.schema_type}`);
      continue;
    }

    const node: JsonLdNode = {
      ...record,
      '@type': row.schema_type,
      ...(row.subtype ? { additionalType: row.subtype } : {}),
    };

    if (!isBounded(node, 0)) {
      findings.push(`structured_data.too_large:${row.schema_type}`);
      continue;
    }

    nodes.push(node);
  }

  return { nodes, findings };
}

const UNSAFE_KEY = /^(__proto__|constructor|prototype|@context|script|html|style)$/i;

/**
 * نگهبان **مقدار** — کلید تنها مرز نیست.
 *
 * نشانی با طرح اجرایی (`javascript:`، `data:`، `vbscript:`) در دادهٔ ساخت‌یافته
 * جای ندارد: مصرف‌کنندهٔ JSON-LD ممکن است آن را به `href` تبدیل کند و آن‌وقت
 * «دادهٔ بی‌جان» به «کد اجراشدنی» تبدیل شده است. `</` هم رد می‌شود — نه به این
 * دلیل که سریال‌ساز escape نمی‌کند (می‌کند)، بلکه برای اینکه دو لایهٔ دفاع
 * داشته باشیم (§191).
 */
const UNSAFE_VALUE = /^\s*(javascript|data|vbscript)\s*:/i;

function findUnsafeValue(value: unknown, depth = 0): boolean {
  if (depth > 4) return true;
  if (typeof value === 'string') return UNSAFE_VALUE.test(value) || value.includes('</');
  if (Array.isArray(value)) return value.some((entry) => findUnsafeValue(entry, depth + 1));
  if (typeof value === 'object' && value !== null) {
    return Object.values(value as Record<string, unknown>).some((entry) => findUnsafeValue(entry, depth + 1));
  }
  return false;
}

function findUnsafeKey(value: Record<string, unknown>, depth = 0): boolean {
  if (depth > 4) return true;
  for (const [key, entry] of Object.entries(value)) {
    if (UNSAFE_KEY.test(key)) return true;
    if (typeof entry === 'string' && /<\s*script|javascript:/i.test(entry)) return true;
    if (typeof entry === 'object' && entry !== null) {
      if (Array.isArray(entry)) {
        for (const item of entry) {
          if (typeof item === 'object' && item !== null && findUnsafeKey(item as Record<string, unknown>, depth + 1)) return true;
        }
      } else if (findUnsafeKey(entry as Record<string, unknown>, depth + 1)) {
        return true;
      }
    }
  }
  return false;
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** بلوک JSON-LD از نودهای ساخت‌یافتهٔ پایگاه‌داده (پس از ادغام در گراف). */
export function serializeStructuredNodes(nodes: readonly JsonLdNode[]): string | null {
  if (nodes.length === 0) return null;
  return serializeJsonLd(nodes);
}

/**
 * سقف اندازهٔ یک نود دادهٔ ساخت‌یافته.
 *
 * چرا: پیلود از پایگاه‌داده می‌آید و می‌تواند دستی نوشته شده باشد. یک نود
 * بی‌مرز (۱۰ هزار عضو یا رشتهٔ یک‌مگابایتی) هم صفحه را سنگین می‌کند و هم
 * بودجهٔ عملکرد را می‌شکند؛ پس اندازه، قید پذیرش است نه توصیه.
 */
function isBounded(value: unknown, depth: number): boolean {
  if (depth > 6) return false;
  if (typeof value === 'string') return value.length <= 2000;
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return true;
  if (Array.isArray(value)) return value.length <= 100 && value.every((item) => isBounded(item, depth + 1));
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).every((item) => isBounded(item, depth + 1));
  return false;
}

/** مقدار ستون `match_kind` → نوع بستهٔ بستهٔ سئو (مقدار ناشناخته ⇒ `exact`). */
function normalizeMatchKind(value: string): 'exact' | 'prefix' | 'pattern' {
  return value === 'prefix' || value === 'pattern' ? value : 'exact';
}

/**
 * ترتیب دستورهای robots: «ممنوعیت‌ها» اول، سپس راهنماهای نمایش.
 *
 * از نظر خزنده ترتیب مهم نیست، ولی برای کسی که هد را می‌خواند تفاوت دارد:
 * `noindex` باید در نگاه اول دیده شود، نه بعد از سه راهنمای طول و تصویر.
 */
function orderDirectives(directives: readonly RobotsDirective[]): RobotsDirective[] {
  const priority: readonly string[] = ['noindex', 'nofollow', 'noarchive', 'nosnippet', 'noimageindex'];
  return [...directives].sort((a, b) => {
    const rank = (value: string): number => {
      const index = priority.indexOf(value);
      return index === -1 ? priority.length : index;
    };
    return rank(a) - rank(b);
  });
}

/**
 * طرح نشانی کانونیکال را با مبدأ سایت هم‌راستا می‌کند.
 *
 * موتور سئو عمداً همهٔ کانونیکال‌ها را `https` می‌کند (تولید همیشه امن است).
 * اما در محیط اجرای محلی، سایت با `http` سرو می‌شود و کانونیکالی که به `https`
 * اشاره کند، به نشانی‌ای اشاره می‌کند که وجود ندارد — همان «نشانی مرجعی که
 * کار نمی‌کند» و خزنده را دو بار می‌فرستد. پس اگر میزبان یکی است، طرح را از
 * مبدأ سایت می‌گیریم؛ میزبانِ دیگر دست‌نخورده می‌ماند تا بازرسی ردش کند.
 */
function reconcileScheme(url: string, origin: string): string {
  try {
    const target = new URL(url);
    const base = new URL(origin);
    if (target.hostname !== base.hostname) return url;
    target.protocol = base.protocol;
    return target.toString();
  } catch {
    return url;
  }
}

/**
 * آیا نشانی کانونیکال روی **همین میزبان** است؟
 *
 * مقایسه بر پایهٔ میزبان است، نه رشتهٔ کامل: `normalizeUrl` در پکیج سئو عمداً
 * طرح را `https` می‌کند (کانونیکال تولید همیشه امن است) و `www.` را برمی‌دارد؛
 * پس مقایسهٔ رشته‌ای، کانونیکال سالم را در محیط توسعهٔ `http` بیرون‌از‌مبدأ
 * می‌دید و آن را دور می‌ریخت.
 */
function isSameOrigin(url: string, origin: string): boolean {
  try {
    const target = new URL(url);
    const base = new URL(origin);
    const normalize = (hostname: string): string => hostname.toLowerCase().replace(/^www\./, '');
    return normalize(target.hostname) === normalize(base.hostname);
  } catch {
    return false;
  }
}

/** کمکی برای صفحه‌ها: مسیر بدون کوئری، همان چیزی که کانونیکال از آن ساخته می‌شود. */
export function pathOf(url: URL): string {
  return url.pathname === '' ? '/' : url.pathname;
}

/** فهرست پارامترهای ردیابی — برای آزمون و بازرسی. */
export const TRACKING_PARAM_LIST = TRACKING_PARAMS;

/**
 * سیاست صفحه‌بندی سایت، از داده.
 *
 * دو رفتار پذیرفته‌شده در صنعت: هر صفحه خودش را کانونیکال اعلام کند
 * (`self_canonical` — پیشنهاد فعلی موتورها همراه با `rel=next/prev`) یا همهٔ
 * صفحه‌ها به صفحهٔ اول اشاره کنند (`canonical_to_first`). انتخاب، داده است.
 */
export function paginationPolicy(settings: SeoSettingsRow | null): 'self_canonical' | 'canonical_to_first' {
  const extra = settings?.extra;
  if (typeof extra !== 'object' || extra === null) return 'self_canonical';
  const value = (extra as Record<string, unknown>).pagination_policy;
  return value === 'canonical_to_first' ? 'canonical_to_first' : 'self_canonical';
}

export type { SeoMetadataRow, CanonicalRuleRow, SeoTemplateRow, SeoStructuredRow };

/**
 * نشانی دارایی را مطلق می‌کند.
 *
 * `og:image` **باید** نشانی مطلق باشد: خزندهٔ شبکهٔ اجتماعی صفحهٔ ما را نمی‌خواند،
 * فقط همان رشته را می‌بیند. مسیر نسبی در کارت، تصویر شکسته می‌دهد.
 */
function absoluteAssetUrl(url: string, origin: string): string {
  return url.startsWith('/') ? `${origin}${url}` : url;
}

/* ------------------------------------------------------------ تگ‌های اضافهٔ هد */

/**
 * فهرست مجاز `rel` برای تگ `link` در هد.
 *
 * `stylesheet` و `script` عمداً نیستند: این‌ها منبع **مسدودکنندهٔ رندر** و
 * هزینهٔ سرویس ثالث‌اند و باید از مسیر رسمی بیایند (رجیستری سرویس ثالث با
 * purpose/cost)، نه از یک فیلد دادهٔ سئو (§performance، §§79).
 */
const ALLOWED_LINK_REL = new Set([
  'preconnect', 'dns-prefetch', 'preload', 'prefetch', 'alternate', 'manifest',
  'icon', 'apple-touch-icon', 'mask-icon', 'license', 'author', 'publisher', 'me',
]);

const ALLOWED_META_HTTP_EQUIV = new Set(['x-ua-compatible']);

const LINK_ATTRS = new Set([
  'rel', 'href', 'hreflang', 'type', 'as', 'sizes', 'crossorigin', 'media', 'fetchpriority',
]);
const META_ATTRS = new Set(['name', 'property', 'content', 'media', 'http-equiv']);

/** آیا نشانی برای هد قابل قبول است؟ (`https` یا مسیر داخلی) */
function isSafeHeadUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return true;
  return /^https:\/\//i.test(trimmed);
}

/**
 * خواندن `seo.metadata.extra_head` — **آرایه‌ای از توصیف‌گرهای ساختاری**.
 *
 * چرا رشتهٔ HTML نه، توصیف‌گر بله: ستون `jsonb` است و شکل ذخیره‌شده در طراحی،
 * ساختار است. اگر رشتهٔ خام می‌پذیرفتیم، برای هر ورودی باید «پاک‌سازی» می‌کردیم
 * — و پاک‌سازی HTML، کارِ باختنی است. اینجا برعکس است: **پذیرش بر پایهٔ فهرست
 * مجاز**؛ هر کلید/مقدار ناشناخته دور ریخته می‌شود و در `findings` ثبت می‌شود
 * تا در بازرسی سئو دیده شود، نه اینکه بی‌صدا ناپدید شود (§191).
 *
 * هر عضو آرایه یکی از دو شکل است:
 *   { "rel": "preconnect", "href": "https://cdn.example", "crossorigin": "anonymous" }
 *   { "name": "google-site-verification", "content": "…" }   // یا "property": "og:…"
 */
export function readExtraHead(raw: unknown, findings: string[] = []): HeadTag[] {
  if (!Array.isArray(raw)) {
    if (raw !== null && raw !== undefined && raw !== '') findings.push('extra_head.not_array');
    return [];
  }
  if (raw.length > 12) findings.push('extra_head.too_many');

  const tags: HeadTag[] = [];
  for (const entry of raw.slice(0, 12)) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      findings.push('extra_head.rejected_entry');
      continue;
    }

    const record = entry as Record<string, unknown>;
    const rel = typeof record.rel === 'string' ? record.rel.toLowerCase() : null;

    if (rel !== null) {
      const attrs = pickAttributes(record, LINK_ATTRS, findings, 'link');
      if (attrs === null) continue;
      if (!ALLOWED_LINK_REL.has(rel)) {
        findings.push(`extra_head.rejected_link:${rel === '' ? 'no-rel' : rel}`);
        continue;
      }
      const href = attrs.href ?? '';
      if (!isSafeHeadUrl(href)) {
        findings.push('extra_head.unsafe_href');
        continue;
      }
      if (rel === 'preload' && !['font', 'script', 'style', 'image', 'fetch'].includes((attrs.as ?? '').toLowerCase())) {
        findings.push('extra_head.preload_without_as');
        continue;
      }
      tags.push({ tag: 'link', attrs: { ...attrs, rel } });
      continue;
    }

    const attrs = pickAttributes(record, META_ATTRS, findings, 'meta');
    if (attrs === null) continue;

    const httpEquiv = attrs['http-equiv']?.toLowerCase();
    if (httpEquiv !== undefined && !ALLOWED_META_HTTP_EQUIV.has(httpEquiv)) {
      // `refresh` کلاسیک‌ترین راه هدایت به دامنهٔ دیگر از دل هد است.
      findings.push('extra_head.rejected_http_equiv');
      continue;
    }

    const key = attrs.name ?? attrs.property ?? httpEquiv ?? '';
    const content = attrs.content;
    if (key === '' || content === undefined || !/^[a-z][a-z0-9._:-]{1,80}$/i.test(key)) {
      findings.push('extra_head.rejected_meta');
      continue;
    }
    if (content.length > 600 || /[<>]/.test(content)) {
      findings.push('extra_head.unsafe_content');
      continue;
    }
    tags.push({ tag: 'meta', attrs: { ...attrs } });
  }

  return tags;
}

/** ویژگی‌های مجاز یک توصیف‌گر؛ مقدارها باید رشتهٔ کوتاه باشند. */
function pickAttributes(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  findings: string[],
  kind: 'link' | 'meta',
): Record<string, string> | null {
  const attrs: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!allowed.has(key)) {
      findings.push(`extra_head.unknown_attr:${kind}:${key}`);
      return null;
    }
    if (typeof value !== 'string' || value.length > 600) {
      findings.push(`extra_head.bad_value:${kind}:${key}`);
      return null;
    }
    attrs[key] = value;
  }
  return attrs;
}
