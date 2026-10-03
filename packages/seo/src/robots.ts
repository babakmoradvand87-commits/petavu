/**
 * robots.txt پویا و محیط‌آگاه (Addendum §45).
 *
 * قاعده‌ای که همه‌چیز را تعیین می‌کند: **محیط غیرتولیدی، نمایه‌پذیر نیست.**
 * یک staging که در گوگل ایندکس شود، هم محتوای تکراری می‌سازد و هم می‌تواند
 * داده‌ی نیم‌ساخته را عمومی کند. پس robots از محیط ساخته می‌شود، نه از یک
 * رشتهٔ ثابت در مخزن.
 *
 * بخش دوم، GEO است: ربات‌های هوش مصنوعی صریحاً فهرست می‌شوند. سکوت دربارهٔ
 * آن‌ها یعنی سیاست مبهم؛ فهرست صریح یعنی تصمیم. و `llms.txt` معرفی می‌شود.
 */

export type Environment = 'production' | 'staging' | 'development' | 'preview';

/** ربات‌های شناخته‌شدهٔ هوش مصنوعی که سیاست GEO دربارهٔ آن‌ها تصمیم می‌گیرد. */
export const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-User',
  'PerplexityBot',
  'Google-Extended',
  'Applebot-Extended',
  'Bytespider',
  'CCBot',
] as const;

/**
 * خزنده‌هایی که برای **آموزش** مدل می‌خزند. اجازهٔ آموزش با اجازهٔ «پاسخ‌دهی و
 * جست‌وجو» یکی نیست؛ سیاست `search-only` همین تفاوت را می‌سازد.
 */
export const AI_TRAINING_CRAWLERS: readonly string[] = ['GPTBot', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'Bytespider', 'ClaudeBot'];

export interface RobotsInput {
  environment: Environment;
  /** نشانی پایهٔ سایت، برای سایتمپ‌ها. */
  baseUrl: string;
  /** مسیرهای ممنوع در همهٔ ربات‌ها (پنل‌ها، اندپوینت‌های داخلی، جست‌وجو). */
  disallow?: string[];
  /** مسیرهای مجاز، وقتی والدشان ممنوع است. */
  allow?: string[];
  /** سایتمپ‌های معرفی‌شده. */
  sitemaps?: string[];
  /** سیاست محتوای هوش مصنوعی: مجاز، ممنوع، یا فقط با ارجاع. */
  aiPolicy?: 'allow' | 'disallow' | 'search-only';
  /** تأخیر پیشنهادی برای ربات‌های سنگین (ثانیه). */
  crawlDelaySeconds?: number | null;
  /** مسیر llms.txt؛ پیش‌فرض `/llms.txt`. */
  llmsPath?: string;
}

const DEFAULT_DISALLOW = ['/panel', '/adminpanel', '/shop', '/adminshop', '/api/', '/search', '/go/'];

export function buildRobots(input: RobotsInput): string {
  const lines: string[] = [];
  const environment = input.environment;
  const disallow = input.disallow ?? DEFAULT_DISALLOW;

  lines.push('# PETAVU — robots.txt');
  lines.push(`# environment: ${environment}`);
  lines.push('');

  if (environment !== 'production') {
    /*
     * در محیط غیرتولیدی، کل سایت بسته است. سایتمپ هم معرفی نمی‌شود: معرفی
     * سایتمپ در robots، دعوت صریح به خزیدن است.
     */
    lines.push('User-agent: *');
    lines.push('Disallow: /');
    lines.push('');
    lines.push('# این محیط تولید نیست؛ هیچ صفحه‌ای نباید نمایه شود.');
    return lines.join('\n');
  }

  lines.push('User-agent: *');
  for (const route of disallow) lines.push(`Disallow: ${route}`);
  for (const route of input.allow ?? []) lines.push(`Allow: ${route}`);
  if (input.crawlDelaySeconds) lines.push(`Crawl-delay: ${input.crawlDelaySeconds}`);
  lines.push('');

  /*
   * سیاست هوش مصنوعی: صریح، نه با سکوت.
   *
   * نکتهٔ معنایی robots.txt که یک‌بار این‌جا اشتباه شد: خزنده‌ای که گروهِ نام‌دار
   * خودش را دارد (`User-agent: GPTBot`)، گروه `*` را **کاملاً نادیده می‌گیرد**.
   * پس «Allow: /» برای ربات هوش مصنوعی، پنل، API و جست‌وجو را هم برایش باز
   * می‌کرد — همان مسیرهایی که برای همه بسته‌اند. هر گروهِ نام‌دار باید فهرست
   * ممنوعه را **خودش** تکرار کند.
   */
  const aiPolicy = input.aiPolicy ?? 'allow';
  const training = new Set<string>(AI_TRAINING_CRAWLERS);
  for (const crawler of AI_CRAWLERS) {
    lines.push(`User-agent: ${crawler}`);
    const blockAll = aiPolicy === 'disallow' || (aiPolicy === 'search-only' && training.has(crawler));
    if (blockAll) {
      lines.push('Disallow: /');
    } else {
      for (const route of disallow) lines.push(`Disallow: ${route}`);
      for (const route of input.allow ?? []) lines.push(`Allow: ${route}`);
    }
    lines.push('');
  }

  for (const sitemap of input.sitemaps ?? []) {
    const absolute = /^https?:\/\//i.test(sitemap) ? sitemap : `${input.baseUrl.replace(/\/+$/, '')}${sitemap}`;
    lines.push(`Sitemap: ${absolute}`);
  }

  const llms = input.llmsPath ?? '/llms.txt';
  lines.push('');
  lines.push('# راهنمای ماشین‌خوان سایت:');
  lines.push(`# ${input.baseUrl.replace(/\/+$/, '')}${llms}`);

  return lines.join('\n');
}

export interface LlmsInput {
  siteName: string;
  summary: string;
  sections?: ReadonlyArray<{ title: string; url: string; note?: string }>;
  /** مسیرهای ممنوع برای پاسخ‌دهی هوش مصنوعی. */
  disallow?: string[];
}

/**
 * `llms.txt` — نقشهٔ سایت برای مدل‌های زبانی.
 *
 * عمداً ساده و کوتاه است: هدف، «معرفی منبع معتبر» است، نه بازتولید محتوا.
 * همین اصل، دلیل وجود این فایل است: در نبود آن، مدل از حافظهٔ آموزش پاسخ
 * می‌دهد، نه از داده‌ی تازه.
 */
export function buildLlmsTxt(input: LlmsInput): string {
  const lines: string[] = [];
  lines.push(`# ${input.siteName}`);
  lines.push('');
  lines.push(`> ${input.summary}`);
  lines.push('');

  for (const section of input.sections ?? []) {
    const note = section.note ? `: ${section.note}` : '';
    lines.push(`- [${section.title}](${section.url})${note}`);
  }

  if ((input.disallow ?? []).length > 0) {
    lines.push('');
    lines.push('## Not for model output');
    for (const route of input.disallow ?? []) lines.push(`- ${route}`);
  }

  return lines.join('\n');
}
