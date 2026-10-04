/**
 * تست اسکیمای دامنه: هویت، کسب‌وکار، محتوا، طراحی، سئو، و دادهٔ مرجع.
 *
 * رویکرد این فایل: هر تست، یک «رفتار تضمین‌شده» را می‌سنجد که اگر بشکند،
 * یعنی نقض امنیت، نقض یکپارچگی داده، یا نقض یک قاعدهٔ سند. تست‌هایی مثل
 * «کسب‌وکار الف، رسانهٔ ب را نمی‌بیند» بیشتر از هر تست واحد دیگری ارزش دارند،
 * چون همان چیزی هستند که در تولید به نشت داده تبدیل می‌شوند.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDatabase } from '../scripts/lib/engine.mjs';
import { migrate } from '../scripts/lib/migrate.mjs';
import { applySeeds } from '../scripts/lib/seed.mjs';
import { uuidv7 } from '../packages/shared/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..');
let engine;
let aliceId;
let bobId;
let businessA;
let businessB;
let roleOwnerId;

/** اجرای یک قطعه SQL در نقش `pv_app` با زمینهٔ دلخواه. */
async function asApp(context, fn) {
  await engine.setContext(context);
  try {
    return await engine.asRole('pv_app', fn);
  } finally {
    await engine.query("select set_config('app.user_id','',false), set_config('app.business_id','',false), set_config('app.platform_role','',false)");
  }
}

/** ساخت کاربر + هویت + کسب‌وکار + عضویت مالک، همه در نقش `pv_app`. */
async function createBusinessFor(userId, slug, name, typeKey = 'veterinary_clinic') {
  return asApp({ userId }, async (handle) => {
    const business = await handle.query(
      `insert into app.business (slug, name, business_type_key, owner_user_id, status, visibility)
       values ($1, $2, $3, $4, 'draft', 'private') returning id`,
      [slug, name, typeKey, userId],
    );
    const id = String(business[0].id);
    await handle.query(
      `insert into app.membership (business_id, user_id, role_id, status, joined_at)
       values ($1, $2, $3, 'active', now())`,
      [id, userId, roleOwnerId],
    );
    return id;
  });
}

before(async () => {
  engine = await openDatabase();
  await migrate(engine, { dir: join(projectRoot, 'migrations') });

  // دادهٔ مرجع از همان فایل‌های واقعی seed؛ نه یک نسخهٔ ساختگی برای تست (§102).
  await applySeeds(engine, { dir: join(projectRoot, 'seeds') });

  const ownerRole = await engine.query("select id from app.role where business_id is null and key = 'owner'");
  roleOwnerId = String(ownerRole[0].id);

  const users = await engine.query(
    `insert into auth.app_user (display_name, status) values ('آلیس رضایی', 'active'), ('بابک مرادی', 'active')
     returning id`,
  );
  aliceId = String(users[0].id);
  bobId = String(users[1].id);

  await engine.query(
    `insert into auth.identity (user_id, kind, value_key, value_display, is_primary, verified_at)
     values ($1, 'email', 'alice@example.com', 'alice@example.com', true, now()),
            ($2, 'email', 'bob@example.com', 'bob@example.com', true, now())`,
    [aliceId, bobId],
  );

  businessA = await createBusinessFor(aliceId, 'tak-pet', 'پت‌شاپ تک‌پت');
  businessB = await createBusinessFor(bobId, 'vet-sharif', 'کلینیک دامپزشکی شریف');
});

after(async () => {
  await engine.close();
});

describe('دادهٔ مرجع — seed ایدمپوتنت (§180)', () => {
  test('اجرای دوبارهٔ seed، خطا نمی‌دهد و داده را دوبرابر نمی‌کند', async () => {
    const count = async () => {
      const rows = await engine.query(`
        select
          (select count(*)::int from ref.business_type) as types,
          (select count(*)::int from auth.permission) as permissions,
          (select count(*)::int from design.component) as components,
          (select count(*)::int from ops.feature) as features,
          (select count(*)::int from design.token) as tokens
      `);
      return rows[0];
    };

    const before = await count();
    // اجرای دوبارهٔ عمدی: کل SQL دوباره فرستاده می‌شود، نه اینکه دفتر seed ردش کند.
    await applySeeds(engine, { dir: join(projectRoot, 'seeds'), force: true });
    const after = await count();

    assert.deepEqual(after, before, 'اجرای دوبارهٔ seed نباید هیچ ردیفی را دوبرابر کند');
  });

  test('مجوزها، نقش‌ها، انواع، صنعت، مکان، کامپوننت، قالب و فیچر ثبت شده‌اند', async () => {
    const counts = await engine.query(`
      select
        (select count(*)::int from auth.permission) as permissions,
        (select count(*)::int from app.role where business_id is null) as roles,
        (select count(*)::int from auth.platform_role) as platform_roles,
        (select count(*)::int from ref.business_type) as business_types,
        (select count(*)::int from ref.industry) as industries,
        (select count(*)::int from ref.location) as locations,
        (select count(*)::int from ref.category) as categories,
        (select count(*)::int from design.component) as components,
        (select count(*)::int from design.page_template) as templates,
        (select count(*)::int from seo.template) as seo_templates,
        (select count(*)::int from ops.feature) as features
    `);
    const row = counts[0];
    // آستانه‌ها عمداً «کف»‌اند، نه عدد دقیق: این تست باید بگوید «seed اجرا شده
    // و دستِ‌کم این حجم دادهٔ مرجع هست»، نه اینکه با افزودن یک صنعت بشکند.
    assert.ok(Number(row.permissions) >= 50, `مجوز: ${row.permissions}`);
    assert.equal(Number(row.roles), 6, 'شش نقش کسب‌وکار');
    assert.equal(Number(row.platform_roles), 5, 'پنج نقش پلتفرم');
    assert.ok(Number(row.business_types) >= 25, `انواع کسب‌وکار: ${row.business_types}`);
    assert.ok(Number(row.industries) >= 45, `صنعت: ${row.industries}`);
    assert.ok(Number(row.locations) >= 90, `مکان: ${row.locations}`);
    assert.ok(Number(row.categories) >= 20, `دسته: ${row.categories}`);
    assert.ok(Number(row.components) >= 40, `کامپوننت: ${row.components}`);
    assert.ok(Number(row.templates) >= 5, `قالب صفحه: ${row.templates}`);
    assert.ok(Number(row.seo_templates) >= 10, `قالب سئو: ${row.seo_templates}`);
    assert.ok(Number(row.features) >= 12, `فیچر: ${row.features}`);
  });

  test('هر مجوزی که در سیاست‌های RLS به کار رفته، در فهرست مجوزها هست', async () => {
    // این تست، «مجوز خیالی» را می‌گیرد: مجوزی که سیاست به آن تکیه می‌کند ولی
    // هیچ‌کس ندارد. بدون این تست، سیاستی مثل `has_permission(b, 'x.manage')`
    // بی‌سروصدا همه را رد می‌کند و هیچ تست واحدی هم شکست نمی‌خورد.
    const policies = await engine.query(`
      select schemaname, tablename, policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '') as body
      from pg_policies
      where schemaname in ('ref', 'auth', 'app', 'media', 'design', 'seo', 'ops')
    `);
    const defined = new Set((await engine.query('select key from auth.permission')).map((row) => String(row.key)));
    const referenced = new Set();
    for (const policy of policies) {
      // هم `has_permission` (دامنه) و هم `has_platform_permission` (پنل مدیریت)
      // باید به مجوزی موجود تکیه کنند؛ دومی هم می‌تواند خیالی باشد.
      for (const match of String(policy.body).matchAll(/has_(?:platform_)?permission\([^,]+,\s*'([a-z0-9_.]+)'::text\)/g)) {
        referenced.add(match[1]);
      }
    }
    assert.ok(referenced.size >= 10, `شمار مجوزهای ارجاع‌شده: ${referenced.size}`);
    const phantom = [...referenced].filter((key) => !defined.has(key));
    assert.deepEqual(phantom, [], `مجوزهای خیالی در سیاست‌ها: ${phantom.join(', ')}`);
  });

  test('نقش مالک، همهٔ مجوزهای دامنه‌ای را دارد و هیچ مجوز پلتفرمی ندارد', async () => {
    const rows = await engine.query(`
      select p.key, p.category
      from app.role r
      join app.role_permission rp on rp.role_id = r.id
      join auth.permission p on p.key = rp.permission_key
      where r.business_id is null and r.key = 'owner'
    `);
    const keys = rows.map((row) => String(row.key));
    assert.ok(keys.includes('business.update'));
    assert.ok(keys.includes('content.publish'));
    assert.ok(keys.includes('design.publish'));
    assert.ok(keys.includes('seo.manage'));
    assert.equal(keys.some((key) => key.startsWith('platform.')), false, 'نقش کسب‌وکار نباید مجوز پلتفرمی داشته باشد');

    const allDomain = await engine.query(`select count(*)::int as c from auth.permission where category <> 'platform'`);
    assert.equal(keys.length, Number(allDomain[0].c), 'مالک باید همهٔ مجوزهای دامنه‌ای را داشته باشد');
  });

  test('نظارت پلتفرم، جدا از مالکیت کسب‌وکار است', async () => {
    const rows = await engine.query(`
      select count(*)::int as c from auth.platform_role_permission
      where role_key = 'moderator' and permission_key like 'platform.%'
    `);
    assert.ok(Number(rows[0].c) >= 3);
    const superadmin = await engine.query(`select count(*)::int as c from auth.platform_role_permission where role_key = 'superadmin'`);
    const all = await engine.query(`select count(*)::int as c from auth.permission`);
    assert.equal(Number(superadmin[0].c), Number(all[0].c), 'مدیر ارشد باید همهٔ مجوزها را داشته باشد');
  });
});

