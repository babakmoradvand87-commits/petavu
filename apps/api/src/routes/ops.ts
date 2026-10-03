/**
 * مسیرهای عملیات و پنل مدیریت (گام ۲۱؛ §28، §93–۹۹، §146–۱۵۱).
 *
 * همهٔ مسیرهای این فایل با **مجوز پلتفرمی** محافظت می‌شوند، نه عضویت. تفاوت
 * عملی است: عضویت کسب‌وکاری، دسترسی به دادهٔ خودِ کسب‌وکار می‌دهد؛ مجوز
 * پلتفرمی، دسترسی به *سیستم*. هر مسیری که دومی را لازم دارد، در OpenAPI هم
 * صریح علامت می‌خورد تا در بازبینی امنیتی دیده شود.
 */

import { AppError, isUuid } from '@petavu/shared';
import { RATE_LIMITS } from '@petavu/security';

import type { RouteDefinition } from '../types.js';
import { validator } from '../validate.js';

export const opsRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: '/api/v1/ops/features',
    name: 'ops.features',
    summary: 'رجیستری فیچر با وضعیت چرخهٔ عمر',
    tags: ['ops'],
    auth: 'session',
    role: 'pv_app',
    platformPermission: 'platform.feature.manage',
    handler: async (request, scope) => {
      const status = request.query.get('status') ?? undefined;
      const layer = request.query.get('layer') ?? undefined;
      const features = await scope.repos.ops.features({ status, layer });
      return { body: { features } };
    },
  },

  {
    method: 'POST',
    path: '/api/v1/ops/features/:key/transition',
    name: 'ops.transitionFeature',
    summary: 'گذر وضعیت فیچر با سنجش موانع',
    tags: ['ops'],
    auth: 'session',
    role: 'pv_app',
    platformPermission: 'platform.feature.manage',
    handler: async (request, scope) => {
      const key = String(request.params.key ?? '');
      const body = validator(request.body);
      const to = body.string('to', { min: 3, max: 30 });
      const note = body.optionalString('note', { max: 400 });
      body.done();

      // موانع برداشتن فیچر، پیش از گذر گزارش می‌شوند: پاسخ باید بگوید «چرا نه».
      const blockers = await scope.repos.ops.featureRemovalBlockers(key);
      if (to === 'archived' && blockers.length > 0) {
        throw new AppError('precondition_failed', {
          message: 'این فیچر هنوز وابستگی فعال دارد.',
          details: { reason: 'feature_blocked', blockers },
        });
      }

      const feature = await scope.repos.ops.transitionFeature(key, to, note);
      return { status: 200, body: { feature } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/ops/features/cycles',
    name: 'ops.featureCycles',
    summary: 'چرخه‌های وابستگی فیچرها',
    tags: ['ops'],
    auth: 'session',
    role: 'pv_app',
    platformPermission: 'platform.feature.manage',
    handler: async (_request, scope) => ({ body: { cycles: await scope.repos.ops.featureCycles() } }),
  },

  {
    method: 'GET',
    path: '/api/v1/ops/jobs/health',
    name: 'ops.jobsHealth',
    summary: 'سلامت صف: در انتظار، در جریان، شکست‌خورده',
    tags: ['ops'],
    auth: 'session',
    role: 'pv_app',
    platformPermission: 'platform.job.observe',
    handler: async (request, scope) => {
      void request;
      const health = await scope.repos.ops.jobHealth();
      return { body: { health } };
    },
  },

  {
    method: 'POST',
    path: '/api/v1/ops/jobs',
    name: 'ops.enqueueJob',
    summary: 'درج کار در صف (از راه تابع دامنه)',
    tags: ['ops'],
    auth: 'session',
    role: 'pv_app',
    platformPermission: 'platform.job.manage',
    rateLimit: RATE_LIMITS.heavyJob,
    handler: async (request, scope) => {
      const body = validator(request.body);
      const kind = body.string('kind', { min: 3, max: 60 });
      const payload = body.optionalObject('payload') ?? {};
      const priority = body.optionalInteger('priority', { min: 1, max: 9 }) ?? 5;
      const runAt = body.instant('run_at');
      const dedupeKey = body.optionalString('dedupe_key', { max: 120 });
      body.done();

      const job = await scope.repos.ops.enqueue({ kind, payload, priority, runAt, dedupeKey });
      return { status: 202, body: { job } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/ops/security/events',
    name: 'ops.securityEvents',
    summary: 'رخدادهای امنیتی',
    tags: ['ops', 'security'],
    auth: 'session',
    role: 'pv_app',
    platformPermission: 'platform.security.manage',
    handler: async (request, scope) => {
      const events = await scope.repos.ops.securityEvents({
        limit: Number(request.query.get('limit') ?? 50),
        severity: request.query.get('severity') ?? undefined,
        openOnly: request.query.get('open') === 'true',
      });
      return { body: { events } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/ops/backups/unverified',
    name: 'ops.unverifiedBackups',
    summary: 'پشتیبان‌هایی که آزمون بازیابی‌شان تأیید نشده',
    tags: ['ops', 'backup'],
    auth: 'session',
    role: 'pv_app',
    platformPermission: 'platform.backup.manage',
    handler: async (request, scope) => {
      const graceHours = Number(request.query.get('grace_hours') ?? 48);
      const backups = await scope.repos.ops.unverifiedBackups(Number.isFinite(graceHours) ? graceHours : 48);
      return { body: { backups } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/ops/retention/due',
    name: 'ops.retentionDue',
    summary: 'سیاست‌های نگهداشت سررسیدشده',
    tags: ['ops'],
    auth: 'session',
    role: 'pv_app',
    platformPermission: 'platform.settings.manage',
    handler: async (request, scope) => {
      void request;
      const due = await scope.repos.ops.retentionDue(50);
      return { body: { due } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/ops/settings',
    name: 'ops.settings',
    summary: 'تنظیمات سیستم (رازها پرده‌دار)',
    tags: ['ops'],
    auth: 'session',
    role: 'pv_app',
    platformPermission: 'platform.settings.manage',
    handler: async (request, scope) => {
      const settings = await scope.repos.ops.settings(request.businessId);
      return {
        body: {
          settings: settings.map((row) => ({
            ...row,
            // راز، هرگز بیرون نمی‌آید — نه مقدار، نه هش. فقط «هست».
            value: (row as { is_secret?: boolean }).is_secret === true ? '•••' : (row as { value: unknown }).value,
          })),
        },
      };
    },
  },

  {
    method: 'PUT',
    path: '/api/v1/ops/settings/:key',
    name: 'ops.setSetting',
    summary: 'ثبت تنظیم سیستم',
    tags: ['ops'],
    auth: 'session',
    role: 'pv_app',
    platformPermission: 'platform.settings.manage',
    handler: async (request, scope) => {
      const key = String(request.params.key ?? '');
      const body = validator(request.body);
      const value = body.raw('value');
      const description = body.optionalString('description', { max: 300 });
      body.done();

      if (value === undefined) {
        throw new AppError('validation_failed', { details: { issues: [{ path: 'value', code: 'required' }] } });
      }

      const setting = await scope.repos.ops.setSetting({ key, value, businessId: request.businessId ?? null, description });
      return { status: 200, body: { setting } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/ops/notifications',
    name: 'ops.notifications',
    summary: 'اعلان‌های کاربر جاری',
    tags: ['ops', 'notifications'],
    auth: 'session',
    role: 'pv_app',
    handler: async (request, scope) => {
      const notifications = await scope.repos.ops.notifications({
        unreadOnly: request.query.get('unread') === 'true',
        limit: Number(request.query.get('limit') ?? 30),
      });
      const unread = await scope.repos.ops.unreadNotificationCount();
      return { body: { notifications, unread } };
    },
  },

  {
    method: 'POST',
    path: '/api/v1/ops/notifications/:notificationId/read',
    name: 'ops.markNotificationRead',
    summary: 'علامت‌گذاری اعلان به‌عنوان خوانده‌شده',
    tags: ['ops', 'notifications'],
    auth: 'session',
    role: 'pv_app',
    handler: async (request, scope) => {
      const notificationId = String(request.params.notificationId ?? '');
      if (!isUuid(notificationId)) {
        throw new AppError('validation_failed', { details: { issues: [{ path: 'notificationId', code: 'expected_uuid' }] } });
      }
      const affected = await scope.repos.ops.markNotificationRead(notificationId);
      return { status: 200, body: { updated: affected } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/ops/performance/health',
    name: 'ops.performanceHealth',
    summary: 'سلامت عملکرد: صف‌های کند، پس‌رفت‌های باز',
    tags: ['ops', 'performance'],
    auth: 'session',
    role: 'pv_app',
    platformPermission: 'platform.job.observe',
    handler: async (request, scope) => {
      const window = request.query.get('window') ?? '24 hours';
      const health = await scope.repos.ops.performanceHealth(window);
      const regressions = await scope.repos.ops.openRegressions(50);
      return { body: { health, regressions } };
    },
  },

  {
    method: 'POST',
    path: '/api/v1/public/security-events',
    name: 'ops.reportSecurityEvent',
    summary: 'ثبت رخداد امنیتی از سمت مرورگر (CSP، دستکاری)',
    tags: ['ops', 'security'],
    auth: 'public',
    role: 'pv_public',
    rateLimit: RATE_LIMITS.publicForm,
    originCheck: true,
    handler: async (request, scope) => {
      const body = validator(request.body);
      const kind = body.string('kind', { min: 3, max: 60 });
      /*
       * واژگان مرورگر با واژگان پایگاه‌داده یکی نیست، و بهتر است یکی نباشد:
       * مرورگر سه سطح می‌فهمد (`info | warning | critical`)، ولی
       * `ops.security_event.severity` پنج سطح دارد. نگاشت صریح اینجا انجام
       * می‌شود. اگر «warning» خام می‌رفت، قید جدول آن را رد می‌کرد و رخدادی
       * که مرورگر خبر داده بود، با خطای «ورودی نامعتبر» گم می‌شد — و دقیقاً
       * همین اتفاق در آزمون واقعی افتاد.
       */
      const browserSeverity = body.oneOf('severity', ['info', 'warning', 'critical'] as const, 'info');
      const severity = browserSeverity === 'critical' ? 'critical' : browserSeverity === 'warning' ? 'medium' : 'info';
      const details = body.optionalObject('details') ?? {};
      body.done();

      /*
       * رخداد سمت مرورگر، «ادعا» است نه «حقیقت». پس فقط ثبت می‌شود و همان
       * لحظه تصمیم امنیتی از آن گرفته نمی‌شود (§99: رخداد، مبنای تصمیم نیست).
       */
      const recorded = await scope.repos.ops.recordSecurityEvent({
        kind: `client.${kind}`,
        severity,
        ip: request.ip,
        details,
      });

      return { status: 202, body: { recorded } };
    },
  },
];
