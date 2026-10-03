/**
 * نشانی‌های تاکسونومی (گام ۲۵؛ §19–۲۰، §8، Addendum §۴۶).
 *
 * چهار خانوادهٔ نشانی، یک قاعده: **نشانی از داده ساخته می‌شود و به همان داده
 * برمی‌گردد** — بی‌ابهام و بدون جدول نگاشت دستی.
 *
 *   /t/{type}                نوع کسب‌وکار     `veterinary_clinic` → `veterinary-clinic`
 *   /i/{a}/{b}               صنف (سلسله‌مراتبی) `animal_care.grooming` → `animal-care/grooming`
 *   /l/{province}/{city}     مکان             `iran.alborz.karaj` → `alborz/karaj`
 *   /k/{a}/{b}               دستهٔ محتوا       `behavior.puppy_training` → `behavior/puppy-training`
 *
 * چرا خط‌تیره به‌جای زیرخط: در نشانی، خط‌تیره جداکنندهٔ واژه است و زیرخط،
 * چسباننده‌اش؛ موتور جست‌وجو «veterinary-clinic» را دو واژه می‌بیند.
 *
 * چرا سلسله‌مراتبی (`/i/a/b`) و نه یک بخش مسطح: صنف زیرمجموعه، بخشی از مسیر
 * والد است و breadcrumb از خود نشانی درمی‌آید. در مکان‌ها این الزامی هم هست:
 * «اردبیل» هم نام یک استان است و هم نام یک شهر، پس یک نامک مسطح یکتا نیست.
 *
 * رمزگشایی **سخت‌گیر** است: هر بخشِ غیرمجاز (حرف بزرگ، نقطه، زیرخط، دو خط‌تیره
 * پشت‌سرهم) `null` می‌دهد و هرگز به پایگاه‌داده نمی‌رسد. این‌گونه یک نشانی
 * فقط یک شکل کانونیک دارد: `/t/veterinary_clinic` و `/t/Veterinary-Clinic` هر دو
 * ۴۰۴ می‌شوند، نه اینکه دو نسخه از یک صفحه ساخته شود.
 *
 * ریشهٔ کشور (`iran`) در نشانی مکان **نمی‌آید**: نشانی کوتاه‌تر و برای
 * کاربر معنادارتر است. ریشه از خود داده خوانده می‌شود (نه ثابت کد)؛ پس اگر
 * روزی کشور دومی آمد، همین‌جا یک ستون تازه لازم می‌شود، نه بازنویسی صفحه‌ها.
 */

/** هر بخش: حروف کوچک لاتین/ارقام، با خط‌تیره‌های تکی میان‌شان. */
const SEGMENT = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** بیشینهٔ عمق (صنف و دسته دو سطحی‌اند؛ سقف سه، جا برای رشد می‌گذارد). */
const MAX_DEPTH = 3;

export type TaxonomyFamily = 'type' | 'industry' | 'location' | 'category';

export const TAXONOMY_PREFIX: Readonly<Record<TaxonomyFamily, string>> = {
  type: '/t',
  industry: '/i',
  location: '/l',
  category: '/k',
};

/** `snake_case` در داده ⇄ `kebab-case` در نشانی. بخشی که خط‌تیرهٔ واقعی دارد، ناپیوستنی است. */
function toSlug(part: string): string | null {
  if (part.includes('-')) return null;
  const slug = part.replace(/_/g, '-');
  return SEGMENT.test(slug) ? slug : null;
}

function fromSlug(segment: string): string | null {
  return SEGMENT.test(segment) ? segment.replace(/-/g, '_') : null;
}

/* ------------------------------------------------------------------ نوع کسب‌وکار */

export function typeUrl(key: string): string | null {
  const slug = toSlug(key);
  return slug ? `/t/${slug}` : null;
}

export function parseTypeSegments(segments: readonly string[]): string | null {
  if (segments.length !== 1) return null;
  return fromSlug(segments[0] as string);
}

/* ------------------------------------------------------------------ صنف و دسته (مسیر نقطه‌دار) */

function dottedUrl(prefix: string, path: string): string | null {
  const parts = path.split('.');
  if (parts.length === 0 || parts.length > MAX_DEPTH) return null;
  const slugs = parts.map(toSlug);
  if (slugs.some((slug) => slug === null)) return null;
  return `${prefix}/${slugs.join('/')}`;
}

function parseDotted(segments: readonly string[]): string | null {
  if (segments.length === 0 || segments.length > MAX_DEPTH) return null;
  const parts = segments.map(fromSlug);
  if (parts.some((part) => part === null)) return null;
  return parts.join('.');
}

export function industryUrl(path: string): string | null {
  return dottedUrl('/i', path);
}

export function parseIndustrySegments(segments: readonly string[]): string | null {
  return parseDotted(segments);
}

export function categoryUrl(path: string): string | null {
  return dottedUrl('/k', path);
}

export function parseCategorySegments(segments: readonly string[]): string | null {
  return parseDotted(segments);
}

/* ------------------------------------------------------------------ مکان */

/**
 * مکان: نامک‌های واقعی (خط‌تیره‌دار مثل `east-azerbaijan`) همان‌طور که هستند
 * می‌آیند؛ فقط ریشهٔ کشور حذف می‌شود.
 */
export function locationUrl(path: string): string | null {
  const parts = path.split('.');
  // `parts[0]` کشور است: «کشور» خودش صفحهٔ /l است.
  if (parts.length < 1 || parts.length > MAX_DEPTH) return null;
  const rest = parts.slice(1);
  if (rest.length === 0) return '/l';
  if (rest.some((part) => !SEGMENT.test(part))) return null;
  return `/l/${rest.join('/')}`;
}

/** بخش‌های نشانی → «پسوند مسیر» (بدون ریشهٔ کشور)؛ ریشه را کوئری اضافه می‌کند. */
export function parseLocationSegments(segments: readonly string[]): string | null {
  if (segments.length === 0 || segments.length > MAX_DEPTH - 1) return null;
  if (segments.some((segment) => !SEGMENT.test(segment))) return null;
  return segments.join('.');
}

/* ------------------------------------------------------------------ ابزارهای مشترک */

/** زنجیرهٔ والدها از مسیر نقطه‌دار: `a.b.c` ⇒ `[a, a.b]` (بدون خود مسیر). */
export function ancestorPaths(path: string): string[] {
  const parts = path.split('.');
  const out: string[] = [];
  for (let index = 1; index < parts.length; index += 1) {
    out.push(parts.slice(0, index).join('.'));
  }
  return out;
}

/** پیشوند مسیر برای پرس‌وجوی «زیردرخت»: `a.b` ⇒ `a.b.`؛ با `starts_with`، نه LIKE (زیرخط جوکر است). */
export function subtreePrefix(path: string): string {
  return `${path}.`;
}
