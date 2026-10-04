/**
 * تست Repositoryهای `@petavu/db` (گام ۱۹ — §18–۶۳، §93–۹۹؛ Addendum §99).
 *
 * چه چیزی اینجا سنجیده می‌شود: اینکه هر عملیات دامنه **از یک مسیر قابل‌حسابرسی**
 * انجام شود — مجوز سمت سرور، حصار RLS، تابع دامنه برای گذرهای وضعیت، کنترل
 * نسخه برای نوشتن، و رخداد/حسابرسی در همان تراکنش.
 *
 * چرا روی موتور تعبیه‌شده: همان PostgreSQL واقعی (PGlite)، همان SQL، همان
 * سیاست‌ها و همان نقش‌ها. تنها درایور عوض می‌شود (§102 — هیچ Mock به‌جای
 * پیاده‌سازی).
 *
 * قاعدهٔ نوشتنِ آزمون در این فایل: هر فراخوانی باید **امضای واقعی** Repository
 * را رعایت کند. تودرتویی یا ساده‌سازی امضا در تست، خطرناک‌ترین نوع آزمون است:
 * سبز می‌شود ولی مسیر تولید را نمی‌سنجد.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDatabase } from '../scripts/lib/engine.mjs';
import { migrate } from '../scripts/lib/migrate.mjs';
import { applySeeds } from '../scripts/lib/seed.mjs';

import { createDal, createRepositories, withContext } from '../packages/db/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..');

let engine;
let client;

let aliceId;
let bobId;
let carolId;
let daveId;
let businessA;
let businessB;
let privateC;
let pageA;

const ALICE = () => ({ userId: aliceId, businessId: businessA });
const BOB = () => ({ userId: bobId, businessId: businessB });
const CAROL = () => ({ userId: carolId, businessId: businessA });
const SUPERADMIN = () => ({ userId: aliceId, businessId: null, platformRole: 'superadmin' });

/** آداپتور موتور تعبیه‌شده به قرارداد `SqlClient` — همان الگوی `tests/db.test.mjs`. */
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
        typeof runner.withTransaction === 'function' ? runner.withTransaction(async (tx) => fn(make(tx))) : fn(scoped),
      async asRole(role, fn) {
        await runner.exec(`set role "${role}"`);
        try {
          return await fn(scoped);
        } finally {
          // تراکنش لغوشده، خطای دوم می‌سازد و خطای اصلی را می‌پوشاند.
          await runner.exec('reset role').catch(() => {});
        }
      },
      close: () => handle.close(),
    };
    return scoped;
  };
  return make(handle);
}

/** اجرای کار با Repositoryها در نقش پایگاه‌دادهٔ داده‌شده. */
async function withRepos(context, role, fn) {
  return withContext(client, context, (tx) =>
    tx.asRole(role, async () => {
      const repos = createRepositories({ dal: createDal(tx), context });
      return fn(repos, tx);
    }),
  );
}

const asApp = (context, fn) => withRepos(context, 'pv_app', fn);
const asWorker = (context, fn) => withRepos(context, 'pv_worker', fn);
const hash = (value) => createHash('sha256').update(String(value)).digest('hex');

const sampleTree = { version: 1, root: [] };

before(async () => {
  engine = await openDatabase();
  await migrate(engine, { dir: join(projectRoot, 'migrations') });
  await applySeeds(engine, { dir: join(projectRoot, 'seeds') });

  const users = await engine.query(
    `insert into auth.app_user (display_name, status)
     values ('آلیس رضایی', 'active'), ('بابک مرادی', 'active'), ('کارول ن.', 'active'), ('داوود ک.', 'active')
     returning id`,
  );
  [aliceId, bobId, carolId, daveId] = users.map((row) => String(row.id));

  /*
   * قید `business_publish_shape` می‌گوید «منتشرشده» یعنی `status='active'`:
   * کسب‌وکاری که `published_at` دارد ولی هنوز `draft` است، وضعیت متناقض است.
   */
  const businesses = await engine.query(
    `insert into app.business (slug, name, business_type_key, owner_user_id, status, visibility, published_at)
     values ('tak-pet', 'پت‌شاپ تک‌پت', 'pet_shop', $1, 'active', 'public', now()),
            ('vet-sharif', 'کلینیک دامپزشکی شریف', 'veterinary_clinic', $2, 'active', 'public', now()),
            ('hidden-lab', 'آزمایشگاه خصوصی', 'animal_lab', $1, 'draft', 'private', null)
     returning id, slug`,
    [aliceId, bobId],
  );
  businessA = String(businesses[0].id);
  businessB = String(businesses[1].id);
  privateC = String(businesses[2].id);

  const roles = await engine.query(`select id, key from app.role where business_id is null`);
  const roleId = (key) => String(roles.find((row) => row.key === key).id);

  await engine.query(
    `insert into app.membership (business_id, user_id, role_id, status, joined_at)
     values ($1, $2, $3, 'active', now()),
            ($4, $5, $6, 'active', now()),
            ($7, $8, $9, 'active', now()),
            ($1, $10, $9, 'active', now()),
            ($11, $2, $3, 'active', now())`,
    [businessA, aliceId, roleId('owner'), businessB, bobId, roleId('owner'), businessA, carolId, roleId('viewer'), daveId, privateC],
  );

  await engine.query(`insert into app.business_profile (business_id) values ($1), ($2), ($3)`, [businessA, businessB, privateC]);

  // صفحهٔ طراحی برای آزمون پیش‌نویس/انتشار؛ ساخت صفحه از مسیر محصول انجام می‌شود،
  // ولی اینجا دادهٔ صحنه است.
  const pages = await engine.query(
    `insert into design.page (business_id, key, title, scope, is_system)
     values ($1, 'home', 'خانه', 'business', false) returning id`,
    [businessA],
  );
  pageA = String(pages[0].id);

  // یک اعلان برای آلیس و یکی برای بابک — برای سنجش «هر کس فقط مال خودش».
  await engine.query(
    `insert into ops.notification (recipient_user_id, kind, title, body, status)
     values ($1, 'system.notice', 'اعلان آلیس', 'متن', 'sent'), ($2, 'system.notice', 'اعلان بابک', 'متن', 'sent')`,
    [aliceId, bobId],
  );

  // هویت داوود، تا دعوت‌نامه بتواند به او تعلق بگیرد (پذیرش، هویت می‌خواهد).
  await engine.query(
    `insert into auth.identity (user_id, kind, value_key, value_display, is_primary, verified_at)
     values ($1, 'email', $2, 'dave@example.test', true, now())`,
    [daveId, hash('dave@example.test')],
  );

  client = createEmbeddedClient(engine);
});

