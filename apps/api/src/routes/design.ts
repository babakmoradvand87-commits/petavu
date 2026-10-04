/**
 * مسیرهای استودیوی طراحی (گام ۲۱؛ §32–۴۴، Addendum §96–۱۰۰).
 *
 * خط لولهٔ انتشار، اینجا «فقط چند اندپوینت» نیست: هر نوشتن، سه دروازه را از
 * همان ابتدا رد می‌کند — اعتبارسنجی درخت (در `design.saveDraft`)، مجوز
 * (`design.manage`)، و در انتشار، دروازهٔ عملکرد (`performance.publishGate`).
 * آنچه این لایه اضافه می‌کند، **ترتیب** است: پیش‌نویس آزاد است، انتشار نه.
 */

import { AppError, isUuid, newOpaqueToken } from '@petavu/shared';
import { RATE_LIMITS, hashToken } from '@petavu/security';

import type { RouteDefinition } from '../types.js';
import { validator } from '../validate.js';

export const designRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: '/api/v1/businesses/:businessId/pages',
    name: 'design.pages',
    summary: 'صفحه‌های طراحی کسب‌وکار',
    tags: ['design'],
    auth: 'session',
    role: 'pv_app',
    permission: 'design.manage',
    handler: async (request, scope) => {
      const businessId = requireBusiness(request);
      const pages = await scope.repos.design.pages(businessId);
      return { body: { pages } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/businesses/:businessId/pages/:pageKey',
    name: 'design.page',
    summary: 'یک صفحه با درخت منتشرشده و پیش‌نویس',
    tags: ['design'],
    auth: 'session',
    role: 'pv_app',
    permission: 'design.manage',
    handler: async (request, scope) => {
      const businessId = requireBusiness(request);
      const pageKey = String(request.params.pageKey ?? '');
      const page = await scope.repos.design.pageByKey(businessId, pageKey);
      if (!page) throw new AppError('not_found', { details: { reason: 'page_not_found' } });
      const revisions = await scope.repos.design.revisions(String((page as { id: string }).id), 10);
      return { body: { page, revisions } };
    },
  },

  {
    method: 'PUT',
    path: '/api/v1/businesses/:businessId/pages/:pageKey/draft',
    name: 'design.saveDraft',
    summary: 'ذخیرهٔ پیش‌نویس درخت صفحه (اعتبارسنجی‌شده در پایگاه‌داده)',
    tags: ['design'],
    auth: 'session',
    role: 'pv_app',
    permission: 'design.manage',
    rateLimit: RATE_LIMITS.heavyJob,
    handler: async (request, scope) => {
      const businessId = requireBusiness(request);
      const pageKey = String(request.params.pageKey ?? '');
      const page = await scope.repos.design.pageByKey(businessId, pageKey);
      if (!page) throw new AppError('not_found', { details: { reason: 'page_not_found' } });

      const body = validator(request.body);
      const expectedVersion = body.integer('expected_version', { min: 1 });
      const tree = body.raw('tree');
      const changeSummary = body.optionalString('change_summary', { max: 300 });
      body.done();

      if (tree === undefined || tree === null) {
        throw new AppError('validation_failed', { details: { issues: [{ path: 'tree', code: 'required' }] } });
      }

      /*
       * اعتبارسنجی درخت در پایگاه‌داده انجام می‌شود (`design.validate_tree`)،
       * پس اینجا فقط شکلِ سطح بالا سنجیده می‌شود: درخت، شیء JSON است، نه
       * رشتهٔ HTML یا کد. §74 می‌گوید هیچ درختی نمی‌تواند کد اجرا کند.
       */
      if (typeof tree !== 'object') {
        throw new AppError('validation_failed', { details: { issues: [{ path: 'tree', code: 'expected_object' }] } });
      }

      const draft = await scope.repos.design.saveDraft(String((page as { id: string }).id), tree, changeSummary, expectedVersion);
      return { status: 200, body: { draft } };
    },
  },

  {
    method: 'POST',
    path: '/api/v1/businesses/:businessId/pages/:pageKey/publish',
    name: 'design.publish',
    summary: 'انتشار پیش‌نویس (پس از دروازهٔ عملکرد)',
    tags: ['design'],
    auth: 'session',
    role: 'pv_app',
    permission: 'design.publish',
    handler: async (request, scope) => {
      const businessId = requireBusiness(request);
      const pageKey = String(request.params.pageKey ?? '');
      const page = await scope.repos.design.pageByKey(businessId, pageKey);
      if (!page) throw new AppError('not_found', { details: { reason: 'page_not_found' } });

      const body = validator(request.body);
      const note = body.optionalString('note', { max: 300 });
      body.done();

      const gate = await scope.repos.performance.publishGate(businessId);
      const verdict = readGateVerdict(gate);

      if (verdict === 'block') {
        throw new AppError('precondition_failed', {
          message: 'دروازهٔ انتشار فعلاً اجازه نمی‌دهد.',
          details: { reason: 'publish_gate_blocked', gate },
        });
      }

      const published = await scope.repos.design.publish(String((page as { id: string }).id), note);
      return { status: 200, body: { page: published, gate } };
    },
  },

  {
    method: 'POST',
    path: '/api/v1/businesses/:businessId/pages/:pageKey/restore',
    name: 'design.restore',
    summary: 'بازگردانی نسخهٔ پیشین به‌عنوان پیش‌نویس',
    tags: ['design'],
    auth: 'session',
    role: 'pv_app',
    permission: 'design.manage',
    handler: async (request, scope) => {
      const businessId = requireBusiness(request);
      const pageKey = String(request.params.pageKey ?? '');
      const page = await scope.repos.design.pageByKey(businessId, pageKey);
      if (!page) throw new AppError('not_found', { details: { reason: 'page_not_found' } });

      const body = validator(request.body);
      const revision = body.integer('revision', { min: 1 });
      body.done();

      // بازگردانی، پیش‌نویس می‌سازد — نه انتشار. انتشار همیشه تصمیم جداگانه است.
      const restored = await scope.repos.design.restoreRevision(String((page as { id: string }).id), revision);
      return { status: 200, body: { draft: restored } };
    },
  },

  {
    method: 'POST',
    path: '/api/v1/businesses/:businessId/pages/:pageKey/preview',
    name: 'design.previewLink',
    summary: 'ساخت پیوند پیش‌نمایش یک‌بارمصرف',
    tags: ['design'],
    auth: 'session',
    role: 'pv_app',
    permission: 'design.manage',
    handler: async (request, scope) => {
      const businessId = requireBusiness(request);
      const pageKey = String(request.params.pageKey ?? '');
      const page = await scope.repos.design.pageByKey(businessId, pageKey);
      if (!page) throw new AppError('not_found', { details: { reason: 'page_not_found' } });

      const body = validator(request.body);
      const audience = body.optionalString('audience', { max: 60 });
      const ttlMinutes = body.optionalInteger('ttl_minutes', { min: 5, max: 10080 }) ?? 60;
      body.done();

      const token = newOpaqueToken(24);
      const link = await scope.repos.design.createPreviewLink(String((page as { id: string }).id), {
        tokenHash: hashToken(token),
        expiresAt: new Date(scope.services.now() + ttlMinutes * 60_000).toISOString(),
        audience: audience ?? 'internal',
      });

      return { status: 201, body: { link, token, note: 'توکن پیش‌نمایش فقط یک بار نمایش داده می‌شود.' } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/design/tokens',
    name: 'design.tokens',
    summary: 'توکن‌های طراحی (منبع حقیقت ظاهر)',
    tags: ['design'],
    auth: 'any',
    role: 'pv_public',
    handler: async (request, scope) => {
      const themeMode = request.query.get('mode') ?? undefined;
      const tokens = await scope.repos.design.tokens({ businessId: request.businessId, themeMode });
      return { body: { tokens } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/design/components',
    name: 'design.components',
    summary: 'رجیستری کامپوننت‌ها',
    tags: ['design'],
    auth: 'any',
    role: 'pv_public',
    handler: async (request, scope) => {
      const status = request.query.get('status') ?? 'active';
      const components = await scope.repos.design.components({ status });
      return { body: { components } };
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

/**
 * خواندن حکم دروازهٔ انتشار.
 *
 * `publish_gate` یک ردیف jsonb برمی‌گرداند که شکلش ممکن است بین نسخه‌ها
 * تغییر کند؛ پس اینجا **بدبینانه** خوانده می‌شود: هر چیزی جز «اجازه» یعنی
 * «نه». این جهتِ خطا عمدی است: گلوگاهِ اشتباه بهتر از انتشارِ اشتباه است.
 */
function readGateVerdict(gate: unknown): 'allow' | 'block' {
  if (gate === null || typeof gate !== 'object') return 'block';
  const record = gate as Record<string, unknown>;
  const candidate = record.verdict ?? record.status ?? record.result;
  return candidate === 'pass' || candidate === 'allow' || candidate === true ? 'allow' : 'block';
}
