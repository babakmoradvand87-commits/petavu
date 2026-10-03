/**
 * هدرهای پاسخ (گام ۲۲؛ §64–۷۸، Addendum §۹–۱۲).
 *
 * سیاست امنیتی این‌جا سخت‌ترین حالتِ ممکن است، چون ما **هیچ چیزی لازم نداریم**:
 *
 *   • هیچ اسکریپت بیرونی بار نمی‌شود → `script-src 'self'`.
 *   • هیچ استایل درون‌خطی و هیچ `style=""` نیست (CSS از توکن‌ها ساخته می‌شود و
 *     به‌صورت یک فایل می‌آید) → `style-src 'self'` بدون `unsafe-inline`.
 *   • هیچ فونت یا تصویر بیرونی نیست → `font-src 'self'`، `img-src 'self' data:`.
 *   • هیچ فریمی نمی‌پذیریم → `frame-ancestors 'none'`.
 *
 * نکتهٔ مهم: `style-src 'self'` فقط وقتی ممکن است که هیچ‌جا استایل درون‌خطی
 * ننویسیم. اگر روزی کسی `style=` در رندر بگذارد، CSP آن را می‌شکند — و همین
 * خوب است: شکستن در تست، بهتر از اجازه دادن در تولید.
 *
 * COOP/CORP و `X-Frame-Options` هر دو گذاشته می‌شوند: اولی مرز پنجرهٔ مرورگر
 * را می‌بندد و دومی برای مرورگرهای قدیمی‌تر است.
 */

import type { Env } from '@petavu/shared';

export interface HeaderOptions {
  readonly env: Env;
  /** آیا پاسخ، HTML است یا دارایی؟ سیاست هرکدام متفاوت است. */
  readonly kind: 'html' | 'asset' | 'text' | 'xml' | 'json';
  /** آیا می‌توان از کش CDN استفاده کرد؟ صفحه‌های دارای سبد کاربر: نه. */
  readonly cdnCacheable: boolean;
  readonly requestId: string;
  /** `false` = این پاسخ، هدایت‌کننده است و نباید کش شود. */
  readonly cacheable?: boolean;
}

/** مسیرهای صفحه، هرگز `immutable` نیستند. */
const HTML_CACHE = 'public, max-age=0, must-revalidate';
const TEXT_CACHE = 'public, max-age=300';
const ASSET_CACHE = 'public, max-age=31536000, immutable';

export function contentSecurityPolicy(env: Env): string {
  const directives = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "worker-src 'self'",
    "manifest-src 'self'",
  ];

  // ارتقای درخواست‌ها فقط در تولید؛ در توسعه که روی http اجرا می‌شویم،
  // این دستور همه‌چیز را به https می‌فرستد و سایت را می‌شکند.
  if (env.isProduction) directives.push('upgrade-insecure-requests');

  return directives.join('; ');
}

export function securityHeaders(options: HeaderOptions): Record<string, string> {
  const { env, kind, cdnCacheable, requestId } = options;

  const headers: Record<string, string> = {
    'content-security-policy': contentSecurityPolicy(env),
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
    // هیچ‌کدام از این قابلیت‌ها را لازم نداریم؛ بستنشان سطح حمله را کم می‌کند.
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'x-request-id': requestId,
  };

  /*
   * کش، سه پله دارد و هر پله دلیل خودش را دارد:
   *   ۱) دارایی درهم‌دار: یک‌ساله و `immutable` — نشانی عوض می‌شود، نه محتوا.
   *   ۲) صفحهٔ HTML: `max-age=0, must-revalidate` + ETag. صفحه هرگز از کش
   *      مرورگر «کهنه» نمی‌آید، ولی بازدید دوباره ۳۰۴ می‌گیرد (بایت صفر).
   *   ۳) متن ماشینی (robots/sitemap): `s-maxage` کوتاه برای CDN، چون بازتولیدش
   *      ارزان است و نباید بیش از چند دقیقه کهنه بماند.
   */
  if (kind === 'asset') {
    headers['cache-control'] = options.cacheable === false ? 'no-store' : ASSET_CACHE;
  } else if (kind === 'html') {
    headers['cache-control'] = options.cacheable === false ? 'no-store' : HTML_CACHE;
  } else if (cdnCacheable) {
    headers['cache-control'] = options.cacheable === false ? 'no-store' : `${TEXT_CACHE}, s-maxage=300, stale-while-revalidate=600`;
  } else {
    headers['cache-control'] = options.cacheable === false ? 'no-store' : 'no-store';
  }

  /*
   * HSTS فقط در تولید و فقط روی https. اگر آن را در توسعه بفرستیم، مرورگر
   * `localhost` را برای ماه‌ها به https مجبور می‌کند و توسعه می‌شکند.
   */
  if (env.isProduction) {
    headers['strict-transport-security'] = 'max-age=31536000; includeSubDomains; preload';
  }

  return headers;
}

/** هدرهایی که در پاسخ ۳۰۴ هم باید بمانند (امنیت) و آن‌ها که نباید. */
export function notModifiedHeaders(base: Record<string, string>, etag: string): Record<string, string> {
  const headers: Record<string, string> = { ...base, etag };
  delete headers['content-type'];
  delete headers['content-length'];
  delete headers['content-encoding'];
  return headers;
}
