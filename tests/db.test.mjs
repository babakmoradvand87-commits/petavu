/**
 * تست `@petavu/db` (گام ۱۸ — §52–۵۵، §58، §78؛ Addendum §19–۲۰).
 *
 * چرا روی موتور تعبیه‌شده: قاعدهٔ پروژه این است که تست از خروجی ساخته‌شده
 * (`dist`) و از SQL واقعی استفاده کند. تنها چیزی که عوض می‌شود، درایور است؛
 * DAL، صفحه‌بندی، کنترل نسخه، نگهبان مستأجر و ترجمهٔ خطا همان کد تولیدند.
 *
 * یک تفاوت صادقانه: موتور تعبیه‌شده فقط ردیف‌ها را برمی‌گرداند، پس `affected`
 * در این آداپتور «تعداد ردیف برگشته» است. به همین دلیل، آزمون‌های نوشتن همه
 * `returning` دارند (§102).
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDatabase } from '../scripts/lib/engine.mjs';
import { migrate } from '../scripts/lib/migrate.mjs';
import { applySeeds } from '../scripts/lib/seed.mjs';

import {
  sql,
  raw,
  ident,
  idents,
  inList,
  valueRows,
  assertStatementSafe,
  hasSelectStar,
  createDal,
  insertInto,
  updateWhere,
  assertTenantScoped,
  tenantFilter,
  withContext,
  requireBusinessId,
  isImpersonating,
  systemContext,
  emitEvent,
  recordAudit,
  mapDatabaseError,
  checkConnection,
  encodeCursor,
  decodeCursor,
  normalizeLimit,
  buildPage,
} from '../packages/db/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..');

let engine;
let client;
let dal;
let aliceId;
let bobId;
let businessA;
let businessB;

/**
 * آداپتور موتور تعبیه‌شده به قرارداد `SqlClient`.
 *
 * `set role`/`reset role` دستی نوشته می‌شود (نه با تابع موتور) چون دستهٔ
 * تراکنش در موتور، فقط `query`/`exec` دارد. مهم‌تر: `reset role` همیشه در
 * `finally` است؛ بدون آن، نقشِ آلوده به تست بعدی می‌رسد و نتیجه‌ها بی‌اعتبار
 * می‌شوند.
 */
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
        typeof runner.withTransaction === 'function'
          ? runner.withTransaction(async (tx) => fn(make(tx)))
          : fn(scoped),
      async asRole(role, fn) {
        await runner.exec(`set role "${role}"`);
        try {
          return await fn(scoped);
        } finally {
          await runner.exec('reset role');
        }
      },
      close: () => handle.close(),
    };
    return scoped;
  };
  return make(handle);
}

before(async () => {
  engine = await openDatabase();
  await migrate(engine, { dir: join(projectRoot, 'migrations') });
  await applySeeds(engine, { dir: join(projectRoot, 'seeds') });

  const users = await engine.query(
    `insert into auth.app_user (display_name, status) values ('آلیس رضایی', 'active'), ('بابک مرادی', 'active') returning id`,
  );
  [aliceId, bobId] = users.map((row) => String(row.id));

  const roles = await engine.query(`select id from app.role where business_id is null and key = 'owner'`);
  const ownerRoleId = String(roles[0].id);

  const businesses = await engine.query(
    `insert into app.business (slug, name, business_type_key, owner_user_id)
     values ('tak-pet', 'پت‌شاپ تک‌پت', 'pet_shop', $1),
            ('vet-sharif', 'کلینیک دامپزشکی شریف', 'veterinary_clinic', $2)
     returning id`,
    [aliceId, bobId],
  );
  [businessA, businessB] = businesses.map((row) => String(row.id));

  await engine.query(
    `insert into app.membership (business_id, user_id, role_id, status, joined_at)
     values ($1, $2, $3, 'active', now()), ($4, $5, $3, 'active', now())`,
    [businessA, aliceId, ownerRoleId, businessB, bobId],
  );

  client = createEmbeddedClient(engine);
  dal = createDal(client);
});