describe('هویت (§6–§17)', () => {
  test('هویت یکتا است: دو کاربر نمی‌توانند یک ایمیل داشته باشند', async () => {
    await assert.rejects(
      () =>
        engine.query(
          `insert into auth.identity (user_id, kind, value_key, value_display) values ($1, 'email', 'alice@example.com', 'a@x.com')`,
          [bobId],
        ),
      (error) => error.code === '23505',
    );
  });

  test('حذف نرم هویت، آن را آزاد می‌کند', async () => {
    const spare = await engine.query(
      `insert into auth.app_user (display_name, status) values ('کاربر موقت', 'active') returning id`,
    );
    const userId = String(spare[0].id);
    const identity = await engine.query(
      `insert into auth.identity (user_id, kind, value_key, value_display) values ($1, 'email', 'temp@example.com', 'temp@example.com') returning id`,
      [userId],
    );
    await engine.query(`update auth.identity set deleted_at = now() where id = $1`, [identity[0].id]);
    await assert.doesNotReject(() =>
      engine.query(
        `insert into auth.identity (user_id, kind, value_key, value_display) values ($1, 'email', 'temp@example.com', 'temp@example.com')`,
        [bobId],
      ),
    );
  });

  test('جدول اعتبارنامه برای نقش برنامه قابل خواندن نیست', async () => {
    await engine.query(
      `insert into auth.credential (user_id, kind, secret_hash) values ($1, 'password', 'pv1$n$argon2id$v=19$m=65536,t=3,p=1$c2FsdA$aGFzaA')`,
      [aliceId],
    );
    let visible = -1;
    try {
      const rows = await engine.asRole('pv_app', () => engine.query('select count(*)::int as c from auth.credential'));
      visible = Number(rows[0].c);
    } catch (error) {
      assert.match(String(error.message), /permission denied/i);
    }
    assert.equal(visible <= 0, true, 'رمز درهم‌شده نباید از مسیر معمولی در دسترس باشد');

    // ولی تابع تخصصی ورود، همان چیزی را می‌دهد که ورود لازم دارد — و نه بیشتر.
    const candidate = await engine.query("select * from auth.find_login_candidate('alice@example.com')");
    assert.equal(candidate.length, 1);
    assert.ok(String(candidate[0].password_hash).startsWith('pv1$'));
    assert.equal(candidate[0].email, undefined);
  });

  test('قفل تدریجی حساب پس از تلاش‌های ناموفق اعمال می‌شود (§13)', async () => {
    // ثبت تلاش ورود، هش شناسه می‌گیرد نه شناسهٔ خام: قید جدول همین را الزام
    // می‌کند تا ایمیل/موبایل کاربران در جدول تلاش‌ها به‌صورت روشن نماند.
    const identifierHash = `sha256:${'9'.repeat(64)}`;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await engine.query(
        `select * from auth.record_login_attempt($1, $2, 'password', false, 'bad_password')`,
        [identifierHash, bobId],
      );
    }
    const state = await engine.query('select failed_login_count, locked_until from auth.app_user where id = $1', [bobId]);
    assert.equal(Number(state[0].failed_login_count), 5);
    assert.notEqual(state[0].locked_until, null, 'پس از ۵ خطا باید قفل شود');

    // ورود موفق، شمارنده را صفر می‌کند.
    await engine.query(`select * from auth.record_login_attempt($1, $2, 'password', true)`, [identifierHash, bobId]);
    const after = await engine.query('select failed_login_count, locked_until, last_login_at from auth.app_user where id = $1', [bobId]);
    assert.equal(Number(after[0].failed_login_count), 0);
    assert.equal(after[0].locked_until, null);
    assert.notEqual(after[0].last_login_at, null);
  });

  test('توکن یکبارمصرف، واقعاً یک‌بارمصرف است', async () => {
    const tokenHash = `sha256:${'a'.repeat(64)}`;
    await engine.query(
      `insert into auth.one_time_token (purpose, token_hash, user_id, expires_at)
       values ('password_reset', $1, $2, now() + interval '30 minutes')`,
      [tokenHash, aliceId],
    );

    // دو مصرف هم‌زمان: باید فقط یکی موفق شود.
    const [first, second] = await Promise.all([
      engine.query(`select * from auth.consume_one_time_token($1, 'password_reset')`, [tokenHash]),
      engine.query(`select * from auth.consume_one_time_token($1, 'password_reset')`, [tokenHash]),
    ]);
    const succeeded = [first, second].filter((result) => result.length > 0);
    assert.equal(succeeded.length, 1, 'دقیقاً یک مصرف باید موفق شود');
    assert.equal(String(succeeded[0][0].user_id), aliceId);
  });

  test('توکن منقضی مصرف نمی‌شود و هدف اشتباه کار نمی‌کند', async () => {
    const tokenHash = `sha256:${'b'.repeat(64)}`;
    await engine.query(
      `insert into auth.one_time_token (purpose, token_hash, user_id, expires_at)
       values ('email_verify', $1, $2, now() - interval '1 minute')`,
      [tokenHash, aliceId],
    );
    const expired = await engine.query(`select * from auth.consume_one_time_token($1, 'email_verify')`, [tokenHash]);
    assert.equal(expired.length, 0);

    const freshHash = `sha256:${'c'.repeat(64)}`;
    await engine.query(
      `insert into auth.one_time_token (purpose, token_hash, user_id, expires_at)
       values ('email_verify', $1, $2, now() + interval '1 hour')`,
      [freshHash, aliceId],
    );
    const wrongPurpose = await engine.query(`select * from auth.consume_one_time_token($1, 'password_reset')`, [freshHash]);
    assert.equal(wrongPurpose.length, 0, 'توکن یک جریان نباید در جریان دیگر کار کند');
    const right = await engine.query(`select * from auth.consume_one_time_token($1, 'email_verify')`, [freshHash]);
    assert.equal(right.length, 1);
  });

  test('نشست: کاربر فقط نشست‌های خودش را می‌بیند', async () => {
    await engine.query(
      `insert into auth.session (user_id, secret_hash, expires_at, absolute_expires_at)
       values ($1, $2, now() + interval '1 day', now() + interval '30 days'),
              ($3, $4, now() + interval '1 day', now() + interval '30 days')`,
      [aliceId, `sha256:${'d'.repeat(64)}`, bobId, `sha256:${'e'.repeat(64)}`],
    );
    await engine.setContext({ userId: aliceId });
    const visible = await engine.asRole('pv_app', () => engine.query('select user_id from auth.session'));
    await engine.query("select set_config('app.user_id','',false)");
    assert.equal(visible.length, 1);
    assert.equal(String(visible[0].user_id), aliceId);

    // آلیس، با زمینهٔ خودش، نمی‌تواند نشست بابک را بسازد.
    await assert.rejects(
      () =>
        engine.setContext({ userId: aliceId }).then(() =>
          engine.asRole('pv_app', () =>
            engine.query(
              `insert into auth.session (user_id, secret_hash, expires_at, absolute_expires_at)
               values ($1, $2, now() + interval '1 day', now() + interval '30 days')`,
              [bobId, `sha256:${'f'.repeat(64)}`],
            ),
          ),
        ),
      (error) => error.code === '42501' || /row-level security/i.test(String(error.message)),
    );

    // و جعل هویت (§31) فقط با نقش پلتفرمی و با ثبت نام جاعل ممکن است.
    await engine.setContext({ userId: aliceId });
    await assert.rejects(
      () =>
        engine.asRole('pv_app', () =>
          engine.query(
            `insert into auth.session (user_id, secret_hash, expires_at, absolute_expires_at, impersonated_by, impersonation_reason)
             values ($1, $2, now() + interval '1 day', now() + interval '30 days', $3, 'پشتیبانی')`,
            [bobId, `sha256:${'1'.repeat(64)}`, aliceId],
          ),
        ),
      (error) => error.code === '42501' || /row-level security/i.test(String(error.message)),
    );

    await engine.setContext({ userId: aliceId, platformRole: 'support' });
    const impersonated = await engine.asRole('pv_app', () =>
      engine.query(
        `insert into auth.session (user_id, secret_hash, expires_at, absolute_expires_at, impersonated_by, impersonation_reason)
         values ($1, $2, now() + interval '1 day', now() + interval '30 days', $3, 'پشتیبانی') returning impersonated_by`,
        [bobId, `sha256:${'2'.repeat(64)}`, aliceId],
      ),
    );
    assert.equal(String(impersonated[0].impersonated_by), aliceId, 'جاعل باید ثبت شود');

    // زمینه باید پاک شود، وگرنه نقش پلتفرمی روی همهٔ تست‌های بعدی اثر می‌گذارد.
    await engine.query(
      "select set_config('app.user_id','',false), set_config('app.business_id','',false), set_config('app.platform_role','',false)",
    );
    await engine.query("select set_config('app.user_id','',false)");
  });
});

