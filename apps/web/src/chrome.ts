/**
 * پوستهٔ مشترک صفحه‌ها: سر، پا، و متن‌های ساختاری (گام ۲۲؛ §103).
 *
 * **متن‌های برند این‌جا فقط «جانشین»‌اند.** جای اصلی متن‌های بازاریابی، جدول
 * `app.content` است (پلتفرم، بی‌کسب‌وکار) و اگر صفحه‌ای منتشر شده باشد، همان
 * نشان داده می‌شود. آنچه این فایل دارد، فقط برچسب‌های ساختاری و یک جملهٔ
 * معرفی است — همان چیزی که در هر سایتی هست و نباید به پایگاه‌داده گره بخورد
 * تا صفحه در نبود داده هم سالم بماند (§181: بدون hardcode داده، ولی بدون
 * شکستن هم).
 *
 * هر عددی که در صفحه دیده می‌شود، **از پایگاه‌داده** می‌آید. هیچ عددی این‌جا
 * دستی نوشته نشده و هیچ ادعایی دربارهٔ کسب‌وکارها ساخته نمی‌شود.
 */

import { createHash } from 'node:crypto';

import type { AssetRegistry } from './assets.js';
import { badge, siteFooter, siteHeader, type NavItem, type FooterColumn } from './components.js';
import type { SitePolicy, WebConfig } from './config.js';
import type { ChromeData, PageContext, PageResponse } from './pages/types.js';
import { renderDocument, textResponse } from './render.js';
import type { ThemeBundle } from './theme.js';
import type { FontSetup } from './fonts.js';
import type { HeadTag } from '@petavu/seo';

/** نام پلتفرم؛ ثابتِ برند است، نه دادهٔ کسب‌وکار. */
export const PLATFORM_NAME = 'پِتاوو';
export const PLATFORM_NAME_LATIN = 'PETAVU';
export const PLATFORM_TAGLINE = 'شبکهٔ کسب‌وکارهای صنعت حیوانات خانگی و اسب';

export interface DocumentShellInput {
  readonly config: WebConfig;
  readonly site: SitePolicy;
  readonly url: URL;
  readonly siteName: string;
  readonly headTags: readonly HeadTag[];
  readonly theme: ThemeBundle;
  readonly fonts: FontSetup;
  readonly assets: AssetRegistry;
  readonly chrome: ChromeData;
  readonly content: string;
  readonly jsonLd?: readonly string[];
  readonly now: Date;
  readonly bodyClass?: string;
  readonly preloadFont?: boolean;
}

/**
 * سند کامل HTML از سر تا پا.
 *
 * «محتوای اصلی» را صفحه ساخته و این‌جا داخل `<main>` می‌نشیند؛ سر و پا از
 * همین تابع می‌آید تا هیچ صفحه‌ای نتواند ناوبری را متفاوت بسازد — و هیچ
 * صفحه‌ای هم نتواند عمداً یا سهواً نشان برند را جا بیندازد.
 */
export function renderShell(input: DocumentShellInput): string {
  const columns = footerColumns(input.chrome, input.site.kind);

  return renderDocument({
    lang: 'fa-IR',
    dir: 'rtl',
    headTags: input.headTags,
    stylesheets: [input.assets.url('app.css')],
    preloadUrls: input.preloadFont === false ? [] : input.fonts.preloadUrls,
    theme: input.theme,
    faviconUrl: input.assets.find('favicon.svg')?.url ?? null,
    siteName: input.siteName,
    jsonLd: input.jsonLd,
    bodyClass: input.bodyClass,
    header: siteHeader({
      siteKind: input.site.kind,
      currentPath: input.url.pathname,
      siteName: input.siteName,
      items: platformNav(input.chrome, input.site.kind),
    }),
    main: input.content,
    footer: siteFooter({
      siteName: input.siteName,
      year: input.now.getFullYear(),
      columns,
      note: PLATFORM_TAGLINE,
    }),
    skip: '<a class="skip-link" href="#main">پرش به محتوای اصلی</a>',
  });
}

