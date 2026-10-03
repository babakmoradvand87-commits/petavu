/**
 * مسیرهای عملکرد (گام ۲۱؛ Addendum §1–۱۹، §91–۹۵).
 *
 * `POST /api/v1/public/vitals` یک مرز اعتماد است، نه یک اندپوینت معمولی:
 * داده از مرورگرِ بی‌نام می‌آید. پس هرچه در دامنه تحمیل شده، اینجا دوباره
 * تحمیل نمی‌شود — فقط **شکل** درخواست سنجیده می‌شود و بقیه به تابع دامنه
 * `ops.record_vitals` سپرده می‌شود که خودش پاک‌سازی مسیر، رد رکورد نامعتبر،
 * سقف دسته و «کسب‌وکار از سرور نه از بدنه» را اعمال می‌کند (§92).
 */

import { AppError, isUuid } from '@petavu/shared';
import { RATE_LIMITS } from '@petavu/security';

import type { RouteDefinition } from '../types.js';
import { validator } from '../validate.js';

const VITALS_METRICS = ['lcp', 'inp', 'cls', 'ttfb', 'fcp'] as const;
const MAX_VITALS_BATCH = 20;

export const performanceRoutes: RouteDefinition[] = [
  {
    method: 'POST',
    path: '/api/v1/public/vitals',
    name: 'performance.recordVitals',
    summary: 'ثبت سنجه‌های میدانی عملکرد از مرورگر',
    tags: ['performance', 'public'],
    auth: 'public',
    role: 'pv_public',
    rateLimit: RATE_LIMITS.publicForm,
    originCheck: true,
    handler: async (request, scope) => {
      const body = validator(request.body);
      const raw = body.array<Record<string, unknown>>('samples', { min: 1, max: MAX_VITALS_BATCH });
      body.done();

      const samples = raw.map((sample, index) => {
        const metric = typeof sample.metric === 'string' ? sample.metric.toLowerCase() : '';
        if (!(VITALS_METRICS as readonly string[]).includes(metric)) {
          throw new AppError('validation_failed', {
            details: { issues: [{ path: `samples.${index}.metric`, code: 'not_allowed' }], allowed: VITALS_METRICS },
          });
        }
        const value = Number(sample.value);
        if (!Number.isFinite(value) || value < 0) {
          throw new AppError('validation_failed', { details: { issues: [{ path: `samples.${index}.value`, code: 'expected_number' }] } });
        }
        // مسیر، هرچه باشد، در پایگاه‌داده پاک‌سازی می‌شود؛ اینجا فقط نوع سنجیده می‌شود.
        const path = typeof sample.path === 'string' && sample.path.startsWith('/') ? sample.path : '';
        if (path === '') {
          throw new AppError('validation_failed', { details: { issues: [{ path: `samples.${index}.path`, code: 'expected_path' }] } });
        }
        return {
          metric,
          value,
          path,
          rating: typeof sample.rating === 'string' ? sample.rating : null,
          navigation_type: typeof sample.navigation_type === 'string' ? sample.navigation_type : null,
          connection: typeof sample.connection === 'string' ? sample.connection : null,
        };
      });

      const result = await scope.repos.performance.record(samples as never, request.businessId);
      return { status: 202, body: { recorded: result } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/performance/budget',
    name: 'performance.budget',
    summary: 'بودجهٔ عملکرد یک الگوی مسیر',
    tags: ['performance'],
    auth: 'any',
    role: 'pv_public',
    handler: async (request, scope) => {
      const path = request.query.get('path') ?? '';
      if (!path.startsWith('/')) {
        throw new AppError('validation_failed', { details: { issues: [{ path: 'path', code: 'expected_path' }] } });
      }
      const budget = await scope.repos.performance.budgetForRoute(path);
      return { body: { budget } };
    },
  },

  {
    method: 'POST',
    path: '/api/v1/performance/budget/check',
    name: 'performance.checkBudget',
    summary: 'سنجش یک اندازه‌گیری در برابر بودجه (سه‌حالته)',
    tags: ['performance'],
    auth: 'session',
    role: 'pv_app',
    handler: async (request, scope) => {
      const body = validator(request.body);
      const path = body.string('path', { min: 1, max: 300 });
      const measurement = body.object('measurement');
      body.done();

      if (!path.startsWith('/')) {
        throw new AppError('validation_failed', { details: { issues: [{ path: 'path', code: 'expected_path' }] } });
      }

      const check = await scope.repos.performance.checkBudget(path, measurement);
      return { status: 200, body: { check } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/businesses/:businessId/performance/gate',
    name: 'performance.publishGate',
    summary: 'دروازهٔ انتشار: حکم نهایی برای انتشار',
    tags: ['performance'],
    auth: 'session',
    role: 'pv_app',
    permission: 'business.publish',
    handler: async (request, scope) => {
      const businessId = requireBusiness(request);
      const gate = await scope.repos.performance.publishGate(businessId);
      return { body: { gate } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/businesses/:businessId/performance/regressions',
    name: 'performance.regressions',
    summary: 'پس‌رفت‌های عملکرد',
    tags: ['performance'],
    auth: 'session',
    role: 'pv_app',
    permission: 'business.analytics.view',
    handler: async (request, scope) => {
      const businessId = requireBusiness(request);
      const status = request.query.get('status') ?? 'open';
      const regressions = await scope.repos.performance.regressions(status);
      const baselines = await scope.repos.performance.baselines();
      void businessId;
      return { body: { regressions, baselines } };
    },
  },

  {
    method: 'POST',
    path: '/api/v1/businesses/:businessId/performance/regressions/:regressionId/resolve',
    name: 'performance.resolveRegression',
    summary: 'بستن پس‌رفت با یادداشت',
    tags: ['performance'],
    auth: 'session',
    role: 'pv_app',
    permission: 'business.publish',
    handler: async (request, scope) => {
      requireBusiness(request);
      const regressionId = String(request.params.regressionId ?? '');
      if (!isUuid(regressionId)) {
        throw new AppError('validation_failed', { details: { issues: [{ path: 'regressionId', code: 'expected_uuid' }] } });
      }

      const body = validator(request.body);
      const status = body.oneOf('status', ['resolved', 'ignored', 'open'] as const, 'resolved');
      const note = body.optionalString('note', { max: 400 });
      body.done();

      const regression = await scope.repos.performance.resolveRegression(regressionId, status, note);
      return { status: 200, body: { regression } };
    },
  },

  {
    method: 'POST',
    path: '/api/v1/ops/performance/rollup',
    name: 'performance.rollup',
    summary: 'تجمیع نمونه‌های عملکرد (ساعتی/روزانه)',
    tags: ['performance', 'ops'],
    auth: 'session',
    role: 'pv_app',
    platformPermission: 'platform.job.manage',
    rateLimit: RATE_LIMITS.heavyJob,
    handler: async (request, scope) => {
      const body = validator(request.body);
      const bucket = body.oneOf('bucket', ['hour', 'day'] as const, 'hour');
      body.done();

      const rows = await scope.repos.performance.rollup(bucket, '2 days');
      return { status: 202, body: { rolled_up: rows, bucket } };
    },
  },
];

/* --------------------------------------------------------------- کمکی‌ها */

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
