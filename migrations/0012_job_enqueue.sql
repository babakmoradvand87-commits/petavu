-- ============================================================================
-- 0012_job_enqueue — درخواست کار از سمت برنامه
--
-- چرا این تابع لازم شد: جدول `ops.job` عمداً هیچ گرنت درج برای `pv_app` ندارد.
-- کار، دارایی کارگر است؛ اگر برنامهٔ وب می‌توانست مستقیم در صف بنویسد، مرز
-- بین «درخواست» و «اجرا» از بین می‌رفت و هر آسیب‌پذیری در API به نوشتن در صف
-- تبدیل می‌شد. از طرف دیگر، رفتار درست این است که رویداد دامنه ثبت شود و
-- قاعده‌ها (که سرور اجرا می‌کند) کار بسازند.
--
-- این تابع، مسیر کنترل‌شدهٔ همان کار است: با `security definer` کار می‌سازد،
-- ولی **اول مجوز را می‌سنجد** و برای کار سراسری، مجوز پلتفرمی می‌خواهد.
-- مرجع: §14 (رد پیش‌فرض)، §57 (صف/Outbox)، Addendum §56–۷۲
-- ============================================================================

create or replace function ops.enqueue_job(
  p_kind text,
  p_payload jsonb default '{}'::jsonb,
  p_business_id uuid default null,
  p_priority integer default 100,
  p_run_at timestamptz default null,
  p_dedupe_key text default null
)
returns ops.job
language plpgsql
security definer
set search_path = pg_catalog, ops, app
as $$
declare
  v_job ops.job;
  v_key text := nullif(btrim(coalesce(p_dedupe_key, '')), '');
begin
  if p_kind is null or position('.' in p_kind) <= 1 then
    raise exception 'نوع کار باید «نام‌فضا.کار» باشد، نه %', p_kind
      using errcode = 'check_violation';
  end if;

  /*
   * مرز مجوز. کار سراسری (بدون کسب‌وکار) فقط برای کارکنان پلتفرم؛ کار
   * کسب‌وکاری، برای کسی که در آن کسب‌وکار اجازهٔ ویرایش دارد.
   */
  if p_business_id is null then
    if not app.has_platform_permission('platform.job.manage') then
      raise exception 'ثبت کار سراسری به مجوز پلتفرمی نیاز دارد'
        using errcode = 'insufficient_privilege';
    end if;
  elsif not (app.has_permission(p_business_id, 'business.update') or app.current_platform_role() is not null) then
    raise exception 'ثبت کار برای این کسب‌وکار مجاز نیست'
      using errcode = 'insufficient_privilege';
  end if;

  /*
   * یکتایی `dedupe_key` جزئی است: فقط روی کارهای «در انتظار یا در اجرا».
   * پس اگر کار فعالی با همین کلید باشد، همان برگردانده می‌شود — «همان کار»،
   * نه «کار تازه». این تعریف، هم از دوباره‌کاری جلوگیری می‌کند و هم اجازه
   * می‌دهد پس از تمام‌شدن کار، همان کلید دوباره به کار برود.
   */
  insert into ops.job (kind, payload, business_id, priority, available_at, dedupe_key, request_id)
  values (
    p_kind,
    coalesce(p_payload, '{}'::jsonb),
    p_business_id,
    greatest(0, least(coalesce(p_priority, 100), 1000)),
    coalesce(p_run_at, now()),
    v_key,
    nullif(current_setting('app.request_id', true), '')
  )
  on conflict (dedupe_key) where (dedupe_key is not null and status in ('pending', 'running')) do nothing
  returning * into v_job;

  if not found then
    select j.* into v_job
    from ops.job j
    where j.dedupe_key = v_key and j.status in ('pending', 'running')
    order by j.created_at desc
    limit 1;

    if not found then
      raise exception 'کار ثبت نشد' using errcode = 'internal_error';
    end if;
  end if;

  return v_job;
end
$$;

comment on function ops.enqueue_job is
  'ثبت کار در صف با کنترل مجوز و کلید یکتای فعال (Addendum §56–۷۲)';

revoke all on function ops.enqueue_job(text, jsonb, uuid, integer, timestamptz, text) from public;
grant execute on function ops.enqueue_job(text, jsonb, uuid, integer, timestamptz, text) to pv_app, pv_worker;
