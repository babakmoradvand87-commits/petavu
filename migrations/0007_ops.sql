-- ============================================================================
-- 0007_ops — عملیات: صف کار، وبهوک، سقف نرخ پایدار، پشتیبان و نگهداشت داده
--
-- چرا این مهاجرت جدا از `0001_foundation` است: بنیان، «ستون فقرات» را ساخت
-- (حسابرسی، رخداد، صف، ایدمپوتنسی، تنظیمات، رخداد امنیتی، رجیستری فیچر).
-- اینجا رفتارهایی می‌آید که *کد* روی آن ستون‌ها می‌نشیند و باید در پایگاه‌داده
-- تحمیل شود، نه در انضباط برنامه‌نویس:
--
--   ۱. صف: ادعای اتمی کار و پایان‌دادن با پس‌رفت و صف مرده (§93، Addendum §56–72)
--   ۲. وبهوک: امضاشده، با تلاش دوباره و بازداری خودکار (§106–108)
--   ۳. سقف نرخ پایدار: چند نمونهٔ API، شمارندهٔ مشترک (§13)
--   ۴. پشتیبان و *تست بازیابی* — بدون آن، پشتیبان ادعاست نه تضمین (§88، §191)
--   ۵. نگهداشت داده: حذف نرم ≠ نگهداشت (§132، §101)
--
-- مرجع: §13، §24، §79، §88، §93–۹۴، §106–۱۰۸، §۱۳۲، §۱۴۶–۱۵۱، §۱۹۱؛
--       Addendum §56–72، §91–95
-- ============================================================================

