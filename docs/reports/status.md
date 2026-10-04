# وضعیت زندهٔ PETAVU

این پرونده با `npm run status -- --write` ساخته می‌شود؛ دستی ویرایش نشود.
عددها از پایگاه‌داده‌ای خوانده می‌شوند که همین حالا از صفر ساخته، مهاجرت و seed شده است.

- **زمان اندازه‌گیری (UTC):** 2026-10-04 07:44
- **مهاجرت‌ها:** 23 فایل، 23 اجراشده روی پایگاه‌دادهٔ تازه
- **Seed:** 8 فایل — 0001_reference.sql, 0002_design_system.sql, 0003_platform_defaults.sql, 0004_automation_rules.sql, 0005_reference_completeness.sql, 0006_site_pages.sql, 0007_budget_routes.sql, 0008_panel_menus.sql
- **تست‌ها:** 976 مورد در 23 پرونده (وضعیت سبز/سرخ تنها با «npm test» تأیید می‌شود)

## شمارش‌های پایگاه‌داده

| سنجه | شمار |
| --- | --- |
| جدول‌ها | ۹۳ |
| توابع دامنه | ۱۱۴ |
| سیاست RLS | ۲۹۲ |
| قید یکپارچگی | ۳۶۴ |
| ماشه | ۶۰ |
| مجوز | ۶۱ |
| نقش کسب‌وکار | ۶ |
| نقش پلتفرم | ۵ |
| نوع کسب‌وکار | ۲۹ |
| صنعت | ۵۳ |
| مکان | ۱۰۰ |
| دستهٔ محتوا | ۲۶ |
| کامپوننت طراحی | ۴۳ |
| قالب صفحه | ۵ |
| قالب سئو | ۱۳ |
| موجودیت سئو | ۱۹ |
| فیچر ثبت‌شده | ۱۴ |

## تست‌ها به تفکیک پرونده

| پرونده | تعداد تست |
| --- | --- |
| `tests/api.test.mjs` | 68 |
| `tests/automation.test.mjs` | 23 |
| `tests/coverage.test.mjs` | 20 |
| `tests/db-repositories.test.mjs` | 52 |
| `tests/db.test.mjs` | 36 |
| `tests/domain-functions.test.mjs` | 25 |
| `tests/domain-schema.test.mjs` | 60 |
| `tests/features.test.mjs` | 15 |
| `tests/migrations.test.mjs` | 33 |
| `tests/ops.test.mjs` | 31 |
| `tests/panel.test.mjs` | 18 |
| `tests/performance.test.mjs` | 23 |
| `tests/rls-null-fences.test.mjs` | 20 |
| `tests/security.test.mjs` | 54 |
| `tests/seed.test.mjs` | 25 |
| `tests/seo-technical.test.mjs` | 56 |
| `tests/seo.test.mjs` | 67 |
| `tests/shared.test.mjs` | 43 |
| `tests/web-design.test.mjs` | 51 |
| `tests/web-pages.test.mjs` | 78 |
| `tests/web-performance.test.mjs` | 76 |
| `tests/web-seo.test.mjs` | 45 |
| `tests/web.test.mjs` | 57 |
