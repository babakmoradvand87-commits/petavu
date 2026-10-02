-- ============================================================================
-- 0010_automation — موتور خودکارسازی: قاعده WHEN→IF→THEN، اجرا، اعلان
--
-- چرا در پایگاه‌داده و نه در کد: قاعدهٔ خودکارسازی، *داده* است — کاربر پنل
-- می‌سازدش و ویرایشش می‌کند. اگر در کد باشد، هر قاعده یعنی یک انتشار تازه.
-- اگر داده باشد، باید قیدهایش هم داده باشند: قاعدهٔ خاموش، قاعدهٔ در سقف،
-- قاعده‌ای که یک رخداد را دوبار اجرا نمی‌کند (§180).
--
-- مرجع: Addendum §56–۷۲ (Event pipeline، Queue، Automation، Notification)،
--       §74 (No-Code نمی‌تواند از مرز امنیتی بگذرد)، §100 (هیچ فیچری جزیره نیست)
-- ============================================================================

-- ------------------------------------------------------------------ قاعده
create table ops.automation_rule (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references app.business (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_.]{2,60}$'),
  name_fa text not null check (length(btrim(name_fa)) between 2 and 120),
  description text,

  /** WHEN: نام رخداد؛ با نقطه و در همان فضای نام رخدادهای دامنه. */
  event_type text not null check (position('.' in event_type) > 1),

  /*
   * IF: شرایط، داده است نه کد (§74).
   *
   * شکل: `{"all":[{...}], "any":[{...}]}` و هر شرط `{"path":"...","op":"...","value":...}`.
   * عملگرهای مجاز در `ops.condition_matches` بسته‌اند؛ هیچ رشتهٔ SQL اجرا نمی‌شود.
   */
  conditions jsonb not null default '{"all":[]}'::jsonb,

  /*
   * THEN: کنش‌ها، داده است نه کد.
   *
   * کنش‌های مجاز بسته‌اند: notify / emit_event / enqueue_job / webhook.
   * هیچ کنش «اجرای کد» وجود ندارد و اضافه هم نمی‌شود (§74، §96).
   */
  actions jsonb not null default '[]'::jsonb,

  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'archived')),
  priority smallint not null default 100 check (priority between 0 and 1000),

  /** حداقل فاصلهٔ دو اجرا برای یک رخداد مشابه؛ جلوگیری از طوفان. */
  cooldown_seconds integer not null default 0 check (cooldown_seconds between 0 and 86400),
  /** سقف اجرا در شبانه‌روز؛ ۰ یعنی بی‌سقف. */
  max_runs_per_day integer not null default 0 check (max_runs_per_day between 0 and 100000),
  /** آزمون خشک: کنش‌ها فقط ثبت می‌شوند و اجرا نمی‌شوند. */
  dry_run boolean not null default false,
  /** قاعدهٔ سیستمی، از seed می‌آید و کاربر آن را حذف نمی‌کند. */
  is_system boolean not null default false,
  created_by uuid references auth.app_user (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint automation_actions_shape check (jsonb_typeof(actions) = 'array'),
  constraint automation_conditions_shape check (jsonb_typeof(conditions) = 'object')
);

comment on table ops.automation_rule is 'قاعده‌های خودکارسازی WHEN→IF→THEN؛ قاعده = داده، نه کد (Addendum §56–۷۲)';

create unique index automation_rule_key_idx
  on ops.automation_rule (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), key);
create index automation_rule_event_idx on ops.automation_rule (event_type, status, priority);
create index automation_rule_business_idx on ops.automation_rule (business_id) where business_id is not null;

create trigger automation_rule_touch
  before update on ops.automation_rule
  for each row execute function app.touch();

-- ------------------------------------------------------------------ دفتر اجرا
create table ops.automation_run (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references ops.automation_rule (id) on delete cascade,
  event_id uuid not null references ops.event (id) on delete cascade,
  event_type text not null,
  business_id uuid,
  status text not null default 'matched' check (status in ('matched', 'skipped', 'succeeded', 'failed', 'dry_run')),
  /** چرا رد شد: cooldown، سقف روزانه، شرط برقرار نشدن. */
  skip_reason text,
  actions_result jsonb not null default '[]'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  constraint automation_run_finished_shape check ((status in ('succeeded', 'failed', 'dry_run', 'skipped')) = (finished_at is not null))
);

