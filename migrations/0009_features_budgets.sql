-- ============================================================================
-- 0009_features_budgets — رجیستری فیچر: وابستگی، چرخهٔ عمر، بودجهٔ صفحه و دروازهٔ انتشار
--
-- چرا: `ops.feature` در گام ۵ ساخته شد تا «منبع حقیقت امکانات» باشد، ولی سه
-- چیز کم داشت که این مهاجرت اضافه می‌کند:
--
--   ۱. **وابستگی**: فیچر ب روی فیچر الف سوار است؛ حذف ایمن الف، بدون دانستن ب
--      ممکن نیست (Addendum §21–۲۴: Dependency Graph + Safe Removal).
--   ۲. **چرخهٔ عمر اجباری**: گذر از پیش‌نویس به منتشرشده باید قاعده داشته باشد،
--      نه این‌که هر کس هر وضعیتی بنویسد.
--   ۳. **بودجهٔ قابل اندازه‌گیری**: «سریع باشد» توصیه است؛ `lcp_ms = 2500` قید
--      است و دروازهٔ انتشار می‌تواند آن را رد یا قبول کند (Addendum §1–۴، §96).
--
-- مرجع: Addendum §1–۴، §21–۲۴، §90–۹۶؛ §103 (SoT)، §191 (هیچ‌چیز بی‌دروازه)
-- ============================================================================

-- ------------------------------------------------------------------ وابستگی فیچر
create table ops.feature_dependency (
  feature_key text not null references ops.feature (key) on delete cascade,
  depends_on_key text not null references ops.feature (key) on delete restrict,
  /** نوع وابستگی: سخت یعنی بدون آن، فیچر کار نمی‌کند. */
  kind text not null default 'hard' check (kind in ('hard', 'soft', 'data', 'performance')),
  note text,
  created_at timestamptz not null default now(),
  primary key (feature_key, depends_on_key),
  /** فیچر نمی‌تواند وابستهٔ خودش باشد. */
  constraint feature_dependency_self check (feature_key <> depends_on_key)
);

comment on table ops.feature_dependency is 'گراف وابستگی امکانات؛ مبنای حذف ایمن (Addendum §21–۲۴)';

create index feature_dependency_reverse_idx on ops.feature_dependency (depends_on_key);

alter table ops.feature_dependency enable row level security;

create policy feature_dependency_read on ops.feature_dependency
  for select to pv_app, pv_public, pv_worker, pv_reader using (true);

create policy feature_dependency_write on ops.feature_dependency
  for all to pv_app, pv_worker
  using (app.has_platform_permission('platform.feature.manage'))
  with check (app.has_platform_permission('platform.feature.manage'));

revoke all on ops.feature_dependency from public;
grant select, insert, update, delete on ops.feature_dependency to pv_app, pv_worker;
grant select on ops.feature_dependency to pv_public, pv_reader;

/**
 * تشخیص حلقه در گراف وابستگی.
 *
 * چرا تابع و نه فقط قید: PostgreSQL با قید ساده نمی‌تواند حلقه را در گراف
 * بگیرد. اگر حلقه بماند، «حذف ایمن» هرگز تمام نمی‌شود و مهاجرت‌ها گیر می‌کنند.
 * این تابع، مسیر حلقه را *برمی‌گرداند* تا کسی که باید تعمیر کند، بداند کجا.
 */
create or replace function ops.feature_dependency_cycles()
returns table (cycle text[])
language sql
stable
security definer
set search_path = pg_catalog, ops
as $$
  with recursive walk as (
    select
      d.feature_key as start_key,
      d.depends_on_key as node,
      array[d.feature_key, d.depends_on_key] as path,
      false as closed
    from ops.feature_dependency d
    union all
    select
      w.start_key,
      d.depends_on_key,
      w.path || d.depends_on_key,
      d.depends_on_key = w.start_key
    from walk w
    join ops.feature_dependency d on d.feature_key = w.node
    /*
     * دو شرط، با یک استثنا:
     *   • اگر گره بعدی، گرهٔ آغازین باشد، حلقه بسته می‌شود ⇒ ثبت.
     *   • اگر در مسیر دیده شده (و آغازین نیست)، مسیر تکراری است ⇒ ادامه نده.
     */
    where not w.closed
      and (d.depends_on_key = w.start_key or not d.depends_on_key = any (w.path))
  )
  select distinct w.path
  from walk w
  where w.closed and array_length(w.path, 1) > 1
