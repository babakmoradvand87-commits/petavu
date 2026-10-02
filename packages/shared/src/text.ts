/**
 * متن فارسی و عربی — §45–47، §123
 *
 * فارسی در نرم‌افزار چند تله دارد که هر کدام یک باگ واقعی می‌سازد:
 *
 *   ۱. «ی» و «ک» عربی با فارسی یکی نیستند. اگر نرمال‌سازی نکنیم، جست‌وجوی
 *      «کاربر» جواب نمی‌دهد چون کاربر با «ك» عربی تایپ کرده.
 *   ۲. اعداد. کاربر «۱۲۳» می‌نویسد، سیستم «123» ذخیره می‌کند. بدون نرمال‌سازی،
 *      اعتبارسنجی شمارهٔ تماس یا کد ملی می‌شکند.
 *   ۳. نیم‌فاصله (U+200C). نه فاصله است نه نویسهٔ بی‌اثر. اگر به فاصله تبدیل
 *      شود، «می‌رود» به «می رود» تبدیل می‌شود و جست‌وجو خراب می‌شود؛ اگر حذف
 *      شود، «میرود» می‌شود. پس در نمایش حفظ می‌شود، فقط در مقایسه یکسان‌سازی.
 *   ۴. اختلاط جهت. متن فارسی با عدد یا نام لاتین، اگر با نشانه‌های کنترلی همراه
 *      نباشد، بد نمایش داده می‌شود.
 */

import { z } from 'zod';

/** نویسه‌های کنترلی جهت که هرگز نباید از ورودی کاربر وارد شوند. */
const BIDI_CONTROL = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/**
 * یکسان‌سازی برای مقایسه و ذخیره: شکل، حروف عربی، اعداد، فاصله‌ها.
 * برای «نمایش» استفاده نمی‌شود — متن کاربر دست‌نخورده می‌ماند.
 */
export function normalizePersian(input: string): string {
  return input
    .normalize('NFKC')
    .replace(BIDI_CONTROL, '')
    .replace(/[\u064a\u0649]/g, 'ی') // ي، ى → ی
    .replace(/[\u0643]/g, 'ک') // ك → ک
    .replace(/\u0629/g, 'ه') // ة → ه
    .replace(/[\u064b-\u0652\u0670]/g, '') // اعراب
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0)) // ۰–۹ فارسی
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660)) // ٠–٩ عربی
    .replace(/[\s\u00a0\u2000-\u200b]+/g, ' ')
    .trim();
}

/**
 * تا کردن واکه‌های همزه‌دار: «آوو» و «اوو» در جست‌وجو یکی‌اند، ولی در نمایش،
 * «آ» باید «آ» بماند. به همین دلیل این تبدیل *فقط* در مقایسه اعمال می‌شود و
 * در `normalizePersian` نیست.
 */
export function foldVowels(input: string): string {
  return input.replace(/[\u0622\u0623\u0625]/g, 'ا').replace(/\u0640/g, '');
}

/** شکل مقایسه‌ای: نیم‌فاصله به فاصلهٔ ساده و متن کوچک‌شده. */
export function foldForCompare(input: string): string {
  return foldVowels(normalizePersian(input)).replace(/\u200c/g, ' ').replace(/ +/g, ' ').toLowerCase();
}

/** کلید جست‌وجو: نیم‌فاصله و همهٔ فاصله‌ها حذف می‌شوند تا «می‌رود» و «میرود» یکی شوند. */
export function searchKey(input: string): string {
  return foldForCompare(input).replace(/ /g, '');
}

