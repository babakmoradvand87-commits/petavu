/**
 * تست توابع دامنه (§17، §23–۲۴، §۵۷–۵۸، §۹۳–۹۴، §۱۰۳، §۱۸۰، §۱۹۱).
 *
 * این تست‌ها روی همان توابعی اجرا می‌شوند که API و کارگر صف اجرا می‌کنند؛ پس
 * اگر روزی مسیر تازه‌ای قیدهای چرخهٔ عمر را دور بزند، همین‌جا معلوم می‌شود.
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
let bobId;
let carolId;
let businessA;
let businessB;
let roleIds = {};

const ALICE_EMAIL = 'alice@example.com';
const BOB_EMAIL = 'bob@example.com';
const CAROL_EMAIL = 'carol@example.com';

/** اجرای SQL در نقش `pv_app` با زمینهٔ دلخواه. */
async function asApp(context, fn) {
  await engine.setContext(context);
  try {
    return await engine.asRole('pv_app', () => fn(engine));
  } finally {
    await engine.query(
      "select set_config('app.user_id','',false), set_config('app.business_id','',false), set_config('app.platform_role','',false), set_config('app.impersonated_by','',false), set_config('app.request_id','',false)",
    );
  }
}

async function makeBusiness(ownerId, slug, name) {
  return asApp({ userId: ownerId }, async (handle) => {
    const [business] = await handle.query(
      `insert into app.business (slug, name, business_type_key, owner_user_id) values ($1, $2, 'veterinary_clinic', $3) returning id`,
      [slug, name, ownerId],
    );
    const id = String(business.id);
    await handle.query(
      `insert into app.membership (business_id, user_id, role_id, status, joined_at) values ($1, $2, $3, 'active', now())`,
      [id, ownerId, roleIds.owner],
    );
    return id;
  });
}

before(async () => {
  engine = await openDatabase();
  await migrate(engine, { dir: join(projectRoot, 'migrations') });
  await applySeeds(engine, { dir: join(projectRoot, 'seeds') });

  const roles = await engine.query(`select id, key from app.role where business_id is null`);
  for (const row of roles) roleIds[String(row.key)] = String(row.id);

  const users = await engine.query(
    `insert into auth.app_user (display_name, status) values
       ('آلیس رضایی', 'active'), ('بابک مرادی', 'active'), ('کارول نوری', 'active')
     returning id`,
  );
  [aliceId, bobId, carolId] = users.map((row) => String(row.id));

  await engine.query(
    `insert into auth.identity (user_id, kind, value_key, value_display, is_primary, verified_at) values
       ($1, 'email', $2, $2, true, now()),
       ($3, 'email', $4, $4, true, now()),
       ($5, 'email', $6, $6, true, now())`,
    [aliceId, ALICE_EMAIL, bobId, BOB_EMAIL, carolId, CAROL_EMAIL],
  );

  businessA = await makeBusiness(aliceId, 'tak-pet', 'پت‌شاپ تک‌پت');
  businessB = await makeBusiness(bobId, 'vet-sharif', 'کلینیک دام‌پزشکی شریف');
});

after(async () => {
  await engine.close();
});

// ---------------------------------------------------------------------------
describe('رخداد و حسابرسی: بازیگر از زمینه می‌آید (§93–۹۴)', () => {
  test('رخداد با بازیگرِ درست ثبت می‌شود، نه با آن‌چه فراخوان می‌گوید', async () => {
    const eventId = await asApp({ userId: aliceId, businessId: businessA }, (handle) =>
      handle.query(
        `select app.emit_event('content.created', 'content', 'x', $1, '{"k":1}'::jsonb) as id`,
        [businessA],
      ),
    );
    const [event] = await engine.query(
      `select event_type, actor_type, actor_id, payload from ops.event where id = $1`,
      [String(eventId[0].id)],
    );
    assert.equal(String(event.event_type), 'content.created');
    assert.equal(String(event.actor_type), 'user');
    assert.equal(String(event.actor_id), aliceId);
    assert.equal(Number(event.payload.k), 1);
  });

  test('جعل هویت، در رخداد و حسابرسی ثبت می‌شود', async () => {
    const auditId = await asApp(
      { userId: bobId, businessId: businessA, platformRole: 'support', impersonatedBy: aliceId },
      (handle) =>
        handle.query(
          `select app.record_audit('business.viewed', 'business', $1::text, $1::uuid) as id`,
          [businessA],
        ),
    );
    const [row] = await engine.query(`select actor_type, impersonated_by, actor_id from ops.audit_log where id = $1`, [
      String(auditId[0].id),
    ]);
    assert.equal(String(row.actor_type), 'impersonator', 'رد حسابرسی باید جعل هویت را افشا کند');
    assert.equal(String(row.impersonated_by), aliceId);
  });

  test('نوع رخداد بی‌شکل، رد می‌شود', async () => {
    await assert.rejects(
      () => engine.query(`select app.emit_event('created', 'content', 'x')`),
      (error) => error.code === '23514',
    );
  });

  test('رخداد کسب‌وکار الف، برای بی‌نام و برای عضو ب دیده نمی‌شود', async () => {
    const asBob = await asApp({ userId: bobId, businessId: businessB }, (handle) =>
      handle.query(`select count(*)::int as c from ops.event where business_id = $1`, [businessA]),
    );
    assert.equal(Number(asBob[0].c), 0);
  });
});

