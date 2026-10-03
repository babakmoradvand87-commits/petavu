/**
 * تست هد سئوی SSR (گام ۲۴ — §39–۴۰، §186، Addendum §۳۹–۴۷).
 *
 * چه چیزی سنجیده می‌شود: **زنجیرهٔ کامل تصمیم سئو** — از دادهٔ پایگاه‌داده تا
 * تگ در HTML. هر آزمون یک پله از زنجیره را می‌گیرد:
 *
 *   قالب (`seo.template`) → متادیتای دستی (`seo.metadata`) → سیاست نمایه
 *   (`seo.index_policy_for_public`) → قاعدهٔ کانونیکال (`seo.canonical`) →
 *   زبان‌های دیگر (hreflang) → دادهٔ ساخت‌یافته (`seo.structured_data`) →
 *   کد بازرسی (`seo.settings.extra`).
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDatabase } from '../scripts/lib/engine.mjs';
import { migrate } from '../scripts/lib/migrate.mjs';
import { applySeeds } from '../scripts/lib/seed.mjs';

import { createWebServer } from '../apps/web/dist/index.js';
import {
  readStructuredRows,
  readExtraHead,
  serializeStructuredNodes,
  verificationCodes,
  TRACKING_PARAM_LIST,
} from '../apps/web/dist/seohead.js';
import { loadEnv, uuidv7 } from '../packages/shared/dist/index.js';
import { createPasswordHasher, TEST_ARGON2, hashIdentifier } from '../packages/security/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..');
const assetsDirectory = join(projectRoot, 'apps/web/assets');

const env = loadEnv({
  PETAVU_ENV: 'test',
  AUTH_PEPPER: 'test-pepper-value',
  SESSION_SECRET: 'test-session-secret-value-0123456789',
  PETAVU_PUBLIC_ORIGIN: 'http://localhost:3000',
  PETAVU_PANEL_ORIGIN: 'http://panel.localhost:3000',
  PETAVU_ADMIN_ORIGIN: 'http://adminpanel.localhost:3000',
  PETAVU_SHOP_ORIGIN: 'http://shop.localhost:3000',
  PETAVU_ADMIN_SHOP_ORIGIN: 'http://adminshop.localhost:3000',
});

const PUBLIC_HOST = 'localhost:3000';
const ORIGIN = 'http://localhost:3000';
const passwords = createPasswordHasher({ params: TEST_ARGON2, pepper: 'test-pepper-value' });

let engine;
let client;
let server;
let ownerUserId;
let businessId;

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
      withTransaction: (fn) => runner.withTransaction(async (tx) => fn(make(tx))),
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

async function asRole(role, sql, params = [], context = {}) {
  const settings = Object.entries(context).filter(([, value]) => value !== undefined && value !== null);
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

const ADMIN = () => ({
  'app.user_id': ownerUserId,
  'app.platform_role': 'superadmin',
  'app.request_id': uuidv7(),
});

/** تگ‌های هد یک صفحه، به‌شکل نگاشت ساده برای بازرسی. */
async function head(path) {
  const response = await server.render({ method: 'GET', url: path, host: PUBLIC_HOST });
  const html = response.body;
  const headHtml = html.slice(0, html.indexOf('</head>'));

  const meta = (name) => {
    const match = new RegExp(`<meta name="${name}" content="([^"]*)"`).exec(headHtml);
    return match ? match[1] : null;
  };
  const property = (name) => {
    const match = new RegExp(`<meta property="${name}" content="([^"]*)"`).exec(headHtml);
    return match ? match[1] : null;
  };
  const links = (rel) =>
    [...headHtml.matchAll(new RegExp(`<link rel="${rel}"[^>]*>`, 'g'))].map((match) => match[0]);

  return {
    status: response.status,
    html,
    headHtml,
    title: /<title>([^<]*)<\/title>/.exec(headHtml)?.[1] ?? null,
    description: meta('description'),
    robots: meta('robots'),
    canonical: /<link rel="canonical" href="([^"]*)"/.exec(headHtml)?.[1] ?? null,
    links,
    property,
    jsonLd: [...headHtml.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => match[1]),
  };
}