after(async () => {
  await engine.close();
});

// ---------------------------------------------------------------------------
describe('ساخت SQL: مقدار پارامتر است، نام از فهرست بسته (§52، §58)', () => {
  test('مقدارها هرگز در متن SQL نمی‌نشینند', () => {
    const fragment = sql`select id from app.business where slug = ${'tak-pet'} and name = ${"x' or 1=1 --"}`;

    assert.equal(fragment.text, 'select id from app.business where slug = $1 and name = $2');
    assert.deepEqual(fragment.params, ['tak-pet', "x' or 1=1 --"]);
    assert.ok(!fragment.text.includes('tak-pet'), 'مقدار نباید در متن باشد');
  });

  test('قطعهٔ درونی، پارامترهایش را با انحراف درست درج می‌کند', () => {
    const inner = sql`and b.slug = ${'tak-pet'}`;
    const outer = sql`select b.id from app.business b where b.name = ${'x'} ${inner} and b.owner_user_id = ${aliceId}`;

    assert.equal(outer.text, 'select b.id from app.business b where b.name = $1 and b.slug = $2 and b.owner_user_id = $3');
    assert.deepEqual(outer.params, ['x', 'tak-pet', aliceId]);
  });

  test('آرایه به فهرست پارامتر گسترده می‌شود و آرایهٔ تهی، «هیچ‌چیز» است', () => {
    const list = sql`select id from app.business where slug in (${['a', 'b', 'c']})`;
    assert.equal(list.text, 'select id from app.business where slug in ($1, $2, $3)');
    assert.deepEqual(list.params, ['a', 'b', 'c']);

    const empty = sql`select id from app.business where slug in (${[]})`;
    assert.equal(empty.text, 'select id from app.business where slug in (select null where false)');
    assert.deepEqual(empty.params, []);
  });

  test('نام شناسه اعتبارسنجی می‌شود؛ نام نامعتبر رد می‌شود', () => {
    assert.equal(ident('app.business').text, '"app"."business"');
    assert.equal(ident('id').text, '"id"');
    assert.equal(idents(['id', 'slug']).text, '"id", "slug"');

    assert.throws(() => ident('app.business; drop table app.business'), (error) => error.code === 'validation_failed');
    assert.throws(() => ident('Business'), (error) => error.code === 'validation_failed');
    assert.throws(() => idents([]), (error) => error.code === 'validation_failed');
  });

  test('بازرسی دستور: select *، چنددستوری و متنی که بریده شده', () => {
    assert.equal(hasSelectStar('select * from app.business'), true);
    assert.equal(hasSelectStar('select b.* from app.business b'), true);
    assert.equal(hasSelectStar('select id, slug from app.business'), false);
    assert.equal(hasSelectStar('select id -- کامنت با * ستاره'), false);
    assert.equal(hasSelectStar(`select 'رشته‌ای با * ستاره' as note from app.business`), false);

    assert.throws(() => assertStatementSafe('select * from app.business'), (error) => error.code === 'precondition_failed');
    assert.throws(
      () => assertStatementSafe('select id from app.business; drop table app.business'),
      (error) => error.details?.reason === 'multiple_statements',
    );
    assert.throws(() => raw('id; drop table x'), (error) => error.code === 'precondition_failed');

    // نقطه‌ویرگول پایانی مشکلی ندارد: یک دستور است.
    assert.doesNotThrow(() => assertStatementSafe('select id from app.business;'));
  });

  test('inList و valueRows، پارامترگذاری درست می‌سازند', () => {
    const list = inList(raw('b.id'), ['x', 'y']);
    assert.equal(list.text, 'b.id in ($1, $2)');
    assert.equal(inList(raw('b.id'), []).text, 'false');

    const rows = valueRows([
      ['a', 1],
      ['b', 2],
    ]);
    assert.equal(rows.text, '($1, $2), ($3, $4)');
    assert.deepEqual(rows.params, ['a', 1, 'b', 2]);
    assert.throws(() => valueRows([]), (error) => error.code === 'validation_failed');
  });
});

