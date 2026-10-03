/**
 * سازندهٔ سایتمپ و ایندکس سایتمپ (Addendum §46).
 *
 * قیدهای پروتکل، سخت‌اند و رعایت‌نکردنشان یعنی سایتمپ بی‌اثر:
 *
 *   • هر فایل حداکثر ۵۰٬۰۰۰ نشانی و ۵۰ مگابایت (نافشرده).
 *   • `lastmod` باید W3C datetime باشد؛ رشتهٔ سرخود، بی‌اثر است.
 *   • `priority` بین ۰ و ۱؛ `changefreq` از فهرست بسته.
 *
 * پس «ساخت سایتمپ» یعنی ساخت چند فایل و یک ایندکس — نه یک فایل بزرگ.
 */

import { toIso } from '@petavu/shared';

export const SITEMAP_MAX_URLS = 50_000;
export const SITEMAP_MAX_BYTES = 50 * 1024 * 1024;

export type ChangeFrequency = 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
const CHANGE_FREQUENCIES: readonly ChangeFrequency[] = ['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never'];

export interface SitemapEntry {
  url: string;
  lastModified?: string | Date | null;
  changeFrequency?: ChangeFrequency | null;
  priority?: number | null;
  /** چند نسخهٔ زبانی برای همین صفحه (xhtml:link). */
  alternates?: ReadonlyArray<{ locale: string; url: string }>;
  images?: ReadonlyArray<{ url: string; title?: string | null; caption?: string | null }>;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** W3C datetime؛ هر چیز نامعتبر، حذف می‌شود (نه اینکه خام بنشیند). */
export function normalizeLastModified(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return toIso(date).replace(/\.\d{3}Z$/, 'Z');
}

export function normalizePriority(value: number | null | undefined): string | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const clamped = Math.min(1, Math.max(0, value));
  return clamped.toFixed(1);
}

export function buildUrlset(entries: readonly SitemapEntry[], options: { withAlternates?: boolean; withImages?: boolean } = {}): string {
  const withAlternates = options.withAlternates ?? entries.some((entry) => (entry.alternates?.length ?? 0) > 0);
  const withImages = options.withImages ?? entries.some((entry) => (entry.images?.length ?? 0) > 0);

  const namespaces = [
    'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    withAlternates ? 'xmlns:xhtml="http://www.w3.org/1999/xhtml"' : '',
    withImages ? 'xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const body = entries.map((entry) => renderEntry(entry, { withAlternates, withImages })).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset ${namespaces}>${body}</urlset>`;
}

function renderEntry(entry: SitemapEntry, options: { withAlternates: boolean; withImages: boolean }): string {
  const parts: string[] = [`<loc>${escapeXml(entry.url)}</loc>`];

  const lastModified = normalizeLastModified(entry.lastModified);
  if (lastModified) parts.push(`<lastmod>${lastModified}</lastmod>`);

  if (entry.changeFrequency && CHANGE_FREQUENCIES.includes(entry.changeFrequency)) {
    parts.push(`<changefreq>${entry.changeFrequency}</changefreq>`);
  }

  const priority = normalizePriority(entry.priority);
  if (priority) parts.push(`<priority>${priority}</priority>`);

  if (options.withAlternates) {
    for (const alternate of entry.alternates ?? []) {
      parts.push(`<xhtml:link rel="alternate" hreflang="${escapeXml(alternate.locale)}" href="${escapeXml(alternate.url)}"/>`);
    }
  }

  if (options.withImages) {
    for (const image of entry.images ?? []) {
      const inner = [
        `<image:loc>${escapeXml(image.url)}</image:loc>`,
        image.title ? `<image:title>${escapeXml(image.title)}</image:title>` : '',
        image.caption ? `<image:caption>${escapeXml(image.caption)}</image:caption>` : '',
      ].join('');
      parts.push(`<image:image>${inner}</image:image>`);
    }
  }

  return `<url>${parts.join('')}</url>`;
}

export interface SitemapFile {
  /** نام فایل، مثل `sitemap-businesses-1.xml`. */
  name: string;
  /** مسیر عمومی، مثل `/sitemaps/sitemap-businesses-1.xml`. */
  path: string;
  content: string;
  urlCount: number;
  lastModified?: string | null;
}

/**
 * تقسیم به فایل‌های مجاز.
 *
 * `bytesPerUrl` تخمین سقف بایت هر نشانی است (سایتمپ هرگز تبدیل به یک فایل
 * ۵۰ مگابایتی نمی‌شود)، و سقف ۵۰٬۰۰۰ نشانی صریح اعمال می‌شود.
 */
export function chunkSitemaps(
  entries: readonly SitemapEntry[],
  options: { prefix: string; directory?: string; maxUrls?: number; maxBytes?: number; bytesPerUrl?: number },
): SitemapFile[] {
  const maxUrls = Math.min(options.maxUrls ?? SITEMAP_MAX_URLS, SITEMAP_MAX_URLS);
  const maxBytes = Math.min(options.maxBytes ?? SITEMAP_MAX_BYTES, SITEMAP_MAX_BYTES);
  const bytesPerUrl = options.bytesPerUrl ?? 700;
  const perFile = Math.max(1, Math.min(maxUrls, Math.floor(maxBytes / bytesPerUrl)));
  const directory = options.directory ?? '/sitemaps';

  const files: SitemapFile[] = [];
  for (let index = 0; index < entries.length; index += perFile) {
    const slice = entries.slice(index, index + perFile);
    const part = files.length + 1;
    const name = `${options.prefix}-${part}.xml`;
    const content = buildUrlset(slice);
    files.push({
      name,
      path: `${directory}/${name}`,
      content,
      urlCount: slice.length,
      lastModified: slice.map((entry) => normalizeLastModified(entry.lastModified)).filter(Boolean).sort().at(-1) ?? null,
    });
  }
  return files;
}

export function buildSitemapIndex(files: ReadonlyArray<{ location: string; lastModified?: string | null }>, baseUrl: string): string {
  const body = files
    .map((file) => {
      const location = escapeXml(/^https?:\/\//i.test(file.location) ? file.location : `${baseUrl.replace(/\/+$/, '')}${file.location}`);
      const lastModified = normalizeLastModified(file.lastModified);
      return `<sitemap><loc>${location}</loc>${lastModified ? `<lastmod>${lastModified}</lastmod>` : ''}</sitemap>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</sitemapindex>`;
}
