/**
 * توکن‌ها — §11
 *
 * قاعدهٔ مرکزی: توکنی که به مرورگر می‌رود، خودش یک رازِ تصادفی است؛ چیزی که در
 * پایگاه‌داده می‌ماند، فقط درهم آن است.
 *
 * چرا درهم توکن با SHA-256 و نه Argon2:
 * توکن ۲۵۶ بیت آنتروپی دارد. برای چنین چیزی، حملهٔ فرهنگ‌واژه بی‌معناست؛ پس
 * کند کردن عمدی، فقط تأخیر بی‌دلیل روی هر درخواست می‌شود. درهم تند، همان
 * امنیت را می‌دهد و اگر پایگاه‌داده لو برود، توکن‌ها همچنان بی‌استفاده‌اند.
 *
 * شکل توکن نشست: `<session_id>.<secret>`
 *   * `session_id` شناسهٔ عمومی ردیف نشست است؛ راز نیست و جست‌وجو را O(1)
 *     می‌کند (بدون اسکن جدول و بدون حملهٔ زمان‌سنجی روی ایندکس).
 *   * `secret` راز است و فقط درهمش ذخیره می‌شود.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { assertUuid, foldForCompare, isUuid, safeEqual } from '@petavu/shared';

export const SESSION_TOKEN_VERSION = 'pv1';

const SECRET_BYTES = 32; // ۲۵۶ بیت

/** درهم توکن برای ذخیره‌سازی. پیشوند `sha256:` اجازهٔ مهاجرت الگوریتم می‌دهد. */
export function hashToken(token: string): string {
  return `sha256:${createHash('sha256').update(token, 'utf8').digest('hex')}`;
}

/**
 * درهم شناسهٔ شخصی، برای کلید محدودیت نرخ و شمارنده‌ها.
 *
 * چرا نرمال می‌کنیم: «+98 912 000 0000» و «+989120000000» و «۰۹۱۲…» یک شماره‌اند.
 * اگر خام درهم شوند، سه کلید جدا می‌سازند و سقف دور می‌خورد. نرمال‌سازی اینجا
 * همان قاعدهٔ متن فارسی را دنبال می‌کند، نه یک قاعدهٔ محلی دوم.
 */
export function hashIdentifier(value: string): string {
  const normalized = foldForCompare(value).replace(/[\s\u200c]+/g, '');
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export interface MintedSessionToken {
  /** مقداری که در کوکی می‌نشیند. */
  readonly token: string;
  /** مقداری که در پایگاه‌داده ذخیره می‌شود. */
  readonly secretHash: string;
  readonly sessionId: string;
}

export function mintSessionToken(sessionId: string): MintedSessionToken {
  assertUuid(sessionId, 'شناسهٔ نشست');
  const secret = randomBytes(SECRET_BYTES).toString('base64url');
  const token = `${SESSION_TOKEN_VERSION}.${sessionId}.${secret}`;
  return { token, secretHash: hashToken(secret), sessionId };
}

export interface ParsedSessionToken {
  readonly sessionId: string;
  readonly secret: string;
}

/**
 * تجزیهٔ توکن. ورودی نامعتبر → `null` (نه استثنا): این تابع روی داده‌ای کار
 * می‌کند که کاربر کنترلش می‌کند، پس «خالی» پاسخ درست است.
 */
export function parseSessionToken(token: string): ParsedSessionToken | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [version, sessionId, secret] = parts as [string, string, string];
  if (version !== SESSION_TOKEN_VERSION) return null;
  if (!isUuid(sessionId)) return null;
  if (secret.length < 32) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(secret)) return null;
  return { sessionId: sessionId.toLowerCase(), secret };
}

/** بررسی راز نشست در برابر درهم ذخیره‌شده، به‌صورت ثابت‌زمان. */
export function verifySessionSecret(storedHash: string, secret: string): boolean {
  return safeEqual(storedHash, hashToken(secret));
}

