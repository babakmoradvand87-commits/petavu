-- ============================================================================
-- 0011_performance — اندازه‌گیری میدانی عملکرد: نمونه، تجمیع، خط مبنا، پس‌رفت
--
-- چرا «بودجه» بی اندازه‌گیری بی‌معنی است: بودجه می‌گوید «سقف کجاست»، ولی تا
-- کسی از سقف رد شدن را *نبینَد*، همان توصیه‌ای است که کسی یادش می‌رود. این فایل
-- حلقه را می‌بندد: مرورگر می‌سنجد → نمونه ثبت می‌شود → تجمیع می‌شود → با خط
-- مبنا مقایسه می‌شود → پس‌رفت، یک *ردیف* می‌شود که کسی باید ببیندش.
--
-- مرجع: Addendum §1–۴ (بودجهٔ قابل اندازه‌گیری)، §91–۹۵ (پایش، RUM، هم‌بستگی)،
--       §۱۰۱ (دادهٔ تولیدی وارد محیط توسعه نمی‌شود)، §۱۳۲ (نگهداشت)
-- ============================================================================

-- ------------------------------------------------------------------ نمونهٔ خام
create table ops.vitals_sample (
  id uuid primary key default gen_random_uuid(),

  /** زمان رخداد در مرورگر و زمان رسیدن به سرور: تفاوتشان، تأخیر انتقال است. */
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),

  metric text not null check (metric in ('lcp', 'inp', 'cls', 'ttfb', 'fcp')),
  value numeric(12, 4) not null check (value >= 0 and value <= 120000),
  rating text not null check (rating in ('good', 'needs_improvement', 'poor')),

  /**
   * الگوی بودجه‌ای که این مسیر با آن تطبیق داده شده.
   *
   * NULL یعنی «هیچ بودجه‌ای تطبیق نکرد» — و این یک *اندازه‌گیری* است، نه یک
   * خطا: مسیر بی‌بودجه باید دیده شود، نه اینکه دور انداخته شود.
   */
  route_pattern text check (route_pattern is null or route_pattern like '/%'),

  /**
   * مسیر صفحه، بی‌رشتهٔ پرس‌وجو و بی‌قطعه.
   *
   * عمدی است و سخت‌گیرانه: نشانی صفحه می‌تواند توکن، ایمیل یا شناسهٔ نشست در
   * رشتهٔ پرس‌وجو داشته باشد. ثبت آن، نشت است (§101). قید، جلوی ذخیرهٔ نشانی
   * آلوده را از همان در می‌گیرد.
   */
  page_path text not null check (
    length(page_path) between 1 and 300
    and page_path like '/%'
    and position('?' in page_path) = 0
    and position('#' in page_path) = 0
  ),

  business_id uuid references app.business (id) on delete cascade,
  device_class text not null default 'unknown' check (device_class in ('mobile', 'tablet', 'desktop', 'unknown')),
  connection text not null default 'unknown'
    check (connection in ('slow-2g', '2g', '3g', '4g', '5g', 'wifi', 'ethernet', 'unknown')),
  navigation_type text not null default 'navigate'
    check (navigation_type in ('navigate', 'reload', 'back_forward', 'prerender', 'unknown')),

  /** بستهٔ طراحی/انتشار فعال؛ مبنای «پس‌رفت از کدام انتشار آمد؟». */
  release_key text,

  /**
   * درهم روزانهٔ نشست — نه شناسهٔ کاربر.
   *
   * برای «چند بازدیدکننده» لازم است، برای «کدام بازدیدکننده» نه. همان چیزی که
   * لازم نیست، ذخیره نمی‌شود (§101).
   */
  session_hash text check (session_hash is null or session_hash ~ '^[a-f0-9]{64}$'),

  /** هم‌بستگی سرتاسری: مرورگر → API → پایگاه‌داده → صف (Addendum §95). */
  request_id text,

  constraint vitals_time_shape check (
    occurred_at <= received_at + interval '5 minutes'
    and occurred_at >= received_at - interval '2 days'
  )
);

comment on table ops.vitals_sample is
  'نمونهٔ میدانی سنجه‌های عملکرد (RUM)؛ ورودی تجمیع، خط مبنا و تشخیص پس‌رفت (Addendum §91–۹۵)';

