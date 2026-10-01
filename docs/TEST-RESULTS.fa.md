# نتایج آزمون و حدود این تحویل

ثبت: ۲۰۲۶-۱۰-۰۱. محیط: Node 20.20.2، Chromium headless، موتور محلی PostgreSQL از PGlite. هیچ credential production یا اتصال حساب واقعی استفاده نشده است.

## نتایج موفق

- TypeScript typecheck بدون خطا.
- build مستقل هر پنج فضا: web، panel، adminpanel، shop، adminshop.
- **۱۰ آزمون مرورگر موفق:** نمایش پنج فضا بدون خطای JS؛ نبود overflow افقی در ۳۰ ترکیب مسیر/عرض؛ حفظ دستهٔ عضویت نمایشی؛ فیلتر و modal ویترین؛ جست‌وجو/ذخیرهٔ محلی پروفایل؛ reduced-motion؛ هدف‌های لمسِ نمایان حداقل 44×44؛ scan اولیهٔ accessibility.
- عرض‌های بررسی‌شده: 320، 390، 768، 1024، 1440، 1920 CSS px.
- axe در مسیرهای سایت، فرم عضویت، پنل اعضا، adminpanel، shop و adminshop: بدون violation از سطح serious/critical در scan با tagهای انتخاب‌شدهٔ WCAG. خطاهای contrastِ پیدا شده در بررسی اولیه اصلاح شدند و suite نهایی گذشت.
- **۱۱ آزمون SQL/RLS موفق:** گروه‌های کسب‌وکار، مرز tenant، حفاظت تماس خصوصی، منع self-verification و self-grant، جداسازی دو پنل مدیر، opt-in پروفایل عمومی، append-only audit برای runtime و عدم دسترسی خصوصی بدون context عضو.
- بررسی short-lived static server: CSP و security headers، public runtime config بدون secret، API پیکربندی‌نشده، منع method نامجاز و traversal، health با `backendConnected:false`.
- نسخهٔ HTML خودبسنده در iframe واقعی با `sandbox=allow-scripts` و origin مبهم بررسی شد؛ رندر و جابه‌جایی hash از سایت به پنل بدون خطای JS موفق بود. storage denial در این محیط با fallback مدیریت می‌شود.
- `npm audit` در لحظهٔ بررسی: صفر vulnerability گزارش‌شده؛ این فقط پایگاه advisory ابزار است، نه تضمین امنیت dependencyها.
- syntax اسکریپت بکاپ بررسی شد؛ manifest checker با fixture غیرحساس موفق و با بایت دستکاری‌شده ناموفق شد.
- بررسی بصری و تصویر خروجی دسکتاپ و موبایل انجام شد.

## کارایی مشاهده‌شدهٔ artifact

bundle اصلی production حدود ۲۹۸ KB خام / ۹۰ KB gzip؛ chunk سه‌بعدی حدود ۵۳۳ KB خام / ۱۳۳ KB gzip، جدا و پس از نزدیک شدن به viewport بارگذاری می‌شود. تصویر WebP برند حدود ۴۱ KB است. HTML آفلاین عمداً همهٔ منابع را تعبیه می‌کند و حدود ۱٫۶ MB است؛ این artifact preview جای build شبکه‌ای production نیست.

هشدار Vite دربارهٔ chunk سه‌بعدی بیش از ۵۰۰ KB باقی است؛ این chunk از مسیر حیاتی جدا شده است، اما benchmark واقعی روی دستگاه‌های ضعیف، مصرف باتری و اندازه‌گیری Web Vitals هنوز لازم‌اند. هدف‌های performance سند UI، نتیجهٔ اندازه‌گیری‌شدهٔ این محیط نیستند.

## اجرا نشده / قابل نتیجه‌گیری نیست

- اتصال یا migration روی Supabase واقعی، PostgreSQL شبکه‌ای production و provisioning کامل service identities.
- backend احراز هویت، cookie/session/MFA، API authorization و تست نفوذ مستقل.
- DNS/TLS/ساب‌دامین‌های واقعی، Docker build روی هاست مقصد و deploy CI در GitHub.
- سفارش، پرداخت، پیام، آموزش واقعی و صحت مدارک حرفه‌ای.
- scheduler بکاپ، dump/upload واقعی، restore کامل DB/Auth/Storage یا SLA/RPO/RTO تأییدشده.
- انطباق کامل ASVS یا WCAG. آزمون خودکار اولیه جای تست انسانی، همهٔ stateها و ارزیابی امنیت مستقل را نمی‌گیرد.

گزارش ماشینی مرورگر در `tests/browser-results.json` و dependency audit در `tests/dependency-audit.json` است. آزمون‌ها تکرارپذیرند؛ browser/node_modules پس از انتقال باید دوباره نصب شوند.

## نتیجهٔ افزودهٔ ۰٫۲

۱۰ آزمون مرورگر با موفقیت اجرا شدند. آزمون جدید، تغییر واقعی `data-camera` و progress صحنهٔ WebGL در اسکرول طبیعی را اندازه می‌گیرد؛ آزمون دیگر نبود لینک/فرم پنل در entry عمومی را بررسی می‌کند. scan contrast صفحهٔ عمومی نیز اصلاح و موفق شد. ۱۱ آزمون RLS همچنان موفق‌اند. پنل‌ها و صفحهٔ عمومی در دو entry متفاوت و پنج خروجی داخلی جدا ساخته شدند. اثر تحرک در حالت idle حذف شد؛ shader فقط با تغییر/تعامل دوباره render می‌شود. bundle عمومی اصلی حدود ۲۴۲ KB خام / ۷۷ KB gzip و chunk مدل‌ها حدود ۵۶۶ KB خام / ۱۴۲ KB gzip است. shader بزرگ‌تر از آستانهٔ هشدار Vite است؛ روی سخت‌افزار کاربر نیازمند benchmark بیشتر است. دسترسی ناشناس به preview E2B، 403 نیازمند traffic-token بود؛ آن آدرس عمومیِ بدون ورود نیست. در static server محدود، مسیرهای panel/adminpanel/shop/adminshop/api/source/release همگی 404 بودند. نتیجهٔ deploy خارجی از report جدا بررسی می‌شود.