// ---------------------------------------------------------------------------
describe('DAL: یک/چند/هیچ و شمارش (§53)', () => {
  test('one/maybeOne/count/exists رفتار درست دارند', async () => {
    const business = await dal.one(sql`select id, slug from app.business where slug = ${'tak-pet'}`);
    assert.equal(String(business.slug), 'tak-pet');

    assert.equal(await dal.maybeOne(sql`select id from app.business where slug = ${'nothing-here'}`), null);

    await assert.rejects(
      () => dal.one(sql`select id from app.business where slug = ${'nothing-here'}`),
      (error) => error.code === 'not_found',
    );

    const total = await dal.count(sql`select count(*)::int as total from app.business`);
    assert.equal(total, 2);

    assert.equal(await dal.exists(sql`select true as present from app.business where slug = ${'tak-pet'}`), true);
    assert.equal(await dal.exists(sql`select true as present from app.business where slug = ${'nope'}`), false);
  });

  test('select * از راه DAL اجرا نمی‌شود', async () => {
    await assert.rejects(
      () => dal.query('select * from app.business'),
      (error) => error.code === 'precondition_failed' && error.details?.reason === 'select_star_forbidden',
    );
  });

  test('insertInto/updateWhere با نگهبان مستأجر کار می‌کنند', async () => {
    await withContext(client, { userId: aliceId, businessId: businessA }, async (tx) => {
      const fragment = insertInto('ops.automation_rule', {
        business_id: businessA,
        key: 'dal.test_rule',
        name_fa: 'قاعدهٔ آزمون DAL',
        event_type: 'dal.test',
        conditions: JSON.stringify({ all: [] }),
        actions: JSON.stringify([]),
        status: 'draft',
        created_by: aliceId,
      });
      const created = await tx.asRole('pv_app', () => tx.query(fragment.text, fragment.params));
      assert.ok(created.rows[0]?.id, 'درج با نقش برنامه باید انجام شود');
    });

    await withContext(client, { userId: aliceId, businessId: businessA }, async (tx) => {
      const fragment = updateWhere(
        'ops.automation_rule',
        { name_fa: 'قاعدهٔ آزمون DAL — ویرایش‌شده' },
        assertTenantScoped(sql`business_id = ${businessA} and key = ${'dal.test_rule'}`, businessA),
      );
      const updated = await tx.asRole('pv_app', () => tx.query(fragment.text, fragment.params));
      assert.equal(updated.affected, 1);
    });

    const check = await dal.one(
      sql`select name_fa from ops.automation_rule where business_id = ${businessA} and key = ${'dal.test_rule'}`,
    );
    assert.equal(String(check.name_fa), 'قاعدهٔ آزمون DAL — ویرایش‌شده');
  });

  test('نگهبان مستأجر، پرس‌وجوی بی‌مستأجر را رد می‌کند', () => {
    assert.throws(
      () => assertTenantScoped(sql`select id from app.content where slug = ${'x'}`, businessA),
      (error) => error.details?.reason === 'unscoped_tenant_query',
    );
    assert.throws(
      () => assertTenantScoped(sql`select id from app.content where business_id = ${businessA}`, null),
      (error) => error.details?.reason === 'missing_tenant_context',
    );

    const scoped = assertTenantScoped(sql`select id from app.content where business_id = ${businessA}`, businessA);
    assert.match(scoped.text, /business_id/);
    assert.equal(tenantFilter(businessA).text, 'b.business_id = $1');
    assert.deepEqual(tenantFilter(businessA).params, [businessA]);
  });
});