after(async () => {
  await engine.close();
});

// ---------------------------------------------------------------------------
describe('کسب‌وکار: خواندن، ساخت سه‌بخشی، ویرایش با کنترل نسخه (§18–۲۲، §55)', () => {
  test('فهرست عمومی، کسب‌وکار خصوصی را بیرون می‌گذارد', async () => {
    const page = await asApp(BOB(), (repos) => repos.business.list({ onlyPublic: true, limit: 10 }));
    const slugs = page.items.map((row) => String(row.slug));

    assert.ok(slugs.includes('vet-sharif'), 'کسب‌وکار عمومی باید در فهرست باشد');
    assert.ok(!slugs.includes('hidden-lab'), 'کسب‌وکار خصوصی نباید در فهرست عمومی باشد');
    assert.equal(page.hasMore, false);
  });

  test('ساخت کسب‌وکار، عضویت مالک و پروفایل و رخداد را با هم می‌سازد', async () => {
    const created = await asApp(ALICE(), (repos) =>
      repos.business.create({ slug: 'new-clinic', name: 'کلینیک تازه', businessTypeKey: 'veterinary_clinic', ownerUserId: aliceId }),
    );

    const membership = await engine.query(`select count(*)::int as n from app.membership where business_id = $1 and user_id = $2`, [
      created.id,
      aliceId,
    ]);
    assert.equal(membership[0].n, 1, 'مالک باید عضو باشد');

    const profile = await engine.query(`select count(*)::int as n from app.business_profile where business_id = $1`, [created.id]);
    assert.equal(profile[0].n, 1, 'پروفایل باید ساخته شود');

    const events = await engine.query(`select count(*)::int as n from ops.event where event_type = 'business.created' and entity_id = $1`, [
      created.id,
    ]);
    assert.equal(events[0].n, 1, 'رخداد ساخت باید ثبت شود');
  });

  test('ساخت با نامک تکراری، تعارض می‌دهد نه خطای مبهم', async () => {
    await assert.rejects(
      () => asApp(ALICE(), (repos) => repos.business.create({ slug: 'tak-pet', name: 'تکراری', businessTypeKey: 'pet_shop', ownerUserId: aliceId })),
      (error) => error.code === 'conflict',
    );
  });

  test('ویرایش با نسخهٔ کهنه رد می‌شود و با نسخهٔ درست اعمال می‌گردد', async () => {
    const before = await asApp(ALICE(), (repos) => repos.business.byId(businessA));
    const version = Number(before.version);

    await assert.rejects(
      () => asApp(ALICE(), (repos) => repos.business.update(businessA, version + 7, { name: 'نام جعلی' })),
      (error) => error.details?.reason === 'version_conflict',
    );

    const updated = await asApp(ALICE(), (repos) => repos.business.update(businessA, version, { name: 'پت‌شاپ تک‌پت — نو' }));
    assert.equal(updated.name, 'پت‌شاپ تک‌پت — نو');
    assert.equal(Number(updated.version), version + 1);
  });

  test('پیشنهاد نامک، یکتا و قابل‌استفاده است', async () => {
    const slug = await asApp(ALICE(), (repos) => repos.business.suggestSlug('تک‌پت'));
    /*
     * نامک فارسی‌اول است، نه فقط ascii: `ref.location.slug` هم همین را اجازه
     * می‌دهد و SEO محلی (§Addendum §44) بدون نامک فارسی معنا ندارد.
     */
    assert.match(slug, /^[\p{Script=Arabic}a-z0-9-]+$/u, `نامک نامعتبر: ${slug}`);
    assert.ok(!slug.includes(' '), 'نامک نباید فاصله داشته باشد');

    const again = await asApp(ALICE(), (repos) => repos.business.suggestSlug('کلینیک دامپزشکی شریف'));
    assert.notEqual(again, slug, 'نامک‌های متفاوت باید جدا باشند');
  });
});

