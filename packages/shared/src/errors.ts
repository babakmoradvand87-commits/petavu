/**
 * خطاهای ساختاریافته — §65
 *
 * هر خطایی که به کاربر یا مصرف‌کنندهٔ API می‌رسد، یک شکل دارد:
 *
 *   { code, message, details, request_id }
 *
 * سه قاعده اینجا اعمال می‌شود و هیچ‌جای دیگری نباید تکرار شود:
 *
 *   * `code` ماشین‌خوان و پایدار است. متن پیام می‌تواند تغییر کند، کد نه.
 *   * `message` هرگز چیزی از داخل سیستم را افشا نمی‌کند. جزئیات فنی در لاگ
 *     می‌ماند، نه در پاسخ (§78).
 *   * خطای نامنتظر (باگ) و خطای انتظاررفته (ورودی بد، دسترسی نداشتن) یکی
 *     نیستند: اولی ۵۰۰ است و لاگ می‌شود، دومی پاسخ عادی است.
 */

/** کدهای خطا. فهرست بسته است: کد تازه یعنی افزودن به همین فهرست. */
export const ERROR_CODES = {
  validation_failed: 400,
  unauthenticated: 401,
  mfa_required: 401,
  step_up_required: 403,
  csrf_failed: 403,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
  conflict: 409,
  precondition_failed: 412,
  payload_too_large: 413,
  unsupported_media_type: 415,
  rate_limited: 429,
  account_locked: 423,
  internal_error: 500,
  not_implemented: 501,
  database_unavailable: 503,
  service_unavailable: 503,
  timeout: 504,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

/** پیام پیش‌فرض هر کد. پیام کاربرپسند است، نه پیام توسعه‌دهنده. */
const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  validation_failed: 'اطلاعات ارسالی کامل یا درست نیست.',
  unauthenticated: 'برای این کار باید وارد شوید.',
  mfa_required: 'برای ادامه، تأیید دومرحله‌ای لازم است.',
  step_up_required: 'برای این کار حساس، دوباره هویت خود را تأیید کنید.',
  csrf_failed: 'درخواست از منبع معتبر نیامده است.',
  forbidden: 'به این بخش دسترسی ندارید.',
  not_found: 'موردی که خواستید پیدا نشد.',
  method_not_allowed: 'این روش برای این نشانی مجاز نیست.',
  conflict: 'این تغییر با وضعیت فعلی سازگار نیست.',
  precondition_failed: 'نسخهٔ شما از این اطلاعات قدیمی است؛ صفحه را تازه کنید.',
  payload_too_large: 'حجم درخواست بیش از حد مجاز است.',
  unsupported_media_type: 'نوع فایل پشتیبانی نمی‌شود.',
  rate_limited: 'تعداد درخواست‌ها زیاد بود؛ کمی بعد دوباره تلاش کنید.',
  account_locked: 'این حساب موقتاً قفل است.',
  internal_error: 'خطای غیرمنتظره‌ای رخ داد. لطفاً دوباره تلاش کنید.',
  not_implemented: 'این امکان هنوز فعال نشده است.',
  database_unavailable: 'ارتباط با پایگاه‌داده برقرار نشد.',
  service_unavailable: 'سرویس موقتاً در دسترس نیست.',
  timeout: 'پاسخ در زمان مجاز نرسید.',
};

export interface AppErrorOptions {
  /** پیام جایگزین. اگر نیاید، پیام پیش‌فرض کد استفاده می‌شود. */
  message?: string;
  /** داده‌های ساختاریافته برای مصرف‌کنندهٔ API. نباید اطلاعات حساس داشته باشد. */
  details?: Record<string, unknown>;
  /** خطای اصلی، فقط برای لاگ. هرگز به پاسخ نمی‌رود. */
  cause?: unknown;
}

/**
 * خطای دامنه.
 *
 * ارث‌بری از `Error` است تا در `instanceof` کار کند، اما چیزی که مصرف‌کننده
 * می‌بیند، فیلدهای صریح است نه پشتهٔ خطا.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;
  /** آیا این خطا می‌تواند با تلاش دوباره موفق شود؟ برای تصمیم کلاینت. */
  readonly retryable: boolean;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    super(options.message ?? DEFAULT_MESSAGES[code], options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_CODES[code];
    if (options.details) this.details = options.details;
    // فقط خطاهایی که ماهیت گذرا دارند قابل تلاش دوباره‌اند. `conflict` نیست:
    // تلاش دوباره با همان داده، همان تعارض را می‌سازد.
    this.retryable = code === 'database_unavailable' || code === 'service_unavailable' || code === 'timeout';
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** شکل ثابتی که به بیرون می‌رود (§65). */
export interface ErrorPayload {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
    request_id: string;
  };
}

/**
 * هر خطای ناشناخته را به `internal_error` تبدیل می‌کند.
 *
 * یک خطای پایگاه‌داده با کد شناخته‌شده، به خطای دامنهٔ درست ترجمه می‌شود؛ بقیه
 * چیزها باگ‌اند و باگ‌ها ۵۰۰ می‌گیرند — نه پیام مفصل، نه جزئیات.
 */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;

  // `zod` خطاهای اعتبارسنجی خودش را دارد؛ در مرز API به این کد نگاشت می‌شود.
  if (typeof error === 'object' && error !== null && 'name' in error && (error as { name?: string }).name === 'ZodError') {
    const issues = (error as { issues?: Array<{ path?: unknown[]; code?: string }> }).issues ?? [];
    return new AppError('validation_failed', {
      details: {
        issues: issues.slice(0, 12).map((issue) => ({
          path: (issue.path ?? []).map(String).join('.'),
          code: issue.code ?? 'invalid',
        })),
      },
      cause: error,
    });
  }

  // کدهای شناخته‌شدهٔ PostgreSQL که معنی دامنه‌ای دارند (§56، §106).
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = String((error as { code: unknown }).code);
    if (code === '23505') return new AppError('conflict', { details: { reason: 'unique_violation' }, cause: error });
    if (code === '23503') return new AppError('validation_failed', { details: { reason: 'missing_reference' }, cause: error });
    if (code === '23514') return new AppError('validation_failed', { details: { reason: 'check_violation' }, cause: error });
    if (code === '40001' || code === '40P01') return new AppError('conflict', { details: { reason: 'concurrent_write' }, cause: error });
    if (code === '42501') return new AppError('forbidden', { details: { reason: 'insufficient_privilege' }, cause: error });
    if (code === '57014') return new AppError('timeout', { cause: error });
    if (code === 'ECONNREFUSED' || code === '57P03') return new AppError('database_unavailable', { cause: error });
  }

  return new AppError('internal_error', { cause: error });
}

/** پاسخ خطا برای HTTP. `requestId` همیشه هست، حتی وقتی هیچ چیز دیگری نیست. */
export function errorPayload(error: AppError, requestId: string): ErrorPayload {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
      request_id: requestId,
    },
  };
}
