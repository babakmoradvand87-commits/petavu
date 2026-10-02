# گزارش گام ۱۰ — اسکیمای دامنه روی پایگاه‌داده

- **تاریخ:** ۲۰۲۶-۱۰-۰۲
- **کامیت:** `0c04510`
- **گام‌های بسته‌شده:** ۶ (هویت)، ۷ (کسب‌وکار)، ۸ (محتوا/رسانه)، ۹ (طراحی)، ۱۰ (سئو)
- **مرجع:** §6–۱۷، §۱۸–۲۴، §۳۲–۴۴، §۴۹–۵۱، §۵۷–۵۸، §۹۴، §۱۸۰، §۱۸۷؛ Addendum §۳۹–۴۷، §۹۷، §۱۰۳

## ۱. خط پایهٔ قابل اندازه‌گیری

| سنجه | نتیجه |
| --- | --- |
| تست‌ها (`node --test tests/`) | **۱۹۰ / ۱۹۰ سبز** — shared ۴۳، security ۵۴، migrations ۳۳، domain-schema ۶۰ |
| مهاجرت‌ها | ۶ فایل، ۴۳۸۲ خط SQL، روی `--memory` و روی دیسک |
| Seed | ۱ فایل (۸۹۳ خط)، ایدمپوتنت با دفتر `ops.seed` و درهم فایل |
| نصب تازه | `rm -rf .data/pg` → `npm run migrate` → `npm run seed` → `npm run migrate:status` = «۶ اجراشده، ۰ معلق، ۰ واگرا» |
| Build | `npm run build` (TypeScript سخت‌گیر) بی‌خطا |

اجرای دوبارهٔ `node scripts/seed.mjs --memory`: «اجرا شد 0001_reference.sql (۵۹ میلی‌ثانیه)» و
بار دوم «همهٔ ۱ فایل seed از قبل اجرا شده بود» — یعنی §180 واقعاً برقرار است، نه ادعا.

## ۲. چه چیزی ساخته شد

| مهاجرت | محتوا |
| --- | --- |
| `0002_identity` | `auth.user`، `identity` (ایمیل/موبایل، یکتایی جزئی با احترام به حذف نرم)، `credential`، `device`، `session`، `one_time_token`، `recovery_code`، `login_attempt` + توابع `security definer`: `find_login_candidate`، `record_login_attempt` (قفل تدریجی)، `recent_failures`، `consume_one_time_token`، `count_active_tokens` |
| `0003_business` | `ref.business_type/industry/location` + `app.business`، `membership`، `invitation`، `business_relationship`، `ownership_transfer` + توابع `is_member_of` / `role_of` / `has_permission` (ترتیب سلب > افزودن > نقش) / `active_member_count` / `user_in_transfer` |
| `0004_content_media` | `app.content`، `content_block`، `content_review` (افزودنی)، `content_category`، `ref.category` + `media.asset`، `derivative`، `album` و توابع `media.asset_is_usable` / `recount_assets` |
| `0005_design` | `design.token`، `theme`، `theme_token`، `component` (Registry فهرست‌بسته)، `page`، `page_revision`، `release`، `page_template`، `preview_link`، `audit` + `validate_tree` و `tree_hash` |
| `0006_seo` | کل `seo.*`: `settings` (دوسطحی، محیط‌آگاه)، `template`، `metadata`، `structured_data`، `canonical`، `redirect`، `sitemap`، `indexing_event`، `topic`، `keyword`، `entity` (لنگر برند)، `internal_link`، `audit` + `pick_template` / `match_redirect` / `find_orphans` / `redirect_chain_issue` |
| `seeds/0001_reference` | ۵۹ مجوز دامنه‌ای، ۶ نقش کسب‌وکار، ۵ نقش پلتفرم، ۲۹ نوع کسب‌وکار، ۵۳ صنعت سه‌سطحی، ۳۱ استان + شهرها (۱۰۰ مکان)، ۲۶ دسته، ۴۳ کامپوننت ثبت‌شده با `props_schema`/`slots`/`a11y`/`seo`/`performance`، ۵ قالب صفحه، ۱۱ قالب سئو، موجودیت لنگر برند + ۱۸ موجودیت پایه، ۱۴ فیچر در `ops.feature` |

