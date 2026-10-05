/**
 * آزمون سئوی فنی (گام ۲۶ — Addendum §۳۹–۴۷، §۸۸–۹۰، §۴۴–۴۶، PART 102).
 *
 * اصل: **نقشهٔ سایت فقط نشانی‌هایی را می‌گوید که صفحه‌شان نمایه‌شدنی است**، و
 * «نمایه‌شدنی» همان چیزی است که خودِ صفحه می‌گوید. پس بیش از آنکه محتوای XML را
 * بسنجیم، دو سو را با هم می‌سنجیم: هر نشانیِ نقشه، در محیط تولید ۲۰۰ و بی‌`noindex`
 * است؛ و هر صفحهٔ `noindex` در نقشه نیست.
 *
 * دومین اصل: robots و نقشهٔ سایت از **داده** می‌آیند (`ops.setting`، `seo.settings`،
 * `seo.metadata`) و ورودیِ نامعتبرِ داده، فایل را نمی‌شکند و دستور تزریق نمی‌کند.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { createFixture, html } from '../scripts/lib/fixture.mjs';
import { openDatabase } from '../scripts/lib/engine.mjs';
import { migrate } from '../scripts/lib/migrate.mjs';
import { applySeeds } from '../scripts/lib/seed.mjs';
import { recordLinkFindings } from '../scripts/lib/seo-opportunities.mjs';

import { crawlLinkGraph, extractLinks, normalizeInternal, sitemapLocations, walkSitemap } from '../apps/web/dist/linkgraph.js';
import { parseSitemapPart, sitemapChunkSize, sitemapPartPath } from '../apps/web/dist/sitemaps.js';
import { indexNowStatus } from '../apps/web/dist/indexnow.js';
import { parseRobotsPolicy } from '../apps/web/dist/pages/feeds.js';
import { resolveTarget } from '../apps/web/dist/router.js';

const run = promisify(execFile);
const ORIGIN = 'http://localhost:3000';

let f;
let owner;
const ids = {};
const urlsOf = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
const paths = (xml, origin = ORIGIN) => urlsOf(xml).map((url) => url.replace(origin, ''));

/** همهٔ نشانی‌های نقشهٔ سایت، از راه خودِ `/sitemap.xml` (مثل یک خزندهٔ واقعی). */
async function walk(page = f.page, origin = ORIGIN) {
  return walkSitemap(origin, async (path) => {
    const result = await page(path);
    return { status: result.status, body: result.body, location: result.headers.location ?? null };
  });
}

before(async () => {
  f = await createFixture();
  owner = await f.registerUser({ email: 'owner@petavu.test' });

  ids.petShop = await f.createBusiness({ slug: 'pet-shop-karaj', name: 'پت‌شاپ کرج', ownerUserId: owner.userId, typeKey: 'pet_shop', industryKey: 'animal_care.grooming', locationPath: 'iran.alborz.karaj' });
  ids.vetKaraj = await f.createBusiness({ slug: 'vet-karaj', name: 'کلینیک سینا', ownerUserId: owner.userId, typeKey: 'veterinary_clinic', industryKey: 'animal_health.clinic', locationPath: 'iran.alborz.karaj' });
  ids.vetKaraj2 = await f.createBusiness({ slug: 'vet-karaj-2', name: 'کلینیک مهر', ownerUserId: owner.userId, typeKey: 'veterinary_clinic', industryKey: 'animal_health.clinic', locationPath: 'iran.alborz.karaj' });
  ids.vetArdabil = await f.createBusiness({ slug: 'vet-ardabil', name: 'کلینیک اردبیل', ownerUserId: owner.userId, typeKey: 'veterinary_clinic', industryKey: 'animal_health.clinic', locationPath: 'iran.ardabil.ardabil' });
  ids.draft = await f.createBusiness({ slug: 'draft-biz', name: 'پیش‌نویس', ownerUserId: owner.userId, status: 'draft', visibility: 'private' });
  ids.hidden = await f.createBusiness({ slug: 'private-biz', name: 'خصوصی', ownerUserId: owner.userId, status: 'active', visibility: 'private' });
  for (let index = 1; index <= 25; index += 1) {
    const n = String(index).padStart(2, '0');
    await f.createBusiness({ slug: `equine-${n}`, name: `باشگاه ${n}`, ownerUserId: owner.userId, typeKey: 'equine_center' });
  }

  const article=await f.createContent({ slug: 'dog-vaccination', title: 'واکسیناسیون سگ', categoryPaths: ['health.vaccination'] });
  await f.sudo('update app.content set body=$1::jsonb,body_text=$2 where id=$3',[JSON.stringify({blocks:[{kind:'paragraph',text:'شرح مستند خدمات و اطلاعات عمومی '.repeat(20)}]}),'شرح مستند خدمات و اطلاعات عمومی '.repeat(20),article]);
  await f.createContent({ businessId: ids.vetKaraj, slug: 'clinic-content', title: 'محتوای کلینیک' });
});

after(async () => {
  await f?.close();
});

