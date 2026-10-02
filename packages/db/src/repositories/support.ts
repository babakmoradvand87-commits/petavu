/**
 * ابزار مشترک Repositoryها (گام ۱۹).
 *
 * سه چیز اینجاست و بس: نگهبان مجوز، ساخت دنبالهٔ صفحه‌بندی، و چند تابع کوچک
 * که تکرارشان در هفت Repository یعنی هفت جا برای جاافتادن.
 *
 * قاعدهٔ کلی Repositoryها: **منطق دامنه‌ای که در SQL هست، در TypeScript
 * بازنویسی نمی‌شود.** هرجا تابع دامنه‌ای وجود دارد (`app.transition_content`،
 * `app.accept_invitation`، `app.upsert_seo_metadata`، …) همان صدا زده می‌شود،
 * چون رخداد و حسابرسی‌اش هم همان‌جاست. Repository فقط هماهنگ می‌کند.
 */

import { AppError } from '@petavu/shared';
import type { RequestContext } from '../context.js';
import { requireBusinessId } from '../context.js';
import type { Dal } from '../dal.js';
import { ident, raw, sql, type SqlFragment } from '../sql.js';
import type { Cursor, Page, PageRequest } from '../pagination.js';

export interface RepoDeps {
  /** لایهٔ داده؛ در کار درون‌تراکنشی، ساخته‌شده روی کلاینت تراکنش (ADR-0010). */
  dal: Dal;
  /** زمینهٔ درخواست؛ بازیگر، کسب‌وکار جاری و شناسهٔ درخواست از اینجا می‌آید. */
  context: RequestContext;
}

/** اندازهٔ صفحهٔ فهرست‌ها؛ یک جا تعیین می‌شود تا همهٔ فهرست‌ها یک رفتار داشته باشند. */
export const PAGE = { defaultLimit: 24, maxLimit: 100 } as const;

/** کسب‌وکار جاری، یا خطای روشن. هیچ عملیات مستأجرداری بدون آن اجرا نمی‌شود. */
export function scope(deps: RepoDeps, action = 'این عملیات'): string {
  return requireBusinessId(deps.context, action);
}

export function forbidden(reason: string, details: Record<string, unknown> = {}): never {
  throw new AppError('forbidden', {
    message: 'این کار به مجوز بیشتری نیاز دارد',
    details: { reason, ...details },
  });
}

export function notFound(entity: string, details: Record<string, unknown> = {}): never {
  throw new AppError('not_found', { message: 'موردی با این مشخصات پیدا نشد', details: { reason: 'not_found', entity, ...details } });
}

export function invalid(reason: string, message: string, details: Record<string, unknown> = {}): never {
  throw new AppError('validation_failed', { message, details: { reason, ...details } });
}

/**
 * نگهبان مجوز کسب‌وکار.
 *
 * RLS هم همین را می‌سنجد؛ این تابع عمداً تکراری است. تفاوتش در **کیفیت خطا**
 * است: بدون آن، نبود مجوز به «صفر ردیف تغییر کرد» یا «پیدا نشد» تبدیل می‌شود و
 * کاربر نمی‌فهمد چه کم است. §14 می‌گوید تصمیم دسترسی سمت سرور گرفته شود؛ این
 * تابع همان تصمیم است، با پیام قابل‌فهم.
 */
export async function assertPermission(deps: RepoDeps, businessId: string, permission: string): Promise<void> {
  const rows = await deps.dal.query<{ ok: boolean }>(
    sql`select app.has_permission(${businessId}, ${permission}) as ok`,
  );
  if (rows[0]?.ok !== true) forbidden('missing_permission', { permission });
}

export async function assertPlatformPermission(deps: RepoDeps, permission: string): Promise<void> {
  const rows = await deps.dal.query<{ ok: boolean }>(
    sql`select app.has_platform_permission(${permission}) as ok`,
  );
  if (rows[0]?.ok !== true) forbidden('missing_platform_permission', { permission });
}

/** آیا کسب‌وکار جاری این مجوز را دارد؟ برای تصمیم‌های نمایشی (نه برای دروازه). */
export async function hasPermission(deps: RepoDeps, businessId: string, permission: string): Promise<boolean> {
  const rows = await deps.dal.query<{ ok: boolean }>(
    sql`select app.has_permission(${businessId}, ${permission}) as ok`,
  );
  return rows[0]?.ok === true;
}

export interface PageTailOptions {
  /** ستون ترتیب، با نام کامل (`b.created_at`). */
  orderBy: string;
  /** کلید مرتب‌سازی؛ باید با ترتیب هم‌خوان باشد. */
  keyExpression: string;
  idColumn: string;
  direction?: 'asc' | 'desc';
}

/**
 * دنبالهٔ استاندارد فهرست: شرط نشانگر + ترتیب + سقف ردیف.
 *
 * مقایسه **دوتایی** است (`(key, id) > (…, …)`) چون هیچ کلید مرتب‌سازی‌ای
 * به‌تنهایی یکتا نیست و مقایسهٔ تک‌ستونی، ردیف‌های هم‌کلید را می‌پراند.
 */
export function pageTail(options: PageTailOptions): (cursor: Cursor | null, fetchLimit: number) => SqlFragment {
  const direction = options.direction ?? 'desc';
  const operator = direction === 'asc' ? '>' : '<';
  const order = `${ident(options.orderBy).text} ${direction === 'asc' ? 'asc' : 'desc'}`;
  const key = ident(options.keyExpression).text;
  const id = ident(options.idColumn).text;

  /*
   * ترتیب پارامترها مهم است: کلید و شناسهٔ نشانگر اول می‌آیند، بعد سقف ردیف.
   * نشانگر و سقف، هر دو پارامترند؛ هیچ‌کدام در متن نمی‌نشیند.
   */
  return (cursor, fetchLimit) =>
    cursor
      ? sql`and (${raw(key)}, ${raw(id)}) ${raw(operator)} (${cursor.key}, ${cursor.id}) order by ${raw(order)}, ${raw(id)} ${raw(direction)} limit ${fetchLimit}`
      : sql`order by ${raw(order)}, ${raw(id)} ${raw(direction)} limit ${fetchLimit}`;
}

/** گزارهٔ «حذف‌نشده»؛ Soft Delete مرز داده است، نه پاک‌کردن (§132). */
export function notDeleted(alias: string): SqlFragment {
  return raw(`${ident(`${alias}.deleted_at`).text} is null`);
}

/**
 * گسترش یک مقدار مرکب (composite) به ستون‌های صریح.
 *
 * توابعی مثل `app.transition_content` یک ردیف کامل برمی‌گردانند و راه معمول
 * `select * from ...` است — که در این پروژه ممنوع است. این تابع، همان کار را
 * با فهرست بسته انجام می‌دهد: `(r).id as id, (r).slug as slug, …`. نتیجه
 * صریح است و اگر ستونی اضافه شود، شکل پاسخ خودبه‌خود عوض نمی‌شود.
 */
export function recordFields(alias: string, names: readonly string[]): SqlFragment {
  if (!/^[a-z_][a-z0-9_]*$/.test(alias)) throw new Error(`نام مستعار نامعتبر: ${alias}`);
  const list = names.map((name) => `(${alias}).${ident(name).text.replaceAll('"', '')} as ${ident(name).text}`).join(', ');
  return raw(list);
}

/** فهرست ستون‌های یک جدول، نقل‌قول‌شده و بدون `select *`. */
export function columns(alias: string, names: readonly string[]): SqlFragment {
  const list = names.map((name) => ident(`${alias}.${name}`).text).join(', ');
  return raw(list);
}

export type { Page, PageRequest, Cursor };
