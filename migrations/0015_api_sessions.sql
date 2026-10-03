-- ---------------------------------------------------------------------------
-- 0015 — نشست‌های API، ورود، و کلید API (گام ۲۱؛ §7–۱۳، §64–۷۸، §191)
--
-- چرا این مهاجرت لازم شد: اسکیمای هویت از گام ۶ کامل بود — اعتبارنامه، نشست،
-- دستگاه، تلاش ورود، توکن یکبارمصرف، همه بودند و همه *خوانده* می‌شدند. اما
-- **ساختن نشست** هیچ مسیری نداشت، چون هیچ‌کس نباید بدون اثبات هویت نشست بسازد.
-- تابع ورود هم نداشتیم که «کسی که رمز را درست آورده» را به «نشست» تبدیل کند.
--
-- سه قاعده‌ای که در ADR-0011 تعیین شد، اینجا هم حاکم است:
--
--   ۱. نوشتن ممتاز، فقط از راه تابع `security definer` — و در همان تابع،
--      هویت از **مرجع** استخراج می‌شود، نه از پارامتر. یعنی `complete_login`
--      کاربر را از `identifier_hash` بلیت می‌گیرد، نه از چیزی که صدازننده
--      گفته باشد. پس پشت در، کسی نمی‌تواند برای کاربر دلخواه نشست بسازد.
--   ۲. گرنت جدول بسته است. `auth.login_ticket` و `app.api_key` هیچ گرنتی به
--      نقش‌های برنامه ندارند؛ فقط از راه توابع همان فایل دیده می‌شوند.
--   ۳. بلیت ورود، به **شناسهٔ درخواست زمینه** گره می‌خورد. یعنی بلیت یک
--      درخواست، در درخواست دیگری قابل مصرف نیست — و این، بازپخش را می‌بندد.
--
-- تصمیم دامنه‌ای که در خودِ SQL می‌نشیند، نه در کد برنامه (§103): طول عمر
-- نشست (۳۰ روز لغزان تا سقف ۱۸۰ روز)، سقف بلیت ورود (۹۰ ثانیه)، و قاعدهٔ
-- «کلید API = کارگزار مستقل با دامنهٔ مجوز خودش».
-- ---------------------------------------------------------------------------

-- ------------------------------------------------------------------ کمکی‌ها
create or replace function app.current_request_id()
returns text
language sql
stable
parallel safe
as $$
  select nullif(current_setting('app.request_id', true), '')
$$;

comment on function app.current_request_id is
  'شناسهٔ درخواست از زمینهٔ تراکنش؛ برای گره‌زدن بلیت ورود و پیوند لاگ/رخداد (§76)';

create or replace function app.current_impersonated_by()
returns uuid
language sql
stable
parallel safe
as $$
  select nullif(current_setting('app.impersonated_by', true), '')::uuid
$$;

comment on function app.current_impersonated_by is 'کارمندی که با اختیار کاربر وارد شده (§31)';

/** کارگزار کلید API: تهی یعنی درخواست با کلید نیامده است. */
create or replace function app.current_api_key_id()
returns uuid
language sql
stable
parallel safe
as $$
  select nullif(current_setting('app.api_key_id', true), '')::uuid
$$;

create or replace function app.current_api_key_business_id()
returns uuid
language sql
stable
parallel safe
as $$
  select nullif(current_setting('app.api_key_business_id', true), '')::uuid
$$;

/** دامنهٔ مجوز کلید؛ رشتهٔ جدا‌شده با کاما، چون تنظیم زمینه رشته است. */
create or replace function app.current_api_key_scopes()
returns text[]
language sql
stable
parallel safe
as $$
  select case
    when coalesce(current_setting('app.api_key_scopes', true), '') = '' then '{}'::text[]
    else string_to_array(current_setting('app.api_key_scopes', true), ',')
  end
$$;

comment on function app.current_api_key_scopes is
  'مجوزهای کلید API؛ همین آرایه، تصمیم مجوز کلید را می‌سازد (نه نقش کاربر)';

-- ------------------------------------------------------------- بلیت ورود
/*
 * بلیت ورود، تنها راه عبور از «بی‌نام» به «دارای نشست» است.
 *
 * چرا بلیت لازم است و بی‌آن نمی‌شد: بررسی رمز در لایهٔ برنامه انجام می‌شود
 * (Argon2id در Node، §7). پس لحظهٔ بین «رمز درست بود» و «نشست بساز» یک
 * فاصلهٔ اعتماد است. اگر `create_session(user_id, …)` آزاد بود، هر کدی که به
 * پایگاه‌داده دسترسی داشت می‌توانست برای هر کاربری نشست بسازد. بلیت این
 * فاصله را به یک رکورد یکبارمصرف، زمان‌دار، و گره‌خورده به همان درخواست
 * تبدیل می‌کند.
 */
create table auth.login_ticket (
  id uuid primary key default gen_random_uuid(),
  /** شناسهٔ درهم‌شدهٔ ورود؛ کاربر از همین ستون استخراج می‌شود، نه از پارامتر. */
  identifier_hash text not null check (char_length(identifier_hash) = 64),
  request_id text not null check (char_length(request_id) between 8 and 128),
  ip inet,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '90 seconds',
  consumed_at timestamptz,
  succeeded boolean,
  failure_reason text,
  session_id uuid
);

