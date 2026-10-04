import type {FormSchemaView} from '@petavu/design/nocode';
/**
 * دادهٔ صفحه‌های وب (گام ۲۲؛ §52–۵۵، §58، §181).
 *
 * سه قاعده، بی‌استثنا:
 *
 *   ۱) **کوئری‌ها فقط از راه `withContext` + نقش `pv_public`.** نقش `pv_public`
 *      همان نقشی است که RLS برای «بی‌نام» تعریف کرده؛ پس وب‌سایت هیچ مسیر
 *      امتیازدهی‌شده‌ای ندارد (§14). اگر روزی صفحه‌ای به دادهٔ عضو نیاز داشت،
 *      این نقش بالا نمی‌رود؛ از API با نشست پرسیده می‌شود.
 *   ۲) **ستون‌ها صریح‌اند و مقدارها پارامتر.** `select *` ممنوع (§64) و هیچ
 *      مقداری داخل متن SQL نمی‌نشیند (§52).
 *   ۳) **شکست پایگاه‌داده = افت صادقانه، نه صفحهٔ جعلی.** تم نیامد؟ با پشتهٔ
 *      جانشین رندر می‌کنیم و در لاگ می‌گوییم. فهرست نیامد؟ بخش خالی می‌ماند.
 *      هیچ دادهٔ ساختگی جای دادهٔ واقعی نمی‌نشیند (§102).
 */

import {
  createDal,
  createRepositories,
  pageTail,
  raw,
  sql,
  withContext,
  type Page,
  type RequestContext,
  type Row,
  type SearchHit,
  type SqlClient,
} from '@petavu/db';
import type { Logger } from '@petavu/shared';

import type { RegistryRow } from './registry.js';
import type { MediaAssetRow } from './media.js';
import type { ThemeMode } from './tokens.js';
import { ancestorPaths, subtreePrefix } from './taxonomy.js';

export interface TokenQueryRow extends Row {
  key: string;
  group_key: string;
  value: unknown;
  value_type: 'color' | 'length' | 'number' | 'shadow' | 'font' | 'duration' | 'cubic' | 'list';
  alias_of: string | null;
  theme_mode: ThemeMode;
  description: string | null;
}

export interface PublicBusinessRow extends Row {
  id: string;
  slug: string;
  name: string;
  name_latin: string | null;
  business_type_key: string;
  industry_key: string | null;
  verification_level: string;
  listing_count: number;
  member_count: number;
  published_at: string | null;
  updated_at: string;
  tagline: string | null;
  summary: string | null;
  founded_year: number | null;
  city_name: string | null;
  city_slug: string | null;
  /** نام فارسی نوع کسب‌وکار؛ کلید خام (`pet_shop`) هرگز به کاربر نشان داده نمی‌شود. */
  type_name: string | null;
  primary_location_id: string | null;
  /** مسیر شهر (`iran.alborz.karaj`)؛ مبنای پیوند داخلی از پروفایل به صفحهٔ شهر. */
  city_path: string | null;
  industry_name: string | null;
  industry_path: string | null;
}

/* ------------------------------------------------------------------ سئوی فنی (گام ۲۶) */

export interface SitemapBusinessRow extends Row {
  slug: string;
  last_modified: string;
  verification_level: string;
}

export interface SitemapContentRow extends Row {
  slug: string;
  last_modified: string;
  kind: string;
}

/** یک صفحهٔ تاکسونومی با دست‌کم یک عضو، و تازه‌ترین تغییر اعضایش. */
export interface SitemapTaxonomyRow extends Row {
  path: string;
  last_modified: string | null;
}

export type SitemapTaxonomyFamily = 'type' | 'industry' | 'location' | 'category';

export interface InternalLinkRow extends Row {
  target_path: string;
  anchor_text: string | null;
  link_kind: string;
}

/**
 * فرادادهٔ عمومی صفحه.
 *
 * ستون‌ها همان ستون‌های واقعی `seo.metadata`اند — از جمله `robots_directives`
 * و `is_indexable`. هیچ ستونی این‌جا **ساخته** نمی‌شود: اگر ستونی در جدول
 * نباشد، در این قرارداد هم نیست (همین اشتباه یک بار در گام ۲۲ گرفتار شد:
 * `column m.robots does not exist`).
 */
export interface SeoMetadataRow extends Row {
  title: string | null;
  description: string | null;
  canonical_url: string | null;
  share_title: string | null;
  /** دارایی تصویر اشتراک‌گذاری (og:image) — اگر ثبت شده باشد. */
  share_asset_id: string | null;
  /**
   * تگ‌های هد اضافه، از سرویس‌های ثالث ثبت‌شده. `jsonb` است و **آرایه‌ای از
   * توصیف‌گرهای ساختاری** (نه رشتهٔ HTML)؛ وب آن را با فهرست مجاز می‌خواند.
   */
  extra_head: unknown;
  is_indexable: boolean;
  robots_directives: string[];
  non_indexable_reason: string | null;
  updated_at: string | null;
}

export interface ContentIndexRow extends Row {
  slug: string;
  kind: string;
  title: string;
  business_slug: string | null;
  updated_at: string;
  published_at: string | null;
}

export interface RedirectRow extends Row {
  source_path: string;
  target_path: string | null;
  status_code: number;
}

export interface SeoSettingsRow extends Row {
  title_separator: string;
  title_template: string;
  description_fallback: string | null;
  default_locale: string;
  default_region: string;
  /** حساب توییتر/ایکس سایت — برای کارت اشتراک‌گذاری. */
  twitter_handle: string | null;
  /** کلیدهای افزودنی: کدهای بازرسی موتورها، تنظیمات سرویس ثالث و… */
  extra: unknown;
  indexing_enabled: boolean;
  environment: 'production' | 'staging' | 'development';
}

/**
 * دارایی رسانه و ردیف Registry، هر دو از همین لایه خوانده می‌شوند — نه با
 * دسترسی مستقیم صفحه‌ها به پایگاه‌داده. دلیلش قاعدهٔ گام ۲۲ است: صفحه فقط
 * «چه می‌خواهد» را می‌گوید؛ اینکه چگونه و با کدام نقش خوانده می‌شود، اینجاست.
 */
/** ردیف قالب سئو (گام ۲۴) — مرجع ساخت عنوان/توضیح/کانونیکال. */
export interface SeoTemplateRow extends Row {
  key: string;
  entity_kind: string;
  subtype: string | null;
  title_template: string;
  description_template: string | null;
  canonical_template: string | null;
  og_title_template: string | null;
  og_description_template: string | null;
  priority: number;
}

/** قاعدهٔ کانونیکال — تنها جایی که «کدام نشانی مرجع است» تصمیم گرفته می‌شود. */
export interface CanonicalRuleRow extends Row {
  source_path: string;
  canonical_path: string;
  match_kind: string;
  reason: string;
}

/** ردیف دادهٔ ساخت‌یافتهٔ دستی/موتوری. */
export interface SeoStructuredRow extends Row {
  schema_type: string;
  subtype: string | null;
  payload: unknown;
  source: string;
}

export interface BusinessContactRow extends Row {
  kind: string;
  value_display: string;
  label: string | null;
  is_public: boolean;
}

export interface BusinessLocationRow extends Row {
  label: string | null;
  address_line: string | null;
  latitude: string | number | null;
  longitude: string | number | null;
  hours: unknown;
  is_primary: boolean;
}

/* ------------------------------------------------------------------ تاکسونومی (گام ۲۵) */

/** نوع کسب‌وکار با شمار کسب‌وکارهای عمومی‌اش. */
export interface TypeFacetRow extends Row {
  key: string;
  name_fa: string;
  plural_fa: string | null;
  description: string | null;
  parent_key: string | null;
  depth: number;
  business_count: number;
}

/** صنف با شمار کسب‌وکارهای **کل زیردرخت**. */
export interface IndustryFacetRow extends Row {
  key: string;
  name_fa: string;
  parent_key: string | null;
  path: string;
  depth: number;
  description: string | null;
  business_count: number;
}

/** استان/شهر با شمار کسب‌وکارهای کل زیردرخت. */
export interface LocationFacetRow extends Row {
  id: string;
  kind: string;
  name_fa: string;
  parent_id: string | null;
  path: string;
  slug: string;
  business_count: number;
}

