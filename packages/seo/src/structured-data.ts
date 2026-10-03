/**
 * موتور داده ساخت‌یافته (Addendum §41–۴۳، §GEO).
 *
 * دو لایه دارد:
 *
 *   ۱) **سازنده‌ها** — JSON-LD را از دادهٔ دامنه می‌سازند (کسب‌وکار، وب‌سایت،
 *      مسیر راهنما، مقاله، پرسش‌های متداول، فهرست).
 *   ۲) **سریال‌ساز** — همان JSON را برای درج در `<script type="application/ld+json">`
 *      امن می‌کند. JSON استاندارد، `</script>` را نمی‌بندد ولی *رشته* می‌تواند
 *      دربر داشته باشد؛ پس `<`, `>`, `&` و نویسه‌های جهت‌دهندهٔ یونیکد فرار
 *      داده می‌شوند.
 *
 * تصویر، همیشه مطلق می‌شود و نهاد برند (`seo.entity` با `is_brand_anchor`)
 * مرکز گراف است: هر گراف، دست‌کم یک گرهٔ برند دارد و بقیه به آن اشاره می‌کنند.
 */

export interface JsonLdNode {
  '@type': string;
  [key: string]: unknown;
}

export interface GraphOptions {
  /** نشانی پایهٔ سایت، برای مطلق‌کردن تصاویر و پیوندها. */
  baseUrl: string;
  /** کلید/نام برند از `seo.entity`. */
  brand: { name: string; url?: string; logo?: string | null; sameAs?: string[] };
  locale?: string;
}

/** پاک‌سازی شیء: کلیدهای تهی می‌روند، رشته‌ها trim می‌شوند. */
export function compact<T extends Record<string, unknown>>(value: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === null || item === undefined) continue;
    if (typeof item === 'string' && item.trim() === '') continue;
    if (Array.isArray(item) && item.length === 0) continue;
    result[key] = typeof item === 'string' ? item.trim() : item;
  }
  return result as T;
}

/** نشانی مطلق: اگر نسبی باشد، بر پایهٔ سایت ساخته می‌شود. */
export function absoluteUrl(url: string, baseUrl: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const base = baseUrl.replace(/\/+$/, '');
  const path = url.startsWith('/') ? url : `/${url}`;
  return `${base}${path}`;
}

export function organizationNode(options: GraphOptions): JsonLdNode {
  return compact({
    '@type': 'Organization',
    '@id': `${options.baseUrl.replace(/\/+$/, '')}/#organization`,
    name: options.brand.name,
    url: options.brand.url ?? options.baseUrl,
    logo: options.brand.logo ?? undefined,
    sameAs: options.brand.sameAs ?? undefined,
  }) as JsonLdNode;
}

export function websiteNode(options: GraphOptions): JsonLdNode {
  return compact({
    '@type': 'WebSite',
    '@id': `${options.baseUrl.replace(/\/+$/, '')}/#website`,
    name: options.brand.name,
    url: options.baseUrl,
    inLanguage: options.locale ?? 'fa-IR',
    publisher: { '@id': `${options.baseUrl.replace(/\/+$/, '')}/#organization` },
  }) as JsonLdNode;
}

export interface LocalBusinessInput {
  name: string;
  url: string;
  type?: string;
  description?: string | null;
  telephone?: string | null;
  image?: string | null;
  priceRange?: string | null;
  address?: { street?: string | null; city?: string | null; region?: string | null; postalCode?: string | null; country?: string | null };
  geo?: { latitude: number; longitude: number };
  openingHours?: string[];
  sameAs?: string[];
}