$$;

comment on function ops.feature_dependency_cycles is 'حلقه‌های گراف وابستگی فیچرها (Addendum §21–۲۴)';

/**
 * حذف ایمن: آیا این فیچر قابل بایگانی است؟
 *
 * پاسخ، فهرست *مانع‌ها* است نه یک «بله/نه»: کسی که می‌خواهد بایگانی کند باید
 * بداند چه چیزی به آن وابسته است و باید اول چه‌کاری بکند.
 */
create or replace function ops.feature_removal_blockers(p_feature_key text)
returns table (blocker text, detail text)
language sql
stable
security definer
set search_path = pg_catalog, ops
as $$
  select 'dependent_feature'::text,
         format('فیچر «%s» به آن وابسته است (%s)', d.feature_key, d.kind)
  from ops.feature_dependency d
  join ops.feature f on f.key = d.feature_key
  where d.depends_on_key = p_feature_key
    and f.status not in ('deprecated', 'archived')

  union all

  select 'not_deprecated'::text,
         format('وضعیت فعلی «%s» است؛ پیش از بایگانی باید به «deprecated» برود', f.status)
  from ops.feature f
  where f.key = p_feature_key and f.status not in ('deprecated', 'archived')

  union all

  select 'dangling_dependency'::text,
         format('به «%s» وابسته است که هنوز منتشر نشده', d.depends_on_key)
  from ops.feature_dependency d
  join ops.feature dep on dep.key = d.depends_on_key
  join ops.feature f on f.key = d.feature_key
  where d.feature_key = p_feature_key
    and f.status in ('deprecated', 'archived')
    and dep.status not in ('published', 'approved')
$$;

comment on function ops.feature_removal_blockers is 'مانع‌های حذف ایمن یک فیچر (Addendum §21–۲۴)';

-- ------------------------------------------------------------------ چرخهٔ عمر فیچر
/**
 * جدول گذرهای مجاز چرخهٔ عمر فیچر (Addendum §21–۲۴).
 *
 * `draft → development → preview → testing → approved → published`، و از آنجا
 * `deprecated → archived`. گذر «عقب» هم مجاز است (مثلاً `published → deprecated`
 * یا `testing → development`)، ولی هر گذر باید صریح باشد.
 */
create or replace function ops.feature_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select (p_from, p_to) in (
    ('draft', 'development'),
    ('development', 'preview'),
    ('development', 'draft'),
    ('preview', 'testing'),
    ('preview', 'development'),
    ('testing', 'approved'),
    ('testing', 'development'),
    ('approved', 'published'),
    ('approved', 'testing'),
    ('published', 'deprecated'),
    ('deprecated', 'archived'),
    ('deprecated', 'published'),
    ('archived', 'draft')
  )
$$;

comment on function ops.feature_transition_allowed is 'گذرهای مجاز چرخهٔ عمر فیچر (Addendum §21–۲۴)';

/**
 * گذر وضعیت فیچر، با قیدهای واقعی.
 *
 * نکتهٔ مهم: «انتشار» بی‌دروازه نیست. فیچر در وضعیت `approved` فقط وقتی منتشر
 * می‌شود که وابستگی‌های سختش منتشرشده باشند و بودجهٔ عملکردش تعریف شده باشد —
 * وگرنه فیچری منتشر می‌شود که «سریع بودنش» اندازه‌گیری نمی‌شود (§1–۴).
 */
create or replace function ops.transition_feature(
  p_key text,
  p_to text,
  p_note text default null
)
returns ops.feature
language plpgsql
security definer
set search_path = pg_catalog, ops
as $$
declare
  v_before ops.feature;
  v_after ops.feature;
  v_missing text;
  v_budget integer;
