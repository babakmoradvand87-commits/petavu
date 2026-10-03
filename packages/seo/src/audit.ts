/**
 * موتور بازرسی سئو (Addendum §46، §92؛ ناظر انتشار §96).
 *
 * بازرسی، **قاعده‌محور** است و نتیجه‌اش همان شکلی است که `seo.audit_finding`
 * ذخیره می‌کند: `rule_key`، `severity`، `message`، `remediation`. هیچ قاعده‌ای
 * «نظر» نمی‌دهد؛ هر قاعده به یک سنجهٔ قابل‌اندازه‌گیری وصل است.
 *
 * چرا شدت سه‌سطحی است: `blocker` یعنی «منتشر نکن» (بی‌عنوان، بی‌کانونیکال،
 * محتوای نازک)، `error` یعنی «سئو می‌شکند ولی صفحه می‌ایستد»، `warning` یعنی
 * «بهتر است درست شود». دروازهٔ انتشار فقط به `blocker` حساس است (§96)، ولی
 * داشبورد همه را نشان می‌دهد.
 */

import { displayLength, looksGeneric, normalizePersian } from '@petavu/shared';

export type Severity = 'blocker' | 'error' | 'warning' | 'info';

export interface Finding {
  ruleKey: string;
  severity: Severity;
  path: string | null;
  message: string;
  remediation: string;
  details?: Record<string, unknown>;
}

export interface PageSnapshot {
  /** مسیر صفحه؛ در همهٔ یافته‌ها می‌آید تا «کجا» معلوم باشد. */
  path: string;
  /** عنوان نهایی هد. */
  title: string | null;
  description: string | null;
  /** بلندترین متن قابل‌نمایش صفحه (برای سنجش «نازکی»). */
  bodyText?: string | null;
  headings?: ReadonlyArray<{ level: number; text: string }>;
  images?: ReadonlyArray<{ src: string; alt?: string | null; loading?: string | null }>;
  links?: ReadonlyArray<{ href: string; text?: string | null; rel?: string | null }>;
  canonicalUrl?: string | null;
  /** آیا کانونیکال به خودِ صفحه اشاره می‌کند؟ */
  canonicalSelfReferencing?: boolean;
  indexable?: boolean;
  robotsDirectives?: readonly string[];
  structuredDataTypes?: readonly string[];
  /** اندازهٔ HTML (کیلوبایت) برای سنجش وزن. */
  htmlBytes?: number | null;
  /** بودجهٔ عملکرد مسیر، اگر تعریف شده باشد. */
  budget?: { lcpMs?: number | null; cls?: number | null; weightKb?: number | null } | null;
  /** سنجه‌های میدانی مسیر، اگر باشند. */
  metrics?: { lcpMs?: number | null; cls?: number | null; samples?: number | null } | null;
  statusCode?: number | null;
  redirectChain?: readonly string[];
  /** تعداد کل نشانی‌های شناخته‌شدهٔ سایت — برای سنجش یتیم‌بودن. */
  siteUrlCount?: number | null;
  /** نام برند/کسب‌وکار؛ اگر بدهید، وجودش در عنوان سنجیده می‌شود. */
  siteName?: string | null;
  inboundInternalLinks?: number | null;
}

export interface AuditOptions {
  /** حداقل نویسهٔ متن قابل‌نمایش تا «نازک» نباشد. */
  thinContentFloor?: number;
  /** سقف وزن HTML، کیلوبایت. */
  weightCeilingKb?: number;
  /** کف پیوندهای داخلی ورودی تا صفحه «یتیم» نباشد. */
  orphanFloor?: number;
  /** قواعد خاموش — برای محیطی که قاعده‌ای هنوز اجرا نمی‌شود. */
  disabledRules?: readonly string[];
}

export interface AuditResult {
  score: number;
  counts: Record<Severity, number>;
  findings: Finding[];
  verdict: 'pass' | 'warn' | 'block';
}

const WEIGHTS: Record<Severity, number> = { blocker: 40, error: 15, warning: 5, info: 0 };

const TITLE_MIN = 10;
const TITLE_TARGET_MAX = 60;
const DESCRIPTION_MIN = 40;
const DESCRIPTION_TARGET_MAX = 155;

