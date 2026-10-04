/**
 * صفحه‌های سیستمی: ۴۰۴، ۴۱۰، و نگهبان‌های بررسی سلامت (گام ۲۲؛ §93–۹۹).
 *
 * دو قاعده:
 *
 *   ۱) **صفحهٔ خطا، `noindex` است.** اگر ۴۰۴ نمایه شود، موتور فهرست بلندی از
 *      نشانی‌های مرده نگه می‌دارد و اعتبار سایت را می‌خورد.
 *   ۲) **پیام خطا، افشاگر نیست.** نه نسخهٔ پایگاه‌داده، نه نام جدول، نه `stack`.
 *      برای کاربر یک جمله و یک راه؛ برای ما، `request_id` که در لاگ دنبالش
 *      می‌رویم. `request_id` تنها چیزی است که به بیرون می‌رود، چون بدون آن
 *      گزارش کاربر بی‌فایده است و خودش هیچ رازی ندارد.
 */

import { buildHead } from '@petavu/seo';

import { container, heading, paragraph, section } from '../components.js';
import { PLATFORM_NAME, jsonPageResponse, renderShell } from '../chrome.js';
import { escapeText } from '../html.js';
import { searchForm } from './search.js';
import type { PageContext, PageResponse } from './types.js';

export interface ErrorPageOptions {
  readonly reason: string;
  /** متن قابل‌نمایش؛ کوتاه و بی‌جزئیات فنی. */
  readonly message?: string;
}

export function notFoundPage(context: PageContext, options: ErrorPageOptions): PageResponse {
  return errorDocument(context, 404, {
    title: 'این صفحه پیدا نشد',
    message: options.message ?? 'نشانی‌ای که دنبالش بودید وجود ندارد یا جابه‌جا شده است.',
    reason: options.reason,
    link: { href: '/businesses', label: 'دیدن فهرست کسب‌وکارها' },
    /*
     * ۴۰۴ بن‌بست نیست: کسی که به نشانی مرده رسیده، هنوز چیزی می‌خواهد. جست‌وجو و
     * مسیرهای کاوش، همان چیزی است که صفحهٔ بعدی‌اش می‌شود (و برای خزنده هم
     * پیوندهای زنده‌ای هستند که از ۴۰۴ به سایت برمی‌گردند).
     */
    extra:
      searchForm('', { id: 'q-404' }) +
      `<p class="cluster">` +
      `<a class="button button--ghost" href="/t">انواع کسب‌وکار</a>` +
      `<a class="button button--ghost" href="/i">صنف‌ها</a>` +
      `<a class="button button--ghost" href="/l">شهرها</a>` +
      `</p>`,
  });
}

export function gonePage(context: PageContext, options: ErrorPageOptions): PageResponse {
  return errorDocument(context, 410, {
    title: 'این محتوا برای همیشه برداشته شد',
    message: options.message ?? 'این صفحه دیگر وجود ندارد و جانشینی هم ندارد.',
    reason: options.reason,
    link: { href: '/', label: 'بازگشت به صفحهٔ اصلی' },
  });
}

export function serverErrorPage(context: PageContext, options: ErrorPageOptions): PageResponse {
  return errorDocument(context, 500, {
    title: 'خطای غیرمنتظره',
    message: options.message ?? 'مشکلی در سمت ما رخ داد. دوباره تلاش کنید؛ اگر تکرار شد، همین شناسه را بگویید.',
    reason: options.reason,
    link: { href: '/', label: 'بازگشت به صفحهٔ اصلی' },
  });
}

interface ErrorDocumentOptions {
  readonly title: string;
  readonly message: string;
  readonly reason: string;
  readonly link: { href: string; label: string };
  /** HTML اضافه (ساخته‌شده با سازنده‌های امن) که پس از دکمهٔ اصلی می‌آید. */
  readonly extra?: string;
}

function errorDocument(context: PageContext, status: number, options: ErrorDocumentOptions): PageResponse {
  const { config, site, url, requestId } = context;
  const origin = config.env.origins.public;

  const headTags = buildHead({
    url: `${origin}${url.pathname}`,
    title: `${options.title} | ${PLATFORM_NAME}`,
    description: options.message,
    // صفحهٔ خطا هرگز نمایه نمی‌شود — حتی در محیط تولید.
    indexable: false,
    nonIndexableReason: options.reason,
    environment: config.environment,
  });

  const body = section({
    children: container(
      heading(1, options.title) +
        paragraph(options.message) +
        `<p><a class="button button--primary" href="${options.link.href}">${escapeText(options.link.label)}</a></p>` +
        (options.extra ? `<div class="section--tight stack">${options.extra}</div>` : '') +
        `<p class="field__hint">شناسهٔ درخواست: <code>${escapeText(requestId)}</code></p>`,
    ),
  });

  const html = renderShell({
    config,
    site,
    url,
    siteName: PLATFORM_NAME,
    headTags,
    theme: context.theme,
    stylesheetUrl: context.stylesheetUrl,
    fonts: context.fonts,
    assets: context.assets,
    chrome: context.chrome,
    now: context.now,
    content: body,
    bodyClass: 'page-error',
  });

  return { status, kind: 'html', body: html, cacheable: false };
}

/**
 * زنده‌بودن فرایند: **بدون** پایگاه‌داده.
 *
 * چرا جدا: اگر این بررسی به پایگاه‌داده وابسته باشد، در قطعی پایگاه‌داده
 * ارکستراتور همهٔ نمونه‌ها را می‌کشد و شبکه خالی می‌ماند. `/healthz` می‌گوید
 * «فرایند زنده است»؛ `/readyz` می‌گوید «آمادهٔ سرو کردن هستم».
 */
export function healthResponse(): PageResponse {
  return jsonPageResponse(200, { status: 'ok', service: 'petavu-web' });
}

export async function readinessResponse(context: PageContext): Promise<PageResponse> {
  const snapshot = await context.data.readiness(context.requestId);
  if (!snapshot) {
    return jsonPageResponse(503, { status: 'unavailable', reason: 'database_unavailable' });
  }
  return jsonPageResponse(200, { status: 'ready', database: snapshot });
}
