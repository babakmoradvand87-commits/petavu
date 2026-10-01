# معماری PETAVU

تاریخ تحقیق: ۲۰۲۶-۱۰-۰۱. این سند تصمیم‌های مهندسی و وضعیت اجرای آن‌ها را از هم جدا می‌کند.

## ۱. پنج فضای مستقل

| فضا | مسئولیت | build | سرویس/جلسهٔ نهایی |
|---|---|---|---|
| دامنهٔ اصلی | معرفی برند، گروه‌ها، دعوت به عضویت | `build:web` | public content؛ بدون مجوز مدیریت |
| `panel.` | پروفایل و فضای اعضای کسب‌وکار | `build:panel` | member audience و cookie مستقل |
| `adminpanel.` | مدیریت سایت اصلی، بررسی اعضا و رویدادها | `build:adminpanel` | staff capability + MFA |
| `shop.` | ویترین همکاری B2B | `build:shop` | catalog public، بدون اختیارات مدیریتی |
| `adminshop.` | بررسی و مدیریت ویترین | `build:adminshop` | shop.manage + MFA؛ مستقل از adminpanel |

در پیش‌نمایش، این فضاها زیر مسیرهای همان origin نمایش داده می‌شوند. DNS و ساب‌دامین واقعی هنوز ایجاد نشده‌اند. پنج خروجی frontend جدا قابل build و انتشار هستند. `apps/*/app.json` قرارداد هر فضا و `src` کتابخانهٔ فعلیِ مشترک UI است؛ backendهای مستقل هنوز ساخته نشده‌اند.

در استقرار واقعی، هر artifact سرویس و تنظیمات runtime خود را دارد. خرابی/انتشار یک frontend نباید دیگری را الزاماً دوباره deploy کند. نسخهٔ UI مشترک باید در release هر برنامه ثابت باشد. قرارداد API نسخه‌دار است؛ تغییر ناسازگار نیازمند نسخهٔ تازه و rollout مرحله‌ای است.

## ۲. فناوری نسخهٔ اول

- React + TypeScript و Vite، با dependencyهای دقیق در lockfile؛ بدون CDN برای فونت/تصاویر/اسکریپت.
- رابط فارسی RTL و متغیرهای CSS، با Vazirmatn و Manrope خودمیزبان.
- تصویر سه‌بعدی برند + Three.js برای حلقهٔ تعاملی؛ fallback تصویری، توقف حرکت و وقفهٔ رندر خارج viewport.
- پنج build مستقل از کد مشترک، و static server قابل انتقال در Docker. سرویس production با Node 24 ساخته می‌شود؛ digest تصاویر باید هنگام استقرار واقعی بازبینی و pin شود.
- PostgreSQL برای دادهٔ تراکنشی؛ Object Storage سازگار با S3 برای فایل‌ها. Redis/موتور جست‌وجوی جدا فقط پس از مشاهدهٔ نیاز واقعی، نه برای شلوغ کردن معماری اولیه.
- API/BFF سمت سرور بین مرورگر و دیتابیس. در تحویل فعلی endpointهای واقعی پیاده‌سازی نشده‌اند؛ `/api/*` در static server پاسخ 503 دارد.

این انتخاب برای این محصول است، نه ادعای «سریع‌ترین ابزار دنیا». SEO انتشار عمومی در مرحلهٔ بعد نیازمند prerender/SSR سایت اصلی، metadata واقعی، sitemap و حذف noindex پس از تأیید انتشار است؛ پنل‌های خصوصی noindex می‌مانند.

## ۳. تصمیم دیتابیسِ مبتنی بر تحقیق