create index vitals_sample_route_idx on ops.vitals_sample (route_pattern, metric, occurred_at desc);
create index vitals_sample_time_idx on ops.vitals_sample (occurred_at desc);
create index vitals_sample_business_idx on ops.vitals_sample (business_id, occurred_at desc) where business_id is not null;
create index vitals_sample_rating_idx on ops.vitals_sample (metric, rating, occurred_at desc);
create index vitals_sample_release_idx on ops.vitals_sample (release_key, occurred_at desc) where release_key is not null;

alter table ops.vitals_sample enable row level security;

/*
 * بی‌نام فقط می‌نویسد.
 *
 * بیگانه می‌تواند بگوید «این صفحه چقدر کند بود»، ولی نمی‌تواند بخواند —
 * حتی نشمارد. نمونه‌های عملکردی، هرچند بی‌نام، نقشهٔ ترافیک کسب‌وکارها هستند.
 */
-- بی‌نام، بی‌انتساب: نوشتن مستقیم نمی‌تواند نمونه را به کسب‌وکاری نسبت دهد.
create policy vitals_sample_public_insert on ops.vitals_sample
  for insert to pv_public
  with check (business_id is null);

-- اپلیکیشن: اگر نمونه به کسب‌وکاری نسبت داده می‌شود، باید عضو همان باشد.
-- انتساب سرور‌محور (برای ترافیک بی‌نام روی صفحهٔ کسب‌وکار) از راه تابع
-- `security definer` انجام می‌شود، نه از راه این سیاست.
create policy vitals_sample_app_insert on ops.vitals_sample
  for insert to pv_app
  with check (business_id is null or app.is_member_of(business_id));

create policy vitals_sample_member_select on ops.vitals_sample
  for select to pv_app
  using (business_id is not null and app.is_member_of(business_id));

create policy vitals_sample_staff_select on ops.vitals_sample
  for select to pv_app
  using (app.has_platform_permission('platform.feature.manage'));

create policy vitals_sample_worker_all on ops.vitals_sample
  for all to pv_worker
  using (true)
  with check (true);

create policy vitals_sample_reader on ops.vitals_sample
  for select to pv_reader
  using (true);

/*
 * گرنت‌ها، صریح و بازنویسی‌شده.
 *
 * `revoke` اول لازم است چون `alter default privileges` در ۰۰۰۱ برای هر جدول
 * تازه، select/insert/update/delete می‌دهد. اگر بازپس‌گیری نمی‌کردیم،
 * «تغییرناپذیری نمونه» فقط یک نیت می‌ماند: هر نقشی می‌توانست اندازه‌گیری
 * ثبت‌شده را بازنویسی کند و کسی هم نمی‌فهمید (تست، همین را گرفت).
 */
revoke all on ops.vitals_sample from public;
revoke insert, update, delete on ops.vitals_sample from pv_app, pv_worker;

grant insert on ops.vitals_sample to pv_public, pv_app;
grant select, insert on ops.vitals_sample to pv_worker;
grant select on ops.vitals_sample to pv_reader;
-- هیچ نقشی update یا delete ندارد: نمونهٔ ثبت‌شده، اندازه‌گیری است؛ بازنویسی
-- یعنی دست‌کاری سابقه، و حذف فقط از راه `ops.purge_vitals` (نگهداشت آگاهانه).
-- نکتهٔ فنی: `insert … returning` به گرنت select هم نیاز دارد؛ همین است که
-- بی‌نام می‌تواند بنویسد ولی نمی‌تواند چیزی بازخوانی کند.

-- ------------------------------------------------------------------ تجمیع
create table ops.vitals_rollup (
  id uuid primary key default gen_random_uuid(),
  /** `~unbudgeted` یعنی مسیری که بودجهٔ تطبیق‌یافته نداشت. */
  route_pattern text not null check (route_pattern = '~unbudgeted' or route_pattern like '/%'),
  metric text not null check (metric in ('lcp', 'inp', 'cls', 'ttfb', 'fcp')),
  bucket text not null check (bucket in ('hour', 'day')),
  bucket_start timestamptz not null,
  sample_count integer not null check (sample_count > 0),
  p50 numeric(12, 4) not null,
  p75 numeric(12, 4) not null,
  p95 numeric(12, 4) not null,
  worst numeric(12, 4) not null,
  good integer not null default 0 check (good >= 0),
  needs_improvement integer not null default 0 check (needs_improvement >= 0),
  poor integer not null default 0 check (poor >= 0),
  computed_at timestamptz not null default now(),
  version integer not null default 1,
  constraint vitals_rollup_counts check (good + needs_improvement + poor = sample_count)
);