before(async () => {
  engine = await openDatabase();
  await migrate(engine, { dir: join(projectRoot, 'migrations') });
  await applySeeds(engine, { dir: join(projectRoot, 'seeds') });
  client = createEmbeddedClient(engine);

  const registrationContext = { 'app.request_id': uuidv7() };
  const tickets = await asRole(
    'pv_app',
    'select * from app.begin_registration($1, $2, null)',
    [hashIdentifier('seo@petavu.test'), 'email'],
    registrationContext,
  );
  const secret = await passwords.hash('Correct-Horse-Seo-1!');
  const created = await asRole(
    'pv_app',
    'select user_id from app.complete_registration($1, $2, $3, $4, $5)',
    [tickets[0].ticket_id, 'کارشناس سئو', secret, 'fa-IR', 'Asia/Tehran'],
    registrationContext,
  );
  ownerUserId = created[0].user_id;

  const business = await asRole(
    'pv_app',
    `insert into app.business (slug, name, business_type_key, owner_user_id, status, visibility, published_at)
     values ('seo-shop', 'پت‌شاپ سئو', 'pet_shop', $1, 'active', 'public', now())
     returning id`,
    [ownerUserId],
    ADMIN(),
  );
  businessId = business[0].id;

  await asRole(
    'pv_app',
    `insert into app.business_profile (business_id, tagline, summary) values ($1, 'نزدیک تو', 'خدمات کامل پت')`,
    [businessId],
    ADMIN(),
  );
  await asRole(
    'pv_app',
    `update app.business b
        set primary_location_id = (select l.id from ref.location l where l.slug = 'tehran' limit 1)
      where b.id = $1`,
    [businessId],
    ADMIN(),
  );

  // کسب‌وکار دوم، برای آزمون قاعدهٔ کانونیکال (نسخهٔ تکراری).
  await asRole(
    'pv_app',
    `insert into app.business (slug, name, business_type_key, owner_user_id, status, visibility, published_at)
     values ('seo-shop-dup', 'پت‌شاپ سئو (تکراری)', 'pet_shop', $1, 'active', 'public', now())`,
    [ownerUserId],
    ADMIN(),
  );

  server = createWebServer({
    client,
    env,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    assetsDirectory,
    now: () => new Date('2026-10-03T09:00:00Z'),
  });
  await server.listen(0, '127.0.0.1');
});

after(async () => {
  await server?.close();
  await engine?.close();
});

/* ------------------------------------------------------------------ قالب‌ها */

describe('عنوان از قالب سئو (Addendum §۴۰)', () => {
  test('عنوان صفحهٔ اصلی از قالب `home.platform` می‌آید، نه از کد', async () => {
    const page = await head('/');
    assert.equal(page.status, 200);
    assert.ok(page.title?.includes('شبکهٔ کسب‌وکار'), page.title ?? '');
    // قالب seed از `{site}` استفاده می‌کند؛ پس نام برند در عنوان هست.
    assert.match(page.title ?? '', /پتاوو/);
    assert.equal((page.headHtml.match(/<title>/g) ?? []).length, 1);
  });

  test('عنوان کسب‌وکار از قالب `business.default` با متغیرهای واقعی ساخته می‌شود', async () => {
    const page = await head('/b/seo-shop');
    assert.match(page.title ?? '', /پت‌شاپ سئو/);
    assert.match(page.title ?? '', /تهران/);
  });

  test('توکن تهی، حذف می‌شود و جداکنندهٔ سرگردان نمی‌ماند', async () => {
    // کسب‌وکار بدون شهر: قالب `{name} {sep} {city} {sep} {site}` نباید «| |» بدهد.
    const page = await head('/b/seo-shop-dup');
    assert.match(page.title ?? '', /پت‌شاپ سئو/);
    assert.ok(!/\|\s*\|/.test(page.title ?? ''), page.title ?? '');
    assert.ok(!page.title?.includes('تهران'), page.title ?? '');
  });

  test('قالب با اولویت بالاتر برنده است', async () => {
    await asRole(
      'pv_app',
      `insert into seo.template (business_id, key, entity_kind, subtype, title_template, priority)
       values (null, 'business.special', 'business', null, 'ویژه: {name}', 200)`,
      [],
      ADMIN(),
    );

    try {
      const page = await head('/b/seo-shop');
      assert.match(page.title ?? '', /^ویژه: /);
    } finally {
      await asRole('pv_app', `delete from seo.template t where t.key = 'business.special'`, [], ADMIN());
    }
  });

  test('متادیتای دستی بر قالب مقدم است', async () => {
    await asRole(
      'pv_app',
      `insert into seo.metadata (entity_kind, entity_id, locale, title, description, is_indexable)
       values ('business', $1, 'fa-IR', 'عنوان دستی سئو', 'توضیح دستی', true)`,
      [businessId],
      ADMIN(),
    );

    try {
      const page = await head('/b/seo-shop');
      assert.equal(page.title, 'عنوان دستی سئو');
      assert.equal(page.description, 'توضیح دستی');
    } finally {
      await asRole('pv_app', `delete from seo.metadata m where m.entity_id = $1`, [businessId], ADMIN());
    }
  });

  test('توضیح بلندتر از حد، بریده می‌شود', async () => {
    await asRole(
      'pv_app',
      `insert into seo.metadata (entity_kind, entity_id, locale, description, is_indexable)
       values ('business', $1, 'fa-IR', $2, true)`,
      [businessId, 'ط'.repeat(390)],
      ADMIN(),
    );

    try {
      const page = await head('/b/seo-shop');
      assert.ok((page.description ?? '').length <= 160, String((page.description ?? '').length));
    } finally {
      await asRole('pv_app', `delete from seo.metadata m where m.entity_id = $1`, [businessId], ADMIN());
    }
  });
});

/* ------------------------------------------------------------------ سیاست نمایه */

