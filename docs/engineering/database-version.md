# انتخاب نسخهٔ تولید — بررسی ۲۰۲۶-۱۰-۰۴

**PostgreSQL 18.6** جدیدترین شاخه/patch پایدارِ بررسی‌شدهٔ رسمی است. PostgreSQL 19 هنوز Beta 4 است و انتشار major آن برای اکتبر برنامه‌ریزی شده؛ Beta وارد تولید PETAVU نمی‌شود. [2](https://www.postgresql.org/about/news/postgresql-186-1711-1615-1519-1424-and-19-beta-3-released-3365/) [1](https://www.postgresql.org/developer/roadmap/)

سیاست رسمی نسخه‌ها نیز 18.6 را current minor شاخهٔ ۱۸ نشان می‌دهد: https://www.postgresql.org/support/versioning/ . runtime تولید باید patch امنیتی روز را پس از آزمون migration/restore بگیرد، نه اینکه برای همیشه روی نسخهٔ تاریخی بماند.

توسعهٔ محلیِ lockfile: **PGlite 0.3.11 / PostgreSQL 17.5**؛ این هرگز «جدیدترین PostgreSQL تولید» معرفی نمی‌شود. SQL و RLS واقعی‌اند، ولی pooled concurrency/افزونه‌ها باید جدا روی Native PG بررسی شوند.

منبع رسمی 18.6 برای آزمون Native از `https://ftp.postgresql.org/pub/source/v18.6/postgresql-18.6.tar.bz2` دریافت و با SHA-256 فایل رسمی تطبیق شد:
`555610c24d53e4316da5b7d3fc25c279d96856d5e0e23ee308c328c5fa881d9f`.

ثبت نتیجهٔ واقعی Native/clean install/restore، در گام‌های کیفیت و گام نهایی است؛ صرف دریافت/مستندسازی، تست نصب محسوب نمی‌شود.