// ---------------------------------------------------------------------------
describe('ایندکس نقشهٔ سایت و بخش‌ها (Addendum §۴۶)', () => {
  test('`/sitemap.xml` همیشه ایندکس است و بخش‌ها را زیر `/sitemaps/` می‌نامد', async () => {
    const response = await f.page('/sitemap.xml');
    assert.equal(response.status, 200);
    assert.match(response.get('content-type'), /^application\/xml/);
    assert.match(response.body, /<sitemapindex xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
    assert.doesNotMatch(response.body, /<urlset/);

    const parts = paths(response.body);
    for (const expected of ['pages', 'content-1', 'types', 'industries', 'locations', 'categories', 'businesses-1']) {
      assert.ok(parts.includes(`/sitemaps/${expected}.xml`), expected);
    }
    // همهٔ نشانی‌های ایندکس مطلق و از مبدأ عمومی‌اند.
    for (const url of urlsOf(response.body)) assert.ok(url.startsWith(`${ORIGIN}/sitemaps/`), url);
  });

  test('هر بخشِ ایندکس، واقعاً ۲۰۰ و urlset معتبر است', async () => {
    const parts = paths((await f.page('/sitemap.xml')).body);
    for (const part of parts) {
      const response = await f.page(part);
      assert.equal(response.status, 200, part);
      assert.match(response.body, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset/, part);
    }
  });

  test('بخش‌های تاکسونومی `lastmod` واقعی دارند؛ بخش‌های قطعه‌قطعه ندارند (دروغ نمی‌گوییم)', async () => {
    const index = (await f.page('/sitemap.xml')).body;
    const entry = (name) => new RegExp(`<sitemap><loc>[^<]*/sitemaps/${name}\\.xml</loc>([^]*?)</sitemap>`).exec(index)?.[1] ?? '';
    for (const name of ['types', 'industries', 'locations', 'categories']) {
      assert.match(entry(name), /<lastmod>\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ<\/lastmod>/, name);
    }
    assert.doesNotMatch(entry('businesses-1'), /lastmod/);
    assert.doesNotMatch(entry('content-1'), /lastmod/);
  });

  test('پلتفرم خالی: فقط آنچه هست؛ بخشِ بی‌عضو معرفی نمی‌شود', async () => {
    const empty = await createFixture();
    try {
      const parts = paths((await empty.page('/sitemap.xml')).body);
      assert.deepEqual(parts, ['/sitemaps/pages.xml', '/sitemaps/content-1.xml']); // قوانین، محتوای سراسری است
      for (const absent of ['types', 'industries', 'locations', 'categories', 'businesses-1']) {
        assert.equal((await empty.page(`/sitemaps/${absent}.xml`)).status, 404, absent);
      }
      // «pages» صفحهٔ اصلی را دارد ولی مرکزِ خالی را نه.
      const pages = paths((await empty.page('/sitemaps/pages.xml')).body);
      assert.deepEqual(pages, ['/']);
    } finally {
      await empty.close();
    }
  });

  test('نام بخش از فهرست بسته است: بخش ناشناخته و شمارهٔ بی‌معنا، ۴۰۴ (بی‌خطا)', async () => {
    for (const bad of ['/sitemaps/unknown.xml', '/sitemaps/types-2.xml', '/sitemaps/businesses-0.xml', '/sitemaps/businesses-abc.xml', '/sitemaps/businesses-1', '/sitemaps/../etc.xml', '/sitemaps/businesses-1.xml.gz', '/sitemaps']) {
      const response = await f.page(bad);
      assert.ok([404, 400].includes(response.status), `${bad} → ${response.status}`);
      assert.doesNotMatch(response.body, /<urlset|<sitemapindex/);
    }
    assert.equal((await f.page('/sitemaps/businesses-99.xml')).status, 404); // بیرون از بازه
  });

  test('تجزیهٔ نام بخش و نشانی', () => {
    assert.deepEqual(parseSitemapPart('businesses-3'), { name: 'businesses', page: 3 });
    assert.deepEqual(parseSitemapPart('types'), { name: 'types', page: 1 });
    assert.equal(parseSitemapPart('types-2'), null);
    assert.equal(parseSitemapPart('businesses-0'), null);
    assert.equal(parseSitemapPart('businesses-1234567'), null);
    assert.equal(sitemapPartPath('businesses', 2), '/sitemaps/businesses-2.xml');
    assert.equal(sitemapPartPath('types', 1), '/sitemaps/types.xml');
    assert.deepEqual(resolveTarget('/sitemaps/businesses-2.xml', 'public'), { type: 'sitemap_part', ref: { name: 'businesses', page: 2 } });
    assert.equal(resolveTarget('/sitemaps/other.xml', 'public').type, 'not_found');
    // روی میزبان‌های مدیریتی وجود ندارد.
    assert.notEqual(resolveTarget('/sitemaps/pages.xml', 'panel').type, 'sitemap_part');
  });

  test('ETag و ۳۰۴: نقشهٔ بدون تغییر، صفر بایت', async () => {
    const port = f.web.server.address().port;
    const first = await fetch(`http://127.0.0.1:${port}/sitemap.xml`);
    const etag = first.headers.get('etag');
    assert.match(etag ?? '', /^"[0-9a-f]{24}"$/);
    await first.text();
    const second = await fetch(`http://127.0.0.1:${port}/sitemap.xml`, { headers: { 'if-none-match': etag } });
    assert.equal(second.status, 304);
    assert.equal((await second.text()), '');
    assert.match(first.headers.get('cache-control') ?? '', /s-maxage=300/);
  });
});

// ---------------------------------------------------------------------------
describe('محتوای صادق نقشهٔ سایت', () => {
  test('فقط کسب‌وکار عمومی و فعال؛ پیش‌نویس و خصوصی هرگز', async () => {
    const part = paths((await f.page('/sitemaps/businesses-1.xml')).body);
    assert.ok(part.includes('/b/pet-shop-karaj'));
    assert.ok(!part.includes('/b/draft-biz'));
    assert.ok(!part.includes('/b/private-biz'));
    assert.equal(part.length, 29); // ۴ نام‌دار + ۲۵ باشگاه
  });

  test('رگرسیون: بیش از ۱۰۰ کسب‌وکار، بی‌صدا قطع نمی‌شود (سقف DAL ۱۰۰ بود)', async () => {
    // پایگاه‌دادهٔ جدا: این ۱۲۰ ردیف نباید خزش‌های سنگین بقیهٔ آزمون‌ها را کند کنند.
    const big = await createFixture();
    try {
      const user = await big.registerUser({ email: 'bulk@petavu.test' });
      await big.sudo(
        `insert into app.business (slug, name, business_type_key, owner_user_id, status, visibility, published_at)
         select 'bulk-' || n, 'انبوه ' || n, 'pet_supplies_wholesale', $1, 'active', 'public', now()
         from generate_series(1, 120) n`,
        [user.userId],
      );
      const part = paths((await big.page('/sitemaps/businesses-1.xml')).body);
      assert.equal(part.length, 120);
      assert.equal(new Set(part).size, 120, 'نشانی تکراری');
    } finally {
      await big.close();
    }
  });

  test('محتوا: فقط محتوای سراسریِ منتشرشده؛ محتوای کسب‌وکار روی پروفایلش می‌نشیند', async () => {
    await f.sudo(
      `insert into app.content (business_id, kind, slug, title, body, status, visibility, locale)
       values (null, 'article', 'draft-article', 'پیش‌نویس', '{"blocks":[]}'::jsonb, 'draft', 'public', 'fa-IR')`,
    );
    const content = paths((await f.page('/sitemaps/content-1.xml')).body);
    assert.ok(content.includes('/rules'));
    assert.ok(content.includes('/dog-vaccination'));
    assert.ok(!content.includes('/draft-article'));
    assert.ok(!content.includes('/clinic-content'));
  });

  test('مرکزها و تاکسونومی: فقط با عضو (محتوای کم‌مایه در نقشه نمی‌آید)', async () => {
    const types = paths((await f.page('/sitemaps/types.xml')).body);
    assert.ok(types.includes('/t/pet-shop'));
    assert.ok(types.includes('/t/veterinary-clinic'));
    assert.ok(!types.includes('/t/mobile-vet'), 'نوعِ بی‌کسب‌وکار');

    const industries = paths((await f.page('/sitemaps/industries.xml')).body);
    assert.ok(industries.includes('/i/animal-care'), 'والد، با شمار زیردرخت');
    assert.ok(industries.includes('/i/animal-care/grooming'));
    assert.ok(!industries.includes('/i/animal-care/boarding'));

    const locations = paths((await f.page('/sitemaps/locations.xml')).body);
    assert.ok(locations.includes('/l/alborz'));
    assert.ok(locations.includes('/l/alborz/karaj'));
    assert.ok(locations.includes('/l/ardabil') && locations.includes('/l/ardabil/ardabil'));
    assert.ok(!locations.includes('/l/bushehr/bushehr'));

    const pages = paths((await f.page('/sitemaps/pages.xml')).body);
    assert.deepEqual(pages.sort(), ['/', '/businesses', '/i', '/k', '/l', '/t'].sort());
  });

  test('هرگز: جست‌وجو، نشانگر، ۴۰۴ و مسیرهای ماشینی', async () => {
    const all = (await walk()).urls;
    assert.ok(all.length > 40);
    for (const path of all) {
      assert.doesNotMatch(path, /^\/search/);
      assert.doesNotMatch(path, /cursor=/);
      assert.doesNotMatch(path, /^\/(?:assets|media|api|sitemaps?)\b/);
      assert.doesNotMatch(path, /\.(?:xml|txt)$/);
    }
    assert.equal(new Set(all).size, all.length);
  });

  test('نقشه با «نمایه‌شدنی بودنِ» خودِ صفحه هم‌سو است: هر نشانی ۲۰۰ و بی‌noindex (تولید)', async () => {
    const prod = await f.production();
    try {
      const listed = (await walk(prod.page, prod.origin)).urls;
      assert.ok(listed.length > 40);
      const wrong = [];
      for (const path of listed) {
        const response = await prod.page(path);
        const robots = html.meta(response.body, 'robots') ?? '';
        if (response.status !== 200 || /noindex/.test(robots)) wrong.push(`${path} → ${response.status} ${robots}`);
      }
      assert.deepEqual(wrong, [], `نشانی‌های ناسازگار: ${wrong.slice(0, 5).join('؛ ')}`);
    } finally {
      await prod.restore();
    }
  });

  test('فرادادهٔ noindex، کسب‌وکار را از نقشه بیرون می‌برد — و صفحه هم همین را می‌گوید', async () => {
    await f.sudo(
      `insert into seo.metadata (entity_kind, entity_id, locale, is_indexable, non_indexable_reason, robots_directives)
       values ('business', $1, 'fa-IR', false, 'user_choice', array['noindex'])`,
      [ids.vetKaraj2],
    );
    const prod = await f.production();
    try {
      const listed = paths((await prod.page('/sitemaps/businesses-1.xml')).body, prod.origin);
      assert.ok(!listed.includes('/b/vet-karaj-2'));
      assert.ok(listed.includes('/b/vet-karaj'));
      assert.match(html.meta((await prod.page('/b/vet-karaj-2')).body, 'robots') ?? '', /noindex/);
    } finally {
      await prod.restore();
      await f.sudo(`delete from seo.metadata where entity_id = $1`, [ids.vetKaraj2]);
    }
  });

  test('فرادادهٔ noindex روی مسیر (تاکسونومی)، آن را از بخشش بیرون می‌برد', async () => {
    await f.sudo(
      `insert into seo.metadata (entity_kind, route_key, locale, is_indexable, non_indexable_reason, robots_directives)
       values ('business_type', '/t/veterinary-clinic', 'fa-IR', false, 'user_choice', array['noindex'])`,
    );
    const prod = await f.production();
    try {
      const types = paths((await prod.page('/sitemaps/types.xml')).body, prod.origin);
      assert.ok(!types.includes('/t/veterinary-clinic'));
      assert.ok(types.includes('/t/pet-shop'));
      assert.match(html.meta((await prod.page('/t/veterinary-clinic')).body, 'robots') ?? '', /noindex/);
    } finally {
      await prod.restore();
      await f.sudo(`delete from seo.metadata where route_key = '/t/veterinary-clinic'`);
    }
  });

  test('اندازهٔ قطعه از تنظیمات می‌آید و بخش‌ها را قطعه می‌کند (حداکثر ۵۰٬۰۰۰)', async () => {
    const previous = (await f.sudo(`select extra from seo.settings where business_id is null`))[0].extra;
    const setChunk = (value) =>
      f.sudo(`update seo.settings set extra = jsonb_set(extra, '{indexing,max_sitemap_urls}', $1::jsonb) where business_id is null`, [JSON.stringify(value)]);
    try {
      await setChunk(10);
      const index = paths((await f.page('/sitemap.xml')).body);
      const chunks = index.filter((path) => path.startsWith('/sitemaps/businesses-'));
      assert.deepEqual(chunks, ['/sitemaps/businesses-1.xml', '/sitemaps/businesses-2.xml', '/sitemaps/businesses-3.xml']); // ۲۹ ⇒ ۳
      const sizes = [];
      const seen = [];
      for (const chunk of chunks) {
        const urls = paths((await f.page(chunk)).body);
        sizes.push(urls.length);
        seen.push(...urls);
      }
      assert.deepEqual(sizes, [10, 10, 9]);
      assert.equal(new Set(seen).size, 29, 'هیچ نشانی‌ای دوبار یا از قلم نیفتاد');
      assert.equal((await f.page('/sitemaps/businesses-4.xml')).status, 404);

      // سقف پروتکل، و مقدار نامعتبر ⇒ پیش‌فرض.
      await setChunk(1_000_000_000);
      assert.equal(paths((await f.page('/sitemap.xml')).body).filter((path) => path.startsWith('/sitemaps/businesses-')).length, 1);
      await setChunk('زیاد');
      assert.equal(paths((await f.page('/sitemap.xml')).body).filter((path) => path.startsWith('/sitemaps/businesses-')).length, 1);
    } finally {
      await f.sudo(`update seo.settings set extra = $1::jsonb where business_id is null`, [JSON.stringify(previous)]);
    }
    assert.equal(sitemapChunkSize({ extra: { indexing: { max_sitemap_urls: 7 } } }), 7);
    assert.equal(sitemapChunkSize({ extra: { indexing: { max_sitemap_urls: 0 } } }), 1);
    assert.equal(sitemapChunkSize({ extra: { indexing: { max_sitemap_urls: 99_999 } } }), 50_000);
    assert.equal(sitemapChunkSize({ extra: {} }), 45_000);
    assert.equal(sitemapChunkSize(null), 45_000);
  });
});

// ---------------------------------------------------------------------------
describe('robots.txt: داده‌محور، ایمن، با گروه‌های صحیح (Addendum §۳۹–۴۷)', () => {
  let prod;
  const robots = async () => (await prod.page('/robots.txt')).body;
  const groups = (text) =>
    text
      .split('\n\n')
      .map((block) => block.trim())
      .filter((block) => block.startsWith('User-agent: '))
      .map((block) => {
        const lines = block.split('\n');
        return { agent: lines[0].slice('User-agent: '.length), lines: lines.slice(1) };
      });

  before(async () => {
    prod = await f.production();
  });
  after(async () => {
    await prod?.restore();
  });

  test('مسیرهای بسته از تنظیمات `platform.robots` می‌آیند، و مسیرهای فنی همیشه افزوده می‌شوند', async () => {
    const text = await robots();
    const star = groups(text).find((group) => group.agent === '*');
    const disallow = star.lines.filter((line) => line.startsWith('Disallow: ')).map((line) => line.slice(10));
    for (const route of ['/panel', '/adminpanel', '/design-studio', '/api/', '/cart', '/checkout', '/auth/']) assert.ok(disallow.includes(route), `از تنظیمات: ${route}`);
    for (const route of ['/readyz', '/search', '/*?cursor=']) assert.ok(disallow.includes(route), `فنی: ${route}`);
  });

  test('ایندکس نقشهٔ سایت معرفی می‌شود (نه بخش‌ها)', async () => {
    const text = await robots();
    assert.deepEqual(text.match(/^Sitemap: .*$/gm), [`Sitemap: ${prod.origin}/sitemap.xml`]);
  });

  test('هر گروهِ نام‌دار، فهرست ممنوعه را تکرار می‌کند (گروه نام‌دار، گروه * را نمی‌خواند)', async () => {
    const all = groups(await robots());
    const star = all.find((group) => group.agent === '*').lines.filter((line) => line.startsWith('Disallow: '));
    const named = all.filter((group) => group.agent !== '*');
    assert.ok(named.length >= 10);
    for (const group of named) {
      for (const line of star) assert.ok(group.lines.includes(line), `${group.agent} بی «${line}» است`);
      assert.ok(!group.lines.includes('Allow: /'), `${group.agent}: «Allow: /» همهٔ مسیرهای بسته را باز می‌کند`);
    }
  });

  test('سیاست هوش مصنوعی از تنظیمات سئو می‌آید: بولی و سه‌حالته', async () => {
    const previous = (await f.sudo(`select extra from seo.settings where business_id is null`))[0].extra;
    const set = (patch) => f.sudo(`update seo.settings set extra = extra || $1::jsonb where business_id is null`, [JSON.stringify(patch)]);
    try {
      await set({ indexing: { ...previous.indexing, allow_ai_crawlers: false } });
      let all = groups(await robots());
      assert.deepEqual(all.find((group) => group.agent === 'GPTBot').lines, ['Disallow: /']);
      assert.deepEqual(all.find((group) => group.agent === 'OAI-SearchBot').lines, ['Disallow: /']);

      // سه‌حالته بر بولی مقدم است: آموزش بسته، پاسخ‌دهی باز (با فهرست ممنوعه).
      await set({ indexing: { ...previous.indexing, allow_ai_crawlers: false, ai_policy: 'search-only' } });
      all = groups(await robots());
      assert.deepEqual(all.find((group) => group.agent === 'GPTBot').lines, ['Disallow: /']);
      assert.ok(all.find((group) => group.agent === 'PerplexityBot').lines.includes('Disallow: /panel'));
      assert.ok(!all.find((group) => group.agent === 'PerplexityBot').lines.includes('Disallow: /'));

      // مقدار نامعتبر ⇒ نادیده؛ بولی می‌ماند.
      await set({ indexing: { ...previous.indexing, allow_ai_crawlers: true, ai_policy: 'مبهم' } });
      all = groups(await robots());
      assert.ok(all.find((group) => group.agent === 'GPTBot').lines.includes('Disallow: /panel'));
    } finally {
      await f.sudo(`update seo.settings set extra = $1::jsonb where business_id is null`, [JSON.stringify(previous)]);
    }
  });

  test('داده، دستور تزریق نمی‌کند: مسیر نامعتبر دور ریخته می‌شود (نه اصلاح)', async () => {
    const previous = (await f.sudo(`select value from ops.setting where business_id is null and key = 'platform.robots'`))[0].value;
    await f.sudo(`update ops.setting set value = $1::jsonb where business_id is null and key = 'platform.robots'`, [
      JSON.stringify({
        disallow: ['/ok', '/evil\nAllow: /secret', 'no-slash', '/with space', '/#hash', '/x\rSitemap: https://evil.example/s.xml', 42, null, '/ok', '/' + 'a'.repeat(300)],
        crawl_delay_seconds: 5,
      }),
    ]);
    try {
      const text = await robots();
      assert.doesNotMatch(text, /Allow: \/secret/);
      assert.doesNotMatch(text, /evil\.example/);
      assert.match(text, /Disallow: \/ok\n/);
      assert.equal((text.match(/^Disallow: \/ok$/gm) ?? []).length, 1 + groups(text).filter((group) => group.agent !== '*').length, 'تکراری یکی می‌شود');
      assert.match(text, /^Crawl-delay: 5$/m);
    } finally {
      await f.sudo(`update ops.setting set value = $1::jsonb where business_id is null and key = 'platform.robots'`, [JSON.stringify(previous)]);
    }
  });

  test('ورودی‌های نامعتبرِ تنظیم، فایل را نمی‌شکنند', () => {
    for (const raw of [null, undefined, 7, 'x', [], { disallow: 'not-array' }, { disallow: [1, 2, 3] }]) {
      assert.deepEqual(parseRobotsPolicy(raw).disallow, [], JSON.stringify(raw));
    }
    for (const delay of [0, -1, 61, 1.5, '5', null]) assert.equal(parseRobotsPolicy({ crawl_delay_seconds: delay }).crawlDelaySeconds, null, String(delay));
    assert.equal(parseRobotsPolicy({ crawl_delay_seconds: 10 }).crawlDelaySeconds, 10);
    assert.equal(parseRobotsPolicy({ allow_ai_crawlers: 'yes' }).allowAiCrawlers, null);
    assert.equal(parseRobotsPolicy({ allow_ai_crawlers: false }).allowAiCrawlers, false);
    assert.equal(parseRobotsPolicy({ disallow: Array.from({ length: 80 }, (_, i) => `/p${i}`) }).disallow.length, 50);
  });

  test('خاموشی ایندکس در تنظیمات سئو، کل سایت را می‌بندد و ETag دارد', async () => {
    await f.sudo(`update seo.settings set indexing_enabled = false where business_id is null`);
    try {
      const response = await prod.page('/robots.txt');
      assert.match(response.body, /User-agent: \*\nDisallow: \/$/m);
      assert.doesNotMatch(response.body, /Sitemap:/);
      assert.match(response.get('etag') ?? '', /^"[0-9a-f]{24}"$/);
    } finally {
      await f.sudo(`update seo.settings set indexing_enabled = true where business_id is null`);
    }
  });

  test('محیط غیرتولید: همه‌چیز بسته و نقشهٔ سایت معرفی نمی‌شود', async () => {
    const response = await f.page('/robots.txt'); // محیط تست
    assert.match(response.body, /Disallow: \/\n/);
    assert.doesNotMatch(response.body, /Sitemap:/);
  });
});

// ---------------------------------------------------------------------------
describe('llms.txt: منابع واقعی، نه صفحهٔ خالی', () => {
  test('مرکزها، نوع/صنف/شهرِ دارای کسب‌وکار با شمار، و صفحه‌های پلتفرم', async () => {
    const { body } = await f.page('/llms.txt');
    assert.match(body, /\[انواع کسب‌وکار\]\(http:\/\/localhost:3000\/t\)/);
    assert.match(body, /\[صنف‌ها\]\(http:\/\/localhost:3000\/i\)/);
    assert.match(body, /\(http:\/\/localhost:3000\/t\/veterinary-clinic\): 3 کسب‌وکار/);
    assert.match(body, /\(http:\/\/localhost:3000\/l\/alborz\/karaj\)/);
    assert.match(body, /\(http:\/\/localhost:3000\/rules\)/);
    assert.doesNotMatch(body, /\/t\/mobile-vet/, 'نوعِ بی‌کسب‌وکار');
    assert.match(body, /## Not for model output/);
  });

  test('همهٔ پیوندها مطلق‌اند و از مبدأ عمومی', async () => {
    const { body } = await f.page('/llms.txt');
    for (const match of body.matchAll(/\]\(([^)]+)\)/g)) assert.ok(match[1].startsWith(`${ORIGIN}/`), match[1]);
  });
});

