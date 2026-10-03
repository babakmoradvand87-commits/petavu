/**
 * لایهٔ HTTP خام (گام ۲۱؛ §68، §76، §78).
 *
 * چه چیزی اینجا هست و چرا فقط همین: پاسخ JSON، هدرهای امنیتی، CORS محدود،
 * خواندن بدنه با سقف، و کوکی. هیچ چیز دیگری — نه مسیریابی، نه احراز هویت.
 *
 * یک تصمیم مهم: **هیچ فریم‌ورکی نیست.** دلیلش §184 است (بدون وابستگی به
 * فروشنده) و دلیل دوم، که مهم‌تر است: هر فریم‌ورکی یک لایهٔ تصمیم ناشفاف
 * اضافه می‌کند (کدام هدر، کدام ترتیب، کدام پیش‌فرض) و ما دقیقاً روی همان
 * لایه‌ها باید تصمیم امنیتی بگیریم. `node:http` در Node ۲۰ برای این کار کافی
 * است و کل مسیر درخواست، در کد خودمان قابل‌خواندن است.
 */

import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http';
import { AppError, type ErrorCode } from '@petavu/shared';

export const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

/** سقف بدنهٔ درخواست: ۲۵۶ کیلوبایت. بدنهٔ بزرگ‌تر، از پیش رد می‌شود. */
export const MAX_BODY_BYTES = 256 * 1024;

export interface ResponseInit {
  status: number;
  headers?: Record<string, string>;
  cookies?: string[];
  /** برای پاسخ‌های بی‌بدنه (`204`). */
  empty?: boolean;
}

export function sendJson(response: ServerResponse, payload: unknown, init: ResponseInit): void {
  const body = init.empty ? '' : JSON.stringify(payload);
  const headers: OutgoingHttpHeaders = {
    'content-type': JSON_CONTENT_TYPE,
    'content-length': String(Buffer.byteLength(body)),
    ...(init.headers ?? {}),
  };

  if (init.cookies && init.cookies.length > 0) headers['set-cookie'] = init.cookies;

  response.writeHead(init.status, headers);
  response.end(body);
}

/**
 * هدرهای امنیتی، در یک جا.
 *
 * CSP اینجا سخت‌گیر است چون API هیچ HTML برنمی‌گرداند: اگر مرورگری چیزی از این
 * دامنه رندر کرد، یعنی چیزی اشتباه است. `default-src 'none'` همان را می‌گوید.
 */
export function securityHeaders(env: { isProduction: boolean }): Record<string, string> {
  const headers: Record<string, string> = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'cross-origin-resource-policy': 'same-site',
    'cache-control': 'no-store',
  };

  // HSTS فقط وقتی معنا دارد که سایت با HTTPS سرو شود؛ در توسعه، مرورگر را
  // برای دامنهٔ محلی قفل نمی‌کنیم.
  if (env.isProduction) headers['strict-transport-security'] = 'max-age=31536000; includeSubDomains';
  return headers;
}

/**
 * CORS.
 *
 * فقط دامنه‌های خودمان، با `credentials: true`، و همیشه با `Vary: Origin`.
 * ستاره‌کردن (`*`) همراه کوکی، همان‌قدر خطرناک است که بستن CSRF.
 */
export function corsHeaders(origin: string | null, allowed: readonly string[]): Record<string, string> {
  const headers: Record<string, string> = { vary: 'Origin' };
  if (origin !== null && allowed.includes(origin)) {
    headers['access-control-allow-origin'] = origin;
    headers['access-control-allow-credentials'] = 'true';
    headers['access-control-allow-headers'] = 'content-type, x-csrf-token, x-business-id, x-request-id, x-impersonate';
    headers['access-control-allow-methods'] = 'GET, POST, PATCH, PUT, DELETE, OPTIONS';
    headers['access-control-max-age'] = '600';
  }
  return headers;
}

export interface ReadBodyResult {
  readonly raw: string;
  readonly json: unknown;
}

/** خواندن بدنه با سقف بایت؛ بدنهٔ بزرگ، خطای ۴۱۳ می‌گیرد نه حافظهٔ برنامه. */
export async function readBody(request: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<ReadBodyResult> {
  const declared = Number(request.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new AppError('payload_too_large', { details: { limit_bytes: maxBytes } });
  }

  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.byteLength;
    if (total > maxBytes) {
      // بدنهٔ نیمه‌خوانده را رها می‌کنیم؛ ادامهٔ خواندن، حملهٔ حافظه است.
      request.destroy();
      throw new AppError('payload_too_large', { details: { limit_bytes: maxBytes } });
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.trim() === '') return { raw: '', json: undefined };

  const contentType = String(request.headers['content-type'] ?? '');
  if (!contentType.includes('application/json') && !contentType.includes('+json')) {
    throw new AppError('unsupported_media_type', { details: { received: contentType.split(';')[0] ?? 'none' } });
  }

  try {
    return { raw, json: JSON.parse(raw) as unknown };
  } catch {
    throw new AppError('validation_failed', {
      message: 'بدنهٔ درخواست JSON معتبر نبود.',
      details: { reason: 'malformed_json' },
    });
  }
}

export function statusForCode(code: ErrorCode): number {
  return new AppError(code).status;
}
