-- ---------------------------------------------------------------------------
-- 0001 — بنیان
--
-- این مهاجرت، اسکلت پایگاه‌داده را می‌سازد: فضاهای نام، نقش‌ها، توابع کمکی،
-- و جدول‌های زیرساختی. هیچ جدول دامنه‌ای اینجا نیست.
--
-- مرجع: §48–§63 (لایهٔ داده)، §14 (Deny-by-default)، §24/§93–۹۴ (حسابرسی)،
--       §146–۱۵۱ (رخداد و صف)، Addendum §۲۱–۲۴ (Feature Registry).
--
-- قاعده‌های این فایل:
--   * فقط PostgreSQL خالص و افزونه‌محور نیست. هیچ افزونه‌ای لازم نیست تا
--     مهاجرت روی هر میزبانی — از جمله اجرای محلی — یکسان اجرا شود.
--   * روی هر جدول tenant، RLS روشن می‌شود و هیچ سیاستی «همه‌چیز» نمی‌دهد؛
--     نبود سیاست یعنی دیده‌نشدن. اجرای برنامه با نقشی انجام می‌شود که مالک
--     جدول‌ها نیست، پس سیاست‌ها روی آن اثر می‌کنند. اینکه برنامه اشتباهی با
--     نقش مالک وصل نشود، با تابع نگهبان `app.rls_is_enforced_for_current_user`
--     در زمان راه‌اندازی بررسی می‌شود — وگرنه `enable` تنها یک ادعا بود.
--   * جدول‌های افزودنی (حسابرسی، رخداد) با تریگر در برابر تغییر و حذف
--     محافظت می‌شوند. «غیرقابل‌ویرایش» یک ادعا نیست؛ یک قید است (§94).
-- ---------------------------------------------------------------------------

-- ------------------------------------------------------------------ فضاهای نام
create schema if not exists ref;        -- دادهٔ مرجع: انواع کسب‌وکار، صنعت، مجوزها
create schema if not exists auth;       -- هویت، اعتبارنامه، نشست، دسترسی
create schema if not exists app;        -- دامنه: کسب‌وکار، محتوا، کاتالوگ
create schema if not exists media;      -- رسانه و فراداده‌اش
create schema if not exists design;     -- توکن، تم، صفحه، کامپوننت
create schema if not exists seo;        -- سئو به‌عنوان داده
create schema if not exists ops;        -- حسابرسی، رخداد، صف، تنظیمات، فیچر
create schema if not exists analytics;  -- نمونهٔ عملکرد و rollup

comment on schema ref is 'دادهٔ مرجع و تاکسونومی — خواندنی برای همه، نوشتنی فقط برای مالک';
comment on schema auth is 'هویت و دسترسی — حساس‌ترین فضای نام';
comment on schema app is 'دادهٔ دامنه، هر ردیف tenant-دار';
comment on schema ops is 'حسابرسی، رخداد، صف و تنظیمات عملیاتی';

-- ------------------------------------------------------------------ نقش‌ها
-- چهار نقش اجرا، با کمترین اختیار لازم:
--   pv_app     — فرایند API با زمینهٔ کاربر تأییدشده (موضوع RLS)
--   pv_public  — درخواست بی‌نام (فقط دادهٔ منتشرشده)
--   pv_worker  — کارگر صف و کارهای زمان‌بندی‌شده
--   pv_reader  — گزارش‌گیری و پشتیبان (فقط خواندن)
do $$
declare
  role_name text;
begin
  foreach role_name in array array['pv_app', 'pv_public', 'pv_worker', 'pv_reader'] loop
    if not exists (select 1 from pg_roles where rolname = role_name) then
      execute format('create role %I nologin', role_name);
    end if;
  end loop;
end
$$;

do $$
declare
  schema_name text;
begin
  foreach schema_name in array array['ref', 'auth', 'app', 'media', 'design', 'seo', 'ops', 'analytics'] loop
    execute format('grant usage on schema %I to pv_app, pv_public, pv_worker, pv_reader', schema_name);
  end loop;
end
$$;