// ---------------------------------------------------------------------------
describe('IndexNow: وضعیت صریح و فایل کلید (PART 102)', () => {
  const KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

  test('وضعیت از مقدار خام: تنظیم‌شده یا تنظیم‌نشده با دلیل', () => {
    assert.deepEqual(indexNowStatus({ key: KEY }), { status: 'configured', key: KEY });
    assert.deepEqual(indexNowStatus(null), { status: 'not_configured', reason: 'missing' });
    assert.deepEqual(indexNowStatus({}), { status: 'not_configured', reason: 'missing' });
    assert.deepEqual(indexNowStatus({ key: 'x' }), { status: 'not_configured', reason: 'invalid_key' });
    assert.deepEqual(indexNowStatus({ key: 'bad key!!!!!' }), { status: 'not_configured', reason: 'invalid_key' });
    assert.deepEqual(indexNowStatus({ key: KEY, enabled: false }), { status: 'not_configured', reason: 'disabled' });
    assert.deepEqual(indexNowStatus([KEY]), { status: 'not_configured', reason: 'missing' });
  });

  test('تا کلید تنظیم نشده، فایل ۴۰۴ است (کلید ساختگی نمی‌سازیم)', async () => {
    assert.equal((await f.page(`/${KEY}.txt`)).status, 404);
  });

  test('با کلید تنظیم‌شده: فقط همان مسیر، با همان بدنه (متن ساده)', async () => {
    await f.sudo(`insert into ops.setting (business_id, key, value) values (null, 'seo.indexnow', $1::jsonb)`, [JSON.stringify({ key: KEY })]);
    try {
      const ok = await f.page(`/${KEY}.txt`);
      assert.equal(ok.status, 200);
      assert.match(ok.get('content-type'), /^text\/plain/);
      assert.equal(ok.body.trim(), KEY);
      // کلید دیگر، همان ۴۰۴ همیشگی است (اوراکل نمی‌سازد).
      assert.equal((await f.page('/ffffffffffffffffffffffffffffffff.txt')).status, 404);
    } finally {
      await f.sudo(`delete from ops.setting where key = 'seo.indexnow'`);
    }
  });

  test('کلیدِ علامت‌خورده «سرّی»، از وب پنهان می‌شود (RLS) ⇒ تنظیم‌نشده', async () => {
    await f.sudo(`insert into ops.setting (business_id, key, value, is_secret) values (null, 'seo.indexnow', $1::jsonb, true)`, [JSON.stringify({ key: KEY })]);
    try {
      assert.equal((await f.page(`/${KEY}.txt`)).status, 404);
    } finally {
      await f.sudo(`delete from ops.setting where key = 'seo.indexnow'`);
    }
  });

  test('این الگو هرگز محتوا را نمی‌پوشاند و فقط مسیر یک‌سطحیِ `.txt` است', () => {
    assert.equal(resolveTarget(`/${KEY}.txt`, 'public').type, 'indexnow_key');
    assert.equal(resolveTarget('/robots.txt', 'public').type, 'robots');
    assert.equal(resolveTarget('/llms.txt', 'public').type, 'llms');
    assert.equal(resolveTarget('/rules', 'public').type, 'content');
    assert.notEqual(resolveTarget(`/a/${KEY}.txt`, 'public').type, 'indexnow_key');
    assert.notEqual(resolveTarget('/short.txt', 'public').type, 'indexnow_key');
    assert.notEqual(resolveTarget(`/${KEY}.txt`, 'panel').type, 'indexnow_key');
  });
});