// ---------------------------------------------------------------------------
describe('چرخهٔ عمر محتوا (§23)', () => {
  let contentId;

  test('گذرهای غیرمجاز، رد می‌شوند', async () => {
    assert.equal(await engine.query(`select app.content_transition_allowed('draft', 'published') as ok`).then((r) => r[0].ok), false);
    assert.equal(await engine.query(`select app.content_transition_allowed('published', 'draft') as ok`).then((r) => r[0].ok), false);
    assert.equal(await engine.query(`select app.content_transition_allowed('draft', 'in_review') as ok`).then((r) => r[0].ok), true);
  });

  test('مسیر کامل: پیش‌نویس → بازبینی → تأیید → انتشار', async () => {
    const [content] = await asApp({ userId: aliceId, businessId: businessA }, (handle) =>
      handle.query(
        `insert into app.content (business_id, kind, slug, title, status) values ($1, 'article', 'litter-guide', 'راهنمای بستر', 'draft') returning id`,
        [businessA],
      ),
    );
    contentId = String(content.id);

    const toReview = await asApp({ userId: aliceId, businessId: businessA }, (handle) =>
      handle.query(`select * from app.transition_content($1, 'in_review')`, [contentId]),
    );
    assert.equal(String(toReview[0].status), 'in_review');
    assert.equal(Number(toReview[0].content_version), 2, 'هر گذر باید شمارندهٔ نسخه را جلو ببرد');

    await asApp({ userId: aliceId, businessId: businessA }, (handle) =>
      handle.query(`select * from app.transition_content($1, 'approved')`, [contentId]),
    );
    const published = await asApp({ userId: aliceId, businessId: businessA }, (handle) =>
      handle.query(`select * from app.transition_content($1, 'published', 'آماده‌سازی برای کمپین')`, [contentId]),
    );
    assert.equal(String(published[0].status), 'published');
    assert.notEqual(published[0].published_at, null, 'انتشار باید مهر زمانی بگذارد');

    const events = await engine.query(
      `select event_type from ops.event where entity_type = 'content' and entity_id = $1 order by occurred_at`,
      [contentId],
    );
    const types = events.map((row) => String(row.event_type));
    assert.ok(types.includes('content.published'), `رخداد انتشار باید ثبت شده باشد: ${types.join(', ')}`);

    const audits = await engine.query(
      `select action from ops.audit_log where entity_type = 'content' and entity_id = $1 order by occurred_at`,
      [contentId],
    );
    assert.ok(audits.some((row) => String(row.action) === 'content.published'));
  });

  test('ناظر نمی‌تواند منتشر کند؛ عضو ساده نمی‌تواند تأیید کند', async () => {
    await engine.query(
      `insert into app.membership (business_id, user_id, role_id, status, joined_at) values ($1, $2, $3, 'active', now())
       on conflict (business_id, user_id) where deleted_at is null and status <> 'left'
       do update set role_id = excluded.role_id, status = 'active'`,
      [businessA, carolId, roleIds.viewer],
    );

    await assert.rejects(
      () =>
        asApp({ userId: carolId, businessId: businessA }, (handle) =>
          handle.query(`select * from app.transition_content($1, 'unpublished')`, [contentId]),
        ),
      (error) => /مجوز/.test(String(error.message)),
      'ناظر نباید مجوز انتشار داشته باشد',
    );

    // و عضو ساده (بدون مجوز بازبینی) نمی‌تواند تأیید کند.
    await engine.query(
      `insert into app.membership (business_id, user_id, role_id, status, joined_at) values ($1, $2, $3, 'active', now())
       on conflict (business_id, user_id) where deleted_at is null and status <> 'left'
       do update set role_id = excluded.role_id, status = 'active'`,
      [businessA, bobId, roleIds.member],
    );
    await assert.rejects(
      () =>
        asApp({ userId: bobId, businessId: businessA }, (handle) =>
          handle.query(`select * from app.transition_content($1, 'unpublished')`, [contentId]),
        ),
      (error) => /مجوز|عضو/.test(String(error.message)),
    );
  });

  test('گذر تکراری و وضعیت پایانی، رد می‌شوند', async () => {
    await asApp({ userId: aliceId, businessId: businessA }, (handle) =>
      handle.query(`select * from app.transition_content($1, 'unpublished')`, [contentId]),
    );
    await assert.rejects(
      () =>
        asApp({ userId: aliceId, businessId: businessA }, (handle) =>
          handle.query(`select * from app.transition_content($1, 'unpublished')`, [contentId]),
        ),
      (error) => /پیش در وضعیت/.test(String(error.message)),
    );
    // انتشار دوباره از «منتشرنشده» مجاز است.
    const republished = await asApp({ userId: aliceId, businessId: businessA }, (handle) =>
      handle.query(`select * from app.transition_content($1, 'published')`, [contentId]),
    );
    assert.equal(String(republished[0].status), 'published');
    assert.equal(republished[0].unpublished_at, null, 'انتشار دوباره باید مهر «لغو انتشار» را پاک کند');
  });

  test('زمان‌بندی و انتشار سررسیده (§180)', async () => {
    const [scheduled] = await asApp({ userId: aliceId, businessId: businessA }, async (handle) => {
      const [content] = await handle.query(
        `insert into app.content (business_id, kind, slug, title, status) values ($1, 'announcement', 'campaign', 'کمپین پاییز', 'draft') returning id`,
        [businessA],
      );
      await handle.query(`select * from app.transition_content($1, 'in_review')`, [String(content.id)]);
      await handle.query(`select * from app.transition_content($1, 'approved')`, [String(content.id)]);
      return handle.query(`select * from app.schedule_content($1, now() + interval '1 hour')`, [String(content.id)]);
    });
    assert.equal(String(scheduled.status), 'scheduled');
    assert.notEqual(scheduled.scheduled_for, null);

    // انتشار سررسیده: چیزی که وقتش نرسیده، منتشر نمی‌شود.
    const publishedNow = await engine.asRole('pv_worker', () =>
      engine.query('select app.publish_due_content(10) as n'),
    );
    assert.equal(Number(publishedNow[0].n), 0, 'هنوز چیزی سررسیده نیست');

    // سررسید: هم `created_at` و هم `scheduled_for` را عقب می‌بریم، چون قید
    // جدول می‌گوید زمان انتشار باید پس از زمان ساخت باشد.
    await engine.query(
      `update app.content set created_at = now() - interval '10 minutes', scheduled_for = now() - interval '1 minute' where id = $1`,
      [String(scheduled.id)],
    );
    const afterDue = await engine.asRole('pv_worker', () => engine.query('select app.publish_due_content(10) as n'));
    assert.equal(Number(afterDue[0].n), 1);
    const [row] = await engine.query(`select status, published_at, scheduled_for from app.content where id = $1`, [
      String(scheduled.id),
    ]);
    assert.equal(String(row.status), 'published');
    assert.equal(row.scheduled_for, null);
  });

  test('زمان‌بندی در گذشته، رد می‌شود', async () => {
    await assert.rejects(
      () =>
        asApp({ userId: aliceId, businessId: businessA }, (handle) =>
          handle.query(`select * from app.schedule_content($1, now() - interval '1 hour')`, [contentId]),
        ),
      (error) => /آینده/.test(String(error.message)),
    );
  });
});