comment on table ops.vitals_rollup is
  'تجمیع ساعتی/روزانهٔ نمونه‌ها؛ مبنای نمودار پنل و تشخیص پس‌رفت (Addendum §91–۹۵)';

create unique index vitals_rollup_key_idx on ops.vitals_rollup (route_pattern, metric, bucket, bucket_start);
create index vitals_rollup_time_idx on ops.vitals_rollup (bucket, bucket_start desc);

create trigger vitals_rollup_touch
  before update on ops.vitals_rollup
  for each row execute function app.touch();

alter table ops.vitals_rollup enable row level security;

create policy vitals_rollup_read on ops.vitals_rollup
  for select to pv_app, pv_reader using (true);

create policy vitals_rollup_write on ops.vitals_rollup
  for all to pv_app, pv_worker
  using (app.has_platform_permission('platform.feature.manage'))
  with check (app.has_platform_permission('platform.feature.manage'));

create policy vitals_rollup_worker_all on ops.vitals_rollup
  for all to pv_worker using (true) with check (true);

revoke all on ops.vitals_rollup from public;
grant select, insert, update, delete on ops.vitals_rollup to pv_app, pv_worker;
grant select on ops.vitals_rollup to pv_reader;

-- ------------------------------------------------------------------ خط مبنا
create table ops.performance_baseline (
  id uuid primary key default gen_random_uuid(),
  route_pattern text not null check (route_pattern = '~unbudgeted' or route_pattern like '/%'),
  metric text not null check (metric in ('lcp', 'inp', 'cls', 'ttfb', 'fcp')),
  window_days integer not null default 7 check (window_days between 1 and 90),
  sample_count integer not null check (sample_count > 0),
  p50 numeric(12, 4) not null,
  p75 numeric(12, 4) not null,
  p95 numeric(12, 4) not null,
  /** بودجهٔ همان الگو در لحظهٔ محاسبه؛ برای «چقدر جا داریم». */
  budget_value numeric(12, 4),
  computed_at timestamptz not null default now(),
  version integer not null default 1
);

comment on table ops.performance_baseline is
  'خط مبنای هر مسیر و سنجه؛ «سرعت عادی این صفحه» که پس‌رفت با آن سنجیده می‌شود';

create unique index performance_baseline_key_idx on ops.performance_baseline (route_pattern, metric);

create trigger performance_baseline_touch
  before update on ops.performance_baseline
  for each row execute function app.touch();

alter table ops.performance_baseline enable row level security;

create policy performance_baseline_read on ops.performance_baseline
  for select to pv_app, pv_reader using (true);

create policy performance_baseline_write on ops.performance_baseline
  for all to pv_app, pv_worker
  using (app.has_platform_permission('platform.feature.manage'))
  with check (app.has_platform_permission('platform.feature.manage'));

revoke all on ops.performance_baseline from public;
grant select, insert, update, delete on ops.performance_baseline to pv_app, pv_worker;
grant select on ops.performance_baseline to pv_reader;

-- ------------------------------------------------------------------ پس‌رفت
create table ops.performance_regression (
  id uuid primary key default gen_random_uuid(),
  route_pattern text not null check (route_pattern = '~unbudgeted' or route_pattern like '/%'),
  metric text not null check (metric in ('lcp', 'inp', 'cls', 'ttfb', 'fcp')),
  severity text not null check (severity in ('warning', 'critical')),
  baseline_value numeric(12, 4) not null,
  observed_value numeric(12, 4) not null,
  delta_ratio numeric(8, 4) not null,
  /** اگر الگو بودجه داشته باشد: سنجهٔ عبور یا شکست، همین‌جا می‌ماند. */
  budget_value numeric(12, 4),
  window_start timestamptz not null,
  window_end timestamptz not null,
  sample_count integer not null check (sample_count > 0),
  /** کدام انتشار مظنون است؛ از نمونه‌های همان بازه. */
  suspect_release text,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved', 'ignored')),
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  note text,
  constraint regression_window_shape check (window_end > window_start),
  constraint regression_resolved_shape check ((status in ('resolved', 'ignored')) = (resolved_at is not null))
);

comment on table ops.performance_regression is
  'پس‌رفت‌های شناسایی‌شده؛ یک ردیف برای هر مسیر و سنجه تا کسی آن را ببیند';

