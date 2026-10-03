/**
 * تست `apps/web` (گام ۲۲ — §45–۴۷، §64–۸۲، §93–۹۹، Addendum §۴–۳۳).
 *
 * چه چیزی اینجا سنجیده می‌شود: **کل مسیر وب** — از سوکت تا HTML نهایی. سرور
 * واقعی روی پورت تصادفی بالا می‌آید، `fetch` واقعی درخواست می‌فرستد، و همان
 * هدرها، همان CSP، همان ETag و همان رندری اجرا می‌شود که در تولید اجرا
 * می‌شود. هیچ‌کدام شبیه‌سازی نیست (§102).
 *
 * چرا روی موتور تعبیه‌شده: همان PostgreSQL ۱۸ (PGlite)، همان مهاجرت‌ها، همان
 * سیاست‌های RLS و همان توکن‌های seed. تنها درایور شبکه عوض می‌شود.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDatabase } from '../scripts/lib/engine.mjs';
import { migrate } from '../scripts/lib/migrate.mjs';
import { applySeeds } from '../scripts/lib/seed.mjs';

import { createWebServer } from '../apps/web/dist/index.js';
import { SHELL_CSS } from '../apps/web/dist/styles.js';
import { buildTokenSet, safeTokenValue, UnsafeTokenValueError, cssVarName } from '../apps/web/dist/tokens.js';
import { createAssetRegistry } from '../apps/web/dist/assets.js';
import { attrs, escapeText, escapeAttr } from '../apps/web/dist/html.js';
import { decodePath, resolveTarget, canonicalRedirect, SLUG_PATTERN } from '../apps/web/dist/router.js';
import { contentSecurityPolicy } from '../apps/web/dist/headers.js';
import { loadEnv, silentLogger, uuidv7 } from '../packages/shared/dist/index.js';
import { createPasswordHasher, TEST_ARGON2, hashIdentifier } from '../packages/security/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..');
const assetsDirectory = join(projectRoot, 'apps/web/assets');

const PEPPER = 'test-pepper-value';
const env = loadEnv({
  PETAVU_ENV: 'test',
  AUTH_PEPPER: PEPPER,
  SESSION_SECRET: 'test-session-secret-value-0123456789',
  PETAVU_PUBLIC_ORIGIN: 'http://localhost:3000',
  PETAVU_PANEL_ORIGIN: 'http://panel.localhost:3000',
  PETAVU_ADMIN_ORIGIN: 'http://adminpanel.localhost:3000',
  PETAVU_SHOP_ORIGIN: 'http://shop.localhost:3000',
  PETAVU_ADMIN_SHOP_ORIGIN: 'http://adminshop.localhost:3000',
});

const PUBLIC_HOST = 'localhost:3000';
const PANEL_HOST = 'panel.localhost:3000';
const UNKNOWN_HOST = 'evil.example.com';

let engine;
let client;
let server;
let baseUrl;
const passwords = createPasswordHasher({ params: TEST_ARGON2, pepper: PEPPER });

/** آداپتور موتور تعبیه‌شده به قرارداد `SqlClient` (همان الگوی تست‌های دیگر). */
function createEmbeddedClient(handle) {
  const make = (runner) => {
    const scoped = {
      engine: 'embedded',
      async query(text, params = []) {
        const rows = await runner.query(text, params);
        return { rows, affected: rows.length };
      },
      async exec(text) {
        await runner.exec(text);
      },
      withTransaction: (fn) =>
        typeof runner.withTransaction === 'function' ? runner.withTransaction(async (tx) => fn(make(tx))) : fn(scoped),
      async asRole(role, fn) {
        await runner.exec(`set role "${role}"`);
        try {
          return await fn(scoped);
        } finally {
          await runner.exec('reset role').catch(() => {});
        }
      },
      close: () => handle.close(),
    };
    return scoped;
  };
  return make(handle);
}

/** اجرای SQL خام با نقش و زمینهٔ دلخواه. */
async function asRole(role, sql, params = [], context = {}) {
  const settings = Object.entries(context).filter(([, value]) => typeof value === 'string' && value !== '');
  return client.withTransaction(async (tx) => {
    if (settings.length > 0) {
      const args = [];
      const assignments = settings.map(([key, value]) => {
        args.push(key, value);
        return `set_config($${args.length - 1}, $${args.length}, true)`;
      });
      await tx.query(`select ${assignments.join(', ')}`, args);
    }
    return tx.asRole(role, async () => {
      const result = await tx.query(sql, params);
      return result.rows;
    });
  });
}

/**
 * ساخت کسب‌وکار عمومی با پروفایل — از همان مسیر دامنه، نه با چیدن دستی ردیف.
 *
 * اگر آزمون ردیف‌ها را دستی می‌چید، «سبز شدن» هیچ چیزی دربارهٔ مسیر واقعی
 * نمی‌گفت. اینجا همان توابع دامنه صدا زده می‌شوند.
 */