comment on table ops.automation_run is 'دفتر اجرای قاعده‌ها؛ مبنای پایش و اشکال‌زدایی (Addendum §56–۷۲)';

/*
 * یکتایی: هر قاعده، هر رخداد را یک‌بار.
 *
 * این تنها چیزی است که «دوبار اجرا نشدن» را تضمین می‌کند — نه دقت کد. اگر
 * کارگر صف وسط کار بمیرد و کار دوباره برداشته شود، درج دوم با تعارض رد
 * می‌شود و اثر دوباره اتفاق نمی‌افتد (§180).
 */
create unique index automation_run_once_idx on ops.automation_run (rule_id, event_id);
create index automation_run_rule_idx on ops.automation_run (rule_id, started_at desc);
create index automation_run_business_idx on ops.automation_run (business_id, started_at desc) where business_id is not null;
create index automation_run_failures_idx on ops.automation_run (started_at desc) where status = 'failed';

create trigger automation_run_append_only
  before delete on ops.automation_run
  for each row execute function app.forbid_mutation();

-- ------------------------------------------------------------------ اعلان
create table ops.notification (
  id uuid primary key default gen_random_uuid(),
  /** گیرنده: کاربر. اعلان کسب‌وکاری هم به کاربر می‌رسد، نه به یک «حساب». */
  recipient_user_id uuid not null references auth.app_user (id) on delete cascade,
  business_id uuid references app.business (id) on delete cascade,
  kind text not null check (position('.' in kind) > 1),
  severity text not null default 'info' check (severity in ('info', 'success', 'warning', 'critical')),
  title text not null check (length(btrim(title)) between 2 and 200),
  body text,
  /** پیوند کنش‌پذیر در پنل؛ مسیر نسبی، نه نشانی کامل. */
  action_path text check (action_path is null or action_path like '/%'),
  data jsonb not null default '{}'::jsonb,
  channel text not null default 'in_app' check (channel in ('in_app', 'email', 'sms', 'webhook', 'push')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'read')),
  rule_id uuid references ops.automation_rule (id) on delete set null,
  /** هم‌بستگی با رخدادی که این اعلان را ساخت (Addendum — Correlation). */
  correlation_id uuid,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  read_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  constraint notification_read_shape check ((status = 'read') = (read_at is not null))
);

comment on table ops.notification is 'اعلان‌های کاربر؛ ساخته‌شده از قاعده یا سیستم (Addendum §56–۷۲)';

create index notification_recipient_idx on ops.notification (recipient_user_id, created_at desc);
create index notification_unread_idx on ops.notification (recipient_user_id) where read_at is null;
create index notification_pending_idx on ops.notification (created_at) where status = 'pending';
create index notification_business_idx on ops.notification (business_id, created_at desc) where business_id is not null;

alter table ops.automation_rule enable row level security;
alter table ops.automation_run enable row level security;
alter table ops.notification enable row level security;

-- قاعدهٔ کسب‌وکاری: ساختش مجوز می‌خواهد، ولی *فعال‌کردن* آن هم مجوز می‌خواهد
-- (چون قاعده، کنش انجام می‌دهد). قاعدهٔ سراسری فقط دست کارکنان است.
create policy automation_rule_member_select on ops.automation_rule
  for select to pv_app
  using (business_id is not null and app.is_member_of(business_id));

create policy automation_rule_member_write on ops.automation_rule
  for all to pv_app
  using (business_id is not null and app.has_permission(business_id, 'automation.manage'))
  with check (business_id is not null and app.has_permission(business_id, 'automation.manage'));

create policy automation_rule_staff_all on ops.automation_rule
  for all to pv_app, pv_worker
  using (app.has_platform_permission('platform.automation.manage'))
  with check (app.has_platform_permission('platform.automation.manage'));

create policy automation_rule_worker_all on ops.automation_rule
  for all to pv_worker
  using (true)
  with check (true);

create policy automation_rule_reader on ops.automation_rule
  for select to pv_reader
  using (true);

