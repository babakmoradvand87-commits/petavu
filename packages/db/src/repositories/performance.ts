/**
 * Repository عملکرد (Addendum §91–۹۵): نمونهٔ میدانی، تجمیع، خط مبنا، پس‌رفت.
 *
 * **نقطهٔ اعتماد، تابع دامنه است.** `ops.record_vitals` سمت سرور تصمیم می‌گیرد:
 * رشتهٔ پرس‌وجو را پاک می‌کند، رکورد نامعتبر را مستند رد می‌کند، سقف دسته را
 * اعمال می‌کند، و کسب‌وکار را از زمینه می‌گیرد — نه از بدنهٔ درخواست. اگر
 * رکورد سنجهٔ مرورگر را مستقیم در جدول بنویسیم، هر بازدیدکننده می‌تواند برای
 * کسب‌وکار دیگری داده بنویسد یا مسیرهای کثیف را وارد گزارش‌ها کند.
 */

import { sql } from '../sql.js';
import type { Row } from '../types.js';
import { type RepoDeps, assertPlatformPermission } from './support.js';

export interface VitalsRecord {
  metric: 'LCP' | 'INP' | 'CLS' | 'TTFB' | 'FCP' | 'navigation' | string;
  value: number;
  routePattern: string;
  pagePath: string;
  deviceClass?: string | null;
  connection?: string | null;
  navigationType?: string | null;
  sessionHash?: string | null;
  releaseKey?: string | null;
  occurredAt?: string | null;
}

export function performanceRepository(deps: RepoDeps) {
  const { dal, context } = deps;

  return {
    /**
     * ثبت نمونه‌های میدانی.
     *
     * `businessId` از زمینه گرفته می‌شود؛ اگر فراخوان بخواهد کسب‌وکار دیگری
     * بدهد، تابع دامنه آن را نادیده می‌گیرد. خروجی، خلاصهٔ پذیرفته/رد‌شده است.
     */
    async record(records: readonly VitalsRecord[], businessId?: string | null): Promise<Row> {
      if (records.length === 0) return { accepted: 0, rejected: 0 } as unknown as Row;
      /*
       * نام سنجه به حروف کوچک عادی می‌شود: مرورگر `LCP` می‌فرستد و پایگاه‌داده
       * `lcp` می‌شناسد. اگر این تبدیل در دو جای مختلف انجام شود، دیر یا زود
       * یکی جا می‌ماند و رکورد بی‌صدا رد می‌شود.
       */
      const payload = records.map((record) => ({
        metric: String(record.metric).toLowerCase(),
        value: record.value,
        /*
         * کلیدها همان چیزی است که `ops.record_vitals` می‌شناسد (`path`، نه
         * `page_path`): نام‌ها یک بار، در تابع دامنه تعیین شده‌اند و اینجا
         * فقط رعایت می‌شوند. مسیر، در خود تابع از رشتهٔ پرس‌وجو پاک می‌شود.
         */
        path: record.pagePath,
        route_pattern: record.routePattern,
        device_class: record.deviceClass ?? null,
        connection: record.connection ?? null,
        navigation_type: record.navigationType ?? null,
        session_hash: record.sessionHash ?? null,
        release_key: record.releaseKey ?? null,
        occurred_at: record.occurredAt ?? null,
      }));
      const rows = await dal.query<{ summary: Row }>(
        sql`select ops.record_vitals(${JSON.stringify(payload)}::jsonb, ${businessId ?? context.businessId ?? null}) as summary`,
      );
      return (rows[0]?.summary ?? {}) as Row;
    },

    /** تجمیع ساعتی/روزانه؛ ایدمپوتنت — اجرای دوباره، دادهٔ تکراری نمی‌سازد. */
    async rollup(bucket: 'hour' | 'day' = 'hour', window = '2 days'): Promise<number> {
      const rows = await dal.query<{ updated: number }>(
        sql`select ops.rollup_vitals(${bucket}, ${window}::interval) as updated`,
      );
      return Number(rows[0]?.updated ?? 0);
    },

    /** خط مبنا؛ نقطهٔ مرجع تشخیص پس‌رفت. */
    async baselines(routePattern?: string | null): Promise<Row[]> {
      const filter = routePattern ? sql`where b.route_pattern = ${routePattern}` : sql``;
      return dal.query(
        sql`select b.route_pattern, b.metric, b.window_days, b.sample_count, b.p50, b.p75, b.p95, b.budget_value, b.computed_at
            from ops.performance_baseline b ${filter}
            order by b.route_pattern asc, b.metric asc`,
      );
    },

    async computeBaselines(windowDays = 7, minSamples = 100): Promise<number> {
      await assertPlatformPermission(deps, 'platform.settings.manage');
      const rows = await dal.query<{ computed: number }>(
        sql`select ops.compute_baselines(${windowDays}, ${minSamples}) as computed`,
      );
      return Number(rows[0]?.computed ?? 0);
    },

    async detectRegressions(threshold = 0.2, window = '24 hours', minSamples = 50): Promise<number> {
      await assertPlatformPermission(deps, 'platform.settings.manage');
      const rows = await dal.query<{ detected: number }>(
        sql`select ops.detect_regressions(${threshold}, ${window}::interval, ${minSamples}) as detected`,
      );
      return Number(rows[0]?.detected ?? 0);
    },

    async regressions(status = 'open'): Promise<Row[]> {
      return dal.query(
        sql`select r.id, r.route_pattern, r.metric, r.severity, r.baseline_value, r.observed_value, r.delta_ratio,
                   r.budget_value, r.window_start, r.window_end, r.sample_count, r.suspect_release, r.status, r.detected_at, r.note
            from ops.performance_regression r
            where r.status = ${status}
            order by case r.severity when 'critical' then 1 else 2 end asc, r.detected_at desc`,
      );
    },

    async resolveRegression(id: string, status: string, note?: string | null): Promise<Row | null> {
      await assertPlatformPermission(deps, 'platform.settings.manage');
      return dal.maybeOne(
        sql`select (r).id as id, (r).status as status, (r).resolved_at as resolved_at, (r).note as note
            from ops.resolve_regression(${id}, ${status}, ${note ?? null}) r`,
      );
    },

    /** بررسی بودجهٔ یک مسیر با اندازه‌گیری واقعی؛ همان تابعی که دروازهٔ انتشار می‌خواند. */
    async checkBudget(path: string, measurement: Record<string, unknown>): Promise<Row> {
      const rows = await dal.query<{ result: Row }>(
        sql`select ops.check_budget(${path}, ${JSON.stringify(measurement)}::jsonb) as result`,
      );
      return (rows[0]?.result ?? {}) as Row;
    },

    /** دروازهٔ انتشار: آیا این کسب‌وکار می‌تواند منتشر کند؟ (Addendum §1–۴). */
    async publishGate(businessId: string): Promise<Row> {
      const rows = await dal.query<{ result: Row }>(sql`select ops.publish_gate(${businessId}) as result`);
      return (rows[0]?.result ?? {}) as Row;
    },

    /** بودجهٔ مسیر — برای تست‌ها و داشبورد عملکرد. */
    async budgetForRoute(path: string): Promise<Row | null> {
      return dal.maybeOne(
        sql`select b.id, b.route_pattern, b.scope, b.name_fa, b.lcp_ms, b.inp_ms, b.cls, b.ttfb_ms,
                   b.weight_kb, b.request_count, b.api_p95_ms, b.rum_sample_rate, b.is_active
            from ops.budget_for_route(${path}) b`,
      );
    },
  };
}

export type PerformanceRepository = ReturnType<typeof performanceRepository>;
