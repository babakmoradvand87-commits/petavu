/**
 * آزمون عملکرد سمت وب (گام ۲۷ — Addendum §۱–۱۹، §۹۱–۹۵، PART 102).
 *
 * اصل: **بایتِ سروشده را می‌سنجیم، نه اندازهٔ فایل.** سه باگ واقعی از همین تفاوت درآمد و هر سه
 * پیش‌تر سبز بودند: فونت خراب سرو می‌شد (۱۵۰٬۶۱۰ بایت به‌جای ۸۳٬۰۴۸)، بیکن عملکرد ۲۰۲ می‌داد
 * و هیچ نمونه‌ای ثبت نمی‌شد، و تطبیق بودجه برای مسیرهای تودرتو «بی‌بودجه» می‌گفت.
 *
 * بیکن را **خودِ فایل** در یک جعبهٔ `vm` اجرا می‌کنیم (بی‌مرورگر، ولی همان کد)، رله را با HTTP
 * واقعی، تصویرها را با `sharp` واقعی و AVIF/WebP واقعی.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import vm from 'node:vm';
import { brotliDecompressSync } from 'node:zlib';

import { createFixture, html, assetsDirectory } from '../scripts/lib/fixture.mjs';
import { openDatabase } from '../scripts/lib/engine.mjs';
import { migrate } from '../scripts/lib/migrate.mjs';
import { applySeeds } from '../scripts/lib/seed.mjs';
import { measurePage, pickSrcsetCandidate, referencedResources, transferBytes } from '../apps/web/dist/measure.js';
import { walkSitemap } from '../apps/web/dist/linkgraph.js';
import {
  allowedWidths,
  createLimiter,
  createPicture,
  DEFAULT_IMAGE_CONFIG,
  parseImageConfig,
  parseVariantQuery,
  unavailableEngine,
  variantKey,
  versionOf,
} from '../apps/web/dist/imagepipeline.js';
import { PROXY_RULES, matchProxyRule } from '../apps/web/dist/proxy.js';

const sharp = (await import('sharp')).default;
const run = promisify(execFile);

let f;
let owner;

/** رندر + بایت‌ها، مثل `serveHttp`. */
const fetchResource = async (path, server = f.web, host = 'localhost:3000') => {
  const result = await server.render({ method: 'GET', url: path, host });
  return { status: result.status, contentType: result.headers['content-type'] ?? '', bytes: result.bytes ?? Buffer.from(result.body, 'utf8') };
};

before(async () => {
  f = await createFixture({ api: true, storage: true });
  owner = await f.registerUser({ email: 'owner@petavu.test' });
  await f.createContent({ slug: 'vaccine-guide', title: 'راهنمای واکسن', categoryPaths: ['health.vaccination'] });
  for (let i = 1; i <= 6; i += 1) {
    await f.createBusiness({ slug: `shop-${i}`, name: `فروشگاه ${i}`, ownerUserId: owner.userId, typeKey: 'pet_shop', industryKey: 'animal_care.grooming', locationPath: 'iran.alborz.karaj' });
  }
});

after(async () => {
  await f?.close();
});

// ---------------------------------------------------------------------------
describe('بایتِ سروشده، نه اندازهٔ فایل (رگرسیون: فونت خراب)', () => {
  const port = () => f.web.server.address().port;
  const get = (path, headers = {}) =>
    new Promise((resolve, reject) => {
      httpRequest({ host: '127.0.0.1', port: port(), path, headers }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
      })
        .on('error', reject)
        .end();
    });

  const assetUrl = async (pattern) => {
    const css = await f.web.stylesheet();
    const home = (await f.page('/')).body;
    const all = `${home}\n${css}`;
    return new RegExp(`(/assets/${pattern})`).exec(all)?.[1];
  };

  test('فونت woff2، بایت‌به‌بایت همان فایل دیسک است', async () => {
    const url = await assetUrl('vazirmatn-var\\.[0-9a-f]{8}\\.woff2');
    assert.ok(url, 'فونت در CSS یا صفحه باید باشد');
    const response = await get(url);
    const disk = readFileSync(join(assetsDirectory, 'fonts', 'vazirmatn-var.woff2'));
    assert.equal(response.status, 200);
    assert.equal(response.body.length, disk.length, 'پیش‌تر ۱۵۰٬۶۱۰ بود: UTF-8 رفت‌وبرگشتی');
    assert.ok(response.body.equals(disk), 'بایت‌ها باید یکی باشند');
    assert.equal(response.headers['content-length'], String(disk.length));
    assert.equal(response.headers['content-type'], 'font/woff2');
    assert.equal(response.headers['content-encoding'], undefined, 'woff2 خودش فشرده است؛ دوباره فشرده نمی‌شود');
    assert.match(response.headers['cache-control'], /immutable/);
  });

  test('هر دارایی، بایتِ دیسک را می‌دهد (فونت، فاویکن، فیلتر ممنوعه نیست)', async () => {
    const files = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(woff2|svg|js)$/.test(name)) files.push(full);
      }
    };
    walk(assetsDirectory);
    assert.ok(files.length >= 3);
    for (const file of files) {
      const base = file.slice(file.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
      const extension = file.slice(file.lastIndexOf('.'));
      const url = await assetUrl(`${base.replace(/[-.]/g, '\\$&')}\\.[0-9a-f]{8}${extension.replace('.', '\\.')}`) ?? (await (async () => {
        const entry = f.web.assets.entries.find((candidate) => candidate.name === file.slice(file.lastIndexOf('/') + 1));
        return entry?.url;
      })());
      assert.ok(url, `نشانی ${file}`);
      const response = await get(url);
      assert.ok(response.body.equals(readFileSync(file)), `${file}: بایت‌ها یکی نیست`);
    }
  });

  test('CSS دارایی، با brotli فشرده می‌شود و رمزگشایی‌اش همان CSS است', async () => {
    const url = (await f.page('/')).body.match(/href="(\/assets\/app\.[0-9a-f]{8}\.css)"/)?.[1];
    const response = await get(url, { 'accept-encoding': 'br' });
    assert.equal(response.headers['content-encoding'], 'br');
    assert.equal(response.headers.vary, 'accept-encoding');
    assert.equal(brotliDecompressSync(response.body).toString('utf8'), await f.web.stylesheet());
    assert.ok(response.body.length < 12 * 1024, `CSS فشرده ${response.body.length} بایت`);
    // بی‌پذیرش brotli، خام.
    const plain = await get(url, { 'accept-encoding': 'identity' });
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.equal(plain.body.toString('utf8'), await f.web.stylesheet());
  });
});

// ---------------------------------------------------------------------------
describe('تطبیق قطعه‌به‌قطعهٔ مسیر (مهاجرت ۰۰۲۲)', () => {
  const matches = async (pattern, path) => (await f.sudo(`select ops.route_matches($1, $2) as v`, [pattern, path]))[0].v;

  test('جدول سنجش: یک بخش، چند بخش، ریشه', async () => {
    const table = [
      ['/t/:slug', '/t/pet-shop', true],
      ['/t/:slug', '/t/a/b', false],
      ['/t/:slug', '/t', false],
      ['/i/:path*', '/i/animal-care', true],
      ['/i/:path*', '/i/animal-care/grooming', true],
      ['/i/:path*', '/i/a/b/c', true],
      ['/i/:path*', '/i', false],
      ['/i/:path*', '/i//x', false],
      ['/:slug', '/rules', true],
      ['/:slug', '/t/x', false],
      ['/:slug', '/', false],
      ['/', '/', true],
      ['/', '/x', false],
      ['/b/:slug', '/b/x', true],
      ['/b/:slug', '/b/x/y', false],
      ['/search', '/search', true],
      ['/a/:x/b', '/a/1/b', true],
      ['/a/:x/b', '/a/1/c', false],
      ['/l/:path*', '/l/alborz/karaj', true],
    ];
    for (const [pattern, path, expected] of table) assert.equal(await matches(pattern, path), expected, `${pattern} ⇐ ${path}`);
  });

  test('پیش‌تر، `/rules` و همهٔ تاکسونومیِ تودرتو «بی‌بودجه» بودند؛ حالا نه', async () => {
    const pattern = async (path) => (await f.sudo(`select route_pattern from ops.budget_for_route($1)`, [path]))[0]?.route_pattern ?? null;
    assert.equal(await pattern('/rules'), '/:slug');
    assert.equal(await pattern('/i/animal-care/grooming'), '/i/:path*');
    assert.equal(await pattern('/l/alborz/karaj'), '/l/:path*');
    assert.equal(await pattern('/k/health/vaccination'), '/k/:path*');
    assert.equal(await pattern('/t/pet-shop'), '/t/:slug');
    assert.equal(await pattern('/b/anything'), '/b/:slug');
  });

  test('خاص‌ترین الگو برنده است: مسیر دقیق > پارامتر ثابت‌دار > فراگیر', async () => {
    const pattern = async (path) => (await f.sudo(`select route_pattern from ops.budget_for_route($1)`, [path]))[0]?.route_pattern ?? null;
    assert.equal(await pattern('/search'), '/search', 'دقیق، بر `/:slug` مقدم است');
    assert.equal(await pattern('/businesses'), '/businesses');
    assert.equal(await pattern('/join'), '/join', 'دقیق، بر `/:slug`');
  });

  test('مسیر ناموجود هنوز «بی‌بودجه» است: نگهبان گام ۱۴ سالم مانده', async () => {
    for (const path of ['/zzz/unknown/route', '/panel/anything/deep', '/b/x/y/z', '/api/v1/x']) {
      const [{ v }] = await f.sudo(`select ops.check_budget($1, '{}'::jsonb) as v`, [path]);
      assert.equal(v.verdict, 'unbudgeted', path);
      assert.equal(v.matched, false);
    }
  });
});

