/**
 * اندازه‌گیری صفحه، بایتِ سروشده (گام ۲۷؛ Addendum §۱–۶، §۹۸).
 *
 * «بودجه‌ای که اندازه‌گیری نشود، آرزوست.» این ماژول، حجم **انتقال** هر صفحه را از خودِ
 * پاسخ‌های سرور می‌خواند — نه از اندازهٔ فایل روی دیسک. تفاوت‌اش واقعی است: فونت
 * woff2 در گام ۲۲ «۸۳KB» گزارش شد (اندازهٔ دیسک) و با این روش معلوم شد **خراب سرو
 * می‌شد** (۱۵۰٬۶۱۰ بایتِ ناهمسان) چون از یک رشتهٔ UTF-8 عبور می‌کرد.
 *
 * چه چیزی سنجیده می‌شود (همهٔ آنچه یک مرورگر برای **نخستین‌نما** می‌گیرد):
 *   • HTML، CSS، JavaScript — فشردهٔ brotli (همان چیزی که روی سیم می‌رود)؛
 *   • فونت‌ها (woff2، خودش فشرده) — هر `url(*.woff2)` در CSS که واقعاً بار می‌شود؛
 *   • تصویرهای غیرتنبل (`loading` غیر از `lazy`).
 *
 * چه چیزی سنجیده **نمی‌شود** و صادقانه `not_compared` می‌ماند: LCP، INP، CLS — اندازهٔ
 * آزمایشگاهی بدون مرورگر ممکن نیست؛ جایش RUM است (بیکن vitals). «قبول»ِ این ماژول
 * یعنی «در سنجه‌های سروشده تخطی نیست»، نه «سریع است».
 *
 * فرض صریح دربارهٔ تصویر: برای `<picture>`، مرورگر مدرن (AVIF) و نمایشگر موبایلِ ۲×
 * (~۹۶۰ پیکسل) فرض می‌شود؛ بزرگ‌ترین گزینه‌ای که از ۹۶۰ بیشتر نباشد.
 */

import { brotliCompressSync } from 'node:zlib';

export interface FetchedResource {
  readonly status: number;
  readonly contentType: string;
  readonly bytes: Buffer;
}

export type ResourceFetcher = (path: string) => Promise<FetchedResource>;

export interface ResourceRef {
  readonly kind: 'html' | 'css' | 'js' | 'font' | 'image' | 'icon';
  readonly path: string;
  /** حجم انتقال، بایت. */
  readonly bytes: number;
  readonly status: number;
}

export interface PageMeasurement {
  readonly html_kb: number;
  readonly css_kb: number;
  readonly js_kb: number;
  readonly font_kb: number;
  readonly image_kb: number;
  readonly weight_kb: number;
  readonly request_count: number;
}

export interface PageReport {
  readonly path: string;
  readonly measurement: PageMeasurement;
  readonly resources: readonly ResourceRef[];
  /** منبعی که نتوانستیم بگیریم (۴xx/۵xx)؛ صفحهٔ دارای منبع شکسته، سالم نیست. */
  readonly failed: readonly ResourceRef[];
}

const TEXT_TYPE = /^(?:text\/|application\/(?:json|xml|javascript)|image\/svg\+xml)/;
const MOBILE_2X_WIDTH = 960;

/** حجم انتقال: متن، brotli؛ دودویی، همان‌طور که هست. */
export function transferBytes(resource: { contentType: string; bytes: Buffer }): number {
  if (TEXT_TYPE.test(resource.contentType)) return brotliCompressSync(resource.bytes).byteLength;
  return resource.bytes.byteLength;
}

function kb(bytes: number): number {
  return Math.round((bytes / 1024) * 10) / 10;
}

function decode(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

/** نشانی (مطلق هم‌مبدأ یا مسیر) → مسیر؛ مبدأ دیگر `null` (مصرف بیرونی، سنجیده نمی‌شود). */
function toPath(href: string, origin: string): string | null {
  const value = decode(href.trim());
  if (value === '' || value.startsWith('data:')) return null;
  if (value.startsWith('//')) return null;
  if (value.startsWith('/')) return value;
  const base = origin.replace(/\/+$/, '');
  return value.startsWith(`${base}/`) ? value.slice(base.length) : null;
}

/** گزینهٔ srcset که مرورگرِ فرضی بر می‌دارد (بزرگ‌ترینِ ≤ ۹۶۰، وگرنه کوچک‌ترین). */
export function pickSrcsetCandidate(srcset: string): string | null {
  const candidates = srcset
    .split(',')
    .map((part) => part.trim().split(/\s+/))
    .filter(([url]) => url)
    .map(([url, descriptor]) => ({ url: url as string, width: descriptor?.endsWith('w') ? Number.parseInt(descriptor, 10) : Number.NaN }));
  if (candidates.length === 0) return null;
  const withWidth = candidates.filter((candidate) => Number.isFinite(candidate.width)).sort((a, b) => a.width - b.width);
  if (withWidth.length === 0) return candidates[0]?.url ?? null;
  const fitting = withWidth.filter((candidate) => candidate.width <= MOBILE_2X_WIDTH);
  return (fitting.at(-1) ?? withWidth[0])?.url ?? null;
}

/** ویژگی‌های یک تگ، مستقل از ترتیب (ترتیب را سازندهٔ HTML تعیین می‌کند و ثابت نیست). */
function attributesOf(tagText: string): Record<string, string> {
  const out: Record<string, string> = {};
  const body = tagText.replace(/^<[a-zA-Z0-9]+/, '').replace(/\/?>$/, '');
  for (const match of body.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*"([^"]*)")?/g)) {
    out[(match[1] ?? '').toLowerCase()] = match[2] ?? '';
  }
  return out;
}