create unique index performance_regression_open_idx
  on ops.performance_regression (route_pattern, metric) where status = 'open';
create index performance_regression_time_idx on ops.performance_regression (detected_at desc);
create index performance_regression_severity_idx on ops.performance_regression (severity, status);

alter table ops.performance_regression enable row level security;

create policy performance_regression_read on ops.performance_regression
  for select to pv_app, pv_reader using (true);

create policy performance_regression_write on ops.performance_regression
  for all to pv_app, pv_worker
  using (app.has_platform_permission('platform.feature.manage'))
  with check (app.has_platform_permission('platform.feature.manage'));

revoke all on ops.performance_regression from public;
grant select, insert, update, delete on ops.performance_regression to pv_app, pv_worker;
grant select on ops.performance_regression to pv_reader;

-- ------------------------------------------------------------------ سنجه‌ها
/**
 * درجه‌بندی یک سنجه بر پایهٔ آستانه‌های Core Web Vitals.
 *
 * آستانه‌ها اینجا هستند و جای دیگری نیست (§103: یک قاعده، همه‌جا). تغییرشان
 * یعنی تغییر همین تابع، نه بازنویسی در پنل و سایت و کارگر.
 */
create or replace function ops.vitals_rating(p_metric text, p_value numeric)
returns text
language sql
immutable
as $$
  select case p_metric
    when 'lcp' then case when p_value <= 2500 then 'good' when p_value <= 4000 then 'needs_improvement' else 'poor' end
    when 'inp' then case when p_value <= 200 then 'good' when p_value <= 500 then 'needs_improvement' else 'poor' end
    when 'cls' then case when p_value <= 0.1 then 'good' when p_value <= 0.25 then 'needs_improvement' else 'poor' end
    when 'ttfb' then case when p_value <= 800 then 'good' when p_value <= 1800 then 'needs_improvement' else 'poor' end
    when 'fcp' then case when p_value <= 1800 then 'good' when p_value <= 3000 then 'needs_improvement' else 'poor' end
    else 'poor'
  end
$$;

comment on function ops.vitals_rating is 'درجه‌بندی سنجه بر پایهٔ آستانه‌های Core Web Vitals';

-- ------------------------------------------------------------------ ثبت نمونه
/**
 * ثبت دسته‌ای نمونهٔ میدانی.
 *
 * ورودی از مرورگر می‌آید و بنابراین **دادهٔ بی‌اعتماد** است. این تابع، مرز
 * اعتماد است: هر رکورد را می‌سنجد، مسیر را پاک می‌کند، سقف تعداد را اعمال
 * می‌کند و رکورد نامعتبر را *رد می‌کند و می‌گوید* — نه اینکه بی‌صدا دور
 * بریزد و نه اینکه کل دسته را باطل کند.
 *
 * `p_business_id` را **سرور** می‌دهد، نه مرورگر. اگر آن را از بدنهٔ درخواست
 * می‌خواندیم، هر کسی می‌توانست نمونهٔ عملکردی را به کسب‌وکار دیگری نسبت دهد —
 * و «عملکرد رقیب» تبدیل می‌شد به داده‌ای که خودش نوشته است. مسیر `business_id`
 * در رکورد، عمداً نادیده گرفته می‌شود.
 */
