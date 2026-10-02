/**
 * ۰۰۱۴ — ثبت‌نام کاربر (§6–۷، §13).
 *
 * یافتهٔ دوم از تست Repositoryها: `identity.create` با خطای RLS می‌افتاد —
 * `new row violates row-level security policy for table "app_user"`.
 *
 * علت: `insert … returning` یک *خواندن* هم هست. سیاست خواندن `auth.app_user`
 * (`app_user_self_select`) فقط ردیف خودِ کاربر یا کارکنان پلتفرم را می‌دهد؛ و
 * در ثبت‌نام، کاربری هنوز وجود ندارد. پس نوشتن موفق می‌شد ولی «پس‌گرفتن ردیف»
 * رد می‌شد — و کل تراکنش می‌افتاد.
 *
 * درس معماری (همان که در `ops.enqueue_job` هم گرفتیم): وقتی هویت جاری اجازهٔ
 * خواندن نتیجه را ندارد، نوشتن باید از **تابع دامنه** بگذرد، نه اینکه حصار
 * RLS را سوراخ کنیم.
 *
 * قاعدهٔ دسترسی: ثبت‌نام فقط از نشست **بی‌نام** (مسیر عمومی) یا با نقش
 * پلتفرمی (پنل مدیریت). یک کاربر وارد‌شده نمی‌تواند با این تابع کاربر بسازد؛
 * وگرنه هر حساب می‌توانست حساب‌ها را زیاد کند.
 */

create or replace function app.register_user(
  p_display_name text,
  p_locale text default 'fa-IR',
  p_timezone text default 'Asia/Tehran'
)
returns auth.app_user
language plpgsql
security definer
set search_path = pg_catalog, app, auth
as $$
declare
  v_user auth.app_user;
begin
  if app.current_user_id() is not null and app.current_platform_role() is null then
    raise exception 'ثبت‌نام کاربر تازه از نشست وارد‌شده مجاز نیست'
      using errcode = 'insufficient_privilege';
  end if;

  if p_display_name is null or length(btrim(p_display_name)) < 2 then
    raise exception 'نام نمایشی باید دست‌کم دو نویسه باشد'
      using errcode = 'invalid_parameter_value';
  end if;

  insert into auth.app_user (display_name, locale, timezone, status)
  values (btrim(p_display_name), coalesce(nullif(btrim(p_locale), ''), 'fa-IR'),
          coalesce(nullif(btrim(p_timezone), ''), 'Asia/Tehran'), 'pending')
  returning * into v_user;

  return v_user;
end
$$;

comment on function app.register_user is
  'ثبت‌نام کاربر با وضعیت pending؛ فقط از نشست بی‌نام یا پنل پلتفرم (§6)';

revoke all on function app.register_user(text, text, text) from public;
grant execute on function app.register_user(text, text, text) to pv_app, pv_public, pv_worker;
