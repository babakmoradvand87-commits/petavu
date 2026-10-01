# انتقال به هاست دیگر، بدون از دست رفتن دادهٔ تأییدشده

این runbook از ابتدا بخشی از معماری است. نتیجهٔ «بدون زیان» فقط پس از تمرین و تطبیق داده قابل پذیرش است؛ تضمین مطلق پیش از آزمون داده نمی‌شود.

## ۱. انتقال صرفِ frontend

پنج artifact مستقل، runtime config عمومی، دارایی‌ها و فونت‌ها منتقل شوند؛ URLهای جدید در DNS/TLS، API allowlist و redirectهای Auth ثبت شوند. دادهٔ کسب‌وکار نباید به دامنهٔ preview وابسته باشد. تغییر هاست frontend الزاماً به انتقال Supabase یا Auth نیاز ندارد.

buildها:

```bash
npm ci
npm run build:all
# dist/web ، dist/panel ، dist/adminpanel ، dist/shop ، dist/adminshop
```

Docker برای هر فضا build جدا دارد. در runtime، `APP_SCOPE` باید با artifact همسان باشد. `PETAVU_MODE=unconfigured` حالت امن پیش‌فرض است؛ backend واقعی هنوز اضافه نشده است. برای static hosting نیز فایل runtime-config همان محیط باید بازبینی و جایگزین شود.

## ۲. inventory انتقال همهٔ سرویس‌ها

کد/lockfile، schema و نسخهٔ migration، DB دامنه، Auth و MFA/provider config، objectها و metadata، keyهای رمزنگاری، roles/grants/RLS، Edge Functions/workerها، ایمیل، webhook، redirect، CORS، DNS/TLS، تنظیمات Realtime و monitoring. object keyها ثابت؛ URLها از provider جدید تولید شوند.

بکاپ Supabase فقط metadata Storage را شامل می‌شود، نه فایل واقعی. [1](https://supabase.com/docs/guides/platform/backups) بعضی تنظیمات مانند Auth، Edge Functions و Realtime نیازمند تنظیم مستقل‌اند. [2](https://supabase.com/docs/guides/platform/migrating-within-supabase/dashboard-restore)

## ۳. روش انتقال

۱. مقصد staging سازگار با نسخهٔ PostgreSQL و افزونه‌ها آماده شود. تبدیل provider قبل از production تمرین شود؛ dump platform به vanilla Postgres همیشه بدون تطبیق restore نمی‌شود.
۲. release source + manifest و بکاپ کامل شامل DB، objects و config گرفته شود.
۳. rolesِ بدون credential و extensions در مقصد با سیاست حداقلی provision شوند. secrets از vault مقصد تزریق شوند؛ secrets قدیمی کپی عمومی نشوند.
۴. schema/data دامنه، Auth طبق مسیر provider، فایل‌ها و policyهای Storage وارد شوند؛ identity UUIDهای دامنه ثابت بمانند.
۵. تطبیق رکوردها، counts، FK/unique، migration version، RLS، object counts/size/SHA-256 و smoke test هر پنج محیط.
۶. Auth audience، cookie host-only، callback، API origin، mail/webhook و password recovery تست شوند. sessionهای قدیمی منتقل نشوند و ورود دوباره توضیح داده شود.
۷. cutover با نوشتن متوقف/باریر واقعی، delta نهایی و DNS TTL مناسب؛ سپس health و خطاها پایش شوند.
۸. مبدأ تا پایان دورهٔ بازگشت توافق‌شده و پس از تأیید عدم زیان حذف نشود. تغییرات جدید مقصد در rollback باید حفظ شوند؛ rollback صرفاً تعویض DNS نیست.

## ۴. مرز قابلیت حمل Auth

با حفظ provider خارجی هنگام جابه‌جایی frontend، حساب‌ها و actor mapping می‌مانند. با تغییر خود Auth provider، export رمزهای hash‌شده، MFA و passkeyها باید با قابلیت واقعی provider بررسی شود. ممکن است reset رمز یا ثبت دوبارهٔ عامل لازم باشد. passkey به RP ID وابسته است؛ تغییر دامنه را بدون طرح سازگاری امن «انتقال کامل» اعلام نکن.

این محدودیت مربوط به credentials/session است؛ پروفایل، روابط سازمانی و محتوا نباید حذف شوند. کلیدهای رمزنگاری دادهٔ قدیمی تا وقتی برای decrypt لازم‌اند با کنترل دسترسی و escrow حفظ شوند.

## ۵. معیار پذیرش

| آزمون | پذیرش |
|---|---|
| schema/migrations | نسخه‌ها و تعریف‌ها مطابق release |
| داده | counts و قیود مطابق snapshot/cutoff؛ اختلاف review شده |
| فایل | بایت واقعی، تعداد و hash مطابق manifest |
| نقش‌ها | تست منفی چند tenant و جداسازی adminpanel/adminshop |
| عملکرد | پروفایل، محتوای سایت و adapterهای API سالم |
| هویت | login/recovery/MFA/redirect و reauthentication معتبر |
| بکاپ مقصد | snapshot مقصد و restore drill موفق |
| rollback | مسیر حفظ delta و بازگشت آزموده‌شده |

فعلاً هیچ داده یا credential production در این پروژه وجود ندارد؛ بنابراین این runbook هنوز روی مبدأ/مقصد واقعی اجرا نشده است.
