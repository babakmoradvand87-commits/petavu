/*
 * گام ۲۸ — بنیان پنل‌ها: منو و ویجت به‌عنوان داده، و یک نقص قدیمی فهرست کلید API.
 *
 * ۱) `ops.menu_item` — منوی هر سطح (§26: ۱۵ مورد برای پنل عضو، §28: ۲۸ مورد برای مدیریت). منو **داده**
 *    است، نه آرایه‌ای در کد (§103: UI هرگز منبع حقیقت نیست). هر ردیف می‌گوید به کدام مجوز گره خورده و
 *    `availability` صادق است: `ready` یا `planned` (با شمارهٔ گامی که آن را می‌سازد). «ساخته‌نشده» پنهان
 *    یا جعل نمی‌شود؛ می‌گوید چه زمانی می‌آید.
 *
 * ۲) `ref.dashboard_widget` — داشبورد آگاه به نوع کسب‌وکار (§27): «کلینیک چیز دیگری می‌بیند، پخش‌کننده چیز
 *    دیگری — از داده، نه از شرط در کد». `source` از **فهرست بستهٔ** منبع‌هاست که سرور می‌شناسد (CHECK)؛ داده،
 *    SQL یا کد نمی‌آورد (§74: No-Code هرگز SQL/JS خام).
 *
 * ۳) `app.panel_menu(surface)` — منوی مجازِ بازیگر جاری. **پنهان‌کردن منو، مجوز دادن نیست** (§15): هر صفحه
 *    مجوزش را دوباره از API می‌گیرد؛ این تابع فقط ورودیِ رابط را از آنچه بازیگر می‌تواند ببیند می‌سازد.
 *
 * ۴) `app.list_api_keys()` — فهرست کلید API **همیشه ۴۰۳ می‌داد**: مسیر `GET /auth/api-keys` جدول `app.api_key`
 *    را مستقیم می‌خواند، ولی آن جدول عمداً بسته است (سیاست `using (false)`، گرنت‌ها revoke؛ هش کلید نباید به
 *    هیچ نقش برنامه‌ای برسد). آزمون‌ها فقط ساخت و باطل‌کردن را می‌سنجیدند، نه فهرست را. راه درست، تابع
 *    `security definer` با مجوز صریح و ستون‌های بی‌خطر است (بی `key_hash`).
 */

-- ------------------------------------------------------------------ ۱) منو

create table ops.menu_item (
  id uuid primary key default gen_random_uuid(),
  surface text not null check (surface in ('panel', 'admin', 'shop', 'admin_shop')),
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  label_fa text not null check (length(btrim(label_fa)) between 2 and 60),
  /** مسیر داخلی روی همان سطح؛ فقط حروف کوچک، رقم، خط‌تیره، زیرخط و `/`. */
  path text not null check (path ~ '^/[a-z0-9/_-]{0,120}$'),
  icon_key text check (icon_key is null or icon_key ~ '^[a-z][a-z0-9_-]{1,30}$'),
  /** مجوز کسب‌وکاری (سطح پنل عضو). تهی ⇒ برای هر نشست. */
  permission_key text references auth.permission (key),
  /** مجوز پلتفرمی (سطح مدیریت). */
  platform_permission_key text references auth.permission (key),
  feature_key text references ops.feature (key),
  availability text not null default 'ready' check (availability in ('ready', 'planned')),
  /** شمارهٔ گامِ ROADMAP که این بخش را می‌سازد؛ فقط برای `planned`. */
  planned_step smallint check (planned_step is null or planned_step between 1 and 99),
  description text check (description is null or length(description) <= 300),
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint menu_item_planned_has_step check ((availability = 'planned') = (planned_step is not null))
);

comment on table ops.menu_item is 'منوی هر سطح، به‌عنوان داده؛ مجوز و وضعیت صادق (§26، §28، §103)';

create unique index menu_item_surface_key_idx on ops.menu_item (surface, key);
create index menu_item_surface_order_idx on ops.menu_item (surface, sort_order) where is_active;

create trigger menu_item_touch
  before update on ops.menu_item
  for each row execute function app.touch();

