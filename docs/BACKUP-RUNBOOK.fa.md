# بکاپ و بازیابی PETAVU

وضعیت: طرح عملیاتی و اسکریپت اولیه؛ scheduler، vault، فایل واقعی و دیتابیس production هنوز متصل نیستند. **در این تحویل، هیچ بکاپ production یا آزمون restore آن انجام نشده است.**

## ۱. پوشش بکاپ کامل

| دارایی | روش |
|---|---|
| دیتابیس دامنه، محتوا و نقش‌ها | logical dump نسخه‌دار + PITR/WAL در هاست مناسب |
| فایل و مدارک | snapshot جدا از Object Storage؛ versioning + checksum |
| کد و طراحی‌ها | release با lockfile، SVG، تصاویر، فونت/مجوز + manifest |
| Auth | export تنظیمات و نگاشت هویت؛ حساب‌ها/credentialها طبق قابلیت ارائه‌دهنده |
| runtime / DNS / redirect / ایمیل | export تنظیمات بازبینی‌شده؛ secrets جدا رمزنگاری شوند |
| کلید رمزنگاری و credentials بازیابی | vault/escrow مستقل، دسترسی دو نفره؛ نه داخل بکاپ عمومی |

Supabase صریحاً می‌گوید بکاپ دیتابیس شامل بایت فایل‌های Storage نیست؛ جدول metadata جای فایل واقعی را نمی‌گیرد. [1](https://supabase.com/docs/guides/platform/backups)

Edge Functions، Auth settings/API keys، Realtime و بعضی تنظیمات/افزونه‌ها نیز باید جدا بررسی و منتقل شوند. [2](https://supabase.com/docs/guides/platform/migrating-within-supabase/dashboard-restore)

## ۲. سیاست پیشنهادی

- الگوی 3-2-1-1-0: کپی‌های متعدد، storage مستقل، یک off-site و یک immutable، و restore بدون خطای بررسی‌نشده.
- SQL منطقی روزانه + snapshot فایل با نسخه‌بندی؛ production تراکنشی در صورت پشتیبانی سرویس از PITR/WAL استفاده کند.
- هدف اولیه RPO حداکثر ۲۴ ساعت با بکاپ روزانه؛ هدف ارتقای production RPO≤۱۵ دقیقه و RTO≤۴ ساعت فقط پس از طراحی و اندازه‌گیری. این اعداد SLA یا نتیجهٔ تأییدشده نیستند.
- retention پیشنهادی: روزانه ۱۴، هفتگی ۸، ماهانه ۱۲؛ دورهٔ نهایی باید با privacy و هزینه سازگار شود.
- restore drill ماهانه روی محیط جدا؛ پس از تغییر عمدهٔ schema یا ارائه‌دهنده، drill تازه.
- credentials بکاپ از credentials اپ جدا؛ حساب اپ حق حذف archiveهای immutable نداشته باشد.
- رمزنگاری با restic و credential تزریق‌شده از vault؛ password/key بازیابی مستقل نگهداری شود. بدون کلید قابل بازیابی، بکاپ رمز‌شده ارزشی ندارد.

## ۳. اجرای اسکریپت

`scripts/backup.sh` را روی runner مورداعتمادِ بیرون از این workspace اجرا کن. نیازها: pg_dump متناسب نسخهٔ سرور، rclone، restic، python3 و فضای موقت امن. `bash -x` و چاپ متغیرها ممنوع.

ورودی‌ها از vault/config امن:

```text
PGSERVICE                 نام سرویس در pg_service.conf، بدون credential در خط فرمان
PGPASSFILE                فایل رمز امن؛ permission محدود
RESTIC_REPOSITORY         مخزن مستقل و رمزنگاری‌شده
RESTIC_PASSWORD_FILE      کلید از vault، خارج از release
OBJECTS_SOURCE            مسیر remote کامل در rclone
SOURCE_RELEASE_ARCHIVE    archive کد/دارایی‌های همان release، بدون secrets
CONFIG_EXPORT_DIR         خروجی بررسی‌شدهٔ Auth/runtime/DNS و تنظیمات
BACKUP_WORKDIR            دیسک امن موقت خارج از workspace
PETAVU_WRITE_FREEZE_CONFIRMED=yes
```

برای snapshot سازگارِ DB و فایل، ابتدا barrier/maintenance واقعیِ نوشتن در backend و uploader برقرار شود یا روش versioned snapshot و cutoff قابل‌اثبات استفاده شود. متغیر «freeze confirmed» خودش نوشتن را متوقف نمی‌کند؛ اپراتور باید این وضعیت را واقعاً برقرار و بررسی کند. این backend/barrier هنوز ساخته نشده است. بدون آن ادعای consistency هم‌زمان مجاز نیست.

اسکریپت: dump کاملِ قابل‌خواندن، export دامنه برای انتقال، کپی objects و config و release، manifest SHA-256، انتقال رمز‌شده با restic و بررسی خوانایی snapshot جدید در مخزن. این بررسی برابر با restore کامل نیست؛ drill جدا اجباری است. scratch دادهٔ حساس دارد و روی storage رمز‌شده با permission محدود اجرا شود.

در Supabase ممکن است dump سراسری platform schemaها/roles محدود باشد. شکست نباید پنهان شود؛ از مسیر رسمی export همان سرویس استفاده کن و پوشش Auth/Storage را جدا اثبات کن. بکاپ قابل انتقال دامنه جای بکاپ Auth provider را نمی‌گیرد.

## ۴. آزمون بازیابی

1. snapshot و کلید مربوط را مشخص و مهر approval ثبت کن.
2. روی target خالی، جدا و بدون دسترسی عمومی restore کن؛ **هرگز در drill روی production ننویس**.
3. manifest را با `scripts/verify-manifest.py` بررسی کن. تعداد objectها، size و SHA-256 با metadata تطبیق داده شوند.
4. DB با ابزار هم‌نسخه/سازگار و roles/extensions مشخص restore شود. اختلاف‌ها و خطاها باید review شوند، نه «همهٔ errorها قابل چشم‌پوشی‌اند».
5. counts جدول‌ها، FKها، unique، وضعیت RLS و رفتار چند tenant، انتشار محتوا، پروفایل و signed-file access تست شوند.
6. Auth: کاربر نمونهٔ مجاز، MFA و نقش مدیر، redirectها و ابطال sessionهای قبلی بررسی شوند.
7. RPO/RTO مشاهده‌شده، commit/schema version، شمارش‌ها، نتایج و نقص‌ها ثبت شوند؛ تا رفع نقص، گیت انتشار بسته بماند.

## ۵. حذف/retention و هشدار

prune/delete خودکار در این اسکریپت وجود ندارد. retention تنها با review، تأیید مالک و اطمینان از داشتن بکاپ restoreشدهٔ دیگر اعمال شود. هشدارها: شکست dump/upload، snapshot قدیمی، تفاوت checksum، از کار افتادن زمان‌بندی، شکست restore و نزدیک شدن به انقضای credential.

نسخهٔ مستقل source در `PETAVU-source.zip` و manifest release خروجی طراحی‌اند؛ آن‌ها بکاپ حساب‌های فعلی یا دادهٔ Supabase نیستند.
