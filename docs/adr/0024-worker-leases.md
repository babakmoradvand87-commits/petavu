# ADR-0024 — Outbox → lease → handler → نتیجهٔ واقعی

وضعیت: اجراشده، گام ۳۲. مرجع: §61، §93، Addendum §56–72 و §91–95.

- `apps/worker` از همان `@petavu/db` و همان توابع دامنه استفاده می‌کند؛ UPDATE مستقلِ status برای اجرای کار نیست.
- dispatch رخداد با `FOR UPDATE SKIP LOCKED`، ساخت کارِ یکتا و `dispatched_at` در یک تراکنش است. `processed_at` فقط پس از پردازش واقعی می‌آید.
- claim با lease UUID و انقضای ۹۰ ثانیه است؛ پایان بدون worker/lease معتبر رد می‌شود. نتیجه، خطا، تلاش و زمان واقعی ذخیره می‌شوند. backoff/DLQ موجود حفظ شده است.
- handlerها فهرست بسته‌اند. نوع نامثبت retry→DLQ است، نه موفقیت. Rule Engine همان WHEN→IF→THEN است؛ run failed بعداً به‌خاطر unique «موفق» فرض نمی‌شود.
- projection/metadata/search مبتنی بر منبع PostgreSQL، scope همان job را دارد. source hash/count/زمان واقعی ثبت می‌شود. monitor از renderer واقعیِ پس از commit و همان `measurePage` استفاده می‌کند؛ CWV مرورگر جعل نمی‌شود.
- اعلان in-app پس از تحویل DB sent می‌شود. SMTP واقعی با nodemailer و گیرندهٔ تأییدشده؛ none/ناپیکربندی هرگز sent نیست. SMTP ممکن است پس از ابهام شبکه نیاز به بررسی داشته باشد؛ تضمین exactly-once بیرون از DB ادعا نمی‌شود.
- وبهوک فقط endpoint ثبت‌شده، secret_ref با پیشوند محدودِ ENV، امضای timestamp+delivery ID+body، idempotency header و HTTPS است. IP خصوصی/credential URL/redirect رد می‌شوند؛ اتصال واقعی به IP اعتبارسنجی‌شده pin می‌شود تا DNS-rebinding ممکن نشود. پاسخ ۲xx واقعی، تحویل شمرده می‌شود.
- schedule به‌عنوان داده در `ops.schedule` است؛ cadence ثابت/محدود، بدون cron code دلخواه. maintenance/rollup واقعاً اجرا می‌شوند.
- DLQ retry از API ادمین، با مجوز/نسخه/re-auth/دلیل/audit است؛ کاربر نمی‌تواند payload/kind را از Retry عوض کند.

## راه‌اندازی

پس از migrate/seed و ENV معتبر: `npm start` (API+Web+Worker روی هستهٔ مشترک)، `npm run worker` (Worker مستقل). PostgreSQL برای تولید و PGlite برای توسعه از همان interface استفاده می‌کنند؛ اسکریپت runtime migration مخفی یا دادهٔ نمونه تولید نمی‌کند.

## آزمون

۱۶ آزمون واقعی Worker: outbox/correlation/idempotency، rule/اعلان واقعی، lease، backoff/DLQ، وضعیت صادق SMTP، schedule، scope گیرنده، SSRF، عدم دسترسی نقش معمولی، HTTPS receiver واقعی و HMAC/replay headers، monitor با بایت واقعی صفحه/فونت/CSS. ۱۵۹ regression اولیهٔ صف/ادمین/اتوماسیون/Repository/پوشش امنیتی سبز.
