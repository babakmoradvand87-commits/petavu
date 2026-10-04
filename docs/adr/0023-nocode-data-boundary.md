# ADR-0023 — No-Code یک DSL داده‌ای است؛ CRUD همان content است

وضعیت: اجراشده در گام ۳۱. مرجع: Addendum §73–87، Master §52–56، §74، §96–99، §191.

## تصمیم

- تعریف Field/Relationship/Form/CRUD در `design.definition`، با Draft و نسخه‌های افزودنی است. JSON فقط DSL محدود است: SQL/JS/server code/expression/HTML/CSS/regex سفارشی پذیرفته نمی‌شود.
- هیچ DDL در زمان کار، جدول کاربرساخته، مسیر DB مستقیم یا مجوز ساخته‌شده در مرورگر وجود ندارد. نوع فیلد از فهرست بسته می‌آید؛ reference/media بررسی scope دارند.
- CRUD همان `app.content` و همان moderation/transition/API/SEO/search/outbox است. **اطلاعات خصوصی در `app.content_extension` بدون گرنت عمومی** است؛ body/body_text/summary/title فقط projection فیلدهای صریحاً عمومی است. هدف CRUD به page/article/service/listing محدود است؛ به credential/session/inventory یا جدول دلخواه وصل نمی‌شود.
- Relationship Builder روی همان `app.business_relationship` است؛ گراف موازی ساخته نشده. تأیید pending فقط از طرف گیرنده است و نسخهٔ کهنه رد می‌شود. خواندن قدیمی که `confirmed` را به‌جای `active` می‌خواست اصلاح شد.

## انتشار و تغییر schema

`0026`، snapshot/activate موجود را با **همان pipeline** توسعه می‌دهد. Definition در bundle و source hash است؛ live toggle مستقیم بسته است. Form عمومی و CRUD، یک صفحهٔ سمنتیکِ واقعی (فرم یا فهرست رکوردهای واقعی) برای Page Builder می‌سازند؛ Draft به‌خودی‌خود عمومی نمی‌شود. فیلد مستقل به یک فرم/مدل وصل می‌شود، نه اینکه صفحهٔ ساختگی برای آن منتشر شود.

رکوردهای موجود با schema پیشنهادی بررسی می‌شوند. افزودن required یا تغییر نوع ناسازگار، انتشار را متوقف می‌کند؛ روش سالم optional → backfill از API مجاز → required است. بیشتر از ۱۰۰۰ رکورد در یک بازرسی sync، صریحاً نیازمند backfill محدود است و «همه سالم‌اند» فرض نمی‌شود.

تغییر privacy، projection رکوردهای همان scope را در تراکنش انتشار بازمی‌سازد و values خصوصی حفظ می‌شود. عملیات رکورد قفل shared scope می‌گیرد و publish قفل exclusive؛ schema زندهٔ کسب‌وکار از release همان scope خوانده می‌شود، نه Draft بعدی پلتفرم.

## فرم واقعی

رندر مشترک، کنترل HTML با label/consent/۴۴px و پیام خطا دارد. Nonce از UUID امن و schema hash از SHA-256 بومی است. فرم‌های nonceدار `no-store` هستند تا HTML مشترک، nonce همهٔ بازدیدکنندگان نشود.

POST عمومی → BFF بدون کوکی → API → schema/receiver/Origin/rate/consent/honeypot/type/reference → ذخیرهٔ واقعی `app.form_submission` → audit/event. `idempotency_key` + hash مانع تکرار اثر و تغییر payload با همان کلید است. endpoint، email «ارسال‌شده» اعلام نمی‌کند؛ فقط رسید ثبت واقعی می‌دهد. دادهٔ submission عمومی، سرچ یا sitemap نمی‌شود.

## UI

ادمین: `/app/nocode`؛ عضو: `/app/pages?builder=nocode`. Standard Field و Advanced JSON **دو نمایش همان schema** اند. ایجاد/ویرایش/تاریخچه/Restore Draft، Form/Page تولیدی، CRUD حقیقی و inbox، به API وصل‌اند. Relationship درخواست/تأیید/پایان از همان گراف است.

محتوای کسب‌وکار مسیر واقعی `/b/:slug/c/:content` دارد؛ renderer همان content renderer عمومی است و canonical/entity ID درست دارد. مراحل پیشرفتهٔ coverage/search/indexing در گام ۳۳ ادامه می‌یابند.

## شواهد

۲۱ آزمون تازه در `tests/nocode.test.mjs`: DSL و دادهٔ بد، IDOR/scope، versioning، جلوگیری از live bypass، pipeline، فرم HTTP واقعی/رضایت/idempotency/عدم گرنت عمومی، CRUD هم‌هسته/حفظ داده/نسخه، privacy projection اتمی، schema migration ناسازگار، B2B recipient-only و URL عمومی واقعی. Regression renderer به اتصال واقعی فرم در گام ۳۱ به‌روز شده است؛ dummy endpoint یا ادعای ارسال وجود ندارد.