begin
  if not app.has_platform_permission('platform.feature.manage') then
    raise exception 'مجوز «platform.feature.manage» لازم است' using errcode = 'insufficient_privilege';
  end if;

  select * into v_before from ops.feature f where f.key = p_key for update;

  if not found then
    raise exception 'فیچر «%» پیدا نشد', p_key using errcode = 'no_data_found';
  end if;

  if not ops.feature_transition_allowed(v_before.status, p_to) then
    raise exception 'گذر از «%» به «%» برای فیچر مجاز نیست', v_before.status, p_to
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if p_to = 'published' then
    select string_agg(d.depends_on_key, ', ')
      into v_missing
    from ops.feature_dependency d
    join ops.feature dep on dep.key = d.depends_on_key
    where d.feature_key = p_key
      and d.kind = 'hard'
      and dep.status <> 'published';

    if v_missing is not null then
      raise exception 'وابستگی سختِ منتشرنشده: %', v_missing using errcode = 'object_not_in_prerequisite_state';
    end if;

    if not (v_before.performance_budget ? 'lcp_ms') then
      raise exception 'بودجهٔ عملکرد تعریف نشده: فیچر بدون lcp_ms منتشر نمی‌شود'
        using errcode = 'object_not_in_prerequisite_state';
    end if;
  end if;

  if p_to in ('deprecated', 'archived') then
    select count(*)::int into v_budget from ops.feature_removal_blockers(p_key);
    if v_budget > 0 and p_to = 'archived' then
      raise exception 'بایگانی این فیچر مانع دارد؛ ابتدا بایگانی همهٔ وابسته‌ها'
        using errcode = 'object_not_in_prerequisite_state';
    end if;
  end if;

  update ops.feature
     set status = p_to,
         deprecated_at = case when p_to = 'deprecated' then coalesce(deprecated_at, now()) else deprecated_at end,
         archived_at = case when p_to = 'archived' then coalesce(archived_at, now()) else archived_at end,
         description = case when p_note is null then description else description end
   where key = p_key
  returning * into v_after;

  perform app.emit_event('feature.status_changed', 'feature', p_key, null,
    jsonb_build_object('from', v_before.status, 'to', p_to, 'note', p_note));

  perform app.record_audit('feature.' || p_to, 'feature', p_key, null,
    jsonb_build_object('status', v_before.status), jsonb_build_object('status', p_to, 'note', p_note));

  return v_after;
end
$$;

comment on function ops.transition_feature is 'گذر چرخهٔ عمر فیچر با قید وابستگی و بودجه (Addendum §21–۲۴)';

revoke all on function ops.feature_dependency_cycles() from public;
revoke all on function ops.feature_removal_blockers(text) from public;
revoke all on function ops.feature_transition_allowed(text, text) from public;
revoke all on function ops.transition_feature(text, text, text) from public;
grant execute on function ops.feature_dependency_cycles() to pv_app, pv_worker, pv_reader;
grant execute on function ops.feature_removal_blockers(text) to pv_app, pv_worker, pv_reader;
grant execute on function ops.feature_transition_allowed(text, text) to pv_app, pv_worker, pv_reader;
grant execute on function ops.transition_feature(text, text, text) to pv_app, pv_worker;

-- ------------------------------------------------------------------ بودجهٔ عملکرد
/**
 * بودجهٔ عملکرد، به تفکیک «الگوی مسیر».
 *
 * چرا الگوی مسیر و نه صفحهٔ مشخص: بودجه برای *نوع* صفحه معنا دارد؛
 * «/b/:slug» همیشه یک قالب است، ولی هزار کسب‌وکار دارد. بودجهٔ هر صفحهٔ تازه
 * از خاص‌ترین الگو ارث می‌برد.
 */