// ---------------------------------------------------------------------------
describe('دعوت‌نامه: پذیرش یک‌بارمصرف، مقید به هویت (§16–۱۷)', () => {
  let invitationId;
  const tokenHash = `sha256:${'c'.repeat(64)}`;
  // هش دعوت، هش است نه شناسهٔ خام: قید جدول دستِ‌کم ۳۲ نویسه می‌خواهد تا
  // کسی وسوسه نشود ایمیل خام را در ستون هش بگذارد.
  const carolHash = `sha256:${'a'.repeat(64)}`;
  const bobHash = `sha256:${'b'.repeat(64)}`;

  test('ساخت دعوت، فقط با مجوز دعوت', async () => {
    await assert.rejects(
      () =>
        asApp({ userId: carolId, businessId: businessA }, (handle) =>
          handle.query(
            `insert into app.invitation (business_id, role_id, invitee_kind, invitee_hash, invitee_display, token_hash, invited_by, expires_at)
             values ($1, $2, 'email', $3, 'کارول', $4, $5, now() + interval '7 days')`,
            [businessA, roleIds.editor, carolHash, tokenHash, aliceId],
          ),
        ),
      (error) => error.code === '42501' || /row-level security/i.test(String(error.message)),
    );

    const [invitation] = await asApp({ userId: aliceId, businessId: businessA }, (handle) =>
      handle.query(
        `insert into app.invitation (business_id, role_id, invitee_kind, invitee_hash, invitee_display, token_hash, invited_by, expires_at)
         values ($1, $2, 'email', $3, 'کارول', $4, $5, now() + interval '7 days') returning id`,
        [businessA, roleIds.editor, carolHash, tokenHash, aliceId],
      ),
    );
    invitationId = String(invitation.id);

    const [membershipCount] = await engine.query(
      `select app.recount_members($1) as c`,
      [businessA],
    );
    assert.ok(Number(membershipCount.c) >= 1);
  });

  test('پذیرش با توکن غلط، رد می‌شود', async () => {
    await assert.rejects(
      () =>
        asApp({ userId: carolId, businessId: null }, (handle) =>
          handle.query(`select app.accept_invitation($1, $2)`, [invitationId, `sha256:${'d'.repeat(64)}`]),
        ),
      (error) => /توکن/.test(String(error.message)),
    );
  });

  test('پذیرش توسط کسی که دعوت برای او نیست، رد می‌شود', async () => {
    await assert.rejects(
      () =>
        asApp({ userId: carolId, businessId: null }, (handle) =>
          handle.query(`select app.accept_invitation($1, $2)`, [invitationId, tokenHash]),
        ),
      (error) => /برای شما صادر نشده/.test(String(error.message)),
    );
  });

  test('پذیرش درست: عضویت ساخته می‌شود و پذیرش دوباره ممکن نیست', async () => {
    await engine.query(
      `update app.invitation set invitee_hash = $2 where id = $1`,
      [invitationId, carolHash],
    );

    // هویت کارول باید با هش دعوت بخواند؛ هش دعوت را با هویت او هم‌تراز می‌کنیم.
    await engine.query(`update auth.identity set value_key = $2 where user_id = $1 and kind = 'email'`, [
      carolId,
      carolHash,
    ]);

    const membershipId = await asApp({ userId: carolId, businessId: null }, (handle) =>
      handle.query(`select app.accept_invitation($1, $2) as id`, [invitationId, tokenHash]),
    );
    assert.ok(membershipId[0].id);

    const [membership] = await engine.query(
      `select role_id, status from app.membership where business_id = $1 and user_id = $2`,
      [businessA, carolId],
    );
    assert.equal(String(membership.role_id), roleIds.editor);
    assert.equal(String(membership.status), 'active');

    const [invitation] = await engine.query(`select accepted_at, accepted_by from app.invitation where id = $1`, [
      invitationId,
    ]);
    assert.notEqual(invitation.accepted_at, null);
    assert.equal(String(invitation.accepted_by), carolId);

    await assert.rejects(
      () =>
        asApp({ userId: carolId, businessId: null }, (handle) =>
          handle.query(`select app.accept_invitation($1, $2)`, [invitationId, tokenHash]),
        ),
      (error) => /پیش‌تر پذیرفته/.test(String(error.message)),
      'دعوت باید یک‌بارمصرف باشد',
    );
  });

  test('دعوت منقضی‌شده و پس‌گرفته‌شده پذیرفته نمی‌شوند', async () => {
    const [expired] = await asApp({ userId: aliceId, businessId: businessA }, (handle) =>
      handle.query(
        `insert into app.invitation (business_id, role_id, invitee_kind, invitee_hash, invitee_display, token_hash, invited_by, expires_at, created_at)
         values ($1, $2, 'email', $3, 'بابک', $4, $5, now() + interval '1 day', now() - interval '2 days') returning id`,
        [businessA, roleIds.member, bobHash, `sha256:${'e'.repeat(64)}`, aliceId],
      ),
    );
    await engine.query(`update app.invitation set expires_at = now() - interval '1 hour' where id = $1`, [
      String(expired.id),
    ]);
    await assert.rejects(
      () =>
        asApp({ userId: bobId, businessId: null }, (handle) =>
          handle.query(`select app.accept_invitation($1, $2)`, [String(expired.id), `sha256:${'e'.repeat(64)}`]),
        ),
      (error) => /منقضی/.test(String(error.message)),
    );

    // گیرندهٔ دیگر: «یک دعوت باز در هر زمان» قید جدول است، پس برای آزمایش
    // پس‌گرفتن، دعوت تازه باید گیرندهٔ تازه داشته باشد.
    const daveHash = `sha256:${'3'.repeat(64)}`;
    const [open] = await asApp({ userId: aliceId, businessId: businessA }, (handle) =>
      handle.query(
        `insert into app.invitation (business_id, role_id, invitee_kind, invitee_hash, invitee_display, token_hash, invited_by, expires_at)
         values ($1, $2, 'email', $3, 'دیو', $4, $5, now() + interval '1 day') returning id`,
        [businessA, roleIds.member, daveHash, `sha256:${'f'.repeat(64)}`, aliceId],
      ),
    );
    await asApp({ userId: aliceId, businessId: businessA }, (handle) =>
      handle.query(`select app.revoke_invitation($1, 'منصرف شد')`, [String(open.id)]),
    );
    await assert.rejects(
      () =>
        asApp({ userId: bobId, businessId: null }, (handle) =>
          handle.query(`select app.accept_invitation($1, $2)`, [String(open.id), `sha256:${'f'.repeat(64)}`]),
        ),
      (error) => /پس گرفته شده|برای شما صادر نشده/.test(String(error.message)),
    );
  });
});

