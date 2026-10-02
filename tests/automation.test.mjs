/**
 * تست موتور خودکارسازی (Addendum §56–۷۲، §74، §91–۹۵، §100؛ §106، §180).
 *
 * این تست روی همان SQL واقعی اجرا می‌شود که در تولید اجرا می‌شود (§102): قاعده،
 * ارزیابی شرط، اجرای کنش، سقف‌ها، صف، وبهوک و اعلان — همه با همان توابع و همان
 * RLS. چیزی شبیه‌سازی نشده است.
 *
 * سه چیز اینجا سنجیده می‌شود که «خودکارسازی» بی آن‌ها فقط یک وعده است:
 *   ۱. قاعده = داده است، نه کد؛ و کنش‌های مجاز بسته‌اند (§74).
 *   ۲. هر قاعده، هر رخداد را یک‌بار اجرا می‌کند — حتی با دو کارگر و دو بار
 *      پردازش (§180).
 *   ۳. سقف‌ها (زمان انتظار، سقف روزانه، دامنهٔ کسب‌وکار) در پایگاه‌داده
 *      اعمال می‌شوند، نه در کد.
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

const asOwner = (fn) => asRole('pv_app', { userId: aliceId, businessId: businessA }, fn);
const asWorker = (fn) => asRole('pv_worker', null, fn);

/** ساخت رخداد تازه با payload دلخواه؛ از همان مسیر واقعی رخدادها. */
async function emit(type, { businessId = businessA, payload = {}, actorId = aliceId } = {}) {
  const rows = await asRole('pv_app', { userId: actorId, businessId }, (handle) =>
    handle.query(`select app.emit_event($1, 'test_entity', 'e-1', $2, $3::jsonb) as id`, [
      type,
      businessId,
      JSON.stringify(payload),
    ]),
  );
  return String(rows[0].id);
}