create policy automation_run_member_select on ops.automation_run
  for select to pv_app
  using (business_id is not null and app.is_member_of(business_id));

create policy automation_run_staff_select on ops.automation_run
  for select to pv_app
  using (app.has_platform_permission('platform.automation.manage'));

create policy automation_run_worker_all on ops.automation_run
  for all to pv_worker
  using (true)
  with check (true);

create policy automation_run_reader on ops.automation_run
  for select to pv_reader
  using (true);

create policy notification_self_select on ops.notification
  for select to pv_app
  using (recipient_user_id = app.current_user_id());

create policy notification_self_update on ops.notification
  for update to pv_app
  using (recipient_user_id = app.current_user_id())
  with check (recipient_user_id = app.current_user_id());

create policy notification_staff_all on ops.notification
  for all to pv_app, pv_worker
  using (app.has_platform_permission('platform.automation.manage'))
  with check (app.has_platform_permission('platform.automation.manage'));

create policy notification_worker_all on ops.notification
  for all to pv_worker
  using (true)
  with check (true);

create policy notification_reader on ops.notification
  for select to pv_reader
  using (true);

revoke all on ops.automation_rule, ops.automation_run, ops.notification from public;
grant select, insert, update, delete on ops.automation_rule to pv_app;
grant select on ops.automation_run to pv_app;
grant select on ops.notification to pv_app;
grant update on ops.notification to pv_app;
grant select, insert, update, delete on ops.automation_rule, ops.automation_run, ops.notification to pv_worker;
grant select on ops.automation_rule, ops.automation_run, ops.notification to pv_reader;

-- ------------------------------------------------------------------ ارزیابی شرط
/**
 * ارزیابی یک شرط روی داده.
 *
 * عملگرها **بسته** هستند و هیچ‌کدام رشتهٔ SQL اجرا نمی‌کند. این همان مرزی است
 * که §74 می‌کشد: No-Code می‌تواند «بگو اگر مبلغ سفارش بیش از ۵ میلیون بود» را
 * بسازد، ولی نمی‌تواند «این کوئری را اجرا کن» را.
 *
 * مسیر (`path`) با نقطه جدا می‌شود و در دادهٔ تودرتوی رخداد پیش می‌رود؛
 * `a.b.0.c` هم پشتیبانی می‌شود.
 */
