/**
 * آزمون «حصارِ تهی» — رفتار سیاست‌های RLS وقتی زمینه خالی است (§14، §54–۵۵، §191).
 *
 * یک درس از گام ۲۶: سیاست `setting_business_all` شرطش را با برابریِ تهی‌امن
 * نوشته بود (`business_id IS NOT DISTINCT FROM current_business_id()`). وقتی
 * زمینهٔ کسب‌وکار تهی بود، ردیف‌های **سراسری** هم «برابر» شدند و هر کاربر عادی
 * می‌توانست تنظیمات پلتفرم (`platform.security`، `platform.robots`…) را بنویسد.
 *
 * هیچ آزمون سناریویی آن را نمی‌گرفت، چون سناریوها همیشه «کاربر + کسب‌وکار» داشتند.
 * این پرونده، **زمینهٔ تهی** را آزمون می‌کند: بی‌نام، کاربر بی‌کسب‌وکار، کارمند بی‌مجوز،
 * عضو بی‌نقش، غیرعضوِ جاعل. هر ردیف یک حمله است و باید رد شود — و هر ردیف یک
 * رفتارِ مشروع، که باید کار کند (اصلاح، نباید چیزی را بشکند).
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { createFixture } from '../scripts/lib/fixture.mjs';
import { uuidv7 } from '../packages/shared/dist/index.js';

let f;
let alice; // مالک
let bob; // عضو با نقش ناظر (viewer)
let eve; // غیرعضو
let businessId;

const ctx = (user, extra = {}) => ({ 'app.user_id': user?.userId ?? '', 'app.request_id': uuidv7(), ...extra });

/** اجرا و گزارش: `rows` (شمار ردیف‌های اثرگذار) یا `denied` (خطای RLS). */
async function attempt(role, sql, params, context) {
  try {
    const rows = await f.asRole(role, sql, params, context);
    return { rows: rows.length, denied: false };
  } catch (error) {
    // 42501 = insufficient_privilege (نقض سیاست RLS)
    const code = error.code ?? error.cause?.code;
    if (code === '42501') return { rows: 0, denied: true };
    throw error;
  }
}

before(async () => {
  f = await createFixture();
  alice = await f.registerUser({ email: 'alice@petavu.test', name: 'آلیس' });
  bob = await f.registerUser({ email: 'bob@petavu.test', name: 'باب' });
  eve = await f.registerUser({ email: 'eve@petavu.test', name: 'ایو' });
  businessId = await f.createBusiness({ slug: 'fence-biz', name: 'کسب‌وکار حصار', ownerUserId: alice.userId });
  await f.addMember({ businessId, userId: alice.userId, roleKey: 'owner' });
  await f.addMember({ businessId, userId: bob.userId, roleKey: 'viewer' });

  // سه ردیف: سراسریِ عادی (از seed)، سراسریِ سرّی، و کسب‌وکاریِ سرّی.
  await f.sudo(`insert into ops.setting (business_id, key, value, is_secret) values (null, 'test.global_secret', '{"token":"G"}'::jsonb, true)`);
  await f.sudo(`insert into ops.setting (business_id, key, value, is_secret) values ($1, 'test.biz_secret', '{"token":"B"}'::jsonb, true)`, [businessId]);
  await f.sudo(`insert into ops.setting (business_id, key, value, is_secret) values ($1, 'test.biz_plain', '{"v":1}'::jsonb, false)`, [businessId]);
});

after(async () => {
  await f?.close();
});

