/**
 * خط لولهٔ تصویر: AVIF/WebP، `srcset`، بُعد اعلام‌شده (گام ۲۷؛ Addendum §۷–۹، §۱۵–۱۹، PART 102).
 *
 * سه قاعده که هر کدام یک آزمون دارد:
 *
 *   ۱) **وضعیت صریح** (PART 102: «Adapter واقعی با وضعیت روشن»). موتور تبدیل (`sharp`، وابستگیِ
 *      اختیاری) یا `configured` است یا `not_configured` با دلیل. نبودش «خطا» نیست و جعل هم
 *      نمی‌شود: بی‌موتور، `<picture>` ساخته نمی‌شود، همان `<img>` اصلی می‌آید و هیچ نشانیِ
 *      `?w=…&f=…` که نتوان سروش کرد، چاپ نمی‌شود.
 *   ۲) **نشانی تغییرناپذیر، بسته و سقف‌دار.** `/media/<شناسه>?w=<عرض>&f=<قالب>&v=<نسخه>`:
 *      عرض فقط از نردبان تنظیمات (یا خودِ عرض اصلی)، قالب از فهرست، `v` برابر پیشوند درهم
 *      فایل. نردبان بسته یعنی تعداد نسخه‌های ممکنِ هر تصویر **متناهی** است — بی‌این، هر
 *      `?w=` دلخواه یک تبدیل و یک فایل در انبار می‌ساخت (حملهٔ پرکردن دیسک/پردازنده). و چون
 *      `v` در نشانی است، `immutable` همیشه امن است: تصویر عوض شد، نشانی عوض می‌شود.
 *   ۳) **بُعد، اجباری.** `width`/`height` همیشه چاپ می‌شود (CLS بودجه است)، و تصویر LCP
 *      (`priority`) `eager` + `fetchpriority=high` می‌گیرد، بقیه `lazy`.
 *
 * تنظیمات از `ops.setting` کلید `platform.image_pipeline` می‌آید (داده؛ §103).
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { Logger } from '@petavu/shared';

import { tag, voidTag } from './html.js';
import type { MediaView } from './renderers.js';

export type ImageFormat = 'avif' | 'webp';

export interface ImagePipelineConfig {
  readonly widths: readonly number[];
  readonly formats: readonly ImageFormat[];
  readonly quality: { readonly avif: number; readonly webp: number };
  readonly maxPixels: number;
  readonly maxBytes: number;
  readonly acceptedMime: readonly string[];
}

export const DEFAULT_IMAGE_CONFIG: ImagePipelineConfig = Object.freeze({
  widths: [320, 640, 960, 1280, 1600, 1920, 2560],
  formats: ['avif', 'webp'] as const,
  quality: { avif: 50, webp: 72 },
  maxPixels: 40_000_000,
  maxBytes: 15_000_000,
  acceptedMime: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'],
});

const MIN_VARIANT_WIDTH = 160;
const MAX_CANDIDATES = 7;

function boundedInt(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

/**
 * تنظیمات از مقدار خام. ورودی نامعتبر، **جزءبه‌جزء** به پیش‌فرض برمی‌گردد (نه کل تنظیم):
 * یک عرضِ بد نباید خط لوله را از کار بیندازد.
 */
