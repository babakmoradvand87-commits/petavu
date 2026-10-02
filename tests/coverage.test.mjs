/**
 * آزمون پوشش امنیتی — «سیاست‌ها» را به‌عنوان یک *قرارداد* می‌سنجد (§14، §54–۵۵، §142، §191).
 *
 * چرا این پرونده جدا از تست‌های دامنه است: تست دامنه می‌پرسد «آیا این سناریو
 * درست کار می‌کند؟»؛ این پرونده می‌پرسد «آیا *هیچ* جدولی بی‌سیاست نمانده،
 * هیچ گرنتی بی‌RLS نداریم، هیچ مجوز خیالی در هیچ سیاستی نیست، هیچ ردیف
 * مستأجداری بی‌ایندکس نمی‌ماند؟»
 *
 * این همان درسی است که در گام ۱۰ گرفتیم: مجوزی که سیاست به آن تکیه می‌کند و
 * وجود ندارد، سیاست را بی‌اثر می‌کند و هیچ تست سناریویی هم شکست نمی‌خورد.
 * پس بررسی باید *سراسری* باشد، نه نمونه‌ای.
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

const DOMAIN_SCHEMAS = ['ref', 'auth', 'app', 'media', 'design', 'seo', 'ops'];
const APP_ROLES = ['pv_app', 'pv_worker', 'pv_public', 'pv_reader'];

let engine;

before(async () => {
  engine = await openDatabase();
  await migrate(engine, { dir: join(projectRoot, 'migrations') });
  await applySeeds(engine, { dir: join(projectRoot, 'seeds') });
});

after(async () => {
  await engine.close();
});

/** همهٔ جدول‌های دامنه، با پرچم‌های ساختاری. */
async function tables() {
  return engine.query(`
    select
      n.nspname as schema_name,
      c.relname as table_name,
      c.relrowsecurity as rls_enabled,
      c.relforcerowsecurity as rls_forced,
      (select count(*)::int from pg_policies p where p.schemaname = n.nspname and p.tablename = c.relname) as policies,
      exists (
        select 1 from pg_index i
        where i.indrelid = c.oid and i.indisprimary
      ) as has_primary_key
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and n.nspname = any ($1::text[])
    order by n.nspname, c.relname
  `, [DOMAIN_SCHEMAS]);
}