// ---------------------------------------------------------------------------
describe('تنظیمات سراسری: کاربر عادیِ بی‌کسب‌وکار نمی‌نویسد', () => {
  test('ویرایش تنظیم سراسری: صفر ردیف (پیش‌تر: ۱ ردیف!)', async () => {
    const result = await attempt('pv_app', `update ops.setting set value = '{"hacked":true}'::jsonb where business_id is null and key = 'platform.robots' returning 1 as x`, [], ctx(eve));
    assert.equal(result.rows, 0);
    const [row] = await f.sudo(`select value from ops.setting where business_id is null and key = 'platform.robots'`);
    assert.equal(row.value.hacked, undefined, 'مقدار نباید عوض شده باشد');
  });

  test('درج تنظیم سراسری جدید: رد می‌شود', async () => {
    const result = await attempt('pv_app', `insert into ops.setting (business_id, key, value) values (null, 'attacker.key', '{}'::jsonb) returning 1 as x`, [], ctx(eve));
    assert.equal(result.denied, true);
    assert.equal((await f.sudo(`select count(*)::int c from ops.setting where key = 'attacker.key'`))[0].c, 0);
  });

  test('حذف تنظیم سراسری: صفر ردیف', async () => {
    const result = await attempt('pv_app', `delete from ops.setting where business_id is null and key = 'platform.security' returning 1 as x`, [], ctx(eve));
    assert.equal(result.rows, 0);
    assert.equal((await f.sudo(`select count(*)::int c from ops.setting where key = 'platform.security'`))[0].c, 1);
  });

  test('بی‌نام هم نمی‌نویسد (گرنت ندارد) و نمی‌تواند به نام کسب‌وکار بنویسد', async () => {
    const result = await attempt('pv_public', `update ops.setting set value = '{}'::jsonb where key = 'platform.robots' returning 1 as x`, [], {});
    assert.equal(result.denied, true);
  });

  test('رفتار مشروع: همه تنظیم سراسریِ غیرسرّی را می‌خوانند', async () => {
    const anonymous = await f.asRole('pv_public', `select key from ops.setting where business_id is null and key = 'platform.robots'`);
    const user = await f.asRole('pv_app', `select key from ops.setting where business_id is null and key = 'platform.robots'`, [], ctx(eve));
    assert.equal(anonymous.length, 1);
    assert.equal(user.length, 1);
  });
});

// ---------------------------------------------------------------------------
describe('تنظیم سرّی: هرگز برای بی‌نام و عضو عادی', () => {
  test('بی‌نام، تنظیم سراسریِ سرّی را نمی‌بیند (پیش‌تر: می‌دید)', async () => {
    const rows = await f.asRole('pv_public', `select key, value from ops.setting where key = 'test.global_secret'`);
    assert.deepEqual(rows, []);
  });

  test('کاربر عادی هم نمی‌بیند', async () => {
    const rows = await f.asRole('pv_app', `select key from ops.setting where key = 'test.global_secret'`, [], ctx(eve));
    assert.deepEqual(rows, []);
  });

  test('بی‌نام هیچ‌چیز از تنظیم کسب‌وکار نمی‌بیند', async () => {
    const rows = await f.asRole('pv_public', `select key from ops.setting where business_id is not null`);
    assert.deepEqual(rows, []);
  });

  test('کارمند پلتفرم بدون مجوز تنظیمات، سرّی را نمی‌بیند؛ با مجوز می‌بیند', async () => {
    const without = await f.asRole('pv_app', `select key from ops.setting where key = 'test.global_secret'`, [], ctx(eve, { 'app.platform_role': 'support' }));
    assert.deepEqual(without, [], 'support مجوز تنظیمات ندارد');
    // غیرسرّی را هر نقش پلتفرمی می‌بیند.
    const plain = await f.asRole('pv_app', `select key from ops.setting where key = 'platform.robots'`, [], ctx(eve, { 'app.platform_role': 'support' }));
    assert.equal(plain.length, 1);

    const withPermission = await f.asRole('pv_app', `select key from ops.setting where key = 'test.global_secret'`, [], ctx(eve, { 'app.platform_role': 'superadmin' }));
    assert.equal(withPermission.length, 1);
  });

  test('نوشتن تنظیم سراسری: فقط با مجوز تنظیمات (support نه، superadmin بله)', async () => {
    const denied = await attempt(
      'pv_app',
      `update ops.setting set description = 'x' where business_id is null and key = 'platform.brand' returning 1 as x`,
      [],
      ctx(eve, { 'app.platform_role': 'support' }),
    );
    assert.equal(denied.rows, 0);

    const allowed = await attempt(
      'pv_app',
      `update ops.setting set description = 'تنظیم برند' where business_id is null and key = 'platform.brand' returning 1 as x`,
      [],
      ctx(alice, { 'app.platform_role': 'superadmin' }),
    );
    assert.equal(allowed.rows, 1);
  });
});

