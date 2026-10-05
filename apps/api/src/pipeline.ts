/**
 * خط لولهٔ درخواست (گام ۲۱؛ §14، §64–۷۸، §93–۹۹).
 *
 * ترتیب گام‌ها **امنیتی** است، نه سلیقه‌ای. هر گام، پیش‌فرضِ گام بعد را
 * می‌سازد:
 *
 *   ۱. شناسهٔ درخواست — پیش از هر لاگ، تا هر خطی از این لحظه به بعد قابل‌ردیابی
 *      باشد (§76).
 *   ۲. تطبیق مسیر — پیش از هر کار سنگین؛ درخواست ناشناس، هیچ هزینه‌ای ندارد.
 *   ۳. محدودیت نرخ — پیش از خواندن بدنه؛ حملهٔ سیل‌آسا نباید حتی بدنه‌اش خوانده شود.
 *   ۴. بدنه — با سقف بایت.
 *   ۵. بازشناخت بازیگر — کوکی نشست یا کلید API. تا اینجا هیچ‌چیز «کاربر» نیست.
 *   ۶. بررسی مبدأ + توکن CSRF — فقط برای درخواست تغییردهندهٔ کوکی‌محور.
 *   ۷. مجوز — پیش‌بررسی صریح، سپس اجرای دستور که خودش هم مجوز و RLS را دارد.
 *   ۸. اجرا در تراکنش، با زمینه و نقش.
 *
 * دو تصمیم که ارزش توضیح دارند:
 *
 *   • **پاسخ خطا یکسان است، چه حساب باشد چه نباشد.** ورود نادرست و کاربر
 *     ناموجود، هر دو `unauthenticated` با یک پیام می‌گیرند (§13).
 *   • **خطای برنامه‌ریزی‌شده، لاگ سطح warn است و خطای ناشناخته، error با
 *     پشته.** اگر باگ‌ها را در همان سطح خطاهای کاربر لاگ کنیم، سیگنال از بین
 *     می‌رود.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  AppError,
  errorPayload,
  isAppError,
  toAppError,
  uuidv7,
} from '@petavu/shared';
import {
  RATE_LIMITS,
  checkRequestOrigin,
  clearCookie,
  hashToken,
  parseSessionToken,
  readCookie,
  verifyCsrfToken,
  type RateLimitDecision,
  type RateLimitRule,
} from '@petavu/security';
import { createDal, createRepositories, withContext, type RequestContext, type Row, type SqlParams } from '@petavu/db';

import {
  MUTATING_METHODS,
  type ApiRequest,
  type ApiResult,
  type ApiServices,
  type AuthState,
  type HttpMethod,
  type RouteDefinition,
  type Scope,
} from './types.js';
import { corsHeaders, readBody, securityHeaders, sendJson } from './http.js';
import { cookieNames } from './cookies.js';
import type { Router } from './router.js';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,64}$/;

export interface PipelineOptions {
  readonly services: ApiServices;
  readonly router: Router;
  /** محدودکنندهٔ نرخ پایدار؛ تزریق می‌شود تا آزمون به ساعت واقعی وابسته نباشد. */
  readonly consumeRateLimit: (key: string, rule: RateLimitRule, requestId: string) => Promise<RateLimitDecision>;
}