export function parseImageConfig(raw: unknown): ImagePipelineConfig {
  const record = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};

  const widthsRaw = Array.isArray(record['widths']) ? (record['widths'] as unknown[]) : [];
  const widths = [...new Set(widthsRaw.filter((entry): entry is number => typeof entry === 'number' && Number.isInteger(entry) && entry >= 16 && entry <= 8192))]
    .sort((a, b) => a - b)
    .slice(0, 12);

  const formatsRaw = Array.isArray(record['output_formats']) ? (record['output_formats'] as unknown[]) : [];
  const formats = (['avif', 'webp'] as const).filter((format) => formatsRaw.includes(format));

  const quality = typeof record['quality'] === 'object' && record['quality'] !== null ? (record['quality'] as Record<string, unknown>) : {};
  const mimeRaw = Array.isArray(record['accepted_mime']) ? (record['accepted_mime'] as unknown[]) : [];
  const acceptedMime = DEFAULT_IMAGE_CONFIG.acceptedMime.filter((mime) => mimeRaw.length === 0 || mimeRaw.includes(mime));

  return {
    widths: widths.length > 0 ? widths : DEFAULT_IMAGE_CONFIG.widths,
    formats: formats.length > 0 ? formats : DEFAULT_IMAGE_CONFIG.formats,
    quality: {
      avif: boundedInt(quality['avif'], 1, 100, DEFAULT_IMAGE_CONFIG.quality.avif),
      webp: boundedInt(quality['webp'], 1, 100, DEFAULT_IMAGE_CONFIG.quality.webp),
    },
    maxPixels: boundedInt(record['max_pixels'], 1_000_000, 200_000_000, DEFAULT_IMAGE_CONFIG.maxPixels),
    maxBytes: boundedInt(record['max_bytes'], 100_000, 100_000_000, DEFAULT_IMAGE_CONFIG.maxBytes),
    acceptedMime: acceptedMime.length > 0 ? acceptedMime : DEFAULT_IMAGE_CONFIG.acceptedMime,
  };
}

/* ------------------------------------------------------------------ موتور (وضعیت صریح) */

export type EngineStatus =
  | { readonly status: 'configured'; readonly engine: 'sharp'; readonly libvips: string }
  | { readonly status: 'not_configured'; readonly reason: 'sharp_not_installed' | 'sharp_load_failed' };

export interface TranscodeOptions {
  readonly width: number;
  readonly format: ImageFormat;
  readonly quality: number;
  readonly maxPixels: number;
}

export interface ImageEngine {
  status(): EngineStatus;
  transcode(input: Buffer, options: TranscodeOptions): Promise<Buffer>;
}

/** موتور بارگذاری‌نشده: وضعیت صریح، بی‌خطا. */
export function unavailableEngine(reason: 'sharp_not_installed' | 'sharp_load_failed'): ImageEngine {
  return {
    status: () => ({ status: 'not_configured', reason }),
    transcode: async () => {
      throw new Error(`موتور تبدیل تصویر در دسترس نیست (${reason})`);
    },
  };
}

type SharpModule = {
  (input: Buffer, options?: Record<string, unknown>): {
    rotate(): ReturnType<SharpModule>;
    resize(options: Record<string, unknown>): ReturnType<SharpModule>;
    avif(options: Record<string, unknown>): ReturnType<SharpModule>;
    webp(options: Record<string, unknown>): ReturnType<SharpModule>;
    toBuffer(): Promise<Buffer>;
  };
  versions?: { vips?: string };
};

/**
 * بارگذاری پویا: `sharp` وابستگیِ **اختیاری** است (باینری بومی دارد). نبودش، سایت را نمی‌شکند؛
 * فقط `status()` صادقانه «تنظیم‌نشده» می‌گوید.
 */
