/**
 * تست اندازه‌گیری عملکرد: نمونه، تجمیع، خط مبنا، پس‌رفت (Addendum §1–۴، §91–۹۵، §101).
 *
 * این تست حلقهٔ کامل را می‌سنجد: مرورگر می‌سنجد → نمونه ثبت می‌شود → تجمیع
 * می‌شود → با خط مبنا مقایسه می‌شود → پس‌رفت یک ردیف می‌شود. اگر جایی از این
 * حلقه نباشد، «بودجهٔ عملکرد» فقط یک عدد در یک جدول است.
 *
 * تمرکز ویژه روی دو چیز:
 *   • دادهٔ بی‌اعتماد: ورودی از مرورگر می‌آید، پس پاک‌سازی و اعتبارسنجی بخشی از
 *     خود تابع است (§101).
 *   • آستانه‌ها: درجه‌بندی و پس‌رفت از یک جا می‌آیند، نه از سه جای مختلف (§103).
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../scripts/lib/engine.mjs';
import { migrate } from '../scripts/lib/migrate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..');

let engine;
let aliceId;
let bobId;
let businessA;
let businessB;

async function asRole(role, context, fn) {
  if (context) await engine.setContext(context);
  try {
    return await engine.asRole(role, fn);
  } finally {
    await engine.query(
      "select set_config('app.user_id','',false), set_config('app.business_id','',false), set_config('app.platform_role','',false)",
    );
  }
}

const asOwner = (fn) => asRole('pv_app', { userId: aliceId, businessId: businessA }, fn);
const asWorker = (fn) => asRole('pv_worker', null, fn);

/** ثبت یک دستهٔ نمونه از مسیر واقعی بی‌نام (همان کاری که بیکن مرورگر می‌کند). */
async function beacon(records, businessId = null) {
  const rows = await asRole('pv_public', null, (handle) =>
    handle.query(`select ops.record_vitals($1::jsonb, $2) as r`, [JSON.stringify(records), businessId]),
  );
  return rows[0].r;
}

/** ساخت نمونه‌های کنترل‌شده برای آزمون تجمیع و پس‌رفت. */
async function seedSamples(path, metric, values, { minutesAgo = 30, releaseKey = null } = {}) {
  const records = values.map((value, index) => ({
    metric,
    value,
    path,
    occurred_at: new Date(Date.now() - minutesAgo * 60_000 + index * 1000).toISOString(),
    release_key: releaseKey,
  }));
  return beacon(records);
}

before(async () => {
  engine = await openDatabase();
  await migrate(engine, { dir: join(projectRoot, 'migrations') });
  await engine.exec(await readFile(join(projectRoot, 'seeds', '0001_reference.sql'), 'utf8'));

  const users = await engine.query(
    `insert into auth.app_user (display_name, status) values ('آلیس رضایی', 'active'), ('بابک مرادی', 'active') returning id`,
  );
  [aliceId, bobId] = users.map((row) => String(row.id));

  const ownerRole = await engine.query(`select id from app.role where business_id is null and key = 'owner'`);
  const businesses = await engine.query(
    `insert into app.business (slug, name, business_type_key, owner_user_id)
     values ('tak-pet', 'پت‌شاپ تک‌پت', 'veterinary_clinic', $1),
            ('vet-sharif', 'کلینیک شریف', 'veterinary_clinic', $2)
     returning id`,
    [aliceId, bobId],
  );
  [businessA, businessB] = businesses.map((row) => String(row.id));

  await engine.query(
    `insert into app.membership (business_id, user_id, role_id, status, joined_at)
     values ($1, $2, $3, 'active', now()), ($4, $5, $3, 'active', now())`,
    [businessA, aliceId, String(ownerRole[0].id), businessB, bobId],
  );
});

after(async () => {
  await engine.close();
});

