/**
 * مسیرهای احراز هویت (گام ۲۱؛ §7–۱۳).
 *
 * این فایل، مرز اعتماد سیستم است. هر تصمیم امنیتی‌اش صریح است:
 *
 *   • **پیام ورود نادرست، یکسان است** — چه کاربر وجود داشته باشد، چه نه، چه
 *     رمز غلط باشد. بررسی ساختگی هم اجرا می‌شود تا *زمان پاسخ* هم یکسان
 *     بماند؛ وگرنه فهرست کاربران از تفاوت زمان لو می‌رود (§13).
 *   • **کوکی نشست، `HttpOnly` و بی‌دامنه** است تا روی `panel.petavu.ir` پخش
 *     نشود (§9). نام‌ها در `cookies.ts` یک‌جا تعیین می‌شوند.
 *   • **توکن CSRF جدا از نشست** صادر می‌شود و به `session_id` گره می‌خورد؛
 *     توکنِ نشست دیگر، بی‌ارزش است (§12).
 *   • **کلید API یک‌بار نشان داده می‌شود.** در پایگاه‌داده فقط هش می‌نشیند.
 */

import { AppError, errorPayload, isUuid, newOpaqueToken, uuidv7 } from '@petavu/shared';
import {
  RATE_LIMITS,
  checkPasswordPolicy,
  clearCookie,
  csrfCookie,
  dummyVerify,
  hashIdentifier,
  hashToken,
  issueCsrfToken,
  mintSessionToken,
  normalizeRecoveryCode,
  sessionCookie,
} from '@petavu/security';

import type { RouteDefinition, Scope } from '../types.js';
import { cookieNames } from '../cookies.js';
import { validator } from '../validate.js';

/** نگاشت ثابت است تا آزمون بتواند بشمارد؛ تغییرش، تصمیم تازه است نه سلیقه. */
const SESSION_FALLBACK_MAX_AGE = 30 * 24 * 60 * 60;

