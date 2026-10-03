/**
 * رله‌ای بسته به API (گام ۲۷؛ §64–۷۸، §83–۸۵، §191).
 *
 * مرورگر فقط با **همان مبدأ صفحه** حرف می‌زند (`connect-src 'self'`، کوکیِ بی‌دامنهٔ `__Host-`).
 * پس هر درخواستی که از صفحه به API می‌رود — بیکن سنجش عملکرد، و بعداً ورود و پنل — باید زیر مبدأ
 * همان سایت برسد. در استقرار با پروکسی (nginx) همین کار را پروکسی می‌کند؛ این ماژول همان کار را
 * برای حالت تک‌فرایندی/خودمیزبان و توسعه می‌کند، **بی‌آنکه** سیستم موازی بسازد: هیچ منطقی این‌جا
 * نیست — فقط عبور، با فهرست سفید.
 *
 * چهار اصل (هرکدام یک آزمون):
 *
 *   ۱) **فهرست سفید بسته.** فقط (سایت، متد، مسیر) ثبت‌شده عبور می‌کند. هر چیز دیگر همان ۴۰۵/۴۰۴
 *      همیشگی است — وجود یا نبودِ یک مسیر API روی سایت عمومی اوراکل نمی‌سازد.
 *   ۲) **بدنه سقف دارد** (و پیش از رسیدن به API شمرده می‌شود): بدنهٔ بی‌سقف، سیل است.
 *   ۳) **هدرها فهرست سفیدند، نه فهرست سیاه.** `X-Forwarded-For` و `Forwarded` را **ما** می‌گذاریم
 *      (از سوکت)؛ مقداری که کلاینت فرستاده، دور ریخته می‌شود — وگرنه هر کسی IP جعلی می‌ساخت و
 *      محدودیت نرخِ چهاربُعدی (§13) را دور می‌زد. کوکی فقط به مسیرهایی که لازم دارند می‌رسد.
 *   ۴) **شکست API، شکست صریح است:** ۵۰۲/۵۰۴ با بدنهٔ JSON ثابت، بی‌جزئیات داخلی.
 *
 * نکتهٔ استقرار: وقتی این رله بین مرورگر و API است، API باید `TRUST_PROXY=true` داشته باشد تا
 * `X-Forwarded-For` ما را بخواند؛ وگرنه همهٔ درخواست‌ها از یک IP (رله) دیده می‌شوند.
 */

import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';

import type { Logger } from '@petavu/shared';

import type { SiteKind } from './config.js';

export interface ProxyRule {
  readonly name: string;
  readonly sites: readonly SiteKind[];
  readonly methods: readonly string[];
  readonly path: RegExp;
  readonly maxBodyBytes: number;
  /** نوع‌های محتوای مجاز برای بدنه (بدون پارامتر `charset`). */
  readonly contentTypes: readonly string[];
  /** کوکی به API می‌رسد و `Set-Cookie` پاسخ به مرورگر؟ */
  readonly cookies: boolean;
}

/**
 * فهرست سفید. افزودن به آن، یک تصمیم امنیتی است و باید همین‌جا (یک جا، قابل‌بازرسی) دیده شود.
 *
 * بیکن سنجش عملکرد: بی‌نام، بی‌کوکی، فقط JSON، حداکثر ۱۶ کیلوبایت (۲۰ نمونه ≈ ۳ کیلوبایت).
 */
export const PROXY_RULES: readonly ProxyRule[] = [
  {
    name: 'performance.recordVitals',
    sites: ['public'],
    methods: ['POST'],
    path: /^\/api\/v1\/public\/vitals$/,
    maxBodyBytes: 16_384,
    contentTypes: ['application/json', 'text/plain'], // sendBeacon با Blob نوع را می‌گذارد؛ برخی مرورگرها text/plain می‌فرستند.
    cookies: false,
  },
];

export function matchProxyRule(rules: readonly ProxyRule[], site: SiteKind, method: string, pathname: string): ProxyRule | null {
  return rules.find((rule) => rule.sites.includes(site) && rule.methods.includes(method) && rule.path.test(pathname)) ?? null;
}

/** هدرهای پاسخ API که به مرورگر می‌رسند. `set-cookie` فقط وقتی قاعده اجازه بدهد. */
const RESPONSE_HEADERS = ['content-type', 'retry-after', 'x-request-id', 'etag'] as const;

function clientAddress(request: IncomingMessage): string {
  const address = request.socket.remoteAddress ?? '';
  // `::ffff:1.2.3.4` ⇒ `1.2.3.4`
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}

function jsonError(response: ServerResponse, status: number, code: string, requestId: string, extra: Record<string, string> = {}): void {
  const body = JSON.stringify({ code, request_id: requestId });
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-request-id': requestId,
    ...extra,
  });
  response.end(body);
}

