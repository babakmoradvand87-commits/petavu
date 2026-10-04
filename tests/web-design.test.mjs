/**
 * تست رندر از درخت JSON (گام ۲۳ — §32–۴۴، §161–۱۶۹، §103، Addendum §۳۰–۳۳).
 *
 * دو دستهٔ آزمون، هر دو لازم:
 *
 *   ۱. **واحد** — بدون پایگاه‌داده: اعتبارسنجی پراپ، رد نشانی‌های خطرناک، سقف
 *      عمق/تعداد، تنزل `h1`، جانشینی نگه‌دارنده‌ها، و رفتار «کامپوننت
 *      رندرنشدنی». اینها سرمایهٔ دفاعی‌اند: مرز امنیتی باید بدون راه‌اندازی
 *      زیرساخت هم آزمون‌شدنی باشد.
 *   ۲. **یکپارچه** — سرور واقعی روی پورت تصادفی، پایگاه‌دادهٔ واقعی (PGlite با
 *      همان مهاجرت‌ها و RLS)، صفحهٔ منتشرشدهٔ واقعی در `design.page`. اگر
 *      صفحهٔ منتشرشده رندر نمی‌شد، هیچ‌کدام از آزمون‌های واحد ارزش عملی نداشت.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDatabase } from '../scripts/lib/engine.mjs';
import { migrate } from '../scripts/lib/migrate.mjs';
import { applySeeds } from '../scripts/lib/seed.mjs';

import { createWebServer } from '../apps/web/dist/index.js';
import {
  createRegistry,
  createRegistryCache,
  parseRegistryRow,
  sanitizeHref,
  validateProps,
  findingsDigest,
} from '../apps/web/dist/registry.js';
import { renderTree, scanTree, treeRoot, resolvePlaceholders } from '../apps/web/dist/tree.js';
import { RENDERERS, UNRENDERABLE } from '../apps/web/dist/renderers.js';
import { formatHours, contactHref, buildBusinessView } from '../apps/web/dist/pagedesign.js';
import { INLINE_MIME, mediaHeaders, mediaViewOf, readLocalMedia, resolveAssetSource } from '../apps/web/dist/media.js';
import { decodePath, resolveTarget } from '../apps/web/dist/router.js';
import { SHELL_CSS } from '../apps/web/dist/styles.js';
import { loadEnv, uuidv7 } from '../packages/shared/dist/index.js';
import { createPasswordHasher, TEST_ARGON2, hashIdentifier } from '../packages/security/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..');
const assetsDirectory = join(projectRoot, 'apps/web/assets');

const mediaRoot = mkdtempSync(join(tmpdir(), 'petavu-media-'));

const env = loadEnv({
  PETAVU_ENV: 'test',
  AUTH_PEPPER: 'test-pepper-value',
  SESSION_SECRET: 'test-session-secret-value-0123456789',
  PETAVU_PUBLIC_ORIGIN: 'http://localhost:3000',
  PETAVU_PANEL_ORIGIN: 'http://panel.localhost:3000',
  PETAVU_ADMIN_ORIGIN: 'http://adminpanel.localhost:3000',
  PETAVU_SHOP_ORIGIN: 'http://shop.localhost:3000',
  PETAVU_ADMIN_SHOP_ORIGIN: 'http://adminshop.localhost:3000',
  STORAGE_LOCAL_DIR: mediaRoot,
});

const PUBLIC_HOST = 'localhost:3000';
const passwords = createPasswordHasher({ params: TEST_ARGON2, pepper: 'test-pepper-value' });

/* ------------------------------------------------------------------ پیکربندی نمونه */

/** Registry کوچک برای آزمون واحد: همان شکل ردیف‌های واقعی `design.component`. */
const SAMPLE_ROWS = [
  {
    key: 'content.heading',
    name_fa: 'عنوان',
    category: 'content',
    status: 'active',
    props_schema: { text: { type: 'string', required: true }, level: { type: 'enum', enum: ['h1', 'h2', 'h3', 'h4'], default: 'h2' }, align: { type: 'enum', enum: ['start', 'center'] } },
    slots: {},
    a11y: {},
    seo: {},
    performance: { weight_kb: 1 },
  },
  {
    key: 'layout.section',
    name_fa: 'بخش',
    category: 'layout',
    status: 'active',
    props_schema: { title: { type: 'string' }, anchor: { type: 'string' }, padding: { type: 'enum', enum: ['none', 'sm', 'md', 'lg', 'xl'], default: 'md' } },
    slots: { default: { multiple: true } },
    a11y: { landmark: 'region' },
    seo: {},
    performance: { weight_kb: 2 },
  },
  {
    key: 'media.image',
    name_fa: 'تصویر',
    category: 'media',
    status: 'active',
    props_schema: { alt: { type: 'string', required: true }, assetId: { type: 'asset', required: true }, loading: { type: 'enum', enum: ['lazy', 'eager'], default: 'lazy' } },
    slots: {},
    a11y: {},
    seo: {},
    performance: { weight_kb: 0, affects_lcp: true },
  },
  {
    key: 'form.contact_form',
    name_fa: 'فرم تماس',
    category: 'form',
    status: 'active',
    props_schema: { title: { type: 'string' } },
    slots: {},
    a11y: {},
    seo: {},
    performance: { weight_kb: 3 },
  },
  {
    key: 'navigation.toc',
    name_fa: 'فهرست مطالب',
    category: 'navigation',
    status: 'active',
    props_schema: { title: { type: 'string', default: 'در این صفحه' }, depth: { type: 'enum', enum: ['2', '3'], default: '2' } },
    slots: {},
    a11y: {},
    seo: {},
    performance: { weight_kb: 1 },
  },
  {
    key: 'content.retired',
    name_fa: 'بازنشسته',
    category: 'content',
    status: 'deprecated',
    props_schema: {},
    slots: {},
    a11y: {},
    seo: {},
    performance: {},
  },
];

const registry = createRegistry(SAMPLE_ROWS);