async function makeRule(overrides = {}) {
  const row = {
    key: `test.${Math.random().toString(36).slice(2, 10)}`,
    nameFa: 'قاعدهٔ آزمون',
    eventType: 'test.event',
    conditions: { all: [] },
    actions: [],
    status: 'active',
    businessId: businessA,
    cooldownSeconds: 0,
    maxRunsPerDay: 0,
    dryRun: false,
    ...overrides,
  };
  const rows = await engine.query(
    `insert into ops.automation_rule
       (business_id, key, name_fa, event_type, conditions, actions, status, cooldown_seconds, max_runs_per_day, dry_run)
     values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10)
     returning id`,
    [
      row.businessId,
      row.key,
      row.nameFa,
      row.eventType,
      JSON.stringify(row.conditions),
      JSON.stringify(row.actions),
      row.status,
      row.cooldownSeconds,
      row.maxRunsPerDay,
      row.dryRun,
    ],
  );
  return String(rows[0].id);
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
describe('شرط‌ها: عملگرهای بسته، بی SQL پویا (Addendum §74)', () => {
  const data = { order: { total: 7500000, items: 3, tags: ['urgent', 'vip'] }, note: '' };

  test('عملگرهای عددی، متنی و عضویت، همان چیزی را می‌دهند که قاعده می‌گوید', async () => {
    const check = async (condition) => {
      const rows = await engine.query(`select ops.condition_matches($1::jsonb, $2::jsonb) as ok`, [
        JSON.stringify(condition),
        JSON.stringify(data),
      ]);
      return rows[0].ok === true;
    };

    assert.equal(await check({ path: 'order.total', op: 'gt', value: 5000000 }), true);
    assert.equal(await check({ path: 'order.total', op: 'gt', value: 9000000 }), false);
    assert.equal(await check({ path: 'order.total', op: 'lte', value: 7500000 }), true);
    assert.equal(await check({ path: 'order.items', op: 'eq', value: 3 }), true);
    assert.equal(await check({ path: 'order.status', op: 'exists' }), false, 'کلید غایب، «هست» نیست');
    assert.equal(await check({ path: 'order.status', op: 'not_exists' }), true);
    assert.equal(await check({ path: 'order.total', op: 'in', value: [7500000, 1] }), true, 'in: مقدار عددی در فهرست');
    assert.equal(await check({ path: 'order.total', op: 'not_in', value: [1, 2] }), true);
    assert.equal(await check({ path: 'order.tags', op: 'any_of', value: ['vip', 'cold'] }), true, 'any_of: آرایه، اشتراک دارد');
    assert.equal(await check({ path: 'order.tags', op: 'all_of', value: ['urgent', 'vip'] }), true);
    assert.equal(await check({ path: 'order.tags', op: 'none_of', value: ['cold'] }), true);
    assert.equal(await check({ path: 'order.tags', op: 'contains', value: ['urgent'] }), true);
    assert.equal(await check({ path: 'note', op: 'empty' }), true, 'رشتهٔ خالی، «خالی» است');
    assert.equal(await check({ path: 'order.items', op: 'gte', value: 'سه' }), false, 'مقایسهٔ نامتوافق، درست نیست');
  });

  test('عملگر ناشناخته، «نمی‌دانم» است نه «درست»', async () => {
    const rows = await engine.query(`select ops.condition_matches($1::jsonb, $2::jsonb) as ok`, [
      JSON.stringify({ path: 'order.total', op: 'eval_jsonata', value: '$ > 1' }),
      JSON.stringify(data),
    ]);
    assert.equal(rows[0].ok, false, 'عملگر ناشناخته باید رد شود، نه اینکه بگذرد');
  });

  test('all / any / not روی مجموعهٔ شرط‌ها اعمال می‌شود', async () => {
    const matches = async (conditions) => {
      const rows = await engine.query(
        `select ops.rule_matches(r, $2::jsonb) as ok from ops.automation_rule r where r.id = $1`,
        [await makeRule({ conditions }), JSON.stringify(data)],
      );
      return rows[0].ok === true;
    };

    assert.equal(
      await matches({ all: [{ path: 'order.items', op: 'gt', value: 2 }, { path: 'order.total', op: 'gt', value: 1000 }] }),
      true,
    );
    assert.equal(
      await matches({ all: [{ path: 'order.items', op: 'gt', value: 9 }, { path: 'order.total', op: 'gt', value: 1000 }] }),
      false,
      'همهٔ شرط‌های all باید برقرار باشند',
    );
    assert.equal(await matches({ any: [{ path: 'order.items', op: 'gt', value: 9 }, { path: 'note', op: 'empty' }] }), true);
    assert.equal(await matches({ not: [{ path: 'note', op: 'empty' }] }), false);
  });
});

// ---------------------------------------------------------------------------
describe('قاعدهٔ متناظر: WHEN→IF→THEN (Addendum §56–۷۲)', () => {
  test('قاعدهٔ فعال، کنش notify را اجرا می‌کند؛ اعلان به گیرندهٔ رخداد می‌رسد', async () => {
    const ruleId = await makeRule({
      eventType: 'order.placed',
      conditions: { all: [{ path: 'total', op: 'gte', value: 5000000 }] },
      actions: [
        {
          type: 'notify',
          user_path: 'buyer_id',
          kind: 'order.high_value',
          severity: 'warning',
          title: 'سفارش بزرگ ثبت شد',
          action_path: '/panel/orders',
        },
      ],
    });

    const eventId = await emit('order.placed', { payload: { total: 9000000, buyer_id: aliceId } });
    const summary = await asWorker((handle) => handle.query(`select ops.process_event($1) as s`, [eventId]));

    assert.equal(summary[0].s.succeeded, 1, 'یک قاعده باید موفق اجرا شود');

    const notifications = await asOwner((handle) =>
      handle.query(`select title, kind, severity, action_path, rule_id from ops.notification where correlation_id = $1`, [
        eventId,
      ]),
    );
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].title, 'سفارش بزرگ ثبت شد');
    assert.equal(notifications[0].severity, 'warning');
    assert.equal(String(notifications[0].rule_id), ruleId);
    assert.equal(notifications[0].action_path, '/panel/orders', 'کنش‌پذیری اعلان بخشی از خودش است');

    const runs = await engine.query(`select status, duration_ms from ops.automation_run where rule_id = $1`, [ruleId]);
    assert.equal(runs[0].status, 'succeeded');
    assert.ok(runs[0].duration_ms !== null, 'مدت اجرا باید ثبت شود (پایش)');

    const audit = await engine.query(
      `select action from ops.audit_log where action = 'automation.rule_run' and entity_id = $1`,
      [ruleId],
    );
    assert.ok(audit.length >= 1, 'اجرای قاعده باید در حسابرسی بماند');
  });

  test('شرط برقرار نشد ⇒ قاعدهٔ درست، اجرا نمی‌شود (و دلیلش ثبت است)', async () => {
    const ruleId = await makeRule({
      eventType: 'order.placed',
      conditions: { all: [{ path: 'total', op: 'gte', value: 50000000 }] },
      actions: [{ type: 'notify', user_path: 'buyer_id', title: 'نباید بیاید' }],
    });

    const eventId = await emit('order.placed', { payload: { total: 1000, buyer_id: aliceId } });
    await asWorker((handle) => handle.query(`select ops.process_event($1)`, [eventId]));

    const runs = await engine.query(`select status, skip_reason from ops.automation_run where rule_id = $1`, [ruleId]);
    assert.equal(runs[0].status, 'skipped');
    assert.equal(runs[0].skip_reason, 'condition_not_met');

    const notifications = await engine.query(`select id from ops.notification where rule_id = $1`, [ruleId]);
    assert.equal(notifications.length, 0, 'قاعدهٔ اجرانشده نباید اعلان بسازد');
  });

  test('قاعدهٔ کسب‌وکار، روی رخداد کسب‌وکار دیگر اثر ندارد (دامنه)', async () => {
    const ruleId = await makeRule({
      eventType: 'order.placed',
      businessId: businessB,
      actions: [{ type: 'notify', recipient: 'business_owner', title: 'سفارش کسب‌وکار دیگر' }],
    });

    const eventId = await emit('order.placed', { businessId: businessA, payload: { buyer_id: aliceId } });
    await asWorker((handle) => handle.query(`select ops.process_event($1)`, [eventId]));

    const runs = await engine.query(`select status, skip_reason from ops.automation_run where rule_id = $1`, [ruleId]);
    assert.equal(runs[0].skip_reason, 'scope_mismatch', 'دامنهٔ کسب‌وکار بخشی از تصمیم است');
  });

  test('قاعدهٔ خاموش، هرگز اجرا نمی‌شود', async () => {
    const ruleId = await makeRule({
      eventType: 'order.placed',
      status: 'paused',
      actions: [{ type: 'notify', user_path: 'buyer_id', title: 'قاعدهٔ خاموش' }],
    });

    const eventId = await emit('order.placed', { payload: { buyer_id: aliceId } });
    await asWorker((handle) => handle.query(`select ops.process_event($1)`, [eventId]));

    const runs = await engine.query(`select status, skip_reason from ops.automation_run where rule_id = $1`, [ruleId]);
    assert.equal(runs[0].skip_reason, 'rule_paused');
  });

  test('آزمون خشک: کنش برنامه‌ریزی می‌شود، ولی اجرا نمی‌شود', async () => {
    const ruleId = await makeRule({
      eventType: 'order.placed',
      dryRun: true,
      actions: [{ type: 'notify', user_path: 'buyer_id', title: 'در آزمون خشک' }],
    });

    const eventId = await emit('order.placed', { payload: { buyer_id: aliceId } });
    await asWorker((handle) => handle.query(`select ops.process_event($1)`, [eventId]));

    const runs = await engine.query(`select status, actions_result from ops.automation_run where rule_id = $1`, [ruleId]);
    assert.equal(runs[0].status, 'dry_run');
    assert.equal(Number(runs[0].actions_result[0].planned), 1, 'آزمون خشک باید بگوید چه چیزی *می‌شد*');

    const notifications = await engine.query(`select id from ops.notification where rule_id = $1`, [ruleId]);
    assert.equal(notifications.length, 0, 'آزمون خشک نباید اثر واقعی بسازد');
  });

  test('کنش ناشناخته اجرا نمی‌شود؛ اجرا شکست‌خورده ثبت می‌شود (§74)', async () => {
    const ruleId = await makeRule({
      eventType: 'order.placed',
      actions: [
        { type: 'run_sql', sql: 'delete from app.business' },
        { type: 'notify', user_path: 'buyer_id', title: 'کنش مجاز' },
      ],
    });

    const eventId = await emit('order.placed', { payload: { buyer_id: aliceId } });
    await asWorker((handle) => handle.query(`select ops.process_event($1)`, [eventId]));

    const runs = await engine.query(`select status, actions_result from ops.automation_run where rule_id = $1`, [ruleId]);
    assert.equal(runs[0].status, 'failed', 'کنش غیرمجاز، اجرا را «موفق» نمی‌کند');
    const rejected = runs[0].actions_result.find((item) => item.ok === false);
    assert.equal(rejected.reason, 'action_not_allowed');

    const businesses = await engine.query(`select count(*)::int as n from app.business`);
    assert.ok(businesses[0].n >= 2, 'هیچ کسب‌وکاری حذف نشده است');
  });

  test('کنش enqueue_job کار را در صف می‌گذارد، با کلید یکتایی', async () => {
    const ruleId = await makeRule({
      eventType: 'order.placed',
      actions: [{ type: 'enqueue_job', kind: 'email.order_receipt', dedupe_key: 'receipt-once' }],
    });

    const eventId = await emit('order.placed', { payload: { buyer_id: aliceId } });
    await asWorker((handle) => handle.query(`select ops.process_event($1)`, [eventId]));

    const jobs = await engine.query(`select kind, payload, business_id from ops.job where kind = 'email.order_receipt'`);
    assert.equal(jobs.length, 1, 'یک کار، نه دو');
    assert.equal(String(jobs[0].business_id), businessA, 'دامنهٔ کسب‌وکار به کار ارث می‌رسد');
    assert.equal(String(jobs[0].payload.event_id), eventId, 'هم‌بستگی با رخداد در خود کار هست');
    void ruleId;
  });

  test('کنش webhook روی مقصد ثبت‌شدهٔ کسب‌وکار تحویل می‌سازد', async () => {
    await asOwner((handle) =>
      handle.query(
        `insert into ops.webhook_endpoint (business_id, key, url, secret_ref, event_types)
         values ($1, 'crm', 'https://crm.example.com/petavu', 'crm-token', array['order.placed'])`,
        [businessA],
      ),
    );

    await makeRule({ eventType: 'order.placed', actions: [{ type: 'webhook' }], key: 'test.webhook_rule' });
    const eventId = await emit('order.placed', { payload: { buyer_id: aliceId } });
    await asWorker((handle) => handle.query(`select ops.process_event($1)`, [eventId]));

    const deliveries = await engine.query(
      `select d.event_type, d.status, e.url from ops.webhook_delivery d join ops.webhook_endpoint e on e.id = d.endpoint_id where d.event_id = $1`,
      [eventId],
    );
    assert.equal(deliveries.length, 1, 'یک تحویل برای یک مقصد مشترک');
    assert.equal(deliveries[0].event_type, 'order.placed');
    assert.equal(deliveries[0].url, 'https://crm.example.com/petavu');
  });
});