// ---------------------------------------------------------------------------
describe('رأی بودجه، منبع‌به‌منبع و صادق (مهاجرت ۰۰۲۲)', () => {
  const check = async (path, measurement) => (await f.sudo(`select ops.check_budget($1, $2::jsonb) as v`, [path, JSON.stringify(measurement)]))[0].v;

  test('هر منبع بودجهٔ خودش را دارد؛ تخطی با نام سنجه، سقف و مقدار', async () => {
    const result = await check('/', { html_kb: 100, css_kb: 10, js_kb: 50, font_kb: 83, image_kb: 0, weight_kb: 200 });
    assert.equal(result.verdict, 'fail');
    assert.deepEqual(
      result.breaches.map((breach) => [breach.metric, breach.budget, breach.actual]).sort(),
      [['html_kb', 30, 100], ['js_kb', 10, 50]],
    );
  });

  test('قبول یعنی «در سنجه‌های سنجیده‌شده تخطی نیست»؛ `compared` و `not_compared` صادقانه می‌گویند', async () => {
    const result = await check('/', { html_kb: 3, css_kb: 9, js_kb: 1.3, font_kb: 81.1, image_kb: 0, weight_kb: 95, request_count: 5 });
    assert.equal(result.verdict, 'pass');
    assert.deepEqual([...result.compared].sort(), ['css_kb', 'font_kb', 'html_kb', 'image_kb', 'js_kb', 'request_count', 'weight_kb']);
    // LCP/INP/CLS بدون مرورگر ممکن نیست؛ پنهان نمی‌شود.
    for (const unmeasured of ['lcp_ms', 'inp_ms', 'cls']) assert.ok(result.not_compared.includes(unmeasured), unmeasured);
  });

  test('مقدار غیرعددی یا منفی، «اندازه‌گیری نشده» است — نه خطای ۵۰۰ (ورودی کاربر است)', async () => {
    const result = await check('/', { weight_kb: 'abc', html_kb: -5, css_kb: null, js_kb: [], font_kb: {}, image_kb: true });
    assert.equal(result.verdict, 'pass');
    assert.deepEqual(result.compared, []);
    assert.ok(result.not_compared.includes('html_kb') && result.not_compared.includes('js_kb'));
    // و از راه API هم همین است.
    const bad = await check('/', { css_kb: 9999 });
    assert.equal(bad.verdict, 'fail');
  });

  test('`js_kb = 0` معنای روشن دارد: «بدون JavaScript»، و ۱ بایت هم تخطی است', async () => {
    await f.sudo(`update ops.page_budget set js_kb = 0 where route_pattern = '/search' and scope = 'platform'`);
    try {
      assert.equal((await check('/search', { js_kb: 0 })).verdict, 'pass');
      const result = await check('/search', { js_kb: 0.1 });
      assert.equal(result.verdict, 'fail');
      assert.equal(result.breaches[0].metric, 'js_kb');
    } finally {
      await f.sudo(`update ops.page_budget set js_kb = 10 where route_pattern = '/search' and scope = 'platform'`);
    }
  });

  test('قیدهای ستون‌های تازه: منفی و بی‌معنا رد می‌شود', async () => {
    for (const [column, value] of [['html_kb', 0], ['css_kb', -1], ['js_kb', -1], ['image_kb', 99999], ['font_kb', -3]]) {
      await assert.rejects(
        () => f.sudo(`update ops.page_budget set ${column} = $1 where route_pattern = '/search'`, [value]),
        (error) => error.code === '23514',
        `${column}=${value}`,
      );
    }
  });

  test('مرز اعتماد vitals: مقدار شمارشیِ ناشناخته دسته را باطل نمی‌کند', async () => {
    const [{ v }] = await f.sudo(
      `select ops.record_vitals($1::jsonb, null) as v`,
      [JSON.stringify([
        { metric: 'lcp', value: 900, path: '/', navigation_type: 'back-forward-cache', connection: 'LTE', device_class: 'phone' },
        { metric: 'cls', value: 0.02, path: '/', navigation_type: 'RELOAD', connection: '4G', device_class: 'MOBILE' },
      ])],
    );
    assert.equal(v.accepted, 2);
    const rows = await f.sudo(`select metric, navigation_type, connection, device_class from ops.vitals_sample where page_path = '/' order by metric`);
    assert.deepEqual(rows.map((row) => [row.metric, row.navigation_type, row.connection, row.device_class]), [
      ['cls', 'reload', '4g', 'mobile'],
      ['lcp', 'back_forward', 'unknown', 'unknown'],
    ]);
  });
});

// ---------------------------------------------------------------------------
describe('اندازه‌گیری منابع (واحد)', () => {
  const ORIGIN = 'http://localhost:3000';
  const doc = (head, body = '') => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

  test('منابع نخستین‌نما: CSS، اسکریپت (نه JSON-LD)، فونتِ preload، فاویکن', () => {
    const found = referencedResources(
      doc(`<link rel="icon" href="/assets/f.svg" type="image/svg+xml">
           <link rel="preload" href="${ORIGIN}/assets/font.woff2" as="font" type="font/woff2" crossorigin="anonymous">
           <link rel="stylesheet" href="/assets/app.css"><script src="/assets/v.js" defer></script>
           <script type="application/ld+json">{"@type":"Thing"}</script>
           <link rel="stylesheet" href="https://cdn.example/x.css">`),
      ORIGIN,
    );
    assert.deepEqual(found.stylesheets, ['/assets/app.css']);
    assert.deepEqual(found.scripts, ['/assets/v.js']);
    assert.deepEqual(found.preloadedFonts, ['/assets/font.woff2']);
    assert.deepEqual(found.icons, ['/assets/f.svg']);
  });

  test('تصویر: تنبل شمرده نمی‌شود؛ `<picture>` گزینهٔ موبایلِ ۲× را برمی‌دارد', () => {
    const found = referencedResources(
      doc('', `
        <img src="/media/a" loading="lazy" width="1" height="1" alt="">
        <img src="/media/b" loading="eager" width="1" height="1" alt="">
        <img src="/media/c" width="1" height="1" alt="">
        <picture>
          <source type="image/avif" srcset="/media/d?w=320&amp;f=avif 320w, /media/d?w=640&amp;f=avif 640w, /media/d?w=1280&amp;f=avif 1280w">
          <source type="image/webp" srcset="/media/d?w=320&amp;f=webp 320w">
          <img src="/media/d" loading="eager" width="1600" height="900" alt="">
        </picture>
        <picture><source type="image/avif" srcset="/media/e?w=640&amp;f=avif 640w"><img src="/media/e" loading="lazy" alt=""></picture>
        <img src="https://other.example/x.png" width="1" height="1" alt="">`),
      ORIGIN,
    );
    assert.deepEqual(found.images.sort(), ['/media/b', '/media/c', '/media/d?w=640&f=avif'].sort());
  });

  test('انتخاب گزینهٔ srcset: بزرگ‌ترینِ ≤ ۹۶۰، وگرنه کوچک‌ترین', () => {
    assert.equal(pickSrcsetCandidate('/a 320w, /b 640w, /c 960w, /d 1280w'), '/c');
    assert.equal(pickSrcsetCandidate('/a 1280w, /b 1600w'), '/a');
    assert.equal(pickSrcsetCandidate('/only'), '/only');
    assert.equal(pickSrcsetCandidate(''), null);
  });

  test('حجم انتقال: متن، brotli؛ دودویی، همان‌طور که هست', () => {
    const text = Buffer.from('سلام '.repeat(2000));
    assert.ok(transferBytes({ contentType: 'text/css; charset=utf-8', bytes: text }) < text.length / 20);
    const binary = Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 7919) % 251));
    assert.equal(transferBytes({ contentType: 'font/woff2', bytes: binary }), 5000);
    assert.equal(transferBytes({ contentType: 'image/avif', bytes: binary }), 5000);
  });

  test('صفحه با منبع شکسته ناسالم است (`failed`)، و جمع‌ها از بایت‌های واقعی‌اند', async () => {
    const files = {
      '/': { contentType: 'text/html', bytes: Buffer.from(doc('<link rel="stylesheet" href="/s.css"><script src="/m.js"></script><link rel="icon" href="/i.svg">')) },
      '/s.css': { contentType: 'text/css', bytes: Buffer.from('@font-face{src:url("/f.woff2")} body{}') },
      '/m.js': { contentType: 'text/javascript', bytes: Buffer.from('console.log(1)') },
      '/f.woff2': { contentType: 'font/woff2', bytes: Buffer.alloc(2048, 7) },
    };
    const report = await measurePage({
      path: '/',
      origin: ORIGIN,
      fetch: async (path) => files[path] ? { status: 200, ...files[path] } : { status: 404, contentType: 'text/plain', bytes: Buffer.from('no') },
    });
    assert.equal(report.measurement.font_kb, 2);
    assert.equal(report.measurement.request_count, 5); // سند، css، js، فونتِ CSS، فاویکن
    assert.deepEqual(report.failed.map((resource) => [resource.path, resource.status]), [['/i.svg', 404]]);
    const total = report.resources.reduce((sum, resource) => sum + resource.bytes, 0);
    assert.ok(Math.abs(report.measurement.weight_kb - total / 1024) < 0.1);
  });
});