-- ------------------------------------------------------------------ مجوز پلتفرم
-- تا امروز سیاست‌های کارکنان به «نقش پلتفرمی دارد؟» تکیه می‌کردند. این برای
-- *دیدن* کافی است، ولی برای *نوشتن* نه: نقش پشتیبانی نباید پشتیبان بگیرد یا
-- صف مرده را پاک کند. این تابع، تصمیم را به ماتریس مجوز پلتفرم می‌سپارد
-- (§16–۱۷، §142).
create or replace function app.has_platform_permission(p_permission_key text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, auth, app
as $$
  select exists (
    select 1
    from auth.platform_role_permission prp
    where prp.role_key = app.current_platform_role()
      and prp.permission_key = p_permission_key
  )
$$;

comment on function app.has_platform_permission is
  'آیا نقش پلتفرمی جاری، این مجوز را دارد؟ مبنای سیاست‌های نوشتن کارکنان (§142)';

revoke all on function app.has_platform_permission(text) from public;
grant execute on function app.has_platform_permission(text) to pv_app, pv_worker, pv_reader;

-- ------------------------------------------------------------------ صف: دفتر تلاش
-- صف (`ops.job`) می‌گوید «کار در چه وضعیتی است»؛ این جدول می‌گوید «هر تلاش چه
-- شد». بدون این، پرسش «چرا این کار مرده؟» جوابی ندارد (Addendum — Observability).
create table ops.job_attempt (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references ops.job (id) on delete cascade,
  attempt integer not null check (attempt > 0),
  outcome text not null check (outcome in ('succeeded', 'failed', 'dead')),
  worker text,
  error text,
  /** مدت اجرای همین تلاش؛ مبنای هشدار «کار کند شده» است. */
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  finished_at timestamptz not null default now()
);

comment on table ops.job_attempt is 'دفتر تلاش‌های صف؛ ورودی پایش و هشدار (Addendum §91–95)';

create index job_attempt_job_idx on ops.job_attempt (job_id, attempt desc);
create index job_attempt_failures_idx on ops.job_attempt (finished_at desc) where outcome <> 'succeeded';

-- دفتر تلاش، سابقه است: ویرایش و حذف ندارد.
create trigger job_attempt_append_only
  before update or delete on ops.job_attempt
  for each row execute function app.forbid_mutation();

alter table ops.job_attempt enable row level security;

create policy job_attempt_worker_all on ops.job_attempt
  for all to pv_worker
  using (true)
  with check (true);

create policy job_attempt_staff_select on ops.job_attempt
  for select to pv_app
  using (
    app.has_platform_permission('platform.job.manage')
    or app.has_platform_permission('platform.job.observe')
  );

create policy job_attempt_reader on ops.job_attempt
  for select to pv_reader
  using (true);

revoke all on ops.job_attempt from public;
grant select, insert on ops.job_attempt to pv_worker;
grant select on ops.job_attempt to pv_app, pv_reader;

-- ------------------------------------------------------------------ صف: ادعای کار
/**
 * برداشتن کار از صف، به‌صورت اتمی.
 *
 * `for update skip locked` یعنی دو کارگر موازی، هرگز یک کار را دو بار
 * برنمی‌دارند و هیچ‌کدام هم پشت قفل دیگری منتظر نمی‌ماند. `attempts` همان‌جا
 * یکی جلو می‌رود تا «چند بار تلاش شده» از خود صف خوانده شود، نه از یک شمارندهٔ
 * جداگانه که می‌تواند واگرا شود.
 */
create or replace function ops.claim_job(
  p_worker text,
  p_kinds text[] default null,
  p_limit integer default 1
)
returns setof ops.job
language sql
security definer
set search_path = pg_catalog, ops
as $$
  with candidate as (
    select id
    from ops.job
    where status = 'pending'
      and available_at <= now()
      and (p_kinds is null or kind = any (p_kinds))
    order by priority, available_at
    limit greatest(p_limit, 1)
    for update skip locked
  )
  update ops.job j
     set status = 'running',
         locked_by = p_worker,
         locked_at = now(),
         attempts = j.attempts + 1
    from candidate c
   where j.id = c.id
  returning j.*;
$$;

comment on function ops.claim_job is 'ادعای اتمی کار از صف با قفل ردیفی (§93، Addendum §56–72)';

/**
 * پایان‌دادن یک کار: موفق، یا ناموفق با پس‌رفت نمایی.
 *
 * پس‌رفت پیش‌فرض نمایی است (۳۰ ثانیه، ۱ دقیقه، ۲ دقیقه، … تا سقف ۱ ساعت) و
 * پس از `max_attempts` کار به وضعیت `dead` می‌رود — نه اینکه بی‌نهایت بچرخد.
 * هر تلاش، در دفتر `ops.job_attempt` ثبت می‌شود.
 */
create or replace function ops.finish_job(
  p_job_id uuid,
  p_succeeded boolean,
  p_error text default null,
  p_retry_after_seconds integer default null
)
returns ops.job
language plpgsql
security definer
set search_path = pg_catalog, ops
as $$
declare
  v_job ops.job;
  v_backoff integer;
  v_outcome text;
  v_worker text;
  v_locked_at timestamptz;
begin
  select * into v_job from ops.job where id = p_job_id for update;

  if not found then
    raise exception 'کار % پیدا نشد', p_job_id using errcode = 'no_data_found';
  end if;

  /*
   * کارگر و زمان قفل را *پیش از* پایان‌دادن نگه می‌داریم: پایان‌دادن، همین دو
   * ستون را پاک می‌کند و اگر بعداً بخوانیم، دفتر تلاش ردیفی بی‌کارگر و
   * بی‌مدت می‌شود — و پرسش «کدام کارگر کند است؟» بی‌جواب می‌ماند.
   */
  v_worker := v_job.locked_by;
  v_locked_at := v_job.locked_at;

  if v_job.status <> 'running' then
    raise exception 'کار % در وضعیت «%» است و پایان‌پذیر نیست', p_job_id, v_job.status
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if p_succeeded then
    update ops.job
       set status = 'succeeded', finished_at = now(), locked_by = null, last_error = null
     where id = p_job_id
    returning * into v_job;
    v_outcome := 'succeeded';
  else
    v_backoff := coalesce(
      p_retry_after_seconds,
      least((30 * power(2, greatest(v_job.attempts - 1, 0)))::integer, 3600)
    );

    if v_job.attempts >= v_job.max_attempts then
      update ops.job
         set status = 'dead', finished_at = now(), locked_by = null, last_error = p_error
       where id = p_job_id
      returning * into v_job;
      v_outcome := 'dead';
    else
      update ops.job
         set status = 'pending',
             locked_by = null,
             locked_at = null,
             last_error = p_error,
             available_at = now() + make_interval(secs => v_backoff)
       where id = p_job_id
      returning * into v_job;
      v_outcome := 'failed';
    end if;
  end if;

  insert into ops.job_attempt (job_id, attempt, outcome, worker, error, duration_ms)
  values (
    p_job_id,
    v_job.attempts,
    v_outcome,
    v_worker,
    p_error,
    case
      when v_locked_at is null then null
      else greatest((extract(epoch from (now() - v_locked_at)) * 1000)::integer, 0)
    end
  );

  return v_job;
end
$$;

comment on function ops.finish_job is 'پایان کار با پس‌رفت نمایی و انتقال به صف مرده (§93)';

/**
 * بازگرداندن کارهای رهاشده به صف.
 *
 * اگر کارگری وسط کار از بین برود (ری‌استارت، مرگ فرایند، قطع اتصال)، کار در
 * وضعیت `running` می‌ماند و هیچ‌کس سراغش نمی‌رود. این تابع، کارهای «قفل‌شدهٔ
 * کهنه» را برمی‌گرداند: اگر سهمیهٔ تلاش تمام شده باشد، مرگ؛ وگرنه صف.
 *
 * این همان تفاوت «صف در پایگاه‌داده» با «صف در حافظه» است: حافظه با ری‌استارت
 * پاک می‌شود، ردیف نه (§93).
 */
create or replace function ops.reclaim_stale_jobs(
  p_timeout_seconds integer default 900,
  p_limit integer default 100
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, ops
as $$
declare
  v_job ops.job;
  v_reclaimed integer := 0;
begin
  for v_job in
    select * from ops.job
     where status = 'running'
       and locked_at < now() - make_interval(secs => greatest(p_timeout_seconds, 30))
     order by locked_at
     limit greatest(p_limit, 1)
     for update skip locked
  loop
    if v_job.attempts >= v_job.max_attempts then
      update ops.job
         set status = 'dead', finished_at = now(), locked_by = null,
             last_error = coalesce(last_error, 'کارگر ناپدید شد و سهمیهٔ تلاش تمام بود')
       where id = v_job.id;
      insert into ops.job_attempt (job_id, attempt, outcome, worker, error, duration_ms)
      values (v_job.id, v_job.attempts, 'dead', v_job.locked_by,
              'کارگر ناپدید شد و سهمیهٔ تلاش تمام بود',
              greatest((extract(epoch from (now() - v_job.locked_at)) * 1000)::integer, 0));
    else
      update ops.job
         set status = 'pending', locked_by = null, locked_at = null,
             last_error = coalesce(last_error, 'کارگر ناپدید شد؛ کار به صف برگشت')
       where id = v_job.id;
      insert into ops.job_attempt (job_id, attempt, outcome, worker, error, duration_ms)
      values (v_job.id, v_job.attempts, 'failed', v_job.locked_by,
              'کارگر ناپدید شد؛ کار به صف برگشت',
              greatest((extract(epoch from (now() - v_job.locked_at)) * 1000)::integer, 0));
    end if;

    v_reclaimed := v_reclaimed + 1;
  end loop;

  return v_reclaimed;
end
$$;

comment on function ops.reclaim_stale_jobs is 'بازگرداندن کارهای رهاشدهٔ کارگر به صف یا صف مرده (§93)';

/** تصویر سلامت صف، برای پایش و هشدار (Addendum §91–95). */
create or replace function ops.job_health()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, ops
as $$
  select jsonb_build_object(
    'pending', (select count(*) from ops.job where status = 'pending'),
    'running', (select count(*) from ops.job where status = 'running'),
    'failed', (select count(*) from ops.job where status = 'failed'),
    'dead', (select count(*) from ops.job where status = 'dead'),
    'succeeded', (select count(*) from ops.job where status = 'succeeded'),
    'oldest_pending_seconds', (
      select coalesce(floor(extract(epoch from (now() - min(available_at))))::integer, 0)
      from ops.job where status = 'pending'
    ),
    'longest_running_seconds', (
      select coalesce(floor(extract(epoch from (now() - min(locked_at))))::integer, 0)
      from ops.job where status = 'running'
    )
  )
$$;

comment on function ops.job_health is 'تصویر سلامت صف برای پایش (Addendum §91–95)';

revoke all on function ops.reclaim_stale_jobs(integer, integer) from public;
revoke all on function ops.claim_job(text, text[], integer) from public;
revoke all on function ops.finish_job(uuid, boolean, text, integer) from public;
revoke all on function ops.job_health() from public;

grant execute on function ops.claim_job(text, text[], integer) to pv_worker;
grant execute on function ops.reclaim_stale_jobs(integer, integer) to pv_worker;
grant execute on function ops.finish_job(uuid, boolean, text, integer) to pv_worker;
grant execute on function ops.job_health() to pv_worker, pv_app, pv_reader;

-- ------------------------------------------------------------------ وبهوک
-- راز امضا، *ذخیره نمی‌شود*: فقط ارجاعش به مخزن راز نگه داشته می‌شود (§79).
-- اگر خود راز اینجا می‌نشست، یک نسخهٔ پشتیبان لو رفته یعنی همهٔ امضاها لو.
create table ops.webhook_endpoint (
  id uuid primary key default gen_random_uuid(),
  /** endpoint سراسری پلتفرم (تهی) یا مختص کسب‌وکار. */
  business_id uuid references app.business (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_-]{1,60}$'),
  url text not null check (url ~ '^https://'),
  /** نام راز در مخزن راز؛ نه خود راز (§79). */
  secret_ref text not null,
  event_types text[] not null check (array_length(event_types, 1) >= 1),
  is_active boolean not null default true,
  timeout_ms integer not null default 5000 check (timeout_ms between 500 and 30000),
  max_attempts integer not null default 8 check (max_attempts between 1 and 100),
  /** پس از این شمار خطای پشت‌سرهم، endpoint خودکار خاموش می‌شود (§108). */
  disable_after_failures integer not null default 20 check (disable_after_failures between 3 and 1000),
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  disabled_at timestamptz,
  disabled_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint webhook_disabled_shape check ((disabled_at is null) = (disabled_reason is null))
);

comment on table ops.webhook_endpoint is 'مقصدهای وبهوک با راز ارجاعی، نه راز ذخیره‌شده (§79، §106–108)';

create unique index webhook_endpoint_key_idx
  on ops.webhook_endpoint (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), key);
create index webhook_endpoint_active_idx on ops.webhook_endpoint (is_active, disabled_at);

create trigger webhook_endpoint_touch
  before update on ops.webhook_endpoint
  for each row execute function app.touch();

create table ops.webhook_delivery (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references ops.webhook_endpoint (id) on delete cascade,
  event_id uuid not null references ops.event (id) on delete cascade,
  event_type text not null,
  business_id uuid,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'dead')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_status_code integer,
  last_error text,
  response_excerpt text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint webhook_delivery_finished_shape check ((status in ('succeeded', 'dead')) = (finished_at is not null))
);