// ---------------------------------------------------------------------------
describe('پیوند داخلی: پروفایل بالا و کناره‌ها را می‌بیند (Addendum §۴۶)', () => {
  test('مسیر راهنما از نوع می‌گذرد و پیوندهای «کاوش بیشتر» به صفحه‌های واقعی می‌روند', async () => {
    const { body } = await f.page('/b/pet-shop-karaj');
    const hrefs = html.hrefs(body);
    for (const href of ['/t/pet-shop', '/i/animal-care/grooming', '/l/alborz/karaj']) assert.ok(hrefs.includes(href), href);
    assert.match(body, /<nav class="breadcrumb"[^]*?\/t\/pet-shop[^]*?<\/nav>/);
    const graph = html.jsonLd(body).flatMap((block) => block['@graph'] ?? [block]).find((node) => node['@type'] === 'BreadcrumbList');
    assert.equal(graph.itemListElement.at(-2).item, `${ORIGIN}/t/pet-shop`);
    // نام فارسی نوع، نه کلید خام.
    assert.doesNotMatch(body, /pet_shop/);
  });

  test('کسب‌وکارهای مشابه: هم‌نوع، هم‌شهری‌ها اول، خود صفحه هرگز', async () => {
    const related = (path) => {
      const section = /id="related"[^]*?(?=<\/div><\/section>|$)/.exec(path)?.[0] ?? '';
      return [...new Set(html.hrefs(section).filter((href) => href.startsWith('/b/')))];
    };
    const karaj = related((await f.page('/b/vet-karaj')).body);
    assert.ok(!karaj.includes('/b/vet-karaj'));
    assert.deepEqual(karaj, ['/b/vet-karaj-2', '/b/vet-ardabil'], 'هم‌شهری اول، بعد بقیه');
    // نوعِ بدون همتا ⇒ بخش اصلاً نیست.
    assert.doesNotMatch((await f.page('/b/pet-shop-karaj')).body, /کسب‌وکارهای مشابه/);
  });

  test('چرخش قطعی: هر هم‌نوع دقیقاً ۶ پیوند ورودی می‌گیرد، هر بار یکسان؛ هیچ‌کس یتیم نیست', async () => {
    const slugs = Array.from({ length: 25 }, (_, i) => `equine-${String(i + 1).padStart(2, '0')}`);
    const inbound = new Map(slugs.map((slug) => [slug, 0]));
    const lists = new Set();
    for (const slug of slugs) {
      const first = (await f.page(`/b/${slug}`)).body;
      const again = (await f.page(`/b/${slug}`)).body;
      assert.equal(first, again, 'خروجی باید قطعی باشد');
      const section = /id="related"[^]*?(?=<\/div><\/section>|$)/.exec(first)?.[0] ?? '';
      const targets = [...new Set(html.hrefs(section).filter((href) => href.startsWith('/b/')))].map((href) => href.slice(3));
      assert.equal(targets.length, 6, slug);
      assert.ok(!targets.includes(slug));
      lists.add(targets.join());
      for (const target of targets) inbound.set(target, inbound.get(target) + 1);
    }
    // چرخه: هر پروفایل از شش پروفایلِ قبلی‌اش پیوند می‌گیرد — نه کمتر، نه بیشتر، نه تصادفی.
    assert.deepEqual([...new Set(inbound.values())], [6]);
    assert.equal(lists.size, 25, 'هر صفحه، فهرست خودش را دارد؛ نه یک دستهٔ ثابت برای همه');
  });

  test('پیوندهای دستیِ سراسری (`seo.internal_link`) نمایش داده می‌شوند — فقط فعال و فقط مسیر داخلی', async () => {
    const insert = (target, active = true, business = null, anchor = 'برچسب') =>
      f.sudo(
        `insert into seo.internal_link (business_id, source_path, target_path, anchor_text, link_kind, source, is_active)
         values ($1, '/b/pet-shop-karaj', $2, $3, 'editorial', 'manual', $4)`,
        [business, target, anchor, active],
      );
    await insert('/rules', true, null, 'قوانین پلتفرم');
    await insert('/t', false, null, 'خاموش');
    await insert('/i', true, ids.petShop, 'کسب‌وکاری');
    await insert('//evil.example/x', true, null, 'بیرونی');
    await insert('https://evil.example/', true, null, 'مطلق');
    await insert('javascript:alert(1)', true, null, 'اسکریپت');
    try {
      const { body } = await f.page('/b/pet-shop-karaj');
      const section = /id="links"[^]*?(?=<\/div><\/section>|$)/.exec(body)?.[0] ?? '';
      assert.match(section, /href="\/rules"[^>]*>قوانین پلتفرم/);
      assert.doesNotMatch(section, /خاموش/);
      assert.doesNotMatch(section, /کسب‌وکاری/);
      assert.doesNotMatch(body, /evil\.example|javascript:/);
    } finally {
      await f.sudo(`delete from seo.internal_link where source_path = '/b/pet-shop-karaj'`);
    }
  });
});

