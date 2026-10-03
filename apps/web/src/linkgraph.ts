/**
 * گراف پیوند داخلی و تشخیص صفحهٔ یتیم (گام ۲۶؛ Addendum §۴۶، §۳۹–۴۷).
 *
 * **چرا خزش، نه بازتولید قاعده‌ها.** گراف پیوند حاصل رندر است، نه یک جدول. اگر
 * قاعدهٔ «کدام صفحه به کدام پیوند می‌دهد» را جداگانه در SQL می‌نوشتیم، دو منبع
 * حقیقت می‌داشتیم که با هر تغییر صفحه‌ها واگرا می‌شدند. خزش همان HTML‌ای را می‌خواند
 * که موتور جست‌وجو می‌خواند: **آنچه هست، نه آنچه گمان می‌کنیم هست.**
 *
 * **سه ناحیه.** پیوند سرصفحه و پاورقی در هر صفحه تکرار می‌شود؛ صفحه‌ای که فقط از
 * پاورقی به آن می‌رسند، یتیم است — پیوندی که همه‌جا هست، هیچ‌جا چیزی نمی‌گوید.
 * پس «پیوند ورودی» فقط پیوندِ **بدنهٔ اصلی** یا **مسیر راهنما** از صفحه‌ای دیگر
 * است (`inbound`)؛ پیوند سراسری جدا ثبت می‌شود ولی در تشخیص یتیم نمی‌شمارد.
 *
 * ورودی، `render` است (تابع، نه سوکت): همان خزش روی سرور واقعی هم اجرا می‌شود و
 * در آزمون هم، بی‌شبکه.
 */

export type LinkRegion = 'header' | 'footer' | 'breadcrumb' | 'main';

export interface ExtractedLink {
  readonly href: string;
  readonly region: LinkRegion;
}

export interface LinkEdge {
  readonly from: string;
  readonly to: string;
  readonly region: LinkRegion;
}

export interface CrawlResponse {
  readonly status: number;
  readonly body: string;
  /** برای ۳xx: مقصد هدایت. */
  readonly location?: string | null;
}

export interface CrawlOptions {
  /** مبدأ عمومی سایت؛ پیوند مطلق به همین مبدأ «داخلی» است. */
  readonly origin: string;
  /** نشانی‌هایی که باید نمایه‌شدنی باشند (همان نقشهٔ سایت). */
  readonly nodes: readonly string[];
  readonly render: (path: string) => Promise<CrawlResponse>;
  /** سقف ایمنی؛ خزشِ بی‌پایان ممنوع است. */
  readonly maxPages?: number;
}

export interface BrokenLink {
  readonly from: string;
  readonly to: string;
  readonly status: number;
}

export interface LinkGraph {
  readonly nodes: readonly string[];
  readonly edges: readonly LinkEdge[];
  /** پیوند ورودیِ **زمینه‌ای** (بدنه یا مسیر راهنما، از صفحهٔ دیگر) برای هر نود. */
  readonly inbound: ReadonlyMap<string, number>;
  readonly orphans: readonly string[];
  readonly broken: readonly BrokenLink[];
  /** نودهایی که خودشان پاسخ غیر ۲۰۰ دادند (نقشهٔ سایت نباید چنین نشانی‌ای داشته باشد). */
  readonly unhealthyNodes: ReadonlyArray<{ path: string; status: number }>;
  readonly crawled: number;
  readonly truncated: boolean;
}

/** مسیرهایی که «صفحه» نیستند و در گراف نمی‌آیند. */
const NON_PAGE = /^\/(?:assets\/|media\/|api\/|sitemap\.xml$|sitemaps\/|robots\.txt$|llms\.txt$|healthz$|readyz$|favicon)/;

/**
 * پیوندهای یک سند HTML، با ناحیه.
 *
 * نشانه‌گذاری، خودِ ماست (بی‌تودرتو و ثابت: `site-header`، `site-footer`،
 * `breadcrumb`)؛ پس برش بر پایهٔ شاخص‌های متن کافی و پایدار است. اگر روزی
 * نشانه‌گذاری عوض شد، آزمون «ناحیه‌ها» می‌شکند — بی‌صدا غلط نمی‌شود.
 */
