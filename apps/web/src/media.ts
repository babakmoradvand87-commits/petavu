/**
 * رسانه: از ردیف پایگاه‌داده تا نشانی قابل‌چاپ (گام ۲۳؛ §75، §77، Addendum §۱۰–۱۴).
 *
 * قاعدهٔ مرکزی: **مسیر فایل هرگز از درخواست نمی‌آید.** نشانی رسانه فقط شناسهٔ
 * دارایی را دارد (`/media/<uuid>`)؛ `storage_key` را سرور از پایگاه‌داده
 * می‌خواند. پس «پیمایش مسیر» (path traversal) در این طراحی **ساختاراً** ممکن
 * نیست، نه اینکه با فیلتر جلویش گرفته شود. بررسی داخل‌بودن مسیر هم به‌عنوان
 * لایهٔ دوم می‌ماند، چون `storage_key` داده است و داده همیشه ممکن است خراب
 * باشد.
 *
 * تصمیم دوم: **بُعد اجباری برای تصویر.** اگر دارایی عرض/ارتفاع نداشته باشد،
 * تصویر چاپ نمی‌شود. جعبهٔ بدون بُعد، CLS می‌سازد و CLS بودجهٔ عملکرد است،
 * نه سلیقه (Addendum §۱–۱۹).
 */

import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, normalize, resolve, sep } from 'node:path';

import type { Row } from '@petavu/db';
import { versionOf } from './imagepipeline.js';
import type { MediaView } from './renderers.js';

export interface MediaAssetRow extends Row {
  id: string;
  driver: string;
  storage_key: string;
  bucket: string | null;
  detected_mime: string;
  kind: string;
  size_bytes: number | string;
  width: number | null;
  height: number | null;
  alt_text: string | null;
  original_name: string | null;
  checksum_sha256: string | null;
}

export interface MediaSource {
  /** نشانی‌ای که در HTML می‌نشیند. */
  readonly url: string;
  /** `true` ⇒ مسیر وب باید به این نشانی هدایت کند (فایل دست ما نیست). */
  readonly redirect: boolean;
}

/**
 * نوع‌های MIME که **درون‌خطی** سرو می‌شوند.
 *
 * هر چیز دیگری (از جمله `text/html` و `image/svg+xml`) با
 * `Content-Disposition: attachment` می‌رود. SVG عمداً درون‌خطی نیست: SVG یک
 * سند XML است و می‌تواند اسکریپت داشته باشد؛ با `attachment` ریسکش صفر می‌شود
 * و هزینه‌اش فقط یک دانلود است.
 */
export const INLINE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'font/woff2',
  'application/pdf',
]);

/** نشانی رسانه از ردیف دارایی؛ `null` یعنی «نمی‌توان با اطمینان اشاره کرد». */
export function resolveAssetSource(row: MediaAssetRow): MediaSource | null {
  /*
   * `storage_key` داده است و ممکن است نبود/ناتهی باشد. اینجا هیچ‌وقت استثنا
   * پرتاب نمی‌شود: نبودِ کلید یعنی «نشانی‌ای در دست نیست»، نه «خرابی سرور».
   */
  const key = typeof row.storage_key === 'string' ? row.storage_key : '';
  if (key === '') return null;

  if (row.driver === 'external') {
    /*
     * دارایی بیرونی فقط با `https` پذیرفته می‌شود: `http` در صفحهٔ https
     * محتوای مختلط می‌سازد، و هر طرح دیگری (data/file/javascript) نشانی نیست.
     */
    if (!/^https:\/\//i.test(key)) return null;
    try {
      const url = new URL(key);
      if (url.username !== '' || url.password !== '') return null;
      return { url: url.toString(), redirect: true };
    } catch {
      return null;
    }
  }

  if (row.driver === 'local') {
    if (key === '' || isAbsolute(key)) return null;
    return { url: `/media/${row.id}`, redirect: false };
  }

  /*
   * `s3` و `supabase`: تا وقتی نشانی عمومی پایه در پیکربندی نباشد، نشانی
   * ساخته نمی‌شود. «حدس زدن» نشانی یک باکت، همان چیزی است که به لینک شکسته
   * منتهی می‌شود (§102: هیچ چیز جعلی).
   */
  return null;
}

export function mediaViewOf(row: MediaAssetRow): MediaView | null {
  const source = resolveAssetSource(row);
  if (!source) return null;

  const width = typeof row.width === 'number' ? row.width : Number(row.width);
  const height = typeof row.height === 'number' ? row.height : Number(row.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;

  const kind = row.kind === 'image' ? 'image' : row.kind === 'video' ? 'video' : 'other';

  return {
    url: source.url,
    width,
    height,
    alt: row.alt_text,
    kind,
    // برای نسخه‌های AVIF/WebP؛ فقط دارایی محلی (فایلش دست ماست).
    ...(row.driver === 'local' ? { assetId: row.id, mime: row.detected_mime, version: versionOf(row.checksum_sha256) } : {}),
  };
}

/* ------------------------------------------------------------------ خواندن فایل */

export interface LocalMediaFile {
  readonly body: Buffer;
  readonly sizeBytes: number;
  readonly contentType: string;
  readonly disposition: 'inline' | 'attachment';
}

/**
 * خواندن فایل رسانهٔ محلی.
 *
 * سه نگهبان، به‌ترتیب:
 *   ۱. مسیر نهایی باید **داخل** پوشهٔ انبار باشد (نه با `..`، نه با پیوند).
 *   ۲. فایل باید موجود و غیرخالی باشد.
 *   ۳. حجم از سقف رد نشود (سقف، مانع خواندن بی‌مرز در حافظه است).
 */
export async function readLocalMedia(
  localDir: string,
  storageKey: string,
  options: { maxBytes?: number; contentType: string } ,
): Promise<LocalMediaFile | null> {
  if (storageKey === '' || isAbsolute(storageKey)) return null;

  const root = resolve(localDir);
  const target = resolve(join(root, normalize(storageKey)));
  if (target !== root && !target.startsWith(root + sep)) return null;

  const maxBytes = options.maxBytes ?? 24 * 1024 * 1024;

  try {
    const info = await stat(target);
    if (!info.isFile() || info.size === 0 || info.size > maxBytes) return null;
    const body = await readFile(target);
    return {
      body,
      sizeBytes: info.size,
      contentType: options.contentType,
      disposition: INLINE_MIME.has(options.contentType) ? 'inline' : 'attachment',
    };
  } catch {
    return null;
  }
}

/** سرصفحه‌های پاسخ دارایی رسانه — کش یک‌ساله و تغییرناپذیر (هویت محتوامحور). */
export function mediaHeaders(input: {
  readonly sizeBytes: number;
  readonly contentType: string;
  readonly disposition: 'inline' | 'attachment';
  readonly etag: string;
  readonly fileName: string | null;
}): Record<string, string> {
  const safeName = (input.fileName ?? 'asset').replace(/[^\w.\-]/gu, '_').slice(0, 120);
  return {
    'content-type': input.contentType,
    'content-length': String(input.sizeBytes),
    'cache-control': 'public, max-age=31536000, immutable',
    etag: input.etag,
    'content-disposition': `${input.disposition}; filename="${safeName}"`,
    'x-content-type-options': 'nosniff',
    // فایل رسانه مستقل است؛ هیچ‌چیز از دامنهٔ اصلی به آن دسترسی ندارد.
    'cross-origin-resource-policy': 'same-site',
  };
}
