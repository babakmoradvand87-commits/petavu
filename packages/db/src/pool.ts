/**
 * کلاینت PostgreSQL میزبانی‌شده (§49–۵۱: ارائه‌دهندهٔ زیرساخت، نه وابستگی).
 *
 * چیزهایی که این لایه تضمین می‌کند و جای دیگری نباید تکرار شوند:
 *
 *   • **سقف زمان هر دستور** روی خود اتصال ست می‌شود، نه در کد برنامه: پرس‌وجوی
 *     کند باید *در سرور* قطع شود، وگرنه اتصال تا پایان کار گروگان می‌ماند.
 *   • **هر درخواست در یک تراکنش.** حتی خواندن‌ها: زمینه با `set_config(…, true)`
 *     در تراکنش می‌نشیند و با پایانش می‌رود؛ بدون تراکنش، زمینه روی اتصال
 *     می‌ماند و درخواست بعدی روی همان اتصال، هویت اشتباه می‌گیرد.
 *   • **برداشت دوبارهٔ اتصال، با نقش بازنشانی‌شده.** `reset role` در `finally`،
 *     پس خطای نیمه‌کاره هم نمی‌تواند نقش را به درخواست بعدی ببرد.
 */

import { AppError } from '@petavu/shared';
import type { DatabaseConfig, DatabaseRole, QueryResult, Row, SqlClient, SqlParams } from './types.js';
import { DATABASE_ROLES } from './types.js';
import { assertStatementSafe } from './sql.js';

interface PgPoolLike {
  query(options: { text: string; values?: unknown[] }): Promise<{ rows: unknown[]; rowCount: number | null }>;
  connect(): Promise<PgConnectionLike>;
  end(): Promise<void>;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  totalCount?: number;
  idleCount?: number;
  waitingCount?: number;
}

interface PgConnectionLike {
  query(options: { text: string; values?: unknown[] }): Promise<{ rows: unknown[]; rowCount: number | null }>;
  release(destroy?: boolean): void;
}

/** ساخت استخر اتصال از پیکربندی؛ `pg` به‌صورت پویا بارگذاری می‌شود تا پکیج سبک بماند. */
export async function createPostgresClient(config: DatabaseConfig): Promise<SqlClient> {
  if (config.url.trim() === '') {
    throw new AppError('database_unavailable', {
      message: 'نشانی پایگاه‌داده تنظیم نشده است',
      details: { reason: 'missing_database_url' },
    });
  }

  /*
   * `pg` به‌صورت پویا بارگذاری می‌شود.
   *
   * دو دلیل: (۱) پکیج در محیط توسعه و تست بارگذاری نمی‌شود چون موتور تعبیه‌شده
   * استفاده می‌شود؛ (۲) تایپ‌های آن، وابستگی ساخت را سنگین می‌کند. قرارداد ما
   * `PgPoolLike` است و همین کافی است.
   */
  const module = (await import(/* @vite-ignore */ 'pg')) as unknown as {
    Pool: new (options: Record<string, unknown>) => PgPoolLike;
    default?: { Pool: new (options: Record<string, unknown>) => PgPoolLike };
  };
  const Pool = module.Pool ?? module.default?.Pool;
  if (!Pool) {
    throw new AppError('database_unavailable', {
      message: 'درایور PostgreSQL در دسترس نیست',
      details: { reason: 'driver_missing' },
    });
  }

  const pool = new Pool({
    connectionString: config.url,
    max: config.poolMax,
    connectionTimeoutMillis: config.connectionTimeoutMs ?? 5_000,
    idleTimeoutMillis: 30_000,
    application_name: config.applicationName ?? 'petavu',
    ...(config.ssl === undefined ? {} : { ssl: config.ssl }),
    // سقف زمان دستور، روی خود اتصال.
    options: `-c statement_timeout=${config.statementTimeoutMs}`,
  });

  await verifyConnection(pool);
  return wrapPool(pool, config);
}

/** آزمون اتصال؛ خطای روشن به‌جای شکست مبهم در نخستین درخواست. */
async function verifyConnection(pool: PgPoolLike): Promise<void> {
  try {
    await pool.query({ text: 'select 1 as ok' });
  } catch (error) {
    throw new AppError('database_unavailable', {
      message: 'اتصال به پایگاه‌داده برقرار نشد',
      details: { reason: 'connection_failed' },
      cause: error,
    });
  }
}

function wrapPool(pool: PgPoolLike, config: DatabaseConfig): SqlClient {
  const queryWith = async <TRow extends Row>(
    runner: PgPoolLike | PgConnectionLike,
    sqlText: string,
    params: SqlParams = [],
    options: { allowSelectStar?: boolean } = {},
  ): Promise<QueryResult<TRow>> => {
    assertStatementSafe(sqlText, options);
    try {
      const result = await runner.query({ text: sqlText, values: [...params] });
      return { rows: result.rows as TRow[], affected: result.rowCount ?? 0 };
    } catch (error) {
      throw mapDatabaseError(error, { statementTimeoutMs: config.statementTimeoutMs });
    }
  };

  const makeClient = (runner: PgPoolLike | PgConnectionLike): SqlClient => ({
    engine: 'postgres',
    query: (text, params) => queryWith(runner, text, params),
    async exec(text) {
      assertStatementSafe(text, { allowSelectStar: true });
      await runner.query({ text });
    },
    async withTransaction(fn) {
      const connection = await pool.connect();
      let settled = false;
      try {
        await connection.query({ text: 'begin' });
        const txClient = makeClient(connection);
        try {
          const value = await fn(txClient);
          await connection.query({ text: 'commit' });
          settled = true;
          return value;
        } catch (error) {
          if (!settled) {
            try {
              await connection.query({ text: 'rollback' });
            } catch {
              // قطع اتصال هنگام rollback: اتصال را دور می‌ریزیم، نه اینکه دوباره استفاده کنیم.
            }
          }
          throw error;
        }
      } finally {
        connection.release();
      }
    },
    async asRole(role, fn) {
      assertRole(role);
      await runner.query({ text: `set local role ${role}` });
      try {
        return await fn(makeClient(runner));
      } finally {
        /*
         * در تراکنش لغوشده، `reset role` خطای 25P02 می‌سازد و بدین‌سان خطای
         * واقعی را می‌پوشاند (کاربر به‌جای «تعارض نسخه» و «مجوز ندارید»،
         * پیام می‌گیرد «تراکنش لغو شده»). بازگشت تراکنش نقش را برمی‌گرداند،
         * پس پاک‌سازی شکست‌خورده را نادیده می‌گیریم.
         */
        await runner.query({ text: 'reset role' }).catch(() => {});
      }
    },
    async close() {
      await pool.end();
    },
  });

  return makeClient(pool);
}