// ---------------------------------------------------------------------------
describe('یک‌بار و فقط یک‌بار (§180، §106)', () => {
  test('اجرای دوبارهٔ همان قاعده روی همان رخداد، اثر دوم نمی‌سازد', async () => {
    const ruleId = await makeRule({
      eventType: 'member.joined',
      actions: [{ type: 'notify', user_path: 'user_id', title: 'خوش آمدید' }],
    });

    const eventId = await emit('member.joined', { payload: { user_id: aliceId } });
    await asWorker((handle) => handle.query(`select ops.process_event($1)`, [eventId]));

    await assert.rejects(
      () => asWorker((handle) => handle.query(`select * from ops.run_rule($1, $2)`, [ruleId, eventId])),
      (error) => error.code === '23505' || /پیش‌تر/.test(error.message),
      'اجرای دوباره باید صریحاً رد شود، نه بی‌صدا تکرار',
    );

    const notifications = await engine.query(`select id from ops.notification where rule_id = $1`, [ruleId]);
    assert.equal(notifications.length, 1, 'اعلان باید یکی بماند');
  });

  test('پردازش دوبارهٔ رخداد (کارگر پس از قطعی) بی‌اثر است', async () => {
    const ruleId = await makeRule({
      eventType: 'content.published',
      actions: [{ type: 'notify', user_path: 'actor', title: 'انتشار' }],
    });

    const eventId = await emit('content.published', { payload: { actor: aliceId } });
    const first = await asWorker((handle) => handle.query(`select ops.process_event($1) as s`, [eventId]));
    const second = await asWorker((handle) => handle.query(`select ops.process_event($1) as s`, [eventId]));

    assert.equal(first[0].s.succeeded, 1);
    assert.equal(second[0].s.already_done, 1, 'بار دوم باید «قبلاً انجام شده» بدهد');
    assert.equal(second[0].s.succeeded ?? 0, 0, 'بار دوم نباید اجرای موفق تازه بسازد');

    const notifications = await engine.query(`select id from ops.notification where rule_id = $1`, [ruleId]);
    assert.equal(notifications.length, 1, 'اثر دوباره ممنوع');
  });

  test('دو کارگر هم‌زمان: فقط یکی تصاحب می‌کند', async () => {
    const ruleId = await makeRule({
      eventType: 'design.published',
      actions: [{ type: 'notify', user_path: 'actor', title: 'انتشار طراحی' }],
    });
    const eventId = await emit('design.published', { payload: { actor: aliceId } });

    const results = await Promise.allSettled([
      asWorker((handle) => handle.query(`select * from ops.run_rule($1, $2)`, [ruleId, eventId])),
      asWorker((handle) => handle.query(`select * from ops.run_rule($1, $2)`, [ruleId, eventId])),
    ]);
    const fulfilled = results.filter((item) => item.status === 'fulfilled');
    assert.equal(fulfilled.length, 1, 'تصاحب باید یک برنده داشته باشد');

    const notifications = await engine.query(`select id from ops.notification where rule_id = $1`, [ruleId]);
    assert.equal(notifications.length, 1, 'و بازنده نباید هیچ کنشی اجرا کرده باشد');
  });

  test('اجرای نیمه‌کاره، صریحاً شکست‌خورده علامت می‌خورد و در پایش دیده می‌شود', async () => {
    const eventId = await emit('ops.stuck', { payload: { actor: aliceId } });
    const [rule] = await engine.query(
      `insert into ops.automation_rule (business_id, key, name_fa, event_type, status, actions)
       values ($1, 'test.stuck', 'قاعدهٔ نیمه‌کاره', 'ops.stuck', 'active', '[]'::jsonb) returning id`,
      [businessA],
    );

    // تصاحب، بی‌آنکه کنشی اجرا شود: همان وضعیتی که «کارگر در میان کار مُرد».
    await engine.query(
      `insert into ops.automation_run (rule_id, event_id, event_type, business_id, status, started_at)
       values ($1, $2, 'ops.stuck', $3, 'matched', now() - interval '30 minutes')`,
      [String(rule.id), eventId, businessA],
    );

    const healthBefore = await engine.query(`select ops.automation_health($1) as h`, [businessA]);
    assert.equal(Number(healthBefore[0].h.stuck_runs), 1, 'اجرای نیمه‌کاره باید شمرده شود');

    const reclaimed = await asWorker((handle) =>
      handle.query(`select ops.reclaim_stale_runs('15 minutes') as n`, []),
    );
    assert.equal(Number(reclaimed[0].n), 1);

    const after = await engine.query(`select status, error from ops.automation_run where rule_id = $1`, [String(rule.id)]);
    assert.equal(after[0].status, 'failed');
    assert.ok(after[0].error.includes('نیمه‌کاره'));
  });
});