// ---------------------------------------------------------------------------
describe('زمینهٔ درخواست: با تراکنش می‌آید، با تراکنش می‌رود (§54)', () => {
  test('زمینه بیرون از تراکنش باقی نمی‌ماند', async () => {
    await withContext(client, { userId: aliceId, businessId: businessA, requestId: 'req-1' }, async (tx) => {
      const inside = await tx.query('select app.current_user_id()::text as uid, app.current_business_id()::text as bid');
      assert.equal(String(inside.rows[0].uid), aliceId);
      assert.equal(String(inside.rows[0].bid), businessA);
    });

    const after = await client.query('select app.current_user_id()::text as uid, app.current_business_id()::text as bid');
    assert.equal(after.rows[0].uid, null, 'زمینه پس از تراکنش نباید بماند');
    assert.equal(after.rows[0].bid, null);
  });

  /**
   * مدل امنیتی اینجا دو حصار دارد و آزمون باید هر دو را نشان دهد:
   *   • حصار RLS: «عضویت». هیچ‌کس ردیف کسب‌وکاری که عضو آن نیست را نمی‌بیند.
   *   • حصار پرس‌وجو: «کسب‌وکار جاری». هر پرس‌وجوی دامنه، `business_id` را
   *     صریح می‌گذارد، پس کار روزمره فقط روی کسب‌وکار فعال انجام می‌شود.
   * RLS جای فیلتر پرس‌وجو را نمی‌گیرد و فیلتر پرس‌وجو جای RLS را.
   */
  test('حصار RLS: عضویت — نه کسب‌وکار جاری — دامنهٔ دیدن را تعیین می‌کند', async () => {
    const countAs = (context, targetBusiness) =>
      withContext(client, context, (tx) =>
        tx
          .asRole('pv_app', () => tx.query(`select count(*)::int as n from ops.automation_rule where business_id = $1`, [targetBusiness]))
          .then((result) => Number(result.rows[0].n)),
      );

    assert.ok(
      (await countAs({ userId: aliceId, businessId: businessA }, businessA)) >= 1,
      'عضو کسب‌وکار، قاعده‌های کسب‌وکار خودش را می‌بیند',
    );

    assert.equal(
      await countAs({ userId: bobId, businessId: businessB }, businessA),
      0,
      'نفوذ میان‌مستأجری: عضو کسب‌وکار دیگر، هیچ ردیفی از کسب‌وکار اول نمی‌بیند',
    );

    assert.equal(
      await countAs({ userId: aliceId, businessId: businessA }, businessB),
      0,
      'و برعکس: عضو اول، هیچ ردیفی از کسب‌وکار دوم نمی‌بیند',
    );

    // عضویت، حصار است نه کسب‌وکار جاری: عضو می‌تواند ردیف کسب‌وکار خودش را
    // ببیند حتی وقتی زمینه روی کسب‌وکار دیگری است. این «نشت» نیست — چارچوب
    // چند‌کسب‌وکاری است؛ ولی کار روزمره همیشه با فیلتر صریح انجام می‌شود.
    assert.ok(
      (await countAs({ userId: aliceId, businessId: businessB }, businessA)) >= 1,
      'عضویت، حصار واقعی است: دو کسب‌وکار زیر یک حساب پنهان از هم نیستند',
    );
  });

  test('requireBusinessId و isImpersonating، تصمیم‌های زمینه را روشن می‌کنند', () => {
    assert.equal(requireBusinessId({ businessId: businessA }), businessA);
    assert.throws(() => requireBusinessId({ businessId: null }, 'ویرایش محتوا'), (error) => error.code === 'forbidden');

    assert.equal(isImpersonating({ impersonatedBy: aliceId }), true);
    assert.equal(isImpersonating({}), false);

    const system = systemContext('req-worker-1');
    assert.equal(system.userId, null);
    assert.equal(system.businessId, null);
    assert.equal(system.requestId, 'req-worker-1');
  });

  test('خطای داخل تراکنش، همهٔ اثرها را برمی‌گرداند', async () => {
    const before = await dal.count(sql`select count(*)::int as total from ops.automation_rule`);

    await assert.rejects(
      () =>
        withContext(client, { userId: aliceId, businessId: businessA }, async (tx) => {
          await tx.asRole('pv_app', () =>
            tx.query(
              `insert into ops.automation_rule (business_id, key, name_fa, event_type, conditions, actions, status)
               values ($1, 'dal.rollback_probe', 'آزمون بازگشت', 'dal.probe', '{"all":[]}'::jsonb, '[]'::jsonb, 'draft')`,
              [businessA],
            ),
          );
          throw new Error('شکست عمدی پس از درج');
        }),
      /شکست عمدی/,
    );

    const after = await dal.count(sql`select count(*)::int as total from ops.automation_rule`);
    assert.equal(after, before, 'تراکنش شکست‌خورده نباید ردیفی باقی بگذارد');
  });
});

