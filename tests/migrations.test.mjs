/**
 * تست مهاجرت‌ها و سیاست‌های پایگاه‌داده.
 *
 * اینجا رفتار واقعی PostgreSQL سنجیده می‌شود: موتور تعبیه‌شده همان PostgreSQL
 * ۱۸ است، با همان RLS، همان تریگرها و همان قیدها. پس اگر ایزوله‌سازی چندمستأجری
 * اینجا سبز نشود، در تولید هم سبز نمی‌شود.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDatabase } from '../scripts/lib/engine.mjs';
import { migrate, migrationStatus, MigrationDriftError, checksumOf, listMigrationFiles } from '../scripts/lib/migrate.mjs';
import { uuidv7 } from '../packages/shared/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');

const TENANT_A = '11111111-1111-7111-8111-111111111111';
const TENANT_B = '22222222-2222-7222-8222-222222222222';

let engine;

before(async () => {
  engine = await openDatabase();
  const result = await migrate(engine, { dir: migrationsDir });
  assert.ok(result.applied.length >= 1, 'مهاجرت‌ها باید روی پایگاه‌دادهٔ خالی اجرا شوند');
});

after(async () => {
  await engine.close();
});

describe('اجراکنندهٔ مهاجرت (§49–51)', () => {
  test('همهٔ مهاجرت‌ها روی پایگاه‌دادهٔ خالی اجرا می‌شوند', async () => {
    const rows = await engine.query('select version, name, checksum, statement_count from ops.migration order by version');
    assert.ok(rows.length >= 1);
    assert.equal(String(rows[0].version), '0001');
    assert.ok(String(rows[0].checksum).startsWith('sha256:'));
    assert.ok(Number(rows[0].statement_count) > 40, 'شمار دستورها باید ثبت شود');
  });

  test('جدول‌های بنیان ساخته شده‌اند', async () => {
    const rows = await engine.query(`
      select table_schema || '.' || table_name as name
      from information_schema.tables
      where table_schema in ('ops', 'app', 'auth', 'ref', 'media', 'design', 'seo', 'analytics')
      order by name
    `);
    const names = rows.map((row) => String(row.name));
    for (const expected of [
      'ops.audit_log',
      'ops.event',
      'ops.job',
      'ops.idempotency_key',
      'ops.setting',
      'ops.security_event',
      'ops.feature',
    ]) {
      assert.ok(names.includes(expected), `جدول ${expected} ساخته نشده`);
    }
  });

  test('اجرای دوباره، بی‌اثر است (§180)', async () => {
    const before = await engine.query('select count(*)::int as c from ops.migration');
    const result = await migrate(engine, { dir: migrationsDir });
    const after = await engine.query('select count(*)::int as c from ops.migration');
    assert.equal(result.applied.length, 0);
    assert.equal(Number(before[0].c), Number(after[0].c));
    assert.ok(result.skipped >= 1);
  });

  test('وضعیت مهاجرت‌ها قابل خواندن است', async () => {
    const status = await migrationStatus(engine, { dir: migrationsDir });
    assert.ok(status.length >= 1);
    assert.equal(status[0].state, 'applied');
    assert.equal(status[0].drift, false);
    assert.ok(Number(status[0].durationMs) >= 0);
  });

  test('تغییر محتوای مهاجرت اجراشده، تشخیص داده می‌شود', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'petavu-drift-'));
    await cp(migrationsDir, join(scratch, 'migrations'), { recursive: true });
    const driftedEngine = await openDatabase();
    try {
      await migrate(driftedEngine, { dir: join(scratch, 'migrations') });
      const target = join(scratch, 'migrations', '0001_foundation.sql');
      const original = await readFile(target, 'utf8');
      await writeFile(target, `${original}\n-- یک تغییر پس از اجرا\n`, 'utf8');

      await assert.rejects(
        () => migrate(driftedEngine, { dir: join(scratch, 'migrations') }),
        (error) => error instanceof MigrationDriftError && error.version === '0001',
      );
    } finally {
      await driftedEngine.close();
    }
  });

  test('درهم مهاجرت به تفاوت خط‌پایان حساس نیست', () => {
    const unix = 'select 1;\nselect 2;\n';
    const windows = 'select 1;\r\nselect 2;\r\n';
    const trailing = 'select 1;\nselect 2;   \n';
    assert.equal(checksumOf(unix), checksumOf(windows));
    assert.equal(checksumOf(unix), checksumOf(trailing));
    assert.notEqual(checksumOf(unix), checksumOf('select 1;\nselect 3;\n'));
  });

  test('نام‌گذاری فایل‌های مهاجرت بررسی می‌شود', async () => {
    const files = await listMigrationFiles(migrationsDir);
    for (const file of files) {
      assert.match(file.filename, /^\d{4}_[a-z0-9_]+\.sql$/);
    }
    assert.deepEqual(
      files.map((file) => file.version),
      [...files.map((file) => file.version)].sort(),
      'فایل‌ها باید به ترتیب شماره بیایند',
    );
  });

  test('مهاجرت‌ها به هیچ افزونهٔ بیرونی وابسته نیستند', async () => {
    const rows = await engine.query('select extname from pg_extension order by extname');
    const names = rows.map((row) => String(row.extname));
    assert.deepEqual(names, ['plpgsql'], `افزونهٔ ناخواسته نصب شده: ${names.join(', ')}`);
    for (const unavailable of engine.capabilities.unavailable_extensions) {
      assert.ok(!names.includes(unavailable));
    }
  });
});

describe('RLS و ایزوله‌سازی (§14، §54–55)', () => {
  test('همهٔ جدول‌های بنیان، RLS روشن دارند', async () => {
    const rows = await engine.query(`
      select c.relname as name, c.relrowsecurity as enabled
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'ops' and c.relkind = 'r' and c.relname <> 'migration'
    `);
    assert.ok(rows.length >= 7);
    for (const row of rows) {
      assert.equal(row.enabled, true, `${String(row.name)} بدون RLS است`);
    }
  });

  test('هر جدول دارای RLS، دست‌کم یک سیاست دارد', async () => {
    const rows = await engine.query(`
      select c.relname as table_name, count(p.policyname)::int as policies
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_policies p on p.schemaname = n.nspname and p.tablename = c.relname
      where n.nspname = 'ops' and c.relkind = 'r' and c.relrowsecurity
      group by c.relname
    `);
    for (const row of rows) {
      assert.ok(Number(row.policies) >= 1, `${String(row.table_name)} سیاست ندارد`);
    }
  });

  test('بدون زمینهٔ پلتفرمی، رد حسابرسی دیده نمی‌شود', async () => {
    await engine.query(
      `insert into ops.audit_log (actor_type, action, entity_type, entity_id)
       values ('system', 'test.created', 'test', 't1')`,
    );

    const asOwner = await engine.query('select count(*)::int as c from ops.audit_log');
    assert.ok(Number(asOwner[0].c) >= 1, 'مالک (نقش مهاجرت) بدون RLS می‌بیند');

    const asApp = await engine.asRole('pv_app', () => engine.query('select count(*)::int as c from ops.audit_log'));
    assert.equal(Number(asApp[0].c), 0, 'نقش برنامه بدون زمینهٔ پلتفرمی نباید چیزی ببیند');
  });

  test('با زمینهٔ پلتفرمی، رد حسابرسی خوانده می‌شود', async () => {
    await engine.setContext({ platformRole: 'superadmin' });
    try {
      const rows = await engine.asRole('pv_app', () => engine.query('select action from ops.audit_log'));
      assert.ok(rows.length >= 1);
    } finally {
      await engine.query("select set_config('app.platform_role', '', false)");
    }
  });

  test('نقش بی‌نام (public) به صف کار دست ندارد', async () => {
    // هر دو نتیجه پذیرفته است و هر دو «بسته» هستند: یا اختیار جدول وجود ندارد
    // (خطای مجوز)، یا RLS ردیفی نمی‌دهد. هیچ‌کدام داده لو نمی‌دهد؛ آنچه مهم است
    // این است که «نمایش» رخ ندهد.
    let visible = -1;
    try {
      const jobs = await engine.asRole('pv_public', () => engine.query('select count(*)::int as c from ops.job'));
      visible = Number(jobs[0].c);
    } catch (error) {
      assert.match(String(error.message), /permission denied/i);
    }
    assert.equal(visible <= 0, true, 'صف کار نباید برای بی‌نام دیده شود');

    await assert.rejects(
      () => engine.asRole('pv_public', () => engine.query("insert into ops.setting (key, value) values ('x', '{}')")),
      (error) => error.code === '42501' || error.code === 'insufficient_privilege',
    );
  });

  test('نگهبان RLS، نقشی که مالک جدول‌هاست را تشخیص می‌دهد', async () => {
    const asOwner = await engine.query('select app.rls_is_enforced_for_current_user() as enforced');
    assert.equal(asOwner[0].enforced, false, 'نقش مالک از سیاست‌ها مستثناست و باید لو برود');

    const asApp = await engine.asRole('pv_app', () => engine.query('select app.rls_is_enforced_for_current_user() as enforced'));
    assert.equal(asApp[0].enforced, true, 'نقش برنامه باید RLS فعال داشته باشد');
  });
});

describe('حسابرسی و رخداد — افزودنی بودن (§24، §93–94)', () => {
  test('رد حسابرسی قابل ویرایش نیست', async () => {
    await assert.rejects(
      () => engine.query("update ops.audit_log set action = 'changed.action'"),
      (error) => error.code === '23001' || /افزودنی/.test(String(error.message)),
    );
  });

  test('رد حسابرسی قابل حذف نیست', async () => {
    await assert.rejects(
      () => engine.query('delete from ops.audit_log'),
      (error) => error.code === '23001' || /افزودنی/.test(String(error.message)),
    );
  });

  test('نقش برنامه اجازهٔ ویرایش حسابرسی ندارد', async () => {
    await assert.rejects(
      () => engine.asRole('pv_app', () => engine.query("update ops.audit_log set action = 'x.y'")),
      (error) => error.code === '42501' || error.code === '23001' || /افزودنی/.test(String(error.message)),
    );
  });

  test('شکل رخداد بررسی می‌شود: نوع باید نقطه‌دار باشد', async () => {
    await assert.rejects(
      () =>
        engine.query(
          `insert into ops.event (event_type, entity_type, entity_id) values ('created', 'business', 'b1')`,
        ),
      (error) => error.code === '23514',
    );
    await engine.query(
      `insert into ops.event (event_type, entity_type, entity_id, payload)
       values ('business.created', 'business', $1, '{"slug":"tak-pet"}'::jsonb)`,
      [TENANT_A],
    );
    const rows = await engine.query("select count(*)::int as c from ops.event where event_type = 'business.created'");
    assert.equal(Number(rows[0].c), 1);
  });

  test('رخداد قابل حذف نیست تا خط لوله آن را ببیند', async () => {
    await assert.rejects(
      () => engine.query('delete from ops.event'),
      (error) => error.code === '23001' || /افزودنی/.test(String(error.message)),
    );
  });
});

describe('صف کار (§57، Addendum §56–72)', () => {
  test('قید شکل قفل: کار در حال اجرا باید قفل داشته باشد', async () => {
    await assert.rejects(
      () =>
        engine.query(`insert into ops.job (kind, status) values ('media.rescale', 'running')`),
      (error) => error.code === '23514',
    );
  });

  test('قید شکل پایان: کار تمام‌شده باید زمان پایان داشته باشد', async () => {
    await assert.rejects(
      () => engine.query(`insert into ops.job (kind, status) values ('media.rescale', 'succeeded')`),
      (error) => error.code === '23514',
    );
  });

  test('کلید یکتایی، کار تکراری در صف نمی‌گذارد (§180)', async () => {
    await engine.query(`insert into ops.job (kind, dedupe_key) values ('seo.sitemap', 'sitemap:global')`);
    await assert.rejects(
      () => engine.query(`insert into ops.job (kind, dedupe_key) values ('seo.sitemap', 'sitemap:global')`),
      (error) => error.code === '23505',
    );
    // پس از پایان کار، کلید آزاد می‌شود.
    await engine.query(`update ops.job set status = 'succeeded', finished_at = now() where dedupe_key = 'sitemap:global'`);
    await engine.query(`insert into ops.job (kind, dedupe_key) values ('seo.sitemap', 'sitemap:global')`);
    const rows = await engine.query(`select count(*)::int as c from ops.job where dedupe_key = 'sitemap:global'`);
    assert.equal(Number(rows[0].c), 2);
  });

  test('کارگر می‌تواند کار آماده را با قفل ردیفی بردارد', async () => {
    await engine.query(`insert into ops.job (kind, priority) values ('media.optimize', 10)`);
    const claimed = await engine.asRole('pv_worker', () =>
      engine.query(`
        with picked as (
          select id from ops.job
          where status = 'pending' and available_at <= now() and kind = 'media.optimize'
          order by priority, available_at
          limit 1
          for update skip locked
        )
        update ops.job j
        set status = 'running', locked_by = 'worker-1', locked_at = now(), attempts = j.attempts + 1
        from picked
        where j.id = picked.id
        returning j.id, j.attempts, j.version
      `),
    );
    assert.equal(claimed.length, 1);
    assert.equal(Number(claimed[0].attempts), 1);
    assert.equal(Number(claimed[0].version), 2, 'نسخه باید با هر به‌روزرسانی جلو برود (§58)');
  });
});

describe('تنظیمات و رجیستری', () => {
  test('نسخه و زمان به‌روزرسانی خودکار جلو می‌روند', async () => {
    const inserted = await engine.query(
      `insert into ops.setting (business_id, key, value) values ($1, 'brand.color', '{"primary":"#0f766e"}'::jsonb)
       returning id, version, updated_at`,
      [TENANT_A],
    );
    assert.equal(Number(inserted[0].version), 1);

    const updated = await engine.query(
      `update ops.setting set value = '{"primary":"#115e59"}'::jsonb where id = $1 returning version, created_at, updated_at`,
      [inserted[0].id],
    );
    assert.equal(Number(updated[0].version), 2);
    assert.ok(new Date(updated[0].updated_at) >= new Date(updated[0].created_at));
  });

  test('تنظیمات هر کسب‌وکار از دیگری جدا است', async () => {
    await engine.query(`insert into ops.setting (business_id, key, value) values ($1, 'brand.color', '{"primary":"#000"}'::jsonb)`, [
      TENANT_B,
    ]);

    await engine.setContext({ businessId: TENANT_A });
    try {
      const rows = await engine.asRole('pv_app', () =>
        engine.query('select business_id, value from ops.setting where key = $1', ['brand.color']),
      );
      assert.equal(rows.length, 1);
      assert.equal(String(rows[0].business_id), TENANT_A);
    } finally {
      await engine.query("select set_config('app.business_id', '', false)");
    }
  });

  test('بدون زمینهٔ کسب‌وکار، هیچ تنظیمات کسب‌وکاری دیده نمی‌شود', async () => {
    const rows = await engine.asRole('pv_app', () => engine.query('select count(*)::int as c from ops.setting'));
    assert.equal(Number(rows[0].c), 0, 'تنظیمات کسب‌وکاری بدون زمینه نباید دیده شود');
  });

  test('کلید تنظیمات سقف طول دارد و مقدار jsonb است', async () => {
    await assert.rejects(
      () => engine.query(`insert into ops.setting (key, value) values ('x', '{}'::jsonb)`),
      (error) => error.code === '23514',
    );
  });

  test('چرخهٔ عمر فیچر با زمان‌هایش هم‌خوان است', async () => {
    await assert.rejects(
      () =>
        engine.query(
          `insert into ops.feature (key, name_fa, layer, status) values ('bad.feature', 'بد', 'public', 'deprecated')`,
        ),
      (error) => error.code === '23514',
    );

    await engine.query(
      `insert into ops.feature (key, name_fa, layer, status, performance_budget, seo_metadata)
       values ('business.profile', 'پروفایل کسب‌وکار', 'public', 'draft',
               '{"lcp_ms":2000,"weight_kb":900}'::jsonb, '{"schema":"LocalBusiness"}'::jsonb)`,
    );
    const rows = await engine.query("select key, dependencies from ops.feature where key = 'business.profile'");
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].dependencies, []);
  });

  test('کلید فیچر باید نقطه‌دار و کوچک باشد', async () => {
    for (const bad of ['BusinessProfile', 'business', 'business.Profile', '1business.profile']) {
      await assert.rejects(
        () => engine.query(`insert into ops.feature (key, name_fa, layer) values ($1, 'x', 'public')`, [bad]),
        (error) => error.code === '23514',
        `کلید «${bad}» نباید پذیرفته شود`,
      );
    }
  });

  test('کلید ایدمپوتنسی در محدودهٔ کسب‌وکار یکتاست', async () => {
    await engine.query(
      `insert into ops.idempotency_key (scope, key, request_hash, business_id) values ('listing.create', 'k1', 'h1', $1)`,
      [TENANT_A],
    );
    await assert.rejects(
      () =>
        engine.query(
          `insert into ops.idempotency_key (scope, key, request_hash, business_id) values ('listing.create', 'k1', 'h2', $1)`,
          [TENANT_A],
        ),
      (error) => error.code === '23505',
    );
    // همان کلید در کسب‌وکار دیگر، تعارض نیست: کلید را کلاینت می‌سازد و
    // محدودهٔ آن، کسب‌وکار خودش است.
    await engine.query(
      `insert into ops.idempotency_key (scope, key, request_hash, business_id) values ('listing.create', 'k1', 'h1', $1)`,
      [TENANT_B],
    );

    // و در محدودهٔ سراسری (بدون کسب‌وکار) هم یکتایی برقرار است — جایی که
    // NULL در ایندکس یکتا با NULL برابر نیست و بدون `coalesce` بی‌محافظ می‌ماند.
    await engine.query(
      `insert into ops.idempotency_key (scope, key, request_hash) values ('platform.job', 'k9', 'h1')`,
    );
    await assert.rejects(
      () => engine.query(`insert into ops.idempotency_key (scope, key, request_hash) values ('platform.job', 'k9', 'h2')`),
      (error) => error.code === '23505',
    );
  });
});

describe('کلیدهای اصلی و قرارداد شناسه', () => {
  test('شناسهٔ UUIDv7 ساخته‌شده در برنامه، در پایگاه‌داده پذیرفته می‌شود', async () => {
    const id = uuidv7();
    const rows = await engine.query(
      `insert into ops.setting (id, key, value) values ($1, 'ids.uuidv7', '{}'::jsonb) returning id`,
      [id],
    );
    assert.equal(String(rows[0].id), id);
  });

  test('شناسهٔ نامعتبر رد می‌شود، بدون لو دادن ساختار جدول', async () => {
    await assert.rejects(
      () => engine.query(`insert into ops.setting (id, key, value) values ('not-a-uuid', 'x.y', '{}'::jsonb)`),
      (error) => error.code === '22P02',
    );
  });

  test('جدول‌ها شناسهٔ پیش‌فرض دارند تا درج دستی هم ممکن باشد', async () => {
    const rows = await engine.query(`insert into ops.setting (key, value) values ('seed.default', '{}'::jsonb) returning id`);
    assert.match(String(rows[0].id), /^[0-9a-f-]{36}$/);
  });
});