describe('کسب‌وکار و ایزوله‌سازی مستأجر (§6، §14–17)', () => {
  test('مؤسس، مالک می‌شود و کسب‌وکار در فهرست او دیده می‌شود', async () => {
    const visible = await asApp({ userId: aliceId }, (handle) => handle.query('select id, slug from app.business'));
    assert.equal(visible.length, 1);
    assert.equal(String(visible[0].slug), 'tak-pet');
  });

  test('کسب‌وکار الف، کسب‌وکار ب را نمی‌بیند', async () => {
    const other = await asApp({ userId: aliceId }, (handle) =>
      handle.query('select count(*)::int as c from app.business where id = $1', [businessB]),
    );
    assert.equal(Number(other[0].c), 0);
  });

  test('کسب‌وکار پیش‌نویس برای بی‌نام دیده نمی‌شود؛ منتشرشده دیده می‌شود', async () => {
    const asPublic = await engine.asRole('pv_public', () =>
      engine.query('select count(*)::int as c from app.business where id = $1', [businessA]),
    );
    assert.equal(Number(asPublic[0].c), 0, 'پیش‌نویس خصوصی نباید عمومی باشد');

    await engine.query(`update app.business set status = 'active', visibility = 'public', published_at = now() where id = $1`, [
      businessA,
    ]);
    const after = await engine.asRole('pv_public', () =>
      engine.query('select name from app.business where id = $1', [businessA]),
    );
    assert.equal(after.length, 1);
  });

  test('پروفایل کسب‌وکار پیش‌نویس، برای بی‌نام دیده نمی‌شود', async () => {
    await engine.query(`insert into app.business_profile (business_id, summary) values ($1, 'خلاصه')`, [businessB]);
    const rows = await engine.asRole('pv_public', () =>
      engine.query('select count(*)::int as c from app.business_profile where business_id = $1', [businessB]),
    );
    assert.equal(Number(rows[0].c), 0);
  });

  test('راه تماس فقط وقتی عمومی است که کسب‌وکار صریحاً بگوید', async () => {
    await engine.query(
      `insert into app.business_contact (business_id, kind, value_key, value_display, is_public)
       values ($1, 'phone', '02100000000', '۰۲۱-۰۰۰۰۰۰۰۰', false),
              ($1, 'website', 'https://tak-pet.example', 'tak-pet.example', true)`,
      [businessA],
    );
    const visible = await engine.asRole('pv_public', () =>
      engine.query('select kind from app.business_contact where business_id = $1', [businessA]),
    );
    assert.deepEqual(visible.map((row) => String(row.kind)), ['website']);

    const asOwner = await asApp({ userId: aliceId, businessId: businessA }, (handle) =>
      handle.query('select count(*)::int as c from app.business_contact where business_id = $1', [businessA]),
    );
    assert.equal(Number(asOwner[0].c), 2, 'مالک باید هر دو را ببیند');
  });

  test('مجوز نقش: مالک می‌تواند، ناظر نمی‌تواند', async () => {
    const owner = await asApp({ userId: aliceId, businessId: businessA }, (handle) =>
      handle.query(`select app.has_permission($1, 'content.publish') as allowed`, [businessA]),
    );
    assert.equal(owner[0].allowed, true);

    const viewerRole = await engine.query("select id from app.role where business_id is null and key = 'viewer'");
    await engine.query(
      `insert into app.membership (business_id, user_id, role_id, status, joined_at) values ($1, $2, $3, 'active', now())`,
      [businessB, aliceId, viewerRole[0].id],
    );
    const viewer = await asApp({ userId: aliceId, businessId: businessB }, (handle) =>
      handle.query(`select app.has_permission($1, 'content.publish') as allowed, app.role_of($1) as role`, [businessB]),
    );
    assert.equal(viewer[0].allowed, false);
    assert.equal(String(viewer[0].role), 'viewer');
  });

  test('مجوز سلب‌شده بر نقش مقدم است، و مجوز افزوده آن را جبران می‌کند', async () => {
    await engine.query(
      `update app.membership set overrides = '{"grant":[],"revoke":["content.update"]}'::jsonb
       where business_id = $1 and user_id = $2`,
      [businessA, aliceId],
    );
    const viewerRole = await engine.query("select id from app.role where business_id is null and key = 'viewer'");
    const revoked = await asApp({ userId: aliceId, businessId: businessA }, (handle) =>
      handle.query(`select app.has_permission($1, 'content.update') as allowed, app.has_permission($1, 'content.create') as other`, [
        businessA,
      ]),
    );
    assert.equal(revoked[0].allowed, false, 'سلب صریح باید بر نقش مقدم باشد');
    assert.equal(revoked[0].other, true, 'سلب یک مجوز نباید بقیه را بردارد');

    await engine.query(
      `update app.membership set role_id = $3, overrides = '{"grant":["content.update"],"revoke":[]}'::jsonb
       where business_id = $1 and user_id = $2`,
      [businessA, aliceId, viewerRole[0].id],
    );
    const granted = await asApp({ userId: aliceId, businessId: businessA }, (handle) =>
      handle.query(`select app.has_permission($1, 'content.update') as allowed, app.has_permission($1, 'content.create') as other`, [
        businessA,
      ]),
    );
    assert.equal(granted[0].allowed, true, 'مجوز افزوده باید کار کند');
    assert.equal(granted[0].other, false);

    // بازگرداندن نقش مالک برای بقیهٔ تست‌ها
    await engine.query(`update app.membership set role_id = $3, overrides = '{"grant":[],"revoke":[]}'::jsonb
       where business_id = $1 and user_id = $2`, [businessA, aliceId, roleOwnerId]);
  });

  test('عضو غیرفعال، هیچ مجوزی ندارد', async () => {
    await engine.query(`update app.membership set status = 'suspended' where business_id = $1 and user_id = $2`, [
      businessB,
      aliceId,
    ]);
    const denied = await asApp({ userId: aliceId, businessId: businessB }, (handle) =>
      handle.query(`select app.has_permission($1, 'profile.view') as allowed, app.is_member_of($1) as member`, [businessB]),
    );
    assert.equal(denied[0].allowed, false);
    assert.equal(denied[0].member, false);
  });

  test('کسی نمی‌تواند عضو کسب‌وکار دیگری شود', async () => {
    await assert.rejects(
      () =>
        asApp({ userId: aliceId }, (handle) =>
          handle.query(
            `insert into app.membership (business_id, user_id, role_id, status, joined_at) values ($1, $2, $3, 'active', now())`,
            [businessB, aliceId, roleOwnerId],
          ),
        ),
      (error) => error.code === '42501' || /row-level security/i.test(String(error.message)),
    );
  });

  test('دعوت‌نامه: یک دعوت باز در هر زمان، و مصرف یکبارمصرف', async () => {
    const invitation = await asApp({ userId: aliceId, businessId: businessA }, (handle) =>
      handle.query(
        `insert into app.invitation (business_id, role_id, invitee_kind, invitee_hash, invitee_display, token_hash, invited_by, expires_at)
         values ($1, $2, 'email', $3, 'karim@example.com', $4, $5, now() + interval '7 days') returning id`,
        [businessA, roleOwnerId, 'k'.repeat(64), `sha256:${'g'.repeat(64)}`, aliceId],
      ),
    );
    assert.equal(invitation.length, 1);

    await assert.rejects(
      () =>
        asApp({ userId: aliceId, businessId: businessA }, (handle) =>
          handle.query(
            `insert into app.invitation (business_id, role_id, invitee_kind, invitee_hash, invitee_display, token_hash, invited_by, expires_at)
             values ($1, $2, 'email', $3, 'karim@example.com', $4, $5, now() + interval '7 days')`,
            [businessA, roleOwnerId, 'k'.repeat(64), `sha256:${'h'.repeat(64)}`, aliceId],
          ),
        ),
      (error) => error.code === '23505',
      'دو دعوت باز برای یک نفر نباید ممکن باشد',
    );
  });

  test('کسی که مجوز دعوت ندارد، نمی‌تواند دعوت بسازد', async () => {
    await engine.query(`update app.membership set role_id = (select id from app.role where key='viewer' and business_id is null)
       where business_id = $1 and user_id = $2`, [businessA, aliceId]);
    await assert.rejects(
      () =>
        asApp({ userId: aliceId, businessId: businessA }, (handle) =>
          handle.query(
            `insert into app.invitation (business_id, role_id, invitee_kind, invitee_hash, invitee_display, token_hash, invited_by, expires_at)
             values ($1, $2, 'email', $3, 'x@example.com', $4, $5, now() + interval '1 day')`,
            [businessA, roleOwnerId, 'm'.repeat(64), `sha256:${'i'.repeat(64)}`, aliceId],
          ),
        ),
      (error) => error.code === '42501' || /row-level security/i.test(String(error.message)),
    );
    await engine.query(`update app.membership set role_id = $3 where business_id = $1 and user_id = $2`, [
      businessA,
      aliceId,
      roleOwnerId,
    ]);
  });

  test('انتقال مالکیت: طرفین می‌بینند، بی‌گانه نه', async () => {
    const transfer = await asApp({ userId: aliceId, businessId: businessA }, (handle) =>
      handle.query(
        `insert into app.ownership_transfer (business_id, from_user_id, to_user_id, reason, requester_step_up_at)
         values ($1, $2, $3, 'تغییر مدیریت', now()) returning id`,
        [businessA, aliceId, bobId],
      ),
    );
    assert.equal(transfer.length, 1);

    const asBob = await asApp({ userId: bobId }, (handle) =>
      handle.query('select count(*)::int as c from app.ownership_transfer'),
    );
    assert.equal(Number(asBob[0].c), 1, 'گیرندهٔ انتقال باید درخواست را ببیند');

    // بی‌نام، حتی اجازهٔ خواندن جدول را ندارد؛ رد پیش‌فرض (§14).
    await assert.rejects(
      () => engine.asRole('pv_public', () => engine.query('select count(*)::int as c from app.ownership_transfer')),
      (error) => error.code === '42501',
      'بی‌نام نباید هیچ دسترسی‌ای به جدول انتقال مالکیت داشته باشد',
    );

    // و کاربری که طرف انتقال نیست، هیچ ردیفی نمی‌بیند.
    const [stranger] = await engine.query(
      `insert into auth.app_user (display_name, status) values ('سهیل ناظری', 'active') returning id`,
    );
    const asStranger = await asApp({ userId: String(stranger.id) }, (handle) =>
      handle.query('select count(*)::int as c from app.ownership_transfer'),
    );
    assert.equal(Number(asStranger[0].c), 0, 'بی‌گانه نباید درخواست انتقال را ببیند');
  });

  test('گراف روابط: هر طرف رابطه، آن را می‌بیند', async () => {
    await engine.query(
      `insert into app.business_relationship (from_business_id, to_business_id, kind, status, is_symmetric)
       values ($1, $2, 'partner', 'active', true)`,
      [businessA, businessB],
    );
    const asOwnerOfB = await asApp({ userId: bobId }, (handle) => handle.query('select count(*)::int as c from app.business_relationship'));
    assert.equal(Number(asOwnerOfB[0].c), 1);
    const asStranger = await asApp({ userId: aliceId, businessId: businessB }, (handle) =>
      handle.query('select count(*)::int as c from app.business_relationship where from_business_id = $1', [businessB]),
    );
    assert.equal(Number(asStranger[0].c), 0, 'عضو ناظر در ب، رابطه‌های ب را نمی‌بیند مگر طرف رابطه باشد');
  });
});

