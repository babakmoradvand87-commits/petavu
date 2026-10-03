/**
 * موتور قالب سئو (Addendum §30–۳۸).
 *
 * قالب، **داده** است: در `seo.template` ذخیره می‌شود و بدون استقرار کد عوض
 * می‌شود. پس این فایل یک «رندر» کوچک است، نه یک زبان قالب: تنها چیزی که
 * می‌فهمد `{token}` است. هیچ شرط، هیچ حلقه، هیچ ارزیابی کد — چون قالبی که
 * بتواند کد اجرا کند، یک درِ پشتی امنیتی است (§74).
 *
 * سه قاعدهٔ واقعی که از دادهٔ مرجع درآمدند:
 *
 *   ۱) `{sep}` جداکنندهٔ عنوان است (`seo.settings.title_separator`)، نه یک
 *      نویسهٔ ثابت: هر کسب‌وکار می‌تواند «|» یا «—» بخواهد.
 *   ۲) توکنِ خالی، قطعهٔ خالی می‌سازد: «کلینیک {sep} {city} {sep} PETAVU» با
 *      شهرِ نداشته باید «کلینیک | PETAVU» بدهد، نه «کلینیک | | PETAVU».
 *   ۳) طول، بخشی از درستی است: عنوان بیرون از ۳..۳۰۰ (قید `seo.metadata`)
 *      اصلاً ذخیره نمی‌شود؛ پس رندر باید پیش از ذخیره ببرد.
 */

import { normalizePersian, truncate } from '@petavu/shared';

/** سقف‌های واقعی سئو؛ همان‌هایی که ابزارهای سنجش گزارش می‌کنند. */
export const TITLE_TARGET = 60;
export const TITLE_MAX = 300;
export const DESCRIPTION_TARGET = 155;
export const DESCRIPTION_MAX = 400;

export interface TemplateRenderOptions {
  /** جداکنندهٔ قطعه‌ها؛ از `seo.settings.title_separator`. */
  separator?: string;
  /** سقف طول هدف (نرم): بریدن با «…». */
  targetLength?: number;
  /** سقف سخت: هرچه بیش از این باشد، خطاست نه سلیقه. */
  hardLimit?: number;
  /** اگر نتیجه خالی شد، این برگردد. */
  fallback?: string;
}

export interface RenderedText {
  text: string;
  /** پیش از بریدن. */
  rawLength: number;
  truncated: boolean;
  /** توکن‌هایی که در متن بودند ولی مقدار نداشتند. */
  missingTokens: string[];
  /** توکن‌هایی که در قالب بودند ولی در دادهٔ ورودی نبودند (حتی خالی). */
  unknownTokens: string[];
}

const TOKEN_PATTERN = /\{([a-z0-9_]+)\}/gi;

/** توکن‌های یک قالب — برای پیش‌نمایش در استودیو و بازرسی. */
export function listTokens(pattern: string): string[] {
  const found = new Set<string>();
  for (const match of pattern.matchAll(TOKEN_PATTERN)) {
    const token = match[1];
    if (token) found.add(token.toLowerCase());
  }
  return [...found];
}

/** اعتبارسنجی قالب: توکن بی‌شکل، یا قالبی که هیچ متنی ندارد. */
export function validateTemplate(pattern: string): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (typeof pattern !== 'string' || pattern.trim() === '') problems.push('empty_template');

  // گیومهٔ فارسی/تایپی جفت‌نشده یا آکولاد باز بی‌بست، قالب را خراب می‌کند.
  const opens = (pattern.match(/\{/g) ?? []).length;
  const closes = (pattern.match(/\}/g) ?? []).length;
  if (opens !== closes) problems.push('unbalanced_braces');

  const stripped = pattern.replace(TOKEN_PATTERN, '');
  if (stripped.replace(/[\s\u200c|—–-]/g, '') === '' && opens === 0) problems.push('no_literal_text');

  return { ok: problems.length === 0, problems };
}

/**
 * رندر قالب.
 *
 * چرا `separator` یک *قطعه* است و نه یک نویسهٔ چسبیده: در متن فارسی، فاصله‌ها
 * حول جداکننده بخشی از زیبایی‌اند؛ اگر جداکننده بی‌فاصله چسبانده شود،
 * «کلینیک|PETAVU» درمی‌آید. پس جداکننده با فاصلهٔ دوطرفش ساخته می‌شود.
 */
export function renderTemplate(pattern: string, values: Record<string, unknown>, options: TemplateRenderOptions = {}): RenderedText {
  const separator = options.separator ?? '|';
  /** توکن‌هایی که در قالب بودند ولی مقدارشان تهی بود. */
  const empty: string[] = [];
  /** توکن‌هایی که در دادهٔ ورودی اصلاً نبودند. */
  const unresolved: string[] = [];

  const pieces: string[] = [];
  let cursor = 0;

  const pushLiteral = (literal: string): void => {
    const clean = literal.trim();
    if (clean !== '') pieces.push(clean);
  };

  for (const match of pattern.matchAll(TOKEN_PATTERN)) {
    const index = match.index ?? 0;
    const token = (match[1] ?? '').toLowerCase();
    pushLiteral(pattern.slice(cursor, index));
    cursor = index + match[0].length;

    if (token === 'sep' || token === 'separator') {
      pieces.push(separator);
      continue;
    }

    let value: unknown = values[token];
    if (value === undefined) {
      // نام‌های جایگزین رایج، تا قالب‌های دادهٔ مرجع بدون شکست کار کنند.
      const alias: Record<string, string> = { business_name: 'name', city_name: 'city', type_plural: 'type' };
      value = alias[token] ? values[alias[token] as string] : undefined;
    }

    if (value === undefined) {
      unresolved.push(token);
      continue;
    }

    const text = normalizePersian(String(value ?? '')).trim();
    if (text === '') {
      empty.push(token);
      continue;
    }
    pieces.push(text);
  }
  pushLiteral(pattern.slice(cursor));

  /*
   * جداکننده‌های تنها می‌روند: «کلینیک | | PETAVU» هرگز نباید ساخته شود.
   * این پاک‌سازی، دلیلِ وجود `|` به‌عنوان قطعه است و نه نویسهٔ چسبیده.
   */
  const compacted: string[] = [];
  for (const piece of pieces) {
    const isSeparator = piece === separator;
    if (isSeparator && (compacted.length === 0 || compacted[compacted.length - 1] === separator)) continue;
    compacted.push(piece);
  }
  while (compacted.length > 0 && compacted[compacted.length - 1] === separator) compacted.pop();

  const joined = compacted.join(' ');
  const rawLength = joined.length;
  const limit = Math.min(options.targetLength ?? TITLE_TARGET, options.hardLimit ?? TITLE_MAX);
  const text = truncate(joined, limit) || options.fallback || '';

  return {
    text,
    rawLength,
    truncated: rawLength > text.length,
    missingTokens: [...new Set(empty)],
    unknownTokens: [...new Set(unresolved)],
  };
}

/** قالب نامک: `{slug}` و توکن‌های نامک‌پذیر. */
export function renderSlugTemplate(pattern: string, values: Record<string, unknown>): string {
  const rendered = renderTemplate(pattern, values, { separator: '-', targetLength: 120, hardLimit: 160 });
  return rendered.text
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}
