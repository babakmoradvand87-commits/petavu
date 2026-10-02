/**
 * صفحه‌بندی نشانگری (Cursor)، نه شمارهٔ صفحه (Addendum §20، §30).
 *
 * چرا نشانگر: `offset` با هر درج تازه، ردیف‌ها را جابه‌جا می‌کند و صفحهٔ دوم
 * می‌تواند ردیفی را دوبار یا هرگز نشان ندهد. نشانگر روی یک کلید *یکتا و
 * مرتب* می‌نشیند، پس پیمایش پایدار است — حتی وقتی داده در حال تغییر است.
 *
 * نشانگر، شفاف نیست ولی رمز هم نیست: کاملاً base64 است تا کلاینت نتواند
 * به‌سادگی مقدار درونی را دستکاری کند، ولی هیچ رازی در آن نیست.
 */

import { AppError } from '@petavu/shared';

export interface Cursor {
  /** مقدار کلید مرتب‌سازی در آخرین ردیف صفحهٔ پیش. */
  key: string | number;
  /** شناسهٔ قطعی‌کننده؛ کلید مرتب‌سازی هرگز به‌تنهایی یکتا نیست. */
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  const payload = JSON.stringify({ k: cursor.key, i: cursor.id });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

export function decodeCursor(value: string | null | undefined): Cursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null) throw new Error('bad cursor');
    const record = parsed as { k?: unknown; i?: unknown };
    if ((typeof record.k !== 'string' && typeof record.k !== 'number') || typeof record.i !== 'string') {
      throw new Error('bad cursor shape');
    }
    return { key: record.k, id: record.i };
  } catch (error) {
    throw new AppError('validation_failed', {
      message: 'نشانگر صفحهٔ نامعتبر است',
      details: { reason: 'invalid_cursor' },
      cause: error,
    });
  }
}

export interface PageRequest {
  cursor?: string | null;
  limit?: number | null;
  /** ترتیب نزولی (پیش‌فرض) یا صعودی. */
  direction?: 'asc' | 'desc';
}

export interface Page<TRow> {
  items: TRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

export const PAGE_SIZE = { default: 20, max: 100 } as const;

export function normalizeLimit(limit: number | null | undefined, options: { default?: number; max?: number } = {}): number {
  const fallback = options.default ?? PAGE_SIZE.default;
  const max = options.max ?? PAGE_SIZE.max;
  if (limit === null || limit === undefined || Number.isNaN(limit)) return fallback;
  if (!Number.isFinite(limit) || limit < 1) {
    throw new AppError('validation_failed', { message: 'اندازهٔ صفحه نامعتبر است', details: { reason: 'invalid_limit' } });
  }
  return Math.min(Math.floor(limit), max);
}

/**
 * ساخت صفحه از ردیف‌های برگشته.
 *
 * قاعده: یک ردیف بیشتر از اندازهٔ صفحه خوانده می‌شود تا «ادامه دارد یا نه»
 * از خود داده معلوم شود، نه از شمارش کل — که خودش یک پرس‌وجوی سنگین است.
 */
export function buildPage<TRow extends Record<string, unknown>>(
  rows: TRow[],
  limit: number,
  extract: (row: TRow) => Cursor,
): Page<TRow> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? encodeCursor(extract(last)) : null,
  };
}

/**
 * شرط کلیدواژهٔ نشانگر.
 *
 * `(key, id) < (cursor.key, cursor.id)` شکل درست مقایسهٔ دوتایی است: مقایسهٔ
 * فقط روی `key` ردیف‌هایی با کلید تکراری را می‌پراند.
 */
export function cursorPredicate(cursor: Cursor, direction: 'asc' | 'desc', keyColumn: string, idColumn: string): {
  text: string;
  params: [unknown, unknown];
} {
  const operator = direction === 'asc' ? '>' : '<';
  return {
    text: `(${keyColumn}, ${idColumn}) ${operator} ($1, $2)`,
    params: [cursor.key, cursor.id],
  };
}