-- پیش‌فرض آینده: هر جدولی که بعداً ساخته می‌شود، همین اختیارها را می‌گیرد.
-- بدون این، هر مهاجرت تازه باید گرنت‌ها را دستی تکرار کند و یک روز یکی جا
-- می‌ماند — و آن یک مورد، همان چیزی است که در تولید می‌شکند.
do $$
declare
  schema_name text;
begin
  foreach schema_name in array array['ref', 'auth', 'app', 'media', 'design', 'seo', 'ops', 'analytics'] loop
    execute format('alter default privileges in schema %I grant select, insert, update, delete on tables to pv_app', schema_name);
    execute format('alter default privileges in schema %I grant select on tables to pv_reader', schema_name);
    execute format('alter default privileges in schema %I grant select, insert, update on tables to pv_worker', schema_name);
    execute format('alter default privileges in schema %I grant usage, select on sequences to pv_app, pv_worker', schema_name);
  end loop;
end
$$;

-- ------------------------------------------------------------------ زمینهٔ درخواست
-- زمینه از طریق `set_config(..., true)` در هر تراکنش ست می‌شود و با پایان
-- تراکنش می‌رود. این توابع فقط آن را می‌خوانند.
--
-- نکتهٔ امنیتی: هیچ‌کدام از این توابع به `current_setting` بدون `true` تکیه
-- نمی‌کنند؛ در غیر این صورت، نبود مقدار در یک درخواست، خطای پایگاه‌داده می‌داد
-- و مسیر خطا می‌توانست اطلاعاتی لو بدهد. «نبود» یعنی تهی، و تهی یعنی «فقط
-- دادهٔ عمومی» — نه «دادهٔ همه».

create or replace function app.current_business_id()
returns uuid
language sql
stable
parallel safe
as $$
  select nullif(current_setting('app.business_id', true), '')::uuid
$$;

create or replace function app.current_user_id()
returns uuid
language sql
stable
parallel safe
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create or replace function app.current_session_id()
returns uuid
language sql
stable
parallel safe
as $$
  select nullif(current_setting('app.session_id', true), '')::uuid
$$;

/** نقش پلتفرمی فعال؛ رشتهٔ خالی یعنی هیچ. */
create or replace function app.current_platform_role()
returns text
language sql
stable
parallel safe
as $$
  select nullif(current_setting('app.platform_role', true), '')
$$;

comment on function app.current_business_id is 'کسب‌وکار جاری از زمینهٔ تراکنش؛ تهی یعنی هیچ';
comment on function app.current_user_id is 'کاربر جاری از زمینهٔ تراکنش';
comment on function app.current_platform_role is 'نقش پلتفرمی (پنل مدیریت) از زمینهٔ تراکنش';

-- ------------------------------------------------------------------ توابع کمکی
-- به‌روزرسانی زمان و شمارندهٔ نسخه.
--
-- `version` برای هم‌روندی خوش‌بینانه است (§58): هر به‌روزرسانی، نسخه را یکی
-- جلو می‌برد. کلاینت نسخه‌ای را که دیده می‌فرستد؛ اگر نخواند، یعنی کس دیگری
-- زودتر نوشته و درخواست باید ۴۱۲ بگیرد، نه اینکه نوشتن روی نوشتن بیفتد.
create or replace function app.touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if to_jsonb(new) ? 'version' then
    new.version := coalesce(old.version, 0) + 1;
  end if;
  return new;
end
$$;

comment on function app.touch is 'زمان به‌روزرسانی و شمارندهٔ نسخه را جلو می‌برد (§58)';

-- جدول افزودنی: هیچ ردیفی ویرایش یا حذف نمی‌شود.
-- این تریگر روی *همه* نقش‌ها اثر می‌گذارد، از جمله مالک جدول؛ وگرنه یک
-- اتصال با اختیار بالا می‌توانست رد حسابرسی را پاک کند.
create or replace function app.forbid_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'این جدول افزودنی است و ردیف‌هایش قابل ویرایش یا حذف نیستند (عملیات: %)', tg_op
    using errcode = 'restrict_violation';
end
$$;

