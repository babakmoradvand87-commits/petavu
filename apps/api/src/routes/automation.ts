/**
 * مسیرهای خودکارسازی (گام ۲۱؛ Addendum §56–۷۲).
 *
 * قاعدهٔ WHEN→IF→THEN، داده است — پس این مسیرها فقط ویرایشگر آن داده‌اند.
 * دو چیز اینجا تحمیل می‌شود و جای دیگری نمی‌شود:
 *
 *   • **فهرست بستهٔ کنش‌ها** (نمایش برای UI آینهٔ همان چیزی است که موتور
 *     می‌فهمد).
 *   • **آزمون خشک پیش از فعال‌سازی**: قاعده‌ای که در آزمون خشک خطا می‌دهد،
 *     هرگز فعال نمی‌شود — نه اینکه در تولید کشف شود.
 */

import { AppError, isUuid } from '@petavu/shared';

import { AUTOMATION_ACTIONS, CONDITION_OPERATORS } from '@petavu/db';
import type { RouteDefinition } from '../types.js';
import { validator } from '../validate.js';

export const automationRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: '/api/v1/businesses/:businessId/automation/rules',
    name: 'automation.list',
    summary: 'قاعده‌های خودکارسازی با صفحه‌بندی',
    tags: ['automation'],
    auth: 'session',
    role: 'pv_app',
    permission: 'automation.manage',
    handler: async (request, scope) => {
      const businessId = requireBusiness(request);
      const page = await scope.repos.automation.list(businessId, {
        cursor: request.query.get('cursor'),
        limit: Number(request.query.get('limit') ?? 24),
        status: request.query.get('status') ?? undefined,
      });
      return {
        body: {
          rules: page.items,
          next_cursor: page.nextCursor,
          has_more: page.hasMore,
          // UI از همین دو فهرست ساخته می‌شود؛ فهرست سخت‌شده در دو جا نمی‌نشیند.
          vocabulary: { actions: AUTOMATION_ACTIONS, operators: CONDITION_OPERATORS },
        },
      };
    },
  },

  {
    method: 'POST',
    path: '/api/v1/businesses/:businessId/automation/rules',
    name: 'automation.create',
    summary: 'ساخت قاعدهٔ خودکارسازی',
    tags: ['automation'],
    auth: 'session',
    role: 'pv_app',
    permission: 'automation.manage',
    handler: async (request, scope) => {
      const businessId = requireBusiness(request);
      const body = validator(request.body);
      const key = body.string('key', { min: 3, max: 80 });
      const nameFa = body.string('name_fa', { min: 2, max: 160 });
      const description = body.optionalString('description', { max: 600 });
      const eventType = body.string('event_type', { min: 3, max: 80 });
      const conditions = body.optionalObject('conditions') ?? undefined;
      const actions = body.array<Record<string, unknown>>('actions', { min: 1, max: 10 });
      const priority = body.optionalInteger('priority', { min: 1, max: 9 }) ?? 5;
      const cooldownSeconds = body.optionalInteger('cooldown_seconds', { min: 0, max: 86400 }) ?? 300;
      const maxRunsPerDay = body.optionalInteger('max_runs_per_day', { min: 1, max: 10000 }) ?? 200;
      const dryRun = body.boolean('dry_run', false);
      body.done();

      assertActions(actions);
      assertConditions(conditions);

      const rule = await scope.repos.automation.create({
        businessId,
        key,
        nameFa,
        description,
        eventType,
        conditions,
        actions,
        priority,
        cooldownSeconds,
        maxRunsPerDay,
        dryRun,
      });

      return { status: 201, body: { rule } };
    },
  },

  {
    method: 'PATCH',
    path: '/api/v1/businesses/:businessId/automation/rules/:ruleId',
    name: 'automation.update',
    summary: 'ویرایش قاعده با کنترل نسخه',
    tags: ['automation'],
    auth: 'session',
    role: 'pv_app',
    permission: 'automation.manage',
    handler: async (request, scope) => {
      requireBusiness(request);
      const ruleId = requireUuid(request.params.ruleId, 'ruleId');
      const body = validator(request.body);
      const expectedVersion = body.integer('expected_version', { min: 1 });

      const values: Record<string, unknown> = {};
      const nameFa = body.optionalString('name_fa', { min: 2, max: 160 });
      if (nameFa !== null) values.name_fa = nameFa;
      const description = body.optionalString('description', { max: 600 });
      if (description !== null) values.description = description;
      const conditions = body.optionalObject('conditions');
      if (conditions !== null) values.conditions = conditions;
      const actions = body.raw('actions');
      if (actions !== undefined) {
        if (!Array.isArray(actions)) {
          throw new AppError('validation_failed', { details: { issues: [{ path: 'actions', code: 'expected_array' }] } });
        }
        assertActions(actions as Array<Record<string, unknown>>);
        values.actions = actions;
      }
      const priority = body.optionalInteger('priority', { min: 1, max: 9 });
      if (priority !== null) values.priority = priority;
      const cooldownSeconds = body.optionalInteger('cooldown_seconds', { min: 0, max: 86400 });
      if (cooldownSeconds !== null) values.cooldown_seconds = cooldownSeconds;
      const maxRunsPerDay = body.optionalInteger('max_runs_per_day', { min: 1, max: 10000 });
      if (maxRunsPerDay !== null) values.max_runs_per_day = maxRunsPerDay;
      body.done();

      if (Object.keys(values).length === 0) {
        throw new AppError('validation_failed', { details: { reason: 'no_fields' } });
      }

      const rule = await scope.repos.automation.update(ruleId, expectedVersion, values);
      return { status: 200, body: { rule } };
    },
  },

  {
    method: 'POST',
    path: '/api/v1/businesses/:businessId/automation/rules/:ruleId/status',
    name: 'automation.setStatus',
    summary: 'فعال/غیرفعال کردن قاعده',
    tags: ['automation'],
    auth: 'session',
    role: 'pv_app',
    permission: 'automation.manage',
    handler: async (request, scope) => {
      requireBusiness(request);
      const ruleId = requireUuid(request.params.ruleId, 'ruleId');
      const body = validator(request.body);
      const status = body.oneOf('status', ['draft', 'active', 'paused', 'archived'] as const);
      body.done();

      const rule = await scope.repos.automation.setStatus(ruleId, status);
      return { status: 200, body: { rule } };
    },
  },

  {
    method: 'POST',
    path: '/api/v1/businesses/:businessId/automation/rules/:ruleId/dry-run',
    name: 'automation.dryRun',
    summary: 'آزمون خشک قاعده با بار نمونه',
    tags: ['automation'],
    auth: 'session',
    role: 'pv_app',
    permission: 'automation.manage',
    handler: async (request, scope) => {
      requireBusiness(request);
      const ruleId = requireUuid(request.params.ruleId, 'ruleId');
      const body = validator(request.body);
      const payload = body.optionalObject('payload') ?? {};
      body.done();

      const result = await scope.repos.automation.dryRunRule(ruleId, payload);
      return { status: 200, body: { dry_run: result } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/businesses/:businessId/automation/runs',
    name: 'automation.runs',
    summary: 'دفتر اجرای قاعده‌ها',
    tags: ['automation'],
    auth: 'session',
    role: 'pv_app',
    permission: 'automation.manage',
    handler: async (request, scope) => {
      const businessId = requireBusiness(request);
      const page = await scope.repos.automation.runs(businessId, {
        cursor: request.query.get('cursor'),
        limit: Number(request.query.get('limit') ?? 24),
        status: request.query.get('status') ?? undefined,
      });
      return { body: { runs: page.items, next_cursor: page.nextCursor, has_more: page.hasMore } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/businesses/:businessId/automation/health',
    name: 'automation.health',
    summary: 'سلامت خودکارسازی: اجراهای بازمانده و شکست‌خورده',
    tags: ['automation'],
    auth: 'session',
    role: 'pv_app',
    permission: 'automation.manage',
    handler: async (request, scope) => {
      const businessId = requireBusiness(request);
      const health = await scope.repos.automation.health(businessId);
      return { body: { health } };
    },
  },
];

/* --------------------------------------------------------------- کمکی‌ها */

function requireUuid(value: string | undefined, field: string): string {
  if (!value || !isUuid(value)) {
    throw new AppError('validation_failed', { details: { issues: [{ path: field, code: 'expected_uuid' }] } });
  }
  return value;
}

function requireBusiness(request: { readonly params: Readonly<Record<string, string>>; readonly businessId: string | null }): string {
  const value = request.params.businessId;
  if (!value || !isUuid(value)) {
    throw new AppError('validation_failed', { details: { issues: [{ path: 'businessId', code: 'expected_uuid' }] } });
  }
  if (request.businessId && request.businessId !== value) {
    throw new AppError('forbidden', { details: { reason: 'business_context_mismatch' } });
  }
  return value;
}

/**
 * کنش‌ها پیش از نوشتن سنجیده می‌شوند؛ کنش ناشناس هرگز ذخیره نمی‌شود.
 *
 * نام فیلد `type` است، نه `kind` — و این جزئیات سلیقه‌ای نیست:
 * موتور اجرا (`ops.run_automation_rule`, مهاجرت ۰۰۱۰) با `v_action ->> 'type'`
 * شاخه می‌شود، و `kind` در کنشِ `notify` معنای دیگری دارد (نوع اعلان). اگر
 * مرز API `kind` را بپذیرد و پایگاه‌داده `type` را بخواهد، هر قاعده‌ای که از
 * راه API ساخته شود در زمان اجرا «کنش ناشناخته» می‌شود — خطایی که تازه سرِ
 * اجرای واقعی دیده می‌شود، نه سرِ ساخت. یک قرارداد، یک نام.
 */
function assertActions(actions: Array<Record<string, unknown>>): void {
  if (actions.length === 0) {
    throw new AppError('validation_failed', { details: { issues: [{ path: 'actions', code: 'required' }] } });
  }

  actions.forEach((action, index) => {
    const type = typeof action.type === 'string' ? action.type : '';
    if (!(AUTOMATION_ACTIONS as readonly string[]).includes(type)) {
      throw new AppError('validation_failed', {
        details: {
          issues: [{ path: `actions.${index}.type`, code: 'not_allowed' }],
          allowed: AUTOMATION_ACTIONS,
        },
      });
    }
  });
}

/**
 * شرط‌ها هم همان شکل `ops.condition_matches` را دارند: شاخه‌های
 * `all`/`any`/`not` که هر کدام فهرستی از `{ op, path, value }` هستند.
 *
 * چرا اینجا هم سنجیده می‌شود، با اینکه مخزن هم می‌سنجد: مرز API جایی است که
 * خطا باید با *مسیر فیلد* برگردد تا کلاینت بداند کدام شرط را درست کند. مخزن
 * همین را می‌گوید، ولی بدون مسیر — و بدون مسیر، پیام «شرط نامعتبر» به
 * کاربر پنل چیزی نمی‌گوید.
 */
function assertConditions(conditions: Record<string, unknown> | undefined): void {
  if (conditions === undefined) return;

  const branches: Array<'all' | 'any' | 'not'> = ['all', 'any', 'not'];
  const known = Object.keys(conditions);
  const unknown = known.filter((branch) => !branches.includes(branch as 'all'));
  if (unknown.length > 0) {
    throw new AppError('validation_failed', {
      details: {
        issues: unknown.map((branch) => ({ path: `conditions.${branch}`, code: 'unknown_branch' })),
        allowed: branches,
      },
    });
  }

  for (const branch of branches) {
    const list = conditions[branch];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      throw new AppError('validation_failed', { details: { issues: [{ path: `conditions.${branch}`, code: 'expected_array' }] } });
    }
    list.forEach((condition, index) => {
      const entry = (condition ?? {}) as { op?: unknown; path?: unknown };
      if (typeof entry.op !== 'string' || !(CONDITION_OPERATORS as readonly string[]).includes(entry.op)) {
        throw new AppError('validation_failed', {
          details: {
            issues: [{ path: `conditions.${branch}.${index}.op`, code: 'not_allowed' }],
            allowed: CONDITION_OPERATORS,
          },
        });
      }
      if (typeof entry.path !== 'string' || entry.path.trim() === '') {
        throw new AppError('validation_failed', {
          details: { issues: [{ path: `conditions.${branch}.${index}.path`, code: 'required' }] },
        });
      }
    });
  }
}