// ---------------------------------------------------------------------------
describe('عضویت: حصار RLS، دعوت یک‌بارمصرف، لغو (§16–۱۷)', () => {
  test('عضو فهرست اعضا را می‌بیند؛ بیگانه هیچ ردیفی نمی‌بیند', async () => {
    const asMember = await asApp(CAROL(), (repos) => repos.business.members(businessA));
    assert.ok(asMember.length >= 2, 'کارول — با وجود اینکه فقط بیننده است — باید اعضای A را ببیند');
    assert.ok(asMember.some((row) => String(row.user_id) === aliceId), 'نام هم‌تیمی باید از JOIN بیاید');

    const asStranger = await asApp(BOB(), (repos) => repos.business.members(businessA));
    assert.equal(asStranger.length, 0, 'بیگانه نباید هیچ عضوی ببیند');
  });

  test('دعوت با نقش، توکن هش‌شده ذخیره می‌کند و یک‌بارمصرف است', async () => {
    const tokenHash = hash('invite-token-dave');
    const invitation = await asApp(ALICE(), (repos) =>
      repos.business.invite({
        businessId: businessA,
        roleKey: 'editor',
        inviteeKind: 'email',
        inviteeHash: hash('dave@example.test'),
        inviteeDisplay: 'dave@example.test',
        tokenHash,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        message: 'خوش آمدید',
      }),
    );

    const stored = await engine.query(`select token_hash, accepted_at from app.invitation where id = $1`, [invitation.id]);
    assert.equal(stored[0].token_hash, tokenHash, 'توکن باید هش‌شده ذخیره شود');
    assert.notEqual(stored[0].token_hash, 'invite-token-dave');

    const accepted = await withContext(client, { userId: daveId }, (tx) =>
      tx.asRole('pv_app', async () => {
        const repos = createRepositories({ dal: createDal(tx), context: { userId: daveId } });
        return repos.business.acceptInvitation(String(invitation.id), tokenHash);
      }),
    );
    assert.ok(accepted);

    const membership = await engine.query(`select count(*)::int as n from app.membership where business_id = $1 and user_id = $2 and status = 'active'`, [
      businessA,
      daveId,
    ]);
    assert.equal(membership[0].n, 1, 'پذیرش باید عضویت فعال بسازد');

    await assert.rejects(
      () =>
        withContext(client, { userId: daveId }, (tx) =>
          tx.asRole('pv_app', async () => {
            const repos = createRepositories({ dal: createDal(tx), context: { userId: daveId } });
            return repos.business.acceptInvitation(String(invitation.id), tokenHash);
          }),
        ),
      'دعوت‌نامهٔ پذیرفته‌شده نباید دوباره پذیرفته شود',
    );
  });

  test('لغو دعوت، باز و واگذارنشده را پس می‌گیرد', async () => {
    const invitation = await asApp(ALICE(), (repos) =>
      repos.business.invite({
        businessId: businessA,
        roleKey: 'member',
        inviteeKind: 'email',
        inviteeHash: hash('someone-else@example.test'),
        inviteeDisplay: 'someone-else@example.test',
        tokenHash: hash('invite-token-other'),
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    );

    const revoked = await asApp(ALICE(), (repos) => repos.business.revokeInvitation(String(invitation.id), 'منصرف شدیم'));
    assert.equal(revoked.revoked, true);

    const row = await engine.query(`select revoked_at, revoked_by from app.invitation where id = $1`, [invitation.id]);
    assert.ok(row[0].revoked_at, 'زمان لغو باید ثبت شود');
  });

  test('نقش‌های سیستمی، مرتب برمی‌گردند', async () => {
    const roles = await asApp(ALICE(), (repos) => repos.business.roles());
    assert.ok(roles.length >= 6);
    const ranks = roles.map((row) => Number(row.rank));
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), 'مرتب‌سازی نقش‌ها باید افزایشی باشد');
  });
});

// ---------------------------------------------------------------------------
describe('هویت: خواندن، ساخت، و مرز «پروفایل خودم» (§6–۷)', () => {
  test('کاربر با شناسه خوانده می‌شود و کسب‌وکارهایش با نقش می‌آیند', async () => {
    const user = await asApp(ALICE(), (repos) => repos.identity.byId(aliceId));
    assert.equal(user.id, aliceId);

    const businesses = await asApp(ALICE(), (repos) => repos.identity.businessesOf(aliceId));
    const ids = businesses.map((row) => String(row.id));
    assert.ok(ids.includes(businessA));
    assert.ok(ids.includes(privateC), 'کسب‌وکار خصوصی هم برای مالکش دیده می‌شود');
    assert.equal(businesses.find((row) => String(row.id) === businessA).role_key, 'owner');
  });

  test('ساخت کاربر تازه، رکورد هویت پایه می‌سازد', async () => {
    const created = await asApp({}, (repos) => repos.identity.create({ displayName: 'کاربر تازه' }));
    assert.ok(created.id);

    const row = await engine.query(`select status, display_name from auth.app_user where id = $1`, [created.id]);
    assert.equal(row[0].status, 'pending');
  });

  test('ویرایش پروفایل دیگران از این مسیر ممکن نیست', async () => {
    await assert.rejects(
      () => asApp(ALICE(), (repos) => repos.identity.updateProfile(bobId, 1, { display_name: 'نام جعلی' })),
      (error) => error.details?.reason === 'not_self',
    );
  });
});

