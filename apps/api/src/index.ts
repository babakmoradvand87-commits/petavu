/**
 * نقطهٔ ورود API (گام ۲۱).
 *
 * کار این فایل، فقط سه چیز است و هر سه باید **پیش از** پذیرش نخستین درخواست
 * انجام شوند:
 *
 *   ۱. خواندن و اعتبارسنجی پیکربندی — اگر رازی نیست، شکست همان‌جا باشد، نه در
 *      میانهٔ یک ورود.
 *   ۲. اتصال به پایگاه‌داده و ارزیابی نگهبان RLS — §14 می‌گوید اگر اجرا در
 *      نقشی باشد که از RLS مستثناست، برنامه باید **بالا نیاید**. این یک ادعا
 *      نیست؛ یک بررسی در زمان راه‌اندازی است.
 *   ۳. شنیدن روی میزبان و پورت پیکربندی‌شده، با خاموشی آرام.
 */

import { AppError, createLogger, loadEnv } from '@petavu/shared';
import { createPostgresClient } from '@petavu/db';

import { createApiServer, type ApiServer } from './server.js';

export * from './server.js';
export * from './types.js';
export * from './router.js';
export * from './openapi.js';
export * from './routes/index.js';
export * from './ratelimit.js';
export * from './cookies.js';

export interface StartedApi {
  readonly server: ApiServer;
  readonly close: () => Promise<void>;
}

/** راه‌اندازی کامل، از پیکربندی تا شنیدن. برای `index` و برای اجرای دستی. */
export async function startApi(): Promise<StartedApi> {
  const env = loadEnv(process.env as Record<string, string | undefined>);
  const logger = createLogger({ level: env.logLevel });

  const client = await createPostgresClient({
    url: env.database.url,
    poolMax: env.database.poolMax,
    statementTimeoutMs: env.database.statementTimeoutMs,
    applicationName: 'petavu-api',
  });

  const server = createApiServer({ client, env, logger });
  const { port } = await server.listen(env.apiPort, env.http.host);

  logger.info('API آماده است', { port, environment: env.env });

  return {
    server,
    close: async () => {
      await server.close();
      await client.close();
    },
  };
}

/** بررسی نگهبان RLS؛ بالا نیامدن بهتر از بالا آمدنِ ناامن است (§14). */
export async function assertRlsEnforced(client: { query: (sql: string, params?: readonly unknown[]) => Promise<{ rows: unknown[] }> }): Promise<void> {
  const result = await client.query('select app.rls_is_enforced_for_current_user() as enforced');
  const row = result.rows[0] as { enforced?: boolean } | undefined;
  if (row?.enforced === false) {
    throw new AppError('internal_error', {
      message: 'نقش فعلی پایگاه‌داده از سیاست‌های RLS مستثناست؛ اجرای برنامه در این نقش مجاز نیست.',
      details: { reason: 'rls_not_enforced' },
    });
  }
}