export function assertRole(role: string): asserts role is DatabaseRole {
  if (!DATABASE_ROLES.includes(role as DatabaseRole)) {
    throw new AppError('validation_failed', {
      message: `نقش پایگاه‌دادهٔ ناشناخته: ${role}`,
      details: { reason: 'unknown_role' },
    });
  }
}

/**
 * نگاشت خطای پایگاه‌داده به خطای دامنه.
 *
 * §78: پیام دیتابیس هرگز به کاربر نمی‌رسد. ولی *معنا*ی خطا باید برسد، وگرنه
 * تعارض نسخه به کاربر «خطای غیرمنتظره» نشان می‌دهد.
 */
export function mapDatabaseError(error: unknown, options: { statementTimeoutMs?: number } = {}): AppError {
  if (error instanceof AppError) return error;

  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
  const message = error instanceof Error ? error.message : String(error);

  switch (code) {
    case 'P0409':
      return new AppError('conflict', { details: { reason: 'version_mismatch' }, cause: error });
    case '23505':
      return new AppError('conflict', { details: { reason: 'unique_violation' }, cause: error });
    case '23503':
      return new AppError('validation_failed', { details: { reason: 'missing_reference' }, cause: error });
    case '23514':
      return new AppError('validation_failed', { details: { reason: 'check_violation' }, cause: error });
    case '23502':
      return new AppError('validation_failed', { details: { reason: 'missing_value' }, cause: error });
    case '40001':
    case '40P01':
      return new AppError('service_unavailable', {
        message: 'هم‌زمانی تراکنش‌ها؛ دوباره تلاش کنید.',
        details: { reason: 'serialization_failure' },
        cause: error,
      });
    case '57014':
      return new AppError('timeout', {
        message: 'پرس‌وجو از سقف زمان گذشت.',
        details: { reason: 'statement_timeout', statement_timeout_ms: options.statementTimeoutMs ?? null },
        cause: error,
      });
    case '42501':
      return new AppError('forbidden', { details: { reason: 'insufficient_privilege' }, cause: error });
    case '42P01':
    case '42703':
      return new AppError('internal_error', { details: { reason: 'schema_mismatch' }, cause: error });
    case '57P01':
    case '57P03':
      return new AppError('database_unavailable', { details: { reason: 'shutdown_or_starting' }, cause: error });
    /*
     * `55000` همان `object_not_in_prerequisite_state` است: توابع دامنه با آن
     * می‌گویند «این گذر از این وضعیت مجاز نیست». اگر نگاشت نشود، کاربر به‌جای
     * «وضعیت اجازه نمی‌دهد» (412)، «خطای داخلی» می‌گیرد — و همین اتفاق در تست
     * واقعی افتاد: گذر `draft → published` خطای 55000 داد.
     */
    case '55000':
      return new AppError('precondition_failed', { details: { reason: 'prerequisite_state' }, cause: error });
    /*
     * خطاهای «ورودی بد» هم باید به کاربر برگردند، نه اینکه «خطای داخلی»
     * شوند: متن نامعتبر، عدد بیرون دامنه، شناسهٔ uuid بدشکل.
     */
    case '22P02':
    case '22003':
    case '22023':
    case '22001':
      return new AppError('validation_failed', { details: { reason: 'invalid_input' }, cause: error });
    case '23P01':
      return new AppError('conflict', { details: { reason: 'exclusion_violation' }, cause: error });
    case 'P0002':
      return new AppError('not_found', { details: { reason: 'no_data_found' }, cause: error });
    default:
      break;
  }

  // قفل روی ردیف یا مهلت گرفته‌شده.
  if (/canceling statement due to statement timeout/i.test(message)) {
    return new AppError('timeout', { details: { reason: 'statement_timeout' }, cause: error });
  }
  if (/could not serialize access/i.test(message)) {
    return new AppError('service_unavailable', { details: { reason: 'serialization_failure' }, cause: error });
  }

  return new AppError('internal_error', { cause: error });
}

/** سلامت اتصال، برای `/ready`: آیا پایگاه‌داده پاسخ می‌دهد؟ */
export async function checkConnection(client: SqlClient): Promise<{ ok: boolean; serverTime?: string }> {
  try {
    const result = await client.query<{ server_time: string }>(
      'select now()::text as server_time',
      [],
    );
    const row = result.rows[0];
    return row ? { ok: true, serverTime: String(row.server_time) } : { ok: false };
  } catch {
    return { ok: false };
  }
}