describe('سیاست نمایه‌شدن، داده‌محور (§39، §186)', () => {
  test('صفحهٔ noindex، هم `noindex` می‌گیرد و هم عنوانش افشا نمی‌شود', async () => {
    await asRole(
      'pv_app',
      `insert into seo.metadata (entity_kind, entity_id, locale, title, is_indexable, non_indexable_reason, robots_directives)
       values ('business', $1, 'fa-IR', 'عنوان خصوصی', false, 'private', '{noarchive}')`,
      [businessId],
      ADMIN(),
    );

    try {
      const page = await head('/b/seo-shop');
      assert.match(page.robots ?? '', /noindex/);
      assert.match(page.robots ?? '', /noarchive/);
      // عنوانِ ردیفِ غیرقابل‌نمایه نباید در صفحه بیاید (تابع دامنه آن را پنهان می‌کند).
      assert.ok(!page.html.includes('عنوان خصوصی'));
    } finally {
      await asRole('pv_app', `delete from seo.metadata m where m.entity_id = $1`, [businessId], ADMIN());
    }
  });

  test('دستور robots ناشناخته از داده پذیرفته نمی‌شود', async () => {
    await asRole(
      'pv_app',
      `insert into seo.metadata (entity_kind, entity_id, locale, is_indexable, robots_directives)
       values ('business', $1, 'fa-IR', true, '{"noindex-but-not-really","max-snippet:-1"}')`,
      [businessId],
      ADMIN(),
    );

    try {
      const page = await head('/b/seo-shop');
      assert.ok(!page.robots?.includes('noindex-but-not-really'));
      assert.match(page.robots ?? '', /max-snippet:-1/);
    } finally {
      await asRole('pv_app', `delete from seo.metadata m where m.entity_id = $1`, [businessId], ADMIN());
    }
  });

  test('ترتیب دستورها: ممنوعیت‌ها اول می‌آیند', async () => {
    const page = await head('/');
    assert.ok((page.robots ?? '').startsWith('noindex'), page.robots ?? '');
  });

  test('سیاست مسیرمحور برای صفحهٔ اصلی خوانده می‌شود', async () => {
    await asRole(
      'pv_app',
      `insert into seo.metadata (entity_kind, route_key, locale, title, is_indexable)
       values ('home', '/', 'fa-IR', 'عنوان مسیرمحور خانه', true)`,
      [],
      ADMIN(),
    );

    try {
      const page = await head('/');
      assert.equal(page.title, 'عنوان مسیرمحور خانه');
    } finally {
      await asRole('pv_app', `delete from seo.metadata m where m.route_key = '/' and m.entity_kind = 'home'`, [], ADMIN());
    }
  });

  test('تابع `seo.index_policy_for_public` سیاست صفحهٔ noindex را برمی‌گرداند', async () => {
    await asRole(
      'pv_app',
      `insert into seo.metadata (entity_kind, entity_id, locale, is_indexable, non_indexable_reason)
       values ('business', $1, 'fa-IR', false, 'thin_content')`,
      [businessId],
      ADMIN(),
    );

    try {
      const rows = await asRole(
        'pv_public',
        `select * from seo.index_policy_for_public('business', $1, null, 'fa-IR')`,
        [businessId],
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].is_indexable, false);
      assert.equal(rows[0].non_indexable_reason, 'thin_content');
    } finally {
      await asRole('pv_app', `delete from seo.metadata m where m.entity_id = $1`, [businessId], ADMIN());
    }
  });
});

/* ------------------------------------------------------------------ کانونیکال */

describe('کانونیکال (Addendum §۴۴)', () => {
  test('پارامترهای ردیابی در کانونیکال نمی‌مانند', async () => {
    const page = await head(`/b/seo-shop?utm_source=newsletter&utm_campaign=nowruz&fbclid=abc`);
    assert.equal(page.canonical, `${ORIGIN}/b/seo-shop`);
    assert.ok(TRACKING_PARAM_LIST.includes('utm_source'));
  });

  test('قاعدهٔ کانونیکال، نسخهٔ تکراری را به نسخهٔ مرجع می‌برد', async () => {
    await asRole(
      'pv_app',
      `insert into seo.canonical (business_id, source_path, canonical_path, match_kind, reason)
       values (null, '/b/seo-shop-dup', '/b/seo-shop', 'exact', 'duplicate')`,
      [],
      ADMIN(),
    );

    try {
      const page = await head('/b/seo-shop-dup');
      assert.equal(page.canonical, `${ORIGIN}/b/seo-shop`);
    } finally {
      await asRole('pv_app', `delete from seo.canonical c where c.source_path = '/b/seo-shop-dup'`, [], ADMIN());
    }
  });

  test('قاعدهٔ کانونیکال نمی‌تواند به دامنهٔ دیگری اشاره کند', async () => {
    // قید پایگاه‌داده (مهاجرت ۰۰۱۸) نشانی مطلق را از همان ابتدا رد می‌کند.
    await assert.rejects(
      () =>
        asRole(
          'pv_app',
          `insert into seo.canonical (business_id, source_path, canonical_path, match_kind, reason)
           values (null, '/b/seo-shop', 'https://evil.example.com/x', 'exact', 'manual')`,
          [],
          ADMIN(),
        ),
      /canonical_path_shape|check/i,
    );

    const page = await head('/b/seo-shop');
    assert.equal(page.canonical, `${ORIGIN}/b/seo-shop`);
  });

  test('کانونیکال فهرست، پارامتر فیلتر را دور می‌ریزد', async () => {
    const first = await head('/businesses?utm_medium=cpc&q=کلینیک');
    assert.equal(first.canonical, `${ORIGIN}/businesses`);
  });
});