// ---------------------------------------------------------------------------
describe('درجه‌بندی: آستانه‌ها در یک جا (§103)', () => {
  test('آستانه‌های Core Web Vitals درست اعمال می‌شوند', async () => {
    const rate = async (metric, value) => {
      const rows = await engine.query(`select ops.vitals_rating($1, $2) as r`, [metric, value]);
      return rows[0].r;
    };

    assert.equal(await rate('lcp', 2000), 'good');
    assert.equal(await rate('lcp', 2500), 'good', 'مرز، خودش «خوب» است');
    assert.equal(await rate('lcp', 3000), 'needs_improvement');
    assert.equal(await rate('lcp', 5000), 'poor');
    assert.equal(await rate('inp', 150), 'good');
    assert.equal(await rate('inp', 300), 'needs_improvement');
    assert.equal(await rate('cls', 0.05), 'good');
    assert.equal(await rate('cls', 0.2), 'needs_improvement');
    assert.equal(await rate('cls', 0.4), 'poor');
    assert.equal(await rate('ttfb', 2000), 'poor');
    assert.equal(await rate('nonsense', 1), 'poor', 'سنجهٔ ناشناخته «خوب» نیست');
  });
});

// ---------------------------------------------------------------------------
describe('ثبت نمونه: مرز اعتماد روی دادهٔ بی‌اعتماد (§101)', () => {
  test('دستهٔ معتبر ثبت می‌شود، درجه می‌گیرد و الگوی بودجه‌اش پیدا می‌شود', async () => {
    const result = await beacon([
      { metric: 'lcp', value: 1800, path: '/b/tak-pet' },
      { metric: 'lcp', value: 5200, path: '/b/tak-pet' },
      { metric: 'cls', value: 0.04, path: '/' },
    ]);

    assert.equal(result.accepted, 3);
    assert.equal(result.rejected.length, 0);
    assert.equal(result.unbudgeted, 0, 'همهٔ این مسیرها بودجه دارند');

    const rows = await engine.query(
      `select metric, value, rating, route_pattern from ops.vitals_sample where page_path = '/b/tak-pet' order by value`,
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0].rating, 'good');
    assert.equal(rows[1].rating, 'poor');
    assert.equal(rows[0].route_pattern, '/b/:slug', 'مسیر عینی، به الگوی بودجه نگاشته می‌شود');
  });

  test('رشتهٔ پرس‌وجو و قطعه در مسیر ذخیره نمی‌شود (نشت نکن)', async () => {
    const result = await beacon([
      { metric: 'lcp', value: 1500, path: '/panel/reset?token=SUPER-SECRET-VALUE#frag' },
      { metric: 'lcp', value: 1500, path: '/b/tak-pet?utm_source=newsletter' },
    ]);
    assert.equal(result.accepted, 2);

    const rows = await engine.query(`select page_path from ops.vitals_sample where page_path like '%reset%' or page_path like '%tak-pet%'`);
    for (const row of rows) {
      assert.equal(row.page_path.includes('?'), false, 'هیچ نشانی نباید رشتهٔ پرس‌وجو داشته باشد');
      assert.equal(row.page_path.includes('#'), false);
      assert.equal(row.page_path.includes('SUPER-SECRET-VALUE'), false, 'توکن نباید ذخیره شود');
    }
  });

  test('رکورد نامعتبر رد می‌شود و دلیلش می‌آید؛ بقیهٔ دسته سالم می‌مانند', async () => {
    const result = await beacon([
      { metric: 'lcp', value: 1200, path: '/b/tak-pet' },
      { metric: 'lcp', value: 1200, path: 'not-a-path' },
      { metric: 'lcp', value: -5, path: '/b/tak-pet' },
      { metric: 'lcp', value: 999999, path: '/b/tak-pet' },
      { metric: 'sql_injection', value: 1, path: '/b/tak-pet' },
      { metric: 'cls', value: 'خیلی زیاد', path: '/b/tak-pet' },
    ]);

    assert.equal(result.accepted, 1, 'فقط رکورد سالم');
    assert.equal(result.rejected.length, 5);
    const reasons = result.rejected.map((item) => item.reason).sort();
    assert.deepEqual(reasons, [
      'metric_not_allowed',
      'path_invalid',
      'value_out_of_range',
      'value_out_of_range',
      'value_out_of_range',
    ]);
    assert.deepEqual(
      result.rejected.map((item) => item.index),
      [1, 2, 3, 4, 5],
      'شمارهٔ رکورد رد‌شده باید برگردد تا پیکربندی سنجش اصلاح شود',
    );
  });

  test('سقف دسته اعمال می‌شود؛ سیل نمونه، مسیر نوشتن بی‌سقف نیست', async () => {
    const many = Array.from({ length: 51 }, () => ({ metric: 'lcp', value: 1000, path: '/b/tak-pet' }));
    await assert.rejects(
      () => beacon(many),
      (error) => /۵۰|50/.test(String(error.message)),
      'بیش از ۵۰ رکورد در یک درخواست باید رد شود',
    );
  });

  test('کسب‌وکار از سرور می‌آید، نه از بدنهٔ درخواست', async () => {
    await beacon([{ metric: 'lcp', value: 1400, path: '/b/tak-pet', business_id: businessB }], businessA);
    const [row] = await engine.query(
      `select business_id from ops.vitals_sample where page_path = '/b/tak-pet' and value = 1400 limit 1`,
    );
    assert.equal(String(row.business_id), businessA, 'کسب‌وکار جعلی در بدنه نباید اثر بگذارد');
  });

  test('زمان آیندهٔ مرورگر (ساعت خراب) به «حالا» کشیده می‌شود', async () => {
    const future = new Date(Date.now() + 6 * 3600_000).toISOString();
    await beacon([{ metric: 'fcp', value: 900, path: '/', occurred_at: future }]);
    const [row] = await engine.query(`select occurred_at, received_at from ops.vitals_sample where metric = 'fcp' order by received_at desc limit 1`);
    assert.ok(new Date(row.occurred_at) <= new Date(row.received_at), 'زمان ثبت نباید پس از دریافت باشد');
  });

  test('مسیر بی‌بودجه، «اندازه‌گیری‌نشده» می‌ماند و پنهان نمی‌شود', async () => {
    const result = await beacon([{ metric: 'lcp', value: 2200, path: '/nowhere/at-all/xyz' }]);
    assert.equal(result.accepted, 1);
    assert.equal(result.unbudgeted, 1, 'رکورد بدون بودجه هم باید شمرده شود');

    const health = await engine.query(`select ops.performance_health('1 hour') as h`);
    assert.ok(
      health[0].h.routes_without_budget.includes('/nowhere/at-all/xyz'),
      'مسیر بی‌بودجه باید در پایش نام برده شود',
    );
  });
});

