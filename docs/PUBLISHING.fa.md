# انتشار عمومی و خصوصی PETAVU — نسخهٔ ۰٫۲

## تصمیم مالک

لینک عمومی فقط صفحهٔ «به‌زودی» را ارائه کند. هیچ پنل اعضا، مدیریت، ویترین، فرم عضویت یا API نباید از لینک عمومی در دسترس باشد. سایت کامل و هر چهار محیط بازطراحی شده‌اند، اما جداگانه و برای بازبینی مالک نگهداری می‌شوند.

## سه محیط متفاوت

۱. **پیش‌نمایش Arena/E2B:** محیط فعلی نیازمند traffic access token پلتفرم است. تست ناشناس پاسخ 403 داد؛ این URL عمومیِ بدون ورود نیست. token پلتفرم هرگز برای رفع این محدودیت منتشر نشود.
۲. **انتشار عمومی:** فقط artifact ساخته‌شده با `npm run build:public`. مسیر GitHub Pages برای انتشار موقت صفحهٔ معرفی، بدون پرداخت/حساب و بدون ارتقای پولی استفاده می‌شود. این انتخاب برای خودِ سرویس B2B عملیاتی نیست؛ هاست نهایی جدا تعیین می‌شود.
۳. **کد و پیش‌نمایش کامل:** مخزن خصوصی و شاخهٔ بازبینی، به همراه HTML خودبسندهٔ owner preview. frontend پنل‌ها هنوز fixture است؛ backend Auth/Supabase واقعی فعال نیست.

مقصدهای این مرحله: مخزن خصوصی `petavu` و مخزن artifact عمومی `petavu-coming-soon` در حساب GitHub مجاز مالک. نتیجهٔ واقعی، URLها و commitها در `release/deployment.json` ثبت می‌شود؛ این سند به‌تنهایی اثبات موفقیت deploy نیست.

## artifact عمومی

فقط index، chunkهای JS/CSS عمومی، فونت‌های محلی و مجوزها، لوگو و تصویر fallback. entry عمومی `src/public-main.tsx`، نه `src/main.tsx`. فایل‌های App، پنل، SQL، قرارداد API، `.env`، scriptهای مدیریت و preview کامل وارد artifact عمومی نمی‌شوند. منابع با base نسبی ساخته می‌شوند تا هم روی subpath GitHub Pages و هم روی دامنهٔ مستقل کار کنند.

static server عمومی فقط root و assetهای صریح allowlist را پاسخ می‌دهد؛ panel/adminpanel/shop/adminshop/api/source/release ناشناس 404 هستند. GitHub Pages نیز فقط همان فایل‌های عمومی را دارد و SPA fallback به پنل وجود ندارد. مسیرهای عمومی هرگز از query parameter، iframe یا storage به محیط مدیریتی تغییر نکنند.

## Push و بازبینی

کل source روی شاخهٔ `agent/scroll-3d-redesign` در مخزن خصوصی قرار می‌گیرد و PR پیش‌نویس برای بازبینی آماده می‌شود؛ merge خودکار به main انجام نشود. CI در قالب `ci.yml.example` است تا پیش از بازبینی بودجه/permissions/runner خودکار اجرا نشود. active کردن آن تصمیم جداست.

اعتبارنامهٔ GitHub تنها با درخواست صریح مالک، در حافظه/متغیر محیطی موقت job و header HTTPS استفاده می‌شود؛ نه فایل، URL، artifact، git config یا log. استفادهٔ موقت، خزانهٔ دائمی یا تضمین دسترسی آینده نیست. Secret Manager و token محدود/چرخش همچنان برای ادامهٔ کار لازم‌اند. Supabase و دیتابیس برای این صفحه استفاده نمی‌شوند.

## انتقال و دامنهٔ آینده

`release/PETAVU-public-site.zip` شامل کل artifact عمومی است؛ می‌توان آن را به هاست مستقل منتقل کرد. نسخهٔ source، lockfile، مدل‌های procedural، فونت/مجوز، migration و مستندات نیز حفظ می‌شوند. backup طرح پیشین در `design-history/PETAVU-v0.1.zip` است؛ این archive بکاپ DB واقعی نیست.

پس از دریافت دامنه: مالکیت DNS، مقصد میزبانی پایدار، HTTPS، redirect، canonical و noindex بازبینی شوند. دامنه مستقیماً به preview محافظت‌شدهٔ E2B وصل نشود. هیچ CNAME، redirect یا تغییر DNS بدون دامنه و تأیید مالک انجام نشده است.