/**
 * توکن امضاشده با محتوا — برای ایمیل تأیید، بازیابی رمز، دعوت‌نامه.
 *
 * قالب: `<payload>.<exp>.<purpose>.<signature>` و امضا روی همهٔ بخش‌های قبلی،
 * شامل `purpose` و `exp`.
 *
 * نکتهٔ امنیتی مهم: `purpose` داخل امضا است. بدون آن، توکنی که برای «تغییر
 * ایمیل» صادر شده بود، می‌شد برای «بازیابی رمز» به کار برد. این نوع جابه‌جایی
 * (token confusion) یکی از رایج‌ترین راه‌های دور زدن این مکانیزم است.
 */
export interface SignTokenOptions {
  readonly secret: string;
  readonly purpose: string;
  readonly payload: Record<string, unknown>;
  readonly expiresInMs: number;
  readonly nowMs: number;
}

export function signToken(options: SignTokenOptions): string {
  const body = base64urlEncode(JSON.stringify(options.payload));
  const exp = Math.floor((options.nowMs + options.expiresInMs) / 1_000);
  const unsigned = `${body}.${exp}.${options.purpose}`;
  const signature = createHmac('sha256', options.secret).update(unsigned, 'utf8').digest('base64url');
  return `${unsigned}.${signature}`;
}

export interface VerifiedToken {
  readonly payload: Record<string, unknown>;
  readonly expiresAt: number;
  readonly purpose: string;
}

export type TokenVerification =
  | { readonly ok: true; readonly token: VerifiedToken }
  | { readonly ok: false; readonly reason: 'malformed' | 'signature' | 'expired' | 'purpose' };

export function verifyToken(
  token: string,
  options: { secret: string; purpose: string; nowMs: number },
): TokenVerification {
  const parts = token.split('.');
  if (parts.length !== 4) return { ok: false, reason: 'malformed' };
  const [body, expRaw, purpose, signature] = parts as [string, string, string, string];

  const expected = createHmac('sha256', options.secret).update(`${body}.${expRaw}.${purpose}`, 'utf8').digest('base64url');
  const provided = Buffer.from(signature, 'utf8');
  const wanted = Buffer.from(expected, 'utf8');
  if (provided.length !== wanted.length || !timingSafeEqual(provided, wanted)) {
    return { ok: false, reason: 'signature' };
  }

  if (purpose !== options.purpose) return { ok: false, reason: 'purpose' };

  const expSeconds = Number(expRaw);
  if (!Number.isSafeInteger(expSeconds)) return { ok: false, reason: 'malformed' };
  if (expSeconds * 1_000 <= options.nowMs) return { ok: false, reason: 'expired' };

  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(base64urlDecode(body));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ok: false, reason: 'malformed' };
    payload = parsed as Record<string, unknown>;
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  return { ok: true, token: { payload, expiresAt: expSeconds * 1_000, purpose } };
}

/** امضای بدنهٔ درخواست — برای وب‌هوک‌ها و کلیدهای ایدمپوتنت (§106). */
export function signBody(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

export function verifyBodySignature(secret: string, body: string, signature: string): boolean {
  const expected = Buffer.from(signBody(secret, body), 'utf8');
  const provided = Buffer.from(signature, 'utf8');
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

/** کد عددی کوتاه — برای تأیید دومرحله‌ای پیامکی و کد بازیابی (§11). */
export function numericCode(digits = 6): string {
  if (digits < 4 || digits > 10) throw new RangeError('طول کد باید بین ۴ و ۱۰ باشد');
  const max = 10 ** digits;
  let value: number;
  do {
    value = randomBytes(4).readUInt32BE(0) % max;
  } while (value >= max);
  return String(value).padStart(digits, '0');
}

/** کد بازیابی، خوانا و دسته‌بندی‌شده: `A1B2-C3D4-E5F6`. */
export function recoveryCode(groups = 4, groupSize = 4): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // بدون نویسه‌های شبیه‌به‌هم
  const parts: string[] = [];
  for (let group = 0; group < groups; group += 1) {
    let part = '';
    for (const byte of randomBytes(groupSize)) part += alphabet[byte % alphabet.length]!;
    parts.push(part);
  }
  return parts.join('-');
}

export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function base64urlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64urlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}
