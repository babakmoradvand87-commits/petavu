/*
 * گام ۲۷ — تطبیق مسیر قطعه‌به‌قطعه و بودجهٔ منبع‌به‌منبع.
 *
 * دو شکافِ پیداشده هنگام وصل‌کردن اندازه‌گیری به بودجه:
 *
 *   ۱) `ops.budget_for_route` با `LIKE` و جایگزینی `/:` به `/%` کار می‌کرد. دو نتیجهٔ غلط:
 *        • `:param` با `%` عمل می‌کرد و از `/` رد می‌شد (می‌خواست «یک بخش» باشد)؛
 *        • الگوی یک‌بخشیِ `/:slug` (نامک محتوا) هرگز با هیچ مسیری نمی‌خورد: `'/:slug'` →
 *          `'/%slug'` می‌شد، یعنی «مسیرهایی که به slug ختم می‌شوند».
 *      نتیجه: `/rules` و **همهٔ صفحه‌های تاکسونومیِ تودرتو** (`/i/a/b`، `/l/استان/شهر`،
 *      `/k/a/b`) «بی‌بودجه» بودند — یعنی دروازهٔ انتشار آن‌ها را می‌گذراند یا رد می‌کرد
 *      به دلیل اشتباه، و نمونه‌های RUM همین مسیرها به سطل `~unbudgeted` می‌ریختند و
 *      هیچ پس‌رفتی برایشان شناسایی نمی‌شد.
 *      حالا تطبیق **قطعه‌به‌قطعه** است: `:name` دقیقاً یک بخش، `:name*` (فقط آخر) یک بخش یا بیشتر.
 *
 *   ۲) بودجهٔ «وزن کل» برای دیدن اینکه کدام منبع می‌پرد کافی نیست. Addendum §۱–۴ بودجه را روی
 *      HTML، CSS، JS، تصویر و فونت جدا می‌خواهد. پنج ستون اختیاری افزوده شد. `js_kb = 0` معنای
 *      روشنی دارد («این مسیر JavaScript ندارد»)، پس مجاز است.
 *
 * `check_budget` تغییر دیگری هم کرد: ورودی کاربر است (مسیر `POST /performance/budget/check`)
 * و `(… ->> 'x')::numeric` روی «abc» با خطای تبدیل می‌افتاد (۵۰۰ به‌جای ۴۰۰). مقدار غیرعددی
 * حالا «اندازه‌گیری نشده» است. و **رأی صادق‌تر شد**: `compared` می‌گوید کدام سنجه‌ها واقعاً
 * سنجیده شدند و `not_compared` کدام‌ها بودجه داشتند ولی اندازه‌گیری نیامد؛ «قبول» یعنی «در
 * سنجه‌های سنجیده‌شده تخطی نیست»، نه «همه‌چیز سالم است».
 */

-- ------------------------------------------------------------------ ۱) تطبیق قطعه‌به‌قطعه

create function ops.route_matches(p_pattern text, p_path text)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = pg_catalog
as $$
declare
  pat text[];
  req text[];
  catch_all boolean;
  fixed integer;
  i integer;
begin
  if p_pattern is null or p_path is null then return false; end if;
  if p_pattern = p_path then return true; end if;
  -- ریشه فقط با ریشه برابر است.
  if p_pattern = '/' or p_path = '/' then return false; end if;

  pat := string_to_array(trim(both '/' from p_pattern), '/');
  req := string_to_array(trim(both '/' from p_path), '/');

  catch_all := pat[cardinality(pat)] like ':%*';
  fixed := case when catch_all then cardinality(pat) - 1 else cardinality(pat) end;

  if catch_all then
    if cardinality(req) < fixed + 1 then return false; end if;
  else
    if cardinality(req) <> fixed then return false; end if;
  end if;

  for i in 1 .. cardinality(req) loop
    if req[i] = '' then return false; end if;
  end loop;

  for i in 1 .. fixed loop
    -- `:param` هر بخشِ غیرتهی؛ بخش ثابت باید دقیقاً برابر باشد.
    if pat[i] like ':%' then continue; end if;
    if pat[i] <> req[i] then return false; end if;
  end loop;

  return true;
