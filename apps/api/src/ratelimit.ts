/**
 * سقف نرخ پایدار (گام ۲۱؛ §13، §104).
 *
 * چرا اینجا ذخیره‌گاه حافظه‌ای نیست: اگر سقف نرخ فقط در حافظهٔ هر نمونه باشد،
 * با دو نمونهٔ API سقف دو برابر می‌شود و با راه‌اندازی مجدد صفر. شمارنده در
 * پایگاه‌داده است (`ops.rate_limit_counter` + `ops.consume_rate_limit`)، پس
 * بین نمونه‌ها مشترک است، و همان پنجره‌ای را می‌شمارد که ما فکر می‌کنیم.
 *
 * دو نکتهٔ ریز اما مهم:
 *
 *   • **موضوع، درهم می‌شود.** `subject_hash` هرگز IP یا ایمیل خام نیست؛
 *     جدول شمارنده ممکن است در پشتیبان یا تحلیل دیده شود.
 *   • **تقسیم موضوع‌ها**: `ip` و `route` دو فضای جدا هستند تا یک مسیر پرترافیک
 *     سهمیهٔ IP را نسوزاند و برعکس.
 */

import { hashIdentifier, type RateLimitDecision, type RateLimitRule } from '@petavu/security';
import { withContext, type Row, type SqlClient } from '@petavu/db';
import type { Logger } from '@petavu/shared';

export type SubjectKind = 'ip' | 'account' | 'device' | 'risk' | 'route' | 'webhook';

export interface DbRateLimiterOptions {
  readonly client: SqlClient;
  readonly logger: Logger;
  /** در آزمون‌ها خاموش می‌شود تا هر درخواست، یک تراکنش اضافه نسازد. */
  readonly enabled?: boolean;
  /** در آزمون‌ها: سقف ثابت تزریق‌شده. */
  readonly now?: () => number;
}

export type ConsumeRateLimit = (key: string, rule: RateLimitRule, requestId: string) => Promise<RateLimitDecision>;

/**
 * ساخت مصرف‌کنندهٔ سقف نرخ.
 *
 * کلید ورودی، شکلی قراردادی دارد: `<kind>:<scope>:<subject>`. اگر کلید
 * ناشناخته باشد، «مجاز» برمی‌گردانیم و لاگ می‌کنیم — محدودیت نرخ هرگز نباید
 * به دلیل خطای برنامه‌نویسی، سرویس را بخواباند یا بی‌صدا همه را ببندد.
 */
export function createDbRateLimiter(options: DbRateLimiterOptions): ConsumeRateLimit {
  const { client, logger } = options;
  const enabled = options.enabled ?? true;
  const now = options.now ?? (() => Date.now());

  return async function consumeRateLimit(key, rule, requestId) {
    if (!enabled) {
      return allowed(rule, now());
    }

    const parsed = parseKey(key);
    if (!parsed) {
      logger.warn('کلید سقف نرخ نامعتبر بود؛ رد نشد', { key_prefix: key.slice(0, 12) });
      return allowed(rule, now());
    }

    try {
      const result = await withContext(client, { requestId }, (tx) =>
        tx.asRole('pv_app', () =>
          tx.query<Row>('select allowed, remaining, reset_at, hits from ops.consume_rate_limit($1, $2, $3, $4, 1)', [
            parsed.kind,
            parsed.subjectHash,
            Math.max(1, Math.min(86_400, Math.round(rule.windowMs / 1000))),
            rule.limit,
          ]),
        ),
      );

      const row = result.rows[0];
      if (!row) return allowed(rule, now());

      const allowedFlag = row.allowed === true;
      const resetAtMs = row.reset_at ? new Date(String(row.reset_at)).getTime() : now() + rule.windowMs;

      return {
        allowed: allowedFlag,
        rule: rule.name,
        limit: rule.limit,
        remaining: Number(row.remaining ?? 0),
        resetAtMs,
        retryAfterSeconds: allowedFlag ? 0 : Math.max(1, Math.ceil((resetAtMs - now()) / 1000)),
      };
    } catch (error) {
      /*
       * شکست زیرساخت سقف نرخ، «باز» است نه «بسته». دلیلش صریح است: بستنِ
       * سرویس چون شمارنده در دسترس نیست، خودش یک حملهٔ سادهٔ انکار سرویس
       * می‌سازد. ولی شکست، لاگ سطح warn می‌گیرد تا بی‌صدا نماند.
       */
      logger.warn('سقف نرخ در دسترس نبود؛ درخواست رد نشد', {
        rule: rule.name,
        error: error instanceof Error ? error.message : 'unknown',
      });
      return allowed(rule, now());
    }
  };
}

function allowed(rule: RateLimitRule, nowMs: number): RateLimitDecision {
  return {
    allowed: true,
    rule: rule.name,
    limit: rule.limit,
    remaining: rule.limit,
    resetAtMs: nowMs + rule.windowMs,
    retryAfterSeconds: 0,
  };
}

export interface ParsedRateKey {
  readonly kind: SubjectKind;
  readonly scope: string;
  readonly subjectHash: string;
}

const KINDS: readonly SubjectKind[] = ['ip', 'account', 'device', 'risk', 'route', 'webhook'];
const KIND_ALIASES: Record<string, SubjectKind> = { acct: 'account', dev: 'device', ses: 'account', bz: 'account', key: 'account' };

/** `<kind>:<scope>:<subject>` → موضوع درهم‌شده. شکل نامعتبر، `null`. */
export function parseKey(key: string): ParsedRateKey | null {
  const parts = key.split(':');
  if (parts.length < 3) return null;
  const [rawKind, scope, ...rest] = parts as [string, string, ...string[]];
  const subject = rest.join(':');
  if (subject === '') return null;

  const kind = KIND_ALIASES[rawKind] ?? (KINDS.includes(rawKind as SubjectKind) ? (rawKind as SubjectKind) : null);
  if (!kind) return null;

  return { kind, scope, subjectHash: hashIdentifier(`${scope}:${subject}`) };
}
