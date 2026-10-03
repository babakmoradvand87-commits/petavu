/**
 * ساخت رشتهٔ HTML، به‌شکلی که «تزریق» ممکن نباشد (گام ۲۲؛ §68، Addendum §۳۰–۳۳).
 *
 * چرا ماژول جدا و چرا این‌قدر متواضع: در SSR، متن کاربر و دادهٔ پایگاه‌داده
 * مستقیم داخل HTML می‌رود. اگر جایی یک رشته با `+` سرِ هم شود، نشت XSS حتمی
 * است. پس هیچ‌جا رشتهٔ HTML خام ساخته نمی‌شود؛ همه‌چیز از این سه سازنده
 * می‌گذرد و escaping در *همان* مسیر اجباری است.
 *
 *   • `escapeText` — برای متن بین تگ‌ها.
 *   • `escapeAttr` — برای مقدار ویژگی (سخت‌گیرتر: کوتیشن و آپاستروف هم).
 *   • `attrs` — تنها راه ساخت ویژگی‌ها از داده.
 *
 * آنچه این ماژول **نمی‌کند** و باید همان‌جا که لازم شد اضافه شود:
 * `style` و `on*` از داده پذیرفته نمی‌شوند (این‌جا مسیرشان بسته است؛ در
 * BootstrapRegistry گام‌های بعد هم بسته می‌ماند).
 */

export type AttributeValue = string | number | boolean | null | undefined;

/** متن بین تگ‌ها. `&` اول، وگرنه `&lt;` دوباره escape می‌شود. */
export function escapeText(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** مقدار ویژگی. کوتیشن‌ها هم escape می‌شوند تا از ویژگی بیرون نزنند. */
export function escapeAttr(value: unknown): string {
  return escapeText(value)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;');
}

/** نام ویژگی مجاز: فقط حروف کوچک، خط تیره و دونقطهٔ نام‌فضا. */
const ATTR_NAME = /^[a-z][a-z0-9-]*(:[a-z0-9-]+)?$/;

/** ویژگی‌های ممنوع از داده — نه سلیقه، بلکه مرز امنیتی. */
const FORBIDDEN_ATTRS = new Set(['style', 'srcdoc', 'formaction', 'xlink:href']);

export function attrs(input: Record<string, AttributeValue> | undefined): string {
  if (!input) return '';
  const parts: string[] = [];

  for (const [name, value] of Object.entries(input)) {
    if (value === null || value === undefined || value === false) continue;
    if (!ATTR_NAME.test(name)) throw new Error(`نام ویژگی نامعتبر در رندر: ${name}`);
    if (FORBIDDEN_ATTRS.has(name) || name.startsWith('on')) {
      throw new Error(`ویژگی ممنوع در رندر: ${name}`);
    }
    if (value === true) {
      parts.push(name);
      continue;
    }
    parts.push(`${name}="${escapeAttr(value)}"`);
  }

  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

/** متن خام HTML که خودمان ساخته‌ایم (نه داده). نامش، هشدارش است. */
export interface RawHtml {
  readonly __html: string;
}

export function raw(html: string): RawHtml {
  return { __html: html };
}

/** درج HTML ساخت‌شده. تنها جایی که بدون escaping چاپ می‌شود. */
export function unsafe(html: RawHtml): string {
  return html.__html;
}

export function tag(name: string, attributes: Record<string, AttributeValue> | undefined, children?: string | RawHtml | string[]): string {
  const inner = children === undefined ? '' : Array.isArray(children) ? children.join('') : typeof children === 'string' ? children : unsafe(children);
  return `<${name}${attrs(attributes)}>${inner}</${name}>`;
}

export function voidTag(name: string, attributes?: Record<string, AttributeValue>): string {
  return `<${name}${attrs(attributes)}>`;
}

/** متن چندخطی (مثل همین توضیح‌ها) در HTML: خط‌های خالی فشرده می‌شوند. */
export function lines(parts: Array<string | null | undefined | false>): string {
  return parts.filter((part): part is string => Boolean(part)).join('\n');
}