const EMPTY_DATA = { businesses: [], contents: [], business: null };

function render(input, options = {}) {
  const scan = scanTree(input, { registry, strings: options.strings ?? {} });
  return renderTree({
    scan,
    registry,
    strings: options.strings ?? {},
    data: options.data ?? EMPTY_DATA,
    pageUrl: options.pageUrl ?? 'http://localhost:3000/',
    locale: 'fa-IR',
    media: options.media ?? null,
  });
}

/* ------------------------------------------------------------------ واحد: تجزیه */

describe('تجزیهٔ درخت (§161)', () => {
  test('ریشهٔ ناقص، مانع می‌گیرد و هیچ گرهی رندر نمی‌شود', () => {
    assert.equal(treeRoot({ root: [] }), null);
    assert.equal(treeRoot({ version: 1 }), null);
    assert.equal(treeRoot([]), null);

    const result = render({ version: 1 });
    assert.equal(result.html, '');
    assert.ok(result.findings.some((finding) => finding.rule === 'structure.tree_invalid'));
  });

  test('گرهٔ بدون کامپوننت، حذف می‌شود (نه اینکه خطا بدهد)', () => {
    const result = render({ version: 1, root: [{ id: 'a', props: { text: 'بی‌کامپوننت' } }] });
    assert.equal(result.html, '');
    assert.ok(result.findings.some((finding) => finding.rule === 'structure.component_invalid'));
  });

  test('کامپوننت ناشناخته ⇒ یافتهٔ مسدودکننده و حذف گره', () => {
    const result = render({ version: 1, root: [{ id: 'x', component: 'evil.script', props: {} }] });
    assert.equal(result.html, '');
    assert.equal(result.findings.find((finding) => finding.rule === 'registry.component_unknown')?.severity, 'blocker');
  });

  test('کامپوننت بازنشسته رندر نمی‌شود', () => {
    const result = render({ version: 1, root: [{ id: 'r', component: 'content.retired', props: {} }] });
    assert.equal(result.html, '');
    assert.ok(result.findings.some((finding) => finding.rule === 'registry.component_inactive'));
  });

  test('سقف عمق: فرزندان گرهٔ عمیق حذف می‌شوند', () => {
    let node = { id: 'leaf', component: 'content.heading', props: { text: 'ته' } };
    for (let depth = 0; depth < 20; depth += 1) {
      node = { id: `s${depth}`, component: 'layout.section', props: { title: 'بخش' }, slots: { default: [node] } };
    }

    const result = render({ version: 1, root: [node] });
    assert.ok(result.findings.some((finding) => finding.rule === 'structure.depth_exceeded'));
    assert.ok(!result.html.includes('ته'));
  });

  test('سقف تعداد گره‌ها: درخت بزرگ‌تر بریده می‌شود', () => {
    const root = Array.from({ length: 500 }, (_, index) => ({
      id: `n${index}`,
      component: 'content.heading',
      props: { text: `عنوان ${index}` },
    }));

    const scan = scanTree({ version: 1, root }, { registry });
    assert.ok(scan.truncated);
    assert.ok(scan.nodeCount <= 400);
    assert.ok(scan.findings.some((finding) => finding.rule === 'performance.tree_truncated'));
  });
});

/* ------------------------------------------------------------------ واحد: پراپ */

describe('اعتبارسنجی پراپ (§43، §103)', () => {
  const headingSpec = parseRegistryRow(SAMPLE_ROWS[0]);

  test('پراپ ناشناخته دور ریخته می‌شود', () => {
    const { props, findings } = validateProps(headingSpec, { text: 'خوب', evil: 'x' }, 'n1');
    assert.deepEqual(props, { text: 'خوب', level: 'h2' });
    assert.ok(!('evil' in props));
    assert.equal(findings.length, 0);
  });

  test('پراپ ظاهری (`style`) و رویداد (`onclick`) پذیرفته نمی‌شوند', () => {
    const { props, findings } = validateProps(headingSpec, { text: 'x', style: 'color:red', onclick: 'x()' }, 'n1');
    assert.ok(!('style' in props));
    assert.ok(!('onclick' in props));
    const rules = findings.map((finding) => finding.rule);
    assert.equal(rules.filter((rule) => rule === 'security.presentation_prop_ignored').length, 2);
  });

  test('نوع نادرست و مقدار خارج از enum رد می‌شود', () => {
    const wrongType = validateProps(headingSpec, { text: 12 }, 'n1');
    assert.ok(!('text' in wrongType.props));
    assert.ok(wrongType.findings.some((finding) => finding.rule === 'structure.prop_type_mismatch'));

    const wrongEnum = validateProps(headingSpec, { text: 'x', level: 'h9' }, 'n1');
    assert.equal(wrongEnum.props['level'], 'h2');
    assert.ok(wrongEnum.findings.some((finding) => finding.rule === 'structure.prop_enum'));
  });

  test('پراپ الزامیِ غایب، یافته می‌دهد', () => {
    const { findings } = validateProps(headingSpec, {}, 'n1');
    assert.ok(findings.some((finding) => finding.rule === 'structure.required_prop_missing'));
  });

  test('شناسهٔ دارایی نامعتبر رد می‌شود و شناسهٔ درست نرمال می‌شود', () => {
    const spec = parseRegistryRow(SAMPLE_ROWS[2]);
    const bad = validateProps(spec, { alt: 'x', assetId: 'not-a-uuid' }, 'n1');
    assert.ok(!('assetId' in bad.props));

    const good = validateProps(spec, { alt: 'x', assetId: 'B00E67E9-01D3-479F-9BA4-08E3A377BD12' }, 'n1');
    assert.equal(good.props['assetId'], 'b00e67e9-01d3-479f-9ba4-08e3a377bd12');
  });

  test('نویسهٔ کنترلی در متن، رد می‌شود', () => {
    const { props, findings } = validateProps(headingSpec, { text: 'ok\u0007bad' }, 'n1');
    assert.ok(!('text' in props));
    assert.ok(findings.some((finding) => finding.rule === 'security.control_chars'));
  });

  test('`findingsDigest` شمارش ساختاری می‌دهد', () => {
    const digest = findingsDigest([
      { rule: 'a', severity: 'warning', message: '' },
      { rule: 'a', severity: 'warning', message: '' },
      { rule: 'b', severity: 'error', message: '' },
    ]);
    assert.equal(digest, 'a×2 b×1');
  });
});

