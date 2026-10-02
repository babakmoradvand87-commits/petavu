/**
 * پیکربندی محیط — §75، §78، §80–۸۲
 *
 * سه اصل:
 *
 *   ۱. پیکربندی یک‌بار و در یک نقطه خوانده و اعتبارسنجی می‌شود. هیچ ماژولی
 *      مستقیماً `process.env` را نمی‌خواند؛ از شیء `Env` استفاده می‌کند.
 *   ۲. نبودِ مقدار لازم، در زمان راه‌اندازی خطا می‌دهد — نه در میان یک درخواست.
 *   ۳. هرچه سرویس بیرونی است، خالی‌بودنش یک «وضعیت صادقانه» است، نه خطا. در
 *      محیط توسعه، نبودِ ایمیل یعنی ارسال خاموش است؛ نه اینکه با Mock پوشانده
 *      شود (§102).
 *
 * یک استثنای مهم: در محیط production، نبودِ رازهای نشست خطاست، نه هشدار.
 */

import { z } from 'zod';

export const ENVIRONMENTS = ['development', 'test', 'staging', 'production'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

/** رازهایی که در production نباید خالی باشند (§9، §11). */
const REQUIRED_IN_PRODUCTION = ['SESSION_SECRET', 'AUTH_PEPPER'] as const;

const RawEnvSchema = z.object({
  PETAVU_ENV: z.enum(ENVIRONMENTS).default('development'),

  PETAVU_PUBLIC_ORIGIN: z.string().default('http://localhost:3000'),
  PETAVU_PANEL_ORIGIN: z.string().default('http://panel.localhost:3000'),
  PETAVU_ADMIN_ORIGIN: z.string().default('http://adminpanel.localhost:3000'),
  PETAVU_SHOP_ORIGIN: z.string().default('http://shop.localhost:3000'),
  PETAVU_ADMIN_SHOP_ORIGIN: z.string().default('http://adminshop.localhost:3000'),

  DATABASE_URL: z.string().default(''),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(200).default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).max(300_000).default(15_000),

  SESSION_SECRET: z.string().default(''),
  AUTH_PEPPER: z.string().default(''),
  SESSION_COOKIE_NAME: z.string().default('pv_session'),

  STORAGE_DRIVER: z.enum(['local', 's3', 'supabase']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./.data/media'),

  EMAIL_DRIVER: z.enum(['none', 'smtp', 'resend', 'supabase']).default('none'),
  SEARCH_DRIVER: z.enum(['postgres', 'opensearch', 'elasticsearch', 'meilisearch']).default('postgres'),
  BACKUP_DIR: z.string().default('./.data/backups'),

  HTTP_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  HTTP_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  TRUST_PROXY: z.coerce.boolean().default(false),
});

export interface OriginSet {
  readonly public: string;
  readonly panel: string;
  readonly admin: string;
  readonly shop: string;
  readonly adminShop: string;
}

export interface Env {
  readonly env: Environment;
  readonly isProduction: boolean;
  readonly isDevelopment: boolean;
  readonly isTest: boolean;
  readonly origins: OriginSet;
  readonly database: {
    readonly url: string;
    readonly poolMax: number;
    readonly statementTimeoutMs: number;
    /** وقتی URL خالی است، موتور تعبیه‌شدهٔ توسعه استفاده می‌شود. */
    readonly embedded: boolean;
  };
  readonly security: {
    readonly sessionSecret: string;
    readonly authPepper: string;
    readonly sessionCookieName: string;
  };
  readonly storage: { readonly driver: 'local' | 's3' | 'supabase'; readonly localDir: string };
  readonly email: { readonly driver: 'none' | 'smtp' | 'resend' | 'supabase'; readonly configured: boolean };
  readonly search: { readonly driver: 'postgres' | 'opensearch' | 'elasticsearch' | 'meilisearch' };
  readonly backupDir: string;
  readonly http: { readonly port: number; readonly host: string };
  readonly apiPort: number;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
  readonly trustProxy: boolean;
}

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvError';
  }
}

