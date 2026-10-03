/**
 * موتور پایگاه‌داده — لایهٔ نازکی که «کجا اجرا می‌شود» را از «چه اجرا می‌شود»
 * جدا می‌کند.
 *
 * چرا: در این محیط، سرور PostgreSQL نصب نیست. موتور تعبیه‌شدهٔ PostgreSQL
 * (PGlite ۰٫۳، همان PostgreSQL 17 کامپایل‌شده به WebAssembly؛ نسخهٔ سنجیده‌شده: 17.5) همان SQL را اجرا
 * می‌کند، با همان RLS و همان توابع. پس توسعه و تست محلی، رفتار واقعی را
 * می‌سنجد — نه یک شبیه‌سازی (§102: هیچ Mock به‌جای پیاده‌سازی).
 *
 * تفاوت‌ها صریح و محدودند و در `capabilities()` گزارش می‌شوند: افزونه‌های
 * بیرونی مثل `pg_trgm` در نسخهٔ تعبیه‌شده نصب نیستند. پس مهاجرت‌ها و کد
 * دامنه به آن‌ها تکیه نمی‌کنند و جست‌وجوی پیشرفته از راه آداپتور می‌آید.
 */

import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const CAPABILITIES = {
  pglite: {
    engine: 'pglite',
    /** PostgreSQL واقعی، تعبیه‌شده در فرایند. */
    postgres: true,
    /** چند اتصال هم‌زمان. */
    pooled: false,
    /** افزونه‌هایی که در دسترس نیستند. */
    unavailable_extensions: ['pg_trgm', 'unaccent', 'pgcrypto', 'ltree', 'fuzzystrmatch', 'postgis'],
    note: 'مناسب توسعه و تست محلی؛ برای تولید همان SQL روی PostgreSQL میزبانی‌شده اجرا می‌شود.',
  },
  postgres: {
    engine: 'postgres',
    postgres: true,
    pooled: true,
    unavailable_extensions: [],
    note: 'PostgreSQL میزبانی‌شده.',
  },
};

/**
 * باز کردن پایگاه‌داده.
 *
 * `url` تهی + `dataDir` تهی = پایگاه‌دادهٔ درون‌حافظه (برای تست).
 * `url` تهی + `dataDir` پر = پایگاه‌دادهٔ محلی پایدار (برای توسعه).
 * `url` پر = PostgreSQL واقعی.
 */
export async function openDatabase(options = {}) {
  const url = options.url ?? process.env.PETAVU_DATABASE_URL ?? '';
  const dataDir = options.dataDir;

  if (url.trim() !== '') {
    return openPostgres(url, options);
  }
  return openPglite(dataDir, options);
}

