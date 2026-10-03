/**
 * انواع مشترک لایهٔ API (گام ۲۱؛ §64–۷۸).
 *
 * چرا قرارداد مسیر (RouteDefinition) داده است و نه decorator: §103 می‌گوید
 * Source of Truth باید قابل‌خواندن و قابل‌تولید باشد. یک فهرست داده‌ای از
 * مسیرها، هم مسیریاب را می‌سازد، هم OpenAPI را، هم آزمون پوشش را — از یک جا.
 * اگر این سه از سه جای مختلف تولید شوند، دیر یا زود واگرا می‌شوند.
 */

import type { DatabaseRole, Dal, Repositories, RequestContext, Row, SqlClient, SqlParams } from '@petavu/db';
import type { Env, Logger, Clock } from '@petavu/shared';
import type { PasswordHasher, RateLimitRule } from '@petavu/security';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export const MUTATING_METHODS: readonly HttpMethod[] = ['POST', 'PATCH', 'PUT', 'DELETE'];

/** حالت احراز هویت درخواست. سه حالت، و هیچ حالت چهارمی وجود ندارد. */
export type AuthState =
  | { readonly kind: 'anonymous' }
  | {
      readonly kind: 'session';
      readonly sessionId: string;
      readonly userId: string;
      readonly displayName: string;
      readonly locale: string;
      readonly timezone: string;
      readonly stepUpAt: string | null;
      readonly platformRole: string | null;
      readonly impersonatedBy: string | null;
      readonly activeBusinessId: string | null;
      readonly expiresAt: string;
      readonly absoluteExpiresAt: string;
    }
  | { readonly kind: 'api-key'; readonly keyId: string; readonly businessId: string; readonly scopes: readonly string[] };

export interface ApiRequest {
  readonly method: HttpMethod;
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  readonly headers: Readonly<Record<string, string>>;
  readonly rawBody: string;
  readonly body: unknown;
  readonly requestId: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly origin: string | null;
  readonly auth: AuthState;
  /** کسب‌وکار مؤثر درخواست؛ از هدر، از نشست یا از کلید API. */
  readonly businessId: string | null;
  readonly context: RequestContext;
  readonly route: RouteDefinition;
  readonly startedAtMs: number;
}

export interface ApiResult {
  readonly status?: number;
  readonly body: unknown;
  /** هدرهای اضافه؛ هرگز هدرهای امنیتی را بازنویسی نمی‌کنند. */
  readonly headers?: Record<string, string>;
  readonly cookies?: string[];
}

/** دامنهٔ اجرای دستور: همان چیزی که هر مسیر برای کار با داده لازم دارد. */
export interface Scope {
  readonly client: SqlClient;
  readonly dal: Dal;
  readonly repos: Repositories;
  readonly context: RequestContext;
  /** سرویس‌های برنامه (محیط، لاگر)؛ برای مسیرهایی مثل `ready` که وضعیت می‌دهند. */
  readonly services: ApiServices;
  query<TRow extends Row = Row>(text: string, params?: SqlParams): Promise<TRow[]>;
}

export type Handler = (request: ApiRequest, scope: Scope) => Promise<ApiResult>;

export interface RouteDefinition {
  readonly method: HttpMethod;
  readonly path: string;
  /** نام یکتای عملیات؛ در OpenAPI و در لاگ می‌آید. */
  readonly name: string;
  readonly summary: string;
  readonly tags: readonly string[];
  /** `public` بی‌نام، `session` کوکی، `api-key` هدر، `any` هر دو. */
  /**
   * الگوی احراز:
   *   • `public` — بی‌نام مجاز (فقط خواندن یا فرم عمومی).
   *   • `session` — فقط نشست انسانی.
   *   • `api-key` — فقط کارگزار ماشینی با کلید.
   *   • `authenticated` — هر شناسهٔ احرازشده: نشست **یا** کلید API.
   *     این الگو برای مسیرهایی است که هر دو نوع بازیگر یک معنا دارند
   *     (مثل خواندن نمای کسب‌وکار خودمان) و بی‌نام نباید ببیند.
   *   • `any` — بی‌نام هم مجاز است، ولی برای نوشتن، بازیگر لازم می‌شود.
   */
  readonly auth: 'public' | 'session' | 'api-key' | 'authenticated' | 'any';
  /** نقش پایگاه‌داده برای اجرای این مسیر (RLS). */
  readonly role: DatabaseRole;
  readonly rateLimit?: RateLimitRule;
  /** بررسی مبدأ (Origin) برای درخواست تغییردهنده؛ پیش‌فرض: روش‌های تغییردهنده. */
  readonly originCheck?: boolean;
  /** توکن CSRF لازم است؟ پیش‌فرض: روش تغییردهنده + احراز با کوکی. */
  readonly csrf?: boolean;
  /** مجوز مستندشده؛ در OpenAPI می‌آید و به‌عنوان پیش‌بررسی سرور اعمال می‌شود. */
  readonly permission?: string;
  /** مجوز پلتفرمی (بدون کسب‌وکار) در برابر مجوز کسب‌وکاری. */
  readonly platformPermission?: string;
  readonly handler: Handler;
}

export interface ApiServices {
  readonly env: Env;
  readonly logger: Logger;
  readonly clock: Clock;
  readonly passwords: PasswordHasher;
  readonly client: SqlClient;
  readonly now: () => number;
}
