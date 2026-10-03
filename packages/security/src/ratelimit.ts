/**
 * محدودیت نرخ — §13
 *
 * چهار بُعد، چون هر بُعدی تنها، راه دور زدن دارد:
 *
 *   * IP — جلوی اسکن گسترده را می‌گیرد، ولی پشت NAT مشترک است و مهاجم هم
 *     می‌تواند IP عوض کند.
 *   * حساب — جلوی حملهٔ هدف‌مند به یک کاربر را می‌گیرد، حتی اگر مهاجم هزار IP
 *     داشته باشد (botnet).
 *   * دستگاه — جلوی سوءاستفاده از توکن دزدیده‌شده از یک دستگاه را می‌گیرد.
 *   * ریسک — نرخ تطبیقی: هرچه نشانه‌های ریسک بیشتر، سقف کمتر.
 *
 * الگوریتم: پنجرهٔ لغزان با شمارندهٔ وزنی. حافظهٔ O(1) برای هر کلید (دو عدد،
 * نه فهرست زمان‌ها) و بدون «لبهٔ تیز» پنجرهٔ ثابت که اجازه می‌دهد دو برابر
 * سقف در دو سوی مرز پنجره رد شود.
 *
 * دربارهٔ ذخیره‌گاه: `MemoryRateLimitStore` واقعی است، ولی در حافظهٔ *یک*
 * فرایند. اگر چند نمونهٔ API بالا باشد، سقف مؤثر چند برابر می‌شود. پس این
 * گزینه فقط برای تک‌نمونه یا لایهٔ دوم دفاع است؛ ذخیره‌گاه مشترک (Postgres یا
 * Redis) با همان اینترفیس در فاز عملیات اضافه می‌شود و کد مصرف‌کننده تغییر
 * نمی‌کند. این وضعیت در پروفایل سلامت سیستم صادقانه گزارش می‌شود (§102).
 */

import { hashIdentifier } from './tokens.js';

export interface RateLimitRule {
  /** نام قاعده؛ در کلید و در لاگ می‌آید. */
  readonly name: string;
  /** بیشترین تعداد مجاز در پنجره. */
  readonly limit: number;
  readonly windowMs: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly rule: string;
  readonly limit: number;
  readonly remaining: number;
  readonly resetAtMs: number;
  readonly retryAfterSeconds: number;
}

export interface RateLimitStore {
  /** شمارش وزنی پنجرهٔ لغزان برای یک کلید؛ عدد اعشاری، وزن بخش پیشین است. */
  count(key: string, windowMs: number, nowMs: number): Promise<number>;
  /** ثبت یک رخداد. */
  hit(key: string, windowMs: number, nowMs: number): Promise<void>;
  /** خانه‌تکانی کلیدهای منقضی. در ذخیره‌گاه‌های بیرونی، بی‌اثر است. */
  prune?(nowMs: number): Promise<void>;
}

interface MemoryBucket {
  windowStart: number;
  current: number;
  previous: number;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, MemoryBucket>();
  private readonly maxKeys: number;

  constructor(options: { maxKeys?: number } = {}) {
    this.maxKeys = options.maxKeys ?? 50_000;
  }

  private bucket(key: string, windowMs: number, nowMs: number): MemoryBucket {
    const existing = this.buckets.get(key);
    const windowStart = Math.floor(nowMs / windowMs) * windowMs;
    if (!existing) {
      const fresh: MemoryBucket = { windowStart, current: 0, previous: 0 };
      this.buckets.set(key, fresh);
      return fresh;
    }
    if (existing.windowStart === windowStart) return existing;

    const movedBy = Math.floor((windowStart - existing.windowStart) / windowMs);
    existing.previous = movedBy === 1 ? existing.current : 0;
    existing.current = 0;
    existing.windowStart = windowStart;
    return existing;
  }

  async count(key: string, windowMs: number, nowMs: number): Promise<number> {
    const bucket = this.bucket(key, windowMs, nowMs);
    const elapsed = nowMs - bucket.windowStart;
    const weight = Math.max(0, 1 - elapsed / windowMs);
    return bucket.previous * weight + bucket.current;
  }

  async hit(key: string, windowMs: number, nowMs: number): Promise<void> {
    if (this.buckets.size >= this.maxKeys) this.pruneSync(nowMs, windowMs);
    const bucket = this.bucket(key, windowMs, nowMs);
    bucket.current += 1;
  }

  async prune(nowMs: number): Promise<void> {
    this.pruneSync(nowMs, 60 * 60 * 1_000);
  }

  private pruneSync(nowMs: number, windowMs: number): void {
    // اگر هنوز پر است، قدیمی‌ترین‌ها حذف می‌شوند. سقف سخت لازم است تا یک حملهٔ
    // تولید کلید (مثلاً با IP جعلی) حافظه را پر نکند.
    const cutOff = nowMs - windowMs * 2;
    for (const [key, bucket] of this.buckets) {
      if (bucket.windowStart < cutOff) this.buckets.delete(key);
    }
    if (this.buckets.size >= this.maxKeys) {
      const excess = this.buckets.size - Math.floor(this.maxKeys * 0.9);
      let removed = 0;
      for (const key of this.buckets.keys()) {
        this.buckets.delete(key);
        removed += 1;
        if (removed >= excess) break;
      }
    }
  }

