/**
 * مسیرهای کسب‌وکار (گام ۲۱؛ §18–۲۴، §52–۵۵).
 *
 * قاعدهٔ مشترک این فایل: **مسیر فقط ترجمهٔ HTTP است.** تصمیم دامنه در
 * Repository و در تابع دامنه گرفته می‌شود. اگر روزی منطقی اینجا اضافه شود که
 * در دامنه هم هست، دو حقیقت ساخته می‌شود و یکی‌شان عقب می‌ماند.
 */

import { AppError, isUuid, newOpaqueToken } from '@petavu/shared';
import { RATE_LIMITS, hashIdentifier, hashToken } from '@petavu/security';

import type { RouteDefinition } from '../types.js';
import { validator } from '../validate.js';

const BUSINESS_LIST_LIMIT = 24;

export const businessRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: '/api/v1/businesses',
    name: 'business.listMine',
    summary: 'کسب‌وکارهای کاربر جاری',
    tags: ['businesses'],
    auth: 'session',
    role: 'pv_app',
    handler: async (request, scope) => {
      const auth = request.auth;
      if (auth.kind !== 'session') throw new AppError('unauthenticated');
      const businesses = await scope.repos.identity.businessesOf(auth.userId);
      return { body: { businesses } };
    },
  },

  {
    method: 'POST',
    path: '/api/v1/businesses',
    name: 'business.create',
    summary: 'ساخت کسب‌وکار (مالک، همان کاربر جاری)',
    tags: ['businesses'],
    auth: 'session',
    role: 'pv_app',
    handler: async (request, scope) => {
      const body = validator(request.body);
      const name = body.string('name', { min: 2, max: 120 });
      const slug = body.optionalString('slug', { min: 2, max: 72 });
      const businessTypeKey = body.string('business_type_key', { min: 2, max: 60 });
      const industryKey = body.optionalString('industry_key', { max: 60 });
      const nameLatin = body.optionalString('name_latin', { max: 120 });
      body.done();

      const auth = request.auth;
      if (auth.kind !== 'session') throw new AppError('unauthenticated');

      const finalSlug = slug ?? (await suggestSlug(scope, name));
      const business = await scope.repos.business.create({
        slug: finalSlug,
        name,
        businessTypeKey,
        industryKey,
        nameLatin,
        ownerUserId: auth.userId,
      });

      return { status: 201, body: { business } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/businesses/:businessId',
    name: 'business.get',
    summary: 'نمای کسب‌وکار (عمومی برای منتشرشده‌ها)',
    tags: ['businesses'],
    auth: 'any',
    role: 'pv_public',
    handler: async (request, scope) => {
      const businessId = requireUuidParam(request.params.businessId, 'businessId');
      const business = await scope.repos.business.byId(businessId);
      if (!business) throw new AppError('not_found');
      const profile = await scope.repos.business.profile(businessId);
      const completeness = await scope.repos.business.completeness(businessId);
      return { body: { business, profile, completeness } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/businesses/:businessId/overview',
    name: 'business.overview',
    summary: 'نمای کامل کسب‌وکار برای اعضا و کارگزاران کلید',
    tags: ['businesses'],
    /*
     * چرا جدا از `business.get`: آن یکی **نمای عمومی** است و فقط کسب‌وکار
     * منتشرشدهٔ عمومی را می‌دهد (`status='active' and visibility='public'`).
     * اگر همان مسیر را برای اعضا باز می‌کردیم، یا باید سیاست عمومی را شل
     * می‌کردیم (که یعنی نشت پیش‌نویس‌ها) یا مالک، کسب‌وکار خودش را ۴۰۴
     * می‌گرفت. دو مخاطب، دو مسیر، دو سیاست — یک مدل.
     */
    auth: 'authenticated',
    role: 'pv_app',
    permission: 'profile.view',
    handler: async (request, scope) => {
      const businessId = requireBusinessParam(request, scope);
      const business = await scope.repos.business.byId(businessId);
      if (!business) throw new AppError('not_found');
      const profile = await scope.repos.business.profile(businessId);
      const completeness = await scope.repos.business.completeness(businessId);
      return { status: 200, body: { business, profile, completeness } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/businesses/:businessId/team',
    name: 'business.team',
    summary: 'اعضای تیم کسب‌وکار',
    tags: ['businesses', 'team'],
    auth: 'session',
    role: 'pv_app',
    /*
     * کلید مجوز از فهرست بستهٔ `auth.permission` می‌آید، نه از نامی که به
     * «منطقی به‌نظر می‌رسد». `business.members` در آن فهرست نیست (کلید فیچر
     * است، نه مجوز) و همین باعث می‌شد حتی مالک کسب‌وکار هم ۴۰۳ بگیرد. مجوز
     * واقعی «دیدن اعضا» بخشی از مدیریت اعضاست: `business.member.manage`.
     */
    permission: 'business.member.manage',
    handler: async (request, scope) => {
      const businessId = requireBusinessParam(request, scope);
      const members = await scope.repos.business.members(businessId);
      const roles = await scope.repos.business.roles();
      return { body: { members, roles } };
    },
  },

  {
    method: 'POST',
    path: '/api/v1/businesses/:businessId/invitations',
    name: 'business.invite',
    summary: 'دعوت کاربر به کسب‌وکار (توکن یکبارمصرف)',
    tags: ['businesses', 'team'],
    auth: 'session',
    role: 'pv_app',
    permission: 'business.member.invite',
    rateLimit: RATE_LIMITS.invitationAccount,
    handler: async (request, scope) => {
      const businessId = requireBusinessParam(request, scope);
      const body = validator(request.body);
      const invitee = body.string('invitee', { min: 5, max: 190 });
      const kind = body.oneOf('invitee_kind', ['email', 'phone'] as const, 'email');
      const roleKey = body.oneOf('role', ['admin', 'editor', 'marketer', 'member', 'viewer'] as const, 'member');
      const message = body.optionalString('message', { max: 400 });
      body.done();

      // توکن دعوت، همان الگوی توکن نشست: راز در کوکی/ایمیل، درهم در پایگاه‌داده.
      const rawToken = newOpaqueToken(24);
      const invitation = await scope.repos.business.invite({
        businessId,
        roleKey,
        inviteeKind: kind,
        inviteeHash: hashIdentifier(invitee),
        inviteeDisplay: maskInvitee(invitee),
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(scope.services.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        message,
      });

      return {
        status: 201,
        body: {
          invitation,
          token: rawToken,
          note: 'توکن دعوت فقط یک بار نمایش داده می‌شود؛ برای پذیرش لازم است.',
        },
      };
    },
  },

  {
    method: 'POST',
    path: '/api/v1/businesses/:businessId/invitations/:invitationId/accept',
    name: 'business.acceptInvitation',
    summary: 'پذیرش دعوت با توکن',
    tags: ['businesses', 'team'],
    auth: 'session',
    role: 'pv_app',
    handler: async (request, scope) => {
      const invitationId = requireUuidParam(request.params.invitationId, 'invitationId');
      const body = validator(request.body);
      const token = body.string('token', { min: 10, max: 200 });
      body.done();

      const result = await scope.repos.business.acceptInvitation(invitationId, hashToken(token));
      return { status: 200, body: { membership: result } };
    },
  },

  {
    method: 'POST',
    path: '/api/v1/businesses/:businessId/invitations/:invitationId/revoke',
    name: 'business.revokeInvitation',
    summary: 'لغو دعوت‌نامه',
    tags: ['businesses', 'team'],
    auth: 'session',
    role: 'pv_app',
    permission: 'business.member.manage',
    handler: async (request, scope) => {
      const invitationId = requireUuidParam(request.params.invitationId, 'invitationId');
      const body = validator(request.body);
      const reason = body.optionalString('reason', { max: 200 });
      body.done();

      const result = await scope.repos.business.revokeInvitation(invitationId, reason);
      return { status: 200, body: { invitation: result } };
    },
  },

  {
    method: 'PATCH',
    path: '/api/v1/businesses/:businessId',
    name: 'business.update',
    summary: 'ویرایش هستهٔ کسب‌وکار با کنترل نسخه',
    tags: ['businesses'],
    auth: 'session',
    role: 'pv_app',
    permission: 'business.update',
    handler: async (request, scope) => {
      const businessId = requireBusinessParam(request, scope);
      const body = validator(request.body);
      const expectedVersion = body.integer('expected_version', { min: 1 });
      const values: Record<string, unknown> = {};
      const name = body.optionalString('name', { min: 2, max: 120 });
      if (name !== null) values.name = name;
      const nameLatin = body.optionalString('name_latin', { max: 120 });
      if (nameLatin !== null) values.name_latin = nameLatin;
      const industryKey = body.optionalString('industry_key', { max: 60 });
      if (industryKey !== null) values.industry_key = industryKey;
      const visibility = body.optionalString('visibility', { max: 20 });
      if (visibility !== null) values.visibility = visibility;
      body.done();

      if (Object.keys(values).length === 0) {
        throw new AppError('validation_failed', { details: { reason: 'no_fields' } });
      }

      const business = await scope.repos.business.update(businessId, expectedVersion, values);
      return { status: 200, body: { business } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/businesses/:businessId/profile',
    name: 'business.profile',
    summary: 'پروفایل عمومی کسب‌وکار',
    tags: ['businesses'],
    auth: 'any',
    role: 'pv_public',
    handler: async (request, scope) => {
      const businessId = requireUuidParam(request.params.businessId, 'businessId');
      const profile = await scope.repos.business.profile(businessId);
      if (!profile) throw new AppError('not_found', { details: { reason: 'profile_missing' } });
      return { body: { profile } };
    },
  },

  {
    method: 'PUT',
    path: '/api/v1/businesses/:businessId/profile',
    name: 'business.upsertProfile',
    summary: 'به‌روزرسانی پروفایل کسب‌وکار',
    tags: ['businesses'],
    auth: 'session',
    role: 'pv_app',
    permission: 'business.update',
    handler: async (request, scope) => {
      const businessId = requireBusinessParam(request, scope);
      const body = validator(request.body);
      const values: Record<string, unknown> = {};
      for (const field of ['tagline', 'summary', 'description'] as const) {
        const value = body.optionalString(field, { max: 4000 });
        if (value !== null) values[field] = value;
      }
      const foundedYear = body.optionalInteger('founded_year', { min: 1500, max: 2200 });
      if (foundedYear !== null) values.founded_year = foundedYear;
      const employeeRange = body.optionalString('employee_range', { max: 40 });
      if (employeeRange !== null) values.employee_range = employeeRange;
      const links = body.optionalObject('links');
      if (links !== null) values.links = links;
      const attributes = body.optionalObject('attributes');
      if (attributes !== null) values.attributes = attributes;
      const keywords = body.array<string>('keywords', { max: 30 });
      if (keywords.length > 0) values.keywords = keywords;
      body.done();

      const profile = await scope.repos.business.upsertProfile(businessId, values);
      return { status: 200, body: { profile } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/businesses/:businessId/relationships',
    name: 'business.relationships',
    summary: 'رابط گراف کسب‌وکار',
    tags: ['businesses'],
    auth: 'any',
    role: 'pv_public',
    handler: async (request, scope) => {
      const businessId = requireUuidParam(request.params.businessId, 'businessId');
      const relationships = await scope.repos.business.relationships(businessId);
      return { body: { relationships } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/businesses/:businessId/completeness',
    name: 'business.completeness',
    summary: 'درصد کامل‌بودن پروفایل',
    tags: ['businesses'],
    auth: 'session',
    role: 'pv_app',
    // دیدن کامل‌بودن پروفایل، مجوز دیدن پروفایل می‌خواهد، نه مدیریت اعضا.
    permission: 'profile.view',
    handler: async (request, scope) => {
      const businessId = requireBusinessParam(request, scope);
      const score = await scope.repos.business.completeness(businessId);
      return { body: { completeness: score } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/businesses/slug/:slug',
    name: 'business.bySlug',
    summary: 'یافتن کسب‌وکار با نامک',
    tags: ['businesses'],
    auth: 'public',
    role: 'pv_public',
    handler: async (request, scope) => {
      const slug = String(request.params.slug ?? '');
      if (slug === '') throw new AppError('validation_failed', { details: { issues: [{ path: 'slug', code: 'required' }] } });
      const business = await scope.repos.business.bySlug(slug);
      if (!business) throw new AppError('not_found');
      return { body: { business } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/businesses/directory',
    name: 'business.directory',
    summary: 'فهرست عمومی کسب‌وکارها با صفحه‌بندی نشانگری',
    tags: ['businesses'],
    auth: 'public',
    role: 'pv_public',
    rateLimit: RATE_LIMITS.publicRead,
    handler: async (request, scope) => {
      const limit = clampLimit(request.query.get('limit'));
      const page = await scope.repos.business.list({
        limit,
        cursor: request.query.get('cursor'),
        businessTypeKey: request.query.get('type') ?? undefined,
        industryKey: request.query.get('industry') ?? undefined,
        // فهرست عمومی، فقط عمومی‌ها: فیلتر وضعیت، کار RLS را تکرار نمی‌کند —
        // آن ایزوله‌سازی است، این انتخاب نمایشی (§54).
        onlyPublic: true,
      });

      return { body: { businesses: page.items, next_cursor: page.nextCursor, has_more: page.hasMore } };
    },
  },
];

/* --------------------------------------------------------------- کمکی‌ها */

function requireUuidParam(value: string | undefined, field: string): string {
  if (!value || !isUuid(value)) {
    throw new AppError('validation_failed', { details: { issues: [{ path: field, code: 'expected_uuid' }] } });
  }
  return value;
}

/**
 * کسب‌وکار مؤثر درخواست.
 *
 * اگر هدر `x-business-id` با کسب‌وکار مسیر نخواند، رد می‌کنیم: بی‌آن، کاربری
 * که در دو کسب‌وکار عضو است می‌تواند دادهٔ یکی را با زمینهٔ دیگری بنویسد و
 * سیستم «موفق» گزارش دهد.
 */
function requireBusinessParam(
  request: { readonly params: Readonly<Record<string, string>>; readonly businessId: string | null },
  scope: { readonly context: { readonly businessId?: string | null } },
): string {
  const businessId = requireUuidParam(request.params.businessId, 'businessId');
  const effective = request.businessId ?? scope.context.businessId ?? null;
  if (effective && effective !== businessId) {
    throw new AppError('forbidden', { details: { reason: 'business_context_mismatch' } });
  }
  return businessId;
}

async function suggestSlug(scope: { repos: { business: { suggestSlug: (name: string) => Promise<string> } } }, name: string): Promise<string> {
  return scope.repos.business.suggestSlug(name);
}

function clampLimit(raw: string | null): number {
  const value = Number(raw ?? BUSINESS_LIST_LIMIT);
  if (!Number.isFinite(value)) return BUSINESS_LIST_LIMIT;
  return Math.max(1, Math.min(100, Math.trunc(value)));
}

/** نمایش پرده‌دار شناسهٔ دعوت‌شده: در پاسخ API، ایمیل کامل نمی‌آید. */
function maskInvitee(value: string): string {
  const [local, domain] = value.split('@');
  if (!domain) return `${value.slice(0, 3)}***`;
  const head = (local ?? '').slice(0, 2);
  return `${head}***@${domain}`;
}