/** نویسه‌های امن برای CSS `direction`: فارسی/عربی راست‌به‌چپ است. */
const RTL_RANGE = /[\u0590-\u05ff\u0600-\u06ff\u0700-\u074f\u0750-\u077f\u08a0-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/;

export function isRtlText(input: string): boolean {
  return RTL_RANGE.test(input);
}

export type TextDirection = 'rtl' | 'ltr';

/**
 * جهت عنصر را از محتوای خودش می‌گیریم، نه از زبان صفحه.
 * یک نام تجاری لاتین در صفحهٔ فارسی نباید چیدمان را به هم بزند.
 */
export function detectDirection(input: string, fallback: TextDirection = 'rtl'): TextDirection {
  const letters = Array.from(input).filter((char) => /\p{L}/u.test(char));
  if (letters.length === 0) return fallback;
  let rtl = 0;
  for (const char of letters.slice(0, 32)) if (RTL_RANGE.test(char)) rtl += 1;
  return rtl * 2 > Math.min(letters.length, 32) ? 'rtl' : 'ltr';
}

/** جداکنندهٔ هزارگان برای نمایش. ورودی هرگز دست‌کاری نمی‌شود. */
export function formatNumber(value: number, locale = 'fa-IR'): string {
  if (!Number.isFinite(value)) throw new TypeError('عدد نامعتبر');
  return new Intl.NumberFormat(locale).format(value);
}

/**
 * رشتهٔ نمایشی امن: نویسه‌های کنترلی و جهت را می‌زداید.
 * این جایگزین فرارِ HTML نیست — آن وظیفهٔ لایهٔ رندر است (§74).
 */
export function sanitizeDisplayText(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.normalize('NFKC').replace(BIDI_CONTROL, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

/** طول نمایشی: نیم‌فاصله نیم‌وزن حساب می‌شود، چون بصری نازک است. */
export function displayLength(input: string): number {
  let length = 0;
  for (const char of input) length += char === '\u200c' ? 0.5 : 1;
  return length;
}

export function truncate(input: string, maxLength: number, ellipsis = '…'): string {
  if (maxLength < 1) throw new RangeError('حداکثر طول باید مثبت باشد');
  if (displayLength(input) <= maxLength) return input;
  let out = '';
  let used = 0;
  for (const char of input) {
    const cost = char === '\u200c' ? 0.5 : 1;
    if (used + cost > maxLength - displayLength(ellipsis)) break;
    out += char;
    used += cost;
  }
  return `${out.replace(/[ ]+$/, '')}${ellipsis}`;
}

/** متن را در مرز واژه می‌شکند؛ برای توضیحات کوتاه کارت‌ها. */
export function excerpt(input: string, maxLength: number): string {
  const clean = normalizePersian(input).replace(/\s+/g, ' ');
  const firstSentence = clean.split(/(?<=[.!؟?…])\s+/)[0] ?? clean;
  return truncate(firstSentence, maxLength);
}

/**
 * الگوهای رایج متن که یک صنف را لو می‌دهند و در UI «ماشینی» به نظر می‌رسند.
 * این فهرست برای بازبینی کیفیت محتوا است، نه فیلتر خودکار (§46).
 */
const AI_GENERIC_PATTERNS: readonly RegExp[] = [
  /به\s+عنوان\s+یک\s+مدل\s+زبانی/u,
  /در\s+دنیای\s+امروز/u,
  /راه‌حل‌های?\s+نوآورانه/u,
  /تجربه‌ای\s+بی‌نظیر\s+و\s+منحصربه‌فرد/u,
  /as an ai language model/i,
  /in today's fast-paced world/i,
];

export function looksGeneric(text: string): boolean {
  const folded = foldForCompare(text);
  return AI_GENERIC_PATTERNS.some((pattern) => pattern.test(folded));
}

/**
 * اسکیمای متن مشترک همه‌جا.
 *
 * چرا اینجا: هر ورودی متنی در سیستم از این عبور می‌کند. طول، نویسه‌های کنترلی
 * و نرمال‌سازی فارسی باید یک‌جا اعمال شود، نه در ۴۰ نقطهٔ مختلف.
 */
export function textField(options: { min?: number; max?: number; field?: string } = {}): z.ZodType<string> {
  const { min = 1, max = 500, field = 'متن' } = options;
  return z
    .string({ error: `${field} باید متن باشد.` })
    .min(min, { error: `${field} باید حداقل ${min} نویسه باشد.` })
    .max(max, { error: `${field} نباید بیشتر از ${max} نویسه باشد.` })
    .transform((value) => sanitizeDisplayText(value))
    .refine((value) => value.trim().length >= min, { error: `${field} نمی‌تواند فقط فاصله باشد.` });
}

/** نام کسب‌وکار، نام شخص، عنوان آگهی — همه یک قاعده دارند. */
export const displayNameSchema = textField({ min: 2, max: 120, field: 'نام' });

/** نشانی وب فارسی‌پسند؛ حروف فارسی در نامک مجازند (§7). */
export const slugSchema = z
  .string({ error: 'نامک باید متن باشد.' })
  .min(2, { error: 'نامک باید حداقل ۲ نویسه باشد.' })
  .max(72, { error: 'نامک نباید بیشتر از ۷۲ نویسه باشد.' })
  .regex(/^[a-z0-9\u0600-\u06ff]+(?:-[a-z0-9\u0600-\u06ff]+)*$/u, {
    error: 'نامک فقط می‌تواند حروف کوچک لاتین، رقم و حروف فارسی با خط تیره باشد.',
  })
  .refine((value) => !value.startsWith('-') && !value.endsWith('-'), { error: 'نامک نباید با خط تیره شروع یا تمام شود.' });

/**
 * توضیح چندخطی. خط جدید حفظ می‌شود، ولی سه خط پشت‌سرهم و بیشتر به دو خط
 * فروکاسته می‌شود تا چیدمان به هم نریزد.
 */
export function longTextSchema(options: { max: number; field: string; min?: number }): z.ZodType<string> {
  const { max, field, min = 1 } = options;
  return z
    .string({ error: `${field} باید متن باشد.` })
    .min(min, { error: `${field} باید حداقل ${min} نویسه باشد.` })
    .max(max, { error: `${field} نباید بیشتر از ${max} نویسه باشد.` })
    .transform((value) => sanitizeDisplayText(value).replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim());
}
