/**
 * Repository سئو (Addendum §39–۴۷): سئو به‌عنوان **داده**.
 *
 * چرا سئو Repository جدا دارد و به محتوا چسبیده نیست: فرادادهٔ سئو به موجودیت
 * وابسته نیست، به **مسیر و موجودیت** وابسته است. یک نشانی می‌تواند کسب‌وکار
 * باشد یا محصول یا مقاله؛ آنچه تصمیم می‌گیرد، `entity_kind` است نه جدول.
 * اگر این منطق به Repository محتوا می‌رفت، هر موجودیت تازه یک کپی می‌ساخت.
 *
 * دو مرز اینجا:
 *   • **نوشتن فراداده، تابع دامنه است** (`app.upsert_seo_metadata`) تا ویرایش
 *     دستی بازنویسی نشود و رخداد `seo.metadata_updated` ثبت شود.
 *   • **خواندن عمومی، تابع `seo.metadata_for_public` است** تا نشانی‌های
 *     ایندکس‌نشدنی و پیش‌نویس‌ها بیرون نروند.
 */

import { raw, sql } from '../sql.js';
import type { Row } from '../types.js';
import { type RepoDeps, assertPermission, invalid, notFound, recordFields } from './support.js';

const METADATA_FIELDS = [
  'id', 'business_id', 'entity_kind', 'entity_id', 'route_key', 'locale', 'title', 'description',
  'canonical_url', 'share_asset_id', 'share_title', 'is_indexable', 'robots_directives', 'non_indexable_reason',
  'is_manual', 'quality_score', 'last_audited_at', 'updated_at', 'version',
] as const;

const METADATA_COLUMNS = METADATA_FIELDS.map((field) => `m.${field}`).join(', ');

const TEMPLATE_FIELDS = [
  'id', 'business_id', 'key', 'entity_kind', 'subtype', 'title_template', 'description_template',
  'slug_template', 'canonical_template', 'og_title_template', 'og_description_template', 'priority', 'is_active',
] as const;

