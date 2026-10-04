# ADR-0025 — Search و GEO از دادهٔ واقعی، با مجوز و freshness

اجراشده در گام ۳۳؛ Addendum §36–55.

FTS عمومی در `seo.search_document` با tsvector/GIN است؛ pg_trgm فقط در PostgreSQLی که افزونهٔ واقعی دارد فعال می‌شود. رکورد دارای scope/entity/source_version است. RLS و API، وضعیت عمومی و **نسخهٔ منبع فعلی** را دوباره می‌سنجند؛ ایندکس عقب‌مانده نباید متن خصوصی‌شده را برگرداند. نسخهٔ aggregate کسب‌وکار با تغییر profile عوض می‌شود. Worker واقعاً scope را index و گراف برند را از کسب‌وکار عمومی می‌سازد.

قرارداد SearchAdapter برای PostgreSQL/OpenSearch/Elasticsearch/Meilisearch یکسان است. درایور خارجی بدون endpoint/key، `not_configured`/503 می‌دهد؛ نتایج خارجی فقط ID پیشنهاد می‌کنند و نام/snippet مجاز از DB دوباره خوانده می‌شود. دادهٔ remote منبع حقیقت امنیت نیست.

query بی‌نتیجهٔ واقعی، فرصت `keyword_gap` یکتا با شواهد می‌سازد؛ IP/شناسهٔ کاربر ذخیره نمی‌شود و عبارت شبیه ایمیل/تلفن برای فرصت نگه‌داری نمی‌شود. از آن صفحهٔ کم‌مایهٔ خودکار ساخته نمی‌شود.

GSC و Bing، HTTP protocol واقعی با اعتبارنامهٔ ENV دارند؛ نبود اعتبارنامه rows/click/score ساختگی نمی‌سازد. مشاهدهٔ manual با provenance صریح از API verified جدا است. dashboard `/app/search`، مشاهدهٔ واقعی را نمایش می‌دهد و در نبود داده «امتیاز صفر» حدس نمی‌زند. `/api/v1/geo/answers` فقط نهاد برند، پروفایل عمومی، منبع canonical و گراف عمومی مجاز را می‌دهد؛ claim دیده‌شدن در AI بدون مشاهده وجود ندارد.

IndexNow به runner/lease و indexing_event واقعی وصل است. Sitemap محتوای کسب‌وکار مسیر صحیح `/b/:slug/c/:content` دارد. محتوای کم‌مایه از renderer و sitemap هر دو خارج از indexing است. Fixture خزش برای آزمودن orphan/broken link باید **محتوای واقعیِ کافی در محیط تست** داشته باشد، نه سند خالی که طبق قرارداد باید noindex باشد.

شواهد: ۱۳ آزمون تازهٔ discovery سبز؛ ۵۶ آزمون technical SEO پس از معیار مشترک محتوای کافی سبز. آزمون‌ها FTS فارسی/عربی، scope، stale privacy، opportunity، عدم نگه‌داری PII، Worker/گراف واقعی، وضعیت صادق adapter، manual provenance، authorization نتایج remote و sitemap را می‌سنجند.
