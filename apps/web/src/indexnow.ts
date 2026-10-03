/**
 * کلید IndexNow (گام ۲۶؛ Addendum §۴۶، §۸۸–۹۰، PART 102).
 *
 * پروتکل IndexNow، مالکیت را با یک فایل ثابت ثابت می‌کند: `https://دامنه/{کلید}.txt` باید
 * همان کلید را برگرداند. کلید سرّی **نیست** (قرار است عمومی باشد) پس در تنظیمات
 * غیرسرّی `seo.indexnow` می‌نشیند؛ اگر روزی کسی آن را سرّی علامت زد، RLS آن را از
 * وب پنهان می‌کند و فایل ۴۰۴ می‌شود (وضعیت: «تنظیم‌نشده»، نه خرابی).
 *
 * **وضعیت صریح** (PART 102: «Adapter واقعی با وضعیت روشن»): `configured` یا
 * `not_configured` به‌همراه دلیل. هیچ کلید ساختگی‌ای ساخته نمی‌شود تا «تنظیم‌شده به نظر
 * برسد»؛ کلید را استقرار می‌دهد و تا آن موقع، وضعیتِ صادقانه، «تنظیم‌نشده» است.
 *
 * ارسال نشانی‌ها به موتورها کار **کارگر** است (گام ۳۲؛ آداپتور در `@petavu/seo`)، نه
 * درخواست کاربر؛ این ماژول فقط «آیا آماده‌ایم؟» را می‌گوید و فایل کلید را می‌سازد.
 */

/** نامی که پروتکل می‌پذیرد: ۸ تا ۱۲۸ نویسهٔ لاتین/رقم/خط‌تیره. */
export const INDEXNOW_KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;

export type IndexNowStatus =
  | { readonly status: 'configured'; readonly key: string }
  | { readonly status: 'not_configured'; readonly reason: 'missing' | 'invalid_key' | 'disabled' };

/** وضعیت از مقدار خام تنظیمات `seo.indexnow`. */
export function indexNowStatus(raw: unknown): IndexNowStatus {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { status: 'not_configured', reason: 'missing' };
  const record = raw as Record<string, unknown>;
  if (record['enabled'] === false) return { status: 'not_configured', reason: 'disabled' };
  const key = record['key'];
  if (typeof key !== 'string') return { status: 'not_configured', reason: 'missing' };
  if (!INDEXNOW_KEY_PATTERN.test(key)) return { status: 'not_configured', reason: 'invalid_key' };
  return { status: 'configured', key };
}