describe('نشانی‌ها (§68، Addendum §۳۳)', () => {
  test('طرح‌های خطرناک رد می‌شوند', () => {
    for (const href of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'blob:http://localhost/1',
      '//evil.example.com/x',
      '/\\evil.example.com/x',
      'http://user:pass@evil.example.com/',
    ]) {
      assert.equal(sanitizeHref(href), null, href);
    }
  });

  test('طرح‌های مجاز می‌مانند', () => {
    assert.equal(sanitizeHref('/b/pet-shop'), '/b/pet-shop');
    assert.equal(sanitizeHref('#services'), '#services');
    assert.equal(sanitizeHref('tel:+9812345678'), 'tel:+9812345678');
    assert.equal(sanitizeHref('mailto:hi@petavu.ir'), 'mailto:hi@petavu.ir');
    assert.equal(sanitizeHref('https://petavu.ir/x?y=1'), 'https://petavu.ir/x?y=1');
  });

  test('نشانی مطلق در رندر، `rel` محافظ می‌گیرد و نشانی خطرناک چاپ نمی‌شود', () => {
    const links = parseRegistryRow({
      key: 'content.button',
      name_fa: 'دکمه',
      category: 'content',
      status: 'active',
      props_schema: { label: { type: 'string', required: true }, href: { type: 'url' } },
      slots: {},
      performance: { weight_kb: 1 },
    });

    const spec = createRegistry([...SAMPLE_ROWS, {
      key: 'content.button',
      name_fa: 'دکمه',
      category: 'content',
      status: 'active',
      props_schema: { label: { type: 'string', required: true }, href: { type: 'url' } },
      slots: {},
      performance: { weight_kb: 1 },
    }]);

    const scan = scanTree(
      { version: 1, root: [{ id: 'b', component: 'content.button', props: { label: 'برو', href: 'https://example.com/x' } }] },
      { registry: spec },
    );
    const result = renderTree({ scan, registry: spec, strings: {}, data: EMPTY_DATA, pageUrl: 'http://localhost:3000/', locale: 'fa-IR', media: null });
    assert.match(result.html, /rel="noopener noreferrer nofollow"/);
    assert.match(result.html, /target="_blank"/);

    const hostile = scanTree(
      { version: 1, root: [{ id: 'b', component: 'content.button', props: { label: 'برو', href: 'javascript:alert(1)' } }] },
      { registry: spec },
    );
    const hostileResult = renderTree({ scan: hostile, registry: spec, strings: {}, data: EMPTY_DATA, pageUrl: 'http://localhost:3000/', locale: 'fa-IR', media: null });
    assert.ok(!hostileResult.html.includes('javascript:'));
    assert.ok(hostileResult.findings.some((finding) => finding.rule === 'security.href_rejected'));
    void links;
  });
});

/* ------------------------------------------------------------------ واحد: رندر */

describe('رندر درخت (§161–۱۶۹)', () => {
  test('دادهٔ خطرناک از تگ بیرون نمی‌زند', () => {
    const result = render({
      version: 1,
      root: [
        { id: 'h', component: 'content.heading', props: { text: '</h2><script>alert(1)</script><h2>' } },
      ],
    });
    assert.ok(!result.html.includes('<script>'));
    assert.match(result.html, /&lt;script&gt;/);
  });

  test('خروجی، هیچ ویژگی درون‌خطی یا رویداد ندارد', () => {
    const result = render({
      version: 1,
      root: [
        { id: 'h', component: 'content.heading', props: { text: 'x', style: 'color:red', onclick: 'x()' } },
        { id: 's', component: 'layout.section', props: { title: 'بخش' }, slots: { default: [] } },
      ],
    });
    assert.ok(!result.html.includes('style='));
    assert.ok(!result.html.includes('onclick'));
  });

  test('`h1` دوم به `h2` تنزل می‌کند', () => {
    const result = render({
      version: 1,
      root: [
        { id: 'a', component: 'content.heading', props: { text: 'اصل', level: 'h1' } },
        { id: 'b', component: 'content.heading', props: { text: 'دوم', level: 'h1' } },
      ],
    });
    assert.equal((result.html.match(/<h1/g) ?? []).length, 1);
    assert.equal((result.html.match(/<h2/g) ?? []).length, 1);
    assert.ok(result.findings.some((finding) => finding.rule === 'a11y.multiple_h1_downgraded'));
    assert.ok(result.hasH1);
  });

  test('شناسهٔ عنوان و لنگر فهرست مطالب یکی است', () => {
    const result = render({
      version: 1,
      root: [
        { id: 'toc', component: 'navigation.toc', props: { title: 'در این صفحه', depth: '2' } },
        { id: 'h', component: 'content.heading', props: { text: 'بخش یک', level: 'h2' } },
      ],
    });
    const headingId = result.html.match(/<h2 class="ds-heading" id="(h-\d+)"/)?.[1];
    assert.ok(headingId, result.html);
    assert.match(result.html, new RegExp(`href="#${headingId}"`));
  });

  test('نگه‌دارندهٔ شناخته‌شده جانشین و ناشناخته خالی می‌شود', () => {
    const result = render(
      { version: 1, root: [{ id: 'h', component: 'content.heading', props: { text: 'به {business_name} خوش آمدید' } }] },
      { strings: { business_name: 'پت‌شاپ تهران' } },
    );
    assert.match(result.html, /پت‌شاپ تهران/);

    const unknown = render(
      { version: 1, root: [{ id: 'h', component: 'content.heading', props: { text: 'سلام {nope}' } }] },
      { strings: {} },
    );
    assert.ok(!unknown.html.includes('{nope}'));
    assert.ok(unknown.findings.some((finding) => finding.rule === 'content.unknown_placeholder'));
  });

  test('کامپوننت رندرنشدنی، حذف می‌شود و دلیلش ثبت می‌شود', () => {
    const result = render({ version: 1, root: [{ id: 'f', component: 'form.contact_form', props: { title: 'تماس' } }] });
    assert.equal(result.html, '');
    const finding = result.findings.find((entry) => entry.rule === 'component.not_renderable');
    assert.ok(finding);
    assert.match(finding.message, /گام ۳۱/);
    assert.equal(UNRENDERABLE['form.contact_form'] !== undefined, true);
  });

  test('تصویر بدون بُعد یا بدون خوانندهٔ رسانه چاپ نمی‌شود', () => {
    const withoutResolver = render({
      version: 1,
      root: [{ id: 'i', component: 'media.image', props: { alt: 'گربه', assetId: 'b00e67e9-01d3-479f-9ba4-08e3a377bd12' } }],
    });
    assert.equal(withoutResolver.html, '');
    assert.ok(withoutResolver.findings.some((finding) => finding.rule === 'media.storage_unwired'));

    const withResolver = render(
      { version: 1, root: [{ id: 'i', component: 'media.image', props: { alt: 'گربه', assetId: 'b00e67e9-01d3-479f-9ba4-08e3a377bd12', loading: 'eager' } }] },
      {
        media: () => ({ url: '/media/b00e67e9-01d3-479f-9ba4-08e3a377bd12', width: 1200, height: 800, alt: null, kind: 'image' }),
      },
    );
    assert.match(withResolver.html, /width="1200"/);
    assert.match(withResolver.html, /height="800"/);
    assert.match(withResolver.html, /loading="eager"/);
    assert.match(withResolver.html, /fetchpriority="high"/);
  });

  test('وزن صفحه از Registry جمع می‌شود', () => {
    const result = render({
      version: 1,
      root: [
        { id: 'a', component: 'content.heading', props: { text: 'x' } },
        { id: 'b', component: 'layout.section', props: { title: 'y' } },
      ],
    });
    assert.equal(result.weightKb, 3);
  });

  test('`resolvePlaceholders` چند نگه‌دارنده را با هم جانشین می‌کند', () => {
    const report = () => {};
    assert.equal(
      resolvePlaceholders('{a} و {b}', { a: 'یک', b: 'دو' }, report),
      'یک و دو',
    );
  });
});