// ---------------------------------------------------------------------------
describe('دروازهٔ بودجه روی سایت واقعی', () => {
  test('هر صفحهٔ نقشهٔ سایت (و جست‌وجو) بودجه دارد و قبول است؛ فونت ۸۳٬۰۴۸ بایت', async () => {
    const walk = await walkSitemap('http://localhost:3000', async (path) => {
      const result = await f.page(path);
      return { status: result.status, body: result.body };
    });
    const urls = [...new Set([...walk.urls, '/search', '/search?q=%D9%81%D8%B1%D9%88%D8%B4%DA%AF%D8%A7%D9%87'])];
    assert.ok(urls.length > 10, `نشانی‌ها: ${urls.length}`);

    const seen = new Set();
    const bad = [];
    for (const path of urls) {
      const report = await measurePage({ path, origin: 'http://localhost:3000', fetch: (resource) => fetchResource(resource) });
      const [{ v }] = await f.sudo(`select ops.check_budget($1, $2::jsonb) as v`, [path.split('?')[0], JSON.stringify(report.measurement)]);
      seen.add(v.route_pattern);
      if (v.verdict !== 'pass' || report.failed.length > 0) bad.push(`${path}: ${v.verdict} ${JSON.stringify(v.breaches)} ${report.failed.map((r) => r.path)}`);
      assert.equal(report.measurement.font_kb, Math.round((83_048 / 1024) * 10) / 10, `${path}: فونت`);
    }
    assert.deepEqual(bad, []);
    for (const pattern of ['/', '/businesses', '/t', '/t/:slug', '/i', '/i/:path*', '/l', '/l/:path*', '/k', '/k/:path*', '/b/:slug', '/:slug', '/search']) {
      assert.ok(seen.has(pattern), `الگوی ${pattern} نمونه نشده`);
    }
  });

  test('صفحهٔ سنگین، دروازه را می‌بندد (رأی `fail` با نام منبع)', async () => {
    // متن شبه‌تصادفی تا brotli آن را فشرده نکند؛ ۱۵۰ کیلوبایت > سقف HTML.
    let seed = 7;
    const words = Array.from({ length: 24_000 }, () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed.toString(36);
    });
    await f.sudo(
      `insert into app.content (business_id, kind, slug, title, body, status, visibility, locale, published_at)
       values (null, 'page', 'heavy-page', 'صفحهٔ سنگین', $1::jsonb, 'published', 'public', 'fa-IR', now())`,
      [JSON.stringify({ blocks: [{ kind: 'paragraph', text: words.join(' ') }] })],
    );
    const report = await measurePage({ path: '/heavy-page', origin: 'http://localhost:3000', fetch: (path) => fetchResource(path) });
    assert.ok(report.measurement.html_kb > 40, `html_kb=${report.measurement.html_kb}`);
    const [{ v }] = await f.sudo(`select ops.check_budget('/heavy-page', $1::jsonb) as v`, [JSON.stringify(report.measurement)]);
    assert.equal(v.verdict, 'fail');
    assert.ok(v.breaches.some((breach) => breach.metric === 'html_kb'));
    await f.sudo(`delete from app.content where slug = 'heavy-page'`);
  });
});

