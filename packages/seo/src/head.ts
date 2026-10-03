/**
 * سازندهٔ هد (Addendum §39–۴۵).
 *
 * هد، جایی است که سئو به HTML تبدیل می‌شود — و جایی که یک اشتباه، یا نشت
 * می‌سازد یا محتوای تکراری. دو قاعده در کل این فایل تکرار می‌شود:
 *
 *   ۱) **همه‌چیز از داده می‌آید.** عنوان و توضیح از `seo.metadata` (یا قالب)،
 *      کانونیکال از `seo.canonical`، robots از تنظیمات زمانی و محیط.
 *   ۲) **هیچ رشتهٔ HTML خامی از داده ساخته نمی‌شود.** تگ‌ها به شکل ساختاری
 *      (نام + ویژگی‌ها) ساخته می‌شوند و سریال‌سازی، تنها جایی است که escaping
 *      رخ می‌دهد.
 */

import { normalizePersian, truncate } from '@petavu/shared';
import type { RenderedText } from './templates.js';

export type RobotsDirective = 'noindex' | 'nofollow' | 'noarchive' | 'nosnippet' | 'noimageindex' | 'max-snippet:-1' | 'max-image-preview:large' | 'max-video-preview:-1' | 'index' | 'follow';

export interface HeadInput {
  /** نشانی کامل صفحه؛ پایهٔ کانونیکال و OG. */
  url: string;
  /** عنوان نهایی (از `seo.metadata` یا رندر قالب). */
  title: string | RenderedText;
  description?: string | RenderedText | null;
  /** کانونیکال؛ اگر بدهید، بر نشانی صفحه مقدم است. */
  canonical?: string | null;
  robots?: RobotsDirective[];
  /** وضعیت نمایه‌پذیری؛ `false` یا `reason`، `noindex` تحمیل می‌کند. */
  indexable?: boolean;
  nonIndexableReason?: string | null;
  /** زبان و منطقهٔ صفحه. */
  locale?: string;
  /** نسخه‌های زبانی دیگر، برای hreflang. */
  alternates?: Array<{ locale: string; url: string }>;
  og?: {
    type?: string;
    title?: string | null;
    description?: string | null;
    image?: string | null;
    imageAlt?: string | null;
    siteName?: string | null;
    locale?: string | null;
  };
  twitter?: { card?: 'summary' | 'summary_large_image'; site?: string | null; creator?: string | null };
  /** صفحه‌بندی: پیش/پس، همان‌طور که گوگل توصیه می‌کند. */
  pagination?: { prev?: string | null; next?: string | null };
  /** ورودی خام محیط/موقعیت (مثلاً staging) که سیاست robots را عوض می‌کند. */
  environment?: 'production' | 'staging' | 'development' | 'preview';
  /** کدهای بازرسی/تحلیل که باید در هد بیایند — از رجیستری سرویس ثالث. */
  verification?: Array<{ name: string; content: string }>;
}

export interface HeadTag {
  tag: 'title' | 'meta' | 'link';
  attrs: Record<string, string>;
  content?: string;
}

/** سیاست robots بر پایهٔ وضعیت نمایه‌پذیری، محیط و دلیل. */
export function resolveRobots(input: Pick<HeadInput, 'robots' | 'indexable' | 'nonIndexableReason' | 'environment'>): RobotsDirective[] {
  const environment = input.environment ?? 'production';
  const directives = new Set<RobotsDirective>(input.robots ?? []);

  /*
   * محیط غیرتولیدی، هرگز نمایه‌پذیر نیست — حتی اگر داده بگوید هست.
   * «صفحهٔ staging که گوگل ایندکس کرده» کلاسیک‌ترین حادثهٔ سئوی فاجعه‌بار است.
   */
  if (environment !== 'production') {
    directives.add('noindex');
    directives.add('nofollow');
    return [...directives];
  }

  if (input.indexable === false) directives.add('noindex');
  if (input.nonIndexableReason && input.indexable !== true) directives.add('noindex');
  return [...directives];
}

function textOf(value: string | RenderedText | null | undefined): string {
  if (!value) return '';
  const raw = typeof value === 'string' ? value : value.text;
  return normalizePersian(raw).trim();
}