describe('محتوا و رسانه (§23–24، §74–75)', () => {
  test('محتوا در کسب‌وکار الف نوشته می‌شود و برای ب دیده نمی‌شود', async () => {
    const contentId = await asApp({ userId: aliceId, businessId: businessA }, async (handle) => {
      const created = await handle.query(
        `insert into app.content (business_id, kind, slug, title, summary, status)
         values ($1, 'article', 'care-dog', 'مراقبت از سگ', 'راهنمای پایه', 'draft') returning id`,
        [businessA],
      );
      return String(created[0].id);
    });
    assert.ok(contentId);

    const asOther = await asApp({ userId: bobId, businessId: businessB }, (handle) =>
      handle.query('select count(*)::int as c from app.content where id = $1', [contentId]),
    );
    assert.equal(Number(asOther[0].c), 0);
  });

  test('پیش‌نویس محتوا برای بی‌نام دیده نمی‌شود؛ منتشرشده دیده می‌شود', async () => {
    const draft = await engine.query(
      `insert into app.content (business_id, kind, slug, title, status) values ($1, 'guide', 'draft-guide', 'پیش‌نویس', 'draft') returning id`,
      [businessA],
    );
    const asPublic = await engine.asRole('pv_public', () =>
      engine.query('select count(*)::int as c from app.content where id = $1', [draft[0].id]),
    );
    assert.equal(Number(asPublic[0].c), 0);

    await engine.query(
      `update app.content set status = 'published', published_at = now() where id = $1`,
      [draft[0].id],
    );
    const after = await engine.asRole('pv_public', () => engine.query('select title from app.content where id = $1', [draft[0].id]));
    assert.equal(after.length, 1);
  });

  test('قید چرخهٔ عمر: انتشار بدون تاریخ انتشار ممکن نیست', async () => {
    await assert.rejects(
      () =>
        engine.query(
          `insert into app.content (business_id, kind, slug, title, status) values ($1, 'article', 'bad', 'بد', 'published')`,
          [businessA],
        ),
      (error) => error.code === '23514',
    );
    await assert.rejects(
      () =>
        engine.query(
          `insert into app.content (business_id, kind, slug, title, status) values ($1, 'article', 'bad2', 'بد', 'scheduled')`,
          [businessA],
        ),
      (error) => error.code === '23514',
    );
  });

  test('بازبینی محتوا، سابقه است: ویرایش و حذف ممنوع', async () => {
    const content = await engine.query(
      `insert into app.content (business_id, kind, slug, title, status) values ($1, 'article', 'reviewed', 'بازبینی‌شده', 'draft') returning id`,
      [businessA],
    );
    await engine.query(
      `insert into app.content_review (content_id, reviewer_id, decision, content_version) values ($1, $2, 'submitted', 1)`,
      [content[0].id, aliceId],
    );
    await assert.rejects(
      () => engine.query(`update app.content_review set decision = 'approved'`),
      (error) => error.code === '23001' || /افزودنی/.test(String(error.message)),
    );
    await assert.rejects(
      () => engine.query('delete from app.content_review'),
      (error) => error.code === '23001' || /افزودنی/.test(String(error.message)),
    );
  });

  test('بلوک محتوا نوع بسته دارد', async () => {
    const content = await engine.query(
      `insert into app.content (business_id, kind, slug, title, status) values ($1, 'faq', 'faq-1', 'پرسش‌ها', 'draft') returning id`,
      [businessA],
    );
    await assert.rejects(
      () =>
        engine.query(`insert into app.content_block (content_id, kind) values ($1, 'raw_html')`, [content[0].id]),
      (error) => error.code === '23514',
    );
    await engine.query(
      `insert into app.content_block (content_id, kind, data, plain_text) values ($1, 'faq', '{"items":[]}'::jsonb, 'پرسش و پاسخ')`,
      [content[0].id],
    );
  });

  test('دارایی تا آماده نشدن، قابل استفاده نیست', async () => {
    const asset = await engine.query(
      `insert into media.asset (business_id, uploaded_by, storage_key, detected_mime, kind, size_bytes, status)
       values ($1, $2, 'biz/tak-pet/x.jpg', 'image/jpeg', 'image', 1024, 'processing') returning id`,
      [businessA, aliceId],
    );
    const notReady = await engine.query('select media.asset_is_usable($1) as usable', [asset[0].id]);
    assert.equal(notReady[0].usable, false);

    await engine.query(`update media.asset set status = 'ready', scan_status = 'clean', width = 1600, height = 900 where id = $1`, [
      asset[0].id,
    ]);
    const ready = await engine.query('select media.asset_is_usable($1) as usable, width_height_ratio as ratio from media.asset where id = $1', [
      asset[0].id,
    ]);
    assert.equal(ready[0].usable, true);
    assert.equal(Number(ready[0].ratio).toFixed(4), '1.7778');
  });

  test('دارایی قرنطینه‌شده، قابل استفاده نیست', async () => {
    const asset = await engine.query(
      `insert into media.asset (business_id, uploaded_by, storage_key, detected_mime, kind, size_bytes, status, scan_status)
       values ($1, $2, 'biz/tak-pet/bad.exe', 'application/octet-stream', 'other', 2048, 'quarantined', 'infected') returning id`,
      [businessA, aliceId],
    );
    const rows = await engine.query('select media.asset_is_usable($1) as usable', [asset[0].id]);
    assert.equal(rows[0].usable, false);
  });

  test('مشتق تکراری برای یک دارایی ساخته نمی‌شود', async () => {
    const asset = await engine.query(
      `insert into media.asset (business_id, uploaded_by, storage_key, detected_mime, kind, size_bytes, status)
       values ($1, $2, 'biz/tak-pet/y.jpg', 'image/jpeg', 'image', 4096, 'ready') returning id`,
      [businessA, aliceId],
    );
    await engine.query(
      `insert into media.derivative (asset_id, variant, format, storage_key, size_bytes, status)
       values ($1, 'thumb', 'webp', 'k1', 100, 'ready')`,
      [asset[0].id],
    );
    await assert.rejects(
      () =>
        engine.query(
          `insert into media.derivative (asset_id, variant, format, storage_key, size_bytes) values ($1, 'thumb', 'webp', 'k2', 120)`,
          [asset[0].id],
        ),
      (error) => error.code === '23505',
    );
  });

  test('دارایی کسب‌وکار الف، برای بی‌نام و برای عضو ب دیده نمی‌شود', async () => {
    const asset = await engine.query(
      `insert into media.asset (business_id, uploaded_by, storage_key, detected_mime, kind, size_bytes, status, is_public)
       values ($1, $2, 'biz/tak-pet/private.jpg', 'image/jpeg', 'image', 512, 'ready', false) returning id`,
      [businessA, aliceId],
    );
    const asPublic = await engine.asRole('pv_public', () =>
      engine.query('select count(*)::int as c from media.asset where id = $1', [asset[0].id]),
    );
    assert.equal(Number(asPublic[0].c), 0);
    const asBob = await asApp({ userId: bobId, businessId: businessB }, (handle) =>
      handle.query('select count(*)::int as c from media.asset where id = $1', [asset[0].id]),
    );
    assert.equal(Number(asBob[0].c), 0);
  });

  test('شمارندهٔ رسانه از منبع حقیقت بازساخته می‌شود', async () => {
    const counted = await engine.query('select media.recount_assets($1) as c', [businessA]);
    const stored = await engine.query('select media_count from app.business where id = $1', [businessA]);
    assert.equal(Number(counted[0].c), Number(stored[0].media_count));
    assert.ok(Number(counted[0].c) >= 3);
  });
});