/* ------------------------------------------------------------------ hreflang */

describe('hreflang از دادهٔ واقعی', () => {
  test('تا وقتی نسخهٔ زبان دیگری ثبت نشده، هیچ نشانی جانشینی چاپ نمی‌شود', async () => {
    const page = await head('/b/seo-shop');
    assert.equal(page.links('alternate').length, 0);
  });

  test('نسخهٔ زبانی دیگر ⇒ `hreflang` و `x-default`', async () => {
    await asRole(
      'pv_app',
      `insert into seo.metadata (entity_kind, entity_id, locale, canonical_url, is_indexable)
       values ('business', $1, 'en-US', $2, true)`,
      [businessId, `${ORIGIN}/b/seo-shop`],
      ADMIN(),
    );

    try {
      const page = await head('/b/seo-shop');
      const alternates = page.links('alternate');
      assert.ok(alternates.some((tag) => tag.includes('hreflang="en-US"')), alternates.join(' '));
      assert.ok(alternates.some((tag) => tag.includes('hreflang="x-default"')));
    } finally {
      await asRole('pv_app', `delete from seo.metadata m where m.entity_id = $1 and m.locale = 'en-US'`, [businessId], ADMIN());
    }
  });
});

/* ------------------------------------------------------------------ دادهٔ ساخت‌یافته */

describe('دادهٔ ساخت‌یافته از پایگاه‌داده (Addendum §۴۱)', () => {
  const faqPayload = {
    mainEntity: [
      {
        '@type': 'Question',
        name: 'ساعات کاری؟',
        acceptedAnswer: { '@type': 'Answer', text: '۹ تا ۱۸' },
      },
    ],
  };

  test('ردیف فعال، به گراف صفحه اضافه می‌شود', async () => {
    await asRole(
      'pv_app',
      `insert into seo.structured_data (entity_kind, entity_id, locale, schema_type, subtype, payload, source)
       values ('business', $1, 'fa-IR', 'FAQPage', null, $2::jsonb, 'manual')`,
      [businessId, JSON.stringify(faqPayload)],
      ADMIN(),
    );

    try {
      const page = await head('/b/seo-shop');
      assert.ok(page.jsonLd.some((block) => block.includes('FAQPage')), page.jsonLd.join('\n').slice(0, 200));
      assert.ok(page.jsonLd.some((block) => block.includes('ساعات کاری؟')));
    } finally {
      await asRole('pv_app', `delete from seo.structured_data d where d.entity_id = $1`, [businessId], ADMIN());
    }
  });

  test('پیلود خطرناک پذیرفته نمی‌شود', () => {
    const hostile = readStructuredRows([
      { schema_type: 'FAQPage', subtype: null, source: 'manual', payload: { text: '<script>alert(1)</script>' } },
      { schema_type: 'FAQPage', subtype: null, source: 'manual', payload: JSON.parse('{"__proto__":{"polluted":true}}') },
      { schema_type: 'FAQPage', subtype: null, source: 'manual', payload: {} },
      { schema_type: 'FAQPage', subtype: null, source: 'manual', payload: 'رشته، نه شیء' },
      { schema_type: 'FAQPage', subtype: null, source: 'manual', payload: { js: 'javascript:alert(1)' } },
    ]);

    assert.equal(hostile.nodes.length, 0);
    assert.ok(hostile.findings.every((finding) => finding.startsWith('structured_data.')));
  });

  test('پیلود معتبر، سریال‌سازی امن می‌گیرد', () => {
    const ok = readStructuredRows([
      { schema_type: 'FAQPage', subtype: 'FAQ', source: 'engine', payload: { name: 'سؤال <تست>' } },
    ]);
    assert.equal(ok.nodes.length, 1);
    assert.equal(ok.nodes[0]?.['additionalType'], 'FAQ');

    const serialized = serializeStructuredNodes(ok.nodes);
    assert.ok(serialized !== null);
    // تگ بستهٔ اسکریپت، حتی داخل متن، escape می‌شود.
    assert.ok(!serialized.includes('</script>'));
    assert.equal(serializeStructuredNodes([]), null);
  });

  test('نوع اسکیما نامعتبر رد می‌شود', () => {
    const result = readStructuredRows([
      { schema_type: 'FAQ/../Page', subtype: null, source: 'manual', payload: { a: 1 } },
    ]);
    assert.equal(result.nodes.length, 0);
  });
});

