/**
 * آزمون صفحه‌های کامل سایت (گام ۲۵ — §19–۲۰، §22، §25، §45–۴۷، Addendum §۳۶–۴۶).
 *
 * سه چیز اینجا سنجیده می‌شود که هیچ‌کدام با «رندر یک صفحه» دیده نمی‌شود:
 *
 *   ۱) **کل گراف نشانی‌ها**: هر ردیف تاکسونومی باید نشانی بسازد و همان نشانی به
 *      همان ردیف برگردد؛ و هر پیوند داخلیِ صفحه‌ها باید زنده باشد (خزنده).
 *   ۲) **سیاست محتوای کم‌مایه** در محیط تولید: فهرستِ خالی ۲۰۰ می‌دهد ولی نمایه
 *      نمی‌شود؛ جست‌وجوی آزاد هرگز.
 *   ۳) **جست‌وجوی واقعی**: شرط در پایگاه‌داده است، نه فیلتر روی یک صفحهٔ پاسخ.
 *
 * همه‌چیز روی پایگاه‌دادهٔ واقعی (همان مهاجرت‌ها و seedها) و سرور وب واقعی
 * اجرا می‌شود (§102: هیچ Mock).
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { createFixture, html, HOSTS } from '../scripts/lib/fixture.mjs';
import { resolveTarget } from '../apps/web/dist/router.js';
import {
  ancestorPaths,
  categoryUrl,
  industryUrl,
  locationUrl,
  parseCategorySegments,
  parseIndustrySegments,
  parseLocationSegments,
  parseTypeSegments,
  typeUrl,
} from '../apps/web/dist/taxonomy.js';

let f;
let owner;
const BULK = 25;

const cards = (doc) => (doc.match(/<article class="card card--raised">/g) ?? []).length;
const segmentsOf = (url) => url.split('/').filter(Boolean).slice(1);

before(async () => {
  f = await createFixture({ api: true });
  owner = await f.registerUser({ email: 'owner@petavu.test' });

  await f.createBusiness({
    slug: 'pet-shop-karaj',
    name: 'پت‌شاپ کرج',
    ownerUserId: owner.userId,
    typeKey: 'pet_shop',
    industryKey: 'animal_care.grooming',
    locationPath: 'iran.alborz.karaj',
    tagline: 'همه‌چیز برای حیوان خانگی',
    keywords: ['غذای سگ', 'قلاده'],
  });
  // نام با «ي» و «ك» عربی، عمداً: جست‌وجو باید با «ی» و «ک» فارسی هم پیدایش کند.
  await f.createBusiness({
    slug: 'vet-karaj',
    name: 'كلينيك دامپزشكي سینا',
    ownerUserId: owner.userId,
    typeKey: 'veterinary_clinic',
    industryKey: 'animal_health.clinic',
    locationPath: 'iran.alborz.karaj',
  });
  // «اردبیل» هم نام استان است و هم نام شهر؛ دو صفحهٔ جدا.
  await f.createBusiness({
    slug: 'vet-ardabil',
    name: 'کلینیک اردبیل',
    ownerUserId: owner.userId,
    typeKey: 'veterinary_clinic',
    industryKey: 'animal_health.clinic',
    locationPath: 'iran.ardabil.ardabil',
  });
  // این‌ها هرگز نباید در هیچ صفحه‌ای دیده شوند.
  await f.createBusiness({ slug: 'draft-biz', name: 'پیش‌نویس مخفی', ownerUserId: owner.userId, status: 'draft', visibility: 'private', locationPath: 'iran.alborz.karaj' });
  await f.createBusiness({ slug: 'private-biz', name: 'خصوصی مخفی', ownerUserId: owner.userId, status: 'active', visibility: 'private', locationPath: 'iran.alborz.karaj' });

  for (let index = 1; index <= BULK; index += 1) {
    const n = String(index).padStart(2, '0');
    await f.createBusiness({ slug: `equine-${n}`, name: `باشگاه سوارکاری ${n}`, ownerUserId: owner.userId, typeKey: 'equine_center' });
  }

  const publicBusiness = (await f.sudo(`select id from app.business where slug = 'vet-karaj'`))[0].id;
  const hiddenBusiness = (await f.sudo(`select id from app.business where slug = 'draft-biz'`))[0].id;
  await f.createContent({ slug: 'dog-vaccination', title: 'واکسیناسیون سگ', summary: 'برنامهٔ واکسن', categoryPaths: ['health.vaccination'] });
  await f.createContent({ businessId: publicBusiness, slug: 'clinic-vaccines', title: 'واکسن در کلینیک سینا', categoryPaths: ['health.vaccination'] });
  await f.createContent({ businessId: hiddenBusiness, slug: 'hidden-vaccines', title: 'محتوای کسب‌وکار مخفی', categoryPaths: ['health.vaccination'] });
});

after(async () => {
  await f?.close();
});

// ---------------------------------------------------------------------------
describe('مسیریابی تاکسونومی: سخت‌گیر و بدون ابهام (§8)', () => {
  test('هر خانواده، مرکز و صفحهٔ فرودش را می‌شناسد', () => {
    assert.deepEqual(resolveTarget('/t', 'public'), { type: 'taxonomy_index', family: 'type' });
    assert.deepEqual(resolveTarget('/i', 'public'), { type: 'taxonomy_index', family: 'industry' });
    assert.deepEqual(resolveTarget('/l', 'public'), { type: 'taxonomy_index', family: 'location' });
    assert.deepEqual(resolveTarget('/k', 'public'), { type: 'taxonomy_index', family: 'category' });
    assert.deepEqual(resolveTarget('/t/veterinary-clinic', 'public'), { type: 'business_type', key: 'veterinary_clinic' });
    assert.deepEqual(resolveTarget('/i/animal-care/grooming', 'public'), { type: 'industry', path: 'animal_care.grooming' });
    assert.deepEqual(resolveTarget('/l/alborz/karaj', 'public'), { type: 'location', suffix: 'alborz.karaj' });
    assert.deepEqual(resolveTarget('/k/behavior/puppy-training', 'public'), { type: 'category', path: 'behavior.puppy_training' });
    assert.deepEqual(resolveTarget('/search', 'public'), { type: 'search' });
  });

  test('نشانی بدشکل، هرگز به پایگاه‌داده نمی‌رسد (فقط یک شکل کانونیک)', () => {
    for (const bad of [
      '/t/Veterinary-Clinic', // حرف بزرگ
      '/t/veterinary_clinic', // زیرخط
      '/t/veterinary--clinic', // دو خط‌تیره
      '/t/-clinic',
      '/t/a/b', // عمق بیش از حد برای نوع
      '/i/animal-care/grooming/x/y', // عمق
      '/i/animal_care',
      '/l/alborz/karaj/x', // سه سطح زیر ریشه
      '/l/Alborz',
      '/k/health/vaccination/x/y',
      '/t/veterinary-clinic.html',
    ]) {
      assert.equal(resolveTarget(bad, 'public').type, 'not_found', bad);
    }
  });

  test('نامک‌های `search` و حرف‌های تاکسونومی را محتوا نمی‌پوشاند', () => {
    assert.equal(resolveTarget('/search', 'public').type, 'search');
    assert.equal(resolveTarget('/t', 'public').type, 'taxonomy_index');
    assert.equal(resolveTarget('/rules', 'public').type, 'content');
  });

  test('روی میزبان‌های مدیریتی، این مسیرها وجود ندارند', () => {
    for (const kind of ['panel', 'admin', 'shop', 'admin_shop']) {
      assert.notEqual(resolveTarget('/t/pet-shop', kind).type, 'business_type', kind);
      assert.notEqual(resolveTarget('/search', kind).type, 'search', kind);
    }
  });

  test('رفت‌وبرگشت: هر ردیف تاکسونومیِ seed نشانی دارد و همان نشانی به همان ردیف برمی‌گردد', async () => {
    const types = await f.sudo('select key from ref.business_type where is_active');
    for (const { key } of types) {
      const url = typeUrl(key);
      assert.ok(url, `نوع ${key} نشانی ندارد`);
      assert.equal(parseTypeSegments(segmentsOf(url)), key);
    }

    const industries = await f.sudo('select path from ref.industry where is_active');
    for (const { path } of industries) {
      const url = industryUrl(path);
      assert.ok(url, `صنف ${path} نشانی ندارد`);
      assert.equal(parseIndustrySegments(segmentsOf(url)), path);
    }

    const locations = await f.sudo(`select path from ref.location where is_active and kind in ('province', 'city')`);
    assert.ok(locations.length >= 90);
    for (const { path } of locations) {
      const url = locationUrl(path);
      assert.ok(url && url !== '/l', `مکان ${path} نشانی ندارد`);
      // ریشهٔ کشور از نشانی حذف شده و با پسوند، دوباره ساخته می‌شود.
      assert.equal(`iran.${parseLocationSegments(segmentsOf(url))}`, path);
    }

    const categories = await f.sudo(`select path from ref.category where is_active and scope = 'content' and business_id is null`);
    for (const { path } of categories) {
      const url = categoryUrl(path);
      assert.ok(url, `دسته ${path} نشانی ندارد`);
      assert.equal(parseCategorySegments(segmentsOf(url)), path);
    }
  });

  test('مسیر والدها از خود مسیر می‌آید', () => {
    assert.deepEqual(ancestorPaths('a.b.c'), ['a', 'a.b']);
    assert.deepEqual(ancestorPaths('a'), []);
  });
});

// ---------------------------------------------------------------------------
describe('صفحهٔ نوع کسب‌وکار (§19)', () => {
  test('فهرست نوع، فقط کسب‌وکارهای عمومی همان نوع را نشان می‌دهد', async () => {
    const response = await f.page('/t/veterinary-clinic');
    assert.equal(response.status, 200);
    assert.deepEqual(html.h1s(response.body), ['کلینیک‌های دامپزشکی']);
    assert.match(response.body, /كلينيك دامپزشكي سینا|کلینیک دامپزشکی سینا/);
    assert.match(response.body, /کلینیک اردبیل/);
    assert.doesNotMatch(response.body, /پت‌شاپ کرج/);
    assert.doesNotMatch(response.body, /مخفی/);
    assert.equal(cards(response.body), 2);
  });

  test('نام فارسی نوع دیده می‌شود، نه کلید خام', async () => {
    const response = await f.page('/t/pet-shop');
    assert.doesNotMatch(response.body, /pet_shop/);
    assert.match(response.body, /badge">پت‌شاپ</);
  });

  test('شهرهای واقعی با شمار، پیوند داخلی می‌سازند', async () => {
    const response = await f.page('/t/veterinary-clinic');
    const hrefs = html.hrefs(response.body);
    assert.ok(hrefs.includes('/l/alborz/karaj'));
    assert.ok(hrefs.includes('/l/ardabil/ardabil'));
    assert.match(response.body, /chip__count">۱</);
  });

  test('مسیر راهنما، عنوان و دادهٔ ساخت‌یافته از همین داده می‌آید', async () => {
    const response = await f.page('/t/veterinary-clinic');
    const graph = html.jsonLd(response.body).flatMap((block) => block['@graph'] ?? [block]);
    const types = graph.map((node) => node['@type']);
    assert.ok(types.includes('BreadcrumbList'));
    const list = graph.find((node) => node['@type'] === 'ItemList');
    assert.ok(list, 'ItemList باید باشد');
    assert.equal(list.itemListElement.length, 2);
    assert.equal(html.title(response.body), 'کلینیک‌های دامپزشکی در ایران | پتاوو');
  });

  test('نوعِ بی‌کسب‌وکار ۲۰۰ با حالت خالی صادقانه می‌دهد', async () => {
    const response = await f.page('/t/mobile-vet');
    assert.equal(response.status, 200);
    assert.match(response.body, /هنوز .* پروفایل عمومی منتشر نکرده‌اند/);
    assert.equal(cards(response.body), 0);
  });

  test('نوع ناموجود: ۴۰۴ یکنواخت، با جست‌وجو و راه‌های کاوش', async () => {
    const response = await f.page('/t/no-such-type');
    assert.equal(response.status, 404);
    assert.match(response.body, /role="search"/);
    for (const hub of ['/t', '/i', '/l']) assert.ok(html.hrefs(response.body).includes(hub), hub);
  });

  test('مرکز انواع: نوع‌های دارای کسب‌وکار، جلوتر از بقیه‌اند', async () => {
    const response = await f.page('/t');
    assert.equal(response.status, 200);
    const populated = response.body.indexOf('href="/t/pet-shop"');
    const empty = response.body.indexOf('href="/t/mobile-vet"');
    assert.ok(populated > 0 && empty > 0 && populated < empty);
    assert.match(response.body, /هنوز کسب‌وکاری ثبت نشده/);
  });
});

// ---------------------------------------------------------------------------
describe('صفحهٔ صنف: شمارش و فهرست، کل زیردرخت (§20)', () => {
  test('صنف والد، کسب‌وکارهای زیرصنف‌ها را هم دارد', async () => {
    const parent = await f.page('/i/animal-care');
    assert.match(parent.body, /پت‌شاپ کرج/);
    const child = await f.page('/i/animal-care/grooming');
    assert.match(child.body, /پت‌شاپ کرج/);
    // صنف همتا، آن را ندارد.
    const other = await f.page('/i/animal-health');
    assert.doesNotMatch(other.body, /پت‌شاپ کرج/);
    assert.match(other.body, /کلینیک اردبیل/);
  });

  test('تراشهٔ زیرصنف با شمار و پیوند سلسله‌مراتبی', async () => {
    const response = await f.page('/i/animal-care');
    assert.ok(html.hrefs(response.body).includes('/i/animal-care/grooming'));
  });

  test('زیرخطِ مسیر، جوکر نیست: «animal_care.%» به «animalXcare.…» نمی‌خورد', async () => {
    // LIKE با `_` به هر نویسه‌ای می‌خورد. این صنف ساختگی، همان دام را می‌پرورد.
    await f.sudo(`insert into ref.industry (key, name_fa, parent_key, path, depth, is_active, sort_order)
                  values ('animalxcare', 'صنف دام', null, 'animalxcare', 0, true, 99),
                         ('animalxcare.sub', 'زیرصنف دام', 'animalxcare', 'animalxcare.sub', 1, true, 1)`);
    await f.createBusiness({ slug: 'wildcard-trap', name: 'دام‌دار تله', ownerUserId: owner.userId, typeKey: 'livestock_farm', industryKey: 'animalxcare.sub' });

    const response = await f.page('/i/animal-care');
    assert.doesNotMatch(response.body, /دام‌دار تله/);
    const trap = await f.page('/i/animalxcare');
    assert.match(trap.body, /دام‌دار تله/);
  });

  test('مرکز صنف‌ها: ریشه‌ها با زیرشاخه‌هایشان در یک پرس‌وجو', async () => {
    const response = await f.page('/i');
    assert.equal(response.status, 200);
    assert.ok(html.hrefs(response.body).includes('/i/animal-care'));
    assert.ok(html.hrefs(response.body).includes('/i/animal-care/grooming'));
  });

  test('صنف ناموجود ۴۰۴ است', async () => {
    assert.equal((await f.page('/i/nothing-here')).status, 404);
  });
});

// ---------------------------------------------------------------------------
describe('صفحهٔ مکان (§20)', () => {
  test('استان، شهرهایش و کسب‌وکارهای کل زیردرخت را نشان می‌دهد', async () => {
    const province = await f.page('/l/alborz');
    assert.equal(province.status, 200);
    assert.deepEqual(html.h1s(province.body), ['کسب‌وکارها در البرز']);
    assert.match(province.body, /پت‌شاپ کرج/);
    assert.ok(html.hrefs(province.body).includes('/l/alborz/karaj'));
    assert.doesNotMatch(province.body, /کلینیک اردبیل/);
  });

  test('شهر، فقط کسب‌وکارهای خودش را دارد و نوع‌ها را پیشنهاد می‌دهد', async () => {
    const city = await f.page('/l/alborz/karaj');
    assert.equal(city.status, 200);
    assert.match(city.body, /پت‌شاپ کرج/);
    assert.doesNotMatch(city.body, /مخفی/);
    assert.ok(html.hrefs(city.body).includes('/t/veterinary-clinic'));
    assert.ok(html.hrefs(city.body).includes('/t/pet-shop'));
  });

  test('«اردبیل» استان و «اردبیل» شهر دو صفحهٔ جدایند', async () => {
    const province = await f.page('/l/ardabil');
    const city = await f.page('/l/ardabil/ardabil');
    assert.equal(province.status, 200);
    assert.equal(city.status, 200);
    assert.notEqual(html.canonical(province.body), html.canonical(city.body));
  });

  test('مرکز مکان‌ها: استان‌ها با شهرها و شمار', async () => {
    const response = await f.page('/l');
    assert.equal(response.status, 200);
    assert.ok(html.hrefs(response.body).includes('/l/alborz'));
    assert.ok(html.hrefs(response.body).includes('/l/alborz/karaj'));
  });

  test('مکان ناموجود، یا با سطح اشتباه: ۴۰۴', async () => {
    assert.equal((await f.page('/l/nowhere')).status, 404);
    assert.equal((await f.page('/l/karaj/alborz')).status, 404);
  });
});

// ---------------------------------------------------------------------------
describe('صفحهٔ دستهٔ محتوا (§23)', () => {
  test('محتوای منتشرشدهٔ عمومی دیده می‌شود، محتوای کسب‌وکار مخفی نه', async () => {
    const response = await f.page('/k/health/vaccination');
    assert.equal(response.status, 200);
    assert.match(response.body, /واکسیناسیون سگ/);
    assert.match(response.body, /واکسن در کلینیک سینا/);
    assert.doesNotMatch(response.body, /کسب‌وکار مخفی/);
  });

  test('محتوای کسب‌وکار به پروفایل همان کسب‌وکار می‌رود، محتوای پلتفرم به نشانی خودش', async () => {
    const hrefs = html.hrefs((await f.page('/k/health/vaccination')).body);
    assert.ok(hrefs.includes('/dog-vaccination'));
    assert.ok(hrefs.includes('/b/vet-karaj'));
  });

  test('دستهٔ والد، کل زیردرخت را می‌شمارد و زیردسته‌ها را پیشنهاد می‌دهد', async () => {
    const response = await f.page('/k/health');
    assert.match(response.body, /واکسیناسیون سگ/);
    assert.ok(html.hrefs(response.body).includes('/k/health/vaccination'));
  });

  test('محتوای منتشرنشده شمرده نمی‌شود (شمارنده، ادعاست — §186)', async () => {
    await f.sudo(
      `insert into app.content (business_id, kind, slug, title, body, status, visibility, locale)
       values (null, 'article', 'draft-article', 'پیش‌نویس مقاله', '{"blocks":[]}'::jsonb, 'draft', 'public', 'fa-IR')`,
    );
    await f.sudo(
      `insert into app.content_category (content_id, category_id)
       select c.id, k.id from app.content c, ref.category k where c.slug = 'draft-article' and k.path = 'health.surgery'`,
    );
    const response = await f.page('/k/health/surgery');
    assert.equal(response.status, 200);
    assert.doesNotMatch(response.body, /پیش‌نویس مقاله/);
    assert.match(response.body, /هنوز محتوایی در این دسته منتشر نشده است/);
  });

  test('دستهٔ ناموجود ۴۰۴ است و مرکز، دسته‌ها را نشان می‌دهد', async () => {
    assert.equal((await f.page('/k/nothing')).status, 404);
    const hub = await f.page('/k');
    assert.equal(hub.status, 200);
    assert.ok(html.hrefs(hub.body).includes('/k/health'));
  });
});

// ---------------------------------------------------------------------------
describe('صفحه‌بندی نشانگری روی صفحه‌های فرود (§67)', () => {
  test('صفحهٔ اول ۲۴ کارت و پیوند بعدی؛ صفحهٔ دوم، بقیه', async () => {
    const first = await f.page('/t/equine-center');
    assert.equal(cards(first.body), 24);
    // پیوند بدنه (نسبی)؛ `<link rel="next">` سر صفحه مطلق است و جداگانه آزموده می‌شود.
    const next = /<a class="button button--ghost" rel="next" href="([^"]+)"/.exec(first.body)?.[1];
    assert.ok(next, 'پیوند صفحهٔ بعد باید باشد');
    assert.match(first.body, /<link rel="next" href="http:\/\/localhost:3000\/t\/equine-center\?cursor=/);
    assert.match(next, /^\/t\/equine-center\?cursor=/);

    const second = await f.page(next.replaceAll('&amp;', '&'));
    assert.equal(second.status, 200);
    assert.equal(cards(second.body), BULK - 24);
    assert.match(second.body, /باشگاه سوارکاری 25/);
    // موردی دوبار یا از قلم نیفتاد.
    const firstNames = [...first.body.matchAll(/باشگاه سوارکاری (\d\d)/g)].map((match) => match[1]);
    const secondNames = [...second.body.matchAll(/باشگاه سوارکاری (\d\d)/g)].map((match) => match[1]);
    assert.equal(new Set([...firstNames, ...secondNames]).size, BULK);
  });

  test('هدایت قدیمی: `?type=` به صفحهٔ نوع و `?q=` به جست‌وجو (۳۰۸)', async () => {
    const byType = await f.page('/businesses?type=pet_shop');
    assert.equal(byType.status, 308);
    assert.equal(byType.get('location'), '/t/pet-shop');

    const bySearch = await f.page(`/businesses?q=${encodeURIComponent('کلینیک')}`);
    assert.equal(bySearch.status, 308);
    assert.equal(bySearch.get('location'), `/search?q=${encodeURIComponent('کلینیک')}`);

    // کلید نامعتبر، هدایت نمی‌شود و فهرست عادی می‌آید (بی‌خطا).
    assert.equal((await f.page('/businesses?type=Bad_Key')).status, 200);
  });

  test('عنوان فهرست، تهی نیست (قالب `listing.default` اصلاح شد)', async () => {
    for (const path of ['/businesses', '/t', '/i', '/l', '/k']) {
      const title = html.title((await f.page(path)).body) ?? '';
      assert.ok(title.length > 10 && !title.startsWith('|') && !/PETAVU/.test(title), `${path}: «${title}»`);
    }
  });
});

// ---------------------------------------------------------------------------
describe('جست‌وجو (§57–۶۳)', () => {
  const search = (q) => f.page(`/search?q=${encodeURIComponent(q)}`);
  const slugsOf = (doc) => [...new Set(html.hrefs(doc).filter((href) => href.startsWith('/b/')).map((href) => href.slice(3)))];

  test('«ي/ك» عربی و «ی/ک» فارسی یکی‌اند — در هر دو جهت', async () => {
    assert.deepEqual(slugsOf((await search('کلینیک سینا')).body), ['vet-karaj']);
    assert.deepEqual(slugsOf((await search('كلينيك سينا')).body), ['vet-karaj']);
  });

  test('نیم‌فاصله، فاصله و چسبیده یکی‌اند', async () => {
    for (const q of ['پت‌شاپ', 'پت شاپ', 'پتشاپ']) {
      assert.deepEqual(slugsOf((await search(q)).body), ['pet-shop-karaj'], q);
    }
  });

  test('ارقام فارسی و لاتین یکی‌اند', async () => {
    assert.deepEqual(slugsOf((await search('سوارکاری ۲۵')).body), ['equine-25']);
    assert.deepEqual(slugsOf((await search('سوارکاری 25')).body), ['equine-25']);
  });

  test('همهٔ واژه‌ها باید بیایند (AND)', async () => {
    assert.deepEqual(slugsOf((await search('کلینیک اردبیل')).body), ['vet-ardabil']);
    assert.deepEqual(slugsOf((await search('کلینیک سینا اردبیل')).body), []);
  });

  test('شهر، نوع و کلیدواژهٔ پروفایل هم جست‌وجو می‌شوند', async () => {
    assert.deepEqual(slugsOf((await search('کرج')).body).sort(), ['pet-shop-karaj', 'vet-karaj']);
    assert.deepEqual(slugsOf((await search('قلاده')).body), ['pet-shop-karaj']);
  });

  test('نام دقیق، بالاتر از «شامل نام» می‌نشیند — حتی اگر الفبایی بعدتر بیاید', async () => {
    await f.createBusiness({ slug: 'exact-sina', name: 'سینا', ownerUserId: owner.userId, typeKey: 'grooming_salon' });
    // «کلینیک دامپزشکی سینا» نام را «شامل» است؛ «سینا» دقیقاً همان است. الفبایی، «سینا» دیرتر می‌آید.
    assert.deepEqual(slugsOf((await search('سینا')).body), ['exact-sina', 'vet-karaj']);
    // شروع نام (۶۰) بر شامل (۴۰) مقدم است.
    const scores = await f.sudo(`select slug, score from app.search_businesses('کلینیک', 10) order by score desc, name asc`);
    assert.deepEqual(scores.map((row) => row.score), [60, 60]);
  });

  test('پیش‌نویس و خصوصی، هرگز دیده نمی‌شوند', async () => {
    for (const q of ['مخفی', 'پیش‌نویس', 'خصوصی']) {
      assert.deepEqual(slugsOf((await search(q)).body), [], q);
    }
  });

  test('رگرسیون: کسب‌وکاری که در صفحهٔ دوم فهرست است هم پیدا می‌شود', async () => {
    // نسخهٔ نخست API، یک صفحه را می‌خواند و بعد فیلتر می‌کرد؛ این مورد هرگز پیدا نمی‌شد.
    const directory = await f.page('/businesses');
    assert.doesNotMatch(directory.body, /باشگاه سوارکاری 25/);
    assert.deepEqual(slugsOf((await search('باشگاه سوارکاری 25')).body), ['equine-25']);

    const api = await fetch(`${f.api.url}/api/v1/search?q=${encodeURIComponent('باشگاه سوارکاری 25')}`);
    const body = await api.json();
    assert.equal(api.status, 200);
    assert.deepEqual(body.results.map((hit) => hit.slug), ['equine-25']);
  });

  test('سقف ۲۴ نتیجه با راهنمای دقیق‌ترکردن', async () => {
    const response = await search('باشگاه');
    assert.equal(slugsOf(response.body).length, 24);
    assert.match(response.body, /بهترین نتیجه‌ها نشان داده شد/);
  });

  test('بی‌نتیجه بن‌بست نیست: پیشنهاد از داده می‌آید', async () => {
    const response = await search('زززززز');
    assert.equal(response.status, 200);
    assert.match(response.body, /نتیجه‌ای پیدا نشد/);
    assert.ok(html.hrefs(response.body).includes('/t/pet-shop'));
    assert.ok(html.hrefs(response.body).includes('/l/alborz/karaj'));
  });

  test('عبارت کوتاه، جست‌وجو نیست (بی‌خطا)', async () => {
    const response = await search('ا');
    assert.equal(response.status, 200);
    assert.match(response.body, /دست‌کم دو نویسه/);
    assert.equal(slugsOf(response.body).length, 0);
  });

  test('ورودی، escape می‌شود (عنوان، ویژگی و بدنه)', async () => {
    const payload = '"><script>alert(1)</script>';
    const response = await search(payload);
    assert.equal(response.status, 200);
    assert.doesNotMatch(response.body, /<script>alert\(1\)/);
    assert.match(html.title(response.body) ?? '', /&lt;script&gt;/);
    assert.match(response.body, /value="&quot;&gt;&lt;script&gt;/);
  });

  test('عبارت بلند، به ۸۰ نویسه بریده می‌شود', async () => {
    const response = await search('الف'.repeat(300));
    const value = /name="q" type="search" value="([^"]*)"/.exec(response.body)?.[1] ?? '';
    assert.equal(value.length, 80);
  });

  test('فرم، دسترس‌پذیر و بی‌JavaScript است', async () => {
    const response = await f.page('/search');
    assert.match(response.body, /<form class="search-form" role="search" method="get" action="\/search">/);
    assert.match(response.body, /<label class="field__label" for="q">/);
    assert.match(response.body, /<input class="input" id="q" name="q" type="search"/);
    assert.doesNotMatch(response.body, /<script(?! type="application\/ld\+json")/);
  });

  test('جست‌وجو همیشه `noindex` است، حتی بدون عبارت', async () => {
    for (const path of ['/search', '/search?q=کلینیک']) {
      const robots = html.meta((await f.page(path)).body, 'robots') ?? '';
      assert.match(robots, /noindex/, path);
    }
  });
});

// ---------------------------------------------------------------------------
describe('سیاست محتوای کم‌مایه در تولید (Addendum §۴۴، §۴۶)', () => {
  let prod;
  before(async () => {
    prod = await f.production();
  });
  after(async () => {
    await prod?.restore();
  });

  const robots = async (path) => html.meta((await prod.page(path)).body, 'robots') ?? '';

  test('صفحهٔ دارای کسب‌وکار، نمایه‌شدنی است و کانونیکال مطلق دارد', async () => {
    const response = await prod.page('/t/veterinary-clinic');
    assert.equal(response.status, 200);
    assert.doesNotMatch(await robots('/t/veterinary-clinic'), /noindex/);
    assert.equal(html.canonical(response.body), `${prod.origin}/t/veterinary-clinic`);
  });

  test('صفحهٔ بی‌کسب‌وکار ۲۰۰ است ولی `noindex`', async () => {
    assert.equal((await prod.page('/t/mobile-vet')).status, 200);
    assert.match(await robots('/t/mobile-vet'), /noindex/);
    // مکانِ بی‌کسب‌وکار هم همین.
    assert.match(await robots('/l/bushehr/bushehr'), /noindex/);
  });

  test('مکان و صنفِ دارای کسب‌وکار، نمایه‌شدنی‌اند', async () => {
    assert.doesNotMatch(await robots('/l/alborz/karaj'), /noindex/);
    assert.doesNotMatch(await robots('/i/animal-care'), /noindex/);
  });

  test('دسته: با محتوا نمایه‌شدنی، بی‌محتوا نه', async () => {
    assert.doesNotMatch(await robots('/k/health/vaccination'), /noindex/);
    assert.match(await robots('/k/business-guides'), /noindex/);
  });

  test('صفحهٔ دوم فهرست: `noindex, follow` با کانونیکال خودارجاع', async () => {
    const first = await prod.page('/t/equine-center');
    const next = /<a class="button button--ghost" rel="next" href="([^"]+)"/.exec(first.body)?.[1]?.replaceAll('&amp;', '&');
    assert.ok(next);
    const second = await prod.page(next);
    const directive = html.meta(second.body, 'robots') ?? '';
    assert.match(directive, /noindex/);
    assert.match(directive, /follow/);
    assert.match(html.canonical(second.body) ?? '', /\/t\/equine-center\?cursor=/);
    // صفحهٔ اول، بدون نشانگر.
    assert.equal(html.canonical(first.body), `${prod.origin}/t/equine-center`);
  });

  test('مرکزها نمایه‌شدنی‌اند؛ جست‌وجو و ۴۰۴ هرگز', async () => {
    for (const path of ['/t', '/i', '/l', '/k', '/businesses']) {
      assert.doesNotMatch(await robots(path), /noindex/, path);
    }
    assert.match(await robots('/search?q=کلینیک'), /noindex/);
    assert.match(await robots('/search'), /noindex/);
    assert.match(await robots('/t/no-such-type'), /noindex/);
  });

  test('عنوان و توضیح از قالب‌های داده‌محور (`seo.template`) می‌آیند', async () => {
    const city = await prod.page('/l/alborz/karaj');
    assert.equal(html.title(city.body), 'کسب‌وکارهای صنف حیوانات در کرج | پتاوو');
    const industry = await prod.page('/i/animal-care/grooming');
    assert.match(html.title(industry.body) ?? '', /^آرایش و شست‌وشو \| کسب‌وکارهای صنف \| پتاوو$/);
  });
});

// ---------------------------------------------------------------------------
describe('ناوبری، پاورقی و ۴۰۴ (§182: فقط مسیرهایی که هستند)', () => {
  test('سرصفحه پیوند مرده ندارد (`/about` و `/contact` در نصب تازه وجود ندارند)', async () => {
    const response = await f.page('/');
    const hrefs = html.hrefs(response.body);
    for (const href of ['/', '/businesses', '/t', '/i', '/l', '/search']) assert.ok(hrefs.includes(href), href);
    assert.ok(!hrefs.includes('/about'));
    assert.ok(!hrefs.includes('/contact'));
  });

  test('پاورقی: مسیرهای کاوش و صفحهٔ قوانین (چون واقعاً منتشر شده)', async () => {
    const hrefs = html.hrefs((await f.page('/')).body);
    for (const href of ['/k', '/rules', '/sitemap.xml', '/robots.txt', '/llms.txt']) assert.ok(hrefs.includes(href), href);
  });

  test('هر پیوند داخلیِ صفحه‌های اصلی زنده است (خزندهٔ پیوند مرده)', async () => {
    const seeds = ['/', '/t', '/i', '/l', '/k', '/businesses', '/rules', '/search', '/t/pet-shop', '/l/alborz', '/i/animal-care'];
    const queue = new Set();
    for (const seed of seeds) {
      for (const href of html.hrefs((await f.page(seed)).body)) {
        if (href.startsWith('/') && !href.startsWith('//') && !href.startsWith('/media/')) queue.add(href.split('#')[0]);
      }
    }
    assert.ok(queue.size > 150, `خزنده باید گسترده باشد؛ ${queue.size} پیوند`);

    const dead = [];
    for (const href of queue) {
      const result = await f.page(href);
      // دارایی‌ها و نقشه‌ها با `fetch` واقعی هم سرو می‌شوند؛ اینجا رندر کافی است.
      if (result.status >= 400) dead.push(`${href} → ${result.status}`);
    }
    assert.deepEqual(dead, [], `پیوند مرده: ${dead.slice(0, 10).join('؛ ')}`);
  });

  test('۴۰۴: جست‌وجو، راه‌های کاوش، noindex و بی‌کش', async () => {
    const response = await f.page('/this/is/nothing');
    assert.equal(response.status, 404);
    assert.match(response.body, /role="search"/);
    assert.match(html.meta(response.body, 'robots') ?? '', /noindex/);
    assert.equal(response.get('cache-control'), 'no-store');
    assert.match(response.body, /شناسهٔ درخواست/);
  });
});

// ---------------------------------------------------------------------------
describe('صفحهٔ اصلی اسکرولی/سینماتیک (§25، §45–۴۷)', () => {
  test('ساختار: یک h1، صحنه‌هایی با عنوان خودشان، شناسه‌های یکتا', async () => {
    const response = await f.page('/');
    assert.equal(response.status, 200);
    assert.equal(html.h1s(response.body).length, 1);

    const ids = html.ids(response.body);
    assert.equal(new Set(ids).size, ids.length, 'شناسهٔ تکراری');
    const labelled = [...response.body.matchAll(/aria-labelledby="([^"]+)"/g)].map((match) => match[1]);
    assert.ok(labelled.length >= 6);
    for (const id of labelled) assert.ok(ids.includes(id), `aria-labelledby به شناسهٔ ناموجود: ${id}`);
  });

  test('صحنه‌ها از داده می‌آیند: نوع، صنف، شهر و کسب‌وکار', async () => {
    const response = await f.page('/');
    for (const id of ['stats', 'types', 'industries', 'cities', 'businesses', 'start']) {
      assert.ok(html.ids(response.body).includes(id), `صحنهٔ ${id}`);
    }
    const hrefs = html.hrefs(response.body);
    assert.ok(hrefs.includes('/t/pet-shop'));
    assert.ok(hrefs.includes('/l/alborz/karaj'));
    assert.ok(hrefs.includes('/i/animal-care'));
    assert.ok(hrefs.includes('/b/pet-shop-karaj'));
    assert.match(response.body, /<div class="scroll-progress" aria-hidden="true">/);
  });

  test('نوعِ بی‌کسب‌وکار در صفحهٔ اصلی نیست (ردیف خالی، ادعای بی‌پشتوانه است)', async () => {
    const response = await f.page('/');
    assert.ok(!html.hrefs(response.body).includes('/t/mobile-vet'));
  });

  test('پلتفرم خالی: صحنه‌های داده‌محور حذف می‌شوند و صفحه صادقانه می‌ماند', async () => {
    const empty = await createFixture();
    try {
      const response = await empty.page('/');
      assert.equal(response.status, 200);
      for (const id of ['types', 'industries', 'cities']) assert.ok(!html.ids(response.body).includes(id), `صحنهٔ ${id} نباید باشد`);
      assert.match(response.body, /هنوز کسب‌وکاری پروفایل عمومی منتشر نکرده است/);
      assert.equal(html.h1s(response.body).length, 1);
    } finally {
      await empty.close();
    }
  });

  test('عددهای صفحه از پایگاه‌داده است', async () => {
    const response = await f.page('/');
    const values = [...response.body.matchAll(/<data class="metric__value" value="(\d+)"/g)].map((match) => Number(match[1]));
    const [expected] = await f.sudo(
      `select count(*)::int c from app.business where status = 'active' and visibility = 'public' and deleted_at is null`,
    );
    assert.ok(expected.c >= 3 + BULK, 'سه نام‌دار و ۲۵ باشگاه، دست‌کم');
    assert.equal(values[0], expected.c);
  });

  test('هیچ استایل یا اسکریپت درون‌خطی نیست (CSP سخت)', async () => {
    for (const path of ['/', '/t', '/search', '/t/pet-shop']) {
      const { body } = await f.page(path);
      assert.doesNotMatch(body, /\sstyle="/, `${path}: style درون‌خطی`);
      assert.doesNotMatch(body, /<style/, `${path}: <style>`);
      assert.doesNotMatch(body, /<script(?! type="application\/ld\+json")/, `${path}: اسکریپت درون‌خطی`);
      assert.doesNotMatch(body, /\son[a-z]+="/, `${path}: رویداد درون‌خطی`);
    }
  });
});

// ---------------------------------------------------------------------------
describe('CSS پیمایش سینماتیک (§47، Addendum §۱۷)', () => {
  /** محتوای بلوک `@supports …` با شمارش آکولاد. */
  const block = (css, header) => {
    const start = css.indexOf(header);
    assert.ok(start >= 0, `بلوک ${header} نیست`);
    let depth = 0;
    for (let index = css.indexOf('{', start); index < css.length; index += 1) {
      if (css[index] === '{') depth += 1;
      if (css[index] === '}') {
        depth -= 1;
        if (depth === 0) return css.slice(start, index + 1);
      }
    }
    throw new Error('آکولاد نامتوازن');
  };

  test('پویانمایی اسکرول فقط با پشتیبانی مرورگر و بدون درخواست کاهش حرکت', async () => {
    const css = await f.web.stylesheet();
    const supports = block(css, '@supports (animation-timeline: view())');
    assert.match(supports, /@media screen and \(prefers-reduced-motion: no-preference\)/);
    // هر قاعدهٔ `.rv` و `animation-timeline` فقط داخل همان بلوک است.
    const outside = css.replace(supports, '');
    assert.doesNotMatch(outside, /animation-timeline/);
    assert.doesNotMatch(outside, /\.rv\s*\{/);
  });

  test('پویانمایی‌ها فقط transform و opacity را تغییر می‌دهند', async () => {
    const css = await f.web.stylesheet();
    for (const name of ['progress-grow', 'scene-in', 'hero-drift', 'cue-bob']) {
      const keyframes = block(css, `@keyframes ${name}`);
      const properties = [...keyframes.matchAll(/([a-z-]+)\s*:/g)].map((match) => match[1]).filter((property) => property !== 'from' && property !== 'to');
      for (const property of properties) assert.ok(['transform', 'opacity'].includes(property), `${name}: ${property}`);
    }
  });

  test('هدف لمس ۴۴ پیکسل برای تراشه و پیکان قهرمان', async () => {
    const css = await f.web.stylesheet();
    assert.match(block(css, '.chip {'), /min-block-size:\s*var\(--size-touch-target,\s*44px\)/);
    assert.match(block(css, '.hero__cue {'), /inline-size:\s*var\(--size-touch-target,\s*44px\)/);
  });

  test('متن قهرمان در تم تاریک هم روشن می‌ماند (neutral.0، نه text.inverse)', async () => {
    const css = await f.web.stylesheet();
    assert.match(block(css, '.hero {'), /color:\s*var\(--color-neutral-0/);
    assert.match(block(css, '.scene--dark {'), /color:\s*var\(--color-neutral-0/);
  });
});

// ---------------------------------------------------------------------------
describe('صفحهٔ قوانین (§22–۲۴)', () => {
  test('صفحهٔ منتشرشدهٔ پلتفرم با ساختار معنایی و عنوان بی‌برند دوگانه', async () => {
    const response = await f.page('/rules');
    assert.equal(response.status, 200);
    assert.deepEqual(html.h1s(response.body), ['قوانین و شرایط استفاده']);
    assert.ok([...response.body.matchAll(/<h2>/g)].length >= 8);
    assert.equal(html.title(response.body), 'قوانین و شرایط استفاده | پتاوو');
  });

  test('متن، ادعایی فراتر از رفتار واقعی سامانه ندارد', async () => {
    const { body } = await f.page('/rules');
    // قول مالی/قضایی/ضمانت، نباید بیاید؛ سامانه از آن‌ها خبر ندارد.
    for (const forbidden of [/ضمانت/, /غرامت/, /بازپرداخت/, /محاکم/, /دادگاه/, /جریمه/]) {
      assert.doesNotMatch(body, forbidden);
    }
    for (const promised of [/Argon2id/, /حسابرسی/, /تعلیق/, /robots\.txt/]) {
      assert.match(body, promised);
    }
  });

  test('صفحه، از همان چرخهٔ محتوا می‌آید (کلید یکتا، منتشرشده، عمومی)', async () => {
    const rows = await f.sudo(`select status, visibility, kind from app.content where business_id is null and slug = 'rules'`);
    assert.deepEqual(rows, [{ status: 'published', visibility: 'public', kind: 'page' }]);
  });
});

// ---------------------------------------------------------------------------
describe('پایگاه‌داده: نرمال‌سازی، جست‌وجو و گرنت (§103)', () => {
  const normalize = async (text) => (await f.sudo('select app.normalize_fa($1) as v', [text]))[0].v;

  test('نرمال‌سازی فارسی: حروف عربی، ارقام، حرکات، کشیده، نیم‌فاصله', async () => {
    assert.equal(await normalize('كلينيك  دامپزشكي'), 'کلینیک دامپزشکی');
    assert.equal(await normalize('٢٤ ساعته ۲۴'), '24 ساعته 24');
    assert.equal(await normalize('پت‌شاپ'), 'پت شاپ');
    assert.equal(await normalize('  مَکتَب  '), 'مکتب');
    assert.equal(await normalize('کـــشیده'), 'کشیده');
    assert.equal(await normalize('هاۀ مؤسسة أحمد إبراهيم'), 'هاه مؤسسه احمد ابراهیم');
    assert.equal(await normalize('ABC'), 'abc');
    assert.equal(await normalize(null), '');
  });

  test('تابع جست‌وجو برای بی‌نام اجرا می‌شود و فقط عمومی را می‌بیند', async () => {
    const rows = await f.asRole('pv_public', `select slug from app.search_businesses('مخفی', 10)`);
    assert.deepEqual(rows, []);
    const found = await f.asRole('pv_public', `select slug from app.search_businesses('پت شاپ', 10)`);
    assert.deepEqual(found.map((row) => row.slug), ['pet-shop-karaj']);
  });

  test('سقف تعداد در خود تابع است (۵۰) و حدِ پایین ۱', async () => {
    const big = await f.sudo(`select count(*)::int c from app.search_businesses('باشگاه', 1000)`);
    assert.equal(big[0].c, BULK);
    const none = await f.sudo(`select count(*)::int c from app.search_businesses('باشگاه', 0)`);
    assert.equal(none[0].c, 1);
    const empty = await f.sudo(`select count(*)::int c from app.search_businesses('', 10)`);
    assert.equal(empty[0].c, 0);
    const single = await f.sudo(`select count(*)::int c from app.search_businesses('ب', 10)`);
    assert.equal(single[0].c, 0, 'واژهٔ یک‌نویسه‌ای جست‌وجو نیست');
  });

  test('گرنت: اجرای توابع برای نقش‌های برنامه، نه برای PUBLIC', async () => {
    for (const role of ['pv_public', 'pv_app', 'pv_worker', 'pv_reader']) {
      const [row] = await f.sudo(`select has_function_privilege($1, 'app.search_businesses(text, integer)', 'execute') as ok`, [role]);
      assert.equal(row.ok, true, role);
    }
    const [publicRole] = await f.sudo(
      `select has_function_privilege('public', 'app.search_businesses(text, integer)', 'execute') as ok`,
    );
    assert.equal(publicRole.ok, false);
  });

  test('رگرسیون: بی‌نام می‌تواند دسته‌بندی محتوای عمومی را بخواند، نه محتوای مخفی را', async () => {
    const [grant] = await f.sudo(`select has_table_privilege('pv_public', 'app.content_category', 'select') as ok`);
    assert.equal(grant.ok, true);
    const rows = await f.asRole('pv_public', `select count(*)::int c from app.content_category`);
    const visible = await f.sudo(
      `select count(*)::int c from app.content_category cc join app.content c on c.id = cc.content_id
        where c.status = 'published' and c.visibility = 'public' and c.deleted_at is null
          and (c.business_id is null or exists (select 1 from app.business b where b.id = c.business_id and b.status = 'active' and b.visibility = 'public'))`,
    );
    assert.equal(rows[0].c, visible[0].c);
  });
});

// ---------------------------------------------------------------------------
describe('seed: بودجه و قالب‌های سئوی گام ۲۵', () => {
  test('هر مسیر تازه بودجه دارد (بی‌بودجه، «قبول» نیست)', async () => {
    const rows = await f.sudo(`select route_pattern from ops.page_budget`);
    const patterns = rows.map((row) => row.route_pattern);
    for (const pattern of ['/businesses', '/t', '/t/:slug', '/i', '/i/:path', '/l', '/l/:path', '/k', '/k/:path', '/:slug', '/search']) {
      assert.ok(patterns.includes(pattern), pattern);
    }
  });

  test('قالب‌های سئو اصلاح شده‌اند', async () => {
    const rows = await f.sudo(
      `select key, title_template from seo.template where business_id is null and key in ('listing.default', 'search.query', 'content.page')`,
    );
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row.title_template]));
    assert.equal(byKey['listing.default'], '{title} {sep} {site}');
    assert.doesNotMatch(byKey['search.query'], /«/);
    assert.equal(byKey['content.page'], '{title} {sep} {site}');
  });

  test('اجرای دوبارهٔ seed بی‌اثر است (هیچ ردیف تکراری)', async () => {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const sqlText = await readFile(join(import.meta.dirname, '..', 'seeds', '0006_site_pages.sql'), 'utf8');
    const before = await f.sudo(`select (select count(*) from app.content where slug = 'rules')::int c, (select count(*) from ops.page_budget)::int b, (select count(*) from seo.template)::int t`);
    await f.engine.exec(sqlText);
    await f.engine.exec(sqlText);
    const after = await f.sudo(`select (select count(*) from app.content where slug = 'rules')::int c, (select count(*) from ops.page_budget)::int b, (select count(*) from seo.template)::int t`);
    assert.deepEqual(after, before);
  });
});
