/**
 * توکن‌های طراحی، از پایگاه‌داده تا متغیر CSS (گام ۲۲؛ §32–۴۴، §161–۱۶۹، Addendum §۴–۱۹).
 *
 * منبع حقیقت ظاهر، جدول `design.token` است — نه CSS، نه کد، نه کامپوننت. این
 * ماژول همان ردیف‌ها را می‌گیرد، ارجاع‌های معنایی (`alias_of`) را باز می‌کند و
 * به متغیرهای CSS تبدیل می‌کند.
 *
 * **مرز امنیتی** (همان چیزی که §43/§167 می‌خواهد): مقدار توکن، رشته‌ای است که
 * داخل CSS می‌نشیند. پس هر مقدار پیش از چاپ، در برابر شکل مجاز **نوعش** سنجیده
 * می‌شود. توکن رنگ نمی‌تواند `;}` یا `url(...)` یا `expression(...)` باشد؛
 * توکن طول نمی‌تواند تابع باشد. اعتبارسنجی این‌جا انجام می‌شود چون تنها جایی است
 * که دادهٔ قابل‌ویرایش به CSS می‌رسد.
 */

export type TokenValueType = 'color' | 'length' | 'number' | 'shadow' | 'font' | 'duration' | 'cubic' | 'list';
export type ThemeMode = 'light' | 'dark' | 'high_contrast';

export interface TokenRow {
  readonly key: string;
  readonly group_key: string;
  readonly value: unknown;
  readonly value_type: TokenValueType;
  readonly alias_of: string | null;
  readonly theme_mode: ThemeMode;
  readonly description?: string | null;
  readonly business_id?: string | null;
}

/**
 * مقدار توکن به رشتهٔ CSS.
 *
 * سه شکل مجاز داریم و بیش از این نه:
 *   • رشته — حالت رایج.
 *   • عدد — برای `value_type: number`.
 *   • آرایهٔ لایه‌های سایه — همان شکلی که `seeds/0002_design_system.sql` برای
 *     `shadow.*` می‌نویسد: `[{x,y,blur,spread,color}]`. این را به
 *     `<x> <y> <blur> <spread> <color>` و لایه‌ها را با کاما به هم می‌چسبانیم.
 * هر شکل دیگر (شیء دلبخواه، تابع، …) رد می‌شود؛ چون نمی‌دانیم چه معنایی دارد و
 * «نمی‌دانم» در CSS جای امنی ندارد.
 */
function scalarToString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'none';
    return value.map((layer) => shadowLayer(layer)).join(', ');
  }
  throw new Error(`مقدار توکن باید رشته، عدد یا فهرست لایه‌های سایه باشد، نه ${typeof value}`);
}

interface ShadowLayer {
  x?: number;
  y?: number;
  blur?: number;
  spread?: number;
  color?: string;
  inset?: boolean;
}

function shadowLayer(layer: unknown): string {
  if (typeof layer !== 'object' || layer === null) throw new Error('لایهٔ سایه باید شیء باشد');
  const { x = 0, y = 0, blur = 0, spread = 0, color, inset = false } = layer as ShadowLayer;
  if (typeof color !== 'string' || color.length === 0) throw new Error('لایهٔ سایه باید رنگ داشته باشد');
  for (const [name, number] of [['x', x], ['y', y], ['blur', blur], ['spread', spread]] as const) {
    if (typeof number !== 'number' || !Number.isFinite(number)) throw new Error(`مقدار ${name} در لایهٔ سایه نامعتبر است`);
  }
  return `${inset ? 'inset ' : ''}${x}px ${y}px ${blur}px ${spread}px ${color}`;
}