// ---------------------------------------------------------------------------
describe('صفحه‌بندی نشانگری: پایدار و بدون پرش (§20)', () => {
  test('پیمایش کامل، بدون تکرار و بدون جاافتادن', async () => {
    const seen = new Set();
    let cursor = null;
    let pages = 0;

    for (;;) {
      const page = await dal.page({
        request: { cursor, limit: 1 },
        statement: (current, fetchLimit) => {
          const tail = current ? sql`and (b.name, b.id) > (${current.key}, ${current.id})` : raw('');
          return sql`select b.id, b.name from app.business b where true ${tail} order by b.name, b.id limit ${fetchLimit}`;
        },
        extract: (row) => ({ key: String(row.name), id: String(row.id) }),
      });

      for (const item of page.items) seen.add(String(item.id));
      pages += 1;
      cursor = page.nextCursor;
      if (!cursor) break;
      assert.ok(pages < 10, 'پیمایش نباید بی‌پایان شود');
    }

    assert.equal(pages, 2, 'دو کسب‌وکار با صفحهٔ یک‌تایی، دقیقاً دو صفحه است');
    assert.equal(seen.size, 2, 'هر ردیف باید دقیقاً یک بار دیده شود');
  });

  test('اکنون که صفحه‌بندی می‌شود، ردیف تازه در میانهٔ پیمایش، نتیجه را خراب نمی‌کند', async () => {
    const firstName = await dal.one(sql`select name from app.business order by name, id limit 1`);
    const inserted = await engine.query(
      `insert into app.business (slug, name, business_type_key, owner_user_id)
       values ('aaa-first', 'آ اولین', 'pet_shop', $1) returning id`,
      [aliceId],
    );

    const page = await dal.page({
      request: { cursor: encodeCursor({ key: String(firstName.name), id: businessA }), limit: 10 },
      statement: (current, fetchLimit) => {
        const tail = current ? sql`and (b.name, b.id) > (${current.key}, ${current.id})` : raw('');
        return sql`select b.id, b.name from app.business b where true ${tail} order by b.name, b.id limit ${fetchLimit}`;
      },
      extract: (row) => ({ key: String(row.name), id: String(row.id) }),
    });

    // صفحهٔ دوم نباید ردیف تازه (که *پیش* از نشانگر است) را برگرداند؛ چیزی که
    // با شمارهٔ صفحه رخ می‌داد.
    assert.ok(!page.items.some((row) => String(row.id) === String(inserted[0].id)));

    await engine.query(`delete from app.business where id = $1`, [String(inserted[0].id)]);
  });

  test('نشانگر نامعتبر، خطای روشن می‌دهد (نه استثنای نامفهوم)', () => {
    assert.deepEqual(decodeCursor(encodeCursor({ key: 'x', id: 'y' })), { key: 'x', id: 'y' });
    assert.equal(decodeCursor(null), null);
    assert.throws(() => decodeCursor('not-a-cursor'), (error) => error.code === 'validation_failed');
    assert.throws(() => decodeCursor(Buffer.from('{"a":1}').toString('base64url')), (error) => error.code === 'validation_failed');
  });

  test('اندازهٔ صفحه، سقف دارد', () => {
    assert.equal(normalizeLimit(undefined), 20);
    assert.equal(normalizeLimit(500, { max: 100 }), 100);
    assert.throws(() => normalizeLimit(0), (error) => error.code === 'validation_failed');
  });

  test('buildPage یک ردیف اضافه را به «ادامه دارد» تبدیل می‌کند', () => {
    const rows = [{ id: '1' }, { id: '2' }, { id: '3' }];
    const page = buildPage(rows, 2, (row) => ({ key: 'k', id: String(row.id) }));
    assert.equal(page.items.length, 2);
    assert.equal(page.hasMore, true);
    assert.ok(page.nextCursor);

    const lastPage = buildPage([{ id: '9' }], 2, (row) => ({ key: 'k', id: String(row.id) }));
    assert.equal(lastPage.hasMore, false);
    assert.equal(lastPage.nextCursor, null);
  });
});

