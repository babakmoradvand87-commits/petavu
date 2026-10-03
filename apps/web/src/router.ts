/**
 * مسیریابی (گام ۲۲؛ §80–۸۲، Addendum §۱۸۰).
 *
 * مسیریابی این‌جا **جدول تصمیم** است، نه زنجیرهٔ میدل‌ور. دلیلش ساده است: در
 * برنامه‌ای با پنج میزبان، «کدام مسیر روی کدام میزبان معنا دارد» جزو مرز امنیتی
 * است و باید یک‌جا و قابل‌بازرسی باشد، نه پخش‌شده در چند تابع.
 *
 * نامک‌ها **پیش از هر کوئری** اعتبارسنجی می‌شوند. این کار دو فایده دارد: ورودی
 * نامعتبر هرگز به پایگاه‌داده نمی‌رسد، و پاسخ برای «نامک بد» و «نامک ناموجود»
 * یکی است — پس هیچ اوراکلی برای شناسایی موجودیت‌ها ساخته نمی‌شود.
 *
 * قالب نامک، **همان قالب پایگاه‌داده** است (`app.content.slug` و
 * `app.business.slug`): `^[a-z0-9\u0600-\u06ff]+(-[a-z0-9\u0600-\u06ff]+)*$`.
 * فارسی مجاز است چون برند و نام کسب‌وکار فارسی‌اند و §7 نامک را بخشی از
 * نشانی می‌داند، نه بخشی از هویت.
 */

import type { SiteKind } from './config.js';

export const SLUG_PATTERN = /^[a-z0-9\u0600-\u06ff]+(?:-[a-z0-9\u0600-\u06ff]+)*$/;

/** نامک‌هایی که با مسیرهای ساختاری ما برخورد می‌کنند و به محتوا داده نمی‌شوند. */
export const RESERVED_SLUGS = new Set([
  'businesses',
  'assets',
  'healthz',
  'readyz',
  'sitemap.xml',
  'robots.txt',
  'llms.txt',
  'favicon.ico',
  'favicon.svg',
  'api',
]);

export type RouteTarget =
  | { readonly type: 'home' }
  | { readonly type: 'businesses' }
  | { readonly type: 'business'; readonly slug: string }
  | { readonly type: 'content'; readonly slug: string }
  | { readonly type: 'asset'; readonly path: string }
  | { readonly type: 'robots' }
  | { readonly type: 'sitemap' }
  | { readonly type: 'llms' }
  | { readonly type: 'health' }
  | { readonly type: 'ready' }
  | { readonly type: 'method_not_allowed'; readonly allow: string }
  | { readonly type: 'forbidden' }
  | { readonly type: 'not_found' };

const ASSET_PREFIX = '/assets/';

export function resolveTarget(pathname: string, siteKind: SiteKind): RouteTarget {
  // مسیر باید نرمال‌شدهٔ همان چیزی باشد که آمد؛ وگرنه نرمال‌سازی مسیر = حمله.
  if (pathname === '' || !pathname.startsWith('/')) return { type: 'not_found' };

  // دارایی‌ها روی همهٔ میزبان‌ها سرو می‌شوند (CSS و فونت مشترک‌اند).
  if (pathname.startsWith(ASSET_PREFIX)) {
    return { type: 'asset', path: pathname.slice(ASSET_PREFIX.length) };
  }

  if (pathname === '/healthz') return { type: 'health' };
  if (pathname === '/readyz') return { type: 'ready' };

  /*
   * سطح مدیریتی روی میزبان عمومی، **وجود ندارد**. نه ۴۰۳: ۴۰۴. تفاوت مهم است:
   * ۴۰۳ یعنی «هستی ولی اجازه نداری» و شمارش سطح مدیریتی را لو می‌دهد.
   */
  if (siteKind !== 'public' && !(siteKind === 'shop' && pathname === '/')) {
    return { type: 'forbidden' };
  }

  if (pathname === '/') return { type: 'home' };
  if (pathname === '/robots.txt') return { type: 'robots' };
  if (pathname === '/sitemap.xml') return { type: 'sitemap' };
  if (pathname === '/llms.txt') return { type: 'llms' };
  if (pathname === '/businesses') return { type: 'businesses' };
  if (pathname === '/businesses/') return { type: 'businesses' };

  const segments = pathname.split('/').filter((segment) => segment !== '');
  if (segments.length === 2) {
    const [prefix, slug] = segments as [string, string];
    if (prefix === 'b') {
      return SLUG_PATTERN.test(slug) ? { type: 'business', slug } : { type: 'not_found' };
    }
  }
  if (segments.length === 1) {
    const slug = segments[0] as string;
    if (!SLUG_PATTERN.test(slug)) return { type: 'not_found' };
    if (RESERVED_SLUGS.has(slug)) return { type: 'not_found' };
    return { type: 'content', slug };
  }

  return { type: 'not_found' };
}

/**
 * رمزگشایی مسیر.
 *
 * یک بار رمزگشایی و بعد بررسی سخت‌گیرانه. اگر مسیر رمزگشایی‌شده `..`، بک‌اسلش،
 * نویسهٔ صفر یا نویسهٔ کنترلی داشته باشد، **رد** می‌شود. `%2e%2e%2f` و
 * `..%2f` و `%00` همه این‌جا می‌میرند، پیش از آنکه به فایل‌سیستم یا مسیریاب
 * برسند.
 */
export function decodePath(rawPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }

  if (decoded.includes('\0')) return null;
  if (/[\u0000-\u001f\u007f]/.test(decoded)) return null;
  if (decoded.includes('\\')) return null;
  if (decoded.split('/').some((segment) => segment === '..' || segment === '.')) return null;
  if (decoded.length > 512) return null;
  // نیم‌فاصله و نویسه‌های جهت‌دهنده در مسیر، فریب‌دهنده‌اند (RTL spoofing).
  if (/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(decoded)) return null;

  return decoded;
}

/**
 * آیا این درخواست باید ۳۰۵ (ریدایرکت دائمی مسیر) بگیرد؟
 *
 * چرا مهم است: `/businesses/` و `/businesses` دو نشانی برای یک صفحه‌اند. بدون
 * یکی‌کردن، دو نسخه از یک محتوا ساخته می‌شود و کانونیکال بی‌معنا می‌شود.
 */
export function canonicalRedirect(pathname: string): string | null {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.replace(/\/+$/, '');
  return null;
}