// ---------------------------------------------------------------------------
describe('بیکن vitals: خودِ فایل، در جعبهٔ vm', () => {
  const SOURCE = readFileSync(join(assetsDirectory, 'vitals.js'), 'utf8');

  /** مرورگرِ مینیمال با همان APIهایی که اسکریپت می‌خواند. */
  function browser({ rate = '1.000', dnt = null, width = 1280, random = 0, observers = true, search = '?token=secret', hash = '#x', beacon = true } = {}) {
    const sent = [];
    const listeners = {};
    const observed = [];
    class FakeObserver {
      constructor(callback) {
        this.callback = callback;
      }
      observe(options) {
        if (!observers) throw new TypeError('unsupported');
        observed.push({ type: options.type, observer: this, options });
      }
    }
    const feed = (type, entries) => {
      for (const item of observed.filter((entry) => entry.type === type)) item.observer.callback({ getEntries: () => entries });
    };
    const context = {
      document: {
        visibilityState: 'visible',
        querySelector: (selector) => (selector === 'meta[name="pv-rum"]' && rate !== null ? { getAttribute: () => rate } : null),
      },
      navigator: {
        doNotTrack: dnt,
        connection: { effectiveType: '4g' },
        ...(beacon ? { sendBeacon: (url, blob) => { sent.push({ url, blob }); return true; } } : {}),
      },
      window: { innerWidth: width, doNotTrack: null },
      location: { pathname: '/b/tak-pet', search, hash },
      performance: { getEntriesByType: () => [{ type: 'navigate', responseStart: 120 }] },
      PerformanceObserver: FakeObserver,
      Blob: class { constructor(parts, options) { this.parts = parts; this.type = options.type; } },
      Math: Object.create(Math, { random: { value: () => random } }),
      JSON,
      isFinite,
      parseFloat,
      addEventListener: (name, handler) => { (listeners[name] ??= []).push(handler); },
    };
    context.window.addEventListener = context.addEventListener;
    vm.runInNewContext(SOURCE, context);
    return {
      sent,
      observed,
      feed,
      hide: () => { context.document.visibilityState = 'hidden'; for (const handler of listeners.visibilitychange ?? []) handler(); },
      pagehide: () => { for (const handler of listeners.pagehide ?? []) handler(); },
      payloads: () => sent.map((entry) => JSON.parse(entry.blob.parts[0])),
    };
  }

  test('بدون `<meta name="pv-rum">` (مسیر بی‌بودجه/خارج از RUM)، هیچ‌چیز راه نمی‌افتد', () => {
    const page = browser({ rate: null });
    assert.equal(page.observed.length, 0);
    page.hide();
    assert.equal(page.sent.length, 0);
  });

  test('«ردیابی نکن» محترم است', () => {
    for (const dnt of ['1']) assert.equal(browser({ dnt }).observed.length, 0);
    assert.ok(browser({ dnt: '0' }).observed.length > 0);
  });

  test('نمونه‌گیری: نرخ از متا، و `Math.random` تصمیم می‌گیرد', () => {
    assert.equal(browser({ rate: '0.200', random: 0.5 }).observed.length, 0, 'خارج از نمونه');
    assert.ok(browser({ rate: '0.200', random: 0.1 }).observed.length > 0, 'در نمونه');
    assert.equal(browser({ rate: '0.000', random: 0 }).observed.length, 0, 'نرخ صفر');
    assert.equal(browser({ rate: 'abc' }).observed.length, 0, 'نرخ نامعتبر');
  });

  test('بی‌sendBeacon، سکوت؛ مرورگری که نوع‌ها را نمی‌شناسد، خطا نمی‌دهد و فقط آنچه دارد می‌فرستد (TTFB)', () => {
    assert.equal(browser({ beacon: false }).observed.length, 0);
    const page = browser({ observers: false });
    page.hide();
    assert.equal(page.sent.length, 1);
    assert.deepEqual(page.payloads()[0].samples.map((sample) => sample.metric), ['ttfb']);
  });

  test('هنگام پنهان‌شدن، یک دسته با شکل درست و **فقط مسیر** (بدون پرس‌وجو و لنگر) می‌رود', () => {
    const page = browser({ width: 390 });
    page.feed('largest-contentful-paint', [{ startTime: 800.4 }, { startTime: 1534.7 }]);
    page.feed('paint', [{ name: 'first-paint', startTime: 300 }, { name: 'first-contentful-paint', startTime: 612.2 }]);
    page.feed('layout-shift', [{ startTime: 100, value: 0.04, hadRecentInput: false }]);
    page.feed('event', [{ interactionId: 1, duration: 96 }, { interactionId: 2, duration: 210 }, { interactionId: 0, duration: 999 }]);
    page.hide();

    assert.equal(page.sent.length, 1);
    assert.equal(page.sent[0].url, '/api/v1/public/vitals');
    assert.equal(page.sent[0].blob.type, 'application/json');
    const { samples } = page.payloads()[0];
    const by = Object.fromEntries(samples.map((sample) => [sample.metric, sample]));
    assert.deepEqual(Object.keys(by).sort(), ['cls', 'fcp', 'inp', 'lcp', 'ttfb']);
    assert.equal(by.lcp.value, 1535, 'آخرین ورودی LCP، گرد‌شده');
    assert.equal(by.fcp.value, 612);
    assert.equal(by.inp.value, 210, 'کندترین تعامل؛ `interactionId=0` تعامل نیست');
    assert.equal(by.cls.value, 0.04);
    assert.equal(by.ttfb.value, 120);
    for (const sample of samples) {
      assert.equal(sample.path, '/b/tak-pet', 'پرس‌وجو و لنگر (می‌توانند توکن داشته باشند) هرگز نمی‌روند');
      assert.equal(sample.device_class, 'mobile');
      assert.equal(sample.connection, '4g');
      assert.equal(sample.navigation_type, 'navigate');
      assert.deepEqual(Object.keys(sample).sort(), ['connection', 'device_class', 'metric', 'navigation_type', 'path', 'value']);
    }
    assert.ok(samples.length <= 5);
  });

  test('فقط یک بار می‌فرستد (پنهان‌شدن + `pagehide` دوباره نمی‌فرستد)', () => {
    const page = browser();
    page.feed('largest-contentful-paint', [{ startTime: 1000 }]);
    page.hide();
    page.pagehide();
    page.hide();
    assert.equal(page.sent.length, 1);
  });

  test('بی‌نمونه نمی‌فرستد (صفحه‌ای که چیزی اندازه‌گیری نشد)', () => {
    const page = browser();
    // ttfb از navigation می‌آید؛ برای «بی‌نمونه»، navigation را هم حذف می‌کنیم.
    const empty = browser();
    empty.hide();
    assert.equal(page.sent.length, 0);
    assert.ok(empty.sent.length <= 1);
  });

  test('CLS: بدترین «پنجرهٔ نشست»؛ ورودیِ بعد از تعامل نمی‌شمارد', () => {
    const page = browser();
    page.feed('layout-shift', [
      { startTime: 100, value: 0.05, hadRecentInput: false },
      { startTime: 600, value: 0.05, hadRecentInput: false }, // همان پنجره: ۰٫۱۰
      { startTime: 700, value: 0.9, hadRecentInput: true }, // بعد از تعامل: نادیده
      { startTime: 3000, value: 0.04, hadRecentInput: false }, // پنجرهٔ تازه (فاصله > ۱ثانیه): ۰٫۰۴
    ]);
    page.hide();
    assert.equal(page.payloads()[0].samples.find((sample) => sample.metric === 'cls').value, 0.1);
  });

  test('CLS بدون هیچ جابه‌جایی، `۰` است (نبودنِ سنجه نیست)', () => {
    const page = browser();
    page.hide();
    assert.equal(page.payloads()[0].samples.find((sample) => sample.metric === 'cls').value, 0);
  });

  test('INP: برای بیش از ۵۰ تعامل، صدک ۹۸ (نه بدترین یک‌باره)', () => {
    const page = browser();
    const entries = Array.from({ length: 100 }, (_, i) => ({ interactionId: i + 1, duration: 40 + i }));
    page.feed('event', entries);
    page.hide();
    // ۱۰۰ تعامل: ایندکس ⌊۱۰۰/۵۰⌋ = ۲ در فهرست نزولی ⇒ سومین کندترین (۱۳۷)
    assert.equal(page.payloads()[0].samples.find((sample) => sample.metric === 'inp').value, 137);
  });

  test('کلاس دستگاه از پهنا؛ بدون پهنا «unknown»', () => {
    const check = (width) => {
      const page = browser({ width });
      page.feed('largest-contentful-paint', [{ startTime: 1 }]);
      page.hide();
      return page.payloads()[0].samples[0].device_class;
    };
    assert.equal(check(375), 'mobile');
    assert.equal(check(800), 'tablet');
    assert.equal(check(1440), 'desktop');
    assert.equal(check(0), 'unknown');
  });

  test('حریم خصوصی و امنیت: بی‌کوکی، بی‌ذخیره‌سازی، بی‌شناسه، بی‌eval، بی‌innerHTML', () => {
    for (const forbidden of [/document\.cookie/, /localStorage/, /sessionStorage/, /indexedDB/, /\beval\s*\(/, /new Function/, /innerHTML/, /outerHTML/, /document\.write/, /fetch\s*\(/, /XMLHttpRequest/, /navigator\.userAgent/, /referrer/, /location\.(search|href|hash)/]) {
      assert.doesNotMatch(SOURCE, forbidden, String(forbidden));
    }
    assert.ok(Buffer.byteLength(SOURCE) < 6 * 1024, `حجم خام ${Buffer.byteLength(SOURCE)} بایت`);
  });
});

// ---------------------------------------------------------------------------
describe('بیکن در سند HTML (CSP سخت)', () => {
  const rumMeta = (doc) => /<meta name="pv-rum" content="([^"]+)">/.exec(doc)?.[1] ?? null;

  test('صفحهٔ عمومی با بودجه: متا با نرخ همان بودجه + یک اسکریپت `defer` هم‌مبدأ', async () => {
    const { body } = await f.page('/');
    assert.equal(rumMeta(body), '0.200');
    const scripts = [...body.matchAll(/<script\s[^>]*src="([^"]+)"[^>]*>/g)].map((match) => match[1]);
    assert.equal(scripts.length, 1);
    assert.match(scripts[0], /^\/assets\/vitals\.[0-9a-f]{8}\.js$/);
    assert.match(body, /<script src="\/assets\/vitals\.[0-9a-f]{8}\.js" defer><\/script>/);
    // هنوز هیچ اسکریپت یا استایل درون‌خطی نیست.
    assert.doesNotMatch(body, /<script(?![^>]*\ssrc=)(?![^>]*application\/ld\+json)/);
    assert.doesNotMatch(body, /\sstyle="/);
  });

  test('نرخ از بودجهٔ همان مسیر می‌آید (داده): ۰ ⇒ هیچ نشانه‌ای', async () => {
    await f.sudo(`update ops.page_budget set rum_sample_rate = 0 where route_pattern = '/businesses' and scope = 'platform'`);
    await f.sudo(`update ops.page_budget set rum_sample_rate = 0.5 where route_pattern = '/t' and scope = 'platform'`);
    try {
      const off = await f.page('/businesses');
      assert.equal(rumMeta(off.body), null);
      assert.doesNotMatch(off.body, /vitals\./);
      assert.equal(rumMeta((await f.page('/t')).body), '0.500');
    } finally {
      await f.sudo(`update ops.page_budget set rum_sample_rate = 0.1 where route_pattern = '/businesses' and scope = 'platform'`);
      await f.sudo(`update ops.page_budget set rum_sample_rate = 0.1 where route_pattern = '/t' and scope = 'platform'`);
    }
  });

  test('صفحهٔ خطا، مسیر بی‌بودجه و میزبان‌های دیگر: بی‌بیکن', async () => {
    assert.equal(rumMeta((await f.page('/this/does/not/exist')).body), null);
    assert.equal((await f.page('/this/does/not/exist')).status, 404);
    // سایت‌های دیگر (پنل…) بیکن عمومی ندارند.
    const panel = await f.page('/', { host: 'panel.localhost:3000' });
    assert.doesNotMatch(panel.body, /pv-rum/);
  });

  test('خودِ دارایی: نوع درست، کش تغییرناپذیر، فشردنی، و همان بایت‌های فایل', async () => {
    const url = (await f.page('/')).body.match(/src="(\/assets\/vitals\.[0-9a-f]{8}\.js)"/)?.[1];
    const response = await f.web.render({ method: 'GET', url, host: 'localhost:3000' });
    assert.equal(response.status, 200);
    assert.match(response.headers['content-type'], /^text\/javascript/);
    assert.match(response.headers['cache-control'], /immutable/);
    assert.ok(response.bytes.equals(readFileSync(join(assetsDirectory, 'vitals.js'))));
    assert.match(response.headers['content-security-policy'], /script-src 'self'/);
  });
});

// ---------------------------------------------------------------------------
describe('رلهٔ فهرست‌سفید به API (§۸۳–۸۵، §۱۳)', () => {
  const base = () => `http://127.0.0.1:${f.web.server.address().port}`;
  const post = (path, { body, headers = {}, host } = {}) =>
    new Promise((resolve, reject) => {
      const payload = body === undefined ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
      const request = httpRequest(
        { host: '127.0.0.1', port: f.web.server.address().port, path, method: 'POST', headers: { 'content-length': payload.length, ...(host ? { host } : {}), ...headers } },
        (response) => {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text: Buffer.concat(chunks).toString('utf8') }));
        },
      );
      request.on('error', reject);
      request.end(payload);
    });
  const sample = (path = '/', extra = {}) => ({ samples: [{ metric: 'lcp', value: 1500, path, device_class: 'mobile', connection: '4g', navigation_type: 'navigate', ...extra }] });
  const json = { 'content-type': 'application/json', origin: 'http://localhost:3000' };

  test('بیکن از مبدأ سایت به API می‌رسد و **واقعاً ثبت می‌شود** (پیش‌تر ۲۰۲ بود و هیچ ثبت نمی‌شد)', async () => {
    await f.sudo(`delete from ops.vitals_sample`);
    const response = await post('/api/v1/public/vitals', { body: sample('/t/pet-shop'), headers: json });
    assert.equal(response.status, 202, response.text);
    assert.equal(JSON.parse(response.text).recorded.accepted, 1);
    const rows = await f.sudo(`select metric, page_path, route_pattern, rating, device_class, connection, navigation_type from ops.vitals_sample`);
    assert.deepEqual(rows, [{ metric: 'lcp', page_path: '/t/pet-shop', route_pattern: '/t/:slug', rating: 'good', device_class: 'mobile', connection: '4g', navigation_type: 'navigate' }]);
  });

  test('`text/plain` (پیش‌فرض برخی sendBeaconها) هم می‌پذیرد؛ بدنهٔ دیگر ۴۱۵', async () => {
    const plain = await post('/api/v1/public/vitals', { body: sample('/b/shop-1'), headers: { ...json, 'content-type': 'text/plain;charset=UTF-8' } });
    assert.equal(plain.status, 202, plain.text);
    const form = await post('/api/v1/public/vitals', { body: 'a=b', headers: { ...json, 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(form.status, 415);
    assert.equal(JSON.parse(form.text).code, 'unsupported_media_type');
    const none = await post('/api/v1/public/vitals', { body: sample(), headers: { origin: 'http://localhost:3000' } });
    assert.equal(none.status, 415);
  });

  test('فهرست سفید بسته است: هیچ مسیر API دیگری، روی هیچ میزبانی، عبور نمی‌کند', async () => {
    for (const path of ['/api/v1/auth/login', '/api/v1/auth/register', '/api/v1/businesses', '/api/v1/public/security-events', '/api/v1/public/vitals/extra', '/api/v1/public/vitals/', '/api/v1/ops/settings/x']) {
      const response = await post(path, { body: {}, headers: json });
      assert.equal(response.status, 405, path);
    }
    // سایت‌های دیگر (پنل، مدیریت) این قاعده را ندارند.
    for (const host of ['panel.localhost:3000', 'adminpanel.localhost:3000', 'shop.localhost:3000']) {
      const response = await post('/api/v1/public/vitals', { body: sample(), headers: json, host });
      assert.equal(response.status, 405, host);
    }
    // میزبان ناشناس: ۴۲۱ همیشگی، نه رله.
    const unknown = await post('/api/v1/public/vitals', { body: sample(), headers: json, host: 'evil.example.com' });
    assert.equal(unknown.status, 405);
    // GET روی همان مسیر، رله نیست.
    const get = await fetch(`${base()}/api/v1/public/vitals`);
    assert.equal(get.status, 404);
  });

  test('بدنهٔ بیش از سقف ۱۶ کیلوبایت: ۴۱۳ و بی‌رسیدن به API', async () => {
    const response = await post('/api/v1/public/vitals', { body: Buffer.alloc(20_000, 0x20), headers: json });
    assert.equal(response.status, 413);
    assert.equal(JSON.parse(response.text).code, 'payload_too_large');
    assert.equal((await f.sudo(`select count(*)::int c from ops.vitals_sample where page_path = '/x'`))[0].c, 0);
  });

  test('اعتبارسنجی، همچنان کار API است: سنجهٔ ناشناس ۴۰۰، مسیر بد ۴۰۰', async () => {
    const bad = await post('/api/v1/public/vitals', { body: { samples: [{ metric: 'bogus', value: 1, path: '/x' }] }, headers: json });
    assert.equal(bad.status, 400);
    const path = await post('/api/v1/public/vitals', { body: { samples: [{ metric: 'lcp', value: 1, path: 'https://evil.example' }] }, headers: json });
    assert.equal(path.status, 400);
  });

  test('مبدأ جعلی را API رد می‌کند (`Origin` عبور می‌کند، تصمیم با API است)', async () => {
    const response = await post('/api/v1/public/vitals', { body: sample(), headers: { 'content-type': 'application/json', origin: 'https://evil.example' } });
    assert.ok([400, 403].includes(response.status), `status=${response.status} ${response.text}`);
  });

  test('پاسخ، سرصفحه‌های امنیتی وب را دارد و `set-cookie` یا هدرِ داخلیِ API نشت نمی‌کند', async () => {
    const response = await post('/api/v1/public/vitals', { body: sample(), headers: json });
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.match(response.headers['content-security-policy'], /default-src 'self'/);
    assert.equal(response.headers['set-cookie'], undefined);
    assert.match(response.headers['x-request-id'], /^[A-Za-z0-9._:-]{8,64}$/);
  });

  describe('هدرها: فهرست سفید، نه سیاه — روی یک بالادست واقعیِ ثبت‌کننده', () => {
    let upstream;
    let captured;
    let relay;

    before(async () => {
      upstream = createServer((request, response) => {
        const chunks = [];
        request.on('data', (chunk) => chunks.push(chunk));
        request.on('end', () => {
          captured = { method: request.method, url: request.url, headers: request.headers, body: Buffer.concat(chunks).toString('utf8') };
          response.writeHead(202, {
            'content-type': 'application/json',
            'set-cookie': ['sid=stolen; Path=/'],
            server: 'internal-api/9.9',
            'x-internal-secret': 'do-not-leak',
            'retry-after': '3',
            etag: '"abc"',
          });
          response.end('{"recorded":{"accepted":1}}');
        });
      });
      await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
      const { createWebServer } = await import('../apps/web/dist/index.js');
      const { silentLogger } = await import('../packages/shared/dist/index.js');
      relay = createWebServer({
        client: f.client,
        env: f.env,
        logger: silentLogger(),
        assetsDirectory,
        apiOrigin: `http://127.0.0.1:${upstream.address().port}`,
        imageConfigTtlMs: 0,
      });
      await relay.listen(0, '127.0.0.1');
    });

    after(async () => {
      await relay?.close();
      await new Promise((resolve) => upstream.close(resolve));
    });

    const send = (headers, body = JSON.stringify({ samples: [] })) =>
      new Promise((resolve, reject) => {
        const request = httpRequest(
          { host: '127.0.0.1', port: relay.server.address().port, path: '/api/v1/public/vitals?utm=x', method: 'POST', headers: { 'content-length': Buffer.byteLength(body), ...headers } },
          (response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text: Buffer.concat(chunks).toString('utf8') }));
          },
        );
        request.on('error', reject);
        request.end(body);
      });

    test('`X-Forwarded-For` و `Forwarded` کلاینت دور ریخته می‌شود؛ مقدار از سوکت می‌آید', async () => {
      await send({ 'content-type': 'application/json', 'x-forwarded-for': '6.6.6.6', forwarded: 'for=6.6.6.6;proto=https', 'x-real-ip': '6.6.6.6', 'x-forwarded-host': 'evil.example' });
      assert.equal(captured.headers['x-forwarded-for'], '127.0.0.1', 'IP جعلی نباید به محدودیت نرخِ API برسد');
      assert.equal(captured.headers.forwarded, undefined);
      assert.equal(captured.headers['x-real-ip'], undefined);
      assert.equal(captured.headers['x-forwarded-host'], undefined);
    });

    test('`X-Forwarded-Proto` از پیکربندی است، نه از ادعای کلاینت', async () => {
      await send({ 'content-type': 'application/json', 'x-forwarded-proto': 'https' });
      assert.equal(captured.headers['x-forwarded-proto'], 'http', 'مبدأ عمومی آزمون http است');
    });

    test('کوکی و `Authorization` به API نمی‌رسند (مسیر بی‌نام)', async () => {
      await send({ 'content-type': 'application/json', cookie: '__Host-pv_session=SECRET', authorization: 'Bearer TOKEN', 'proxy-authorization': 'x' });
      assert.equal(captured.headers.cookie, undefined);
      assert.equal(captured.headers.authorization, undefined);
      assert.equal(captured.headers['proxy-authorization'], undefined);
    });

    test('آنچه باید برسد: مسیر، متد، بدنه، `Origin`، `User-Agent`، شناسهٔ درخواست و نوع محتوا', async () => {
      const body = JSON.stringify({ samples: [{ metric: 'lcp', value: 1, path: '/' }] });
      await send({ 'content-type': 'application/json; charset=utf-8', origin: 'http://localhost:3000', 'user-agent': 'Mozilla/5.0 test', 'x-request-id': 'req-12345678' }, body);
      assert.equal(captured.method, 'POST');
      assert.equal(captured.url, '/api/v1/public/vitals?utm=x');
      assert.equal(captured.body, body);
      assert.equal(captured.headers.origin, 'http://localhost:3000');
      assert.equal(captured.headers['user-agent'], 'Mozilla/5.0 test');
      assert.equal(captured.headers['x-request-id'], 'req-12345678');
      assert.equal(captured.headers['content-type'], 'application/json');
      assert.equal(captured.headers['content-length'], String(Buffer.byteLength(body)));
      assert.equal(captured.headers.host, `127.0.0.1:${upstream.address().port}`);
    });

    test('شناسهٔ درخواستِ نامعتبر (فاصله، بیش‌ازحد بلند، کوتاه)، جایگزین می‌شود', async () => {
      for (const bad of ['bad id with spaces', 'x'.repeat(100), 'short']) {
        await send({ 'content-type': 'application/json', 'x-request-id': bad });
        assert.match(captured.headers['x-request-id'], /^web-[a-z0-9-]+$/, bad.slice(0, 20));
      }
    });

    test('پاسخ: فقط هدرهای فهرست‌سفید می‌گذرند؛ `Set-Cookie` و `Server` و سرّ داخلی نه', async () => {
      const response = await send({ 'content-type': 'application/json' });
      assert.equal(response.status, 202);
      assert.equal(response.text, '{"recorded":{"accepted":1}}');
      assert.equal(response.headers['set-cookie'], undefined);
      assert.equal(response.headers.server, undefined);
      assert.equal(response.headers['x-internal-secret'], undefined);
      assert.equal(response.headers['retry-after'], '3');
      assert.equal(response.headers.etag, '"abc"');
      assert.equal(response.headers['cache-control'], 'no-store');
    });
  });

  test('API در دسترس نیست: ۵۰۲ با بدنهٔ ثابت و بی‌جزئیات داخلی', async () => {
    const { createWebServer } = await import('../apps/web/dist/index.js');
    const { silentLogger } = await import('../packages/shared/dist/index.js');
    const dead = createWebServer({ client: f.client, env: f.env, logger: silentLogger(), assetsDirectory, apiOrigin: 'http://127.0.0.1:1', imageConfigTtlMs: 0 });
    await dead.listen(0, '127.0.0.1');
    try {
      const body = JSON.stringify(sample());
      const result = await new Promise((resolve, reject) => {
        const request = httpRequest(
          { host: '127.0.0.1', port: dead.server.address().port, path: '/api/v1/public/vitals', method: 'POST', headers: { ...json, 'content-length': Buffer.byteLength(body) } },
          (response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => resolve({ status: response.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
          },
        );
        request.on('error', reject);
        request.end(body);
      });
      assert.equal(result.status, 502);
      assert.equal(JSON.parse(result.text).code, 'upstream_unavailable');
      assert.doesNotMatch(result.text, /ECONNREFUSED|127\.0\.0\.1|stack/);
    } finally {
      await dead.close();
    }
  });

  test('قواعد رله: جدول بسته، یک قاعده، فقط POST روی سایت عمومی', () => {
    assert.equal(PROXY_RULES.length, 1);
    assert.ok(matchProxyRule(PROXY_RULES, 'public', 'POST', '/api/v1/public/vitals'));
    assert.equal(matchProxyRule(PROXY_RULES, 'public', 'GET', '/api/v1/public/vitals'), null);
    assert.equal(matchProxyRule(PROXY_RULES, 'public', 'PUT', '/api/v1/public/vitals'), null);
    assert.equal(matchProxyRule(PROXY_RULES, 'panel', 'POST', '/api/v1/public/vitals'), null);
    assert.equal(matchProxyRule(PROXY_RULES, 'public', 'POST', '/api/v1/public/vitals/'), null);
    assert.equal(matchProxyRule(PROXY_RULES, 'public', 'POST', '/api/v1/auth/login'), null);
    assert.equal(PROXY_RULES[0].cookies, false);
  });
});