export function createPipeline(options: PipelineOptions) {
  const { services, router } = options;
  const allowedOrigins = Object.values(services.env.origins);
  const secure = services.env.isProduction;
  const cookieName = cookieNames(services.env);

  /** همهٔ کارهای یک درخواست، از تطبیق تا پاسخ. */
  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const startedAtMs = services.now();
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    const requestId = pickRequestId(request.headers['x-request-id']);
    const logger = services.logger.child({ requestId });

    const baseHeaders: Record<string, string> = {
      ...securityHeaders(services.env),
      'x-request-id': requestId,
    };

    const origin = header(request, 'origin');
    Object.assign(baseHeaders, corsHeaders(origin, allowedOrigins));

    // پیش‌پرواز CORS: هیچ منطق دامنه‌ای لازم نیست، فقط پاسخ درست.
    if (request.method === 'OPTIONS') {
      response.writeHead(204, baseHeaders);
      response.end();
      return;
    }

    const method = (request.method ?? 'GET').toUpperCase() as HttpMethod;
    const result = router.match(method, url.pathname);

    if (result.kind === 'not_found') {
      sendError(response, new AppError('not_found', { details: { path: url.pathname } }), requestId, 404, baseHeaders);
      return;
    }

    if (result.kind === 'method_not_allowed') {
      sendError(
        response,
        new AppError('method_not_allowed', { details: { allowed: result.allowed.join(', ') } }),
        requestId,
        405,
        { ...baseHeaders, allow: result.allowed.join(', ') },
      );
      return;
    }

    const { route, params } = result.match;
    const ip = clientIp(request, services.env.trustProxy);

    try {
      await respond(route, params);
    } catch (error) {
      const appError = isAppError(error) ? error : toAppError(error);
      if (appError.code === 'internal_error') {
        logger.error('خطای نامنتظر در پردازش درخواست', {
          route: route.name,
          error: appError.message,
          cause: describeCause(appError),
        });
      } else {
        logger.warn('رد درخواست در لایهٔ API', { route: route.name, code: appError.code });
      }
      sendError(response, appError, requestId, appError.status, baseHeaders);
    }

    async function respond(matched: RouteDefinition, pathParams: Readonly<Record<string, string>>): Promise<void> {
      // ۱. محدودیت نرخ: قاعدهٔ مسیر، به‌علاوهٔ سقف عمومی خواندن/نوشتن.
      const decisions: RateLimitDecision[] = [];
      /*
       * سقف نرخ، **به‌ازای هر مسیر** شمرده می‌شود؛ نه یک سبد مشترک.
       *
       * در نسخهٔ پیشین کلید از نام *قاعده* ساخته می‌شد، پس همهٔ مسیرهای
       * تغییردهندهٔ یک IP یک سبد داشتند و انفجار نوشتن در یک مسیر، مسیرهای
       * دیگر را می‌بست. این «امن‌تر» نبود، فقط شکننده بود: مهاجم همان یک
       * سبد را پر می‌کرد و کاربر واقعی بیرون می‌ماند.
       *
       * قاعدهٔ پیش‌فرض هم به دستهٔ مسیر وابسته است: مسیر بی‌نام، سقف فرم
       * عمومی می‌گیرد (سخت)؛ مسیر احرازشده، سقف کاری (سخاوتمندانه).
       */
      const routeRule =
        matched.rateLimit ??
        (MUTATING_METHODS.includes(matched.method)
          ? matched.auth === 'public'
            ? RATE_LIMITS.publicForm
            : RATE_LIMITS.writeGeneral
          : matched.auth === 'public'
            ? RATE_LIMITS.publicRead
            : RATE_LIMITS.readGeneral);
      decisions.push(await options.consumeRateLimit(`route:${matched.name}:ip:${ip ?? 'unknown'}`, routeRule, requestId));

      const blocked = decisions.find((decision) => !decision.allowed);
      if (blocked) {
        logger.warn('سقف نرخ رد کرد', { route: matched.name, rule: blocked.rule });
        sendError(
          response,
          new AppError('rate_limited', { details: { rule: blocked.rule, retry_after_seconds: blocked.retryAfterSeconds } }),
          requestId,
          429,
          baseHeaders,
          blocked,
        );
        return;
      }

      // ۲. بدنه، فقط برای روش‌های تغییردهنده.
      const body = MUTATING_METHODS.includes(matched.method) ? await readBody(request) : { raw: '', json: undefined };

      // ۳. بازیگر.
      const auth = await resolveActor(request, requestId, ip);

      if ((matched.auth === 'session' && auth.kind === 'anonymous') || (matched.auth === 'api-key' && auth.kind !== 'api-key')) {
        throw new AppError('unauthenticated', { details: { reason: 'auth_required' } });
      }
      if (matched.auth === 'authenticated' && auth.kind === 'anonymous') {
        throw new AppError('unauthenticated', { details: { reason: 'auth_required' } });
      }
      if (matched.auth === 'any' && auth.kind === 'anonymous') {
        // `any` یعنی «خواندن عمومی مجاز است»، نه «نوشتن بی‌نام». نوشتنِ
        // بی‌نام فقط جایی معنا دارد که مسیر صراحتاً `public` باشد.
        if (MUTATING_METHODS.includes(matched.method)) {
          throw new AppError('unauthenticated', { details: { reason: 'auth_required' } });
        }
      }

      // ۴. بررسی مبدأ و CSRF برای درخواست‌های تغییردهندهٔ کوکی‌محور.
      if (MUTATING_METHODS.includes(matched.method)) {
        const browserOrigin = header(request, 'origin');
        /*
         * کلاینت ماشینی (کلید API) معمولاً `Origin` ندارد؛ نبودنش برای او عادی
         * است. ولی اگر مرورگری با کلید API درخواست داد و `Origin` فرستاد، همان
         * بررسی دامنه‌ها رویش اجرا می‌شود.
         */
        const exempt = auth.kind === 'api-key' && browserOrigin === null;
        const check = checkRequestOrigin({
          method: matched.method,
          origin: browserOrigin ?? undefined,
          referer: header(request, 'referer') ?? undefined,
          allowedOrigins,
          exempt: (matched.originCheck ?? true) === false ? true : exempt,
        });
        if (!check.ok) throw new AppError('csrf_failed', { details: { reason: check.reason } });

        const csrfRequired = matched.csrf ?? auth.kind === 'session';
        if (csrfRequired) {
          if (auth.kind !== 'session') {
            throw new AppError('csrf_failed', { details: { reason: 'session_required_for_csrf' } });
          }
          /*
           * توکن فقط از هدر می‌آید، **نه از کوکی**.
           *
           * الگوی «دو گانهٔ کوکی» در ظاهر امن است، ولی اگر سرور توکن را از
           * کوکی هم بپذیرد، اثباتِ «کد مهاجم نتوانسته مقدار را بخواند» از
           * بین می‌رود: مرورگر کوکی را خودش می‌فرستد، پس یک درخواست
           * میان‌سایتی هم آن را با خود دارد. کوکی CSRF فقط برای این صادر
           * می‌شود که `fetch` همان مبدأ، مقدارش را بخواند و در **هدر**
           * بگذارد. آزمون واقعی همین را گرفت: درخواست بی‌هدر، ۲۰۰ گرفت.
           */
          const token = header(request, 'x-csrf-token');
          const verified = verifyCsrfToken(token, {
            secret: services.env.security.sessionSecret,
            sessionId: auth.sessionId,
            nowMs: services.now(),
          });
          if (!verified.ok) throw new AppError('csrf_failed', { details: { reason: verified.reason ?? 'invalid' } });
        }
      }

      if(auth.kind==='session'&&auth.impersonatedBy&&MUTATING_METHODS.includes(matched.method)&&matched.path.startsWith('/api/v1/auth/')&&!['mfa.stopImpersonate','auth.logout','auth.switchBusiness'].includes(matched.name))throw new AppError('forbidden',{details:{reason:'credential_mutation_during_impersonation'}});
      // ۵. کسب‌وکار مؤثر.
      /*
       * هدر خالی یا فقط فاصله، «نبودِ هدر» است — نه یک uuid نامعتبر.
       *
       * کلاینت‌ها به‌سادگی `x-business-id: ` یا `null` می‌فرستند (و بعضی
       * کتابخانه‌ها مقدار `null` را به رشته تبدیل می‌کنند). پاسخ «شناسهٔ
       * نامعتبر» به چنین درخواستی، مصرف‌کنندهٔ API را به دام می‌اندازد؛ خطای
       * واقعی باید برای چیزی باشد که *قصد* داشته کسب‌وکار نام ببرد.
       */
      const businessHeader = header(request, 'x-business-id');
      const businessId = await resolveBusiness(auth, businessHeader && businessHeader.trim() !== '' ? businessHeader : null);

      const context: RequestContext = {
        userId: auth.kind === 'session' ? auth.userId : null,
        sessionId: auth.kind === 'session' ? auth.sessionId : null,
        businessId,
        platformRole: auth.kind === 'session' ? auth.platformRole : null,
        impersonatedBy: auth.kind === 'session' ? auth.impersonatedBy : null,
        requestId,
      };

      const apiRequest: ApiRequest = {
        method: matched.method,
        path: url.pathname,
        params: pathParams,
        query: url.searchParams,
        headers: flattenHeaders(request),
        rawBody: body.raw,
        body: body.json,
        requestId,
        ip,
        userAgent: header(request, 'user-agent'),
        origin,
        auth,
        businessId,
        context,
        route: matched,
        startedAtMs,
      };

      const apiResult = await runScoped(services, matched, context, auth, apiRequest);

      const status = apiResult.status ?? (matched.method === 'POST' ? 201 : 200);
      logger.info('درخواست انجام شد', {
        route: matched.name,
        status,
        duration_ms: Math.round(services.now() - startedAtMs),
        actor: auth.kind,
      });

      sendJson(response, apiResult.body, {
        status,
        headers: { ...baseHeaders, ...(apiResult.headers ?? {}) },
        cookies: apiResult.cookies,
      });
    }

    // ------------------------------------------------------------------ بازیگر
    async function resolveActor(request: IncomingMessage, requestId: string, ip: string | null): Promise<AuthState> {
      /*
       * کلید API اول بررسی می‌شود: اگر هدر `Authorization` آمده باشد، یعنی
       * کلاینت ماشینی است و کوکی ندارد. بررسی کوکی در آن حالت، کار بیهوده است.
       */
      const authorization = header(request, 'authorization');
      if (authorization?.toLowerCase().startsWith('bearer ')) {
        const raw = authorization.slice(7).trim();
        if (raw === '') throw new AppError('unauthenticated', { details: { reason: 'empty_bearer' } });

        const keyHash = hashApiKey(raw);
        const result = await withContext(
          services.client,
          { requestId },
          (tx) => tx.asRole('pv_app', () => tx.query<Row>('select key_id, key_business_id, key_scopes from app.resolve_api_key($1, $2)', [keyHash, ip])),
        );

        const row = result.rows[0];
        if (!row) throw new AppError('unauthenticated', { details: { reason: 'invalid_api_key' } });

        return {
          kind: 'api-key',
          keyId: String(row.key_id),
          businessId: String(row.key_business_id),
          scopes: (row.key_scopes as string[] | null) ?? [],
        };
      }

      const cookieHeader = header(request, 'cookie') ?? undefined;
      const token = readCookie(cookieHeader, cookieName.session);
      if (!token) return { kind: 'anonymous' };

      // تجزیه و درهم‌سازی راز، از `@petavu/security` می‌آید — یک پیاده‌سازی،
      // نه دو تا که یکی‌شان دیر یا زود وصله نشود.
      const parsed = parseSessionToken(token);
      if (!parsed) return { kind: 'anonymous' };
      const secretHash = hashToken(parsed.secret);

      const resolved = await withContext(
        services.client,
        { requestId },
        (tx) =>
          tx.asRole('pv_public', () =>
            tx.query<Row>('select session_id, token_user_id, display_name, locale, timezone, aal, step_up_at, platform_role, impersonated_by, active_business_id, issued_at, expires_at, absolute_expires_at from app.resolve_session($1, $2, $3, $4) as r', [
              parsed.sessionId,
              secretHash,
              ip,
              header(request, 'user-agent'),
            ]),
          ),
      );

      const row = resolved.rows[0];
      if (!row) return { kind: 'anonymous' };

      return {
        kind: 'session',
        sessionId: String(row.session_id),
        userId: String(row.token_user_id),
        displayName: String(row.display_name ?? ''),
        locale: String(row.locale ?? 'fa-IR'),
        timezone: String(row.timezone ?? 'Asia/Tehran'),
        stepUpAt: row.step_up_at ? new Date(String(row.step_up_at)).toISOString() : null,
        platformRole: row.platform_role ? String(row.platform_role) : null,
        impersonatedBy: row.impersonated_by ? String(row.impersonated_by) : null,
        activeBusinessId: row.active_business_id ? String(row.active_business_id) : null,
        expiresAt: new Date(String(row.expires_at)).toISOString(),
        absoluteExpiresAt: new Date(String(row.absolute_expires_at)).toISOString(),
      };
    }

    // ------------------------------------------------------------ کسب‌وکار
    async function resolveBusiness(auth: AuthState, headerValue: string | null): Promise<string | null> {
      if (auth.kind === 'api-key') {
        /*
         * کلید API فقط کسب‌وکار خودش را می‌بیند. اگر هدر چیز دیگری بخواهد،
         * خطا می‌دهیم — نه اینکه بی‌صدا نادیده گرفته شود؛ «بی‌صدا» یعنی
         * توسعه‌دهنده ماه‌ها بعد بفهمد.
         */
        if (headerValue !== null && headerValue !== auth.businessId) {
          throw new AppError('forbidden', { details: { reason: 'api_key_business_mismatch' } });
        }
        return auth.businessId;
      }

      if (headerValue !== null && headerValue !== '') {
        if (!/^[0-9a-fA-F-]{36}$/.test(headerValue)) {
          throw new AppError('validation_failed', { details: { issues: [{ path: 'x-business-id', code: 'expected_uuid' }] } });
        }
        if (auth.kind === 'anonymous') {
          throw new AppError('unauthenticated', { details: { reason: 'business_requires_session' } });
        }
        return headerValue.toLowerCase();
      }

      return auth.kind === 'session' ? auth.activeBusinessId : null;
    }
  }

  // -------------------------------------------------------------- اجرا
  async function runScoped(
    services_: ApiServices,
    route: RouteDefinition,
    context: RequestContext,
    auth: AuthState,
    request: ApiRequest,
  ): Promise<ApiResult> {
    const settings = apiKeySettings(auth);

    return withContext(
      services_.client,
      context,
      async (tx) => {
        if (Object.keys(settings).length > 0) {
          const entries = Object.entries(settings);
          const params: unknown[] = [];
          const assignments = entries.map(([key, value]) => {
            params.push(key, value);
            return `set_config($${params.length - 1}, $${params.length}, true)`;
          });
          await tx.query(`select ${assignments.join(', ')}`, params);
        }

        return tx.asRole(route.role, async () => {
          const dal = createDal(tx);
          const scope: Scope = {
            client: tx,
            dal,
            repos: createRepositories({ dal, context }),
            context,
            services: services_,
            query: <TRow extends Row = Row>(text: string, params?: SqlParams) => dal.query<TRow>(text, params),
          };

          await assertRouteAccess(scope, route, request);
          return route.handler(request, scope);
        });
      },
    );
  }

  /** پیش‌بررسی مجوز مسیر؛ تصمیم نهایی، همچنان در دستور و در RLS است. */
  async function assertRouteAccess(scope: Scope, route: RouteDefinition, request: ApiRequest): Promise<void> {
    if (route.platformPermission) {
      const rows = await scope.query<{ ok: boolean }>('select app.has_platform_permission($1) as ok', [route.platformPermission]);
      if (rows[0]?.ok !== true) {
        throw new AppError('forbidden', { details: { reason: 'missing_platform_permission', permission: route.platformPermission } });
      }
      return;
    }

    if (route.permission) {
      /*
       * مجوز کسب‌وکاری بدون کسب‌وکار جاری، معنا ندارد. اگر مسیر چنین مجوزی
       * بخواهد و کسب‌وکار معلوم نباشد، خطای روشن می‌دهیم — نه «صفر ردیف».
       */
      if (!request.businessId) {
        throw new AppError('validation_failed', { details: { reason: 'business_required', permission: route.permission } });
      }
      const rows = await scope.query<{ ok: boolean }>('select app.has_permission($1, $2) as ok', [request.businessId, route.permission]);
      if (rows[0]?.ok !== true) {
        throw new AppError('forbidden', { details: { reason: 'missing_permission', permission: route.permission } });
      }
    }
  }

  function sendError(
    response: ServerResponse,
    error: AppError,
    requestId: string,
    status: number,
    headers: Record<string, string>,
    decision?: RateLimitDecision,
  ): void {
    const extra: Record<string, string> = {};
    if (decision && !decision.allowed) {
      extra['retry-after'] = String(decision.retryAfterSeconds);
      extra['ratelimit-limit'] = String(decision.limit);
      extra['ratelimit-remaining'] = '0';
      extra['ratelimit-reset'] = String(Math.max(0, Math.ceil((decision.resetAtMs - services.now()) / 1000)));
    }
    /*
     * پاسخ به خطا و کوکی‌ها: تفکیک این دو، عمدی است.
     *
     *   • `unauthenticated` — کوکی نشست بی‌ارزش است؛ پاکش می‌کنیم تا کلاینت در
     *     حلقهٔ «همیشه ۴۰۱» نیفتد.
     *   • `csrf_failed` — توکن CSRF نبود یا ناهمخوان بود. اینجا **کوکی نشست را
     *     پاک نمی‌کنیم**؛ فقط توکن CSRF را. پاک‌کردن نشست یعنی یک درخواستِ
     *     بدشکل (یا صفحه‌ای که توکنش کهنه شده) کاربر را از حساب بیرون
     *     می‌اندازد — همان اتفاقی که در آزمون واقعی افتاد: یک آزمون CSRF،
     *     کوکی نشست را پاک کرد و بیست آزمون پس از آن ۴۰۱ گرفتند. باطل‌کردن
     *     نشست، پاسخ به *تکرار* نشانه‌های مشکوک است (§13)، نه به یک بار.
     */
    if (error.code === 'unauthenticated') {
      extra['set-cookie'] = clearCookie(cookieName.session, { path: '/', secure, httpOnly: true, sameSite: 'Lax' });
    }
    if (error.code === 'csrf_failed') {
      extra['set-cookie'] = clearCookie(cookieName.csrf, { path: '/', secure, httpOnly: false, sameSite: 'Lax' });
    }

    sendJson(response, errorPayload(error, requestId), { status, headers: { ...headers, ...extra } });
  }

  function pickRequestId(value: string | string[] | undefined): string {
    const candidate = Array.isArray(value) ? value[0] : value;
    // شناسهٔ ورودی فقط اگر شکل امن داشته باشد پذیرفته می‌شود؛ وگرنه، نویسه‌های
    // کنترلی به لاگ و به هدر پاسخ راه پیدا می‌کنند.
    if (typeof candidate === 'string' && REQUEST_ID_PATTERN.test(candidate)) return candidate;
    return uuidv7(services.now());
  }

  return { handle };
}