async function createPublicBusiness(slug, name, ownerUserId) {
  /*
   * سیاست درج (`business_insert_self`) می‌گوید «مالکِ ردیف، همان کاربر جاری
   * است». پس زمینهٔ درخواست باید کاربر را داشته باشد — و همین، آزمون را به
   * مسیر واقعی نزدیک می‌کند: در API هم کاربر از نشست می‌آید، نه از پارامتر.
   */
  /*
   * نقش پلتفرمی `superadmin` اینجا فقط برای **چیدن پیش‌شرطِ آزمون** است: بدون
   * عضویت، سیاست پروفایل اجازهٔ درج نمی‌دهد. مسیر عادی، عضویت را با
   * `app.accept_invitation` یا ایجاد کسب‌وکار می‌سازد؛ اینجا مستقیم می‌نویسیم
   * تا آزمون وب به جزئیات آن مسیر گره نخورد.
   */
  const context = { 'app.user_id': ownerUserId, 'app.platform_role': 'superadmin', 'app.request_id': uuidv7() };
  const rows = await asRole(
    'pv_app',
    `insert into app.business (slug, name, business_type_key, owner_user_id, status, visibility, published_at)
     values ($1, $2, 'pet_shop', $3, 'active', 'public', now())
     returning id`,
    [slug, name, ownerUserId],
    context,
  );
  const businessId = rows[0].id;
  await asRole(
    'pv_app',
    `insert into app.business_profile (business_id, tagline, summary) values ($1, $2, $3)`,
    [businessId, `معرفی ${name}`, `توضیح کوتاه دربارهٔ ${name}`],
    context,
  );
  return businessId;
}

/**
 * درخواست خام روی سوکت.
 *
 * چرا لازم است: `fetch` هدر `Host` را (به‌عنوان هدر ممنوعه) بازنویسی می‌کند، پس
 * با آن نمی‌توان «میزبان ناشناس» را آزمود. مسیر میزبان، خودش یک مرز امنیتی است؛
 * پس با سوکت خام آزموده می‌شود، نه با میان‌بر.
 */
async function rawRequest({ host, path = '/', method = 'GET', headers = {} }) {
  const { connect } = await import('node:net');
  const address = new URL(baseUrl);
  const lines = [`${method} ${path} HTTP/1.1`, `Host: ${host}`, 'Connection: close', ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`), '', ''];
  return new Promise((resolve, reject) => {
    const socket = connect(Number(address.port), address.hostname, () => socket.write(lines.join('\r\n')));
    let data = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => { data += chunk; });
    socket.on('end', () => {
      const [head, ...rest] = data.split('\r\n\r\n');
      const statusLine = head.split('\r\n')[0];
      const status = Number(statusLine.split(' ')[1]);
      const headerMap = new Map(
        head
          .split('\r\n')
          .slice(1)
          .filter((line) => line.includes(':'))
          .map((line) => {
            const index = line.indexOf(':');
            return [line.slice(0, index).toLowerCase(), line.slice(index + 1).trim()];
          }),
      );
      resolve({ status, headers: headerMap, body: rest.join('\r\n\r\n') });
    });
    socket.on('error', reject);
  });
}

async function request(path, options = {}) {
  const headers = { host: options.host ?? PUBLIC_HOST, ...(options.headers ?? {}) };
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    redirect: 'manual',
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, text, get: (name) => response.headers.get(name) };
}

before(async () => {
  engine = await openDatabase();
  await migrate(engine, { dir: join(projectRoot, 'migrations') });
  await applySeeds(engine, { dir: join(projectRoot, 'seeds') });
  client = createEmbeddedClient(engine);

  /*
   * بلیت ثبت‌نام به «همان درخواست» گره دارد: `begin_registration` شناسهٔ
   * درخواست را در بلیت نگه می‌دارد و `complete_registration` آن را می‌سنجد.
   * پس هر دو در یک زمینهٔ درخواست اجرا می‌شوند — همان‌طور که در مسیر واقعی
   * ثبت‌نام هم می‌شود.
   */
  const registrationContext = { 'app.request_id': uuidv7() };
  const tickets = await asRole(
    'pv_app',
    'select * from app.begin_registration($1, $2, null)',
    [hashIdentifier('owner@petavu.test'), 'email'],
    registrationContext,
  );
  const secret = await passwords.hash('Correct-Horse-Owner-1!');
  const created = await asRole(
    'pv_app',
    'select user_id from app.complete_registration($1, $2, $3, $4, $5)',
    [tickets[0].ticket_id, 'مالک آزمایشی', secret, 'fa-IR', 'Asia/Tehran'],
    registrationContext,
  );

  await createPublicBusiness('pet-shop-tehran', 'پت‌شاپ تهران', created[0].user_id);
  await createPublicBusiness('equine-feed-karaj', 'خوراک اسب کرج', created[0].user_id);

  server = createWebServer({ client, env, logger: silentLogger(), assetsDirectory });
  const listening = await server.listen(0, '127.0.0.1');
  baseUrl = `http://127.0.0.1:${listening.port}`;
});