alter table ops.menu_item enable row level security;

create policy menu_item_read on ops.menu_item
  for select to pv_app, pv_worker, pv_reader
  using (is_active or app.has_platform_permission('platform.settings.manage'));

create policy menu_item_insert on ops.menu_item
  for insert to pv_app
  with check (app.has_platform_permission('platform.settings.manage'));

create policy menu_item_update on ops.menu_item
  for update to pv_app
  using (app.has_platform_permission('platform.settings.manage'))
  with check (app.has_platform_permission('platform.settings.manage'));

create policy menu_item_delete on ops.menu_item
  for delete to pv_app
  using (app.has_platform_permission('platform.settings.manage'));

grant select, insert, update, delete on ops.menu_item to pv_app;
grant select on ops.menu_item to pv_worker, pv_reader;

-- ------------------------------------------------------------------ ۲) ویجت داشبورد

create table ref.dashboard_widget (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  name_fa text not null check (length(btrim(name_fa)) between 2 and 80),
  kind text not null check (kind in ('metric', 'breakdown', 'checklist')),
  /** فهرست بستهٔ منبع‌ها؛ سرور برای هر کدام یک خواندنِ مجازشده دارد. داده، کد نمی‌آورد. */
  source text not null check (source in (
    'completeness', 'content_counts', 'team', 'invitations', 'listings', 'notifications', 'automation', 'regressions'
  )),
  /** تهی ⇒ همهٔ نوع‌ها. */
  business_type_keys text[],
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

comment on table ref.dashboard_widget is 'ویجت‌های داشبورد پنل به تفکیک نوع کسب‌وکار؛ از داده، نه شرط در کد (§27)';

create trigger dashboard_widget_touch
  before update on ref.dashboard_widget
  for each row execute function app.touch();

alter table ref.dashboard_widget enable row level security;

create policy dashboard_widget_read on ref.dashboard_widget
  for select to pv_app, pv_worker, pv_reader
  using (true);

create policy dashboard_widget_insert on ref.dashboard_widget
  for insert to pv_app
  with check (app.has_platform_permission('platform.taxonomy.manage'));

create policy dashboard_widget_update on ref.dashboard_widget
  for update to pv_app
  using (app.has_platform_permission('platform.taxonomy.manage'))
  with check (app.has_platform_permission('platform.taxonomy.manage'));

create policy dashboard_widget_delete on ref.dashboard_widget
  for delete to pv_app
  using (app.has_platform_permission('platform.taxonomy.manage'));

grant select, insert, update, delete on ref.dashboard_widget to pv_app;
grant select on ref.dashboard_widget to pv_worker, pv_reader;

-- ------------------------------------------------------------------ ۳) منوی مجازِ بازیگر

/*
 * `security invoker`: RLS روی `ops.menu_item` و توابع مجوز برای همین بازیگر اجرا می‌شود.
 *
 * سطح مدیریت فقط برای دارندهٔ نقش پلتفرمی است؛ بقیه فهرست خالی می‌گیرند (نه خطا: «وجود نداشتن» و
 * «اجازه نداشتن» یکی دیده می‌شود، §14).
 */
create function app.panel_menu(p_surface text)
returns table (
  key text,
  label_fa text,
  path text,
  icon_key text,
  availability text,
  planned_step smallint,
  description text,
  sort_order integer
)
language sql
stable
set search_path = pg_catalog, app, ops
as $$
  select m.key, m.label_fa, m.path, m.icon_key, m.availability, m.planned_step, m.description, m.sort_order
  from ops.menu_item m
  where m.surface = p_surface
    and m.is_active
    and (p_surface <> 'admin' or app.current_platform_role() is not null)
    and (m.permission_key is null or app.has_permission(app.current_business_id(), m.permission_key))
    and (m.platform_permission_key is null or app.has_platform_permission(m.platform_permission_key))
  order by m.sort_order, m.key
$$;

comment on function app.panel_menu(text) is 'منوی مجازِ بازیگر جاری؛ پنهان‌کردن منو، مجوز دادن نیست (§15)';