// ---------------------------------------------------------------------------
describe('خط لولهٔ تصویر: تنظیمات و نشانی (واحد)', () => {
  test('تنظیمات از داده؛ ورودی نامعتبر جزءبه‌جزء به پیش‌فرض برمی‌گردد', () => {
    assert.deepEqual(parseImageConfig(null), DEFAULT_IMAGE_CONFIG);
    assert.deepEqual(parseImageConfig('x'), DEFAULT_IMAGE_CONFIG);
    const custom = parseImageConfig({ widths: [640, 320, 320, 'x', -1, 99999, 1000.5, 1280], output_formats: ['webp', 'gif'], quality: { avif: 999, webp: 60 }, max_pixels: 1, accepted_mime: ['image/png', 'image/svg+xml'] });
    assert.deepEqual(custom.widths, [320, 640, 1280]);
    assert.deepEqual(custom.formats, ['webp']);
    assert.deepEqual(custom.quality, { avif: 50, webp: 60 });
    assert.equal(custom.maxPixels, DEFAULT_IMAGE_CONFIG.maxPixels, 'ورودیِ بی‌معنا');
    assert.deepEqual(custom.acceptedMime, ['image/png'], 'SVG هرگز: سند XML است و می‌تواند اسکریپت داشته باشد');
    assert.equal(parseImageConfig({ widths: Array.from({ length: 40 }, (_, i) => 100 + i) }).widths.length, 12);
  });

  test('عرض‌های مجاز: نردبان تا قبل از اصل + خودِ اصل؛ هرگز بزرگ‌تر از اصل، هرگز بیش از ۷', () => {
    const config = DEFAULT_IMAGE_CONFIG;
    assert.deepEqual(allowedWidths(1600, config), [320, 640, 960, 1280, 1600]);
    assert.deepEqual(allowedWidths(400, config), [320, 400]);
    assert.deepEqual(allowedWidths(320, config), [320]);
    assert.deepEqual(allowedWidths(100, config), [], 'کوچک‌تر از ۱۶۰: نسخه نمی‌ارزد');
    assert.deepEqual(allowedWidths(3000, config), [320, 640, 960, 1280, 1600, 1920, 2560].slice(0, 6).concat(3000));
    assert.ok(allowedWidths(5000, config).length <= 7);
    assert.ok(!allowedWidths(1000, config).some((width) => width > 1000));
  });

  test('نشانی نسخه سخت‌گیرانه است: «تقریباً درست» وجود ندارد', () => {
    const config = DEFAULT_IMAGE_CONFIG;
    const asset = { width: 1600, version: 'abcdef012345' };
    const q = (s) => new URLSearchParams(s);
    assert.equal(parseVariantQuery(q(''), asset, config), null, 'بی‌پارامتر: اصل');
    assert.deepEqual(parseVariantQuery(q('w=640&f=avif&v=abcdef012345'), asset, config), { width: 640, format: 'avif' });
    assert.deepEqual(parseVariantQuery(q('w=1600&f=webp&v=abcdef012345'), asset, config), { width: 1600, format: 'webp' });
    for (const bad of ['w=641&f=avif&v=abcdef012345', 'w=2560&f=avif&v=abcdef012345', 'w=640&f=gif&v=abcdef012345', 'w=640&f=avif&v=000000000000', 'w=640&f=avif', 'w=640&v=abcdef012345', 'f=avif&v=abcdef012345', 'w=abc&f=avif&v=abcdef012345', 'w=0640&f=avif&v=abcdef012345', 'w=-640&f=avif&v=abcdef012345', 'w=640.5&f=avif&v=abcdef012345', 'w=640&f=AVIF&v=abcdef012345', 'v=abcdef012345', 'w=640']) {
      assert.equal(parseVariantQuery(q(bad), asset, config), 'invalid', bad);
    }
    assert.equal(parseVariantQuery(q('w=640&f=avif&v=abcdef012345'), { width: 1600, version: null }, config), 'invalid', 'بدون نسخه (درهم)، نسخه‌ای نیست');
    assert.equal(parseVariantQuery(q('w=640&f=avif&v=abcdef012345'), { width: null, version: 'abcdef012345' }, config), 'invalid');
  });

  test('نسخه از درهم محتوا؛ درهم نامعتبر ⇒ تهی', () => {
    assert.equal(versionOf('A'.repeat(64)), 'a'.repeat(12));
    assert.equal(versionOf(null), null);
    assert.equal(versionOf('short'), null);
    assert.equal(versionOf('g'.repeat(64)), null);
  });

  test('کلید نسخه به محتوا، عرض، قالب و کیفیت گره خورده است', () => {
    const key = variantKey('c'.repeat(64), 640, 'avif', 50);
    assert.match(key, /^[0-9a-f]{64}$/);
    assert.notEqual(key, variantKey('c'.repeat(64), 641, 'avif', 50));
    assert.notEqual(key, variantKey('c'.repeat(64), 640, 'webp', 50));
    assert.notEqual(key, variantKey('c'.repeat(64), 640, 'avif', 51));
    assert.notEqual(key, variantKey('d'.repeat(64), 640, 'avif', 50));
  });

  test('محدودکنندهٔ هم‌زمانی: حداکثر n کار هم‌زمان، بی‌گم‌شدن کار', async () => {
    const limit = createLimiter(2);
    let active = 0;
    let peak = 0;
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        limit(async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 10));
          active -= 1;
          return i;
        }),
      ),
    );
    assert.deepEqual(results, [0, 1, 2, 3, 4, 5, 6, 7]);
    assert.equal(peak, 2);
  });

  test('نشانه‌گذاری `<picture>`: AVIF اول، بعد WebP؛ `<img>` اصلی آخر، با بُعد و اولویت', () => {
    const media = { url: '/media/abc', width: 1600, height: 900, alt: 'x', kind: 'image', assetId: 'abc', mime: 'image/jpeg', version: 'abcdef012345' };
    const engine = { status: () => ({ status: 'configured', engine: 'sharp', libvips: '8' }), transcode: async () => Buffer.alloc(0) };
    const picture = createPicture(DEFAULT_IMAGE_CONFIG, engine);
    const out = picture.picture(media, { alt: 'گربه', className: 'c', loading: 'eager', priority: true, sizes: '50vw' });
    assert.match(out, /^<picture><source type="image\/avif" srcset="[^"]+" sizes="50vw"><source type="image\/webp" srcset="[^"]+" sizes="50vw"><img /);
    assert.match(out, /srcset="\/media\/abc\?w=320&amp;f=avif&amp;v=abcdef012345 320w, \/media\/abc\?w=640/);
    assert.match(out, /<img class="c" src="\/media\/abc" alt="گربه" width="1600" height="900" loading="eager" decoding="async" fetchpriority="high">/);
    // تنبل: بی‌fetchpriority
    assert.doesNotMatch(picture.picture(media, { alt: '', className: 'c', loading: 'lazy' }), /fetchpriority/);
    // alt خالی (تزئینی) همچنان چاپ می‌شود، نه حذف.
    assert.match(picture.picture(media, { alt: '', className: 'c', loading: 'lazy' }), /alt=""/);
  });

  test('بی‌موتور یا تصویر ناشایست: `<img>` ساده (بی‌نشانیِ ناسروشدنی)', () => {
    const media = { url: '/media/abc', width: 1600, height: 900, alt: 'x', kind: 'image', assetId: 'abc', mime: 'image/jpeg', version: 'abcdef012345' };
    const options = { alt: 'a', className: 'c', loading: 'lazy' };
    const none = createPicture(DEFAULT_IMAGE_CONFIG, unavailableEngine('sharp_not_installed'));
    assert.doesNotMatch(none.picture(media, options), /picture|srcset|\?w=/);
    assert.deepEqual(none.status(), { status: 'not_configured', reason: 'sharp_not_installed' });

    const engine = { status: () => ({ status: 'configured', engine: 'sharp', libvips: '8' }), transcode: async () => Buffer.alloc(0) };
    const ready = createPicture(DEFAULT_IMAGE_CONFIG, engine);
    for (const ineligible of [
      { ...media, mime: 'image/gif' },
      { ...media, mime: 'image/svg+xml' },
      { ...media, version: null },
      { ...media, assetId: undefined },
      { ...media, width: 100 },
      { ...media, kind: 'video' },
    ]) {
      assert.doesNotMatch(ready.picture(ineligible, options), /<picture|srcset/, JSON.stringify(ineligible));
    }
  });
});