comment on table ops.webhook_delivery is 'تلاش‌های تحویل وبهوک؛ با پس‌رفت و بازداری خودکار (§106–108)';

create index webhook_delivery_business_idx on ops.webhook_delivery (business_id, created_at desc) where business_id is not null;
create index webhook_endpoint_business_idx on ops.webhook_endpoint (business_id) where business_id is not null;
create unique index webhook_delivery_event_idx on ops.webhook_delivery (endpoint_id, event_id);
create index webhook_delivery_ready_idx on ops.webhook_delivery (next_attempt_at) where status in ('pending', 'failed');
create index webhook_delivery_endpoint_idx on ops.webhook_delivery (endpoint_id, created_at desc);

alter table ops.webhook_endpoint enable row level security;
alter table ops.webhook_delivery enable row level security;

-- کسب‌وکار: دیدن و ساخت endpoint با مجوز یکپارچه‌سازی.
create policy webhook_endpoint_member_all on ops.webhook_endpoint
  for all to pv_app
  using (business_id is not null and app.has_permission(business_id, 'business.integration.manage'))
  with check (business_id is not null and app.has_permission(business_id, 'business.integration.manage'));

create policy webhook_endpoint_staff_all on ops.webhook_endpoint
  for all to pv_app, pv_worker
  using (app.has_platform_permission('platform.settings.manage'))
  with check (app.has_platform_permission('platform.settings.manage'));