/* ------------------------------------------------------------------ واحد: رسانه */

describe('رسانه (§75، Addendum §۱۰–۱۴)', () => {
  const base = {
    id: 'b00e67e9-01d3-479f-9ba4-08e3a377bd12',
    driver: 'local',
    storage_key: 'shops/cat.webp',
    bucket: null,
    detected_mime: 'image/webp',
    kind: 'image',
    size_bytes: 100,
    width: 800,
    height: 600,
    alt_text: 'گربه',
    original_name: 'cat.webp',
    checksum_sha256: 'a'.repeat(64),
  };

  test('دارایی بیرونی فقط با `https` نشانی می‌دهد', () => {
    assert.equal(resolveAssetSource({ ...base, driver: 'external', storage_key: 'http://x/y.png' }), null);
    assert.equal(resolveAssetSource({ ...base, driver: 'external', storage_key: 'javascript:alert(1)' }), null);
    assert.equal(resolveAssetSource({ ...base, driver: 'external', storage_key: 'https://user:pass@x/y.png' }), null);
    const ok = resolveAssetSource({ ...base, driver: 'external', storage_key: 'https://cdn.example.com/y.png' });
    assert.deepEqual(ok, { url: 'https://cdn.example.com/y.png', redirect: true });
  });

  test('دارایی بدون بُعد، نمایش‌داده‌شدنی نیست', () => {
    assert.equal(mediaViewOf({ ...base, width: null }), null);
    assert.equal(mediaViewOf({ ...base, height: null }), null);
    assert.ok(mediaViewOf(base) !== null);
  });

  test('دارایی محلی، نشانی درون‌سایتی می‌گیرد', () => {
    const source = resolveAssetSource({ ...base, storage_key: 'business/2026/cat.webp' });
    assert.deepEqual(source, { url: `/media/${base.id}`, redirect: false });
    // کلید مطلق: بیرون از پوشهٔ انبار است، پس پذیرفته نمی‌شود.
    assert.equal(resolveAssetSource({ ...base, storage_key: '/etc/passwd' }), null);
  });

  test('خواندن فایل با نگهبان مسیر (§75)', async () => {
    mkdirSync(join(mediaRoot, 'ok'), { recursive: true });
    writeFileSync(join(mediaRoot, 'ok', 'file.webp'), Buffer.from([1, 2, 3, 4]));

    const file = await readLocalMedia(mediaRoot, 'ok/file.webp', { contentType: 'image/webp' });
    assert.equal(file?.sizeBytes, 4);
    assert.equal(file?.disposition, 'inline');

    // پیمایش مسیر: بیرون از پوشهٔ انبار.
    const escaped = await readLocalMedia(mediaRoot, '../secret.webp', { contentType: 'image/webp' });
    assert.equal(escaped, null);

    const hostile = await readLocalMedia(mediaRoot, 'ok/none.webp', { contentType: 'text/html' });
    assert.equal(hostile, null);

    const attachment = await readLocalMedia(mediaRoot, 'ok/file.webp', { contentType: 'text/html' });
    assert.equal(attachment?.disposition, 'attachment');
    assert.ok(!INLINE_MIME.has('text/html'));
    assert.ok(!INLINE_MIME.has('image/svg+xml'));
  });

  test('سرصفحه‌های رسانه، کش یک‌ساله و `nosniff` دارند', () => {
    const headers = mediaHeaders({
      sizeBytes: 12,
      contentType: 'image/webp',
      disposition: 'inline',
      etag: '"abc"',
      fileName: 'my cat.webp',
    });
    assert.equal(headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.equal(headers['x-content-type-options'], 'nosniff');
    assert.match(headers['content-disposition'] ?? '', /filename="my_cat.webp"/);
  });
});

/* ------------------------------------------------------------------ واحد: زمینه */

describe('زمینهٔ کسب‌وکار برای بلوک تماس', () => {
  test('ساعات کار از شکل واقعی jsonb خوانده می‌شود', () => {
    assert.deepEqual(formatHours({ sat: { open: '09:00', close: '18:00' } }), ['شنبه 09:00–18:00']);
    assert.deepEqual(
      formatHours({ sat: [{ open: '09:00', close: '13:00' }, { open: '16:00', close: '20:00' }] }),
      ['شنبه 09:00–13:00، 16:00–20:00'],
    );
    assert.deepEqual(formatHours({ unknown_day: { open: '1', close: '2' } }), []);
    assert.deepEqual(formatHours(null), []);
  });

  test('نشانی راه تماس فقط برای شکل‌های شناخته‌شده ساخته می‌شود', () => {
    assert.equal(contactHref('phone', '۰۲۱-۱۲۳۴۵۶۷۸'), null); // ارقام فارسی: حدس نمی‌زنیم
    assert.equal(contactHref('phone', '021-12345678'), 'tel:02112345678');
    assert.equal(contactHref('whatsapp', '+98 912 000 0000'), 'https://wa.me/989120000000');
    assert.equal(contactHref('website', 'http://insecure.example.com'), null);
    assert.equal(contactHref('website', 'https://petavu.ir'), 'https://petavu.ir');
    assert.equal(contactHref('fax', '02112345678'), null);
  });

  test('نمای کسب‌وکار، فقط دادهٔ موجود را می‌آورد', () => {
    const view = buildBusinessView(
      {
        id: 'b1', slug: 'pet-shop', name: 'پت‌شاپ', name_latin: null, business_type_key: 'pet_shop',
        industry_key: null, verification_level: 'none', listing_count: 0, member_count: 1,
        published_at: null, updated_at: '2026-01-01T00:00:00Z', tagline: null, summary: null,
        founded_year: null, city_name: 'تهران', city_slug: 'tehran',
      },
      [{ label: 'مرکزی', address_line: 'خیابان ولیعصر', latitude: '35.7', longitude: '51.4', hours: { sat: { open: '09:00', close: '18:00' } }, is_primary: true }],
      [{ kind: 'phone', value_display: '02112345678', label: null, is_public: true }],
      'http://localhost:3000',
    );

    assert.equal(view.address, 'خیابان ولیعصر');
    assert.equal(view.latitude, 35.7);
    assert.equal(view.hours[0], 'شنبه 09:00–18:00');
    assert.equal(view.contacts[0]?.label, 'تلفن');
    assert.equal(view.contacts[0]?.href, 'tel:02112345678');
  });
});

/* ------------------------------------------------------------------ واحد: چیدمان */

describe('CSS کامپوننت‌های طراحی (§45–۴۷)', () => {
  test('کلاس‌های درخت در CSS تعریف شده‌اند', () => {
    for (const className of ['.ds-block', '.ds-grid', '.ds-hero', '.ds-figure', '.ds-faq', '.ds-toc', '.ds-gallery', '.ds-table']) {
      assert.ok(SHELL_CSS.includes(className), className);
    }
  });

  test('هیچ رنگ خامی بیرون از بلوک چاپ نیست', () => {
    const printStart = SHELL_CSS.indexOf('@media print');
    assert.ok(printStart > 0);
    const outside = SHELL_CSS.slice(0, printStart).replace(/var\([^)]*\)/g, '');
    const colors = [...new Set([...outside.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0]))];
    assert.deepEqual(colors, []);
  });

  test('مسیر رسانه فقط شناسه می‌پذیرد و روی پنل بسته است', () => {
    assert.deepEqual(resolveTarget('/media/b00e67e9-01d3-479f-9ba4-08e3a377bd12', 'public'), {
      type: 'media',
      id: 'b00e67e9-01d3-479f-9ba4-08e3a377bd12',
    });
    assert.equal(resolveTarget('/media/../../etc/passwd', 'public').type, 'not_found');
    assert.equal(resolveTarget('/media/b00e67e9-01d3-479f-9ba4-08e3a377bd12', 'panel').type, 'not_found');
    assert.equal(decodePath('/media/%2e%2e%2fsecret'), null);
  });

  test('کش Registry، بارگذاری را تکرار نمی‌کند', async () => {
    let calls = 0;
    const cache = createRegistryCache({
      ttlMs: 1000,
      load: async () => {
        calls += 1;
        return SAMPLE_ROWS;
      },
    });

    const first = await cache.get();
    const second = await cache.get();
    assert.equal(calls, 1);
    assert.equal(first.size, second.size);
    assert.ok(first.size >= 5);

    cache.invalidate();
    await cache.get();
    assert.equal(calls, 2);
  });

  test('شکست بارگذاری Registry، استقرار را نمی‌شکند', async () => {
    const cache = createRegistryCache({
      load: async () => {
        throw new Error('پایگاه‌داده در دسترس نیست');
      },
    });
    const empty = await cache.get();
    assert.equal(empty.size, 0);
  });
});