// ---------------------------------------------------------------------------
describe('تجمیع و خط مبنا: از نمونه تا عدد قابل تصمیم (§91–۹۵)', () => {
  test('تجمیع، صدک‌ها و بدترین حالت را درست می‌دهد', async () => {
    // مسیر اختصاصی تا نمونه‌های تست‌های دیگر، صدک‌ها را جابه‌جا نکنند.
    await seedSamples('/blog/cinematic-baseline', 'lcp', [1000, 2000, 3000, 4000], { minutesAgo: 45 });
    await asWorker((handle) => handle.query(`select ops.rollup_vitals('hour', '6 hours')`));

    const [bucket] = await engine.query(
      `select sample_count, p50, p75, p95, worst, good, needs_improvement, poor
       from ops.vitals_rollup
       where route_pattern = '/blog/:slug' and metric = 'lcp' and bucket = 'hour'
       order by bucket_start desc limit 1`,
    );

    assert.equal(Number(bucket.sample_count), 4, 'دقیقاً همان نمونه‌هایی که کاشتیم');
    assert.equal(Number(bucket.p50), 2500);
    assert.equal(Number(bucket.p75), 3250, 'صدک درون‌یابی‌شده، نه یک نمونهٔ خام');
    assert.equal(Number(bucket.worst), 4000, 'بدترین حالت باید بماند');
    assert.equal(Number(bucket.good), 2);
    assert.equal(
      Number(bucket.good) + Number(bucket.needs_improvement) + Number(bucket.poor),
      Number(bucket.sample_count),
      'جمع درجه‌ها باید برابر شمار نمونه باشد',
    );
  });

  test('تجمیع ایدمپوتنت است: اجرای دوباره سبد تکراری نمی‌سازد (§180)', async () => {
    const before = await engine.query(`select count(*)::int as n from ops.vitals_rollup`);
    const first = await asWorker((handle) => handle.query(`select ops.rollup_vitals('hour', '6 hours') as n`));
    const second = await asWorker((handle) => handle.query(`select ops.rollup_vitals('hour', '6 hours') as n`));
    const after = await engine.query(`select count(*)::int as n from ops.vitals_rollup`);

    assert.equal(Number(first[0].n) > 0, true);
    assert.equal(Number(second[0].n), Number(first[0].n), 'همان سبدها بازنویسی شدند، نه بیشتر');
    assert.equal(Number(after[0].n), Number(before[0].n), 'شمردن سبدها نباید تغییر کند');
  });

  test('خط مبنا فقط با نمونهٔ کافی ساخته می‌شود', async () => {
    const none = await asWorker((handle) => handle.query(`select ops.compute_baselines(7, 100000) as n`));
    assert.equal(Number(none[0].n), 0, 'با کفِ نمونهٔ بالا، خط مبنا ساخته نمی‌شود');

    const some = await asWorker((handle) => handle.query(`select ops.compute_baselines(7, 3) as n`));
    assert.ok(Number(some[0].n) >= 1, 'با نمونهٔ کافی، خط مبنا ساخته می‌شود');
  });

  test('بودجهٔ خط مبنا، از همان سنجه می‌آید (نه همیشه LCP)', async () => {
    await seedSamples('/blog/cinematic-baseline', 'cls', [0.05, 0.06, 0.07, 0.08], { minutesAgo: 20 });
    await asWorker((handle) => handle.query(`select ops.compute_baselines(7, 3)`));

    const rows = await engine.query(
      `select metric, budget_value from ops.performance_baseline where route_pattern = '/blog/:slug' order by metric`,
    );
    const cls = rows.find((row) => row.metric === 'cls');
    const lcp = rows.find((row) => row.metric === 'lcp');
    assert.ok(Number(cls.budget_value) < 1, `بودجهٔ CLS باید کسری باشد، نه میلی‌ثانیه: ${cls.budget_value}`);
    assert.ok(Number(lcp.budget_value) > 100, 'بودجهٔ LCP باید میلی‌ثانیه باشد');
  });
});