export interface ForwardOptions {
  /** مبدأ داخلی API (`http://127.0.0.1:4000`). */
  readonly apiOrigin: string;
  readonly logger: Logger;
  readonly timeoutMs?: number;
  /** سرصفحه‌های امنیتی پایهٔ وب؛ به پاسخ رله هم اعمال می‌شوند. */
  readonly baseHeaders: (requestId: string) => Record<string, string>;
  /**
   * طرح مبدأ عمومی (از پیکربندی). `X-Forwarded-Proto` را **ما** می‌گوییم؛ مقداری که کلاینت فرستاده
   * اعتماد نمی‌شود (هر کسی می‌توانست ادعای https کند).
   */
  readonly proto: 'http' | 'https';
}

/** بیشینهٔ بدنه‌ای که برای «دیدن پاسخ ۴۱۳» تخلیه می‌کنیم؛ بیشتر از آن، اتصال بریده می‌شود. */
const DRAIN_LIMIT = 256 * 1024;

/**
 * بدنه را با سقف می‌خواند. از سقف گذشت ⇒ `null`، **پس از آنکه** پاسخ ۴۱۳ نوشته شد.
 *
 * ترتیب مهم است: بریدن اتصال پیش از پاسخ، کلاینت را با `ECONNRESET` رها می‌کند و علت را نمی‌بیند.
 * بدنهٔ کوچکِ بیش‌ازحد تخلیه می‌شود (تا کلاینت بنویسد و پاسخ را بخواند)، بدنهٔ بزرگ نه: تخلیهٔ
 * گیگابایت‌ها خودش یک حمله است.
 */
async function readLimited(request: IncomingMessage, response: ServerResponse, limit: number, requestId: string): Promise<Buffer | null> {
  const reject = (): null => {
    if (!response.headersSent) jsonError(response, 413, 'payload_too_large', requestId, { connection: 'close' });
    const declared = Number(request.headers['content-length']);
    if (Number.isFinite(declared) && declared > DRAIN_LIMIT) {
      request.destroy();
    } else {
      // تخلیهٔ محدود: نخوانده‌ها دور ریخته می‌شوند و اتصال بعد از سقف بسته می‌شود.
      let drained = 0;
      request.on('data', (chunk: Buffer) => {
        drained += chunk.byteLength;
        if (drained > DRAIN_LIMIT) request.destroy();
      });
      request.on('error', () => undefined);
    }
    return null;
  };

  const declared = request.headers['content-length'];
  if (declared !== undefined && Number(declared) > limit) return reject();

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.byteLength;
    if (size > limit) return reject();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/**
 * عبور یک درخواست از فهرست سفید به API. پاسخ را خودش می‌نویسد.
 */
export async function forwardToApi(
  request: IncomingMessage,
  response: ServerResponse,
  rule: ProxyRule,
  requestId: string,
  options: ForwardOptions,
): Promise<void> {
  const contentType = String(request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (!rule.contentTypes.includes(contentType)) {
    jsonError(response, 415, 'unsupported_media_type', requestId);
    request.resume();
    return;
  }

  const body = await readLimited(request, response, rule.maxBodyBytes, requestId);
  if (body === null) return;

  const upstream = new URL(options.apiOrigin);
  const headers: Record<string, string> = {
    'content-type': contentType === 'text/plain' ? 'application/json' : contentType,
    'content-length': String(body.byteLength),
    accept: 'application/json',
    'x-request-id': requestId,
    'x-forwarded-for': clientAddress(request),
    'x-forwarded-proto': options.proto,
  };
  const origin = request.headers.origin;
  if (typeof origin === 'string') headers.origin = origin;
  const agent = request.headers['user-agent'];
  if (typeof agent === 'string') headers['user-agent'] = agent.slice(0, 300);
  if (rule.cookies && typeof request.headers.cookie === 'string') headers.cookie = request.headers.cookie;

  await new Promise<void>((resolve) => {
    const upstreamRequest = httpRequest(
      {
        protocol: upstream.protocol,
        hostname: upstream.hostname,
        port: upstream.port,
        path: request.url,
        method: request.method,
        headers,
        timeout: options.timeoutMs ?? 5_000,
      },
      (upstreamResponse) => {
        const out: Record<string, string | string[]> = { ...options.baseHeaders(requestId), 'cache-control': 'no-store' };
        for (const name of RESPONSE_HEADERS) {
          const value = upstreamResponse.headers[name];
          if (typeof value === 'string') out[name] = value;
        }
        if (rule.cookies && upstreamResponse.headers['set-cookie']) out['set-cookie'] = upstreamResponse.headers['set-cookie'];
        response.writeHead(upstreamResponse.statusCode ?? 502, out);
        upstreamResponse.pipe(response);
        upstreamResponse.on('end', resolve);
        upstreamResponse.on('error', () => {
          response.destroy();
          resolve();
        });
      },
    );

    const fail = (status: number, code: string): void => {
      options.logger.warn('رلهٔ API شکست خورد', { requestId, rule: rule.name, code });
      if (!response.headersSent) jsonError(response, status, code, requestId);
      else response.destroy();
      resolve();
    };

    upstreamRequest.on('timeout', () => {
      upstreamRequest.destroy();
      fail(504, 'upstream_timeout');
    });
    upstreamRequest.on('error', () => fail(502, 'upstream_unavailable'));
    upstreamRequest.end(body);
  });
}
