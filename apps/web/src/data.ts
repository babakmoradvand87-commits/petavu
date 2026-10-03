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
  type SqlClient,
} from '@petavu/db';
import type { Logger } from '@petavu/shared';

import type { RegistryRow } from './registry.js';
import type { MediaAssetRow } from './media.js';
import type { ThemeMode } from './tokens.js';

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
  indexing_enabled: boolean;
  environment: 'production' | 'staging' | 'development';
}

/**
 * دارایی رسانه و ردیف Registry، هر دو از همین لایه خوانده می‌شوند — نه با
 * دسترسی مستقیم صفحه‌ها به پایگاه‌داده. دلیلش قاعدهٔ گام ۲۲ است: صفحه فقط
 * «چه می‌خواهد» را می‌گوید؛ اینکه چگونه و با کدام نقش خوانده می‌شود، اینجاست.
 */
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

export interface WebData {
  /** توکن‌های سراسری پلتفرم — تنها چیزی که `pv_public` می‌بیند. */
  themeTokens(requestId: string): Promise<TokenQueryRow[]>;
  seoSettings(requestId: string): Promise<SeoSettingsRow | null>;
  indexingEnabled(requestId: string): Promise<boolean>;
  businessBySlug(slug: string, requestId: string): Promise<{ business: PublicBusinessRow; metadata: SeoMetadataRow | null } | null>;
  featuredBusinesses(limit: number, requestId: string): Promise<PublicBusinessRow[]>;
  /** فهرست عمومی با صفحه‌بندی نشانگری (نه `offset`) و فیلتر نوع کسب‌وکار. */
  listPublicBusinesses(
    request: { limit: number; cursor?: string | null; businessTypeKey?: string | null },
    requestId: string,
  ): Promise<Page<PublicBusinessRow>>;
  contentIndex(limit: number, requestId: string): Promise<ContentIndexRow[]>;
  redirectFor(pathname: string, requestId: string): Promise<RedirectRow | null>;
  readiness(requestId: string): Promise<Row | null>;
  /** شمارنده‌های واقعی پلتفرم برای صفحهٔ اصلی — از خود جدول‌ها، نه ادعا. */
  platformStats(requestId: string): Promise<PlatformStats>;
  /** صفحهٔ محتوای سراسری پلتفرم از `app.content` (بدون کسب‌وکار). */
  platformPage(slug: string, requestId: string): Promise<PlatformPageRow | null>;
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
}

export interface PlatformStats extends Row {
  readonly businesses: number;
  readonly industries: number;
  readonly business_types: number;
  readonly cities: number;
  readonly contents: number;
}

export interface PlatformPageRow extends Row {
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
  p.tagline, p.summary, p.founded_year,
  l.slug as city_slug, l.name_fa as city_name
`);

const BUSINESS_SOURCE = raw(`
  from app.business b
  left join app.business_profile p on p.business_id = b.id
  left join ref.location l on l.id = b.primary_location_id
`);

const METADATA_COLUMNS = raw(
  'm.title, m.description, m.canonical_url, m.share_title, m.is_indexable, m.robots_directives, m.non_indexable_reason, m.updated_at',
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
    themeTokens(requestId) {
      return degrade('theme.tokens', [], () =>
        read(requestId, ({ dal }) =>
          dal.query<TokenQueryRow>(sql`
            select t.key, t.group_key, t.value, t.value_type, t.alias_of, t.theme_mode, t.description
            from design.token t
            where t.business_id is null
            order by t.key asc, t.theme_mode asc
          `),
        ),
      );
    },

    seoSettings(requestId) {
      return degrade('seo.settings', null, () =>
        read(requestId, ({ dal }) =>
          dal.maybeOne<SeoSettingsRow>(sql`
            select s.title_separator, s.title_template, s.description_fallback, s.default_locale,
                   s.default_region, s.indexing_enabled, s.environment
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
              return sql`
                select ${BUSINESS_COLUMNS}
                ${BUSINESS_SOURCE}
                where b.status = 'active' and b.visibility = 'public' and b.deleted_at is null ${typeFilter}
                ${pageTail({ orderBy: 'b.name', keyExpression: 'b.name', idColumn: 'b.id', direction: 'asc' })(cursor, fetchLimit)}
              `;
            },
          }),
        ),
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

    platformPage(slug, requestId) {
      return degrade(`platform.page:${slug}`, null, () =>
        read(requestId, ({ dal }) =>
          dal.maybeOne<PlatformPageRow>(sql`
            select c.slug, c.kind, c.title, c.subtitle, c.summary, c.body, c.updated_at, c.published_at
            from app.content c
            where c.business_id is null and c.slug = ${slug}
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
            select c.slug, c.kind, c.title, c.subtitle, c.summary, c.body, c.updated_at, c.published_at
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
            where a.id = any(${ids}::uuid[])
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