export function seoRepository(deps: RepoDeps) {
  const { dal, context } = deps;

  return {
    /** تنظیمات سئو: سراسری یا کسب‌وکاری. */
    async settings(businessId?: string | null): Promise<Row | null> {
      return dal.maybeOne(
        sql`select s.id, s.business_id, s.title_separator, s.title_template, s.description_fallback, s.slug_prefix,
                   s.default_locale, s.default_region, s.indexing_enabled, s.environment, s.extra
            from seo.settings s
            where s.business_id = ${businessId ?? null}
            order by s.created_at asc
            limit 1`,
      );
    },

    /**
     * آیا ایندکس‌گذاری در این محیط مجاز است؟
     *
     * تنها جایی که به `environment` نگاه می‌شود. ربات‌ها و سایتمپ‌ها از همین
     * یک تابع می‌پرسند تا «محیط توسعه با noindex منتشر شد» یک بار و برای همیشه
     * حل شود (Addendum: robots پویا/محیط‌آگاه).
     */
    async indexingEnabled(): Promise<boolean> {
      const rows = await dal.query<{ enabled: boolean }>(
        sql`select coalesce(bool_and(s.indexing_enabled and s.environment = 'production'), false) as enabled
            from seo.settings s where s.business_id is null`,
      );
      return rows[0]?.enabled === true;
    },

    async metadata(entityKind: string, entityId: string, locale = 'fa-IR'): Promise<Row | null> {
      return dal.maybeOne(
        sql`select ${raw(METADATA_COLUMNS)} from seo.metadata m
            where m.entity_kind = ${entityKind} and m.entity_id = ${entityId} and m.locale = ${locale}`,
      );
    },

    /** فرادادهٔ عمومی — از تابع سخت‌گیرانهٔ دامنه، نه از جدول خام. */
    async publicMetadata(entityKind: string, entityId: string, locale = 'fa-IR'): Promise<Row | null> {
      return dal.maybeOne(
        sql`select ${recordFields('f', METADATA_FIELDS)} from seo.metadata_for_public(${entityKind}, ${entityId}, ${locale}) f`,
      );
    },

    /**
     * نوشتن فراداده — از راه تابع دامنه.
     *
     * `sourceHash` اگر بیاید و با درهم منبع یکی نباشد، تابع دامنه تشخیص می‌دهد
     * که سندِ منبع عوض شده و فرادادهٔ خودکار باید تازه شود؛ فرادادهٔ دستی
     * (`is_manual`) دست‌نخورده می‌ماند.
     */
    async upsertMetadata(input: {
      entityKind: string;
      entityId: string;
      locale?: string;
      values: Record<string, unknown>;
      sourceHash?: string | null;
      businessId?: string | null;
    }): Promise<Row> {
      if (input.businessId) await assertPermission(deps, input.businessId, 'seo.manage');
      const rows = await dal.query<Row>(
        sql`select ${recordFields('r', METADATA_FIELDS)}
            from app.upsert_seo_metadata(${input.entityKind}, ${input.entityId}, ${input.locale ?? 'fa-IR'},
              ${JSON.stringify(input.values)}::jsonb, ${input.sourceHash ?? null}, ${input.businessId ?? null}) r`,
      );
      const [metadata] = rows;
      if (!metadata) notFound('seo_metadata', { entity_kind: input.entityKind, entity_id: input.entityId });
      return metadata;
    },

    /**
     * قالب سئو برای یک موجودیت.
     *
     * ترتیب انتخاب: قالب اختصاصی کسب‌وکار → قالب سراسری؛ و دقیق‌تر (با `subtype`)
     * پیش از عام. `seo.pick_template` همین را در SQL تصمیم می‌گیرد تا API و
     * کارگر دو تصمیم متفاوت نگیرند.
     */
    async pickTemplate(entityKind: string, subtype?: string | null, businessId?: string | null): Promise<Row | null> {
      return dal.maybeOne(
        sql`select ${recordFields('t', TEMPLATE_FIELDS)} from seo.pick_template(${entityKind}, ${subtype ?? null}, ${businessId ?? null}) t`,
      );
    },

    async templates(businessId?: string | null): Promise<Row[]> {
      return dal.query(
        sql`select t.id, t.business_id, t.key, t.entity_kind, t.subtype, t.title_template, t.description_template,
                   t.priority, t.is_active
            from seo.template t
            where (t.business_id = ${businessId ?? null} or t.business_id is null) and t.is_active
            order by t.priority desc, t.key asc`,
      );
    },

    /** یافتن مقصد یک مسیر درخواستی؛ حلقه و زنجیره را تابع دامنه تشخیص می‌دهد. */
    async matchRedirect(path: string, businessId?: string | null): Promise<Row | null> {
      return dal.maybeOne(
        sql`select r.id, r.target_path, r.status_code from seo.match_redirect(${path}, ${businessId ?? null}) r`,
      );
    },

    async redirectIssue(path: string): Promise<Row | null> {
      return dal.maybeOne(
        sql`select i.issue, i.chain, i.final_path from seo.redirect_chain_issue(${path}) i`,
      );
    },

    /** ریدایرکت‌ها با صفحه‌بندی نشانگری و شمار بازدید. */
    async redirects(businessId: string | null, options: { cursor?: string | null; limit?: number | null } = {}): Promise<Row[]> {
      const scopeFilter = businessId ? sql`and (r.business_id = ${businessId} or r.business_id is null)` : sql``;
      return dal.query(
        sql`select r.id, r.business_id, r.source_path, r.target_path, r.status_code, r.reason, r.hit_count, r.last_hit_at, r.is_active
            from seo.redirect r
            where r.is_active ${scopeFilter}
            order by r.source_path asc
            limit ${Math.min(Number(options.limit ?? 100), 200)}`,
      );
    },

    async createRedirect(input: {
      businessId?: string | null;
      sourcePath: string;
      targetPath: string;
      statusCode?: 301 | 302 | 307 | 308 | 410;
      reason?: string | null;
    }): Promise<Row> {
      if (input.businessId) await assertPermission(deps, input.businessId, 'seo.redirect.manage');
      const statusCode = input.statusCode ?? 301;
      const target = statusCode === 410 ? null : input.targetPath;
      if (statusCode !== 410 && !target) invalid('missing_target', 'کد ۴۱۰ مقصد ندارد؛ بقیه باید مقصد داشته باشند');

      const duplicate = await dal.maybeOne<{ id: string }>(
        sql`select r.id from seo.redirect r where r.source_path = ${input.sourcePath} and r.business_id is not distinct from ${input.businessId ?? null}`,
      );
      if (duplicate) invalid('duplicate_source', 'برای این مسیر از قبل ریدایرکت هست', { id: duplicate.id });

      /*
       * حلقه را *پیش از نوشتن* می‌سنجیم، و درست همان حلقه‌ای که این یال
       * می‌سازد — نه وضعیت زنجیره‌های موجود.
       *
       * بررسی «آیا زنجیرهٔ این مبدأ مشکل دارد؟» برای قاعدهٔ تازه کافی نیست:
       * حلقه وقتی بسته می‌شود که *مقصد* تازه، با زنجیرهٔ موجود به همین مبدأ
       * برگردد. `seo.would_create_loop` (مهاجرت ۰۰۱۷) همین را می‌پیماید.
       */
      if (target) {
        const loop = await dal.maybeOne<{ loop: boolean }>(
          sql`select seo.would_create_loop(${input.sourcePath}, ${target}, ${input.businessId ?? null}) as loop`,
        );
        if (loop?.loop === true) invalid('redirect_loop', 'این مسیر، حلقهٔ ریدایرکت می‌سازد');
      }

      return dal.one(
        sql`insert into seo.redirect (business_id, source_path, target_path, status_code, reason, created_by)
            values (${input.businessId ?? null}, ${input.sourcePath}, ${target}, ${statusCode}, ${input.reason ?? null}, ${context.userId ?? null})
            returning id, business_id, source_path, target_path, status_code, reason, is_active, created_at`,
      );
    },

    /** بردار داده ساخت‌یافته — تنها منبع JSON-LD در رندر (§39–۴۰). */
    async structuredData(entityKind: string, entityId: string, locale = 'fa-IR'): Promise<Row[]> {
      return dal.query(
        sql`select s.id, s.entity_kind, s.entity_id, s.route_key, s.locale, s.schema_type, s.subtype, s.payload, s.source
            from seo.structured_data s
            where s.entity_kind = ${entityKind} and s.entity_id = ${entityId} and s.locale = ${locale} and s.is_active
            order by s.schema_type asc`,
      );
    },

    async sitemaps(businessId?: string | null): Promise<Row[]> {
      return dal.query(
        sql`select s.id, s.business_id, s.name, s.kind, s.scope, s.path, s.url_count, s.size_bytes, s.last_built_at, s.status
            from seo.active_sitemaps(${businessId ?? null}) s`,
      );
    },

    /** سایتمپ‌هایی که ساختشان مانده یا شکست خورده؛ ورودی کارگر سایتمپ. */
    async pendingSitemaps(limit = 20): Promise<Row[]> {
      return dal.query(
        sql`select s.id, s.business_id, s.kind, s.scope, s.path, s.status, s.failure_note
            from seo.sitemap s
            where s.status in ('pending', 'stale', 'failed')
            order by s.updated_at asc
            limit ${limit}`,
      );
    },

    /** آخرین بازرسی‌ها و یافته‌های سئو؛ برای داشبورد دیده‌شدن. */
    async latestAudit(businessId: string | null): Promise<Row | null> {
      return dal.maybeOne(
        sql`select a.id, a.business_id, a.run_kind, a.status, a.blocker_count, a.error_count, a.warning_count, a.info_count, a.score, a.finished_at
            from seo.audit a
            where a.business_id is not distinct from ${businessId ?? null}
            order by a.started_at desc
            limit 1`,
      );
    },

    async openOpportunities(businessId: string | null, limit = 50): Promise<Row[]> {
      return dal.query(
        sql`select o.id, o.kind, o.severity, o.title, o.description, o.path, o.priority, o.suggested_action, o.detected_at
            from seo.content_opportunity o
            where o.business_id is not distinct from ${businessId ?? null} and o.status = 'open'
            order by o.priority desc, o.detected_at desc
            limit ${limit}`,
      );
    },

    /**
     * رخدادهای ایندکس که هنوز فرستاده نشده‌اند (IndexNow/GSC/بینگ).
     *
     * «در انتظار» فقط `queued` نیست: `failed` و `throttled` هم منتظرند —
     * اولی برای تلاش دوباره، دومی برای وقتی محدودیت نرخ تمام شود. همان سه
     * وضعیتی که ایندکس جزئی جدول برایشان ساخته شده است.
     *
     * اینجا فقط خواندن است؛ فرستادن، کارِ کارگر است (گام ۳۳ و §46).
     */
    async pendingIndexingEvents(limit = 100): Promise<Row[]> {
      return dal.query(
        sql`select e.id, e.occurred_at, e.channel, e.action, e.url_count, e.status,
                   e.response_code, e.response_note, e.request_id, e.job_id, e.payload
            from seo.indexing_event e
            where e.status in ('queued', 'failed', 'throttled')
            order by e.occurred_at asc
            limit ${limit}`,
      );
    },

    /** نامک‌های پیشنهادی قالب برای یک مسیر — فقط برای دیدنِ تصمیم ضمنی. */
    async templatePreview(entityKind: string, values: Record<string, string>): Promise<Row> {
      const template = await this.pickTemplate(entityKind);
      if (!template) notFound('seo_template', { entity_kind: entityKind });
      const render = (pattern: string | null): string => {
        if (!pattern) return '';
        return pattern.replace(/\{\{\s*([a-z_][a-z0-9_.]*)\s*\}\}/g, (_, token: string) => values[token] ?? '');
      };
      return {
        template_key: template.key,
        title: render(String(template.title_template ?? '')).trim(),
        description: render(String(template.description_template ?? '')).trim(),
        slug: render(String(template.slug_template ?? '')).trim(),
        canonical: render(String(template.canonical_template ?? '')).trim(),
      } as unknown as Row;
    },
  };
}

export type SeoRepository = ReturnType<typeof seoRepository>;
