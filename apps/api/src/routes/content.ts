/**
 * مسیرهای محتوا (گام ۲۱؛ §23–۲۴، §74).
 *
 * نکتهٔ اصلی این فایل، **نبودِ** یک فیلد است: هیچ مسیری `status` نمی‌گیرد.
 * گذر وضعیت فقط از راه `POST …/transition` و تابع دامنه `app.transition_content`
 * انجام می‌شود. اگر کسی بخواهد `status` را با `PATCH` عوض کند، پاسخ
 * `validation_failed` می‌گیرد — چون فیلدش وجود ندارد، نه چون چک شده است.
 */

import { AppError, isUuid } from '@petavu/shared';

import type { RouteDefinition } from '../types.js';
import { validator } from '../validate.js';

const CONTENT_KINDS = ['article', 'guide', 'service', 'faq', 'page', 'news'] as const;

export const contentRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: '/api/v1/businesses/:businessId/content',
    name: 'content.list',
    summary: 'فهرست محتوای کسب‌وکار با صفحه‌بندی نشانگری',
    tags: ['content'],
    auth: 'session',
    role: 'pv_app',
    permission: 'content.update',
    handler: async (request, scope) => {
      const businessId = requireBusiness(request);
      const page = await scope.repos.content.list(businessId, {
        cursor: request.query.get('cursor'),
        limit: clampLimit(request.query.get('limit')),
        kind: request.query.get('kind') ?? undefined,
        status: request.query.get('status') ?? undefined,
      });
      return { body: { items: page.items, next_cursor: page.nextCursor, has_more: page.hasMore } };
    },
  },

  {
    method: 'POST',
    path: '/api/v1/businesses/:businessId/content',
    name: 'content.create',
    summary: 'ساخت محتوا (وضعیت نخست: پیش‌نویس)',
    tags: ['content'],
    auth: 'session',
    role: 'pv_app',
    permission: 'content.create',
    handler: async (request, scope) => {
      const businessId = requireBusiness(request);
      const body = validator(request.body);
      const kind = body.oneOf('kind', CONTENT_KINDS);
      const slug = body.string('slug', { min: 2, max: 72 });
      const title = body.string('title', { min: 2, max: 300 });
      const subtitle = body.optionalString('subtitle', { max: 300 });
      const summary = body.optionalString('summary', { max: 600 });
      const locale = body.optionalString('locale', { max: 12 });
      body.done();

      const content = await scope.repos.content.create(businessId, {
        kind,
        slug,
        title,
        subtitle,
        summary,
        locale: locale ?? 'fa-IR',
      });

      return { status: 201, body: { content } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/businesses/:businessId/content/:contentId',
    name: 'content.get',
    summary: 'نمای یک محتوا با بلوک‌هایش',
    tags: ['content'],
    auth: 'session',
    role: 'pv_app',
    permission: 'content.update',
    handler: async (request, scope) => {
      const contentId = requireUuid(request.params.contentId, 'contentId');
      const content = await scope.repos.content.byId(contentId);
      if (!content) throw new AppError('not_found');
      const blocks = await scope.repos.content.blocks(contentId);
      return { body: { content, blocks } };
    },
  },

  {
    method: 'PATCH',
    path: '/api/v1/businesses/:businessId/content/:contentId',
    name: 'content.update',
    summary: 'ویرایش محتوا با کنترل نسخه (بی هیچ راهی برای تغییر وضعیت)',
    tags: ['content'],
    auth: 'session',
    role: 'pv_app',
    permission: 'content.update',
    handler: async (request, scope) => {
      requireBusiness(request);
      const contentId = requireUuid(request.params.contentId, 'contentId');
      const body = validator(request.body);
      const expectedVersion = body.integer('expected_version', { min: 1 });

      const values: Record<string, unknown> = {};
      for (const field of ['title', 'subtitle', 'summary', 'body_text'] as const) {
        const value = body.optionalString(field, { max: 20000 });
        if (value !== null) values[field] = value;
      }
      const slug = body.optionalString('slug', { min: 2, max: 72 });
      if (slug !== null) values.slug = slug;
      body.done();

      if (Object.keys(values).length === 0) {
        throw new AppError('validation_failed', { details: { reason: 'no_fields' } });
      }

      const content = await scope.repos.content.update(contentId, expectedVersion, values);
      return { status: 200, body: { content } };
    },
  },

  {
    method: 'POST',
    path: '/api/v1/businesses/:businessId/content/:contentId/transition',
    name: 'content.transition',
    summary: 'گذر وضعیت محتوا از راه تابع دامنه',
    tags: ['content'],
    auth: 'session',
    role: 'pv_app',
    handler: async (request, scope) => {
      requireBusiness(request);
      const contentId = requireUuid(request.params.contentId, 'contentId');
      const body = validator(request.body);
      const to = body.string('to', { min: 3, max: 30 });
      const reason = body.optionalString('reason', { max: 400 });
      body.done();

      // مجوز، در خودِ تابع دامنه بر پایهٔ *مقصد* سنجیده می‌شود (§23).
      const content = await scope.repos.content.transition(contentId, to, reason);
      return { status: 200, body: { content } };
    },
  },

  {
    method: 'POST',
    path: '/api/v1/businesses/:businessId/content/:contentId/schedule',
    name: 'content.schedule',
    summary: 'زمان‌بندی انتشار',
    tags: ['content'],
    auth: 'session',
    role: 'pv_app',
    permission: 'content.publish',
    handler: async (request, scope) => {
      requireBusiness(request);
      const contentId = requireUuid(request.params.contentId, 'contentId');
      const body = validator(request.body);
      const publishAt = body.instant('publish_at', { required: true });
      body.done();

      const content = await scope.repos.content.schedule(contentId, publishAt as string);
      return { status: 200, body: { content } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/businesses/:businessId/content/:contentId/blocks',
    name: 'content.blocks',
    summary: 'بلوک‌های محتوا',
    tags: ['content'],
    auth: 'session',
    role: 'pv_app',
    permission: 'content.update',
    handler: async (request, scope) => {
      requireBusiness(request);
      const contentId = requireUuid(request.params.contentId, 'contentId');
      const blocks = await scope.repos.content.blocks(contentId);
      return { body: { blocks } };
    },
  },

  {
    method: 'PUT',
    path: '/api/v1/businesses/:businessId/content/:contentId/blocks',
    name: 'content.replaceBlocks',
    summary: 'جایگزینی کامل بلوک‌ها (اتمی)',
    tags: ['content'],
    auth: 'session',
    role: 'pv_app',
    permission: 'content.update',
    handler: async (request, scope) => {
      requireBusiness(request);
      const contentId = requireUuid(request.params.contentId, 'contentId');
      const body = validator(request.body);
      const raw = body.array<Record<string, unknown>>('blocks', { max: 200 });
      body.done();

      const blocks = raw.map((block, index) => {
        const kind = typeof block.kind === 'string' ? block.kind : '';
        if (kind === '') {
          throw new AppError('validation_failed', { details: { issues: [{ path: `blocks.${index}.kind`, code: 'required' }] } });
        }
        return {
          kind,
          data: (block.data as Record<string, unknown>) ?? {},
          plainText: typeof block.plain_text === 'string' ? block.plain_text : undefined,
        };
      });

      const count = await scope.repos.content.replaceBlocks(contentId, blocks);
      return { status: 200, body: { replaced: count } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/businesses/:businessId/media',
    name: 'content.assets',
    summary: 'فهرست دارایی‌های رسانه‌ای',
    tags: ['media'],
    auth: 'session',
    role: 'pv_app',
    permission: 'content.update',
    handler: async (request, scope) => {
      const businessId = requireBusiness(request);
      const page = await scope.repos.content.assets(businessId, {
        cursor: request.query.get('cursor'),
        limit: clampLimit(request.query.get('limit')),
        kind: request.query.get('kind') ?? undefined,
        onlyPublic: request.query.get('public') === 'true',
      });
      return { body: { assets: page.items, next_cursor: page.nextCursor, has_more: page.hasMore } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/businesses/:businessId/media/:assetId',
    name: 'content.asset',
    summary: 'یک دارایی رسانه‌ای',
    tags: ['media'],
    auth: 'session',
    role: 'pv_app',
    permission: 'content.update',
    handler: async (request, scope) => {
      const businessId = requireBusiness(request);
      const assetId = requireUuid(request.params.assetId, 'assetId');
      const asset = await scope.repos.content.asset(businessId, assetId);
      if (!asset) throw new AppError('not_found');
      return { body: { asset } };
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
  const businessId = requireUuid(request.params.businessId, 'businessId');
  if (request.businessId && request.businessId !== businessId) {
    throw new AppError('forbidden', { details: { reason: 'business_context_mismatch' } });
  }
  return businessId;
}

function clampLimit(raw: string | null): number {
  const value = Number(raw ?? 24);
  if (!Number.isFinite(value)) return 24;
  return Math.max(1, Math.min(100, Math.trunc(value)));
}