create index login_ticket_lookup_idx on auth.login_ticket (identifier_hash, created_at desc);
create index login_ticket_expiry_idx on auth.login_ticket (expires_at) where consumed_at is null;

comment on table auth.login_ticket is
  'بلیت یکبارمصرف ورود؛ گره‌خورده به شناسهٔ درخواست، با سقف ۹۰ ثانیه (§11، §191)';

alter table auth.login_ticket enable row level security;

/*
 * سیاست «بسته»: هیچ نقشی از راه جدول به بلیت دست نمی‌زند. یک سیاست لازم است
 * (قرارداد پوشش: جدول بی‌سیاست یعنی احتمالاً جدولی جا مانده)، ولی این سیاست
 * عمداً هیچ‌چیز را مجاز نمی‌کند — دسترسی فقط از راه توابع `security definer`
 * است که به‌عنوان مالک اجرا می‌شوند.
 */
create policy login_ticket_closed on auth.login_ticket
  for all to pv_app using (false) with check (false);

revoke all on auth.login_ticket from pv_app, pv_worker, pv_public, pv_reader;

/*
 * بلیت ثبت‌نام، هم‌زادِ بلیت ورود و با همان منطق: یک کار بی‌هویت (ساخت
 * حساب) باید گره‌خورده به یک درخواست، یک‌بارمصرف و زمان‌دار باشد. تفاوتش این
 * است که اینجا «مرجع» همان شناسه‌ای است که کاربر تازه می‌آورد — پس کاربر از
 * پارامتر نمی‌آید، از خودِ بلیت می‌آید.
 */
create table auth.registration_ticket (
  id uuid primary key default gen_random_uuid(),
  identifier_hash text not null check (char_length(identifier_hash) = 64),
  identifier_kind text not null check (identifier_kind in ('email', 'phone')),
  request_id text not null check (char_length(request_id) between 8 and 128),
  ip inet,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  consumed_at timestamptz,
  user_id uuid references auth.app_user (id) on delete set null,
  failure_reason text
);

create index registration_ticket_lookup_idx on auth.registration_ticket (identifier_hash, created_at desc);
create index registration_ticket_expiry_idx on auth.registration_ticket (expires_at) where consumed_at is null;

comment on table auth.registration_ticket is
  'بلیت یکبارمصرف ثبت‌نام؛ گره‌خورده به درخواست، با سقف ۱۵ دقیقه (§6–۷)';

alter table auth.registration_ticket enable row level security;
create policy registration_ticket_closed on auth.registration_ticket
  for all to pv_app using (false) with check (false);

revoke all on auth.registration_ticket from pv_app, pv_worker, pv_public, pv_reader;

/**
 * گام یکم ثبت‌نام: بلیت، اگر و تنها اگر شناسه آزاد باشد.
 *
 * اینجا **صریح** می‌گوییم که شناسه تکراری است (خطای `23505`). دلیلش این است
 * که در ثبت‌نام، «این ایمیل قبلاً استفاده شده» یک واقعیت لازم برای کاربر
 * است، نه یک نشت؛ پنهان‌کردنش فقط کاربر را سرگردان می‌کند. جریان
 * افشاناپذیر (پاسخ یکسان + ایمیل تأیید) وقتی می‌آید که درایور ایمیل فعال
 * باشد — و آن زمان، همین تابع تغییر نمی‌کند، فقط لایهٔ API پاسخ را عوض
 * می‌کند.
 */