const PATTERNS: Record<TokenValueType, RegExp> = {
  // رنگ: hex، rgb/rgba/hsl/hsla/oklch/color-mix ساده، یا کلیدواژهٔ مجاز.
  color: /^(#[0-9a-fA-F]{3,8}|(?:rgb|rgba|hsl|hsla|oklch|lab|lch)\(\s*[-+0-9.%,\s/\wdeg]+\)|transparent|currentColor|inherit|none)$/,
  length: /^-?(?:\d+|\d*\.\d+)(?:px|rem|em|%|vh|vw|vmin|vmax|ch|ex|pt|cm|mm)?$/,
  number: /^-?\d*\.?\d+$/,
  duration: /^\d*\.?\d+(ms|s)$/,
  cubic: /^cubic-bezier\(\s*-?\d*\.?\d+(\s*,\s*-?\d*\.?\d+){3}\s*\)$/,
  // فونت: پشتهٔ نام خانواده‌ها (نه تابع و نه کوتیشن تکی که بشکند).
  // `(` و `)` و `;` و `}` عمداً مجاز نیستند؛ همین‌ها راه تزریق CSS‌اند.
  font: /^[A-Za-z\u0600-\u06FF][A-Za-z0-9\u0600-\u06FF _'\-]*(\s*,\s*[A-Za-z\u0600-\u06FF][A-Za-z0-9\u0600-\u06FF _'\-]*)*$/,
  /*
   * سایه: یک یا چند لایه، هر لایه دو تا چهار طول و یک رنگ.
   * `none` هم مجاز است (لایهٔ صفر) — چون حذف سایه در تم‌های سفارشی رایج است.
   */
  shadow: /^(none|(inset\s+)?(-?\d*\.?\d+(px|rem|em)\s+){2,4}(#[0-9a-fA-F]{3,8}|rgba?\s*\([0-9.,\s%]+\)|hsla?\s*\([0-9.,\s%deg]+\))(\s*,\s*(inset\s+)?(-?\d*\.?\d+(px|rem|em)\s+){2,4}(#[0-9a-fA-F]{3,8}|rgba?\s*\([0-9.,\s%]+\)|hsla?\s*\([0-9.,\s%deg]+\)))*)$/,
  // سیاهه: چند مقدار از انواع بالا، با کاما (مثل `font.family`).
  list: /^[A-Za-z0-9\u0600-\u06FF _\-.,%#()\s]+$/,
};

export class UnsafeTokenValueError extends Error {
  constructor(
    readonly key: string,
    readonly valueType: TokenValueType,
    readonly value: string,
  ) {
    super(`مقدار توکن «${key}» با نوع ${valueType} نمی‌خواند`);
    this.name = 'UnsafeTokenValueError';
  }
}

/** مقدار را برای نوعش اعتبارسنجی و به رشته تبدیل می‌کند. خروجی هرگز کد نیست. */
export function safeTokenValue(key: string, valueType: TokenValueType, value: unknown): string {
  const text = scalarToString(value).trim();
  const pattern = PATTERNS[valueType];
  if (!pattern || !pattern.test(text)) throw new UnsafeTokenValueError(key, valueType, text);
  return text;
}

export interface TokenSet {
  readonly mode: ThemeMode;
  /** مقدار نهایی (پس از باز کردن ارجاع‌ها) و امن‌شده. */
  get(key: string): string | undefined;
  has(key: string): boolean;
  /** کلیدهای حاضر، مرتب‌شده — برای تست پوشش و برای پنل. */
  keys(): readonly string[];
  /** `--color-bg: #fff;` برای همهٔ توکن‌ها. */
  toCssVars(): string;
  size(): number;
}

export interface TokenSetResult {
  readonly tokens: TokenSet;
  /** توکن‌هایی که به‌دلیل مقدار نامعتبر رد شدند — گزارش صادقانه، نه سکوت. */
  readonly rejected: readonly { key: string; reason: string }[];
  /** ارجاع‌های شکسته/حلقه‌دار — نباید بی‌صدا از دست بروند. */
  readonly unresolved: readonly string[];
}

/** `color.text.muted` ⇒ `--color-text-muted` */
export function cssVarName(key: string): string {
  return `--${key.replace(/\./g, '-')}`;
}

const MAX_ALIAS_DEPTH = 8;

export function buildTokenSet(rows: readonly TokenRow[], mode: ThemeMode): TokenSetResult {
  const byKey = new Map<string, TokenRow>();
  for (const row of rows) {
    if (row.theme_mode !== mode) continue;
    byKey.set(row.key, row);
  }

  const rejected: { key: string; reason: string }[] = [];
  const unresolved: string[] = [];
  const resolved = new Map<string, string>();

  const resolve = (key: string, depth = 0): string | undefined => {
    const cached = resolved.get(key);
    if (cached !== undefined) return cached;
    if (depth > MAX_ALIAS_DEPTH) {
      unresolved.push(key);
      return undefined;
    }

    const row = byKey.get(key);
    if (!row) return undefined;

    if (row.alias_of) {
      const target = resolve(row.alias_of, depth + 1);
      if (target === undefined) {
        // ارجاع به توکن غایب: مقدار خودش را داریم، ولی باید بلند بگوییم.
        unresolved.push(`${key}→${row.alias_of}`);
      } else {
        // توکن معنایی، مقدار هدف را می‌گیرد؛ ولی نوع خودش تعیین‌کنندهٔ اعتبار است.
        if (PATTERNS[row.value_type].test(target)) {
          resolved.set(key, target);
          return target;
        }
      }
    }

    try {
      const safe = safeTokenValue(key, row.value_type, row.value);
      resolved.set(key, safe);
      return safe;
    } catch (error) {
      rejected.push({ key, reason: error instanceof Error ? error.message : String(error) });
      return undefined;
    }
  };

  for (const key of byKey.keys()) resolve(key);

  const sortedKeys = [...resolved.keys()].sort();

  return {
    rejected,
    unresolved,
    tokens: {
      mode,
      get: (key) => resolved.get(key),
      has: (key) => resolved.has(key),
      keys: () => sortedKeys,
      toCssVars: () => sortedKeys.map((key) => `  ${cssVarName(key)}: ${resolved.get(key)};`).join('\n'),
      size: () => resolved.size,
    },
  };
}
