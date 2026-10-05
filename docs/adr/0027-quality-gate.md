# ADR-0027 — دروازه کیفیت، شواهد مرورگر، Native PG ۱۸، SBOM

گام ۳۵؛ §117–۱۲۰، §190.

آزمون واحد/یکپارچه روی PGlite است. کیفیت پذیرش نیازمند شواهد جداست: Playwright+axe روی پنج سطح، اسکرین ۳۹۰ و ۱۴۴۰، و هم‌زمانی موجودی روی PostgreSQL 18.6 کامپایل‌شده. SBOM از `package-lock.json` ساخته می‌شود. `npm audit --omit=dev` باید صفر آسیب‌پذیری داشته باشد. MFA (TOTP RFC-6238، WebAuthn، recovery، impersonation با re-auth) در همین گام است. هیچ ادعای Core Web Vitals بدون نمونه مرورگر.
