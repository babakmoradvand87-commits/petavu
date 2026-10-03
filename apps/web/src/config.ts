/**
 * پیکربندی وب (گام ۲۲؛ §80–۸۲، §78).
 *
 * پنج میزبان، یک برنامه (§ قانون ۵ کاربر: یک سایت + چهار زیردامنهٔ مستقل).
 * این ماژول تعیین می‌کند درخواست به کدام «نقش سایت» رسیده است — و مهم‌تر،
 * تعیین می‌کند کدام مسیرها روی کدام میزبان مجازند.
 *
 * چرا این تفکیک امنیتی است، نه سلیقه‌ای: اگر پنل و ادمین‌پنل روی میزبان عمومی
 * هم سرو شوند، هر صفحهٔ عمومی می‌تواند قربانیِ CSRF/clickjacking روی سطح
 * مدیریتی شود و کوکی‌های همان دامنه مشترک می‌شوند. جداسازی میزبان، ساده‌ترین
 * جداسازی «مرز امنیتی» است.
 *
 * میزبان ناشناس، **هیچ‌چیز** نمی‌گیرد: نه ریدایرکت با `Host` بی‌اعتبار (که
 * خودش یک نشتی است)، نه صفحه. جواب ۴۲۱ با بدنهٔ متنی ثابت.
 */

import type { Env } from '@petavu/shared';

export const SITE_KINDS = ['public', 'panel', 'admin', 'shop', 'admin_shop'] as const;
export type SiteKind = (typeof SITE_KINDS)[number];

export type SeoEnvironment = 'production' | 'staging' | 'development' | 'preview';

export interface SitePolicy {
  readonly kind: SiteKind;
  readonly origin: string;
  readonly host: string;
  /** پیشوندهای مسیر مجاز روی این میزبان. */
  readonly pathPrefixes: readonly string[];
  /** نمایه‌پذیری برای موتورها. پنل و ادمین هرگز. */
  readonly indexable: boolean;
}

export interface WebConfig {
  readonly env: Env;
  readonly environment: SeoEnvironment;
  readonly sites: readonly SitePolicy[];
  /** دارایی‌های عمومی (فونت/CSS) — روی همهٔ میزبان‌ها سرو می‌شوند. */
  readonly assetsDirectory: string;
  /** میزبان‌هایی که پیش‌بارگذاری فونت روی‌شان معنا دارد. */
  readonly preloadFontOn: readonly SiteKind[];
  /** نشانی راهنمای API برای همین محیط؛ داده از API می‌آید یا مستقیم از DB. */
  readonly apiBasePath: string;
}

const PANEL_PREFIXES = ['/', '/login', '/signup', '/verify', '/reset', '/invite', '/app'] as const;
const ADMIN_PREFIXES = ['/', '/login', '/app'] as const;
const SHOP_PREFIXES = ['/', '/cart', '/checkout', '/order', '/orders', '/search', '/s', '/p'] as const;
const ADMIN_SHOP_PREFIXES = ['/', '/login', '/app', '/orders', '/catalog'] as const;

/**
 * میزبان، **بدون پورت**.
 *
 * پورت بخشی از هویت سایت نیست: `panel.localhost:3000` در توسعه و
 * `panel.petavu.ir` در تولید، یک سایت‌اند. اگر پورت را نگه داریم، هر درخواستی
 * که پورت را ننویسد (که در تولید همیشه است) ناشناس تلقی می‌شود و ۴۲۱ می‌گیرد.
 */
function hostOf(origin: string): string {
  return new URL(origin).hostname.toLowerCase();
}

function policy(kind: SiteKind, origin: string, prefixes: readonly string[], indexable: boolean): SitePolicy {
  return { kind, origin, host: hostOf(origin), pathPrefixes: prefixes, indexable };
}

/**
 * تبدیل محیط پلتفرم به محیط سئو.
 *
 * `test` عمداً به `development` نگاشت می‌شود و نه `production`: اگر روزی کسی
 * تست را روی نشانی عمومی اجرا کند، خطرِ ایندکس‌شدن باید صفر بماند و نه «بعید».
 */
export function seoEnvironment(env: Env): SeoEnvironment {
  if (env.env === 'production') return 'production';
  if (env.env === 'staging') return 'staging';
  return 'development';
}

export interface WebConfigOptions {
  readonly assetsDirectory: string;
  readonly apiBasePath?: string;
}

export function createWebConfig(env: Env, options: WebConfigOptions): WebConfig {
  const sites: SitePolicy[] = [
    policy('public', env.origins.public, ['/'], true),
    policy('panel', env.origins.panel, PANEL_PREFIXES, false),
    policy('admin', env.origins.admin, ADMIN_PREFIXES, false),
    policy('shop', env.origins.shop, SHOP_PREFIXES, false),
    policy('admin_shop', env.origins.adminShop, ADMIN_SHOP_PREFIXES, false),
  ];

  return {
    env,
    environment: seoEnvironment(env),
    sites,
    assetsDirectory: options.assetsDirectory,
    // پیش‌بارگذاری فونت فقط جایی که متن، محتوای اصلی است. در پنل، فونت
    // بحرانی نیست و پیش‌بارگذاری‌اش صف شبکه را پر می‌کند.
    preloadFontOn: ['public', 'shop'],
    apiBasePath: options.apiBasePath ?? '/api/v1',
  };
}

/** برای تست و برای لاگ: میزبان‌ها بدون پورت. */
export function siteHosts(config: WebConfig): string[] {
  return config.sites.map((site) => site.host);
}

export function normalizeHost(rawHost: string | undefined): string {
  if (!rawHost) return '';
  const withoutPort = rawHost.split(':')[0] ?? '';
  return withoutPort.trim().toLowerCase().replace(/\.$/, '');
}

/**
 * کدام سایت؟ نبودِ تطابق ⇒ `null` (نه «پیش‌فرضِ عمومی»).
 *
 * استثنای توسعه: روی `localhost`/`127.0.0.1` می‌توان همهٔ سایت‌ها را با
 * پیشوند آزمایش کرد، ولی حتی در توسعه هم میزبانِ ناشناس پذیرفته نمی‌شود.
 */
export function resolveSite(config: WebConfig, rawHost: string | undefined): SitePolicy | null {
  const host = normalizeHost(rawHost);
  if (host === '') return null;

  for (const site of config.sites) {
    if (site.host === host) return site;
  }

  if (!config.env.isProduction) {
    // `localhost` و `127.0.0.1` در توسعه ⇒ سایت عمومی؛ تا `npm start` ساده کار کند.
    if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1') {
      return config.sites[0] ?? null;
    }
  }

  return null;
}

/**
 * مسیر روی این میزبان مجاز است؟
 *
 * پیشوند `'/'` یعنی **همهٔ مسیرها** — همان چیزی که سایت عمومی می‌خواهد. اگر
 * معنایش «فقط ریشه» بود، هر مسیر تازه‌ای (مثل `/b/:slug`) به‌طور پیش‌فرض بسته
 * می‌شد و باید دستی باز می‌شد؛ آن الگو، دیر یا زود یک مسیر فراموش‌شده می‌سازد.
 * میزبان‌های مدیریتی که فهرست بسته دارند، از همان فهرست بسته پیروی می‌کنند.
 */
export function isPathAllowed(site: SitePolicy, pathname: string): boolean {
  if (site.pathPrefixes.includes('/')) return true;
  if (pathname === '/') return true;
  return site.pathPrefixes.some((prefix) => prefix !== '/' && (pathname === prefix || pathname.startsWith(`${prefix}/`)));
}
