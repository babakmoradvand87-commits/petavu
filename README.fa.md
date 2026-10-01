# PETAVU — پِتاو | نسخهٔ ۰٫۲

شبکهٔ همکاری B2B برای فعالان صنعت پت و اسب. این نسخه، ساختار و رابط اجرایی است؛ سرویس عملیاتی با حساب و دیتابیس زنده نیست.

## اصلاح اصلی این نسخه

**صفحهٔ اول اکنون تجربهٔ واقعی سه‌بعدیِ متصل به اسکرول است، نه عکس سه‌بعدی با پارالاکس.** مدل‌های سگ، گربه و اسب، حلقه، سکو و هشت جایگاه کسب‌وکار meshهای واقعی WebGL هستند. موقعیت اسکرول، دوربین، زاویه، عمق و مراحل روایت را کنترل می‌کند. scroll طبیعی باقی می‌ماند؛ توقف حرکت، reduced-motion، عبور از روایت و fallback بدون WebGL وجود دارند. در حالت ثابت، رندر سنگین بی‌دلیل ادامه پیدا نمی‌کند.

سایت و هر چهار فضای Panel، Adminpanel، Shop و Adminshop با سیستم طراحی یکپارچه بازطراحی شده‌اند. فارسی و RTL، فونت محلی، چیدمان fluid و هدف لمس حداقل 44×44 برقرار است.

## انتشار محدودِ عمومی

**لینک عمومی فقط صفحهٔ «به‌زودی» است.** نسخهٔ کامل، پنل‌ها، SQL، API و فرم عضویت به آن لینک اضافه نمی‌شوند. entry و artifact عمومی مستقل‌اند؛ CSS پنهان‌کننده جای جداسازی build/hosting را نمی‌گیرد.

- `npm run build:public` → `dist/public`
- `npm run serve:public` → فقط root و assetهای allowlist؛ بدون SPA fallback، API یا پنل
- `release/PETAVU-public-site.zip` → artifact قابل انتقال عمومی
- `release/deployment.json` → نتیجهٔ واقعی GitHub/Pages، بدون credential

پیش‌نمایش E2B نیازمند token پلتفرم است و در آزمون ناشناس 403 داد؛ این آدرس به‌عنوان لینک عمومی معرفی نمی‌شود. برای لینک مستقل، artifact «به‌زودی» در GitHub Pages منتشر می‌شود؛ وضعیت دقیق باید از deployment report بررسی شود. هیچ دامنه‌ای هنوز تنظیم نشده است.

## کد و پنل‌ها

Source به مخزن خصوصی و شاخهٔ بازبینی می‌رود؛ انتشار خودکار پنل‌ها یا merge به main انجام نمی‌شود. CI فعلاً قالب غیرفعال است. HTML preview کامل برای مالک در `release/PETAVU-preview.html`، نه روی سایت عمومی، قرار دارد.

| بخش | وضعیت |
|---|---|
| WebGL اسکرولی و UI/UX پنج فضا | اجرایی |
| حساب، backend، MFA و پنل مدیریتی واقعی | هنوز پیاده‌سازی/متصل نشده |
| PostgreSQL migration و RLS | ساخته و محلی آزموده شده |
| Supabase واقعی و دادهٔ production | استفاده/تغییر نشده |
| صفحهٔ به‌زودی | build عمومی مستقل؛ deploy report نتیجه را ثبت می‌کند |
| سفارش، پرداخت، پیام و دوره | فاز بعد |
| بکاپ production/PITR | طرح و اسکریپت؛ scheduler/restore واقعی اجرا نشده |

## اجرا و آزمون

```bash
npm ci
npm run typecheck
npm run test:db
npx playwright install --with-deps chromium
TEST_WEB_SERVER=1 npm run test:e2e
npm run build:all
npm run build:public
npm run export:preview
python scripts/package-release.py
```

برای توسعهٔ محلی، `npm run dev` فقط محیط owner preview است، نه لینک عمومی. CI template با Node 24 آماده است؛ dependencyها از lockfile نصب می‌شوند. نتیجهٔ فعلی: ۱۰ آزمون مرورگر و ۱۱ آزمون محلی SQL/RLS؛ گواهی تست نفوذ یا انطباق کامل نیست.

## Docker / هاست مستقل

```bash
docker build --build-arg APP_SCOPE=public -t petavu-public .
docker run --rm -p 8080:8080 petavu-public
```

برای پنج فضای داخلی، build با APP_SCOPE مربوطه؛ TLS، auth/BFF، session host-only و نقش سرویس مستقل باید پیش از انتشار واقعی تکمیل شوند. credentialها فقط در Secret Manager بیرونی؛ فایل‌ها و public runtime config بدون secret هستند. credential موقت GitHub در فایل یا artifact ذخیره نمی‌شود.

## اسناد

- [قواعد پروژه](AGENTS.md)
- [معماری](docs/ARCHITECTURE.fa.md)
- [انتشار و دامنه](docs/PUBLISHING.fa.md)
- [امنیت](docs/SECURITY.fa.md)
- [بکاپ](docs/BACKUP-RUNBOOK.fa.md)
- [انتقال](docs/MIGRATION.fa.md)
- [UI/UX](docs/UI-UX.fa.md)
- [نتایج آزمون](docs/TEST-RESULTS.fa.md)
- [متن و تحقیق برند](docs/CONTENT-RESEARCH.fa.md)

نام: PETAVU؛ تلفظ: پِتاو. لوگوی SVG پیشنهادی در `public/brand/petavu-logo.svg`؛ بررسی حقوقی علامت تجاری انجام نشده است.
