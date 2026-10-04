/**
 * خواندن فرم HTML (گام ۲۸؛ §68، §191).
 *
 * فرم‌ها `application/x-www-form-urlencoded` می‌فرستند و این تنها ورودی تغییردهندهٔ پنل است (بی‌JavaScript).
 * ورودی بی‌اعتماد است: سقف بایت (در لایهٔ سرور)، سقف تعداد فیلد، الگوی نام، سقف طول مقدار، و **شیء بی‌پروتوتایپ**
 * (`__proto__` و دوستان نمی‌توانند ساختار را آلوده کنند).
 */

export const MAX_FORM_BYTES = 64 * 1024;
const MAX_FIELDS = 60;
const MAX_VALUE_LENGTH = 20_000;
const FIELD_NAME = /^[a-zA-Z_][a-zA-Z0-9_.-]{0,59}$/;
const FORBIDDEN_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

export type Form = Readonly<Record<string, string>>;

/** `null` ⇒ فرم نامعتبر (۴۰۰). نام یا مقدار بدشکل، کل فرم را رد می‌کند؛ «نیمه‌پذیرفتن» نداریم. */
export function parseForm(body: string): Form | null {
  const out: Record<string, string> = Object.create(null) as Record<string, string>;
  let count = 0;
  for (const pair of body.split('&')) {
    if (pair === '') continue;
    count += 1;
    if (count > MAX_FIELDS) return null;
    const separator = pair.indexOf('=');
    const rawName = separator === -1 ? pair : pair.slice(0, separator);
    const rawValue = separator === -1 ? '' : pair.slice(separator + 1);
    let name: string;
    let value: string;
    try {
      name = decodeURIComponent(rawName.replace(/\+/g, ' '));
      value = decodeURIComponent(rawValue.replace(/\+/g, ' '));
    } catch {
      return null;
    }
    if (!FIELD_NAME.test(name) || FORBIDDEN_NAMES.has(name)) return null;
    if (value.length > MAX_VALUE_LENGTH || value.includes('\u0000')) return null;
    if (Object.hasOwn(out, name)) return null; // duplicated authority/CSRF fields are ambiguous
    out[name] = value.replace(/\r\n/g, '\n');
  }
  return out;
}
