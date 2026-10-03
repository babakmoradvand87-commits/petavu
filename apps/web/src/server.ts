/**
 * سرور وب (گام ۲۲؛ §64–۷۸، §93–۹۹، Addendum §۹–۱۲).
 *
 * «بدون فریم‌ورک» این‌جا فقط سادگی نیست؛ چهار چیز باید در دست خودمان باشد چون
 * هر کدام یا یک عدد قابل اندازه‌گیری است یا یک مرز امنیتی:
 *
 *   • **هدرها.** CSP سخت، `nosniff`، `frame-ancestors 'none'`، HSTS فقط در
 *     تولید. با فریم‌ورک این‌ها «افزونه» می‌شوند؛ این‌جا، پیش‌فرض.
 *   • **کش.** دارایی درهم‌دار ⇒ `immutable`؛ HTML ⇒ `must-revalidate` + ETag؛
 *     پاسخ خطا ⇒ `no-store`.
 *   • **فشرده‌سازی.** brotli اگر مرورگر بپذیرد، وگرنه gzip، وگرنه خام — با
 *     آستانهٔ ۱ کیلوبایت، چون فشرده‌کردن پاسخ کوچک کار بیهوده است.
 *   • **زمان.** `headersTimeout`/`requestTimeout` بسته می‌شوند تا یک اتصال کند
 *     نتواند ظرفیت سرور را ببلعد.
 *
 * ترتیب پردازش یک درخواست، ثابت و بدون گام پنهان است:
 *   متد ⇒ رمزگشایی مسیر ⇒ میزبان ⇒ ریدایرکت (اسلش/قاعدهٔ داده) ⇒ مسیر ⇒
 *   پاسخ ⇒ ETag/۳۰۴ ⇒ فشرده‌سازی ⇒ لاگ.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { brotliCompressSync, gzipSync } from 'node:zlib';

import type { SqlClient } from '@petavu/db';
import { AppError, createLogger, type Env, type Logger } from '@petavu/shared';

import { createAssetRegistry, type AssetRegistry, type AssetEntry } from './assets.js';
import { PLATFORM_NAME } from './chrome.js';
import { createWebConfig, resolveSite, type SitePolicy, type WebConfig } from './config.js';
import { createWebData, type WebData } from './data.js';
import { createFontSetup, type FontSetup } from './fonts.js';
import { buildTheme, type ThemeBundle } from './theme.js';
import { SHELL_CSS } from './styles.js';
import { canonicalRedirect, decodePath, resolveTarget } from './router.js';
import { notModifiedHeaders, securityHeaders } from './headers.js';
import { businessPage } from './pages/business.js';
import { businessesPage } from './pages/businesses.js';
import { llmsPage, robotsPage, sitemapPage } from './pages/feeds.js';
import { homePage } from './pages/home.js';
import { platformContentPage } from './pages/content.js';
import { gonePage, healthResponse, notFoundPage, readinessResponse } from './pages/system.js';
import type { PageContext, PageResponse } from './pages/types.js';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,64}$/;
const COMPRESS_THRESHOLD = 1024;
const ALLOWED_METHODS = 'GET, HEAD';
const CSS_ASSET = 'app.css';

export interface WebServerOptions {
  readonly client: SqlClient;
  readonly env: Env;
  readonly logger?: Logger;
  /** پوشهٔ دارایی‌ها؛ پیش‌فرض `apps/web/assets`. */
  readonly assetsDirectory: string;
  /** ساعت تزریق‌شده — تست‌ها با آن زمان ثابت می‌سازند. */
  readonly now?: () => Date;
}

export interface RenderRequest {
  readonly method: string;
  readonly url: string;
  readonly host: string;
  readonly headers?: Record<string, string | undefined>;
}

export interface RenderResult {
  readonly status: number;
  readonly headers: Record<string, string>;
  /** بدنهٔ **رمزگشایی‌نشده**؛ فشرده‌سازی، کار لایهٔ شبکه است. */
  readonly body: string;
}

export interface WebServer {
  readonly server: Server;
  readonly config: WebConfig;
  readonly assets: AssetRegistry;
  readonly fonts: FontSetup;
  listen(port: number, host?: string): Promise<{ port: number }>;
  close(): Promise<void>;
  /** رندر یک درخواست بدون سوکت — برای تست و پیش‌گرم. */
  render(request: RenderRequest): Promise<RenderResult>;
  /** CSS نهایی (توکن‌ها + فونت + پوسته). پیش از اولین درخواست ساخته می‌شود. */
  stylesheet(): Promise<string>;
  /** تحلیل نهایی سهم بایت‌های بحرانی — پایهٔ سنجش بودجهٔ عملکرد. */
  budgetSnapshot(): Promise<{ cssBytes: number; fontBytes: number; documents: number }>;
}

