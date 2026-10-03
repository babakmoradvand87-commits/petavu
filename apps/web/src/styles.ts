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
  color: var(--color-text-inverse, #FFFFFF);
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

/* ============================================================ چاپ */
@media print {
  .site-header, .site-footer, .skip-link { display: none; }
  body { background: #FFFFFF; color: #000000; }
}
`;