create or replace function ops.condition_matches(p_condition jsonb, p_data jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  v_op text := coalesce(p_condition ->> 'op', 'eq');
  v_path text := coalesce(p_condition ->> 'path', '');
  v_expected jsonb := p_condition -> 'value';
  v_actual jsonb;
  v_number numeric;
begin
  if v_path = '' then
    return false;
  end if;

  -- پیمایش مسیر، با آزمودن گام‌به‌گام تا مسیر نامعتبر خطا ندهد.
  begin
    v_actual := p_data #> string_to_array(v_path, '.');
  exception when others then
    return false;
  end;

  case v_op
    when 'exists' then
      return v_actual is not null and jsonb_typeof(v_actual) <> 'null';

    when 'not_exists' then
      return v_actual is null or jsonb_typeof(v_actual) = 'null';

    when 'eq' then
      return v_actual is not null and v_actual = v_expected;

    when 'neq' then
      return v_actual is distinct from v_expected;

    when 'gt', 'gte', 'lt', 'lte' then
      if jsonb_typeof(v_actual) <> 'number' or jsonb_typeof(v_expected) <> 'number' then
        return false;
      end if;
      v_number := (v_actual)::text::numeric;
      return case v_op
        when 'gt' then v_number > (v_expected)::text::numeric
        when 'gte' then v_number >= (v_expected)::text::numeric
        when 'lt' then v_number < (v_expected)::text::numeric
        else v_number <= (v_expected)::text::numeric
      end;

    /*
     * `in` / `not_in`: مقدار فیلد، عضوی از فهرست است.
     *
     * با `?` نوشته نشد چون آن عملگر عنصر رشته‌ای را می‌بیند و روی عددها
     * («۷۵۰۰۰۰۰ در فهرست [7500000, 1]») پاسخ اشتباه می‌دهد. مقایسه با
     * برابریِ jsonb انجام می‌شود که عدد و رشته را درست می‌سنجد.
     */
    when 'in' then
      return jsonb_typeof(v_expected) = 'array'
        and exists (select 1 from jsonb_array_elements(v_expected) as item where item = v_actual);

    when 'not_in' then
      return jsonb_typeof(v_expected) = 'array'
        and not exists (select 1 from jsonb_array_elements(v_expected) as item where item = v_actual);

    /* `any_of` / `all_of` / `none_of`: فیلد خودش آرایه است. */
    when 'any_of' then
      return jsonb_typeof(v_expected) = 'array'
        and jsonb_typeof(v_actual) = 'array'
        and exists (select 1 from jsonb_array_elements(v_expected) as item where v_actual @> jsonb_build_array(item));

    when 'all_of' then
      return jsonb_typeof(v_expected) = 'array'
        and jsonb_typeof(v_actual) = 'array'
        and not exists (select 1 from jsonb_array_elements(v_expected) as item where not v_actual @> jsonb_build_array(item));

    when 'none_of' then
      return jsonb_typeof(v_expected) = 'array'
        and jsonb_typeof(v_actual) = 'array'
        and not exists (select 1 from jsonb_array_elements(v_expected) as item where v_actual @> jsonb_build_array(item));

    when 'contains' then
      return v_actual is not null and v_actual @> v_expected;

    when 'empty' then
      return v_actual is null
        or jsonb_typeof(v_actual) = 'null'
        or v_actual = '""'::jsonb
        or v_actual = '[]'::jsonb
        or v_actual = '{}'::jsonb;

    else
      -- عملگر ناشناخته، «نمی‌داند» است نه «درست»: رد می‌شود.
      return false;
  end case;
end
$$;

comment on function ops.condition_matches is
  'ارزیابی شرط قاعده با عملگرهای بسته؛ هیچ SQL پویایی اجرا نمی‌شود (§74)';

/**
 * ارزیابی کل شرط‌های یک قاعده.
 *
 * ساختار: `{"all":[…], "any":[…], "not":[…]}`. خالی بودن بخش‌ها یعنی «قیدی
 * نیست». اگر هیچ شرطی نباشد، قاعده برای هر رخداد آن نوع اجرا می‌شود.
 */
create or replace function ops.rule_matches(p_rule ops.automation_rule, p_payload jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  v_all jsonb := coalesce(p_rule.conditions -> 'all', '[]'::jsonb);
  v_any jsonb := coalesce(p_rule.conditions -> 'any', '[]'::jsonb);
  v_not jsonb := coalesce(p_rule.conditions -> 'not', '[]'::jsonb);
begin
  if jsonb_typeof(v_all) = 'array' and jsonb_array_length(v_all) > 0 then
    if exists (
      select 1 from jsonb_array_elements(v_all) as item
      where not ops.condition_matches(item, p_payload)
    ) then
      return false;
    end if;
  end if;

  if jsonb_typeof(v_any) = 'array' and jsonb_array_length(v_any) > 0 then
    if not exists (
      select 1 from jsonb_array_elements(v_any) as item
      where ops.condition_matches(item, p_payload)
    ) then
      return false;
    end if;
  end if;

  if jsonb_typeof(v_not) = 'array' and jsonb_array_length(v_not) > 0 then
    if exists (
      select 1 from jsonb_array_elements(v_not) as item
      where ops.condition_matches(item, p_payload)
    ) then
      return false;
    end if;
  end if;

  return true;
end
$$;

comment on function ops.rule_matches is 'ارزیابی شرط‌های all/any/not یک قاعده (Addendum §56–۷۲)';

-- ------------------------------------------------------------------ اجرا
/**
 * قاعده‌های متناظر یک رخداد، به ترتیب اولویت.
 *
 * قاعدهٔ خاموش، قاعدهٔ در دورهٔ انتظار (cooldown) و قاعده‌ای که سقف روزانه‌اش
 * پر شده، حتی برنمی‌گردد — نه اینکه در کد بعداً رد شود. «سقف» باید در
 * پایگاه‌داده باشد، وگرنه چند کارگر موازی، سقف را چند برابر می‌کنند.
 */
create or replace function ops.matching_rules(p_event_id uuid)
returns table (rule ops.automation_rule, skip_reason text)
language sql
stable
security definer
set search_path = pg_catalog, ops
as $$
  select
    r,
    case
      when r.status <> 'active' then 'rule_' || r.status
      when r.business_id is not null and (e.business_id is null or e.business_id <> r.business_id)
        then 'scope_mismatch'
      when not ops.rule_matches(r, e.payload) then 'condition_not_met'
      when r.cooldown_seconds > 0 and exists (
        select 1 from ops.automation_run run
        where run.rule_id = r.id
          and run.status in ('succeeded', 'dry_run')
          and run.started_at > now() - make_interval(secs => r.cooldown_seconds)
      ) then 'cooldown'
      when r.max_runs_per_day > 0 and (
        select count(*) from ops.automation_run run
        where run.rule_id = r.id
          and run.status in ('succeeded', 'dry_run')
          and run.started_at > now() - interval '1 day'
      ) >= r.max_runs_per_day then 'daily_cap'
      else null
    end as skip_reason
  /*
   * `join` و نه `lateral`.
   *
   * معنای اینجا یکی است، ولی `lateral` در PGlite 0.5.8 (PostgreSQL 18 روی wasm)
   * وقتی با ستون خروجیِ نوع مرکب در یک تابع SQL جمع شود، خطای درونی
   * «nsitem not found» می‌دهد. شکل `join` همان نتیجه را بدون آن خطا می‌دهد —
   * و همان‌قدر صریح است.
   */
  from ops.event e
  join ops.automation_rule r on r.event_type = e.event_type
  where e.id = p_event_id
  order by r.priority, r.created_at
$$;

comment on function ops.matching_rules is 'قاعده‌های متناظر رخداد با دلیل رد، پیش از اجرا (Addendum §56–۷۲)';

/**
 * اجرای کنش‌های یک قاعده روی یک رخداد.
 *
 * کنش‌های مجاز — و بس:
 *   • `{"type":"notify","user_path":"actor.id","title":"…","body":"…","kind":"…"}`
 *     گیرنده از خود رخداد خوانده می‌شود، نه از ورودی آزاد؛ وگرنه یک قاعده
 *     می‌توانست به همه اعلان بفرستد.
 *   • `{"type":"emit_event","event_type":"…","payload":{…}}` — زنجیرهٔ رخداد.
 *   • `{"type":"enqueue_job","kind":"…","payload":{…},"dedupe_key":"…"}`.
 *   • `{"type":"webhook","endpoint_key":"…"}` — پخش روی مقصد ثبت‌شده.
 *
 * اثر دوباره ممکن نیست: `ops.automation_run (rule_id, event_id)` یکتاست و
 * اگر اجرای همین رخداد پیش‌تر ثبت شده باشد، تابع با تعارض تمام می‌شود.
 */
create or replace function ops.run_rule(p_rule_id uuid, p_event_id uuid)
returns ops.automation_run
language plpgsql
security definer
set search_path = pg_catalog, ops, app, auth
as $$
declare
  v_rule ops.automation_rule;
  v_event ops.event;
  v_run ops.automation_run;
  v_action jsonb;
  v_results jsonb := '[]'::jsonb;
  v_status text;
  v_started timestamptz := clock_timestamp();
  v_recipient uuid;
  v_skip text;
begin
  select * into v_rule from ops.automation_rule where id = p_rule_id;
  if not found then
    raise exception 'قاعده % پیدا نشد', p_rule_id using errcode = 'no_data_found';
  end if;

  select * into v_event from ops.event where id = p_event_id;
  if not found then
    raise exception 'رخداد % پیدا نشد', p_event_id using errcode = 'no_data_found';
  end if;

  /*
   * قیدهای اجرا، اینجا دوباره سنجیده می‌شوند.
   *
   * `matching_rules` پیش از اجرا فیلتر می‌کند، ولی فاصلهٔ بین «انتخاب» و
   * «اجرا» می‌تواند ده‌ها ثانیه باشد و در آن فاصله، سقف پر شود. پس تصمیم
   * نهایی همین‌جا گرفته می‌شود و دلیل رد، ثبت می‌شود.
   *
   * (`(mr.rule).id` با پرانتز: یک ستون مرکب است، نه یک نام سه‌بخشی.)
   */
  select mr.skip_reason into v_skip from ops.matching_rules(p_event_id) mr where (mr.rule).id = p_rule_id;

  if v_skip is not null then
    insert into ops.automation_run (rule_id, event_id, event_type, business_id, status, skip_reason, finished_at)
    values (p_rule_id, p_event_id, v_event.event_type, v_event.business_id, 'skipped', v_skip, now())
    on conflict (rule_id, event_id) do nothing
    returning * into v_run;

    if v_run.id is null then
      raise exception 'این قاعده برای این رخداد پیش‌تر بررسی شده است' using errcode = 'unique_violation';
    end if;

    return v_run;
  end if;

  if v_rule.dry_run then
    insert into ops.automation_run (rule_id, event_id, event_type, business_id, status, actions_result, finished_at, duration_ms)
    values (
      p_rule_id, p_event_id, v_event.event_type, v_event.business_id, 'dry_run',
      jsonb_build_array(jsonb_build_object('planned', jsonb_array_length(v_rule.actions), 'actions', v_rule.actions)),
      now(), 0
    )
    on conflict (rule_id, event_id) do nothing
    returning * into v_run;

    if v_run.id is null then
      raise exception 'این قاعده برای این رخداد پیش‌تر بررسی شده است' using errcode = 'unique_violation';
    end if;

    return v_run;
  end if;

  /*
   * ── نخست تصاحب، بعد کنش ────────────────────────────────────────────────
   *
   * ترتیب، خودِ ضمانت است. اگر کنش‌ها اول اجرا می‌شدند و بعد ردیف ثبت، دو
   * کارگر هم‌زمان می‌توانستند هر دو اعلان بفرستند و تنها *ثبت* دومی رد شود؛
   * یعنی اثر دوباره، بی‌آنکه کسی بفهمد. با تصاحبِ اول، درج یکتا داور است:
   * برنده یکی است و بازنده حتی یک کنش هم اجرا نکرده است (§180، §106).
   */
  insert into ops.automation_run (rule_id, event_id, event_type, business_id, status, started_at)
  values (p_rule_id, p_event_id, v_event.event_type, v_event.business_id, 'matched', v_started)
  on conflict (rule_id, event_id) do nothing
  returning * into v_run;

  if v_run.id is null then
    raise exception 'این قاعده برای این رخداد پیش‌تر اجرا شده است' using errcode = 'unique_violation';
  end if;

  for v_action in select * from jsonb_array_elements(v_rule.actions)
  loop
    case v_action ->> 'type'
      when 'notify' then
        /*
         * گیرنده، فقط از دو جای مطمئن می‌آید: کاربری که در دادهٔ رخداد نامش
         * هست، یا مالک کسب‌وکار. «هر آدرسی که قاعده بگوید» وجود ندارد.
         */
        if v_action ? 'user_path' then
          begin
            v_recipient := (v_event.payload #>> string_to_array(v_action ->> 'user_path', '.'))::uuid;
          exception when others then
            v_recipient := null;
          end;
        end if;

        if v_recipient is null and v_action ->> 'recipient' = 'business_owner' and v_event.business_id is not null then
          select owner_user_id into v_recipient from app.business where id = v_event.business_id;
        end if;

        if v_recipient is null and v_event.actor_id is not null then
          v_recipient := v_event.actor_id;
        end if;

        if v_recipient is null then
          v_results := v_results || jsonb_build_object('type', 'notify', 'ok', false, 'reason', 'no_recipient');
          continue;
        end if;

        insert into ops.notification (
          recipient_user_id, business_id, kind, severity, title, body, action_path, data, rule_id, correlation_id
        ) values (
          v_recipient,
          v_event.business_id,
          coalesce(v_action ->> 'kind', 'automation.' || replace(v_rule.key, '.', '_')),
          coalesce(v_action ->> 'severity', 'info'),
          coalesce(v_action ->> 'title', v_rule.name_fa),
          v_action ->> 'body',
          v_action ->> 'action_path',
          jsonb_build_object('event_id', v_event.id, 'rule_key', v_rule.key),
          v_rule.id,
          v_event.id
        );

        v_results := v_results || jsonb_build_object('type', 'notify', 'ok', true);

      when 'emit_event' then
        perform app.emit_event(
          coalesce(v_action ->> 'event_type', 'automation.followup'),
          coalesce(v_action ->> 'entity_type', v_event.entity_type),
          coalesce(v_action ->> 'entity_id', v_event.entity_id),
          v_event.business_id,
          coalesce(v_action -> 'payload', '{}'::jsonb)
            || jsonb_build_object('caused_by_event', v_event.id, 'rule_key', v_rule.key)
        );
        v_results := v_results || jsonb_build_object('type', 'emit_event', 'ok', true);

      when 'enqueue_job' then
        insert into ops.job (kind, payload, business_id, dedupe_key, request_id)
        values (
          coalesce(v_action ->> 'kind', 'automation.task'),
          coalesce(v_action -> 'payload', '{}'::jsonb)
            || jsonb_build_object('event_id', v_event.id, 'rule_key', v_rule.key),
          v_event.business_id,
          nullif(v_action ->> 'dedupe_key', ''),
          v_event.request_id
        )
        on conflict do nothing;
        v_results := v_results || jsonb_build_object('type', 'enqueue_job', 'ok', true);

      when 'webhook' then
        perform ops.fan_out_webhook(v_event.id);
        v_results := v_results || jsonb_build_object('type', 'webhook', 'ok', true);

      else
        -- کنش ناشناخته: رد می‌شود و ثبت. «اجرای کد دلخواه» وجود ندارد (§74).
        v_results := v_results || jsonb_build_object(
          'type', coalesce(v_action ->> 'type', 'unknown'),
          'ok', false,
          'reason', 'action_not_allowed'
        );
    end case;
  end loop;

  v_status := case
    when exists (select 1 from jsonb_array_elements(v_results) as item where (item ->> 'ok')::boolean is false)
      then 'failed'
    else 'succeeded'
  end;

  update ops.automation_run
     set status = v_status,
         actions_result = v_results,
         finished_at = now(),
         duration_ms = greatest((extract(epoch from (clock_timestamp() - v_started)) * 1000)::integer, 0)
   where id = v_run.id
  returning * into v_run;

  perform app.record_audit(
    'automation.rule_run', 'automation_rule', p_rule_id::text, v_event.business_id,
    null, jsonb_build_object('event_id', p_event_id, 'status', v_status, 'results', v_results)
  );

  return v_run;
end
$$;

comment on function ops.run_rule is
  'اجرای کنش‌های قاعده با کنش‌های بسته و اثر یک‌بار (§74، §180)';

/**
 * پردازش یک رخداد: همهٔ قاعده‌های متناظر را به ترتیب اجرا می‌کند.
 *
 * ایدمپوتنت است (§180). اگر همین رخداد پیش‌تر پردازش شده باشد، اجرای دوباره
 * هیچ اثری ندارد: هر قاعده با `(rule_id, event_id)` یکتا مهار می‌شود و در
 * خلاصهٔ برگشتی، `already_done` می‌گیرد. کارگر صف می‌تواند همان کار را بعد از
 * یک قطعی دوباره بردارد، بی‌آنکه اعلان یا وبهوک دوباره ساخته شود.
 */
create or replace function ops.process_event(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, ops
as $$
declare
  v_row record;
  v_summary jsonb := '{"succeeded":0,"skipped":0,"failed":0,"dry_run":0,"already_done":0}'::jsonb;
  v_run ops.automation_run;
  v_key text;
begin
  for v_row in
    select (mr.rule).id as rule_id, mr.skip_reason
    from ops.matching_rules(p_event_id) mr
  loop
    begin
      v_run := ops.run_rule(v_row.rule_id, p_event_id);
      v_key := coalesce(v_run.status, 'already_done');
    exception
      when unique_violation then
        v_key := 'already_done';
    end;

    v_summary := jsonb_set(
      v_summary,
      array[v_key],
      to_jsonb(coalesce((v_summary ->> v_key)::int, 0) + 1)
    );
  end loop;

  update ops.event
     set processed_at = coalesce(processed_at, now()),
         attempts = attempts + 1
   where id = p_event_id;

  return v_summary;
end
$$;

comment on function ops.process_event is 'پردازش رخداد: اجرای قاعده‌های متناظر و نشان‌گذاری رخداد (Addendum §56–۷۲)';

/** تصویر سلامت خودکارسازی، برای پنل: چند قاعده، چند اجرا، چند خطا. */
create or replace function ops.automation_health(p_business_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, ops
as $$
  select jsonb_build_object(
    'rules', (select count(*) from ops.automation_rule r
               where p_business_id is null or r.business_id = p_business_id),
    'active_rules', (select count(*) from ops.automation_rule r
                      where r.status = 'active' and (p_business_id is null or r.business_id = p_business_id)),
    'runs_24h', (select count(*) from ops.automation_run run
                  where run.started_at > now() - interval '1 day'
                    and (p_business_id is null or run.business_id = p_business_id)),
    'failures_24h', (select count(*) from ops.automation_run run
                      where run.status = 'failed' and run.started_at > now() - interval '1 day'
                        and (p_business_id is null or run.business_id = p_business_id)),
    'pending_events', (select count(*) from ops.event e where e.processed_at is null),
    /*
     * اجراهای نیمه‌کاره: قاعده‌ای که تصاحب شد و تمام نشد (کرنل کارگر در میان
     * کار). این عدد باید صفر بماند؛ اگر نماند، چیزی برای دیدن وجود دارد —
     * و این دقیقاً دلیل ثبت «تصاحب» پیش از کنش است.
     */
    'stuck_runs', (select count(*) from ops.automation_run run
                    where run.status = 'matched' and run.finished_at is null),
    'unread_notifications', (select count(*) from ops.notification n where n.read_at is null)
  )
$$;

/**
 * آزادسازی اجراهای نیمه‌کاره.
 *
 * اجرایی که تصاحب شد و تمام نشد، هرگز خودش تمام نمی‌شود؛ به‌جای پاک کردنش،
 * صریحاً «شکست‌خورده» علامت می‌خورد تا در پایش دیده شود و اپراتور بتواند
 * آگاهانه دوباره اجرا کند. جمع کردن بی‌صدا، بدترین گزینه است: نه اثر می‌دهد،
 * نه کسی می‌فهمد که نداده.
 */
create or replace function ops.reclaim_stale_runs(p_older_than interval default '15 minutes')
returns integer
language plpgsql
security definer
set search_path = pg_catalog, ops
as $$
declare
  v_count integer;
begin
  update ops.automation_run
     set status = 'failed',
         finished_at = now(),
         error = 'اجرای نیمه‌کاره: کارگر پیش از پایان کنش‌ها از کار افتاد',
         duration_ms = greatest((extract(epoch from (now() - started_at)) * 1000)::integer, 0)
   where status = 'matched'
     and finished_at is null
     and started_at < now() - p_older_than;

  get diagnostics v_count = row_count;
  return v_count;
end
$$;

comment on function ops.reclaim_stale_runs is 'علامت‌زدن اجراهای نیمه‌کاره به‌عنوان شکست‌خورده، برای دیدن اپراتور (§93)';

comment on function ops.automation_health is 'تصویر سلامت خودکارسازی و اعلان (Addendum §91–95)';

revoke all on function ops.condition_matches(jsonb, jsonb) from public;
revoke all on function ops.rule_matches(ops.automation_rule, jsonb) from public;
revoke all on function ops.matching_rules(uuid) from public;
revoke all on function ops.run_rule(uuid, uuid) from public;
revoke all on function ops.process_event(uuid) from public;
revoke all on function ops.reclaim_stale_runs(interval) from public;
revoke all on function ops.automation_health(uuid) from public;

grant execute on function ops.condition_matches(jsonb, jsonb) to pv_app, pv_worker, pv_reader;
grant execute on function ops.rule_matches(ops.automation_rule, jsonb) to pv_app, pv_worker;
grant execute on function ops.matching_rules(uuid) to pv_app, pv_worker;
grant execute on function ops.run_rule(uuid, uuid) to pv_worker;
grant execute on function ops.process_event(uuid) to pv_worker;
grant execute on function ops.reclaim_stale_runs(interval) to pv_worker;
grant execute on function ops.automation_health(uuid) to pv_app, pv_worker, pv_reader;
