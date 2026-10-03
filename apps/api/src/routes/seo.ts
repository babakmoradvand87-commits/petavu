/**
 * مسیرهای سئو (گام ۲۱؛ Addendum §39–۴۷، §96).
 *
 * سئو در این معماری «داده» است، نه «تنظیم». پس هر مسیر این فایل، یک ردیف داده
 * را می‌خواند یا می‌نویسد، و هیچ‌کدام HTML نمی‌سازد — ساختن هد، کار
 * `@petavu/seo` در لایهٔ وب است. تفکیک عمدی است: داده در یک جا، رندر در
 * جای دیگر، و هر دو از یک منبع.
 */

import { AppError, isUuid } from '@petavu/shared';

import type { RouteDefinition } from '../types.js';
import { validator } from '../validate.js';

export const seoRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: '/api/v1/businesses/:businessId/seo/settings',
    name: 'seo.settings',
    summary: 'تنظیمات سئوی کسب‌وکار',
    tags: ['seo'],
    auth: 'session',
    role: 'pv_app',
    permission: 'seo.manage',
    handler: async (request, scope) => {
      const businessId = requireBusiness(request);
      const settings = await scope.repos.seo.settings(businessId);
      const templates = await scope.repos.seo.templates(businessId);
      return { body: { settings, templates } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/businesses/:businessId/seo/metadata/:entityKind/:entityId',
    name: 'seo.metadata',
    summary: 'فرادادهٔ سئوی یک موجودیت',
    tags: ['seo'],
    auth: 'session',
    role: 'pv_app',
    permission: 'seo.manage',
    handler: async (request, scope) => {
      requireBusiness(request);
      const entityKind = String(request.params.entityKind ?? '');
      const entityId = requireUuid(request.params.entityId, 'entityId');
      const locale = request.query.get('locale') ?? 'fa-IR';
      const metadata = await scope.repos.seo.metadata(entityKind, entityId, locale);
      return { body: { metadata } };
    },
  },

  {
    method: 'PUT',
    path: '/api/v1/businesses/:businessId/seo/metadata/:entityKind/:entityId',
    name: 'seo.upsertMetadata',
    summary: 'ثبت/به‌روزرسانی فرادادهٔ سئو از راه تابع دامنه',
    tags: ['seo'],
    auth: 'session',
    role: 'pv_app',
    permission: 'seo.manage',
    handler: async (request, scope) => {
      const businessId = requireBusiness(request);
      const entityKind = String(request.params.entityKind ?? '');
      const entityId = requireUuid(request.params.entityId, 'entityId');

      const body = validator(request.body);
      const locale = body.optionalString('locale', { max: 12 }) ?? 'fa-IR';
      const title = body.optionalString('title', { min: 3, max: 300 });
      const description = body.optionalString('description', { max: 400 });
      const canonicalUrl = body.optionalString('canonical_url', { max: 500 });
      const robots = body.optionalString('robots_directives', { max: 200 });
      const isManual = body.boolean('is_manual', true);
      const sourceHash = body.optionalString('source_hash', { max: 64 });
      body.done();

      const values: Record<string, unknown> = {};
      if (title !== null) values.title = title;
      if (description !== null) values.description = description;
      if (canonicalUrl !== null) values.canonical_url = canonicalUrl;
      if (robots !== null) values.robots_directives = robots;
      values.is_manual = isManual;

      if (Object.keys(values).length === 1) {
        throw new AppError('validation_failed', { details: { reason: 'no_fields' } });
      }

      const metadata = await scope.repos.seo.upsertMetadata({
        entityKind,
        entityId,
        locale,
        values,
        sourceHash,
        businessId,
      });

      return { status: 200, body: { metadata } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/businesses/:businessId/seo/redirects',
    name: 'seo.redirects',
    summary: 'فهرست تغییر مسیرها',
    tags: ['seo'],
    auth: 'session',
    role: 'pv_app',
    permission: 'seo.manage',
    handler: async (request, scope) => {
      const businessId = requireBusiness(request);
      const redirects = await scope.repos.seo.redirects(businessId, {
        cursor: request.query.get('cursor'),
        limit: Number(request.query.get('limit') ?? 50),
      });
      return { body: { redirects } };
    },
  },

  {
    method: 'POST',
    path: '/api/v1/businesses/:businessId/seo/redirects',
    name: 'seo.createRedirect',
    summary: 'ثبت تغییر مسیر با تشخیص حلقه',
    tags: ['seo'],
    auth: 'session',
    role: 'pv_app',
    permission: 'seo.redirect.manage',
    handler: async (request, scope) => {
      const businessId = requireBusiness(request);
      const body = validator(request.body);
      const sourcePath = body.string('source_path', { min: 1, max: 300 });
      const targetPath = body.string('target_path', { min: 1, max: 300 });
      // ۳۰۱ (دائمی) و ۳۰۸ (دائمی، حفظ متد) و ۳۰۲/۳۰۷ (موقت): چهار کد مجاز، نه هر عددی.
      const statusCode = body.oneOfNumber('status_code', [301, 302, 307, 308], 301);
      const reason = body.optionalString('reason', { max: 300 });
      body.done();

      const redirect = await scope.repos.seo.createRedirect({
        businessId,
        sourcePath,
        targetPath,
        statusCode: statusCode as 301 | 302 | 307 | 308,
        reason,
      });

      return { status: 201, body: { redirect } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/businesses/:businessId/seo/sitemaps',
    name: 'seo.sitemaps',
    summary: 'سایتمپ‌های ثبت‌شده',
    tags: ['seo'],
    auth: 'session',
    role: 'pv_app',
    permission: 'seo.manage',
    handler: async (request, scope) => {
      const businessId = requireBusiness(request);
      const sitemaps = await scope.repos.seo.sitemaps(businessId);
      return { body: { sitemaps } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/businesses/:businessId/seo/audit',
    name: 'seo.latestAudit',
    summary: 'آخرین بازرسی سئو با یافته‌ها',
    tags: ['seo'],
    auth: 'session',
    role: 'pv_app',
    permission: 'seo.manage',
    handler: async (request, scope) => {
      const businessId = requireBusiness(request);
      const audit = await scope.repos.seo.latestAudit(businessId);
      return { body: { audit } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/businesses/:businessId/seo/opportunities',
    name: 'seo.opportunities',
    summary: 'فرصت‌های محتوایی باز',
    tags: ['seo'],
    auth: 'session',
    role: 'pv_app',
    permission: 'seo.manage',
    handler: async (request, scope) => {
      const businessId = requireBusiness(request);
      const opportunities = await scope.repos.seo.openOpportunities(businessId, 50);
      return { body: { opportunities } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/businesses/:businessId/seo/indexing-events',
    name: 'seo.indexingEvents',
    summary: 'رخدادهای ایندکس در انتظار ارسال',
    tags: ['seo'],
    auth: 'session',
    role: 'pv_app',
    permission: 'seo.manage',
    handler: async (request, scope) => {
      requireBusiness(request);
      const events = await scope.repos.seo.pendingIndexingEvents(100);
      return { body: { events, indexing_enabled: await scope.repos.seo.indexingEnabled() } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/seo/templates',
    name: 'seo.templates',
    summary: 'قالب‌های سئو (سراسری و کسب‌وکار)',
    tags: ['seo'],
    auth: 'any',
    role: 'pv_public',
    handler: async (request, scope) => {
      const templates = await scope.repos.seo.templates(request.businessId);
      return { body: { templates } };
    },
  },

  {
    method: 'POST',
    path: '/api/v1/seo/templates/preview',
    name: 'seo.templatePreview',
    summary: 'پیش‌نمایش رندر قالب با مقادیر نمونه',
    tags: ['seo'],
    auth: 'session',
    role: 'pv_app',
    permission: 'seo.manage',
    handler: async (request, scope) => {
      const body = validator(request.body);
      const entityKind = body.string('entity_kind', { min: 3, max: 40 });
      const subtype = body.optionalString('subtype', { max: 60 });
      const values = body.object('values');
      body.done();

      // رندر، در `@petavu/seo` است؛ اینجا فقط سیم‌کشی HTTP انجام می‌شود.
      const template = await scope.repos.seo.pickTemplate(entityKind, subtype, request.businessId);
      if (!template) throw new AppError('not_found', { details: { reason: 'template_not_found' } });

      const rendered = await scope.repos.seo.templatePreview(entityKind, values as Record<string, string>);
      // پیش‌نمایش چیزی نمی‌سازد؛ پس ۲۰۰ می‌دهد، نه ۲۰۱. کد وضعیت باید
      // بگوید «چه اتفاقی افتاد»، نه «چه متدی بود» (§65).
      return { status: 200, body: { template, rendered } };
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
