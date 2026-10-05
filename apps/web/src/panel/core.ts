/**
 * هستهٔ پنل: نشست، چیدمان، مسیریابی، فرم‌ها (گام ۲۸؛ §11–۱۵، §26–۲۸، §191).
 *
 * پنل یک **BFF بی‌منطق** است: صفحه می‌سازد و هر خواندن/تغییر را به API می‌سپارد. چهار قاعده، هر کدام یک آزمون:
 *
 *   ۱) **مرز مبدأ.** هر POST باید از مبدأ **همین سایت** بیاید (`Origin` برابر مبدأ همین میزبان). API مبدأ را در
 *      فهرست ۵ سایت می‌پذیرد؛ صفحهٔ فروشگاه نباید بتواند فرمی به پنل بفرستد. این‌جا سخت‌گیرتر است.
 *   ۲) **CSRF.** توکن نشست، پنهان در هر فرم؛ همان به API می‌رسد و API می‌سنجد (تنها تصمیم‌گیر). بی‌توکن ⇒ ۴۰۳.
 *   ۳) **هیچ منوی مجوزدهنده‌ای نیست.** منو از API (از داده) می‌آید و فقط ورودی رابط است؛ هر صفحه مجوزش را
 *      دوباره از API می‌گیرد. بخش‌ناشناس یا غیرمجاز: همان ۴۰۴ یکنواخت.
 *   ۴) **بی‌کش و بی‌نمایه.** پاسخ احراز‌شده `no-store` و `noindex` است.
 *
 * هدایت پس از POST (۳۰۳، الگوی PRG) همیشه به **مسیر داخلی** است؛ پارامتر `next` از کاربر خوانده نمی‌شود.
 */

import { verifyCsrfToken } from '@petavu/security';

import { buildHead } from '@petavu/seo';
import type { Logger } from '@petavu/shared';

import type { AssetRegistry } from '../assets.js';
import type { WebConfig } from '../config.js';
import { securityHeaders } from '../headers.js';
import { escapeText, escapeAttr, tag, voidTag } from '../html.js';
import { renderDocument } from '../render.js';
import type { ThemeBundle } from '../theme.js';
import { ApiUnavailableError, type ApiClient, type ApiResponse } from './api.js';
import { parseForm } from './forms.js';
import { actionForm, card, flashBlock, formBlock, pageHeader, type Flash } from './kit.js';
import type { PanelBusiness, PanelCtx, PanelSession, PanelSurface, Section, SectionRegistry } from './types.js';

const BRAND = 'پِتاوو';

export interface PanelDeps {
  readonly api: ApiClient;
  readonly logger: Logger;
  readonly config: WebConfig;
  readonly assets: AssetRegistry;
  readonly theme: ThemeBundle;
  readonly sections: Readonly<Partial<Record<PanelSurface, SectionRegistry>>>;
}

export interface PanelRequest {
  readonly surface: PanelSurface;
  readonly method: 'GET' | 'POST';
  readonly pathname: string;
  readonly search: URLSearchParams;
  readonly cookie: string | null;
  readonly origin: string | null;
  readonly ip: string;
  readonly userAgent: string | null;
  readonly body: string | null;
  readonly contentType: string | null;
  readonly requestId: string;
}

export interface PanelResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly cookies: readonly string[];
  readonly body: string;
}

interface MenuItem {
  readonly key: string;
  readonly label_fa: string;
  readonly path: string;
  readonly availability: string;
  readonly planned_step: number | null;
  readonly description: string | null;
}

/** پیام خطای API، به زبان کاربر؛ بی‌جزئیات فنی. */
export function describeProblem(response: ApiResponse): string {
  const error = (response.json?.['error'] ?? null) as { code?: string; details?: { issues?: Array<{ path?: string }> } } | null;
  switch (response.status) {
    case 400: {
      const paths = (error?.details?.issues ?? []).map((issue) => issue.path).filter(Boolean);
      return paths.length > 0 ? `اطلاعات ناقص یا نادرست است: ${[...new Set(paths)].join('، ')}` : 'اطلاعات ناقص یا نادرست است.';
    }
    case 401:
      return 'نشست شما پایان یافته است؛ دوباره وارد شوید.';
    case 403:
      return 'اجازهٔ این کار را ندارید.';
    case 404:
      return 'موردی که خواستید پیدا نشد.';
    case 409:
      return 'این مورد هم‌زمان تغییر کرده است؛ صفحه را تازه کنید و دوباره تلاش کنید.';
    case 412:
      return 'شرایط انجام این کار برقرار نیست.';
    case 429:
      return 'تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید.';
    default:
      return response.status >= 500 ? 'خطایی در سامانه رخ داد؛ کمی بعد دوباره تلاش کنید.' : 'درخواست انجام نشد.';
  }
}