describe('RLS: رد پیش‌فرض روی همهٔ جدول‌ها (§14، §54)', () => {
  test('هر جدول دامنه، RLS فعال دارد', async () => {
    const rows = await tables();
    const without = rows.filter((row) => !row.rls_enabled).map((row) => `${row.schema_name}.${row.table_name}`);
    assert.deepEqual(without, [], `جدول بدون RLS: ${without.join(', ')}`);
    assert.ok(rows.length >= 70, `شمار جدول‌های دامنه: ${rows.length}`);
  });

  test('هر جدولی که RLS دارد، دست‌کم یک سیاست دارد', async () => {
    // جدول بی‌سیاست یعنی «هیچ‌کس هیچ‌کاری نمی‌تواند» — و این خودش یک اشکال
    // است، چون معمولاً یعنی یک جدول جا مانده، نه اینکه عمداً بسته باشد.
    // جدول‌هایی که *عمداً* بسته‌اند، در فهرست زیر صریح نام برده می‌شوند.
    const INTENTIONALLY_CLOSED = [
      // راز: فقط از راه توابع `security definer` خوانده و نوشته می‌شوند.
      'auth.credential',
      'auth.recovery_code',
      'auth.one_time_token',
      // زیرساخت: دفتر مهاجرت، متعلق به اجراکننده است و گرنتی به نقش‌های
      // برنامه ندارد؛ RLS دارد تا حتی با گرنت ناخواسته هم چیزی بیرون نرود.
      'ops.migration',
    ];
    const rows = await tables();
    const orphan = rows
      .filter((row) => Number(row.policies) === 0)
      .map((row) => `${row.schema_name}.${row.table_name}`)
      .filter((name) => !INTENTIONALLY_CLOSED.includes(name));
    assert.deepEqual(orphan, [], `جدول بدون هیچ سیاست: ${orphan.join(', ')}`);
  });

  test('هر جدول، کلید اصلی دارد', async () => {
    const rows = await tables();
    const without = rows.filter((row) => !row.has_primary_key).map((row) => `${row.schema_name}.${row.table_name}`);
    assert.deepEqual(without, [], `جدول بدون کلید اصلی: ${without.join(', ')}`);
  });

  test('force row level security استفاده نمی‌شود', async () => {
    // عمدی است و مستند: `force` سیاست‌ها را روی مالک جدول هم اعمال می‌کند و
    // در موتورهای میزبانی‌شده به رفتار متفاوت می‌انجامد. به‌جایش هیچ نقش
    // برنامه‌ای مالک جدول‌ها نیست و گرنت‌ها صریح‌اند.
    const rows = await tables();
    const forced = rows.filter((row) => row.rls_forced).map((row) => `${row.schema_name}.${row.table_name}`);
    assert.deepEqual(forced, [], `جدول با force RLS: ${forced.join(', ')}`);
  });

  test('هیچ جدولی به PUBLIC گرنت ندارد و نقش‌ها فقط چهار نقش معلوم‌اند', async () => {
    const grants = await engine.query(`
      select table_schema, table_name, grantee, privilege_type
      from information_schema.role_table_grants
      where table_schema = any ($1::text[])
        and grantee not in ('pv_app', 'pv_worker', 'pv_public', 'pv_reader', 'postgres')
    `, [DOMAIN_SCHEMAS]);
    assert.deepEqual(grants, [], `گرنت به نقش ناشناس: ${JSON.stringify(grants.slice(0, 5))}`);

    const policies = await engine.query(`
      select schemaname, tablename, policyname, roles::text as roles
      from pg_policies where schemaname = any ($1::text[])
    `, [DOMAIN_SCHEMAS]);
    const bad = policies.filter((row) => {
      const roles = String(row.roles).replace(/[{}]/g, '').split(',').map((role) => role.trim()).filter(Boolean);
      return roles.some((role) => role !== 'public' && !APP_ROLES.includes(role)) && roles.includes('public') === false
        ? roles.some((role) => !APP_ROLES.includes(role))
        : roles.includes('public');
    });
    assert.deepEqual(bad, [], `سیاست با نقش غیرمجاز: ${JSON.stringify(bad.slice(0, 5))}`);
  });
});