export function createWebServer(options: WebServerOptions): WebServer {
  const logger = options.logger ?? createLogger({ level: options.env.logLevel });
  const now = options.now ?? (() => new Date());
  const config = createWebConfig(options.env, { assetsDirectory: options.assetsDirectory });
  const data: WebData = createWebData({ client: options.client, logger });
  const assets = createAssetRegistry({ directory: options.assetsDirectory });

  const fonts = createFontSetup({
    assetsDirectory: options.assetsDirectory,
    assets,
    publicOrigin: options.env.origins.public,
  });

  function cssFor(theme: ThemeBundle): string {
    return [theme.css, fonts.faceCss, SHELL_CSS].join('\n\n');
  }

  /*
   * تم، داده‌ای کم‌تغییر است: یک بار خوانده می‌شود، در حافظه می‌ماند و CSS از
   * آن ساخته می‌شود. اما **بی‌قید و شرط تازه نمی‌شود**؛ تازه‌سازی، از رخداد
   * `design.token` در گام‌های بعد می‌آید (Addendum §۹: کش چندلایه).
   */
  let themePromise: Promise<ThemeBundle> | null = null;
  let cssPromise: Promise<AssetEntry> | null = null;

  const getTheme = (): Promise<ThemeBundle> => (themePromise ??= loadTheme());

  async function loadTheme(): Promise<ThemeBundle> {
    return buildTheme(await awaitTokens());
  }

  async function awaitTokens(): Promise<Parameters<typeof buildTheme>[0]> {
    return data.themeTokens('bootstrap');
  }

  const getCssAsset = (): Promise<AssetEntry> =>
    (cssPromise ??= (async () => {
      const theme = await getTheme();
      return assets.registerGenerated(CSS_ASSET, cssFor(theme), 'text/css; charset=utf-8');
    })());

  /** راه‌اندازی گرم: پرس‌وجوی تم و ثبت CSS، پیش از شنیدن روی پورت. */
  async function warmup(): Promise<void> {
    await getCssAsset();
  }

  async function buildContext(input: {
    url: URL;
    host: string;
    requestId: string;
    site: SitePolicy;
    theme: ThemeBundle;
  }): Promise<PageContext> {
    const [settings, pages, stats, featured, contents] = await Promise.all([
      data.seoSettings(input.requestId),
      data.platformPages(input.requestId),
      data.platformStats(input.requestId),
      data.featuredBusinesses(6, input.requestId),
      data.contentIndex(4, input.requestId),
    ]);

    return {
      config,
      site: input.site,
      url: input.url,
      requestId: input.requestId,
      data,
      assets,
      fonts,
      theme: input.theme,
      settings,
      siteName: PLATFORM_NAME,
      now: now(),
      chrome: { pages, stats, featured, contents },
    };
  }

  async function dispatch(input: {
    url: URL;
    host: string;
    requestId: string;
  }): Promise<RenderResult> {
    const decodedPath = decodePath(input.url.pathname);

    if (decodedPath === null) {
      return plain(400, 'bad request', input.requestId);
    }

    const site = resolveSite(config, input.host);
    if (!site) {
      /*
       * میزبان ناشناس: نه صفحه، نه ریدایرکت. ریدایرکت، `Host` را بازتاب
       * می‌دهد و بازتاب `Host` خودش یک آسیب‌پذیری کلاسیک است.
       */
      return plain(421, 'misdirected request', input.requestId);
    }

    // یک نشانی، یک صفحه: مسیر با اسلش پایانی، به شکل بدون اسلش می‌رود.
    const canonical = canonicalRedirect(decodedPath);
    if (canonical) {
      return redirect(308, `${canonical}${input.url.search}`, input.requestId);
    }

    // قواعد تغییر مسیر داده‌محور (Addendum §۴۵)، پیش از مسیریابی.
    const rule = await data.redirectFor(decodedPath, input.requestId);
    if (rule) {
      if (rule.status_code === 410) {
        const theme = await getTheme();
        const context = await buildContext({ ...input, site, theme });
        return finalize(gonePage(context, { reason: 'redirect_410' }), input.requestId);
      }
      return redirect(rule.status_code, rule.target_path ?? '/', input.requestId);
    }

    const target = resolveTarget(decodedPath, site.kind);

    if (target.type === 'asset') {
      const entry = assets.resolve(`/assets/${target.path}`);
      // دارایی ناموجود: پاسخ متنی ساده، بدون رندر صفحه (این درخواست‌ها ماشینی‌اند).
      if (!entry) return plain(404, 'asset not found', input.requestId);
      return {
        status: 200,
        headers: {
          ...securityHeaders({ env: options.env, kind: 'asset', cdnCacheable: true, requestId: input.requestId }),
          'content-type': entry.contentType,
          etag: `"${entry.hash}"`,
        },
        body: assets.body(entry).toString('utf8'),
      };
    }

    /*
     * CSS باید **پیش از** رندر ثبت شده باشد: صفحه‌ها نشانی دارایی را از
     * رجیستری می‌پرسند. ثبت، یک‌بار انجام می‌شود (memoized) و اگر نشود،
     * «دارایی ناشناخته» می‌گیریم — همان خطایی که در آزمون اول دیدیم.
     */
    await getCssAsset();

    const theme = await getTheme();
    const context = await buildContext({ ...input, site, theme });

    switch (target.type) {
      case 'health':
        return finalize(healthResponse(), input.requestId);
      case 'ready':
        return finalize(await readinessResponse(context), input.requestId);
      case 'robots':
        return finalize(robotsPage(context, { indexingEnabled: await data.indexingEnabled(input.requestId) }), input.requestId);
      case 'llms':
        return finalize(llmsPage(context), input.requestId);
      case 'sitemap':
        return finalize(await sitemapPage(context), input.requestId);
      case 'home':
        return finalize(homePage(context), input.requestId);
      case 'businesses':
        return finalize(await businessesPage(context), input.requestId);
      case 'business':
        return finalize(await businessPage(context, target.slug), input.requestId);
      case 'content':
        return finalize(await platformContentPage(context, target.slug), input.requestId);
      case 'forbidden':
      case 'method_not_allowed':
      case 'not_found':
      default:
        /*
         * سه حالت، یک پاسخ.
         *
         * تفکیک «هست ولی اجازه نداری» از «نیست» یک اوراکل می‌سازد؛ و سطح
         * مدیریتی روی میزبان عمومی نباید حتی وجودش لو برود. پس همه‌جا ۴۰۴.
         */
        return finalize(notFoundPage(context, { reason: `route:${target.type}` }), input.requestId);
    }
  }

  function finalize(response: PageResponse, requestId: string): RenderResult {
    const headers: Record<string, string> = {
      ...securityHeaders({
        env: options.env,
        kind: response.kind,
        cdnCacheable: response.cacheable !== false && response.kind !== 'html',
        requestId,
        cacheable: response.cacheable,
      }),
      ...(response.headers ?? {}),
    };

    if (!headers['content-type']) headers['content-type'] = contentTypeFor(response.kind);
    if (!headers['x-request-id']) headers['x-request-id'] = requestId;

    return { status: response.status, headers, body: response.body };
  }

  function redirect(status: number, location: string, requestId: string): RenderResult {
    return {
      status,
      headers: {
        ...securityHeaders({ env: options.env, kind: 'text', cdnCacheable: false, requestId, cacheable: false }),
        location,
        'content-type': 'text/plain; charset=utf-8',
      },
      body: '',
    };
  }

  function plain(status: number, message: string, requestId: string): RenderResult {
    return {
      status,
      headers: {
        ...securityHeaders({ env: options.env, kind: 'text', cdnCacheable: false, requestId, cacheable: false }),
        'content-type': 'text/plain; charset=utf-8',
      },
      body: `${message}\n`,
    };
  }

  async function render(input: RenderRequest): Promise<RenderResult> {
    const method = input.method.toUpperCase();
    const requestId = pickRequestId(input.headers?.['x-request-id']);

    if (method !== 'GET' && method !== 'HEAD') {
      const result = plain(405, 'method not allowed', requestId);
      return { ...result, headers: { ...result.headers, allow: ALLOWED_METHODS } };
    }

    try {
      const url = new URL(input.url, `http://${input.host || 'unknown'}`);
      return await dispatch({ url, host: input.host, requestId });
    } catch (error) {
      const appError = error instanceof AppError ? error : null;
      logger.error('درخواست وب شکست خورد', {
        requestId,
        url: input.url,
        code: appError?.code ?? 'internal_error',
        error: error instanceof Error ? error.message : String(error),
      });

      /*
       * پاسخ خطا، بی‌جزئیات فنی. `request_id` تنها سرنخ بیرونی است — برای ما
       * کافی است و برای مهاجم بی‌ارزش.
       */
      const status = appError?.status ?? 500;
      const message = status >= 500 ? `internal error (${requestId})` : (appError?.code ?? 'error');
      return plain(status, message, requestId);
    }
  }

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void serveHttp(request, response).catch((error: unknown) => {
      logger.error('پردازش درخواست شکست خورد', { error: error instanceof Error ? error.message : String(error) });
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('internal error\n');
    });
  });

  async function serveHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const started = process.hrtime.bigint();
    const host = request.headers.host ?? '';

    const hasBody =
      (request.headers['content-length'] !== undefined && request.headers['content-length'] !== '0') ||
      request.headers['transfer-encoding'] !== undefined;

    const result = await render({
      method: request.method ?? 'GET',
      url: request.url ?? '/',
      host,
      headers: {
        'x-request-id': typeof request.headers['x-request-id'] === 'string' ? request.headers['x-request-id'] : undefined,
      },
    });

    const headers: Record<string, string> = { ...result.headers };
    const etag = headers.etag;
    const ifNoneMatch = request.headers['if-none-match'];

    // ۳۰۴: همان چیزی که مرورگر دارد ⇒ صفر بایت.
    if (etag && typeof ifNoneMatch === 'string' && ifNoneMatch.split(',').map((part) => part.trim()).includes(etag)) {
      const notModified = notModifiedHeaders(headers, etag);
      response.writeHead(304, notModified);
      response.end();
      logRequest(request, 304, started, notModified);
      return;
    }

    const acceptEncoding = String(request.headers['accept-encoding'] ?? '');
    let body: Buffer = Buffer.from(result.body, 'utf8');

    if (body.byteLength >= COMPRESS_THRESHOLD && isCompressible(headers['content-type'])) {
      const compressed = acceptEncoding.includes('br')
        ? brotliCompressSync(body)
        : acceptEncoding.includes('gzip')
          ? gzipSync(body)
          : body;
      if (compressed !== body) {
        body = compressed;
        headers['content-encoding'] = acceptEncoding.includes('br') ? 'br' : 'gzip';
        headers.vary = 'accept-encoding';
      }
    }

    headers['content-length'] = String(body.byteLength);
    if (hasBody) headers.connection = 'close';

    response.writeHead(result.status, headers);
    // HEAD: هدرها کامل، بدنه خالی (طبق RFC).
    response.end(request.method === 'HEAD' ? undefined : body);
    logRequest(request, result.status, started, headers);
  }

  function logRequest(request: IncomingMessage, status: number, started: bigint, headers: Record<string, string>): void {
    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    const record = {
      requestId: headers['x-request-id'],
      method: request.method,
      url: request.url,
      status,
      durationMs: Math.round(durationMs * 100) / 100,
      bytes: Number(headers['content-length'] ?? 0),
      host: request.headers.host,
    };

    /*
     * سطح لاگ به وضعیت پاسخ گره می‌خورد: خطای سرور `error`، خطای کاربر `warn`،
     * موفقیت `debug`. اگر همه `info` باشند، لاگ موفقیت‌های پرتکرار، سیگنال را
     * زیر نویز دفن می‌کند.
     */
    if (status >= 500) logger.error('پاسخ وب', record);
    else if (status >= 400) logger.warn('پاسخ وب', record);
    else logger.debug('پاسخ وب', record);
  }

  const webServer: WebServer = {
    server,
    config,
    assets,
    fonts,

    async listen(port, host) {
      await warmup();

      await new Promise<void>((resolve) => {
        server.listen(port, host ?? options.env.http.host, () => resolve());
      });

      // سقف زمان: اتصال کند نباید ظرفیت سرور را ببلعد.
      server.headersTimeout = 10_000;
      server.requestTimeout = 15_000;
      server.keepAliveTimeout = 5_000;

      const address = server.address();
      return { port: typeof address === 'object' && address !== null ? address.port : port };
    },

    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },

    render,

    async stylesheet() {
      return assets.body(await getCssAsset()).toString('utf8');
    },

    async budgetSnapshot() {
      const theme = await getTheme();
      const cssBytes = Buffer.byteLength(cssFor(theme), 'utf8');
      return {
        cssBytes,
        fontBytes: fonts.bytes,
        documents: assets.entries.length,
      };
    },
  };

  return webServer;
}

function pickRequestId(candidate: string | undefined): string {
  if (typeof candidate === 'string' && REQUEST_ID_PATTERN.test(candidate)) return candidate;
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function contentTypeFor(kind: PageResponse['kind']): string {
  switch (kind) {
    case 'html':
      return 'text/html; charset=utf-8';
    case 'xml':
      return 'application/xml; charset=utf-8';
    case 'json':
      return 'application/json; charset=utf-8';
    default:
      return 'text/plain; charset=utf-8';
  }
}

function isCompressible(contentType: string | undefined): boolean {
  if (!contentType) return false;
  return /text\/|application\/(xml|json|javascript)/.test(contentType);
}
