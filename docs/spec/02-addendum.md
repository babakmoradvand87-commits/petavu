# سند ۲ — ADDENDUM

**PERFORMANCE + SEO + GEO + AUTOMATION + NO-CODE FEATURE ARCHITECTURE**

این سند، **ادامهٔ مستقیم پرامپت اول** است. پروژهٔ جدید نیست، بازطراحی جایگزین
نیست. به همان معماری، همان پایگاه‌داده، همان API، همان رابط کاربری، همان سیستم
طراحی، همان پنل‌ها و همان زیرساخت اضافه می‌شود.

---

## قاعدهٔ بنیادی

- **پرامپت اول + این سند = یک Specification نهایی.**
- هیچ الزام پرامپت اول حذف، ساده یا نادیده نمی‌شود.
- **هیچ سیستم موازی، معماری دوم، یا workaround موقت** ساخته نمی‌شود.
- **PART 101** فهرست ۲۵ گام اجرایی این سند است.
- **PART 102** هیچ Mock/Fake به‌عنوان implementation نهایی — فقط Adapter واقعی
  با وضعیت روشن (`configured` / `not_configured` + دلیل).
- **PART 103** Source of Truth: معماری → DB → API Contracts → Feature Registry →
  Design Tokens → Config → SEO Rules → Automation Rules. **UI هرگز SoT نیست.**

## §1–۴ — Performance به‌عنوان معماری

- بودجهٔ عملکرد از ابتدا در معماری است، با عدد قابل اندازه‌گیری و قابل اعمال
  (enforce) — نه توصیه.
- **Publish Gate**: انتشار بدون عبور از بودجه، انجام نمی‌شود.
- بودجه روی هر صفحه: HTML، CSS، JS، تصویر، فونت، تعداد درخواست، LCP، INP، CLS.

## §5–۶ — اندازه‌گیری، نه ادعا

- هر بودجه‌ای که اندازه‌گیری نشود، آرزوست. نمونه‌های واقعی مرورگر (RUM) +
  اندازه‌گیری سمت سرور.
- عبور/شکست، در پایگاه‌داده ثبت می‌شود و در کنار هر انتشار قابل بازبینی است.

## §7–۹ — تصویر و رسانه

- خط لولهٔ تصویر: اعتبارسنجی MIME و signature (نه فقط پسوند)، تولید AVIF/WebP،
  `srcset`، ابعاد اعلام‌شده.
- تصویر LCP با `eager` و `fetchpriority=high`؛ بقیه `lazy`.

## §10–۱۴ — Caching و CDN

- کش چندلایه: مرورگر، لبه (edge)، برنامه، پایگاه‌داده.
- دارایی‌های تغییرناپذیر با نام محتوامحور (content-addressed) و
  `Cache-Control: immutable`.
- HTML با بازاعتبارسنجی کوتاه؛ صفحهٔ خطا بدون کش.
- آماده برای CDN، بدون وابستگی به CDN خاص.

## §15–۱۹ — CSS، فونت، پویانمایی، CLS

- CSS توکن‌محور: رنگ و اندازه در CSS دست‌نویس تکرار نمی‌شود.
- فونت WOFF2، subset، `font-display: swap`، و preload محدود (نه بیش از دو فایل).
- پویانمایی فقط با `transform` و `opacity`؛ احترام به `prefers-reduced-motion`.
- CLS: فضای رزرو‌شده برای تصویر/ویدیو/بنر؛ پرش معیار شکست است.

## §20 — Third-party

- هر منبع بیرونی باید ثبت شود: هدف، هزینه، استراتژی بارگذاری. بدون ثبت، بارگذاری
  نمی‌شود.

## §21–۲۴ — Feature Registry به‌عنوان SoT

- هر فیچر در Registry با lifecycle:
  `Draft → Development → Preview → Testing → Approved → Published → Deprecated → Archived`.
- Registry، متادیتای عملکرد، سئو و جست‌وجو را نگه می‌دارد.
- Dependency Graph: افزودن/حذف فیچر با آگاهی از وابستگی‌ها.
- Safe Removal: حذف فیچر بدون شکستن چیز دیگر.

## §25–۳۲ — عملکرد پایگاه‌داده

- ایندکس بر اساس الگوی کوئری (نه حدس).
- صفحه‌بندی نشانه‌محور برای فهرست‌های بزرگ.
- بدون `SELECT *` در مسیرهای داغ.
- Query timeout.
- پرهیز از N+1.

## §33–۳۵ — API

- نسخه‌دار، صفحه‌بندی‌شده، فیلترپذیر. قرارداد پایدار.

## §36–۳۸ — جست‌وجو

- ابتدا PostgreSQL-friendly (خودِ PG، با `tsvector`/`trigram`).
- Adapter برای OpenSearch / Elasticsearch / Meilisearch.
- جست‌وجو، جدای از سئو نیست: کوئری‌های بی‌نتیجه، ورودی محتوا هستند.

## §39–۴۷ — SEO به‌عنوان Data Model