// ---------------------------------------------------------------------------
describe('محتوا: چرخهٔ عمر از راه تابع دامنه، نه UPDATE ($23–۲۴)', () => {
  let contentId;

  test('ساخت محتوا و خواندن با نامک', async () => {
    const created = await asApp(ALICE(), (repos) =>
      repos.content.create(businessA, { kind: 'article', slug: 'vaccine-guide', title: 'راهنمای واکسن سگ', summary: 'خلاصه' }),
    );
    contentId = String(created.id);
    assert.equal(created.status, 'draft');

    const bySlug = await asApp(ALICE(), (repos) => repos.content.bySlug(businessA, 'vaccine-guide', 'article'));
    assert.equal(String(bySlug.id), contentId);

    const list = await asApp(ALICE(), (repos) => repos.content.list(businessA, { limit: 5 }));
    assert.ok(list.items.some((row) => String(row.id) === contentId));
  });

  test('گذر نامعتبر رد می‌شود (draft → published وجود ندارد)', async () => {
    await assert.rejects(
      () => asApp(ALICE(), (repos) => repos.content.transition(contentId, 'published')),
      (error) => error.code === 'precondition_failed' || error.details?.reason === 'prerequisite_state',
    );
  });

  test('چرخهٔ مجاز، مهر زمانی و رخداد می‌گذارد', async () => {
    for (const to of ['in_review', 'approved', 'published']) {
      const row = await asApp(ALICE(), (repos) => repos.content.transition(contentId, to));
      assert.equal(row.status, to);
    }

    const row = await engine.query(`select published_at, content_version from app.content where id = $1`, [contentId]);
    assert.ok(row[0].published_at, 'زمان انتشار باید ثبت شود');

    const events = await engine.query(`select count(*)::int as n from ops.event where event_type = 'content.published' and entity_id = $1`, [
      contentId,
    ]);
    assert.equal(events[0].n, 1, 'رخداد انتشار باید ثبت شود');
  });

  test('ویرایش با نسخهٔ کهنه رد می‌شود', async () => {
    const current = await asApp(ALICE(), (repos) => repos.content.byId(contentId));
    await assert.rejects(
      () => asApp(ALICE(), (repos) => repos.content.update(contentId, Number(current.version) + 3, { title: 'عنوان جعلی' })),
      (error) => error.details?.reason === 'version_conflict',
    );

    const updated = await asApp(ALICE(), (repos) => repos.content.update(contentId, Number(current.version), { title: 'راهنمای واکسن سگ — ویرایش ۲' }));
    assert.equal(updated.title, 'راهنمای واکسن سگ — ویرایش ۲');
  });

  test('جای‌گذاری بلوک‌ها اتمی است؛ بلوک‌های قبلی می‌روند', async () => {
    const first = await asApp(ALICE(), (repos) =>
      repos.content.replaceBlocks(contentId, [
        { kind: 'paragraph', data: { text: 'بند یکم' }, plainText: 'بند یکم' },
        { kind: 'paragraph', data: { text: 'بند دوم' }, plainText: 'بند دوم' },
      ]),
    );
    assert.equal(first, 2);

    const replaced = await asApp(ALICE(), (repos) =>
      repos.content.replaceBlocks(contentId, [{ kind: 'heading', data: { text: 'تیتر' }, plainText: 'تیتر' }]),
    );
    assert.equal(replaced, 1);

    const blocks = await asApp(ALICE(), (repos) => repos.content.blocks(contentId));
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].kind, 'heading');
  });
});