/* ------------------------------------------------------------------ بازرسی و extras */

describe('کدهای بازرسی و تنظیمات', () => {
  test('کد بازرسی از `seo.settings.extra` می‌آید و در هد می‌نشیند', async () => {
    const previous = await asRole('pv_app', `select s.extra from seo.settings s where s.business_id is null`, [], ADMIN());
    await asRole(
      'pv_app',
      `update seo.settings s set extra = jsonb_set(s.extra, '{verification}', $1::jsonb) where s.business_id is null`,
      [JSON.stringify([{ name: 'google-site-verification', content: 'abc-123' }, { name: 'BAD NAME', content: 'x' }])],
      ADMIN(),
    );

    try {
      const page = await head('/');
      assert.match(page.headHtml, /<meta name="google-site-verification" content="abc-123">/);
      assert.ok(!page.headHtml.includes('BAD NAME'));
    } finally {
      await asRole(
        'pv_app',
        `update seo.settings s set extra = $1::jsonb where s.business_id is null`,
        [JSON.stringify(previous[0]?.extra ?? {})],
        ADMIN(),
      );
    }
  });

  test('`verificationCodes` نویسهٔ خطرناک را رد می‌کند', () => {
    assert.deepEqual(
      verificationCodes({ verification: [{ name: 'google-site-verification', content: 'ok-1' }] }),
      [{ name: 'google-site-verification', content: 'ok-1' }],
    );
    assert.deepEqual(verificationCodes({ verification: [{ name: 'x', content: 'ok' }] }), []);
    assert.deepEqual(verificationCodes({ verification: [{ name: 'google-site-verification', content: 'a"b' }] }), []);
    assert.deepEqual(verificationCodes({ verification: 'not-an-array' }), []);
    assert.deepEqual(verificationCodes(null), []);
  });

  test('OPEN GRAPH: عنوان و توضیح از متادیتا می‌آید و تصویر جعلی ساخته نمی‌شود', async () => {
    const page = await head('/b/seo-shop');
    assert.ok(page.property('og:title'));
    assert.ok(page.property('og:description'));
    // بدون دارایی اشتراک‌گذاری، `og:image` چاپ نمی‌شود (نه نشانی جعلی).
    assert.equal(page.property('og:image'), null);
  });

  test('هر صفحه دقیقاً یک `<title>` و یک کانونیکال دارد', async () => {
    for (const path of ['/', '/businesses', '/b/seo-shop']) {
      const page = await head(path);
      assert.equal((page.headHtml.match(/<title>/g) ?? []).length, 1, path);
      assert.equal((page.headHtml.match(/rel="canonical"/g) ?? []).length, 1, path);
    }
  });
});

/* ------------------------------------------------------------------ محیط تولید */

/**
 * دروازهٔ محیط، بهترین جا برای اشتباه فاجعه‌بار است: «صفحهٔ staging که گوگل
 * ایندکس کرده» یا برعکس، «سایت تولیدی که بی‌خبر noindex خورده». پس این‌جا با
 * یک سرور واقعیِ پیکربندی‌شده برای تولید سنجیده می‌شود: تنظیمات پایگاه‌داده،
 * محیط اجرا و سیاست صفحه، سه‌تایی با هم.
 */