// ---------------------------------------------------------------------------
describe('سقف‌ها: در پایگاه‌داده، نه در کد (Addendum §56–۷۲)', () => {
  test('دورهٔ انتظار، اجرای پی‌درپی را می‌بندد', async () => {
    const ruleId = await makeRule({
      eventType: 'rate.limited',
      cooldownSeconds: 3600,
      actions: [{ type: 'notify', user_path: 'actor', title: 'دورهٔ انتظار' }],
    });

    const first = await emit('rate.limited', { payload: { actor: aliceId } });
    const second = await emit('rate.limited', { payload: { actor: aliceId } });

    await asWorker((handle) => handle.query(`select ops.process_event($1)`, [first]));
    await asWorker((handle) => handle.query(`select ops.process_event($1)`, [second]));

    const runs = await engine.query(
      `select event_id, status, skip_reason from ops.automation_run where rule_id = $1 order by started_at`,
      [ruleId],
    );
    assert.equal(runs.length, 2);
    assert.equal(runs[1].skip_reason, 'cooldown', 'رخداد دوم در دورهٔ انتظار باید رد شود');
    assert.equal(String(runs[1].event_id), second, 'و رد شدن باید به همان رخداد دوم نسبت داده شود');
  });

  test('سقف روزانه، پس از پر شدن، اجرا را متوقف می‌کند', async () => {
    const ruleId = await makeRule({
      eventType: 'cap.test',
      maxRunsPerDay: 2,
      actions: [{ type: 'notify', user_path: 'actor', title: 'سقف روزانه' }],
    });

    for (let index = 0; index < 3; index += 1) {
      const eventId = await emit('cap.test', { payload: { actor: aliceId } });
      await asWorker((handle) => handle.query(`select ops.process_event($1)`, [eventId]));
    }

    const runs = await engine.query(
      `select status, skip_reason from ops.automation_run where rule_id = $1 order by started_at`,
      [ruleId],
    );
    const succeeded = runs.filter((row) => row.status === 'succeeded').length;
    const capped = runs.filter((row) => row.skip_reason === 'daily_cap').length;
    assert.equal(succeeded, 2, 'دقیقاً به اندازهٔ سقف اجرا شود');
    assert.equal(capped, 1, 'اجرای سوم باید با دلیل روشن رد شود');
  });
});