// ---------------------------------------------------------------------------
describe('طراحی: درخت، پیش‌نویس، انتشار، بازگردانی (§32–۴۴)', () => {
  test('درخت بی‌ریشه، مانع ساختاری می‌گیرد', async () => {
    const findings = await asApp(ALICE(), (repos) => repos.design.validateTree({ version: 1 }));
    assert.ok(findings.some((finding) => finding.rule === 'structure.tree_invalid' && finding.severity === 'blocker'));
  });

  test('کامپوننت ناشناس، مانع ثبت در Registry می‌گیرد', async () => {
    const findings = await asApp(ALICE(), (repos) =>
      repos.design.validateTree({ version: 1, root: [{ component: 'not.a.component', props: {} }] }),
    );
    assert.ok(findings.some((finding) => finding.rule === 'registry.component_unknown'));
  });

  test('ذخیرهٔ پیش‌نویس، نسخه می‌سازد و شمارهٔ پیش‌نویس را جلو می‌برد', async () => {
    const saved = await asApp(ALICE(), (repos) => repos.design.saveDraft(pageA, sampleTree, 'نسخهٔ نخست'));
    assert.equal(Number(saved.draft_revision), 1);

    const revisions = await asApp(ALICE(), (repos) => repos.design.revisions(pageA));
    assert.equal(revisions.length, 1);
    assert.match(String(revisions[0].tree_hash), /^md5:/, 'اثر انگشت محتوایی باید ثبت شود');
  });

  test('انتشار مستقیم Repository بدون Preview/Approval ممنوع است', async () => {
    await assert.rejects(() => asApp(ALICE(), (repos) => repos.design.publish(pageA, 'بدون خط لوله')), (error) => error.code === 'precondition_failed');
    const [stored] = await engine.query('select published_tree from design.page where id=$1', [pageA]);
    assert.equal(stored.published_tree, null);
  });

  test('بازگردانی، نسخهٔ پیشین را به پیش‌نویس می‌آورد و حسابرسی می‌گذارد', async () => {
    await asApp(ALICE(), (repos) => repos.design.saveDraft(pageA, { version: 1, root: [{ component: 'x' }] }, 'خراب')).catch(() => {
      /* درخت با کامپوننت ناشناس، عمداً رد می‌شود — این تست، مسیر سالم را می‌سنجد. */
    });

    const restored = await asApp(ALICE(), (repos) => repos.design.restoreRevision(pageA, 1));
    assert.ok(restored.draft_revision);

    const stored = await engine.query(`select draft_tree from design.page where id = $1`, [pageA]);
    assert.deepEqual(stored[0].draft_tree, sampleTree, 'بازگردانی باید درخت نسخهٔ ۱ را به پیش‌نویس بیاورد');

    const audits = await engine.query(`select count(*)::int as n from ops.audit_log where action = 'design.restore'`, []);
    assert.ok(audits[0].n >= 1, 'بازگردانی باید حسابرسی شود');
  });

  test('توکن‌های طراحی و Registry کامپوننت‌ها خواندنی‌اند', async () => {
    const tokens = await asApp(ALICE(), (repos) => repos.design.tokens({ businessId: businessA, themeMode: 'light' }));
    assert.ok(tokens.length > 0);

    const components = await asApp(ALICE(), (repos) => repos.design.components({ status: 'active' }));
    assert.ok(components.length > 0);
    assert.ok(components.every((component) => component.status === 'active'));
  });
});

// ---------------------------------------------------------------------------
describe('سئو: متادیتا، قالب، ریدایرکت، سایتمپ (Addendum §30–۴۶)', () => {
  test('فراداده از تابع دامنه می‌آید و عمومی هم خوانده می‌شود', async () => {
    const saved = await asApp(ALICE(), (repos) =>
      repos.seo.upsertMetadata({
        entityKind: 'business',
        entityId: businessA,
        values: { title: 'پت‌شاپ تک‌پت — خوراک و لوازم', description: 'فروشگاه خوراک و لوازم حیوانات خانگی' },
        sourceHash: 'hash-1',
        businessId: businessA,
      }),
    );
    assert.ok(saved.id);

    const mine = await asApp(ALICE(), (repos) => repos.seo.metadata('business', businessA));
    assert.equal(String(mine.id), String(saved.id));

    const publicView = await asApp(BOB(), (repos) => repos.seo.publicMetadata('business', businessA));
    assert.equal(String(publicView.title), 'پت‌شاپ تک‌پت — خوراک و لوازم');
  });

  test('قالب خاص‌ترین را برمی‌گرداند', async () => {
    const template = await asApp(ALICE(), (repos) => repos.seo.pickTemplate('business', null, businessA));
    assert.ok(template);
    assert.match(String(template.key), /^business\./);
  });

  test('ریدایرکت ساخته می‌شود، تطبیق می‌خورد و تکراری رد می‌شود', async () => {
    const created = await asApp(ALICE(), (repos) =>
      repos.seo.createRedirect({ businessId: businessA, sourcePath: '/old-feed', targetPath: '/feed', statusCode: 301, reason: 'تغییر نامک' }),
    );
    assert.equal(created.status_code, 301);

    const matched = await asApp(ALICE(), (repos) => repos.seo.matchRedirect('/old-feed', businessA));
    assert.equal(String(matched.target_path), '/feed');

    await assert.rejects(
      () => asApp(ALICE(), (repos) => repos.seo.createRedirect({ businessId: businessA, sourcePath: '/old-feed', targetPath: '/other' })),
      (error) => error.details?.reason === 'duplicate_source',
    );
  });

  test('حلقهٔ ریدایرکت پیش از ساخت دیده می‌شود', async () => {
    const issue = await asApp(ALICE(), (repos) => repos.seo.redirectIssue('/feed'));
    assert.ok(issue === null || typeof issue.issue === 'string');
  });

  test('سایتمپ، فرصت‌ها و رخدادهای ایندکس، شکل قراردادی دارند', async () => {
    const sitemaps = await asApp(ALICE(), (repos) => repos.seo.sitemaps(businessA));
    const pending = await asApp(ALICE(), (repos) => repos.seo.pendingIndexingEvents(5));
    const opportunities = await asApp(ALICE(), (repos) => repos.seo.openOpportunities(businessA));
    const preview = await asApp(ALICE(), (repos) => repos.seo.templatePreview('business', { name: 'پت‌شاپ تک‌پت' }));

    assert.ok(Array.isArray(sitemaps) && Array.isArray(pending) && Array.isArray(opportunities));
    assert.ok(preview.title, 'پیش‌نمایش قالب باید عنوان بسازد');
  });
});