// ---------------------------------------------------------------------------
describe('تنظیم کسب‌وکار: عضویت و مجوز، نه فقط زمینهٔ جاعلانه', () => {
  const asMember = (user) => ctx(user, { 'app.business_id': businessId });

  test('غیرعضوی که زمینه را جعل کرده، چیزی نمی‌بیند و نمی‌نویسد', async () => {
    const read = await f.asRole('pv_app', `select key from ops.setting where business_id = $1`, [businessId], asMember(eve));
    assert.deepEqual(read, []);
    const write = await attempt('pv_app', `update ops.setting set value = '{"v":9}'::jsonb where key = 'test.biz_plain' returning 1 as x`, [], asMember(eve));
    assert.equal(write.rows, 0);
    const insert = await attempt('pv_app', `insert into ops.setting (business_id, key, value) values ($1, 'eve.key', '{}'::jsonb) returning 1 as x`, [businessId], asMember(eve));
    assert.equal(insert.denied, true);
  });

  test('عضو ناظر، تنظیم غیرسرّی را می‌خواند ولی نمی‌نویسد و سرّی را نمی‌بیند', async () => {
    const read = await f.asRole('pv_app', `select key from ops.setting where business_id = $1 order by key`, [businessId], asMember(bob));
    assert.deepEqual(read.map((row) => row.key), ['test.biz_plain']);

    const write = await attempt('pv_app', `update ops.setting set value = '{"v":9}'::jsonb where key = 'test.biz_plain' returning 1 as x`, [], asMember(bob));
    assert.equal(write.rows, 0);
    const insert = await attempt('pv_app', `insert into ops.setting (business_id, key, value) values ($1, 'bob.key', '{}'::jsonb) returning 1 as x`, [businessId], asMember(bob));
    assert.equal(insert.denied, true);
    const remove = await attempt('pv_app', `delete from ops.setting where key = 'test.biz_plain' returning 1 as x`, [], asMember(bob));
    assert.equal(remove.rows, 0);
  });

  test('مالک: می‌خواند و می‌نویسد، سرّی را هم (مجوز یکپارچه‌سازی دارد)', async () => {
    const read = await f.asRole('pv_app', `select key from ops.setting where business_id = $1 order by key`, [businessId], asMember(alice));
    assert.deepEqual(read.map((row) => row.key), ['test.biz_plain', 'test.biz_secret']);

    const update = await attempt('pv_app', `update ops.setting set value = '{"v":2}'::jsonb where key = 'test.biz_plain' returning 1 as x`, [], asMember(alice));
    assert.equal(update.rows, 1);
    const insert = await attempt('pv_app', `insert into ops.setting (business_id, key, value) values ($1, 'owner.key', '{}'::jsonb) returning 1 as x`, [businessId], asMember(alice));
    assert.equal(insert.rows, 1);
  });

  test('نوشتن برای کسب‌وکارِ دیگر (زمینه ≠ ردیف) رد می‌شود', async () => {
    const other = await f.createBusiness({ slug: 'other-biz', name: 'دیگری', ownerUserId: alice.userId });
    await f.addMember({ businessId: other, userId: alice.userId, roleKey: 'owner' });
    const result = await attempt(
      'pv_app',
      `insert into ops.setting (business_id, key, value) values ($1, 'cross.key', '{}'::jsonb) returning 1 as x`,
      [other],
      asMember(alice), // زمینه: کسب‌وکار اول؛ ردیف: کسب‌وکار دوم
    );
    assert.equal(result.denied, true);
  });
});