export function localBusinessNode(input: LocalBusinessInput, options: GraphOptions): JsonLdNode {
  return compact({
    '@type': input.type ?? 'LocalBusiness',
    '@id': `${absoluteUrl(input.url, options.baseUrl)}#business`,
    name: input.name,
    url: absoluteUrl(input.url, options.baseUrl),
    description: input.description ?? undefined,
    telephone: input.telephone ?? undefined,
    image: input.image ? absoluteUrl(input.image, options.baseUrl) : undefined,
    priceRange: input.priceRange ?? undefined,
    address: input.address
      ? compact({
          '@type': 'PostalAddress',
          streetAddress: input.address.street ?? undefined,
          addressLocality: input.address.city ?? undefined,
          addressRegion: input.address.region ?? undefined,
          postalCode: input.address.postalCode ?? undefined,
          addressCountry: input.address.country ?? 'IR',
        })
      : undefined,
    geo: input.geo
      ? { '@type': 'GeoCoordinates', latitude: input.geo.latitude, longitude: input.geo.longitude }
      : undefined,
    openingHours: input.openingHours ?? undefined,
    sameAs: input.sameAs ?? undefined,
  }) as JsonLdNode;
}

export function breadcrumbNode(items: ReadonlyArray<{ name: string; url: string }>, options: GraphOptions): JsonLdNode {
  return {
    '@type': 'BreadcrumbList',
    '@id': `${absoluteUrl(items[items.length - 1]?.url ?? '/', options.baseUrl)}#breadcrumb`,
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.url, options.baseUrl),
    })),
  };
}

export interface ArticleInput {
  headline: string;
  url: string;
  description?: string | null;
  image?: string | null;
  datePublished?: string | null;
  dateModified?: string | null;
  authorName?: string | null;
  type?: 'Article' | 'NewsArticle' | 'BlogPosting';
}

export function articleNode(input: ArticleInput, options: GraphOptions): JsonLdNode {
  return compact({
    '@type': input.type ?? 'Article',
    '@id': `${absoluteUrl(input.url, options.baseUrl)}#article`,
    headline: input.headline,
    url: absoluteUrl(input.url, options.baseUrl),
    description: input.description ?? undefined,
    image: input.image ? absoluteUrl(input.image, options.baseUrl) : undefined,
    datePublished: input.datePublished ?? undefined,
    dateModified: input.dateModified ?? input.datePublished ?? undefined,
    author: input.authorName ? { '@type': 'Person', name: input.authorName } : undefined,
    inLanguage: options.locale ?? 'fa-IR',
    isPartOf: { '@id': `${options.baseUrl.replace(/\/+$/, '')}/#website` },
  }) as JsonLdNode;
}

export function faqNode(items: ReadonlyArray<{ question: string; answer: string }>): JsonLdNode {
  return {
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };
}

export function itemListNode(items: ReadonlyArray<{ name: string; url: string }>, options: GraphOptions): JsonLdNode {
  return {
    '@type': 'ItemList',
    numberOfItems: items.length,
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      url: absoluteUrl(item.url, options.baseUrl),
    })),
  };
}

/** گراف نهایی: `@context` + `@graph`. نهاد برند همیشه اول است. */
export function buildGraph(nodes: readonly JsonLdNode[], options: GraphOptions): string {
  const graph = [organizationNode(options), websiteNode(options), ...nodes];
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph });
}

/**
 * سریال‌سازی امن JSON-LD.
 *
 * `<` و `>` حتی داخل JSON هم فرار داده می‌شوند: مرورگر، `</script>` را در
 * *هر* جایی از بدنهٔ اسکریپت می‌بندد، حتی داخل رشتهٔ JSON. بدون این کار، یک
 * نام کسب‌وکار با `<` می‌تواند HTML را بشکند.
 */
export function serializeJsonLd(value: unknown): string {
  const json = typeof value === 'string' ? value : JSON.stringify(value);
  return json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** بررسی شکل نهایی: گراف باید `@context` و `@graph` داشته باشد. */
export function validateGraph(serialized: string): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized.replace(/\\u003c/g, '<').replace(/\\u003e/g, '>').replace(/\\u0026/g, '&'));
  } catch {
    return { ok: false, problems: ['invalid_json'] };
  }
  const graph = (parsed as { '@graph'?: unknown })['@graph'];
  if (!Array.isArray(graph) || graph.length === 0) problems.push('missing_graph');
  else if (!graph.some((node) => (node as JsonLdNode)['@type'] === 'Organization')) problems.push('missing_brand_node');
  return { ok: problems.length === 0, problems };
}