هر جدول دامنه‌ای سه‌گانهٔ «RLS فعال + سیاست یک‌دستوری + گرنت صریح» را دارد و هیچ
سیاستی به‌طور پیش‌فرض اجازه نمی‌دهد. جزئیات تصمیم‌ها در `docs/adr/0005-multi-tenancy-and-secrets.md`.

## ۳. سه اشکال واقعی که تست‌ها گرفتند (و چرا مهم‌اند)

۱. **`content.manage` مجوز خیالی بود.** سیاست‌های محتوا به کلیدی تکیه می‌کردند که در
   `auth.permission` وجود نداشت؛ نتیجه: آن مسیرها همیشه همه را رد می‌کردند و **هیچ تست
   واحدی هم شکست نمی‌خورد**. امروز تستی وجود دارد که هر `has_permission(…, 'x')` در
   `pg_policies` را با فهرست مجوزها مقابله می‌کند، و کار مدیریت محتوا به
   `content.create` / `content.update` / `content.delete` / `content.publish` تفکیک شده است.

۲. **`auth.record_login_attempt` هرگز اجرا نشده بود.** تابع با
   `returns table (…, failed_login_count integer)` هم‌نام ستون `app_user` شده بود و در
   `set failed_login_count = failed_login_count + 1` خطای ابهام می‌داد. یعنی مسیر «قفل حساب
   پس از پنج خطای ورود» تا امروز یک بار هم کار نکرده بود. نام‌ها مقید و تست‌پذیر شدند.

۳. **`design.validate_tree` درخت بی‌ریشه را سالم می‌دانست.** `jsonb_typeof(null)` تهی
   می‌دهد و `null <> 'array'` هم تهی است نه `true`؛ پس بازرسی ساختاری — یعنی دروازهٔ خط
   لولهٔ انتشار (§38) — درخت بدون ریشه را قبول می‌کرد. با `is distinct from` بسته شد.

به این‌ها اضافه کنید: قید `content_publish_shape` (انتشار بدون `published_at`) عملاً
بی‌اثر بود، سیاست ساخت نشست `with check (true)` بود، و تاریخچهٔ نسخه‌های صفحه
(`design.page_revision`) افزودنی نبود. هر چهار مورد اصلاح شد.

## ۴. تصمیم‌های معماری این گام

- **جداسازی، سیاست است نه عادت:** هیچ کوئری‌ای «امیدوار» نمی‌ماند که `where business_id`
  یادش نرود؛ RLS در پایگاه‌داده اجرا می‌شود.
- **تولد کسب‌وکار:** سیاست `membership_bootstrap_owner` حلقهٔ «مجوز↔عضویت» را فقط در لحظهٔ
  تولد و با چهار قید باز می‌کند؛ `membership_no_extra_owner` مالک دوم را برای همیشه می‌بندد.
- **`insert … returning` و RLS:** سیاست `business_owner_select` لازم شد، چون PostgreSQL
  هنگام بازگرداندن ردیفِ تازه‌ساخته‌شده هم سیاست `select` را می‌سنجد.
- **جعل هویت (§31):** ساخت نشست برای کاربر دیگر فقط با نقش پلتفرمی و با ثبت نام جاعل.
- **سئو = مدل داده، نه لایهٔ کد (§103):** جدول‌های `seo.*` منبع حقیقت قواعدند؛ رندر متن،
  کار `packages/seo` در گام‌های بعد.
- **بدون افزونهٔ بیرونی:** `pgcrypto`/`pg_trgm`/`unaccent` در محیط نیستند و به آن‌ها تکیه
  نشده؛ شناسه `gen_random_uuid()`، اثر انگشت محتوایی `md5()`، جست‌وجوی متنی با
  `to_tsvector('simple', …)`. هیچ هش امنیتی در SQL ساخته نمی‌شود.

## ۵. گام بعدی (۱۱–۲۰)

۱. `0007_ops` — بکاپ، سقف نرخ، ابزار صف/Outbox و نگه‌داشت داده.
۲. ماتریس مجوز (§142) و تست پوشش: هر جدول ⇒ سیاست؛ هر سیاست ⇒ گرنت؛ هر مجوز ⇒ نقش.
۳. توابع دامنه: پذیرش دعوت، انتقال مالکیت اتمی، چرخهٔ عمر محتوا، شمارنده‌ها.
۴. `packages/db` (DAL + زمینهٔ درخواست) و سپس Repositoryها.
۵. `packages/seo` و دروازهٔ انتشار طراحی (CHANGE→…→PUBLISH→MONITOR→AUDIT).