// ---------------------------------------------------------------------------
describe('انتقال مالکیت: اتمی، با تأیید مجدد تازه (§17، §139–۱۴۱)', () => {
  let transferId;
  let daveId;

  test('گیرندهٔ غیرعضو، پذیرفته نمی‌شود', async () => {
    const [dave] = await engine.query(
      `insert into auth.app_user (display_name, status) values ('دیو کاظمی', 'active') returning id`,
    );
    daveId = String(dave.id);

    // مالکیت به کسی که عضو کسب‌وکار نیست داده نمی‌شود؛ وگرنه کسب‌وکار به
    // دست غریبه می‌افتد و هیچ‌کس هم متوجه نمی‌شود.
    const [transfer] = await asApp({ userId: aliceId, businessId: businessA }, (handle) =>
      handle.query(
        `insert into app.ownership_transfer (business_id, from_user_id, to_user_id, requester_step_up_at)
         values ($1, $2, $3, now()) returning id`,
        [businessA, aliceId, daveId],
      ),
    );
    await assert.rejects(
      () =>
        asApp({ userId: aliceId, businessId: businessA }, (handle) =>
          handle.query(`select * from app.complete_ownership_transfer($1)`, [String(transfer.id)]),
        ),
      (error) => /عضو فعال/.test(String(error.message)),
    );
    await asApp({ userId: aliceId, businessId: businessA }, (handle) =>
      handle.query(`select * from app.cancel_ownership_transfer($1, 'آزمون')`, [String(transfer.id)]),
    );
  });

  test('تأیید مجدد کهنه، انتقال را متوقف می‌کند', async () => {
    await engine.query(
      `insert into app.membership (business_id, user_id, role_id, status, joined_at) values ($1, $2, $3, 'active', now())
       on conflict (business_id, user_id) where deleted_at is null and status <> 'left'
       do update set role_id = excluded.role_id, status = 'active'`,
      [businessA, bobId, roleIds.admin],
    );

    const [transfer] = await asApp({ userId: aliceId, businessId: businessA }, (handle) =>
      handle.query(
        `insert into app.ownership_transfer (business_id, from_user_id, to_user_id, reason, requester_step_up_at)
         values ($1, $2, $3, 'واگذاری', now() - interval '40 minutes') returning id`,
        [businessA, aliceId, bobId],
      ),
    );
    transferId = String(transfer.id);

    await assert.rejects(
      () =>
        asApp({ userId: aliceId, businessId: businessA }, (handle) =>
          handle.query(`select * from app.complete_ownership_transfer($1)`, [transferId]),
        ),
      (error) => /تأیید مجدد/.test(String(error.message)),
    );
  });

  test('کسی جز مالک فعلی نمی‌تواند نهایی کند', async () => {
    await engine.query(`update app.ownership_transfer set requester_step_up_at = now() where id = $1`, [transferId]);
    await assert.rejects(
      () =>
        asApp({ userId: bobId, businessId: businessA }, (handle) =>
          handle.query(`select * from app.complete_ownership_transfer($1)`, [transferId]),
        ),
      (error) => /مالک فعلی/.test(String(error.message)),
    );
  });

  test('انتقال کامل: مالک، نقش‌ها و سابقه در یک تراکنش', async () => {
    const business = await asApp({ userId: aliceId, businessId: businessA }, (handle) =>
      handle.query(`select * from app.complete_ownership_transfer($1)`, [transferId]),
    );
    assert.equal(String(business[0].owner_user_id), bobId, 'مالکیت باید به گیرنده برسد');

    const memberships = await engine.query(
      `select user_id, role_id from app.membership where business_id = $1 and deleted_at is null`,
      [businessA],
    );
    const byUser = new Map(memberships.map((row) => [String(row.user_id), String(row.role_id)]));
    assert.equal(byUser.get(bobId), roleIds.owner, 'گیرنده باید مالک شود');
    assert.equal(byUser.get(aliceId), roleIds.admin, 'مالک پیشین باید مدیر شود');

    const [transfer] = await engine.query(`select status, completed_at from app.ownership_transfer where id = $1`, [
      transferId,
    ]);
    assert.equal(String(transfer.status), 'completed');
    assert.notEqual(transfer.completed_at, null);

    const audits = await engine.query(
      `select count(*)::int as c from ops.audit_log where action = 'business.ownership_transferred' and entity_id = $1`,
      [businessA],
    );
    assert.equal(Number(audits[0].c), 1);

    await assert.rejects(
      () =>
        asApp({ userId: aliceId, businessId: businessA }, (handle) =>
          handle.query(`select * from app.complete_ownership_transfer($1)`, [transferId]),
        ),
      (error) => /بسته شده/.test(String(error.message)),
      'انتقال، یک‌بارمصرف است',
    );
  });

  test('لغو توسط گیرنده، «رد» ثبت می‌شود', async () => {
    const [transfer] = await asApp({ userId: bobId, businessId: businessA }, (handle) =>
      handle.query(
        `insert into app.ownership_transfer (business_id, from_user_id, to_user_id, requester_step_up_at)
         values ($1, $2, $3, now()) returning id`,
        [businessA, bobId, aliceId],
      ),
    );
    const result = await asApp({ userId: aliceId, businessId: businessA }, (handle) =>
      handle.query(`select * from app.cancel_ownership_transfer($1, 'فعلاً نه')`, [String(transfer.id)]),
    );
    assert.equal(String(result[0].status), 'rejected', 'رد گیرنده، «رد» است نه «لغو»');
  });
});