/** دستهٔ محتوا با شمار محتوای منتشرشدهٔ کل زیردرخت. */
export interface CategoryFacetRow extends Row {
  id: string;
  slug: string;
  name_fa: string;
  description: string | null;
  parent_id: string | null;
  path: string;
  content_count: number;
}

export interface CategoryContentRow extends Row {
  id: string;
  slug: string;
  kind: string;
  title: string;
  summary: string | null;
  business_slug: string | null;
  business_name: string | null;
  published_at: string | null;
  updated_at: string;
}

export interface TaxonomyFilter {
  readonly typeKey?: string | null;
  readonly industryPath?: string | null;
  readonly locationPath?: string | null;
}

export interface WebData {
  searchMixed(query:string,requestId:string):Promise<Array<{id:string;entity_kind:string;title:string;snippet:string;path:string}>>;
  sitemapBusinessContentCount(requestId:string):Promise<number>;
  sitemapBusinessContent(limit:number,offset:number,requestId:string):Promise<Array<{path:string;last_modified:string}>>;
  publicForms(businessId:string|null,requestId:string):Promise<FormSchemaView[]>;
  publicRecords(definitionId:string,businessId:string|null,requestId:string):Promise<Array<{title:string;slug:string;business_slug:string|null}>>;
  /** توکن‌های سراسری پلتفرم — تنها چیزی که `pv_public` می‌بیند. */
  themeTokens(requestId: string, businessId?: string | null): Promise<TokenQueryRow[]>;
  themeSettings(requestId:string,businessId?:string|null):Promise<Record<string,unknown>>;
  themeFingerprint(requestId: string, businessId?: string | null): Promise<string>;
  pageRegistry(request:{businessId:string|null;key:string},requestId:string):Promise<RegistryRow[]|null>;
  sitemapDesignCount(requestId:string):Promise<number>;
  sitemapDesignPages(limit:number,offset:number,requestId:string):Promise<Array<{path:string;last_modified:string|null}>>;
  designPage(request: {businessId: string|null;key:string},requestId:string): Promise<{id:string;key:string;title:string;description:string|null;published_tree:unknown}|null>;
  seoSettings(requestId: string): Promise<SeoSettingsRow | null>;
  indexingEnabled(requestId: string): Promise<boolean>;
  businessBySlug(slug: string, requestId: string): Promise<{ business: PublicBusinessRow; metadata: SeoMetadataRow | null } | null>;
  featuredBusinesses(limit: number, requestId: string): Promise<PublicBusinessRow[]>;
  /** فهرست عمومی با صفحه‌بندی نشانگری (نه `offset`) و فیلتر نوع کسب‌وکار. */
  listPublicBusinesses(
    request: {
      limit: number;
      cursor?: string | null;
      businessTypeKey?: string | null;
      /** مسیر کامل صنف؛ کل زیردرخت را می‌گیرد. */
      industryPath?: string | null;
      /** مسیر کامل مکان؛ کل زیردرخت را می‌گیرد. */
      locationPath?: string | null;
    },
    requestId: string,
  ): Promise<Page<PublicBusinessRow>>;
  /** همهٔ انواع فعال، با شمار. */
  businessTypes(requestId: string): Promise<TypeFacetRow[]>;
  businessType(key: string, requestId: string): Promise<TypeFacetRow | null>;
  /** فرزندهای مستقیم یک صنف (`null` = ریشه‌ها) با شمار زیردرخت. */
  industryChildren(parentPath: string | null, requestId: string): Promise<IndustryFacetRow[]>;
  /** همهٔ صنف‌های فعال با شمار زیردرخت — یک پرس‌وجو برای صفحهٔ مرکز (بدون N+1). */
  industryTree(requestId: string): Promise<IndustryFacetRow[]>;
  industryByPath(path: string, requestId: string): Promise<{ industry: IndustryFacetRow; ancestors: IndustryFacetRow[] } | null>;
  /** ریشهٔ مکان‌ها (کشور). */
  locationRoot(requestId: string): Promise<LocationFacetRow | null>;
  locationChildren(parentId: string, requestId: string): Promise<LocationFacetRow[]>;
  /** همهٔ استان‌ها و شهرهای فعال با شمار زیردرخت — یک پرس‌وجو برای صفحهٔ مرکز. */
  locationTree(requestId: string): Promise<LocationFacetRow[]>;
  /** `suffix` همان مسیر بی‌ریشهٔ نشانی است (`alborz.karaj`). */
  locationBySuffix(suffix: string, requestId: string): Promise<{ location: LocationFacetRow; ancestors: LocationFacetRow[] } | null>;
  categoryChildren(parentPath: string | null, requestId: string): Promise<CategoryFacetRow[]>;
  /** همهٔ دسته‌های محتوای فعال با شمار زیردرخت — یک پرس‌وجو برای صفحهٔ مرکز. */
  categoryTree(requestId: string): Promise<CategoryFacetRow[]>;
  categoryByPath(path: string, requestId: string): Promise<{ category: CategoryFacetRow; ancestors: CategoryFacetRow[] } | null>;
  contentByCategory(
    request: { path: string; limit: number; cursor?: string | null },
    requestId: string,
  ): Promise<Page<CategoryContentRow>>;
  /** شهرهایی که واقعاً کسب‌وکار دارند، با شمار (برای پیوند داخلی). */
  facetCities(filter: TaxonomyFilter, limit: number, requestId: string): Promise<LocationFacetRow[]>;
  /** نوع‌هایی که در این محدوده واقعاً کسب‌وکار دارند، با شمار. */
  facetTypes(filter: TaxonomyFilter, limit: number, requestId: string): Promise<TypeFacetRow[]>;
  /** جست‌وجوی متنی در کسب‌وکارهای عمومی (`app.search_businesses`). */
  searchBusinesses(query: string, limit: number, requestId: string): Promise<SearchHit[]>;
  /** تنظیم سراسریِ غیرسرّی (`ops.setting`)؛ تنظیم سرّی هرگز برنمی‌گردد (RLS). */
  platformSetting(key: string, requestId: string): Promise<unknown | null>;
  sitemapBusinessCount(requestId: string): Promise<number>;
  sitemapBusinesses(limit: number, offset: number, requestId: string): Promise<SitemapBusinessRow[]>;
  sitemapContentCount(requestId: string): Promise<number>;
  sitemapContent(limit: number, offset: number, requestId: string): Promise<SitemapContentRow[]>;
  sitemapTaxonomy(family: SitemapTaxonomyFamily, requestId: string): Promise<SitemapTaxonomyRow[]>;
  /** کدام مسیرها فرادادهٔ `noindex` دارند؟ (یک پرس‌وجو برای کل فهرست.) */
  noindexRoutes(routes: readonly string[], requestId: string): Promise<Set<string>>;
  /** نرخ نمونه‌گیری RUM برای یک مسیر، از بودجهٔ همان مسیر؛ بی‌بودجه ⇒ ۰. */
  rumSampleRate(path: string, requestId: string): Promise<number>;
  /** پیوندهای داخلیِ سراسری و فعال از یک صفحه (`seo.internal_link`). */
  internalLinks(sourcePath: string, requestId: string): Promise<InternalLinkRow[]>;
  /** کسب‌وکارهای مشابه: هم‌نوع، هم‌شهرها اول، با چرخش پایدار برای پخش پیوند. */
  relatedBusinesses(business: PublicBusinessRow, limit: number, requestId: string): Promise<PublicBusinessRow[]>;
  contentIndex(limit: number, requestId: string): Promise<ContentIndexRow[]>;
  redirectFor(pathname: string, requestId: string): Promise<RedirectRow | null>;
  readiness(requestId: string): Promise<Row | null>;
  /** شمارنده‌های واقعی پلتفرم برای صفحهٔ اصلی — از خود جدول‌ها، نه ادعا. */
  platformStats(requestId: string): Promise<PlatformStats>;
  /** صفحهٔ محتوای سراسری پلتفرم از `app.content` (بدون کسب‌وکار). */
  platformPage(slug: string, requestId: string, businessId?:string|null): Promise<PlatformPageRow | null>;
  /** فهرست صفحه‌های منتشرشدهٔ پلتفرم — برای ناوبری و نقشهٔ سایت. */
  platformPages(requestId: string): Promise<PlatformPageRow[]>;
  /**
   * درخت منتشرشدهٔ یک صفحهٔ طراحی (گام ۲۳).
   *
   * ترتیب جست‌وجو: ابتدا صفحهٔ خود کسب‌وکار، بعد صفحهٔ سراسری پلتفرم. اگر
   * هیچ‌کدام منتشر نشده باشد، `null` برمی‌گردد و صفحه به چیدمان پایهٔ کد
   * برمی‌گردد — نه به یک صفحهٔ خالی.
   */
  pageTree(request: { businessId: string | null; key: string }, requestId: string): Promise<unknown | null>;
  /** ردیف‌های Registry — منبع حقیقت کامپوننت‌های مجاز. */
  componentRegistry(requestId: string): Promise<RegistryRow[]>;
  /** دارایی‌های رسانه‌ای که درخت به آن‌ها اشاره کرده (تنها همان‌ها). */
  mediaAssets(ids: readonly string[], requestId: string): Promise<MediaAssetRow[]>;
  /** یک دارایی رسانه برای مسیر `/media/:id`. */
  mediaAsset(id: string, requestId: string): Promise<MediaAssetRow | null>;
  /** مکان‌ها و راه‌های تماس **عمومی** یک کسب‌وکار (زمینهٔ بلوک تماس و نقشه). */
  businessContext(businessId: string, requestId: string): Promise<{ locations: BusinessLocationRow[]; contacts: BusinessContactRow[] }>;

