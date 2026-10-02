/**
 * رمز عبور — §10
 *
 * تصمیم‌های این فایل، همه از یک پرسش می‌آیند: اگر پایگاه‌داده لو برود، مهاجم
 * چه می‌بیند؟ پاسخ باید این باشد: چیزی که شکستنش اقتصادی نباشد.
 *
 *   ۱. Argon2id انتخاب شده، نه bcrypt و نه PBKDF2. حافظه‌سختی Argon2 است که
 *      حملهٔ موازی با کارت گرافیک را بی‌فایده می‌کند؛ bcrypt فضای کلید کوچکی
 *      دارد و PBKDF2 فقط CPU را درگیر می‌کند.
 *   ۲. پارامترها در خودِ رشتهٔ درهم نگه داشته می‌شوند (فرمت استاندارد
 *      `$argon2id$v=19$m=…,t=…,p=…$salt$hash`)، و یک نشانگر نسخه هم جلوی آن
 *      می‌آید. پس وقتی پارامترها را بالا بردیم، `needsRehash` می‌تواند رمزهای
 *      قدیمی را در نخستین ورود موفق، بی‌سروصدا به‌روز کند.
 *   ۳. «فلفل» (pepper) یک رازِ سرور است که کنار رمز درهم می‌شود. تفاوتش با
 *      نمک: نمک در پایگاه‌داده است و فلفل نه. اگر فقط پایگاه‌داده لو برود،
 *      بدون فلفل هیچ‌کدام از درهم‌ها قابل حمله نیستند.
 *
 * نکتهٔ مهم دربارهٔ فلفل: اگر فلفل عوض شود، همهٔ رمزها بی‌اعتبار می‌شوند. این
 * در مستندات عملیاتی به‌عنوان «راز غیرقابل‌چرخش» ثبت شده است.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import type { Algorithm } from '@node-rs/argon2';

import { AppError, safeEqual } from '@petavu/shared';

/** نسخهٔ طرح درهم‌سازی خودمان، برای مهاجرت‌های آینده. */
export const PASSWORD_SCHEME = 'pv1';

/**
 * شمارهٔ الگوریتم Argon2id در کتابخانهٔ `@node-rs/argon2`
 * (`Algorithm.Argon2d = 0`, `Argon2i = 1`, `Argon2id = 2`).
 *
 * این عدد را از کتابخانه *وارد* نمی‌کنیم، چون `Algorithm` در `index.d.ts`
 * یک `const enum` محیطی است و با `verbatimModuleSyntax` قابل ارجاع در زمان
 * اجرا نیست. عدد را اینجا با مرجع نگه می‌داریم و در تست، سازگاری‌اش بررسی
 * می‌شود — تا اگر کتابخانه تغییر کرد، تست بشکند نه رفتار.
 */
const ARGON2ID = 2 as Algorithm;

export interface Argon2Params {
  readonly memoryCost: number;
  readonly timeCost: number;
  readonly parallelism: number;
}

/**
 * پارامتر تولید: ۶۴ مگابایت حافظه، ۳ دور، یک‌رشته.
 * روی سخت‌افزار این محیط حدود ۹۴ میلی‌ثانیه طول می‌کشد؛ هدف، محدودهٔ ۵۰ تا
 * ۲۵۰ میلی‌ثانیه است: آن‌قدر کند که حمله گران شود، آن‌قدر سریع که ورود کاربر
 * آزاردهنده نشود.
 */
export const DEFAULT_ARGON2: Argon2Params = { memoryCost: 65_536, timeCost: 3, parallelism: 1 };

/**
 * پارامتر تست: همان الگوریتم، با هزینهٔ کمتر.
 *
 * این «حالت امنیتی ضعیف» نیست؛ فقط برای تست است. در محیط production مقدار
 * پیش‌فرض استفاده می‌شود و راهی برای رسیدن به این پارامتر از پیکربندی وجود
 * ندارد — تا کسی نتواند با یک متغیر محیطی، امنیت رمز را کم کند.
 */
export const TEST_ARGON2: Argon2Params = { memoryCost: 8_192, timeCost: 1, parallelism: 1 };

const MIN_MEMORY_COST = 19_456; // کف OWASP
const MAX_PASSWORD_LENGTH = 200;

export interface PasswordHasherOptions {
  readonly params?: Argon2Params;
  readonly pepper?: string;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(stored: string, password: string): Promise<boolean>;
  needsRehash(stored: string): boolean;
}

