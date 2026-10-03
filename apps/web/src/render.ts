/**
 * سند HTML (گام ۲۲؛ §68، Addendum §۳۰–۳۳، §۸۷–۸۸).
 *
 * یک تابع، یک سند. هیچ قالب‌ساز بیرونی، هیچ رشته‌چسبانی در صفحه‌ها: هر صفحه
 * فقط «چه چیزی» را می‌دهد و این‌جا «چگونه» ساخته می‌شود.
 *
 * قراردادهای ثابت (و دلیل‌شان):
 *   • `<html lang dir>` از تنظیمات محلی می‌آید، نه از حدس؛ صفحهٔ فارسی، RTL.
 *   • ترتیب هد: charset، viewport، هدِ سئو، CSS. `charset` اول است چون مرورگر
 *     پیش از هر چیز باید کدگذاری را بداند.
 *   • CSS با درهم محتوا لینک می‌شود و **هیچ استایل درون‌خطی** نیست؛ همین
 *     چیزی است که CSP سخت (`style-src 'self'`) را ممکن می‌کند.
 *   • فونت بحرانی، `preload` می‌شود — ولی فقط یک فایل و فقط جایی که متن،
 *     محتوای اصلی صفحه است.
 *   • `theme-color` از توکن‌ها می‌آید تا نوار مرورگر موبایل با برند یکی باشد.
 */

import { serializeHeadTags, type HeadTag } from '@petavu/seo';

import { voidTag } from './html.js';
import type { ThemeBundle } from './theme.js';

export interface DocumentInput {
  readonly lang: string;
  readonly dir: 'rtl' | 'ltr';
  readonly headTags: readonly HeadTag[];
  /** نشانی دارایی CSS (با درهم محتوا) و هر دارایی دیگری که باید لینک شود. */
  readonly stylesheets: readonly string[];
  /** بلوک `@font-face` — داخل همان CSS می‌رود، نه در `<style>` درون‌خطی. */
  /** نشانی‌های مطلق فونت‌هایی که باید پیش‌بارگذاری شوند. */
  readonly preloadUrls: readonly string[];
  readonly theme: ThemeBundle;
  readonly faviconUrl: string | null;
  readonly siteName: string;
  /**
   * بلوک‌های JSON-LD، **از قبل سریال‌شده**.
   *
   * چرا رشتهٔ آماده و نه شیء: امن‌سازی JSON-LD کاری است که `@petavu/seo`
   * انجام می‌دهد (`serializeJsonLd`). اگر این‌جا دوباره سریال کنیم، دو مسیر
   * امن‌سازی می‌سازیم و یکی‌شان روزی عقب می‌ماند.
   */
  readonly jsonLd?: readonly string[];
  readonly bodyClass?: string;
  /**
   * قطعات سند، به‌صورت رشتهٔ HTML **تمام‌شده**.
   *
   * هر قطعه از `components.ts` می‌آید و در همان‌جا همهٔ مقادیر از `escapeText`
   * گذشته‌اند. `renderDocument` هیچ داده‌ای را داخل این رشته‌ها تزریق نمی‌کند؛
   * فقط سرِ هم می‌کند — پس هیچ نقطهٔ escaping تازه‌ای این‌جا لازم نیست.
   */
  readonly header: string;
  readonly main: string;
  readonly footer: string;
  readonly skip?: string;
  /** برای حالت `noindex`: هیچ‌چیز اضافه‌ای لازم نیست؛ هد سئو مسئول است. */
}

export function renderDocument(input: DocumentInput): string {
  const head = [
    voidTag('meta', { charset: 'utf-8' }),
    /*
     * `viewport-fit=cover` و نه `user-scalable=no`: ممنوع‌کردن زوم، نقض
     * دسترس‌پذیری است. زوم آزاد می‌ماند.
     */
    voidTag('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' }),
    voidTag('meta', { name: 'color-scheme', content: 'light dark' }),
    voidTag('meta', {
      name: 'theme-color',
      content: input.theme.themeColorLight,
      media: '(prefers-color-scheme: light)',
    }),
    input.theme.darkAvailable
      ? voidTag('meta', { name: 'theme-color', content: input.theme.themeColorDark, media: '(prefers-color-scheme: dark)' })
      : '',
    input.faviconUrl ? voidTag('link', { rel: 'icon', href: input.faviconUrl, type: 'image/svg+xml' }) : '',
    // فونت بحرانی: `preload` با `crossorigin` (فونت همیشه CORS است، حتی هم‌مبدأ).
    ...input.preloadUrls.map((href) =>
      voidTag('link', { rel: 'preload', href, as: 'font', type: 'font/woff2', crossorigin: 'anonymous' }),
    ),
    serializeHeadTags(input.headTags),
    ...input.stylesheets.map((href) => voidTag('link', { rel: 'stylesheet', href })),
  ]
    .filter((part) => part !== '')
    .join('\n    ');

  const jsonLd = (input.jsonLd ?? [])
    .map((block) => `<script type="application/ld+json">${block}</script>`)
    .join('\n    ');

  const html = [
    '<!doctype html>',
    `<html lang="${escapeAttributeValue(input.lang)}" dir="${input.dir}">`,
    '  <head>',
    `    ${head}`,
    jsonLd ? `    ${jsonLd}` : '',
    '  </head>',
    `  <body${input.bodyClass ? ` class="${escapeAttributeValue(input.bodyClass)}"` : ''}>`,
    input.skip ? `    ${input.skip}` : '',
    `    ${input.header}`,
    `    <main id="main" tabindex="-1">`,
    `      ${input.main}`,
    '    </main>',
    `    ${input.footer}`,
    '  </body>',
    '</html>',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n');

  return html;
}

function escapeAttributeValue(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * سند متنی (robots، sitemap، llms).
 *
 * خروجی این‌ها از `@petavu/seo` می‌آید و **پیش از رسیدن به این‌جا** ساخته شده؛
 * این‌جا فقط قالب پاسخ تعیین می‌شود. پس هیچ escaping دوباره‌ای انجام نمی‌شود —
 * escaping دوباره روی XML، خودش یک نوع خرابی است.
 */
export function textResponse(body: string): string {
  return body.endsWith('\n') ? body : `${body}\n`;
}