// ---------------------------------------------------------------------------
describe('هم‌زمانی خوش‌بینانه: نسخهٔ کهنه، نوشته نمی‌شود (§55)', () => {
  test('به‌روزرسانی با نسخهٔ درست، نسخه را جلو می‌برد', async () => {
    const [created] = await engine.query(
      `insert into ops.automation_rule (business_id, key, name_fa, event_type, conditions, actions, status)
       values ($1, 'dal.version_rule', 'قاعدهٔ نسخه', 'dal.version', '{"all":[]}'::jsonb, '[]'::jsonb, 'draft') returning id, version`,
      [businessA],
    );

    const updated = await withContext(client, { userId: aliceId, businessId: businessA }, (tx) =>
      tx.asRole('pv_app', () =>
        // DAL روی کلاینت تراکنش: پرس‌وجو باید همان زمینه و همان اتصال را ببیند.
        createDal(tx).updateWithVersion({
          table: 'ops.automation_rule',
          id: String(created.id),
          expectedVersion: Number(created.version),
          values: { name_fa: 'قاعدهٔ نسخه — ویرایش‌شده' },
          tenant: { column: 'business_id', value: businessA },
          returning: ['id', 'version', 'name_fa'],
        }),
      ),
    );

    assert.equal(Number(updated.version), Number(created.version) + 1);
    assert.equal(String(updated.name_fa), 'قاعدهٔ نسخه — ویرایش‌شده');
  });

  test('نسخهٔ کهنه، precondition_failed می‌گیرد و چیزی تغییر نمی‌کند', async () => {
    const [row] = await engine.query(
      `select id, version, name_fa from ops.automation_rule where business_id = $1 and key = 'dal.version_rule'`,
      [businessA],
    );

    await assert.rejects(
      () =>
        withContext(client, { userId: aliceId, businessId: businessA }, (tx) =>
          tx.asRole('pv_app', () =>
            createDal(tx).updateWithVersion({
              table: 'ops.automation_rule',
              id: String(row.id),
              expectedVersion: Number(row.version) - 1,
              values: { name_fa: 'نباید بنشیند' },
              tenant: { column: 'business_id', value: businessA },
            }),
          ),
        ),
      (error) => error.code === 'precondition_failed' && error.details?.reason === 'version_conflict',
    );

    const [check] = await engine.query(`select name_fa from ops.automation_rule where id = $1`, [String(row.id)]);
    assert.equal(String(check.name_fa), String(row.name_fa));
  });

  test('مستأجر نادرست، حتی با نسخهٔ درست، نوشته نمی‌شود', async () => {
    const [row] = await engine.query(
      `select id, version from ops.automation_rule where business_id = $1 and key = 'dal.version_rule'`,
      [businessA],
    );

    await assert.rejects(
      () =>
        withContext(client, { userId: bobId, businessId: businessB }, (tx) =>
          tx.asRole('pv_app', () =>
            createDal(tx).updateWithVersion({
              table: 'ops.automation_rule',
              id: String(row.id),
              expectedVersion: Number(row.version),
              values: { name_fa: 'نفوذ میان‌مستأجری' },
              tenant: { column: 'business_id', value: businessB },
            }),
          ),
        ),
      (error) => error.code === 'precondition_failed',
    );

    const [check] = await engine.query(`select name_fa from ops.automation_rule where id = $1`, [String(row.id)]);
    assert.equal(String(check.name_fa), 'قاعدهٔ نسخه — ویرایش‌شده');
  });
});