describe('محیط تولید: دروازه‌ها و صفحه‌بندی', () => {
  const PRODUCTION_HOST = 'petavu.example';
  const PRODUCTION_ORIGIN = `https://${PRODUCTION_HOST}`;
  let productionServer;
  let previous;

  const productionEnv = loadEnv({
    PETAVU_ENV: 'production',
    AUTH_PEPPER: 'production-pepper-value-0123456789abcdef',
    SESSION_SECRET: 'production-session-secret-0123456789abcdef',
    PETAVU_PUBLIC_ORIGIN: PRODUCTION_ORIGIN,
    PETAVU_PANEL_ORIGIN: `https://panel.${PRODUCTION_HOST}`,
    PETAVU_ADMIN_ORIGIN: `https://adminpanel.${PRODUCTION_HOST}`,
    PETAVU_SHOP_ORIGIN: `https://shop.${PRODUCTION_HOST}`,
    PETAVU_ADMIN_SHOP_ORIGIN: `https://adminshop.${PRODUCTION_HOST}`,
  });

  const prodHead = async (path) => {
    const response = await productionServer.render({ method: 'GET', url: path, host: PRODUCTION_HOST });
    const html = response.body;
    const headHtml = html.slice(0, html.indexOf('</head>'));
    const meta = (name) => new RegExp(`<meta name="${name}" content="([^"]*)"`).exec(headHtml)?.[1] ?? null;
    return {
      status: response.status,
      robots: meta('robots'),
      canonical: /<link rel="canonical" href="([^"]*)"/.exec(headHtml)?.[1] ?? null,
      headHtml,
    };
  };

  before(async () => {
    previous = await asRole(
      'pv_app',
      `select s.indexing_enabled, s.environment from seo.settings s where s.business_id is null`,
      [],
      ADMIN(),
    );
    await asRole(
      'pv_app',
      `update seo.settings s set indexing_enabled = true, environment = 'production' where s.business_id is null`,
      [],
      ADMIN(),
    );
    productionServer = createWebServer({
      client,
      env: productionEnv,
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      assetsDirectory,
      now: () => new Date('2026-10-03T09:00:00Z'),
    });
    await productionServer.listen(0, '127.0.0.1');
  });

  after(async () => {
    await productionServer?.close();
    await asRole(
      'pv_app',
      `update seo.settings s set indexing_enabled = $1, environment = $2 where s.business_id is null`,
      [previous[0].indexing_enabled, previous[0].environment],
      ADMIN(),
    );
  });

  test('در تولید با ایندکس روشن، صفحهٔ اول نمایه‌شدنی است', async () => {
    const page = await prodHead('/businesses');
    assert.equal(page.status, 200);
    assert.ok(!(page.robots ?? '').includes('noindex'), page.robots ?? '');
    assert.match(page.robots ?? '', /max-image-preview:large/);
    assert.equal(page.canonical, `${PRODUCTION_ORIGIN}/businesses`);
  });

  test('صفحهٔ دوم: `noindex` + کانونیکال خودارجاع (سیاست پیش‌فرض `self_canonical`)', async () => {
    // نشانگر جعلی، فقط برای رسیدن به «صفحهٔ دوم» — محتوا لازم نیست.
    const page = await prodHead('/businesses?cursor=zzz-not-a-real-cursor');
    assert.match(page.robots ?? '', /noindex/);
    // سیاست صفحه‌بندی داده است: `self_canonical` یعنی هر صفحه خودش را مرجع می‌گوید،
    // ولی پارامتر ردیابی هرگز در کانونیکال نمی‌ماند.
    assert.equal(page.canonical, `${PRODUCTION_ORIGIN}/businesses?cursor=zzz-not-a-real-cursor`);

    const tracked = await prodHead('/businesses?cursor=zzz-not-a-real-cursor&utm_source=ads');
    assert.equal(tracked.canonical, `${PRODUCTION_ORIGIN}/businesses?cursor=zzz-not-a-real-cursor`);
  });

  test('با سیاست `canonical_to_first`، همهٔ صفحه‌ها به فهرست اشاره می‌کنند', async () => {
    const previousExtra = await asRole(
      'pv_app',
      `select s.extra from seo.settings s where s.business_id is null`,
      [],
      ADMIN(),
    );
    await asRole(
      'pv_app',
      `update seo.settings s set extra = jsonb_set(s.extra, '{pagination_policy}', '"canonical_to_first"') where s.business_id is null`,
      [],
      ADMIN(),
    );

    try {
      const page = await prodHead('/businesses?cursor=zzz-not-a-real-cursor');
      assert.equal(page.canonical, `${PRODUCTION_ORIGIN}/businesses`);
    } finally {
      await asRole(
        'pv_app',
        `update seo.settings s set extra = $1::jsonb where s.business_id is null`,
        [JSON.stringify(previousExtra[0].extra)],
        ADMIN(),
      );
    }
  });

  test('جست‌وجوی آزاد `noindex, follow` می‌گیرد، فهرست نه', async () => {
    const listing = await prodHead('/businesses?type=pet_shop');
    assert.ok(!(listing.robots ?? '').includes('noindex'), listing.robots ?? '');

    const search = await prodHead('/businesses?q=کلینیک');
    assert.match(search.robots ?? '', /noindex/);
    assert.match(search.robots ?? '', /follow/);
    // پرس‌وجو هرگز در کانونیکال نمی‌ماند.
    assert.equal(search.canonical, `${PRODUCTION_ORIGIN}/businesses`);
  });

  test('صفحهٔ کسب‌وکار در تولید، عنوان و کانونیکال امن دارد', async () => {
    const page = await prodHead('/b/seo-shop?utm_source=ads');
    assert.equal(page.canonical, `${PRODUCTION_ORIGIN}/b/seo-shop`);
    assert.match(page.robots ?? '', /max-image-preview:large/);
  });

  test('خاموش‌کردن ایندکس در تنظیمات، همهٔ صفحه‌ها را می‌بندد', async () => {
    await asRole(
      'pv_app',
      `update seo.settings s set indexing_enabled = false where s.business_id is null`,
      [],
      ADMIN(),
    );
    try {
      const page = await prodHead('/businesses');
      assert.match(page.robots ?? '', /noindex/);
    } finally {
      await asRole(
        'pv_app',
        `update seo.settings s set indexing_enabled = true where s.business_id is null`,
        [],
        ADMIN(),
      );
    }
  });

  test('بازگشت به محیط توسعه، صفحه‌ها را دوباره می‌بندد', async () => {
    await asRole(
      'pv_app',
      `update seo.settings s set environment = 'staging' where s.business_id is null`,
      [],
      ADMIN(),
    );
    try {
      const page = await prodHead('/businesses');
      assert.match(page.robots ?? '', /noindex/);
    } finally {
      await asRole(
        'pv_app',
        `update seo.settings s set environment = 'production' where s.business_id is null`,
        [],
        ADMIN(),
      );
    }
  });
});