end
$$;

comment on function ops.route_matches(text, text) is
  'تطبیق الگوی مسیر قطعه‌به‌قطعه: :name یک بخش، :name* (فقط آخر) یک بخش یا بیشتر. Addendum §۱–۴';

revoke all on function ops.route_matches(text, text) from public;
grant execute on function ops.route_matches(text, text) to pv_public, pv_app, pv_worker, pv_reader;

create or replace function ops.budget_for_route(p_path text)
returns setof ops.page_budget
language sql
stable
security definer
set search_path = pg_catalog, ops
as $$
  select b.*
  from ops.page_budget b
  where b.is_active
    and ops.route_matches(b.route_pattern, p_path)
  order by
    -- مسیر دقیق، بر همه مقدم است.
    case when b.route_pattern = p_path then 0 else 1 end,
    -- بعد خاص‌ترین: بخش‌های ثابت بیشتر.
    (select count(*) from unnest(string_to_array(trim(both '/' from b.route_pattern), '/')) as seg where seg not like ':%') desc,
    -- پارامتر ساده بر «یک بخش یا بیشتر» مقدم است.
    case when b.route_pattern like '%*' then 1 else 0 end asc,
    length(b.route_pattern) desc
  limit 1
$$;

-- ------------------------------------------------------------------ ۲) بودجهٔ منبع‌به‌منبع

alter table ops.page_budget
  add column html_kb integer check (html_kb is null or html_kb between 1 and 5000),
  add column css_kb integer check (css_kb is null or css_kb between 1 and 5000),
  add column js_kb integer check (js_kb is null or js_kb between 0 and 5000),
  add column image_kb integer check (image_kb is null or image_kb between 0 and 20000),
  add column font_kb integer check (font_kb is null or font_kb between 0 and 5000);

comment on column ops.page_budget.html_kb is 'سقف حجم انتقال HTML (فشردهٔ brotli)، کیلوبایت';
comment on column ops.page_budget.css_kb is 'سقف حجم انتقال CSS (فشرده)، کیلوبایت';
comment on column ops.page_budget.js_kb is 'سقف حجم انتقال JavaScript (فشرده)؛ صفر یعنی «بدون JavaScript»';
comment on column ops.page_budget.image_kb is 'سقف حجم تصویرهای نخستین‌نما، کیلوبایت';
comment on column ops.page_budget.font_kb is 'سقف حجم فونت‌های بارشده، کیلوبایت';

-- ------------------------------------------------------------------ ۳) رأی صادق‌تر

/** عدد از اندازه‌گیری، یا تهی اگر کلید نیست یا عددی نیست (ورودی کاربر است). */
create function ops.measurement_number(p_measurement jsonb, p_key text)
returns numeric
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case
    when jsonb_typeof(p_measurement -> p_key) = 'number' and (p_measurement ->> p_key)::numeric >= 0
      then (p_measurement ->> p_key)::numeric
  end
$$;

revoke all on function ops.measurement_number(jsonb, text) from public;
grant execute on function ops.measurement_number(jsonb, text) to pv_public, pv_app, pv_worker, pv_reader;

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
  v_compared jsonb := '[]'::jsonb;
  v_not_compared jsonb := '[]'::jsonb;
  v_metric record;
  v_actual numeric;