// ---------------------------------------------------------------------------
describe('گراف پیوند: استخراج و نرمال‌سازی (واحد)', () => {
  const sample = `<!doctype html><html><body>
    <header class="site-header"><a href="/">خانه</a><a href="/t">انواع</a></header>
    <main id="main">
      <nav class="breadcrumb" aria-label="مسیر"><ol><li><a href="/t">نوع</a></li></ol></nav>
      <a href="/b/x">یک</a> <a href="http://localhost:3000/b/y?utm_source=a#top">دو</a>
      <a href="mailto:a@b.c">m</a><a href="#local">l</a><a href="https://other.example/">o</a><a href="//cdn.example/">p</a>
    </main>
    <footer class="site-footer"><a href="/rules">قوانین</a></footer></body></html>`;

  test('سه ناحیه جدا می‌شوند: سرصفحه، پاورقی، مسیر راهنما، بدنه', () => {
    const links = extractLinks(sample);
    const by = (region) => links.filter((link) => link.region === region).map((link) => link.href);
    assert.deepEqual(by('header'), ['/', '/t']);
    assert.deepEqual(by('footer'), ['/rules']);
    assert.deepEqual(by('breadcrumb'), ['/t']);
    assert.deepEqual(by('main'), ['/b/x', 'http://localhost:3000/b/y?utm_source=a#top', 'mailto:a@b.c', '#local', 'https://other.example/', '//cdn.example/']);
  });

  test('نرمال‌سازی: مبدأ، پرس‌وجو، لنگر، اسلش پایانی؛ بیرونی و ماشینی حذف', () => {
    const n = (href) => normalizeInternal(href, ORIGIN);
    assert.equal(n('/b/x'), '/b/x');
    assert.equal(n('http://localhost:3000/b/y?utm_source=a#top'), '/b/y');
    assert.equal(n('/t/x/?cursor=abc'), '/t/x');
    assert.equal(n('http://localhost:3000'), '/');
    assert.equal(n('/'), '/');
    for (const skipped of ['', '#a', 'mailto:a@b.c', 'tel:123', 'javascript:alert(1)', 'https://other.example/', '//cdn.example/x', '/assets/app.css', '/media/abc', '/sitemap.xml', '/sitemaps/types.xml', '/robots.txt', '/llms.txt', '/healthz', '/api/v1/x']) {
      assert.equal(n(skipped), null, skipped);
    }
  });

  test('نقشهٔ سایت: `<loc>` و مبدأ بیگانه', () => {
    const xml = `<urlset><url><loc>${ORIGIN}/a</loc></url><url><loc>${ORIGIN}</loc></url><url><loc>https://evil.example/x</loc></url><url><loc>${ORIGIN}/q?a=1&amp;b=2</loc></url></urlset>`;
    assert.deepEqual(sitemapLocations(xml, ORIGIN), ['/a', '/', '/q?a=1&b=2']);
  });
});

