/**
 * Repository خودکارسازی (Addendum §56–۷۲).
 *
 * قاعده‌های WHEN→IF→THEN **داده‌اند، نه کد** (§74). پس نوشتن قاعده یعنی نوشتن
 * JSON در چند ستون، و اعتبارسنجی یعنی سنجیدن همان JSON. دو چیز اینجا تصمیم
 * می‌گیرد و هر دو در SQL است:
 *
 *   • `ops.condition_matches` — عملگرهای بسته؛ هیچ رشتهٔ SQL اجرا نمی‌شود.
 *   • `ops.run_rule` — تصاحب پیش از کنش، با یکتایی `(rule_id, event_id)`؛ تنها
 *     ضمانت واقعی «یک‌بار اجرا».
 *
 * Repository فقط قاعده می‌سازد، فهرست می‌کند، خاموش/روشن می‌کند، و اجراها را
 * نشان می‌دهد. هیچ‌جای این فایل «اجرای کد» نیست و اضافه هم نمی‌شود.
 */

import { raw, sql } from '../sql.js';
import type { Row } from '../types.js';
import { PAGE, type RepoDeps, assertPermission, forbidden, invalid, notFound, pageTail } from './support.js';
import type { Page } from '../pagination.js';

/** کنش‌های مجاز؛ فهرست بسته. گسترش این فهرست، یک تصمیم معماری است نه یک تنظیم. */
export const AUTOMATION_ACTIONS = ['notify', 'emit_event', 'enqueue_job', 'webhook'] as const;

/**
 * عملگرهای مجاز شرط — **آینهٔ دقیق** `ops.condition_matches`.
 *
 * این فهرست باید حرف‌به‌حرف با `case` تابع SQL یکی باشد. اگر عملگری اینجا
 * باشد که در SQL نیست، آن قاعده بی‌صدا هرگز تطبیق نمی‌خورد (تابع SQL برای
 * عملگر ناشناخته `false` می‌دهد) — و بی‌صدا بودن، بدترین نوع خطا در
 * خودکارسازی است. پس فهرست از SQL گرفته شده، نه از تصور.
 */
export const CONDITION_OPERATORS = [
  'exists', 'not_exists',
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte',
  'in', 'not_in',
  'any_of', 'all_of', 'none_of',
  'contains', 'empty',
] as const;

const RULE_COLUMNS = `r.id, r.business_id, r.key, r.name_fa, r.description, r.event_type, r.conditions, r.actions,
  r.status, r.priority, r.cooldown_seconds, r.max_runs_per_day, r.dry_run, r.is_system, r.created_at, r.updated_at, r.version`;