create policy webhook_endpoint_worker_all on ops.webhook_endpoint
  for all to pv_worker
  using (true)
  with check (true);

create policy webhook_delivery_member_select on ops.webhook_delivery
  for select to pv_app
  using (business_id is not null and app.has_permission(business_id, 'business.integration.manage'));

create policy webhook_delivery_staff_select on ops.webhook_delivery
  for select to pv_app
  using (app.has_platform_permission('platform.settings.manage'));

create policy webhook_delivery_worker_all on ops.webhook_delivery
  for all to pv_worker
  using (true)
  with check (true);

create policy webhook_delivery_reader on ops.webhook_delivery
  for select to pv_reader
  using (true);

revoke all on ops.webhook_endpoint, ops.webhook_delivery from public;
grant select, insert, update, delete on ops.webhook_endpoint to pv_app;
grant select, insert, update, delete on ops.webhook_delivery to pv_worker;
grant select on ops.webhook_delivery to pv_app, pv_reader;
grant select, insert, update on ops.webhook_endpoint to pv_worker;
grant select on ops.webhook_endpoint to pv_reader;

/**
 * پخش یک رخداد روی همهٔ مقصدهای مشترک.
 *
 * قاعدهٔ انتخاب مقصد: فعال باشد، خاموش نشده باشد، همان کسب‌وکار رخداد
 * (یا مقصد سراسری) باشد، و این نوع رخداد را مشترک شده باشد. یکتایی
 * `(endpoint_id, event_id)` تضمین می‌کند پخش دوباره، تحویل تکراری نسازد (§180).
 */