describe('گراف پیوند: یتیم، شکسته، ناسالم (واحد، روی سایت کوچکِ مشخص)', () => {
  /** سایت کوچک: صفحه ← HTML. `redirects`: مسیر ← مقصد. */
  const site = (pages, redirects = {}) => async (path) => {
    if (redirects[path]) return { status: 301, body: '', location: redirects[path] };
    if (!(path in pages)) return { status: 404, body: '' };
    const body = pages[path];
    return { status: typeof body === 'string' ? 200 : body.status, body: typeof body === 'string' ? body : body.body };
  };
  const page = ({ header = [], main = [], footer = [], breadcrumb = [] }) =>
    `<header class="site-header">${header.map((h) => `<a href="${h}">x</a>`).join('')}</header><main>` +
    (breadcrumb.length ? `<nav class="breadcrumb">${breadcrumb.map((h) => `<a href="${h}">x</a>`).join('')}</nav>` : '') +
    `${main.map((h) => `<a href="${h}">x</a>`).join('')}</main><footer class="site-footer">${footer.map((h) => `<a href="${h}">x</a>`).join('')}</footer>`;

  test('پیوندِ فقط-پاورقی/سرصفحه، یتیم می‌سازد؛ پیوند بدنه و مسیر راهنما نه', async () => {
    const render = site({
      '/': page({ header: ['/a', '/b'], footer: ['/c'], main: ['/d'] }),
      '/a': page({ main: ['/e'] }),
      '/b': page({}),
      '/c': page({}),
      '/d': page({}),
      '/e': page({ breadcrumb: ['/f'] }),
      '/f': page({}),
    });
    const graph = await crawlLinkGraph({ origin: ORIGIN, nodes: ['/', '/a', '/b', '/c', '/d', '/e', '/f'], render });
    // /a و /b فقط از سرصفحه، /c فقط از پاورقی؛ /d از بدنه، /e از بدنهٔ /a، /f از مسیر راهنمای /e.
    assert.deepEqual([...graph.orphans].sort(), ['/a', '/b', '/c']);
    assert.equal(graph.inbound.get('/d'), 1);
    assert.equal(graph.inbound.get('/f'), 1);
    assert.deepEqual(graph.broken, []);
    assert.equal(graph.crawled, 7);
  });

  test('پیوند به خود و پیوندهای تکراری از یک صفحه، یک بار می‌شمارند؛ ریشه یتیم نیست', async () => {
    const render = site({
      '/': page({ main: ['/a', '/a', '/a'] }),
      '/a': page({ main: ['/a', '/'] }),
    });
    const graph = await crawlLinkGraph({ origin: ORIGIN, nodes: ['/', '/a'], render });
    assert.equal(graph.inbound.get('/a'), 1);
    assert.deepEqual(graph.orphans, []);
  });

  test('پیوند شکسته: ۴۰۴ با مبدأها؛ هدایتِ سالم شکسته نیست، هدایتِ منتهی به ۴۰۴ هست', async () => {
    const render = site(
      {
        '/': page({ main: ['/gone', '/old', '/old-dead', '/search?q=x', '/ok'] }),
        '/ok': page({ main: ['/gone'] }),
        '/search': page({}),
        '/new': page({}),
      },
      { '/old': '/new', '/old-dead': '/nowhere' },
    );
    const graph = await crawlLinkGraph({ origin: ORIGIN, nodes: ['/', '/ok'], render });
    const brokenTargets = [...new Set(graph.broken.map((link) => link.to))].sort();
    assert.deepEqual(brokenTargets, ['/gone', '/old-dead']);
    assert.deepEqual(graph.broken.filter((link) => link.to === '/gone').map((link) => link.from).sort(), ['/', '/ok']);
    assert.ok(!brokenTargets.includes('/old'));
  });

  test('نشانیِ ناسالم در نقشهٔ سایت: جدا گزارش می‌شود و خزش را نمی‌شکند', async () => {
    const render = site({ '/': page({ main: ['/a'] }), '/a': { status: 500, body: '' } });
    const graph = await crawlLinkGraph({ origin: ORIGIN, nodes: ['/', '/a', '/missing'], render });
    assert.deepEqual(graph.unhealthyNodes, [{ path: '/a', status: 500 }, { path: '/missing', status: 404 }]);
  });

  test('سقف ایمنی: خزش بی‌پایان ممنوع و گزارش می‌شود', async () => {
    const render = site({ '/': page({}), '/a': page({}), '/b': page({}) });
    const graph = await crawlLinkGraph({ origin: ORIGIN, nodes: ['/', '/a', '/b'], render, maxPages: 2 });
    assert.equal(graph.truncated, true);
    assert.equal(graph.crawled, 2);
  });
});