/* ------------------------------------------------------------------ یکپارچه */

let engine;
let client;
let server;
let ownerUserId;

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
      withTransaction: (fn) => runner.withTransaction(async (tx) => fn(make(tx))),
      async asRole(role, fn) {
        await runner.exec(`set role "${role}"`);
        try {
          return await fn(scoped);
        } finally {
          await runner.exec('reset role').catch(() => {});
        }
      },
      close: () => handle.close(),
    };
    return scoped;
  };
  return make(handle);
}

async function asRole(role, sql, params = [], context = {}) {
  const settings = Object.entries(context).filter(([, value]) => typeof value === 'string');
  return client.withTransaction(async (tx) => {
    if (settings.length > 0) {
      const args = [];
      const assignments = settings.map(([key, value]) => {
        args.push(key, value);
        return `set_config($${args.length - 1}, $${args.length}, true)`;
      });
      await tx.query(`select ${assignments.join(', ')}`, args);
    }
    return tx.asRole(role, async () => {
      const result = await tx.query(sql, params);
      return result.rows;
    });
  });
}

const ADMIN_CONTEXT = () => ({
  'app.user_id': ownerUserId,
  'app.platform_role': 'superadmin',
  'app.request_id': uuidv7(),
});

// Legacy/corrupt DB fixture: owner-only setup tests the renderer's defence in depth.
// Production pv_app is explicitly forbidden to insert/delete/modify live pages (studio.test).
async function publishPage({ key, businessId = null, scope = 'platform', tree, isSystem = true }) {
  await engine.query(`delete from design.page where key=$1 and business_id is not distinct from $2::uuid`,[key,businessId]);
  const rows=await engine.query(`insert into design.page(key,title,scope,is_system,business_id,status,draft_tree,published_tree,published_at,published_by) values($1,$2,$3,$4,$5,'published',$6::jsonb,$6::jsonb,now(),$7) returning id`,[key,`صفحهٔ ${key}`,scope,isSystem,businessId,JSON.stringify(tree),ownerUserId]);
  return rows[0].id;
}