// ---------------------------------------------------------------------------
describe('تشخیص پس‌رفت: از عدد به هشدار (§91–۹۵)', () => {
  test('افت نکرده ⇒ هشدار ساخته نمی‌شود', async () => {
    const count = await asWorker((handle) => handle.query(`select ops.detect_regressions(0.5, '6 hours', 3) as n`));
    assert.equal(Number(count[0].n), 0, 'با آستانهٔ سخاوتمند، پس‌رفت ساخته نمی‌شود');
  });

  test('جهش ⇒ پس‌رفت باز با شدت و نسبت درست', async () => {
    /*
     * خط مبنا **بازنویسی نمی‌شود**.
     *
     * خط مبنا یعنی «این مسیر در حالت عادی چقدر بود». اگر پس از جهش، خط مبنا را
     * از همان نمونه‌های خراب حساب کنیم، عدد خراب، معیار خودش می‌شود و هیچ
     * پس‌رفتی هرگز دیده نخواهد شد.
     */
    await seedSamples('/blog/cinematic-baseline', 'lcp', [9000, 9500, 9800, 9900], {
      minutesAgo: 10,
      releaseKey: 'release-42',
    });
    const count = await asWorker((handle) => handle.query(`select ops.detect_regressions(0.2, '6 hours', 3) as n`));

    assert.ok(Number(count[0].n) >= 1);
    const [row] = await engine.query(
      `select severity, baseline_value, observed_value, delta_ratio, budget_value, suspect_release, status
       from ops.performance_regression where route_pattern = '/blog/:slug' and metric = 'lcp' and status = 'open'`,
    );
    assert.equal(row.severity, 'critical', 'عبور از بودجه، خرابی است نه هشدار');
    assert.ok(Number(row.observed_value) > Number(row.baseline_value));
    assert.ok(Number(row.delta_ratio) > 0.2, `نسبت رشد: ${row.delta_ratio}`);
    assert.equal(Number(row.budget_value), 2500, 'بودجهٔ همان الگو باید کنار پس‌رفت باشد');
    assert.equal(row.suspect_release, 'release-42', 'مظنون، از نمونه‌های همان بازه می‌آید');
  });

  test('اجرای دوبارهٔ تشخیص، پس‌رفت باز تکراری نمی‌سازد', async () => {
    const before = await engine.query(`select count(*)::int as n from ops.performance_regression where status = 'open'`);
    await asWorker((handle) => handle.query(`select ops.detect_regressions(0.2, '6 hours', 3)`));
    const after = await engine.query(`select count(*)::int as n from ops.performance_regression where status = 'open'`);
    assert.equal(Number(after[0].n), Number(before[0].n), 'هر اجرای کارگر نباید هشدار تازه بسازد');
  });

  test('بستن پس‌رفت با یادداشت، و امکان تشخیص تازه پس از بستن', async () => {
    const [open] = await engine.query(
      `select id from ops.performance_regression where route_pattern = '/blog/:slug' and metric = 'lcp' and status = 'open'`,
    );

    const closed = await asOwner((handle) =>
      handle.query(`select * from ops.resolve_regression($1, 'resolved', 'کش CDN تنظیم شد')`, [String(open.id)]),
    );
    assert.equal(closed[0].status, 'resolved');
    assert.ok(closed[0].resolved_at !== null, 'وضعیت بسته باید مهر زمانی داشته باشد');
    assert.equal(closed[0].note, 'کش CDN تنظیم شد');

    const again = await asWorker((handle) => handle.query(`select ops.detect_regressions(0.2, '6 hours', 3) as n`));
    assert.ok(Number(again[0].n) >= 1, 'پس از بستن، تشخیص تازه باید ممکن باشد');
  });

  test('وضعیت نامعتبر رد می‌شود و پس‌رفت ناموجود خطای روشن می‌دهد', async () => {
    await assert.rejects(
      () =>
        asOwner((handle) =>
          handle.query(`select ops.resolve_regression('00000000-0000-0000-0000-000000000000', 'forgotten')`),
        ),
      (error) => /وضعیت نامعتبر/.test(String(error.message)),
    );

    await assert.rejects(
      () =>
        asOwner((handle) =>
          handle.query(`select ops.resolve_regression('00000000-0000-0000-0000-000000000000', 'resolved')`),
        ),
      (error) => /پیدا نشد/.test(String(error.message)),
    );
  });
});

