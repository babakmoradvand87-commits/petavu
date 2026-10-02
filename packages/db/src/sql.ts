/**
 * ساخت SQL ایمن و بازرسی دستورها (§52، §58، Addendum §19).
 *
 * سه قاعده اینجا اعمال می‌شود و هیچ‌جای دیگری نباید تکرار شود:
 *
 *   ۱. **مقدار، پارامتر است.** هیچ مقداری در متن SQL نمی‌نشیند. تزریق، وقتی
 *      ممکن است که رشته ساخته شود؛ پس رشته ساخته نمی‌شود.
 *   ۲. **نام، از فهرست بسته.** نام جدول و ستون از دیتابیس به کد می‌آید، نه از
 *      ورودی کاربر؛ `ident` همین را با اعتبارسنجی سخت‌گیرانه تضمین می‌کند.
 *   ۳. **هر دستور، یک دستور.** چند دستور در یک رفت‌وبرگشت، یعنی یک ورودی
 *      می‌تواند دستور تازه بچسباند. رد می‌شود.
 */

import { AppError } from '@petavu/shared';
import type { Row, SqlParams } from './types.js';

/** قطعهٔ SQL ساخته‌شده: متن و پارامترها، جدانشدنی. */
export interface SqlFragment {
  readonly text: string;
  readonly params: SqlParams;
}

/**
 * قالب رشتهٔ برچسب‌دار برای SQL.
 *
 *   sql`select id from app.business where slug = ${slug}`
 *
 * مقدارها به پارامتر تبدیل می‌شوند؛ مقادیر آرایه‌ای به فهرست پارامتر گسترده
 * می‌شوند (برای `in`)، و `SqlFragment` دیگر، همان‌طور که هست درج می‌شود تا
 * ترکیب قطعه‌ها ممکن باشد بی‌آنکه دوباره پارامترگذاری شود.
 */
export function sql(strings: TemplateStringsArray, ...values: unknown[]): SqlFragment {
  const params: unknown[] = [];
  let text = '';

  strings.forEach((chunk, index) => {
    text += chunk;
    if (index >= values.length) return;

    const value = values[index];
    if (isFragment(value)) {
      // شماره‌های پارامترِ قطعهٔ درونی، با انحراف همین پرس‌وجو جابه‌جا می‌شوند.
      const offset = params.length;
      text += renumber(value.text, offset);
      params.push(...value.params);
      return;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        // `in ()` در SQL نامعتبر است؛ فهرست تهی یعنی «هیچ‌چیز»، صریح و روشن.
        text += 'select null where false';
        return;
      }
      const placeholders = value.map((item) => {
        params.push(item);
        return `$${params.length}`;
      });
      text += placeholders.join(', ');
      return;
    }

    params.push(value);
    text += `$${params.length}`;
  });

  return { text, params };
}

export function isFragment(value: unknown): value is SqlFragment {
  return (
    typeof value === 'object' &&
    value !== null &&
    'text' in value &&
    'params' in value &&
    typeof (value as { text: unknown }).text === 'string'
  );
}

