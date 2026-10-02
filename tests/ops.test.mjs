/**
 * تست لایهٔ عملیات (§13، §88، §93–۹۴، §106–۱۰۸، §132، §191؛ Addendum §56–95).
 *
 * این تست روی همان SQL واقعی اجرا می‌شود که در تولید اجرا می‌شود. هیچ شبیه‌سازی
 * و هیچ جدول ساختگی در کار نیست (§102): صف، وبهوک، سقف نرخ، پشتیبان و نگهداشت
 * همه با همان توابع و همان RLS سنجیده می‌شوند.
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

/** اجرای یک قطعه SQL در نقش دلخواه، با زمینهٔ دلخواه (§55). */
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

/** ساخت کسب‌وکار تازه با مالک مشخص؛ دادهٔ آماده‌سازی با اتصال مالک جدول. */
async function makeBusiness(ownerId, slug, name) {
  const rows = await engine.query(
    `insert into app.business (slug, name, business_type_key, owner_user_id) values ($1, $2, 'veterinary_clinic', $3) returning id`,
    [slug, name, ownerId],
  );
  return String(rows[0].id);
}

before(async () => {
  engine = await openDatabase();
  await migrate(engine, { dir: join(projectRoot, 'migrations') });
  await engine.exec(await readFile(join(projectRoot, 'seeds', '0001_reference.sql'), 'utf8'));

  const ownerRole = await engine.query("select id from app.role where business_id is null and key = 'owner'");
  const users = await engine.query(
    `insert into auth.app_user (display_name, status) values ('آلیس رضایی', 'active'), ('بابک مرادی', 'active') returning id`,
  );
  [aliceId, bobId] = users.map((row) => String(row.id));

  businessA = await makeBusiness(aliceId, 'tak-pet', 'پت‌شاپ تک‌پت');
  businessB = await makeBusiness(bobId, 'vet-sharif', 'کلینیک دامن‌پزشکی شریف');

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
describe('صف کار (§93، Addendum §56–72)', () => {
  test('کارگر، کار را برمی‌دارد؛ کارگر دوم همان کار را دو بار برنمی‌دارد', async () => {
    await engine.query(
      `insert into ops.job (kind, payload, dedupe_key) values ('email.send', '{"to":"a@example.com"}', 'once-only')`,
    );

    const first = await asRole('pv_worker', null, (handle) => handle.query(`select * from ops.claim_job('worker-1')`));
    assert.equal(first.length, 1, 'کارگر اول باید یک کار بردارد');
    assert.equal(first[0].status, 'running');
    assert.equal(first[0].locked_by, 'worker-1');
    assert.equal(Number(first[0].attempts), 1, 'شمار تلاش باید همان‌جا یکی جلو برود');

    const second = await asRole('pv_worker', null, (handle) =>
      handle.query(`select * from ops.claim_job('worker-2')`),
    );
    assert.equal(second.length, 0, 'کارگر دوم نباید همان کار را دوباره بردارد');
  });

  test('کلید یکتایی، کار تکراری در صف نمی‌سازد (§180)', async () => {
    await assert.rejects(
      () =>
        engine.query(`insert into ops.job (kind, payload, dedupe_key) values ('email.send', '{}'::jsonb, 'once-only')`),
      (error) => error.code === '23505',
      'دو کار هم‌نام در حال انتظار نباید ممکن باشد',
    );
  });

  test('شکست: پس‌رفت نمایی، و پس از پایان سهمیه، صف مرده', async () => {
    const [job] = await engine.query(
      `insert into ops.job (kind, payload, max_attempts) values ('image.variant', '{}'::jsonb, 2) returning id`,
    );
    const jobId = String(job.id);

    const claimed = await asRole('pv_worker', null, (handle) =>
      handle.query(`select * from ops.claim_job('w') where id = $1`, [jobId]),
    );
    const afterFirstFail = await asRole('pv_worker', null, (handle) =>
      handle.query(`select * from ops.finish_job($1, false, 'شبکه قطع شد')`, [jobId]),
    );
    assert.equal(claimed.length, 1);
    assert.equal(afterFirstFail[0].status, 'pending', 'پس از خطای اول، کار باید به صف برگردد');
    assert.ok(new Date(afterFirstFail[0].available_at) > new Date(), 'بازگشت باید با تأخیر باشد، نه فوری');

    // سهمیهٔ تلاش: بار دوم برداشتن، آخرین تلاش است.
    await engine.query(`update ops.job set available_at = now() where id = $1`, [jobId]);
    await asRole('pv_worker', null, (handle) => handle.query(`select * from ops.claim_job('w') where id = $1`, [jobId]));
    const afterSecondFail = await asRole('pv_worker', null, (handle) =>
      handle.query(`select * from ops.finish_job($1, false, 'باز هم خطا')`, [jobId]),
    );
    assert.equal(afterSecondFail[0].status, 'dead', 'پس از پایان سهمیه، کار باید به صف مرده برود');

    const attempts = await engine.query(`select attempt, outcome, error from ops.job_attempt where job_id = $1 order by attempt`, [
      jobId,
    ]);
    assert.equal(attempts.length, 2, 'هر تلاش باید در دفتر ثبت شده باشد');
    assert.deepEqual(
      attempts.map((row) => String(row.outcome)),
      ['failed', 'dead'],
    );
  });

  test('کار پایان‌یافته، دوباره پایان‌پذیر نیست', async () => {
    const [job] = await engine.query(`insert into ops.job (kind) values ('smoke.test') returning id`);
    const jobId = String(job.id);
    await asRole('pv_worker', null, (handle) => handle.query(`select * from ops.claim_job('w') where id = $1`, [jobId]));
    await asRole('pv_worker', null, (handle) => handle.query(`select * from ops.finish_job($1, true)`, [jobId]));
    await assert.rejects(
      () => asRole('pv_worker', null, (handle) => handle.query(`select * from ops.finish_job($1, true)`, [jobId])),
      (error) => /پایان‌پذیر نیست/.test(String(error.message)),
      'پایان دوبارهٔ کار، باید صریحاً رد شود',
    );
  });

  test('کارگر ناپدید: کار رهاشده به صف برمی‌گردد، نه اینکه برای همیشه گروگان بماند', async () => {
    const [job] = await engine.query(
      `insert into ops.job (kind, max_attempts) values ('backup.run', 5) returning id`,
    );
    const jobId = String(job.id);
    await asRole('pv_worker', null, (handle) => handle.query(`select * from ops.claim_job('worker-gone') where id = $1`, [jobId]));
    // کارگر مرده؛ قفل کهنه می‌شود.
    await engine.query(`update ops.job set locked_at = now() - interval '2 hours' where id = $1`, [jobId]);

    const reclaimed = await asRole('pv_worker', null, (handle) =>
      handle.query(`select ops.reclaim_stale_jobs(900) as n`),
    );
    assert.equal(Number(reclaimed[0].n), 1, 'یک کار کهنه باید بازیافت شود');

    const back = await engine.query(`select status, locked_by from ops.job where id = $1`, [jobId]);
    assert.equal(back[0].status, 'pending');
    assert.equal(back[0].locked_by, null);
  });

  test('سلامت صف، تصویر واقعی می‌دهد', async () => {
    const health = await engine.query('select ops.job_health() as h');
    const value = health[0].h;
    for (const key of ['pending', 'running', 'failed', 'dead', 'succeeded']) {
      assert.equal(typeof value[key], 'number', `کلید ${key} باید شمار باشد`);
    }
    assert.ok(value.dead >= 1, 'صف مرده باید همان کارهای واقعی را نشان دهد');
    assert.ok(typeof value.oldest_pending_seconds === 'number');
  });
});

// ---------------------------------------------------------------------------
describe('وبهوک (§79، §106–108)', () => {
  let endpointA;
  let endpointB;
  let disabledEndpoint;

  test('راز وبهوک ذخیره نمی‌شود؛ فقط ارجاعش', async () => {
    const columns = await engine.query(
      `select column_name from information_schema.columns where table_schema = 'ops' and table_name = 'webhook_endpoint'`,
    );
    const names = columns.map((row) => String(row.column_name));
    for (const forbidden of ['secret', 'signing_key', 'token', 'password']) {
      assert.equal(
        names.includes(forbidden),
        false,
        `ستون «${forbidden}» نباید در جدول مقصد وبهوک باشد؛ راز در مخزن راز می‌نشیند (§79)`,
      );
    }
    assert.ok(names.includes('secret_ref'), 'ارجاع راز باید باشد');
    assert.equal(
      names.some((name) => name.startsWith('secret') && name !== 'secret_ref'),
      false,
    );
  });

  test('مقصد ناسالم نمی‌تواند ساخته شود: https اجباری', async () => {
    await assert.rejects(
      () =>
        engine.query(
          `insert into ops.webhook_endpoint (key, url, secret_ref, event_types) values ('bad', 'http://example.com/hook', 'kv/bad', array['content.published'])`,
        ),
      (error) => error.code === '23514',
    );
  });

  test('پخش رخداد: فقط مقصدهای هم‌نوع، ایدمپوتنت', async () => {
    const rows = await engine.query(
      `insert into ops.webhook_endpoint (business_id, key, url, secret_ref, event_types) values
         ($1, 'crm', 'https://crm.example.com/hook', 'kv/crm', array['content.published']),
         (null, 'partner', 'https://partner.example.com/hook', 'kv/partner', array['content.published']),
         ($1, 'shop', 'https://shop.example.com/hook', 'kv/shop', array['order.created'])
       returning id, key`,
      [businessA],
    );
    endpointA = String(rows.find((row) => row.key === 'crm').id);
    endpointB = String(rows.find((row) => row.key === 'partner').id);

    const [event] = await engine.query(
      `insert into ops.event (event_type, entity_type, entity_id, business_id, payload)
       values ('content.published', 'content', 'abc', $1, '{"slug":"tak-pet"}') returning id`,
      [businessA],
    );

    const delivered = await asRole('pv_worker', null, (handle) =>
      handle.query('select ops.fan_out_webhook($1) as n', [String(event.id)]),
    );
    assert.equal(Number(delivered[0].n), 2, 'مقصد هم‌نوع کسب‌وکار و مقصد سراسری، هر دو باید بگیرند');

    const again = await asRole('pv_worker', null, (handle) =>
      handle.query('select ops.fan_out_webhook($1) as n', [String(event.id)]),
    );
    assert.equal(Number(again[0].n), 0, 'پخش دوباره نباید تحویل تکراری بسازد (§180)');

    const rowsAll = await engine.query(
      `select endpoint_id, payload -> 'type' as type from ops.webhook_delivery where event_id = $1`,
      [String(event.id)],
    );
    assert.equal(rowsAll.length, 2);
    assert.ok(rowsAll.every((row) => String(row.type) === 'content.published'));
  });

  test('تحویل ناموفق: پس‌رفت، سپس صف مرده در پایان سهمیه', async () => {
    await engine.query(`update ops.webhook_endpoint set max_attempts = 2 where id = $1`, [endpointA]);
    const [delivery] = await engine.query(
      `select id from ops.webhook_delivery where endpoint_id = $1 limit 1`,
      [endpointA],
    );
    const deliveryId = String(delivery.id);

    const first = await asRole('pv_worker', null, (handle) =>
      handle.query(`select * from ops.record_webhook_result($1, false, 500, 'خطای سرور')`, [deliveryId]),
    );
    assert.equal(first[0].status, 'failed');
    assert.equal(Number(first[0].attempts), 1);
    assert.ok(new Date(first[0].next_attempt_at) > new Date());

    const second = await asRole('pv_worker', null, (handle) =>
      handle.query(`select * from ops.record_webhook_result($1, false, 503, 'باز هم خطا')`, [deliveryId]),
    );
    assert.equal(second[0].status, 'dead', 'پس از پایان سهمیه، تحویل باید مرده شود');

    await assert.rejects(
      () => asRole('pv_worker', null, (handle) => handle.query(`select * from ops.record_webhook_result($1, true)`, [deliveryId])),
      (error) => /بسته شده است/.test(String(error.message)),
    );
  });

  test('مقصدی که پشت‌سرهم می‌شکند، خودکار خاموش می‌شود (§108)', async () => {
    const [endpoint] = await engine.query(
      `insert into ops.webhook_endpoint (business_id, key, url, secret_ref, event_types, max_attempts, disable_after_failures)
       values ($1, 'flaky', 'https://flaky.example.com/hook', 'kv/flaky', array['content.published'], 50, 3)
       returning id`,
      [businessA],
    );
    disabledEndpoint = String(endpoint.id);

    const deliveries = [];
    for (let index = 0; index < 3; index += 1) {
      const [row] = await engine.query(
        `insert into ops.event (event_type, entity_type, entity_id, business_id)
         values ('content.published', 'content', $1, $2) returning id`,
        [`e${index}`, businessA],
      );
      await asRole('pv_worker', null, (handle) => handle.query('select ops.fan_out_webhook($1)', [String(row.id)]));
      const [delivery] = await engine.query(
        `select id from ops.webhook_delivery where endpoint_id = $1 and event_id = $2`,
        [disabledEndpoint, String(row.id)],
      );
      deliveries.push(String(delivery.id));
      await asRole('pv_worker', null, (handle) =>
        handle.query(`select * from ops.record_webhook_result($1, false, 500, 'خطا')`, [String(delivery.id)]),
      );
    }

    const endpointState = await engine.query(
      `select is_active, consecutive_failures, disabled_at, disabled_reason from ops.webhook_endpoint where id = $1`,
      [disabledEndpoint],
    );
    assert.equal(Number(endpointState[0].consecutive_failures), 3);
    assert.notEqual(endpointState[0].disabled_at, null, 'مقصد باید خاموش شده باشد');
    assert.ok(/خاموش/.test(String(endpointState[0].disabled_reason)));

    // مقصد خاموش، تحویل تازه نمی‌گیرد.
    const [freshEvent] = await engine.query(
      `insert into ops.event (event_type, entity_type, entity_id, business_id)
       values ('content.published', 'content', 'later', $1) returning id`,
      [businessA],
    );
    await asRole('pv_worker', null, (handle) =>
      handle.query('select ops.fan_out_webhook($1)', [String(freshEvent.id)]),
    );
    const forDisabled = await engine.query(
      `select count(*)::int as c from ops.webhook_delivery where endpoint_id = $1 and event_id = $2`,
      [disabledEndpoint, String(freshEvent.id)],
    );
    assert.equal(Number(forDisabled[0].c), 0, 'مقصد خاموش نباید تحویل تازه بگیرد');
  });

  test('تحویل موفق، خطاهای پشت‌سرهم را صفر می‌کند', async () => {
    await engine.query(`update ops.webhook_endpoint set disabled_at = null, disabled_reason = null where id = $1`, [
      disabledEndpoint,
    ]);
    const [delivery] = await engine.query(
      `insert into ops.event (event_type, entity_type, entity_id, business_id) values ('content.published', 'content', 'ok', $1) returning id`,
      [businessA],
    );
    await asRole('pv_worker', null, (handle) =>
      handle.query('select ops.fan_out_webhook($1)', [String(delivery.id)]),
    );
    const [row] = await engine.query(
      `select id from ops.webhook_delivery where endpoint_id = $1 and event_id = $2`,
      [disabledEndpoint, String(delivery.id)],
    );
    await asRole('pv_worker', null, (handle) =>
      handle.query(`select * from ops.record_webhook_result($1, true, 200)`, [String(row.id)]),
    );
    const state = await engine.query(
      `select consecutive_failures, last_success_at from ops.webhook_endpoint where id = $1`,
      [disabledEndpoint],
    );
    assert.equal(Number(state[0].consecutive_failures), 0);
    assert.notEqual(state[0].last_success_at, null);
  });

  test('مقصد کسب‌وکار، برای عضو کسب‌وکار دیگر دیده نمی‌شود', async () => {
    const rows = await asRole('pv_app', { userId: bobId, businessId: businessB }, (handle) =>
      handle.query(`select count(*)::int as c from ops.webhook_endpoint where id = $1`, [endpointA]),
    );
    assert.equal(Number(rows[0].c), 0, 'ایزوله‌سازی مستأجر روی مقصدهای وبهوک هم برقرار است');
  });
});

// ---------------------------------------------------------------------------
describe('سقف نرخ پایدار (§13)', () => {
  test('مصرف اتمی: تا سقف اجازه، بعدش رد', async () => {
    const hash = 'ip:'.padEnd(10, 'a');
    const first = await asRole('pv_public', null, (handle) =>
      handle.query(`select * from ops.consume_rate_limit('ip', $1, 60, 3)`, [hash]),
    );
    assert.equal(first[0].allowed, true);
    assert.equal(Number(first[0].remaining), 2, 'پس از یک مصرف از سه، دو تا مانده');

    await asRole('pv_public', null, (handle) => handle.query(`select * from ops.consume_rate_limit('ip', $1, 60, 3)`, [hash]));
    await asRole('pv_public', null, (handle) => handle.query(`select * from ops.consume_rate_limit('ip', $1, 60, 3)`, [hash]));

    const blocked = await asRole('pv_public', null, (handle) =>
      handle.query(`select * from ops.consume_rate_limit('ip', $1, 60, 3)`, [hash]),
    );
    assert.equal(blocked[0].allowed, false, 'مصرف چهارم باید رد شود');
    assert.equal(Number(blocked[0].remaining), 0);
    assert.ok(new Date(blocked[0].reset_at) > new Date(), 'زمان باز شدن پنجره باید در آینده باشد');
  });

  test('موضوع‌ها جدا شمرده می‌شوند: مال من، سهمیهٔ تو را نمی‌خورد', async () => {
    const one = 'ip:'.padEnd(10, 'b');
    const two = 'ip:'.padEnd(10, 'c');
    await asRole('pv_public', null, (handle) => handle.query(`select * from ops.consume_rate_limit('ip', $1, 60, 1)`, [one]));
    const other = await asRole('pv_public', null, (handle) =>
      handle.query(`select * from ops.consume_rate_limit('ip', $1, 60, 1)`, [two]),
    );
    assert.equal(other[0].allowed, true, 'سهمیهٔ هر موضوع باید مستقل باشد');
  });

  test('سقف نرخ پیش از ورود هم کار می‌کند (نقش بی‌نام)', async () => {
    const rows = await asRole('pv_public', null, (handle) =>
      handle.query(`select has_function_privilege('pv_public', 'ops.consume_rate_limit(text,text,integer,integer,integer)', 'execute') as ok`),
    );
    assert.equal(rows[0].ok, true, 'سقف نرخ روی صفحهٔ ورود، پیش از احراز هویت لازم است');
  });

  test('ورودی نامعتبر، صریحاً رد می‌شود', async () => {
    await assert.rejects(
      () => engine.query(`select * from ops.consume_rate_limit('ip', 'x', 999999, 10)`),
      (error) => /پنجرهٔ زمانی/.test(String(error.message)),
    );
    await assert.rejects(
      () => engine.query(`select * from ops.consume_rate_limit('ip', 'x', 60, 0)`),
      (error) => /سقف/.test(String(error.message)),
    );
    await assert.rejects(
      () => engine.query(`select * from ops.consume_rate_limit('kind_unknown', 'x', 60, 10)`),
      (error) => error.code === '23514',
    );
  });

  test('پنجره‌های کهنه پاک می‌شوند', async () => {
    await engine.query(`insert into ops.rate_limit_counter (subject_kind, subject_hash, window_seconds, bucket_start, counter)
                        values ('ip', 'stale-subject', 60, now() - interval '3 hours', 5)`);
    const pruned = await asRole('pv_worker', null, (handle) =>
      handle.query('select ops.prune_rate_limit_counters(3600) as n'),
    );
    assert.ok(Number(pruned[0].n) >= 1);
    const left = await engine.query(`select count(*)::int as c from ops.rate_limit_counter where subject_hash = 'stale-subject'`);
    assert.equal(Number(left[0].c), 0);
  });
});

// ---------------------------------------------------------------------------
describe('پشتیبان و بازیابی (§88، §191)', () => {
  let backupId;

  test('پشتیبانِ رمزنگاری‌نشده بدون کلید پذیرفته نمی‌شود', async () => {
    await assert.rejects(
      () =>
        engine.query(
          `insert into ops.backup (kind, status, is_encrypted, key_ref, finished_at) values ('full', 'succeeded', true, null, now())`,
        ),
      (error) => error.code === '23514',
    );
  });

  test('آزمون بازیابی ناموفق، «موفق» ثبت نمی‌شود', async () => {
    const [backup] = await engine.query(
      `insert into ops.backup (kind, status, storage_key, size_bytes, checksum_sha256, key_ref, schema_version, finished_at, duration_ms)
       values ('full', 'succeeded', 'backups/0001.dump', 1024, repeat('a', 64), 'kv/backup', '0007', now(), 1200) returning id`,
    );
    backupId = String(backup.id);

    await assert.rejects(
      () =>
        engine.query(
          `insert into ops.restore_test (backup_id, environment, status, finished_at, checks_failed)
           values ($1, 'fresh', 'succeeded', now(), 2)`,
          [backupId],
        ),
      (error) => error.code === '23514',
      'بازیابِ دارای بررسی شکست‌خورده، نباید موفق نامیده شود (§191)',
    );
  });

  test('پشتیبانِ بدون آزمون بازیابی، در فهرست «تأییدنشده» می‌ماند', async () => {
    const unverified = await engine.query(
      `select id from ops.unverified_backups(0) where id = $1`,
      [backupId],
    );
    assert.equal(unverified.length, 1, 'بدون آزمون موفق، پشتیبان هنوز تأیید نشده است');

    await engine.query(
      `insert into ops.restore_test (backup_id, environment, status, finished_at, duration_ms, migrations_applied, seed_applied, checks_passed)
       values ($1, 'fresh', 'succeeded', now(), 800, 7, 1, 12)`,
      [backupId],
    );
    const afterTest = await engine.query(`select id from ops.unverified_backups(0) where id = $1`, [backupId]);
    assert.equal(afterTest.length, 0, 'با آزمون موفق، پشتیبان از فهرست تأییدنشده‌ها بیرون می‌رود');
  });

  test('دفتر تلاش، سابقه است: ویرایش و حذف ندارد', async () => {
    await assert.rejects(
      () => engine.query('update ops.job_attempt set error = null'),
      (error) => error.code === '23001' || /افزودنی/.test(String(error.message)),
      'سابقهٔ تلاش‌ها نباید پاک‌شدنی باشد؛ وگرنه «چه شد که مرد؟» جوابی ندارد',
    );
    await assert.rejects(
      () => engine.query('delete from ops.job_attempt'),
      (error) => error.code === '23001' || /افزودنی/.test(String(error.message)),
    );
  });

  test('دسترسی پشتیبان، جدا از «نقش پلتفرمی داشتن» است', async () => {
    // نقش `admin` پلتفرم، مجوز پشتیبان‌گیری ندارد.
    const asAdmin = await asRole('pv_app', { platformRole: 'admin' }, (handle) =>
      handle.query('select count(*)::int as c from ops.backup'),
    );
    assert.equal(Number(asAdmin[0].c), 0, 'نقش admin پلتفرم نباید پشتیبان‌ها را ببیند');

    await assert.rejects(
      () =>
        asRole('pv_app', { platformRole: 'admin' }, (handle) =>
          handle.query(
            `insert into ops.backup (kind, status, storage_key, checksum_sha256, key_ref)
             values ('full', 'running', 'backups/x.dump', repeat('b', 64), 'kv/backup')`,
          ),
        ),
      (error) => error.code === '42501' || /row-level security/i.test(String(error.message)),
      'نوشتن پشتیبان باید مجوز platform.backup.manage بخواهد، نه فقط نقش داشتن',
    );

    // نقش `superadmin` همهٔ مجوزها را دارد.
    const asSuperadmin = await asRole('pv_app', { platformRole: 'superadmin' }, (handle) =>
      handle.query('select count(*)::int as c from ops.backup'),
    );
    assert.ok(Number(asSuperadmin[0].c) >= 1, 'مدیر ارشد باید پشتیبان‌ها را ببیند');
  });
});

// ---------------------------------------------------------------------------
describe('نگهداشت داده (§132)', () => {
  test('سیاست‌های نسخهٔ یک، از seed آمده‌اند', async () => {
    const rows = await engine.query('select count(*)::int as c, count(*) filter (where legal_hold)::int as holds from ops.retention_policy');
    assert.ok(Number(rows[0].c) >= 6, `سیاست نگهداشت: ${rows[0].c}`);
    assert.equal(Number(rows[0].holds), 0);
  });

  test('نگهداشت قانونی، بدون دلیل ممکن نیست', async () => {
    await assert.rejects(
      () =>
        engine.query(
          `insert into ops.retention_policy (scope, name_fa, retain_days, action, legal_hold) values ('x.y', 'آزمون', 30, 'delete', true)`,
        ),
      (error) => error.code === '23514',
    );
  });

  test('نگهداشت قانونی، سیاست را از صف اجرا بیرون می‌برد', async () => {
    await engine.query(
      `insert into ops.retention_policy (scope, name_fa, retain_days, action, legal_hold, legal_hold_reason)
       values ('legal.hold.test', 'در نگهداشت قانونی', 30, 'delete', true, 'دستور قضایی')`,
    );
    const due = await engine.query(`select scope from ops.retention_due(100)`);
    assert.equal(
      due.some((row) => String(row.scope) === 'legal.hold.test'),
      false,
      'سیاست در نگهداشت قانونی نباید اجرا شود',
    );

    await engine.query(`update ops.retention_policy set legal_hold = false, legal_hold_reason = null where scope = 'legal.hold.test'`);
    const after = await engine.query(`select scope from ops.retention_due(100)`);
    assert.ok(after.some((row) => String(row.scope) === 'legal.hold.test'));
  });

  test('دامنهٔ تکراری پذیرفته نمی‌شود و دامنه شکل درست دارد', async () => {
    await assert.rejects(
      () =>
        engine.query(
          `insert into ops.retention_policy (scope, name_fa, retain_days, action) values ('auth.sessions', 'تکراری', 10, 'delete')`,
        ),
      (error) => error.code === '23505',
    );
    await assert.rejects(
      () =>
        engine.query(
          `insert into ops.retention_policy (scope, name_fa, retain_days, action) values ('Scope-With-Upper', 'بد', 10, 'delete')`,
        ),
      (error) => error.code === '23514',
    );
  });

  test('تصویر نگهداشت، عددهای واقعی می‌دهد', async () => {
    const summary = (await engine.query('select ops.retention_summary() as s'))[0].s;
    assert.ok(summary.policies >= 7);
    assert.ok(summary.active >= 6);
    assert.equal(summary.on_hold, 0);
    assert.ok(summary.due_now >= 1);
  });

  test('دفتر اجرای نگهداشت، افزودنی است', async () => {
    const [policy] = await engine.query(`select id from ops.retention_policy where scope = 'auth.sessions'`);
    await engine.query(
      `insert into ops.retention_run (policy_id, status, cutoff_at, examined, affected, finished_at, duration_ms)
       values ($1, 'succeeded', now() - interval '90 days', 10, 4, now(), 30)`,
      [String(policy.id)],
    );
    const runs = await engine.query('select examined, affected from ops.retention_run');
    assert.equal(runs.length, 1);
    assert.equal(Number(runs[0].affected), 4);
  });
});

// ---------------------------------------------------------------------------
describe('مجوز پلتفرم، در برابر «فقط داشتن نقش» (§16–17، §142)', () => {
  test('بی‌نقش، هیچ مجوز پلتفرمی ندارد', async () => {
    const rows = await engine.query(`select app.has_platform_permission('platform.backup.manage') as ok`);
    assert.equal(rows[0].ok, false);
  });

  test('هر مجوز پلتفرمی که در سیاست‌ها به کار رفته، به دستِ‌کم یک نقش داده شده است', async () => {
    // همان دستهٔ اشکالی که در گام ۱۰ گرفتیم: مجوزی که سیاست به آن تکیه می‌کند
    // ولی هیچ نقشی ندارد، سیاست را بی‌اثر می‌کند و هیچ تستی هم شکست نمی‌خورد.
    const policies = await engine.query(`
      select coalesce(qual, '') || ' ' || coalesce(with_check, '') as body
      from pg_policies where schemaname in ('ref', 'auth', 'app', 'media', 'design', 'seo', 'ops')
    `);
    const referenced = new Set();
    for (const policy of policies) {
      for (const match of String(policy.body).matchAll(/has_platform_permission\('([a-z0-9_.]+)'::text\)/g)) {
        referenced.add(match[1]);
      }
    }
    assert.ok(referenced.size >= 5, `مجوزهای پلتفرمی ارجاع‌شده: ${referenced.size}`);

    const granted = new Set(
      (await engine.query('select distinct permission_key from auth.platform_role_permission')).map((row) =>
        String(row.permission_key),
      ),
    );
    const orphan = [...referenced].filter((key) => !granted.has(key));
    assert.deepEqual(orphan, [], `مجوز پلتفرمی بدون نقش: ${orphan.join(', ')}`);
  });
});