export function runAudit(page: PageSnapshot, options: AuditOptions = {}): AuditResult {
  const findings: Finding[] = [];
  const disabled = new Set(options.disabledRules ?? []);

  const add = (finding: Finding): void => {
    if (disabled.has(finding.ruleKey)) return;
    findings.push({ ...finding, path: finding.path ?? page.path });
  };

  // ------------------------------------------------------------------ عنوان
  const title = page.title ? normalizePersian(page.title).trim() : '';
  if (title === '') {
    add({
      ruleKey: 'title.missing',
      severity: 'blocker',
      path: page.path,
      message: 'صفحه عنوان ندارد.',
      remediation: 'عنوان از قالب سئو بسازید یا در فراداده ثبت کنید.',
    });
  } else {
    if (displayLength(title) < TITLE_MIN) {
      add({
        ruleKey: 'title.too_short',
        severity: 'warning',
        path: page.path,
        message: `عنوان کوتاه است (${displayLength(title)} نویسه).`,
        remediation: 'نام کسب‌وکار، خدمت اصلی یا شهر را به عنوان بیفزایید.',
      });
    }
    if (displayLength(title) > TITLE_TARGET_MAX) {
      add({
        ruleKey: 'title.too_long',
        severity: 'warning',
        path: page.path,
        message: `عنوان بلندتر از هدف است (${displayLength(title)} نویسه).`,
        remediation: 'قالب را کوتاه کنید؛ بخش انتهایی در نتایج بریده می‌شود.',
      });
    }
    if (looksGeneric(title)) {
      add({
        ruleKey: 'title.generic',
        severity: 'warning',
        path: page.path,
        message: 'عنوان، عبارت کلیشه‌ای ماشینی دارد.',
        remediation: 'به‌جای عبارت‌های تبلیغاتی توخالی، خدمت مشخص و محدودهٔ کار را بنویسید.',
      });
    }
    if (page.siteName && !title.toLowerCase().includes(page.siteName.toLowerCase())) {
      add({
        ruleKey: 'title.brand_missing',
        severity: 'warning',
        path: page.path,
        message: `نام برند «${page.siteName}» در عنوان نیست.`,
        remediation: 'نام کسب‌وکار را در ابتدا یا انتهای عنوان بیاورید.',
        details: { siteName: page.siteName },
      });
    }
  }

  // ------------------------------------------------------------------- توضیح
  const description = page.description ? normalizePersian(page.description).trim() : '';
  if (description === '') {
    add({
      ruleKey: 'description.missing',
      severity: 'error',
      path: page.path,
      message: 'توضیح متا ندارد؛ موتور جست‌وجو خودش می‌سازد.',
      remediation: 'قالب توضیح را پر کنید یا `seo.metadata.description` را بنویسید.',
    });
  } else {
    if (displayLength(description) < DESCRIPTION_MIN) {
      add({
        ruleKey: 'description.too_short',
        severity: 'warning',
        path: page.path,
        message: `توضیح کوتاه است (${displayLength(description)} نویسه).`,
        remediation: 'خدمت، مزیت و شهر را در یک جمله بیاورید.',
      });
    }
    if (displayLength(description) > DESCRIPTION_TARGET_MAX) {
      add({
        ruleKey: 'description.too_long',
        severity: 'warning',
        path: page.path,
        message: `توضیح بلندتر از هدف است (${displayLength(description)} نویسه).`,
        remediation: 'توضیح را در ۱۵۵ نویسه جمع کنید.',
      });
    }
  }

  // ------------------------------------------------------------------ ساختار
  const headings = page.headings ?? [];
  const h1Count = headings.filter((heading) => heading.level === 1).length;
  if (h1Count === 0 && headings.length > 0) {
    add({
      ruleKey: 'headings.h1_missing',
      severity: 'error',
      path: page.path,
      message: 'صفحه `h1` ندارد.',
      remediation: 'عنوان اصلی صفحه را با `h1` بگذارید (یک بار).',
    });
  }
  if (h1Count > 1) {
    add({
      ruleKey: 'headings.h1_multiple',
      severity: 'warning',
      path: page.path,
      message: `صفحه ${h1Count} تا \`h1\` دارد.`,
      remediation: 'فقط عنوان اصلی `h1` باشد؛ بقیه `h2`/`h3`.',
    });
  }

  // ------------------------------------------------------------- تصویر و پیوند
  for (const image of page.images ?? []) {
    if (!image.alt || image.alt.trim() === '') {
      add({
        ruleKey: 'image.alt_missing',
        severity: 'warning',
        path: page.path,
        message: 'تصویر بدون متن جایگزین.',
        remediation: 'متن جایگزین معنادار بنویسید (نه نام فایل).',
        details: { src: image.src },
      });
    }
  }

  const internalLinks = (page.links ?? []).filter((link) => link.href.startsWith('/'));
  if (internalLinks.length < 3) {
    add({
      ruleKey: 'links.internal_few',
      severity: 'warning',
      path: page.path,
      message: `تنها ${internalLinks.length} پیوند داخلی در صفحه هست.`,
      remediation: 'به خدمات مرتبط، مقاله‌های مرتبط و صفحهٔ تماس پیوند بدهید.',
    });
  }
  for (const link of page.links ?? []) {
    if (link.rel?.includes('nofollow') && link.href.startsWith('/')) {
      add({
        ruleKey: 'links.internal_nofollow',
        severity: 'error',
        path: page.path,
        message: 'پیوند داخلی با `nofollow`؛ اعتبار داخلی قطع می‌شود.',
        remediation: '`nofollow` را از پیوندهای داخلی بردارید.',
        details: { href: link.href },
      });
    }
  }

  // ------------------------------------------------------------- محتوای نازک
  const text = normalizePersian(page.bodyText ?? '').trim();
  const thinFloor = options.thinContentFloor ?? 300;
  if (text.length < thinFloor) {
    add({
      ruleKey: 'content.thin',
      severity: text.length < thinFloor / 2 ? 'blocker' : 'warning',
      path: page.path,
      message: `متن قابل‌نمایش ${text.length} نویسه است (کف: ${thinFloor}).`,
      remediation: 'توضیح خدمت، محدودهٔ کاری و پرسش‌های پرتکرار مشتری را بیفزایید.',
      details: { characters: text.length, floor: thinFloor },
    });
  }

  // ------------------------------------------------------- کانونیکال و ایندکس
  if (page.canonicalUrl === null || page.canonicalUrl === undefined) {
    add({
      ruleKey: 'canonical.missing',
      severity: 'blocker',
      path: page.path,
      message: 'کانونیکال تعریف نشده.',
      remediation: 'کانونیکال را از موتور کانونیکال بسازید (پارامترهای ردیابی حذف شوند).',
    });
  } else if (page.canonicalSelfReferencing === false) {
    add({
      ruleKey: 'canonical.not_self',
      severity: 'error',
      path: page.path,
      message: 'کانونیکال به صفحهٔ دیگری اشاره می‌کند.',
      remediation: 'اگر عمدی است، دلیلش را در `seo.canonical` ثبت کنید؛ وگرنه خودارجاع کنید.',
      details: { canonical: page.canonicalUrl },
    });
  }

  const directives = page.robotsDirectives ?? [];
  if (page.indexable === true && directives.some((directive) => directive.startsWith('noindex'))) {
    add({
      ruleKey: 'robots.indexable_conflict',
      severity: 'blocker',
      path: page.path,
      message: 'صفحه نمایه‌پذیر اعلام شده ولی `noindex` دارد.',
      remediation: 'یکی را انتخاب کنید؛ تناقض، نمایه‌شدن را غیرقابل‌پیش‌بینی می‌کند.',
    });
  }

  // ------------------------------------------------------- داده ساخت‌یافته
  const structuredTypes = page.structuredDataTypes ?? [];
  if (structuredTypes.length === 0) {
    add({
      ruleKey: 'structured_data.missing',
      severity: 'error',
      path: page.path,
      message: 'داده ساخت‌یافته ندارد.',
      remediation: 'گراف را با گرهٔ برند و گرهٔ نوع صفحه بسازید (`buildGraph`).',
    });
  } else if (!structuredTypes.some((type) => type === 'Organization' || type === 'LocalBusiness')) {
    add({
      ruleKey: 'structured_data.brand_missing',
      severity: 'warning',
      path: page.path,
      message: 'گراف، گرهٔ برند (Organization/LocalBusiness) ندارد.',
      remediation: 'نهاد برند، مرکز گراف است؛ آن را بیفزایید.',
    });
  }

  // --------------------------------------------------------------- وزن و سرعت
  if (page.htmlBytes && page.htmlBytes > (options.weightCeilingKb ?? 180) * 1024) {
    add({
      ruleKey: 'performance.html_heavy',
      severity: 'error',
      path: page.path,
      message: `وزن HTML ${Math.round(page.htmlBytes / 1024)} کیلوبایت است.`,
      remediation: 'درخت صفحه را سبک کنید؛ اجزای تکراری را به کامپوننت منتقل کنید.',
    });
  }

  const metrics = page.metrics ?? null;
  const budget = page.budget ?? null;
  if (metrics && budget && (metrics.samples ?? 0) > 0) {
    if (metrics.lcpMs && budget.lcpMs && metrics.lcpMs > budget.lcpMs * 1.2) {
      add({
        ruleKey: 'performance.lcp_over_budget',
        severity: 'error',
        path: page.path,
        message: `LCP میدانی ${Math.round(metrics.lcpMs)}ms از بودجه (${budget.lcpMs}ms) گذشته.`,
        remediation: 'تصویر شاخص را eager و بهینه کنید؛ منابع مسدودکننده را عقب بیندازید.',
        details: { lcpMs: metrics.lcpMs, budgetMs: budget.lcpMs, samples: metrics.samples },
      });
    }
    if (metrics.cls && budget.cls && metrics.cls > budget.cls * 1.2) {
      add({
        ruleKey: 'performance.cls_over_budget',
        severity: 'error',
        path: page.path,
        message: `CLS میدانی ${metrics.cls} از بودجه (${budget.cls}) گذشته.`,
        remediation: 'ابعاد تصویر و جای تبلیغ را از پیش رزرو کنید.',
      });
    }
  }

  // ------------------------------------------------------- ایندکس‌پذیری و نقل
  if (page.statusCode && page.statusCode >= 400) {
    add({
      ruleKey: 'http.error_status',
      severity: 'blocker',
      path: page.path,
      message: `کد وضعیت ${page.statusCode}.`,
      remediation: 'صفحه باید ۲۰۰ برگرداند (یا ۴۱۰ اگر عمداً رفته است).',
    });
  }

  const redirectChain = page.redirectChain ?? [];
  if (redirectChain.length > 1) {
    add({
      ruleKey: 'redirect.chain',
      severity: 'error',
      path: page.path,
      message: `زنجیرهٔ تغییر مسیر به طول ${redirectChain.length}.`,
      remediation: 'مقصد نهایی را مستقیم اعلام کنید؛ زنجیره، اعتبار را می‌خورد.',
      details: { chain: redirectChain.join(' → ') },
    });
  }

  const orphanFloor = options.orphanFloor ?? 1;
  if ((page.inboundInternalLinks ?? 0) < orphanFloor && (page.siteUrlCount ?? 0) > 1) {
    add({
      ruleKey: 'links.orphan',
      severity: 'warning',
      path: page.path,
      message: 'صفحهٔ یتیم: هیچ پیوند داخلی ورودی ندارد.',
      remediation: 'از صفحهٔ دسته یا مقالهٔ مرتبط به آن پیوند بدهید.',
    });
  }

  // ------------------------------------------------------------------- جمع‌بندی
  const counts: Record<Severity, number> = { blocker: 0, error: 0, warning: 0, info: 0 };
  let penalty = 0;
  for (const finding of findings) {
    counts[finding.severity] += 1;
    penalty += WEIGHTS[finding.severity];
  }

  const score = Math.max(0, 100 - penalty);
  const verdict: AuditResult['verdict'] = counts.blocker > 0 ? 'block' : counts.error > 0 ? 'warn' : 'pass';

  return { score, counts, findings, verdict };
}
