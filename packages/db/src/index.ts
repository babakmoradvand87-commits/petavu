/**
 * `@petavu/db` — لایهٔ داده.
 *
 * چه چیزی اینجا هست: قرارداد کلاینت، زمینهٔ درخواست، تراکنش، صفحه‌بندی
 * نشانگری، کنترل نسخه، نگهبان مستأجر، و ثبت رخداد/حسابرسی.
 *
 * چه چیزی اینجا نیست — و عمدی است: هیچ SQL دامنه‌ای. کوئری‌ها در Repositoryها
 * می‌نشینند (گام ۱۹) تا این پکیج، «چگونه» را بداند و «چه» را نداند.
 */

export * from './types.js';
export * from './sql.js';
export * from './context.js';
export * from './pool.js';
export * from './pagination.js';
export * from './dal.js';
export * from './events.js';