async function fetchPage(path) {
  const response = await server.render({ method: 'GET', url: path, host: PUBLIC_HOST });
  return response;
}

before(async () => {
  engine = await openDatabase();
  await migrate(engine, { dir: join(projectRoot, 'migrations') });
  await applySeeds(engine, { dir: join(projectRoot, 'seeds') });
  client = createEmbeddedClient(engine);

  /*
   * کاربر از **مسیر واقعی** ثبت‌نام ساخته می‌شود، نه با چیدن ردیف: هویت و
   * کاربر دو چیزند (§6) و جدول `auth.app_user` ستون ایمیل ندارد؛ ایمیل در
   * `auth.identity` است. مسیر دامنه، همان چیزی است که تولید هم می‌رود.
   */
  const registrationContext = { 'app.request_id': uuidv7() };
  const tickets = await asRole(
    'pv_app',
    'select * from app.begin_registration($1, $2, null)',
    [hashIdentifier('designer@petavu.test'), 'email'],
    registrationContext,
  );
  const secret = await passwords.hash('Correct-Horse-Designer-1!');
  const created = await asRole(
    'pv_app',
    'select user_id from app.complete_registration($1, $2, $3, $4, $5)',
    [tickets[0].ticket_id, 'طراح آزمون', secret, 'fa-IR', 'Asia/Tehran'],
    registrationContext,
  );
  ownerUserId = created[0].user_id;

  const business = await asRole(
    'pv_app',
    `insert into app.business (slug, name, business_type_key, owner_user_id, status, visibility, published_at)
     values ('design-shop', 'پت‌شاپ طراحی', 'pet_shop', $1, 'active', 'public', now())
     returning id`,
    [ownerUserId],
    ADMIN_CONTEXT(),
  );
  const businessId = business[0].id;

  await asRole(
    'pv_app',
    `insert into app.business_profile (business_id, tagline, summary) values ($1, 'نزدیک تو', 'توضیح کوتاه')`,
    [businessId],
    ADMIN_CONTEXT(),
  );

  await asRole(
    'pv_app',
    `insert into app.business_location (business_id, location_id, address_line, latitude, longitude, hours, is_primary)
     values ($1, (select l.id from ref.location l where l.slug = 'tehran' limit 1),
             'خیابان ولیعصر، پلاک ۱', 35.7, 51.4, '{"sat":{"open":"09:00","close":"18:00"}}'::jsonb, true)`,
    [businessId],
    ADMIN_CONTEXT(),
  );

  // مکان اصلی را به همان شعبه وصل می‌کنیم تا `{city}` از اتصال واقعی بیاید.
  await asRole(
    'pv_app',
    `update app.business b
        set primary_location_id = (select l.id from ref.location l where l.slug = 'tehran' limit 1)
      where b.id = $1`,
    [businessId],
    ADMIN_CONTEXT(),
  );

  await asRole(
    'pv_app',
    `insert into app.business_contact (business_id, kind, value_key, value_display, is_public)
     values ($1, 'phone', '02112345678', '021-12345678', true)`,
    [businessId],
    ADMIN_CONTEXT(),
  );

  server = createWebServer({
    client,
    env,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    assetsDirectory,
    now: () => new Date('2026-10-03T09:00:00Z'),
  });

  await server.listen(0, '127.0.0.1');
});

after(async () => {
  await server.close();
  await client.close();
  rmSync(mediaRoot, { recursive: true, force: true });
});

