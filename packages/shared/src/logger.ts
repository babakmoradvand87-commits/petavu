/**
 * لاگ ساختاریافته — §96، §99
 *
 * لاگ یک متن خوانا نیست؛ یک رویداد ماشین‌خوان است. هر خط یک JSON است با
 * فیلدهای ثابت، تا بتوان در هر زمان‌بندی جست‌وجو و فیلتر کرد.
 *
 * `request_id` ستون فقرات ردیابی است: از مرورگر می‌آید، در API می‌ماند، به
 * پرس‌وجوهای پایگاه‌داده می‌رسد و در کارهای صف ادامه پیدا می‌کند
 * (Addendum — Correlation مرورگر → API → DB → Queue).
 *
 * قاعدهٔ امنیتی: از کاربر و از دادهٔ حساس هیچ‌وقت لاگ نمی‌گیریم. رمز، توکن،
 * کلید، کوکی و محتوای بدنهٔ درخواست هرگز در لاگ نمی‌آید. اگر لازم باشد بدانیم
 * چه چیزی رد شد، نام فیلد را لاگ می‌کنیم، نه مقدارش (§78).
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** فیلدهایی که هرگز نباید در لاگ ظاهر شوند، حتی اگر کسی تصادفی پاس بدهد. */
const REDACTED_KEYS: ReadonlySet<string> = new Set([
  'password', 'pass', 'passwd', 'secret', 'token', 'access_token', 'refresh_token',
  'authorization', 'cookie', 'set-cookie', 'apikey', 'api_key', 'service_role_key',
  'anon_key', 'private_key', 'totp', 'otp', 'code', 'recovery_code', 'csrf',
  'session', 'session_id', 'pepper', 'hash', 'password_hash', 'signature',
]);

export interface LogRecord {
  readonly level: LogLevel;
  readonly time: string;
  readonly msg: string;
  readonly request_id?: string;
  readonly actor_id?: string;
  readonly business_id?: string;
  readonly [field: string]: unknown;
}

export interface LogContext {
  readonly requestId?: string;
  readonly actorId?: string;
  readonly businessId?: string;
  /** شناسهٔ ردیابی کار صف؛ برای Correlation بین API و Worker. */
  readonly jobId?: string;
}

const contextStore = new AsyncLocalStorage<LogContext>();

/** اجرای یک تابع در بافت لاگ. هر لاگ داخل آن، این فیلدها را حمل می‌کند. */
export function withLogContext<T>(context: LogContext, fn: () => T): T {
  return contextStore.run(context, fn);
}

export function currentLogContext(): LogContext {
  return contextStore.getStore() ?? {};
}

function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 4) return '[عمق بیش از حد]';
  if (typeof value === 'string') return value.length > 2_000 ? `${value.slice(0, 2_000)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: value.message, code: (value as { code?: unknown }).code };
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACTED_KEYS.has(key.toLowerCase()) ? '[حذف‌شده]' : redact(item, depth + 1);
    }
    return out;
  }
  return '[غیرقابل‌نمایش]';
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  /** لاگر فرزند با فیلدهای ثابت اضافه. */
  child(context: LogContext): Logger;
}

export interface LoggerOptions {
  readonly level?: LogLevel;
  readonly context?: LogContext;
  /** برای تست: خروجی را می‌گیرد به‌جای چاپ. */
  readonly sink?: (record: LogRecord) => void;
  readonly now?: () => Date;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  const baseContext = options.context ?? {};
  const sink = options.sink ?? defaultSink;
  const now = options.now ?? (() => new Date());

  const emit = (recordLevel: LogLevel, msg: string, fields?: Record<string, unknown>): void => {
    if (LEVEL_WEIGHT[recordLevel] < LEVEL_WEIGHT[level]) return;

    // بافت داخلی با نام camelCase نگه داشته می‌شود، ولی آنچه بیرون می‌رود
    // snake_case است. دلیلش قرارداد است: مصرف‌کنندهٔ لاگ (جست‌وجو، داشبورد،
    // هشدار) روی نام فیلدهای ثابت حساب می‌کند، نه روی سبک کدنویسی ما.
    const context = { ...baseContext, ...currentLogContext() };
    const record: LogRecord = {
      level: recordLevel,
      time: now().toISOString(),
      msg,
      ...(context.requestId ? { request_id: context.requestId } : {}),
      ...(context.actorId ? { actor_id: context.actorId } : {}),
      ...(context.businessId ? { business_id: context.businessId } : {}),
      ...(context.jobId ? { job_id: context.jobId } : {}),
      ...(redact(fields ?? {}) as Record<string, unknown>),
    };
    sink(record);
  };

  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
    child: (context) => createLogger({ level, context: { ...baseContext, ...context }, sink, now }),
  };
}

/**
 * خروجی پیش‌فرض: یک خط JSON روی stdout.
 * زمان خطا از stderr استفاده می‌شود تا در جمع‌آوری لاگ جدا شود.
 */
function defaultSink(record: LogRecord): void {
  const line = JSON.stringify(record);
  if (record.level === 'error' || record.level === 'warn') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

/** لاگر بی‌اثر، برای تست‌هایی که به لاگ کاری ندارند. */
export function silentLogger(): Logger {
  let logger: Logger;
  const noop = (): void => {};
  logger = { debug: noop, info: noop, warn: noop, error: noop, child: () => logger };
  return logger;
}

/** لاگر درون‌حافظه‌ای؛ برای بررسی در تست. */
export function memoryLogger(level: LogLevel = 'debug'): Logger & { records: LogRecord[] } {
  const records: LogRecord[] = [];
  const logger = createLogger({ level, sink: (record) => records.push(record) }) as Logger & { records: LogRecord[] };
  logger.records = records;
  return logger;
}