/**
 * ساخت هد.
 *
 * ترتیب تگ‌ها ثابت است (title، سپس meta، سپس link): ترتیبِ پایدار، بازرسی
 * خودکار را ممکن می‌کند و «قرارداد هد» را قابل‌آزمون.
 */
export function buildHead(input: HeadInput): HeadTag[] {
  const tags: HeadTag[] = [];
  const title = textOf(input.title);
  if (title) tags.push({ tag: 'title', attrs: {}, content: title });

  const description = textOf(input.description);
  if (description) tags.push({ tag: 'meta', attrs: { name: 'description', content: description } });

  const robots = resolveRobots(input);
  tags.push({ tag: 'meta', attrs: { name: 'robots', content: robots.length > 0 ? robots.join(', ') : 'index, follow' } });

  const canonical = input.canonical ?? input.url;
  if (canonical) tags.push({ tag: 'link', attrs: { rel: 'canonical', href: canonical } });

  for (const alternate of input.alternates ?? []) {
    tags.push({ tag: 'link', attrs: { rel: 'alternate', hreflang: alternate.locale, href: alternate.url } });
  }

  if (input.pagination?.prev) tags.push({ tag: 'link', attrs: { rel: 'prev', href: input.pagination.prev } });
  if (input.pagination?.next) tags.push({ tag: 'link', attrs: { rel: 'next', href: input.pagination.next } });

  const og = input.og ?? {};
  tags.push({ tag: 'meta', attrs: { property: 'og:type', content: og.type ?? 'website' } });
  if (og.siteName) tags.push({ tag: 'meta', attrs: { property: 'og:site_name', content: og.siteName } });
  if (input.url) tags.push({ tag: 'meta', attrs: { property: 'og:url', content: input.url } });
  const ogTitle = textOf(og.title) || title;
  if (ogTitle) tags.push({ tag: 'meta', attrs: { property: 'og:title', content: ogTitle } });
  const ogDescription = textOf(og.description) || description;
  if (ogDescription) tags.push({ tag: 'meta', attrs: { property: 'og:description', content: ogDescription } });
  if (og.image) tags.push({ tag: 'meta', attrs: { property: 'og:image', content: og.image } });
  if (og.imageAlt) tags.push({ tag: 'meta', attrs: { property: 'og:image:alt', content: og.imageAlt } });
  if (og.locale ?? input.locale) tags.push({ tag: 'meta', attrs: { property: 'og:locale', content: (og.locale ?? input.locale) as string } });

  if (input.twitter) {
    tags.push({ tag: 'meta', attrs: { name: 'twitter:card', content: input.twitter.card ?? 'summary_large_image' } });
    if (input.twitter.site) tags.push({ tag: 'meta', attrs: { name: 'twitter:site', content: input.twitter.site } });
    if (input.twitter.creator) tags.push({ tag: 'meta', attrs: { name: 'twitter:creator', content: input.twitter.creator } });
  }

  for (const verification of input.verification ?? []) {
    tags.push({ tag: 'meta', attrs: { name: verification.name, content: verification.content } });
  }

  return tags;
}

const ATTRIBUTE_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** تنها جای escaping روی مسیر HTML. */
export function escapeAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ATTRIBUTE_ESCAPES[character] as string);
}

export function serializeHeadTags(tags: readonly HeadTag[]): string {
  return tags
    .map((tag) => {
      const attributes = Object.entries(tag.attrs)
        .map(([name, value]) => `${name}="${escapeAttribute(value)}"`)
        .join(' ');
      const open = attributes === '' ? tag.tag : `${tag.tag} ${attributes}`;
      if (tag.tag === 'link' || tag.tag === 'meta') return `<${open}>`;
      return `<${open}>${escapeTextContent(tag.content ?? '')}</${tag.tag}>`;
    })
    .join('');
}

/** متن `<title>`: سه نویسه کافی است؛ بقیه می‌توانند ساختار ببندند. */
export function escapeTextContent(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * کوتاه‌سازی توضیح برای نمایش در هد.
 *
 * توضیح کوتاه‌تر از این، بی‌فایده است و بلندتر، در نتایج بریده می‌شود؛ پس
 * یک تابع، سقف را اعمال می‌کند تا هر مصرف‌کننده‌ای قاعدهٔ خودش را نسازد.
 */
export function clampDescription(value: string | null | undefined, maxLength = 155): string {
  return truncate(textOf(value), maxLength);
}
