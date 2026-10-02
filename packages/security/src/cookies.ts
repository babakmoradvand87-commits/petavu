/**
 * کوکی‌ها — §9
 *
 * سه قاعدهٔ سخت که اینجا *اجرایی* می‌شوند (نه فقط مستند):
 *
 *   ۱. هیچ کوکی‌ای نباید روی دامنهٔ مادر (`.petavu.ir`) پخش شود. اگر نشست روی
 *      دامنهٔ مادر ست شود، هر ساب‌دامین — از جمله یک ساب‌دامین که کاربر روی آن
 *      محتوا می‌سازد — می‌تواند آن را ببیند یا بازنویسی کند. پس پارامتر
 *      `Domain` به‌کل در این تابع پذیرفته نمی‌شود و کسی نمی‌تواند اشتباهی
 *      اضافه‌ش کند.
 *   ۲. HttpOnly برای هر کوکی نشست اجباری است: اسکریپت صفحه، حتی اگر XSS رخ
 *      بدهد، به توکن نشست دسترسی ندارد.
 *   ۳. پیشوند `__Host-` در محیط امن: مرورگر خودش تضمین می‌کند کوکی با این
 *      پیشوند فقط Secure، فقط بدون Domain و فقط با Path=/ ثبت می‌شود. این
 *      قوی‌ترین تضمینی است که مرورگر به ما می‌دهد.
 */

import { AppError } from '@petavu/shared';

export type SameSiteValue = 'Lax' | 'Strict' | 'None';

export interface CookieOptions {
  readonly path?: string;
  readonly maxAgeSeconds?: number;
  readonly expires?: Date;
  readonly httpOnly?: boolean;
  readonly secure?: boolean;
  readonly sameSite?: SameSiteValue;
  /**
   * عمداً پذیرفته نمی‌شود. اگر روزی لازم شد، باید تصمیم جدید و ADR باشد، نه
   * یک پارامتر در یک فراخوانی.
   */
  readonly domain?: never;
}

/** نویسه‌های مجاز در نام کوکی (RFC 6265). */
const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  if (!COOKIE_NAME_PATTERN.test(name)) {
    throw new TypeError(`نام کوکی نامعتبر است: «${name}»`);
  }
  // تایپ `never` فقط زمان کامپایل را می‌گیرد. اینجا زمان اجرا هم می‌گیریم، چون
  // یک فراخوانی از کد جاوااسکریپت بدون تایپ می‌تواند نشست را روی دامنهٔ مادر
  // پخش کند و همهٔ ساب‌دامین‌ها را در معرض بگذارد (§9).
  if (Object.prototype.hasOwnProperty.call(options, 'domain')) {
    throw new AppError('internal_error', { message: 'تنظیم دامنه برای کوکی مجاز نیست (§9).' });
  }
  if (name.startsWith('__Host-') || name.startsWith('__Secure-')) {
    if (options.secure !== true) throw new AppError('internal_error', { message: 'کوکی با پیشوند امن باید Secure باشد.' });
    if (options.path !== undefined && options.path !== '/') {
      throw new AppError('internal_error', { message: 'کوکی __Host- فقط با Path=/ مجاز است.' });
    }
  }

  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path ?? '/'}`);

  if (options.maxAgeSeconds !== undefined) {
    parts.push(`Max-Age=${Math.floor(options.maxAgeSeconds)}`);
  }
  if (options.expires) {
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.secure !== false) parts.push('Secure');
  parts.push(`SameSite=${options.sameSite ?? 'Lax'}`);

  return parts.join('; ');
}

/** کوکی پاک‌کننده: همان ویژگی‌ها، ولی خالی و منقضی. */
export function clearCookie(name: string, options: CookieOptions = {}): string {
  return serializeCookie(name, '', {
    ...options,
    maxAgeSeconds: 0,
    expires: new Date(0),
  });
}

/**
 * نام کوکی نشست.
 *
 * در محیط امن، پیشوند `__Host-` می‌گیرد. در توسعهٔ محلی روی http این پیشوند
 * کار نمی‌کند (مرورگر کوکی Secure را روی http نمی‌پذیرد)، پس نام ساده می‌ماند.
 * این تفاوت، عمدی و مستند است — نه اینکه در production هم نام ساده بیفتد.
 */
export function sessionCookieName(baseName: string, secure: boolean): string {
  return secure ? `__Host-${baseName}` : baseName;
}

/** خواندن یک کوکی از هدر، بدون وابستگی به چارچوب. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const chunk of header.split(';')) {
    const index = chunk.indexOf('=');
    if (index < 0) continue;
    const key = chunk.slice(0, index).trim();
    if (key !== name) continue;
    const raw = chunk.slice(index + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return null; // درصدگذاری خراب = کوکی نامعتبر
    }
  }
  return null;
}

/** پیکربندی استاندارد کوکی نشست، تا در هر سطح یکسان باشد. */
export function sessionCookie(name: string, token: string, options: { secure: boolean; maxAgeSeconds: number }): string {
  return serializeCookie(name, token, {
    path: '/',
    httpOnly: true,
    secure: options.secure,
    sameSite: 'Lax', // Lax نه None: جلوی ارسال کوکی در درخواست‌های بین‌سایتی را می‌گیرد.
    maxAgeSeconds: options.maxAgeSeconds,
  });
}

/**
 * کوکی CSRF.
 *
 * این کوکی عمداً `HttpOnly` *نیست*: الگوی «ارسال دوگانه» می‌خواهد که کد سمت
 * مرورگر مقدار کوکی را بخواند و در هدر درخواست بگذارد. اگر HttpOnly باشد، این
 * الگو کار نمی‌کند. راز واقعی اینجا نیست؛ راز، امضایی است که سمت سرور بررسی
 * می‌شود (§12).
 */
export function csrfCookie(name: string, value: string, options: { secure: boolean; maxAgeSeconds: number }): string {
  return serializeCookie(name, value, {
    path: '/',
    httpOnly: false,
    secure: options.secure,
    sameSite: 'Lax',
    maxAgeSeconds: options.maxAgeSeconds,
  });
}