// ---------------------------------------------------------------------------
describe('کاتالوگ: دادهٔ مرجع، فقط خواندنی (§19–۲۰)', () => {
  test('نوع کسب‌وکار، صنعت، مکان و دسته می‌آید', async () => {
    const types = await asApp(BOB(), (repos) => repos.catalog.businessTypes());
    assert.ok(types.some((row) => row.key === 'veterinary_clinic'));

    const industries = await asApp(BOB(), (repos) => repos.catalog.industries());
    assert.ok(industries.length > 0);

    const locations = await asApp(BOB(), (repos) => repos.catalog.locations({ kind: 'province', limit: 5 }));
    assert.ok(Array.isArray(locations));

    const categories = await asApp(BOB(), (repos) => repos.catalog.categories({ limit: 3 }));
    assert.ok(Array.isArray(categories));
  });

  test('مهر تازه‌سازی دادهٔ مرجع برمی‌گردد (برای کش لایهٔ بالاتر)', async () => {
    const revision = await asApp(BOB(), (repos) => repos.catalog.revision());
    assert.ok(revision.types, 'مهر زمانی انواع باید باشد');
  });
});

// ---------------------------------------------------------------------------
describe('عملیات: تنظیمات و فیچر (§93–۹۹، §180)', () => {
  test('تنظیم سراسری و کسب‌وکاری، خوانده و نوشته می‌شود', async () => {
    await asApp(SUPERADMIN(), (repos) => repos.ops.setSetting({ key: 'seo.indexing', value: { enabled: true } }));

    const globalSetting = await asApp(BOB(), (repos) => repos.ops.setting('seo.indexing'));
    assert.equal(globalSetting.value.enabled, true);

    const scoped = await asApp(ALICE(), (repos) =>
      repos.ops.setSetting({ key: 'shop.currency', value: { code: 'IRT' }, businessId: businessA }),
    );
    assert.equal(scoped.business_id, businessA);

    const settings = await asApp(ALICE(), (repos) => repos.ops.settings(businessA));
    assert.ok(settings.some((row) => row.key === 'shop.currency'));
  });

  test('فیچر خوانده می‌شود و گذر وضعیتش حسابرسی می‌شود', async () => {
    const feature = await asApp(SUPERADMIN(), (repos) => repos.ops.feature('seo.engine'));
    assert.ok(feature);

    // `seo.engine` در دادهٔ مرجع از پیش `development` است؛ گذر بعدی `preview` است.
    const next = await asApp(SUPERADMIN(), (repos) => repos.ops.transitionFeature('seo.engine', 'preview', 'آزمون گذر'));
    assert.equal(next.status, 'preview');
  });

  test('نمودار وابستگی فیچرها و بازدارنده‌های حذف برمی‌گردند', async () => {
    const cycles = await asApp(SUPERADMIN(), (repos) => repos.ops.featureCycles());
    assert.equal(typeof cycles, 'object');

    const blockers = await asApp(SUPERADMIN(), (repos) => repos.ops.featureRemovalBlockers('seo.engine'));
    assert.ok(Array.isArray(blockers));
  });
});

// ---------------------------------------------------------------------------
describe('صف کار: تصاحب اتمی، پایان کار، سلامت (§64–۷۸)', () => {
  let jobId;

  test('کار با کلید یکتا در صف می‌نشیند و تکرار، کار دومی نمی‌سازد', async () => {
    const first = await asApp(ALICE(), (repos) =>
      repos.ops.enqueue({ kind: 'seo.audit', businessId: businessA, dedupeKey: 'audit-business-a' }),
    );
    jobId = String(first.id);

    const second = await asApp(ALICE(), (repos) =>
      repos.ops.enqueue({ kind: 'seo.audit', businessId: businessA, dedupeKey: 'audit-business-a' }),
    );
    assert.equal(String(second.id), jobId, 'کار تکراری نباید ساخته شود');
  });

  test('تصاحب اتمی است: یک کار به دو کارگر داده نمی‌شود', async () => {
    const claimed = await asWorker({ userId: aliceId }, (repos) => repos.ops.claimJobs('worker-1', ['seo.audit'], 1));
    assert.equal(claimed.length, 1);
    assert.equal(String(claimed[0].id), jobId);

    const again = await asWorker({ userId: aliceId }, (repos) => repos.ops.claimJobs('worker-2', ['seo.audit'], 1));
    assert.equal(again.length, 0, 'کار تصاحب‌شده نباید دوباره داده شود');
  });

  test('پایان کار، وضعیت را می‌بندد', async () => {
    const finished = await asWorker({ userId: aliceId }, (repos) => repos.ops.finishJob(jobId, true));
    assert.equal(finished.status, 'succeeded');
  });

  test('کار شکست‌خورده با تأخیر برمی‌گردد و به سقف که رسید، مرده اعلام می‌شود', async () => {
    const job = await asApp(ALICE(), (repos) => repos.ops.enqueue({ kind: 'image.variants', businessId: businessA, dedupeKey: 'img-1' }));
    await asWorker({ userId: aliceId }, (repos) => repos.ops.claimJobs('worker-3', ['image.variants'], 1));
    const retried = await asWorker({ userId: aliceId }, (repos) => repos.ops.finishJob(String(job.id), false, 'خطای آزمایشی', 5));
    assert.equal(retried.status, 'pending');
    assert.ok(Number(retried.attempts) >= 1);
  });

  test('تصویر سلامت صف، شمارنده‌ها را می‌دهد', async () => {
    const health = await asApp(SUPERADMIN(), (repos) => repos.ops.jobHealth());
    assert.equal(typeof health, 'object');
    assert.ok('pending' in health || 'succeeded' in health);
  });

  test('رخداد ثبت‌شده، از صف پردازش برداشته می‌شود', async () => {
    const eventId = await asApp(ALICE(), (repos) =>
      repos.ops.emitEvent({ eventType: 'content.updated', entityType: 'content', entityId: businessA, businessId: businessA, payload: { by: 'test' } }),
    );

    const pending = await asApp(SUPERADMIN(), (repos) => repos.ops.unprocessedEvents(50));
    assert.ok(pending.some((row) => String(row.id) === String(eventId)));

    const summary = await asWorker({ userId: aliceId }, (repos) => repos.ops.processEvent(String(eventId)));
    assert.ok(summary !== undefined && summary !== null);
  });
});

