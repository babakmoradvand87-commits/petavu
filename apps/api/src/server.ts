/**
 * سرور API (گام ۲۱؛ §64–۷۸).
 *
 * این فایل، تنها جایی است که `node:http` را می‌بیند. هر چیز دیگری — مسیریابی،
 * احراز، مجوز، خطا — در ماژول‌های جدا است تا آزمون بتواند بی‌نیاز از پورت و
 * شبکه، همان مسیر تولید را اجرا کند.
 *
 * سه تصمیم عملیاتی:
 *
 *   • `keepAliveTimeout` بلندتر از پروکسی: بی‌آن، پروکسی اتصال را می‌بندد و
 *     کاربر خطای تصادفی می‌بیند.
 *   • `headersTimeout` و `requestTimeout` روشن‌اند: درخواست نیمه‌باز، اتصال
 *     را گروگان نمی‌گیرد.
 *   • خاموشی آرام: سیگنال، سرور را می‌بندد و صبر می‌کند تا کارهای جاری تمام
 *     شوند. کشتن فرآیند وسط نوشتن، همان چیزی است که «داده‌ی نیمه‌نوشته» می‌سازد.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createLogger, loadEnv, systemClock, type Env, type Logger } from '@petavu/shared';
import { createPasswordHasher, DEFAULT_ARGON2, TEST_ARGON2, type PasswordHasher } from '@petavu/security';
import type { SqlClient } from '@petavu/db';

import { Router } from './router.js';
import { createPipeline } from './pipeline.js';
import { createDbRateLimiter, type ConsumeRateLimit } from './ratelimit.js';
import { routes } from './routes/index.js';
import { buildOpenApi } from './openapi.js';
import type { ApiServices, RouteDefinition } from './types.js';

export interface ApiServerOptions {
  readonly client: SqlClient;
  readonly env?: Env;
  readonly logger?: Logger;
  readonly env_?: never;
  /** در آزمون‌ها: بررسی رمز با پارامترهای سبک‌تر تا مجموعه کند نشود. */
  readonly lightweightPasswords?: boolean;
  /** در آزمون‌ها: خاموش‌کردن شمارندهٔ نرخ پایگاه‌داده. */
  readonly rateLimit?: boolean;
  readonly now?: () => number;
  readonly routes?: readonly RouteDefinition[];
}

export interface ApiServer {
  readonly handler: (request: IncomingMessage, response: ServerResponse) => void;
  readonly router: Router;
  readonly openapi: () => Record<string, unknown>;
  readonly services: ApiServices;
  listen(port: number, host: string): Promise<{ url: string; port: number }>;
  close(): Promise<void>;
}

export function createApiServer(options: ApiServerOptions): ApiServer {
  const env = options.env ?? loadEnv(process.env as Record<string, string | undefined>);
  const logger = options.logger ?? createLogger({ level: env.logLevel });
  const now = options.now ?? (() => Date.now());

  const passwords: PasswordHasher = createPasswordHasher({
    ...(options.lightweightPasswords === true
      ? { params: TEST_ARGON2 }
      : { params: DEFAULT_ARGON2 }),
    pepper: env.security.authPepper,
  });

  const services: ApiServices = { env, logger, clock: systemClock, passwords, client: options.client, now };

  const router = new Router(options.routes ?? routes);
  const consumeRateLimit: ConsumeRateLimit =
    options.rateLimit === false
      ? async (_key, rule) => ({
          allowed: true,
          rule: rule.name,
          limit: rule.limit,
          remaining: rule.limit,
          resetAtMs: now() + rule.windowMs,
          retryAfterSeconds: 0,
        })
      : createDbRateLimiter({ client: options.client, logger, now });

  const pipeline = createPipeline({ services, router, consumeRateLimit });

  let server: Server | null = null;

  return {
    handler: (request, response) => {
      void pipeline.handle(request, response);
    },
    router,
    openapi: () => buildOpenApi(router.list(), { publicOrigin: env.origins.public }),
    services,
    async listen(port, host) {
      server = createServer((request, response) => {
        void pipeline.handle(request, response);
      });
      // پروکسی، اتصال را زودتر می‌بندد؛ اگر سرور دیرتر بفهمد، کاربر خطای تصادفی می‌بیند.
      server.keepAliveTimeout = 65_000;
      server.headersTimeout = 70_000;
      server.requestTimeout = 30_000;

      await new Promise<void>((resolve, reject) => {
        server?.once('error', reject);
        server?.listen(port, host, () => resolve());
      });

      const address = server.address();
      const boundPort = typeof address === 'object' && address !== null ? address.port : port;
      return { url: `http://${host}:${boundPort}`, port: boundPort };
    },
    async close() {
      if (!server) return;
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = null;
    },
  };
}
