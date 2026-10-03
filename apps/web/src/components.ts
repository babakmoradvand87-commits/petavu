/**
 * اجزای مشترک پوسته (گام ۲۲؛ §45–۴۷، Addendum §۳۰–۳۱).
 *
 * هر جزء اینجا **معنایی** است و نه تزئینی: سر صفحه `header`، فهرست `nav`،
 * مسیر `nav` با `aria-current`، و هر عددی که کاربر باید ببیند داخل `<data>` یا
 * متن واقعی می‌نشیند. این انتخاب، سئو و دسترس‌پذیری را با هم تأمین می‌کند
 * (Addendum §۳۱: Design System سمنتیک).
 *
 * هیچ عددی در این فایل «تصمیم ظاهری» نمی‌گیرد: رنگ و فاصله و شعاع از توکن‌ها
 * می‌آیند (در CSS) و اینجا فقط ساختار ساخته می‌شود.
 */

import { attrs, escapeText, tag, voidTag, type RawHtml } from './html.js';
import type { SiteKind } from './config.js';

export interface NavItem {
  readonly href: string;
  readonly label: string;
}

export function brandMark(size = 28): string {
  /*
   * نشانهٔ گرافیکی برند، SVG درون‌خطی: صفر درخواست، مقیاس‌پذیر، و رنگش از
   * توکن می‌آید (`currentColor`) تا در حالت تاریک هم درست بنشیند.
   */
  return (
    `<svg class="brand__mark" viewBox="0 0 32 32" width="${size}" height="${size}" role="img" aria-hidden="true" focusable="false">` +
      '<path d="M16 3c3.6 0 6.5 2.9 6.5 6.5 0 1.2-.3 2.3-.9 3.2 2.2 1.7 3.9 4.3 3.9 7.3 0 4.4-3.6 8-8 8h-3c-4.4 0-8-3.6-8-8 0-3 1.7-5.6 3.9-7.3-.6-.9-.9-2-.9-3.2C9.5 5.9 12.4 3 16 3Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
      '<circle cx="12.5" cy="19" r="1.6" fill="currentColor"/><circle cx="19.5" cy="19" r="1.6" fill="currentColor"/></svg>'
  );
}

/**
 * سرصفحه. فهرست ناوبری را **فراخواننده می‌دهد** (`platformNav`)، نه ثابتی در کد.
 *
 * نسخهٔ نخست، فهرستی ثابت داشت که به `/about` و `/contact` پیوند می‌داد؛ این
 * صفحه‌ها در نصب تازه وجود نداشتند و دو پیوند مرده در هر صفحه می‌ماند (§182:
 * فقط مسیرهایی که واقعاً هستند).
 */
export function siteHeader(options: {
  siteKind: SiteKind;
  currentPath: string;
  siteName: string;
  items: readonly NavItem[];
}): string {
  const items = options.siteKind === 'public' ? options.items : [];

  const nav = tag(
    'ul',
    { class: 'site-nav', role: 'list' },
    items.map((item) =>
      tag(
        'li',
        {},
        tag(
          'a',
          {
            class: 'site-nav__link',
            href: item.href,
            'aria-current': isCurrent(item.href, options.currentPath) ? 'page' : null,
          },
          escapeText(item.label),
        ),
      ),
    )
  );

  const inner = tag('div', { class: 'container site-header__inner' }, [
    tag(
      'a',
      { class: 'brand', href: '/', 'aria-label': `${options.siteName} — خانه` },
      [brandMark(), tag('span', { class: 'brand__name' }, escapeText(options.siteName))],
    ),
    /*
     * موبایل: کشوی بدون JavaScript با `<details>`؛ دسکتاپ: همان فهرست، افقی.
     * یک ساختار، دو نمایش — نه دو کامپوننت که از هم عقب بمانند.
     */
    tag('details', { class: 'nav-toggle' }, [
      tag('summary', { 'aria-label': 'فهرست ناوبری' }, escapeText('منو')),
      tag('div', { class: 'nav-toggle__panel' }, nav),
    ]),
    tag('nav', { class: 'site-nav', 'aria-label': 'ناوبری اصلی', hidden: items.length === 0 ? true : null }, nav),
  ]);

  return (tag('header', { class: 'site-header' }, inner));
}

export function isCurrent(href: string, currentPath: string): boolean {
  if (href === '/') return currentPath === '/';
  return currentPath === href || currentPath.startsWith(`${href}/`);
}

export interface FooterColumn {
  readonly title: string;
  readonly items: readonly NavItem[];
}

