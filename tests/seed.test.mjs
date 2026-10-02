/**
 * تست دادهٔ مرجع (گام ۱۷ — §182؛ Addendum §21–۲۴، §39–۴۷، §100، §103).
 *
 * چرا دادهٔ مرجع تست می‌خواهد: هرچه در seed بیاید، بعداً «واقعیت» فرض می‌شود.
 * یک توکن با مقدار نامعتبر، یک کامپوننت بی‌فرادادهٔ دسترس‌پذیری، یک قاعدهٔ
 * خودکارسازی با کنش ناشناخته، یا یک مجوز خیالی در فرادادهٔ فیچر — همه در
 * زمان اجرا خودشان را نشان نمی‌دهند؛ فقط وقتی کاربر گیر کند.
 *
 * این تست، همان «قرارداد دادهٔ مرجع» است: شکل، یکپارچگی و پوشش.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../scripts/lib/engine.mjs';
import { migrate } from '../scripts/lib/migrate.mjs';
import { applySeeds, seedFiles } from '../scripts/lib/seed.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..');
const seedsDir = join(projectRoot, 'seeds');

let engine;

before(async () => {
  engine = await openDatabase();
  await migrate(engine, { dir: join(projectRoot, 'migrations') });
  await applySeeds(engine, { dir: seedsDir });
});

after(async () => {
  await engine.close();
});

// ---------------------------------------------------------------------------
describe('ایدمپوتنسی دادهٔ مرجع (§180)', () => {
  test('همهٔ فایل‌های seed اجرا شده‌اند و دفتر seed با فهرست فایل‌ها می‌خواند', async () => {
    const files = await seedFiles(seedsDir);
    const ledger = await engine.query(`select filename from ops.seed order by filename`);
    const recorded = ledger.map((row) => String(row.filename));

    assert.ok(files.length >= 5, `فایل‌های seed: ${files.join(', ')}`);
    for (const file of files) {
      assert.ok(recorded.includes(file), `فایل ${file} در دفتر seed نیست`);
    }
  });

  test('اجرای دوبارهٔ کل seed (اجباراً)، هیچ ردیفی را دوبرابر نمی‌کند', async () => {
    const snapshot = async () => {
      const [row] = await engine.query(`
        select
          (select count(*)::int from design.token) as tokens,
          (select count(*)::int from design.theme) as themes,
          (select count(*)::int from design.component) as components,
          (select count(*)::int from ops.feature) as features,
          (select count(*)::int from ops.setting) as settings,
          (select count(*)::int from ops.page_budget) as budgets,
          (select count(*)::int from ops.automation_rule) as rules,
          (select count(*)::int from seo.template) as templates,
          (select count(*)::int from auth.permission) as permissions,
          (select count(*)::int from seo.settings) as seo_settings
      `);
      return row;
    };

    const before = await snapshot();
    await applySeeds(engine, { dir: seedsDir, force: true });
    const after = await snapshot();

    assert.deepEqual(after, before);
    assert.ok(Number(before.tokens) > 100, `توکن‌ها: ${before.tokens}`);
    assert.ok(Number(before.components) >= 40, `کامپوننت‌ها: ${before.components}`);
  });

  test('seed رازی در خود ندارد', async () => {
    // §79 و §152: راز در پیکربندی می‌آید، نه در دادهٔ مرجع و نه در مخزن.
    const secrets = await engine.query(`select key from ops.setting where is_secret`);
    const suspicious = await engine.query(`
      select key from ops.setting
      where value::text ~ '(sk-[A-Za-z0-9]{16,}|eyJ[A-Za-z0-9_-]{20,}|postgres://[a-z]+:[^@]+@)'
    `);
    assert.deepEqual(secrets.map((row) => String(row.key)), [], 'تنظیم رازدار نباید در seed باشد');
    assert.deepEqual(suspicious.map((row) => String(row.key)), [], 'هیچ مقدار شبیه راز در seed نیست');
  });
});

// ---------------------------------------------------------------------------
describe('توکن‌های طراحی: شکل، مقیاس و ارجاع (§161، Addendum §4–۱۹)', () => {
  test('هر توکن، مقدار متناسب با نوعش دارد', async () => {
    const tokens = await engine.query(`select key, value_type, value from design.token`);
    const problems = [];

    for (const token of tokens) {
      const value = token.value;
      const asText = typeof value === 'string' ? value : JSON.stringify(value);
      const key = String(token.key);

      switch (String(token.value_type)) {
        case 'color':
          if (!/^(#[0-9A-Fa-f]{6}|rgba?\([0-9.,\s]+\))$/.test(asText)) problems.push(`${key}: رنگ نامعتبر ${asText}`);
          break;
        case 'length':
          if (!/^(0|-?[0-9.]+(px|em|rem|ch|%))$/.test(asText)) problems.push(`${key}: طول نامعتبر ${asText}`);
          break;
        case 'number':
          if (typeof value !== 'number' && !/^-?[0-9.]+$/.test(asText)) problems.push(`${key}: عدد نامعتبر ${asText}`);
          break;
        case 'shadow':
          if (!Array.isArray(value) || value.some((layer) => typeof layer.color !== 'string' || typeof layer.blur !== 'number')) {
            problems.push(`${key}: سایهٔ نامعتبر`);
          }
          break;
        case 'font':
          if (typeof value !== 'string' || value.length < 3) problems.push(`${key}: فونت نامعتبر`);
          break;
        case 'duration':
          if (!/^[0-9]+ms$/.test(asText)) problems.push(`${key}: مدت نامعتبر ${asText}`);
          break;
        case 'cubic':
          if (!/^cubic-bezier\(/.test(asText)) problems.push(`${key}: منحنی نامعتبر ${asText}`);
          break;
        default:
          problems.push(`${key}: نوع ناشناخته ${token.value_type}`);
      }
    }

    assert.deepEqual(problems, [], `توکن نامعتبر:\n${problems.join('\n')}`);
  });

  test('فاصله‌ها روی شبکهٔ ۴ پیکسلی‌اند', async () => {
    const rows = await engine.query(
      `select key, (value #>> '{}')::text as raw from design.token where group_key = 'spacing' and value_type = 'length'`,
    );
    const offGrid = rows
      .map((row) => [String(row.key), parseInt(String(row.raw), 10)])
      .filter(([, px]) => Number.isFinite(px) && px % 4 !== 0)
      .map(([key, px]) => `${key}=${px}px`);

    assert.deepEqual(offGrid, [], `فاصلهٔ بیرون از شبکه: ${offGrid.join(', ')}`);
  });

  test('مقیاس تایپوگرافی صعودی است و متن پایه کمتر از ۱۶ نیست', async () => {
    const rows = await engine.query(`
      select key, (value #>> '{}')::text as raw
      from design.token
      where group_key = 'typography' and key like 'font.size.%'
    `);
    const sizes = rows
      .map((row) => ({ key: String(row.key), px: parseInt(String(row.raw), 10) }))
      .sort((a, b) => a.px - b.px);

    assert.ok(sizes.length >= 8, `اندازه‌ها: ${sizes.length}`);
    for (let index = 1; index < sizes.length; index += 1) {
      assert.ok(sizes[index].px > sizes[index - 1].px, `${sizes[index].key} باید از ${sizes[index - 1].key} بزرگ‌تر باشد`);
    }
    const base = sizes.find((size) => size.key === 'font.size.base');
    assert.ok(base.px >= 16, 'متن پایه زیر ۱۶ پیکسل، زوم موبایل را می‌شکند');
  });

  test('ارتفاع خط متن فارسی باز است', async () => {
    const rows = await engine.query(
      `select key, (value #>> '{}')::text::numeric as leading from design.token where key in ('font.leading.body', 'font.leading.heading')`,
    );
    const body = rows.find((row) => row.key === 'font.leading.body');
    assert.ok(Number(body.leading) >= 1.7, 'متن بلند فارسی به ارتفاع خط بازتر نیاز دارد');
  });

  test('توکن‌های معنایی با مرجعشان می‌خوانند و همتای تاریک دارند', async () => {
    const rows = await engine.query(`
      select key, theme_mode, alias_of, value
      from design.token
      where alias_of is not null
    `);

    const problems = [];
    for (const row of rows) {
      const target = await engine.query(
        `select value from design.token where key = $1 and theme_mode = $2 and alias_of is null limit 1`,
        [String(row.alias_of), String(row.theme_mode)],
      );
      if (target.length === 0) {
        problems.push(`${row.key}: مرجع ${row.alias_of} در حالت ${row.theme_mode} وجود ندارد`);
        continue;
      }
      if (JSON.stringify(target[0].value) !== JSON.stringify(row.value)) {
        problems.push(`${row.key}: مقدار با مرجعش ${row.alias_of} یکی نیست`);
      }
    }
    assert.deepEqual(problems, [], problems.join('\n'));

    // توکن‌های معنایی‌ای که باید در هر دو حالت روشن و تاریک وجود داشته باشند.
    const semantic = ['color.bg', 'color.surface', 'color.text', 'color.text.muted', 'color.border', 'color.link'];
    const modes = new Map();
    for (const row of await engine.query(`select key, theme_mode from design.token where key = any ($1::text[])`, [semantic])) {
      const key = String(row.key);
      modes.set(key, (modes.get(key) ?? new Set()).add(String(row.theme_mode)));
    }

    const missing = semantic.filter((key) => !(modes.get(key)?.has('light') && modes.get(key)?.has('dark')));
    assert.deepEqual(missing, [], `توکن معنایی بی‌همتای تاریک: ${missing.join(', ')}`);
    assert.ok(rows.length >= 12, `توکن‌های ارجاعی: ${rows.length}`);
  });

  test('تم پیش‌فرض، کامل و سازگار با قانون طراحی است', async () => {
    const themes = await engine.query(
      `select key, settings, is_default, is_system from design.theme where business_id is null`,
    );
    const defaults = themes.filter((row) => row.is_default);

    assert.equal(defaults.length, 1, 'دقیقاً یک تم پیش‌فرض سیستمی');
    const settings = defaults[0].settings;
    assert.equal(settings.direction, 'rtl', 'جهت پیش‌فرض راست‌به‌چپ است');
    assert.equal(Number(settings.touch_target_min_px), 44, 'کمینهٔ هدف لمسی ۴۴ پیکسل (§45)');
    assert.equal(settings.respects_reduced_motion, true, 'احترام به reduced-motion بخشی از تم است');
    assert.equal(themes[0].is_system, true);
  });

  test('هر بازنویسی تم، به توکن موجود اشاره می‌کند', async () => {
    const rows = await engine.query(`
      select tt.token_key, tt.theme_mode
      from design.theme_token tt
      where not exists (select 1 from design.token t where t.key = tt.token_key)
    `);
    assert.deepEqual(rows.map((row) => String(row.token_key)), [], 'بازنویسی روی توکن ناموجود');
  });
});

// ---------------------------------------------------------------------------
describe('کامپوننت‌ها و فرادادهٔ آن‌ها (§43–۴۷، Addendum §96)', () => {
  test('هر کامپوننت دسترس‌پذیری و عملکرد خود را اعلام کرده است', async () => {
    const rows = await engine.query(`
      select key from design.component
      where a11y = '{}'::jsonb or performance = '{}'::jsonb or props_schema = '{}'::jsonb
      order by key
    `);
    assert.deepEqual(rows.map((row) => String(row.key)), [], 'کامپوننت بی‌فراداده');
  });

  test('کامپوننت‌های ساختاری، فرادادهٔ سئو دارند', async () => {
    // کامپوننت‌هایی که در ساختار سند ظاهر می‌شوند باید بگویند چگونه؛
    // کامپوننت صرفاً تزئینی اجازه دارد خالی بماند.
    const rows = await engine.query(`
      select key from design.component
      where category in ('content', 'media', 'navigation', 'data', 'commerce')
        and seo = '{}'::jsonb
      order by key
    `);
    assert.deepEqual(rows.map((row) => String(row.key)), [], 'کامپوننت ساختاری بی‌فرادادهٔ سئو');
  });

  test('همهٔ کامپوننت‌ها فعال و بدون کلید تکراری‌اند', async () => {
    const counts = await engine.query(`
      select
        count(*)::int as total,
        count(*) filter (where status <> 'active')::int as inactive,
        count(distinct key)::int as distinct_keys
    from design.component
    `);
    assert.ok(Number(counts[0].total) >= 40);
    assert.equal(Number(counts[0].inactive), 0);
    assert.equal(Number(counts[0].total), Number(counts[0].distinct_keys));
  });
});

// ---------------------------------------------------------------------------
describe('رجیستری فیچر: پیوند با مجوز، بودجه و سئو (§100، Addendum §21–۲۴)', () => {
  test('هر مجوز نام‌برده در فیچر، مجوزی واقعی است', async () => {
    const rows = await engine.query(`
      select f.key as feature, t.perm as missing
      from ops.feature f,
           lateral jsonb_array_elements_text(coalesce(f.wiring -> 'permissions', '[]'::jsonb)) as t(perm)
      where not exists (select 1 from auth.permission p where p.key = t.perm)
      order by 1, 2
    `);
    assert.deepEqual(
      rows.map((row) => `${row.feature}:${row.missing}`),
      [],
      'فیچر به مجوز خیالی وصل شده است',
    );
  });

  test('هر فیچر ایندکس‌پذیر، بودجهٔ عملکرد دارد', async () => {
    const rows = await engine.query(`
      select key from ops.feature
      where (seo_metadata ->> 'indexable')::boolean is true
        and not (performance_budget ? 'lcp_ms')
      order by key
    `);
    assert.deepEqual(
      rows.map((row) => String(row.key)),
      [],
      'فیچری که صفحهٔ ایندکس‌پذیر می‌سازد، باید بودجهٔ LCP داشته باشد',
    );
  });

  test('هر فیچر می‌گوید به کجا وصل است (§100)', async () => {
    const rows = await engine.query(`
      select key from ops.feature where wiring = '{}'::jsonb order by key
    `);
    assert.deepEqual(rows.map((row) => String(row.key)), [], 'فیچر جزیره: هیچ اتصالی اعلام نشده');
  });

  test('بودجهٔ همهٔ مسیرهای عمومی تعریف شده است', async () => {
    const required = ['/', '/b/:slug', '/blog/:slug', '/search', '/membership', '/join', '/auth/:step'];
    const rows = await engine.query(`select route_pattern from ops.page_budget where scope = 'platform'`);
    const defined = rows.map((row) => String(row.route_pattern));
    const missing = required.filter((route) => !defined.includes(route));

    assert.deepEqual(missing, [], `مسیر بی‌بودجه: ${missing.join(', ')}`);
  });

  test('هر بودجه، عددی معنادار دارد', async () => {
    const rows = await engine.query(`
      select route_pattern, lcp_ms, inp_ms, cls, rum_sample_rate from ops.page_budget
    `);
    const problems = rows
      .filter((row) => Number(row.lcp_ms) < 100 || Number(row.inp_ms) < 10 || Number(row.cls) > 1 || Number(row.rum_sample_rate) < 0)
      .map((row) => String(row.route_pattern));
    assert.deepEqual(problems, [], `بودجهٔ بی‌معنا: ${problems.join(', ')}`);
  });
});

// ---------------------------------------------------------------------------
describe('قاعده‌های سیستمی، قالب‌ها و تنظیمات پایه', () => {
  test('هر قاعدهٔ سیستمی، کنش مجاز و گیرندهٔ روشن دارد', async () => {
    const rules = await engine.query(`select key, event_type, conditions, actions from ops.automation_rule where is_system`);
    const allowed = ['notify', 'emit_event', 'enqueue_job', 'webhook'];
    const problems = [];

    for (const rule of rules) {
      if (!/^[a-z_]+\.[a-z_]+$/.test(String(rule.event_type))) problems.push(`${rule.key}: رخداد نامعتبر`);
      if (typeof rule.conditions !== 'object') problems.push(`${rule.key}: شرط نامعتبر`);
      if (!Array.isArray(rule.actions) || rule.actions.length === 0) problems.push(`${rule.key}: بی‌کنش`);
      for (const action of rule.actions) {
        if (!allowed.includes(action.type)) problems.push(`${rule.key}: کنش غیرمجاز ${action.type}`);
        if (action.type === 'notify' && !action.user_path && !action.recipient) {
          problems.push(`${rule.key}: کنش notify بی‌گیرنده`);
        }
      }
    }

    assert.deepEqual(problems, [], problems.join('\n'));
    assert.ok(rules.length >= 4, `قاعده‌های سیستمی: ${rules.length}`);
  });

  test('قاعده‌های سیستمی تا آمدن کارگر خاموش‌اند', async () => {
    // قاعدهٔ فعالی که کسی پردازشش نمی‌کند، رخداد معطل می‌سازد. روشن‌کردن،
    // کار گام ۳۲ است — و تا آن زمان، خاموش‌بودن صریح است، نه فراموشی.
    const rows = await engine.query(`select key, status from ops.automation_rule where is_system and status <> 'paused'`);
    assert.deepEqual(rows.map((row) => String(row.key)), [], 'قاعدهٔ سیستمی روشن، بی‌کارگر');
  });

  test('تنظیمات پایهٔ پلتفرم کامل‌اند و سیاست‌های حیاتی را می‌گویند', async () => {
    const rows = await engine.query(`select key, value from ops.setting where business_id is null`);
    const settings = new Map(rows.map((row) => [String(row.key), row.value]));

    const required = [
      'platform.locale',
      'platform.brand',
      'platform.third_party',
      'platform.image_pipeline',
      'platform.fonts',
      'platform.cache',
      'platform.observability',
      'platform.api',
      'platform.security',
      'platform.backup',
      'platform.robots',
      'platform.content',
      'platform.rate_limit',
    ];
    const missing = required.filter((key) => !settings.has(key));
    assert.deepEqual(missing, [], `تنظیم غایب: ${missing.join(', ')}`);

    const security = settings.get('platform.security');
    assert.equal(security.cookie.host_only, true, 'کوکی نباید روی دامنهٔ مادر پخش شود');
    assert.equal(security.domain_cookie_broadcast, false);
    assert.equal(security.service_role_key_in_browser, false, 'کلید سرویس هرگز به مرورگر نمی‌رود (§79)');
    assert.ok(Number(security.step_up_minutes) > 0);

    const backup = settings.get('platform.backup');
    assert.equal(backup.restore_test_required, true, 'پشتیبان بی‌آزمون بازیابی، پشتیبان نیست (§191)');

    const robots = settings.get('platform.robots');
    assert.equal(robots.index_in_non_production, false);
    assert.ok(robots.disallow.includes('/panel') && robots.disallow.includes('/api/'));

    const images = settings.get('platform.image_pipeline');
    assert.equal(images.lcp_image_eager, true, 'تصویر LCP هرگز lazy نمی‌شود');
    assert.equal(images.verify_signature, true, 'اعتبارسنجی امضای فایل، نه فقط MIME');

    const thirdParty = settings.get('platform.third_party');
    for (const entry of thirdParty.entries) {
      assert.ok(entry.purpose && entry.cost && entry.loading_strategy, 'هر سرویس بیرونی: purpose، cost، loading_strategy');
    }
  });

  test('تنظیمات سئوی سراسری، محافظه‌کارانه شروع می‌شود', async () => {
    // ماژول‌های غیرتولیدی که از همین seed تغذیه می‌کنند، نباید پیش از تصمیم
    // آگاهانهٔ استقرار ایندکس شوند.
    const [row] = await engine.query(`select environment, indexing_enabled, default_locale from seo.settings where business_id is null`);
    assert.notEqual(row.environment, 'production', 'پیش‌فرض seed، محیط تولید نیست');
    assert.equal(row.indexing_enabled, false, 'ایندکس پیش از تصمیم استقرار، بسته است');
    assert.equal(row.default_locale, 'fa-IR');
  });

  test('قالب‌های سئو، همهٔ نوع‌های موجودیت لازم را پوشش می‌دهند', async () => {
    const rows = await engine.query(`select entity_kind, count(*)::int as n from seo.template where business_id is null group by 1`);
    const kinds = new Map(rows.map((row) => [String(row.entity_kind), Number(row.n)]));
    const required = ['home', 'business', 'content', 'category', 'industry', 'location', 'business_type', 'search'];

    const missing = required.filter((kind) => !kinds.has(kind));
    assert.deepEqual(missing, [], `نوع موجودیت بی‌قالب: ${missing.join(', ')}`);
  });

  test('نقش‌ها، همهٔ مجوزهای دامنه‌ای را پوشش می‌دهند', async () => {
    const rows = await engine.query(`
      select p.key
      from auth.permission p
      where p.category <> 'platform'
        and not exists (select 1 from app.role_permission rp where rp.permission_key = p.key)
    `);
    assert.deepEqual(rows.map((row) => String(row.key)), [], 'مجوز دامنه‌ای بی‌نقش');

    const [automation] = await engine.query(`
      select count(*)::int as n
      from app.role r join app.role_permission rp on rp.role_id = r.id
      where r.business_id is null and r.key in ('owner', 'admin', 'marketer') and rp.permission_key = 'automation.manage'
    `);
    assert.equal(Number(automation.n), 3, 'مدیریت خودکارسازی باید دست مالک، مدیر و بازاریاب باشد');
  });

  test('تاکسونومی پایه کامل است و سلسله‌مراتب صنعت معتبر', async () => {
    const [counts] = await engine.query(`
      select
        (select count(*)::int from ref.business_type) as types,
        (select count(*)::int from ref.industry) as industries,
        (select count(*)::int from ref.location) as locations,
        (select count(*)::int from ref.industry where parent_key is not null) as industry_children
    `);
    assert.ok(Number(counts.types) >= 20, `انواع کسب‌وکار: ${counts.types}`);
    assert.ok(Number(counts.industries) >= 40);
    assert.ok(Number(counts.locations) >= 50);
    assert.ok(Number(counts.industry_children) >= 10, 'سلسله‌مراتب صنعت باید سطح دوم داشته باشد');

    const orphans = await engine.query(`
      select key from ref.industry i
      where i.parent_key is not null and not exists (select 1 from ref.industry p where p.key = i.parent_key)
    `);
    assert.deepEqual(orphans.map((row) => String(row.key)), []);
  });
});
