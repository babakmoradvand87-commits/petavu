/**
 * لایهٔ دسترسی به داده (§52–۵۳).
 *
 * این لایه، «SQL نوشتن» را به چند عمل معنادار تبدیل می‌کند و چند قاعدهٔ
 * عملکرد/امنیت را در یک جا اعمال می‌کند:
 *
 *   • **هیچ `select *`** — ستون‌ها صریح‌اند (Addendum §19).
 *   • **هیچ پرس‌وجوی بی‌مستأجر** روی دادهٔ کسب‌وکار — `tenantFilter` اجباری است.
 *   • **هیچ N+1** — `batchLoad` برای بارگذاری گروهی، و شمارندهٔ پرس‌وجو در
 *     حالت بازرسی تا N+1 در تست دیده شود، نه در تولید.
 *   • **هر خطای دیتابیس، خطای دامنه** می‌شود؛ پیام دیتابیس بیرون نمی‌رود (§78).
 *
 * یک نکتهٔ مهم دربارهٔ اتصال: `Dal` به یک کلاینت بسته می‌شود. اگر کارتان در
 * تراکنش است، `Dal` را روی همان کلاینتِ تراکنش بسازید:
 *
 * ```ts
 * await withContext(pool, context, (tx) => {
 *   const dal = createDal(tx);
 *   return dal.updateWithVersion({ ... });
 * });
 * ```
 *
 * پرس‌وجو با کلاینت بیرونی هنگام باز‌بودن تراکنش، یا زمینه را از دست می‌دهد یا
 * (روی اتصال تک‌نفره) قفل می‌شود. این را در قرارداد نوشتیم تا اشتباه تکرار نشود.
 */

import { AppError } from '@petavu/shared';
import type { SqlClient, SqlParams, Row, QueryResult } from './types.js';
import { sql, type SqlFragment, assertStatementSafe } from './sql.js';
import { buildPage, decodeCursor, normalizeLimit, type Cursor, type Page, type PageRequest } from './pagination.js';
import { mapDatabaseError } from './pool.js';

export interface DalOptions {
  /** بازرسی در توسعه/تست: شمارش پرس‌وجوها و بررسی الگوهای پرهزینه. */
  inspect?: boolean;
}

export interface Dal {
  readonly client: SqlClient;
  query<TRow extends Row = Row>(fragment: SqlFragment | string, params?: SqlParams): Promise<TRow[]>;
  one<TRow extends Row = Row>(fragment: SqlFragment | string, params?: SqlParams): Promise<TRow>;
  maybeOne<TRow extends Row = Row>(fragment: SqlFragment | string, params?: SqlParams): Promise<TRow | null>;
  execute(fragment: SqlFragment | string, params?: SqlParams): Promise<number>;
  count(fragment: SqlFragment | string, params?: SqlParams): Promise<number>;
  exists(fragment: SqlFragment | string, params?: SqlParams): Promise<boolean>;
  /** صفحه‌بندی نشانگری روی یک پرس‌وجوی کلیدواژه‌دار. */
  page<TRow extends Row = Row>(options: PageQueryOptions<TRow>): Promise<Page<TRow>>;
  /** بارگذاری گروهی برای پرهیز از N+1. */
  batchLoad<TKey, TRow extends Row, TValue>(
    keys: readonly TKey[],
    loader: (client: SqlClient, keys: readonly TKey[]) => Promise<TRow[]>,
    options: { keyOf: (row: TRow) => TKey; valueOf?: (row: TRow) => TValue },
  ): Promise<Map<TKey, TValue>>;
  /** به‌روزرسانی با کنترل نسخه (Optimistic concurrency، §۵۵). */
  updateWithVersion(options: UpdateWithVersionOptions): Promise<Row>;
  /** شمارش پرس‌وجوهای همین نمونه؛ برای آزمون «N+1 رخ نداده». */
  stats(): { queries: number };
  resetStats(): void;
}

export interface PageQueryOptions<TRow extends Row> {
  /**
   * متن پرس‌وجو.
   *
   * `fetchLimit` برابر «اندازهٔ صفحه + ۱» است: آن یک ردیف اضافه، تنها راه
   * دانستنِ «ادامه دارد» بدون شمردن کل جدول است. سازندهٔ پرس‌وجو باید همین
   * عدد را در `limit` بگذارد تا قاعده یک‌جا و تکرارنشدنی بماند.
   */
  statement: (cursor: Cursor | null, fetchLimit: number) => SqlFragment;
  request: PageRequest;
  extract: (row: TRow) => Cursor;
  defaultLimit?: number;
  maxLimit?: number;
}

export interface UpdateWithVersionOptions {
  table: string;
  id: string;
  expectedVersion: number;
  /** ستون‌های به‌روزرسانی، از فهرست بسته؛ مقدارها پارامتر می‌شوند. */
  values: Record<string, unknown>;
  /** نگهبان مستأجر؛ برای جدول‌های کسب‌وکاری اجباری است. */
  tenant?: { column: string; value: string };
  returning?: readonly string[];
}