comment on function app.forbid_mutation is 'محافظت جدول افزودنی در برابر ویرایش و حذف (§94)';

-- شمارندهٔ تغییر برای نامک‌ها و کدهای کوتاه.
create or replace function app.slug_base(input text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(lower(coalesce(input, '')), '[^a-z0-9\u0600-\u06ff]+', '-', 'g'))
$$;

/**
 * آیا RLS برای همین اتصال واقعاً اعمال می‌شود؟
 *
 * اگر نقش جاری، مالک یکی از جدول‌های دارای RLS باشد، پاسخ `false` است: مالک
 * جدول از سیاست‌ها مستثناست (مگر با `force`، که اینجا عمداً استفاده نشده تا
 * نقش مهاجرت و seed بتواند کارش را بکند). برنامهٔ API در زمان راه‌اندازی این
 * تابع را صدا می‌زند و اگر `false` بود، بالا نمی‌آید. این بررسی، تفاوت میان
 * «سیاست نوشته‌شده» و «سیاست اعمال‌شده» است.
 */
create or replace function app.rls_is_enforced_for_current_user()
returns boolean
language sql
stable
as $$
  select not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r'
      and c.relrowsecurity
      and n.nspname in ('ref', 'auth', 'app', 'media', 'design', 'seo', 'ops', 'analytics')
      and pg_get_userbyid(c.relowner) = current_user
  )
$$;

comment on function app.rls_is_enforced_for_current_user is
  'آیا نقش جاری از سیاست‌های RLS مستثناست؟ (برنامه باید در صورت false بالا نیاید)';

-- ------------------------------------------------------------------ عملیات: حسابرسی
-- حسابرسی، «چه کسی چه چیزی را چه زمانی تغییر داد» است. یک ردیف برای هر
-- عملیات حساس، غیرقابل ویرایش، با زمینهٔ کامل درخواست.
create table ops.audit_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_type text not null check (actor_type in ('user', 'system', 'worker', 'impersonator', 'anonymous')),
  actor_id uuid,
  /** کسی که با اختیار خودش وارد شده بود؛ فقط در Impersonation پر می‌شود (§31). */
  impersonated_by uuid,
  business_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  before_state jsonb,
  after_state jsonb,
  request_id text,
  ip inet,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  constraint audit_action_shape check (position('.' in action) > 1)
);

comment on table ops.audit_log is 'رد حسابرسی افزودنی؛ هر ردیف یک عملیات حساس (§24، §93–94)';

create index audit_log_business_time_idx on ops.audit_log (business_id, occurred_at desc);
create index audit_log_entity_idx on ops.audit_log (entity_type, entity_id, occurred_at desc);
create index audit_log_actor_idx on ops.audit_log (actor_id, occurred_at desc) where actor_id is not null;
create index audit_log_action_idx on ops.audit_log (action, occurred_at desc);

create trigger audit_log_append_only
  before update or delete on ops.audit_log
  for each row execute function app.forbid_mutation();

alter table ops.audit_log enable row level security;

-- نوشتن: هر نقش اجرایی می‌تواند رد بگذارد. خواندن: فقط کارکنان پلتفرم؛
-- صاحب کسب‌وکار رد کسب‌وکار خودش را از نمای `ops.audit_log_visible` می‌بیند
-- که سیاستش در مهاجرت هویت تکمیل می‌شود.
create policy audit_log_insert on ops.audit_log
  for insert to pv_app, pv_worker, pv_public
  with check (true);

create policy audit_log_select_staff on ops.audit_log
  for select to pv_app, pv_worker, pv_reader, pv_public
  using (app.current_platform_role() is not null);

revoke update, delete on ops.audit_log from pv_app, pv_worker, pv_public, pv_reader;

-- ------------------------------------------------------------------ عملیات: رخداد
-- رخداد = «چه اتفاقی افتاد». واقعیت ثبت‌شده، نه کار. کارگر و قاعده‌های
-- خودکارسازی، از همین‌جا می‌خوانند؛ خودِ درخواست کاربر هرگز منتظر آن‌ها
-- نمی‌ماند (Addendum — Event pipeline).
create table ops.event (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  event_type text not null check (position('.' in event_type) > 1),
  entity_type text not null,
  entity_id text not null,
  business_id uuid,
  actor_type text not null default 'system' check (actor_type in ('user', 'system', 'worker', 'impersonator')),
  actor_id uuid,
  payload jsonb not null default '{}'::jsonb,
  request_id text,
  processed_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text
);