function tagsOf(html: string, name: string): Array<Record<string, string>> {
  return [...html.matchAll(new RegExp(`<${name}\\s[^>]*>`, 'g'))].map((match) => attributesOf(match[0]));
}

/** منابعِ نخستین‌نمای یک سند HTML. */
export function referencedResources(html: string, origin: string): {
  stylesheets: string[];
  scripts: string[];
  preloadedFonts: string[];
  images: string[];
  icons: string[];
} {
  const links = tagsOf(html, 'link');
  const pathsOf = (items: Array<Record<string, string>>, attribute: string): string[] =>
    items.map((item) => toPath(item[attribute] ?? '', origin)).filter((path): path is string => path !== null);

  const stylesheets = pathsOf(links.filter((link) => link['rel'] === 'stylesheet'), 'href');
  const scripts = pathsOf(tagsOf(html, 'script').filter((script) => 'src' in script), 'src');
  const preloadedFonts = pathsOf(links.filter((link) => link['rel'] === 'preload' && link['as'] === 'font'), 'href');
  const icons = pathsOf(links.filter((link) => link['rel'] === 'icon'), 'href');

  // تصویرِ غیرتنبل: `<img>` بدون `loading="lazy"`؛ اگر در `<picture>` است، گزینهٔ فرضیِ منبع اول.
  const images: string[] = [];
  const seen = new Set<string>();
  const add = (path: string | null): void => {
    if (path && !seen.has(path)) {
      seen.add(path);
      images.push(path);
    }
  };
  for (const picture of html.matchAll(/<picture>([\s\S]*?)<\/picture>/g)) {
    const inner = picture[1] ?? '';
    const img = tagsOf(inner, 'img')[0];
    if (!img || img['loading'] === 'lazy') continue;
    const source = tagsOf(inner, 'source')[0];
    const candidate = source?.['srcset'] ? pickSrcsetCandidate(decode(source['srcset'])) : img['src'];
    add(candidate ? toPath(candidate, origin) : null);
  }
  const withoutPictures = html.replace(/<picture>[\s\S]*?<\/picture>/g, '');
  for (const img of tagsOf(withoutPictures, 'img')) {
    if (img['loading'] === 'lazy') continue;
    add(img['src'] ? toPath(img['src'], origin) : null);
  }

  return { stylesheets, scripts, preloadedFonts, images, icons };
}

/** فونت‌هایی که CSS اعلام می‌کند و صفحه واقعاً می‌گیرد (`url(*.woff2)`). */
function fontsOfCss(css: string, origin: string): string[] {
  return [...css.matchAll(/url\(\s*['"]?([^'")\s]+\.woff2[^'")\s]*)['"]?\s*\)/g)]
    .map((match) => toPath(match[1] ?? '', origin))
    .filter((path): path is string => path !== null);
}

/**
 * اندازه‌گیری یک صفحه. `fetch` همان رندر سرور است (نه شبکه)، پس اندازه‌گیری روی سرور
 * واقعی و همان پاسخ‌هایی است که مرورگر می‌گیرد.
 */
export async function measurePage(options: { path: string; origin: string; fetch: ResourceFetcher }): Promise<PageReport> {
  const { path, origin, fetch } = options;
  const resources: ResourceRef[] = [];
  const failed: ResourceRef[] = [];

  const record = async (kind: ResourceRef['kind'], resourcePath: string): Promise<FetchedResource> => {
    const response = await fetch(resourcePath);
    const ref: ResourceRef = { kind, path: resourcePath, bytes: transferBytes(response), status: response.status };
    resources.push(ref);
    if (response.status >= 400) failed.push(ref);
    return response;
  };

  const document = await record('html', path);
  const html = document.bytes.toString('utf8');
  const found = referencedResources(html, origin);

  const fontPaths = new Set<string>(found.preloadedFonts);
  for (const stylesheet of [...new Set(found.stylesheets)]) {
    const css = await record('css', stylesheet);
    for (const font of fontsOfCss(css.bytes.toString('utf8'), origin)) fontPaths.add(font);
  }
  for (const script of [...new Set(found.scripts)]) await record('js', script);
  for (const font of fontPaths) await record('font', font);
  for (const image of found.images) await record('image', image);
  for (const icon of [...new Set(found.icons)]) await record('icon', icon);

  const sum = (kind: ResourceRef['kind']): number => resources.filter((resource) => resource.kind === kind).reduce((total, resource) => total + resource.bytes, 0);
  const total = resources.reduce((accumulator, resource) => accumulator + resource.bytes, 0);

  return {
    path,
    measurement: {
      html_kb: kb(sum('html')),
      css_kb: kb(sum('css')),
      js_kb: kb(sum('js')),
      font_kb: kb(sum('font')),
      image_kb: kb(sum('image')),
      weight_kb: kb(total),
      request_count: resources.length,
    },
    resources,
    failed,
  };
}