/** قطعهٔ خام، فقط برای چیزهایی که پارامتر نمی‌پذیرند (کلیدواژه، ترتیب مرتب‌سازی). */
export function raw(text: string): SqlFragment {
  assertNoTerminator(text);
  return { text, params: [] };
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/;

/**
 * نام شناسه (`table` یا `schema.table`)، اعتبارسنجی‌شده و نقل‌قول‌شده.
 *
 * کوچک‌بودن اجباری است: نامی که از دیتابیس یا فهرست بسته می‌آید همیشه
 * کوچک است، و نام بزرگ یعنی کسی رشتهٔ کاربر را به اینجا رسانده.
 */
export function ident(name: string): SqlFragment {
  if (!IDENTIFIER.test(name)) {
    throw new AppError('validation_failed', {
      message: `نام شناسهٔ نامعتبر: ${name.slice(0, 40)}`,
      details: { reason: 'invalid_identifier' },
    });
  }
  return { text: `"${name.replace('.', '"."')}"`, params: [] };
}

/** فهرست شناسه‌ها، برای `select` و `order by` فهرست‌بسته. */
export function idents(names: readonly string[]): SqlFragment {
  if (names.length === 0) {
    throw new AppError('validation_failed', { message: 'فهرست ستون‌ها تهی است', details: { reason: 'empty_column_list' } });
  }
  const parts = names.map((name) => ident(name).text);
  return { text: parts.join(', '), params: [] };
}

/** جای‌نگهدارهای `$1, $2, …` برای یک فهرست مشخص (بی‌مقدار). */
export function placeholders(count: number, from = 1): SqlFragment {
  const items = Array.from({ length: count }, (_, index) => `$${from + index}`);
  return { text: items.join(', '), params: [] };
}

/**
 * بازرسی دستور پیش از اجرا.
 *
 * این بازرسی در توسعه و تست سخت‌گیرانه است و در تولید هم پایه‌ها را می‌گیرد:
 * `select *` ممنوع است (§58: ستون‌ها صریح‌اند تا شکست قرارداد در زمان
 * مهاجرت دیده شود، نه در تولید)، و چنددستوری ممنوع است.
 */
export function assertStatementSafe(text: string, options: { allowSelectStar?: boolean } = {}): void {
  assertNoTerminator(text);

  if (!options.allowSelectStar && hasSelectStar(text)) {
    throw new AppError('precondition_failed', {
      message: 'پرس‌وجو با select * اجرا نمی‌شود؛ ستون‌ها صریح باشند',
      details: { reason: 'select_star_forbidden' },
    });
  }
}

function assertNoTerminator(text: string): void {
  const withoutTrailing = text.trim().replace(/;\s*$/, '');
  if (withoutTrailing.includes(';')) {
    throw new AppError('precondition_failed', {
      message: 'بیش از یک دستور در یک پرس‌وجو مجاز نیست',
      details: { reason: 'multiple_statements' },
    });
  }
}

/**
 * تشخیص `select *`.
 *
 * کامنت‌ها و رشته‌های داخل نقل‌قول اول حذف می‌شوند؛ وگرنه یک متن فارسی با
 * ستاره، پرس‌وجوی سالم را رد می‌کرد.
 */
export function hasSelectStar(text: string): boolean {
  const cleaned = stripLiteralsAndComments(text);
  return /\bselect\s+(?:distinct\s+|all\s+)?(?:\*|[a-z_][a-z0-9_]*\.\*)/i.test(cleaned);
}

function stripLiteralsAndComments(text: string): string {
  return text
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""');
}

/** شمارهٔ پارامترهای یک قطعهٔ درونی را با انحراف مشخص جابه‌جا می‌کند. */
function renumber(text: string, offset: number): string {
  if (offset === 0) return text;
  return text.replace(/\$(\d+)/g, (_, index: string) => `$${Number(index) + offset}`);
}

/** ساخت شرط `col in (...)` با پارامترهای امن. */
export function inList(column: SqlFragment, values: readonly unknown[]): SqlFragment {
  if (values.length === 0) return raw('false');
  const params: unknown[] = [];
  const placeholdersText = values
    .map((value) => {
      params.push(value);
      return `$${params.length}`;
    })
    .join(', ');
  return { text: `${column.text} in (${placeholdersText})`, params };
}

/** ساخت `values (…), (…)` برای درج دسته‌ای. */
export function valueRows(rows: ReadonlyArray<ReadonlyArray<unknown>>): SqlFragment {
  if (rows.length === 0) {
    throw new AppError('validation_failed', { message: 'فهرست درج تهی است', details: { reason: 'empty_rows' } });
  }
  const params: unknown[] = [];
  const groups = rows.map((row) => {
    const cells = row.map((value) => {
      params.push(value);
      return `$${params.length}`;
    });
    return `(${cells.join(', ')})`;
  });
  return { text: groups.join(', '), params };
}

/** ردیف‌های نتیجه، به‌صورت تایپ‌شده. تایپ‌کردن اختیاری است، نه شبیه‌سازی. */
export function asRows<TRow extends Row>(rows: Row[]): TRow[] {
  return rows as TRow[];
}

export function asRow<TRow extends Row>(row: Row | undefined): TRow | undefined {
  return row as TRow | undefined;
}
