/**
 * موتور کانونیکال (Addendum §44).
 *
 * کانونیکال، «کدام نشانی، نشانی اصلی است» را تعیین می‌کند. دو خطای رایج که
 * هر دو محتوای تکراری می‌سازند:
 *
 *   • پارامترهای ردیابی (`utm_*`, `fbclid`, `gclid`, …) بخشی از نشانی می‌شوند
 *     و هر اشتراک‌گذاری، یک نسخهٔ تازه می‌سازد.
 *   • اسلش پایانی، بزرگی/کوچکی میزبان، و `www` ناهمگون.
 *
 * این فایل، تنها جایی است که این تصمیم گرفته می‌شود — رندر و سایتمپ و بازرسی
 * همه از همین تابع می‌پرسند، تا سه تصمیم متفاوت ساخته نشود.
 */

export interface CanonicalInput {
  /** نشانی درخواستی (مطلق یا نسبی). */
  url: string;
  baseUrl: string;
  /** قاعده‌های `seo.canonical` که بر مسیر اعمال می‌شوند. */
  rules?: ReadonlyArray<{ sourcePath: string; canonicalPath: string; matchKind?: 'exact' | 'prefix' | 'pattern' }>;
  /** سیاست اسلش پایانی. `strip` پیش‌فرض است. */
  trailingSlash?: 'strip' | 'keep';
  /** پارامترهایی که باید حفظ شوند (مثل `page` برای صفحه‌بندی). */
  keepParams?: string[];
  /** زبان پیش‌فرض؛ برای تعیین نسخهٔ کانونیکال زبان‌دار. */
  defaultLocale?: string;
}

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'utm_name',
  'fbclid', 'gclid', 'gbraid', 'wbraid', 'msclkid', 'dclid', 'yclid',
  'igshid', 'mc_cid', 'mc_eid', 'ref', 'referrer', 'fb_action_ids', 'wt_mc',
]);

/** نشانی، بدون پارامترهای ردیابی. */
export function stripTrackingParams(url: string, keepParams: string[] = []): string {
  const parsed = new URL(url);
  const keep = new Set(keepParams);
  for (const key of [...parsed.searchParams.keys()]) {
    const lower = key.toLowerCase();
    if (keep.has(lower)) continue;
    if (TRACKING_PARAMS.has(lower) || lower.startsWith('utm_')) parsed.searchParams.delete(key);
  }
  // ترتیب پارامترهای باقی‌مانده، پایدار می‌شود تا دو نشانی هم‌معنا، یکی شوند.
  const sorted = [...parsed.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  parsed.search = '';
  for (const [key, value] of sorted) parsed.searchParams.append(key, value);
  return parsed.toString();
}

export function normalizeUrl(url: string, options: { baseUrl: string; trailingSlash?: 'strip' | 'keep'; keepParams?: string[] }): string {
  const absolute = /^https?:\/\//i.test(url) ? url : `${options.baseUrl.replace(/\/+$/, '')}${url.startsWith('/') ? url : `/${url}`}`;
  const cleaned = stripTrackingParams(absolute, options.keepParams);
  const parsed = new URL(cleaned);

  // میزبان: کوچک، و `www.` برداشته می‌شود (یک تصمیم، نه دو رفتار).
  parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
  parsed.hash = '';
  parsed.protocol = 'https:';

  if ((options.trailingSlash ?? 'strip') === 'strip' && parsed.pathname.length > 1) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  }
  return parsed.toString();
}

/** قاعدهٔ کانونیکال منطبق با یک مسیر، اگر باشد. */
export function matchCanonicalRule(
  path: string,
  rules: CanonicalInput['rules'] = [],
): { sourcePath: string; canonicalPath: string; matchKind: string } | null {
  let best: { sourcePath: string; canonicalPath: string; matchKind: string } | null = null;
  for (const rule of rules) {
    const kind = rule.matchKind ?? 'exact';
    const matches =
      kind === 'exact'
        ? path === rule.sourcePath
        : kind === 'prefix'
          ? path === rule.sourcePath || path.startsWith(`${rule.sourcePath.replace(/\/+$/, '')}/`)
          : new RegExp(rule.sourcePath).test(path);
    if (!matches) continue;
    // طولانی‌ترین منبع، دقیق‌ترین قاعده است — همان قاعدهٔ `pick_template`.
    if (!best || rule.sourcePath.length > best.sourcePath.length) {
      best = { sourcePath: rule.sourcePath, canonicalPath: rule.canonicalPath, matchKind: kind };
    }
  }
  return best;
}

/** کانونیکال نهایی یک صفحه. */
export function resolveCanonical(input: CanonicalInput): { url: string; reason: 'self' | 'rule' | 'default_locale' | 'explicit' } {
  const normalized = normalizeUrl(input.url, {
    baseUrl: input.baseUrl,
    trailingSlash: input.trailingSlash,
    keepParams: input.keepParams,
  });
  const path = new URL(normalized).pathname;

  const rule = matchCanonicalRule(path, input.rules);
  if (rule) {
    const target = rule.canonicalPath.includes('{path}')
      ? rule.canonicalPath.replace('{path}', path)
      : rule.canonicalPath;
    return { url: normalizeUrl(target, { baseUrl: input.baseUrl, trailingSlash: input.trailingSlash }), reason: 'rule' };
  }

  return { url: normalized, reason: 'self' };
}

/** زبان صفحه از نشانی؛ پیش‌فرض زبان سایت. */
export function localeFromPath(path: string, defaultLocale = 'fa-IR'): { locale: string; path: string } {
  const match = /^\/([a-z]{2}(?:-[a-z]{2})?)(\/|$)/i.exec(path);
  if (!match) return { locale: defaultLocale, path };

  /*
   * «fa» به «fa-IR» نگاشته می‌شود چون زبان پیش‌فرض سایت فارسی ایران است؛
   * هر زبان دیگر، همان‌طور که در نشانی آمده برمی‌گردد. نگاشت معکوس در
   * `head.ts` انجام نمی‌شود — یک تصمیم، یک‌جا.
   */
  const candidate = match[1] as string;
  const known = candidate.toLowerCase() === 'fa' ? 'fa-IR' : candidate;
  const rest = path.slice(match[0].length);
  return { locale: known, path: rest === '' ? '/' : `/${rest}` };
}