function applyPepper(pepper: string | undefined, password: string): string {
  if (pepper === undefined || pepper === '') return password;
  // HMAC-SHA256 خروجی با طول ثابت می‌دهد، پس رمزهای بسیار بلند هم مسئله‌ساز
  // نیستند و طول رمز از درهم بیرون نمی‌زند.
  return createHmac('sha256', pepper).update(password, 'utf8').digest('base64');
}

export function createPasswordHasher(options: PasswordHasherOptions = {}): PasswordHasher {
  const params = options.params ?? DEFAULT_ARGON2;
  const pepper = options.pepper;

  if (options.params && options.params.memoryCost < MIN_MEMORY_COST) {
    // فقط پارامتر تست از این مسیر می‌آید؛ اگر کسی اشتباهی مقدار کم بدهد، باید
    // بفهمد. بررسی در زمان ساخت است، نه زمان استفاده.
    if (options.params !== TEST_ARGON2) {
      throw new RangeError('پارامترهای Argon2 کمتر از کف امن اعلام‌شده‌اند');
    }
  }

  const pepperMark = pepper && pepper !== '' ? 'p' : 'n';

  const argonOptions = {
    algorithm: ARGON2ID,
    memoryCost: params.memoryCost,
    timeCost: params.timeCost,
    parallelism: params.parallelism,
  };

  return {
    async hash(password: string): Promise<string> {
      if (password.length > MAX_PASSWORD_LENGTH) {
        throw new AppError('validation_failed', {
          message: `رمز عبور نباید بیشتر از ${MAX_PASSWORD_LENGTH} نویسه باشد.`,
        });
      }
      const digest = await argon2Hash(applyPepper(pepper, password), argonOptions);
      return `${PASSWORD_SCHEME}$${pepperMark}$${digest}`;
    },

    async verify(stored: string, password: string): Promise<boolean> {
      // طول غیرمجاز، فقط «ناموفق» است؛ نه خطای ۵۰۰ که وضعیت سیستم را لو بدهد.
      if (password.length > MAX_PASSWORD_LENGTH) return false;
      const parsed = parseStored(stored);
      if (!parsed) return false;

      const candidate = applyPepper(parsed.peppered ? pepper : undefined, password);

      try {
        return await argon2Verify(parsed.digest, candidate);
      } catch {
        // رشتهٔ درهم خراب یا ناسازگار — «ناموفق»، و لاگ در لایهٔ بالاتر.
        return false;
      }
    },

    needsRehash(stored: string): boolean {
      const parsed = parseStored(stored);
      if (!parsed) return true;
      if (parsed.peppered !== (pepperMark === 'p')) return true;
      if (parsed.scheme !== PASSWORD_SCHEME) return true;
      const current = parsed.params;
      if (!current) return true;
      return (
        current.memoryCost !== params.memoryCost ||
        current.timeCost !== params.timeCost ||
        current.parallelism !== params.parallelism ||
        current.type !== ARGON2ID
      );
    },
  };
}

interface ParsedHash {
  scheme: string;
  peppered: boolean;
  digest: string;
  params: { memoryCost: number; timeCost: number; parallelism: number; type: Algorithm } | null;
}

export function parseStored(stored: string): ParsedHash | null {
  const firstBreak = stored.indexOf('$');
  if (firstBreak < 0) return null;
  const scheme = stored.slice(0, firstBreak);
  const rest = stored.slice(firstBreak + 1);
  const secondBreak = rest.indexOf('$');
  if (secondBreak < 0) return null;
  const mark = rest.slice(0, secondBreak);
  const digest = rest.slice(secondBreak + 1);
  if (mark !== 'p' && mark !== 'n') return null;
  if (!digest.startsWith('$argon2')) return null;

  return { scheme, peppered: mark === 'p', digest, params: parseArgonParams(digest) };
}

function parseArgonParams(digest: string): ParsedHash['params'] {
  const match = /\$argon2(id|i|d)\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(digest);
  if (!match) return null;
  const type = (match[1] === 'id' ? 2 : match[1] === 'i' ? 1 : 0) as Algorithm;
  return {
    type,
    memoryCost: Number(match[3]),
    timeCost: Number(match[4]),
    parallelism: Number(match[5]),
  };
}

