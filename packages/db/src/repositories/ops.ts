/**
 * Repository عملیات (§93–۹۹؛ Addendum §56–۷۲): تنظیمات، فیچر، کار، اعلان،
 * امنیت، پشتیبان.
 *
 * قاعده‌ای که همهٔ این فایل را شکل داده: **کارگر و API از یک در استفاده می‌کنند.**
 * `claim_job`/`finish_job`، `process_event`، `run_rule` همه تابع دامنه‌اند با
 * قفل ردیفی و ادعای اتمی. اگر کارگر خودش `update ops.job set status='running'`
 * می‌زد، دو کارگر می‌توانستند یک کار را بردارند و «یک‌بار اجرا» از بین می‌رفت.
 */

import { raw, sql } from '../sql.js';
import type { Row } from '../types.js';
import { type RepoDeps, assertPlatformPermission, assertPermission, notFound, recordFields } from './support.js';

const JOB_FIELDS = ['id', 'kind', 'status', 'priority', 'attempts', 'max_attempts', 'available_at', 'locked_by', 'locked_at', 'last_error', 'finished_at', 'business_id', 'dedupe_key', 'created_at', 'updated_at', 'version'] as const;

export function opsRepository(deps: RepoDeps) {
  const { dal, context } = deps;

  return {
    // ---------------------------------------------------------------- تنظیمات
    /**
     * خواندن تنظیم: مقدار کسب‌وکاری بر مقدار سراسری مقدم است.
     * `is_secret` هیچ‌وقت مقدار نمی‌دهد — فقط می‌گوید «این تنظیم راز است».
     */
    async setting(key: string, businessId?: string | null): Promise<{ value: unknown; is_secret: boolean } | null> {
      const row = await dal.maybeOne<{ value: unknown; is_secret: boolean }>(
        sql`select s.value, s.is_secret
            from ops.setting s
            where s.key = ${key} and s.business_id is not distinct from ${businessId ?? null}
            order by (s.business_id is null) asc
            limit 1`,
      );
      if (!row) return null;
      if (row.is_secret) return { value: null, is_secret: true };
      return row;
    },

    async settings(businessId?: string | null): Promise<Row[]> {
      return dal.query(
        sql`select s.key, case when s.is_secret then null else s.value end as value, s.is_secret, s.description, s.business_id
            from ops.setting s
            where s.business_id is not distinct from ${businessId ?? null} or s.business_id is null
            order by s.key asc`,
      );
    },

    async setSetting(input: { key: string; value: unknown; businessId?: string | null; description?: string | null }): Promise<Row> {
      if (input.businessId) await assertPermission(deps, input.businessId, 'business.update');
      else await assertPlatformPermission(deps, 'platform.settings.manage');

      return dal.one(
        sql`insert into ops.setting (key, value, business_id, description, updated_by)
            values (${input.key}, ${JSON.stringify(input.value)}::jsonb, ${input.businessId ?? null}, ${input.description ?? null}, ${context.userId ?? null})
            on conflict (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), key)
            do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()
            returning key, case when is_secret then null else value end as value, is_secret, business_id, updated_at, version`,
      );
    },

    // ------------------------------------------------------------------ فیچر
    /** Registry فیچرها؛ منبع حقیقت وضعیت و بودجه‌ها (Addendum §21–۲۴). */
    async features(options: { status?: string; layer?: string } = {}): Promise<Row[]> {
      const filters: unknown[] = [];
      const clauses = [];
      if (options.status) clauses.push(sql`f.status = ${options.status}`);
      if (options.layer) clauses.push(sql`f.layer = ${options.layer}`);
      void filters;
      const where = clauses.length > 0 ? clauses.reduce((acc, clause) => sql`${acc} and ${clause}`) : sql`true`;
      return dal.query(
        sql`select f.key, f.name_fa, f.description, f.layer, f.status, f.dependencies, f.performance_budget,
                   f.seo_metadata, f.search_metadata, f.wiring, f.since_version, f.updated_at, f.version
            from ops.feature f where ${where}
            order by f.layer asc, f.key asc`,
      );
    },

    async feature(key: string): Promise<Row | null> {
      return dal.maybeOne(
        sql`select f.key, f.name_fa, f.description, f.layer, f.status, f.dependencies, f.performance_budget,
                   f.seo_metadata, f.search_metadata, f.wiring, f.since_version, f.updated_at, f.version
            from ops.feature f where f.key = ${key}`,
      );
    },

    /** گذر وضعیت فیچر — تابع دامنه، با شرط هر گذر و ثبت رخداد. */
    async transitionFeature(key: string, to: string, note?: string | null): Promise<Row> {
      await assertPlatformPermission(deps, 'platform.feature.manage');
      return dal.one(
        sql`select ${raw(['key', 'name_fa', 'layer', 'status', 'updated_at', 'version'].map((f) => `(r).${f} as ${f}`).join(', '))}
            from ops.transition_feature(${key}, ${to}, ${note ?? null}) r`,
      );
    },

    async featureCycles(): Promise<Row> {
      const rows = await dal.query<{ cycles: Row }>(sql`select ops.feature_dependency_cycles() as cycles`);
      return (rows[0]?.cycles ?? {}) as Row;
    },

    async featureRemovalBlockers(key: string): Promise<Row[]> {
      return dal.query(sql`select b.blocker, b.detail from ops.feature_removal_blockers(${key}) b`);
    },

    // -------------------------------------------------------------------- کار
    /** ادعای اتمی کار — تابع دامنه با `for update skip locked`. */
    async claimJobs(worker: string, kinds?: readonly string[] | null, limit = 1): Promise<Row[]> {
      /*
       * فهرست نوع‌ها از JSON به آرایهٔ متنی تبدیل می‌شود، نه با سریال‌سازی
       * مستقیم آرایه: شکل نوشتن آرایهٔ PostgreSQL بین درایورها یکسان نیست و
       * یک عنصر می‌تواند به «رشتهٔ تنها» تبدیل شود — که خطای «آرایهٔ نامعتبر»
       * می‌دهد. این مسیر، هم قطعی است و هم پارامتری می‌ماند.
       */
      const kindsParam =
        kinds && kinds.length > 0
          ? sql`(select array_agg(value)::text[] from jsonb_array_elements_text(${JSON.stringify([...kinds])}::jsonb))`
          : sql`null::text[]`;
      return dal.query(sql`select ${recordFields('j', JOB_FIELDS)} from ops.claim_job(${worker}, ${kindsParam}, ${limit}) j`);
    },

    async finishJob(jobId: string, succeeded: boolean, error?: string | null, retryAfterSeconds?: number | null): Promise<Row | null> {
      return dal.maybeOne(
        sql`select ${recordFields('j', JOB_FIELDS)} from ops.finish_job(${jobId}, ${succeeded}, ${error ?? null}, ${retryAfterSeconds ?? null}) j`,
      );
    },

    /**
     * تصویر سلامت صف.
     *
     * `ops.job_health()` یک شیء jsonb برمی‌گرداند، نه ردیف‌ها: تصویر سلامت
     * «یک عدد و چند شمارنده» است و شکل ردیفی، مصرف‌کننده‌اش را وادار می‌کند
     * ستون‌های ضمنی را حدس بزند.
     */
    async jobHealth(): Promise<Row> {
      const rows = await dal.query<{ health: Row }>(sql`select ops.job_health() as health`);
      return (rows[0]?.health ?? {}) as Row;
    },

    /**
     * ثبت کار در صف — از راه `ops.enqueue_job`.
     *
     * جدول `ops.job` هیچ گرنت درج برای `pv_app` ندارد و همین درست است: اگر
     * برنامهٔ وب می‌توانست مستقیم در صف بنویسد، «درخواست» و «اجرا» یکی می‌شد.
     * تابع دامنه، مجوز را می‌سنجد و بعد کار می‌سازد؛ و کلید یکتا را هم مدیریت
     * می‌کند: کار فعال با همان کلید، همان کار است.
     */
    async enqueue(input: { kind: string; payload?: Record<string, unknown>; businessId?: string | null; priority?: number; runAt?: string | null; dedupeKey?: string | null }): Promise<Row> {
      return dal.one(
        sql`select ${recordFields('j', JOB_FIELDS)}
            from ops.enqueue_job(${input.kind}, ${JSON.stringify(input.payload ?? {})}::jsonb, ${input.businessId ?? null},
                                 ${input.priority ?? 100}, ${input.runAt ?? null}, ${input.dedupeKey ?? null}) j`,
      );
    },

    // ---------------------------------------------------------------- رخدادها
    /** رخدادهای پردازش‌نشده؛ ورودی کارگر خط لوله (Addendum §56–۷۲). */
    async unprocessedEvents(limit = 50): Promise<Row[]> {
      return dal.query(
        sql`select e.id, e.event_type, e.entity_type, e.entity_id, e.business_id, e.occurred_at, e.attempts, e.last_error
            from ops.event e
            where e.processed_at is null
            order by e.occurred_at asc
            limit ${limit}`,
      );
    },

    /** پردازش یک رخداد: قاعده‌های منطبق اجرا می‌شوند و خلاصه برمی‌گردد. */
    async processEvent(eventId: string): Promise<Row> {
      return dal.one(sql`select ops.process_event(${eventId}) as summary`);
    },

    async emitEvent(input: { eventType: string; entityType: string; entityId: string; businessId?: string | null; payload?: Record<string, unknown> }): Promise<string> {
      const rows = await dal.query<{ id: string }>(
        sql`select app.emit_event(${input.eventType}, ${input.entityType}, ${input.entityId},
              ${input.businessId ?? null}, ${JSON.stringify(input.payload ?? {})}::jsonb) as id`,
      );
      return String(rows[0]?.id ?? '');
    },

    // ---------------------------------------------------------------- اعلان‌ها
    /** اعلان‌های کاربر جاری. یک کاربر فقط اعلان خودش را می‌بیند. */
    async notifications(options: { unreadOnly?: boolean; limit?: number } = {}): Promise<Row[]> {
      const unread = options.unreadOnly ? sql`and n.read_at is null` : sql``;
      return dal.query(
        sql`select n.id, n.kind, n.severity, n.title, n.body, n.action_path, n.data, n.channel, n.status, n.created_at, n.read_at
            from ops.notification n
            where n.recipient_user_id = ${context.userId ?? null} and n.status <> 'cancelled' ${unread}
            order by n.created_at desc
            limit ${Math.min(Number(options.limit ?? 50), 200)}`,
      );
    },

    async markNotificationRead(notificationId: string): Promise<number> {
      return dal.execute(
        sql`update ops.notification n set read_at = now(), status = 'read'
            where n.id = ${notificationId} and n.recipient_user_id = ${context.userId ?? null} and n.read_at is null
            returning id`,
      );
    },

    async unreadNotificationCount(): Promise<number> {
      const rows = await dal.query<{ total: number }>(
        sql`select count(*)::int as total from ops.notification n
            where n.recipient_user_id = ${context.userId ?? null} and n.read_at is null and n.status <> 'cancelled'`,
      );
      return Number(rows[0]?.total ?? 0);
    },

    // ------------------------------------------------------- عملکرد و امنیت
    async performanceHealth(window = '24 hours'): Promise<Row> {
      const rows = await dal.query<{ health: Row }>(
        sql`select ops.performance_health(${window}::interval) as health`,
      );
      return (rows[0]?.health ?? {}) as Row;
    },

    async openRegressions(limit = 50): Promise<Row[]> {
      return dal.query(
        sql`select r.id, r.route_pattern, r.metric, r.severity, r.baseline_value, r.observed_value, r.delta_ratio,
                   r.budget_value, r.sample_count, r.status, r.detected_at, r.suspect_release
            from ops.performance_regression r
            where r.status = 'open'
            order by case r.severity when 'critical' then 1 else 2 end asc, r.detected_at desc
            limit ${limit}`,
      );
    },

    /**
     * رخدادهای امنیتی — فقط برای کارکنان پلتفرم.
     *
     * اینها «گزارش سازمانی» نیستند: آدرس IP، اثر انگشت دستگاه و شناسهٔ
     * درخواست در آن‌هاست و دیدنشان مجوز پلتفرمی می‌خواهد. حصار دوم، سیاست RLS
     * جدول است که همان شرط را دوباره اعمال می‌کند.
     */
    async securityEvents(options: { limit?: number; severity?: string; openOnly?: boolean } = {}): Promise<Row[]> {
      await assertPlatformPermission(deps, 'platform.security.manage');
      const severity = options.severity ? sql`and e.severity = ${options.severity}` : sql``;
      const openOnly = options.openOnly ? sql`and e.acknowledged_at is null` : sql``;
      return dal.query(
        sql`select e.id, e.occurred_at, e.kind, e.severity, e.actor_id, e.business_id, e.ip, e.device_id,
                   e.request_id, e.details, e.acknowledged_at, e.acknowledged_by, e.resolution_note
            from ops.security_event e
            where true ${severity} ${openOnly}
            order by e.occurred_at desc
            limit ${Math.min(Number(options.limit ?? 100), 500)}`,
      );
    },

    /**
     * ثبت یک رخداد امنیتی.
     *
     * `actor_id` از `context` می‌آید، نه از ورودی: اگر فراخوان می‌توانست
     * «فاعل» را تعیین کند، مهاجم می‌توانست رد پای خود را به دیگری بیندازد.
     * درج برای `pv_app`/`pv_worker`/`pv_public` آزاد است (§97) — چون اینجا
     * دقیقاً همان جایی است که باید بتوانیم حتی ورود ناموفقِ کاربر ناشناس را
     * ثبت کنیم.
     */
    async recordSecurityEvent(input: { kind: string; severity?: string; businessId?: string | null; actorId?: string | null; ip?: string | null; deviceId?: string | null; details?: Record<string, unknown> }): Promise<Row> {
      /*
       * بدون `returning`.
       *
       * این عمدی است، نه از قلم افتاده: خواندن رخداد امنیتی فقط برای کارکنان
       * پلتفرم مجاز است (سیاست `security_event_staff_all`)، و `returning` هم
       * یک خواندن است. نویسنده — که ممکن است کاربر بی‌نام باشد — پس سطر را
       * پس نمی‌گیرد؛ فقط می‌داند ثبت شد. اگر شناسه لازم شد، آن درخواست باید از
       * مسیر کارکنان برود، نه اینکه حصار RLS را سوراخ کنیم.
       */
      await dal.query(
        sql`insert into ops.security_event (kind, severity, business_id, actor_id, ip, device_id, request_id, details)
            values (${input.kind}, ${input.severity ?? 'info'}, ${input.businessId ?? context.businessId ?? null},
                    ${input.actorId ?? context.userId ?? null}, ${input.ip ?? null}, ${input.deviceId ?? null},
                    ${context.requestId ?? null}, ${JSON.stringify(input.details ?? {})}::jsonb)`,
      );
      return { recorded: true, kind: input.kind, severity: input.severity ?? 'info' };
    },

    // --------------------------------------------------------------- پشتیبان
    /** پشتیبان‌هایی که آزمون بازیابی‌شان تأیید نشده — دیده‌بان §191. */
    async unverifiedBackups(graceHours = 48): Promise<Row[]> {
      return dal.query(
        sql`select b.id, b.kind, b.status, b.driver, b.size_bytes, b.checksum_sha256, b.is_encrypted,
                   b.schema_version, b.started_at, b.finished_at, b.duration_ms, b.error
            from ops.unverified_backups(${graceHours}) b`,
      );
    },

    async backup(id: string): Promise<Row | null> {
      const row = await dal.maybeOne(sql`select b.id, b.status, b.checksum from ops.backup b where b.id = ${id}`);
      if (!row) notFound('backup', { id });
      return row;
    },

    // ------------------------------------------------------------ نگهداشت
    /**
     * سیاست‌های نگهداری‌ای که وقت اجرایشان رسیده.
     *
     * خروجی، خودِ `ops.retention_policy` است (نه یک خلاصهٔ ساختگی): همان چیزی
     * که کار زمان‌بندی‌شده باید بداند — چه چیزی، چند روز، با کدام اقدام.
     * `legal_hold` هم می‌آید چون سیاستی که در توقیف قانونی است، اجرا نمی‌شود.
     */
    async retentionDue(limit = 50): Promise<Row[]> {
      return dal.query(
        sql`select r.id, r.scope, r.name_fa, r.retain_days, r.action, r.legal_hold, r.legal_hold_reason,
                   r.is_active, r.last_run_at, r.next_run_at
            from ops.retention_due(${limit}) r`,
      );
    },

    /** پاک‌سازی رکوردهای ماشین‌محور قدیمی؛ در کار زمان‌بندی‌شده صدا زده می‌شود. */
    async purgeVitals(olderThan = '30 days'): Promise<number> {
      const rows = await dal.query<{ deleted: number }>(sql`select ops.purge_vitals(${olderThan}::interval) as deleted`);
      return Number(rows[0]?.deleted ?? 0);
    },

    async pruneRateLimits(keepSeconds = 3600): Promise<number> {
      const rows = await dal.query<{ pruned: number }>(sql`select ops.prune_rate_limit_counters(${keepSeconds}) as pruned`);
      return Number(rows[0]?.pruned ?? 0);
    },
  };
}

export type OpsRepository = ReturnType<typeof opsRepository>;