describe('طراحی (§32–44، §161–169)', () => {
  test('درخت با کامپوننت ثبت‌شده معتبر است', async () => {
    const tree = {
      version: 1,
      root: [
        { id: 'n1', component: 'content.hero', props: { title: 'کلینیک پت', layout: 'split' } },
        { id: 'n2', component: 'content.heading', props: { text: 'خدمات', level: 'h2' } },
      ],
    };
    const findings = await engine.query('select design.validate_tree($1::jsonb) as f', [JSON.stringify(tree)]);
    assert.deepEqual(findings[0].f, []);
  });

  test('کامپوننت ناشناخته، یافتهٔ سطح «جلودار» می‌دهد', async () => {
    const tree = { version: 1, root: [{ id: 'x', component: 'custom.raw_html', props: { html: '<script>x</script>' } }] };
    const findings = await engine.query('select design.validate_tree($1::jsonb) as f', [JSON.stringify(tree)]);
    assert.equal(findings[0].f.length, 1);
    assert.equal(findings[0].f[0].rule, 'registry.component_unknown');
    assert.equal(findings[0].f[0].severity, 'blocker');
  });

  test('پراپ الزامی غایب و اسلات ناشناخته گرفته می‌شوند', async () => {
    const tree = {
      version: 1,
      root: [
        { id: 'a', component: 'content.heading', props: {} },
        { id: 'b', component: 'layout.section', props: { title: 'x' }, slots: { nonexistent: [] } },
      ],
    };
    const findings = await engine.query('select design.validate_tree($1::jsonb) as f', [JSON.stringify(tree)]);
    const rules = findings[0].f.map((finding) => finding.rule);
    assert.ok(rules.includes('structure.required_prop_missing'));
    assert.ok(rules.includes('structure.unknown_slot'));
  });

  test('درخت بدون ریشه، رد می‌شود', async () => {
    const findings = await engine.query(`select design.validate_tree('{"version":1}'::jsonb) as f`);
    assert.equal(findings[0].f[0].rule, 'structure.tree_invalid');
  });

  test('اثر انگشت درخت، پایدار است', async () => {
    const tree = { version: 1, root: [{ id: 'a', component: 'content.heading', props: { text: 'x', level: 'h2' } }] };
    const first = await engine.query('select design.tree_hash($1::jsonb) as h', [JSON.stringify(tree)]);
    const second = await engine.query('select design.tree_hash($1::jsonb) as h', [JSON.stringify(tree)]);
    assert.equal(first[0].h, second[0].h);
    const other = await engine.query(`select design.tree_hash('{"version":1,"root":[]}'::jsonb) as h`);
    assert.notEqual(first[0].h, other[0].h);
  });

  test('نسخهٔ صفحه، یکتا و تغییرناپذیر است', async () => {
    const page = await asApp({ userId: aliceId, businessId: businessA }, async (handle) => {
      const created = await handle.query(
        `insert into design.page (business_id, key, title, scope, draft_tree) values ($1, 'home', 'صفحهٔ اصلی', 'business', '{"version":1,"root":[]}'::jsonb) returning id`,
        [businessA],
      );
      return String(created[0].id);
    });
    await engine.query(
      `insert into design.page_revision (page_id, revision, tree, tree_hash, created_by) values ($1, 1, '{"version":1,"root":[]}'::jsonb, 'md5:a', $2)`,
      [page, aliceId],
    );
    await assert.rejects(
      () =>
        engine.query(
          `insert into design.page_revision (page_id, revision, tree, tree_hash) values ($1, 1, '{"version":1,"root":[]}'::jsonb, 'md5:b')`,
          [page],
        ),
      (error) => error.code === '23505',
    );
    await assert.rejects(
      () => engine.query(`update design.page_revision set revision = 2 where page_id = $1`, [page]),
      (error) => error.code === '42501' || error.code === '23001' || /permission denied|افزودنی/i.test(String(error.message)),
    );
  });

  test('انتشار، سابقه است: حذف بستهٔ انتشار ممنوع', async () => {
    // اول یک بسته می‌سازیم؛ وگرنه `delete` روی جدول خالی هیچ ردیفی را
    // لمس نمی‌کند، ماشه اجرا نمی‌شود و تست بی‌دلیل سبز می‌ماند.
    await engine.query(
      `insert into design.release (business_id, version, bundle, bundle_hash, status, scope, published_at, is_current)
       values ($1, 9, '{}'::jsonb, 'md5:guard', 'rolled_back', 'business', now(), false)`,
      [businessA],
    );
    await assert.rejects(
      () => engine.query('delete from design.release where version = 9'),
      (error) => error.code === '23001' || /افزودنی/.test(String(error.message)),
    );
  });

  test('فقط یک انتشار جاری در هر محدوده', async () => {
    await engine.query(
      `insert into design.release (business_id, version, bundle, bundle_hash, status, scope, published_at, is_current)
       values ($1, 1, '{}'::jsonb, 'md5:1', 'published', 'business', now(), true)`,
      [businessA],
    );
    await assert.rejects(
      () =>
        engine.query(
          `insert into design.release (business_id, version, bundle, bundle_hash, status, scope, published_at, is_current)
           values ($1, 2, '{}'::jsonb, 'md5:2', 'published', 'business', now(), true)`,
          [businessA],
        ),
      (error) => error.code === '23505',
    );
  });

  test('صفحهٔ منتشرنشده برای بی‌نام دیده نمی‌شود', async () => {
    const rows = await engine.asRole('pv_public', () => engine.query(`select count(*)::int as c from design.page`));
    assert.equal(Number(rows[0].c), 0);
  });

  test('صفحه با محدودهٔ کسب‌وکار، باید کلید کسب‌وکار داشته باشد', async () => {
    // صفحهٔ کسب‌وکار بدون کسب‌وکار، صفحه‌ای است که هیچ‌کس مالکش نیست.
    await assert.rejects(
      () => engine.query(`insert into design.page (key, title) values ('bad', 'بد')`),
      (error) => error.code === '23514',
      'صفحهٔ کسب‌وکار بدون کلید کسب‌وکار نباید ثبت شود',
    );
    // و صفحهٔ سراسری پلتفرم، دقیقاً برعکس: باید کسب‌وکار نداشته باشد.
    const platformPage = await engine.query(
      `insert into design.page (key, title, scope, is_system) values ('platform-home', 'صفحهٔ سراسری', 'platform', true) returning id`,
    );
    assert.equal(platformPage.length, 1);
  });
});