describe('رندر درخت منتشرشده روی صفحهٔ واقعی', () => {
  test('Registry از پایگاه‌داده بار می‌شود و کل کامپوننت‌های seed را دارد', async () => {
    const loaded = await server.componentRegistry();
    assert.ok(loaded.size >= 40, `تعداد Registry: ${loaded.size}`);
    assert.ok(loaded.has('content.hero'));
    assert.ok(loaded.has('layout.section'));
    assert.ok(!loaded.has('content.removed_component'));
  });

  test('صفحهٔ اصلی سراسری از درخت منتشرشده رندر می‌شود', async () => {
    await publishPage({
      key: 'home',
      tree: {
        version: 1,
        root: [
          { id: 'hero', component: 'content.hero', props: { title: 'خانهٔ {business_name}', subtitle: 'زیرعنوان طراحی', primaryCta: { label: 'کسب‌وکارها', href: '/businesses' } } },
          { id: 'sec', component: 'layout.section', props: { title: 'از درخت، نه از کد' }, slots: { default: [
            { id: 'p1', component: 'content.paragraph', props: { text: 'این متن از درخت JSON آمده است.' } },
          ] } },
        ],
      },
    });

    const response = await fetchPage('/');
    assert.equal(response.status, 200);
    // برند در جای نگه‌دارنده نشسته است (با هر اعراب‌گذاری‌ای که برند رسمی دارد).
    assert.match(response.body, /ds-hero__title">خانهٔ پ/);
    assert.match(response.body, /از درخت، نه از کد/);
    assert.match(response.body, /این متن از درخت JSON آمده است/);
    // چیدمان پایه جای خود را داده است.
    assert.ok(!response.body.includes('hero__eyebrow'));

    await engine.query(`delete from design.page p where p.key = 'home' and p.business_id is null`, []);
  });

  test('پیش‌نویس منتشرنشده رندر نمی‌شود', async () => {
    /*
     * پیش‌نویسِ صفحهٔ اصلی پلتفرم: رکورد هست، ولی منتشر نشده. صفحه باید
     * **چیدمان پایه** را بیاورد. این آزمون، مرز «پیش‌نویس در برابر منتشرشده»
     * را می‌سنجد — همان مرزی که §36 روی آن تأکید دارد.
     */
    await asRole(
      'pv_app',
      `insert into design.page (key, title, scope, is_system, status, draft_tree)
       values ('home', 'صفحهٔ اصلی', 'platform', true, 'draft', '{"version":1,"root":[{"id":"h","component":"content.heading","props":{"text":"پیش‌نویس محرمانه"}}]}'::jsonb)`,
      [],
      ADMIN_CONTEXT(),
    );

    const response = await fetchPage('/');
    assert.equal(response.status, 200);
    assert.ok(!response.body.includes('پیش‌نویس محرمانه'));
    assert.match(response.body, /hero__eyebrow/);

    await engine.query(`delete from design.page p where p.key = 'home' and p.business_id is null`, []);
  });

  test('درخت کسب‌وکار با نگه‌دارنده‌های واقعی رندر می‌شود', async () => {
    const business = await asRole('pv_app', `select id from app.business b where b.slug = 'design-shop'`, [], ADMIN_CONTEXT());
    const businessId = business[0].id;

    await publishPage({
      key: 'home',
      businessId,
      scope: 'business',
      isSystem: false,
      tree: {
        version: 1,
        root: [
          { id: 'hero', component: 'content.hero', props: { title: '{business_name}', subtitle: '{tagline} در {city}' } },
          { id: 'contact', component: 'content.contact_block', props: { title: 'تماس با {business_name}', showMap: true, showHours: true } },
          { id: 'map', component: 'content.map', props: { latitude: 35.7, longitude: 51.4, title: 'موقعیت' } },
        ],
      },
    });

    const response = await fetchPage('/b/design-shop');
    assert.equal(response.status, 200);
    assert.match(response.body, /پت‌شاپ طراحی/);
    assert.match(response.body, /نزدیک تو در تهران/);
    assert.match(response.body, /خیابان ولیعصر، پلاک ۱/);
    assert.match(response.body, /021-12345678/);
    assert.match(response.body, /شنبه 09:00–18:00/);
    // نقشه، بدون کد بیرونی و بدون iframe.
    assert.ok(!response.body.includes('<iframe'));
    assert.match(response.body, /openstreetmap\.org/);

    await engine.query(`delete from design.page p where p.key = 'home' and p.business_id = $1`, [businessId]);
  });

  test('درخت کسب‌وکار روی پروفایل کسب‌وکار دیگر اثر نمی‌گذارد', async () => {
    const business = await asRole('pv_app', `select id from app.business b where b.slug = 'design-shop'`, [], ADMIN_CONTEXT());
    const businessId = business[0].id;

    await publishPage({
      key: 'home',
      businessId,
      scope: 'business',
      isSystem: false,
      tree: { version: 1, root: [{ id: 'h', component: 'content.heading', props: { text: 'فقط برای این کسب‌وکار', level: 'h1' } }] },
    });

    const other = await asRole(
      'pv_app',
      `insert into app.business (slug, name, business_type_key, owner_user_id, status, visibility, published_at)
       values ('design-other', 'کسب‌وکار دیگر', 'pet_shop', $1, 'active', 'public', now())
       returning id`,
      [ownerUserId],
      ADMIN_CONTEXT(),
    );

    const response = await fetchPage('/b/design-other');
    assert.equal(response.status, 200);
    assert.ok(!response.body.includes('فقط برای این کسب‌وکار'));

    await engine.query(`delete from design.page p where p.key = 'home' and p.business_id = $1`, [businessId]);
    await asRole('pv_app', `delete from app.business b where b.slug = 'design-other'`, [], ADMIN_CONTEXT());
    assert.ok(other.length === 1);
  });

  test('درخت خطرناک منتشرشده هم از تگ بیرون نمی‌زند', async () => {
    await publishPage({
      key: 'home',
      tree: {
        version: 1,
        root: [
          { id: 'h', component: 'content.heading', props: { text: '</h1><script>alert(1)</script>', level: 'h1', style: 'color:red' } },
          { id: 'p', component: 'content.paragraph', props: { text: '<img src=x onerror=alert(1)>', size: 'lg', onclick: 'alert(1)' } },
        ],
      },
    });

    const response = await fetchPage('/');
    assert.equal(response.status, 200);
    assert.ok(!response.body.includes('<script>alert(1)</script>'));
    assert.ok(!response.body.includes('<img src=x'));
    assert.ok(!response.body.includes('style="color:red"'));
    assert.match(response.body, /&lt;script&gt;/);
    assert.match(response.body, /&lt;img src=x onerror=alert\(1\)&gt;/);

    await engine.query(`delete from design.page p where p.key = 'home' and p.business_id is null`, []);
  });

  test('درخت با کامپوننت رندرنشدنی، صفحه را نمی‌شکند', async () => {
    await publishPage({
      key: 'home',
      tree: {
        version: 1,
        root: [
          { id: 'h', component: 'content.heading', props: { text: 'صفحهٔ نیمه‌کاره', level: 'h1' } },
          { id: 'f', component: 'form.contact_form', props: { title: 'تماس' } },
          { id: 'c', component: 'commerce.cart_button', props: { label: 'سبد' } },
        ],
      },
    });

    const response = await fetchPage('/');
    assert.equal(response.status, 200);
    assert.match(response.body, /صفحهٔ نیمه‌کاره/);
    assert.ok(!response.body.includes('form'));

    await engine.query(`delete from design.page p where p.key = 'home' and p.business_id is null`, []);
  });
});

describe('رسانه روی وب', () => {
  test('دارایی عمومی محلی، با کش یک‌ساله سرو می‌شود', async () => {
    mkdirSync(join(mediaRoot, 'shops'), { recursive: true });
    writeFileSync(join(mediaRoot, 'shops', 'photo.webp'), Buffer.from([82, 73, 70, 70, 1, 2, 3, 4]));

    const rows = await asRole(
      'pv_app',
      `insert into media.asset (business_id, uploaded_by, storage_key, driver, detected_mime, kind, size_bytes,
                                width, height, alt_text, original_name, is_public, status, scan_status, checksum_sha256)
       values (null, $1, 'shops/photo.webp', 'local', 'image/webp', 'image', 8, 800, 600, 'گربه', 'photo.webp', true, 'ready', 'clean', $2)
       returning id`,
      [ownerUserId, 'b'.repeat(64)],
      ADMIN_CONTEXT(),
    );
    const assetId = rows[0].id;

    const response = await server.render({ method: 'GET', url: `/media/${assetId}`, host: PUBLIC_HOST });
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'image/webp');
    assert.equal(response.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['content-length'], '8');
    assert.ok(Buffer.isBuffer(response.bytes));
    assert.equal(response.bytes.byteLength, 8);

    // مسیر رسانه روی میزبان پنل، وجود ندارد.
    const onPanel = await server.render({ method: 'GET', url: `/media/${assetId}`, host: 'panel.localhost:3000' });
    assert.equal(onPanel.status, 404);

    // شناسهٔ نامعتبر ⇒ ۴۰۴ بی‌کوئری.
    const badId = await server.render({ method: 'GET', url: '/media/not-a-uuid', host: PUBLIC_HOST });
    assert.equal(badId.status, 404);

    await asRole('pv_app', `delete from media.asset a where a.id = $1`, [assetId], ADMIN_CONTEXT());
  });

  test('دارایی قرنطینه‌شده یا خصوصی، برای بی‌نام وجود ندارد', async () => {
    const rows = await asRole(
      'pv_app',
      `insert into media.asset (business_id, uploaded_by, storage_key, driver, detected_mime, kind, size_bytes,
                                width, height, is_public, status, scan_status)
       values (null, $1, 'shops/private.webp', 'local', 'image/webp', 'image', 8, 10, 10, false, 'ready', 'clean')
       returning id`,
      [ownerUserId],
      ADMIN_CONTEXT(),
    );
    const assetId = rows[0].id;

    const response = await server.render({ method: 'GET', url: `/media/${assetId}`, host: PUBLIC_HOST });
    assert.equal(response.status, 404);

    await asRole('pv_app', `delete from media.asset a where a.id = $1`, [assetId], ADMIN_CONTEXT());
  });

  test('دارایی بیرونی، هدایت می‌شود نه اینکه از دامنهٔ ما سرو شود', async () => {
    const rows = await asRole(
      'pv_app',
      `insert into media.asset (business_id, uploaded_by, storage_key, driver, detected_mime, kind, size_bytes,
                                width, height, is_public, status, scan_status)
       values (null, $1, 'https://cdn.example.com/pet.png', 'external', 'image/png', 'image', 100, 20, 20, true, 'ready', 'clean')
       returning id`,
      [ownerUserId],
      ADMIN_CONTEXT(),
    );
    const assetId = rows[0].id;

    const response = await server.render({ method: 'GET', url: `/media/${assetId}`, host: PUBLIC_HOST });
    assert.equal(response.status, 302);
    assert.equal(response.headers['location'], 'https://cdn.example.com/pet.png');

    await asRole('pv_app', `delete from media.asset a where a.id = $1`, [assetId], ADMIN_CONTEXT());
  });

  test('دارایی بدون فایل روی دیسک ⇒ ۴۰۴ (نه ۵۰۰)', async () => {
    const rows = await asRole(
      'pv_app',
      `insert into media.asset (business_id, uploaded_by, storage_key, driver, detected_mime, kind, size_bytes,
                                width, height, is_public, status, scan_status)
       values (null, $1, 'shops/missing.webp', 'local', 'image/webp', 'image', 8, 10, 10, true, 'ready', 'clean')
       returning id`,
      [ownerUserId],
      ADMIN_CONTEXT(),
    );
    const assetId = rows[0].id;

    const response = await server.render({ method: 'GET', url: `/media/${assetId}`, host: PUBLIC_HOST });
    assert.equal(response.status, 404);

    await asRole('pv_app', `delete from media.asset a where a.id = $1`, [assetId], ADMIN_CONTEXT());
  });
});

describe('رندرکننده‌ها پوشش Registry را کامل می‌کنند', () => {
  test('هر کامپوننت فعال یا رندرکننده دارد یا دلیلِ مستندِ رندرنشدن', async () => {
    const loaded = await server.componentRegistry();
    const missing = [];

    for (const key of loaded.keys) {
      const spec = loaded.get(key);
      if (!spec || spec.status !== 'active') continue;
      if (RENDERERS[key] || UNRENDERABLE[key]) continue;
      missing.push(key);
    }

    assert.deepEqual(missing, [], `کامپوننت بدون رندرکننده: ${missing.join(', ')}`);
  });

  test('دلایل رندرنشدن، همگی به گام آینده ارجاع می‌دهند', () => {
    for (const [key, reason] of Object.entries(UNRENDERABLE)) {
      assert.ok(reason.length > 10, key);
      assert.match(reason, /گام/);
    }
  });
});