export const authRoutes: RouteDefinition[] = [
  {
    method: 'POST',
    path: '/api/v1/auth/login',
    name: 'auth.login',
    summary: 'ورود با شناسه و رمز عبور',
    tags: ['auth'],
    auth: 'public',
    role: 'pv_public',
    rateLimit: RATE_LIMITS.loginIp,
    originCheck: true,
    handler: async (request, scope) => {
      const body = validator(request.body);
      const identifier = body.string('identifier', { min: 3, max: 190 });
      const password = body.string('password', { min: 1, max: 200 });
      const deviceFingerprint = body.optionalString('device_fingerprint', { min: 16, max: 200 });
      body.done();

      const identifierHash = hashIdentifier(identifier);
      const candidates = await scope.query<{
        user_id: string | null;
        password_hash: string | null;
        user_status: string | null;
        mfa_required: boolean | null;
        failed_login_count: number | null;
        locked_until: string | null;
      }>('select user_id, password_hash, user_status, mfa_required, failed_login_count, locked_until, identity_id from auth.find_login_candidate($1)', [identifierHash]);

      const candidate = candidates[0] ?? null;

      if (candidate?.locked_until && new Date(candidate.locked_until).getTime() > scope.services.now()) {
        await scope.repos.ops.recordSecurityEvent({
          kind: 'auth.login_locked',
          severity: 'warning',
          ip: request.ip,
          details: { identifier_hash: identifierHash },
        });
        /*
         * به‌جای `throw`، پاسخ برمی‌گردانیم — و این تصمیم مهمی است.
         *
         * خطایی که از هندلر بیرون بیاید، تراکنش درخواست را **برمی‌گرداند**؛
         * پس رخداد امنیتی‌ای که همین چند خط بالاتر نوشتیم، با آن پاک می‌شد.
         * هر چیزی که «ردّ» است (رخداد، تلاش ورود، قفل حساب) باید بماند، حتی
         * وقتی پاسخ به کاربر «نه» است. پس مسیرهای شکستی که نوشتن ماندگار
         * دارند، پاسخِ خطای ساختاریافته برمی‌گردانند و استثنا پرت نمی‌کنند.
         */
        return {
          status: 423,
          body: errorPayload(
            new AppError('account_locked', { details: { locked_until: new Date(candidate.locked_until).toISOString() } }),
            request.requestId,
          ),
        };
      }

      // بررسی ساختگی وقتی اعتبارنامه‌ای برای بررسی نیست: زمان پاسخ نباید
      // وابسته به «وجود کاربر» باشد.
      const storedHash = candidate?.password_hash ?? null;
      const verified = storedHash
        ? await scope.services.passwords.verify(storedHash, password)
        : await dummyVerify(scope.services.passwords, password);

      const tickets = await scope.query<{ ticket_id: string }>('select ticket_id, expires_at from app.begin_login($1, $2)', [identifierHash, request.ip]);
      const ticket = tickets[0];
      if (!ticket) throw new AppError('service_unavailable', { details: { reason: 'login_ticket_not_created' } });

      if (!verified || !candidate?.user_id) {
        const attempts = await scope.query<{ locked_until: string | null; failed_login_count: number | null }>(
          'select session_id, locked_until, failed_login_count from app.complete_login($1, false, null, 1::smallint, $2, $3, $4, $5, null, null)',
          [ticket.ticket_id, 'invalid_credentials', request.ip, deviceFingerprint, request.userAgent],
        );

        await scope.repos.ops.recordSecurityEvent({
          kind: 'auth.login_failed',
          severity: 'info',
          ip: request.ip,
          details: { identifier_hash: identifierHash, failures: attempts[0]?.failed_login_count ?? null },
        });

        /* پیام یکسان و بی‌افشا (§13)، ولی با پاسخ برگشتی تا نوشتن‌ها بمانند. */
        return {
          status: 401,
          body: errorPayload(
            new AppError('unauthenticated', {
              message: 'شناسه یا رمز عبور درست نیست.',
              details: { reason: 'invalid_credentials' },
            }),
            request.requestId,
          ),
        };
      }

      /*
       * توکن نشست، پیش از درج ساخته می‌شود تا *شناسهٔ نشست* را بدانیم و راز
       * را به شکل درهم به پایگاه‌داده بدهیم. کلیدهای رمزی هرگز خام نمی‌روند.
       */
      /*
       * شناسهٔ نشست را ما می‌سازیم، نه پایگاه‌داده: راز باید پیش از درج هش شود
       * و شناسه باید *بدون خواندنِ پس از درج* معلوم باشد — چون `returning` روی
       * جدول نشست خودش یک خواندن است و مسیر بی‌نام نباید نشست‌ها را بخواند
       * (§54، ADR-0011).
       */
      const sessionId = uuidv7(scope.services.now());
      const minted = mintSessionToken(sessionId);

      const sessions = await scope.query<{
        session_id: string;
        expires_at: string;
        absolute_expires_at: string;
        display_name: string | null;
        locale: string | null;
        mfa_required: boolean | null;
        user_id: string | null;
      }>(
        'select session_id, expires_at, absolute_expires_at, display_name, locale, mfa_required, user_id from app.complete_login($1, true, $2, 1::smallint, null, $3, $4, $5, null, $6)',
        [ticket.ticket_id, minted.secretHash, request.ip, deviceFingerprint, request.userAgent, sessionId],
      );

      const session = sessions[0];
      if (!session?.session_id) throw new AppError('unauthenticated', { message: 'ورود کامل نشد؛ دوباره تلاش کنید.' });

      return {
        status: 200,
        body: {
          session: {
            id: session.session_id,
            expires_at: session.expires_at,
            absolute_expires_at: session.absolute_expires_at,
          },
          // شناسهٔ کاربر هم برمی‌گردد: کلاینت بی‌آن باید یک درخواست دوم به
          // `/auth/session` بزند تا فقط یک uuid بگیرد.
          user: {
            id: session.user_id,
            display_name: session.display_name,
            locale: session.locale,
            mfa_required: session.mfa_required === true,
          },
          csrf_token: csrfTokenFrom(scope, session.session_id),
        },
        cookies: sessionCookies(scope, minted.token, session.session_id, session.expires_at),
      };
    },
  },

  {
    method: 'POST',
    path: '/api/v1/auth/register',
    name: 'auth.register',
    summary: 'ساخت حساب کاربری و ورود بی‌درنگ',
    tags: ['auth'],
    auth: 'public',
    role: 'pv_public',
    rateLimit: RATE_LIMITS.registerIp,
    originCheck: true,
    handler: async (request, scope) => {
      const body = validator(request.body);
      const identifier = body.string('identifier', { min: 3, max: 190 });
      const password = body.string('password', { min: 1, max: 200 });
      const displayName = body.string('display_name', { min: 2, max: 120 });
      const locale = body.optionalString('locale', { min: 2, max: 16 }) ?? 'fa-IR';
      const timezone = body.optionalString('timezone', { min: 3, max: 64 }) ?? 'Asia/Tehran';
      const deviceFingerprint = body.optionalString('device_fingerprint', { min: 16, max: 200 });
      body.done();

      /*
       * سیاست رمز، *پیش از* هر کار پایگاه‌داده‌ای اجرا می‌شود: نه بلیتی ساخته
       * می‌شود، نه هشی محاسبه می‌شود. حساب با رمز ضعیف هرگز به وجود نمی‌آید.
       */
      const policy = checkPasswordPolicy(password, { personalInfo: [displayName, identifier] });
      if (!policy.ok) {
        throw new AppError('validation_failed', {
          message: 'رمز عبور شرایط لازم را ندارد.',
          details: {
            issues: policy.problems.map((problem) => ({ path: 'password', code: 'weak_password', message: problem })),
          },
        });
      }

      const identifierHash = hashIdentifier(identifier);
      const identifierKind = identifier.includes('@') ? 'email' : 'phone';

      let ticket: { ticket_id: string; expires_at: string } | undefined;
      try {
        const tickets = await scope.query<{ ticket_id: string; expires_at: string }>(
          'select ticket_id, expires_at from app.begin_registration($1, $2, $3)',
          [identifierHash, identifierKind, request.ip],
        );
        ticket = tickets[0];
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '23505') {
          throw new AppError('conflict', {
            message: 'این شناسه قبلاً ثبت شده است. اگر حساب دارید، وارد شوید.',
            details: { reason: 'identifier_taken' },
          });
        }
        throw error;
      }

      if (!ticket) throw new AppError('service_unavailable', { details: { reason: 'registration_ticket_not_created' } });

      const secretHash = await scope.services.passwords.hash(password);
      const created = await scope.query<{ user_id: string; identity_id: string }>(
        'select user_id, identity_id from app.complete_registration($1, $2, $3, $4, $5)',
        [ticket.ticket_id, displayName, secretHash, locale, timezone],
      );

      if (!created[0]?.user_id) {
        throw new AppError('conflict', {
          message: 'بلیت ثبت‌نام معتبر نبود؛ دوباره تلاش کنید.',
          details: { reason: 'registration_ticket_invalid' },
        });
      }

      // ورود بی‌درنگ: کاربری که تازه ثبت‌نام کرده نباید رمز را دوباره بنویسد.
      const loginTickets = await scope.query<{ ticket_id: string }>('select ticket_id, expires_at from app.begin_login($1, $2)', [
        identifierHash,
        request.ip,
      ]);
      const loginTicket = loginTickets[0];
      if (!loginTicket) throw new AppError('service_unavailable', { details: { reason: 'login_ticket_not_created' } });

      const sessionId = uuidv7(scope.services.now());
      const minted = mintSessionToken(sessionId);

      const sessions = await scope.query<{
        session_id: string;
        expires_at: string;
        absolute_expires_at: string;
        display_name: string | null;
        locale: string | null;
        mfa_required: boolean | null;
      }>(
        'select session_id, expires_at, absolute_expires_at, display_name, locale, mfa_required from app.complete_login($1, true, $2, 1::smallint, null, $3, $4, $5, null, $6)',
        [loginTicket.ticket_id, minted.secretHash, request.ip, deviceFingerprint, request.userAgent, sessionId],
      );

      const session = sessions[0];
      if (!session?.session_id) throw new AppError('unauthenticated', { message: 'ثبت‌نام کامل شد، ولی ورود انجام نشد.' });

      await scope.repos.ops.recordSecurityEvent({
        kind: 'auth.registered',
        severity: 'info',
        ip: request.ip,
        actorId: created[0].user_id,
        details: { identifier_kind: identifierKind, request_id: request.requestId },
      });

      return {
        status: 201,
        body: {
          user: { id: created[0].user_id, display_name: session.display_name, locale: session.locale },
          session: {
            id: session.session_id,
            expires_at: session.expires_at,
            absolute_expires_at: session.absolute_expires_at,
          },
          csrf_token: csrfTokenFrom(scope, session.session_id),
        },
        cookies: sessionCookies(scope, minted.token, session.session_id, session.expires_at),
      };
    },
  },

  {
    method: 'POST',
    path: '/api/v1/auth/logout',
    name: 'auth.logout',
    summary: 'بستن نشست جاری',
    tags: ['auth'],
    auth: 'session',
    role: 'pv_app',
    handler: async (request, scope) => {
      const body = validator(request.body);
      const reason = body.optionalString('reason', { max: 200 });
      body.done();

      const rows = await scope.query<{ logout: boolean }>('select app.logout($1) as logout', [reason ?? 'user_request']);

      return {
        status: 200,
        body: { revoked: rows[0]?.logout === true },
        // پاک‌کردن کوکی، بخشی از خروج است: بی‌آن، کوکی مرده در مرورگر می‌ماند.
        cookies: expiredCookies(scope),
      };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/auth/session',
    name: 'auth.session',
    summary: 'بازیگر جاری، نشست و کسب‌وکارهای عضو',
    tags: ['auth'],
    auth: 'session',
    role: 'pv_app',
    handler: async (request, scope) => {
      const auth = request.auth;
      if (auth.kind !== 'session') throw new AppError('unauthenticated');

      const businesses = await scope.repos.identity.businessesOf(auth.userId);

      return {
        body: {
          user: { id: auth.userId, display_name: auth.displayName, locale: auth.locale, timezone: auth.timezone },
          session: {
            id: auth.sessionId,
            step_up_at: auth.stepUpAt,
            expires_at: auth.expiresAt,
            absolute_expires_at: auth.absoluteExpiresAt,
            platform_role: auth.platformRole,
            impersonated_by: auth.impersonatedBy,
          },
          active_business_id: auth.activeBusinessId,
          businesses,
          csrf_token: csrfTokenFrom(scope, auth.sessionId),
        },
      };
    },
  },

  {
    method: 'POST',
    path: '/api/v1/auth/business',
    name: 'auth.switchBusiness',
    summary: 'تغییر کسب‌وکار فعال نشست',
    tags: ['auth'],
    auth: 'session',
    role: 'pv_app',
    handler: async (request, scope) => {
      const body = validator(request.body);
      const businessId = body.uuid('business_id');
      body.done();

      const rows = await scope.query<{ switched: boolean }>('select app.switch_business($1) as switched', [businessId]);
      if (rows[0]?.switched !== true) {
        // نداشتن عضویت = «پیدا نشد»، نه «ممنوع»: وجود کسب‌وکار افشا نمی‌شود.
        throw new AppError('not_found', { details: { reason: 'not_a_member' } });
      }

      return { status: 200, body: { active_business_id: businessId } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/auth/api-keys',
    name: 'auth.listApiKeys',
    summary: 'فهرست کلیدهای API کسب‌وکار فعال',
    tags: ['auth', 'api-keys'],
    auth: 'session',
    role: 'pv_app',
    permission: 'business.integration.manage',
    handler: async (request, scope) => {
      const rows = await scope.query<Record<string, unknown>>(
        `select k.id, k.name, k.key_prefix, k.scopes, k.created_at, k.last_used_at, k.expires_at,
                k.revoked_at, k.revoked_reason, k.request_count
           from app.api_key k
          where k.business_id = $1
          order by k.created_at desc`,
        [request.businessId],
      );
      // هش کلید، حتی در فهرست ادمین هم بیرون نمی‌آید.
      return { body: { keys: rows } };
    },
  },

  {
    method: 'POST',
    path: '/api/v1/auth/api-keys',
    name: 'auth.createApiKey',
    summary: 'ساخت کلید API با دامنهٔ مجوز صریح',
    tags: ['auth', 'api-keys'],
    auth: 'session',
    role: 'pv_app',
    permission: 'business.integration.manage',
    handler: async (request, scope) => {
      const body = validator(request.body);
      const name = body.string('name', { min: 2, max: 80 });
      const scopes = body.array<string>('scopes', { max: 40 });
      const expiresAt = body.instant('expires_at');
      body.done();

      const cleanScopes = [...new Set(scopes.filter((key) => typeof key === 'string' && key.includes('.')))];

      /*
       * دامنهٔ مجوز، پیش از ساخت کلید سنجیده می‌شود.
       *
       * تابع دامنه هم همین را می‌سنجد (و مرجع نهایی همان است)، ولی آنجا خطا
       * «invalid_input» بی‌جزئیات است. مرز API جایی است که کاربر پنل باید
       * بداند *کدام* کلید مجوز ناشناس بوده — وگرنه با فهرست بلندی از کلیدها
       * تنها می‌ماند.
       */
      if (cleanScopes.length > 0) {
        const known = await scope.query<{ key: string }>('select p.key from auth.permission p where p.key = any($1::text[])', [cleanScopes]);
        const knownSet = new Set(known.map((row) => row.key));
        const unknown = cleanScopes.filter((key) => !knownSet.has(key));
        if (unknown.length > 0) {
          throw new AppError('validation_failed', {
            message: 'دامنهٔ مجوز کلید، شامل کلید ناشناس است.',
            details: { issues: unknown.map((key) => ({ path: 'scopes', code: 'unknown_permission', key })) },
          });
        }
      }

      const raw = `pvk_live_${newOpaqueToken(24)}`;

      /*
       * `$5::text[]` و `$6::timestamptz` صریح‌اند، نه تزئینی.
       *
       * پارامترهای بی‌نوع، در PostgreSQL مقدار «ناشناخته» می‌گیرند و وقتی همهٔ
       * کاندیدهای تابع هیچ‌یک به‌طور کامل تطبیق نکند، حل ابهام شکست می‌خورد
       * (`function does not exist`) — همان خطایی که در آزمون واقعی رخ داد.
       * امضای درست را نمی‌شود از تعداد آرگومان‌ها حدس زد؛ باید گفت.
       */
      const rows = await scope.query<{ key_id: string; created_at: string }>(
        'select key_id, created_at from app.issue_api_key($1, $2, $3, $4, $5::text[], $6::timestamptz)',
        [request.businessId, name, hashToken(raw), raw.slice(0, 16), cleanScopes, expiresAt],
      );

      return {
        status: 201,
        body: {
          key: { id: rows[0]?.key_id, name, key_prefix: raw.slice(0, 16), scopes: cleanScopes, expires_at: expiresAt },
          // تنها باری که کلید خام دیده می‌شود.
          secret: raw,
          warning: 'این کلید فقط یک بار نمایش داده می‌شود؛ آن را در جای امن نگه دارید.',
        },
      };
    },
  },

  {
    method: 'DELETE',
    path: '/api/v1/auth/api-keys/:keyId',
    name: 'auth.revokeApiKey',
    summary: 'باطل‌کردن کلید API',
    tags: ['auth', 'api-keys'],
    auth: 'session',
    role: 'pv_app',
    permission: 'business.integration.manage',
    csrf: true,
    handler: async (request, scope) => {
      const keyId = request.params.keyId ?? '';
      if (!isUuid(keyId)) {
        throw new AppError('validation_failed', { details: { issues: [{ path: 'keyId', code: 'expected_uuid' }] } });
      }

      const rows = await scope.query<{ revoked: boolean }>('select app.revoke_api_key($1, $2) as revoked', [keyId, 'user_request']);
      if (rows[0]?.revoked !== true) throw new AppError('not_found', { details: { reason: 'key_not_found' } });

      return { status: 200, body: { revoked: true, id: keyId } };
    },
  },

  {
    method: 'GET',
    path: '/api/v1/auth/recovery-codes',
    name: 'auth.recoveryCodesLeft',
    summary: 'شمار کدهای بازیابی باقی‌مانده',
    tags: ['auth'],
    auth: 'session',
    role: 'pv_app',
    handler: async (request, scope) => {
      const auth = request.auth;
      if (auth.kind !== 'session') throw new AppError('unauthenticated');

      const rows = await scope.query<{ left: number }>('select auth.recovery_codes_left($1) as left', [auth.userId]);
      return {
        body: {
          remaining: rows[0]?.left ?? 0,
          // قالب کد بازیابی از خودِ تولیدکننده می‌آید تا UI و سرور یکی بمانند.
          format_example: normalizeRecoveryCode('ABCD-EFGH-IJKL-MNOP'),
        },
      };
    },
  },
];

/* --------------------------------------------------------------- کمکی‌ها */

function csrfTokenFrom(scope: Scope, sessionId: string): string {
  return issueCsrfToken({ secret: scope.services.env.security.sessionSecret, sessionId, nowMs: scope.services.now() });
}

function sessionCookies(scope: Scope, token: string, sessionId: string, expiresAt: string): string[] {
  const secure = scope.services.env.isProduction;
  const names = cookieNames(scope.services.env);
  const remaining = Math.floor((new Date(expiresAt).getTime() - scope.services.now()) / 1000);
  const maxAgeSeconds = Number.isFinite(remaining) && remaining > 60 ? remaining : SESSION_FALLBACK_MAX_AGE;

  return [
    sessionCookie(names.session, token, { secure, maxAgeSeconds }),
    csrfCookie(names.csrf, csrfTokenFrom(scope, sessionId), { secure, maxAgeSeconds }),
  ];
}

function expiredCookies(scope: Scope): string[] {
  const names = cookieNames(scope.services.env);
  const secure = scope.services.env.isProduction;
  return [
    clearCookie(names.session, { path: '/', secure, httpOnly: true, sameSite: 'Lax' }),
    clearCookie(names.csrf, { path: '/', secure, httpOnly: false, sameSite: 'Lax' }),
  ];
}