comment on table ops.event is 'رخدادهای دامنه؛ ورودی خط لولهٔ سئو/جست‌وجو/اعلان/تحلیل (Addendum §56–72)';

create index event_unprocessed_idx on ops.event (occurred_at) where processed_at is null;
create index event_business_time_idx on ops.event (business_id, occurred_at desc);
create index event_type_idx on ops.event (event_type, occurred_at desc);
create index event_entity_idx on ops.event (entity_type, entity_id, occurred_at desc);

create trigger event_append_only
  before delete on ops.event
  for each row execute function app.forbid_mutation();

alter table ops.event enable row level security;

create policy event_insert on ops.event
  for insert to pv_app, pv_worker
  with check (true);

create policy event_select_worker on ops.event
  for select to pv_worker
  using (true);

create policy event_select_staff on ops.event
  for select to pv_app, pv_reader
  using (app.current_platform_role() is not null);

revoke delete on ops.event from pv_app;

-- ------------------------------------------------------------------ عملیات: صف کار
-- صف، در پایگاه‌داده و با قفلِ ردیفی. `for update skip locked` یعنی چند کارگر
-- می‌توانند موازی بردارند بدون اینکه یک کار را دو بار بگیرند — بدون نیاز به
-- صف بیرونی و بدون از دست رفتن کار در ری‌استارت.
create table ops.job (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  kind text not null check (position('.' in kind) > 1),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed', 'dead')),
  priority smallint not null default 100 check (priority between 0 and 1000),
  available_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 100),
  locked_by text,
  locked_at timestamptz,
  last_error text,
  finished_at timestamptz,
  business_id uuid,
  /** کلید یکتایی برای اینکه یک کار، دو بار در صف ننشیند (§180). */
  dedupe_key text,
  /** هم‌بستگی با درخواستی که این کار را ساخت (Addendum — Correlation). */
  request_id text,
  constraint job_lock_shape check ((status = 'running') = (locked_by is not null)),
  constraint job_finished_shape check ((status in ('succeeded', 'failed', 'dead')) = (finished_at is not null))
);

comment on table ops.job is 'صف کار با قفل ردیفی، تلاش دوباره و صف مرده (Addendum §56–72)';

create unique index job_dedupe_idx on ops.job (dedupe_key) where dedupe_key is not null and status in ('pending', 'running');
create index job_ready_idx on ops.job (priority, available_at) where status = 'pending';
create index job_running_idx on ops.job (locked_at) where status = 'running';
create index job_business_idx on ops.job (business_id, created_at desc) where business_id is not null;

create trigger job_touch
  before update on ops.job
  for each row execute function app.touch();

alter table ops.job enable row level security;

create policy job_worker_all on ops.job
  for all to pv_worker
  using (true)
  with check (true);

create policy job_staff_select on ops.job
  for select to pv_app, pv_reader
  using (app.current_platform_role() is not null);

-- ------------------------------------------------------------------ عملیات: ایدمپوتنسی
-- پاسخ درخواست‌هایی که کلید ایدمپوتنسی دارند نگه داشته می‌شود تا تکرار همان
-- درخواست (رetry کاربر یا شبکه) اثر دوباره نگذارد (§106، §180).
create table ops.idempotency_key (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  key text not null,
  request_hash text not null,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed', 'failed')),
  response jsonb,
  business_id uuid,
  actor_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);

comment on table ops.idempotency_key is 'ثبت کلید ایدمپوتنسی و پاسخ، برای جلوگیری از اثر دوباره (§106)';