منبع رسمی PostgreSQL هنگام بررسی، ۱۸٫۶ را در نسخه‌های پایدار و ۱۹ را در مرحلهٔ Beta 4 نشان می‌دهد؛ beta برای production انتخاب نشده است. [3](https://www.postgresql.org/) [1](https://www.postgresql.org/about/news/postgresql-186-1711-1615-1519-1424-and-19-beta-3-released-3365/)

پیشنهاد هاست مستقل: PostgreSQL 18 با آخرین minor پایدارِ بررسی‌شده در زمان استقرار. برای Supabase، بالاترین نسخهٔ پشتیبانی‌شدهٔ همان پروژه پس از تست سازگاری انتخاب شود؛ مستندات فعلی مسیر Postgres 17 و محدودیت افزونه‌های آن را شرح می‌دهند، بنابراین این طرح بی‌بررسی نسخهٔ ۱۸ را روی Supabase تحمیل نمی‌کند. [1](https://supabase.com/docs/guides/platform/upgrading)

SQL این بسته بر قابلیت‌های قابل‌حمل PostgreSQL 17+ بنا شده است: uuid، timestamptz، JSONB محدود برای محتوا، قیود صریح، partial indexes و RLS؛ بدون وابستگی به یک افزونهٔ اختصاصی یا `auth.uid()` در کل مدل دامنه.

### مدل منطقی

```text
identity.actors ← provider_links
        │
        └── network.memberships → network.organizations
                                      ├── organization_categories → business_categories
                                      ├── organization_private
                                      ├── documents → private object storage
                                      └── commerce.products
content.pages: نسخه‌بندی محتوای سایت
operations.audit_events: رویداد حداقلی، append-only برای نقش runtime
operations.outbox_events: انتشار رویداد تراکنشی در فاز backend
```

- دستهٔ تجاری از role عضویت و capability مدیریتی جداست.
- `organization_id` مرز tenant است؛ اطلاعات خصوصی از پروفایل قابل‌انتشار جداست.
- FKها، UNIQUE، CHECK و indexهای مسیرهای دسترسی در migration ثبت شده‌اند.
- زمان‌ها UTC/timestamptz؛ در UI محلی‌سازی می‌شوند. برای پول در فاز تجارت، مقدار integer در واحد کوچک پول + currency لازم است؛ در این فاز مدل سفارش یا قیمتِ ساختگی ساخته نشده است.
- UUID پایدار مانع وابستگی لینک‌ها به شناسهٔ یک سرویس Auth می‌شود. تصمیم UUIDv7/partitioning تنها پس از benchmark و نیاز واقعی؛ uuid تصادفی به‌خودی‌خود تضمین کارایی نیست.
- صفحه‌بندی نهایی keyset بر `(created_at,id)`؛ queryهای پارامتری؛ سقف page size و جلوگیری از N+1؛ اندازه‌گیری با EXPLAIN ANALYZE روی دادهٔ representative.
- search فارسی باید normalization «ی/ک»، نیم‌فاصله و collation را تست کند. موتور جست‌وجوی خارجی فعلاً اضافه نشده است.

### مرز RLS

RLS این بسته برای API مورداعتماد طراحی شده است. `petavu.actor_id` فقط پس از اعتبارسنجی session از سمت سرور، داخل transaction تنظیم می‌شود. این مقدار به‌تنهایی احراز هویت نیست؛ کاربر SQL نباید به مرورگر داده شود. schemaهای خصوصی نباید بی‌بررسی به PostgREST عمومی expose شوند.

سرویس‌های adminpanel و adminshop credential و نقش دیتابیس جدا دارند. داشتن رابط مدیریت یا تغییر نقش نمایشی مرورگر هیچ مجوز واقعی ایجاد نمی‌کند. تعیین staff capability، ایجاد نخستین مدیر و کنترل MFA هنوز نیازمند backend هستند.

## ۴. قابلیت انتقال

- شناسهٔ فایل، object key و checksum ذخیره می‌شود؛ URL کاملِ هاست در دادهٔ دامنه hardcode نمی‌شود.
- سرویس‌های Auth، DB و Storage پشت قرارداد/adaptor قرار می‌گیرند. انتقال صرفِ هاست frontend نباید تغییر دادهٔ دامنه بخواهد.
- API origin، دامنه و scope از runtime config عمومی، نه secret یا دامنهٔ preview، خوانده می‌شوند.
- migrationها و کد + lockfile + فونت/رسانه در بسته موجودند. تنظیمات محرمانه جداگانه تزریق می‌شوند.
- مهاجرت به معنای انتقال همهٔ sessionها نیست. sessionهای قدیمی باید باطل شوند؛ تغییر دامنهٔ WebAuthn یا ارائه‌دهندهٔ Auth ممکن است نیازمند ورود/ثبت دوباره باشد، بدون حذف پروفایل کسب‌وکار.

## ۵. خط قرمز production

این تحویل frontend فعال و schema آزموده‌شدهٔ محلی است؛ پنل production، احراز هویت، صحت مدارک حرفه‌ای، سفارش/پرداخت، بکاپ scheduler و ساب‌دامین‌های واقعی ساخته/فعال نشده‌اند. اسناد طراحی، گواهی اجرا یا انطباق نیستند.

## افزودهٔ نسخهٔ ۰٫۲

ورودی عمومی مستقلی برای صفحهٔ به‌زودی اضافه شده است: `src/public-main.tsx`. پنج frontend کامل به مخزن خصوصی/preview مالک محدودند و در build عمومی import نمی‌شوند. مدل‌های procedural و camera واقعی WebGL با progress اسکرول کار می‌کنند؛ عکس فقط fallback است. رندر فقط هنگام تغییر/تعامل انجام می‌شود، نه loop سنگینِ تزئینیِ همیشگی. برای انتشار موقت معرفی از GitHub Pages استفاده می‌شود، نه برای backend یا تجارت عملیاتی. Source، public artifact و نمایش protected E2B سه سطح متفاوت‌اند؛ سند PUBLISHING مرجع تفکیک است.
