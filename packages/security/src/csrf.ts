/**
 * CSRF — §12
 *
 * دفاع دو لایه، و هر دو لازم است:
 *
 *   لایهٔ اول — بررسی `Origin`. برای هر درخواست تغییردهنده، مبدأ باید یکی از
 *   دامنه‌های خودمان باشد. این لایه ارزان است و جلوی اکثر حملات را می‌گیرد.
 *
 *   لایهٔ دوم — توکن امضاشده و گره‌خورده به نشست. اینجا الگوی «ارسال دوگانهٔ
 *   ساده» کافی نیست: اگر مهاجم بتواند کوکی را در مرورگر قربانی بنشاند (مثلاً
 *   از یک ساب‌دامین خریداری‌شده)، دوگانهٔ ساده دور می‌خورد. پس توکن را با
 *   `session_id` امضا می‌کنیم. توکنِ نشست دیگر، بی‌ارزش است.
 *
 * توکن بدون حالت (stateless) است تا نیازی به نوشتن در پایگاه‌داده در هر
 * بارگذاری صفحه نباشد؛ انقضا در خود توکن است.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { safeEqual } from '@petavu/shared';

const PURPOSE = 'csrf';
const DEFAULT_TTL_MS = 2 * 60 * 60 * 1_000; // دو ساعت

export interface CsrfIssueOptions {
  readonly secret: string;
  readonly sessionId: string;
  readonly nowMs: number;
  readonly ttlMs?: number;
}

/** صدور توکن تازه برای فرم. */
export function issueCsrfToken(options: CsrfIssueOptions): string {
  const ttl = options.ttlMs ?? DEFAULT_TTL_MS;
  const nonce = randomBytes(16).toString('base64url');
  const exp = Math.floor((options.nowMs + ttl) / 1_000);
  const signature = sign(options.secret, options.sessionId, nonce, exp);
  return `${nonce}.${exp}.${signature}`;
}

export type CsrfFailure = 'malformed' | 'signature' | 'expired' | 'session_mismatch';

export interface CsrfVerifyResult {
  readonly ok: boolean;
  readonly reason?: CsrfFailure;
}

export function verifyCsrfToken(
  token: string | null | undefined,
  options: { secret: string; sessionId: string; nowMs: number },
): CsrfVerifyResult {
  if (!token) return { ok: false, reason: 'malformed' };

  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [nonce, expRaw, signature] = parts as [string, string, string];

  const exp = Number(expRaw);
  if (!Number.isSafeInteger(exp) || exp <= 0) return { ok: false, reason: 'malformed' };

  const expected = sign(options.secret, options.sessionId, nonce, exp);
  if (!safeEqual(expected, signature)) return { ok: false, reason: 'session_mismatch' };

  if (exp * 1_000 <= options.nowMs) return { ok: false, reason: 'expired' };

  return { ok: true };
}

function sign(secret: string, sessionId: string, nonce: string, exp: number): string {
  return createHmac('sha256', secret).update(`${PURPOSE}:${sessionId}:${nonce}:${exp}`, 'utf8').digest('base64url');
}

/* ------------------------------------------------------------------ *
 * بررسی مبدأ
 * ------------------------------------------------------------------ */

const UNSAFE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export type OriginCheckReason = 'ok' | 'not_required' | 'origin_missing' | 'origin_invalid' | 'origin_not_allowed';

export interface OriginCheckInput {
  readonly method: string;
  readonly origin?: string | undefined;
  readonly referer?: string | undefined;
  readonly allowedOrigins: readonly string[];
  /** درخواست‌های بدون کوکی (مثل وب‌هوک با امضا) از این بررسی معاف‌اند. */
  readonly exempt?: boolean;
}

export interface OriginCheckResult {
  readonly ok: boolean;
  readonly reason: OriginCheckReason;
}

/**
 * وقتی `Origin` نیست، به `Referer` تکیه می‌کنیم — ولی هرگز به «هیچ‌کدام».
 * درخواستی که مبدأ ندارد و مبدأ لازم دارد، رد می‌شود.
 */
export function checkRequestOrigin(input: OriginCheckInput): OriginCheckResult {
  if (!UNSAFE_METHODS.has(input.method.toUpperCase())) return { ok: true, reason: 'not_required' };
  if (input.exempt === true) return { ok: true, reason: 'not_required' };

  const candidate = input.origin ?? input.referer;
  if (candidate === undefined || candidate === '') return { ok: false, reason: 'origin_missing' };

  const origin = safeOriginOf(candidate);
  if (!origin) return { ok: false, reason: 'origin_invalid' };
  if (origin === 'null') return { ok: false, reason: 'origin_invalid' };

  return input.allowedOrigins.includes(origin) ? { ok: true, reason: 'ok' } : { ok: false, reason: 'origin_not_allowed' };
}

/** مبدأ را به شکل `scheme://host[:port]` درمی‌آورد؛ ورودی خراب → null. */
export function safeOriginOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** مقایسهٔ سادهٔ دو رشته در جای حساس، دوباره استفاده‌شده برای وضوح. */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
