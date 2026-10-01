# مبنای امنیت و حفاظت دادهٔ PETAVU

نسخهٔ ۰٫۱ — ۲۰۲۶-۱۰-۰۱. وضعیت: استاندارد پذیرش و کنترل‌های پایه؛ **نه گزارش تست نفوذ و نه گواهی امنیت production**.

## ۱. منابع و سطح هدف

OWASP ASVS 5.0.0 مبنای اصلی کنترل و آزمون است، نه صرفاً فهرست OWASP Top 10. هدف پیشنهادی محصول عملیاتی سطح ۲ است؛ برای پنل مدیر، مدیریت secrets، عملیات مخرب و بازیابی، کنترل‌های منتخبِ سخت‌گیرانه‌تر نیز لازم‌اند. منبع رسمی، 5.0.0 را نسخهٔ پایدار معرفی می‌کند. [2](https://owasp.org/www-project-application-security-verification-standard)

برای احراز هویت، NIST SP 800-63B-4 مبنای تکمیلی است. اگر رمز عبور تنها عامل باشد، حداقل ۱۵ کاراکتر؛ پشتیبانی از رمزهای طولانی و password manager، بدون قانون ترکیب بی‌دلیل یا تغییر دوره‌ایِ اجباری. مدیران باید MFA و گزینهٔ مقاوم به phishing داشته باشند؛ تنظیم نهایی با ریسک و ارائه‌دهندهٔ Auth تطبیق داده می‌شود. [1](https://pages.nist.gov/800-63-4/sp800-63b/authenticators/) [3](https://pages.nist.gov/800-63-4/sp800-63b/customer/)

این سند جای مطالعه و verification کامل ASVS را نمی‌گیرد. کنترل‌ها باید با شناسه‌های دقیق نسخهٔ ثابت استاندارد در backlog امنیتی پیاده‌سازی و evidence جمع شوند.

## ۲. دارایی‌ها و تهدیدها

دارایی‌ها: هویت اعضا، مدارک حرفه‌ای، تماس خصوصی، روابط tenantها، محتوا، ویترین، اختیار مدیر، کلیدها، بکاپ و اعتبار برند.

| تهدید | کنترل پذیرش |
|---|---|
| عبور عضو از مرز کسب‌وکار دیگر / IDOR | مجوز object-level در API + RLS + تست منفی چند tenant |
| انتخاب دستهٔ دامپزشکی برای گرفتن privilege | business category جدا از membership و staff capability؛ بررسی مدارک مستقل |
| تصاحب جلسه/مدیر | host-only cookies، MFA، reauthentication عملیات حساس، محدودیت زمان و audit |
| XSS / محتوای آلودهٔ CMS | نمایش متنی امن، sanitization محتوای rich-text با allowlist، CSP؛ no raw HTML |
| CSRF و سوءاستفاده میان ساب‌دامین‌ها | کنترل Origin/CSRF، بدون cookie با Domain مشترک؛ SameSite به‌تنهایی کافی نیست |
| فایل مخرب / افشای مدارک | قرنطینه، MIME واقعی، اسکن، اندازه محدود، storage خصوصی و signed URL کوتاه‌مدت |
| SQL injection / mass assignment | query پارامتری، schema validation، field allowlist، قیود و role حداقلی |
| افشای secret در چت/لاگ/build | مخزن اسرار بیرونی، redaction و scan، rotate/revoke؛ بدون secret در frontend |
| شرکت یا مدرک جعلی / تقلب | هویت verified فقط از فرایند بازبینی؛ گزارش تخلف و وضعیت واضح؛ بدون تأیید خودکار |
| خرابی بکاپ / حذف عمدی / گم‌شدن کلید | کپی مستقل immutable، دسترسی جدا، escrow کلید و restore drill |
| اختلال عرضهٔ dependency یا CI | lockfile، review، scan، حداقل permissions، runner مورداعتماد و pin digest |

## ۳. احراز هویت و جلسه

طرح production:
- OIDC/PKCE یا سرویس Auth معتبر از طریق BFF؛ بررسی issuer، audience، signature، expiry و nonce/state.
- sessionها سمت سرور و قابل ابطال؛ tokenهای طولانی و refresh token به localStorage مرورگر سپرده نشوند.
- cookie هر فضا: `__Host-petavu-<scope>`، Secure، HttpOnly، Path=/، بدون Domain؛ SameSite مناسب flow همراه CSRF/Origin checking.
- cookie یا staff access میان panel/adminpanel/shop/adminshop خودکار به اشتراک گذاشته نشود. SSO آینده فقط از طریق exchange مجاز و کوتاه‌مدت.
- تغییر ایمیل/رمز/MFA، اعطای نقش، بازیابی حساب و export مدارک: احراز دوباره، اعلان و audit.
- خطای عمومی ورود برای جلوگیری از user enumeration؛ rate limit بر IP و حساب، anti-abuse متناسب و حفظ دسترس‌پذیری.
- انتخاب نقش کسب‌وکار و کنترل‌های frontend قابل اعتماد نیستند؛ هر درخواست باید سمت سرور authorize شود.
- نخستین مدیر از مسیر bootstrap خارج از ثبت‌نام عمومی و با تأیید مالک ساخته شود. هیچ کاربر تازه به‌طور پیش‌فرض staff نیست.

**وضعیت:** این backend/session flow هنوز پیاده‌سازی نشده است. فرم فعلی رمز دریافت نمی‌کند؛ داده‌های نمونه فقط در sessionStorage این مرورگرند و هیچ session واقعی ایجاد نمی‌شود. static server `/api/*` را 503 می‌کند.

## ۴. مجوز و دیتابیس

- deny-by-default، سرویس‌های site-admin و shop-admin جدا، بدون SUPERUSER/BYPASSRLS در runtime.
- نقش‌های SQL این بسته NOLOGIN هستند؛ credentialهای واقعی از Secret Manager و خارج migration ساخته می‌شوند.
- تغییر وضعیت verification و membership از نوشتن پروفایل معمولی جداست. عضو حق تغییر status و grant کردن staff capability ندارد.
- `identity.current_actor_id()` از context transaction مورداعتماد می‌خواند. به اتصال مستقیم کاربر یا claim ورودیِ بررسی‌نشده اعتماد نکن.
- connection pool باید context را داخل transaction تنظیم و پاک کند؛ از SET سراسری روی connection pooled برای production استفاده نشود.
- ۱۱ آزمون محلی migration/RLS اجراشدنی در `tests/database.mjs` موجود است؛ آزمون با PGlite است، نه پروژهٔ Supabase واقعی، backend یا شبکه.
- audit برای نقش‌های runtime append-only است؛ ادمین دیتابیس هنوز می‌تواند آن را دستکاری کند. برای مقاومت به tampering، export مستقل و integrity checking لازم است.

## ۵. داده و privacy

- حداقل‌سازی: پروفایل حرفه‌ای عمومی جدا از تماس خصوصی و مدارک؛ انتشار opt-in و پس از بررسی.
- در لاگ، رمز، token، session cookie، تصویر مدرک، SQL حاوی اطلاعات شخصی، بدنهٔ خام و dump محیط ممنوع.
- اطلاعات حساس transit با TLS و at-rest با قابلیت سرویس ذخیره‌سازی رمز شود؛ کلیدها در secret/KMS جدا.
- retention باید با بازار و تعهد حقوقی نهایی شود. حذف حساب نیازمند retention/بکاپ و export قابل‌فهم است؛ hard-delete کورکورانه روی رابطه‌های مالی/مدارک ممنوع.
- secretهای جدید نباید در چت، Git، `.env` این workspace، URL یا fixture قرار گیرند. `.gitignore` vault یا رمزنگاری نیست.
- متن privacy/terms UI فعلی پیش‌نویس است؛ مبنای حقوقی داده، jurisdiction و سیاست مدارک هنوز نهایی نیست.

## ۶. frontend و زیرساخت

پیاده‌سازی پایهٔ static server: CSP با script-src self و object-src none، X-Content-Type-Options، Referrer-Policy، Permissions-Policy، منع iframe در production و HSTS فقط با تأیید HTTPS at edge. برای styleهای پویا `unsafe-inline` فقط در style-src نگه داشته شده؛ script-src unsafe-inline/eval ندارد. CSP کامل backend و nonce لازم باید در استقرار واقعی بازبینی شوند.

preview توسعه با Vite است و این کنترل‌های production را ندارد؛ allowlist میزبان بازِ dev برای محیط preview است و نباید dev server در production منتشر شود. منابع بصری و فونت‌ها محلی‌اند؛ frontend secret ندارد.

CI: PRها بدون اسرار production تست شوند. pull_request_target نباید کد PR نامطمئن را با secrets اجرا کند. deploy از commit مشخص شاخهٔ محافظت‌شده، پس از review و approval جدا؛ مهاجرت مخرب یا restore صرفاً با تأیید آگاهانهٔ مالک.

## ۷. وضعیت evidence

| حوزه | در این بسته | برای راه‌اندازی باقی مانده |
|---|---|---|
| UI، RTL، کاهش حرکت | اجرایی + تست مرورگر | تست کاربر واقعی و بازبینی accessibility تکمیلی |
| schema و tenant RLS | migrations + تست محلی | staging واقعی، نقش‌ها، API transaction context |
| پنل‌های مدیر | mock read-only با برچسب | auth/MFA، policyهای backend و bootstrap مدیر |
| headers | static server و Docker | TLS edge، بررسی CSP/CORS، BFF |
| secrets | فقط نام متغیر/قالب | vault واقعی، rotation و دسترسی حداقلی |
| backup | اسکریپت و manifest/runbook | scheduler، storage مستقل، PITR و restore واقعی |
| ASVS | استاندارد هدف و threat model | verification کامل، evidence و تست نفوذ مستقل |

## ۸. گیت انتشار واقعی

بدون گذر از این موارد، محیط production فعال نشود: دسترسی چند tenant و نقش مدیر، MFA/بازیابی/ابطال جلسه، CSRF و CORS، تست upload، scan dependency/secret، backup + restore آزموده‌شده، مانیتورینگ و پاسخ حادثه، privacy نهایی، endpoint و billing constraints، تنظیم TLS/DNS، و review کامل migration روی staging.

در رخداد افشای secret: revoke/rotate، بررسی استفاده و audit، قطع جلسه‌های مرتبط، به‌روزرسانی vault و deploy. حذف متن افشاشده به‌تنهایی credential را باطل نمی‌کند.

## افزودهٔ انتشار ۰٫۲

صفحهٔ عمومی build و server مستقل دارد؛ پنل‌ها/فرم‌ها/API با CSS پنهان نشده‌اند، بلکه اصلاً در entry عمومی نیستند. static server عمومی فقط مسیر root و assetهای allowlist را پاسخ می‌دهد. در این صفحهٔ بدون عملیات حساس، embedding برای preview مجاز است؛ منع iframe برای پنل‌های عملیاتی همچنان لازم است. پیش‌نمایش E2B خود token پلتفرم می‌خواهد؛ این token نباید برای ساخت لینک عمومی افشا یا محافظت کل sandbox غیرفعال شود. انتشار عمومی روی میزبانی مجزا، با تنها artifact معرفی انجام می‌شود. استفادهٔ GitHub موقت و با اجازهٔ مالک است؛ secrets روی سرور/فایل/URL ذخیره نمی‌شوند. دیتابیس هیچ تغییری نکرده است.
