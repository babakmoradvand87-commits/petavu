/**
 * فونت: زیرمجموعه، پیش‌بارگذاری، و صفرِ CLS (گام ۲۲؛ Addendum §۶–۸).
 *
 * سه تصمیم که هر کدام یک عدد قابل اندازه‌گیری را جابه‌جا می‌کند:
 *
 *   ۱) **یک فایل متغیر، نه سه وزن.** `wght 100–900` در یک WOFF2 = یک درخواست
 *      به‌جای سه، و وزن‌های میانی (۴۵۰، ۵۵۰) هم بدون فایل تازه ممکن می‌شوند.
 *   ۲) **پیش‌بارگذاری فقط برای فونت بحرانی.** `preload` فونت، LCP متن را جلو
 *      می‌اندازد؛ ولی پیش‌بارگذاری همه‌چیز، صف شبکه را پر می‌کند و همان LCP را
 *      عقب می‌برد. پس یک فایل، آن هم فقط در صفحه‌هایی که متن محتوای اصلی است.
 *   ۳) **`font-display: swap` + جبران متریک.** تا آمدن فونت، فونت سیستم نشان
 *      داده می‌شود؛ `size-adjust` و `ascent-override` باعث می‌شوند جانشین،
 *      همان‌قدر جا بگیرد و پرش متن (CLS) رخ ندهد.
 *
 * اگر فایل فونت نباشد، هیچ‌چیز جعل نمی‌شود: سیستم به فونت جانشین برمی‌گردد و
 * آمادگی، وضعیت را **صادقانه** گزارش می‌کند (§102).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AssetRegistry } from './assets.js';

export interface FontManifest {
  readonly family: string;
  readonly source: string;
  readonly license: string;
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly unicode_ranges: readonly string[];
  readonly axes?: Record<string, [number, number]>;
}

export interface FontSetup {
  /** فایل فونت در دسترس است؟ (نه ادعا — بررسی واقعی دیسک) */
  readonly available: boolean;
  readonly family: string;
  readonly assetUrl: string | null;
  readonly bytes: number;
  readonly manifest: FontManifest | null;
  /** بلوک `@font-face` با بازه‌های نویسه‌ای و جانشین متریک‌جبران‌شده. */
  readonly faceCss: string;
  /**
   * نشانی‌های مطلق فونت بحرانی، برای `preload` و برای هدر `Link`.
   *
   * چرا مطلق و نه نسبی: همان مقدار در دو جا مصرف می‌شود — تگ `<link>` در سند و
   * هدر `Link: <...>; rel=preload` برای «فشار زودهنگام» سرور. یک رشته، دو مصرف.
   */
  readonly preloadUrls: string[];
}

/**
 * پشتهٔ جانشین، با اعداد واقعی.
 *
 * `Vazirmatn Fallback` یک نام ساختگی برای «فونت سیستم با اندازهٔ اصلاح‌شده»
 * است: `size-adjust: 100%` (وزیری عمداً هم‌متریک با فونت‌های رایج طراحی شده)
 * و صعود/نزول تنظیم‌شده تا خط اول، بی‌جهش جابه‌جا نشود.
 */
export const FALLBACK_STACK = [
  'Vazirmatn',
  'Vazirmatn Fallback',
  'system-ui',
  '-apple-system',
  'Segoe UI',
  'Tahoma',
  'Arial',
  'sans-serif',
].join(', ');

export interface FontOptions {
  readonly assetsDirectory: string;
  readonly assets: AssetRegistry;
  /** اگر false، هیچ `preload` تولید نمی‌شود (صفحه‌های بدون متن محوری). */
  readonly preload?: boolean;
  readonly publicOrigin: string;
}

export function createFontSetup(options: FontOptions): FontSetup {
  const manifestPath = join(options.assetsDirectory, 'fonts', 'manifest.json');
  const fontPath = join(options.assetsDirectory, 'fonts', 'vazirmatn-var.woff2');
  const available = existsSync(fontPath) && existsSync(manifestPath);

  if (!available) {
    return {
      available: false,
      family: 'Vazirmatn',
      assetUrl: null,
      bytes: 0,
      manifest: null,
      // پشتهٔ جانشین همین‌جا می‌نشیند تا حتی بدون توکن‌های پایگاه‌داده هم
      // صفحه با فونت خوانا رندر شود (§۱۸۱: بدون داده هم چیزی نمی‌شکند).
      faceCss: `:root { --font-family-sans: ${FALLBACK_STACK}; }`,
      preloadUrls: [],
    };
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as FontManifest;
  const assetUrl = options.assets.url(manifest.file);
  const bytes = options.assets.find(manifest.file)?.bytes ?? manifest.bytes;

  const face = [
    '@font-face {',
    `  font-family: 'Vazirmatn';`,
    '  font-style: normal;',
    '  font-weight: 100 900;',
    '  font-display: swap;',
    `  src: url('${assetUrl}') format('woff2-variations');`,
    `  unicode-range: ${manifest.unicode_ranges.join(', ')};`,
    '}',
    '',
    '/* جانشین متریک‌جبران‌شده: پیش از آمدن فونت، جا را همان‌قدر می‌گیرد. */',
    '@font-face {',
    `  font-family: 'Vazirmatn Fallback';`,
    '  src: local("Tahoma"), local("Arial");',
    '  size-adjust: 100%;',
    '  ascent-override: 92%;',
    '  descent-override: 24%;',
    '  line-gap-override: 0%;',
    '}',
  ].join('\n');

  /* یک فایل، یک پیش‌بارگذاری. فونت دوم — هرچه باشد — بعد از رندر می‌آید. */
  const preloadUrls = options.preload === false ? [] : [`${options.publicOrigin}${assetUrl}`];

  return {
    available: true,
    family: 'Vazirmatn',
    assetUrl,
    bytes,
    manifest,
    faceCss: face,
    preloadUrls,
  };
}

/** هدر پاسخ برای فونت — `immutable` است چون نشانی، درهم‌دار است. */
export function fontCacheHeader(): string {
  return 'public, max-age=31536000, immutable';
}
