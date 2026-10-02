/**
 * `@petavu/db` — لایهٔ داده.
 *
 * چه چیزی اینجا هست: قرارداد کلاینت، زمینهٔ درخواست، تراکنش، صفحه‌بندی
 * نشانگری، کنترل نسخه، نگهبان مستأجر، و ثبت رخداد/حسابرسی.
 *
 * چه چیزی بیرون از `repositories/` است و چرا: ابزار پایه — SQL، زمینه، تراکنش،
 * صفحه‌بندی. پرس‌وجوهای دامنه در `repositories/` می‌نشینند تا لایهٔ پایه
 * «چگونه» را بداند و «چه» را نداند.
 */

export * from './types.js';
export * from './sql.js';
export * from './context.js';
export * from './pool.js';
export * from './pagination.js';
export * from './dal.js';
export * from './events.js';
export * from './repositories/index.js';