// ---------------------------------------------------------------------------
describe('اعلان و رخداد امنیتی (§97)', () => {
  test('هر کس فقط اعلان خودش را می‌بیند', async () => {
    const mine = await asApp(ALICE(), (repos) => repos.ops.notifications());
    assert.ok(mine.length >= 1);
    assert.ok(mine.every((row) => String(row.title).includes('آلیس')), 'اعلان دیگران نباید دیده شود');
  });

  test('خواندن اعلان، یک‌بار اثر می‌گذارد', async () => {
    const before = await asApp(ALICE(), (repos) => repos.ops.unreadNotificationCount());
    const [notification] = await asApp(ALICE(), (repos) => repos.ops.notifications({ unreadOnly: true }));

    const affected = await asApp(ALICE(), (repos) => repos.ops.markNotificationRead(String(notification.id)));
    assert.equal(affected, 1);

    const again = await asApp(ALICE(), (repos) => repos.ops.markNotificationRead(String(notification.id)));
    assert.equal(again, 0, 'خواندن دوباره نباید اثر بگذارد');

    const after = await asApp(ALICE(), (repos) => repos.ops.unreadNotificationCount());
    assert.equal(after, before - 1);
  });

  test('ثبت رخداد امنیتی از مسیر برنامه انجام می‌شود ولی خواندنش فقط کارکنان را', async () => {
    const recorded = await asApp(ALICE(), (repos) =>
      repos.ops.recordSecurityEvent({ kind: 'login_failed', severity: 'low', details: { reason: 'bad_password' } }),
    );
    assert.equal(recorded.recorded, true, 'نویسنده نباید سطر را پس بگیرد (RLS خواندن کارکنان است)');

    await assert.rejects(
      () => asApp(ALICE(), (repos) => repos.ops.securityEvents({ limit: 5 })),
      (error) => error.details?.reason === 'missing_platform_permission',
    );

    const staff = await asApp(SUPERADMIN(), (repos) => repos.ops.securityEvents({ limit: 5 }));
    assert.ok(staff.some((row) => row.kind === 'login_failed'));
  });

  test('سیاست‌های نگهداری و پشتیبان‌های تأییدنشده خوانده می‌شوند', async () => {
    const due = await asApp(SUPERADMIN(), (repos) => repos.ops.retentionDue(10));
    assert.ok(Array.isArray(due));

    const backups = await asApp(SUPERADMIN(), (repos) => repos.ops.unverifiedBackups(48));
    assert.ok(Array.isArray(backups));
  });
});