/**
 * درهم ساختگی برای یکسان‌سازی زمان پاسخ (§13).
 *
 * بدون این، پاسخ «کاربر وجود ندارد» در چند میلی‌ثانیه برمی‌گردد و پاسخ «رمز
 * اشتباه» در ~۱۰۰ میلی‌ثانیه. همان تفاوت، ابزار شمارش کاربران است. پس در مسیر
 * ورود، حتی وقتی حساب وجود ندارد، یک بررسی واقعی انجام می‌شود.
 */
let dummyHashCache: { hasher: PasswordHasher; value: string } | null = null;

export async function dummyVerify(hasher: PasswordHasher, password: string): Promise<false> {
  if (!dummyHashCache || dummyHashCache.hasher !== hasher) {
    dummyHashCache = { hasher, value: await hasher.hash(randomBytes(24).toString('base64url')) };
  }
  await hasher.verify(dummyHashCache.value, password);
  return false;
}

/* ------------------------------------------------------------------ *
 * سیاست رمز عبور
 * ------------------------------------------------------------------ */

/**
 * کوتاه‌ترین فهرست ممکن از رمزهای پرتکرارِ لو‌رفته.
 * این فهرست عمداً کوچک است؛ گسترشش یک فایل داده است، نه تغییر کد. جای آن در
 * فاز عملیات با فهرست کامل (مثلاً HIBP) پر می‌شود و همین تابع مصرف‌کنندهٔ آن
 * می‌ماند — پس هیچ‌جای دیگری این بررسی تکرار نمی‌شود.
 */
const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  'password', 'password1', 'password123', '123456', '12345678', '123456789', '1234567890',
  'qwerty', 'qwerty123', 'abc123', '111111', '000000', 'iloveyou', 'admin', 'administrator',
  'welcome', 'letmein', 'monkey', 'dragon', 'football', 'baseball', 'sunshine', 'princess',
  'qazwsx', '1q2w3e4r', 'asdfghjkl', 'zxcvbnm', 'ورود', 'رمز', 'ایران', 'تهران', 'petavu',
]);

export interface PasswordPolicyOptions {
  readonly minLength?: number;
  readonly maxLength?: number;
  /** اطلاعات شخصی که رمز نباید شاملشان باشد (شمارهٔ تماس، ایمیل، نام). */
  readonly personalInfo?: readonly string[];
}

export interface PasswordPolicyResult {
  readonly ok: boolean;
  readonly problems: readonly string[];
}

/**
 * سیاست بر پایهٔ طول و فهرست سیاه است، نه «باید حرف بزرگ و علامت داشته باشد».
 *
 * دلیلش توصیهٔ NIST است: اجبار به ترکیب نویسه‌ها، کاربر را به الگوهای قابل‌حدس
 * («Password1!») می‌راند و آنتروپی واقعی را بالا نمی‌برد. طول و پرهیز از رمز
 * لو‌رفته، مؤثرترند.
 */
export function checkPasswordPolicy(password: string, options: PasswordPolicyOptions = {}): PasswordPolicyResult {
  const minLength = options.minLength ?? 10;
  const maxLength = options.maxLength ?? MAX_PASSWORD_LENGTH;
  const problems: string[] = [];

  if (password.length < minLength) problems.push(`رمز عبور باید حداقل ${minLength} نویسه باشد.`);
  if (password.length > maxLength) problems.push(`رمز عبور نباید بیشتر از ${maxLength} نویسه باشد.`);

  const folded = password.toLowerCase().replace(/[\s\u200c]/g, '');
  if (COMMON_PASSWORDS.has(folded)) problems.push('این رمز عبور در فهرست رمزهای رایج و ناامن است.');
  if (/^(.)\1+$/.test(password)) problems.push('رمز عبور نباید تکرار یک نویسه باشد.');
  if (/^\d+$/.test(password)) problems.push('رمز عبور نباید فقط رقم باشد.');

  for (const info of options.personalInfo ?? []) {
    const needle = info.trim().toLowerCase();
    if (needle.length >= 4 && folded.includes(needle)) {
      problems.push('رمز عبور نباید شامل اطلاعات شخصی شما باشد.');
      break;
    }
  }

  return { ok: problems.length === 0, problems };
}

/** مقایسهٔ امن دو رشتهٔ درهم (مثلاً برای بازبینی یکپارچگی). */
export function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** مقایسهٔ رشتهٔ درهم ذخیره‌شده با مقدار محاسبه‌شده، بدون وابستگی به طول. */
export function matchesHash(storedHash: string, candidateHash: string): boolean {
  return safeEqual(storedHash, candidateHash);
}