create table ops.page_budget (
  id uuid primary key default gen_random_uuid(),
  /** الگوی مسیر با پارامتر: `/b/:slug`, `/blog/:slug`, `/`. */
  route_pattern text not null check (length(route_pattern) between 1 and 200),
  scope text not null default 'platform' check (scope in ('platform', 'business', 'admin', 'shop')),
  name_fa text not null,
  lcp_ms integer not null check (lcp_ms between 100 and 20000),
  inp_ms integer not null check (inp_ms between 10 and 5000),
  cls numeric(4, 3) not null check (cls >= 0 and cls <= 1),
  ttfb_ms integer check (ttfb_ms is null or ttfb_ms between 10 and 5000),
  /** وزن صفحه به کیلوبایت؛ سقف کل منابع. */
  weight_kb integer check (weight_kb is null or weight_kb between 10 and 20000),
  request_count integer check (request_count is null or request_count between 1 and 2000),
  api_p95_ms integer check (api_p95_ms is null or api_p95_ms between 10 and 10000),
  /**
   * درصد نمونه‌گیری RUM برای این الگو (Addendum §91–۹۵).
   *
   * صفر مجاز است و معنی روشنی دارد: «این الگو بیرون از دامنهٔ RUM است».
   * مسیرهای احراز هویت عمداً صفر‌اند: سنجش میدانی روی صفحه‌ای که نشانی‌اش
   * می‌تواند توکن یک‌بارمصرف داشته باشد، خودش یک نشت است. بودجهٔ این مسیرها
   * بی‌سنجه نمی‌ماند؛ در خط لولهٔ انتشار و در اندازه‌گیری آزمایشگاهی سنجیده
   * می‌شود.
   */
  rum_sample_rate numeric(4, 3) not null default 0.1 check (rum_sample_rate >= 0 and rum_sample_rate <= 1),
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

comment on table ops.page_budget is 'بودجهٔ عملکرد هر الگوی مسیر؛ مبنای دروازهٔ انتشار (Addendum §1–۴، §96)';

create unique index page_budget_route_scope_idx on ops.page_budget (scope, route_pattern);
create index page_budget_active_idx on ops.page_budget (is_active, scope);

create trigger page_budget_touch
  before update on ops.page_budget
  for each row execute function app.touch();

alter table ops.page_budget enable row level security;

create policy page_budget_read on ops.page_budget
  for select to pv_app, pv_public, pv_worker, pv_reader using (true);

create policy page_budget_write on ops.page_budget
  for all to pv_app, pv_worker
  using (app.has_platform_permission('platform.feature.manage'))
  with check (app.has_platform_permission('platform.feature.manage'));

revoke all on ops.page_budget from public;
grant select, insert, update, delete on ops.page_budget to pv_app, pv_worker;
grant select on ops.page_budget to pv_public, pv_reader;

/**
 * انتخاب بودجهٔ یک مسیر: خاص‌ترین الگو برنده است.
 *
 * `/b/tak-pet` باید بودجهٔ `/b/:slug` را بگیرد، نه بودجهٔ `/` را. مقایسه بر
 * پایهٔ «تعداد بخش‌های ثابت» است؛ همان قاعده‌ای که در انتخاب قالب سئو و
 * تطبیق تغییر مسیر هم به کار رفت (§103: یک قاعده، همه‌جا).
 */
create or replace function ops.budget_for_route(p_path text)
/*
 * `setof` و نه یک مقدار تکی.
 *
 * تفاوتش یک باگ واقعی بود: تابعی که `returns <جدول>` است، وقتی هیچ ردیفی پیدا
 * نکند یک «ردیف تهی» برمی‌گرداند — نه «هیچ». نتیجه: `check_budget` روی مسیر
 * بی‌بودجه، ردیف تهی را «بودجهٔ پیدا‌شده» حساب می‌کرد و رأی «قبول» می‌داد؛
 * یعنی دقیقاً همان مسیری که هیچ‌چیز اندازه‌گیری نمی‌شد، سالم به نظر می‌رسید.
 */
returns setof ops.page_budget
language sql
stable
security definer
set search_path = pg_catalog, ops
as $$
  select b.*
  from ops.page_budget b
  where b.is_active
    and (
      b.route_pattern = p_path
      or (
        position(':' in b.route_pattern) > 0
        and p_path like replace(replace(b.route_pattern, '/:', '/%'), ':slug', '%')
      )
      or (
        position(':' in b.route_pattern) > 0
        and array_length(string_to_array(trim(both '/' from b.route_pattern), '/'), 1)
            = array_length(string_to_array(trim(both '/' from p_path), '/'), 1)
        and split_part(trim(both '/' from b.route_pattern), '/', 1) = split_part(trim(both '/' from p_path), '/', 1)
      )
    )
  order by
    case when b.route_pattern = p_path then 0 else 1 end,
    length(replace(b.route_pattern, ':', '')) desc
  limit 1
$$;

comment on function ops.budget_for_route is 'بودجهٔ متناظر یک مسیر؛ خاص‌ترین الگو برنده (Addendum §1–۴)';

/**
 * سنجش یک اندازه‌گیری با بودجه — «قبول/رد» به‌جای «عدد خام».
 *
 * ورودی، اندازه‌گیری است (همان شکلی که RUM می‌فرستد) و خروجی، رأی به‌همراه
 * فهرست تخطی‌ها. دروازهٔ انتشار همین را می‌خواند.
 */
create or replace function ops.check_budget(p_path text, p_measurement jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, ops
as $$
declare
  v_budget ops.page_budget;
  v_breaches jsonb := '[]'::jsonb;
  v_lcp numeric;
  v_inp numeric;
  v_cls numeric;
  v_weight numeric;
  v_requests numeric;
  v_api numeric;
begin
  select * into v_budget from ops.budget_for_route(p_path);

  if not found then
    return jsonb_build_object(
      'route', p_path,
      'matched', false,
      'verdict', 'unbudgeted',
      'message', 'برای این مسیر بودجه‌ای تعریف نشده است؛ یعنی هیچ‌چیز اندازه‌گیری نمی‌شود.',
      'breaches', v_breaches
    );
  end if;

  v_lcp := (p_measurement ->> 'lcp_ms')::numeric;
  v_inp := (p_measurement ->> 'inp_ms')::numeric;
  v_cls := (p_measurement ->> 'cls')::numeric;
  v_weight := (p_measurement ->> 'weight_kb')::numeric;
  v_requests := (p_measurement ->> 'request_count')::numeric;
  v_api := (p_measurement ->> 'api_p95_ms')::numeric;

  if v_lcp is not null and v_lcp > v_budget.lcp_ms then
    v_breaches := v_breaches || jsonb_build_object('metric', 'lcp_ms', 'budget', v_budget.lcp_ms, 'actual', v_lcp);
  end if;
  if v_inp is not null and v_inp > v_budget.inp_ms then
    v_breaches := v_breaches || jsonb_build_object('metric', 'inp_ms', 'budget', v_budget.inp_ms, 'actual', v_inp);
  end if;
  if v_cls is not null and v_cls > v_budget.cls then
    v_breaches := v_breaches || jsonb_build_object('metric', 'cls', 'budget', v_budget.cls, 'actual', v_cls);
  end if;
  if v_weight is not null and v_budget.weight_kb is not null and v_weight > v_budget.weight_kb then
    v_breaches := v_breaches || jsonb_build_object('metric', 'weight_kb', 'budget', v_budget.weight_kb, 'actual', v_weight);
  end if;
  if v_requests is not null and v_budget.request_count is not null and v_requests > v_budget.request_count then
    v_breaches := v_breaches || jsonb_build_object('metric', 'request_count', 'budget', v_budget.request_count, 'actual', v_requests);
  end if;
  if v_api is not null and v_budget.api_p95_ms is not null and v_api > v_budget.api_p95_ms then
    v_breaches := v_breaches || jsonb_build_object('metric', 'api_p95_ms', 'budget', v_budget.api_p95_ms, 'actual', v_api);
  end if;

  return jsonb_build_object(
    'route', p_path,
    'matched', true,
    'budget_id', v_budget.id,
    'route_pattern', v_budget.route_pattern,
    'verdict', case when jsonb_array_length(v_breaches) = 0 then 'pass' else 'fail' end,
    'breaches', v_breaches
  );
end
$$;

comment on function ops.check_budget is 'سنجش اندازه‌گیری با بودجهٔ مسیر؛ رأی قبول/رد (Addendum §1–۴، §96)';

-- ------------------------------------------------------------------ دروازهٔ انتشار
/**
 * دروازهٔ انتشار: پیش از انتشار، چه چیزهایی مانع‌اند؟
 *
 * این تابع، **انتخاب‌گر** است نه تصمیم‌گیر: هر بررسی، یک ردیف با نام و شدت
 * برمی‌گرداند و خط لولهٔ انتشار (Addendum — Publish Pipeline) با آن تصمیم
 * می‌گیرد. عمداً یک «بله/نه» برنمی‌گرداند، چون کسی که انتشار را متوقف می‌کند
 * باید بداند *چرا*، وگرنه دروازه به مانع کور تبدیل می‌شود.
 */
create or replace function ops.publish_gate(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, ops, app, design, seo
as $$
declare
  v_blockers jsonb := '[]'::jsonb;
  v_feature_missing jsonb;
  v_unbudgeted jsonb;
  v_seo_missing jsonb;
  v_design_blockers jsonb;
begin
  if p_business_id is not null
     and (app.current_user_id() is null or not app.is_member_of(p_business_id))
     and app.current_platform_role() is null then
    raise exception 'برای خواندن دروازهٔ انتشار، عضویت یا نقش پلتفرمی لازم است'
      using errcode = 'insufficient_privilege';
  end if;

  -- ۱. فیچرهایی که پیش‌نیاز انتشارند ولی منتشر نشده‌اند.
  select jsonb_agg(jsonb_build_object('key', f.key, 'status', f.status))
    into v_feature_missing
  from ops.feature f
  where f.status in ('draft', 'development');

  if v_feature_missing is not null then
    v_blockers := v_blockers || jsonb_build_object(
      'gate', 'features',
      'severity', 'warning',
      'message', 'فیچرهایی در وضعیت پیش از تأیید مانده‌اند.',
      'details', v_feature_missing
    );
  end if;

  -- ۲. مسیرهای پرترافیک بدون بودجه.
  select jsonb_agg(b.route_pattern)
    into v_unbudgeted
  from ops.page_budget b
  where not b.is_active;

  if v_unbudgeted is not null then
    v_blockers := v_blockers || jsonb_build_object(
      'gate', 'performance_budget',
      'severity', 'info',
      'message', 'بودجهٔ غیرفعال: این مسیرها اندازه‌گیری نمی‌شوند.',
      'details', v_unbudgeted
    );
  end if;

  -- ۳. محتوای منتشرشدهٔ این کسب‌وکار که فرادادهٔ سئو ندارد.
  if p_business_id is not null then
    select jsonb_agg(jsonb_build_object('content_id', c.id, 'slug', c.slug))
      into v_seo_missing
    from app.content c
    where c.business_id = p_business_id
      and c.status = 'published'
      and c.deleted_at is null
      and not exists (
        select 1 from seo.metadata m
        where m.entity_kind = 'content' and m.entity_id = c.id
      );

    if v_seo_missing is not null then
      v_blockers := v_blockers || jsonb_build_object(
        'gate', 'seo_metadata',
        'severity', 'blocker',
        'message', 'محتوای منتشرشده بدون فرادادهٔ سئو منتشر شده است.',
        'details', v_seo_missing
      );
    end if;

    -- ۴. درخت صفحهٔ منتشرنشدهٔ آمادهٔ انتشار؟ بررسی ساختاری پیش‌نویس.
    select jsonb_agg(jsonb_build_object('page_id', p.id, 'findings', f.value))
      into v_design_blockers
    from design.page p
    cross join lateral (
      select jsonb_agg(item) as value
      from jsonb_array_elements(design.validate_tree(p.draft_tree)) as item
      where item ->> 'severity' = 'blocker'
    ) f
    where p.business_id = p_business_id
      and p.status <> 'published'
      and jsonb_array_length(f.value) > 0;

    if v_design_blockers is not null then
      v_blockers := v_blockers || jsonb_build_object(
        'gate', 'design_structure',
        'severity', 'blocker',
        'message', 'پیش‌نویس صفحه، یافتهٔ بازدارنده دارد.',
        'details', v_design_blockers
      );
    end if;
  end if;

  return jsonb_build_object(
    'business_id', p_business_id,
    'checked_at', now(),
    'verdict', case
      when exists (
        select 1 from jsonb_array_elements(v_blockers) as item where item ->> 'severity' = 'blocker'
      ) then 'blocked'
      else 'pass'
    end,
    'blockers', v_blockers
  );
end
$$;

comment on function ops.publish_gate is
  'دروازهٔ انتشار: فهرست مانع‌ها با شدت، برای خط لولهٔ انتشار (Addendum §96)';

revoke all on function ops.budget_for_route(text) from public;
revoke all on function ops.check_budget(text, jsonb) from public;
revoke all on function ops.publish_gate(uuid) from public;
grant execute on function ops.budget_for_route(text) to pv_app, pv_public, pv_worker, pv_reader;
grant execute on function ops.check_budget(text, jsonb) to pv_app, pv_public, pv_worker, pv_reader;
grant execute on function ops.publish_gate(uuid) to pv_app, pv_worker;