  /* ---------------------------------------------------------- سئو (گام ۲۴) */

  /** قالب‌های فعال سئو برای یک نوع موجودیت، به ترتیب اولویت. */
  seoTemplates(entityKind: string, subtype: string | null, requestId: string): Promise<SeoTemplateRow[]>;
  /** سیاست نمایه‌شدن صفحه (شامل صفحه‌های `noindex`). */
  indexPolicy(
    target: { kind: string; id: string | null; routeKey: string | null; locale: string },
    requestId: string,
  ): Promise<{ is_indexable: boolean; robots_directives: string[]; non_indexable_reason: string | null } | null>;
  /** متادیتای مؤثر یک صفحه — از تابع سخت‌گیرانهٔ دامنه، نه از جدول خام. */
  pageMetadata(
    target: { kind: string; id: string | null; routeKey: string | null; locale: string },
    requestId: string,
  ): Promise<SeoMetadataRow | null>;
  /** قواعد کانونیکال فعال پلتفرم. */
  canonicalRules(requestId: string): Promise<CanonicalRuleRow[]>;
  /** نسخه‌های زبانی دیگر همان موجودیت (مبنای hreflang). */
  pageAlternates(
    target: { kind: string; id: string; locale: string },
    requestId: string,
  ): Promise<{ locale: string; canonical_url: string | null; canonical_path: string | null }[]>;
  /** ردیف‌های دادهٔ ساخت‌یافتهٔ فعال برای یک صفحه. */
  structuredDataRows(
    target: { kind: string; id: string | null; routeKey: string | null; locale: string },
    requestId: string,
  ): Promise<SeoStructuredRow[]>;
}

export interface PlatformStats extends Row {
  readonly businesses: number;
  readonly industries: number;
  readonly business_types: number;
  readonly cities: number;
  readonly contents: number;
}

export interface PlatformPageRow extends Row {
  id?:string;
  slug: string;
  kind: string;
  title: string;
  subtitle: string | null;
  summary: string | null;
  body: unknown;
  updated_at: string;
  published_at: string | null;
}

export interface WebDataOptions {
  readonly client: SqlClient;
  readonly logger: Logger;
}

/*
 * فهرست ستون‌ها به‌عنوان `raw` می‌آید چون متن ثابت است (نه ورودی کاربر)؛
 * همان الگویی که `packages/db/src/repositories/*` استفاده می‌کند.
 */
const BUSINESS_COLUMNS = raw(`
  b.id, b.slug, b.name, b.name_latin, b.business_type_key, b.industry_key,
  b.verification_level, b.listing_count, b.member_count, b.published_at, b.updated_at,
  b.primary_location_id,
  p.tagline, p.summary, p.founded_year,
  l.slug as city_slug, l.name_fa as city_name, l.path as city_path,
  bt.name_fa as type_name,
  ind.name_fa as industry_name, ind.path as industry_path
`);

const BUSINESS_SOURCE = raw(`
  from app.business b
  left join app.business_profile p on p.business_id = b.id
  left join ref.location l on l.id = b.primary_location_id
  left join ref.business_type bt on bt.key = b.business_type_key
  left join ref.industry ind on ind.key = b.industry_key
`);

/*
 * شرط «کسب‌وکار عمومی و فعال».
 *
 * یک جا نوشته می‌شود تا پانزده پرس‌وجوی تاکسونومی یک تعریف از «عمومی» داشته
 * باشند. این شرط، همان شرط سیاست `business_public_select` است؛ سیاست، مرز
 * امنیتی است و این شرط، بهینه‌سازی (§22: انتشار عمومی یک تصمیم است).
 */
const VISIBLE_BUSINESS = raw("b.status = 'active' and b.visibility = 'public' and b.deleted_at is null");

/*
 * شمار محتوای منتشرشدهٔ یک دسته (کل زیردرخت).
 *
 * `c` همان دستهٔ بیرونی است. محتوای کسب‌وکارِ غیرعمومی شمرده نمی‌شود: شمارنده‌ای
 * که به صفحه‌ای اشاره کند که کاربر نمی‌بیند، ادعای نادرست است (§186).
 */
const CATEGORY_CONTENT_COUNT = raw(`
  select count(distinct ct.id)
  from app.content ct
  join app.content_category cc on cc.content_id = ct.id
  join ref.category x on x.id = cc.category_id
  left join app.business b on b.id = ct.business_id and b.status = 'active' and b.visibility = 'public' and b.deleted_at is null
  where ct.status = 'published' and ct.visibility = 'public' and ct.deleted_at is null
    and (ct.published_at is null or ct.published_at <= now())
    and (ct.business_id is null or b.id is not null)
    and (x.path = c.path or starts_with(x.path, c.path || '.'))
`);

const METADATA_COLUMNS = raw(
  'm.title, m.description, m.canonical_url, m.share_title, m.share_asset_id, m.extra_head, m.is_indexable, m.robots_directives, m.non_indexable_reason, m.updated_at',
);

/*
 * همان ستون‌ها با نام‌مستعار `x` — برای زیرپرس‌وجوی `union all`.
 *
 * چرا `select *` نه: نگهبان DAL آن را رد می‌کند (§64) و درست هم می‌کند: `*`
 * با هر ستون تازه‌ای در جدول، قرارداد را بی‌سروصدا عوض می‌کند. همین نگهبان،
 * اولین اجرای این کوئری را گرفت.
 */
const METADATA_UNION_COLUMNS = raw(
  'x.title, x.description, x.canonical_url, x.share_title, x.share_asset_id, x.extra_head, x.is_indexable, x.robots_directives, x.non_indexable_reason, x.updated_at',
);

