/**
 * تم: از ردیف‌های `design.token` تا یک بستهٔ CSS آمادهٔ چاپ (گام ۲۲).
 *
 * چرا دو حالت را با هم می‌سازیم: اگر حالت تاریک را «دوباره درخواست» کنیم،
 * یعنی دو کوئری و دو حالت بارگذاری. یک کوئری، هر دو تم را می‌آورد؛ حالت تاریک
 * داخل `@media (prefers-color-scheme: dark)` می‌نشیند و انتخاب صریح کاربر
 * (`data-theme`) از آن بالاتر می‌ایستد.
 *
 * نکتهٔ مهم دربارهٔ «تاریک خودکار»: اگر کاربر تم را دستی انتخاب کرده باشد،
 * `color-scheme` و انتخابش بر رسانهٔ سیستم مقدم است — وگرنه انتخاب کاربر
 * بی‌اثر می‌شد.
 */

import type { Row } from '@petavu/db';

import { buildTokenSet, type ThemeMode, type TokenRow } from './tokens.js';

export interface ThemeBundle {
  readonly light: ThemeMode;
  readonly darkAvailable: boolean;
  readonly tokenCount: number;
  readonly rejected: readonly { key: string; reason: string }[];
  readonly unresolved: readonly string[];
  /** `:root { ... }` روشن + بلوک تاریک/پرکنتراست. */
  readonly css: string;
  /** رنگ نوار مرورگر موبایل، از خود توکن‌ها. */
  readonly themeColorLight: string;
  readonly themeColorDark: string;
}

interface TokenQueryRow extends Row {
  key: string;
  group_key: string;
  value: unknown;
  value_type: TokenRow['value_type'];
  alias_of: string | null;
  theme_mode: ThemeMode;
  description: string | null;
}

/**
 * کوئری به‌نام ستون‌ها (نه `select *`؛ §۶۴ و قاعدهٔ گام ۲۱).
 *
 * کسب‌وکارِ صاحب تم می‌تواند توکن‌های خودش را داشته باشد و همان‌ها بر توکن‌های
 * سراسری سوار می‌شوند؛ `coalesce` در `order by` تضمین می‌کند توکن اختصاصی
 * کسب‌وکار، برندهٔ همان کلید شود.
 */
export const TOKEN_QUERY = `
  select key, group_key, value, value_type, alias_of, theme_mode, description
  from design.token
  where ($1::uuid is null and business_id is null) or business_id = $1::uuid
  order by (business_id is null) asc, key asc, theme_mode asc
`;

export function buildTheme(rows: readonly TokenQueryRow[]): ThemeBundle {
  // `TokenQueryRow` دقیقاً شکل `TokenRow` است؛ فقط `Row` هم در آن هست. پس
  // تبدیل، صریح و بی‌ابهام است و کپی داده لازم نیست.
  const tokens: readonly TokenRow[] = rows;
  const light = buildTokenSet(tokens, 'light');
  const dark = buildTokenSet(tokens, 'dark');
  const highContrast = buildTokenSet(tokens, 'high_contrast');
  const darkAvailable = dark.tokens.size() > 0;

  const darkBlock = darkAvailable
    ? `
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
${indent(dark.tokens.toCssVars())}
  }
}`
    : '';

  const explicitDark = darkAvailable
    ? `
:root[data-theme='dark'] {
${indent(dark.tokens.toCssVars())}
}`
    : '';

  const contrastBlock = highContrast.tokens.size() > 0
    ? `
:root[data-theme='high_contrast'] {
${indent(highContrast.tokens.toCssVars())}
}`
    : '';

  const css = [
    `:root {\n${indent(light.tokens.toCssVars())}\n}`,
    darkBlock,
    explicitDark,
    contrastBlock,
  ]
    .filter((part) => part.trim().length > 0)
    .join('\n');

  return {
    light: 'light',
    darkAvailable,
    tokenCount: light.tokens.size(),
    rejected: light.rejected,
    unresolved: light.unresolved,
    css,
    themeColorLight: light.tokens.get('color.surface') ?? light.tokens.get('color.bg') ?? '#ffffff',
    themeColorDark: dark.tokens.get('color.surface') ?? dark.tokens.get('color.bg') ?? '#0B0D0F',
  };
}

function indent(block: string): string {
  return block
    .split('\n')
    .map((line) => (line.trim() ? `  ${line}` : line))
    .join('\n');
}
