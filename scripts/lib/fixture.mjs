/**
 * فیکسچر مشترک آزمون‌های وب و پنل (گام ۲۵ به بعد).
 *
 * چرا این‌جا و نه زیر `tests/`: اجراکنندهٔ تست نود، هر فایلِ زیر `tests/` را
 * یک پروندهٔ آزمون می‌شمارد؛ فایل کمکی آن‌جا «آزمونِ بی‌آزمون» می‌شد. کنار
 * `engine.mjs` و `migrate.mjs` جای درستش است (همان ابزارهایی که آزمون‌ها
 * از قبل از این پوشه می‌خوانند).
 *
 * اصل: **همان مسیر واقعی.** پایگاه‌داده از صفر با همهٔ مهاجرت‌ها و seedها ساخته
 * می‌شود؛ کاربر از راه `begin_registration/complete_registration` می‌آید؛
 * کسب‌وکار با سیاست درج همان نقش. هیچ ردیفی دور زده نمی‌شود، مگر در «چیدن
 * پیش‌شرط» که صریحاً `sudo` نام دارد.
 */

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createEmbeddedClient } from './embedded-client.mjs';
import { openDatabase } from './engine.mjs';
import { migrate } from './migrate.mjs';
import { applySeeds } from './seed.mjs';

import { createApiServer } from '../../apps/api/dist/index.js';
import { createWebServer } from '../../apps/web/dist/index.js';
import { loadEnv, silentLogger, uuidv7 } from '../../packages/shared/dist/index.js';
import { createPasswordHasher, TEST_ARGON2, hashIdentifier } from '../../packages/security/dist/index.js';

const projectRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
export const assetsDirectory = join(projectRoot, 'apps/web/assets');

export const PEPPER = 'test-pepper-value';

export const HOSTS = Object.freeze({
  public: 'localhost:3000',
  panel: 'panel.localhost:3000',
  admin: 'adminpanel.localhost:3000',
  shop: 'shop.localhost:3000',
  adminShop: 'adminshop.localhost:3000',
});

export function testEnv(overrides = {}) {
  return loadEnv({
    PETAVU_ENV: 'test',
    AUTH_PEPPER: PEPPER,
    SESSION_SECRET: 'test-session-secret-value-0123456789',
    PETAVU_PUBLIC_ORIGIN: `http://${HOSTS.public}`,
    PETAVU_PANEL_ORIGIN: `http://${HOSTS.panel}`,
    PETAVU_ADMIN_ORIGIN: `http://${HOSTS.admin}`,
    PETAVU_SHOP_ORIGIN: `http://${HOSTS.shop}`,
    PETAVU_ADMIN_SHOP_ORIGIN: `http://${HOSTS.adminShop}`,
    ...overrides,
  });
}

export const PRODUCTION_HOST = 'petavu.example';

/** محیط تولید برای آزمودن دروازه‌های نمایه‌شدن (دامنه‌ها و رازها ساختگی‌اند؛ فقط در حافظه). */
export function productionEnv(overrides = {}, host = PRODUCTION_HOST) {
  return loadEnv({
    PETAVU_ENV: 'production',
    AUTH_PEPPER: 'production-pepper-value-0123456789abcdef',
    SESSION_SECRET: 'production-session-secret-0123456789abcdef',
    PETAVU_PUBLIC_ORIGIN: `https://${host}`,
    PETAVU_PANEL_ORIGIN: `https://panel.${host}`,
    PETAVU_ADMIN_ORIGIN: `https://adminpanel.${host}`,
    PETAVU_SHOP_ORIGIN: `https://shop.${host}`,
    PETAVU_ADMIN_SHOP_ORIGIN: `https://adminshop.${host}`,
    ...overrides,
  });
}

export { createEmbeddedClient };