/* ------------------------------------------------------------------ تگ‌های اضافهٔ هد */

describe('تگ‌های اضافهٔ هد: فهرست مجاز، نه پاک‌سازی (Addendum §۳۷، §۷۹)', () => {
  const ok = [
    { rel: 'preconnect', href: 'https://fonts.example', crossorigin: 'anonymous' },
    { name: 'google-site-verification', content: 'abc-123' },
    { property: 'og:locale', content: 'fa_IR' },
    { rel: 'alternate', href: '/en-US', hreflang: 'en-US' },
    { rel: 'preload', href: '/assets/fonts/vazirmatn.woff2', as: 'font', type: 'font/woff2', crossorigin: 'anonymous' },
  ];

  test('توصیف‌گرهای مجاز، به تگ تبدیل می‌شوند', () => {
    const findings = [];
    const tags = readExtraHead(ok, findings);
    assert.equal(tags.length, ok.length);
    assert.deepEqual(findings, []);
    assert.equal(tags[0].tag, 'link');
    assert.equal(tags[1].attrs.name, 'google-site-verification');
    assert.equal(tags[2].attrs.property, 'og:locale');
  });

  test('شکل نامعتبر (رشته، شیء، عدد) رد می‌شود', () => {
    assert.deepEqual(readExtraHead('<script>alert(1)</script>'), []);
    assert.deepEqual(readExtraHead({ rel: 'preconnect', href: 'https://x.example' }), []);
    assert.deepEqual(readExtraHead(null), []);

    const findings = [];
    assert.deepEqual(readExtraHead(['<meta name="x" content="y">'], findings), []);
    assert.ok(findings.includes('extra_head.rejected_entry'));

    const nonArray = [];
    readExtraHead('<meta>', nonArray);
    assert.ok(nonArray.includes('extra_head.not_array'));
  });

  test('`stylesheet` و `script` پذیرفته نمی‌شوند (منبع مسدودکنندهٔ رندر)', () => {
    const findings = [];
    const tags = readExtraHead([{ rel: 'stylesheet', href: 'https://cdn.example/x.css' }], findings);
    assert.equal(tags.length, 0);
    assert.ok(findings.includes('extra_head.rejected_link:stylesheet'));
  });

  test('ویژگی ناشناخته یا مقدار غیررشته‌ای، کل توصیف‌گر را رد می‌کند', () => {
    const findings = [];
    assert.equal(readExtraHead([{ name: 'x', content: 'y', onload: 'alert(1)' }], findings).length, 0);
    assert.ok(findings.includes('extra_head.unknown_attr:meta:onload'));

    const findings2 = [];
    assert.equal(readExtraHead([{ rel: 'preconnect', href: 42 }], findings2).length, 0);
    assert.ok(findings2.includes('extra_head.bad_value:link:href'));
  });

  test('نشانی ناامن (javascript/http) و `http-equiv` غیرمجاز رد می‌شود', () => {
    const findings = [];
    assert.equal(readExtraHead([{ rel: 'preconnect', href: 'javascript:alert(1)' }], findings).length, 0);
    assert.equal(readExtraHead([{ rel: 'preconnect', href: 'http://insecure.example' }], findings).length, 0);
    assert.equal(findings.filter((f) => f === 'extra_head.unsafe_href').length, 2);

    const findings2 = [];
    assert.equal(
      readExtraHead([{ 'http-equiv': 'refresh', content: '0;url=https://evil.example' }], findings2).length,
      0,
    );
    assert.ok(findings2.includes('extra_head.rejected_http_equiv'));
  });

  test('`preload` بدون `as` و مقدار خطرناک در `content` رد می‌شود', () => {
    const findings = [];
    assert.equal(readExtraHead([{ rel: 'preload', href: 'https://cdn.example/f.woff2' }], findings).length, 0);
    assert.ok(findings.includes('extra_head.preload_without_as'));

    const findings2 = [];
    assert.equal(
      readExtraHead([{ name: 'description', content: 'x</head><script>alert(1)</script>' }], findings2).length,
      0,
    );
    assert.ok(findings2.includes('extra_head.unsafe_content'));
  });

  test('سقف تعداد: بیش از ۱۲ توصیف‌گر پذیرفته نمی‌شود', () => {
    const findings = [];
    const many = Array.from({ length: 20 }, (_, index) => ({ name: `x-${index}`, content: 'v' }));
    const tags = readExtraHead(many, findings);
    assert.equal(tags.length, 12);
    assert.ok(findings.includes('extra_head.too_many'));
  });

  test('در صفحه: تگ مجاز از پایگاه‌داده چاپ می‌شود و اسکریپت نه', async () => {
    await asRole(
      'pv_app',
      `insert into seo.metadata (entity_kind, entity_id, locale, is_indexable, extra_head)
       values ('business', $1, 'fa-IR', true, $2::jsonb)`,
      [
        businessId,
        JSON.stringify([
          { name: 'google-site-verification', content: 'verify-me' },
          { rel: 'stylesheet', href: 'https://cdn.example/x.css' },
          { name: 'x', content: '<script>alert(1)</script>' },
        ]),
      ],
      ADMIN(),
    );

    try {
      const page = await head('/b/seo-shop');
      assert.match(page.headHtml, /<meta name="google-site-verification" content="verify-me">/);
      assert.ok(!page.headHtml.includes('cdn.example'), 'استایل‌شیت نباید در هد بیاید');
      assert.ok(!page.headHtml.includes('<script>alert(1)'), 'محتوای ناامن نباید در هد بیاید');
    } finally {
      await asRole('pv_app', `delete from seo.metadata m where m.entity_id = $1`, [businessId], ADMIN());
    }
  });
});