// ---------------------------------------------------------------------------
describe('خط لولهٔ تصویر: AVIF/WebP واقعی با sharp واقعی', () => {
  let jpeg;
  let png;
  let asset;
  let pngAsset;

  /** تصویر با جزئیات (نویز + شیب)، تا AVIF/WebP واقعاً از JPEG کوچک‌تر شود. */
  async function photo(width, height, format, withExif = false) {
    const raw = Buffer.alloc(width * height * 3);
    let seed = 12345;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        const noise = (seed >>> 24) & 31;
        const i = (y * width + x) * 3;
        raw[i] = Math.min(255, Math.floor((x / width) * 200) + noise);
        raw[i + 1] = Math.min(255, Math.floor((y / height) * 200) + noise);
        raw[i + 2] = Math.min(255, 90 + noise * 2);
      }
    }
    let pipeline = sharp(raw, { raw: { width, height, channels: 3 } });
    if (withExif) pipeline = pipeline.withExif({ IFD0: { Copyright: 'پتاوو-آزمون', ImageDescription: 'GPS-LEAK-CHECK' } });
    return format === 'png' ? pipeline.png().toBuffer() : pipeline.jpeg({ quality: 92 }).toBuffer();
  }

  const variant = (id, version, w, format) => `/media/${id}?w=${w}&f=${format}&v=${version}`;
  const variantsDir = () => `${f.storageDir}.variants`;
  const countCached = () => {
    let total = 0;
    const walk = (dir) => {
      try {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) walk(full);
          else if (!name.endsWith('.tmp')) total += 1;
        }
      } catch {
        // هنوز نیست
      }
    };
    walk(variantsDir());
    return total;
  };

  before(async () => {
    jpeg = await photo(1600, 1000, 'jpeg', true);
    png = await photo(800, 500, 'png');
    asset = await f.createImageAsset({ bytes: jpeg, mime: 'image/jpeg', width: 1600, height: 1000, alt: 'نمای فروشگاه' });
    pngAsset = await f.createImageAsset({ bytes: png, mime: 'image/png', width: 800, height: 500 });
  });

  test('وضعیت صریح: موتور `configured` است و نسخهٔ libvips را می‌گوید', async () => {
    const status = await f.web.imagePipelineStatus();
    assert.equal(status.status, 'configured');
    assert.equal(status.engine, 'sharp');
    assert.match(status.libvips, /^\d+\.\d+/);
  });

  test('AVIF واقعی: بُعد درست، کوچک‌تر از JPEG، سرصفحه‌های تغییرناپذیر', async () => {
    const response = await f.web.render({ method: 'GET', url: variant(asset.id, asset.version, 640, 'avif'), host: 'localhost:3000' });
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'image/avif');
    assert.match(response.headers['cache-control'], /public, max-age=31536000, immutable/);
    assert.match(response.headers.etag, /^"[0-9a-f]{64}"$/);
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['content-length'], String(response.bytes.length));
    assert.equal(response.bytes.subarray(4, 12).toString('latin1'), 'ftypavif', 'جعبهٔ AVIF واقعی');
    const meta = await sharp(response.bytes).metadata();
    assert.equal(meta.format, 'heif');
    assert.equal(meta.width, 640);
    assert.equal(meta.height, 400, 'نسبت ابعاد حفظ می‌شود');
    assert.ok(response.bytes.length < jpeg.length / 3, `AVIF ${response.bytes.length} در برابر JPEG ${jpeg.length}`);
  });

  test('WebP واقعی، و PNG هم قابل‌تبدیل است', async () => {
    const webp = await f.web.render({ method: 'GET', url: variant(asset.id, asset.version, 960, 'webp'), host: 'localhost:3000' });
    assert.equal(webp.status, 200);
    assert.equal(webp.headers['content-type'], 'image/webp');
    assert.equal(webp.bytes.subarray(0, 4).toString('latin1'), 'RIFF');
    assert.equal(webp.bytes.subarray(8, 12).toString('latin1'), 'WEBP');
    assert.equal((await sharp(webp.bytes).metadata()).width, 960);

    const fromPng = await f.web.render({ method: 'GET', url: variant(pngAsset.id, pngAsset.version, 320, 'webp'), host: 'localhost:3000' });
    assert.equal(fromPng.status, 200);
    assert.equal((await sharp(fromPng.bytes).metadata()).width, 320);
  });

  test('عرض اصل مجاز است و بزرگ‌تر از اصل هرگز؛ جهش عرضِ نردبانی ۴۰۴', async () => {
    const same = await f.web.render({ method: 'GET', url: variant(asset.id, asset.version, 1600, 'webp'), host: 'localhost:3000' });
    assert.equal(same.status, 200);
    assert.equal((await sharp(same.bytes).metadata()).width, 1600);
    for (const bad of [
      variant(asset.id, asset.version, 2560, 'webp'), // بزرگ‌تر از اصل
      variant(asset.id, asset.version, 641, 'webp'), // خارج از نردبان
      variant(asset.id, asset.version, 640, 'gif'),
      variant(asset.id, 'deadbeefdead', 640, 'avif'), // نسخهٔ کهنه/جعلی
      `/media/${asset.id}?w=640&f=avif`, // بی‌نسخه
      `/media/${asset.id}?w=640`,
      `/media/${asset.id}?f=avif`,
    ]) {
      const response = await f.web.render({ method: 'GET', url: bad, host: 'localhost:3000' });
      assert.equal(response.status, 404, bad);
      assert.equal(response.body.trim(), 'media not found');
    }
  });

  test('ابرداده (EXIF/توضیح) در نسخه نمی‌ماند؛ نسخه جهتِ درست را اعمال می‌کند', async () => {
    const original = await sharp(jpeg).metadata();
    assert.ok(original.exif, 'مقدمه: JPEG اصلی EXIF دارد');
    for (const format of ['avif', 'webp']) {
      const response = await f.web.render({ method: 'GET', url: variant(asset.id, asset.version, 320, format), host: 'localhost:3000' });
      const meta = await sharp(response.bytes).metadata();
      assert.equal(meta.exif, undefined, `${format}: EXIF نباید بماند`);
      assert.ok(!response.bytes.includes(Buffer.from('GPS-LEAK-CHECK')), `${format}: متن ابرداده نباید بماند`);
    }
  });

  test('نسخه یک‌بار ساخته می‌شود: بار دوم از انبار دیسک، با همان بایت‌ها', async () => {
    const url = variant(asset.id, asset.version, 1280, 'avif');
    const before = countCached();
    const first = await f.web.render({ method: 'GET', url, host: 'localhost:3000' });
    const afterFirst = countCached();
    const second = await f.web.render({ method: 'GET', url, host: 'localhost:3000' });
    assert.equal(afterFirst, before + 1);
    assert.equal(countCached(), afterFirst, 'بار دوم فایل تازه نمی‌سازد');
    assert.ok(first.bytes.equals(second.bytes));
    assert.equal(first.headers.etag, second.headers.etag);
  });

  test('درخواست هم‌زمان برای یک نسخه، یک تبدیل می‌شود (coalesce)', async () => {
    let calls = 0;
    const { createWebServer } = await import('../apps/web/dist/index.js');
    const { silentLogger } = await import('../packages/shared/dist/index.js');
    const { loadImageEngine } = await import('../apps/web/dist/imagepipeline.js');
    const real = await loadImageEngine(silentLogger());
    const counting = {
      status: () => real.status(),
      transcode: async (...args) => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 30));
        return real.transcode(...args);
      },
    };
    const server = createWebServer({
      client: f.client,
      env: f.env,
      logger: silentLogger(),
      assetsDirectory,
      imageConfigTtlMs: 0,
      imageEngine: counting,
      variantsDirectory: `${variantsDir()}-coalesce`,
    });
    const url = variant(asset.id, asset.version, 960, 'avif');
    const results = await Promise.all(Array.from({ length: 8 }, () => server.render({ method: 'GET', url, host: 'localhost:3000' })));
    assert.equal(calls, 1, `۸ درخواست هم‌زمان باید ۱ تبدیل بسازد، ${calls} شد`);
    assert.ok(results.every((result) => result.status === 200 && result.bytes.equals(results[0].bytes)));
  });

  test('ناسالم‌ها همان ۴۰۴ یکنواخت‌اند: فایل ناموجود، دارایی غیرتصویر، GIF، دادهٔ خراب', async () => {
    // فایل روی دیسک نیست.
    const ghost = await f.sudo(
      `insert into media.asset (storage_key, driver, detected_mime, kind, size_bytes, checksum_sha256, width, height, is_public, status, scan_status)
       values ('img/zz/ghost-file', 'local', 'image/jpeg', 'image', 10, $1, 1000, 600, true, 'ready', 'clean') returning id`,
      ['a'.repeat(64)],
    );
    assert.equal((await f.web.render({ method: 'GET', url: variant(ghost[0].id, 'a'.repeat(12), 640, 'avif'), host: 'localhost:3000' })).status, 404);

    // GIF: متحرک، شایستهٔ تبدیل نیست.
    const gif = await f.createImageAsset({ bytes: Buffer.from('GIF89a-not-a-real-gif'), mime: 'image/gif', width: 1000, height: 600 });
    assert.equal((await f.web.render({ method: 'GET', url: variant(gif.id, gif.version, 640, 'avif'), host: 'localhost:3000' })).status, 404);

    // JPEG که JPEG نیست (رمزگشایی نمی‌شود): ۴۰۴، نه ۵۰۰ و نه نشت پیام.
    const corrupt = await f.createImageAsset({ bytes: Buffer.from('this is definitely not a jpeg '.repeat(40)), mime: 'image/jpeg', width: 1000, height: 600 });
    const bad = await f.web.render({ method: 'GET', url: variant(corrupt.id, corrupt.version, 640, 'webp'), host: 'localhost:3000' });
    assert.equal(bad.status, 404);
    assert.doesNotMatch(bad.body, /sharp|vips|Input buffer|unsupported/i);

    // دارایی ناموجود.
    assert.equal((await f.web.render({ method: 'GET', url: variant('00000000-0000-4000-8000-000000000000', 'abcdef012345', 640, 'avif'), host: 'localhost:3000' })).status, 404);
  });

  test('بمب فشرده‌سازی: تصویری که از سقف پیکسل بزرگ‌تر است، رد می‌شود (۴۰۴)', async () => {
    // PNG سادهٔ ۳۰۰۰×۳۰۰۰ (۹ میلیون پیکسل) ولی کوچک‌بایت؛ سقف را به ۵ میلیون پیکسل می‌کشیم.
    const flat = await sharp({ create: { width: 3000, height: 3000, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png({ compressionLevel: 9 }).toBuffer();
    const bomb = await f.createImageAsset({ bytes: flat, mime: 'image/png', width: 3000, height: 3000, name: 'bomb' });
    const previous = (await f.sudo(`select value from ops.setting where business_id is null and key = 'platform.image_pipeline'`))[0].value;
    await f.sudo(`update ops.setting set value = value || '{"max_pixels": 5000000}'::jsonb where business_id is null and key = 'platform.image_pipeline'`);
    try {
      assert.ok(flat.length < 50_000, `بدنهٔ بمب ${flat.length} بایت`);
      const response = await f.web.render({ method: 'GET', url: variant(bomb.id, bomb.version, 640, 'avif'), host: 'localhost:3000' });
      assert.equal(response.status, 404);
    } finally {
      await f.sudo(`update ops.setting set value = $1::jsonb where business_id is null and key = 'platform.image_pipeline'`, [JSON.stringify(previous)]);
    }
  });

  test('اصل بدون پارامتر همان‌طور سرو می‌شود (بایت‌به‌بایت، ETag درهم محتوا)', async () => {
    const response = await f.web.render({ method: 'GET', url: `/media/${asset.id}`, host: 'localhost:3000' });
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'image/jpeg');
    assert.ok(response.bytes.equals(jpeg));
    assert.equal(response.headers.etag, `"${asset.checksum}"`);
  });

  test('نسخه‌ها روی میزبان‌های مدیریتی هم وجود ندارند', async () => {
    const response = await f.web.render({ method: 'GET', url: variant(asset.id, asset.version, 640, 'avif'), host: 'panel.localhost:3000' });
    assert.equal(response.status, 404);
  });

  test('صفحهٔ واقعی: `<picture>` با AVIF/WebP، بُعد، `eager`+`fetchpriority` برای LCP و `lazy` برای بقیه', async () => {
    await f.publishDesignPage({
      key: 'home',
      tree: {
        version: 1,
        root: [
          { id: 'h', component: 'content.hero', props: { title: 'پتاوو', layout: 'split' }, slots: { media: [] } },
          { id: 'i1', component: 'media.image', props: { alt: 'تصویر نخست', assetId: asset.id, loading: 'eager' } },
          { id: 'i2', component: 'media.image', props: { alt: 'تصویر دوم', assetId: pngAsset.id } },
        ],
      },
    });
    const { body } = await f.page('/');
    const pictures = [...body.matchAll(/<picture>[\s\S]*?<\/picture>/g)].map((match) => match[0]);
    assert.equal(pictures.length, 2);

    const first = pictures.find((picture) => picture.includes(`/media/${asset.id}`));
    assert.match(first, /<source type="image\/avif" srcset="\/media\/[^"]+ 320w/);
    assert.match(first, /<source type="image\/webp"/);
    assert.match(first, /width="1600" height="1000" loading="eager" decoding="async" fetchpriority="high"/);
    assert.match(first, new RegExp(`v=${asset.version}`));

    const second = pictures.find((picture) => picture.includes(`/media/${pngAsset.id}`));
    assert.match(second, /loading="lazy"/);
    assert.doesNotMatch(second, /fetchpriority/);
    // پیش‌ساخت‌شدهٔ AVIF روی نشانیِ چاپ‌شده واقعاً سرو می‌شود (نشانیِ چاپ‌شده، نشانیِ سروشدنی است).
    const src = /<source type="image\/avif" srcset="([^"]+)"/.exec(first)[1].split(',')[1].trim().split(' ')[0].replaceAll('&amp;', '&');
    assert.equal((await f.web.render({ method: 'GET', url: src, host: 'localhost:3000' })).status, 200);
  });

  test('سنجش بودجه با تصویر: نخستین‌نما فقط گزینهٔ AVIF موبایل را می‌شمارد، نه اصل را', async () => {
    const report = await measurePage({ path: '/', origin: 'http://localhost:3000', fetch: (path) => fetchResource(path) });
    const images = report.resources.filter((resource) => resource.kind === 'image');
    assert.equal(images.length, 1, 'فقط تصویر eager (دومی lazy است)');
    assert.match(images[0].path, /f=avif/);
    assert.ok(images[0].bytes < jpeg.length / 2, `AVIF سروشده ${images[0].bytes} در برابر JPEG ${jpeg.length}`);
    assert.ok(report.measurement.image_kb > 0);
    const [{ v }] = await f.sudo(`select ops.check_budget('/', $1::jsonb) as v`, [JSON.stringify(report.measurement)]);
    assert.equal(v.verdict, 'pass');
    await f.sudo(`delete from design.page where key = 'home' and business_id is null`);
  });

  test('تنظیمات از داده: نردبان و قالب‌ها را مدیر عوض می‌کند', async () => {
    await f.sudo(`update ops.setting set value = value || '{"widths":[400,800],"output_formats":["webp"]}'::jsonb where business_id is null and key = 'platform.image_pipeline'`);
    try {
      assert.equal((await f.web.render({ method: 'GET', url: variant(asset.id, asset.version, 800, 'webp'), host: 'localhost:3000' })).status, 200);
      assert.equal((await f.web.render({ method: 'GET', url: variant(asset.id, asset.version, 800, 'avif'), host: 'localhost:3000' })).status, 404, 'AVIF خاموش شد');
      assert.equal((await f.web.render({ method: 'GET', url: variant(asset.id, asset.version, 640, 'webp'), host: 'localhost:3000' })).status, 404, 'خارج از نردبانِ تازه');
    } finally {
      await f.sudo(`update ops.setting set value = value || '{"widths":[320,640,960,1280,1600,1920,2560],"output_formats":["avif","webp"]}'::jsonb where business_id is null and key = 'platform.image_pipeline'`);
    }
  });
});

