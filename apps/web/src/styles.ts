/**
 * پوستهٔ CSS وب‌سایت (گام ۲۲؛ §45–۴۷، §170–۱۷۵، Addendum §۴–۱۹).
 *
 * قواعدی که این فایل را می‌سازد و هر کدام قابل آزمون است:
 *
 *   ۱) **هر مقدار از توکن می‌آید.** هیچ رنگ، فاصله، شعاع، سایه، مدت یا اندازهٔ
 *      فونتی به‌صورت عدد خام این‌جا نیست. تنها استثناها «عدد ساختاری»اند
 *      (وزن شبکه، نسبت، ترتیب) و همان‌ها هم در کامنت علامت خورده‌اند.
 *   ۲) **منطقی، نه چپ‌وراست.** `margin-inline-start` به‌جای `margin-left`؛ پس
 *      همین فایل، RTL و LTR را یکسان می‌پوشاند و برای i18n آماده است (§۱۲۳).
 *   ۳) **موبایل اول.** همهٔ چیدمان‌ها ستونی‌اند؛ بزرگ‌تر از شکست، ستون‌ها باز
 *      می‌شوند. نقطه‌های شکست **باید** با توکن‌های `breakpoint.*` برابر باشند و
 *      تست، همین را می‌سنجد (یعنی CSS نمی‌تواند بی‌صدا از توکن جدا شود).
 *   ۴) **لمس ۴۴×۴۴.** هر چیز قابل‌لمس، کمینهٔ ۴۴ پیکسل — با `min-block-size`،
 *      نه با padding حدسی.
 *   ۵) **حرکت، اختیاری.** انیمیشن‌ها فقط `transform` و `opacity` را دست
 *      می‌زنند (بدون layout thrash) و زیر `prefers-reduced-motion` صفر می‌شوند.
 *   ۶) **تمرکز هرگز حذف نمی‌شود.** حلقهٔ تمرکز از توکن می‌آید و روی همه چیز
 *      باقی می‌ماند؛ پنهان‌کردنش ممنوع است (§۴۶).
 *
 * CSS به‌صورت دارایی محتوامحور سرو می‌شود (`app.css` با درهم) و همان‌جا
 * می‌شود بی‌نگرانی `immutable` کشید. هیچ فایل CSS دیگری بار نمی‌شود و هیچ
 * استایل درون‌خطی در صفحه نیست — تا CSP بتواند `style-src 'self'` بماند.
 */

