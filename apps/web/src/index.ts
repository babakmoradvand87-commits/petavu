/**
 * نقطهٔ ورود وب (گام ۲۲).
 *
 * مثل `apps/api`: خواندن پیکربندی، اتصال، **بررسی مرزهای امنیتی**، و بعد
 * شنیدن. هیچ‌کدام از این‌ها داخل مسیر درخواست انجام نمی‌شود — خطا باید در
 * راه‌اندازی دیده شود، نه در میانهٔ یک بازدید.
 *
 * دو بررسی که پیش از شنیدن انجام می‌شوند:
 *   ۱) **اعتبار پوشهٔ دارایی‌ها.** اگر فونت یا CSS نباشد، سایت با رنگ و فونت
 *      جانشین بالا می‌آید؛ ولی باید در لاگ بگوییم (§102: وضعیت صادقانه).
 *   ۲) **وضعیت ایندکس‌گذاری.** در محیط تولید، اگر `seo.settings` خاموش باشد،
 *      سایت با `noindex` سرو می‌شود — و این باید بلند گفته شود، چون معمولاً
 *      یعنی کسی یادش رفته آن را روشن کند.
 */

import { AppError, createLogger, loadEnv, type Env } from '@petavu/shared';
import { createPostgresClient, type SqlClient } from '@petavu/db';

import { createWebServer, type WebServer } from './server.js';

export * from './server.js';
export * from './config.js';
export * from './data.js';
export * from './html.js';
export * from './assets.js';
export * from './fonts.js';
export * from './tokens.js';
export * from './theme.js';
export * from './router.js';
export * from './headers.js';
export * from './structured.js';
export * from './styles.js';
export * from './registry.js';
export * from './tree.js';
export * from './renderers.js';
export * from './media.js';
export * from './pagedesign.js';
export * from './components.js';
export * from './pages/types.js';

export interface StartedWeb {
  readonly server: WebServer;
  readonly close: () => Promise<void>;
}

export interface StartWebOptions {
  /** پوشهٔ دارایی‌ها؛ اگر ندهید، `apps/web/assets` کنار همین بسته. */
  readonly assetsDirectory?: string;
  readonly env?: Env;
}

export async function startWeb(options: StartWebOptions = {}): Promise<StartedWeb> {
  const env = options.env ?? loadEnv(process.env as Record<string, string | undefined>);
  const logger = createLogger({ level: env.logLevel });

  const client = await createPostgresClient({
    url: env.database.url,
    poolMax: env.database.poolMax,
    statementTimeoutMs: env.database.statementTimeoutMs,
    applicationName: 'petavu-web',
  });

  const assetsDirectory = options.assetsDirectory ?? defaultAssetsDirectory();
  const server = createWebServer({ client, env, logger, assetsDirectory });

  const { port } = await server.listen(env.http.port, env.http.host);

  const budget = await server.budgetSnapshot();
  logger.info('وب‌سایت آماده است', {
    port,
    environment: env.env,
    sites: server.config.sites.map((site) => site.host),
    font: server.fonts.available ? `${Math.round(budget.fontBytes / 1024)}KB` : 'inavailable',
    cssKb: Math.round(budget.cssBytes / 1024),
  });

  /**
   * نگهبان RLS — همان تصمیمی که در API گرفته شد (§14).
   *
   * اگر نقش فعلی از RLS مستثنا باشد، هر کوئری بی‌نام می‌تواند دادهٔ همهٔ
   * کسب‌وکارها را بخواند. بهتر است برنامه بالا نیاید تا اینکه ناامن سرو کند.
   */
  await assertRlsEnforced(client);

  return {
    server,
    close: async () => {
      await server.close();
      await client.close();
    },
  };
}

export async function assertRlsEnforced(client: Pick<SqlClient, 'query'>): Promise<void> {
  const result = await client.query<{ enforced: boolean }>('select app.rls_is_enforced_for_current_user() as enforced');
  const row = result.rows[0];
  if (row?.enforced === false) {
    throw new AppError('internal_error', {
      message: 'نقش فعلی پایگاه‌داده از سیاست‌های RLS مستثناست؛ اجرای وب‌سایت در این نقش مجاز نیست.',
      details: { reason: 'rls_not_enforced' },
    });
  }
}

/**
 * پوشهٔ پیش‌فرض دارایی‌ها.
 *
 * از محل فایل اجراشده حساب می‌شود (`dist/index.js` ⇒ `../assets`)، نه از
 * `process.cwd()`: سرویس ممکن است از هر پوشه‌ای بالا بیاید و مسیر دارایی‌ها
 * نباید به آن وابسته باشد.
 */
export function defaultAssetsDirectory(): string {
  return new URL('../assets', import.meta.url).pathname;
}

if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
  const logger = createLogger();
  startWeb()
    .then(({ close }) => {
      const shutdown = (signal: string): void => {
        logger.info('خاموشی آرام', { signal });
        void close().then(() => process.exit(0));
      };
      process.on('SIGINT', () => shutdown('SIGINT'));
      process.on('SIGTERM', () => shutdown('SIGTERM'));
    })
    .catch((error: unknown) => {
      logger.error('راه‌اندازی وب شکست خورد', { error: error instanceof Error ? error.message : String(error) });
      process.exitCode = 1;
    });
}