create or replace function ops.record_vitals(p_records jsonb, p_business_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, ops, app
as $$
declare
  v_item jsonb;
  v_index integer := -1;
  v_metric text;
  v_value numeric;
  v_path text;
  v_pattern text;
  v_business uuid;
  v_occurred timestamptz;
  v_accepted integer := 0;
  v_unbudgeted integer := 0;
  v_rejected jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_records) <> 'array' then
    raise exception 'دستهٔ نمونه باید آرایه باشد' using errcode = 'invalid_parameter_value';
  end if;

  -- سقف دسته: یک درخواست، بیش از این نمی‌نویسد (§13: محدودیت نرخ).
  if jsonb_array_length(p_records) > 50 then
    raise exception 'بیش از ۵۰ رکورد در یک درخواست مجاز نیست' using errcode = 'invalid_parameter_value';
  end if;

  for v_item in select * from jsonb_array_elements(p_records)
  loop
    v_index := v_index + 1;
    v_metric := v_item ->> 'metric';

    if v_metric is null or v_metric not in ('lcp', 'inp', 'cls', 'ttfb', 'fcp') then
      v_rejected := v_rejected || jsonb_build_object('index', v_index, 'reason', 'metric_not_allowed');
      continue;
    end if;

    begin
      v_value := (v_item ->> 'value')::numeric;
    exception when others then
      v_value := null;
    end;

    if v_value is null or v_value < 0 or v_value > 120000 then
      v_rejected := v_rejected || jsonb_build_object('index', v_index, 'reason', 'value_out_of_range');
      continue;
    end if;

    /*
     * پاک‌سازی مسیر: رشتهٔ پرس‌وجو و قطعه دور می‌روند.
     *
     * اگر این کار را نکنیم، یک `?token=…` در نشانی، برای همیشه در پایگاه‌داده
     * می‌ماند. قید جدول هم همین را می‌خواهد؛ تابع، دوستانه‌تر انجامش می‌دهد.
     */
    v_path := coalesce(v_item ->> 'path', '');
    v_path := split_part(v_path, '?', 1);
    v_path := split_part(v_path, '#', 1);
    v_path := left(btrim(v_path), 300);
    if v_path = '' or position('/' in v_path) <> 1 then
      v_rejected := v_rejected || jsonb_build_object('index', v_index, 'reason', 'path_invalid');
      continue;
    end if;

    begin
      v_occurred := coalesce((v_item ->> 'occurred_at')::timestamptz, now());
    exception when others then
      v_occurred := now();
    end;

    -- clamp: ساعت مرورگر بی‌اعتماد است؛ زمان بیرون از پنجره به «حالا» می‌آید.
    if v_occurred > now() + interval '5 minutes' or v_occurred < now() - interval '2 days' then
      v_occurred := now();
    end if;

    v_pattern := (select route_pattern from ops.budget_for_route(v_path) limit 1);

    -- کسب‌وکار از سرور می‌آید؛ آنچه در رکورد آمده، نادیده گرفته می‌شود.
    v_business := p_business_id;

    if v_pattern is null then
      v_unbudgeted := v_unbudgeted + 1;
    end if;

    insert into ops.vitals_sample (
      occurred_at, metric, value, rating, route_pattern, page_path, business_id,
      device_class, connection, navigation_type, release_key, session_hash, request_id
    ) values (
      v_occurred,
      v_metric,
      v_value,
      ops.vitals_rating(v_metric, v_value),
      v_pattern,
      v_path,
      v_business,
      coalesce(nullif(v_item ->> 'device_class', ''), 'unknown'),
      coalesce(nullif(v_item ->> 'connection', ''), 'unknown'),
      coalesce(nullif(v_item ->> 'navigation_type', ''), 'unknown'),
      nullif(v_item ->> 'release_key', ''),
      nullif(v_item ->> 'session_hash', ''),
      nullif(v_item ->> 'request_id', '')
    );

    v_accepted := v_accepted + 1;
  end loop;

  return jsonb_build_object(
    'accepted', v_accepted,
    'unbudgeted', v_unbudgeted,
    'rejected', v_rejected
  );
end
$$;

comment on function ops.record_vitals is
  'ثبت نمونه‌های RUM با اعتبارسنجی، پاک‌سازی مسیر و رد مستند رکورد نامعتبر (§101)';

-- ------------------------------------------------------------------ تجمیع
/**
 * تجمیع نمونه‌ها به سبد ساعتی یا روزانه.
 *
 * ایدمپوتنت است (§180): پنجرهٔ هم‌پوشان، همان سبد را بازنویسی می‌کند و شمارش
 * دوباره نمی‌شود. `greatest` روی همهٔ سنجه‌ها، «بدترین حالت» را نگه می‌دارد
 * تا یک تجربهٔ خراب در میان هزار تجربهٔ خوب گم نشود.
 */
create or replace function ops.rollup_vitals(p_bucket text default 'hour', p_window interval default '2 days')
returns integer
language plpgsql
security definer
set search_path = pg_catalog, ops
as $$
declare
  v_count integer;