// ---------------------------------------------------------------------------
describe('کلید ایدمپوتنسی: متعلق به کنشگر (نه «هر کسی که زمینه‌اش تهی است»)', () => {
  before(async () => {
    await f.sudo(
      `insert into ops.idempotency_key (scope, key, request_hash, actor_id, business_id, response)
       values ('listing.create', 'alice-key', 'h', $1, null, '{"secret":"alice-response"}'::jsonb)`,
      [alice.userId],
    );
  });

  test('دیگری آن را نمی‌بیند، نمی‌نویسد و نمی‌خواند (پیش‌تر: همه چیز را می‌دید)', async () => {
    const read = await f.asRole('pv_app', `select key, response from ops.idempotency_key`, [], ctx(eve));
    assert.deepEqual(read, []);
    const update = await attempt('pv_app', `update ops.idempotency_key set status = 'completed' returning 1 as x`, [], ctx(eve));
    assert.equal(update.rows, 0);
    const remove = await attempt('pv_app', `delete from ops.idempotency_key returning 1 as x`, [], ctx(eve));
    assert.equal(remove.rows, 0);
  });

  test('نمی‌توان به نام دیگری کلید ساخت', async () => {
    const result = await attempt(
      'pv_app',
      `insert into ops.idempotency_key (scope, key, request_hash, actor_id) values ('listing.create', 'forged', 'h', $1) returning 1 as x`,
      [alice.userId],
      ctx(eve),
    );
    assert.equal(result.denied, true);
  });

  test('رفتار مشروع: صاحب کلید آن را می‌بیند و می‌سازد', async () => {
    const read = await f.asRole('pv_app', `select key from ops.idempotency_key`, [], ctx(alice));
    assert.deepEqual(read.map((row) => row.key), ['alice-key']);
    const own = await attempt(
      'pv_app',
      `insert into ops.idempotency_key (scope, key, request_hash, actor_id) values ('listing.create', 'alice-key-2', 'h', $1) returning 1 as x`,
      [alice.userId],
      ctx(alice),
    );
    assert.equal(own.rows, 1);
  });

  test('ردیف بی‌صاحب (actor تهی) را هیچ‌کس نمی‌بیند', async () => {
    await f.sudo(`insert into ops.idempotency_key (scope, key, request_hash) values ('orphan.scope', 'orphan', 'h')`);
    for (const user of [alice, eve]) {
      const rows = await f.asRole('pv_app', `select key from ops.idempotency_key where key = 'orphan'`, [], ctx(user));
      assert.deepEqual(rows, []);
    }
  });
});

// ---------------------------------------------------------------------------
describe('الگو: هیچ سیاستی به برابریِ تهی‌امنِ business_id تکیه نمی‌کند', () => {
  test('هر سیاستِ `IS [NOT] DISTINCT FROM app.current_business_id()` کنشگر یا «غیرتهی» را هم می‌خواهد', async () => {
    const rows = await f.sudo(
      `select schemaname || '.' || tablename as t, policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '') as expr
         from pg_policies
        where schemaname in ('ref', 'auth', 'app', 'media', 'design', 'seo', 'ops')
          and (coalesce(qual, '') || coalesce(with_check, '')) ilike '%distinct from app.current_business_id()%'`,
    );
    const unsafe = rows.filter(
      (row) => !/business_id IS NOT NULL/i.test(row.expr) && !/actor_id = app\.current_user_id\(\)/i.test(row.expr),
    );
    assert.deepEqual(
      unsafe.map((row) => `${row.t}:${row.policyname}`),
      [],
      'برابریِ تهی‌امن بدون «غیرتهی» یا «کنشگر»، ردیف‌های سراسری را با زمینهٔ تهی هم‌ارز می‌کند',
    );
    // و الگو واقعاً هنوز جایی هست (کلید ایدمپوتنسی)، پس این آزمون خالی از معنا نیست.
    assert.ok(rows.length >= 1);
  });

  test('هیچ تنظیم سراسری یا کسب‌وکاری سرّی، برای نقش بی‌نام خواندنی نیست', async () => {
    const rows = await f.asRole('pv_public', `select key from ops.setting where is_secret`);
    assert.deepEqual(rows, []);
  });
});
