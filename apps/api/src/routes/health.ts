/**
 * مسیرهای سلامت و آمادگی (گام ۲۱؛ §93–۹۷، §102).
 *
 * تفکیک `health` از `ready` عمدی است و پیامد عملیاتی دارد:
 *
 *   • `health` (زنده‌بودن) هیچ وابستگی‌ای را نمی‌سنجد. اگر این هم به
 *     پایگاه‌داده نگاه کند، هنگام قطعی پایگاه‌داده گرداننده فرآیند را می‌کُشد
 *     و قطعی کوتاه، به قطعی بلند تبدیل می‌شود.
 *   • `ready` (آمادگی) پایگاه‌داده را می‌سنجد و عددهای واقعی می‌دهد.
 *   • هر دو، وضعیت سرویس‌های پیکربندی‌نشده را **صادقانه** می‌گویند (§102):
 *     ایمیل بی‌درایور، جست‌وجوی Postgres، ذخیره‌سازی محلی. نه پنهان، نه ادعای
 *     «آماده».
 */

import type { RouteDefinition } from '../types.js';

export const healthRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: '/api/v1/health',
    name: 'health.live',
    summary: 'زنده‌بودن فرآیند، بدون هیچ وابستگی',
    tags: ['health'],
    auth: 'public',
    role: 'pv_public',
    handler: async (request) => ({
      body: { status: 'ok', service: 'petavu-api', version: 'v1', request_id: request.requestId },
    }),
  },

  {
    method: 'GET',
    path: '/api/v1/ready',
    name: 'health.ready',
    summary: 'آمادگی: پایگاه‌داده، مهاجرت‌ها و وضعیت صادقانهٔ سرویس‌ها',
    tags: ['health'],
    auth: 'public',
    role: 'pv_public',
    handler: async (request, scope) => {
      /*
       * عددها از تابع دامنه می‌آید، نه از خواندن مستقیم `ops.migration` و
       * `ops.feature`. نقش مسیر `pv_public` است و آن جدول‌ها به نقش بی‌نام
       * هیچ گرنتی ندارند؛ پیش‌تر همین باعث می‌شد `/ready` با ۴۰۳ بیفتد. راه
       * درست، باز‌کردن جدول نبود؛ یک تابع باریک بود که فقط همین پنج عدد را
       * می‌دهد (مهاجرت ۰۰۱۶).
       */
      const [snapshot] = await scope.query<{
        migrations: number;
        last_applied_at: string | null;
        tables: number;
        features_development: number;
        features_published: number;
      }>('select migrations, last_applied_at, tables, features_development, features_published from ops.readiness_snapshot()');

      const env = scope.services.env;

      return {
        body: {
          status: 'ready',
          service: 'petavu-api',
          request_id: request.requestId,
          environment: env.env,
          database: {
            engine: scope.client.engine,
            migrations: snapshot?.migrations ?? 0,
            last_applied_at: snapshot?.last_applied_at ? String(snapshot.last_applied_at) : null,
            tables: snapshot?.tables ?? 0,
          },
          features: {
            development: snapshot?.features_development ?? 0,
            published: snapshot?.features_published ?? 0,
          },
          services: {
            storage: { driver: env.storage.driver, configured: true },
            email: { driver: env.email.driver, configured: env.email.configured },
            search: { driver: env.search.driver, configured: env.search.driver !== 'postgres' },
            rate_limit: { driver: 'postgres', configured: true },
          },
        },
      };
    },
  },
];
