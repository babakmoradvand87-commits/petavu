/**
 * شناسه‌ها — §7
 *
 * قاعده: شناسهٔ موجودیت غیرقابل حدس است، و «نامک» (اسلاگ) چیزی جدا از آن است.
 *
 * چرا UUIDv7 و نه عدد ترتیبی یا UUIDv4:
 *
 *   * عدد ترتیبی، اندازهٔ کسب‌وکار را لو می‌دهد و با تغییر یک عدد می‌شود به
 *     رکورد دیگری رسید (IDOR). مرز §5 و §57.
 *   * UUIDv4 تصادفی است و خوب است، اما چون ترتیب ندارد، درج آن ایندکس B-tree
 *     را پراکنده می‌کند و بار نوشتن بالا می‌رود.
 *   * UUIDv7 هم تصادفیِ کافی دارد و هم مرتب‌شونده با زمان است. پس هم امن است
 *     و هم برای ایندکس و صفحه‌بندی مکان‌محور (cursor) مناسب (§Add، DB perf).
 *
 * پیاده‌سازی، مطابق RFC 9562، بدون وابستگی بیرونی.
 */

import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import { normalizePersian } from './text.js';

const HEX = '0123456789abcdef';

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += HEX[byte >> 4]! + HEX[byte & 0x0f]!;
  return out;
}

/**
 * UUIDv7: ۴۸ بیت زمان (میلی‌ثانیه از مبدأ یونیکس)، ۴ بیت نسخه، ۱۲ بیت تصادفی،
 * ۲ بیت نوع، ۶۲ بیت تصادفی.
 */
export function uuidv7(nowMs: number = Date.now()): string {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new TypeError('زمان پایه برای UUIDv7 نامعتبر است');

  const bytes = randomBytes(16);

  // ۴۸ بیت زمان، از پرمعنی‌ترین بایت به کم‌معنی‌ترین.
  const ts = BigInt(nowMs);
  bytes[0] = Number((ts >> 40n) & 0xffn);
  bytes[1] = Number((ts >> 32n) & 0xffn);
  bytes[2] = Number((ts >> 24n) & 0xffn);
  bytes[3] = Number((ts >> 16n) & 0xffn);
  bytes[4] = Number((ts >> 8n) & 0xffn);
  bytes[5] = Number(ts & 0xffn);

  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // نسخهٔ ۷
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // نوع RFC 4122

  const hex = toHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * بررسی شکل UUID.
 *
 * نکتهٔ امنیتی: اگر ورودی نامعتبر را به پایگاه‌داده بفرستیم، PostgreSQL خطای
 * نوع می‌دهد و پیام آن پیام خطا لو می‌رود. پس مرز، همین‌جا بررسی می‌شود.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value.toLowerCase());
}

export function assertUuid(value: unknown, field = 'شناسه'): string {
  if (!isUuid(value)) throw new TypeError(`${field} باید یک UUID معتبر باشد`);
  return value.toLowerCase();
}

/**
 * زمان درج‌شده در UUIDv7، بدون نیاز به کوئری.
 *
 * به همین دلیل است که صفحه‌بندی مکان‌محور روی `id` هم ارزان است: ترتیب و
 * زمان با هم می‌آیند. (برای دادهٔ مهاجرت‌شده که شناسهٔ غیرv7 دارد، نباید به
 * این اتکا کرد.)
 */
export function uuidv7Time(value: string): number | null {
  if (!isUuid(value)) return null;
  const hex = value.replace(/-/g, '').slice(0, 12);
  return Number(BigInt(`0x${hex}`));
}

/** پیشوندِ نوع موجودیت، برای خوانایی لاگ و کلیدهای بیرونی (§20). */
export const ID_PREFIX = {
  business: 'bz',
  member: 'mb',
  user: 'us',
  listing: 'ls',
  media: 'md',
  invitation: 'iv',
  session: 'ss',
  order: 'or',
} as const;

export type IdPrefix = (typeof ID_PREFIX)[keyof typeof ID_PREFIX];

const SLUG_MAX = 72;