/**
 * آدرس‌های مطلق از اینجا ساخته می‌شوند، نه از هدر درخواست (§80–۸۲).
 *
 * `Host` را کلاینت می‌فرستد؛ اگر کانونیکال یا لینک ایمیل را از آن بسازیم،
 * مهاجم می‌تواند آن را به دامنهٔ خودش ببرد (Host header injection). پس یک بار
 * اینجا از محیط خوانده می‌شود و همه‌جا همین استفاده می‌شود.
 */
function parseOrigin(name: string, raw: string, env: Environment): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new EnvError(`${name} باید یک نشانی کامل با پروتکل باشد (مثال: https://petavu.ir)؛ مقدار فعلی: «${raw}»`);
  }
  if (env === 'production' && url.protocol !== 'https:') {
    throw new EnvError(`${name} در محیط production باید https باشد؛ مقدار فعلی: «${raw}»`);
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new EnvError(`${name} نباید مسیر، پارامتر یا fragment داشته باشد؛ مقدار فعلی: «${raw}»`);
  }
  // بدون اسلش پایانی نگه می‌داریم تا الحاق مسیرها قطعی باشد.
  return url.origin;
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = RawEnvSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.map(String).join('.')}: ${issue.message}`)
      .join('؛ ');
    throw new EnvError(`پیکربندی محیط نامعتبر است — ${problems}`);
  }
  const raw = parsed.data;
  const env = raw.PETAVU_ENV;

  if (env === 'production') {
    const missing = REQUIRED_IN_PRODUCTION.filter((key) => raw[key].trim() === '');
    if (missing.length > 0) {
      throw new EnvError(`در محیط production این متغیرها باید مقدار داشته باشند: ${missing.join(', ')}`);
    }
    for (const key of REQUIRED_IN_PRODUCTION) {
      const value = raw[key];
      if (value.length < 32) {
        throw new EnvError(`${key} در محیط production باید حداقل ۳۲ نویسه باشد (آنتروپی کافی برای امضای نشست).`);
      }
    }
  }

  const origins: OriginSet = {
    public: parseOrigin('PETAVU_PUBLIC_ORIGIN', raw.PETAVU_PUBLIC_ORIGIN, env),
    panel: parseOrigin('PETAVU_PANEL_ORIGIN', raw.PETAVU_PANEL_ORIGIN, env),
    admin: parseOrigin('PETAVU_ADMIN_ORIGIN', raw.PETAVU_ADMIN_ORIGIN, env),
    shop: parseOrigin('PETAVU_SHOP_ORIGIN', raw.PETAVU_SHOP_ORIGIN, env),
    adminShop: parseOrigin('PETAVU_ADMIN_SHOP_ORIGIN', raw.PETAVU_ADMIN_SHOP_ORIGIN, env),
  };

  return {
    env,
    isProduction: env === 'production',
    isDevelopment: env === 'development',
    isTest: env === 'test',
    origins,
    database: {
      url: raw.DATABASE_URL,
      poolMax: raw.DATABASE_POOL_MAX,
      statementTimeoutMs: raw.DATABASE_STATEMENT_TIMEOUT_MS,
      embedded: raw.DATABASE_URL.trim() === '',
    },
    security: {
      sessionSecret: raw.SESSION_SECRET,
      authPepper: raw.AUTH_PEPPER,
      sessionCookieName: raw.SESSION_COOKIE_NAME,
    },
    storage: { driver: raw.STORAGE_DRIVER, localDir: raw.STORAGE_LOCAL_DIR },
    email: { driver: raw.EMAIL_DRIVER, configured: raw.EMAIL_DRIVER !== 'none' },
    search: { driver: raw.SEARCH_DRIVER },
    backupDir: raw.BACKUP_DIR,
    http: { port: raw.HTTP_PORT, host: raw.HTTP_HOST },
    apiPort: raw.API_PORT,
    logLevel: raw.LOG_LEVEL,
    trustProxy: raw.TRUST_PROXY,
  };
}

/** نشانی مطلق یک مسیر روی سایت اصلی (§81). */
export function publicUrl(env: Env, path = '/'): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${env.origins.public}${normalized}`;
}

/** همهٔ میزبان‌های معتبر، برای بررسی `Origin` و ساخت لینک (§80). */
export function allowedOrigins(env: Env): readonly string[] {
  return [env.origins.public, env.origins.panel, env.origins.admin, env.origins.shop, env.origins.adminShop];
}
