/**
 * ۰۰۱۳ — فهرست تیم (§17، §25–۲۸).
 *
 * یافتهٔ واقعی از تست Repositoryها: «فهرست اعضا» عملاً کار نمی‌کرد، ولی نه به
 * دلیل کد — به دلیل دو سیاست RLS:
 *
 *   ۱) `app.membership` فقط ردیف *خودِ کاربر* را به او می‌داد (یا همه را، اگر
 *      مجوز مدیریت اعضا داشت). پس عضو عادی، هم‌تیمی‌هایش را نمی‌دید.
 *   ۲) `auth.app_user` فقط ردیف *خودِ کاربر* را می‌داد؛ پس حتی وقتی عضویت
 *      دیده می‌شد، نامِ هم‌تیمی از JOIN بیرون می‌افتاد.
 *
 * تصمیم معماری: دیدن «چه کسی در تیم است» حق هر عضو است — نه یک مجوز ویژه.
 * ولی این حق دو حصار دارد:
 *
 *   • فقط عضویت‌های *کسب‌وکارهایی که خودت عضوی از آن‌ها هستی*.
 *   • از پروفایل کاربران دیگر، فقط همان چیزی که فهرست تیم لازم دارد
 *     (`display_name` و مانند آن)؛ `auth.identity` — ایمیل و تلفن — کاملاً
 *     دست‌نخورده و خودی می‌ماند.
 *
 * هیچ‌کدام از دو سیاست، دسترسی «همه به همه» نمی‌دهد: شرط، اشتراک کسب‌وکار
 * فعال است. مدیریت اعضا (تغییر نقش، حذف) همچنان مجوز `business.member.manage`
 * می‌خواهد — این مهاجرت فقط «دیدن» را باز می‌کند.
 */

-- --------------------------------------------------------------- عضویت‌ها
/*
 * `is_member_of` خودش تعریف‌گر است، پس داخل سیاست بدون بازگشت RLS کار می‌کند.
 * شرط «business_id همان کسب‌وکار» عمدی است: با این سیاست، یک عضو می‌تواند
 * ببیند *چه کسانی* در تیمش هستند، نه اینکه در کدام کسب‌وکارهای دیگر کسی
 * عضویت دارد.
 */
create policy membership_member_read on app.membership
  for select to pv_app, pv_worker
  using (app.is_member_of(business_id));

comment on policy membership_member_read on app.membership is
  'هر عضو، عضویت‌های کسب‌وکار خودش را می‌بیند (§17)';

-- ------------------------------------------------- پروفایل پایهٔ کاربران تیم
/*
 * `auth.app_user` جدول «هویت» است، ولی برخلاف `auth.identity` دادهٔ تماس در آن
 * نیست: نام نمایشی، زبان و منطقه. اشتراک کسب‌وکار فعال، همان چیزی است که
 * «کسی که باید در فهرست تیم ببینم» را تعریف می‌کند.
 *
 * کارکنان پلتفرم از مسیر خودشان (سیاست `app_user_self_select`) دسترسی دارند.
 */
create policy app_user_directory_read on auth.app_user
  for select to pv_app, pv_worker
  using (
    id = app.current_user_id()
    or app.current_platform_role() is not null
    or exists (
      select 1
      from app.membership theirs
      where theirs.user_id = auth.app_user.id
        and theirs.status = 'active'
        and theirs.deleted_at is null
        and app.is_member_of(theirs.business_id)
    )
  );

comment on policy app_user_directory_read on auth.app_user is
  'نام هم‌تیمی‌ها برای فهرست اعضا؛ نه دادهٔ تماس، نه هویت دیگران (§17)';

-- ------------------------------------------------------------------ گرنت‌ها
/*
 * سیاست بدون گرنت اثری ندارد. گرنت‌های انتخاب روی این دو جدول از پیش به
 * `pv_app`/`pv_worker` داده شده‌اند؛ این بلوک فقط *صریح* می‌کند که این مهاجرت
 * به آن‌ها تکیه دارد، تا اگر روزی گرنتی برداشته شد، اینجا معلوم باشد.
 */
grant select on app.membership to pv_app, pv_worker;
grant select on auth.app_user to pv_app, pv_worker;