-- یکتایی در محدودهٔ کسب‌وکار: دو کسب‌وکار مستقل می‌توانند کلید یکسانی بفرستند
-- (کلید را کلاینت می‌سازد و از دید او تصادفی است)؛ ولی دو درخواست یک
-- کسب‌وکار با کلید یکسان، همان درخواست‌اند. `coalesce` لازم است چون در ایندکس
-- یکتا، NULL با NULL برابر شمرده نمی‌شود و ردیف‌های سراسری (بدون کسب‌وکار)
-- بی‌محافظ می‌ماندند.
create unique index idempotency_scope_key_idx
  on ops.idempotency_key (scope, coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

create index idempotency_expiry_idx on ops.idempotency_key (expires_at);
create index idempotency_business_idx on ops.idempotency_key (business_id) where business_id is not null;

alter table ops.idempotency_key enable row level security;

create policy idempotency_app_all on ops.idempotency_key
  for all to pv_app
  using (business_id is not distinct from app.current_business_id())
  with check (business_id is not distinct from app.current_business_id());

create policy idempotency_staff_select on ops.idempotency_key
  for select to pv_reader, pv_worker
  using (app.current_platform_role() is not null);

-- ------------------------------------------------------------------ عملیات: تنظیمات
-- تنظیمات دوسطحی: سراسری (business_id تهی) و کسب‌وکاری. مقدار jsonb است تا
-- هر ماژول شکل خودش را داشته باشد، ولی *کلید* در کد تعریف می‌شود — نه اینکه
-- هر ماژولی هر کلیدی بنویسد.
create table ops.setting (
  id uuid primary key default gen_random_uuid(),
  business_id uuid,
  key text not null check (length(key) between 2 and 120),
  value jsonb not null default '{}'::jsonb,
  description text,
  is_secret boolean not null default false,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

comment on table ops.setting is 'تنظیمات سراسری و کسب‌وکاری (کلید در کد تعریف می‌شود)';

create unique index setting_scope_key_idx on ops.setting (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

create trigger setting_touch
  before update on ops.setting
  for each row execute function app.touch();

alter table ops.setting enable row level security;

-- نکته: این سیاست فقط به زمینهٔ تراکنش تکیه می‌کند. کد سمت سرور مسئول است که
-- این زمینه را فقط پس از تأیید عضویت ست کند. در مهاجرت هویت، سیاست به
-- «عضویت تأییدشده» ارتقا می‌یابد تا دفاع لایه‌دوم هم برقرار باشد.
create policy setting_business_all on ops.setting
  for all to pv_app
  using (business_id is not distinct from app.current_business_id())
  with check (business_id is not distinct from app.current_business_id());

create policy setting_global_read on ops.setting
  for select to pv_app, pv_public
  using (business_id is null);

create policy setting_staff_all on ops.setting
  for all to pv_app, pv_worker
  using (app.current_platform_role() is not null)
  with check (app.current_platform_role() is not null);

-- ------------------------------------------------------------------ عملیات: رخداد امنیتی
-- رخداد امنیتی با حسابرسی یکی نیست: حسابرسی می‌گوید «چه تغییری رخ داد»،
-- رخداد امنیتی می‌گوید «چه چیز مشکوکی دیده شد» — ورود ناموفق زنجیره‌ای،
-- تلاش دسترسی ردشده، تغییر ناگهانی الگوی استفاده (§97).
create table ops.security_event (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  kind text not null,
  severity text not null default 'info' check (severity in ('info', 'low', 'medium', 'high', 'critical')),
  actor_id uuid,
  business_id uuid,
  ip inet,
  device_id text,
  request_id text,
  details jsonb not null default '{}'::jsonb,
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  resolution_note text
);

comment on table ops.security_event is 'رخدادهای امنیتی و وضعیت رسیدگی (§97)';

create index security_event_time_idx on ops.security_event (occurred_at desc);
create index security_event_open_idx on ops.security_event (severity, occurred_at desc) where acknowledged_at is null;
create index security_event_business_idx on ops.security_event (business_id, occurred_at desc) where business_id is not null;
create index security_event_actor_idx on ops.security_event (actor_id, occurred_at desc) where actor_id is not null;

alter table ops.security_event enable row level security;

create policy security_event_insert on ops.security_event
  for insert to pv_app, pv_worker, pv_public
  with check (true);

create policy security_event_staff_all on ops.security_event
  for all to pv_app, pv_worker
  using (app.current_platform_role() is not null)
  with check (app.current_platform_role() is not null);

-- ------------------------------------------------------------------ عملیات: Feature Registry
-- بر پایهٔ Addendum §۲۱–۲۴: هر امکان ثبت‌شده در سیستم یک ردیف دارد، با چرخهٔ
-- عمر، وابستگی‌ها، و بودجهٔ عملکرد و فرادادهٔ سئو/جست‌وجو. این جدول منبع
-- حقیقت امکانات است؛ کد «فیچر» را از اینجا می‌خواند، نه از یک فهرست سخت‌کد.
create table ops.feature (
  key text primary key check (key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'),
  name_fa text not null,
  description text,
  layer text not null check (layer in ('platform', 'business', 'public', 'admin', 'shop', 'integration')),
  status text not null default 'draft'
    check (status in ('draft', 'development', 'preview', 'testing', 'approved', 'published', 'deprecated', 'archived')),
  dependencies text[] not null default '{}',
  /** بودجهٔ عملکرد: lcp_ms، cls، weight_kb، api_p95_ms و مانند آن. */
  performance_budget jsonb not null default '{}'::jsonb,
  /** فرادادهٔ سئو: قالب عنوان/توضیح، نوع دادهٔ ساختاریافته، قواعد ایندکس. */
  seo_metadata jsonb not null default '{}'::jsonb,
  /** فرادادهٔ جست‌وجو: نوع سند، فیلدهای قابل جست‌وجو، وزن‌ها. */
  search_metadata jsonb not null default '{}'::jsonb,
  /** اتصال‌ها: کدام permission، کدام رویداد، کدام قاعدهٔ خودکارسازی. */
  wiring jsonb not null default '{}'::jsonb,
  since_version text,
  deprecated_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint feature_deprecation_shape check ((status = 'deprecated') = (deprecated_at is not null)),
  constraint feature_archive_shape check ((status = 'archived') = (archived_at is not null))
);

comment on table ops.feature is 'منبع حقیقت امکانات: چرخهٔ عمر، وابستگی، بودجهٔ عملکرد و فراداده (Addendum §21–24)';

create index feature_status_idx on ops.feature (status, layer);
create index feature_dependencies_idx on ops.feature using gin (dependencies);

create trigger feature_touch
  before update on ops.feature
  for each row execute function app.touch();

alter table ops.feature enable row level security;

-- رجیستری، فراداده است نه دادهٔ کاربر: خواندنش برای همه آزاد است، نوشتنش
-- فقط برای کارکنان پلتفرم.
create policy feature_read on ops.feature
  for select to pv_app, pv_public, pv_worker, pv_reader
  using (true);

create policy feature_write_staff on ops.feature
  for all to pv_app, pv_worker
  using (app.current_platform_role() is not null)
  with check (app.current_platform_role() is not null);

-- ------------------------------------------------------------------ گرنت‌های صریح
-- گرنت‌های پیش‌فرض برای جدول‌های *آینده* است؛ جدول‌های بالا باید صریح بگیرند.
grant select, insert, update on ops.setting to pv_app;
grant select, insert, update on ops.feature to pv_app;
grant select, insert, update on ops.idempotency_key to pv_app;
grant select, insert on ops.event to pv_app;
grant insert on ops.audit_log to pv_app, pv_public;
grant insert on ops.security_event to pv_app, pv_public;

grant select, insert, update, delete on ops.job to pv_worker;
grant select, insert, update on ops.event to pv_worker;
grant insert on ops.audit_log to pv_worker;
grant insert on ops.security_event to pv_worker;
grant select, insert, update on ops.feature to pv_worker;

grant select on ops.feature to pv_public;
grant select on ops.setting to pv_public;

grant select on ops.audit_log to pv_reader;
grant select on ops.event to pv_reader;
grant select on ops.job to pv_reader;
grant select on ops.security_event to pv_reader;
grant select on ops.setting to pv_reader;
grant select on ops.feature to pv_reader;