// ---------------------------------------------------------------------------
describe('دسترسی: قاعده و اعلان، دادهٔ خصوصی است (§14–۱۷)', () => {
  test('غیرعضو، قاعده‌های کسب‌وکار را نمی‌بیند و نمی‌سازد', async () => {
    await makeRule({ eventType: 'privacy.check', actions: [] });

    const visible = await asRole('pv_app', { userId: bobId, businessId: businessB }, (handle) =>
      handle.query(`select count(*)::int as n from ops.automation_rule where business_id = $1`, [businessA]),
    );
    assert.equal(visible[0].n, 0, 'قاعدهٔ کسب‌وکار دیگر نباید دیده شود');

    await assert.rejects(
      () =>
        asRole('pv_app', { userId: bobId, businessId: businessB }, (handle) =>
          handle.query(
            `insert into ops.automation_rule (business_id, key, name_fa, event_type, actions)
             values ($1, 'sneaky.rule', 'نفوذی', 'x.y', '[]'::jsonb)`,
            [businessA],
          ),
        ),
      (error) => /row-level security|policy/.test(String(error.message)) || error.code === '42501',
      'ساخت قاعده در کسب‌وکار دیگر باید رد شود',
    );
  });

  test('اعلان، فقط برای گیرندهٔ خودش خوانده می‌شود', async () => {
    const ruleId = await makeRule({
      eventType: 'notify.privacy',
      actions: [{ type: 'notify', user_path: 'user_id', title: 'فقط برای آلیس' }],
    });
    const eventId = await emit('notify.privacy', { payload: { user_id: aliceId } });
    await asWorker((handle) => handle.query(`select ops.process_event($1)`, [eventId]));

    const alice = await asOwner((handle) => handle.query(`select count(*)::int as n from ops.notification where rule_id = $1`, [ruleId]));
    const bob = await asRole('pv_app', { userId: bobId, businessId: businessB }, (handle) =>
      handle.query(`select count(*)::int as n from ops.notification where rule_id = $1`, [ruleId]),
    );

    assert.equal(alice[0].n, 1, 'گیرنده باید اعلان خودش را ببیند');
    assert.equal(bob[0].n, 0, 'دیگری نباید ببیند');
  });

  test('اجرای خودکارسازی، کار کارگر است نه کار درخواست کاربر', async () => {
    const eventId = await emit('permission.check', { payload: {} });
    await assert.rejects(
      () => asOwner((handle) => handle.query(`select ops.process_event($1)`, [eventId])),
      (error) => /permission denied/.test(String(error.message)) || error.code === '42501',
      'pv_app نباید بتواند رخداد را پردازش کند',
    );
  });

  test('قاعدهٔ خاموشِ صف‌شده، کنش غیرمجاز را روی داده اجرا نمی‌کند', async () => {
    // قاعده‌ای که کنشش «وب‌هوک» است ولی مقصدی ثبت نشده: اجرا موفق است، تحویل صفر.
    await makeRule({ eventType: 'no.endpoint', actions: [{ type: 'webhook' }], key: 'test.no_endpoint' });
    const eventId = await emit('no.endpoint', { payload: {} });
    const summary = await asWorker((handle) => handle.query(`select ops.process_event($1) as s`, [eventId]));
    assert.equal(summary[0].s.succeeded, 1, 'نبود مقصد، شکست قاعده نیست');

    const deliveries = await engine.query(
      `select count(*)::int as n from ops.webhook_delivery where event_id = $1`,
      [eventId],
    );
    assert.equal(deliveries[0].n, 0);
  });
});