export function createPanel(deps: PanelDeps): { handle(request: PanelRequest): Promise<PanelResponse> } {
  const { api, logger, config, assets, theme } = deps;
  const production = config.env.isProduction;
  const cookiePrefix = production ? '__Host-' : '';
  const flashName = `${cookiePrefix}${config.env.security.sessionCookieName}_flash`;

  function siteOrigin(surface: PanelSurface): string {
    return config.sites.find((site) => site.kind === surface)?.origin ?? '';
  }

  /* ------------------------------------------------------------------ پاسخ‌ها */

  const baseHeaders = (requestId: string): Record<string, string> => ({
    ...securityHeaders({ env: config.env, kind: 'html', cdnCacheable: false, requestId, cacheable: false }),
    'content-type': 'text/html; charset=utf-8',
    'x-robots-tag': 'noindex, nofollow',
    vary: 'cookie',
  });

  function flashCookie(flash: Flash | null): string {
    const secure = production ? '; Secure' : '';
    if (!flash) return `${flashName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
    const value = Buffer.from(JSON.stringify({ k: flash.kind, t: flash.text.slice(0, 280) }), 'utf8').toString('base64url');
    return `${flashName}=${value}; Path=/; Max-Age=60; HttpOnly; SameSite=Lax${secure}`;
  }

  function readFlash(cookie: string | null): Flash | null {
    const match = cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${flashName}=`));
    if (!match) return null;
    try {
      const parsed = JSON.parse(Buffer.from(match.slice(flashName.length + 1), 'base64url').toString('utf8')) as { k?: unknown; t?: unknown };
      const kind = parsed.k === 'success' || parsed.k === 'error' || parsed.k === 'info' ? parsed.k : null;
      return kind && typeof parsed.t === 'string' ? { kind, text: parsed.t.slice(0, 280) } : null;
    } catch {
      return null; // کوکیِ دست‌کاری‌شده، صرفاً «پیامی نیست»
    }
  }

  function redirect(location: string, requestId: string, cookies: readonly string[] = []): PanelResponse {
    // فقط مسیر داخلی: `//x` و `http:` و هر چیز دیگر ممنوع (هدایت باز).
    const safe = /^\/(?![/\\])[^\s]*$/.test(location) ? location : '/';
    return { status: 303, headers: { ...baseHeaders(requestId), location: safe, 'content-type': 'text/plain; charset=utf-8' }, cookies, body: '' };
  }

  function document(request: PanelRequest, input: { title: string; main: string; themeCss?: string; previewDoc?:string; header?: string; status?: number; cookies?: readonly string[] }): PanelResponse {
    const origin = siteOrigin(request.surface);
    const headTags = buildHead({
      url: `${origin}${request.pathname}`,
      title: `${input.title} | ${BRAND}`,
      description: null,
      indexable: false,
      nonIndexableReason: 'private_area',
      environment: config.environment,
    });
    let main=input.main;
    if(input.previewDoc&&input.themeCss){const stylesheet=assets.registerGenerated('studio-preview.css',input.themeCss,'text/css; charset=utf-8');const doc=input.previewDoc.replace(/\/assets\/preview\.[0-9a-f]+\.css/g,stylesheet.url).split(config.env.origins.public+'/assets/').join('/assets/');main+=`<iframe class="studio-preview__frame" title="پیش‌نمایش خصوصی و ایزولهٔ بسته" sandbox="allow-same-origin" srcdoc="${escapeAttr(doc)}"></iframe>`;}
    const html = renderDocument({
      lang: 'fa-IR',
      dir: 'rtl',
      headTags,
      stylesheets: [assets.url('app.css')],
      preloadUrls: [],
      theme,
      faviconUrl: assets.find('favicon.svg')?.url ?? null,
      siteName: BRAND,
      bodyClass: `panel-body panel-body--${request.surface}`,
      header: input.header ?? '',
      main,
      scripts:request.pathname==='/app/account'&&assets.find('passkeys.js')?[assets.url('passkeys.js')]:[],
      footer: '',
      skip: '<a class="skip-link" href="#main">پرش به محتوای اصلی</a>',
    });
    const headers=baseHeaders(request.requestId);if(input.previewDoc)headers['content-security-policy']=(headers['content-security-policy']??'').replace("frame-src 'none'","frame-src 'self'");
    return { status: input.status ?? 200, headers, cookies: input.cookies ?? [], body: html };
  }

  /* ------------------------------------------------------------------ صفحه‌های بی‌نشست */

  function authPage(request: PanelRequest, mode: 'login' | 'signup', options: { error?: string; status?: number; identifier?: string } = {}): PanelResponse {
    const surfaceName = request.surface === 'admin' ? 'مدیریت پِتاوو' : 'پنل کسب‌وکار';
    const fields =
      mode === 'login'
        ? [
            { name: 'identifier', label: 'ایمیل یا موبایل', type: 'text' as const, required: true, autocomplete: 'username', value: options.identifier ?? '', dir: 'ltr' as const },
            { name: 'password', label: 'رمز عبور', type: 'password' as const, required: true, autocomplete: 'current-password' },
            {name:'totp',label:'کد authenticator (اگر فعال است)',dir:'ltr' as const,maxLength:6},
            {name:'recovery_code',label:'کد بازیابی به جای authenticator',dir:'ltr' as const,maxLength:64},
          ]
        : [
            { name: 'display_name', label: 'نام شما', type: 'text' as const, required: true, autocomplete: 'name' },
            { name: 'identifier', label: 'ایمیل یا موبایل', type: 'text' as const, required: true, autocomplete: 'username', value: options.identifier ?? '', dir: 'ltr' as const },
            { name: 'password', label: 'رمز عبور', type: 'password' as const, required: true, autocomplete: 'new-password', hint: 'دست‌کم ۱۲ نویسه؛ نام و ایمیل شما نباید در آن باشد.' },
          ];
    const body = [
      tag('h1', { class: 'auth__title' }, escapeText(mode === 'login' ? `ورود به ${surfaceName}` : 'ساخت حساب کاربری')),
      options.error ? flashBlock({ kind: 'error', text: options.error }) : '',
      formBlock({ id: mode, action: mode === 'login' ? '/login' : '/signup', csrf: null, fields, submit: mode === 'login' ? 'ورود' : 'ساخت حساب' }),
      request.surface === 'panel'
        ? tag('p', { class: 'field__hint' }, mode === 'login' ? `حساب ندارید؟ ${tag('a', { href: '/signup' }, 'ساخت حساب')}` : `حساب دارید؟ ${tag('a', { href: '/login' }, 'ورود')}`)
        : '',
    ].join('');
    return document(request, { title: mode === 'login' ? 'ورود' : 'ساخت حساب', main: tag('div', { class: 'auth stack' }, body), status: options.status });
  }

  function notFoundPage(request: PanelRequest, session: PanelSession | null, menu: readonly MenuItem[], status = 404): PanelResponse {
    const main = [pageHeader(status === 403 ? 'دسترسی ندارید' : 'این صفحه پیدا نشد'), tag('p', {}, escapeText(status === 403 ? 'این بخش برای حساب شما فعال نیست.' : 'نشانی‌ای که دنبالش بودید وجود ندارد یا برای شما در دسترس نیست.')), tag('p', {}, tag('a', { class: 'button button--primary', href: '/app' }, 'بازگشت به داشبورد'))].join('');
    return session ? shell(request, session, menu, { title: status === 403 ? 'دسترسی ندارید' : 'پیدا نشد', main, status }) : document(request, { title: 'پیدا نشد', main, status });
  }

  /* ------------------------------------------------------------------ چیدمان با نشست */

  function shell(request: PanelRequest, session: PanelSession, menu: readonly MenuItem[], input: { title: string; main: string; themeCss?: string; previewDoc?:string; flash?: Flash | null; status?: number; cookies?: readonly string[] }): PanelResponse {
    const current = request.pathname;
    const navItems = menu.map((item) => {
      if (item.availability === 'planned') {
        return tag('li', {}, tag('span', { class: 'panel-nav__link panel-nav__link--planned', 'aria-disabled': 'true' }, `${escapeText(item.label_fa)} ${tag('small', {}, escapeText(`گام ${item.planned_step ?? ''}`))}`));
      }
      const active = item.path === '/app' ? current === '/app' : current === item.path || current.startsWith(`${item.path}/`);
      return tag('li', {}, tag('a', { class: 'panel-nav__link', href: item.path, 'aria-current': active ? 'page' : null }, escapeText(item.label_fa)));
    });

    const switcher =
      request.surface !== 'admin' && session.businesses.length > 0
        ? tag('form', { class: 'inline-form', method: 'post', action: '/app/switch' }, [
            voidTag('input', { type: 'hidden', name: '_csrf', value: session.csrf }),
            tag('label', { class: 'visually-hidden', for: 'switch-business' }, 'کسب‌وکار فعال'),
            tag('select', { id: 'switch-business', class: 'input input--compact', name: 'business_id' },
              session.businesses.map((business) => tag('option', { value: business.id, selected: business.id === session.activeBusinessId ? true : null }, escapeText(business.name))).join('')),
            tag('button', { class: 'button button--ghost button--small', type: 'submit' }, 'تغییر'),
          ].join(''))
        : '';

    const header = tag('header', { class: 'panel-top' }, tag('div', { class: 'panel-top__inner' }, [
      tag('a', { class: 'brand', href: '/app', 'aria-label': `${BRAND} — داشبورد` }, tag('span', { class: 'brand__name' }, escapeText(BRAND))),
      tag('span', { class: 'panel-top__surface' }, escapeText(request.surface === 'admin' ? 'مدیریت' : 'پنل')),
      switcher,
      tag('span', { class: 'panel-top__user' }, escapeText(session.displayName)),
      tag('form', { class: 'inline-form', method: 'post', action: '/logout' }, [voidTag('input', { type: 'hidden', name: '_csrf', value: session.csrf }), tag('button', { class: 'button button--ghost button--small', type: 'submit' }, 'خروج')].join('')),
    ].join('')));

    const main = (session.impersonatedBy?tag('aside',{class:'flash flash--error',role:'alert'},'ورود با اختیار کاربر فعال است؛ این یک نشست زمان‌دار و حسابرسی‌شده است.'+actionForm({action:'/app/account/impersonation-stop',csrf:session.csrf,label:'پایان ورود با اختیار'}).__html):'')+tag('div', { class: 'panel-layout' }, [
      tag('nav', { class: 'panel-nav', 'aria-label': 'منوی اصلی' }, tag('details', { class: 'panel-nav__toggle', open: true }, [tag('summary', {}, 'منو'), tag('ul', { class: 'panel-nav__list', role: 'list' }, navItems.join(''))].join(''))),
      tag('div', { class: 'panel-content stack' }, [flashBlock(input.flash ?? null), input.main].join('')),
    ].join(''));

    return document(request, { title: input.title, main, header, themeCss:input.themeCss,previewDoc:input.previewDoc,status: input.status, cookies: input.cookies });
  }

  /* ------------------------------------------------------------------ نشست */

  async function loadSession(request: PanelRequest): Promise<{ session: PanelSession | null; unavailable: boolean }> {
    if (!request.cookie) return { session: null, unavailable: false };
    let response: ApiResponse;
    try {
      response = await api.call({ method: 'GET', path: '/api/v1/auth/session', cookie: request.cookie, origin: siteOrigin(request.surface), ip: request.ip, requestId: request.requestId, userAgent: request.userAgent });
    } catch (error) {
      if (error instanceof ApiUnavailableError) return { session: null, unavailable: true };
      throw error;
    }
    if (response.status !== 200 || !response.json) return { session: null, unavailable: false };

    const user = (response.json['user'] ?? {}) as { id?: string; display_name?: string };
    const meta = (response.json['session'] ?? {}) as { id?: string; platform_role?: string | null;impersonated_by?:string|null };
    const businesses = Array.isArray(response.json['businesses']) ? (response.json['businesses'] as Array<Record<string, unknown>>) : [];
    if (typeof user.id !== 'string' || typeof response.json['csrf_token'] !== 'string') return { session: null, unavailable: false };

    return {
      session: {
        sessionId: String(meta.id ?? ''),
        userId: user.id,
        displayName: String(user.display_name ?? ''),
        platformRole: typeof meta.platform_role === 'string' ? meta.platform_role : null,
        impersonatedBy:typeof meta.impersonated_by==='string'?meta.impersonated_by:null,
        activeBusinessId: typeof response.json['active_business_id'] === 'string' ? (response.json['active_business_id'] as string) : null,
        businesses: businesses.flatMap((business): PanelBusiness[] =>
          typeof business['id'] === 'string' ? [{ id: business['id'] as string, name: String(business['name'] ?? ''), slug: typeof business['slug'] === 'string' ? (business['slug'] as string) : null, role_key: typeof business['role_key'] === 'string' ? (business['role_key'] as string) : null }] : [],
        ),
        csrf: response.json['csrf_token'] as string,
      },
      unavailable: false,
    };
  }

  /* ------------------------------------------------------------------ درخواست */

  async function handle(request: PanelRequest): Promise<PanelResponse> {
    try {
      return await route(request);
    } catch (error) {
      if (error instanceof ApiUnavailableError) {
        const page = document(request, { title: 'سرویس در دسترس نیست', main: [pageHeader('سرویس موقتاً در دسترس نیست'), tag('p', {}, escapeText('کمی بعد دوباره تلاش کنید.'))].join(''), status: 502 });
        return page;
      }
      logger.error('پنل شکست خورد', { requestId: request.requestId, path: request.pathname, error: error instanceof Error ? error.message : String(error) });
      return document(request, { title: 'خطای سامانه', main: [pageHeader('خطای غیرمنتظره'), tag('p', { class: 'field__hint' }, `شناسهٔ درخواست: ${tag('code', {}, escapeText(request.requestId))}`)].join(''), status: 500 });
    }
  }

  async function route(request: PanelRequest): Promise<PanelResponse> {
    if (request.method === 'POST' && (request.contentType ?? '').split(';')[0]?.trim() !== 'application/x-www-form-urlencoded') return document(request, { title: 'فرم نامعتبر', main: pageHeader('نوع فرم پذیرفته نیست'), status: 415 });
    const origin = siteOrigin(request.surface);

    // ۱) مرز مبدأ: هر POST، فقط از همین سایت.
    if (request.method === 'POST' && request.origin !== origin) {
      return document(request, { title: 'درخواست نامعتبر', main: pageHeader('درخواست رد شد'), status: 403 });
    }

    const { session, unavailable } = await loadSession(request);
    if (unavailable) throw new ApiUnavailableError();

    const segments = request.pathname.split('/').filter(Boolean);
    const first = segments[0] ?? '';

    // ---------------- بی‌نشست: ورود و ثبت‌نام
    if (request.pathname === '/') return redirect(session ? '/app' : '/login', request.requestId);

    if (request.pathname === '/login' || (request.pathname === '/signup' && request.surface === 'panel')) {
      const mode = request.pathname === '/login' ? 'login' : 'signup';
      if (session && request.method === 'GET') return redirect('/app', request.requestId);
      if (request.method === 'GET') return authPage(request, mode);

      const form = parseForm(request.body ?? '');
      if (!form) return authPage(request, mode, { error: 'اطلاعات فرم نامعتبر است.', status: 400 });
      const payload =
        mode === 'login'
          ? { identifier: form['identifier'] ?? '', password: form['password'] ?? '',...(form['totp']?{totp:form['totp']}:{}),...(form['recovery_code']?{recovery_code:form['recovery_code']}:{}) }
          : { identifier: form['identifier'] ?? '', password: form['password'] ?? '', display_name: form['display_name'] ?? '' };
      const result = await api.call({ method: 'POST', path: mode === 'login' ? '/api/v1/auth/login' : '/api/v1/auth/register', body: payload, origin, ip: request.ip, requestId: request.requestId, userAgent: request.userAgent });
      if (result.status === 200 || result.status === 201) return redirect('/app', request.requestId, result.cookies);
      const message =
        result.status === 429
          ? 'تعداد تلاش‌ها زیاد است؛ کمی بعد دوباره تلاش کنید.'
          : mode === 'login'
            ? 'شناسه یا رمز عبور نادرست است.' // پیام یکسان: وجود حساب افشا نمی‌شود (§13)
            : result.status === 400
              ? describeProblem(result)
              : 'ساخت حساب انجام نشد.';
      return authPage(request, mode, { error: message, status: result.status === 429 ? 429 : result.status === 400 ? 400 : 401, identifier: form['identifier'] ?? '' });
    }

    if (request.pathname === '/logout' && request.method === 'POST') {
      const form = parseForm(request.body ?? '');
      if (session && form?.['_csrf'] && verifyCsrfToken(form['_csrf'], { secret: config.env.security.sessionSecret, sessionId: session.sessionId, nowMs: Date.now() }).ok) {
        const result = await api.call({ method: 'POST', path: '/api/v1/auth/logout', cookie: request.cookie, csrf: form['_csrf'], origin, ip: request.ip, requestId: request.requestId, userAgent: request.userAgent });
        if (result.status !== 200) return document(request, { title: 'خروج انجام نشد', main: pageHeader('خروج انجام نشد'), status: result.status });
        return redirect('/login', request.requestId, [...result.cookies, flashCookie(null)]);
      }
      return document(request, { title: 'فرم نامعتبر', main: pageHeader('توکن امنیتی فرم نامعتبر است'), status: 403 });
    }

    if (first !== 'app') return notFoundPage(request, session, []);
    if (!session) return redirect('/login', request.requestId);

    // ---------------- با نشست
    const form = request.method === 'POST' ? parseForm(request.body ?? '') : null;
    if (request.method === 'POST' && !form) return shell(request, session, [], { title: 'درخواست نامعتبر', main: pageHeader('فرم نامعتبر است'), status: 400 });
    if (request.method === 'POST' && (!form?.['_csrf'] || !verifyCsrfToken(form['_csrf'], { secret: config.env.security.sessionSecret, sessionId: session.sessionId, nowMs: Date.now() }).ok)) return shell(request, session, [], { title: 'درخواست نامعتبر', main: pageHeader('توکن امنیتی فرم نیامد'), status: 403 });

    // سطح مدیریت فقط برای کارمند پلتفرم؛ دیگران همان ۴۰۴ همیشگی را می‌بینند.
    if (request.surface === 'admin' && !session.platformRole) {
      return document(request, { title: 'دسترسی ندارید', main: [pageHeader('دسترسی ندارید'), tag('p', {}, escapeText('این بخش برای کارکنان پلتفرم است.')), actionForm({ action: '/logout', csrf: session.csrf, label: 'خروج' }).__html].join(''), status: 403 });
    }

    const cookies: string[] = [];
    const ctx: PanelCtx = {
      surface: request.surface,
      publicOrigin: config.env.origins.public,
      session,
      url: new URL(request.pathname + (request.search.toString() ? `?${request.search.toString()}` : ''), 'http://panel.invalid'),
      form,
      csrf: form?.['_csrf'] ?? session.csrf,
      async api(method, path, body) {
        const result = await api.call({
          method,
          path,
          cookie: request.cookie,
          csrf: method === 'GET' ? null : (form?.['_csrf'] ?? session.csrf),
          businessId: request.surface !== 'admin' ? session.activeBusinessId : null,
          body,
          origin,
          ip: request.ip,
          requestId: request.requestId,
          userAgent: request.userAgent,
        });
        cookies.push(...result.cookies);
        return result;
      },
      businessPath(suffix = '') {
        if (!session.activeBusinessId) throw new Error('no_active_business');
        return `/api/v1/businesses/${session.activeBusinessId}${suffix}`;
      },
    };

    if (request.method === 'POST' && segments[1] === 'auth' && segments[2] === 'reauth' && segments.length === 3) {
      const result = await ctx.api('POST', '/api/v1/auth/reauth', { password: form?.['password'] ?? '',...(form?.['totp']?{totp:form['totp']}:{}),...(form?.['recovery_code']?{recovery_code:form['recovery_code']}:{}) });
      return redirect('/app', request.requestId, [...cookies, flashCookie({ kind: result.status === 200 ? 'success' : 'error', text: result.status === 200 ? 'هویت برای ۱۵ دقیقه تأیید شد.' : describeProblem(result) })]);
    }

    // کنش‌های عمومی پنل عضو: تغییر کسب‌وکار فعال و ساخت کسب‌وکار.
    if (request.surface !== 'admin' && request.method === 'POST' && segments[1] === 'switch' && segments.length === 2) {
      const result = await ctx.api('POST', '/api/v1/auth/business', { business_id: form?.['business_id'] ?? '' });
      return redirect('/app', request.requestId, [...cookies, flashCookie(result.status === 200 ? { kind: 'success', text: 'کسب‌وکار فعال تغییر کرد.' } : { kind: 'error', text: describeProblem(result) })]);
    }
    if (request.surface !== 'admin' && request.method === 'POST' && segments[1] === 'business' && segments[2] === 'create' && segments.length === 3) {
      const created = await ctx.api('POST', '/api/v1/businesses', { name: form?.['name'] ?? '', business_type_key: form?.['business_type_key'] ?? '' });
      const id = ((created.json?.['business'] ?? {}) as { id?: string }).id;
      if (created.status !== 201 || !id) return redirect('/app', request.requestId, [...cookies, flashCookie({ kind: 'error', text: describeProblem(created) })]);
      await ctx.api('POST', '/api/v1/auth/business', { business_id: id });
      return redirect('/app', request.requestId, [...cookies, flashCookie({ kind: 'success', text: 'کسب‌وکار ساخته شد.' })]);
    }

    // منو (از داده) و بخش.
    const menuResponse = await ctx.api('GET', `/api/v1/panel/menu?surface=${request.surface}`);
    const menu = Array.isArray(menuResponse.json?.['items']) ? (menuResponse.json?.['items'] as MenuItem[]) : [];
    const sectionKey = segments[1] ?? 'dashboard';
    const item = menu.find((candidate) => (candidate.path === '/app' ? sectionKey === 'dashboard' : candidate.path === `/app/${sectionKey}` || candidate.path === `/app/${sectionKey.replace(/_/g, '-')}`));
    if (!item) return notFoundPage(request, session, menu);

    if (item.availability === 'planned') {
      return shell(request, session, menu, {
        title: item.label_fa,
        main: [pageHeader(item.label_fa), card('هنوز ساخته نشده', tag('p', {}, escapeText(`این بخش در گام ${item.planned_step ?? '؟'} نقشهٔ راه ساخته می‌شود. هیچ دادهٔ نمونه‌ای جای آن نمی‌نشیند.`)))].join(''),
        cookies,
      });
    }

    const section: Section | undefined = deps.sections[request.surface]?.[item.key];
    if (!section) {
      // منوی داده‌محور «آماده» می‌گوید، ولی کدی نیست: خطای ما، نه کاربر.
      logger.error('بخش منو پیاده‌سازی نشده', { surface: request.surface, key: item.key });
      return shell(request, session, menu, { title: item.label_fa, main: pageHeader(item.label_fa), status: 501, cookies });
    }

    if (request.method === 'POST') {
      const action = segments[2] && segments[1] !== 'switch' ? segments[2] : null;
      const handler = action ? section.actions?.[action] : undefined;
      if (!handler || segments.length !== 3) return notFoundPage(request, session, menu);
      const outcome = await handler(ctx);
      if ('page' in outcome) return shell(request, session, menu, { title: outcome.page.title, main: outcome.page.html, themeCss:outcome.page.themeCss,previewDoc:outcome.page.previewDoc,status: outcome.page.status, cookies });
      return redirect(outcome.redirect, request.requestId, [...cookies, flashCookie(outcome.flash ?? null)]);
    }

    if (segments.length > 2) return notFoundPage(request, session, menu);

    if (request.surface !== 'admin' && !session.activeBusinessId && !['dashboard','account','notifications'].includes(section.key)) return shell(request, session, menu, { title: section.title, main: pageHeader('ابتدا کسب‌وکار را انتخاب کنید'), status: 200, cookies });
    const rendered = await section.render(ctx);
    return shell(request, session, menu, { title: section.title, main: rendered.html, flash: readFlash(request.cookie), status: rendered.status, cookies: [...cookies, ...(readFlash(request.cookie) ? [flashCookie(null)] : [])] });
  }

  return { handle };
}