create or replace function ops.fan_out_webhook(p_event_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, ops
as $$
declare
  v_event ops.event;
  v_count integer;
begin
  select * into v_event from ops.event where id = p_event_id;

  if not found then
    raise exception 'رخداد % پیدا نشد', p_event_id using errcode = 'no_data_found';
  end if;

  insert into ops.webhook_delivery (endpoint_id, event_id, event_type, business_id, payload)
  select
    e.id,
    v_event.id,
    v_event.event_type,
    v_event.business_id,
    jsonb_build_object(
      'id', v_event.id,
      'type', v_event.event_type,
      'occurred_at', v_event.occurred_at,
      'entity', jsonb_build_object('type', v_event.entity_type, 'id', v_event.entity_id),
      'data', v_event.payload
    )
  from ops.webhook_endpoint e
  where e.is_active
    and e.disabled_at is null
    and (e.business_id is null or e.business_id = v_event.business_id)
    and v_event.event_type = any (e.event_types)
  on conflict (endpoint_id, event_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end
$$;

comment on function ops.fan_out_webhook is 'پخش رخداد روی مقصدهای وبهوک، ایدمپوتنت (§106، §180)';

/**
 * ثبت نتیجهٔ یک تحویل: موفق، یا ناموفق با پس‌رفت.
 *
 * خطاهای پشت‌سرهم، روی *خود مقصد* شمرده می‌شوند؛ چون مقصدی که سی بار پشت‌سرهم
 * شکست خورده، مشکلش با «تلاش بیشتر» حل نمی‌شود و باید خاموش شود تا صف را
 * اشغال نکند (§108). خاموش‌شدن، تصمیم داده است، نه یادداشت.
 */
create or replace function ops.record_webhook_result(
  p_delivery_id uuid,
  p_succeeded boolean,
  p_status_code integer default null,
  p_error text default null,
  p_retry_after_seconds integer default null,
  p_response_excerpt text default null
)
returns ops.webhook_delivery
language plpgsql
security definer
set search_path = pg_catalog, ops
as $$
declare
  v_delivery ops.webhook_delivery;
  v_endpoint ops.webhook_endpoint;
  v_backoff integer;
  v_failures integer;
begin
  select * into v_delivery from ops.webhook_delivery where id = p_delivery_id for update;

  if not found then
    raise exception 'تحویل % پیدا نشد', p_delivery_id using errcode = 'no_data_found';
  end if;

  if v_delivery.status in ('succeeded', 'dead') then
    raise exception 'تحویل % پیش‌تر بسته شده است (وضعیت «%»)', p_delivery_id, v_delivery.status
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  select * into v_endpoint from ops.webhook_endpoint where id = v_delivery.endpoint_id for update;

  if p_succeeded then
    update ops.webhook_delivery
       set status = 'succeeded',
           attempts = attempts + 1,
           finished_at = now(),
           last_status_code = p_status_code,
           last_error = null,
           response_excerpt = p_response_excerpt
     where id = p_delivery_id
    returning * into v_delivery;

    update ops.webhook_endpoint
       set consecutive_failures = 0,
           last_success_at = now()
     where id = v_delivery.endpoint_id;
  else
    v_backoff := coalesce(
      p_retry_after_seconds,
      least((30 * power(2, greatest(v_delivery.attempts, 0)))::integer, 3600)
    );

    if v_delivery.attempts + 1 >= v_endpoint.max_attempts then
      update ops.webhook_delivery
         set status = 'dead',
             attempts = attempts + 1,
             finished_at = now(),
             last_status_code = p_status_code,
             last_error = p_error,
             response_excerpt = p_response_excerpt
       where id = p_delivery_id
      returning * into v_delivery;
    else
      update ops.webhook_delivery
         set status = 'failed',
             attempts = attempts + 1,
             next_attempt_at = now() + make_interval(secs => v_backoff),
             last_status_code = p_status_code,
             last_error = p_error,
             response_excerpt = p_response_excerpt
       where id = p_delivery_id
      returning * into v_delivery;
    end if;

    update ops.webhook_endpoint
       set consecutive_failures = consecutive_failures + 1,
           last_failure_at = now()
     where id = v_delivery.endpoint_id
    returning consecutive_failures into v_failures;

    if v_failures >= v_endpoint.disable_after_failures then
      update ops.webhook_endpoint
         set disabled_at = now(),
             disabled_reason = format('پس از %s خطای پشت‌سرهم خاموش شد', v_failures)
       where id = v_delivery.endpoint_id and disabled_at is null;
    end if;
  end if;

  return v_delivery;
end
$$;

comment on function ops.record_webhook_result is 'ثبت نتیجهٔ تحویل وبهوک با پس‌رفت و بازداری خودکار مقصد (§106–108)';

revoke all on function ops.fan_out_webhook(uuid) from public;
revoke all on function ops.record_webhook_result(uuid, boolean, integer, text, integer, text) from public;
grant execute on function ops.fan_out_webhook(uuid) to pv_worker;
grant execute on function ops.record_webhook_result(uuid, boolean, integer, text, integer, text) to pv_worker;

-- ------------------------------------------------------------------ سقف نرخ پایدار
-- محدودکنندهٔ درون‌فرایندی `@petavu/security` برای یک نمونه کافی است؛ ولی وقتی
-- چند نمونهٔ API پشت بارمتعادل‌کننده باشند، شمارندهٔ درون‌حافظه یعنی هر نمونه
-- سهم خودش را می‌شمارد و سقف واقعی چند برابر می‌شود. پس پنجرهٔ شمارش، در
-- پایگاه‌داده می‌نشیند و اتمی مصرف می‌شود (§13).
create table ops.rate_limit_counter (
  subject_kind text not null check (subject_kind in ('ip', 'account', 'device', 'risk', 'route', 'webhook')),
  /** هش موضوع؛ هرگز خودِ شناسه (ایمیل، آی‌پی) ذخیره نمی‌شود. */
  subject_hash text not null check (length(subject_hash) between 8 and 128),
  window_seconds integer not null check (window_seconds between 1 and 86400),
  bucket_start timestamptz not null,
  counter integer not null default 0 check (counter >= 0),
  updated_at timestamptz not null default now(),
  primary key (subject_kind, subject_hash, window_seconds, bucket_start)
);

comment on table ops.rate_limit_counter is 'شمارندهٔ پنجرهٔ ثابت سقف نرخ، مشترک بین نمونه‌های API (§13)';

create index rate_limit_counter_stale_idx on ops.rate_limit_counter (bucket_start);

alter table ops.rate_limit_counter enable row level security;

create policy rate_limit_counter_worker_all on ops.rate_limit_counter
  for all to pv_worker
  using (true)
  with check (true);

create policy rate_limit_counter_staff_select on ops.rate_limit_counter
  for select to pv_app
  using (app.has_platform_permission('platform.security.manage'));

create policy rate_limit_counter_reader on ops.rate_limit_counter
  for select to pv_reader
  using (true);

revoke all on ops.rate_limit_counter from public;
grant select, insert, update, delete on ops.rate_limit_counter to pv_worker;
grant select on ops.rate_limit_counter to pv_app, pv_reader;

/**
 * مصرف یک واحد از سهمیهٔ یک موضوع در یک پنجرهٔ زمانی.
 *
 * مقدار برگشتی، *پاسخ* است نه نظر: `allowed` می‌گوید اجازه هست یا نه،
 * `remaining` چند تا مانده، و `reset_at` چه زمانی پنجره باز می‌شود — همان
 * چیزی که هدرهای `Retry-After` و `RateLimit-*` از آن ساخته می‌شوند.
 *
 * این تابع به `pv_public` هم داده می‌شود: سقف نرخ باید *پیش از* احراز هویت
 * هم کار کند، وگرنه صفحهٔ ورود بی‌سقف است. اما هیچ داده‌ای برنمی‌گرداند جز
 * شمارندهٔ همان موضوعی که پرسیده شده.
 */
create or replace function ops.consume_rate_limit(
  p_subject_kind text,
  p_subject_hash text,
  p_window_seconds integer,
  p_limit integer,
  p_cost integer default 1
)
returns table (allowed boolean, remaining integer, reset_at timestamptz, hits integer)
language plpgsql
security definer
set search_path = pg_catalog, ops
as $$
declare
  v_bucket timestamptz;
  v_reset timestamptz;
  v_hits integer;
begin
  if p_cost < 1 or p_cost > 100 then
    raise exception 'هزینهٔ مصرف باید بین ۱ و ۱۰۰ باشد، نه %', p_cost using errcode = 'check_violation';
  end if;

  if p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'پنجرهٔ زمانی باید بین ۱ ثانیه و ۲۴ ساعت باشد، نه %', p_window_seconds
      using errcode = 'check_violation';
  end if;

  if p_limit < 1 then
    raise exception 'سقف باید مثبت باشد، نه %', p_limit using errcode = 'check_violation';
  end if;

  v_bucket := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_reset := v_bucket + make_interval(secs => p_window_seconds);

  insert into ops.rate_limit_counter (subject_kind, subject_hash, window_seconds, bucket_start, counter)
  values (p_subject_kind, p_subject_hash, p_window_seconds, v_bucket, p_cost)
  on conflict (subject_kind, subject_hash, window_seconds, bucket_start)
  do update set counter = ops.rate_limit_counter.counter + p_cost,
                updated_at = now()
  returning ops.rate_limit_counter.counter into v_hits;

  return query select v_hits <= p_limit, greatest(p_limit - v_hits, 0), v_reset, v_hits;
end
$$;

comment on function ops.consume_rate_limit is 'مصرف اتمی سهمیهٔ سقف نرخ با پنجرهٔ ثابت (§13)';

/** پاک‌سازی پنجره‌های کهنه؛ کار زمان‌بندی‌شدهٔ صف آن را صدا می‌زند. */
create or replace function ops.prune_rate_limit_counters(p_keep_seconds integer default 3600)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, ops
as $$
declare
  v_deleted integer;
begin
  delete from ops.rate_limit_counter
   where bucket_start < now() - make_interval(secs => greatest(p_keep_seconds, 60));

  get diagnostics v_deleted = row_count;
  return v_deleted;
end
$$;

comment on function ops.prune_rate_limit_counters is 'حذف پنجره‌های کهنهٔ سقف نرخ';

revoke all on function ops.consume_rate_limit(text, text, integer, integer, integer) from public;
revoke all on function ops.prune_rate_limit_counters(integer) from public;
grant execute on function ops.consume_rate_limit(text, text, integer, integer, integer) to pv_app, pv_public, pv_worker;
grant execute on function ops.prune_rate_limit_counters(integer) to pv_worker;

-- ------------------------------------------------------------------ پشتیبان و بازیابی
create table ops.backup (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('full', 'schema', 'data', 'config', 'media')),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  driver text not null default 'local' check (driver in ('local', 's3', 'gcs', 'azure')),
  storage_key text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  checksum_sha256 text check (checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$'),
  /** پشتیبان بدون رمزنگاری، پشتیبان نیست (§88). */
  is_encrypted boolean not null default true,
  key_ref text,
  /** آخرین مهاجرت اجراشده در لحظهٔ پشتیبان؛ شرط سازگاری بازیابی (§146–151). */
  schema_version text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  error text,
  requested_by uuid,
  request_id text,
  constraint backup_finished_shape check ((status = 'running') = (finished_at is null)),
  constraint backup_encryption_shape check (not is_encrypted or key_ref is not null)
);

comment on table ops.backup is 'نسخه‌های پشتیبان با درهم و ارجاع کلید رمزنگاری (§88)';

create index backup_started_idx on ops.backup (started_at desc);
create index backup_kind_idx on ops.backup (kind, started_at desc);

create table ops.restore_test (
  id uuid primary key default gen_random_uuid(),
  backup_id uuid not null references ops.backup (id) on delete restrict,
  /** محیطی که بازیابی در آن آزموده شد؛ «fresh» یعنی نصب از صفر (§187). */
  environment text not null check (environment in ('fresh', 'staging', 'local')),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  migrations_applied integer not null default 0 check (migrations_applied >= 0),
  seed_applied integer not null default 0 check (seed_applied >= 0),
  checks_passed integer not null default 0 check (checks_passed >= 0),
  checks_failed integer not null default 0 check (checks_failed >= 0),
  report jsonb not null default '{}'::jsonb,
  executed_by uuid,
  notes text,
  constraint restore_test_finished_shape check ((status = 'running') = (finished_at is null)),
  /** بازیابِ ناموفق، «موفق» ثبت نمی‌شود؛ وگرنه تست بازیابی تشریفاتی می‌شود. */
  constraint restore_test_ok_shape check (status <> 'succeeded' or checks_failed = 0)
);

comment on table ops.restore_test is 'آزمون بازیابی پشتیبان؛ بدون این، پشتیبان ادعاست (§191)';

create index restore_test_backup_idx on ops.restore_test (backup_id, started_at desc);

alter table ops.backup enable row level security;
alter table ops.restore_test enable row level security;

create policy backup_staff_all on ops.backup
  for all to pv_app
  using (app.has_platform_permission('platform.backup.manage'))
  with check (app.has_platform_permission('platform.backup.manage'));

create policy backup_worker_all on ops.backup
  for all to pv_worker
  using (true)
  with check (true);

create policy backup_reader on ops.backup
  for select to pv_reader
  using (true);

create policy restore_test_staff_all on ops.restore_test
  for all to pv_app
  using (app.has_platform_permission('platform.backup.manage'))
  with check (app.has_platform_permission('platform.backup.manage'));

create policy restore_test_worker_all on ops.restore_test
  for all to pv_worker
  using (true)
  with check (true);

create policy restore_test_reader on ops.restore_test
  for select to pv_reader
  using (true);

revoke all on ops.backup, ops.restore_test from public;
grant select, insert, update on ops.backup, ops.restore_test to pv_app, pv_worker;
grant select on ops.backup, ops.restore_test to pv_reader;

/**
 * پشتیبان‌هایی که آزمون بازیابی موفق ندارند.
 *
 * قید §191 صریح است: «هیچ پشتیبانی بدون آزمون بازیابی». این تابع همان قید را
 * *پرسش‌پذیر* می‌کند تا بتواند در پایش و دروازهٔ انتشار بنشیند، نه اینکه به
 * یادآوری آدم‌ها سپرده شود.
 */
create or replace function ops.unverified_backups(p_grace_hours integer default 48)
returns setof ops.backup
language sql
stable
security definer
set search_path = pg_catalog, ops
as $$
  select b.*
  from ops.backup b
  where b.status = 'succeeded'
    and b.finished_at < now() - make_interval(hours => greatest(p_grace_hours, 0))
    and not exists (
      select 1 from ops.restore_test rt
      where rt.backup_id = b.id and rt.status = 'succeeded'
    )
  order by b.finished_at
$$;

comment on function ops.unverified_backups is 'پشتیبان‌های بدون آزمون بازیابی موفق (§191)';

revoke all on function ops.unverified_backups(integer) from public;
grant execute on function ops.unverified_backups(integer) to pv_app, pv_worker, pv_reader;

-- ------------------------------------------------------------------ نگهداشت داده
-- «حذف نرم» یعنی کاربر فکر می‌کند پاک شد؛ «نگهداشت» یعنی واقعاً چند وقت
-- می‌ماند و بعد چه می‌شود. این دو یکی نیستند و اینجا از هم جدا می‌شوند (§132).
create table ops.retention_policy (
  id uuid primary key default gen_random_uuid(),
  /** دامنهٔ داده — نام منطقی، نه نام جدول؛ وگرنه با هر تغییر اسکیما می‌شکند. */
  scope text not null unique check (scope ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$'),
  name_fa text not null,
  retain_days integer not null check (retain_days between 1 and 3650),
  action text not null check (action in ('delete', 'anonymize', 'archive')),
  /** نگهداشت قانونی: تا برداشته نشود، هیچ اجرایی این دامنه را لمس نمی‌کند. */
  legal_hold boolean not null default false,
  legal_hold_reason text,
  is_active boolean not null default true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint retention_hold_shape check ((not legal_hold) = (legal_hold_reason is null))
);

comment on table ops.retention_policy is 'سیاست نگهداشت داده به تفکیک دامنه (§132)';

create index retention_policy_due_idx on ops.retention_policy (next_run_at) where is_active and not legal_hold;

create trigger retention_policy_touch
  before update on ops.retention_policy
  for each row execute function app.touch();

create table ops.retention_run (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references ops.retention_policy (id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'skipped')),
  cutoff_at timestamptz not null,
  examined integer not null default 0 check (examined >= 0),
  affected integer not null default 0 check (affected >= 0),
  skipped_hold integer not null default 0 check (skipped_hold >= 0),
  error text,
  report jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  constraint retention_run_finished_shape check ((status = 'running') = (finished_at is null))
);

comment on table ops.retention_run is 'دفتر اجرای سیاست‌های نگهداشت (§132)';

create index retention_run_policy_idx on ops.retention_run (policy_id, started_at desc);

alter table ops.retention_policy enable row level security;
alter table ops.retention_run enable row level security;

create policy retention_policy_staff_all on ops.retention_policy
  for all to pv_app
  using (app.has_platform_permission('platform.backup.manage'))
  with check (app.has_platform_permission('platform.backup.manage'));

create policy retention_policy_worker_all on ops.retention_policy
  for all to pv_worker
  using (true)
  with check (true);

create policy retention_policy_reader on ops.retention_policy
  for select to pv_reader
  using (true);

create policy retention_run_staff_select on ops.retention_run
  for select to pv_app
  using (app.has_platform_permission('platform.backup.manage'));

create policy retention_run_worker_all on ops.retention_run
  for all to pv_worker
  using (true)
  with check (true);

create policy retention_run_reader on ops.retention_run
  for select to pv_reader
  using (true);

revoke all on ops.retention_policy, ops.retention_run from public;
grant select, insert, update on ops.retention_policy to pv_app, pv_worker;
grant select, insert, update on ops.retention_run to pv_worker;
grant select on ops.retention_run to pv_app;
grant select on ops.retention_policy, ops.retention_run to pv_reader;

/** سیاست‌هایی که وقت اجرایشان رسیده — نگهداشت قانونی، هرگز. */
create or replace function ops.retention_due(p_limit integer default 50)
returns setof ops.retention_policy
language sql
stable
security definer
set search_path = pg_catalog, ops
as $$
  select p.*
  from ops.retention_policy p
  where p.is_active
    and not p.legal_hold
    and (p.next_run_at is null or p.next_run_at <= now())
  order by p.next_run_at nulls first
  limit greatest(p_limit, 1)
$$;

comment on function ops.retention_due is 'سیاست‌های نگهداشت سررسیده، بدون نگهداشت قانونی (§132)';

/** تصویر نگهداشت، برای پنل مدیریت: چه چیزی، چند روز، آخرین اجرا. */
create or replace function ops.retention_summary()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, ops
as $$
  select jsonb_build_object(
    'policies', (select count(*) from ops.retention_policy),
    'active', (select count(*) from ops.retention_policy where is_active),
    'on_hold', (select count(*) from ops.retention_policy where legal_hold),
    'due_now', (select count(*) from ops.retention_policy
                 where is_active and not legal_hold
                   and (next_run_at is null or next_run_at <= now())),
    'last_run_at', (select max(finished_at) from ops.retention_run where status = 'succeeded')
  )
$$;

comment on function ops.retention_summary is 'تصویر وضعیت نگهداشت داده (§132)';

revoke all on function ops.retention_due(integer) from public;
revoke all on function ops.retention_summary() from public;
grant execute on function ops.retention_due(integer) to pv_worker, pv_app;
grant execute on function ops.retention_summary() to pv_app, pv_worker, pv_reader;