export async function loadImageEngine(logger: Logger): Promise<ImageEngine> {
  const specifier = 'sharp'; // متغیر: بی‌وابستگی زمان‌ترجمه به وجود بستهٔ اختیاری
  let loaded: SharpModule;
  try {
    const mod = (await import(specifier)) as { default?: SharpModule } & SharpModule;
    loaded = (mod.default ?? mod) as SharpModule;
  } catch (error) {
    const missing = (error as { code?: string }).code === 'ERR_MODULE_NOT_FOUND' || (error as { code?: string }).code === 'MODULE_NOT_FOUND';
    logger.warn('موتور تبدیل تصویر بارگذاری نشد؛ تصویرها بی‌AVIF/WebP سرو می‌شوند', {
      reason: missing ? 'sharp_not_installed' : 'sharp_load_failed',
      error: error instanceof Error ? error.message.slice(0, 200) : String(error),
    });
    return unavailableEngine(missing ? 'sharp_not_installed' : 'sharp_load_failed');
  }

  const sharp = loaded;
  return {
    status: () => ({ status: 'configured', engine: 'sharp', libvips: sharp.versions?.vips ?? 'unknown' }),
    async transcode(input, options) {
      /*
       * `limitInputPixels`: بمب فشرده‌سازی (یک PNG ۱۰۰ بایتی که ۱۰۰ هزار پیکسل مربع باز می‌شود) را
       * پیش از رمزگشایی می‌گیرد. `rotate()` جهت EXIF را اعمال می‌کند و ابرداده (EXIF/GPS) هرگز در
       * خروجی نمی‌ماند — سایت عمومی، مکان عکاسی را لو نمی‌دهد.
       */
      const pipeline = sharp(input, { limitInputPixels: options.maxPixels, failOn: 'error' })
        .rotate()
        .resize({ width: options.width, withoutEnlargement: true });
      return options.format === 'avif'
        ? pipeline.avif({ quality: options.quality, effort: 4 }).toBuffer()
        : pipeline.webp({ quality: options.quality, effort: 4 }).toBuffer();
    },
  };
}

/* ------------------------------------------------------------------ نشانی و برنامهٔ نسخه‌ها */

export interface VariantPlan {
  readonly widths: readonly number[];
  readonly formats: readonly ImageFormat[];
}

/** پیشوند درهمِ محتوا در نشانی (`v`)؛ ۱۲ نویسهٔ هگز. */
export function versionOf(checksum: string | null | undefined): string | null {
  return typeof checksum === 'string' && /^[0-9a-f]{12,}$/i.test(checksum) ? checksum.slice(0, 12).toLowerCase() : null;
}

/**
 * عرض‌های مجاز برای یک تصویر: نردبان تا قبل از عرض اصلی + **خودِ عرض اصلی**. هرگز بزرگ‌تر از
 * اصل (بزرگ‌کردن، بایت اضافه می‌دهد و کیفیت نه) و هرگز نامحدود (حداکثر ۷ گزینه).
 */
export function allowedWidths(originalWidth: number, config: ImagePipelineConfig): number[] {
  if (!Number.isInteger(originalWidth) || originalWidth < MIN_VARIANT_WIDTH) return [];
  const widths = [...new Set([...config.widths.filter((width) => width < originalWidth), originalWidth])].sort((a, b) => a - b);
  // اگر بیش از سقف بود، کوچک‌ترین‌ها را نگه می‌داریم و اصل را هم؛ تنوع، از نردبان می‌آید.
  return widths.length <= MAX_CANDIDATES ? widths : [...widths.slice(0, MAX_CANDIDATES - 1), originalWidth];
}

export function variantPlan(media: MediaView, config: ImagePipelineConfig, engine: ImageEngine): VariantPlan | null {
  if (engine.status().status !== 'configured') return null;
  if (media.kind !== 'image' || !media.assetId || !media.version || !media.mime) return null;
  if (!config.acceptedMime.includes(media.mime)) return null;
  const widths = allowedWidths(media.width, config);
  return widths.length > 0 ? { widths, formats: config.formats } : null;
}

export function variantUrl(assetId: string, width: number, format: ImageFormat, version: string): string {
  return `/media/${assetId}?w=${width}&f=${format}&v=${version}`;
}

export interface ParsedVariant {
  readonly width: number;
  readonly format: ImageFormat;
}

/**
 * پارامترهای یک درخواست نسخه. `null` = «نسخه نمی‌خواهد» (اصل)؛ `'invalid'` = پارامتر دارد ولی
 * نامعتبر (۴۰۴). هیچ‌وقت «تقریباً درست» پذیرفته نمی‌شود: `w=641` همان ۴۰۴ است، نه نزدیک‌ترین عرض.
 */