begin
  select * into v_budget from ops.budget_for_route(p_path);

  if not found then
    return jsonb_build_object(
      'route', p_path,
      'matched', false,
      'verdict', 'unbudgeted',
      'message', 'برای این مسیر بودجه‌ای تعریف نشده است؛ یعنی هیچ‌چیز اندازه‌گیری نمی‌شود.',
      'breaches', v_breaches,
      'compared', v_compared,
      'not_compared', v_not_compared
    );
  end if;

  /*
   * هر سنجه: نام در اندازه‌گیری، سقف در بودجه. «سقف تهی» یعنی این سنجه بودجه ندارد (نه
   * «همیشه قبول»)؛ «اندازه‌گیریِ تهی» یعنی سنجیده نشد، که باید دیده شود.
   */
  for v_metric in
    select * from (values
      ('lcp_ms',        v_budget.lcp_ms::numeric),
      ('inp_ms',        v_budget.inp_ms::numeric),
      ('cls',           v_budget.cls::numeric),
      ('weight_kb',     v_budget.weight_kb::numeric),
      ('request_count', v_budget.request_count::numeric),
      ('api_p95_ms',    v_budget.api_p95_ms::numeric),
      ('html_kb',       v_budget.html_kb::numeric),
      ('css_kb',        v_budget.css_kb::numeric),
      ('js_kb',         v_budget.js_kb::numeric),
      ('image_kb',      v_budget.image_kb::numeric),
      ('font_kb',       v_budget.font_kb::numeric)
    ) as m(name, cap)
    where m.cap is not null
  loop
    v_actual := ops.measurement_number(p_measurement, v_metric.name);
    if v_actual is null then
      v_not_compared := v_not_compared || to_jsonb(v_metric.name);
      continue;
    end if;
    v_compared := v_compared || to_jsonb(v_metric.name);
    if v_actual > v_metric.cap then
      v_breaches := v_breaches || jsonb_build_object('metric', v_metric.name, 'budget', v_metric.cap, 'actual', v_actual);
    end if;
  end loop;

  return jsonb_build_object(
    'route', p_path,
    'matched', true,
    'budget_id', v_budget.id,
    'route_pattern', v_budget.route_pattern,
    'verdict', case when jsonb_array_length(v_breaches) = 0 then 'pass' else 'fail' end,
    'breaches', v_breaches,
    'compared', v_compared,
    'not_compared', v_not_compared
  );
end
$$;

-- ------------------------------------------------------------------ ۴) مرز اعتمادِ vitals، واقعاً مرز

/*
 * `ops.record_vitals` در توضیحش می‌گوید «رکورد نامعتبر را رد می‌کند و می‌گوید — نه اینکه کل
 * دسته را باطل کند». ولی سه ستون شمارشی (`device_class`، `connection`، `navigation_type`) قید
 * `check` دارند و مقدارِ ناشناخته مستقیم به آن‌ها می‌رسید: یک `navigation_type = 'back-forward'`
 * (که کتابخانه‌ها همین‌طور می‌نویسند) یا `connection = 'LTE'` یک **خطای قید** می‌داد و کل دسته،
 * با ۴۰ رکورد سالم، از بین می‌رفت (۵۰۰ برای بیکن).
 *
 * اصلاح در خود تابع است (مرز اعتماد همان‌جاست؛ §191: هیچ اعتبارسنجی فقط در لایهٔ بالاتر):
 * مقدار ناشناخته «unknown» می‌شود و مترادف‌های شناخته‌شده یکی می‌شوند.
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
      -- سه شمارهٔ بسته: مقدار ناشناخته «unknown» می‌شود، نه خطای قید (که کل دسته را باطل می‌کرد).
      case when lower(v_item ->> 'device_class') in ('mobile', 'tablet', 'desktop') then lower(v_item ->> 'device_class') else 'unknown' end,
      case when lower(v_item ->> 'connection') in ('slow-2g', '2g', '3g', '4g', '5g', 'wifi', 'ethernet') then lower(v_item ->> 'connection') else 'unknown' end,
      case replace(lower(coalesce(v_item ->> 'navigation_type', '')), '-', '_')
        when 'navigate' then 'navigate'
        when 'reload' then 'reload'
        when 'prerender' then 'prerender'
        -- مرورگرها و کتابخانه‌ها این یک مفهوم را به چند شکل می‌نویسند.
        when 'back_forward' then 'back_forward'
        when 'back_forward_cache' then 'back_forward'
        when 'restore' then 'back_forward'
        else 'unknown'
      end,
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