- جداول: `seo_settings`, `seo_templates`, `seo_rules`, `seo_metadata`,
  `seo_redirects`, `seo_canonicals`, `seo_audits`, `seo_keywords`,
  `seo_topics`, `seo_entities`, `seo_internal_links`, `seo_sitemaps`,
  `seo_indexing_events`, `seo_content_opportunities`.
- Template Engine برای عنوان/توضیح/H1.
- Search Intent مدل می‌شود.
- Topic Cluster و Knowledge Graph.
- Brand Entity مرکزی: همهٔ داده‌های ساخت‌یافته به یک موجودیت برند وصل می‌شوند.
- Structured Data Engine.
- robots پویا و محیط‌آگاه.
- سایتمپ داینامیک + Sitemap Index.
- IndexNow adapter.
- Canonical Engine مرکزی: یک جا تصمیم می‌گیرد کانونیکال کدام است.
- Redirect Manager: 301/302، تشخیص زنجیره و حلقه.
- Internal Linking و Orphan Detection.
- Content Opportunity: صفحه‌ای که باید ساخته شود.
- Programmatic/Location SEO با پرهیز از Thin Content.

## §44 و §46 — پرهیز از محتوای کم‌مایه

- صفحه‌ای که ارزش افزوده ندارد، ساخته نمی‌شود یا ایندکس نمی‌شود.

## §48–۵۵ — GEO (دیده‌شدن در پاسخ‌های ماشینی)

- ساختار محتوایی که برای موتورهای پاسخ‌گو (AI) قابل استخراج باشد.
- موجودیت‌های روشن، ادعاهای مستند، ارجاع داخلی.
- داشبورد AI Visibility.

## §56–۷۲ — Event Pipeline، Queue، Automation

- رویدادها: `ENTITY_CREATED`, `ENTITY_UPDATED`, `ENTITY_PUBLISHED`, …
- زنجیره: Event → SEO / Search / Sitemap / Notify / Analytics، بدون Block کردن
  درخواست کاربر.
- Queue/Worker برای: ایمیل، تصویر، سایتمپ، آنالیز، بکاپ.
- retry با backoff، idempotency، DLQ.
- Automation Rule Engine: **WHEN → IF → THEN**.
- Workflow Builder، Moderation، Notification (رویدادمحور و مبتنی بر صف).
- Audit کامل خودکارسازی‌ها + Observability: وضعیت صف، تلاش‌ها، آخرین خطا.

## §73–۸۰ — No-Code Builders

- Field Builder، Relationship Builder، Form Builder، Page/CRUD Builder.
- **مرز امنیتی §74 پرامپت اول:** No-Code هرگز Arbitrary SQL، Server Code یا
  JavaScript نمی‌سازد؛ هرگز امنیت/مجوز را دور نمی‌زند؛ هرگز دسترسی مستقیم به
  پایگاه‌داده نمی‌سازد.
- امنیت، بالاتر از No-Code است.

## §81–۸۷ — حالت ادمین و نسخه‌بندی پیکربندی

- Standard Mode / Advanced Mode برای هر پیکربندی.
- Versioning / Draft / Compare / Rollback برای هر تنظیم، قاعده و صفحه.

## §88–۹۰ — SEO Audit و Agent

- SEO Audit Engine: بازرسی خودکار صفحات.
- SEO Agent: پیشنهاد کنش.
- SEO Health Dashboard و AI Visibility Dashboard.
- Adapter برای GSC / Bing / IndexNow (وضعیت روشن: متصل یا نه).

## §91–۹۵ — Performance Observability و RUM

- LCP / INP / CLS از مرورگر واقعی.
- همبستگی: مرورگر → API → DB → Queue.
- هیچ شناسهٔ شخصی ذخیره نمی‌شود.

## §96–۱۰۰ — Design System سمنتیک و Publish Pipeline

- کامپوننت‌های سمنتیک: `h1`, `nav`, `breadcrumb`, `link`, `image`, `card`,
  `table` — با معنای درست، نه `div` عمومی.
- Structural Linter.
- **Publish Pipeline:**
  `CHANGE → VALIDATE → SECURITY → DB → API → PERFORMANCE → A11Y → SEO → SD →
  SEARCH → SITEMAP → AI → AUTOMATION → PREVIEW → APPROVAL → PUBLISH → MONITOR →
  AUDIT`

## §101–۱۰۵ — Portable و خودمیزبان

- قابل حمل، قابل نصب روی سرور خودی، بدون وابستگی به ارائه‌دهنده.

## §99 (سند ۱) — قاعدهٔ اتصال

هر فیچر جدید باید به این‌ها وصل شود:
DB، API، UI، Permission، Search، SEO، Structured Data، Sitemap، AI،
Notification، Automation، Audit، Analytics، Performance.

**§100 سند ۱:** هیچ فیچری جزیره نیست.
**§102 سند ۱:** هیچ Mock/Fake به‌عنوان implementation نهایی.