describe('گرنت و سیاست، دست‌به‌دست هم (§14)', () => {
  test('هیچ گرنتی به pv_app/pv_worker/pv_reader روی جدول بدون RLS نیست', async () => {
    const leaks = await engine.query(`
      select g.table_schema, g.table_name, g.grantee
      from information_schema.role_table_grants g
      join pg_class c on c.relname = g.table_name
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = g.table_schema
      where g.table_schema = any ($1::text[])
        and g.grantee in ('pv_app', 'pv_worker', 'pv_public', 'pv_reader')
        and c.relrowsecurity = false
    `, [DOMAIN_SCHEMAS]);
    assert.deepEqual(leaks, [], `گرنت روی جدول بدون RLS: ${JSON.stringify(leaks.slice(0, 5))}`);
  });

  test('جدول‌های راز، هیچ گرنت انتخابی برای نقش‌های برنامه ندارند', async () => {
    const SECRETS = [
      ['auth', 'credential'],
      ['auth', 'recovery_code'],
      ['auth', 'one_time_token'],
      // `auth.login_attempt` عمداً در این فهرست نیست: شناسه‌ها در آن هش‌شده‌اند
      // و نقش گزارش‌گیر برای تحلیل حمله به آن نیاز دارد؛ اما بی‌نام، هیچ
      // دسترسی خواندنی به آن ندارد (تست پایین‌تر).
    ];
    for (const [schema, table] of SECRETS) {
      for (const role of ['pv_app', 'pv_public', 'pv_worker', 'pv_reader']) {
        const [row] = await engine.query(
          `select has_table_privilege($1, $2, 'select') as allowed`,
          [role, `${schema}.${table}`],
        );
        assert.equal(row.allowed, false, `${role} نباید روی ${schema}.${table} دسترسی خواندن داشته باشد`);
      }
    }
  });

  test('جدول‌های خصوصی، برای بی‌نام هیچ دسترسی خواندنی ندارند', async () => {
    // بی‌نام نباید حتی بتواند *بشمارد*؛ وگرنه شمارش، خودش نشت اطلاعات است.
    const PRIVATE = [
      'app.membership',
      'app.invitation',
      'app.ownership_transfer',
      'app.content_review',
      'ops.backup',
      'ops.restore_test',
      'ops.webhook_endpoint',
      'ops.rate_limit_counter',
      'ops.retention_run',
      'auth.session',
      'auth.device',
      'auth.login_attempt',
      'design.release',
      'design.page_revision',
      'seo.audit',
      'seo.entity_mention',
    ];
    const leaks = [];
    for (const name of PRIVATE) {
      const [schema, table] = name.split('.');
      for (const privilege of ['select', 'update', 'delete']) {
        const [row] = await engine.query(`select has_table_privilege('pv_public', $1, $2) as allowed`, [
          `${schema}.${table}`,
          privilege,
        ]);
        if (row.allowed) leaks.push(`${name}:${privilege}`);
      }
    }
    assert.deepEqual(leaks, [], `دسترسی بی‌نام روی جدول خصوصی: ${leaks.join(', ')}`);

    // استثناها *صریح* و محدودند: بی‌نام باید بتواند تلاش ورود و رخداد امنیتی را
    // ثبت کند و نشست/دستگاه بسازد — چون این کارها پیش از احراز هویت رخ می‌دهند.
    // اما هیچ‌کدام از این‌ها نباید خواندنی باشند.
    const INSERT_ONLY = [
      'auth.session',
      'auth.device',
      'auth.login_attempt',
      'ops.security_event',
      // سنجهٔ عملکرد: بیگانه می‌تواند بگوید «این صفحه چقدر کند بود»، ولی نمی‌تواند
      // بخواند — نه حتی بشمارد (§101).
      'ops.vitals_sample',
    ];
    for (const name of INSERT_ONLY) {
      const [schema, table] = name.split('.');
      const [row] = await engine.query(`select has_table_privilege('pv_public', $1, 'insert') as allowed`, [
        `${schema}.${table}`,
      ]);
      assert.equal(row.allowed, true, `${name}: بی‌نام برای جریان ورود به insert نیاز دارد`);
      const [reading] = await engine.query(`select has_table_privilege('pv_public', $1, 'select') as allowed`, [
        `${schema}.${table}`,
      ]);
      assert.equal(reading.allowed, false, `${name}: بی‌نام نباید بخواند`);
    }
  });
});