export function parseVariantQuery(
  query: URLSearchParams,
  asset: { width: number | null; version: string | null },
  config: ImagePipelineConfig,
): ParsedVariant | null | 'invalid' {
  const w = query.get('w');
  const f = query.get('f');
  const v = query.get('v');
  if (w === null && f === null && v === null) return null;
  if (w === null || f === null || v === null) return 'invalid';

  if (!/^[1-9]\d{0,4}$/.test(w)) return 'invalid';
  const width = Number(w);
  if (!(config.formats as readonly string[]).includes(f)) return 'invalid';
  if (asset.version === null || v !== asset.version) return 'invalid';
  if (typeof asset.width !== 'number' || !allowedWidths(asset.width, config).includes(width)) return 'invalid';

  return { width, format: f as ImageFormat };
}

export interface ImageTagOptions {
  readonly alt: string;
  readonly className: string;
  readonly loading: 'lazy' | 'eager';
  readonly priority?: boolean;
  /** `sizes` برای انتخاب مرورگر؛ پیش‌فرض تمام‌عرض. */
  readonly sizes?: string;
}

/** `<img>` ساده (بی‌موتور، یا تصویری که شایستهٔ نسخه نیست). بُعد همیشه چاپ می‌شود. */
export function plainImage(media: MediaView, options: ImageTagOptions): string {
  return tag('img', {
    class: options.className,
    src: media.url,
    alt: options.alt === '' ? '' : options.alt,
    width: media.width,
    height: media.height,
    loading: options.loading,
    decoding: 'async',
    fetchpriority: options.priority ? 'high' : null,
  });
}

export interface ImagePicture {
  picture(media: MediaView, options: ImageTagOptions): string;
  status(): EngineStatus;
}

export function createPicture(config: ImagePipelineConfig, engine: ImageEngine): ImagePicture {
  return {
    status: () => engine.status(),
    picture(media, options) {
      const plan = variantPlan(media, config, engine);
      if (!plan || !media.assetId || !media.version) return plainImage(media, options);

      const sizes = options.sizes ?? '100vw';
      // مرورگر از بالا به پایین اولین `<source>` سازگار را بر می‌دارد؛ AVIF اول، بعد WebP.
      const sources = plan.formats.map((format) =>
        voidTag('source', {
          type: `image/${format}`,
          srcset: plan.widths.map((width) => `${variantUrl(media.assetId as string, width, format, media.version as string)} ${width}w`).join(', '),
          sizes,
        }),
      );
      return tag('picture', {}, [...sources, plainImage(media, options)].join(''));
    },
  };
}

/* ------------------------------------------------------------------ انبار نسخه‌ها (دیسک، محتوامحور) */

export interface VariantCache {
  get(key: string, format: ImageFormat): Promise<Buffer | null>;
  put(key: string, format: ImageFormat, bytes: Buffer): Promise<void>;
}

export function variantKey(checksum: string, width: number, format: ImageFormat, quality: number): string {
  return createHash('sha256').update(`${checksum}:${width}:${format}:${quality}`).digest('hex');
}

/**
 * انبار روی دیسک. کلید، درهم است (نه نامی از درخواست)، پس مسیر هرگز از ورودی کاربر نمی‌آید و
 * پیمایش مسیر ساختاراً ممکن نیست. نوشتن اتمی (فایل موقت + `rename`): خواننده هرگز نیمه‌فایل نمی‌بیند.
 */
export function createDiskVariantCache(directory: string): VariantCache {
  const pathFor = (key: string, format: ImageFormat): string => join(directory, key.slice(0, 2), `${key}.${format}`);
  return {
    async get(key, format) {
      try {
        return await readFile(pathFor(key, format));
      } catch {
        return null;
      }
    },
    async put(key, format, bytes) {
      const target = pathFor(key, format);
      await mkdir(dirname(target), { recursive: true });
      const temporary = `${target}.${process.pid}.${Date.now().toString(36)}.tmp`;
      await writeFile(temporary, bytes);
      await rename(temporary, target);
    },
  };
}

/** حداکثر تبدیل هم‌زمان: پردازنده، منبع محدودی است و تبدیل AVIF سنگین. */
export function createLimiter(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}
