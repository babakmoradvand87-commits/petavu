/**
 * دروازهٔ انتشار سئو (Addendum §96، §100).
 *
 * خط لولهٔ انتشار، ۱۷ ایستگاه دارد؛ ایستگاه سئو یکی از آن‌هاست و باید **حکم**
 * بدهد، نه نظر. سه وضعیت:
 *
 *   • `block` — انتشار متوقف می‌شود (مانع سئو یا مانع سخت).
 *   • `warn` — منتشر می‌شود، ولی در داشبورد می‌ماند.
 *   • `pass` — هیچ چیزی نیست که بگوید.
 *
 * ورودی‌ها همان چیزهایی‌اند که در ایستگاه‌های پیشین ساخته شده‌اند: هد، گراف
 * داده ساخت‌یافته، نتیجهٔ بازرسی، حضور در سایتمپ، و وضعیت محتوا. هیچ ورودی‌ای
 * «حدس» زده نمی‌شود.
 */

import type { AuditResult } from './audit.js';
import type { HeadTag } from './head.js';
import { validateGraph } from './structured-data.js';

export interface SeoGateInput {
  path: string;
  /** پایان هد ساخته‌شده. */
  head: readonly HeadTag[];
  /** گراف داده ساخت‌یافته، سریال‌شده (اگر باشد). */
  structuredData?: string | null;
  /** نتیجهٔ بازرسی؛ اگر نباشد، شرط «بازرسی انجام شد» رد می‌شود. */
  audit?: AuditResult | null;
  /** آیا مسیر در سایتمپ هست؟ */
  inSitemap?: boolean;
  /** برای صفحه‌ای که عمداً نمایه نمی‌شود، سایتمپ و کانونیکال شرط نیست. */
  intentionallyNoIndex?: boolean;
  /** مسیر در فهرست `redirect` است — نباید محتوای رقیب بسازد. */
  hasRedirectSource?: boolean;
  /** زبان صفحه؛ برای سنجش hreflang در سایت چندزبانه. */
  locale?: string | null;
}

export interface GateBlocker {
  code: string;
  message: string;
  remediation: string;
}

export interface SeoGateVerdict {
  verdict: 'pass' | 'warn' | 'block';
  blockers: GateBlocker[];
  warnings: GateBlocker[];
  checkedAt: string;
}

/** محتوای یک `meta` با نام یا ویژگی داده‌شده؛ پیشوند `og:` هم پوشش می‌یابد. */
function metaContent(tags: readonly HeadTag[], name: string): string | null {
  const found = tags.find((item) => item.tag === 'meta' && (item.attrs.name === name || item.attrs.property === name));
  return found?.attrs.content ?? null;
}

function linkHref(tags: readonly HeadTag[], rel: string): string | null {
  const found = tags.find((item) => item.tag === 'link' && item.attrs.rel === rel);
  return found?.attrs.href ?? null;
}

export function evaluateSeoGate(input: SeoGateInput, now: Date = new Date()): SeoGateVerdict {
  const blockers: GateBlocker[] = [];
  const warnings: GateBlocker[] = [];

  const title = input.head.find((tag) => tag.tag === 'title')?.content ?? null;
  const description = metaContent(input.head, 'description');
  const canonical = linkHref(input.head, 'canonical');
  const robots = metaContent(input.head, 'robots');

  if (!title || title.trim() === '') {
    blockers.push({ code: 'title_missing', message: 'بدون عنوان، صفحه در نتایج بی‌نام می‌شود.', remediation: 'قالب عنوان را پر کنید.' });
  }
  if (!canonical && !input.intentionallyNoIndex) {
    blockers.push({ code: 'canonical_missing', message: 'صفحهٔ نمایه‌پذیر بدون کانونیکال.', remediation: 'کانونیکال خودارجاع بسازید.' });
  }
  if (!description) {
    warnings.push({ code: 'description_missing', message: 'توضیح متا ندارد.', remediation: 'توضیح۱۵۵نویسه‌ای بنویسید.' });
  }
  if (!input.structuredData) {
    blockers.push({
      code: 'structured_data_missing',
      message: 'بدون داده ساخت‌یافته، موتور و مدل، موجودیت را نمی‌شناسند.',
      remediation: 'گراف را بسازید و در هد بگذارید.',
    });
  } else {
    const validation = validateGraph(input.structuredData);
    if (!validation.ok) {
      blockers.push({
        code: 'structured_data_invalid',
        message: `گراف داده ساخت‌یافته ناقص است: ${validation.problems.join(', ')}.`,
        remediation: 'گرهٔ برند و `@graph` را کامل کنید.',
      });
    }
  }

  if (!input.audit) {
    blockers.push({
      code: 'audit_missing',
      message: 'بازرسی سئو اجرا نشده.',
      remediation: 'ایستگاه بازرسی را پیش از انتشار اجرا کنید.',
    });
  } else {
    for (const finding of input.audit.findings.filter((item) => item.severity === 'blocker')) {
      blockers.push({ code: `audit.${finding.ruleKey}`, message: finding.message, remediation: finding.remediation });
    }
    for (const finding of input.audit.findings.filter((item) => item.severity === 'error')) {
      warnings.push({ code: `audit.${finding.ruleKey}`, message: finding.message, remediation: finding.remediation });
    }
  }

  if (input.inSitemap === false && !input.intentionallyNoIndex) {
    warnings.push({
      code: 'sitemap_missing',
      message: 'مسیر در سایتمپ نیست.',
      remediation: 'سایتمپ را بازسازی کنید (ایستگاه سایتمپ در خط لوله).',
    });
  }

  if (input.hasRedirectSource) {
    blockers.push({
      code: 'redirect_source_conflict',
      message: 'همین مسیر، مبدأ تغییر مسیر است؛ دو رقیب برای یک نشانی.',
      remediation: 'یا محتوا را منتشر کنید یا تغییر مسیر را بردارید — نه هر دو.',
    });
  }

  if (robots && robots.includes('noindex') && !input.intentionallyNoIndex) {
    blockers.push({
      code: 'robots_noindex_unexpected',
      message: '`noindex` بدون قصد ثبت‌شده.',
      remediation: 'اگر عمدی است، دلیلش را در فراداده ثبت کنید؛ وگرنه بردارید.',
    });
  }

  return {
    verdict: blockers.length > 0 ? 'block' : warnings.length > 0 ? 'warn' : 'pass',
    blockers,
    warnings,
    checkedAt: now.toISOString(),
  };
}
