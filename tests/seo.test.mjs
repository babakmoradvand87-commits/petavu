/**
 * تست `@petavu/seo` (گام ۲۰ — Addendum §30–۴۷، §96–۱۰۰).
 *
 * این پکیج خالص است: نه پایگاه‌داده، نه شبکه. پس آزمون‌ها هم خالص‌اند — ولی
 * ورودی‌هایشان **واقعی** است: قالب‌های `seo.template`، سقف‌های `seo.metadata`،
 * قیدهای پروتکل سایتمپ، و کدهای وضعیت واقعی IndexNow.
 *
 * در آزمون آداپتور ایندکس، `fetch` تزریقی است. این «Mock» نیست: آداپتور و
 * شکل درخواستش کد تولید است؛ آنچه جعل می‌شود، سمت دیگر شبکه است که در
 * sandbox وجود ندارد — و همین کار در تولید انجام نمی‌شود (§102).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  // قالب
  listTokens,
  validateTemplate,
  renderTemplate,
  renderSlugTemplate,
  // هد
  buildHead,
  resolveRobots,
  serializeHeadTags,
  escapeAttribute,
  clampDescription,
  // داده ساخت‌یافته
  buildGraph,
  localBusinessNode,
  breadcrumbNode,
  articleNode,
  faqNode,
  itemListNode,
  serializeJsonLd,
  validateGraph,
  compact,
  absoluteUrl,
  // سایتمپ
  buildUrlset,
  buildSitemapIndex,
  chunkSitemaps,
  normalizeLastModified,
  normalizePriority,
  escapeXml,
  // robots
  buildRobots,
  buildLlmsTxt,
  AI_CRAWLERS,
  // کانونیکال
  stripTrackingParams,
  normalizeUrl,
  matchCanonicalRule,
  resolveCanonical,
  localeFromPath,
  // بازرسی
  runAudit,
  // ایندکس
  createIndexNowAdapter,
  createSitemapPingAdapter,
  mapIndexNowStatus,
  chunkUrls,
  filterSameHost,
  // دروازه
  evaluateSeoGate,
} from '../packages/seo/dist/index.js';

const BASE = 'https://petavu.ir';
const BRAND = { name: 'PETAVU', url: BASE, logo: '/media/logo.svg', sameAs: ['https://example.org/petavu'] };

/** نمونهٔ صفحهٔ سالم؛ هر آزمون، یک چیز را در آن می‌شکند. */
function healthyPage(overrides = {}) {
  return {
    path: '/b/tak-pet',
    title: 'پت‌شاپ تک‌پت | خوراک و لوازم حیوانات خانگی',
    description: 'پت‌شاپ تک‌پت در تهران: خوراک، لوازم و مشاورهٔ تغذیه برای سگ و گربه. ارسال سریع و تماس مستقیم.',
    bodyText: 'پت‌شاپ تک‌پت فروشندهٔ خوراک سگ و گربه در تهران است. '.repeat(12),
    headings: [{ level: 1, text: 'پت‌شاپ تک‌پت' }, { level: 2, text: 'خدمات' }],
    images: [{ src: '/media/a.jpg', alt: 'قفسهٔ خوراک سگ' }],
    links: [
      { href: '/b/tak-pet/contact', text: 'تماس' },
      { href: '/c/pet-food', text: 'خوراک' },
      { href: '/l/tehran', text: 'تهران' },
    ],
    canonicalUrl: `${BASE}/b/tak-pet`,
    canonicalSelfReferencing: true,
    indexable: true,
    robotsDirectives: ['index', 'follow'],
    structuredDataTypes: ['Organization', 'LocalBusiness'],
    htmlBytes: 60 * 1024,
    statusCode: 200,
    inboundInternalLinks: 4,
    siteUrlCount: 100,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
describe('قالب سئو: رندر بدون زبان قالب (§30–۳۸)', () => {
  test('توکن‌ها فهرست و قالب اعتبارسنجی می‌شود', () => {
    assert.deepEqual(listTokens('{name} {sep} {city}').sort(), ['city', 'name', 'sep']);
    assert.equal(validateTemplate('{name} {sep} PETAVU').ok, true);
    assert.equal(validateTemplate('{name {sep} PETAVU').problems.includes('unbalanced_braces'), true);
    assert.equal(validateTemplate('').problems.includes('empty_template'), true);
  });

  test('جداکننده از داده می‌آید، نه از کد', () => {
    const rendered = renderTemplate('{name} {sep} {city} {sep} PETAVU', { name: 'کلینیک شریف', city: 'تهران' }, { separator: '—' });
    assert.equal(rendered.text, 'کلینیک شریف — تهران — PETAVU');
  });

  test('توکن خالی، جداکنندهٔ تنها نمی‌سازد', () => {
    const rendered = renderTemplate('{name} {sep} {city} {sep} PETAVU', { name: 'کلینیک شریف', city: null }, { separator: '|' });
    assert.equal(rendered.text, 'کلینیک شریف | PETAVU');
    assert.ok(!rendered.text.includes('| |'));
    assert.deepEqual(rendered.unknownTokens, []);
  });

  test('توکن غایب و توکن تهی، دو چیز متفاوت گزارش می‌شوند', () => {
    const missingValue = renderTemplate('{name} {sep} {service}', { name: 'کلینیک', service: '' });
    assert.deepEqual(missingValue.missingTokens, ['service']);
    assert.deepEqual(missingValue.unknownTokens, []);

    const unknown = renderTemplate('{name} {sep} {nonsense}', { name: 'کلینیک' });
    assert.deepEqual(unknown.unknownTokens, ['nonsense']);
  });

  test('نام‌های جایگزین رایج پذیرفته می‌شوند (دادهٔ مرجع از `business_name` استفاده می‌کند)', () => {
    const rendered = renderTemplate('{title} {sep} {business_name}', { title: 'واکسن', name: 'کلینیک شریف' });
    assert.equal(rendered.text, 'واکسن | کلینیک شریف');
  });

  test('طول هدف اعمال می‌شود و بریدن گزارش می‌شود', () => {
    const long = 'واکسن‌های ضروری سگ و گربه در کلینیک دامپزشکی شریف با نوبت‌دهی آنلاین و تلفنی هر روز هفته';
    const rendered = renderTemplate('{title}', { title: long }, { targetLength: 40 });
    assert.ok(rendered.text.length <= 41, `طول: ${rendered.text.length}`);
    assert.equal(rendered.truncated, true);
    assert.ok(rendered.rawLength > rendered.text.length);
  });

  test('قالب نامک، فاصله را به خط تیره می‌برد', () => {
    assert.equal(renderSlugTemplate('{name}', { name: 'کلینیک دامپزشکی شریف' }), 'کلینیک-دامپزشکی-شریف');
  });
});

// ---------------------------------------------------------------------------
describe('هد: robots محیط‌آگاه، کانونیکال، اشتراک‌گذاری (§39–۴۵)', () => {
  test('عنوان، توضیح، کانونیکال خودارجاع و robots پیش‌فرض', () => {
    const tags = buildHead({ url: `${BASE}/b/tak-pet`, title: 'پت‌شاپ تک‌پت', description: 'خوراک و لوازم', locale: 'fa-IR' });
    assert.equal(tags.find((tag) => tag.tag === 'title')?.content, 'پت‌شاپ تک‌پت');
    assert.equal(tags.find((tag) => tag.attrs.name === 'description')?.attrs.content, 'خوراک و لوازم');
    assert.equal(tags.find((tag) => tag.attrs.rel === 'canonical')?.attrs.href, `${BASE}/b/tak-pet`);
    assert.equal(tags.find((tag) => tag.attrs.name === 'robots')?.attrs.content, 'index, follow');
  });

  test('محیط غیرتولیدی، همیشه noindex است', () => {
    for (const environment of ['staging', 'development', 'preview']) {
      const directives = resolveRobots({ environment, indexable: true });
      assert.ok(directives.includes('noindex'), `${environment} باید noindex باشد`);
      assert.ok(directives.includes('nofollow'));
    }
    assert.deepEqual(resolveRobots({ environment: 'production', indexable: true }), []);
  });

  test('دلیل نمایه‌نشدن، در robots دیده می‌شود', () => {
    const directives = resolveRobots({ environment: 'production', indexable: false, nonIndexableReason: 'کسب‌وکار منتشر نشده' });
    assert.ok(directives.includes('noindex'));
  });

  test('تگ‌ها ساختاری ساخته و سریال‌سازی می‌شوند؛ دادهٔ خرابکار، HTML را نمی‌شکند', () => {
    const tags = buildHead({
      url: `${BASE}/b/x?a=1&b=2`,
      title: 'نام "خطرناک" <script>',
      description: 'توضیح با & و <',
      og: { type: 'website', image: '/media/a.jpg' },
    });
    const html = serializeHeadTags(tags);
    assert.ok(!html.includes('<script>'), 'تگ اسکریپت نباید ساخته شود');
    assert.ok(html.includes('&lt;script&gt;'));
    assert.equal(escapeAttribute('a"b'), 'a&quot;b');
  });

  test('hreflang، صفحه‌بندی و OG کامل ساخته می‌شوند', () => {
    const tags = buildHead({
      url: `${BASE}/b/tak-pet?page=2`,
      title: 'فهرست — صفحهٔ ۲',
      alternates: [{ locale: 'fa-IR', url: `${BASE}/b/tak-pet` }, { locale: 'en', url: `${BASE}/en/b/tak-pet` }],
      pagination: { prev: `${BASE}/b/tak-pet`, next: null },
      og: { type: 'website', title: 'OG', image: `${BASE}/media/og.jpg`, siteName: 'PETAVU', locale: 'fa_IR' },
      twitter: { card: 'summary_large_image', site: '@petavu' },
      verification: [{ name: 'google-site-verification', content: 'abc' }],
    });
    assert.equal(tags.filter((tag) => tag.attrs.rel === 'alternate').length, 2);
    assert.equal(tags.find((tag) => tag.attrs.rel === 'prev')?.attrs.href, `${BASE}/b/tak-pet`);
    assert.equal(tags.find((tag) => tag.attrs.name === 'twitter:card')?.attrs.content, 'summary_large_image');
    assert.equal(tags.find((tag) => tag.attrs.name === 'google-site-verification')?.attrs.content, 'abc');
    assert.ok(tags.some((tag) => tag.attrs.property === 'og:image:alt') === false);
  });

  test('توضیح، در سقف هدف بریده می‌شود', () => {
    const long = 'ا'.repeat(400);
    assert.equal(clampDescription(long).length <= 156, true);
  });
});

// ---------------------------------------------------------------------------
describe('داده ساخت‌یافته: گراف با برند در مرکز (Addendum §41–۴۳)', () => {
  test('گراف، همیشه گرهٔ برند و وب‌سایت دارد', () => {
    const graph = buildGraph([], { baseUrl: BASE, brand: BRAND });
    const parsed = JSON.parse(graph);
    assert.equal(parsed['@context'], 'https://schema.org');
    assert.equal(parsed['@graph'][0]['@type'], 'Organization');
    assert.equal(parsed['@graph'][1]['@type'], 'WebSite');
    assert.equal(validateGraph(graph).ok, true);
  });

  test('گرهٔ کسب‌وکار محلی، نشانی نسبی را مطلق می‌کند', () => {
    const node = localBusinessNode(
      {
        name: 'پت‌شاپ تک‌پت',
        url: '/b/tak-pet',
        description: 'خوراک و لوازم',
        telephone: '+982112345678',
        image: '/media/shop.jpg',
        address: { street: 'خیابان ولیعصر', city: 'تهران', country: 'IR' },
        geo: { latitude: 35.7, longitude: 51.4 },
      },
      { baseUrl: BASE, brand: BRAND },
    );
    assert.equal(node.url, `${BASE}/b/tak-pet`);
    assert.equal(node.image, `${BASE}/media/shop.jpg`);
    assert.equal(node.address.addressCountry, 'IR');
    assert.equal(node.geo.latitude, 35.7);
  });

  test('کلیدهای تهی از گراف حذف می‌شوند، نه اینکه null بمانند', () => {
    const node = compact({ name: 'x', description: null, sameAs: [], telephone: '' });
    assert.deepEqual(Object.keys(node), ['name']);
  });

  test('مسیر راهنما، مقاله، پرسش‌ها و فهرست ساخته می‌شوند', () => {
    const breadcrumb = breadcrumbNode([{ name: 'خانه', url: '/' }, { name: 'پت‌شاپ', url: '/t/pet-shop' }], { baseUrl: BASE, brand: BRAND });
    assert.equal(breadcrumb.itemListElement.length, 2);
    assert.equal(breadcrumb.itemListElement[1].item, `${BASE}/t/pet-shop`);

    const article = articleNode({ headline: 'واکسن سگ', url: '/c/vaccine', authorName: 'دکتر رضایی', datePublished: '2026-01-01T00:00:00Z' }, { baseUrl: BASE, brand: BRAND });
    assert.equal(article.author.name, 'دکتر رضایی');
    assert.equal(article.isPartOf['@id'], `${BASE}/#website`);

    assert.equal(faqNode([{ question: 'چند وقت یک‌بار؟', answer: 'سالانه' }]).mainEntity.length, 1);
    assert.equal(itemListNode([{ name: 'الف', url: '/a' }], { baseUrl: BASE, brand: BRAND }).numberOfItems, 1);
  });

  test('سریال‌سازی، `</script>` را بی‌اثر می‌کند', () => {
    const serialized = serializeJsonLd({ name: '</script><img src=x onerror=alert(1)>' });
    assert.ok(!serialized.includes('</script>'));
    assert.ok(serialized.includes('\\u003c'));
    // گرافِ معتبر، پس از سریال‌سازی هم معتبر می‌ماند.
    assert.equal(validateGraph(buildGraph([], { baseUrl: BASE, brand: BRAND })).ok, true);
  });

  test('گراف بی‌گرهٔ برند، معتبر شمرده نمی‌شود', () => {
    const result = validateGraph(JSON.stringify({ '@context': 'https://schema.org', '@graph': [{ '@type': 'Article' }] }));
    assert.equal(result.ok, false);
    assert.ok(result.problems.includes('missing_brand_node'));
  });

  test('نشانی مطلق، دوباره مطلق نمی‌شود', () => {
    assert.equal(absoluteUrl('https://cdn.example.com/a.jpg', BASE), 'https://cdn.example.com/a.jpg');
    assert.equal(absoluteUrl('media/a.jpg', BASE), `${BASE}/media/a.jpg`);
  });
});

// ---------------------------------------------------------------------------
describe('سایتمپ: قیدهای پروتکل، نه سلیقه (§46)', () => {
  const entries = [
    { url: `${BASE}/b/tak-pet`, lastModified: '2026-10-01T10:00:00.000Z', changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE}/c/vaccine?a=1&b=2`, lastModified: 'نامعتبر', priority: 2 },
  ];

  test('urlset با escaping و lastmod استاندارد ساخته می‌شود', () => {
    const xml = buildUrlset(entries);
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
    assert.ok(xml.includes('<loc>https://petavu.ir/c/vaccine?a=1&amp;b=2</loc>'));
    assert.ok(xml.includes('<lastmod>2026-10-01T10:00:00Z</lastmod>'));
    assert.ok(!xml.includes('نامعتبر'), 'زمان نامعتبر نباید خام بنشیند');
  });

  test('priority بیرون دامنه، بریده می‌شود؛ changefreq ناشناس حذف', () => {
    assert.equal(normalizePriority(2), '1.0');
    assert.equal(normalizePriority(-3), '0.0');
    assert.equal(normalizePriority(Number.NaN), null);
    assert.equal(normalizeLastModified('خالی'), null);

    const xml = buildUrlset([{ url: `${BASE}/x`, changeFrequency: 'often' }]);
    assert.ok(!xml.includes('changefreq'));
  });

  test('نسخه‌های زبانی و تصویر، فضای نام خودشان را می‌آورند', () => {
    const xml = buildUrlset(
      [{ url: `${BASE}/b/x`, alternates: [{ locale: 'en', url: `${BASE}/en/b/x` }], images: [{ url: `${BASE}/media/a.jpg`, title: 'قفسه' }] }],
      {},
    );
    assert.ok(xml.includes('xmlns:xhtml'));
    assert.ok(xml.includes('xhtml:link'));
    assert.ok(xml.includes('image:loc'));
  });

  test('تقسیم فایل‌ها، سقف ۵۰٬۰۰۰ و سقف بایت را رعایت می‌کند', () => {
    const many = Array.from({ length: 25 }, (_, index) => ({ url: `${BASE}/p/${index}` }));
    const files = chunkSitemaps(many, { prefix: 'sitemap-pages', maxUrls: 10 });
    assert.equal(files.length, 3);
    assert.deepEqual(files.map((file) => file.urlCount), [10, 10, 5]);
    assert.equal(files[0].path, '/sitemaps/sitemap-pages-1.xml');
    assert.equal(validateGraphSafe(files[0].content), true);
  });

  test('ایندکس سایتمپ، نشانی‌های نسبی را مطلق می‌کند', () => {
    const xml = buildSitemapIndex([{ location: '/sitemaps/sitemap-pages-1.xml', lastModified: '2026-10-01T00:00:00Z' }], BASE);
    assert.ok(xml.includes(`<loc>${BASE}/sitemaps/sitemap-pages-1.xml</loc>`));
    assert.ok(xml.includes('<sitemapindex'));
  });

  test('نویسه‌های ویژه در XML فرار داده می‌شوند', () => {
    assert.equal(escapeXml('a & b < c > d "e" \'f\''), 'a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;');
  });
});

function validateGraphSafe(xml) {
  return /^<\?xml/.test(xml) && xml.includes('<urlset');
}

// ---------------------------------------------------------------------------
describe('robots و llms.txt: تصمیم صریح، نه سکوت (§45)', () => {
  test('تولید: مسیرهای خصوصی بسته و سایتمپ معرفی می‌شود', () => {
    const robots = buildRobots({ environment: 'production', baseUrl: BASE, sitemaps: ['/sitemap.xml'], aiPolicy: 'allow' });
    assert.ok(robots.includes('Disallow: /panel'));
    assert.ok(robots.includes('Disallow: /api/'));
    assert.ok(robots.includes(`Sitemap: ${BASE}/sitemap.xml`));
    assert.ok(robots.includes('User-agent: GPTBot'));
    assert.ok(robots.includes('Allow: /'));
  });

  test('غیرتولید: همه‌چیز بسته و سایتمپ معرفی نمی‌شود', () => {
    const robots = buildRobots({ environment: 'staging', baseUrl: BASE, sitemaps: ['/sitemap.xml'] });
    assert.ok(robots.includes('Disallow: /'));
    assert.ok(!robots.includes('Sitemap:'));
    assert.ok(robots.includes('این محیط تولید نیست'));
  });

  test('سیاست هوش مصنوعی، صریح نوشته می‌شود', () => {
    const disallow = buildRobots({ environment: 'production', baseUrl: BASE, aiPolicy: 'disallow' });
    const blocks = disallow.split('User-agent: ').slice(1);
    assert.equal(blocks.length, AI_CRAWLERS.length + 1, 'هر ربات، یک بلوک');
    assert.ok(disallow.includes('User-agent: ClaudeBot\nDisallow: /'));

    const searchOnly = buildRobots({ environment: 'production', baseUrl: BASE, aiPolicy: 'search-only' });
    assert.ok(searchOnly.includes('User-agent: GPTBot'));
    assert.ok(!/User-agent: GPTBot\nDisallow: \/$/.test(searchOnly.replace(/\n\n/g, '\n')));
  });

  test('llms.txt، منبع را معرفی می‌کند نه محتوا را', () => {
    const llms = buildLlmsTxt({
      siteName: 'PETAVU',
      summary: 'شبکهٔ کسب‌وکار حیوانات خانگی و اسب',
      sections: [{ title: 'کسب‌وکارها', url: `${BASE}/t/veterinary-clinic`, note: 'فهرست کلینیک‌ها' }],
      disallow: ['/panel'],
    });
    assert.ok(llms.includes('# PETAVU'));
    assert.ok(llms.includes(`[کسب‌وکارها](${BASE}/t/veterinary-clinic)`));
    assert.ok(llms.includes('/panel'));
  });
});

// ---------------------------------------------------------------------------
describe('کانونیکال: یک تصمیم، برای همهٔ مصرف‌کننده‌ها (§44)', () => {
  test('پارامترهای ردیابی حذف و ترتیب پایدار می‌شود', () => {
    const cleaned = stripTrackingParams(`${BASE}/b/x?utm_source=news&b=2&a=1&fbclid=xyz`);
    assert.equal(cleaned, `${BASE}/b/x?a=1&b=2`);
  });

  test('پارامتر صفحه‌بندی، عمداً حفظ می‌شود', () => {
    const cleaned = stripTrackingParams(`${BASE}/b/x?utm_source=news&page=2`, ['page']);
    assert.ok(cleaned.includes('page=2'));
  });

  test('میزبان کوچک و بی‌www، پروتکل https و اسلش پایانی بسته می‌شود', () => {
    assert.equal(normalizeUrl('http://WWW.PETAVU.ir/b/x/', { baseUrl: BASE }), `${BASE}/b/x`);
    assert.equal(normalizeUrl('/b/x/', { baseUrl: BASE, trailingSlash: 'keep' }), `${BASE}/b/x/`);
    assert.equal(normalizeUrl(`${BASE}/b/x#top`, { baseUrl: BASE }), `${BASE}/b/x`);
  });

  test('قاعدهٔ دقیق و قاعدهٔ پیشوندی، با انتخاب خاص‌ترین', () => {
    const rules = [
      { sourcePath: '/b', canonicalPath: '/t/businesses', matchKind: 'prefix' },
      { sourcePath: '/b/tak-pet', canonicalPath: '/b/tak-pet-shop', matchKind: 'exact' },
    ];
    assert.equal(matchCanonicalRule('/b/tak-pet', rules)?.canonicalPath, '/b/tak-pet-shop');
    assert.equal(matchCanonicalRule('/b/other', rules)?.canonicalPath, '/t/businesses');
    assert.equal(matchCanonicalRule('/c/x', rules), null);
  });

  test('کانونیکال نهایی: خودارجاع یا از قاعده', () => {
    const self = resolveCanonical({ url: `${BASE}/b/x?utm_source=a`, baseUrl: BASE });
    assert.equal(self.url, `${BASE}/b/x`);
    assert.equal(self.reason, 'self');

    const ruled = resolveCanonical({
      url: `${BASE}/b/x`,
      baseUrl: BASE,
      rules: [{ sourcePath: '/b/x', canonicalPath: '/t/new-home', matchKind: 'exact' }],
    });
    assert.equal(ruled.url, `${BASE}/t/new-home`);
    assert.equal(ruled.reason, 'rule');
  });

  test('زبان از مسیر خوانده می‌شود، با پیش‌فرض فارسی', () => {
    assert.deepEqual(localeFromPath('/en/b/x'), { locale: 'en', path: '/b/x' });
    assert.deepEqual(localeFromPath('/b/x'), { locale: 'fa-IR', path: '/b/x' });
  });
});

// ---------------------------------------------------------------------------
describe('بازرسی: هر قاعده به یک سنجه وصل است (§46)', () => {
  test('صفحهٔ سالم، بی‌یافته و با نمرهٔ کامل است', () => {
    const result = runAudit(healthyPage());
    assert.equal(result.findings.length, 0, JSON.stringify(result.findings));
    assert.equal(result.score, 100);
    assert.equal(result.verdict, 'pass');
  });

  test('بی‌عنوان، مانع است نه هشدار', () => {
    const result = runAudit(healthyPage({ title: null }));
    const finding = result.findings.find((item) => item.ruleKey === 'title.missing');
    assert.equal(finding.severity, 'blocker');
    assert.equal(result.verdict, 'block');
  });

  test('عنوان بلند، کوتاه و عمومی، سه هشدار جدا هستند', () => {
    assert.ok(runAudit(healthyPage({ title: 'کلینیک' })).findings.some((item) => item.ruleKey === 'title.too_short'));
    assert.ok(runAudit(healthyPage({ title: 'ا'.repeat(80) })).findings.some((item) => item.ruleKey === 'title.too_long'));
    assert.ok(
      runAudit(healthyPage({ title: 'در دنیای امروز، خدمات دامپزشکی بهتری داشته باشید' })).findings.some(
        (item) => item.ruleKey === 'title.generic',
      ),
      'عبارت کلیشه‌ای ماشینی باید دیده شود',
    );
    assert.ok(
      !runAudit(healthyPage({ title: 'کلینیک دامپزشکی شریف تهران' })).findings.some((item) => item.ruleKey === 'title.generic'),
      'عنوان مشخص، کلیشه‌ای نیست',
    );
  });

  test('نام برند غایب از عنوان، هشدار است (وقتی نام سایت معلوم باشد)', () => {
    const missing = runAudit(healthyPage({ siteName: 'تک‌پت', title: 'فروشگاه خوراک سگ و گربه در تهران' }));
    assert.ok(missing.findings.some((item) => item.ruleKey === 'title.brand_missing'));

    const present = runAudit(healthyPage({ siteName: 'تک‌پت', title: 'کلینیک تک‌پت | واکسن سگ و گربه در تهران' }));
    assert.ok(!present.findings.some((item) => item.ruleKey === 'title.brand_missing'));

    const unknown = runAudit(healthyPage());
    assert.ok(!unknown.findings.some((item) => item.ruleKey === 'title.brand_missing'), 'بی‌نام سایت، حکم ندارد');
  });

  test('توضیح غایب، خطا است (نه مانع)', () => {
    const result = runAudit(healthyPage({ description: null }));
    assert.equal(result.findings.find((item) => item.ruleKey === 'description.missing').severity, 'error');
    assert.equal(result.verdict, 'warn');
  });

  test('ساختار عنوان‌ها و تصاویر بی‌متن جایگزین دیده می‌شود', () => {
    const noH1 = runAudit(healthyPage({ headings: [{ level: 2, text: 'خدمات' }] }));
    assert.equal(noH1.findings.find((item) => item.ruleKey === 'headings.h1_missing').severity, 'error');

    const twoH1 = runAudit(healthyPage({ headings: [{ level: 1, text: 'a' }, { level: 1, text: 'b' }] }));
    assert.ok(twoH1.findings.some((item) => item.ruleKey === 'headings.h1_multiple'));

    const alt = runAudit(healthyPage({ images: [{ src: '/a.jpg', alt: '' }] }));
    assert.ok(alt.findings.some((item) => item.ruleKey === 'image.alt_missing'));
  });

  test('پیوند داخلی کم و nofollow داخلی، دو یافتهٔ متفاوتند', () => {
    const few = runAudit(healthyPage({ links: [{ href: '/a' }] }));
    assert.ok(few.findings.some((item) => item.ruleKey === 'links.internal_few'));

    const nofollow = runAudit(healthyPage({ links: [{ href: '/a', rel: 'nofollow' }, { href: '/b' }, { href: '/c' }] }));
    assert.ok(nofollow.findings.some((item) => item.ruleKey === 'links.internal_nofollow'));
  });

  test('محتوای نازک: هشدار، و نیمهٔ کف، مانع', () => {
    const thin = runAudit(healthyPage({ bodyText: 'متن کوتاه' }));
    assert.equal(thin.findings.find((item) => item.ruleKey === 'content.thin').severity, 'blocker');

    const almost = runAudit(healthyPage({ bodyText: 'م'.repeat(200) }));
    assert.equal(almost.findings.find((item) => item.ruleKey === 'content.thin').severity, 'warning');
  });

  test('کانونیکال غایب مانع است؛ کانونیکال غیرخودارجاع خطا', () => {
    assert.equal(runAudit(healthyPage({ canonicalUrl: null })).verdict, 'block');
    const other = runAudit(healthyPage({ canonicalSelfReferencing: false }));
    assert.equal(other.findings.find((item) => item.ruleKey === 'canonical.not_self').severity, 'error');
    assert.equal(other.verdict, 'warn');
  });

  test('تناقض noindex با نمایه‌پذیری، مانع است', () => {
    const conflict = runAudit(healthyPage({ indexable: true, robotsDirectives: ['noindex'] }));
    assert.equal(conflict.findings.find((item) => item.ruleKey === 'robots.indexable_conflict').severity, 'blocker');
  });

  test('داده ساخت‌یافته: غایب خطا، بی‌برند هشدار', () => {
    assert.equal(runAudit(healthyPage({ structuredDataTypes: [] })).findings.find((item) => item.ruleKey === 'structured_data.missing').severity, 'error');
    assert.ok(runAudit(healthyPage({ structuredDataTypes: ['Article'] })).findings.some((item) => item.ruleKey === 'structured_data.brand_missing'));
  });

  test('وزن و سنجه‌های میدانی، در برابر بودجه سنجیده می‌شوند', () => {
    const heavy = runAudit(healthyPage({ htmlBytes: 400 * 1024 }));
    assert.ok(heavy.findings.some((item) => item.ruleKey === 'performance.html_heavy'));

    const slow = runAudit(
      healthyPage({ budget: { lcpMs: 2000, cls: 0.1 }, metrics: { lcpMs: 3000, cls: 0.05, samples: 120 } }),
    );
    assert.ok(slow.findings.some((item) => item.ruleKey === 'performance.lcp_over_budget'));
    assert.ok(!slow.findings.some((item) => item.ruleKey === 'performance.cls_over_budget'), 'CLS زیر بودجه است');

    const noData = runAudit(healthyPage({ budget: { lcpMs: 2000 }, metrics: { lcpMs: 9000, samples: 0 } }));
    assert.ok(!noData.findings.some((item) => item.ruleKey === 'performance.lcp_over_budget'), 'بی‌نمونه، حکم ندارد');
  });

  test('کد خطا، زنجیرهٔ تغییر مسیر و صفحهٔ یتیم دیده می‌شوند', () => {
    assert.equal(runAudit(healthyPage({ statusCode: 404 })).verdict, 'block');
    assert.ok(runAudit(healthyPage({ redirectChain: ['/a', '/b'] })).findings.some((item) => item.ruleKey === 'redirect.chain'));
    assert.ok(runAudit(healthyPage({ inboundInternalLinks: 0 })).findings.some((item) => item.ruleKey === 'links.orphan'));
  });

  test('نمره با شدت‌ها کم می‌شود و قاعده‌های خاموش، حساب نمی‌شوند', () => {
    const withWarning = runAudit(healthyPage({ images: [{ src: '/a.jpg', alt: '' }] }));
    assert.equal(withWarning.score, 95);

    const disabled = runAudit(healthyPage({ images: [{ src: '/a.jpg', alt: '' }] }), { disabledRules: ['image.alt_missing'] });
    assert.equal(disabled.score, 100);
  });
});

// ---------------------------------------------------------------------------
describe('آداپتور ایندکس: پروتکل واقعی، شبکهٔ تزریقی (§46–۴۷)', () => {
  /** پاسخ‌دهندهٔ آزمون — سمت دیگر شبکه است که در sandbox نیست، نه یک Mock. */
  function responder(plan) {
    const calls = [];
    const fetch = async (url, init) => {
      calls.push({ url, init });
      const next = plan.shift() ?? { status: 200 };
      if (next.throw) throw new Error('network down');
      return {
        status: next.status,
        headers: { get: (name) => (next.headers ?? {})[name.toLowerCase()] ?? null },
      };
    };
    return { fetch, calls };
  }

  const noSleep = async () => {};

  test('نگاشت کدهای وضعیت، مطابق مستندات IndexNow', () => {
    assert.equal(mapIndexNowStatus(200).status, 'accepted');
    assert.equal(mapIndexNowStatus(202).status, 'accepted');
    assert.equal(mapIndexNowStatus(400).status, 'rejected');
    assert.equal(mapIndexNowStatus(403).status, 'rejected');
    assert.equal(mapIndexNowStatus(422).status, 'rejected');
    assert.equal(mapIndexNowStatus(429).status, 'throttled');
    assert.equal(mapIndexNowStatus(503).status, 'failed');
  });

  test('دسته‌بندی، سقف ۱۰٬۰۰۰ نشانی را رعایت می‌کند', () => {
    const urls = Array.from({ length: 25 }, (_, index) => `${BASE}/p/${index}`);
    assert.equal(chunkUrls(urls, 10).length, 3);
    assert.equal(chunkUrls(urls, 99_999).length, 1, 'سقف پروتکل، بالاتر از تنظیم نمی‌رود');
  });

  test('نشانی بیرون از میزبان، پیش از درخواست رد می‌شود', () => {
    const { accepted, rejected } = filterSameHost([`${BASE}/a`, 'https://other.example/b', 'نه-نشانی'], BASE);
    assert.deepEqual(accepted, [`${BASE}/a`]);
    assert.equal(rejected.length, 2);
  });

  test('ارسال موفق، بدنهٔ درست و نتیجهٔ پذیرفته می‌سازد', async () => {
    const { fetch, calls } = responder([{ status: 200, headers: { 'x-request-id': 'req-1' } }]);
    const adapter = createIndexNowAdapter({ key: 'k-123', baseUrl: BASE, fetch, sleep: noSleep });
    const [result] = await adapter.submit([`${BASE}/b/x`, `${BASE}/b/y`]);

    assert.equal(result.status, 'accepted');
    assert.equal(result.urlCount, 2);
    assert.equal(result.requestId, 'req-1');

    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.host, 'petavu.ir');
    assert.equal(body.key, 'k-123');
    assert.equal(body.keyLocation, `${BASE}/k-123.txt`);
    assert.deepEqual(body.urlList, [`${BASE}/b/x`, `${BASE}/b/y`]);
  });

  test('۴۲۹ با retry-after: پس‌رفت و سپس موفقیت', async () => {
    const { fetch, calls } = responder([{ status: 429, headers: { 'retry-after': '2' } }, { status: 200 }]);
    const adapter = createIndexNowAdapter({ key: 'k', baseUrl: BASE, fetch, sleep: noSleep });
    const [result] = await adapter.submit([`${BASE}/b/x`]);

    assert.equal(result.status, 'accepted');
    assert.equal(result.attempts, 2);
    assert.equal(calls.length, 2);
  });

  test('خطای شبکه، پس از تلاش‌ها شکست گزارش می‌شود (نه استثنا)', async () => {
    const { fetch, calls } = responder([{ throw: true }, { throw: true }, { throw: true }]);
    const adapter = createIndexNowAdapter({ key: 'k', baseUrl: BASE, fetch, sleep: noSleep, maxAttempts: 3 });
    const [result] = await adapter.submit([`${BASE}/b/x`]);

    assert.equal(result.status, 'failed');
    assert.equal(result.attempts, 3);
    assert.equal(calls.length, 3);
    assert.match(String(result.responseNote), /شبکه/);
  });

  test('۴۲۲ برای نشانی‌های بیرون میزبان، پیش از شبکه گزارش می‌شود', async () => {
    const { fetch, calls } = responder([]);
    const adapter = createIndexNowAdapter({ key: 'k', baseUrl: BASE, fetch, sleep: noSleep });
    const [rejected] = await adapter.submit(['https://other.example/x']);

    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.responseCode, 422);
    assert.equal(calls.length, 0, 'درخواست بی‌فایده فرستاده نمی‌شود');
  });

  test('بی‌fetch، ساخت آداپتور خطاست نه شکست خاموش', () => {
    const original = globalThis.fetch;
    // Node خودش `fetch` دارد؛ برای سنجش مسیر خطا، موقتاً برداشته می‌شود.
    delete globalThis.fetch;
    try {
      assert.throws(() => createIndexNowAdapter({ key: 'k', baseUrl: BASE, fetch: undefined, sleep: noSleep }), /fetch/);
      assert.throws(() => createSitemapPingAdapter({ baseUrl: BASE, endpoints: ['https://x/ping'], fetch: undefined, sleep: noSleep }), /fetch/);
    } finally {
      globalThis.fetch = original;
    }
  });

  test('اعلان سایتمپ: اندپوینت بازنشسته، صریح گزارش می‌شود', async () => {
    const { fetch } = responder([{ status: 410 }, { status: 200 }]);
    const adapter = createSitemapPingAdapter({ baseUrl: BASE, endpoints: ['https://google.example/ping', 'https://bing.example/ping'], fetch, sleep: noSleep, maxAttempts: 1 });
    const results = await adapter.ping('/sitemap.xml');

    assert.equal(results[0].status, 'rejected');
    assert.match(String(results[0].responseNote), /Search Console/);
    assert.equal(results[1].status, 'sent');
  });
});

