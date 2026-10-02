/**
 * زمینهٔ درخواست — «کی، از طرف کی، در کدام کسب‌وکار، در کدام درخواست» (§54–۵۵، §31).
 *
 * چرا زمینه و نه پارامتر تابع: تصمیم دسترسی در RLS گرفته می‌شود، و سیاست‌ها
 * باید بدانند چه کسی پرسیده است. اگر این اطلاعات به‌جای زمینه، پارامتر هر
 * کوئری می‌شد، هر کوئری می‌توانست آن را جا بیندازد — و یک جا افتادن یعنی
 * نشت. زمینه، یک بار در آغاز تراکنش ست می‌شود و با پایانش می‌رود.
 *
 * قاعدهٔ سخت: زمینه با `set_config(..., true)` (محلی تراکنش) ست می‌شود، هرگز
 * سراسری. زمینهٔ سراسری یعنی نشست بعدی روی همان اتصال، هویت اشتباه می‌گیرد.
 */

import type { SqlClient } from './types.js';
import { AppError } from '@petavu/shared';

export interface RequestContext {
  /** کاربر احراز‌هویت‌شده؛ برای درخواست بی‌نام تهی است. */
  userId?: string | null;
  /** کسب‌وکار جاری؛ تهی یعنی «بدون کسب‌وکار» (نه «همهٔ کسب‌وکارها»). */
  businessId?: string | null;
  sessionId?: string | null;
  /** نقش پلتفرمی کارکنان: superadmin، admin، moderator، support، auditor. */
  platformRole?: string | null;
  /** کارمندانی که با اختیار کاربر وارد شده‌اند؛ §31. */
  impersonatedBy?: string | null;
  /** شناسهٔ درخواست، برای پیوند لاگ، رخداد و حسابرسی (§76، Addendum §95). */
  requestId?: string | null;
}

/** نگاشت زمینه به تنظیمات پایگاه‌داده؛ تنها جای این نگاشت. */
export function contextSettings(context: RequestContext): Array<[string, string]> {
  const entries: Array<[string, string | null | undefined]> = [
    ['app.user_id', context.userId],
    ['app.business_id', context.businessId],
    ['app.session_id', context.sessionId],
    ['app.platform_role', context.platformRole],
    ['app.impersonated_by', context.impersonatedBy],
    ['app.request_id', context.requestId],
  ];

  return entries
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '')
    .map(([key, value]) => [key, value]);
}

/**
 * اجرای کاری در تراکنش، با زمینهٔ ست‌شده.
 *
 * ترتیب مهم است: نقش (`set role`) پیش از زمینه یا پس از آن؟ نقش تعیین می‌کند
 * RLS کدام سیاست‌ها را ببیند؛ زمینه تعیین می‌کند آن سیاست‌ها چه تصمیمی
 * بگیرند. پس اول نقش، بعد زمینه — و هر دو داخل همان تراکنش.
 */
export async function withContext<T>(
  client: SqlClient,
  context: RequestContext,
  fn: (client: SqlClient) => Promise<T>,
  options: { role?: Parameters<SqlClient['asRole']>[0] } = {},
): Promise<T> {
  return client.withTransaction(async (tx) => {
    await applyContext(tx, context);
    if (options.role) {
      return tx.asRole(options.role, fn);
    }
    return fn(tx);
  });
}

/** ست‌کردن زمینه در تراکنش جاری. */
export async function applyContext(client: SqlClient, context: RequestContext): Promise<void> {
  const settings = contextSettings(context);
  if (settings.length === 0) return;

  const params: unknown[] = [];
  const assignments = settings.map(([key, value]) => {
    params.push(key, value);
    return `set_config($${params.length - 1}, $${params.length}, true)`;
  });

  await client.query(`select ${assignments.join(', ')}`, params);
}

/**
 * نگهبان مستأجر.
 *
 * هر کوئری‌ای که به دادهٔ کسب‌وکار دست می‌زند باید مستأجرش را بگوید. این
 * تابع، «گفتن» را به یک تابع تبدیل می‌کند تا جاافتادنش دیده شود: بدون آن،
 * یک کوئری می‌تواند بی‌سر‌و‌صدا از RLS عبور کند و همهٔ کسب‌وکارها را بخواند.
 */
export function requireBusinessId(context: RequestContext, action = 'این عملیات'): string {
  const businessId = context.businessId;
  if (typeof businessId !== 'string' || businessId.trim() === '') {
    throw new AppError('forbidden', {
      message: `${action} به کسب‌وکار جاری نیاز دارد`,
      details: { reason: 'missing_tenant_context' },
    });
  }
  return businessId;
}

/**
 * آیا این درخواست با اختیار کاربر دیگری اجرا می‌شود؟
 *
 * جعل هویت (§31) مجاز است، ولی باید دیده شود: هر رخداد و رد حسابرسی، هر دو
 * شناسه را نگه می‌دارد و درخواست‌های جهش‌دهنده در حالت جعل هویت، محدودترند.
 */
export function isImpersonating(context: RequestContext): boolean {
  return typeof context.impersonatedBy === 'string' && context.impersonatedBy !== '';
}

/** زمینهٔ سیستم/کارگر: بی‌کاربر، برای کارهای پس‌زمینه. */
export function systemContext(requestId?: string): RequestContext {
  return { userId: null, businessId: null, platformRole: null, impersonatedBy: null, requestId: requestId ?? null };
}