begin
  if p_bucket not in ('hour', 'day') then
    raise exception 'سبد نامعتبر: %', p_bucket using errcode = 'invalid_parameter_value';
  end if;

  insert into ops.vitals_rollup (
    route_pattern, metric, bucket, bucket_start, sample_count, p50, p75, p95, worst,
    good, needs_improvement, poor, computed_at
  )
  select
    coalesce(s.route_pattern, '~unbudgeted'),
    s.metric,
    p_bucket,
    date_trunc(p_bucket, s.occurred_at),
    count(*)::int,
    round(percentile_cont(0.5) within group (order by s.value)::numeric, 4),
    round(percentile_cont(0.75) within group (order by s.value)::numeric, 4),
    round(percentile_cont(0.95) within group (order by s.value)::numeric, 4),
    max(s.value),
    count(*) filter (where s.rating = 'good')::int,
    count(*) filter (where s.rating = 'needs_improvement')::int,
    count(*) filter (where s.rating = 'poor')::int,
    now()
  from ops.vitals_sample s
  where s.occurred_at >= now() - p_window
  group by 1, 2, 4
  on conflict (route_pattern, metric, bucket, bucket_start) do update
    set sample_count = excluded.sample_count,
        p50 = excluded.p50,
        p75 = excluded.p75,
        p95 = excluded.p95,
        worst = excluded.worst,
        good = excluded.good,
        needs_improvement = excluded.needs_improvement,
        poor = excluded.poor,
        computed_at = excluded.computed_at;
        -- نسخه با ماشهٔ `vitals_rollup_touch` جلو می‌رود، نه دستی: یک قاعده، یک جا.

  get diagnostics v_count = row_count;
  return v_count;
end
$$;

comment on function ops.rollup_vitals is 'تجمیع ایدمپوتنت نمونه‌ها به سبد ساعتی/روزانه (Addendum §91–۹۵)';

-- ------------------------------------------------------------------ خط مبنا
/**
 * محاسبهٔ خط مبنا از نمونه‌های خام یک پنجرهٔ بلند.
 *
 * مسیری که نمونهٔ کافی ندارد، خط مبنا نمی‌گیرد. این سخت‌گیری عمدی است: خط
 * مبنای بی‌نمونه، عدد ساختگی است و پس‌رفتِ ساختگی می‌سازد — و هشدار ساختگی،
 * بدتر از نبود هشدار است.
 */
create or replace function ops.compute_baselines(p_window_days integer default 7, p_min_samples integer default 100)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, ops
as $$
declare
  v_count integer;
begin
  if p_window_days < 1 or p_window_days > 90 then
    raise exception 'پنجرهٔ خط مبنا بیرون از محدوده است' using errcode = 'invalid_parameter_value';
  end if;

  insert into ops.performance_baseline (
    route_pattern, metric, window_days, sample_count, p50, p75, p95, budget_value, computed_at
  )
  select
    coalesce(s.route_pattern, '~unbudgeted'),
    s.metric,
    p_window_days,
    count(*)::int,
    round(percentile_cont(0.5) within group (order by s.value)::numeric, 4),
    round(percentile_cont(0.75) within group (order by s.value)::numeric, 4),
    round(percentile_cont(0.95) within group (order by s.value)::numeric, 4),
    budget.value,
    now()
  from ops.vitals_sample s
  /*
   * بودجهٔ همان سنجه، نه فقط LCP.
   *
   * نسخهٔ نخست، `b.lcp_ms` را برای همهٔ سنجه‌ها می‌گذاشت؛ نتیجه‌اش این بود که
   * بودجهٔ CLS با میلی‌ثانیه سنجیده می‌شد. کلمهٔ «بودجه» بی معنیِ درست، بدتر
   * از نبودنش است.
   */
  left join lateral (
    select case s.metric
      when 'lcp' then b.lcp_ms
      when 'inp' then b.inp_ms
      when 'cls' then b.cls
      when 'ttfb' then b.ttfb_ms
      else null
    end::numeric as value
    from ops.page_budget b
    where b.route_pattern = s.route_pattern and b.is_active
    limit 1
  ) budget on true
  where s.occurred_at >= now() - make_interval(days => p_window_days)
  group by 1, 2, budget.value
  having count(*) >= p_min_samples
  on conflict (route_pattern, metric) do update
    set window_days = excluded.window_days,
        sample_count = excluded.sample_count,
        p50 = excluded.p50,
        p75 = excluded.p75,
        p95 = excluded.p95,
        budget_value = excluded.budget_value,
        computed_at = excluded.computed_at;
        -- نسخه با ماشهٔ `performance_baseline_touch` جلو می‌رود.

  get diagnostics v_count = row_count;
  return v_count;
end
$$;