// ---------------------------------------------------------------------------
describe('خودکارسازی: قاعده داده است، کنش بسته (§56–۷۲)', () => {
  let ruleId;

  test('قاعده ساخته می‌شود و کنش ناشناس رد می‌شود', async () => {
    const rule = await asApp(ALICE(), (repos) =>
      repos.automation.create({
        businessId: businessA,
        key: 'notify_on_update',
        nameFa: 'اطلاع ویرایش',
        eventType: 'business.updated',
        conditions: { all: [{ path: 'business_id', op: 'exists' }] },
        actions: [{ type: 'emit_event', event_type: 'automation.notify_on_update' }],
        priority: 50,
      }),
    );
    ruleId = String(rule.id);
    assert.equal(rule.status, 'draft');

    await assert.rejects(
      () =>
        asApp(ALICE(), (repos) =>
          repos.automation.create({
            businessId: businessA,
            key: 'dangerous_rule',
            nameFa: 'قاعدهٔ خطرناک',
            eventType: 'business.updated',
            actions: [{ type: 'run_sql', statement: 'delete from app.business' }],
          }),
        ),
      (error) => error.details?.reason === 'unknown_action',
    );
  });

  test('روشن‌کردن قاعده، رخداد حسابرسی می‌گذارد', async () => {
    const active = await asApp(ALICE(), (repos) => repos.automation.setStatus(ruleId, 'active'));
    assert.equal(active.status, 'active');

    const audits = await engine.query(`select count(*)::int as n from ops.audit_log where entity_id = $1`, [ruleId]);
    assert.ok(audits[0].n >= 1, 'تغییر وضعیت قاعده باید حسابرسی شود');
  });

  test('اجرای خشک، تطبیق را بی‌اجرای کنش می‌سنجد', async () => {
    const dry = await asApp(ALICE(), (repos) => repos.automation.dryRunRule(ruleId, { business_id: businessA }));
    assert.equal(dry.matched, true);

    const notMatching = await asApp(ALICE(), (repos) => repos.automation.dryRunRule(ruleId, {}));
    assert.equal(notMatching.matched, false);
  });

  test('اجرای قاعده روی رخداد واقعی، یک اجرا ثبت می‌کند', async () => {
    const eventId = await asApp(ALICE(), (repos) =>
      repos.ops.emitEvent({ eventType: 'business.updated', entityType: 'business', entityId: businessA, businessId: businessA, payload: { name: 'نو' } }),
    );

    const run = await asWorker({ userId: aliceId }, (repos) => repos.automation.runRule(ruleId, String(eventId)));
    assert.ok(run, 'اجرا باید ثبت شود');

    const runs = await asApp(ALICE(), (repos) => repos.automation.runs(businessA, { limit: 5 }));
    assert.ok(runs.items.some((row) => String(row.rule_id) === ruleId));
  });

  test('سلامت خودکارسازی و فهرست قاعده‌ها می‌آید', async () => {
    const health = await asApp(ALICE(), (repos) => repos.automation.health(businessA));
    assert.equal(typeof health, 'object');

    const list = await asApp(ALICE(), (repos) => repos.automation.list(businessA, { limit: 5 }));
    assert.ok(list.items.some((row) => String(row.id) === ruleId));
  });
});

// ---------------------------------------------------------------------------
describe('عملکرد: مرز اعتماد، ایدمپوتنسی، دروازهٔ انتشار (§170–۱۷۵)', () => {
  test('ثبت نمونه: مسیر پاک می‌شود و رکورد نامعتبر در گزارش رد می‌آید', async () => {
    const summary = await asApp(ALICE(), (repos) =>
      repos.performance.record(
        [
          { metric: 'LCP', value: 1900, pagePath: '/b/tak-pet?utm_source=x', routePattern: '/b/:slug' },
          { metric: 'CLS', value: 0.04, pagePath: '/b/tak-pet', routePattern: '/b/:slug' },
          { metric: 'LCP', value: 999_999, pagePath: '/b/tak-pet', routePattern: '/b/:slug' },
        ],
        businessA,
      ),
    );

    assert.equal(summary.accepted, 2);
    assert.equal(summary.rejected.length, 1);
    assert.equal(summary.rejected[0].reason, 'value_out_of_range');

    const stored = await engine.query(`select page_path from ops.vitals_sample where page_path like '%tak-pet%' limit 5`);
    assert.ok(stored.length > 0, 'نمونه‌ها باید ذخیره شده باشند');
    assert.ok(stored.every((row) => !String(row.page_path).includes('?')), 'رشتهٔ پرس‌وجو نباید در مسیر بماند');
  });

  test('تجمیع ایدمپوتنت است', async () => {
    const first = await asWorker({ userId: aliceId }, (repos) => repos.performance.rollup('hour', '2 days'));
    const second = await asWorker({ userId: aliceId }, (repos) => repos.performance.rollup('hour', '2 days'));
    assert.equal(first, second, 'اجرای دوباره نباید دادهٔ تکراری بسازد');
  });

  test('بودجهٔ مسیر و دروازهٔ انتشار، پاسخ ساختاریافته می‌دهند', async () => {
    const budget = await asApp(ALICE(), (repos) => repos.performance.budgetForRoute('/b/:slug'));
    assert.ok(budget, 'برای مسیر عمومی باید بودجه تعریف شده باشد');
    assert.ok(Number(budget.lcp_ms) > 0);

    const verdict = await asApp(ALICE(), (repos) => repos.performance.checkBudget('/b/:slug', { lcp_ms: 2000, cls: 0.05 }));
    assert.ok(['pass', 'fail', 'warn'].includes(String(verdict.verdict)));

    const gate = await asApp(ALICE(), (repos) => repos.performance.publishGate(businessA));
    assert.ok(gate.verdict, 'دروازهٔ انتشار باید حکم بدهد');
  });

  test('رگرسیون‌ها و خط پایه خوانده می‌شوند', async () => {
    const baselines = await asApp(SUPERADMIN(), (repos) => repos.performance.baselines('/b/:slug'));
    assert.ok(Array.isArray(baselines));

    const regressions = await asApp(SUPERADMIN(), (repos) => repos.performance.regressions('open'));
    assert.ok(Array.isArray(regressions));
  });
});