  /** فقط برای تست و پایش: تعداد کلیدهای فعال. */
  size(): number {
    return this.buckets.size;
  }
}

export interface RateLimiterOptions {
  readonly store: RateLimitStore;
  /** زمان‌سنج قابل‌تزریق، تا تست‌ها به ساعت واقعی وابسته نباشند. */
  readonly now?: () => number;
}

export class RateLimiter {
  private readonly store: RateLimitStore;
  private readonly now: () => number;

  constructor(options: RateLimiterOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => Date.now());
  }

  /** بررسی بدون ثبت — برای پیش‌نمایش باقی‌مانده. */
  async peek(key: string, rule: RateLimitRule): Promise<RateLimitDecision> {
    const nowMs = this.now();
    const used = await this.store.count(key, rule.windowMs, nowMs);
    return this.decide(rule, used, nowMs);
  }

  /** ثبت یک تلاش و بازگرداندن تصمیم. */
  async consume(key: string, rule: RateLimitRule): Promise<RateLimitDecision> {
    const nowMs = this.now();
    const used = await this.store.count(key, rule.windowMs, nowMs);
    const decision = this.decide(rule, used, nowMs);
    if (decision.allowed) await this.store.hit(key, rule.windowMs, nowMs);
    return decision;
  }

  /**
   * چند قاعده با هم. سخت‌گیرانه‌ترین تصمیم برنده است، ولی همهٔ تلاش‌ها ثبت
   * می‌شوند تا محدودیت‌ها هم‌زمان پیش بروند.
   */
  async consumeAll(keyFor: (rule: RateLimitRule) => string, rules: readonly RateLimitRule[]): Promise<RateLimitDecision> {
    const decisions = await Promise.all(rules.map((rule) => this.consume(keyFor(rule), rule)));
    return strictest(decisions);
  }

  private decide(rule: RateLimitRule, used: number, nowMs: number): RateLimitDecision {
    const allowed = used < rule.limit;
    const windowStart = Math.floor(nowMs / rule.windowMs) * rule.windowMs;
    const resetAtMs = windowStart + rule.windowMs;
    // معنای `remaining`: چند درخواست دیگر تا رسیدن به سقف، با فرض اینکه
    // درخواست جاری مجاز باشد. این همان معنایی است که هدر `RateLimit-Remaining`
    // در پیش‌نویس استاندارد دارد، پس کلاینت با یک عدد واحد کار می‌کند.
    const remaining = allowed ? Math.max(0, Math.floor(rule.limit - used) - 1) : 0;
    return {
      allowed,
      rule: rule.name,
      limit: rule.limit,
      remaining,
      resetAtMs,
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((resetAtMs - nowMs) / 1_000)),
    };
  }
}

function strictest(decisions: readonly RateLimitDecision[]): RateLimitDecision {
  let winner = decisions[0];
  if (!winner) throw new RangeError('فهرست قاعده‌ها خالی است');
  for (const decision of decisions) {
    if (decision.allowed && !winner.allowed) continue;
    if (!decision.allowed && winner.allowed) {
      winner = decision;
      continue;
    }
    if (decision.retryAfterSeconds > winner.retryAfterSeconds) winner = decision;
    else if (decision.retryAfterSeconds === winner.retryAfterSeconds && decision.remaining < winner.remaining) winner = decision;
  }
  return winner;
}

/* ------------------------------------------------------------------ *
 * قاعده‌های استاندارد و ساخت کلید
 *
 * اعداد اینجا سیاست‌اند، نه سلیقه: هر عدد با یک توجیه آمده است. تغییرشان
 * باید در ADR ثبت شود.
 * ------------------------------------------------------------------ */