// ---------------------------------------------------------------------------
describe('پایش خودکارسازی (Addendum §91–۹۵)', () => {
  test('سلامت، شمار قاعده، اجرا، شکست و رخداد معطل‌مانده را می‌دهد', async () => {
    const health = await engine.query(`select ops.automation_health($1) as h`, [businessA]);
    const value = health[0].h;

    assert.ok(Number(value.rules) >= 1);
    assert.ok(Number(value.active_rules) >= 1);
    assert.ok(Number(value.runs_24h) >= 1);
    assert.ok(Number(value.failures_24h) >= 1, 'کنش غیرمجاز باید در شمار شکست‌ها بیاید');
    assert.equal(typeof value.pending_events, 'number');
  });

  test('قاعدهٔ سیستمی seed حاضر است و نگهبان دروازهٔ انتشار است', async () => {
    const rows = await engine.query(
      `select key, event_type, status, is_system from ops.automation_rule where key = 'platform.publish_gate_guard'`,
    );
    assert.equal(rows.length, 1, 'قاعدهٔ سیستمی باید از seed آمده باشد');
    assert.equal(rows[0].is_system, true);
    assert.equal(rows[0].status, 'paused', 'نگهبان تا پایان گام‌های بعدی، خاموش می‌ماند');
  });
});
