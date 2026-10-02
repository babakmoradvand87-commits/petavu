# وضعیت زندهٔ PETAVU

این پرونده با `npm run status -- --write` ساخته می‌شود؛ دستی ویرایش نشود.
عددها از پایگاه‌داده‌ای خوانده می‌شوند که همین حالا از صفر ساخته، مهاجرت و seed شده است.

- **زمان اندازه‌گیری (UTC):** 2026-10-02 12:48
- **مهاجرت‌ها:** 11 فایل، 11 اجراشده روی پایگاه‌دادهٔ تازه
- **Seed:** 5 فایل — 0001_reference.sql, 0002_design_system.sql, 0003_platform_defaults.sql, 0004_automation_rules.sql, 0005_reference_completeness.sql
- **تست‌ها:** 386 مورد در 12 پرونده (وضعیت سبز/سرخ تنها با «npm test» تأیید می‌شود)

## شمارش‌های پایگاه‌داده

| سنجه | شمار |
| --- | --- |
| جدول‌ها | ۸۸ |
| توابع دامنه | ۸۰ |
| سیاست RLS | ۲۷۰ |
| قید یکپارچگی | ۳۳۶ |
| ماشه | ۵۸ |
| مجوز | ۶۱ |
| نقش کسب‌وکار | ۶ |
| نقش پلتفرم | ۵ |
| نوع کسب‌وکار | ۲۹ |
| صنعت | ۵۳ |
| مکان | ۱۰۰ |
| دستهٔ محتوا | ۲۶ |
| کامپوننت طراحی | ۴۳ |
| قالب صفحه | ۵ |
| قالب سئو | ۱۲ |
| موجودیت سئو | ۱۹ |
| فیچر ثبت‌شده | ۱۴ |

## تست‌ها به تفکیک پرونده

| پرونده | تعداد تست |
| --- | --- |
| `tests/automation.test.mjs` | 23 |
| `tests/coverage.test.mjs` | 18 |
| `tests/db.test.mjs` | 36 |
| `tests/domain-functions.test.mjs` | 25 |
| `tests/domain-schema.test.mjs` | 60 |
| `tests/features.test.mjs` | 15 |
| `tests/migrations.test.mjs` | 33 |
| `tests/ops.test.mjs` | 31 |
| `tests/performance.test.mjs` | 23 |
| `tests/security.test.mjs` | 54 |
| `tests/seed.test.mjs` | 25 |
| `tests/shared.test.mjs` | 43 |
