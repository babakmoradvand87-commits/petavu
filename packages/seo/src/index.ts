/**
 * `@petavu/seo` — موتور سئو (گام ۲۰).
 *
 * این پکیج، «سئو به‌عنوان داده» را به «سئو در خروجی» تبدیل می‌کند: قالب‌ها
 * رندر می‌شوند، هد ساخته می‌شود، گراف داده ساخت‌یافته بسته می‌شود، سایتمپ و
 * robots ساخته می‌شوند، صفحه بازرسی می‌شود و دروازهٔ انتشار حکم می‌دهد.
 *
 * چه چیزی اینجا **نیست**: هیچ تصمیمی دربارهٔ دسترسی، هیچ کوئری پایگاه‌داده،
 * و هیچ رندر HTML صفحه. داده از `@petavu/db` می‌آید، خروجی به `apps/web` و
 * `apps/api` می‌رود؛ این پکیج، مغزِ میانی است.
 */

export * from './templates.js';
export * from './head.js';
export * from './structured-data.js';
export * from './sitemap.js';
export * from './robots.js';
export * from './canonical.js';
export * from './audit.js';
export * from './indexing.js';
export * from './gate.js';
export * from './search-adapter.js';
export * from './visibility-adapters.js';