describe('سیاست‌ها با مجوز موجود حرف می‌زنند (§16–17، §142)', () => {
  test('هیچ سیاستی به مجوز خیالی تکیه نمی‌کند', async () => {
    const policies = await engine.query(`
      select schemaname, tablename, policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '') as body
      from pg_policies where schemaname = any ($1::text[])
    `, [DOMAIN_SCHEMAS]);
    const defined = new Set((await engine.query('select key from auth.permission')).map((row) => String(row.key)));

    const referenced = new Map();
    for (const policy of policies) {
      for (const match of String(policy.body).matchAll(/has_(?:platform_)?permission\([^,]+,\s*'([a-z0-9_.]+)'::text\)/g)) {
        referenced.set(match[1], `${policy.schemaname}.${policy.tablename}:${policy.policyname}`);
      }
    }

    assert.ok(referenced.size >= 15, `مجوزهای ارجاع‌شده در سیاست‌ها: ${referenced.size}`);
    const phantom = [...referenced.keys()].filter((key) => !defined.has(key));
    assert.deepEqual(phantom, [], `مجوز خیالی: ${phantom.map((key) => `${key} (در ${referenced.get(key)})`).join(', ')}`);
  });

  test('هر مجوز دامنه‌ای به دستِ‌کم یک نقش کسب‌وکار داده شده است', async () => {
    // مجوز تعریف‌شده‌ای که به هیچ نقشی داده نشده، یک «قفسهٔ خالی» است: کسی
    // نمی‌تواند آن کار را بکند و کسی هم متوجه نمی‌شود.
    const orphans = await engine.query(`
      select p.key
      from auth.permission p
      where p.category <> 'platform'
        and not exists (select 1 from app.role_permission rp where rp.permission_key = p.key)
      order by p.key
    `);
    assert.deepEqual(orphans.map((row) => String(row.key)), []);
  });

  test('هر مجوز پلتفرمی به دستِ‌کم یک نقش پلتفرم داده شده است', async () => {
    const orphans = await engine.query(`
      select p.key
      from auth.permission p
      where p.category = 'platform'
        and not exists (select 1 from auth.platform_role_permission prp where prp.permission_key = p.key)
      order by p.key
    `);
    assert.deepEqual(orphans.map((row) => String(row.key)), []);
  });

  test('نقش مالک، همهٔ مجوزهای دامنه‌ای را دارد؛ نقش ناظر، هیچ مجوز نوشتنی', async () => {
    const ownerKeys = new Set(
      (
        await engine.query(`
          select rp.permission_key
          from app.role r join app.role_permission rp on rp.role_id = r.id
          where r.business_id is null and r.key = 'owner'
        `)
      ).map((row) => String(row.permission_key)),
    );
    const domain = (await engine.query(`select key from auth.permission where category <> 'platform'`)).map((row) =>
      String(row.key),
    );
    const missing = domain.filter((key) => !ownerKeys.has(key));
    assert.deepEqual(missing, [], `مجوز دامنه‌ای بدون نقش مالک: ${missing.join(', ')}`);

    const viewer = await engine.query(`
      select count(*)::int as c
      from app.role r
      join app.role_permission rp on rp.role_id = r.id
      join auth.permission p on p.key = rp.permission_key
      where r.business_id is null and r.key = 'viewer'
        and p.key !~ '\\.(view|read)$'
        and p.category <> 'platform'
    `);
    assert.equal(Number(viewer[0].c), 0, 'نقش ناظر نباید هیچ مجوز نوشتنی داشته باشد');
  });
});

