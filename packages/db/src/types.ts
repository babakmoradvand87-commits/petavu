/**
 * انواع پایهٔ لایهٔ داده (§52–۵۳).
 *
 * قاعده: این پکیج نمی‌داند داده کجاست. `SqlClient` یک قرارداد است؛ Postgres
 * میزبانی‌شده، موتور تعبیه‌شدهٔ توسعه و هر چیز دیگری می‌تواند آن را پیاده کند.
 * همین قرارداد است که §184 (بدون وابستگی به فروشنده) را عملی می‌کند: تعویض
 * زیرساخت، تعویض یک پیاده‌سازی است، نه بازنویسی برنامه.
 */

/** یک ردیف، با مقادیر ناشناخته: تایپ‌کردن جایی رخ می‌دهد که ستون‌ها معلوم‌اند. */
export type Row = Record<string, unknown>;

/** پارامترهای پرس‌وجو؛ ترتیب، ترتیب `$1..$n` است. */
export type SqlParams = ReadonlyArray<unknown>;

export interface QueryResult<TRow extends Row = Row> {
  rows: TRow[];
  /** تعداد ردیف‌های اثرگذاشته (`insert`/`update`/`delete`). */
  affected: number;
}

/**
 * قرارداد کلاینت پایگاه‌داده.
 *
 * `withTransaction` تنها راه تغییر داده است: از بیرون هیچ راهی برای اجرای
 * دستور بیرون از تراکنش وجود ندارد، چون §54 می‌گوید تصمیم‌های امنیتی (زمینه و
 * نقش) باید در محدودهٔ تراکنش باشند و با پایانش بروند.
 */
export interface SqlClient {
  readonly engine: 'postgres' | 'embedded';
  query<TRow extends Row = Row>(sql: string, params?: SqlParams): Promise<QueryResult<TRow>>;
  exec(sql: string): Promise<void>;
  withTransaction<T>(fn: (client: SqlClient) => Promise<T>): Promise<T>;
  /** اجرا در نقش پایگاه‌داده (RLS). نقش‌ها: pv_app، pv_worker، pv_public، pv_reader. */
  asRole<T>(role: DatabaseRole, fn: (client: SqlClient) => Promise<T>): Promise<T>;
  /** بستن اتصال‌ها؛ در خاموشی آرام برنامه صدا زده می‌شود. */
  close(): Promise<void>;
}

export type DatabaseRole = 'pv_app' | 'pv_worker' | 'pv_public' | 'pv_reader';

export const DATABASE_ROLES: readonly DatabaseRole[] = ['pv_app', 'pv_worker', 'pv_public', 'pv_reader'];

/** مشخصات اتصال؛ همان چیزی که از پیکربندی می‌آید (§72). */
export interface DatabaseConfig {
  url: string;
  poolMax: number;
  /** سقف هر دستور در سرور؛ پرس‌وجوی کند، اتصال را گروگان نمی‌گیرد. */
  statementTimeoutMs: number;
  /** سقف انتظار برای گرفتن اتصال از استخر. */
  connectionTimeoutMs?: number;
  applicationName?: string;
  ssl?: boolean | { rejectUnauthorized: boolean };
}