describe('سئو به‌عنوان داده (Addendum §39–55)', () => {
  test('انتخاب قالب: خاص‌ترین برنده است', async () => {
    const general = await engine.query(`select key, entity_kind from seo.pick_template('content', 'article', null)`);
    assert.equal(String(general[0].key), 'content.article');

    await engine.query(
      `insert into seo.template (business_id, key, entity_kind, subtype, title_template, priority)
       values ($1, 'content.article.business', 'content', 'article', '{title} | {business_name}', 50)`,
      [businessA],
    );
    const specific = await engine.query('select key from seo.pick_template($1, $2, $3)', [
      'content',
      'article',
      businessA,
    ]);
    assert.equal(String(specific[0].key), 'content.article.business', 'قالب اختصاصی کسب‌وکار باید مقدم باشد');

    const other = await engine.query('select key from seo.pick_template($1, $2, $3)', ['content', 'article', businessB]);
    assert.equal(String(other[0].key), 'content.article', 'کسب‌وکار دیگر باید قالب سراسری بگیرد');
  });

  test('متادیتا به تفکیک موجودیت و زبان یکتاست', async () => {
    await engine.query(
      `insert into seo.metadata (entity_kind, entity_id, locale, title) values ('business', $1, 'fa-IR', 'تک‌پت')`,
      [businessA],
    );
    await assert.rejects(
      () =>
        engine.query(`insert into seo.metadata (entity_kind, entity_id, locale, title) values ('business', $1, 'fa-IR', 'دیگر')`, [
          businessA,
        ]),
      (error) => error.code === '23505',
    );
    await engine.query(
      `insert into seo.metadata (entity_kind, entity_id, locale, title) values ('business', $1, 'en-US', 'TakPet')`,
      [businessA],
    );
  });

  test('متادیتای غیرقابل‌ایندکس باید دلیل داشته باشد تا در بازرسی گم نشود', async () => {
    const rows = await engine.query(
      `insert into seo.metadata (entity_kind, entity_id, is_indexable, non_indexable_reason, locale)
       values ('content', $1, false, 'thin_content', 'fa-IR') returning non_indexable_reason`,
      [uuidv7()],
    );
    assert.equal(String(rows[0].non_indexable_reason), 'thin_content');
    await assert.rejects(
      () =>
        engine.query(
          `insert into seo.metadata (entity_kind, entity_id, is_indexable, non_indexable_reason) values ('content', $1, false, 'به دلم برخورد')`,
          [uuidv7()],
        ),
      (error) => error.code === '23514',
    );
  });

  test('تغییر مسیر: زنجیره و حلقه تشخیص داده می‌شود', async () => {
    await engine.query(`insert into seo.redirect (source_path, target_path, status_code) values ('/a', '/b', 301)`);
    await engine.query(`insert into seo.redirect (source_path, target_path, status_code) values ('/b', '/c', 301)`);
    await engine.query(`insert into seo.redirect (source_path, target_path, status_code) values ('/c', '/a', 301)`);

    const loop = await engine.query(`select * from seo.redirect_chain_issue('/a', 5)`);
    assert.equal(String(loop[0].issue), 'loop');
    assert.ok(Array.isArray(loop[0].chain));
  });

  test('زنجیرهٔ بلند تشخیص داده می‌شود و زنجیرهٔ کوتاه نه', async () => {
    await engine.query(`insert into seo.redirect (source_path, target_path, status_code) values ('/x1', '/x2', 301)`);
    await engine.query(`insert into seo.redirect (source_path, target_path, status_code) values ('/x2', '/x3', 301)`);
    await engine.query(`insert into seo.redirect (source_path, target_path, status_code) values ('/x3', '/x4', 301)`);
    const short = await engine.query(`select * from seo.redirect_chain_issue('/x1', 5)`);
    assert.equal(short.length, 0, 'زنجیرهٔ سه‌گامی نباید مشکل باشد');

    await engine.query(`insert into seo.redirect (source_path, target_path, status_code) values ('/x4', '/x5', 301)`);
    await engine.query(`insert into seo.redirect (source_path, target_path, status_code) values ('/x5', '/x6', 301)`);
    await engine.query(`insert into seo.redirect (source_path, target_path, status_code) values ('/x6', '/x7', 301)`);
    const long = await engine.query(`select * from seo.redirect_chain_issue('/x1', 3)`);
    assert.equal(String(long[0].issue), 'chain_too_long');
  });

  test('تغییر مسیر به خودش ممکن نیست', async () => {
    await assert.rejects(
      () => engine.query(`insert into seo.redirect (source_path, target_path, status_code) values ('/self', '/self', 301)`),
      (error) => error.code === '23514',
    );
  });

  test('کد ۴۱۰ بدون مقصد و با دلیل درست ثبت می‌شود', async () => {
    await engine.query(`insert into seo.redirect (source_path, target_path, status_code) values ('/gone', null, 410)`);
    await assert.rejects(
      () => engine.query(`insert into seo.redirect (source_path, target_path, status_code) values ('/gone2', '/x', 410)`),
      (error) => error.code === '23514',
    );
  });

  test('تطبیق تغییر مسیر: بلندترین پیشوند برنده است', async () => {
    await engine.query(`insert into seo.redirect (source_path, target_path, status_code) values ('/t/old', '/t/new', 301)`);
    await engine.query(`insert into seo.redirect (source_path, target_path, status_code) values ('/t', '/types', 301)`);

    const exact = await engine.query(`select * from seo.match_redirect('/t/old', null)`);
    assert.equal(String(exact[0].target_path), '/t/new');

    const prefix = await engine.query(`select * from seo.match_redirect('/t/clinic', null)`);
    assert.equal(String(prefix[0].target_path), '/types', 'کوتاه‌ترین پیشوند منطبق باید انتخاب شود');

    const unknown = await engine.query(`select * from seo.match_redirect('/nothing', null)`);
    assert.equal(unknown.length, 0);
  });

  test('صفحهٔ یتیم کشف می‌شود و با افزودن پیوند داخلی از فهرست می‌رود', async () => {
    const orphans = await engine.query(`select * from seo.find_orphans($1, 50)`, [businessA]);
    assert.ok(orphans.some((row) => String(row.path) === '/b/tak-pet'), 'صفحهٔ بدون پیوند ورودی باید یتیم شمرده شود');

    await engine.query(`insert into seo.internal_link (source_path, target_path, link_kind) values ('/', '/b/tak-pet', 'hub')`);
    const after = await engine.query(`select * from seo.find_orphans($1, 50)`, [businessA]);
    assert.equal(after.some((row) => String(row.path) === '/b/tak-pet'), false);
  });

  test('کانونیکال نمی‌تواند به خودش اشاره کند', async () => {
    await assert.rejects(
      () => engine.query(`insert into seo.canonical (source_path, canonical_path, reason) values ('/a', '/a', 'duplicate')`),
      (error) => error.code === '23514',
    );
  });

  test('نقشهٔ سایت، سقف استاندارد را رعایت می‌کند', async () => {
    await assert.rejects(
      () => engine.query(`insert into seo.sitemap (name, kind, path, url_count) values ('big-one', 'page', '/sitemap-big.xml', 50001)`),
      (error) => error.code === '23514',
    );
    await engine.query(`insert into seo.sitemap (name, kind, path, url_count, status) values ('core-pages', 'page', '/sitemap-pages.xml', 42, 'ready')`);
    const rows = await engine.query(`select name, url_count from seo.sitemap where name = 'core-pages'`);
    assert.equal(Number(rows[0].url_count), 42);
  });

  test('موجودیت برند، تنها یک لنگر دارد', async () => {
    const anchors = await engine.query('select count(*)::int as c from seo.entity where is_brand_anchor');
    assert.equal(Number(anchors[0].c), 1);
    await assert.rejects(
      () =>
        engine.query(
          `insert into seo.entity (kind, key, name_fa, is_brand_anchor) values ('brand', 'other', 'برند دیگر', true)`,
        ),
      (error) => error.code === '23505',
    );
  });

  test('خوشهٔ موضوعی و کلیدواژه، یکتا در محدودهٔ خودشان', async () => {
    await engine.query(`insert into seo.topic (slug, title, intent, cluster_key) values ('dog-vaccine', 'واکسن سگ', 'informational', 'dog-health')`);
    await assert.rejects(
      () => engine.query(`insert into seo.topic (slug, title) values ('dog-vaccine', 'تکراری')`),
      (error) => error.code === '23505',
    );

    await engine.query(`insert into seo.keyword (phrase, phrase_key, intent, search_volume) values ('واکسن سگ', 'واکنسگ', 'informational', 1200)`);
    await assert.rejects(
      () => engine.query(`insert into seo.keyword (phrase, phrase_key) values ('واکسن  سگ', 'واکنسگ')`),
      (error) => error.code === '23505',
    );
  });

  test('یافتهٔ بازرسی سئو، راهنمای اصلاح دارد و قابل رفع است', async () => {
    const audit = await engine.query(
      `insert into seo.audit (target_path, run_kind, status) values ('/b/tak-pet', 'on_demand', 'running') returning id`,
    );
    const finding = await engine.query(
      `insert into seo.audit_finding (audit_id, rule_key, severity, message, remediation)
       values ($1, 'meta.title_too_long', 'warning', 'عنوان صفحه بیش از ۶۰ نویسه است.', 'عنوان را کوتاه کنید یا قالب را تغییر دهید.')
       returning id`,
      [audit[0].id],
    );
    const open = await engine.query('select count(*)::int as c from seo.audit_finding where resolved_at is null');
    assert.ok(Number(open[0].c) >= 1);
    await engine.query('update seo.audit_finding set resolved_at = now(), resolved_by = $1 where id = $2', [
      aliceId,
      finding[0].id,
    ]);
    const resolved = await engine.query('select resolved_at from seo.audit_finding where id = $1', [finding[0].id]);
    assert.notEqual(resolved[0].resolved_at, null);
  });

  test('تنظیمات سئو در محیط توسعه، ایندکس را خاموش می‌کند', async () => {
    const rows = await engine.query('select indexing_enabled, environment from seo.settings where business_id is null');
    assert.equal(rows[0].indexing_enabled, false);
    assert.equal(String(rows[0].environment), 'development');
    assert.ok(rows[0].indexing_enabled !== true, 'robots در محیط غیرتولیدی نباید ایندکس باز بگذارد');
  });
});