describe('خط لولهٔ تصویر: وقتی موتور نیست، صادقانه (PART 102)', () => {
  let bare;
  before(async () => {
    bare = await createFixture({ storage: true, imageEngine: unavailableEngine('sharp_not_installed') });
  });
  after(async () => {
    await bare?.close();
  });

  test('وضعیت `not_configured` با دلیل؛ نه خطا، نه جعل', async () => {
    assert.deepEqual(await bare.web.imagePipelineStatus(), { status: 'not_configured', reason: 'sharp_not_installed' });
  });

  test('صفحه `<img>` ساده می‌دهد (بی‌`<picture>`، بی‌نشانیِ ناسروشدنی) و نسخه ۴۰۴ است', async () => {
    const bytes = await sharp({ create: { width: 800, height: 500, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toBuffer();
    const asset = await bare.createImageAsset({ bytes, mime: 'image/jpeg', width: 800, height: 500 });
    await bare.publishDesignPage({
      key: 'home',
      tree: { version: 1, root: [{ id: 'i', component: 'media.image', props: { alt: 'x', assetId: asset.id, loading: 'eager' } }] },
    });
    const { body } = await bare.page('/');
    assert.doesNotMatch(body, /<picture|srcset|\?w=/);
    assert.match(body, new RegExp(`<img[^>]*src="/media/${asset.id}"[^>]*width="800" height="500"`));
    const variantUrl = `/media/${asset.id}?w=640&f=avif&v=${asset.version}`;
    assert.equal((await bare.web.render({ method: 'GET', url: variantUrl, host: 'localhost:3000' })).status, 404);
    // اصل سالم سرو می‌شود: نبودِ موتور، تصویر را نمی‌شکند.
    assert.equal((await bare.web.render({ method: 'GET', url: `/media/${asset.id}`, host: 'localhost:3000' })).status, 200);
  });
});

// ---------------------------------------------------------------------------