revoke all on function app.panel_menu(text) from public;
grant execute on function app.panel_menu(text) to pv_app;

-- ------------------------------------------------------------------ ۴) فهرست کلید API

create function app.list_api_keys()
returns table (
  id uuid,
  name text,
  key_prefix text,
  scopes text[],
  created_at timestamptz,
  last_used_at timestamp with time zone,
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text,
  request_count bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, app
as $$
begin
  -- مجوز را خود تابع می‌سنجد: بدنه `security definer` است و RLS برای صاحب جدول اجرا می‌شود.
  if app.current_user_id() is null
     or app.current_business_id() is null
     or not app.has_permission(app.current_business_id(), 'business.integration.manage') then
    raise exception 'برای فهرست کلیدهای API، مجوز یکپارچه‌سازی لازم است'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select k.id, k.name, k.key_prefix, k.scopes, k.created_at, k.last_used_at, k.expires_at,
           k.revoked_at, k.revoked_reason, k.request_count
    from app.api_key k
    where k.business_id = app.current_business_id()
    order by k.created_at desc;
end
$$;

comment on function app.list_api_keys() is 'فهرست کلیدهای API کسب‌وکار فعال؛ هرگز key_hash نمی‌دهد (§79)';

revoke all on function app.list_api_keys() from public;
grant execute on function app.list_api_keys() to pv_app;

-- §56: نسخهٔ پروفایل در خود پایگاه‌داده سنجیده می‌شود؛ درج نخست هم داده‌ها را می‌نویسد.
create function app.save_business_profile(p_business uuid, p_version integer, p_patch jsonb)
returns setof app.business_profile
language plpgsql security definer set search_path = pg_catalog, app as $$
declare old_row app.business_profile; new_row app.business_profile; k text;
begin
  if app.current_user_id() is null or not app.has_permission(p_business, 'business.update') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_version is null or p_version < 0 or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'invalid profile patch' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('tagline','summary','description','founded_year','employee_range','logo_asset_id','cover_asset_id','links','attributes','keywords') then
      raise exception 'field not allowed' using errcode='22023';
    end if;
  end loop;
  perform pg_advisory_xact_lock(hashtextextended(p_business::text, 0));
  select * into old_row from app.business_profile where business_id=p_business for update;
  if coalesce(old_row.version, 0) <> p_version then raise exception 'stale profile version' using errcode='P0409'; end if;
  if old_row.business_id is null then insert into app.business_profile (business_id) values (p_business); end if;
  update app.business_profile p set
    tagline=case when p_patch ? 'tagline' then p_patch->>'tagline' else p.tagline end,
    summary=case when p_patch ? 'summary' then p_patch->>'summary' else p.summary end,
    description=case when p_patch ? 'description' then p_patch->>'description' else p.description end,
    founded_year=case when p_patch ? 'founded_year' then (p_patch->>'founded_year')::smallint else p.founded_year end,
    employee_range=case when p_patch ? 'employee_range' then p_patch->>'employee_range' else p.employee_range end,
    logo_asset_id=case when p_patch ? 'logo_asset_id' then (p_patch->>'logo_asset_id')::uuid else p.logo_asset_id end,
    cover_asset_id=case when p_patch ? 'cover_asset_id' then (p_patch->>'cover_asset_id')::uuid else p.cover_asset_id end,
    links=case when p_patch ? 'links' then p_patch->'links' else p.links end,
    attributes=case when p_patch ? 'attributes' then p_patch->'attributes' else p.attributes end,
    keywords=case when p_patch ? 'keywords' then array(select jsonb_array_elements_text(p_patch->'keywords')) else p.keywords end
  where p.business_id=p_business returning p.* into new_row;
  perform app.record_audit('profile.updated', 'business_profile', p_business::text, p_business, to_jsonb(old_row), to_jsonb(new_row));
  perform app.emit_event('profile.updated', 'business', p_business::text, p_business, jsonb_build_object('version', new_row.version));
  return next new_row;
end $$;
revoke all on function app.save_business_profile(uuid, integer, jsonb) from public;
grant execute on function app.save_business_profile(uuid, integer, jsonb) to pv_app;