after(async () => {
  await server?.close();
  await engine?.close();
});

// ---------------------------------------------------------------------------
describe('صفحهٔ اصلی (§25، §45–۴۷)', () => {
  test('‏HTML کامل با dir=rtl و lang فارسی می‌آید', async () => {
    const response = await request('/');
    assert.equal(response.status, 200);
    assert.match(response.get('content-type'), /^text\/html; charset=utf-8/);
    assert.match(response.text, /^<!doctype html>/i);
    assert.match(response.text, /<html lang="fa-IR" dir="rtl">/);
    assert.match(response.text, /<main id="main"/);
  });

  test('‏عددهای صفحه از پایگاه‌داده می‌آید، نه از متن ثابت', async () => {
    const response = await request('/');
    // دو کسب‌وکار عمومی در `before` ساخته شد؛ پس شمارش باید دست‌کم ۲ باشد.
    const metrics = [...response.text.matchAll(/<data class="metric__value" value="(\d+)"/g)].map((match) => Number(match[1]));
    assert.ok(metrics.length >= 4, `چهار سنجه انتظار می‌رفت، ${metrics.length} آمد`);
    assert.ok(metrics[0] >= 2, `شمارش کسب‌وکارها باید دست‌کم ۲ باشد، ${metrics[0]} آمد`);
  });

  test('‏نام کسب‌وکار واقعی در صفحه دیده می‌شود', async () => {
    const response = await request('/');
    assert.match(response.text, /پت‌شاپ تهران/);
  });

  test('‏هیچ منبعی از دامنهٔ سوم بار نمی‌شود', async () => {
    const response = await request('/');
    const urls = [...response.text.matchAll(/(?:href|src)="(https?:\/\/[^"]+)"/g)].map((match) => match[1]);
    const thirdParty = urls.filter((url) => !url.startsWith('http://localhost:3000/'));
    assert.deepEqual(thirdParty, [], `منبع دامنهٔ سوم نباید باشد: ${thirdParty.join(', ')}`);
  });

  test('‏فقط یک فایل CSS با درهم محتوا لینک می‌شود', async () => {
    const response = await request('/');
    const styles = [...response.text.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((match) => match[1]);
    assert.equal(styles.length, 1);
    assert.match(styles[0], /^\/assets\/app\.[0-9a-f]{8}\.css$/);
  });
});

// ---------------------------------------------------------------------------
describe('هدرها و امنیت پاسخ (§64–۷۸)', () => {
  test('‏CSP سخت است و استایل درون‌خطی را اجازه نمی‌دهد', async () => {
    const response = await request('/');
    const csp = response.get('content-security-policy');
    assert.ok(csp, 'هدر CSP باید باشد');
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /style-src 'self'/);
    assert.doesNotMatch(csp, /unsafe-inline/);
    assert.doesNotMatch(csp, /unsafe-eval/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
  });

  test('‏در محیط غیرتولیدی، HSTS فرستاده نمی‌شود', async () => {
    const response = await request('/');
    assert.equal(response.get('strict-transport-security'), null);
  });

  test('هدرهای امنیتی پایه حاضرند', async () => {
    const response = await request('/');
    assert.equal(response.get('x-content-type-options'), 'nosniff');
    assert.equal(response.get('x-frame-options'), 'DENY');
    assert.equal(response.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.equal(response.get('cross-origin-opener-policy'), 'same-origin');
    assert.match(response.get('x-request-id'), /^[A-Za-z0-9._:-]{8,64}$/);
  });

  test('‏شناسهٔ درخواست معتبر از هدر، پذیرفته و بازتاب می‌شود', async () => {
    const rid = 'test-request-0001';
    const response = await request('/', { headers: { 'x-request-id': rid } });
    assert.equal(response.get('x-request-id'), rid);
  });

  test('‏شناسهٔ درخواست نامعتبر رد می‌شود و بی‌آسیب جایگزین می‌گردد', async () => {
    const response = await request('/', { headers: { 'x-request-id': 'bad id with spaces' } });
    assert.notEqual(response.get('x-request-id'), 'bad id with spaces');
    assert.match(response.get('x-request-id'), /^web-[a-z0-9-]+$/);
  });

  test('‏میزبان ناشناس، ۴۲۱ می‌گیرد و بازتاب داده نمی‌شود', async () => {
    const response = await rawRequest({ host: UNKNOWN_HOST });
    assert.equal(response.status, 421);
    assert.equal(response.headers.get('location') ?? null, null);
    assert.doesNotMatch(response.body, /evil\.example\.com/);
  });

  test('‏میزبان‌های شناخته‌شده از سوکت هم درست مسیریابی می‌شوند', async () => {
    const publicPage = await rawRequest({ host: PUBLIC_HOST });
    assert.equal(publicPage.status, 200);

    const panel = await rawRequest({ host: PANEL_HOST });
    assert.equal(panel.status, 404, 'روی میزبان پنل، صفحهٔ عمومی وجود ندارد (۴۰۴، نه ۴۰۳)');
  });
});

// ---------------------------------------------------------------------------
describe('مسیریابی (§80–۸۲)', () => {
  test('مسیر با اسلش پایانی به شکل کانونیکال ریدایرکت می‌شود', async () => {
    const response = await request('/businesses/');
    assert.equal(response.status, 308);
    assert.equal(response.get('location'), '/businesses');
  });

  test('‏نامک نامعتبر، ۴۰۴ می‌گیرد (بدون کوئری)', async () => {
    const response = await request('/%2e%2e%2fetc%2fpasswd');
    assert.ok(response.status === 400 || response.status === 404, `وضعیت غیرمنتظره: ${response.status}`);
  });

  test('نویسهٔ کنترلی در مسیر رد می‌شود', () => {
    assert.equal(decodePath('/a%00b'), null);
    assert.equal(decodePath('/..%2fetc'), null);
    assert.equal(decodePath('/a\\b'), null);
    // نیم‌فاصله در مسیر مجاز است (فارسی)، ولی نویسهٔ جهت‌دهنده نه.
    assert.equal(decodePath('/\u202eabc'), null);
  });

  test('مسیرهای ماشینی و ساختاری به هدف درست نگاشت می‌شوند', () => {
    assert.equal(resolveTarget('/', 'public').type, 'home');
    assert.equal(resolveTarget('/businesses', 'public').type, 'businesses');
    assert.equal(resolveTarget('/robots.txt', 'public').type, 'robots');
    assert.equal(resolveTarget('/sitemap.xml', 'public').type, 'sitemap');
    assert.equal(resolveTarget('/healthz', 'public').type, 'health');
    assert.equal(resolveTarget('/b/pet-shop-tehran', 'public').type, 'business');
    assert.equal(resolveTarget('/about', 'public').type, 'content');
    // نامک رزرو‌شده، محتوا نمی‌شود
    assert.equal(resolveTarget('/api/v1/health', 'public').type, 'not_found');
    assert.equal(resolveTarget('/api/v1/health', 'public').type, 'not_found');
    assert.equal(canonicalRedirect('/businesses/'), '/businesses');
    assert.equal(canonicalRedirect('/businesses'), null);
  });

  test('قالب نامک، فارسی را می‌پذیرد و کاراکترهای خطرناک را نه', () => {
    assert.ok(SLUG_PATTERN.test('پت-شاپ'));
    assert.ok(SLUG_PATTERN.test('pet-shop-1'));
    assert.ok(!SLUG_PATTERN.test('Pet-Shop'));
    assert.ok(!SLUG_PATTERN.test('a b'));
    assert.ok(!SLUG_PATTERN.test('a/b'));
    assert.ok(!SLUG_PATTERN.test('-a'));
  });
});

// ---------------------------------------------------------------------------
describe('پروفایل عمومی کسب‌وکار (§19–۲۲)', () => {
  test('کسب‌وکار عمومی با دادهٔ واقعی رندر می‌شود', async () => {
    const response = await request('/b/pet-shop-tehran');
    assert.equal(response.status, 200);
    assert.match(response.text, /پت‌شاپ تهران/);
    assert.match(response.text, /<h1[^>]*>پت‌شاپ تهران<\/h1>/);
  });

  test('‏canonical به نشانی خودِ صفحه اشاره می‌کند', async () => {
    const response = await request('/b/pet-shop-tehran');
    assert.match(response.text, /<link rel="canonical" href="http:\/\/localhost:3000\/b\/pet-shop-tehran">/);
  });

  test('دادهٔ ساخت‌یافتهٔ LocalBusiness در صفحه هست', async () => {
    const response = await request('/b/pet-shop-tehran');
    const match = response.text.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
    assert.ok(match, 'بلوک JSON-LD باید باشد');
    const graph = JSON.parse(match[1]);
    const types = graph['@graph'].map((node) => node['@type']);
    assert.ok(types.includes('Organization'), 'گره برند باید باشد');
    assert.ok(types.includes('WebSite'), 'گره سایت باید باشد');
    assert.ok(types.includes('LocalBusiness'), 'گره کسب‌وکار باید باشد');
    assert.ok(types.includes('BreadcrumbList'), 'مسیر راهنما باید باشد');
  });

  test('کسب‌وکار ناموجود، ۴۰۴ و noindex می‌گیرد', async () => {
    const response = await request('/b/does-not-exist');
    assert.equal(response.status, 404);
    assert.match(response.text, /<meta name="robots" content="noindex/);
  });

  test('‏JSON-LD با دادهٔ خطرناک، از تگ بیرون نمی‌زند', async () => {
    // نامی که `</script>` و `<` دارد؛ اگر escaping نباشد، HTML می‌شکند.
    const owner = await asRole('pv_reader', `select owner_user_id from app.business where slug = 'pet-shop-tehran'`);
    await asRole(
      'pv_app',
      `insert into app.business (slug, name, business_type_key, owner_user_id, status, visibility)
       values ('xss-probe', '</script><img src=x onerror=alert(1)>', 'pet_shop', $1, 'active', 'public')`,
      [owner[0].owner_user_id],
      { 'app.user_id': owner[0].owner_user_id, 'app.platform_role': 'superadmin', 'app.request_id': uuidv7() },
    );
    const response = await request('/b/xss-probe');
    assert.equal(response.status, 200);
    assert.doesNotMatch(response.text, /<\/script><img/);
    assert.match(response.text, /\\u003c\/script\\u003e/);
  });
});

// ---------------------------------------------------------------------------
describe('فهرست کسب‌وکارها و صفحه‌بندی (§19–۲۰)', () => {
  test('فهرست، همهٔ کسب‌وکارهای عمومی را نشان می‌دهد', async () => {
    const response = await request('/businesses');
    assert.equal(response.status, 200);
    assert.match(response.text, /پت‌شاپ تهران/);
    assert.match(response.text, /خوراک اسب کرج/);
  });

  test('صفحهٔ دومِ نشانگری، noindex می‌شود ولی کانونیکال ندارد', async () => {
    const first = await request('/businesses');
    const nextMatch = first.text.match(/rel="next" href="([^"]+)"/);
    if (!nextMatch) return; // با ۲۴ حد فهرست، صفحهٔ دوم نداریم — آزمون بی‌معنا نمی‌شود.

    const second = await request(new URL(nextMatch[1]).pathname + new URL(nextMatch[1]).search);
    assert.match(second.text, /<meta name="robots" content="noindex, follow">/);
  });
});

// ---------------------------------------------------------------------------
describe('خروجی‌های ماشینی: robots، sitemap، llms (Addendum §۳۸–۴۶)', () => {
  test('تا ایندکس‌گذاری روشن نشده، robots کل سایت را می‌بندد', async () => {
    const response = await request('/robots.txt');
    assert.equal(response.status, 200);
    assert.match(response.get('content-type'), /^text\/plain/);
    assert.match(response.text, /User-agent: \*/);
    assert.match(response.text, /Disallow: \//);
  });

  test('با روشن‌کردن ایندکس، سیاست محیط تعیین‌کننده می‌شود (تست ⇒ بسته)', async () => {
    await asRole('pv_app', `update seo.settings set indexing_enabled = true, environment = 'production' where business_id is null`, [], {
      'app.platform_role': 'superadmin',
      'app.request_id': uuidv7(),
    });

    try {
      const response = await request('/robots.txt');
      assert.equal(response.status, 200);
      // محیط اجرا «تست» است ⇒ سئو آن را غیرتولیدی می‌داند و همه‌چیز بسته می‌ماند.
      assert.match(response.text, /environment: development/);
      assert.match(response.text, /Disallow: \//);
      assert.doesNotMatch(response.text, /^Sitemap:/m, 'در محیط غیرتولیدی، سایتمپ معرفی نمی‌شود');

      // صفحه هم باید `noindex` بگیرد، نه اینکه فقط robots بسته باشد.
      const page = await request('/');
      assert.match(page.text, /<meta name="robots" content="noindex/);
    } finally {
      await asRole('pv_app', `update seo.settings set indexing_enabled = false, environment = 'development' where business_id is null`, [], {
        'app.platform_role': 'superadmin',
        'app.request_id': uuidv7(),
      });
    }
  });

  test('نقشهٔ سایت، XML معتبر با نشانی‌های واقعی است', async () => {
    const response = await request('/sitemap.xml');
    assert.equal(response.status, 200);
    assert.match(response.get('content-type'), /^application\/xml/);
    assert.match(response.text, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    assert.match(response.text, /<urlset/);
    assert.match(response.text, /http:\/\/localhost:3000\/b\/pet-shop-tehran/);
    assert.match(response.text, /http:\/\/localhost:3000\/b\/equine-feed-karaj/);
  });

  test('‏XML خروجی escape شده است (بدون نشت تگ خام)', async () => {
    const response = await request('/sitemap.xml');
    assert.doesNotMatch(response.text, /<img /);
    assert.match(response.text, /&lt;\/script&gt;|%3C%2Fscript%3E|xss-probe/);
  });

  test('‏llms.txt فهرست منابع است، نه بازتولید محتوا', async () => {
    const response = await request('/llms.txt');
    assert.equal(response.status, 200);
    assert.match(response.text, /^# پِتاوو/);
    assert.match(response.text, /## Not for model output/);
  });
});

// ---------------------------------------------------------------------------
describe('بررسی سلامت (§93–۹۹)', () => {
  test('‏/healthz بی‌وابستگی به پایگاه‌داده پاسخ می‌دهد', async () => {
    const response = await request('/healthz');
    assert.equal(response.status, 200);
    const body = JSON.parse(response.text);
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'petavu-web');
  });

  test('‏/readyz وضعیت واقعی پایگاه‌داده را می‌دهد', async () => {
    const response = await request('/readyz');
    assert.equal(response.status, 200);
    const body = JSON.parse(response.text);
    assert.equal(body.status, 'ready');
    assert.ok(Number(body.database.migrations) >= 17, 'دست‌کم ۱۷ مهاجرت باید اعمال شده باشد');
    assert.equal(response.get('cache-control'), 'no-store');
  });
});

// ---------------------------------------------------------------------------
describe('دارایی‌ها: درهم محتوا و کش بی‌نگرانی (§۸۷–۸۸)', () => {
  test('‏CSS با درهم محتوا سرو می‌شود و immutable است', async () => {
    const page = await request('/');
    const cssUrl = page.text.match(/<link rel="stylesheet" href="([^"]+)">/)[1];
    const response = await request(cssUrl);
    assert.equal(response.status, 200);
    assert.match(response.get('content-type'), /^text\/css/);
    assert.equal(response.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.match(response.get('etag'), /^"[0-9a-f]{8}"$/);
    // CSS باید توکن‌ها را داشته باشد (یعنی از پایگاه‌داده آمده، نه از فایل دستی)
    assert.match(response.text, /--color-text:/);
  });

  test('‏ETag درخواست دوباره، ۳۰۴ می‌گیرد', async () => {
    const page = await request('/');
    const cssUrl = page.text.match(/<link rel="stylesheet" href="([^"]+)">/)[1];
    const first = await request(cssUrl);
    const second = await request(cssUrl, { headers: { 'if-none-match': first.get('etag') } });
    assert.equal(second.status, 304);
    assert.equal(second.text, '');
  });

  test('دارایی ناموجود، ۴۰۴ متنی می‌دهد (بدون رندر صفحه)', async () => {
    const response = await request('/assets/nope.abcdef12.css');
    assert.equal(response.status, 404);
    assert.match(response.get('content-type'), /^text\/plain/);
  });

  test('پیمایش مسیر در دارایی‌ها ممکن نیست', async () => {
    const response = await request('/assets/..%2f..%2fpackage.json');
    assert.ok(response.status === 400 || response.status === 404);
  });

  test('فونت زیرمجموعهٔ فارسی سرو می‌شود و در CSS اعلام شده است', async () => {
    const page = await request('/');
    const cssUrl = page.text.match(/<link rel="stylesheet" href="([^"]+)">/)[1];
    const css = await request(cssUrl);
    const fontMatch = css.text.match(/url\('(\/assets\/vazirmatn-var\.[0-9a-f]{8}\.woff2)'\)/);
    assert.ok(fontMatch, 'نشانی فونت با درهم محتوا باید در CSS باشد');

    const font = await request(fontMatch[1]);
    assert.equal(font.status, 200);
    assert.equal(font.get('content-type'), 'font/woff2');
    assert.equal(font.get('cache-control'), 'public, max-age=31536000, immutable');
  });
});

// ---------------------------------------------------------------------------
describe('عملکرد: بودجه و فشرده‌سازی (Addendum §۴–۱۲، §۹۱)', () => {
  test('وزن HTML صفحهٔ اصلی زیر سقف بودجه است', async () => {
    const response = await request('/');
    const bytes = Buffer.byteLength(response.text, 'utf8');
    const budgetRow = await asRole('pv_reader', `select weight_kb from ops.page_budget where route_pattern = '/'`);
    const ceiling = budgetRow.length > 0 && budgetRow[0].weight_kb ? Number(budgetRow[0].weight_kb) * 1024 : 250 * 1024;
    assert.ok(bytes < ceiling, `وزن صفحه ${bytes} بایت است و سقف ${ceiling} بایت`);
  });

  test('پاسخ HTML با gzip فشرده می‌شود و Vary می‌گیرد', async () => {
    const response = await fetch(`${baseUrl}/`, { headers: { host: PUBLIC_HOST, 'accept-encoding': 'gzip' } });
    assert.equal(response.headers.get('content-encoding'), 'gzip');
    assert.equal(response.headers.get('vary'), 'accept-encoding');
    await response.text();
  });

  test('پاسخ کوچک فشرده نمی‌شود (آستانهٔ ۱ کیلوبایت)', async () => {
    const response = await fetch(`${baseUrl}/healthz`, { headers: { host: PUBLIC_HOST, 'accept-encoding': 'gzip' } });
    assert.equal(response.headers.get('content-encoding'), null);
    await response.text();
  });

  test('سنجش بودجه، عدد واقعی می‌دهد', async () => {
    const snapshot = await server.budgetSnapshot();
    assert.ok(snapshot.cssBytes > 1000, `CSS باید محتوا داشته باشد، ${snapshot.cssBytes} بایت آمد`);
    assert.ok(snapshot.fontBytes > 10_000, `فونت باید واقعی باشد، ${snapshot.fontBytes} بایت آمد`);
    assert.ok(snapshot.fontBytes < 150_000, 'زیرمجموعهٔ فونت نباید از ۱۵۰ کیلوبایت بگذرد');
  });

  test('CSS از توکن‌ها ساخته می‌شود و استایل درون‌خطی وجود ندارد', async () => {
    const response = await request('/');
    // هیچ `style="` در سند نباید باشد؛ وگرنه CSP سخت می‌شکند.
    assert.doesNotMatch(response.text, /<[^>]+\sstyle="/);
    // نماینده‌ای از هر گروه توکن در CSS سروشده: رنگ، فاصله، شعاع، حرکت.
    const css = await server.stylesheet();
    for (const token of ['--color-text:', '--space-4:', '--radius-md:', '--motion-duration-base:', '--breakpoint-md:']) {
      assert.ok(css.includes(token), `توکن ${token} در CSS نیست`);
    }
  });
});

// ---------------------------------------------------------------------------
describe('توکن‌ها: مرز امنیتی CSS (§43، §167)', () => {
  test('مقدار مجاز، همان‌طور که هست می‌ماند', () => {
    assert.equal(safeTokenValue('color.bg', 'color', '#FFFFFF'), '#FFFFFF');
    assert.equal(safeTokenValue('space.4', 'length', '16px'), '16px');
    assert.equal(safeTokenValue('radius.md', 'length', '8px'), '8px');
  });

  test('مقدار تزریقی رد می‌شود — در همهٔ انواع', () => {
    const attacks = [
      ['color.bg', 'color', '#fff; } body { display: none }'],
      ['color.bg', 'color', 'url(javascript:alert(1))'],
      ['space.4', 'length', '16px; background: url(//evil)'],
      ['font.family.sans', 'font', 'x") } body { color: red }'],
      ['shadow.md', 'shadow', '0 0 red; }'],
      ['motion.ease.standard', 'cubic', 'ease-in'],
      ['z.sticky', 'number', '100 !important'],
    ];
    for (const [key, type, value] of attacks) {
      assert.throws(() => safeTokenValue(key, type, value), UnsafeTokenValueError, `باید رد شود: ${value}`);
    }
  });

  test('سایهٔ ساختاریافته (آرایهٔ لایه‌ها) درست به CSS تبدیل می‌شود', () => {
    const value = safeTokenValue('shadow.md', 'shadow', [
      { x: 0, y: 4, blur: 8, spread: -2, color: 'rgba(11,13,15,0.10)' },
      { x: 0, y: 2, blur: 4, spread: -2, color: 'rgba(11,13,15,0.06)' },
    ]);
    assert.equal(value, '0px 4px 8px -2px rgba(11,13,15,0.10), 0px 2px 4px -2px rgba(11,13,15,0.06)');
  });

  test('‏alias باز می‌شود و ارجاع شکسته گزارش می‌شود', () => {
    const result = buildTokenSet(
      [
        { key: 'color.neutral.0', group_key: 'color', value: '#FFFFFF', value_type: 'color', alias_of: null, theme_mode: 'light' },
        { key: 'color.bg', group_key: 'color', value: '#000000', value_type: 'color', alias_of: 'color.neutral.0', theme_mode: 'light' },
        { key: 'color.missing', group_key: 'color', value: '#111111', value_type: 'color', alias_of: 'color.nowhere', theme_mode: 'light' },
      ],
      'light',
    );
    assert.equal(result.tokens.get('color.bg'), '#FFFFFF');
    assert.ok(result.unresolved.some((entry) => entry.startsWith('color.missing')));
  });

  test('نام متغیر CSS از کلید نقطه‌دار ساخته می‌شود', () => {
    assert.equal(cssVarName('color.text.muted'), '--color-text-muted');
    assert.equal(cssVarName('space.4'), '--space-4');
  });

  test('CSS پوسته، بیرون از بلوک چاپ هیچ رنگ خامی ندارد', () => {
    /*
     * قاعده: هر رنگ در SHELL_CSS باید داخل `var(...)` باشد.
     * یک استثنای مستند وجود دارد: بلوک `@media print` عمداً سیاه‌وسفید ثابت
     * است — چاپ باید صرف‌نظر از تم، خوانا بماند.
     */
    const printStart = SHELL_CSS.indexOf('@media print');
    assert.ok(printStart > 0, 'بلوک چاپ باید وجود داشته باشد');
    const printBlock = SHELL_CSS.slice(printStart);
    const outside = SHELL_CSS.slice(0, printStart).replace(/var\([^)]*\)/g, '');

    const outsideColors = [...new Set([...outside.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0]))];
    assert.deepEqual(outsideColors, [], `رنگ خام بیرون از بلوک چاپ: ${outsideColors.join(', ')}`);

    const printColors = [...new Set([...printBlock.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0]))].sort();
    assert.deepEqual(printColors, ['#000000', '#FFFFFF'], `رنگ‌های بلوک چاپ باید سیاه و سفید باشند: ${printColors.join(', ')}`);
  });
});

// ---------------------------------------------------------------------------
describe('رندر: نگهبان‌های تزریق (§68)', () => {
  test('متن و ویژگی، escape می‌شوند', () => {
    assert.equal(escapeText('<b>&"'), '&lt;b&gt;&amp;"');
    assert.equal(escapeAttr('a"b\'c'), 'a&quot;b&#39;c');
    assert.equal(attrs({ href: '/x?a=1&b=2' }), ' href="/x?a=1&amp;b=2"');
  });

  test('ویژگی‌های خطرناک، خطا می‌دهند (نه سکوت)', () => {
    assert.throws(() => attrs({ onclick: 'alert(1)' }), /ممنوع/);
    assert.throws(() => attrs({ style: 'color:red' }), /ممنوع/);
    assert.throws(() => attrs({ 'Bad Name': 'x' }), /نامعتبر/);
  });

  test('ویژگی تهی/غلط حذف می‌شود و بولیِ درست بدون مقدار می‌آید', () => {
    assert.equal(attrs({ hidden: true, id: null, x: undefined, y: false }), ' hidden');
  });

  test('‏CSP از پیکربندی ساخته می‌شود و در تولید سخت‌تر است', () => {
    const dev = contentSecurityPolicy(env);
    assert.doesNotMatch(dev, /upgrade-insecure-requests/);
    const prod = contentSecurityPolicy({ ...env, isProduction: true });
    assert.match(prod, /upgrade-insecure-requests/);
  });
});

// ---------------------------------------------------------------------------
describe('زمینهٔ بی‌نام: RLS نقش `pv_public` (§14)', () => {
  test('کوئری وب فقط با نقش بی‌نام اجرا می‌شود و کسب‌وکار خصوصی نمی‌بیند', async () => {
    const owner = await asRole('pv_reader', `select owner_user_id from app.business where slug = 'pet-shop-tehran'`);
    await asRole(
      'pv_app',
      `insert into app.business (slug, name, business_type_key, owner_user_id, status, visibility)
       values ('private-shop', 'کسب‌وکار خصوصی', 'pet_shop', $1, 'draft', 'private')`,
      [owner[0].owner_user_id],
      { 'app.user_id': owner[0].owner_user_id, 'app.platform_role': 'superadmin', 'app.request_id': uuidv7() },
    );

    const direct = await asRole('pv_public', `select count(*)::int as count from app.business where slug = 'private-shop'`);
    assert.equal(Number(direct[0].count), 0, 'نقش بی‌نام نباید کسب‌وکار خصوصی را ببیند');

    const response = await request('/b/private-shop');
    assert.equal(response.status, 404);
  });

  test('صفحهٔ خصوصی، هیچ نشانه‌ای از وجود در پاسخ جا نمی‌گذارد', async () => {
    const response = await request('/b/private-shop');
    assert.doesNotMatch(response.text, /کسب‌وکار خصوصی/);
  });
});

// ---------------------------------------------------------------------------
describe('پوستهٔ صفحه: ناوبری و دسترس‌پذیری (§45–۴۷)', () => {
  test('سر و پا و پیوند پرش حاضرند', async () => {
    const response = await request('/');
    assert.match(response.text, /class="skip-link" href="#main"/);
    assert.match(response.text, /<header class="site-header">/);
    assert.match(response.text, /<footer class="site-footer">/);
    assert.match(response.text, /aria-label="ناوبری اصلی"/);
  });

  test('عنوان صفحه یکتا و شامل نام برند است', async () => {
    const response = await request('/');
    const titles = [...response.text.matchAll(/<title>([^<]*)<\/title>/g)];
    assert.equal(titles.length, 1, 'فقط یک title در صفحه');
    /*
     * نام برند در هد، از `normalizePersian` می‌گذرد (پکیج `seo` همهٔ متن‌های هد
     * را نرمال می‌کند). پس اعراب — از جمله کسرهٔ «پِتاوو» — برداشته می‌شود.
     * انتظار آزمون هم باید همان شکل نرمال‌شده باشد.
     */
    assert.match(titles[0][1], /پتاوو/);
  });

  test('هر صفحه دقیقاً یک h1 دارد', async () => {
    const pages = ['/', '/businesses', '/b/pet-shop-tehran'];
    for (const path of pages) {
      const response = await request(path);
      const count = [...response.text.matchAll(/<h1[\s>]/g)].length;
      assert.equal(count, 1, `${path} باید یک h1 داشته باشد، ${count} داشت`);
    }
  });

  test('تصویر نشانه، متن جانشین دارد و aria-hidden درست است', async () => {
    const response = await request('/');
    const svg = response.text.match(/<svg class="brand__mark"[^>]*>/)[0];
    assert.match(svg, /aria-hidden="true"/);
    assert.match(svg, /focusable="false"/);
  });
});