// ---------------------------------------------------------------------------
describe('خزش روی سایت واقعی و ثبت فرصت‌های سئو (ایدمپوتنت، خودبسته‌شونده)', () => {
  const crawl = async () => {
    const mapped = await walk();
    return {
      mapped,
      graph: await crawlLinkGraph({
        origin: ORIGIN,
        nodes: mapped.urls,
        render: async (path) => {
          const result = await f.page(path);
          return { status: result.status, body: result.body, location: result.headers.location ?? null };
        },
      }),
    };
  };
  const open = (kind) => f.sudo(`select path, status, severity, entity_kind, suggested_action from seo.content_opportunity where kind = $1 and business_id is null order by path`, [kind]);

  test('سایتِ سالم: بی‌پیوند شکسته، بی‌نشانیِ ناسالم، و هیچ کسب‌وکاری یتیم نیست', async () => {
    const { mapped, graph } = await crawl();
    assert.deepEqual(mapped.failedParts, []);
    assert.deepEqual(mapped.foreign, []);
    assert.deepEqual(graph.unhealthyNodes, []);
    assert.deepEqual(graph.broken, [], `پیوند شکسته: ${JSON.stringify(graph.broken.slice(0, 3))}`);
    assert.deepEqual(graph.orphans.filter((path) => path.startsWith('/b/')), [], 'چرخش، همهٔ پروفایل‌ها را پیوند ورودی می‌دهد');
    assert.ok(graph.nodes.length > 40);
  });

  test('صفحهٔ محتوای بی‌دسته که از صفحهٔ اصلی بیرون افتاده، یتیم است (پاورقی کافی نیست)', async () => {
    for (let index = 1; index <= 6; index += 1) {
      await f.sudo(
        `insert into app.content (business_id, kind, slug, title, body,body_text,status, visibility, locale, published_at)
         values (null, 'article', $1, $2, $4::jsonb,$5, 'published', 'public', 'fa-IR', now() - ($3 || ' days')::interval)`,
        [`lonely-${index}`, `مقالهٔ ${index}`, String(index),JSON.stringify({blocks:[{kind:'paragraph',text:'محتوای مستند واقعی برای آزمون یتیم بودن '.repeat(8)}]}),'محتوای مستند واقعی برای آزمون یتیم بودن '.repeat(8)],
      );
    }
    const { graph } = await crawl();
    // صفحهٔ اصلی چهار محتوای تازه را نشان می‌دهد؛ بقیه فقط در پاورقی‌اند.
    const lonely = graph.orphans.filter((path) => path.startsWith('/lonely-'));
    assert.ok(lonely.length >= 2, `یتیم‌ها: ${graph.orphans.join(', ')}`);
    assert.ok(lonely.includes('/lonely-6'), 'قدیمی‌ترین');
  });

  test('پیوند دستیِ شکسته و هدایتِ مرده، گزارش می‌شوند؛ هدایت سالم نه', async () => {
    await f.sudo(
      `insert into seo.internal_link (source_path, target_path, anchor_text, link_kind, source, is_active) values
         ('/rules', '/gone-page', 'مرده', 'editorial', 'manual', true),
         ('/rules', '/old-rules', 'قدیمی', 'editorial', 'manual', true)`,
    );
    await f.sudo(
      `insert into seo.redirect (source_path, target_path, status_code, is_active) values ('/old-rules', '/rules', 301, true)`,
    );
    try {
      const { graph } = await crawl();
      const targets = graph.broken.map((link) => link.to);
      assert.ok(targets.includes('/gone-page'));
      assert.ok(!targets.includes('/old-rules'), 'هدایتِ سالم شکسته نیست');
      assert.deepEqual(graph.broken.find((link) => link.to === '/gone-page'), { from: '/rules', to: '/gone-page', status: 404 });
    } finally {
      await f.sudo(`delete from seo.internal_link where source_path = '/rules'`);
      await f.sudo(`delete from seo.redirect where source_path = '/old-rules'`);
    }
  });

  test('ثبت: ردیف‌های باز، ایدمپوتنت، با پیشنهاد؛ اجرای دوباره ردیف تازه نمی‌سازد', async () => {
    await f.sudo(`insert into seo.internal_link (source_path, target_path, anchor_text, link_kind, source, is_active) values ('/rules', '/gone-page', 'مرده', 'editorial', 'manual', true)`);
    try {
      const { graph } = await crawl();
      const first = await recordLinkFindings(f.engine, graph);
      assert.ok(first.orphan_page.opened >= 2);
      assert.equal(first.broken_link.opened, 1);

      const orphans = (await open('orphan_page')).filter((row) => row.path.startsWith('/lonely-'));
      assert.ok(orphans.length >= 2);
      for (const row of orphans) {
        assert.equal(row.status, 'open');
        assert.equal(row.severity, 'medium');
        assert.equal(row.entity_kind, 'content');
        assert.equal(row.suggested_action.action, 'link_from_hub');
      }
      const broken = await open('broken_link');
      assert.deepEqual(broken.map((row) => [row.path, row.severity, row.status]), [['/gone-page', 'high', 'open']]);

      const countBefore = (await f.sudo(`select count(*)::int c from seo.content_opportunity`))[0].c;
      const second = await recordLinkFindings(f.engine, graph);
      assert.equal(second.orphan_page.opened, 0);
      assert.equal(second.broken_link.opened, 0);
      assert.equal(second.orphan_page.updated, first.orphan_page.opened);
      assert.equal((await f.sudo(`select count(*)::int c from seo.content_opportunity`))[0].c, countBefore, 'ردیف تکراری');
    } finally {
      await f.sudo(`delete from seo.internal_link where source_path = '/rules'`);
    }
  });

  test('خودبستن: مشکل رفع شد ⇒ «انجام‌شده»؛ فرصتِ در دست انسان (`planned`) دست‌نخورده', async () => {
    // یک فرصت را «برنامه‌ریزی‌شده» می‌کنیم: کار آدمی است و خزش به آن دست نمی‌زند.
    await f.sudo(`update seo.content_opportunity set status = 'planned' where kind = 'orphan_page' and path = '/lonely-5'`);
    // لینک شکسته رفع شده (در این اجرا، پیوند دستی حذف شده) و یتیم‌ها هم عوض شده‌اند (محتوای قدیمی حذف).
    await f.sudo(`delete from app.content where slug in ('lonely-6', 'lonely-4')`);
    const { graph } = await crawl();
    const summary = await recordLinkFindings(f.engine, graph);
    assert.equal(summary.broken_link.closed, 1, 'پیوند شکستهٔ رفع‌شده بسته شد');
    assert.ok(summary.orphan_page.closed >= 1);

    const closed = await f.sudo(`select path, status, resolved_at from seo.content_opportunity where path in ('/lonely-6', '/lonely-4', '/gone-page') order by path`);
    for (const row of closed) {
      assert.equal(row.status, 'done', row.path);
      assert.ok(row.resolved_at, row.path);
    }
    const planned = await f.sudo(`select status from seo.content_opportunity where path = '/lonely-5'`);
    assert.deepEqual(planned, [{ status: 'planned' }]);
  });

  test('پیشنهاد برای کسب‌وکارِ یتیم: سه هم‌نوع که به آن پیوند بدهند', async () => {
    await recordLinkFindings(f.engine, { orphans: ['/b/equine-05'], broken: [], unhealthyNodes: [] });
    const [row] = await f.sudo(`select entity_kind, suggested_action from seo.content_opportunity where kind = 'orphan_page' and path = '/b/equine-05' and status = 'open'`);
    assert.equal(row.entity_kind, 'business');
    assert.equal(row.suggested_action.action, 'add_internal_link');
    assert.equal(row.suggested_action.from_paths.length, 3);
    for (const path of row.suggested_action.from_paths) {
      assert.match(path, /^\/b\/equine-/, 'هم‌نوع');
      assert.notEqual(path, '/b/equine-05');
    }
  });

  test('یکتایی در پایگاه‌داده: دو فرصتِ بازِ یک مسیر ممکن نیست؛ بسته‌شده، آزاد می‌کند', async () => {
    const insert = (status) =>
      f.sudo(`insert into seo.content_opportunity (kind, severity, title, path, status) values ('orphan_page', 'low', 't', '/uniq-check', $1)`, [status]);
    await insert('open');
    await assert.rejects(() => insert('open'), (error) => error.code === '23505');
    await assert.rejects(() => insert('planned'), (error) => error.code === '23505');
    await f.sudo(`update seo.content_opportunity set status = 'done', resolved_at = now() where path = '/uniq-check'`);
    await insert('open'); // آزاد شد
  });
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
describe('نگهبان‌های پایگاه‌داده برای سئوی فنی', () => {
  test('توابع نقشهٔ سایت برای بی‌نام اجرا می‌شوند و فقط ستون‌های بی‌خطر می‌دهند', async () => {
    const rows = await f.asRole('pv_public', `select * from seo.sitemap_businesses(3, 0)`);
    assert.equal(rows.length, 3);
    assert.deepEqual(Object.keys(rows[0]).sort(), ['last_modified', 'slug', 'verification_level']);
    const [count] = await f.asRole('pv_public', `select seo.sitemap_business_count() as n`);
    assert.ok(count.n >= 29);
  });

  test('سقف و کف تعداد در خود تابع است', async () => {
    assert.equal((await f.sudo(`select count(*)::int c from seo.sitemap_businesses(0, 0)`))[0].c, 1);
    assert.equal((await f.sudo(`select count(*)::int c from seo.sitemap_businesses(null, null)`))[0].c, 29);
    assert.equal((await f.sudo(`select count(*)::int c from seo.sitemap_businesses(10, 1000000)`))[0].c, 0);
  });

  test('`noindex_routes` فقط مسیرهای خواسته‌شده را می‌گوید، و ورودی jsonL است', async () => {
    await f.sudo(`insert into seo.metadata (entity_kind, route_key, locale, is_indexable, robots_directives) values ('listing', '/x-noindex', 'fa-IR', false, array['noindex'])`);
    try {
      const rows = await f.asRole('pv_public', `select r from seo.noindex_routes('["/x-noindex", "/other"]'::jsonb) r`);
      assert.deepEqual(rows.map((row) => row.r), ['/x-noindex']);
      assert.deepEqual(await f.asRole('pv_public', `select r from seo.noindex_routes('[]'::jsonb) r`), []);
    } finally {
      await f.sudo(`delete from seo.metadata where route_key = '/x-noindex'`);
    }
  });

  test('بی‌نام هنوز فرادادهٔ سئو را مستقیم نمی‌خواند (فقط از راه تابع‌ها)', async () => {
    await f.sudo(`insert into seo.metadata (entity_kind, route_key, locale, is_indexable) values ('listing', '/direct', 'fa-IR', false)`);
    try {
      assert.deepEqual(await f.asRole('pv_public', `select route_key from seo.metadata where route_key = '/direct'`), []);
    } finally {
      await f.sudo(`delete from seo.metadata where route_key = '/direct'`);
    }
  });

  test('تنظیم غیرسرّی سراسری برای وب خواندنی است؛ سرّی نه', async () => {
    const data = await f.asRole('pv_public', `select value from ops.setting where business_id is null and key = 'platform.robots'`);
    assert.equal(data.length, 1);
    assert.ok(Array.isArray(data[0].value.disallow));
  });
});
