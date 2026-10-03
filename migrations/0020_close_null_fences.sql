/*
 * گام ۲۶ — بستن دو «حصار تهی» در سیاست‌های RLS (§14، §54–۵۵، §142، §191).
 *
 * هنگام وصل‌کردن robots به تنظیمات (`platform.robots` در `ops.setting`)
 * پیدا شد که تنظیمات سراسری **برای هر کاربر عادی نوشتنی است**. اجرای واقعی:
 *
 *     -- کاربر عادی؛ بدون نقش پلتفرمی؛ بدون کسب‌وکار فعال
 *     update ops.setting set value = '{"hacked":true}' where key = 'platform.robots';
 *     --> UPDATE 1
 *     insert into ops.setting (business_id, key, value) values (null, 'attacker.key', '{}');
 *     --> INSERT 0 1
 *
 * ریشه: سیاست `setting_business_all` شرطش را این‌طور نوشته بود
 *
 *     NOT (business_id IS DISTINCT FROM app.current_business_id())
 *
 * یعنی «برابر، با برابری تهی-امن». وقتی زمینهٔ کسب‌وکار **تهی** است (کاربر هنوز
 * کسب‌وکاری انتخاب نکرده)، ردیف‌های سراسری (`business_id` تهی) هم «برابر»
 * حساب می‌شوند و سیاست — که `for all` است — خواندن و نوشتنشان را باز می‌کند.
 * تنظیمات سراسری شامل `platform.security`، `platform.robots` و
 * `platform.rate_limit` است.
 *
 * چرا هیچ آزمونی نگرفتش: قرارداد «سیاستِ pv_app به مستأجر یا کاربر گره خورده»
 * فقط **وجود** `current_business_id()` در متن سیاست را می‌دید، نه رفتارش در
 * حالت تهی را. حالا هم رفتار آزموده می‌شود، هم الگو (آزمون پوشش).
 *
 * سه رخنهٔ هم‌ریشه در همین جدول و یک جدول دیگر بسته می‌شود:
 *
 *   ۱) `ops.setting` — نوشتن تنظیم سراسری بی‌هیچ مجوز (بالا).
 *   ۲) `ops.setting` — **خواندن تنظیم سرّی** (`is_secret`) توسط بی‌نام:
 *      `setting_global_read` برای `pv_public` فقط `business_id is null` می‌گفت.
 *      الان تنظیم سرّی نیست، پس نشتی رخ نداده؛ ولی اولین کلید IndexNow یا
 *      توکن سرویس ثالثی که این‌جا بنشیند، برای هر بازدیدکننده خواندنی می‌شد.
 *   ۳) `ops.idempotency_key` — همان الگو: بدون زمینهٔ کسب‌وکار، کلیدهای
 *      **همهٔ کاربران** (با `response` ذخیره‌شده) خواندنی و نوشتنی بود. هنوز
 *      هیچ کدی از این جدول استفاده نمی‌کند، پس نشتی بالقوه است، نه رخ‌داده.
 *
 * اصل اصلاح: **سیاست به «چه کسی» و «چه چیزی» می‌پردازد، نه به برابریِ تهی.**
 *   • ردیف سراسری هرگز با زمینهٔ کسب‌وکار سنجیده نمی‌شود (`business_id is not null`).
 *   • نوشتن تنظیم سراسری = مجوز پلتفرمی `platform.settings.manage`.
 *   • تنظیم سرّی = مجوز صریح (کسب‌وکار: `business.integration.manage`؛ پلتفرم: همان
 *     مجوز تنظیمات). بی‌نام و عضو عادی هرگز نمی‌خوانند.
 *   • کلید ایدمپوتنسی = متعلق به **کنشگر** و زمینهٔ همان درخواست.
 *
 * «یک سیاست = یک دستور» (ADR-0005): `for all` شکسته می‌شود تا هر دستور شرط
 * خودش را داشته باشد و خواندن با نوشتن اشتباه نشود.
 */

-- ------------------------------------------------------------------ ۱) ops.setting