// ---------------------------------------------------------------------------
describe('دروازهٔ انتشار: حکم می‌دهد، نظر نمی‌دهد (§96، §100)', () => {
  const head = buildHead({ url: `${BASE}/b/tak-pet`, title: 'پت‌شاپ تک‌پت', description: 'توضیح کافی برای نمایش در نتایج جست‌وجو' });
  const graph = buildGraph([], { baseUrl: BASE, brand: BRAND });
  const audit = runAudit(healthyPage());

  test('صفحهٔ کامل، از دروازه می‌گذرد', () => {
    const verdict = evaluateSeoGate({ path: '/b/tak-pet', head, structuredData: graph, audit, inSitemap: true });
    assert.equal(verdict.verdict, 'pass');
    assert.equal(verdict.blockers.length, 0);
  });

  test('بدون عنوان و بدون کانونیکال، مانع است', () => {
    const badHead = buildHead({ url: '', title: '' });
    const verdict = evaluateSeoGate({ path: '/b/x', head: badHead, structuredData: graph, audit, inSitemap: true });
    assert.equal(verdict.verdict, 'block');
    assert.ok(verdict.blockers.some((blocker) => blocker.code === 'title_missing'));
  });

  test('گراف ناقص و نبود بازرسی، مانع‌اند', () => {
    const invalidGraph = JSON.stringify({ '@context': 'https://schema.org', '@graph': [{ '@type': 'Article' }] });
    const verdict = evaluateSeoGate({ path: '/b/x', head, structuredData: invalidGraph, audit: null });
    assert.equal(verdict.verdict, 'block');
    assert.ok(verdict.blockers.some((blocker) => blocker.code === 'structured_data_invalid'));
    assert.ok(verdict.blockers.some((blocker) => blocker.code === 'audit_missing'));
  });

  test('مانع بازرسی، مستقیماً به مانع دروازه تبدیل می‌شود', () => {
    const thin = runAudit(healthyPage({ title: null }));
    const verdict = evaluateSeoGate({ path: '/b/x', head, structuredData: graph, audit: thin, inSitemap: true });
    assert.ok(verdict.blockers.some((blocker) => blocker.code === 'audit.title.missing'));
  });

  test('نبود توضیح و نبود سایتمپ، هشدارند نه مانع', () => {
    const headWithoutDescription = buildHead({ url: `${BASE}/b/x`, title: 'عنوان' });
    const verdict = evaluateSeoGate({ path: '/b/x', head: headWithoutDescription, structuredData: graph, audit, inSitemap: false });
    assert.equal(verdict.verdict, 'warn');
    assert.ok(verdict.warnings.some((warning) => warning.code === 'description_missing'));
    assert.ok(verdict.warnings.some((warning) => warning.code === 'sitemap_missing'));
  });

  test('تناقض با تغییر مسیر، مانع است', () => {
    const verdict = evaluateSeoGate({ path: '/b/x', head, structuredData: graph, audit, inSitemap: true, hasRedirectSource: true });
    assert.ok(verdict.blockers.some((blocker) => blocker.code === 'redirect_source_conflict'));
  });

  test('صفحهٔ عمداً نمایه‌نشدنی، شرط کانونیکال و سایتمپ ندارد', () => {
    const noIndexHead = buildHead({
      url: `${BASE}/b/x`,
      title: 'پیش‌نویس داخلی تک‌پت',
      description: 'این صفحه عمداً نمایه نمی‌شود و فقط برای بازبینی درون‌سازمانی است.',
      indexable: false,
    });
    const verdict = evaluateSeoGate({ path: '/b/x', head: noIndexHead, structuredData: graph, audit, inSitemap: false, intentionallyNoIndex: true });
    assert.equal(verdict.verdict, 'pass');
  });
});
