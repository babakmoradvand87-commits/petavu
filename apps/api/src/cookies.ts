/**
 * نام کوکی‌ها، در یک نقطه (گام ۲۱؛ §9، §12).
 *
 * چرا این فایل وجود دارد: نام کوکی، قرارداد بین سه جا است — لحظهٔ ورود که
 * کوکی را می‌نشاند، خط لوله که آن را می‌خواند، و خروج که پاکش می‌کند. اگر
 * این نام در سه جا ساخته شود، اولین تغییری که یک جا اعمال نشود، نشست را
 * بی‌صدا می‌شکند («کاربر وارد می‌شود ولی هر درخواست بی‌نام است»).
 */

import type { Env } from '@petavu/shared';

export interface CookieNames {
  /** کوکی نشست؛ `HttpOnly` و بی‌دامنه (§9). */
  readonly session: string;
  /** کوکی CSRF؛ عمداً خواندنی، چون الگوی ارسال دوگانه همین را می‌خواهد (§12). */
  readonly csrf: string;
}

export function cookieNames(env: Env): CookieNames {
  const secure = env.isProduction;
  const base = env.security.sessionCookieName;
  // در تولید، `__Host-` هم کوکی نشست را می‌گیرد و هم کوکی CSRF را: هر دو روی
  // همان دامنه، بدون Domain، با Path=/ — و همین «بدون Domain» است که اجازه
  // نمی‌دهد کوکی روی `.petavu.ir` و ساب‌دامین‌های خواهر پخش شود.
  const prefix = secure ? '__Host-' : '';
  return { session: `${prefix}${base}`, csrf: `${prefix}${base}_csrf` };
}