comment on function ops.compute_baselines is 'محاسبهٔ خط مبنا با کفِ نمونه؛ خط مبنای بی‌نمونه ساخته نمی‌شود';

-- ------------------------------------------------------------------ پس‌رفت
/**
 * تشخیص پس‌رفت: مقایسهٔ p75 پنجرهٔ تازه با خط مبنا.
 *
 * دو شدت داریم و تفاوتشان معنادار است:
 *   • `critical` — از *بودجهٔ* همان الگو هم گذشته؛ این خرابی است، نه کند شدن.
 *   • `warning`  — از خط مبنا بیش از آستانه جلو زده ولی هنوز زیر بودجه است؛
 *                   این «هشدارِ پیش از خرابی» است.
 *
 * یکتایی جزئی تضمین می‌کند برای هر مسیر و سنجه، بیش از یک پس‌رفت *باز* ساخته
 * نشود؛ وگرنه هر اجرای کارگر، یک هشدار تازه می‌ساخت و کسی به هشدارها نگاه
 * نمی‌کرد.
 */
create or replace function ops.detect_regressions(
  p_threshold numeric default 0.2,
  p_window interval default '24 hours',
  p_min_samples integer default 50
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, ops
as $$
declare
  v_count integer;
begin
  if p_threshold <= 0 or p_threshold > 10 then
    raise exception 'آستانهٔ پس‌رفت بیرون از محدوده است' using errcode = 'invalid_parameter_value';
  end if;

  insert into ops.performance_regression (
    route_pattern, metric, severity, baseline_value, observed_value, delta_ratio,
    budget_value, window_start, window_end, sample_count, suspect_release
  )
  select
    b.route_pattern,
    b.metric,
    case when budget.value is not null and observed.value > budget.value then 'critical' else 'warning' end,
    b.p75,
    observed.value,
    round(((observed.value - b.p75) / nullif(b.p75, 0))::numeric, 4),
    budget.value,
    now() - p_window,
    now(),
    observed.sample_count,
    observed.release_key
  from ops.performance_baseline b
  cross join lateral (
    select
      round(percentile_cont(0.75) within group (order by s.value)::numeric, 4) as value,
      count(*)::int as sample_count,
      (array_agg(s.release_key order by s.occurred_at desc) filter (where s.release_key is not null))[1] as release_key
    from ops.vitals_sample s
    where s.occurred_at >= now() - p_window
      and s.metric = b.metric
      and coalesce(s.route_pattern, '~unbudgeted') = b.route_pattern
  ) observed
  cross join lateral (
    select case b.metric
      when 'lcp' then (select p.lcp_ms from ops.page_budget p where p.route_pattern = b.route_pattern and p.is_active limit 1)
      when 'inp' then (select p.inp_ms from ops.page_budget p where p.route_pattern = b.route_pattern and p.is_active limit 1)
      when 'cls' then (select p.cls from ops.page_budget p where p.route_pattern = b.route_pattern and p.is_active limit 1)
      when 'ttfb' then (select p.ttfb_ms from ops.page_budget p where p.route_pattern = b.route_pattern and p.is_active limit 1)
      else null
    end as value
  ) budget
  where observed.sample_count >= p_min_samples
    and b.p75 > 0
    and observed.value > b.p75 * (1 + p_threshold)
  on conflict (route_pattern, metric) where status = 'open' do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end
$$;

comment on function ops.detect_regressions is
  'شناسایی پس‌رفت با دو شدت: گذر از بودجه (critical) و جلو زدن از خط مبنا (warning)';

/** بستن پس‌رفت با یادداشت؛ پس از رفع، مسیر می‌تواند پس‌رفت تازه بسازد. */
create or replace function ops.resolve_regression(p_id uuid, p_status text, p_note text default null)
returns ops.performance_regression
language plpgsql
security definer
set search_path = pg_catalog, ops
as $$
declare
  v_row ops.performance_regression;
begin
  if p_status not in ('acknowledged', 'resolved', 'ignored') then
    raise exception 'وضعیت نامعتبر برای پس‌رفت: %', p_status using errcode = 'invalid_parameter_value';
  end if;

  update ops.performance_regression
     set status = p_status,
         resolved_at = case when p_status in ('resolved', 'ignored') then now() else null end,
         note = coalesce(p_note, note)
   where id = p_id
  returning * into v_row;

  /* `not found` کار نمی‌کند: ردیف نگردانده‌شده، ردیف تهی است نه «هیچ». */
  if v_row.id is null then
    raise exception 'پس‌رفت % پیدا نشد', p_id using errcode = 'no_data_found';
  end if;

  return v_row;
end
$$;

comment on function ops.resolve_regression is 'بستن یا بی‌اثر کردن پس‌رفت با یادداشت اپراتور';

-- ------------------------------------------------------------------ نگهداشت
/**
 * پاک‌سازی نمونه‌های خام قدیمی.
 *
 * نمونهٔ خام برای تحلیل کوتاه‌مدت لازم است؛ سابقهٔ بلند در تجمیع و خط مبنا
 * می‌ماند (کوچک، بی‌هویت، کافی). نگهداشت، حذف *آگاهانه* است، نه فراموشی.
 */
create or replace function ops.purge_vitals(p_older_than interval default '30 days')
returns integer
language plpgsql
security definer
set search_path = pg_catalog, ops
as $$
declare
  v_count integer;
begin
  delete from ops.vitals_sample where received_at < now() - p_older_than;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

comment on function ops.purge_vitals is 'پاک‌سازی نمونه‌های خام قدیمی؛ سابقهٔ بلند در تجمیع و خط مبنا می‌ماند';

-- ------------------------------------------------------------------ پایش
/** تصویر سلامت عملکرد: حجم نمونه، سهم مسیر بی‌بودجه، سهم بد، پس‌رفت‌های باز. */
create or replace function ops.performance_health(p_window interval default '24 hours')
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, ops
as $$
  with windowed as (
    select * from ops.vitals_sample where occurred_at >= now() - p_window
  )
  select jsonb_build_object(
    'samples', (select count(*) from windowed),
    'sessions', (select count(distinct session_hash) from windowed where session_hash is not null),
    'unbudgeted', (select count(*) from windowed where route_pattern is null),
    'poor', (select count(*) from windowed where rating = 'poor'),
    'poor_ratio', (select case when count(*) = 0 then 0
                    else round(count(*) filter (where rating = 'poor')::numeric / count(*), 4) end from windowed),
    'regressions_open', (select count(*) from ops.performance_regression where status = 'open'),
    'regressions_critical', (select count(*) from ops.performance_regression where status = 'open' and severity = 'critical'),
    'routes_without_budget', (
      select coalesce(jsonb_agg(distinct s.page_path), '[]'::jsonb)
      from windowed s where s.route_pattern is null
    ),
    'worst_routes', (
      select coalesce(jsonb_agg(row_to_json(w)), '[]'::jsonb)
      from (
        select
          coalesce(s.route_pattern, '~unbudgeted') as route_pattern,
          s.metric,
          round(percentile_cont(0.75) within group (order by s.value)::numeric, 2) as p75,
          count(*)::int as sample_count
        from windowed s
        group by 1, 2
        order by 3 desc
        limit 5
      ) w
    )
  )
$$;

comment on function ops.performance_health is 'تصویر سلامت عملکرد برای پنل ادمین (Addendum §91–۹۵)';

revoke all on function ops.vitals_rating(text, numeric) from public;
revoke all on function ops.record_vitals(jsonb, uuid) from public;
revoke all on function ops.rollup_vitals(text, interval) from public;
revoke all on function ops.compute_baselines(integer, integer) from public;
revoke all on function ops.detect_regressions(numeric, interval, integer) from public;
revoke all on function ops.resolve_regression(uuid, text, text) from public;
revoke all on function ops.purge_vitals(interval) from public;
revoke all on function ops.performance_health(interval) from public;

grant execute on function ops.vitals_rating(text, numeric) to pv_public, pv_app, pv_worker, pv_reader;
-- بی‌نام فقط ثبت می‌کند؛ خواندن، کار عضو و کارکنان است.
grant execute on function ops.record_vitals(jsonb, uuid) to pv_public, pv_app, pv_worker;
grant execute on function ops.rollup_vitals(text, interval) to pv_worker;
grant execute on function ops.compute_baselines(integer, integer) to pv_worker;
grant execute on function ops.detect_regressions(numeric, interval, integer) to pv_worker;
grant execute on function ops.resolve_regression(uuid, text, text) to pv_app;
grant execute on function ops.purge_vitals(interval) to pv_worker;
grant execute on function ops.performance_health(interval) to pv_app, pv_worker, pv_reader;
