/**
 * `@petavu/shared` — بنیاد مشترک همهٔ لایه‌ها.
 *
 * این پکیج هیچ وابستگی داخلی ندارد و هیچ چیزی از دامنه، پایگاه‌داده یا رابط
 * کاربر نمی‌داند. فقط چیزهایی اینجاست که در بیش از یک لایه لازم‌اند و اگر
 * کپی شوند، واگرا می‌شوند: خطا، پیکربندی، شناسه، زمان، لاگ و متن فارسی.
 */

export * from './errors.js';
export * from './env.js';
export * from './clock.js';
export * from './ids.js';
export * from './logger.js';
export * from './text.js';