// ---------------------------------------------------------------------------
describe('پرهیز از N+1 و شمارش پرس‌وجو (Addendum §19)', () => {
  test('batchLoad برای n کلید، یک بار بارگذار را صدا می‌زند', async () => {
    const ids = [businessA, businessB, businessA];
    let calls = 0;

    const loaded = await dal.batchLoad(
      ids,
      async (handle, keys) => {
        calls += 1;
        const result = await handle.query(`select id, slug from app.business where id = any($1::uuid[])`, [keys]);
        return result.rows;
      },
      { keyOf: (row) => String(row.id), valueOf: (row) => String(row.slug) },
    );

    assert.equal(calls, 1, 'یک پرس‌وجو برای همهٔ کلیدها، نه یکی برای هر کلید');
    assert.equal(loaded.size, 2);
    assert.equal(loaded.get(businessA), 'tak-pet');
  });

  test('batchLoad با فهرست تهی، هیچ پرس‌وجویی نمی‌زند', async () => {
    let calls = 0;
    const loaded = await dal.batchLoad([], async () => {
      calls += 1;
      return [];
    }, { keyOf: () => 'x' });
    assert.equal(calls, 0);
    assert.equal(loaded.size, 0);
  });

  test('شمارندهٔ پرس‌وجو با DAL ساخته‌شده روی کلاینت تراکنش، همان تراکنش را می‌شمارد', async () => {
    const scoped = createDal(client);
    scoped.resetStats();
    await withContext(client, { userId: aliceId, businessId: businessA }, async (tx) => {
      const inner = createDal(tx);
      await inner.query(sql`select id from app.business limit 1`);
      assert.equal(inner.stats().queries, 1);
    });
    assert.equal(scoped.stats().queries, 0, 'شمارندهٔ کلاینت تراکنش با شمارندهٔ کلاینت اصلی قاطی نمی‌شود');
  });

  test('شمارندهٔ پرس‌وجو، در دسترس بازرسی است', async () => {
    dal.resetStats();
    await dal.query(sql`select id from app.business limit 1`);
    await dal.query(sql`select id from app.business limit 1`);
    assert.equal(dal.stats().queries, 2);
  });
});

// ---------------------------------------------------------------------------
describe('نگاشت خطا: پیام دیتابیس بیرون نمی‌رود (§78)', () => {
  test('کدهای شناخته‌شدهٔ PostgreSQL، خطای دامنه می‌شوند', () => {
    assert.equal(mapDatabaseError({ code: '23505' }).code, 'conflict');
    assert.equal(mapDatabaseError({ code: '23503' }).code, 'validation_failed');
    assert.equal(mapDatabaseError({ code: '23514' }).code, 'validation_failed');
    assert.equal(mapDatabaseError({ code: '42501' }).code, 'forbidden');
    assert.equal(mapDatabaseError({ code: 'P0002' }).code, 'not_found');
    assert.equal(mapDatabaseError({ code: '57014' }).code, 'timeout');
    assert.equal(mapDatabaseError({ code: '40001' }).code, 'service_unavailable');
    assert.equal(mapDatabaseError({ code: '42P01' }).code, 'internal_error');
  });

  test('خطای ناشناخته، جزئیات دیتابیس را بیرون نمی‌دهد', () => {
    const unknown = mapDatabaseError(new Error('relation "ops.secret_table" does not exist at character 42'));
    assert.equal(unknown.code, 'internal_error');
    assert.ok(!String(unknown.message).includes('secret_table'), 'نام جدول نباید در پیام باشد');
    assert.notEqual(unknown.details?.reason, 'relation_missing');
  });

  test('نقض یکتایی واقعی، conflict می‌شود', async () => {
    await assert.rejects(
      () =>
        dal.query(
          sql`insert into auth.permission (key, name_fa, category) values (${'business.create'}, ${'تکراری'}, ${'business'})`,
        ),
      (error) => error.code === 'conflict' && error.details?.reason === 'unique_violation',
    );
  });

  test('کلید بیرونی غایب، validation_failed می‌شود', async () => {
    await assert.rejects(
      () =>
        dal.query(
          sql`insert into app.business (slug, name, business_type_key, owner_user_id)
              values (${'ghost-shop'}, ${'کسب‌وکار بی‌نوع'}, ${'no_such_type'}, ${aliceId})`,
        ),
      (error) => error.code === 'validation_failed' && error.details?.reason === 'missing_reference',
    );
  });

  test('نقض RLS واقعی، forbidden می‌شود (نه خطای داخلی)', async () => {
    await assert.rejects(
      () => client.asRole('pv_public', () => dal.query(sql`insert into app.business (slug, name, business_type_key, owner_user_id) values (${'public-write'}, ${'نوشتن بی‌اجازه'}, ${'pet_shop'}, ${bobId})`)),
      (error) => error.code === 'forbidden',
      'نقش عمومی نباید بتواند کسب‌وکار بسازد',
    );
  });

  test('سلامت اتصال، برای مسیر ready', async () => {
    const health = await checkConnection(client);
    assert.equal(health.ok, true);
    assert.ok(health.serverTime);
  });
});