export function siteFooter(options: { siteName: string; year: number; columns: readonly FooterColumn[]; note?: string }): string {
  const columns = options.columns.map((column) =>
    tag('div', {}, [
      tag('p', { class: 'site-footer__title' }, escapeText(column.title)),
      tag(
        'ul',
        { role: 'list' },
        column.items.map((item) =>
          tag('li', {}, tag('a', { href: item.href }, escapeText(item.label))),
        ),
      ),
    ])
  );

  const inner = tag('div', { class: 'container' }, [
    tag('div', { class: 'site-footer__cols' }, columns),
    tag('p', { class: 'section--tight' }, escapeText(`© ${options.year} ${options.siteName}${options.note ? ` — ${options.note}` : ''}`)),
  ]);

  return (tag('footer', { class: 'site-footer' }, inner));
}

export function breadcrumb(items: ReadonlyArray<{ label: string; href?: string }>): string {
  const list = items.map((item, index) => {
    const isLast = index === items.length - 1;
    const content = item.href && !isLast ? tag('a', { href: item.href }, escapeText(item.label)) : escapeText(item.label);
    return tag('li', isLast ? { 'aria-current': 'page' } : {}, content);
  });

  return (tag('nav', { class: 'breadcrumb', 'aria-label': 'مسیر صفحه' }, tag('ol', { role: 'list' }, list)));
}

export function section(options: { id?: string; tight?: boolean; children: string | RawHtml; labelledBy?: string }): string {
  const classes = ['section'];
  if (options.tight) classes.push('section--tight');
  return (
    tag(
      'section',
      { class: classes.join(' '), id: options.id ?? null, 'aria-labelledby': options.labelledBy ?? null },
      childrenHtml(options.children),
    )
  );
}

export function container(children: string | RawHtml): string {
  return (tag('div', { class: 'container' }, childrenHtml(children)));
}

/** ترتیب فرزندان: HTML ساخته‌شده را همان‌طور که هست درج می‌کنیم. */
function childrenHtml(children: string | RawHtml | string[]): string {
  if (Array.isArray(children)) return children.join('');
  return typeof children === 'string' ? children : children.__html;
}

export function heading(level: 1 | 2 | 3 | 4, text: string, options: { id?: string; class?: string } = {}): string {
  return (tag(`h${level}`, { id: options.id ?? null, class: options.class ?? null }, escapeText(text)));
}

export function paragraph(text: string, className?: string): string {
  return (tag('p', { class: className ?? null }, escapeText(text)));
}

export function metric(label: string, value: string | number, hint?: string): string {
  return (
    tag('div', { class: 'metric' }, [
      tag('data', { class: 'metric__value', value: String(value) }, escapeText(formatNumber(value))),
      tag('span', { class: 'metric__label' }, escapeText(label)),
      hint ? tag('span', { class: 'field__hint' }, escapeText(hint)) : '',
    ])
  );
}

/** عدد فارسی، با جداکنندهٔ هزارگان — چون کاربر فارسی «۱٬۲۳۴» می‌خواند. */
export function formatNumber(value: number | string): string {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(numeric);
}

export function badge(text: string, tone?: 'success' | 'warning' | 'danger'): string {
  return (tag('span', { class: tone ? `badge badge--${tone}` : 'badge' }, escapeText(text)));
}

export function card(options: { title?: string; meta?: string; body: string | RawHtml; href?: string; raised?: boolean }): string {
  const inner = [
    options.title ? tag('h3', { class: 'card__title' }, escapeText(options.title)) : '',
    options.meta ? tag('p', { class: 'card__meta' }, escapeText(options.meta)) : '',
    tag('div', {}, childrenHtml(options.body)),
  ];

  const classes = ['card'];
  if (options.raised) classes.push('card--raised');

  if (options.href) {
    // کل کارت، پیوند است: سطح لمسی بزرگ‌تر، بدون تکرار پیوند برای صفحه‌خوان.
    return (
      tag('article', { class: classes.join(' ') }, [
        tag('a', { href: options.href, class: 'card__link' }, inner.join('')),
      ])
    );
  }

  return (tag('article', { class: classes.join(' ') }, inner.join('')));
}

export function emptyState(text: string): string {
  return (tag('p', { class: 'card card--quiet' }, escapeText(text)));
}

export function skipLink(): string {
  return (tag('a', { class: 'skip-link', href: '#main' }, escapeText('پرش به محتوای اصلی')));
}

/** ویژگی‌های دادهٔ ساختاریافته برای `<time>`؛ تاریخ خوانا، ماشین‌خوان دقیق. */
export function timeTag(iso: string | null | undefined, label: string): string {
  if (!iso) return (escapeText(label));
  return (`<time datetime="${escapeAttributeValue(iso)}">${escapeText(label)}</time>`);
}

function escapeAttributeValue(value: string): string {
  return value.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** ساختار آمادهٔ ویژگی‌ها — نقطهٔ واحد عبور از نگهبان `attrs`. */
export function attributes(values: Record<string, string | number | boolean | null | undefined>): string {
  return attrs(values);
}

export { tag, voidTag };