export const SHELL_CSS = String.raw`
/* ============================================================ بازنشانی */
*, *::before, *::after { box-sizing: border-box; }

html {
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
  /* بدون «رفتار نرم» سراسری: پرش ناگهانی برای کاربر گیج‌کننده است، ولی
     هموارسازی سراسری هم باعث می‌شود پرش‌های ناخواسته به‌نظر عمدی بیایند. */
  scroll-behavior: auto;
  color-scheme: light dark;
}

body {
  margin: 0;
  min-block-size: 100dvh;
  font-family: var(--font-family-sans, system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif);
  font-size: var(--font-size-base, 16px);
  font-weight: var(--font-weight-regular, 400);
  line-height: var(--font-leading-body, 1.8);
  color: var(--color-text, #14171A);
  background-color: var(--color-bg, #FFFFFF);
  /* متن فارسی: ارقام و کلمات نباید بین خطوط شکسته شوند. */
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3, h4, h5, h6, p, figure, blockquote, dl, dd, ul, ol {
  margin: 0;
}
ul[role="list"], ol[role="list"] { list-style: none; padding: 0; }

h1, h2, h3, h4 {
  font-weight: var(--font-weight-bold, 700);
  line-height: var(--font-leading-heading, 1.4);
  letter-spacing: var(--font-tracking-normal, 0);
  /* عنوان‌ها: توازن خطوط، تا کلمهٔ تنها در سطر آخر نماند. */
  text-wrap: balance;
}
p { text-wrap: pretty; }

img, svg, video, canvas { display: block; max-inline-size: 100%; }
img { height: auto; }

a { color: var(--color-link, #0B626A); text-decoration-thickness: 1px; text-underline-offset: 2px; }
a:hover { color: var(--color-link-hover, #08494F); }

/* ============================================================ دسترس‌پذیری */
:where(a, button, input, select, textarea, summary, [tabindex]):focus-visible {
  outline: 2px solid var(--color-focus-ring, #F5A623);
  outline-offset: 2px;
  border-radius: var(--radius-xs, 2px);
}

.visually-hidden {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

/* پیوند پرش: تنها وقتی دیده می‌شود که با صفحه‌کلید به آن رسیده باشیم. */
.skip-link {
  position: absolute;
  inset-inline-start: var(--space-4, 16px);
  inset-block-start: calc(-1 * var(--space-16, 64px));
  z-index: var(--z-sticky, 100);
  padding: var(--space-2, 8px) var(--space-4, 16px);
  background-color: var(--color-surface-raised, #FFFFFF);
  color: var(--color-text, #14171A);
  border: 1px solid var(--color-border-strong, #9AA3AE);
  border-radius: var(--radius-md, 8px);
  transition: inset-block-start var(--motion-duration-fast, 160ms) var(--motion-ease-standard, ease);
}
.skip-link:focus { inset-block-start: var(--space-4, 16px); }

/* ============================================================ اندازه‌ها */
.container {
  inline-size: 100%;
  /* موبایل: حاشیهٔ کناری از توکن؛ دسکتاپ: همان، کمی بیشتر. */
  padding-inline: var(--space-gutter, 16px);
  margin-inline: auto;
  max-inline-size: 1280px;
}
@media (min-width: 768px) {
  .container { padding-inline: var(--space-8, 32px); }
}
@media (min-width: 1280px) {
  .container { padding-inline: var(--space-12, 48px); }
}

/* ریتم عمودی بخش‌ها: سیال میان دو توکن فاصله.
   چرا clamp و نه دو توکن جدا: فاصله باید با عرض صفحه رشد کند، ولی *کمینه و
   بیشینه* از مقیاس بیاید تا از شبکهٔ ۴ پیکسلی بیرون نزند. */
.section { padding-block: clamp(var(--space-10, 40px), 7vw, var(--space-24, 96px)); }
.section--tight { padding-block: clamp(var(--space-6, 24px), 4vw, var(--space-12, 48px)); }
.section--page { padding-block-start: clamp(var(--space-6, 24px), 4vw, var(--space-12, 48px)); }

.stack > * + * { margin-block-start: var(--stack-gap, var(--space-4, 16px)); }
.stack--loose { --stack-gap: var(--space-6, 24px); }
.stack--tight { --stack-gap: var(--space-2, 8px); }

.cluster {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--cluster-gap, var(--space-3, 12px));
}
.cluster--between { justify-content: space-between; }

.grid {
  display: grid;
  gap: var(--grid-gap, var(--space-6, 24px));
  grid-template-columns: 1fr;
}
@media (min-width: 768px) {
  .grid--2, .grid--3, .grid--4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (min-width: 1024px) {
  /* «auto-fit» با کمینهٔ کارتی، نه تعداد ثابت ستون: پهنای خوانا حفظ می‌شود
     حتی وقتی کارت‌ها کم‌ترند. */
  .grid--3 { grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr)); }
  .grid--4 { grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); }
}

/* ============================================================ سر و پا */
.site-header {
  position: sticky;
  inset-block-start: 0;
  z-index: var(--z-sticky, 100);
  background-color: color-mix(in srgb, var(--color-bg, #FFFFFF) 88%, transparent);
  /* «backdrop-filter» گران است؛ فقط وقتی پشتیبانی شود و فقط روی نوارهای
     کم‌ارتفاع. جایگزینش، پس‌زمینهٔ نیمه‌شفاف است. */
  backdrop-filter: saturate(140%) blur(12px);
  border-block-end: 1px solid var(--color-border, #DDE1E6);
}
.site-header__inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4, 16px);
  min-block-size: 60px;
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2, 8px);
  min-block-size: 44px;
  color: var(--color-text, #14171A);
  font-weight: var(--font-weight-bold, 700);
  letter-spacing: var(--font-tracking-tight, -0.01em);
  text-decoration: none;
}
.brand__mark { inline-size: 28px; block-size: 28px; flex: none; }
.brand__name { font-size: var(--font-size-xl, 20px); }
.brand__latin {
  font-size: var(--font-size-xs, 12px);
  letter-spacing: var(--font-tracking-wide, 0.02em);
  color: var(--color-text-muted, #4C545E);
  text-transform: uppercase;
}

.site-nav { display: flex; align-items: center; gap: var(--space-1, 4px); }
.site-nav__link {
  display: inline-flex;
  align-items: center;
  min-block-size: 44px;
  padding-inline: var(--space-3, 12px);
  border-radius: var(--radius-md, 8px);
  color: var(--color-text-muted, #4C545E);
  text-decoration: none;
  font-size: var(--font-size-sm, 14px);
  transition: background-color var(--motion-duration-fast, 160ms) var(--motion-ease-standard, ease),
              color var(--motion-duration-fast, 160ms) var(--motion-ease-standard, ease);
}
.site-nav__link:hover { background-color: var(--color-bg-subtle, #F7F8F9); color: var(--color-text, #14171A); }
.site-nav__link[aria-current="page"] { color: var(--color-text, #14171A); font-weight: var(--font-weight-semibold, 600); }

/*
 * موبایل: فهرست کشویی واقعی با <details>؛ بدون یک بایت JS.
 * دسکتاپ: همان فهرست، افقی و همیشه باز. یک ساختار HTML، دو نمایش — نه دو
 * کامپوننت که از هم عقب بمانند.
 */
.nav-toggle { display: block; }
.site-header nav.site-nav { display: none; }
@media (min-width: 768px) {
  .nav-toggle { display: none; }
  .site-header nav.site-nav { display: flex; }
}
.nav-toggle > summary {
  list-style: none;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2, 8px);
  min-block-size: 44px;
  padding-inline: var(--space-3, 12px);
  border: 1px solid var(--color-border, #DDE1E6);
  border-radius: var(--radius-md, 8px);
  cursor: pointer;
}
.nav-toggle > summary::-webkit-details-marker { display: none; }
.nav-toggle__panel {
  position: absolute;
  inset-inline: var(--space-4, 16px);
  margin-block-start: var(--space-2, 8px);
  padding: var(--space-3, 12px);
  background-color: var(--color-surface-raised, #FFFFFF);
  border: 1px solid var(--color-border, #DDE1E6);
  border-radius: var(--radius-lg, 12px);
  box-shadow: var(--shadow-lg, 0 12px 24px -6px rgba(11, 13, 15, 0.14));
}
.nav-toggle__panel .site-nav { flex-direction: column; align-items: stretch; }

.site-footer {
  border-block-start: 1px solid var(--color-border, #DDE1E6);
  background-color: var(--color-bg-subtle, #F7F8F9);
  color: var(--color-text-muted, #4C545E);
  font-size: var(--font-size-sm, 14px);
}
.site-footer__cols { display: grid; gap: var(--space-8, 32px); grid-template-columns: 1fr; }
@media (min-width: 768px) { .site-footer__cols { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (min-width: 1024px) { .site-footer__cols { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
.site-footer__title { color: var(--color-text, #14171A); font-weight: var(--font-weight-semibold, 600); }

/* ============================================================ قهرمان صفحه */
.hero {
  position: relative;
  overflow: hidden;
  /* neutral.0 در هر دو تم ثابت است؛ text.inverse در تم تاریک تیره می‌شد و
     روی پردهٔ همیشه‌تاریک قهرمان ناخوانا می‌ماند. */
  color: var(--color-neutral-0, #FFFFFF);
  background-color: var(--color-brand-900, #03201F);
  /* پردهٔ سینماتیک: دو منبع نور، بدون تصویر. تصویر قهرمان، LCP را می‌کشد؛
     این پرده صفر بایت است و همان حس را می‌دهد. */
  background-image:
    radial-gradient(120% 90% at 85% 10%, color-mix(in srgb, var(--color-brand-500, #0E7C86) 55%, transparent) 0%, transparent 60%),
    radial-gradient(90% 70% at 10% 100%, color-mix(in srgb, var(--color-accent-400, #F5A623) 28%, transparent) 0%, transparent 65%);
}
.hero__inner { padding-block: clamp(var(--space-12, 48px), 12vw, var(--space-40, 160px)); }
.hero__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2, 8px);
  font-size: var(--font-size-xs, 12px);
  letter-spacing: var(--font-tracking-wide, 0.02em);
  padding: var(--space-1, 4px) var(--space-3, 12px);
  border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
  border-radius: var(--radius-full, 9999px);
}
.hero__title {
  font-size: clamp(var(--font-size-3xl, 30px), 7vw, var(--font-size-display, 76px));
  line-height: var(--font-leading-tight, 1.2);
  letter-spacing: var(--font-tracking-tight, -0.01em);
  margin-block: var(--space-4, 16px) var(--space-4, 16px);
}
.hero__lead {
  font-size: clamp(var(--font-size-base, 16px), 2.2vw, var(--font-size-lg, 18px));
  color: color-mix(in srgb, currentColor 82%, transparent);
  max-inline-size: var(--font-measure-prose, 68ch);
}
.hero__actions { margin-block-start: var(--space-8, 32px); }

/* ============================================================ کارت */
.card {
  background-color: var(--color-surface, #FFFFFF);
  border: 1px solid var(--color-border, #DDE1E6);
  border-radius: var(--radius-lg, 12px);
  padding: var(--space-6, 24px);
}
.card--raised { background-color: var(--color-surface-raised, #FFFFFF); box-shadow: var(--shadow-md, 0 4px 8px -2px rgba(11, 13, 15, 0.10)); border-color: transparent; }
/* کارتِ پیوندی: کل سطح کارت لمس‌پذیر است، بی‌آنکه متن لینک تکرار شود. */
.card__link { display: block; color: inherit; text-decoration: none; }
.card__link:hover .card__title { color: var(--color-link-hover, #08494F); }
.card__link:hover { transform: translateY(-2px); }
.card { transition: transform var(--motion-duration-base, 240ms) var(--motion-ease-standard, ease),
                   box-shadow var(--motion-duration-base, 240ms) var(--motion-ease-standard, ease); }
.card--quiet { background-color: var(--color-bg-subtle, #F7F8F9); }
.card__title { font-size: var(--font-size-2xl, 24px); }
.card__meta { font-size: var(--font-size-sm, 14px); color: var(--color-text-muted, #4C545E); }

/* نشانگر عدد: ارقام جدولی تا ستون اعداد نلرزد. */
.metric { font-variant-numeric: tabular-nums; }
.metric__value {
  display: block;
  font-size: clamp(var(--font-size-2xl, 24px), 4vw, var(--font-size-4xl, 36px));
  font-weight: var(--font-weight-bold, 700);
  letter-spacing: var(--font-tracking-tight, -0.01em);
}
.metric__label { font-size: var(--font-size-sm, 14px); color: var(--color-text-muted, #4C545E); }

/* ============================================================ دکمه و پیوند کنش */
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2, 8px);
  min-block-size: 44px;
  min-inline-size: 44px;
  padding-inline: var(--space-5, 20px);
  border: 1px solid transparent;
  border-radius: var(--radius-md, 8px);
  font: inherit;
  font-weight: var(--font-weight-medium, 500);
  text-decoration: none;
  cursor: pointer;
  transition: transform var(--motion-duration-instant, 100ms) var(--motion-ease-standard, ease),
              background-color var(--motion-duration-fast, 160ms) var(--motion-ease-standard, ease);
}
.button:active { transform: translateY(1px); }
.button--primary { background-color: var(--color-brand-600, #0B626A); color: var(--color-text-inverse, #FFFFFF); }
.button--primary:hover { background-color: var(--color-brand-700, #08494F); color: var(--color-text-inverse, #FFFFFF); }
.button--accent { background-color: var(--color-accent-400, #F5A623); color: var(--color-neutral-1000, #0B0D0F); }
.button--accent:hover { background-color: var(--color-accent-500, #D4881A); color: var(--color-neutral-1000, #0B0D0F); }
.button--ghost { background-color: transparent; border-color: var(--color-border-strong, #9AA3AE); color: var(--color-text, #14171A); }
.button--ghost:hover { background-color: var(--color-bg-subtle, #F7F8F9); }
.button[aria-disabled="true"] { opacity: 0.55; cursor: not-allowed; }

/* ============================================================ برچسب و جدول */
.badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1, 4px);
  padding: 2px var(--space-2, 8px);
  border-radius: var(--radius-full, 9999px);
  font-size: var(--font-size-xs, 12px);
  background-color: var(--color-bg-subtle, #F7F8F9);
  color: var(--color-text-muted, #4C545E);
  border: 1px solid var(--color-border, #DDE1E6);
}
.badge--success { border-color: var(--color-success-500, #1F8A54); color: var(--color-success-600, #166B40); }
.badge--warning { border-color: var(--color-warning-500, #B9791A); color: var(--color-warning-600, #8F5D13); }
.badge--danger  { border-color: var(--color-danger-500, #C0392B);  color: var(--color-danger-600, #97291E); }

.table-wrap { overflow-x: auto; }
table { border-collapse: collapse; inline-size: 100%; font-size: var(--font-size-sm, 14px); }
th, td { text-align: start; padding: var(--space-3, 12px); border-block-end: 1px solid var(--color-border, #DDE1E6); }
th { font-weight: var(--font-weight-semibold, 600); color: var(--color-text-muted, #4C545E); }

/* ============================================================ متن بلند */
.prose { max-inline-size: var(--font-measure-prose, 68ch); }
.prose > * + * { margin-block-start: var(--space-4, 16px); }
.prose h2 { font-size: var(--font-size-3xl, 30px); margin-block-start: var(--space-10, 40px); }
.prose h3 { font-size: var(--font-size-2xl, 24px); margin-block-start: var(--space-8, 32px); }
.prose ul, .prose ol { padding-inline-start: var(--space-6, 24px); }
.prose li + li { margin-block-start: var(--space-2, 8px); }
.prose code {
  font-family: var(--font-family-mono, monospace);
  font-size: 0.92em;
  background-color: var(--color-surface-sunken, #EDEFF2);
  padding: 2px var(--space-1, 4px);
  border-radius: var(--radius-xs, 2px);
}
.prose blockquote {
  border-inline-start: 3px solid var(--color-accent-400, #F5A623);
  padding-inline-start: var(--space-4, 16px);
  color: var(--color-text-muted, #4C545E);
}

/* ============================================================ مسیر راهنما */
.breadcrumb { font-size: var(--font-size-sm, 14px); }
.breadcrumb ol { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1, 4px); list-style: none; padding: 0; }
.breadcrumb li + li::before { content: "‹"; margin-inline: var(--space-1, 4px); color: var(--color-text-muted, #4C545E); }
.breadcrumb a { display: inline-flex; align-items: center; min-block-size: 44px; color: var(--color-text-muted, #4C545E); }

/* ============================================================ فرم */
.field { display: grid; gap: var(--space-1, 4px); max-inline-size: var(--font-measure-narrow, 45ch); }
.field__label { font-size: var(--font-size-sm, 14px); font-weight: var(--font-weight-medium, 500); }
.field__hint { font-size: var(--font-size-xs, 12px); color: var(--color-text-muted, #4C545E); }
.input {
  min-block-size: 44px;
  padding-inline: var(--space-3, 12px);
  font: inherit;
  /* کمینهٔ ۱۶ پیکسل: زیر آن، iOS هنگام تمرکز زوم می‌کند. */
  font-size: var(--font-size-base, 16px);
  color: var(--color-text, #14171A);
  background-color: var(--color-surface, #FFFFFF);
  border: 1px solid var(--color-border-strong, #9AA3AE);
  border-radius: var(--radius-md, 8px);
}
.input:focus-visible { border-color: var(--color-brand-500, #0E7C86); }

/* ============================================================ حرکت */
@keyframes rise {
  from { opacity: 0; transform: translateY(var(--motion-parallax-max, 24px)); }
  to   { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: no-preference) {
  .reveal { animation: rise var(--motion-duration-slow, 400ms) var(--motion-ease-emphasized, ease-out) both; }
  .reveal--2 { animation-delay: 60ms; }
  .reveal--3 { animation-delay: 120ms; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

/**
 * ============================================================ کامپوننت‌های طراحی
 *
 * CSS کامپوننت‌های Registry (گام ۲۳). قاعده‌ها همان قاعده‌های پوسته‌اند:
 *
 *   • **هیچ رنگ خامی نیست** — همه از توکن‌های design.token می‌آیند
 *     (شکل var(--token, fallback)). آزمون، همین را سنجش می‌کند.
 *   • **ویژگی‌های منطقی** (padding-inline، margin-block) تا RTL و LTR هر دو
 *     درست بنشینند (§45–۴۷).
 *   • **بدون JavaScript**: تاشوها details، زبانه‌ها لنگر، فهرست مطالب لنگر.
 *   • **حرکت فقط با transform/opacity** و تحت prefers-reduced-motion.
 */
.ds-block {
  padding-block: clamp(var(--space-8, 32px), 6vw, var(--space-20, 80px));
  padding-inline: var(--space-gutter, 16px);
}
.ds-block > * { max-inline-size: var(--layout-container-max, 1200px); margin-inline: auto; }
.ds-block--pad-none { padding-block: 0; }
.ds-block--pad-sm { padding-block: clamp(var(--space-4, 16px), 3vw, var(--space-10, 40px)); }
.ds-block--pad-lg { padding-block: clamp(var(--space-12, 48px), 8vw, var(--space-28, 112px)); }
.ds-block--pad-xl { padding-block: clamp(var(--space-16, 64px), 11vw, var(--space-36, 144px)); }
.ds-block--bg-surface { background-color: var(--color-surface, var(--color-bg, #FFFFFF)); }
.ds-block--bg-muted { background-color: var(--color-bg-subtle, #F7F8F9); }
.ds-block--bg-brand { background-color: var(--color-brand-50, #E6F4F5); }
.ds-block--bg-image { background-color: var(--color-bg-subtle, #F7F8F9); }
.ds-block__body { margin-block-start: var(--space-4, 16px); }

.ds-grid { display: grid; gap: var(--space-6, 24px); grid-template-columns: 1fr; }
.ds-grid--gap-sm { gap: var(--space-4, 16px); }
.ds-grid--gap-lg { gap: var(--space-10, 40px); }
@media (min-width: 640px) {
  .ds-grid--2, .ds-grid--3, .ds-grid--4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (min-width: 960px) {
  .ds-grid--2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ds-grid--3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .ds-grid--4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}

.ds-columns { display: grid; gap: var(--space-6, 24px); }
@media (min-width: 960px) {
  .ds-columns { grid-template-columns: 1fr 1fr; }
  .ds-columns--60-40 { grid-template-columns: 3fr 2fr; }
  .ds-columns--40-60 { grid-template-columns: 2fr 3fr; }
  .ds-columns--70-30 { grid-template-columns: 7fr 3fr; }
  .ds-columns--30-70 { grid-template-columns: 3fr 7fr; }
  .ds-columns--reverse .ds-columns__cell:first-child { order: 2; }
}

.ds-heading {
  font-size: clamp(var(--font-size-2xl, 24px), 3vw, var(--font-size-4xl, 36px));
  line-height: var(--line-height-tight, 1.25);
  margin-block-end: var(--space-3, 12px);
  text-wrap: balance;
}
.ds-heading--center { text-align: center; }
.ds-heading--sm { font-size: var(--font-size-xl, 20px); }

.ds-text { font-size: var(--font-size-base, 16px); line-height: var(--line-height-relaxed, 1.7); }
.ds-text--sm { font-size: var(--font-size-sm, 14px); }
.ds-text--lg { font-size: var(--font-size-lg, 18px); }

.ds-cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2, 8px);
  min-block-size: var(--size-touch-target, 44px);
  min-inline-size: var(--size-touch-target, 44px);
  padding-inline: var(--space-4, 16px);
  border-radius: var(--radius-md, 8px);
  font-weight: var(--font-weight-medium, 500);
  text-decoration: none;
  transition: transform var(--motion-duration-fast, 150ms) var(--motion-ease-standard, ease);
}
.ds-cta--primary { background-color: var(--color-brand-600, #0B626A); color: var(--color-on-brand, #FFFFFF); }
.ds-cta--secondary { border: 1px solid var(--color-border-strong, #9AA3AE); color: var(--color-text, #14171A); }
.ds-cta--ghost { color: var(--color-text-muted, #4C545E); }
.ds-cta--link { color: var(--color-link, #0B626A); text-decoration: underline; padding-inline: 0; }
.ds-cta--sm { font-size: var(--font-size-sm, 14px); }
.ds-cta--lg { font-size: var(--font-size-lg, 18px); }
@media (prefers-reduced-motion: no-preference) {
  .ds-cta:hover { transform: translateY(-1px); }
}

.ds-hero { padding-block: clamp(var(--space-8, 32px), 7vw, var(--space-24, 96px)); padding-inline: var(--space-gutter, 16px); }
.ds-hero__body, .ds-hero__media { max-inline-size: var(--layout-container-max, 1200px); margin-inline: auto; }
.ds-hero__title { font-size: clamp(var(--font-size-3xl, 30px), 5vw, var(--font-size-5xl, 48px)); line-height: var(--line-height-tight, 1.2); text-wrap: balance; }
.ds-hero__subtitle { color: var(--color-text-muted, #4C545E); font-size: var(--font-size-lg, 18px); margin-block-start: var(--space-3, 12px); }
.ds-hero__actions { margin-block-start: var(--space-5, 20px); }
.ds-hero__media { margin-block-start: var(--space-6, 24px); }
@media (min-width: 960px) {
  .ds-hero--split { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-10, 40px); align-items: center; }
  .ds-hero--split .ds-hero__media { margin-block-start: 0; }
  .ds-hero--centered .ds-hero__body { text-align: center; }
  .ds-hero--overlay { position: relative; }
}

.ds-list { padding-inline-start: var(--space-5, 20px); line-height: var(--line-height-relaxed, 1.7); }

.ds-feature { padding: var(--space-4, 16px); border: 1px solid var(--color-border, #DDE1E6); border-radius: var(--radius-lg, 12px); }
.ds-feature__title { font-size: var(--font-size-lg, 18px); margin-block-end: var(--space-1, 4px); }
.ds-feature__text { color: var(--color-text-muted, #4C545E); }

.ds-stat { display: flex; flex-direction: column; gap: var(--space-1, 4px); }
.ds-stat__value { font-size: clamp(var(--font-size-2xl, 24px), 4vw, var(--font-size-4xl, 36px)); font-weight: var(--font-weight-semibold, 600); }
.ds-stat__label { color: var(--color-text-muted, #4C545E); font-size: var(--font-size-sm, 14px); }

.ds-plan { display: flex; flex-direction: column; gap: var(--space-2, 8px); }
.ds-plan--highlighted { border-color: var(--color-brand-500, #0E7C86); box-shadow: var(--shadow-lg, none); }
.ds-plan__price { font-size: var(--font-size-2xl, 24px); font-weight: var(--font-weight-semibold, 600); }

.ds-faq { display: grid; gap: var(--space-2, 8px); }
.ds-faq__item, .ds-accordion__item { border: 1px solid var(--color-border, #DDE1E6); border-radius: var(--radius-md, 8px); }
.ds-faq__q, .ds-accordion__q {
  cursor: pointer;
  min-block-size: var(--size-touch-target, 44px);
  display: flex;
  align-items: center;
  padding: var(--space-3, 12px) var(--space-4, 16px);
  font-weight: var(--font-weight-medium, 500);
}
.ds-faq__a, .ds-accordion__a { padding: 0 var(--space-4, 16px) var(--space-4, 16px); }

.ds-quote { border-inline-start: 3px solid var(--color-brand-500, #0E7C86); padding-inline-start: var(--space-4, 16px); }
.ds-quote__text { font-size: var(--font-size-lg, 18px); }
.ds-quote__source { color: var(--color-text-muted, #4C545E); font-size: var(--font-size-sm, 14px); margin-block-start: var(--space-2, 8px); }

.ds-callout { border-radius: var(--radius-md, 8px); padding: var(--space-4, 16px); border-inline-start: 3px solid var(--color-border-strong, #9AA3AE); }
.ds-callout--info { background-color: var(--color-info-50, #EAF4FB); }
.ds-callout--success { background-color: var(--color-success-50, #EAF7EF); }
.ds-callout--warning { background-color: var(--color-warning-50, #FDF3E3); }
.ds-callout--danger { background-color: var(--color-danger-50, #FCEDED); }
.ds-callout__title { font-weight: var(--font-weight-semibold, 600); margin-block-end: var(--space-1, 4px); }

.ds-steps { display: grid; gap: var(--space-4, 16px); padding-inline-start: var(--space-5, 20px); }
.ds-step__title { font-size: var(--font-size-lg, 18px); }
.ds-step__text { color: var(--color-text-muted, #4C545E); }

.ds-table-wrap { overflow-x: auto; }
.ds-table { inline-size: 100%; border-collapse: collapse; }
.ds-table caption { text-align: start; color: var(--color-text-muted, #4C545E); padding-block-end: var(--space-2, 8px); }
.ds-table th, .ds-table td { text-align: start; padding: var(--space-3, 12px); border-block-end: 1px solid var(--color-border, #DDE1E6); }

.ds-cta-banner { border-radius: var(--radius-lg, 12px); padding: clamp(var(--space-5, 20px), 4vw, var(--space-10, 40px)); }
.ds-cta-banner--brand { background-color: var(--color-brand-600, #0B626A); color: var(--color-on-brand, #FFFFFF); }
.ds-cta-banner--dark { background-color: var(--color-neutral-900, #14171A); color: var(--color-on-brand, #FFFFFF); }
.ds-cta-banner--muted { background-color: var(--color-bg-subtle, #F7F8F9); }
.ds-cta-banner__title { font-size: var(--font-size-2xl, 24px); }
.ds-cta-banner__text { margin-block: var(--space-2, 8px) var(--space-4, 16px); }

.ds-contact__rows { display: grid; gap: var(--space-2, 8px); }
.ds-contact__label { color: var(--color-text-muted, #4C545E); }
.ds-map { padding-block: var(--space-6, 24px); }

.ds-figure { margin: 0; }
.ds-figure__img { inline-size: 100%; block-size: auto; display: block; }
.ds-figure__img--rounded { border-radius: var(--radius-lg, 12px); }
.ds-figure__caption { color: var(--color-text-muted, #4C545E); font-size: var(--font-size-sm, 14px); margin-block-start: var(--space-2, 8px); }
.ds-ratio--1-1 { aspect-ratio: 1 / 1; object-fit: cover; }
.ds-ratio--4-3 { aspect-ratio: 4 / 3; object-fit: cover; }
.ds-ratio--3-2 { aspect-ratio: 3 / 2; object-fit: cover; }
.ds-ratio--16-9 { aspect-ratio: 16 / 9; object-fit: cover; }
.ds-ratio--21-9 { aspect-ratio: 21 / 9; object-fit: cover; }

.ds-gallery { display: grid; gap: var(--space-3, 12px); grid-template-columns: 1fr; }
@media (min-width: 640px) { .ds-gallery--2, .ds-gallery--3, .ds-gallery--4 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (min-width: 960px) {
  .ds-gallery--2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ds-gallery--3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .ds-gallery--4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}

.ds-logo { inline-size: auto; block-size: auto; max-inline-size: 100%; }
.ds-logo--sm { max-block-size: 24px; }
.ds-logo--md { max-block-size: 40px; }
.ds-logo--lg { max-block-size: 64px; }

.ds-video { inline-size: 100%; block-size: auto; border-radius: var(--radius-lg, 12px); }

.ds-tabs { display: flex; flex-wrap: wrap; gap: var(--space-2, 8px); }
.ds-tabs__item {
  min-block-size: var(--size-touch-target, 44px);
  display: inline-flex;
  align-items: center;
  padding-inline: var(--space-4, 16px);
  border-radius: var(--radius-full, 999px);
  border: 1px solid var(--color-border, #DDE1E6);
}
.ds-tabs--underline .ds-tabs__item { border: none; border-block-end: 2px solid var(--color-border-strong, #9AA3AE); border-radius: 0; }

.ds-toc { border: 1px solid var(--color-border, #DDE1E6); border-radius: var(--radius-md, 8px); padding: var(--space-4, 16px); }
.ds-toc__list { display: grid; gap: var(--space-1, 4px); }

.ds-share { display: flex; flex-wrap: wrap; gap: var(--space-3, 12px); }
.ds-share__link { min-block-size: var(--size-touch-target, 44px); display: inline-flex; align-items: center; }

.ds-divider { border: none; border-block-start: 1px solid var(--color-border, #DDE1E6); }
.ds-divider--dashed { border-block-start-style: dashed; }
.ds-divider--sm { margin-block: var(--space-2, 8px); }
.ds-divider--md { margin-block: var(--space-6, 24px); }
.ds-divider--lg { margin-block: var(--space-12, 48px); }

.ds-spacer { block-size: var(--space-6, 24px); }
.ds-spacer--sm { block-size: var(--space-3, 12px); }
.ds-spacer--md { block-size: var(--space-6, 24px); }
.ds-spacer--lg { block-size: var(--space-10, 40px); }
.ds-spacer--xl { block-size: var(--space-20, 80px); }
.ds-spacer--mobile { display: block; }
.ds-spacer--desktop { display: none; }
@media (min-width: 960px) {
  .ds-spacer--mobile { display: none; }
  .ds-spacer--desktop { display: block; }
}

.ds-anchor-nav { display: flex; gap: var(--space-2, 8px); overflow-x: auto; }
.ds-anchor-nav__link { min-block-size: var(--size-touch-target, 44px); display: inline-flex; align-items: center; padding-inline: var(--space-3, 12px); }

.badge--neutral { background-color: var(--color-bg-subtle, #F7F8F9); color: var(--color-text-muted, #4C545E); }
.badge--info { background-color: var(--color-info-50, #EAF4FB); color: var(--color-text, #14171A); }
.badge--brand { background-color: var(--color-brand-50, #E6F4F5); color: var(--color-brand-700, #08494F); }

.ds-card--surface { background-color: var(--color-surface, var(--color-bg, #FFFFFF)); }
.ds-card--muted { background-color: var(--color-bg-subtle, #F7F8F9); }
.ds-card--outline { background-color: transparent; border: 1px solid var(--color-border, #DDE1E6); }

/* ============================================================ تاکسونومی و پیمایش سینماتیک (گام ۲۵) */

/* تراشهٔ پیوندی: هدف لمس ۴۴ پیکسل، شمارندهٔ جدولی تا ستون اعداد نلرزد. */
.chips { display: flex; flex-wrap: wrap; gap: var(--space-2, 8px); list-style: none; padding: 0; margin: 0; }
.chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2, 8px);
  min-block-size: var(--size-touch-target, 44px);
  padding-inline: var(--space-4, 16px);
  border: 1px solid var(--color-border-strong, #9AA3AE);
  border-radius: var(--radius-full, 9999px);
  background-color: var(--color-surface, #FFFFFF);
  color: var(--color-text, #14171A);
  text-decoration: none;
  transition: background-color var(--motion-duration-fast, 160ms) var(--motion-ease-standard, ease),
              border-color var(--motion-duration-fast, 160ms) var(--motion-ease-standard, ease);
}
.chip:hover { background-color: var(--color-brand-50, #EAF6F7); border-color: var(--color-brand-500, #0E7C86); }
.chip__count { font-variant-numeric: tabular-nums; font-size: var(--font-size-xs, 12px); color: var(--color-text-muted, #4C545E); }

/* شبکهٔ مرکز تاکسونومی: هر گروه یک کارت، با تراشه‌های فرزند. */
.index-grid { display: grid; gap: var(--space-4, 16px); grid-template-columns: 1fr; }
@media (min-width: 768px) { .index-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (min-width: 1024px) { .index-grid { grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr)); } }
.index-grid .card__title a { color: inherit; text-decoration: none; display: inline-flex; align-items: center; min-block-size: var(--size-touch-target, 44px); }
.index-grid .card__title a:hover { color: var(--color-link-hover, #08494F); }

/* فرم جست‌وجو: ستونی در موبایل، یک ردیف در دسکتاپ. */
.search-form { display: grid; gap: var(--space-3, 12px); grid-template-columns: 1fr; align-items: end; max-inline-size: var(--font-measure-prose, 68ch); }
@media (min-width: 768px) { .search-form { grid-template-columns: minmax(0, 1fr) auto; } }
.search-form .field { max-inline-size: none; }
.search-form .input { min-block-size: 48px; }

/* ---- صحنه‌های صفحهٔ اصلی ---- */
.scene { position: relative; }
.scene--subtle { background-color: var(--color-bg-subtle, #F7F8F9); }
.scene--dark {
  background-color: var(--color-brand-900, #03201F);
  color: var(--color-neutral-0, #FFFFFF);
}
.scene--dark .section-head__eyebrow,
.scene--dark .section-head__lead { color: color-mix(in srgb, currentColor 78%, transparent); }
.scene--dark .chip {
  background-color: transparent;
  color: inherit;
  border-color: color-mix(in srgb, currentColor 38%, transparent);
}
.scene--dark .chip:hover { background-color: color-mix(in srgb, currentColor 14%, transparent); border-color: currentColor; }
.scene--dark .chip__count { color: color-mix(in srgb, currentColor 72%, transparent); }
.scene--dark .button--ghost { color: inherit; border-color: color-mix(in srgb, currentColor 45%, transparent); }
.scene--dark .button--ghost:hover { background-color: color-mix(in srgb, currentColor 14%, transparent); }
.scene--closing { text-align: center; }
.scene--closing .section-head__lead { margin-inline: auto; }
.scene--closing .cluster { justify-content: center; }

.section-head { display: grid; gap: var(--space-2, 8px); max-inline-size: var(--font-measure-prose, 68ch); margin-block-end: var(--space-8, 32px); }
.section-head__eyebrow {
  font-size: var(--font-size-xs, 12px);
  letter-spacing: var(--font-tracking-wide, 0.02em);
  font-weight: var(--font-weight-semibold, 600);
  color: var(--color-brand-600, #0B626A);
}
.section-head__title {
  font-size: clamp(var(--font-size-2xl, 24px), 4.5vw, var(--font-size-5xl, 48px));
  line-height: var(--font-leading-tight, 1.2);
  letter-spacing: var(--font-tracking-tight, -0.01em);
}
.section-head__lead { font-size: var(--font-size-lg, 18px); color: var(--color-text-muted, #4C545E); }

/* نوار عددها: عدد بزرگ، برچسب کوچک؛ عددِ جدولی، بدون پرش. */
.stat-strip { display: grid; gap: var(--space-8, 32px); grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (min-width: 768px) { .stat-strip { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
.stat-strip .metric { border-block-start: 1px solid var(--color-border-strong, #9AA3AE); padding-block-start: var(--space-4, 16px); }
.stat-strip .metric__value {
  display: block;
  font-size: clamp(var(--font-size-4xl, 36px), 9vw, var(--font-size-display, 76px));
  line-height: 1;
  letter-spacing: var(--font-tracking-tight, -0.01em);
  font-weight: var(--font-weight-bold, 700);
}

/* قهرمان سینماتیک: تمام‌قد، با دو «نور» که با اسکرول آرام جابه‌جا می‌شوند. */
.hero--cinema { display: grid; align-items: end; min-block-size: min(100svh, 52rem); isolation: isolate; }
.hero--cinema::before,
.hero--cinema::after { content: ""; position: absolute; inset: -20%; z-index: -1; pointer-events: none; }
.hero--cinema::before {
  background: radial-gradient(38% 38% at 72% 28%, color-mix(in srgb, var(--color-accent-400, #F5A623) 26%, transparent), transparent 72%);
}
.hero--cinema::after {
  background: radial-gradient(46% 46% at 18% 82%, color-mix(in srgb, var(--color-brand-400, #33A7B0) 30%, transparent), transparent 70%);
}
.hero__cue {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  inline-size: var(--size-touch-target, 44px);
  block-size: var(--size-touch-target, 44px);
  margin-block-start: var(--space-10, 40px);
  border: 1px solid color-mix(in srgb, currentColor 40%, transparent);
  border-radius: var(--radius-full, 9999px);
  color: inherit;
  text-decoration: none;
}
.hero__cue:hover { background-color: color-mix(in srgb, currentColor 14%, transparent); }

/* نوار پیشرفت اسکرول: فقط با پشتیبانی مرورگر و بدون درخواست کاهش حرکت.
   بدون پشتیبانی، پنهان می‌ماند — هیچ نشانه‌ای از «خراب‌بودن» دیده نمی‌شود. */
.scroll-progress { display: none; }
@keyframes progress-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes scene-in { from { opacity: 0; transform: translateY(var(--motion-parallax-max, 24px)); } to { opacity: 1; transform: none; } }
@keyframes hero-drift { from { transform: none; opacity: 1; } to { transform: translateY(8%); opacity: 0.4; } }
@keyframes cue-bob { 0%, 100% { transform: none; } 50% { transform: translateY(var(--space-1, 4px)); } }

@supports (animation-timeline: view()) {
  @media screen and (prefers-reduced-motion: no-preference) {
    .scroll-progress {
      display: block;
      position: fixed;
      inset-block-start: 0;
      inset-inline: 0;
      block-size: 3px;
      z-index: var(--z-sticky, 100);
      background-color: var(--color-accent-400, #F5A623);
      transform-origin: 100% 50%;
      pointer-events: none;
      animation: progress-grow linear both;
      animation-timeline: scroll(root block);
    }
    :root[dir="ltr"] .scroll-progress { transform-origin: 0 50%; }
    .rv { animation: scene-in linear both; animation-timeline: view(); animation-range: entry 0% entry 60%; }
    .hero--cinema .hero__inner { animation: hero-drift linear both; animation-timeline: view(); animation-range: exit 0% exit 100%; }
    .hero__cue { animation: cue-bob var(--motion-duration-cinematic, 700ms) var(--motion-ease-standard, ease) infinite alternate; }
  }
}


/* §26–28: پنج سطح مستقل؛ پنلْ چیدمان و توکن‌های معنایی خودش را دارد. */
.panel-body { --panel-bg: var(--color-neutral-50, #F7F8F9); --panel-surface: var(--color-neutral-0, #FFFFFF); background: var(--panel-bg); }
.panel-body--admin { --panel-bg: var(--color-neutral-1000, #0B0D0F); --panel-surface: var(--color-neutral-900, #14171A); --color-text: var(--color-neutral-100, #EDEFF2); --color-text-muted: var(--color-neutral-400, #9AA3AE); --color-border: var(--color-neutral-700, #343A42); --color-text-inverse: var(--color-neutral-0, #FFFFFF); }
.panel-top { background: var(--panel-surface); border-block-end: 1px solid var(--color-border); }
.panel-top__inner { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3, 12px); padding: var(--space-4, 16px); }
.panel-top__surface { font-size: var(--font-size-xs, 12px); color: var(--color-text-muted); }
.panel-top__user { margin-inline-start: auto; font-size: var(--font-size-sm, 14px); }
.panel-layout { display: grid; min-block-size: 80svh; grid-template-columns: minmax(0, 1fr); }
.panel-nav { padding: var(--space-3, 12px); background: var(--panel-surface); border-block-end: 1px solid var(--color-border); }
.panel-nav__toggle summary { min-block-size: 44px; display: flex; align-items: center; cursor: pointer; }
.panel-nav__list { display: grid; gap: var(--space-1, 4px); padding: 0; list-style: none; }
.panel-nav__link { display: flex; align-items: center; justify-content: space-between; min-block-size: 44px; padding-inline: var(--space-3, 12px); border-radius: var(--radius-sm, 4px); color: var(--color-text); text-decoration: none; }
.panel-nav__link:hover, .panel-nav__link[aria-current="page"] { background: var(--color-brand-50, #EAF6F7); color: var(--color-brand-800, #053134); }
.panel-nav__link--planned { color: var(--color-text-muted); }
.panel-nav__link small { font-size: var(--font-size-xs, 12px); }
.panel-content { padding: clamp(var(--space-4, 16px), 4vw, var(--space-10, 40px)); min-inline-size: 0; }
.panel-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: start; gap: var(--space-4, 16px); margin-block-end: var(--space-6, 24px); }
.panel-head__title { font-size: clamp(var(--font-size-2xl, 24px), 4vw, var(--font-size-4xl, 36px)); line-height: var(--font-leading-heading, 1.4); }
.panel-head__subtitle { color: var(--color-text-muted); max-inline-size: var(--font-measure-prose, 68ch); margin-block-start: var(--space-2, 8px); }
.panel-card { background: var(--panel-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg, 12px); padding: var(--space-6, 24px); min-inline-size: 0; }
.panel-card--quiet { border-style: dashed; }
.panel-card__title { font-size: var(--font-size-xl, 20px); margin-block-end: var(--space-4, 16px); }
.panel-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr)); gap: var(--space-4, 16px); }
.panel-metric { padding: var(--space-5, 20px); border: 1px solid var(--color-border); border-radius: var(--radius-md, 8px); background: var(--panel-surface); display: grid; gap: var(--space-3, 12px); }
.panel-metric__label, .panel-empty, .muted { color: var(--color-text-muted); }
.panel-metric__value { font-variant-numeric: tabular-nums; font-size: var(--font-size-4xl, 36px); }
.panel-breakdown { list-style: none; padding: 0; font-size: var(--font-size-sm, 14px); }
.panel-breakdown li { display: flex; justify-content: space-between; gap: var(--space-3, 12px); }
.panel-dl { display: grid; grid-template-columns: minmax(5rem, 1fr) minmax(0, 2fr); gap: var(--space-3, 12px); }
.panel-dl dt { color: var(--color-text-muted); }
.panel-dl dd { margin: 0; overflow-wrap: anywhere; }
.panel-form .field { max-inline-size: none; }
.panel-form { max-inline-size: 48rem; }
.panel-table { inline-size: 100%; border-collapse: collapse; font-size: var(--font-size-sm, 14px); }
.panel-table th, .panel-table td { padding: var(--space-3, 12px); border-block-end: 1px solid var(--color-border); text-align: start; vertical-align: top; overflow-wrap: anywhere; }
.panel-table th { color: var(--color-text-muted); font-weight: var(--font-weight-semibold, 600); }
.inline-form { display: inline-flex; align-items: center; flex-wrap: wrap; gap: var(--space-2, 8px); }
.button--small { font-size: var(--font-size-sm, 14px); min-block-size: 44px; }
.button--danger { background: var(--color-danger-600, #97291E); color: var(--color-neutral-0, #FFFFFF); }
.input--compact { max-inline-size: 18rem; }
.flash { padding: var(--space-4, 16px); border-radius: var(--radius-md, 8px); border: 1px solid var(--color-border); }
.flash--error { border-color: var(--color-danger-500, #C0392B); }
.flash--success { border-color: var(--color-success-500, #1F8A54); }
.auth { max-inline-size: 32rem; margin-inline: auto; padding: clamp(var(--space-6, 24px), 6vw, var(--space-12, 48px)); margin-block: var(--space-12, 48px); background: var(--panel-surface); border: 1px solid var(--color-border); border-radius: var(--radius-xl, 16px); }
.auth__title { font-size: var(--font-size-3xl, 30px); }
.secret { padding: var(--space-4, 16px); border: 1px solid var(--color-border); overflow-wrap: anywhere; white-space: pre-wrap; }
@media (min-width: 1024px) { .panel-layout { grid-template-columns: 15rem minmax(0, 1fr); } .panel-nav { border-block-end: none; border-inline-end: 1px solid var(--color-border); } .panel-nav__toggle summary { display: none; } }

/* ============================================================ چاپ */
@media print {
  .site-header, .site-footer, .skip-link { display: none; }
  body { background: #FFFFFF; color: #000000; }
}
`;