// ---------------------------------------------------------------------------
describe('رخداد و حسابرسی، در همان تراکنش (§23–۲۴، §93)', () => {
  test('رخداد با بازیگر و شناسهٔ درخواستِ زمینه ثبت می‌شود', async () => {
    const eventId = await withContext(
      client,
      { userId: aliceId, businessId: businessA, requestId: 'req-event-1' },
      (tx) => emitEvent(tx, { eventType: 'dal.probe', entityType: 'test', entityId: 'e-1', businessId: businessA, payload: { ok: true } }),
    );

    const [row] = await engine.query(`select actor_id, actor_type, request_id, payload from ops.event where id = $1`, [eventId]);
    assert.equal(String(row.actor_id), aliceId);
    assert.equal(String(row.actor_type), 'user');
    assert.equal(String(row.request_id), 'req-event-1');
    assert.equal(row.payload.ok, true);
  });

  test('جعل هویت، بازیگر را جدا ثبت می‌کند (§31)', async () => {
    const eventId = await withContext(
      client,
      { userId: bobId, businessId: businessB, impersonatedBy: aliceId, requestId: 'req-impersonate' },
      (tx) => emitEvent(tx, { eventType: 'dal.probe', entityType: 'test', entityId: 'e-2', businessId: businessB }),
    );

    const [row] = await engine.query(`select actor_id, actor_type from ops.event where id = $1`, [eventId]);
    assert.equal(String(row.actor_id), bobId, 'بازیگر، کاربری است که به‌جایش وارد شده‌اند');
    assert.equal(String(row.actor_type), 'impersonator');
  });

  test('رد حسابرسی با وضعیت پیش و پس ثبت می‌شود و ویرایش‌شدنی نیست', async () => {
    const auditId = await withContext(client, { userId: aliceId, businessId: businessA }, (tx) =>
      recordAudit(tx, {
        action: 'dal.audit_probe',
        entityType: 'test',
        entityId: 'e-3',
        businessId: businessA,
        before: { name: 'پیش' },
        after: { name: 'پس' },
        metadata: { reason: 'آزمون' },
      }),
    );

    const [row] = await engine.query(`select actor_id, before_state, after_state from ops.audit_log where id = $1`, [auditId]);
    assert.equal(String(row.actor_id), aliceId);
    assert.equal(row.before_state.name, 'پیش');
    assert.equal(row.after_state.name, 'پس');

    await assert.rejects(
      () => engine.query(`delete from ops.audit_log where id = $1`, [auditId]),
      /افزودنی|append/i,
      'حسابرسی سابقه است و حذف‌شدنی نیست',
    );
  });

  test('رخداد باید نام‌فضا داشته باشد؛ نام بی‌نقطه رد می‌شود', async () => {
    await assert.rejects(
      () => withContext(client, { userId: aliceId, businessId: businessA }, (tx) => emitEvent(tx, { eventType: 'probe', entityType: 'test', entityId: 'e-4' })),
      (error) => error.code !== undefined,
    );
  });
});