export function automationRepository(deps: RepoDeps) {
  const { dal } = deps;

  function validateActions(actions: unknown): void {
    if (!Array.isArray(actions) || actions.length === 0) {
      invalid('invalid_actions', 'قاعده باید دست‌کم یک کنش داشته باشد');
    }
    for (const action of actions as Array<{ type?: string }>) {
      if (!action || typeof action.type !== 'string' || !AUTOMATION_ACTIONS.includes(action.type as (typeof AUTOMATION_ACTIONS)[number])) {
        invalid('unknown_action', 'کنش ناشناخته در قاعده', { allowed: AUTOMATION_ACTIONS });
      }
    }
  }

  function validateConditions(conditions: unknown): void {
    if (typeof conditions !== 'object' || conditions === null) invalid('invalid_conditions', 'شرط‌ها باید شیء باشند');
    const shape = conditions as { all?: unknown; any?: unknown; not?: unknown };
    for (const branch of [shape.all, shape.any, shape.not]) {
      if (branch === undefined) continue;
      if (!Array.isArray(branch)) invalid('invalid_conditions', 'شاخهٔ شرط باید آرایه باشد');
      for (const condition of branch as Array<{ op?: string; path?: string }>) {
        if (!condition || typeof condition.op !== 'string' || !CONDITION_OPERATORS.includes(condition.op as (typeof CONDITION_OPERATORS)[number])) {
          invalid('unknown_operator', 'عملگر شرط ناشناخته است', { allowed: CONDITION_OPERATORS });
        }
        /*
         * `path` الزامی است: `ops.condition_matches` بدون مسیر، `false`
         * برمی‌گرداند. اگر اینجا نگیریمش، قاعده‌ای ذخیره می‌شود که «شرط دارد»
         * ولی همیشه رد می‌شود.
         */
        if (typeof condition.path !== 'string' || condition.path.trim() === '') {
          invalid('missing_condition_path', 'هر شرط باید مسیر فیلد داشته باشد', { op: condition.op });
        }
      }
    }
  }

  return {
    async byId(ruleId: string): Promise<Row | null> {
      return dal.maybeOne(sql`select ${raw(RULE_COLUMNS)} from ops.automation_rule r where r.id = ${ruleId}`);
    },

    async list(businessId: string | null, options: { cursor?: string | null; limit?: number | null; status?: string } = {}): Promise<Page<Row>> {
      const filters = [sql`(r.business_id = ${businessId ?? null} or (r.business_id is null and r.is_system))`];
      if (options.status) filters.push(sql`r.status = ${options.status}`);
      const where = filters.reduce((acc, filter) => sql`${acc} and ${filter}`);
      const tail = pageTail({ orderBy: 'r.priority', keyExpression: 'r.priority', idColumn: 'r.id', direction: 'asc' });

      return dal.page<Row>({
        request: options,
        defaultLimit: PAGE.defaultLimit,
        maxLimit: PAGE.maxLimit,
        statement: (cursor, fetchLimit) =>
          sql`select ${raw(RULE_COLUMNS)} from ops.automation_rule r where ${where} ${tail(cursor, fetchLimit)}`,
        extract: (row) => ({ key: Number(row.priority), id: String(row.id) }),
      });
    },

    async create(input: {
      businessId: string | null;
      key: string;
      nameFa: string;
      description?: string | null;
      eventType: string;
      conditions?: Record<string, unknown>;
      actions: Array<Record<string, unknown>>;
      priority?: number;
      cooldownSeconds?: number;
      maxRunsPerDay?: number;
      dryRun?: boolean;
    }): Promise<Row> {
      if (input.businessId) await assertPermission(deps, input.businessId, 'automation.manage');
      if (!/^[a-z][a-z0-9_.]{2,60}$/.test(input.key)) invalid('invalid_key', 'کلید قاعده نامعتبر است');
      if (!/\./.test(input.eventType)) invalid('invalid_event', 'نام رخداد باید «نام‌فضا.رخداد» باشد');
      validateActions(input.actions);
      validateConditions(input.conditions ?? { all: [] });

      const existing = await dal.maybeOne<{ id: string }>(
        sql`select r.id from ops.automation_rule r
            where r.key = ${input.key} and r.business_id is not distinct from ${input.businessId ?? null}`,
      );
      if (existing) invalid('duplicate_rule', 'قاعده‌ای با این کلید از قبل هست', { id: existing.id });

      return dal.one(
        sql`insert into ops.automation_rule (business_id, key, name_fa, description, event_type, conditions, actions,
                                             priority, cooldown_seconds, max_runs_per_day, dry_run)
            values (${input.businessId ?? null}, ${input.key}, ${input.nameFa}, ${input.description ?? null}, ${input.eventType},
                    ${JSON.stringify(input.conditions ?? { all: [] })}::jsonb, ${JSON.stringify(input.actions)}::jsonb,
                    ${input.priority ?? 100}, ${input.cooldownSeconds ?? 0}, ${input.maxRunsPerDay ?? 0}, ${input.dryRun ?? false})
            returning ${raw(RULE_COLUMNS.replaceAll('r.', ''))}`,
      );
    },

    /**
     * ویرایش قاعده.
     *
     * `status` عمداً از فهرست بیرون است: روشن/خاموش‌کردن مسیر جدا دارد تا
     * «ویرایش متن» و «فعال‌کردن» دو عمل متفاوت بمانند و در حسابرسی قاطی نشوند.
     */
    async update(ruleId: string, expectedVersion: number, values: Record<string, unknown>): Promise<Row> {
      const rule = await dal.maybeOne<{ business_id: string | null; is_system: boolean }>(
        sql`select r.business_id, r.is_system from ops.automation_rule r where r.id = ${ruleId}`,
      );
      /*
       * قاعدهٔ سیستمی (مثل «اطلاع انتشار») برای کاربر عادی حتی دیده نمی‌شود:
       * سیاست RLS آن را به کارکنان پلتفرم محدود کرده است. پس «پیدا نشد» اینجا
       * معنایش «یا وجود ندارد یا به تو مربوط نیست» است — و پاسخ امن، یکی است:
       * دسترسی ندارید. تفکیک این دو، وجود قاعده‌های پلتفرم را لو می‌دهد.
       */
      if (!rule) {
        forbidden('rule_not_accessible', {
          id: ruleId,
          hint: 'قاعده‌های سیستمی فقط از پنل مدیریت پلتفرم ویرایش می‌شوند',
        });
      }
      if (rule.business_id) await assertPermission(deps, rule.business_id, 'automation.manage');
      if (rule.is_system) invalid('system_rule', 'قاعدهٔ سیستمی از این مسیر ویرایش نمی‌شود');

      if (values.actions !== undefined) validateActions(values.actions);
      if (values.conditions !== undefined) validateConditions(values.conditions);

      const allowed = ['name_fa', 'description', 'event_type', 'conditions', 'actions', 'priority', 'cooldown_seconds', 'max_runs_per_day', 'dry_run'];
      const entries = Object.entries(values).filter(([key]) => allowed.includes(key));
      if (entries.length === 0) invalid('no_values', 'هیچ فیلد قابل‌ویرایشی فرستاده نشده');

      return dal.updateWithVersion({
        table: 'ops.automation_rule',
        id: ruleId,
        expectedVersion,
        values: Object.fromEntries(entries),
        tenant: rule.business_id ? { column: 'business_id', value: rule.business_id } : undefined,
        returning: RULE_COLUMNS.replaceAll('r.', '').split(',').map((column) => column.trim()),
      });
    },

    /** روشن/خاموش/بایگانی — گذر وضعیت با حسابرسی. */
    async setStatus(ruleId: string, status: 'draft' | 'active' | 'paused' | 'archived'): Promise<Row> {
      const rule = await dal.maybeOne<{ business_id: string | null; is_system: boolean; status: string }>(
        sql`select r.business_id, r.is_system, r.status from ops.automation_rule r where r.id = ${ruleId}`,
      );
      if (!rule) notFound('automation_rule', { id: ruleId });
      if (rule.business_id) await assertPermission(deps, rule.business_id, 'automation.manage');

      const updated = await dal.one<Row>(
        sql`update ops.automation_rule r set status = ${status}
            where r.id = ${ruleId}
            returning ${raw(RULE_COLUMNS.replaceAll('r.', ''))}`,
      );

      await dal.execute(
        sql`select app.record_audit('automation.' || ${status}, 'automation_rule', ${ruleId}, ${rule.business_id ?? null},
              ${JSON.stringify({ from: rule.status, to: status, is_system: rule.is_system })}::jsonb)`,
      );

      return updated;
    },

    /** اجرای規則 برای یک رخداد مشخص — تابع دامنه، با تصاحب اتمی. */
    async runRule(ruleId: string, eventId: string): Promise<Row | null> {
      return dal.maybeOne(
        sql`select (r).id as id, (r).status as status, (r).skip_reason as skip_reason,
                   (r).actions_result as actions_result, (r).error as error, (r).finished_at as finished_at
            from ops.run_rule(${ruleId}, ${eventId}) r`,
      );
    },

    /** قاعده‌های منطبق با یک رخداد، پیش از اجرا — برای پیش‌نمایش «چه خواهد شد». */
    async matchingRules(eventId: string): Promise<Row[]> {
      return dal.query(
        sql`select m.rule_id, m.skip_reason, m.name_fa, m.priority from ops.matching_rules(${eventId}) m`,
      );
    },

    async runs(businessId: string | null, options: { cursor?: string | null; limit?: number | null; status?: string } = {}): Promise<Page<Row>> {
      const filters = [sql`(a.business_id = ${businessId ?? null} or ${businessId === null ? sql`true` : sql`a.business_id is null`})`];
      if (options.status) filters.push(sql`a.status = ${options.status}`);
      const where = filters.reduce((acc, filter) => sql`${acc} and ${filter}`);
      const tail = pageTail({ orderBy: 'a.started_at', keyExpression: 'a.started_at', idColumn: 'a.id' });

      return dal.page<Row>({
        request: options,
        defaultLimit: PAGE.defaultLimit,
        maxLimit: PAGE.maxLimit,
        statement: (cursor, fetchLimit) =>
          sql`select a.id, a.rule_id, a.event_id, a.event_type, a.business_id, a.status, a.skip_reason,
                     a.actions_result, a.error, a.started_at, a.finished_at, a.duration_ms
              from ops.automation_run a where ${where} ${tail(cursor, fetchLimit)}`,
        extract: (row) => ({ key: String(row.started_at), id: String(row.id) }),
      });
    },

    /** سلامت خودکارسازی: چه چیزی می‌شکند، چه چیزی کند است (Addendum §69–۷۰). */
    /** تصویر سلامت خودکارسازی؛ یک شیء jsonb با شمارنده‌ها و آخرین خطاها. */
    async health(businessId?: string | null): Promise<Row> {
      const rows = await dal.query<{ health: Row }>(
        sql`select ops.automation_health(${businessId ?? null}) as health`,
      );
      return (rows[0]?.health ?? {}) as Row;
    },

    /**
     * آزمون خشک: قاعده را روی یک بار دادهٔ نمونه می‌سنجد، بی‌آنکه کنشی اجرا شود.
     * «تصمیم نگرفتن» دربارهٔ یک قاعده، همان چیزی است که قاعده را خطرناک می‌کند.
     */
    async dryRunRule(ruleId: string, payload: Record<string, unknown>): Promise<Row> {
      const rule = await this.byId(ruleId);
      if (!rule) notFound('automation_rule', { id: ruleId });
      const rows = await dal.query<{ matched: boolean }>(
        sql`select ops.rule_matches(r, ${JSON.stringify(payload)}::jsonb) as matched
            from ops.automation_rule r where r.id = ${ruleId}`,
      );
      return { rule_id: ruleId, matched: rows[0]?.matched === true, payload } as unknown as Row;
    },
  };
}

export type AutomationRepository = ReturnType<typeof automationRepository>;
