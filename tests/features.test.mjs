/**
 * تست رجیستری فیچر، بودجهٔ عملکرد و دروازهٔ انتشار (Addendum §1–۴، §21–۲۴، §90–۹۶).
 *
 * این تست‌ها همان چیزی را می‌سنجند که «دروازه» باید تضمین کند: هیچ فیچری
 * بی‌بودجه منتشر نمی‌شود، هیچ فیچری با وابستگی منتشرنشده منتشر نمی‌شود، هیچ
 * حلقه‌ای در گراف وابستگی نمی‌ماند، و هیچ صفحه‌ای بی‌بودجه رها نمی‌شود.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../scripts/lib/engine.mjs';
import { migrate } from '../scripts/lib/migrate.mjs';
import { applySeeds } from '../scripts/lib/seed.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..');

let engine;
let aliceId;
let businessA;

async function asPlatform(fn, { userId = null, platformRole = 'superadmin' } = {}) {
  await engine.setContext({ userId, platformRole });
  try {
    return await engine.asRole('pv_app', () => fn(engine));
  } finally {
    await engine.query(
      "select set_config('app.user_id','',false), set_config('app.platform_role','',false), set_config('app.business_id','',false)",
    );
  }
}

before(async () => {
  engine = await openDatabase();
  await migrate(engine, { dir: join(projectRoot, 'migrations') });
  await applySeeds(engine, { dir: join(projectRoot, 'seeds') });

  const [user] = await engine.query(
    `insert into auth.app_user (display_name, status) values ('آلیس رضایی', 'active') returning id`,
  );
  aliceId = String(user.id);

  const ownerRole = await engine.query(`select id from app.role where business_id is null and key = 'owner'`);
  const [business] = await engine.query(
    `insert into app.business (slug, name, business_type_key, owner_user_id) values ('tak-pet', 'پت‌شاپ تک‌پت', 'veterinary_clinic', $1) returning id`,
    [aliceId],
  );
  businessA = String(business.id);
  await engine.query(
    `insert into app.membership (business_id, user_id, role_id, status, joined_at) values ($1, $2, $3, 'active', now())`,
    [businessA, aliceId, String(ownerRole[0].id)],
  );

  // بودجه‌های پایه از seed می‌آیند، نه از این تست: اگر بودجه در راه‌اندازی نباشد،
  // یعنی سایت می‌تواند بی‌سنجه بالا بیاید.
});

after(async () => {
  await engine.close();
});

describe('گراف وابستگی فیچر (Addendum §21–۲۴)', () => {
  test('وابستگی ثبت می‌شود و معکوسش پرسش‌پذیر است', async () => {
    await asPlatform(async (handle) => {
      await handle.query(
        `insert into ops.feature_dependency (feature_key, depends_on_key, kind)
         values ('seo.engine', 'business.profile', 'hard'), ('ops.jobs', 'business.profile', 'soft')`,
      );
    });

    const blockers = await engine.query(`select blocker, detail from ops.feature_removal_blockers('business.profile')`);
    assert.ok(blockers.some((row) => String(row.blocker) === 'dependent_feature'));
  });

  test('فیچر نمی‌تواند به خودش وابسته باشد', async () => {
    await assert.rejects(
      () =>
        engine.query(
          `insert into ops.feature_dependency (feature_key, depends_on_key) values ('ops.jobs', 'ops.jobs')`,
        ),
      (error) => error.code === '23514',
    );
  });

  test('حلقه تشخیص داده می‌شود', async () => {
    // حلقهٔ موقت: a → b → c → a
    await engine.query(
      `insert into ops.feature (key, name_fa, layer, status) values
         ('cycle.a', 'الف', 'platform', 'draft'), ('cycle.b', 'ب', 'platform', 'draft'), ('cycle.c', 'ج', 'platform', 'draft')
       on conflict (key) do nothing`,
    );
    await engine.query(
      `insert into ops.feature_dependency (feature_key, depends_on_key) values
         ('cycle.a', 'cycle.b'), ('cycle.b', 'cycle.c'), ('cycle.c', 'cycle.a')`,
    );

    const cycles = await engine.query(`select cycle from ops.feature_dependency_cycles()`);
    assert.ok(cycles.length >= 1, 'حلقه باید دیده شود');
    const path = cycles[0].cycle;
    assert.ok(Array.isArray(path) && path.length >= 3);

    await engine.query(`delete from ops.feature_dependency where feature_key like 'cycle.%'`);
    const after = await engine.query(`select count(*)::int as c from ops.feature_dependency_cycles()`);
    assert.equal(Number(after[0].c), 0, 'با حذف حلقه، دیگر حلقه‌ای نمی‌ماند');
  });
});

describe('چرخهٔ عمر فیچر: بی‌دروازه منتشر نمی‌شود', () => {
  test('گذرهای مجاز و غیرمجاز', async () => {
    assert.equal(await engine.query(`select ops.feature_transition_allowed('draft', 'published') as ok`).then((r) => r[0].ok), false);
    assert.equal(await engine.query(`select ops.feature_transition_allowed('approved', 'published') as ok`).then((r) => r[0].ok), true);
    assert.equal(await engine.query(`select ops.feature_transition_allowed('archived', 'draft') as ok`).then((r) => r[0].ok), true);
  });

  test('بی‌مجوز پلتفرمی، گذر ممکن نیست', async () => {
    await assert.rejects(
      () => asPlatform((handle) => handle.query(`select * from ops.transition_feature('seo.engine', 'development')`), { platformRole: 'moderator' }),
      (error) => /مجوز/.test(String(error.message)),
    );
  });

  test('فیچر بی‌بودجهٔ عملکرد و با وابستگی منتشرنشده، منتشر نمی‌شود', async () => {
    await asPlatform(async (handle) => {
      await handle.query(
        `insert into ops.feature (key, name_fa, layer, status, performance_budget)
         values ('gate.blocked', 'فیچر آزمون دروازه', 'platform', 'approved', '{}'::jsonb)
         on conflict (key) do nothing`,
      );
      // وابستگی سخت به فیچری که منتشر نشده (خودش).
      await handle.query(
        `insert into ops.feature_dependency (feature_key, depends_on_key, kind) values ('gate.blocked', 'shop.commerce', 'hard')
         on conflict do nothing`,
      );
    });

    await assert.rejects(
      () => asPlatform((handle) => handle.query(`select * from ops.transition_feature('gate.blocked', 'published')`)),
      (error) => /وابستگی سختِ منتشرنشده|بودجهٔ عملکرد/.test(String(error.message)),
    );

    await asPlatform(async (handle) => {
      await handle.query(`delete from ops.feature_dependency where feature_key = 'gate.blocked'`);
      await handle.query(
        `update ops.feature set performance_budget = '{"lcp_ms":2500,"inp_ms":200,"cls":0.1}'::jsonb where key = 'gate.blocked'`,
      );
    });

    const published = await asPlatform((handle) =>
      handle.query(`select * from ops.transition_feature('gate.blocked', 'published')`),
    );
    assert.equal(String(published[0].status), 'published');

    const events = await engine.query(
      `select count(*)::int as c from ops.event where event_type = 'feature.status_changed' and entity_id = 'gate.blocked'`,
    );
    assert.equal(Number(events[0].c), 1, 'گذار فیچر باید رخداد بگذارد');
  });

  test('بایگانی، پیش از بایگانی وابسته‌ها ممکن نیست', async () => {
    await assert.rejects(
      () => asPlatform((handle) => handle.query(`select * from ops.transition_feature('business.profile', 'archived')`)),
      (error) => /گذر از|مانع دارد/.test(String(error.message)),
    );
  });
});

describe('بودجهٔ عملکرد: عدد، نه توصیه (Addendum §1–۴)', () => {
  test('بودجهٔ پایه در seed تعریف شده و مسیر خودش را پیدا می‌کند', async () => {
    const budget = await engine.query(`select route_pattern, lcp_ms from ops.budget_for_route('/b/tak-pet')`);
    assert.equal(budget.length, 1, 'برای مسیر کسب‌وکار باید بودجه پیدا شود');
    assert.ok(Number(budget[0].lcp_ms) > 0);
  });

  test('اندازه‌گیری در محدوده، «قبول» می‌گیرد', async () => {
    const verdict = await engine.query(
      `select ops.check_budget('/b/tak-pet', '{"lcp_ms":1800,"inp_ms":120,"cls":0.04}'::jsonb) as v`,
    );
    assert.equal(String(verdict[0].v.verdict), 'pass');
    assert.equal(verdict[0].v.breaches.length, 0);
  });

  test('تخطی، با ذکر سنجه و عدد گزارش می‌شود', async () => {
    const verdict = await engine.query(
      `select ops.check_budget('/b/tak-pet', '{"lcp_ms":5200,"inp_ms":120,"cls":0.3}'::jsonb) as v`,
    );
    assert.equal(String(verdict[0].v.verdict), 'fail');
    const metrics = verdict[0].v.breaches.map((row) => row.metric).sort();
    assert.deepEqual(metrics, ['cls', 'lcp_ms']);
    const lcp = verdict[0].v.breaches.find((row) => row.metric === 'lcp_ms');
    assert.ok(Number(lcp.budget) < Number(lcp.actual), 'تخطی باید بودجه و مقدار واقعی را با هم بدهد');
  });

  test('مسیر بی‌بودجه، صریحاً «اندازه‌گیری‌نشده» اعلام می‌شود', async () => {
    const verdict = await engine.query(`select ops.check_budget('/nowhere/at-all/xyz', '{"lcp_ms":100}'::jsonb) as v`);
    assert.equal(String(verdict[0].v.verdict), 'unbudgeted');
    assert.equal(verdict[0].v.matched, false);
  });

  test('الگوی خاص‌تر برنده است', async () => {
    await asPlatform(async (handle) => {
      await handle.query(
        `insert into ops.page_budget (route_pattern, scope, name_fa, lcp_ms, inp_ms, cls)
         values ('/b/:slug', 'platform', 'پروفایل کسب‌وکار', 2500, 200, 0.1),
                ('/', 'platform', 'صفحهٔ اصلی', 1800, 150, 0.05)
         on conflict do nothing`,
      );
    });
    const specific = await engine.query(`select route_pattern, lcp_ms from ops.budget_for_route('/b/some-business')`);
    assert.equal(String(specific[0].route_pattern), '/b/:slug');
    const home = await engine.query(`select route_pattern, lcp_ms from ops.budget_for_route('/')`);
    assert.equal(String(home[0].route_pattern), '/');
  });
});

describe('دروازهٔ انتشار (Addendum §96)', () => {
  test('محتوای منتشرشدهٔ بی‌فراداده، دروازه را می‌بندد', async () => {
    await engine.query(
      `insert into app.content (business_id, kind, slug, title, status, published_at)
       values ($1, 'article', 'no-seo', 'مقالهٔ بی‌سئو', 'published', now())`,
      [businessA],
    );

    await engine.setContext({ userId: aliceId, businessId: businessA });
    const gate = await engine.asRole('pv_app', () => engine.query(`select ops.publish_gate($1) as g`, [businessA]));
    await engine.query("select set_config('app.user_id','',false), set_config('app.business_id','',false)");

    const result = gate[0].g;
    assert.equal(String(result.verdict), 'blocked');
    assert.ok(result.blockers.some((row) => String(row.gate) === 'seo_metadata'));

    // با افزودن فراداده، آن مانع برداشته می‌شود.
    await engine.query(
      `insert into seo.metadata (business_id, entity_kind, entity_id, locale, title, description)
       select $1, 'content', c.id, 'fa-IR', 'عنوان مؤثر', 'توضیح مؤثر' from app.content c where c.slug = 'no-seo' and c.business_id = $1`,
      [businessA],
    );
    await engine.setContext({ userId: aliceId, businessId: businessA });
    const after = await engine.asRole('pv_app', () => engine.query(`select ops.publish_gate($1) as g`, [businessA]));
    await engine.query("select set_config('app.user_id','',false), set_config('app.business_id','',false)");
    assert.equal(
      after[0].g.blockers.some((row) => String(row.gate) === 'seo_metadata'),
      false,
      'مانع سئو باید برداشته شود',
    );
  });

  test('پیش‌نویس صفحه با یافتهٔ بازدارنده، دروازه را می‌بندد', async () => {
    await engine.setContext({ userId: aliceId, businessId: businessA });
    await engine.asRole('pv_app', () =>
      engine.query(
        `insert into design.page (business_id, key, title, scope, draft_tree)
         values ($1, 'home', 'صفحهٔ اصلی', 'business', '{"version":1,"root":[{"id":"a","component":"content.unknown"}]}'::jsonb)`,
        [businessA],
      ),
    );
    await engine.query("select set_config('app.user_id','',false), set_config('app.business_id','',false)");

    await engine.setContext({ userId: aliceId, businessId: businessA });
    const gate = await engine.asRole('pv_app', () => engine.query(`select ops.publish_gate($1) as g`, [businessA]));
    await engine.query("select set_config('app.user_id','',false), set_config('app.business_id','',false)");

    assert.equal(String(gate[0].g.verdict), 'blocked');
    assert.ok(gate[0].g.blockers.some((row) => String(row.gate) === 'design_structure'));
  });

  test('غیرعضو نمی‌تواند دروازه را بخواند', async () => {
    const [outsider] = await engine.query(
      `insert into auth.app_user (display_name, status) values ('سهیل ناظری', 'active') returning id`,
    );
    await engine.setContext({ userId: String(outsider.id) });
    await assert.rejects(
      () => engine.asRole('pv_app', () => engine.query(`select ops.publish_gate($1)`, [businessA])),
      (error) => error.code === '42501' || /insufficient|عضویت/.test(String(error.message)),
    );
    await engine.query("select set_config('app.user_id','',false)");
  });
});