describe('جدول‌های مستأجردار: ایندکس و سیاستِ مستأرمحور (§48–۶۳)', () => {
  test('هر جدولی که business_id دارد، ایندکس آغازشده با business_id دارد', async () => {
    // بدون این ایندکس، هر کوئری مستأجردار به پیمایش کامل می‌رسد — و بدتر،
    // RLS روی هر ردیف اجرا می‌شود. این تست، «عملکرد از ابتدا» را به یک قید
    // ساختاری تبدیل می‌کند، نه یک توصیه (Addendum §79–۸۰).
    const rows = await engine.query(`
      with tenant as (
        select c.oid, n.nspname as schema_name, c.relname as table_name
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid and a.attname = 'business_id' and not a.attisdropped
        where c.relkind = 'r' and n.nspname = any ($1::text[])
      )
      select t.schema_name, t.table_name
      from tenant t
      where not exists (
        select 1
        from pg_index i
        where i.indrelid = t.oid
          and (pg_get_indexdef(i.indexrelid) like 'CREATE%ON%public.%business_id%'
               or pg_get_indexdef(i.indexrelid) like '%(business_id%'
               or pg_get_indexdef(i.indexrelid) like '%coalesce(business_id%')
      )
      order by 1, 2
    `, [DOMAIN_SCHEMAS]);
    const missing = rows.map((row) => `${row.schema_name}.${row.table_name}`);
    assert.deepEqual(missing, [], `جدول مستأجردار بدون ایندکس مستأجر: ${missing.join(', ')}`);
  });

  test('هر سیاست pv_app روی جدول مستأجردار، به مستأجر یا کاربر گره خورده است', async () => {
    // این تست، «with check (true)» را می‌گیرد: سیاستی که روی جدول مستأجردار
    // هیچ قید مستأجری ندارد، یعنی هر کاربر تأییدشده می‌تواند ردیف هر
    // کسب‌وکاری را بسازد یا بخواند.
    const rows = await engine.query(`
      select p.schemaname, p.tablename, p.policyname, p.cmd,
             coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') as body
      from pg_policies p
      where p.schemaname = any ($1::text[])
        and 'pv_app' = any (p.roles)
        and exists (
          select 1 from pg_attribute a
          join pg_class c on c.oid = a.attrelid
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = p.schemaname and c.relname = p.tablename
            and a.attname = 'business_id' and not a.attisdropped
        )
      order by 1, 2, 3
    `, [DOMAIN_SCHEMAS]);

    /*
     * استثناهای مستند — هر کدام دلیل خودش را دارد و »کوتاه« نگه داشته می‌شود:
     *
     *   • درج در حسابرسی/رخداد/رخداد امنیتی: نویسنده، کاربر جاری است و سطر
     *     خواندنی نیست؛ قید مستأجر روی این‌ها معنا ندارد چون خودِ RLS خواندن را
     *     به کارکنان محدود می‌کند.
     *   • تغییر مسیر: نگاشت نشانی عمومی است و بی‌نام هم می‌خواندش (§SEO).
     */
    const DOCUMENTED = [
      'ops.audit_log:audit_log_insert',
      'ops.event:event_insert',
      'ops.security_event:security_event_insert',
      'seo.redirect:redirect_read_public',
    ];
    const ANCHORS = [
      'business_id',
      'is_member_of',
      'has_permission',
      'current_business_id',
      'owner_user_id',
      'current_platform_role',
      'has_platform_permission',
      'user_id',
      'user_in_transfer',
    ];
    const unanchored = rows
      .filter((row) => !ANCHORS.some((anchor) => String(row.body).includes(anchor)))
      .map((row) => `${row.schemaname}.${row.tablename}:${row.policyname}`)
      .filter((name) => !DOCUMENTED.includes(name));
    assert.deepEqual(unanchored, [], `سیاست بی‌قید مستأجر: ${unanchored.join(', ')}`);
  });

  test('هر جدول دارای ستون version، ماشهٔ به‌روزرسانی دارد (§58)', async () => {
    const rows = await engine.query(`
      select n.nspname as schema_name, c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'version' and not a.attisdropped
      where c.relkind = 'r' and n.nspname = any ($1::text[])
        and not exists (
          select 1 from pg_trigger t
          where t.tgrelid = c.oid and not t.tgisinternal and t.tgname like '%_touch'
        )
      order by 1, 2
    `, [DOMAIN_SCHEMAS]);
    // دفتر مهاجرت، زیرساخت است: نسخه‌اش را اجراکننده مدیریت می‌کند.
    const missing = rows
      .map((row) => `${row.schema_name}.${row.table_name}`)
      .filter((name) => name !== 'ops.migration');
    assert.deepEqual(missing, [], `جدول دارای نسخه، بدون ماشهٔ touch: ${missing.join(', ')}`);
  });
});

describe('سابقه‌ها، غیرقابل‌ویرایش‌اند (§94، §191)', () => {
  test('جدول‌های افزودنی، ماشهٔ forbid_mutation دارند', async () => {
    const APPEND_ONLY = [
      'ops.audit_log',
      'ops.job_attempt',
      'app.content_review',
      'design.page_revision',
    ];
    for (const name of APPEND_ONLY) {
      const [schema, table] = name.split('.');
      const triggers = await engine.query(
        `select t.tgname, p.proname
         from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
         join pg_namespace n on n.oid = c.relnamespace
         join pg_proc p on p.oid = t.tgfoid
         where n.nspname = $1 and c.relname = $2 and not t.tgisinternal`,
        [schema, table],
      );
      const guarded = triggers.some((row) => String(row.proname) === 'forbid_mutation');
      assert.equal(guarded, true, `${name} باید محافظ افزودنی داشته باشد`);
    }
  });

  test('حسابرسی: هیچ نقشی حق ویرایش یا حذف ندارد', async () => {
    for (const role of APP_ROLES) {
      for (const privilege of ['update', 'delete']) {
        const [row] = await engine.query(`select has_table_privilege($1, 'ops.audit_log', $2) as allowed`, [
          role,
          privilege,
        ]);
        assert.equal(row.allowed, false, `${role} نباید روی حسابرسی ${privilege} داشته باشد`);
      }
    }
  });

  test('رخداد: حذف برای هیچ نقش برنامه‌ای ممکن نیست', async () => {
    for (const role of APP_ROLES) {
      const [row] = await engine.query(`select has_table_privilege($1, 'ops.event', 'delete') as allowed`, [role]);
      assert.equal(row.allowed, false, `${role} نباید رخداد را حذف کند`);
    }
  });
});