create or replace function app.begin_registration(
  p_identifier_hash text,
  p_identifier_kind text default 'email',
  p_ip inet default null
)
returns table (ticket_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, auth, app
as $$
declare
  v_request text := app.current_request_id();
begin
  if p_identifier_hash is null or char_length(p_identifier_hash) <> 64 then
    raise exception 'شناسهٔ درهم ثبت‌نام نامعتبر است' using errcode = '22023';
  end if;

  if p_identifier_kind not in ('email', 'phone') then
    raise exception 'نوع شناسهٔ ثبت‌نام باید email یا phone باشد' using errcode = '22023';
  end if;

  if v_request is null then
    raise exception 'شناسهٔ درخواست در زمینه نیست؛ بلیت ثبت‌نام بدون آن ساخته نمی‌شود' using errcode = '55000';
  end if;

  if exists (
    select 1 from auth.identity i
    where i.value_key = p_identifier_hash and i.deleted_at is null
  ) then
    raise exception 'این شناسه قبلاً ثبت شده است' using errcode = 'unique_violation';
  end if;

  return query
    insert into auth.registration_ticket (identifier_hash, identifier_kind, request_id, ip)
    values (p_identifier_hash, p_identifier_kind, v_request, p_ip)
    returning registration_ticket.id, registration_ticket.expires_at;
end
$$;

comment on function app.begin_registration is
  'ساخت بلیت ثبت‌نام برای شناسهٔ آزاد؛ شناسهٔ تکراری با 23505 رد می‌شود (§6)';

/**
 * گام دوم ثبت‌نام: مصرف بلیت و ساخت کاربر، هویت و اعتبارنامه — اتمی.
 *
 * چرا همه در یک تابع: اگر ساخت کاربر و اعتبارنامه دو مرحلهٔ جدا بود، یک
 * شکست وسط کار، «کاربرِ بی‌رمز» می‌ساخت؛ حسابی که نه می‌تواند وارد شود و نه
 * کسی می‌داند چرا. تراکنش، این حالت را ناممکن می‌کند.
 */
create or replace function app.complete_registration(
  p_ticket_id uuid,
  p_display_name text,
  p_secret_hash text,
  p_locale text default 'fa-IR',
  p_timezone text default 'Asia/Tehran'
)
returns table (user_id uuid, identity_id uuid, credential_id uuid, display_name text)
language plpgsql
security definer
set search_path = pg_catalog, auth, app
as $$
declare
  v_ticket auth.registration_ticket;
  v_user auth.app_user;
  v_identity auth.identity;
  v_credential auth.credential;
  v_request text := app.current_request_id();
begin
  select * into v_ticket
  from auth.registration_ticket t
  where t.id = p_ticket_id
  for update;

  if not found then
    return;
  end if;

  if v_ticket.request_id is distinct from v_request then
    raise exception 'بلیت ثبت‌نام به درخواست دیگری تعلق دارد' using errcode = '42501';
  end if;

  if v_ticket.consumed_at is not null or v_ticket.expires_at <= now() then
    update auth.registration_ticket t
       set consumed_at = coalesce(t.consumed_at, now()),
           failure_reason = coalesce(t.failure_reason, 'expired_or_reused')
     where t.id = v_ticket.id;
    return;
  end if;

  /*
   * اینجا درهمِ *راز کلید ورود* (sha-256 هگز) می‌آید یا درهمِ *گذرواژه*
   * (رشتهٔ کدشدهٔ Argon2)؟ هیچ‌کدام — این پارامتر درهمِ گذرواژه است و قالبش
   * مالِ کتابخانهٔ درهم‌ساز است، پس قالب را تحمیل نمی‌کنیم؛ فقط کمینهٔ
   * معناداری را می‌سنجیم تا رازِ خام یا رشتهٔ خالی رد شود.
   */
  if p_secret_hash is null or char_length(p_secret_hash) < 32 then
    raise exception 'درهم اعتبارنامه نامعتبر است' using errcode = '22023';
  end if;

  if btrim(coalesce(p_display_name, '')) = '' then
    raise exception 'نام نمایشی لازم است' using errcode = '22023';
  end if;

  /* در همین تراکنش، رقابت دو ثبت‌نام با یک شناسه بسته می‌شود. */
  if exists (
    select 1 from auth.identity i
    where i.value_key = v_ticket.identifier_hash and i.deleted_at is null
  ) then
    update auth.registration_ticket t
       set consumed_at = now(), failure_reason = 'identifier_taken'
     where t.id = v_ticket.id;
    raise exception 'این شناسه قبلاً ثبت شده است' using errcode = 'unique_violation';
  end if;

  select * into v_user
  from app.register_user(btrim(p_display_name), coalesce(p_locale, 'fa-IR'), coalesce(p_timezone, 'Asia/Tehran'));

  insert into auth.identity (user_id, kind, value_key, value_display, is_primary, verified_at)
  values (v_user.id, v_ticket.identifier_kind, v_ticket.identifier_hash, left(v_ticket.identifier_hash, 12) || '…', true, null)
  returning * into v_identity;

  insert into auth.credential (user_id, kind, secret_hash, hash_params)
  values (v_user.id, 'password', p_secret_hash, '{}'::jsonb)
  returning * into v_credential;

  update auth.registration_ticket t
     set consumed_at = now(), user_id = v_user.id
   where t.id = v_ticket.id;

  return query select v_user.id, v_identity.id, v_credential.id, v_user.display_name;
end
$$;

comment on function app.complete_registration is
  'ساخت اتمی کاربر + هویت + اعتبارنامه از بلیت ثبت‌نام؛ بلیت از درخواست دیگری پذیرفته نمی‌شود (§6–۷)';

-- -------------------------------------------------------------- کلید API
/*
 * کلید API، کارگزار مستقل است: نه کاربر، نه عضو. یک کسب‌وکار، یک فهرست
 * مجوز، و یک هش. کلید خام هرگز ذخیره نمی‌شود — فقط SHA-256 آن.
 *
 * دامنهٔ مجوز کلید (`scopes`) از همان ۶۱ مجوز سیستم انتخاب می‌شود؛ پس
 * «کلید فهرست‌خوان» و «کلید محتوا‌نویس» دو چیزند و هیچ‌کدام نمی‌توانند کاری
 * کنند که مجوزش را ندارند.
 */
create table app.api_key (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references app.business (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  /** پیشوند نمایشی (`pvk_live_ab12…`) برای شناسایی در UI؛ راز نیست. */
  key_prefix text not null check (char_length(key_prefix) between 6 and 32),
  /*
   * هش کلید با پیشوند الگوریتم ذخیره می‌شود (`sha256:<64hex>`) — همان قالب
   * `auth.session.secret_hash`. یک قالب برای همهٔ رازها یعنی «بازبینیِ
   * یک‌نگاهه» ممکن است؛ دو قالب، یعنی روزی یکی‌شان وصله نمی‌شود.
   */
  key_hash text not null unique check (key_hash ~ '^sha256:[0-9a-f]{64}$'),
  scopes text[] not null default '{}',
  created_by uuid references auth.app_user (id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  last_used_ip inet,
  request_count bigint not null default 0,
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text
);

create index api_key_business_idx on app.api_key (business_id) where revoked_at is null;

comment on table app.api_key is
  'کارگزار ماشین‌به‌ماشین: هش‌شده، دامنه‌دار، و برای هر کسب‌وکار جدا (§74، §79)';

alter table app.api_key enable row level security;
create policy api_key_closed on app.api_key
  for all to pv_app using (false) with check (false);

revoke all on app.api_key from pv_app, pv_worker, pv_public, pv_reader;

-- ------------------------------------------------------------------ توابع
/**
 * گام یکم ورود: ساخت بلیت، گره‌خورده به همین درخواست.
 *
 * هیچ تصمیمی دربارهٔ کاربر نمی‌گیرد — فقط می‌گوید «کسی دارد برای این شناسه
 * تلاش می‌کند، در این درخواست». همین که بلیت بی‌هویت است، اجازه می‌دهد این
 * تابع را در مسیر بی‌نام هم صدا زد.
 */
create or replace function app.begin_login(
  p_identifier_hash text,
  p_ip inet default null
)
returns table (ticket_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, auth, app
as $$
declare
  v_request text := app.current_request_id();
begin
  if p_identifier_hash is null or char_length(p_identifier_hash) <> 64 then
    raise exception 'شناسهٔ درهم ورود نامعتبر است' using errcode = '22023';
  end if;

  /*
   * بی‌شناسهٔ درخواست، بلیت ساخته نمی‌شود. این سخت‌گیری عمدی است: بدون آن،
   * گره‌زدن به درخواست وجود ندارد و بلیت می‌تواند در جای دیگری مصرف شود.
   */
  if v_request is null then
    raise exception 'شناسهٔ درخواست در زمینه نیست؛ بلیت ورود بدون آن ساخته نمی‌شود' using errcode = '55000';
  end if;

  return query
    insert into auth.login_ticket (identifier_hash, request_id, ip)
    values (p_identifier_hash, v_request, p_ip)
    returning login_ticket.id, login_ticket.expires_at;
end
$$;

comment on function app.begin_login is
  'ساخت بلیت یکبارمصرف ورود، گره‌خورده به شناسهٔ درخواست (§11)';

/**
 * گام دوم ورود: مصرف بلیت و — در صورت موفقیت — ساخت نشست.
 *
 * سه نکتهٔ امنیتی که همه در همین تابع تحمیل می‌شوند:
 *
 *   • **کاربر از بلیت استخراج می‌شود**، با جست‌وجوی همان `identifier_hash`
 *     در `auth.identity`. حتی اگر صدازننده بخواهد، نمی‌تواند کاربر دیگری را
 *     نام ببرد؛ پارامتری برای آن وجود ندارد.
 *   • **بلیت یکبارمصرف است** (`for update` + بررسی `consumed_at`)، پس دو
 *     درخواست هم‌زمان نمی‌توانند یک بلیت را دو بار بسوزانند.
 *   • **نتیجهٔ تلاش، همیشه ثبت می‌شود** — موفق و ناموفق، با همان تابع
 *     `auth.record_login_attempt` که قفل تدریجی را هم اعمال می‌کند. پس مسیر
 *     ورود نمی‌تواند «ثبت را فراموش کند».
 */
create or replace function app.complete_login(
  p_ticket_id uuid,
  p_succeeded boolean,
  p_secret_hash text default null,
  p_aal smallint default 1,
  p_failure_reason text default null,
  p_ip inet default null,
  p_device_hash text default null,
  p_user_agent text default null,
  p_risk_score smallint default null,
  p_session_id uuid default null
)
returns table (
  session_id uuid,
  expires_at timestamptz,
  absolute_expires_at timestamptz,
  locked_until timestamptz,
  failed_login_count integer,
  user_id uuid,
  display_name text,
  locale text,
  mfa_required boolean
)
language plpgsql
security definer
set search_path = pg_catalog, auth, app
as $$
declare
  v_ticket auth.login_ticket;
  v_user_id uuid;
  v_attempt record;
  v_session auth.session;
  v_device_id uuid;
  v_request text := app.current_request_id();
begin
  select * into v_ticket
  from auth.login_ticket t
  where t.id = p_ticket_id
  for update;

  if not found then
    return;
  end if;

  -- بلیت درخواست دیگری، بلیت این درخواست نیست.
  if v_ticket.request_id is distinct from v_request then
    raise exception 'بلیت ورود به درخواست دیگری تعلق دارد' using errcode = '42501';
  end if;

  if v_ticket.consumed_at is not null or v_ticket.expires_at <= now() then
    -- بلیت سوخته یا منقضی: پاسخ، همان «نشستی ساخته نشد» است، بدون افشای علت.
    return;
  end if;

  -- کاربر از مرجع: شناسهٔ درهم، نه پارامتر.
  select i.user_id into v_user_id
  from auth.identity i
  join auth.app_user u on u.id = i.user_id
  where i.value_key = v_ticket.identifier_hash
    and i.deleted_at is null
    and u.deleted_at is null
  limit 1;

  update auth.login_ticket t
     set consumed_at = now(),
         succeeded = coalesce(p_succeeded, false),
         failure_reason = p_failure_reason
   where t.id = v_ticket.id;

  if v_user_id is null then
    /* شناسهٔ ناشناس: نه نشستی، نه سرنخی. تأخیر مصنوعی اینجا نیست — لایهٔ
       برنامه مسئول یکسان‌سازی زمان پاسخ است (§13، پیام غیرافشاگر). */
    return;
  end if;

  select * into v_attempt
  from auth.record_login_attempt(
    v_ticket.identifier_hash,
    v_user_id,
    'password',
    coalesce(p_succeeded, false),
    p_failure_reason,
    coalesce(p_ip, v_ticket.ip),
    p_device_hash,
    v_request,
    p_risk_score
  );

  -- حساب قفل، یا وضعیت نامجاز: نشست ساخته نمی‌شود، ولی تلاش ثبت شد.
  if coalesce(p_succeeded, false) is not true or v_attempt.locked_until is not null then
    return query
      select null::uuid, null::timestamptz, null::timestamptz,
             v_attempt.locked_until, v_attempt.failed_login_count,
             v_user_id, null::text, null::text, null::boolean;
    return;
  end if;

  /*
   * درهم راز نشست با پیشوند الگوریتم ذخیره می‌شود (`sha256:<64hex>`) تا روزی
   * که الگوریتم عوض شود، ردیف‌های قدیمی بدون مهاجرت داده شناخته شوند. پس
   * قالب را کامل می‌سنجیم، نه فقط طول را (§9).
   */
  if p_secret_hash is null or p_secret_hash !~ '^sha256:[0-9a-f]{64}$' then
    raise exception 'درهم راز نشست نامعتبر است' using errcode = '22023';
  end if;

  /*
   * دستگاه: اگر اثر انگشت آمده باشد، دستگاه ثبت یا تازه می‌شود و به نشست
   * می‌چسبد. «دستگاه تازه» بعداً ورودی تحلیل ریسک است (§13) — و برای آن،
   * باید از همین لحظه ثبت شده باشد.
   */
  if p_device_hash is not null and char_length(p_device_hash) >= 32 then
    insert into auth.device (user_id, fingerprint_hash, user_agent, first_ip, last_ip)
    values (
      v_user_id, p_device_hash,
      nullif(left(coalesce(p_user_agent, ''), 400), ''), coalesce(p_ip, v_ticket.ip), coalesce(p_ip, v_ticket.ip)
    )
    on conflict (user_id, fingerprint_hash) where revoked_at is null do update
      set last_seen_at = now(), last_ip = coalesce(excluded.last_ip, auth.device.last_ip)
    returning id into v_device_id;
  end if;

  /*
   * سیاست طول عمر نشست، اینجا است نه در کد برنامه: ۳۰ روز لغزان، تا سقف
   * مطلق ۱۸۰ روز. نشستی که هر روز استفاده می‌شود، بی‌نهایت زنده نمی‌ماند.
   */
  /*
   * شناسهٔ نشست را **صدازننده** می‌دهد، نه پایگاه‌داده.
   *
   * چرا تصمیم مهمی است: توکنی که به مرورگر می‌رود، شناسهٔ نشست را در خود
   * دارد (`pv1.<session_id>.<secret>`) و نرخ بازشناخت هم با همان شناسه انجام
   * می‌شود. اگر پایگاه‌داده شناسهٔ خودش را می‌ساخت، توکنِ صادرشده هرگز به
   * ردیفش نمی‌رسید و کوکی معتبر، در نگاه بعدی بی‌نام می‌شد. پس یا باید
   * توکن *بعد از* درج ساخته می‌شد (یعنی راز خام می‌رفت و بعد درهم می‌شد)، یا
   * شناسه از بالا می‌آمد. دومی انتخاب شد: راز همچنان پیش از درج درهم می‌شود.
   */
  if p_session_id is null then
    raise exception 'شناسهٔ نشست لازم است' using errcode = '22023';
  end if;

  insert into auth.session (
    id, user_id, secret_hash, aal, expires_at, absolute_expires_at,
    user_agent, request_id, last_seen_ip, device_id
  ) values (
    p_session_id, v_user_id, p_secret_hash, greatest(coalesce(p_aal, 1), 1),
    now() + interval '30 days', now() + interval '180 days',
    nullif(left(coalesce(p_user_agent, ''), 400), ''), v_request, coalesce(p_ip, v_ticket.ip),
    v_device_id
  )
  returning * into v_session;

  update auth.login_ticket t set session_id = v_session.id where t.id = v_ticket.id;

  return query
    select v_session.id, v_session.expires_at, v_session.absolute_expires_at,
           null::timestamptz, v_attempt.failed_login_count,
           u.id, u.display_name, u.locale, u.mfa_required
    from auth.app_user u
    where u.id = v_user_id;
end
$$;

comment on function app.complete_login is
  'مصرف اتمی بلیت ورود و ساخت نشست؛ کاربر از مرجع استخراج می‌شود، نه از پارامتر (§7، §11)';

/**
 * بازشناخت نشست از روی کوکی، و به‌روزرسانی «آخرین بازدید».
 *
 * این تابع، مرز اعتماد هر درخواست احراز‌شده است. اگر برنگرداند، درخواست
 * بی‌نام است — نه خطا، نه استثنا. سه حالت «برنگرداند» عمداً از هم تفکیک
 * نمی‌شوند: نشست ناموجود، راز نادرست، و نشست باطل‌شده، همه یک پاسخ دارند.
 */
create or replace function app.resolve_session(
  p_session_id uuid,
  p_secret_hash text,
  p_ip inet default null,
  p_user_agent text default null
)
returns table (
  session_id uuid,
  token_user_id uuid,
  display_name text,
  locale text,
  timezone text,
  aal smallint,
  step_up_at timestamptz,
  platform_role text,
  impersonated_by uuid,
  active_business_id uuid,
  issued_at timestamptz,
  expires_at timestamptz,
  absolute_expires_at timestamptz
)
language sql
security definer
set search_path = pg_catalog, auth, app
as $$
  with touched as (
    update auth.session s
       set last_seen_at = now(),
           last_seen_ip = coalesce(p_ip, s.last_seen_ip),
           user_agent = coalesce(nullif(left(coalesce(p_user_agent, ''), 400), ''), s.user_agent),
           -- تمدید لغزان: با هر بازدید، ۳۰ روز جلو می‌رود ولی از سقف مطلق نمی‌گذرد.
           expires_at = least(now() + interval '30 days', s.absolute_expires_at)
     where s.id = p_session_id
       and s.secret_hash = p_secret_hash
       and s.revoked_at is null
       and s.expires_at > now()
       and s.absolute_expires_at > now()
    returning s.*
  )
  select
    t.id, t.user_id, u.display_name, u.locale, u.timezone,
    t.aal, t.step_up_at,
    (
      select upr.role_key
      from auth.user_platform_role upr
      where upr.user_id = t.user_id
        and upr.revoked_at is null
        and (upr.expires_at is null or upr.expires_at > now())
      order by upr.granted_at desc
      limit 1
    ) as platform_role,
    t.impersonated_by, t.active_business_id, t.created_at, t.expires_at, t.absolute_expires_at
  from touched t
  join auth.app_user u on u.id = t.user_id
  where u.deleted_at is null
    and u.suspended_at is null
    and (u.locked_until is null or u.locked_until <= now())
$$;

comment on function app.resolve_session is
  'بازشناخت نشست از کوکی + تمدید لغزان + آخرین بازدید؛ بازنگشتن یعنی بی‌نام (§7–۸)';

/**
 * بستن نشست جاری.
 *
 * «دلیل» از واژگان بستهٔ قید `auth.session.revoked_reason` می‌آید
 * (`logout | rotate | admin | security | expired | ownership`). پارامتر آزاد
 * اینجا یک تله است: هر رشتهٔ ناشناس، `check_violation` می‌دهد و کاربری که
 * فقط می‌خواست خارج شود، خطای «ورودی نامعتبر» می‌گیرد — که همین اتفاق در
 * آزمون واقعی افتاد. پس دلیل ناشناس، به `logout` فروکاسته می‌شود، نه اینکه
 * رد شود: خروج کاربر هرگز نباید به‌خاطر برچسب شکست بخورد.
 *
 * `security` و `admin` از راه این تابع پذیرفته **نمی‌شوند**: باطل‌کردن امنیتی
 * کار کارکنان است، نه چیزی که کاربر برای نشست خودش بخواهد (§14، §191).
 */
create or replace function app.logout(p_reason text default null)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, auth, app
as $$
declare
  v_session uuid := app.current_session_id();
begin
  if v_session is null then
    return false;
  end if;

  update auth.session s
     set revoked_at = now(),
         revoked_reason = case when p_reason in ('rotate', 'expired', 'ownership') then p_reason else 'logout' end
   where s.id = v_session
     and s.revoked_at is null;

  return found;
end
$$;

comment on function app.logout is 'باطل‌کردن نشست جاری با دلیل ثبت‌شده (§9)';

/**
 * تغییر کسب‌وکار فعال نشست.
 *
 * «کسب‌وکار فعال» در نشست ذخیره می‌شود، نه در کوکی: اگر در کوکی بود، کاربر
 * می‌توانست کسب‌وکاری را نام ببرد که عضوش نیست و امیدوار باشد جایی باور شود.
 * اینجا عضویت، پیش از نوشتن، سنجیده می‌شود.
 */
create or replace function app.switch_business(p_business_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, auth, app
as $$
declare
  v_session uuid := app.current_session_id();
  v_user uuid := app.current_user_id();
begin
  if v_session is null or v_user is null then
    return false;
  end if;

  if not exists (
    select 1 from app.membership m
    where m.business_id = p_business_id
      and m.user_id = v_user
      and m.status = 'active'
      and m.deleted_at is null
  ) then
    return false;
  end if;

  update auth.session s
     set active_business_id = p_business_id
   where s.id = v_session
     and s.user_id = v_user
     and s.revoked_at is null;

  return found;
end
$$;

comment on function app.switch_business is 'تغییر کسب‌وکار فعال نشست، پس از سنجش عضویت (§18)';

-- -------------------------------------------------------------- کلید API
/**
 * ساخت کلید API. کلید خام در این تابع دیده نمی‌شود؛ فقط هش و پیشوند.
 *
 * مجوز لازم، `business.integration.manage` است: کلید API، اتصال بیرونی به
 * کسب‌وکار می‌سازد و از همین جنس است. هر دامنهٔ مجوزی که رد شود، درج کل را
 * رد می‌کند — تا کلیدی با مجوز خیالی ساخته نشود.
 */
create or replace function app.issue_api_key(
  p_business_id uuid,
  p_name text,
  p_key_hash text,
  p_key_prefix text,
  p_scopes text[] default '{}',
  p_expires_at timestamptz default null
)
returns table (key_id uuid, created_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, auth, app
as $$
declare
  v_bad text;
begin
  if not app.has_permission(p_business_id, 'business.integration.manage') then
    raise exception 'برای ساخت کلید API مجوز business.integration.manage لازم است' using errcode = '42501';
  end if;

  if p_key_hash is null or p_key_hash !~ '^sha256:[0-9a-f]{64}$' then
    raise exception 'هش کلید نامعتبر است؛ قالب درست sha256:<64hex> است' using errcode = '22023';
  end if;

  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'تاریخ انقضای کلید در گذشته است' using errcode = '22023';
  end if;

  select s into v_bad
  from unnest(coalesce(p_scopes, '{}'::text[])) as s
  where not exists (select 1 from auth.permission p where p.key = s)
  limit 1;

  if v_bad is not null then
    raise exception 'دامنهٔ مجوز ناشناس: %', v_bad using errcode = '22023';
  end if;

  return query
    insert into app.api_key (business_id, name, key_prefix, key_hash, scopes, created_by, expires_at)
    values (
      p_business_id, trim(p_name), p_key_prefix, p_key_hash,
      coalesce(p_scopes, '{}'::text[]), app.current_user_id(), p_expires_at
    )
    returning api_key.id, api_key.created_at;
end
$$;

comment on function app.issue_api_key is
  'ساخت کلید API با دامنهٔ مجوز اعتبارسنجی‌شده؛ نیازمند business.integration.manage';

/**
 * بازشناخت کلید API.
 *
 * کلید منقضی یا باطل، «هیچ» برمی‌گرداند. شمارندهٔ مصرف هم اینجا زیاد می‌شود،
 * چون همین‌جا معلوم است که کلید واقعاً استفاده شده — نه در جایی که ممکن است
 * فراموش شود.
 */
create or replace function app.resolve_api_key(p_key_hash text, p_ip inet default null)
returns table (key_id uuid, key_business_id uuid, key_scopes text[])
language sql
security definer
set search_path = pg_catalog, auth, app
as $$
  with used as (
    update app.api_key k
       set last_used_at = now(),
           last_used_ip = p_ip,
           request_count = k.request_count + 1
     where k.key_hash = p_key_hash
       and k.revoked_at is null
       and (k.expires_at is null or k.expires_at > now())
    returning k.id, k.business_id, k.scopes
  )
  select u.id, u.business_id, u.scopes from used u
$$;

comment on function app.resolve_api_key is
  'بازشناخت کلید API با هش؛ باطل/منقضی هیچ برمی‌گرداند (§74)';

/** باطل‌کردن کلید؛ با همان مجوز ساخت. */
create or replace function app.revoke_api_key(p_key_id uuid, p_reason text default null)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, auth, app
as $$
declare
  v_business uuid;
begin
  select k.business_id into v_business from app.api_key k where k.id = p_key_id;

  if v_business is null then
    return false;
  end if;

  if not app.has_permission(v_business, 'business.integration.manage') then
    raise exception 'برای باطل‌کردن کلید API مجوز business.integration.manage لازم است' using errcode = '42501';
  end if;

  update app.api_key k
     set revoked_at = now(),
         revoked_reason = coalesce(nullif(p_reason, ''), 'revoked')
   where k.id = p_key_id
     and k.revoked_at is null;

  return found;
end
$$;

comment on function app.revoke_api_key is 'باطل‌کردن کلید API؛ باطل‌شده دیگر بازشناخته نمی‌شود';

-- ------------------------------------------- کلید API در مدل مجوز (یک‌جا و بس)
/*
 * چرا این دو تابع بازنویسی می‌شوند و نه اینکه API خودش تصمیم بگیرد:
 *
 * §14 می‌گوید تصمیم دسترسی سمت سرور است، و §54 می‌گوید RLS حصار دوم است.
 * اگر کلید API بیرون از این دو تابع مجوز می‌گرفت، RLS هیچ‌چیز از کلید
 * نمی‌دانست و کلید یا همه‌چیز می‌دید یا هیچ. پس کلید API یک **کارگزار** در
 * همان مدل است: ایزوله‌سازی مستأجر با کسب‌وکارش، و مجوز فقط در حد دامنه‌اش.
 *
 * نکتهٔ مهم: `app.role_of` برای کلید هیچ نقشی برنمی‌گرداند. پس سیاست‌هایی که
 * به نقش مشخصی گره خورده‌اند، برای کلید بسته می‌مانند — و این عمدی است.
 */
create or replace function app.is_member_of(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, app
as $$
  /*
   * `coalesce(..., false)` تزئینی نیست؛ یک شکاف واقعی را می‌بندد.
   *
   * `p_business_id = app.current_api_key_business_id()` وقتی زمینهٔ کلید API
   * خالی باشد، `NULL` می‌دهد (نه `false`)؛ پس مجموع
   * «`exists(...) OR NULL`» برای کاربر بی‌عضویت `NULL` می‌شود. هر جا این
   * نتیجه در شرطی مثل `if not app.is_member_of(...) then raise` بنشیند، شرط
   * `NULL` می‌شود و **استثنا پرت نمی‌شود** — یعنی نگهبان، خاموش. آزمون واقعی
   * همین را گرفت: غیرعضو توانست دروازهٔ انتشار را بخواند.
   *
   * قاعدهٔ کلی: تابع تصمیم دسترسی، همیشه بولیِ سخت برمی‌گرداند.
   */
  select coalesce(
    exists (
      select 1
      from app.membership m
      where m.business_id = p_business_id
        and m.user_id = app.current_user_id()
        and m.status = 'active'
        and m.deleted_at is null
    )
    or p_business_id = app.current_api_key_business_id(),
    false
  )
$$;

comment on function app.is_member_of is
  'ستون فقرات ایزوله‌سازی مستأجر؛ مبنای سیاست‌های RLS جدول‌های tenant (§14) + کارگزار کلید API';

create or replace function app.has_permission(p_business_id uuid, p_permission_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, app, auth
as $$
declare
  v_grant jsonb;
  v_revoke jsonb;
  v_has boolean;
begin
  /* کارمند پلتفرم: دسترسی کامل — ولی هر فراخوانی، رد حسابرسی می‌گیرد و
     درخواست‌های حساس باید تأیید مجدد هویت داشته باشند (لایهٔ API). */
  if app.current_platform_role() = 'superadmin' then
    return true;
  end if;

  /*
   * کارگزار کلید API: مجوز، دقیقاً همان دامنه‌ای است که هنگام ساخت کلید
   * اعلام شد، و فقط برای همان کسب‌وکار. نه بیشتر.
   */
  if app.current_user_id() is null and app.current_api_key_id() is not null then
    return p_business_id = app.current_api_key_business_id()
       and p_permission_key = any (app.current_api_key_scopes());
  end if;

  select coalesce(m.overrides -> 'grant', '[]'::jsonb),
         coalesce(m.overrides -> 'revoke', '[]'::jsonb)
    into v_grant, v_revoke
  from app.membership m
  where m.business_id = p_business_id
    and m.user_id = app.current_user_id()
    and m.status = 'active'
    and m.deleted_at is null
  limit 1;

  /* عضو نیست → رد. این خط، «رد پیش‌فرض» را تضمین می‌کند (§14). */
  if not found then
    return false;
  end if;

  /* سلب صریح، بر هر چیز دیگری مقدم است — حتی بر مجوز نقش. */
  if v_revoke @> to_jsonb(p_permission_key) then
    return false;
  end if;

  if v_grant @> to_jsonb(p_permission_key) then
    return true;
  end if;

  select exists (
    select 1
    from app.membership m
    join app.role_permission rp on rp.role_id = m.role_id
    where m.business_id = p_business_id
      and m.user_id = app.current_user_id()
      and m.status = 'active'
      and m.deleted_at is null
      and rp.permission_key = p_permission_key
  ) into v_has;

  return coalesce(v_has, false);
end
$$;

comment on function app.has_permission is
  'تصمیم مجوز سمت سرور؛ رد پیش‌فرض، کارمندان پلتفرم، کارگزار کلید API، سپس نقش و مجوزهای افزوده/سلب‌شده (§14–16)';

-- -------------------------------------------------- حسابرسی: کارگزار کلید
-- `ops.audit_log.actor_type` تا امروز پنج حالت داشت. کلید API حالت ششم است؛
-- بدون آن، هر عمل ماشینی به‌غلط «system» ثبت می‌شد و رد حسابرسی گمراه می‌کرد.
alter table ops.audit_log drop constraint audit_log_actor_type_check;
alter table ops.audit_log add constraint audit_log_actor_type_check
  check (actor_type in ('user', 'system', 'worker', 'impersonator', 'anonymous', 'api_key'));

-- ------------------------------------------------------------------ گرنت‌ها
/*
 * گرنت execute، نه گرنت جدول. مسیر بی‌نام باید بتواند تلاش ورود را آغاز کند؛
 * پس `begin_login`/`complete_login` به `pv_public` هم داده می‌شوند. بقیه فقط
 * به `pv_app`: کسی که نشست ندارد، کاری با آن‌ها ندارد.
 */
revoke all on function app.begin_login(text, inet) from public;
revoke all on function app.complete_login(uuid, boolean, text, smallint, text, inet, text, text, smallint, uuid) from public;
revoke all on function app.begin_registration(text, text, inet) from public;
revoke all on function app.complete_registration(uuid, text, text, text, text) from public;
revoke all on function app.resolve_session(uuid, text, inet, text) from public;
revoke all on function app.logout(text) from public;
revoke all on function app.switch_business(uuid) from public;
revoke all on function app.issue_api_key(uuid, text, text, text, text[], timestamptz) from public;
revoke all on function app.resolve_api_key(text, inet) from public;
revoke all on function app.revoke_api_key(uuid, text) from public;

grant execute on function app.begin_login(text, inet) to pv_app, pv_public;
grant execute on function app.begin_registration(text, text, inet) to pv_app, pv_public;
grant execute on function app.complete_registration(uuid, text, text, text, text) to pv_app, pv_public;
grant execute on function app.complete_login(uuid, boolean, text, smallint, text, inet, text, text, smallint, uuid) to pv_app, pv_public;
grant execute on function app.resolve_session(uuid, text, inet, text) to pv_app, pv_public;
grant execute on function app.logout(text) to pv_app;
grant execute on function app.switch_business(uuid) to pv_app;
grant execute on function app.issue_api_key(uuid, text, text, text, text[], timestamptz) to pv_app;
grant execute on function app.resolve_api_key(text, inet) to pv_app;
grant execute on function app.revoke_api_key(uuid, text) to pv_app;

grant execute on function app.current_request_id() to pv_app, pv_public, pv_worker, pv_reader;
grant execute on function app.current_impersonated_by() to pv_app, pv_public, pv_worker, pv_reader;
grant execute on function app.current_api_key_id() to pv_app, pv_public, pv_worker, pv_reader;
grant execute on function app.current_api_key_business_id() to pv_app, pv_public, pv_worker, pv_reader;
grant execute on function app.current_api_key_scopes() to pv_app, pv_public, pv_worker, pv_reader;