// ---------------------------------------------------------------------------
describe('دسترسی و نگهداشت (§14، §101، §132)', () => {
  test('بی‌نام می‌نویسد ولی نمی‌خواند', async () => {
    // بی `returning`: بی‌نام گرنت خواندن ندارد، و `insert … returning` خواندن
    // می‌خواهد. همین، مرز را در دو جهت می‌بندد: می‌نویسد، نمی‌خواند.
    await assert.doesNotReject(() =>
      asRole('pv_public', null, (handle) =>
        handle.query(
          `insert into ops.vitals_sample (occurred_at, metric, value, rating, page_path)
           values (now(), 'lcp', 1500, 'good', '/')`,
        ),
      ),
    );

    await assert.rejects(
      () => asRole('pv_public', null, (handle) => handle.query(`select count(*)::int from ops.vitals_sample`)),
      (error) => /permission denied/.test(String(error.message)) || error.code === '42501',
    );
  });

  test('نمونهٔ هر کسب‌وکار، فقط برای عضو خودش خواندنی است', async () => {
    const mine = await asOwner((handle) =>
      handle.query(`select count(*)::int as n from ops.vitals_sample where business_id = $1`, [businessA]),
    );
    const theirs = await asRole('pv_app', { userId: bobId, businessId: businessB }, (handle) =>
      handle.query(`select count(*)::int as n from ops.vitals_sample where business_id = $1`, [businessA]),
    );

    assert.ok(Number(mine[0].n) > 0, 'عضو باید نمونه‌های کسب‌وکار خودش را ببیند');
    assert.equal(Number(theirs[0].n), 0, 'غیرعضو نباید ببیند');
  });

  test('نمونهٔ ثبت‌شده بازنویسی‌شدنی نیست (سنجه، سابقه است)', async () => {
    const denied = (error) => /permission denied/.test(String(error.message)) || error.code === '42501';
    await assert.rejects(
      () => asWorker((handle) => handle.query(`update ops.vitals_sample set value = 1 where page_path = '/'`)),
      denied,
      'کارگر نباید اندازه‌گیری ثبت‌شده را دست‌کاری کند',
    );
    await assert.rejects(
      () => asOwner((handle) => handle.query(`update ops.vitals_sample set value = 1 where page_path = '/'`)),
      denied,
      'اپلیکیشن هم نباید',
    );
    await assert.rejects(
      () => asWorker((handle) => handle.query(`delete from ops.vitals_sample where page_path = '/'`)),
      denied,
      'حذف فقط از راه تابع نگهداشت',
    );
  });

  test('نگهداشت، فقط نمونه‌های قدیمی را پاک می‌کند', async () => {
    const [old] = await engine.query(
      `insert into ops.vitals_sample (occurred_at, received_at, metric, value, rating, page_path)
       values (now() - interval '40 days', now() - interval '40 days', 'lcp', 1000, 'good', '/')
       returning id`,
    );
    const before = await engine.query(`select count(*)::int as n from ops.vitals_sample`);
    const removed = await asWorker((handle) => handle.query(`select ops.purge_vitals('30 days') as n`));
    const after = await engine.query(`select count(*)::int as n from ops.vitals_sample`);

    assert.equal(Number(removed[0].n), 1);
    assert.equal(Number(after[0].n), Number(before[0].n) - 1);
    const still = await engine.query(`select id from ops.vitals_sample where id = $1`, [String(old.id)]);
    assert.equal(still.length, 0, 'نمونهٔ قدیمی پاک شده است');
  });

  test('تجمیع و تشخیص پس‌رفت، کار کارگر است نه کار درخواست کاربر', async () => {
    await assert.rejects(
      () => asOwner((handle) => handle.query(`select ops.rollup_vitals('hour', '1 hour')`)),
      (error) => /permission denied/.test(String(error.message)) || error.code === '42501',
    );
    await assert.rejects(
      () => asOwner((handle) => handle.query(`select ops.detect_regressions(0.2, '1 hour', 1)`)),
      (error) => /permission denied/.test(String(error.message)) || error.code === '42501',
    );
  });

  test('سلامت عملکرد، تصویر تصمیم‌پذیر می‌دهد', async () => {
    const health = await engine.query(`select ops.performance_health('24 hours') as h`);
    const value = health[0].h;

    assert.ok(Number(value.samples) > 0);
    assert.ok(Number(value.poor) > 0, 'نمونه‌های بد باید شمرده شوند');
    assert.ok(Number(value.poor_ratio) >= 0 && Number(value.poor_ratio) <= 1);
    assert.ok(Number(value.regressions_open) >= 0);
    assert.ok(Array.isArray(value.worst_routes));
    assert.ok(Array.isArray(value.routes_without_budget));
    assert.ok(value.worst_routes.length > 0, 'بدترین مسیرها باید نام برده شوند');
  });
});