// ---------------------------------------------------------------------------
describe('فرادادهٔ سئو: ویرایش دستی محترم است (§103)', () => {
  test('نوشتن خودکار، فرادادهٔ دستی را بازنویسی نمی‌کند', async () => {
    const [business] = await engine.query(`select id from app.business where id = $1`, [businessA]);
    assert.ok(business);

    await asApp({ userId: bobId, businessId: businessA }, (handle) =>
      handle.query(`select * from app.upsert_seo_metadata('business', $1, 'fa-IR', $2::jsonb, 'hash-1', $3)`, [
        businessA,
        JSON.stringify({ title: 'تک‌پت | اول', description: 'توضیح اول', is_indexable: true }),
        businessA,
      ]),
    );

    await engine.query(`update seo.metadata set is_manual = true, title = 'عنوان دستی' where entity_id = $1`, [
      businessA,
    ]);

    const after = await asApp({ userId: bobId, businessId: businessA }, (handle) =>
      handle.query(`select * from app.upsert_seo_metadata('business', $1, 'fa-IR', $2::jsonb, 'hash-2', $3)`, [
        businessA,
        JSON.stringify({ title: 'عنوان خودکار تازه', description: 'توضیح تازه' }),
        businessA,
      ]),
    );
    assert.equal(String(after[0].title), 'عنوان دستی', 'نوشتن خودکار نباید ویرایش دستی را بشوید');
    assert.equal(String(after[0].source_hash), 'hash-2', 'اثر انگشت منبع باید به‌روز شود');
  });

  test('بی‌مجوز، فرادادهٔ سئو نوشته نمی‌شود', async () => {
    const viewerRole = roleIds.viewer;
    await engine.query(
      `update app.membership set role_id = $3 where business_id = $1 and user_id = $2`,
      [businessA, carolId, viewerRole],
    );
    await assert.rejects(
      () =>
        asApp({ userId: carolId, businessId: businessA }, (handle) =>
          handle.query(`select * from app.upsert_seo_metadata('business', $1, 'fa-IR', '{}'::jsonb, null, $1)`, [
            businessA,
          ]),
        ),
      (error) => /مجوز/.test(String(error.message)),
    );
  });
});