/**
 * ناوبری: مسیرهای ساختاری — که همه **همیشه وجود دارند** (§182).
 *
 * پنج مسیر تاکسونومی و جست‌وجو، کدِ خودمان‌اند و بی‌داده هم ۲۰۰ می‌دهند؛ پس
 * پیوند مرده‌ای در ناوبری نیست. صفحه‌های محتوای پلتفرم (قوانین، درباره، …) به
 * شرط انتشار در پاورقی می‌آیند؛ سرصفحه را شلوغ نمی‌کنند.
 */
export function platformNav(_chrome: ChromeData, siteKind: SitePolicy['kind']): NavItem[] {
  if (siteKind !== 'public') return [];
  return [
    { href: '/', label: 'خانه' },
    { href: '/businesses', label: 'کسب‌وکارها' },
    { href: '/t', label: 'انواع' },
    { href: '/i', label: 'صنف‌ها' },
    { href: '/l', label: 'شهرها' },
    { href: '/search', label: 'جست‌وجو' },
  ];
}

export function footerColumns(chrome: ChromeData, siteKind: SitePolicy['kind']): FooterColumn[] {
  if (siteKind !== 'public') return [];

  const pageLinks: NavItem[] = chrome.pages.map((page) => ({ href: `/${page.slug}`, label: page.title }));

  const columns: FooterColumn[] = [
    {
      title: 'پِتاوو',
      items: [
        { href: '/', label: 'صفحهٔ اصلی' },
        { href: '/businesses', label: 'فهرست کسب‌وکارها' },
        { href: '/search', label: 'جست‌وجو' },
      ],
    },
    {
      title: 'کاوش',
      items: [
        { href: '/t', label: 'انواع کسب‌وکار' },
        { href: '/i', label: 'صنف‌ها' },
        { href: '/l', label: 'شهرها و استان‌ها' },
        { href: '/k', label: 'دسته‌های محتوا' },
      ],
    },
  ];

  // صفحه‌های منتشرشدهٔ پلتفرم فقط وقتی هستند که واقعاً هستند.
  if (pageLinks.length > 0) columns.push({ title: 'صفحه‌ها', items: pageLinks });

  columns.push({
    // مسیرهای ماشینی: برای خزنده‌ها مفیدند و برای کاربر هم ضرری ندارند.
    title: 'دسترسی‌ها',
    items: [
      { href: '/sitemap.xml', label: 'نقشهٔ سایت' },
      { href: '/robots.txt', label: 'robots.txt' },
      { href: '/llms.txt', label: 'llms.txt' },
    ],
  });

  return columns;
}

/** نشان «تأییدشده» فقط وقتی داده می‌گوید تأیید شده — نه هر وقت زیبا بود. */
export function verificationBadge(level: string) {
  if (level === 'premium') return badge('تأییدشدهٔ ویژه', 'success');
  if (level === 'identity_verified') return badge('هویت تأییدشده', 'success');
  if (level === 'contact_verified') return badge('تماس تأییدشده');
  return null;
}

/**
 * پاسخ متنی (robots/sitemap/llms) — بدون پوستهٔ HTML.
 *
 * `ETag` از محتوا ساخته می‌شود: خزنده‌ها (و CDN) با `If-None-Match` می‌پرسند «تغییر
 * کرده؟» و نقشهٔ سایتِ بدون تغییر، صفر بایت (۳۰۴) می‌شود.
 */
export function textPageResponse(status: number, kind: PageResponse['kind'], body: string, cacheable = true): PageResponse {
  const text = textResponse(body);
  const etag = `"${createHash('sha256').update(text).digest('hex').slice(0, 24)}"`;
  return { status, kind, body: text, cacheable, seo: false, headers: { etag } };
}

/** پاسخ JSON — برای نقاط بررسی سلامت. */
export function jsonPageResponse(status: number, value: unknown): PageResponse {
  return { status, kind: 'json', body: `${JSON.stringify(value)}\n`, cacheable: false, seo: false };
}

export type { PageContext };