export function createWebData(options: WebDataOptions): WebData {
  const { client, logger } = options;

  /**
   * اجرای خواندن بی‌نام در نقش `pv_public`.
   *
   * حتی اگر روزی شرطی در کوئری جا بماند، سیاست‌های RLS جلوی خواندن دادهٔ
   * غیرعمومی را می‌گیرند. این «لایهٔ دوم» است، نه جانشین شرط‌ها.
   */
  async function read<T>(
    requestId: string,
    fn: (helpers: { repos: ReturnType<typeof createRepositories>; dal: ReturnType<typeof createDal> }) => Promise<T>,
  ): Promise<T> {
    const context: RequestContext = {
      userId: null,
      businessId: null,
      sessionId: null,
      platformRole: null,
      impersonatedBy: null,
      requestId,
    };

    return withContext(
      client,
      context,
      async (tx) => {
        // مهلت کوتاه‌تر از API: صفحهٔ عمومی باید سریع شکست بخورد و جانشین بدهد،
        // نه اینکه کاربر را معطل نگه دارد (Addendum §۹۱: سقف p95).
        const dal = createDal(tx);
        return fn({ repos: createRepositories({ dal, context }), dal });
      },
      { role: 'pv_public' },
    );
  }

  /**
   * افت صادقانه: خطا لاگ می‌شود و مقدار جانشین برمی‌گردد.
   *
   * `cause` را هم لاگ می‌کنیم چون `mapDatabaseError` پیام اصلی پایگاه‌داده را
   * ماسک می‌کند (عامدانه: پیام خام نباید به کاربر برسد). اما در لاگ، بدون
   * علت، «خطای غیرمنتظره» یک بن‌بست عیب‌یابی است.
   */
  async function degrade<T>(action: string, fallback: T, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      const cause = (error as { cause?: { message?: string; code?: string } }).cause;
      logger.error('خواندن دادهٔ وب شکست خورد', {
        action,
        error: error instanceof Error ? error.message : String(error),
        cause: cause?.message ?? null,
        code: cause?.code ?? null,
      });
      return fallback;
    }
  }

  return {
    searchMixed(query,requestId){return degrade('search.mixed',[],()=>read(requestId,({dal})=>dal.query<{id:string;entity_kind:string;title:string;snippet:string;path:string}>(sql`select id,entity_kind,title,snippet,path from seo.search_public(${query},24,null,null)`)));},
    sitemapBusinessContentCount(requestId){return degrade('sitemap.businessContentCount',0,()=>read(requestId,async({dal})=>{const row=await dal.maybeOne<{n:number}>(sql`select seo.sitemap_business_content_count()::int n`);return row?.n??0;}));},
    sitemapBusinessContent(limit,offset,requestId){return degrade('sitemap.businessContent',[],()=>read(requestId,({dal})=>dal.query<{path:string;last_modified:string}>(sql`select path,last_modified from seo.sitemap_business_content(${limit},${offset})`)));},
    publicForms(businessId,requestId){return degrade('nocode.forms',[],()=>read(requestId,async({dal})=>{const row=await dal.maybeOne<{items:FormSchemaView[]}>(sql`select design.public_forms(${businessId}::uuid) items`);return row?.items??[];}));},
    publicRecords(definitionId,businessId,requestId){return degrade('nocode.records',[],()=>read(requestId,async({dal})=>{const row=await dal.maybeOne<{items:Array<{title:string;slug:string;business_slug:string|null}>}>(sql`select design.public_records(${definitionId}::uuid,${businessId}::uuid) items`);return row?.items??[];}));},
    themeTokens(requestId, businessId = null) {
      return degrade('theme.tokens', [], () => read(requestId, ({dal}) => dal.query<TokenQueryRow>(sql`select key,group_key,value,value_type,alias_of,theme_mode,description from design.public_tokens(${businessId}::uuid)`)));
    },
    themeSettings(requestId,businessId=null){return degrade('theme.settings',{},()=>read(requestId,async({dal})=>{const row=await dal.maybeOne<{settings:Record<string,unknown>}>(sql`select design.public_theme_settings(${businessId}::uuid) as settings`);return row?.settings??{};}));},
    themeFingerprint(requestId, businessId = null) {
      return degrade('theme.fingerprint','bootstrap',()=>read(requestId,async({dal})=>{const row=await dal.maybeOne<{value:string}>(sql`select design.public_fingerprint(${businessId}::uuid) as value`);return row?.value??'bootstrap';}));
    },
    pageRegistry(request,requestId){return degrade('design.pageRegistry',null,()=>read(requestId,async({dal})=>{const row=await dal.maybeOne<{rows:RegistryRow[]|null}>(sql`select design.public_registry(${request.businessId}::uuid,${request.key}) as rows`);return row?.rows??null;}));},
    sitemapDesignCount(requestId){return degrade('design.sitemapCount',0,()=>read(requestId,async({dal})=>{const row=await dal.maybeOne<{n:number}>(sql`select design.sitemap_count()::int as n`);return row?.n??0;}));},
    sitemapDesignPages(limit,offset,requestId){return degrade('design.sitemapPages',[],()=>read(requestId,({dal})=>dal.query<{path:string;last_modified:string|null}>(sql`select path,last_modified from design.sitemap_pages(${limit},${offset})`)));},
    designPage(request,requestId) {
      return degrade('design.metadata',null,()=>read(requestId,({dal})=>dal.maybeOne<{id:string;key:string;title:string;description:string|null;published_tree:unknown}>(sql`select id,key,title,description,published_tree from design.page where business_id is not distinct from ${request.businessId}::uuid and key=${request.key} and status='published'`)));
    },

    seoSettings(requestId) {
      return degrade('seo.settings', null, () =>
        read(requestId, ({ dal }) =>
          dal.maybeOne<SeoSettingsRow>(sql`
            select s.title_separator, s.title_template, s.description_fallback, s.default_locale,
                   s.default_region, s.indexing_enabled, s.environment, s.twitter_handle, s.extra
            from seo.settings s
            where s.business_id is null
            limit 1
          `),
        ),
      );
    },

    indexingEnabled(requestId) {
      return degrade('seo.indexing', false, () => read(requestId, ({ repos }) => repos.seo.indexingEnabled()));
    },

    businessBySlug(slug, requestId) {
      return degrade(`business.bySlug:${slug}`, null, () =>
        read(requestId, async ({ dal }) => {
          /*
           * شرط وضعیت، همان شرط سیاست عمومی است (`business_public_select`).
           * تکرارش عمدی است: سیاست، مرز امنیتی است و شرط کوئری، بهینه‌سازی؛
           * هیچ‌کدام جای دیگری را نمی‌گیرد.
           */
          const business = await dal.maybeOne<PublicBusinessRow>(sql`
            select ${BUSINESS_COLUMNS}
            ${BUSINESS_SOURCE}
            where b.slug = ${slug} and b.status = 'active' and b.visibility = 'public' and b.deleted_at is null
            limit 1
          `);
          if (!business) return null;

          // فراداده از تابع سخت‌گیرانهٔ دامنه می‌آید، نه از جدول خام.
          const metadata = await dal.maybeOne<SeoMetadataRow>(sql`
            select ${METADATA_COLUMNS}
            from seo.metadata_for_public('business', ${business.id}, 'fa-IR') m
          `);

          return { business, metadata };
        }),
      );
    },

    featuredBusinesses(limit, requestId) {
      return degrade('business.featured', [], () =>
        read(requestId, ({ dal }) =>
          dal.query<PublicBusinessRow>(sql`
            select ${BUSINESS_COLUMNS}
            ${BUSINESS_SOURCE}
            where b.status = 'active' and b.visibility = 'public' and b.deleted_at is null
            order by b.verification_level desc, b.published_at asc nulls last, b.name asc
            limit ${limit}
          `),
        ),
      );
    },

    listPublicBusinesses(request, requestId) {
      const empty: Page<PublicBusinessRow> = { items: [], nextCursor: null, hasMore: false };
      return degrade('business.list', empty, () =>
        read(requestId, ({ dal }) =>
          dal.page<PublicBusinessRow>({
            request: { cursor: request.cursor ?? null, limit: request.limit },
            extract: (row) => ({ key: row.name, id: row.id }),
            statement: (cursor, fetchLimit) => {
              const typeFilter = request.businessTypeKey ? sql`and b.business_type_key = ${request.businessTypeKey}` : sql``;
              /*
               * صنف و مکان، **زیردرخت** را می‌گیرند: کسب‌وکاری که صنفش
               * `animal_care.grooming` است در صفحهٔ `animal_care` هم دیده می‌شود.
               * مقایسه با `starts_with` است، نه LIKE: زیرخط در LIKE جوکر است و
               * `animal_care.%` به `animalXcare.…` هم می‌خورد.
               */
              const industryFilter = request.industryPath
                ? sql`and b.industry_key in (select x.key from ref.industry x where x.path = ${request.industryPath} or starts_with(x.path, ${subtreePrefix(request.industryPath)}))`
                : sql``;
              const locationFilter = request.locationPath
                ? sql`and b.primary_location_id in (select x.id from ref.location x where x.path = ${request.locationPath} or starts_with(x.path, ${subtreePrefix(request.locationPath)}))`
                : sql``;
              return sql`
                select ${BUSINESS_COLUMNS}
                ${BUSINESS_SOURCE}
                where ${VISIBLE_BUSINESS} ${typeFilter} ${industryFilter} ${locationFilter}
                ${pageTail({ orderBy: 'b.name', keyExpression: 'b.name', idColumn: 'b.id', direction: 'asc' })(cursor, fetchLimit)}
              `;
            },
          }),
        ),
      );
    },

    /* -------------------------------------------------------------- تاکسونومی (گام ۲۵) */

    businessTypes(requestId) {
      return degrade('taxonomy.types', [], () =>
        read(requestId, ({ dal }) =>
          dal.query<TypeFacetRow>(sql`
            select t.key, t.name_fa, t.plural_fa, t.description, t.parent_key, t.depth,
                   (select count(*) from app.business b
                      where b.business_type_key = t.key and ${VISIBLE_BUSINESS})::int as business_count
            from ref.business_type t
            where t.is_active
            order by t.depth asc, t.sort_order asc, t.key asc
          `),
        ),
      );
    },

    businessType(key, requestId) {
      return degrade(`taxonomy.type:${key}`, null, () =>
        read(requestId, ({ dal }) =>
          dal.maybeOne<TypeFacetRow>(sql`
            select t.key, t.name_fa, t.plural_fa, t.description, t.parent_key, t.depth,
                   (select count(*) from app.business b
                      where b.business_type_key = t.key and ${VISIBLE_BUSINESS})::int as business_count
            from ref.business_type t
            where t.key = ${key} and t.is_active
            limit 1
          `),
        ),
      );
    },

    industryChildren(parentPath, requestId) {
      return degrade(`taxonomy.industries:${parentPath ?? 'root'}`, [], () =>
        read(requestId, ({ dal }) => {
          const parent =
            parentPath === null
              ? sql`i.parent_key is null`
              : sql`i.parent_key = (select p.key from ref.industry p where p.path = ${parentPath})`;
          return dal.query<IndustryFacetRow>(sql`
            select i.key, i.name_fa, i.parent_key, i.path, i.depth, i.description,
                   (select count(*) from app.business b
                      join ref.industry x on x.key = b.industry_key
                      where ${VISIBLE_BUSINESS}
                        and (x.path = i.path or starts_with(x.path, i.path || '.')))::int as business_count
            from ref.industry i
            where i.is_active and ${parent}
            order by i.sort_order asc, i.name_fa asc
          `);
        }),
      );
    },

    industryTree(requestId) {
      return degrade('taxonomy.industries.tree', [], () =>
        read(requestId, ({ dal }) =>
          dal.query<IndustryFacetRow>(sql`
            select i.key, i.name_fa, i.parent_key, i.path, i.depth, i.description,
                   (select count(*) from app.business b
                      join ref.industry x on x.key = b.industry_key
                      where ${VISIBLE_BUSINESS}
                        and (x.path = i.path or starts_with(x.path, i.path || '.')))::int as business_count
            from ref.industry i
            where i.is_active
            order by i.path asc
          `),
        ),
      );
    },

    industryByPath(path, requestId) {
      return degrade(`taxonomy.industry:${path}`, null, () =>
        read(requestId, async ({ dal }) => {
          const industry = await dal.maybeOne<IndustryFacetRow>(sql`
            select i.key, i.name_fa, i.parent_key, i.path, i.depth, i.description,
                   (select count(*) from app.business b
                      join ref.industry x on x.key = b.industry_key
                      where ${VISIBLE_BUSINESS}
                        and (x.path = i.path or starts_with(x.path, i.path || '.')))::int as business_count
            from ref.industry i
            where i.path = ${path} and i.is_active
            limit 1
          `);
          if (!industry) return null;

          const parents = ancestorPaths(industry.path);
          const ancestors =
            parents.length === 0
              ? []
              : await dal.query<IndustryFacetRow>(sql`
                  select i.key, i.name_fa, i.parent_key, i.path, i.depth, i.description, 0::int as business_count
                  from ref.industry i
                  where i.path in (${parents}) and i.is_active
                  order by i.depth asc
                `);
          return { industry, ancestors };
        }),
      );
    },

    locationRoot(requestId) {
      return degrade('taxonomy.location.root', null, () =>
        read(requestId, ({ dal }) =>
          dal.maybeOne<LocationFacetRow>(sql`
            select l.id, l.kind, l.name_fa, l.parent_id, l.path, l.slug,
                   (select count(*) from app.business b where ${VISIBLE_BUSINESS})::int as business_count
            from ref.location l
            where l.kind = 'country' and l.parent_id is null and l.is_active
            order by l.path asc
            limit 1
          `),
        ),
      );
    },

    locationChildren(parentId, requestId) {
      return degrade(`taxonomy.location.children:${parentId}`, [], () =>
        read(requestId, ({ dal }) =>
          dal.query<LocationFacetRow>(sql`
            select l.id, l.kind, l.name_fa, l.parent_id, l.path, l.slug,
                   (select count(*) from app.business b
                      join ref.location x on x.id = b.primary_location_id
                      where ${VISIBLE_BUSINESS}
                        and (x.path = l.path or starts_with(x.path, l.path || '.')))::int as business_count
            from ref.location l
            where l.parent_id = ${parentId} and l.is_active
            order by l.name_fa asc
          `),
        ),
      );
    },

    locationTree(requestId) {
      return degrade('taxonomy.location.tree', [], () =>
        read(requestId, ({ dal }) =>
          dal.query<LocationFacetRow>(sql`
            select l.id, l.kind, l.name_fa, l.parent_id, l.path, l.slug,
                   (select count(*) from app.business b
                      join ref.location x on x.id = b.primary_location_id
                      where ${VISIBLE_BUSINESS}
                        and (x.path = l.path or starts_with(x.path, l.path || '.')))::int as business_count
            from ref.location l
            where l.is_active and l.kind in ('province', 'city')
            order by l.path asc
          `),
        ),
      );
    },

    locationBySuffix(suffix, requestId) {
      return degrade(`taxonomy.location:${suffix}`, null, () =>
        read(requestId, async ({ dal }) => {
          /*
           * نشانی ریشهٔ کشور را ندارد؛ ریشه از خود داده می‌آید و به پسوند
           * می‌چسبد. اگر مسیر ساخته‌شده در جدول نباشد، `null` است — همان ۴۰۴.
           */
          const location = await dal.maybeOne<LocationFacetRow>(sql`
            select l.id, l.kind, l.name_fa, l.parent_id, l.path, l.slug,
                   (select count(*) from app.business b
                      join ref.location x on x.id = b.primary_location_id
                      where ${VISIBLE_BUSINESS}
                        and (x.path = l.path or starts_with(x.path, l.path || '.')))::int as business_count
            from ref.location l
            join ref.location c on c.kind = 'country' and c.parent_id is null
            where l.path = c.path || '.' || ${suffix} and l.is_active
            order by c.path asc
            limit 1
          `);
          if (!location) return null;

          const parents = ancestorPaths(location.path);
          const ancestors =
            parents.length === 0
              ? []
              : await dal.query<LocationFacetRow>(sql`
                  select l.id, l.kind, l.name_fa, l.parent_id, l.path, l.slug, 0::int as business_count
                  from ref.location l
                  where l.path in (${parents}) and l.is_active
                  order by length(l.path) asc
                `);
          return { location, ancestors };
        }),
      );
    },

    categoryChildren(parentPath, requestId) {
      return degrade(`taxonomy.categories:${parentPath ?? 'root'}`, [], () =>
        read(requestId, ({ dal }) => {
          const parent =
            parentPath === null
              ? sql`c.parent_id is null`
              : sql`c.parent_id = (select p.id from ref.category p where p.path = ${parentPath} and p.scope = 'content' and p.business_id is null)`;
          return dal.query<CategoryFacetRow>(sql`
            select c.id, c.slug, c.name_fa, c.description, c.parent_id, c.path,
                   (${CATEGORY_CONTENT_COUNT}) as content_count
            from ref.category c
            where c.scope = 'content' and c.business_id is null and c.is_active and ${parent}
            order by c.sort_order asc, c.name_fa asc
          `);
        }),
      );
    },

    categoryTree(requestId) {
      return degrade('taxonomy.categories.tree', [], () =>
        read(requestId, ({ dal }) =>
          dal.query<CategoryFacetRow>(sql`
            select c.id, c.slug, c.name_fa, c.description, c.parent_id, c.path,
                   (${CATEGORY_CONTENT_COUNT}) as content_count
            from ref.category c
            where c.scope = 'content' and c.business_id is null and c.is_active
            order by c.path asc
          `),
        ),
      );
    },

    categoryByPath(path, requestId) {
      return degrade(`taxonomy.category:${path}`, null, () =>
        read(requestId, async ({ dal }) => {
          const category = await dal.maybeOne<CategoryFacetRow>(sql`
            select c.id, c.slug, c.name_fa, c.description, c.parent_id, c.path,
                   (${CATEGORY_CONTENT_COUNT}) as content_count
            from ref.category c
            where c.scope = 'content' and c.business_id is null and c.is_active and c.path = ${path}
            limit 1
          `);
          if (!category) return null;

          const parents = ancestorPaths(category.path);
          const ancestors =
            parents.length === 0
              ? []
              : await dal.query<CategoryFacetRow>(sql`
                  select c.id, c.slug, c.name_fa, c.description, c.parent_id, c.path, 0::int as content_count
                  from ref.category c
                  where c.scope = 'content' and c.business_id is null and c.is_active and c.path in (${parents})
                  order by length(c.path) asc
                `);
          return { category, ancestors };
        }),
      );
    },

    contentByCategory(request, requestId) {
      const empty: Page<CategoryContentRow> = { items: [], nextCursor: null, hasMore: false };
      return degrade(`taxonomy.category.content:${request.path}`, empty, () =>
        read(requestId, ({ dal }) =>
          dal.page<CategoryContentRow>({
            request: { cursor: request.cursor ?? null, limit: request.limit },
            extract: (row) => ({ key: row.title, id: row.id }),
            statement: (cursor, fetchLimit) => sql`
              select c.id, c.slug, c.kind, c.title, c.summary, b.slug as business_slug, b.name as business_name,
                     c.published_at, c.updated_at
              from app.content c
              left join app.business b on b.id = c.business_id and ${VISIBLE_BUSINESS}
              where c.status = 'published' and c.visibility = 'public' and c.deleted_at is null
                and (c.published_at is null or c.published_at <= now())
                and (c.business_id is null or b.id is not null)
                and c.id in (
                  select cc.content_id
                  from app.content_category cc
                  join ref.category x on x.id = cc.category_id
                  where x.path = ${request.path} or starts_with(x.path, ${subtreePrefix(request.path)})
                )
              ${pageTail({ orderBy: 'c.title', keyExpression: 'c.title', idColumn: 'c.id', direction: 'asc' })(cursor, fetchLimit)}
            `,
          }),
        ),
      );
    },

    facetCities(filter, limit, requestId) {
      return degrade('taxonomy.facet.cities', [], () =>
        read(requestId, ({ dal }) => {
          const type = filter.typeKey ? sql`and b.business_type_key = ${filter.typeKey}` : sql``;
          const industry = filter.industryPath
            ? sql`and b.industry_key in (select x.key from ref.industry x where x.path = ${filter.industryPath} or starts_with(x.path, ${subtreePrefix(filter.industryPath)}))`
            : sql``;
          return dal.query<LocationFacetRow>(sql`
            select l.id, l.kind, l.name_fa, l.parent_id, l.path, l.slug, count(*)::int as business_count
            from app.business b
            join ref.location l on l.id = b.primary_location_id
            where ${VISIBLE_BUSINESS} and l.kind = 'city' and l.is_active ${type} ${industry}
            group by l.id, l.kind, l.name_fa, l.parent_id, l.path, l.slug
            order by business_count desc, l.name_fa asc
            limit ${limit}
          `);
        }),
      );
    },

    facetTypes(filter, limit, requestId) {
      return degrade('taxonomy.facet.types', [], () =>
        read(requestId, ({ dal }) => {
          const location = filter.locationPath
            ? sql`and b.primary_location_id in (select x.id from ref.location x where x.path = ${filter.locationPath} or starts_with(x.path, ${subtreePrefix(filter.locationPath)}))`
            : sql``;
          const industry = filter.industryPath
            ? sql`and b.industry_key in (select x.key from ref.industry x where x.path = ${filter.industryPath} or starts_with(x.path, ${subtreePrefix(filter.industryPath)}))`
            : sql``;
          return dal.query<TypeFacetRow>(sql`
            select t.key, t.name_fa, t.plural_fa, t.description, t.parent_key, t.depth, count(*)::int as business_count
            from app.business b
            join ref.business_type t on t.key = b.business_type_key
            where ${VISIBLE_BUSINESS} and t.is_active ${location} ${industry}
            group by t.key, t.name_fa, t.plural_fa, t.description, t.parent_key, t.depth
            order by business_count desc, t.name_fa asc
            limit ${limit}
          `);
        }),
      );
    },

    searchBusinesses(query, limit, requestId) {
      return degrade('search.businesses', [], () => read(requestId, ({ repos }) => repos.catalog.searchBusinesses(query, limit)));
    },

    /* -------------------------------------------------------------- سئوی فنی (گام ۲۶) */

    platformSetting(key, requestId) {
      return degrade(`setting:${key}`, null, () =>
        read(requestId, async ({ dal }) => {
          // `not is_secret` تکرار سیاست است (RLS هم تنظیم سرّی را برای بی‌نام پنهان می‌کند).
          const row = await dal.maybeOne<{ value: unknown }>(sql`
            select s.value from ops.setting s
            where s.business_id is null and s.key = ${key} and not s.is_secret
            limit 1
          `);
          return row ? row.value : null;
        }),
      );
    },

    sitemapBusinessCount(requestId) {
      return degrade('sitemap.business.count', 0, () =>
        read(requestId, async ({ dal }) => {
          const row = await dal.maybeOne<{ n: number }>(sql`select seo.sitemap_business_count() as n`);
          return Number(row?.n ?? 0);
        }),
      );
    },

    sitemapBusinesses(limit, offset, requestId) {
      return degrade('sitemap.business.page', [], () =>
        read(requestId, ({ dal }) =>
          dal.query<SitemapBusinessRow>(sql`
            select s.slug, s.last_modified, s.verification_level
            from seo.sitemap_businesses(${limit}, ${offset}) s
          `),
        ),
      );
    },

    sitemapContentCount(requestId) {
      return degrade('sitemap.content.count', 0, () =>
        read(requestId, async ({ dal }) => {
          const row = await dal.maybeOne<{ n: number }>(sql`select seo.sitemap_content_count() as n`);
          return Number(row?.n ?? 0);
        }),
      );
    },

    sitemapContent(limit, offset, requestId) {
      return degrade('sitemap.content.page', [], () =>
        read(requestId, ({ dal }) =>
          dal.query<SitemapContentRow>(sql`
            select s.slug, s.last_modified, s.kind
            from seo.sitemap_content(${limit}, ${offset}) s
          `),
        ),
      );
    },

    sitemapTaxonomy(family, requestId) {
      return degrade(`sitemap.taxonomy:${family}`, [], () =>
        read(requestId, ({ dal }) => {
          switch (family) {
            case 'type':
              return dal.query<SitemapTaxonomyRow>(sql`
                select t.key as path, greatest(t.updated_at, max(b.updated_at)) as last_modified
                from ref.business_type t
                join app.business b on b.business_type_key = t.key
                where t.is_active and ${VISIBLE_BUSINESS}
                group by t.key, t.updated_at
                order by t.key
              `);
            case 'industry':
              return dal.query<SitemapTaxonomyRow>(sql`
                select i.path, greatest(i.updated_at, s.last_modified) as last_modified
                from ref.industry i
                join lateral (
                  select count(*) as members, max(b.updated_at) as last_modified
                  from app.business b
                  join ref.industry x on x.key = b.industry_key
                  where ${VISIBLE_BUSINESS} and (x.path = i.path or starts_with(x.path, i.path || '.'))
                ) s on s.members > 0
                where i.is_active
                order by i.path
              `);
            case 'location':
              return dal.query<SitemapTaxonomyRow>(sql`
                select l.path, greatest(l.updated_at, s.last_modified) as last_modified
                from ref.location l
                join lateral (
                  select count(*) as members, max(b.updated_at) as last_modified
                  from app.business b
                  join ref.location x on x.id = b.primary_location_id
                  where ${VISIBLE_BUSINESS} and (x.path = l.path or starts_with(x.path, l.path || '.'))
                ) s on s.members > 0
                where l.is_active and l.kind in ('province', 'city')
                order by l.path
              `);
            case 'category':
              return dal.query<SitemapTaxonomyRow>(sql`
                select c.path, greatest(c.updated_at, s.last_modified) as last_modified
                from ref.category c
                join lateral (
                  select count(distinct ct.id) as members, max(ct.updated_at) as last_modified
                  from app.content ct
                  join app.content_category cc on cc.content_id = ct.id
                  join ref.category x on x.id = cc.category_id
                  left join app.business b on b.id = ct.business_id and ${VISIBLE_BUSINESS}
                  where ct.status = 'published' and ct.visibility = 'public' and ct.deleted_at is null
                    and (ct.published_at is null or ct.published_at <= now())
                    and (ct.business_id is null or b.id is not null)
                    and (x.path = c.path or starts_with(x.path, c.path || '.'))
                ) s on s.members > 0
                where c.scope = 'content' and c.business_id is null and c.is_active
                order by c.path
              `);
          }
        }),
      );
    },

    noindexRoutes(routes, requestId) {
      if (routes.length === 0) return Promise.resolve(new Set<string>());
      return degrade('seo.noindex_routes', new Set<string>(), () =>
        read(requestId, async ({ dal }) => {
          const rows = await dal.query<{ route: string }>(sql`
            select r as route from seo.noindex_routes(${JSON.stringify(routes)}::jsonb) r
          `);
          return new Set(rows.map((row) => row.route));
        }),
      );
    },

    rumSampleRate(path, requestId) {
      return degrade(`rum.rate:${path}`, 0, () =>
        read(requestId, async ({ dal }) => {
          const row = await dal.maybeOne<{ rate: string | number }>(sql`select b.rum_sample_rate as rate from ops.budget_for_route(${path}) b limit 1`);
          const rate = Number(row?.rate ?? 0);
          return Number.isFinite(rate) && rate > 0 && rate <= 1 ? rate : 0;
        }),
      );
    },

    internalLinks(sourcePath, requestId) {
      return degrade(`seo.internal_links:${sourcePath}`, [], () =>
        read(requestId, ({ dal }) =>
          dal.query<InternalLinkRow>(sql`
            select l.target_path, l.anchor_text, l.link_kind
            from seo.internal_link l
            where l.source_path = ${sourcePath} and l.is_active and l.business_id is null
            order by l.link_kind asc, l.target_path asc
            limit 12
          `),
        ),
      );
    },

    relatedBusinesses(business, limit, requestId) {
      return degrade(`business.related:${business.slug}`, [], () =>
        read(requestId, async ({ dal }) => {
          /*
           * همسایه‌های **چرخشی** به ترتیب شناسه: «n نفرِ بعدی، و بعد از آخر، از اول».
           *
           * چرا چرخه و نه «برترین‌ها»: اگر همه به یک دستهٔ ثابت پیوند بدهند، بقیه یتیم
           * می‌مانند. در چرخه، هر پروفایل دقیقاً از n پروفایل قبلی‌اش پیوند ورودی
           * می‌گیرد — **قطعی**، بی‌یتیم (برای گروه بزرگ‌تر از n)، و بی‌تصادف.
           * نسخهٔ نخست چرخش را با `md5` می‌ساخت و پوشش، احتمالاتی بود: آزمون در
           * ۲٪ اجراها می‌شکست. «قطعی» همان چیزی است که می‌شود تضمین‌ش کرد.
           *
           * چرا کوتاه‌هزینه: هر شاخه با ایندکس `(نوع، شناسه)` و `limit` کار می‌کند؛
           * هزینهٔ هر صفحه به تعداد کسب‌وکارهای آن نوع بستگی ندارد (§98).
           */
          const cycle = async (scope: ReturnType<typeof sql>, take: number): Promise<PublicBusinessRow[]> => {
            const after = await dal.query<PublicBusinessRow>(sql`
              select ${BUSINESS_COLUMNS} ${BUSINESS_SOURCE}
              where ${VISIBLE_BUSINESS} and ${scope} and b.id > ${business.id}
              order by b.id asc limit ${take}
            `);
            if (after.length >= take) return after;
            const before = await dal.query<PublicBusinessRow>(sql`
              select ${BUSINESS_COLUMNS} ${BUSINESS_SOURCE}
              where ${VISIBLE_BUSINESS} and ${scope} and b.id < ${business.id}
              order by b.id asc limit ${take - after.length}
            `);
            return [...after, ...before];
          };

          const sameType = sql`b.business_type_key = ${business.business_type_key}`;
          // هم‌شهری‌ها اول (حداکثر نیمی از فهرست)، بعد چرخهٔ هم‌نوع‌ها تا پر شدن.
          const local =
            business.primary_location_id !== null
              ? await cycle(sql`${sameType} and b.primary_location_id = ${business.primary_location_id}`, Math.ceil(limit / 2))
              : [];
          const global = await cycle(sameType, limit);

          const picked = new Map<string, PublicBusinessRow>();
          for (const row of [...local, ...global]) {
            if (picked.size >= limit) break;
            if (row.id !== business.id && !picked.has(row.id)) picked.set(row.id, row);
          }
          return [...picked.values()];
        }),
      );
    },

    contentIndex(limit, requestId) {
      return degrade('content.index', [], () =>
        read(requestId, ({ dal }) =>
          dal.query<ContentIndexRow>(sql`
            select c.slug, c.kind, c.title, b.slug as business_slug, c.updated_at, c.published_at
            from app.content c
            left join app.business b
              on b.id = c.business_id and b.status = 'active' and b.visibility = 'public' and b.deleted_at is null
            where c.status = 'published' and c.visibility = 'public' and c.deleted_at is null
              and (c.business_id is null or b.id is not null)
              and (c.published_at is null or c.published_at <= now())
            order by coalesce(c.published_at, c.updated_at) desc
            limit ${limit}
          `),
        ),
      );
    },

    redirectFor(pathname, requestId) {
      return degrade(`redirect:${pathname}`, null, () =>
        read(requestId, ({ dal }) =>
          dal.maybeOne<RedirectRow>(sql`
            select r.source_path, r.target_path, r.status_code
            from seo.redirect r
            where r.source_path = ${pathname} and r.is_active and r.business_id is null
            order by r.status_code asc
            limit 1
          `),
        ),
      );
    },

    platformStats(requestId) {
      const empty: PlatformStats = { businesses: 0, industries: 0, business_types: 0, cities: 0, contents: 0 };
      return degrade('platform.stats', empty, () =>
        read(requestId, async ({ dal }) => {
          /*
           * پنج شمارش در یک رفت‌وبرگشت.
           *
           * چرا زیرپرس‌وجو و نه پنج کوئری: هر رفت‌وبرگشت به پایگاه‌داده، یک
           * رفت‌وبرگشت شبکه است. پنج‌تا یعنی پنج برابر تأخیر، برای صفحه‌ای که
           * فقط عدد نشان می‌دهد (Addendum §۲۰: پرهیز از N+1).
           */
          const row = await dal.maybeOne<PlatformStats>(sql`
            select
              (select count(*) from app.business b
                 where b.status = 'active' and b.visibility = 'public' and b.deleted_at is null)::int as businesses,
              (select count(*) from ref.industry i where i.is_active)::int as industries,
              (select count(*) from ref.business_type t where t.is_active)::int as business_types,
              (select count(*) from ref.location l where l.kind = 'city' and l.is_active)::int as cities,
              (select count(*) from app.content c
                 where c.business_id is null and c.status = 'published' and c.visibility = 'public' and c.deleted_at is null
                   and (c.published_at is null or c.published_at <= now()))::int as contents
          `);
          return row ?? empty;
        }),
      );
    },

    platformPage(slug, requestId, businessId=null) {
      return degrade(`platform.page:${slug}`, null, () =>
        read(requestId, ({ dal }) =>
          dal.maybeOne<PlatformPageRow>(sql`
            select c.id,c.slug, c.kind, c.title, c.subtitle, c.summary, c.body, c.body_text, c.updated_at, c.published_at
            from app.content c
            where c.business_id is not distinct from ${businessId}::uuid and c.slug = ${slug}
              and c.status = 'published' and c.visibility = 'public' and c.deleted_at is null
              and (c.published_at is null or c.published_at <= now())
            limit 1
          `),
        ),
      );
    },

    platformPages(requestId) {
      return degrade('platform.pages', [], () =>
        read(requestId, ({ dal }) =>
          dal.query<PlatformPageRow>(sql`
            select c.id,c.slug, c.kind, c.title, c.subtitle, c.summary, c.body, c.body_text, c.updated_at, c.published_at
            from app.content c
            where c.business_id is null and c.status = 'published' and c.visibility = 'public' and c.deleted_at is null
              and (c.published_at is null or c.published_at <= now())
            order by c.weight desc, c.title asc
          `),
        ),
      );
    },

    pageTree(request, requestId) {
      return degrade(`design.page:${request.key}`, null, () =>
        read(requestId, async ({ dal }) => {
          const row = await dal.maybeOne<{ published_tree: unknown }>(sql`
            select p.published_tree
            from design.page p
            where p.key = ${request.key}
              and p.status = 'published'
              and p.published_tree is not null
              and (
                (p.business_id = ${request.businessId} and ${request.businessId !== null})
                or (p.business_id is null and p.is_system)
              )
            order by (p.business_id is null) asc
            limit 1
          `);
          return row?.published_tree ?? null;
        }),
      );
    },

    componentRegistry(requestId) {
      return degrade('design.registry', [], () =>
        read(requestId, ({ dal }) =>
          dal.query<RegistryRow>(sql`
            select c.key, c.name_fa, c.category, c.props_schema, c.slots, c.a11y, c.seo, c.performance, c.status
            from design.component c
            where c.status <> 'removed'
            order by c.category asc, c.key asc
          `),
        ),
      );
    },

    mediaAssets(ids, requestId) {
      if (ids.length === 0) return Promise.resolve([]);
      return degrade('media.assets', [], () =>
        read(requestId, ({ dal }) =>
          dal.query<MediaAssetRow>(sql`
            select a.id, a.driver, a.storage_key, a.bucket, a.detected_mime, a.kind, a.size_bytes,
                   a.width, a.height, a.alt_text, a.original_name, a.checksum_sha256
            from media.asset a
            -- DAL آرایه را به فهرست پارامتر گسترده می‌کند (برای in)، پس
            -- «= any» با قالب uuid[] این‌جا به «any با چند آرگومان» تبدیل می‌شد
            -- و خطای malformed array literal می‌داد. شکل درست با این لایه،
            -- فهرست in است.
            where a.id in (${ids})
          `),
        ),
      );
    },

    mediaAsset(id, requestId) {
      return degrade(`media.asset:${id}`, null, () =>
        read(requestId, ({ dal }) =>
          dal.maybeOne<MediaAssetRow>(sql`
            select a.id, a.driver, a.storage_key, a.bucket, a.detected_mime, a.kind, a.size_bytes,
                   a.width, a.height, a.alt_text, a.original_name, a.checksum_sha256
            from media.asset a
            where a.id = ${id}::uuid
            limit 1
          `),
        ),
      );
    },

    businessContext(businessId, requestId) {
      const empty = { locations: [] as BusinessLocationRow[], contacts: [] as BusinessContactRow[] };
      return degrade(`business.context:${businessId}`, empty, () =>
        read(requestId, async ({ dal }) => {
          /*
           * دو خواندن کوچک به‌جای یکی با اتصال: جدول‌ها رابطهٔ یک‌به‌چند دارند و
           * اتصال، سطرها را تکثیر می‌کند. هر دو از پیش‌شرط‌های یکسانی عبور می‌کنند.
           */
          const locations = await dal.query<BusinessLocationRow>(sql`
            select l.label, l.address_line, l.latitude, l.longitude, l.hours, l.is_primary
            from app.business_location l
            where l.business_id = ${businessId}
            order by l.is_primary desc, l.created_at asc
            limit 20
          `);

          const contacts = await dal.query<BusinessContactRow>(sql`
            select c.kind, c.value_display, c.label, c.is_public
            from app.business_contact c
            where c.business_id = ${businessId} and c.is_public
            order by c.sort_order asc, c.created_at asc
            limit 20
          `);

          return { locations, contacts };
        }),
      );
    },

    seoTemplates(entityKind, subtype, requestId) {
      return degrade(`seo.templates:${entityKind}`, [], () =>
        read(requestId, ({ dal }) =>
          dal.query<SeoTemplateRow>(sql`
            select t.key, t.entity_kind, t.subtype, t.title_template, t.description_template,
                   t.canonical_template, t.og_title_template, t.og_description_template, t.priority
            from seo.template t
            where t.business_id is null and t.is_active
              and t.entity_kind = ${entityKind}
              and (t.subtype is null or t.subtype = ${subtype})
            order by t.priority desc, t.key asc
            limit 20
          `),
        ),
      );
    },

    indexPolicy(target, requestId) {
      return degrade(`seo.policy:${target.kind}`, null, () =>
        read(requestId, ({ dal }) =>
          dal.maybeOne<{ is_indexable: boolean; robots_directives: string[]; non_indexable_reason: string | null }>(sql`
            select p.is_indexable, p.robots_directives, p.non_indexable_reason
            from seo.index_policy_for_public(${target.kind}, ${target.id}::uuid, ${target.routeKey}, ${target.locale}) p
          `),
        ),
      );
    },

    pageMetadata(target, requestId) {
      /*
       * دو منبع، یک شکل: موجودیت‌دار از تابع سخت‌گیرانهٔ موجودیت، مسیرمحور از
       * تابع مسیر. هیچ‌کدام جدول خام را نمی‌خوانند، چون نگهبان «منتشرشده بودن»
       * در همان توابع است.
       *
       * دو نکتهٔ ریز که هر دو یک‌بار ما را زمین زدند:
       *
       *   • ریشهٔ تله در مهاجرت ۰۰۱۸ بسته شد (تابع‌ها setof شدند، پس ردیف تهی
       *     نمی‌دهند). نگهبان «لیترال «x.entity_kind is not null»» هم می‌ماند:
       *     اگر روزی تابعی دوباره نوع مرکب بدهد، این‌جا بی‌صدا «فراداده هست»
       *     نتیجه نمی‌گیریم.
       *   • ترتیب اهمیت دارد: متادیتای موجودیت بر متادیتای مسیر مقدم است، پس با
       *     source_rank مرتب می‌کنیم (وگرنه ترتیب union all تعیین می‌کرد، که
       *     تصادفی است).
       *
       * ⚠️ هیچ کامنتی داخل قالب SQL نمی‌نویسیم: بک‌تیک در متن کامنت، قالب را
       * می‌بندد و خطای نحوی می‌دهد (همین‌جا یک‌بار اتفاق افتاد).
       */
      return degrade(`seo.metadata:${target.kind}`, null, () =>
        read(requestId, ({ dal }) =>
          dal.maybeOne<SeoMetadataRow>(sql`
            select ${METADATA_COLUMNS}
            from (
              select ${METADATA_UNION_COLUMNS}, 0 as source_rank from seo.metadata_for_public(${target.kind}, ${target.id}::uuid, ${target.locale}) x
               where x.entity_kind is not null
              union all
              select ${METADATA_UNION_COLUMNS}, 1 as source_rank from seo.metadata_for_route(${target.kind}, ${target.routeKey}, ${target.locale}) x
               where x.entity_kind is not null
            ) m
            order by m.source_rank
            limit 1
          `),
        ),
      );
    },

    canonicalRules(requestId) {
      return degrade('seo.canonical', [], () =>
        read(requestId, ({ dal }) =>
          dal.query<CanonicalRuleRow>(sql`
            select c.source_path, c.canonical_path, c.match_kind, c.reason
            from seo.canonical c
            where c.is_active and c.business_id is null
            order by length(c.source_path) desc
            limit 200
          `),
        ),
      );
    },

    pageAlternates(target, requestId) {
      /*
       * از تابع `security definer` می‌خوانیم، نه از جدول: نقش بی‌نام روی
       * `seo.metadata` سیاست خواندن ندارد و RLS بی‌صدا ردیف‌ها را پنهان می‌کند.
       */
      return degrade(`seo.alternates:${target.kind}`, [], () =>
        read(requestId, ({ dal }) =>
          dal.query<{ locale: string; canonical_url: string | null; canonical_path: string | null }>(sql`
            select a.locale, a.canonical_url, a.canonical_path
            from seo.public_alternates(${target.kind}, ${target.id}::uuid, ${target.locale}) a
          `),
        ),
      );
    },

    structuredDataRows(target, requestId) {
      return degrade(`seo.structured:${target.kind}`, [], () =>
        read(requestId, ({ dal }) =>
          dal.query<SeoStructuredRow>(sql`
            select d.schema_type, d.subtype, d.payload, d.source
            from seo.structured_data d
            where d.is_active
              and d.locale = ${target.locale}
              and (
                (d.entity_id is not null and d.entity_id = ${target.id}::uuid)
                or (d.route_key is not null and d.route_key = ${target.routeKey})
              )
            order by d.created_at asc
            limit 20
          `),
        ),
      );
    },

    readiness(requestId) {
      return degrade('ops.readiness', null, () =>
        read(requestId, ({ dal }) =>
          dal.maybeOne<Row>(sql`
            select m.migrations, m.last_applied_at, m.tables, m.features_development, m.features_published
            from ops.readiness_snapshot() m
          `),
        ),
      );
    },
  };
}
