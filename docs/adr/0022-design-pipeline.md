# ADR-0022 — یک هستهٔ طراحی و انتشار اتمی، نه Publish مستقیم

وضعیت: پذیرفته و اجراشده در گام ۳۰. مرجع: Master §32–44، §161–169؛ Addendum §96–100.

## تصمیم

پیاده‌سازی رندر/Registry/token/theme/font/asset/image/measurement در `@petavu/design` است. مسیرهای قدیمی وب فقط re-export اند. Preview از API همان رندر معناشناختی سایت را فراخوانی می‌کند؛ درخواست API→Web→API داخل تراکنش وجود ندارد.

`0025_design_pipeline.sql` (بدون دست‌بردن به 0005) دفتر انتشار را ترمیم می‌کند: `version` شمارهٔ **تغییرناپذیر انتشار** و `lock_version` شمارندهٔ وضعیت است. درهم بسته و منبع، SHA-256 بومی PostgreSQL است؛ MD5 قدیمی فقط برای شناسهٔ revisionهای قدیمی باقی می‌ماند.

Scope کسب‌وکار از **کسب‌وکار فعال نشست احرازشده** است؛ هدر ناسازگار رد می‌شود. `scope=platform` مجوز `platform.design.manage` می‌خواهد. وضعیت تهی هیچ‌گاه «همهٔ کسب‌وکارها» نیست.

## جریان

1. Draft: درخت بازگشتی محدود به ۴۰۰ گره، عمق ۱۲، ۲۵۶KiB؛ پراپ/اسلات/کلید ناشناس و کد خام رد می‌شوند. به‌روزرسانی optimistic و revision افزودنی است.
2. Prepare: کل صفحه‌های محدوده، توکن‌های مؤثر، تم، Registry، fingerprint رسانه و تنظیمات سئوی مربوط به یک بستهٔ تغییرناپذیر می‌روند. تنظیم/توکن پیش‌نویس پلتفرم به کسب‌وکار ارث نمی‌رسد؛ فقط مقدار زندهٔ مشترک قابل‌ارث است.
3. Validate: درخت، Registry، CSS معتبر/ارجاع‌ها، کنتراست sRGB، ساختار عنوان‌ها و تصویر، هد و JSON-LD واقعاً ساخته می‌شوند. `measurePage` بایت واقعی HTML/CSS/فونت/رسانه را می‌خواند؛ متن با همان Brotli سرور و دارایی دودویی با بایت اصلی سنجیده می‌شود. بودجهٔ `ops.check_budget` و دروازهٔ موجود RUM جدا هستند.
4. Preview: رندر خصوصی با `noindex/no-store` داخل iframe ایزولهٔ same-origin و بدون اجازهٔ script/form؛ درخواست نمایش، hash/بازیگر/زمان همان بسته را ثبت می‌کند.
5. Approval: Preview و validation لازم‌اند؛ source drift، optimistic conflict و نبود re-auth مانع‌اند.
6. Publish: بودجهٔ جاری دوباره با اندازه‌گیری مقایسه می‌شود؛ فعال‌سازی page/token/theme/SEO، تغییر current، audit و outbox در یک تراکنش است. مسیر قدیمی publish و INSERT/UPDATE/DELETE مستقیم زنده با trigger بسته‌اند.
7. Rollback: **خود بستهٔ قبلاً منتشرشده** فعال می‌شود؛ نه کپی‌کردن draft. صفحه‌های بعدی از نمایش خارج می‌شوند؛ draftهای بعدی حفظ می‌شوند. rollback به بستهٔ جاری بی‌اثر است.

## مرزهای ادعا

- با سنجش سروری، LCP/INP/CLS اندازه‌گیری‌شده اعلام نمی‌شود. `not_compared` و `requires_browser_quality_suite` در گواه می‌ماند. مرورگر/visual/MFA تقویت‌شده، کار گام ۳۵ است.
- MONITOR پس از publish **pending با شناسهٔ event واقعی** است، نه سبز ساختگی. مصرف outbox و monitor در گام ۳۲ وصل می‌شود.
- بسته، artifact طراحی/SEO را ثابت می‌کند. دادهٔ دامنه (فهرست کسب‌وکار، نام/تماس/محتوای فعلی) همچنان دادهٔ زندهٔ مجاز است؛ rollback طراحی، rollback دادهٔ تجاری یا restore backup نیست.
- ورودی فاقد شواهد/منبع شکسته، اجازهٔ انتشار ندارد. اتصال رسانهٔ خارجی که در این اجرا قابل سنجش نیست، قبول فرض نمی‌شود.

## UI و delivery

`/app/pages` عضو و `/app/design` و `/app/tokens` ادمین، از API می‌خوانند. Builder افزودن/تغییر/حذف گره، ویرایش JSON محدود، متادیتا، توکن اختصاصی، تنظیم تم، گواه/Preview/Approval/Publish/Rollback دارد. CSS فقط از دادهٔ معتبر ساخته می‌شود.

صفحهٔ سفارشی واقعی: `/p/:key` و `/b/:slug/:page`؛ کلید `home` مسیر پایه است. sitemap طراحی chunked است و فقط محتوای کافیِ منتشرشده/عمومی و indexable را می‌گیرد. CSS به fingerprint انتشار حساس است؛ تغییر Draft روی HTML/CSS زنده اثر ندارد. تمِ کسب‌وکار از همان snapshot منتشرشده تولید می‌شود.

## آزمون

`tests/studio.test.mjs`: ۳۲ آزمون DB/API/SSR واقعی؛ scope/IDOR، درخت ناامن، CSRF مسیرهای موجود، نسخهٔ stale، bypass مستقیم، SHA-256، snapshot/preview/re-auth، budget breach، drift، publication/cache، rollback و حفظ draft، routing/sitemap و نشت‌نکردن Draft پلتفرم. آزمون‌های renderer برای دادهٔ legacy/corrupt از setup مالک DB استفاده می‌کنند، نه دورزدن قانون production.