drop policy if exists setting_business_all on ops.setting;
drop policy if exists setting_global_read on ops.setting;
drop policy if exists setting_staff_all on ops.setting;

-- تنظیم سراسری **غیرسرّی**: برای همه خواندنی (برند، robots، حافظهٔ نهان…).
create policy setting_global_read on ops.setting
  for select to pv_app, pv_public
  using (business_id is null and not is_secret);

-- تنظیم کسب‌وکار: اعضا می‌خوانند؛ سرّی‌اش فقط با مجوز یکپارچه‌سازی.
create policy setting_business_select on ops.setting
  for select to pv_app
  using (
    business_id is not null
    and business_id = app.current_business_id()
    and app.is_member_of(business_id)
    and (not is_secret or app.has_permission(business_id, 'business.integration.manage'))
  );

create policy setting_business_insert on ops.setting
  for insert to pv_app
  with check (
    business_id is not null
    and business_id = app.current_business_id()
    and app.has_permission(business_id, case when is_secret then 'business.integration.manage' else 'business.update' end)
  );

create policy setting_business_update on ops.setting
  for update to pv_app
  using (
    business_id is not null
    and business_id = app.current_business_id()
    and app.has_permission(business_id, case when is_secret then 'business.integration.manage' else 'business.update' end)
  )
  with check (
    business_id is not null
    and business_id = app.current_business_id()
    and app.has_permission(business_id, case when is_secret then 'business.integration.manage' else 'business.update' end)
  );

create policy setting_business_delete on ops.setting
  for delete to pv_app
  using (
    business_id is not null
    and business_id = app.current_business_id()
    and app.has_permission(business_id, case when is_secret then 'business.integration.manage' else 'business.update' end)
  );

-- کارکنان: هر نقش پلتفرمی می‌خواند، ولی سرّی و هر نوشتنی مجوز تنظیمات می‌خواهد.
create policy setting_staff_select on ops.setting
  for select to pv_app, pv_worker
  using (
    app.current_platform_role() is not null
    and (not is_secret or app.has_platform_permission('platform.settings.manage'))
  );

create policy setting_staff_insert on ops.setting
  for insert to pv_app, pv_worker
  with check (app.has_platform_permission('platform.settings.manage'));

create policy setting_staff_update on ops.setting
  for update to pv_app, pv_worker
  using (app.has_platform_permission('platform.settings.manage'))
  with check (app.has_platform_permission('platform.settings.manage'));

-- کارگر گرنت `delete` ندارد؛ سیاستِ بی‌گرنت مرده است (قرارداد پوشش).
create policy setting_staff_delete on ops.setting
  for delete to pv_app
  using (app.has_platform_permission('platform.settings.manage'));

-- ------------------------------------------------------------------ ۲) ops.idempotency_key

drop policy if exists idempotency_app_all on ops.idempotency_key;

/*
 * کلید ایدمپوتنسی را فقط «کنشگری که ساخته» و فقط در همان زمینهٔ کسب‌وکار
 * می‌بیند. `actor_id` تهی ⇒ هیچ‌کس (ردیف بی‌صاحب، قابل‌ادعا نیست).
 */
create policy idempotency_app_select on ops.idempotency_key
  for select to pv_app
  using (
    actor_id is not null
    and actor_id = app.current_user_id()
    and business_id is not distinct from app.current_business_id()
  );

create policy idempotency_app_insert on ops.idempotency_key
  for insert to pv_app
  with check (
    actor_id is not null
    and actor_id = app.current_user_id()
    and business_id is not distinct from app.current_business_id()
  );

create policy idempotency_app_update on ops.idempotency_key
  for update to pv_app
  using (
    actor_id is not null
    and actor_id = app.current_user_id()
    and business_id is not distinct from app.current_business_id()
  )
  with check (
    actor_id is not null
    and actor_id = app.current_user_id()
    and business_id is not distinct from app.current_business_id()
  );

create policy idempotency_app_delete on ops.idempotency_key
  for delete to pv_app
  using (
    actor_id is not null
    and actor_id = app.current_user_id()
    and business_id is not distinct from app.current_business_id()
  );