export function createDal(client: SqlClient, options: DalOptions = {}): Dal {
  let queryCount = 0;

  const run = async <TRow extends Row = Row>(fragment: SqlFragment | string, params: SqlParams = []): Promise<QueryResult<TRow>> => {
    const text = typeof fragment === 'string' ? fragment : fragment.text;
    const values = typeof fragment === 'string' ? params : fragment.params;
    assertStatementSafe(text);
    queryCount += 1;
    try {
      return await client.query<TRow>(text, values);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  };

  const dal: Dal = {
    client,

    async query<TRow extends Row = Row>(fragment: SqlFragment | string, params?: SqlParams): Promise<TRow[]> {
      const result = await run<TRow>(fragment, params);
      return result.rows;
    },

    async one<TRow extends Row = Row>(fragment: SqlFragment | string, params?: SqlParams): Promise<TRow> {
      const rows = await dal.query<TRow>(fragment, params);
      const [first] = rows;
      if (!first) {
        throw new AppError('not_found', { details: { reason: 'expected_one_row' } });
      }
      return first;
    },

    async maybeOne<TRow extends Row = Row>(fragment: SqlFragment | string, params?: SqlParams): Promise<TRow | null> {
      const rows = await dal.query<TRow>(fragment, params);
      if (rows.length > 1 && options.inspect) {
        throw new AppError('internal_error', {
          message: 'پرس‌وجوی «شاید یکی» بیش از یک ردیف برگرداند',
          details: { reason: 'multiple_rows' },
        });
      }
      return rows[0] ?? null;
    },

    async execute(fragment: SqlFragment | string, params?: SqlParams): Promise<number> {
      const result = await run(fragment, params);
      return result.affected;
    },

    async count(fragment: SqlFragment | string, params?: SqlParams): Promise<number> {
      const rows = await dal.query<{ total: string | number }>(fragment, params);
      const total = rows[0]?.total ?? 0;
      return typeof total === 'number' ? total : Number(total);
    },

    async exists(fragment: SqlFragment | string, params?: SqlParams): Promise<boolean> {
      const rows = await dal.query<{ present: boolean }>(fragment, params);
      return rows[0]?.present === true;
    },

    async page<TRow extends Row>(pageOptions: PageQueryOptions<TRow>): Promise<Page<TRow>> {
      const limit = normalizeLimit(pageOptions.request.limit, {
        default: pageOptions.defaultLimit,
        max: pageOptions.maxLimit,
      });
      const cursor = decodeCursor(pageOptions.request.cursor);
      const fragment = pageOptions.statement(cursor, limit + 1);
      const rows = await dal.query<TRow>(fragment);
      return buildPage(rows, limit, pageOptions.extract);
    },

    async batchLoad<TKey, TRow extends Row, TValue>(
      keys: readonly TKey[],
      loader: (client: SqlClient, keys: readonly TKey[]) => Promise<TRow[]>,
      batchOptions: { keyOf: (row: TRow) => TKey; valueOf?: (row: TRow) => TValue },
    ): Promise<Map<TKey, TValue>> {
      const unique = [...new Set(keys)];
      const result = new Map<TKey, TValue>();
      if (unique.length === 0) return result;

      // در دسته‌های کوچک: یک پرس‌وجوی بزرگ با `= any(...)`، نه یکی برای هر کلید.
      const chunkSize = 500;
      for (let index = 0; index < unique.length; index += chunkSize) {
        const chunk = unique.slice(index, index + chunkSize);
        const rows = await loader(client, chunk);
        for (const row of rows) {
          const key = batchOptions.keyOf(row);
          const value = batchOptions.valueOf ? batchOptions.valueOf(row) : (row as unknown as TValue);
          result.set(key, value);
        }
      }

      return result;
    },

    async updateWithVersion(update: UpdateWithVersionOptions): Promise<Row> {
      const entries = Object.entries(update.values);
      if (entries.length === 0) {
        throw new AppError('validation_failed', { message: 'هیچ ستونی برای به‌روزرسانی نیامده', details: { reason: 'no_values' } });
      }

      const params: unknown[] = [update.id, update.expectedVersion];
      const assignments = entries.map(([column, value]) => {
        if (!/^[a-z_][a-z0-9_]*$/.test(column)) {
          throw new AppError('validation_failed', { message: `نام ستون نامعتبر: ${column}`, details: { reason: 'invalid_column' } });
        }
        params.push(value);
        return `"${column}" = $${params.length}`;
      });

      let tenantClause = '';
      if (update.tenant) {
        if (!/^[a-z_][a-z0-9_]*$/.test(update.tenant.column)) {
          throw new AppError('validation_failed', { details: { reason: 'invalid_column' } });
        }
        params.push(update.tenant.value);
        tenantClause = ` and "${update.tenant.column}" = $${params.length}`;
      }

      const returning = update.returning && update.returning.length > 0 ? update.returning.map((c) => `"${c}"`).join(', ') : 'id, version';
      const text = [
        `update ${update.table}`,
        `set ${assignments.join(', ')}, version = version + 1`,
        `where id = $1 and version = $2${tenantClause}`,
        `returning ${returning}`,
      ].join(' ');

      const rows = await dal.query(text, params);
      const [row] = rows;
      if (!row) {
        /*
         * تعارض نسخه، خطای ۴۱۲ است نه ۴۰۹: «وضعیت شما کهنه است، تازه کن» با
         * «این داده با دادهٔ موجود نمی‌سازد» یکی نیست و کلاینت باید بتواند
         * این دو را از هم تشخیص دهد.
         */
        throw new AppError('precondition_failed', {
          message: 'نسخهٔ شما از این رکورد قدیمی است',
          details: { reason: 'version_conflict', table: update.table },
        });
      }
      return row;
    },

    stats() {
      return { queries: queryCount };
    },

    resetStats() {
      queryCount = 0;
    },
  };

  return dal;
}

/**
 * نگهبان مستأجر برای متن پرس‌وجو.
 *
 * پرس‌وجویی که به جدول کسب‌وکاری دست می‌زند و `business_id` در آن نیست، یا
 * اشتباه است یا نشت. این تابع آن را به خطای روشن تبدیل می‌کند تا در بازبینی
 * دیده شود، نه در گزارش حادثه.
 */
export function assertTenantScoped(fragment: SqlFragment, businessId: string | null | undefined): SqlFragment {
  if (!businessId) {
    throw new AppError('forbidden', { message: 'عملیات بدون کسب‌وکار جاری مجاز نیست', details: { reason: 'missing_tenant_context' } });
  }
  if (!/business_id/.test(fragment.text)) {
    throw new AppError('internal_error', {
      message: 'پرس‌وجوی مستأجردار، شرط business_id ندارد',
      details: { reason: 'unscoped_tenant_query' },
    });
  }
  return fragment;
}

/** شرط استاندارد مستأجر. یک جا تعریف می‌شود تا در همهٔ پرس‌وجوها یکی باشد. */
export function tenantFilter(businessId: string): SqlFragment {
  return sql`b.business_id = ${businessId}`;
}

/** `insert` سادهٔ امن: ستون‌ها از فهرست بسته، مقدارها پارامتر. */
export function insertInto(table: string, values: Record<string, unknown>): SqlFragment {
  const entries = Object.entries(values);
  if (entries.length === 0) {
    throw new AppError('validation_failed', { details: { reason: 'no_values' } });
  }
  const columns: string[] = [];
  const params: unknown[] = [];
  const placeholders: string[] = [];
  for (const [column, value] of entries) {
    if (!/^[a-z_][a-z0-9_]*$/.test(column)) {
      throw new AppError('validation_failed', { details: { reason: 'invalid_column', column } });
    }
    columns.push(`"${column}"`);
    params.push(value);
    placeholders.push(`$${params.length}`);
  }
  return {
    text: `insert into ${table} (${columns.join(', ')}) values (${placeholders.join(', ')}) returning id`,
    params,
  };
}

/**
 * `update` سادهٔ امن، با شرط مستأجر اجباری.
 *
 * `returning` پیش‌فرض `['id']` است: بدون آن، «چند ردیف تغییر کرد» از درایور
 * خوانده می‌شود که بین پیکربندی‌ها یکسان نیست. شناسه‌های برگشته هم به API
 * اجازه می‌دهند برای هر ردیفِ تغییرکرده، رخداد بفرستد.
 */
export function updateWhere(
  table: string,
  values: Record<string, unknown>,
  where: SqlFragment,
  options: { returning?: readonly string[] } = {},
): SqlFragment {
  const entries = Object.entries(values);
  if (entries.length === 0) {
    throw new AppError('validation_failed', { details: { reason: 'no_values' } });
  }
  const params: unknown[] = [];
  const assignments = entries.map(([column, value]) => {
    if (!/^[a-z_][a-z0-9_]*$/.test(column)) {
      throw new AppError('validation_failed', { details: { reason: 'invalid_column', column } });
    }
    params.push(value);
    return `"${column}" = $${params.length}`;
  });

  const offset = params.length;
  const whereText = where.text.replace(/\$(\d+)/g, (_, index: string) => `$${Number(index) + offset}`);
  params.push(...where.params);

  const returning = (options.returning ?? ['id']).map((column) => {
    if (!/^[a-z_][a-z0-9_]*$/.test(column)) {
      throw new AppError('validation_failed', { details: { reason: 'invalid_column', column } });
    }
    return `"${column}"`;
  });

  return {
    text: `update ${table} set ${assignments.join(', ')} where ${whereText}${returning.length > 0 ? ` returning ${returning.join(', ')}` : ''}`,
    params,
  };
}