/* ------------------------------------------------------------------ og */

describe('کارت اشتراک‌گذاری (Addendum §۴۲)', () => {
  test('قالب `og_title_template` متن کارت را جدا از متن نتایج می‌سازد', async () => {
    await asRole(
      'pv_app',
      `insert into seo.template (business_id, key, entity_kind, title_template, og_title_template, og_description_template, priority)
       values (null, 'business.og', 'business', 'عنوان نتایج {name}', 'کارت: {name}', 'کارت‌توضیح {name}', 300)`,
      [],
      ADMIN(),
    );

    try {
      const page = await head('/b/seo-shop');
      assert.equal(page.property('og:title'), 'کارت: پت‌شاپ سئو');
      assert.equal(page.property('og:description'), 'کارت‌توضیح پت‌شاپ سئو');
    } finally {
      await asRole('pv_app', `delete from seo.template t where t.key = 'business.og'`, [], ADMIN());
    }
  });

  test('تصویر اشتراک‌گذاری از دارایی واقعی می‌آید و مطلق است', async () => {
    const assets = await asRole(
      'pv_app',
      `insert into media.asset (storage_key, driver, detected_mime, kind, size_bytes, width, height, status, is_public, alt_text, uploaded_by)
       values ('share/og-image-' || gen_random_uuid()::text || '.jpg', 'local', 'image/jpeg', 'image', 12345, 1200, 630, 'ready', true, 'تصویر اشتراک', $1)
       returning id`,
      [ownerUserId],
      ADMIN(),
    );
    const assetId = assets[0].id;

    await asRole(
      'pv_app',
      `insert into seo.metadata (entity_kind, entity_id, locale, is_indexable, share_asset_id)
       values ('business', $1, 'fa-IR', true, $2)`,
      [businessId, assetId],
      ADMIN(),
    );

    try {
      const page = await head('/b/seo-shop');
      assert.equal(page.property('og:image'), `${ORIGIN}/media/${assetId}`);
      const width = await asRole('pv_app', `select width, height from media.asset where id = $1`, [assetId], ADMIN());
      assert.equal(width[0].height, 630);
    } finally {
      await asRole('pv_app', `delete from seo.metadata m where m.entity_id = $1`, [businessId], ADMIN());
      await asRole('pv_app', `delete from media.asset a where a.id = $1`, [assetId], ADMIN());
    }
  });

  test('بدون دارایی، `og:image` ساخته نمی‌شود (نه تصویر جعلی)', async () => {
    const page = await head('/b/seo-shop');
    assert.equal(page.property('og:image'), null);
  });
});

/* ------------------------------------------------------------------ مهاجرت */

describe('مهاجرت ۰۰۱۸', () => {
  test('قید شکل کانونیکال، مسیر نامعتبر را رد می‌کند', async () => {
    await assert.rejects(
      () =>
        asRole(
          'pv_app',
          `insert into seo.canonical (business_id, source_path, canonical_path, match_kind, reason)
           values (null, 'no-leading-slash', '/x', 'exact', 'manual')`,
          [],
          ADMIN(),
        ),
      /canonical_source_shape|check/i,
    );
  });

  test('تابع مسیرمحور برای بی‌نام قابل اجراست و ردیف غیرنمایه‌شدنی نمی‌دهد', async () => {
    await asRole(
      'pv_app',
      `insert into seo.metadata (entity_kind, route_key, locale, title, is_indexable)
       values ('home', '/legacy', 'fa-IR', 'کد قدیمی', false)`,
      [],
      ADMIN(),
    );

    try {
      const rows = await asRole(
        'pv_public',
        `select * from seo.metadata_for_route('home', '/legacy', 'fa-IR')`,
      );
      assert.equal(rows.length, 0);

      const policy = await asRole(
        'pv_public',
        `select * from seo.index_policy_for_public('home', null, '/legacy', 'fa-IR')`,
      );
      assert.equal(policy.length, 1);
      assert.equal(policy[0].is_indexable, false);
    } finally {
      await asRole('pv_app', `delete from seo.metadata m where m.route_key = '/legacy'`, [], ADMIN());
    }
  });
});