/* --------------------------------------------------------------- کمکی‌ها */

export function header(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function flattenHeaders(request: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    out[key.toLowerCase()] = Array.isArray(value) ? (value[0] ?? '') : value;
  }
  return out;
}

export function clientIp(request: IncomingMessage, trustProxy: boolean): string | null {
  if (trustProxy) {
    const forwarded = header(request, 'x-forwarded-for');
    if (forwarded) {
      const first = forwarded.split(',')[0]?.trim();
      if (first) return first;
    }
  }
  return request.socket.remoteAddress ?? null;
}

/** راز کلید API هرگز خام ذخیره نمی‌شود؛ همان قاعدهٔ توکن نشست (§9). */
export function hashApiKey(raw: string): string {
  return hashToken(raw);
}

export function describeCause(error: AppError): string {
  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`;
  if (cause === undefined) return 'unknown';
  return typeof cause === 'string' ? cause : JSON.stringify(cause).slice(0, 200);
}

/** تنظیم زمینه برای کارگزار کلید API. */
function apiKeySettings(auth: AuthState): Record<string, string> {
  if (auth.kind !== 'api-key') return {};
  return {
    'app.api_key_id': auth.keyId,
    'app.api_key_business_id': auth.businessId,
    'app.api_key_scopes': auth.scopes.join(','),
  };
}