async function openPglite(dataDir, options) {
  const { PGlite } = await import('@electric-sql/pglite');
  /*
   * نصب تازه: پوشهٔ داده هنوز نیست.
   *
   * موتور تعبیه‌شده خودش پوشه نمی‌سازد و با `ENOENT` می‌افتد؛ روی نصب تازه
   * این یعنی اولین اجرای `npm run migrate` به‌جای «پایگاه‌داده ساخته شد»،
   * یک خطای نامفهوم می‌داد. اینجا مسیر ساخته می‌شود تا نصب تازه بی‌دستکاری
   * کار کند (§187).
   */
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const db = dataDir ? new PGlite({ dataDir }) : new PGlite();
  await db.waitReady;

  const engine = {
    kind: 'pglite',
    capabilities: CAPABILITIES.pglite,
    async exec(sql) {
      await db.exec(sql);
    },
    async query(sql, params = []) {
      const result = await db.query(sql, params);
      return result.rows ?? [];
    },
    async withTransaction(fn) {
      return db.transaction(async (tx) => {
        const handle = {
          async exec(sql) {
            await tx.exec(sql);
          },
          async query(sql, params = []) {
            const result = await tx.query(sql, params);
            return result.rows ?? [];
          },
        };
        return fn(handle, { rollback: () => tx.rollback() });
      });
    },
    async close() {
      await db.close();
    },
    /**
     * اجرا در نقش یک کاربر پایگاه‌داده؛ برای آزمودن سیاست‌های دسترسی.
     * همیشه نقش را برمی‌گرداند، حتی اگر بدنه خطا بدهد — وگرنه اتصال آلوده
     * می‌ماند و تست بعدی نتیجهٔ غلط می‌دهد.
     */
    async asRole(role, fn) {
      await db.exec(`set role ${quoteIdentifier(role)}`);
      try {
        return await fn(engine);
      } finally {
        /*
         * اگر بدنه با خطای SQL افتاده باشد، تراکنش «لغوشده» است و `reset role`
         * خودش خطای تازه می‌سازد — که خطای اصلی را می‌پوشاند. بازگشت تراکنش،
         * نقش را هم برمی‌گرداند؛ پس شکست این پاک‌سازی را نادیده می‌گیریم.
         */
        await db.exec('reset role').catch(() => {});
      }
    },
    /** ست کردن زمینهٔ درخواست؛ `local=false` برای دوام در کل اتصال (تست). */
    async setContext(context, { local = false } = {}) {
      const entries = [
        ['app.user_id', context.userId],
        ['app.business_id', context.businessId],
        ['app.session_id', context.sessionId],
        ['app.platform_role', context.platformRole],
        // جعل هویت (§31) و شناسهٔ درخواست (§76) هم بخشی از زمینه‌اند: رخداد و
        // حسابرسی از همین دو می‌فهمند «کی، از طرف کی، در کدام درخواست».
        ['app.impersonated_by', context.impersonatedBy],
        ['app.request_id', context.requestId],
      ];
      for (const [key, value] of entries) {
        if (value === undefined || value === null) continue;
        await db.query('select set_config($1, $2, $3)', [key, String(value), local]);
      }
    },
    async hashKey() {
      const result = await db.query("select md5('x') as ignored", []);
      void result;
      return createHash('sha256').digest('hex');
    },
  };

  void options;
  return engine;
}

async function openPostgres(url, options) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    connectionString: url,
    max: options.poolMax ?? 10,
    // مهلت پرس‌وجو در سطح اتصال: هیچ پرس‌وجویی نباید بی‌نهایت بماند (§ DB perf).
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    application_name: 'petavu',
  });

  const engine = {
    kind: 'postgres',
    capabilities: CAPABILITIES.postgres,
    async exec(sql) {
      const client = await pool.connect();
      try {
        await client.query(sql);
      } finally {
        client.release();
      }
    },
    async query(sql, params = []) {
      const client = await pool.connect();
      try {
        const result = await client.query(sql, params);
        return result.rows ?? [];
      } finally {
        client.release();
      }
    },
    async withTransaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const handle = {
          async exec(sql) {
            await client.query(sql);
          },
          async query(sql, params = []) {
            const result = await client.query(sql, params);
            return result.rows ?? [];
          },
        };
        const result = await fn(handle, { rollback: () => client.query('rollback') });
        await client.query('commit');
        return result;
      } catch (error) {
        await client.query('rollback').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
    async asRole(role, fn) {
      const client = await pool.connect();
      try {
        await client.query(`set role ${quoteIdentifier(role)}`);
        try {
          return await fn(engine);
        } finally {
          await client.query('reset role');
        }
      } finally {
        client.release();
      }
    },
    async setContext(context, { local = false } = {}) {
      const entries = [
        ['app.user_id', context.userId],
        ['app.business_id', context.businessId],
        ['app.session_id', context.sessionId],
        ['app.platform_role', context.platformRole],
        ['app.impersonated_by', context.impersonatedBy],
        ['app.request_id', context.requestId],
      ];
      for (const [key, value] of entries) {
        if (value === undefined || value === null) continue;
        await engine.query('select set_config($1, $2, $3)', [key, String(value), local]);
      }
    },
  };

  return engine;
}

function quoteIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new TypeError(`نام شناسهٔ نامعتبر: ${value}`);
  return `"${value}"`;
}

export { CAPABILITIES };