/**
 * نامک — §7، §20
 *
 * نامک بخشی از شناسهٔ موجودیت نیست و تغییرش هویت را عوض نمی‌کند؛ فقط نشانی
 * عمومی است. پس: یکتایی در سطح دامنه بررسی می‌شود، و اگر تکرار شد شماره
 * می‌خورد — نه اینکه نامک موجود بازنویسی شود.
 */
export function slugify(input: string): string {
  // از همان یکسان‌ساز متن استفاده می‌کنیم تا رقم فارسی، «ك» عربی و نیم‌فاصله
  // اینجا هم یک قاعده داشته باشند — نه قاعدهٔ دوم و واگرا.
  const normalized = normalizePersian(input).replace(/[\u200c]/g, ' ').toLowerCase();

  const parts: string[] = [];
  let current = '';
  for (const char of normalized) {
    const isLatin = char >= 'a' && char <= 'z';
    const isDigit = char >= '0' && char <= '9';
    const isPersian = /[\u0621-\u06cc\u0698\u067e\u0686\u06af]/.test(char);
    if (isLatin || isDigit || isPersian) {
      current += char;
    } else if (char === 'ی' || char === 'ك') {
      current += char === 'ی' ? 'ی' : 'ک';
    } else if (current !== '') {
      parts.push(current);
      current = '';
    }
  }
  if (current !== '') parts.push(current);

  const joined = parts.join('-').replace(/^-+|-+$/g, '');
  return joined.slice(0, SLUG_MAX).replace(/-+$/g, '');
}

/**
 * رزروهای نامک: مسیرهایی که معنای فنی دارند و نباید به هیچ کسب‌وکاری داده شوند.
 * این فهرست بخشی از قرارداد است، نه سلیقه — تغییرش یک تغییر رفتاری است.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'api', 'admin', 'adminpanel', 'panel', 'shop', 'adminshop', 'app', 'auth', 'login', 'logout',
  'signup', 'register', 'settings', 'dashboard', 'help', 'support', 'about', 'contact', 'terms',
  'privacy', 'pricing', 'blog', 'news', 'search', 'static', 'assets', 'media', 'public', 'www',
  'new', 'edit', 'delete', 'static', 'sitemap', 'robots', 'favicon', 'well-known',
  'petavu', 'system', 'internal', 'health', 'status', 'metrics', 'webhook', 'webhooks',
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase());
}

/**
 * انتخاب نامک آزاد: اگر مشغول باشد، پسوند می‌خورد.
 * تابع `isTaken` را بیرون می‌دهیم تا این لایه به پایگاه‌داده وابسته نشود.
 */
export function uniqueSlug(base: string, isTaken: (candidate: string) => boolean, suffixDigits = 4): string {
  const root = slugify(base);
  if (root === '' || isReservedSlug(root)) {
    throw new TypeError(`نامک «${base}» قابل استفاده نیست`);
  }
  if (!isTaken(root)) return root;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const tail = randomDigits(suffixDigits);
    const candidate = `${root}-${tail}`;
    if (!isTaken(candidate)) return candidate;
  }
  // با 20 تلاش و ۱۰٬۰۰۰ ترکیب ، رسیدن به اینجا تقریباً ناممکن است.
  throw new Error('نامک آزاد پیدا نشد');
}

function randomDigits(count: number): string {
  let out = '';
  while (out.length < count) {
    for (const byte of randomBytes(count)) {
      if (byte < 250) out += String(byte % 10);
    }
  }
  return out.slice(0, count);
}

/** شناسهٔ تازه برای موجودیت‌های معمولی. */
export function newId(clock: { now(): number } = { now: () => Date.now() }): string {
  return uuidv7(clock.now());
}

/** شناسهٔ تصادفی برای توکن‌هایی که نباید هیچ اطلاعاتی از خودشان بدهند (§11). */
export function newOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function newIdempotencyKey(): string {
  return randomUUID();
}

/**
 * مقایسهٔ ثابت‌زمان.
 *
 * مقایسهٔ سادهٔ رشته‌ها در اولین نویسهٔ متفاوت متوقف می‌شود؛ همین تفاوت زمانی،
 * امکان حدس‌زدن توکن را می‌دهد. برای هر مقایسهٔ راز از این استفاده می‌شود.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    // طول‌های نابرابر، ولی مقایسه همچنان انجام می‌شود تا زمان اجرا لو ندهد.
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}