export const RATE_LIMITS = {
  /** ورود: ۱۰ تلاش در ۱۵ دقیقه برای هر حساب، ۳۰ برای هر IP. */
  loginAccount: { name: 'login_account', limit: 10, windowMs: 15 * 60_000 },
  loginIp: { name: 'login_ip', limit: 30, windowMs: 15 * 60_000 },
  /** ثبت‌نام: ۵ حساب در ساعت برای هر IP؛ جلوی ساخت انبوه حساب. */
  registerIp: { name: 'register_ip', limit: 5, windowMs: 60 * 60_000 },
  /** بازیابی رمز: سخت‌گیرانه، چون ابزار ارسال پیام است. */
  passwordResetAccount: { name: 'password_reset_account', limit: 3, windowMs: 60 * 60_000 },
  passwordResetIp: { name: 'password_reset_ip', limit: 10, windowMs: 60 * 60_000 },
  /** تأیید دومرحله‌ای: هر کد، ۵ تلاش. */
  mfaVerify: { name: 'mfa_verify', limit: 5, windowMs: 10 * 60_000 },
  /** عملیات حساس با re-auth: جلوی سوءاستفاده از نشست باز را می‌گیرد. */
  stepUp: { name: 'step_up', limit: 5, windowMs: 10 * 60_000 },
  /** بارگذاری فایل: پرحجم‌ترین عملیات کاربر. */
  uploadAccount: { name: 'upload_account', limit: 60, windowMs: 60 * 60_000 },
  /** جست‌وجو و فهرست‌های عمومی: سخاوتمندانه، ولی نه بی‌سقف. */
  publicRead: { name: 'public_read', limit: 600, windowMs: 60_000 },
  searchPublic: { name: 'search_public', limit: 120, windowMs: 60_000 },
  /** فرم‌های عمومی (تماس، درخواست قیمت، عضویت خبرنامه). */
  publicForm: { name: 'public_form', limit: 5, windowMs: 60 * 60_000 },
  /** دعوت کاربران به کسب‌وکار. */
  invitationAccount: { name: 'invitation_account', limit: 20, windowMs: 24 * 60 * 60_000 },
  /** API عمومی با کلید. */
  apiKey: { name: 'api_key', limit: 1_000, windowMs: 60_000 },
  /** کارهای سنگین مثل تولید سایتمپ یا اجرای تحلیل. */
  heavyJob: { name: 'heavy_job', limit: 10, windowMs: 60 * 60_000 },
  /*
   * سقف پیش‌فرض مسیرهای احرازشده.
   *
   * چرا جدا از `publicForm`: آن یکی برای فرم بی‌نام پشت اینترنت است (۵ در
   * ساعت)، این یکی برای پنل یک کسب‌وکار که چند نفر هم‌زمان روی یک شبکهٔ
   * اداری کار می‌کنند. اگر یک سقف داشتند، یا پنل با ۵ نوشتن در ساعت فلج
   * می‌شد یا فرم عمومی بی‌دفاع. کلید هر مسیر جداست، پس انفجار یک مسیر،
   * بقیه را نمی‌بندد.
   */
  writeGeneral: { name: 'write_general', limit: 120, windowMs: 60_000 },
  readGeneral: { name: 'read_general', limit: 600, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;

/** ضریب ریسک: هرچه بزرگ‌تر، سقف تنگ‌تر. */
export function riskAdjusted(rule: RateLimitRule, riskFactor: number): RateLimitRule {
  if (riskFactor <= 1) return rule;
  const divisor = Math.max(1, Math.floor(riskFactor));
  return { ...rule, limit: Math.max(1, Math.floor(rule.limit / divisor)) };
}

/**
 * کلید محدودیت.
 *
 * شناسه‌های شخصی (شمارهٔ تماس، ایمیل) هرگز خام در کلید نمی‌آیند: کلید ممکن است
 * در لاگ یا در یک ذخیره‌گاه مشترک دیده شود. پس درهم می‌شوند.
 */
export const limitKeys = {
  ip: (scope: string, ip: string): string => `${scope}:ip:${ip}`,
  account: (scope: string, identifier: string): string => `${scope}:acct:${hashIdentifier(identifier)}`,
  device: (scope: string, deviceId: string): string => `${scope}:dev:${deviceId}`,
  session: (scope: string, sessionId: string): string => `${scope}:ses:${sessionId}`,
  business: (scope: string, businessId: string): string => `${scope}:bz:${businessId}`,
  apiKey: (scope: string, keyId: string): string => `${scope}:key:${keyId}`,
} as const;

export interface RiskSignals {
  /** IP در فهرست بدنام است. */
  readonly flaggedIp?: boolean;
  /** دستگاه تازه است. */
  readonly newDevice?: boolean;
  /** تلاش‌های ناموفق اخیر. */
  readonly recentFailures?: number;
  /** سرعت غیرطبیعی درخواست. */
  readonly unusualVelocity?: boolean;
}

/**
 * ضریب ریسک از نشانه‌ها. این تابع نقطهٔ واحدی است که بعداً می‌تواند با تحلیل
 * واقعی جایگزین شود، بدون تغییر در مصرف‌کننده‌ها.
 */
export function riskFactor(signals: RiskSignals): number {
  let factor = 1;
  if (signals.flaggedIp) factor *= 4;
  if (signals.newDevice) factor *= 2;
  if (signals.unusualVelocity) factor *= 2;
  if (signals.recentFailures && signals.recentFailures > 3) factor *= 2;
  return Math.min(factor, 16);
}

/** هدر استاندارد پاسخ محدودیت نرخ. */
export function rateLimitHeaders(decision: RateLimitDecision): Record<string, string> {
  const headers: Record<string, string> = {
    'RateLimit-Limit': String(decision.limit),
    'RateLimit-Remaining': String(decision.remaining),
    'RateLimit-Reset': String(Math.max(0, Math.ceil((decision.resetAtMs - Date.now()) / 1_000))),
  };
  if (!decision.allowed) headers['Retry-After'] = String(decision.retryAfterSeconds);
  return headers;
}