export function extractLinks(html: string): ExtractedLink[] {
  const regions: Array<{ region: LinkRegion; text: string }> = [];
  let rest = html;

  const cut = (pattern: RegExp, region: LinkRegion): void => {
    const match = pattern.exec(rest);
    if (!match) return;
    regions.push({ region, text: match[0] });
    rest = rest.slice(0, match.index) + rest.slice(match.index + match[0].length);
  };

  cut(/<header class="site-header"[\s\S]*?<\/header>/, 'header');
  cut(/<footer class="site-footer"[\s\S]*?<\/footer>/, 'footer');
  cut(/<nav class="breadcrumb"[\s\S]*?<\/nav>/, 'breadcrumb');
  // باقی‌مانده (بدنهٔ اصلی)، بی‌سر و پا و بی‌مسیر راهنما.
  const main = /<main[\s\S]*?<\/main>/.exec(rest)?.[0] ?? rest;
  regions.push({ region: 'main', text: main });

  const links: ExtractedLink[] = [];
  for (const { region, text } of regions) {
    for (const match of text.matchAll(/<a\s[^>]*?href="([^"]*)"/g)) {
      links.push({ href: decodeEntities(match[1] ?? ''), region });
    }
  }
  return links;
}

function decodeEntities(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

/**
 * نشانی → مسیر نرمال‌شده یا `null` (بیرونی، لنگر، `mailto:`، دارایی…).
 *
 * پرس‌وجو و لنگر حذف می‌شوند: `/t/x?cursor=…` همان صفحهٔ `/t/x` است و پیوند
 * به خودش در گراف نمی‌ماند.
 */
export function normalizeInternal(href: string, origin: string): string | null {
  const value = href.trim();
  if (value === '' || value.startsWith('#')) return null;
  if (/^(?:mailto:|tel:|javascript:|data:)/i.test(value)) return null;

  let path: string;
  if (value.startsWith('//')) return null;
  if (value.startsWith('/')) path = value;
  else if (value.startsWith(`${origin}/`) || value === origin) path = value.slice(origin.length) || '/';
  else return null;

  const clean = path.split('#')[0]?.split('?')[0] ?? '/';
  if (NON_PAGE.test(clean)) return null;
  return clean.length > 1 ? clean.replace(/\/+$/, '') : clean;
}

export async function crawlLinkGraph(options: CrawlOptions): Promise<LinkGraph> {
  const origin = options.origin.replace(/\/+$/, '');
  const maxPages = options.maxPages ?? 5_000;

  const nodePaths = [...new Set(options.nodes.map((node) => normalizeInternal(node, origin)).filter((path): path is string => path !== null))];
  const nodeSet = new Set(nodePaths);

  const edges: LinkEdge[] = [];
  const unhealthyNodes: Array<{ path: string; status: number }> = [];
  const targets = new Map<string, Set<string>>(); // مقصد → چه صفحه‌هایی به آن پیوند داده‌اند
  let crawled = 0;
  let truncated = false;

  for (const path of nodePaths) {
    if (crawled >= maxPages) {
      truncated = true;
      break;
    }
    const response = await options.render(path);
    crawled += 1;
    if (response.status !== 200) {
      unhealthyNodes.push({ path, status: response.status });
      continue;
    }

    for (const link of extractLinks(response.body)) {
      const to = normalizeInternal(link.href, origin);
      if (to === null || to === path) continue;
      edges.push({ from: path, to, region: link.region });
      const from = targets.get(to) ?? new Set<string>();
      from.add(path);
      targets.set(to, from);
    }
  }

  // پیوندِ ورودی، فقط «زمینه‌ای» و فقط به نودها.
  const inbound = new Map<string, number>(nodePaths.map((path) => [path, 0]));
  const contextual = new Set<string>();
  for (const edge of edges) {
    if (edge.region !== 'main' && edge.region !== 'breadcrumb') continue;
    if (!nodeSet.has(edge.to)) continue;
    const key = `${edge.from}→${edge.to}`;
    if (contextual.has(key)) continue; // یک صفحه، حداکثر یک پیوند ورودی به مقصد می‌شمارد
    contextual.add(key);
    inbound.set(edge.to, (inbound.get(edge.to) ?? 0) + 1);
  }

  const orphans = nodePaths.filter((path) => path !== '/' && (inbound.get(path) ?? 0) === 0);

  // پیوند شکسته: مقصدهایی که نود نیستند را یک‌بار می‌سنجیم (هدایت، یک گام دنبال می‌شود).
  const broken: BrokenLink[] = [];
  const statusCache = new Map<string, number>();
  for (const [target, sources] of targets) {
    if (nodeSet.has(target)) continue;
    if (crawled >= maxPages) {
      truncated = true;
      break;
    }
    let status = statusCache.get(target);
    if (status === undefined) {
      const response = await options.render(target);
      crawled += 1;
      status = response.status;
      if (status >= 300 && status < 400 && response.location) {
        const next = normalizeInternal(response.location, origin);
        if (next && next !== target) {
          const followed = await options.render(next);
          crawled += 1;
          status = followed.status;
        }
      }
      statusCache.set(target, status);
    }
    if (status >= 400) for (const from of sources) broken.push({ from, to: target, status });
  }

  return { nodes: nodePaths, edges, inbound, orphans, broken, unhealthyNodes, crawled, truncated };
}

/* ------------------------------------------------------------------ نقشهٔ سایت، به‌عنوان نقطهٔ شروع خزش */

/** `<loc>`‌های یک سند نقشهٔ سایت (ایندکس یا urlset)، تبدیل‌شده به مسیر. */
export function sitemapLocations(xml: string, origin: string): string[] {
  const base = origin.replace(/\/+$/, '');
  const paths: string[] = [];
  for (const match of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const location = decodeEntities((match[1] ?? '').trim());
    if (location.startsWith(`${base}/`)) paths.push(location.slice(base.length) || '/');
    else if (location === base) paths.push('/');
    // نشانی مبدأ دیگر در نقشهٔ سایت یک خطاست؛ این‌جا نادیده گرفته می‌شود و `foreign` آن را می‌گوید.
  }
  return paths;
}

export interface SitemapWalk {
  /** نشانی‌های صفحه (مسیر)، یکتا. */
  readonly urls: readonly string[];
  /** بخش‌هایی که ایندکس معرفی کرد ولی غیر ۲۰۰ دادند. */
  readonly failedParts: ReadonlyArray<{ path: string; status: number }>;
  /** نشانی‌هایی که مبدأ دیگری دارند (نقشهٔ سایت نباید چنین چیزی بگوید). */
  readonly foreign: readonly string[];
}

/**
 * همان کاری که خزندهٔ واقعی می‌کند: از `/sitemap.xml` شروع، بخش‌ها را باز کن، نشانی‌ها را
 * جمع کن. فهرست جدا از مسیر تولید نداریم؛ آنچه خزنده می‌بیند، همان است که می‌سنجیم.
 */
export async function walkSitemap(origin: string, render: CrawlOptions['render']): Promise<SitemapWalk> {
  const base = origin.replace(/\/+$/, '');
  const failedParts: Array<{ path: string; status: number }> = [];
  const foreign: string[] = [];
  const urls = new Set<string>();

  const index = await render('/sitemap.xml');
  if (index.status !== 200) {
    failedParts.push({ path: '/sitemap.xml', status: index.status });
    return { urls: [], failedParts, foreign };
  }

  for (const match of index.body.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const location = decodeEntities((match[1] ?? '').trim());
    if (!location.startsWith(`${base}/`)) {
      foreign.push(location);
      continue;
    }
    const partPath = location.slice(base.length);
    const part = await render(partPath);
    if (part.status !== 200) {
      failedParts.push({ path: partPath, status: part.status });
      continue;
    }
    for (const match2 of part.body.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const url = decodeEntities((match2[1] ?? '').trim());
      if (url === base || url.startsWith(`${base}/`)) urls.add(url.slice(base.length) || '/');
      else foreign.push(url);
    }
  }

  return { urls: [...urls], failedParts, foreign };
}