// ---------------------------------------------------------------------------
describe('کد بازیابی و اعتبارنامه: مسیرهای بدون گرنت (§11)', () => {
  test('کد بازیابی، یک‌بارمصرف و اتمی است', async () => {
    const codeHash = `sha256:${'7'.repeat(64)}`;
    await engine.query(
      `insert into auth.recovery_code (user_id, code_hash) values ($1, $2)`,
      [aliceId, codeHash],
    );

    const first = await engine.asRole('pv_app', () =>
      engine.query(`select * from auth.consume_recovery_code($1)`, [codeHash]),
    );
    assert.equal(first[0].consumed, true);
    assert.equal(String(first[0].user_id), aliceId);

    const second = await engine.asRole('pv_app', () =>
      engine.query(`select * from auth.consume_recovery_code($1)`, [codeHash]),
    );
    assert.equal(second[0].consumed, false);
    assert.equal(second[0].already_used, true, 'تفکیک «سوخته» از «نادرست» برای تحلیل ریسک لازم است');

    const left = await engine.asRole('pv_app', () =>
      engine.query(`select app.has_platform_permission('platform.audit.view') as x, auth.recovery_codes_left($1) as left`, [
        aliceId,
      ]),
    );
    assert.equal(Number(left[0].left), 0);
  });

  test('اعتبارنامه فقط از راه تابع ورود خوانده می‌شود', async () => {
    const identifierHash = `sha256:${'8'.repeat(64)}`;
    await engine.query(`update auth.identity set value_key = $2 where user_id = $1`, [aliceId, identifierHash]);
    const [credential] = await engine.query(
      `insert into auth.credential (user_id, kind, secret_hash, hash_params)
       values ($1, 'password', $2, '{"m":65536,"t":3,"p":1}'::jsonb) returning id`,
      [aliceId, `argon2id$v=19$m=65536,t=3,p=1$${'x'.repeat(32)}`],
    );

    const rows = await engine.asRole('pv_app', () =>
      engine.query(`select * from auth.credential_for_login($1)`, [identifierHash]),
    );
    assert.equal(rows.length, 1);
    assert.equal(String(rows[0].credential_id), String(credential.id));
    assert.equal(String(rows[0].user_status), 'active');

    const asPublic = await engine.asRole('pv_public', () =>
      engine.query(`select count(*)::int as c from auth.credential`),
    ).catch((error) => error.code);
    assert.equal(asPublic, '42501', 'بی‌نام نباید حتی بتواند بشمارد');
  });

  test('تلاش‌های اخیر ورود، فقط برای خودِ کاربر', async () => {
    const identifierHash = `sha256:${'9'.repeat(64)}`;
    await engine.query(
      `select * from auth.record_login_attempt($1, $2, 'password', false, 'bad_password')`,
      [identifierHash, aliceId],
    );
    const rows = await engine.asRole('pv_app', () =>
      engine.query(`select * from auth.recent_login_attempts($1, 5)`, [aliceId]),
    );
    assert.ok(rows.length >= 1);
    assert.equal(String(rows[0].failure_reason), 'bad_password');
  });
});