/** ابزارهای خواندن HTML در آزمون (بدون DOM؛ فقط الگوهایی که معنا دارند). */
export const html = {
  meta(doc, name) {
    const head = doc.slice(0, doc.indexOf('</head>'));
    return new RegExp(`<meta name="${name}" content="([^"]*)"`).exec(head)?.[1] ?? null;
  },
  canonical(doc) {
    const head = doc.slice(0, doc.indexOf('</head>'));
    return /<link rel="canonical" href="([^"]*)"/.exec(head)?.[1] ?? null;
  },
  title(doc) {
    return /<title>([^<]*)<\/title>/.exec(doc)?.[1] ?? null;
  },
  h1s(doc) {
    return [...doc.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((match) => match[1].replace(/<[^>]+>/g, '').trim());
  },
  hrefs(doc) {
    return [...doc.matchAll(/<a [^>]*href="([^"]+)"/g)].map((match) => match[1]);
  },
  ids(doc) {
    return [...doc.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  },
  jsonLd(doc) {
    return [...doc.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
  },
};

/**
 * ساخت فیکسچر کامل.
 *
 * `api: true` سرور API را هم بالا می‌آورد (برای پنل‌ها که کلاینتِ همان API‌اند).
 */
export async function createFixture(options = {}) {
  /*
   * `storage: true` ⇒ پوشهٔ موقتِ واقعی برای رسانهٔ محلی (و نسخه‌های تصویر کنارش). بی‌آن،
   * مسیر پیش‌فرض `./.data/media` نسبت به cwd است و آزمون‌ها در مخزن می‌نویسند.
   */
  const storageRoot = options.storage ? await mkdtemp(join(tmpdir(), 'petavu-storage-')) : null;
  const storageDir = storageRoot ? join(storageRoot, 'media') : null;
  if (storageDir) await mkdir(storageDir, { recursive: true });
  const env = options.env ?? testEnv(storageDir ? { STORAGE_LOCAL_DIR: storageDir } : {});
  const logger = options.logger ?? silentLogger();
  const engine = await openDatabase();
  await migrate(engine, { dir: join(projectRoot, 'migrations') });
  await applySeeds(engine, { dir: join(projectRoot, 'seeds') });
  const client = createEmbeddedClient(engine);
  const passwords = createPasswordHasher({ params: TEST_ARGON2, pepper: PEPPER });

  /** SQL خام با نقش و زمینهٔ دلخواه. */
  async function asRole(role, sql, params = [], context = {}) {
    const settings = Object.entries(context).filter(([, value]) => typeof value === 'string' && value !== '');
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

  /** «چیدن پیش‌شرط» با دسترسی کامل — فقط برای داده‌ای که مسیر دامنه‌اش جای دیگری آزموده می‌شود. */
  const sudo = (sql, params = []) => engine.query(sql, params);

  /** ثبت‌نام کاربر از همان مسیر واقعی (بلیت ⇒ تکمیل). */
  async function registerUser({ email, name = 'کاربر آزمایشی', password = 'Correct-Horse-Battery-1!' }) {
    const context = { 'app.request_id': uuidv7() };
    const tickets = await asRole('pv_app', 'select * from app.begin_registration($1, $2, null)', [hashIdentifier(email), 'email'], context);
    const secret = await passwords.hash(password);
    const created = await asRole(
      'pv_app',
      'select user_id from app.complete_registration($1, $2, $3, $4, $5)',
      [tickets[0].ticket_id, name, secret, 'fa-IR', 'Asia/Tehran'],
      context,
    );
    return { userId: created[0].user_id, email, password, name };
  }

  /**
   * کسب‌وکار با ویژگی‌های دلخواه.
   *
   * نقش `superadmin` فقط برای چیدن پیش‌شرط است (همان توجیه تست‌های وب): مسیر
   * عادی، عضویت را با ایجاد کسب‌وکار می‌سازد.
   */
  async function createBusiness({
    slug,
    name,
    ownerUserId,
    typeKey = 'pet_shop',
    industryKey = null,
    locationPath = null,
    status = 'active',
    visibility = 'public',
    tagline = null,
    summary = null,
    nameLatin = null,
    keywords = [],
  }) {
    const context = { 'app.user_id': ownerUserId, 'app.platform_role': 'superadmin', 'app.request_id': uuidv7() };
    const locationId = locationPath
      ? (await sudo('select id from ref.location where path = $1', [locationPath]))[0]?.id ?? null
      : null;
    if (locationPath && !locationId) throw new Error(`مکان ناموجود در fixture: ${locationPath}`);

    const rows = await asRole(
      'pv_app',
      `insert into app.business (slug, name, name_latin, business_type_key, industry_key, primary_location_id, owner_user_id, status, visibility, published_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, case when $8 = 'active' then now() else null end)
       returning id`,
      [slug, name, nameLatin, typeKey, industryKey, locationId, ownerUserId, status, visibility],
      context,
    );
    const businessId = rows[0].id;
    await asRole(
      'pv_app',
      `insert into app.business_profile (business_id, tagline, summary, keywords) values ($1, $2, $3, $4)`,
      [businessId, tagline ?? `معرفی ${name}`, summary ?? `توضیح کوتاه دربارهٔ ${name}`, keywords],
      context,
    );
    return businessId;
  }

  /** عضویت فعال با نقش سیستمی (`owner`، `admin`، `editor`، `viewer`، …)؛ چیدن پیش‌شرط. */
  async function addMember({ businessId, userId, roleKey }) {
    const rows = await sudo(
      `insert into app.membership (business_id, user_id, role_id, status, joined_at)
       select $1, $2, r.id, 'active', now() from app.role r where r.business_id is null and r.key = $3
       on conflict do nothing
       returning id`,
      [businessId, userId, roleKey],
    );
    return rows[0]?.id ?? null;
  }

  /** محتوای منتشرشده (پلتفرم یا کسب‌وکار) با دسته‌ها؛ چیدن پیش‌شرط، نه آزمون چرخهٔ عمر. */
  async function createContent({ businessId = null, kind = 'article', slug, title, summary = null, categoryPaths = [] }) {
    const rows = await sudo(
      `insert into app.content (business_id, kind, slug, title, summary, body, body_text, status, visibility, locale, published_at, author_display)
       values ($1, $2, $3, $4, $5, '{"blocks":[{"kind":"paragraph","text":"متن"}]}'::jsonb, $4, 'published', 'public', 'fa-IR', now(), 'آزمون')
       returning id`,
      [businessId, kind, slug, title, summary],
    );
    const contentId = rows[0].id;
    for (const path of categoryPaths) {
      await sudo(
        `insert into app.content_category (content_id, category_id)
         select $1, c.id from ref.category c where c.path = $2 and c.scope = 'content' and c.business_id is null`,
        [contentId, path],
      );
    }
    return contentId;
  }

  /**
   * دارایی تصویر **واقعی**: فایل روی دیسک انبار، ردیف `media.asset` با درهم و بُعد درست.
   * (چیدن پیش‌شرط؛ مسیر آپلود امن در گام‌های بعد است.)
   */
  async function createImageAsset({ bytes, mime, width, height, name = 'photo', alt = null, businessId = null }) {
    if (!storageDir) throw new Error('createFixture({ storage: true }) لازم است');
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const key = `img/${checksum.slice(0, 2)}/${checksum}`;
    await mkdir(join(storageDir, 'img', checksum.slice(0, 2)), { recursive: true });
    await writeFile(join(storageDir, key), bytes);
    const rows = await sudo(
      `insert into media.asset (business_id, storage_key, driver, original_name, declared_mime, detected_mime, kind, size_bytes, checksum_sha256, width, height, alt_text, is_public, status, scan_status)
       values ($1, $2, 'local', $3, $4, $4, 'image', $5, $6, $7, $8, $9, true, 'ready', 'clean')
       returning id`,
      [businessId, key, `${name}.${mime === 'image/png' ? 'png' : 'jpg'}`, mime, bytes.length, checksum, width, height, alt],
    );
    return { id: rows[0].id, checksum, key, version: checksum.slice(0, 12) };
  }

  /** صفحهٔ طراحیِ منتشرشده (چیدن پیش‌شرط؛ چرخهٔ انتشار در `design` آزموده می‌شود). */
  async function publishDesignPage({ key, tree, businessId = null }) {
    await sudo(`delete from design.page where key = $1 and business_id is not distinct from $2::uuid`, [key, businessId]);
    const rows = await sudo(
      `insert into design.page (key, title, scope, is_system, business_id, status, draft_tree, published_tree, published_at)
       values ($1, $2, $3, $4, $5, 'published', $6::jsonb, $6::jsonb, now())
       returning id`,
      [key, `صفحهٔ ${key}`, businessId ? 'business' : 'platform', businessId === null, businessId, JSON.stringify(tree)],
    );
    return rows[0].id;
  }

  // اگر API می‌خواهیم، **اول** آن را بالا می‌آوریم: رلهٔ وب (بیکن عملکرد) به همین مبدأ می‌رود.
  let api = null;
  if (options.api) {
    const server = createApiServer({ client, env, logger, lightweightPasswords: true, rateLimit: false });
    const listening = await server.listen(0, '127.0.0.1');
    api = { server, url: listening.url, port: listening.port };
  }

  const web = createWebServer({
    client,
    env,
    logger,
    assetsDirectory,
    now: () => new Date('2026-10-03T09:00:00Z'),
    ...(api ? { apiOrigin: api.url } : {}),
    imageConfigTtlMs: 0,
    ...(options.imageEngine ? { imageEngine: options.imageEngine } : {}),
  });
  await web.listen(0, '127.0.0.1');

  /** رندر بدون سوکت؛ `host` همان‌طور که مرورگر می‌فرستد. */
  const page = async (path, { host = HOSTS.public, server = web, headers } = {}) => {
    const result = await server.render({ method: 'GET', url: path, host, headers });
    return { ...result, get: (name) => result.headers[name.toLowerCase()] ?? null };
  };

  /**
   * سرور وب در «تولید با ایندکس روشن» — تنظیمات پایگاه‌داده، محیط اجرا و سیاست
   * صفحه، سه‌تایی با هم. `restore()` تنظیمات را برمی‌گرداند و سرور را می‌بندد.
   */
  async function production() {
    const previous = await sudo(`select indexing_enabled, environment from seo.settings where business_id is null`);
    await sudo(`update seo.settings set indexing_enabled = true, environment = 'production' where business_id is null`);
    const server = createWebServer({
      client,
      env: productionEnv(storageDir ? { STORAGE_LOCAL_DIR: storageDir } : {}),
      logger,
      assetsDirectory,
      now: () => new Date('2026-10-03T09:00:00Z'),
      ...(api ? { apiOrigin: api.url } : {}),
      imageConfigTtlMs: 0,
      ...(options.imageEngine ? { imageEngine: options.imageEngine } : {}),
    });
    await server.listen(0, '127.0.0.1');
    return {
      server,
      host: PRODUCTION_HOST,
      origin: `https://${PRODUCTION_HOST}`,
      page: (path) => page(path, { host: PRODUCTION_HOST, server }),
      async restore() {
        await server.close().catch(() => {});
        await sudo(`update seo.settings set indexing_enabled = $1, environment = $2 where business_id is null`, [
          previous[0].indexing_enabled,
          previous[0].environment,
        ]);
      },
    };
  }

  return {
    env,
    engine,
    client,
    passwords,
    production,
    asRole,
    sudo,
    registerUser,
    createBusiness,
    createContent,
    createImageAsset,
    publishDesignPage,
    addMember,
    storageDir,
    web,
    api,
    page,
    async close() {
      await web.close().catch(() => {});
      await api?.server.close().catch(() => {});
      await engine.close().catch(() => {});
      if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
    },
  };
}
