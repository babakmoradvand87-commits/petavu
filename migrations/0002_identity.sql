-- ---------------------------------------------------------------------------
-- 0002 — هویت
--
-- مرجع: §6–§17 (هویت ≠ کسب‌وکار، نشست، دستگاه، توکن، MFA، بازیابی، دعوت،
--       نقش و permission)، §13 (محدودیت نرخ و ریسک)، §132 (حذف نرم).
--
-- قاعده‌های طراحی این فایل:
--
--   ۱. **هویت، کسب‌وکار نیست.** یک کاربر می‌تواند چند کسب‌وکار داشته باشد و
--      چند کاربر می‌توانند در یک کسب‌وکار عضو باشند. پس هیچ ستون
--      `business_id` روی خودِ کاربر نمی‌نشیند؛ رابطه از راه عضویت می‌آید
--      (که در مهاجرت کسب‌وکار ساخته می‌شود).
--
--   ۲. **جدول‌های راز، از نقش برنامه پنهان‌اند.** `credential`، `one_time_token`
--      و `recovery_code` هیچ `select` مستقیمی برای `pv_app`/`pv_public` ندارند.
--      دسترسی فقط از راه توابع `security definer` با سطح تماس باریک می‌آید.
--      دلیلش ساده است: هر پرس‌وجوی مستقیم روی این جدول‌ها، یک فرصت برای
--      نوشتن شرط اشتباه است؛ تابع، شرط را یک‌جا و آزمون‌پذیر می‌کند.
--
--   ۳. **هیچ رازی به‌صورت خام نمی‌ماند.** ستون‌ها `_hash` هستند و درهم‌سازی
--      سمت برنامه انجام می‌شود (Argon2id برای رمز، SHA-256 برای توکن).
-- ---------------------------------------------------------------------------

-- ------------------------------------------------------------------ کاربر
create table auth.app_user (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,

  display_name text not null check (length(btrim(display_name)) between 2 and 120),
  /** نام نمایشی کوچک؛ جست‌وجو و صدا‌زدن استفاده می‌کند. */
  short_name text check (short_name is null or length(short_name) between 1 and 60),

  status text not null default 'pending'
    check (status in ('pending', 'active', 'suspended', 'deactivated')),

  /** دارایی تصویر پروفایل؛ کلید بیرونی به `media.asset` (در مهاجرت محتوا). */
  avatar_asset_id uuid,

  locale text not null default 'fa-IR' check (position('-' in locale) > 1),
  timezone text not null default 'Asia/Tehran',

  last_login_at timestamptz,
  /** شمارندهٔ تلاش ناموفق؛ با ورود موفق صفر می‌شود. */
  failed_login_count integer not null default 0 check (failed_login_count >= 0),
  locked_until timestamptz,
  /** الزام تأیید دومرحله‌ای برای این حساب (خود کاربر یا سیاست پلتفرم). */
  mfa_required boolean not null default false,

  suspended_at timestamptz,
  suspended_reason text,
  deleted_at timestamptz,

  constraint user_suspension_shape check ((status = 'suspended') = (suspended_at is not null)),
  constraint user_name_not_blank check (btrim(display_name) <> '')
);

comment on table auth.app_user is 'کاربر پلتفرم؛ هویت مستقل از کسب‌وکار (§6)';

create index app_user_status_idx on auth.app_user (status) where deleted_at is null;
create index app_user_created_idx on auth.app_user (created_at desc);

create trigger app_user_touch
  before update on auth.app_user
  for each row execute function app.touch();

-- ------------------------------------------------------------------ هویت‌ها
-- یک کاربر می‌تواند چند هویت داشته باشد: ایمیل کاری، ایمیل شخصی، موبایل.
-- «هویت» چیزی است که با آن وارد می‌شود؛ «کاربر» چیزی است که در سیستم هست.
create table auth.identity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.app_user (id) on delete cascade,
  kind text not null check (kind in ('email', 'phone', 'username')),
  /** شکل یکسان‌شده برای یکتایی و جست‌وجو (کوچک، ارقام لاتین، بدون فاصله). */
  value_key text not null check (length(value_key) between 3 and 320),
  /** شکل نمایشی؛ همان چیزی که کاربر نوشته است. */
  value_display text not null,
  is_primary boolean not null default false,
  verified_at timestamptz,
  verified_via text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  deleted_at timestamptz
);

comment on table auth.identity is 'ایمیل/موبایل/نام کاربری؛ یکتا در سطح پلتفرم (§7)';

-- یکتایی با احترام به حذف نرم: هویتی که آزاد شده، می‌تواند دوباره استفاده شود،
-- ولی دو کاربر فعال نمی‌توانند یک ایمیل را داشته باشند.
create unique index identity_kind_key_idx on auth.identity (kind, value_key) where deleted_at is null;
create unique index identity_primary_idx on auth.identity (user_id, kind) where is_primary and deleted_at is null;
create index identity_user_idx on auth.identity (user_id) where deleted_at is null;

create trigger identity_touch
  before update on auth.identity
  for each row execute function app.touch();

-- ------------------------------------------------------------------ اعتبارنامه
-- جدول راز. هیچ‌کس جز مالک جدول و نقش پشتیبان، `select` مستقیم ندارد.
create table auth.credential (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.app_user (id) on delete cascade,
  kind text not null check (kind in ('password', 'totp', 'webauthn', 'sms')),
  /** درهم با پیشوند طرح؛ مثلاً `pv1$n$argon2id$…` یا `sha256:…`. */
  secret_hash text not null check (length(secret_hash) > 16),
  /** پارامترهای الگوریتم و نسخه؛ نبودش یعنی «با پیش‌فرض فعلی درست شده». */
  hash_params jsonb not null default '{}'::jsonb,
  /** برای WebAuthn: شناسهٔ اعتبارنامه و کلید عمومی. */
  external_id text,
  label text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,
  used_count integer not null default 0 check (used_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  revoked_at timestamptz,
  revoked_reason text,
  version integer not null default 1,

  /** یک رمز و یک TOTP در هر زمان؛ WebAuthn چندتایی مجاز است. */
  unique (user_id, kind, external_id)
);

comment on table auth.credential is 'اعتبارنامه‌ها (رمزمحور و بی‌رمز)؛ فقط از راه توابع دسترسی دارد (§10–11)';

create index credential_user_idx on auth.credential (user_id) where revoked_at is null;
create index credential_webauthn_idx on auth.credential (external_id) where kind = 'webauthn' and revoked_at is null;

create trigger credential_touch
  before update on auth.credential
  for each row execute function app.touch();

-- ------------------------------------------------------------------ دستگاه
create table auth.device (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.app_user (id) on delete cascade,
  /** درهم اثر انگشت مرورگر/دستگاه؛ خود اثر انگشت ذخیره نمی‌شود. */
  fingerprint_hash text not null check (length(fingerprint_hash) >= 32),
  label text,
  user_agent text,
  first_ip inet,
  last_ip inet,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  /** دستگاه تأییدشده: در ورود حساس، تأیید دومرحله‌ای نمی‌خواهد. */
  trusted_at timestamptz,
  revoked_at timestamptz,
  version integer not null default 1
);

comment on table auth.device is 'دستگاه‌های شناخته‌شدهٔ کاربر؛ مبنای تشخیص ریسک و تأیید (§7، §13)';

create unique index device_user_fingerprint_idx on auth.device (user_id, fingerprint_hash) where revoked_at is null;
create index device_user_seen_idx on auth.device (user_id, last_seen_at desc) where revoked_at is null;

-- ------------------------------------------------------------------ نشست
create table auth.session (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.app_user (id) on delete cascade,
  device_id uuid references auth.device (id) on delete set null,

  /** درهم راز نشست؛ خود توکن هرگز ذخیره نمی‌شود (§11). */
  secret_hash text not null check (length(secret_hash) >= 32),

  /** سطح تضمین: aal1 ورود ساده، aal2 تأیید دومرحله‌ای در همین نشست. */
  aal smallint not null default 1 check (aal in (1, 2)),
  /** زمان آخرین تأیید مجدد هویت؛ عملیات حساس این را تازه می‌خواهند (§11). */
  step_up_at timestamptz,

  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_seen_ip inet,
  /** پایان قطعی نشست: حتی با فعالیت مداوم، بی‌نهایت تمدید نمی‌شود. */
  expires_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_reason text check (revoked_reason is null or revoked_reason in ('logout', 'rotate', 'admin', 'security', 'expired', 'ownership')),
  version integer not null default 1,

  user_agent text,
  request_id text,

  /** §31: اگر این نشست حاصل ورود با اختیار کارکنان پلتفرم است. */
  impersonated_by uuid references auth.app_user (id) on delete set null,
  impersonation_reason text,

  constraint session_expiry_order check (expires_at <= absolute_expires_at),
  constraint session_impersonation_shape check ((impersonated_by is null) = (impersonation_reason is null))
);

comment on table auth.session is 'نشست‌ها؛ فقط درهم راز ذخیره می‌شود، با انقضای نسبی و مطلق (§9، §11، §31)';

create unique index session_secret_idx on auth.session (secret_hash) where revoked_at is null;
create index session_user_active_idx on auth.session (user_id, last_seen_at desc) where revoked_at is null;
create index session_expiry_idx on auth.session (expires_at) where revoked_at is null;

create trigger session_touch
  before update on auth.session
  for each row execute function app.touch();

-- ------------------------------------------------------------------ توکن یکبارمصرف
-- ایمیل تأیید، بازیابی رمز، ورود بی‌رمز، و هر جریان دیگری که «یک بار» است.
-- `purpose` بخشی از هویت توکن است، پس توکن یک جریان، در جریان دیگر کار نمی‌کند.
create table auth.one_time_token (
  id uuid primary key default gen_random_uuid(),
  purpose text not null check (purpose in (
    'email_verify', 'phone_verify', 'password_reset', 'password_set',
    'login_link', 'email_change', 'mfa_recovery', 'invitation_accept'
  )),
  token_hash text not null check (length(token_hash) >= 32),
  user_id uuid references auth.app_user (id) on delete cascade,
  /** برای جریان‌های پیش از ساخت کاربر (ثبت‌نام) یا تغییر ایمیل. */
  target_key text,
  issued_by uuid references auth.app_user (id) on delete set null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  attempts integer not null default 0 check (attempts between 0 and 50),
  max_attempts integer not null default 5 check (max_attempts between 1 and 50),
  metadata jsonb not null default '{}'::jsonb,
  request_id text,
  constraint token_target_shape check (user_id is not null or target_key is not null)
);

comment on table auth.one_time_token is 'توکن‌های یکبارمصرف؛ هدف‌دار، با شمارش تلاش و انقضا (§11)';

create unique index one_time_token_hash_idx on auth.one_time_token (token_hash);
create index one_time_token_cleanup_idx on auth.one_time_token (expires_at) where consumed_at is null;
create index one_time_token_user_idx on auth.one_time_token (user_id, purpose, issued_at desc) where consumed_at is null;

-- شمارش توکن‌های فعال یک هدف. تابع، جای پرس‌وجوی پراکنده در کد، تا سقف
-- «چند ایمیل بازیابی در ساعت» یک‌جا اعمال شود.
create or replace function auth.count_active_tokens(p_purpose text, p_user_id uuid, p_target_key text)
returns integer
language sql
stable
as $$
  select count(*)::int
  from auth.one_time_token t
  where t.purpose = p_purpose
    and t.consumed_at is null
    and t.expires_at > now()
    and (t.user_id is not distinct from p_user_id)
    and (t.target_key is not distinct from p_target_key)
$$;

-- ------------------------------------------------------------------ کد بازیابی
create table auth.recovery_code (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.app_user (id) on delete cascade,
  code_hash text not null check (length(code_hash) >= 32),
  created_at timestamptz not null default now(),
  used_at timestamptz,
  used_ip inet,
  unique (user_id, code_hash)
);

comment on table auth.recovery_code is 'کدهای بازیابی یکبارمصرف؛ فقط درهم ذخیره می‌شود (§11)';

create index recovery_code_user_idx on auth.recovery_code (user_id) where used_at is null;

-- ------------------------------------------------------------------ تلاش ورود
-- ورودی موتور ریسک و محدودیت نرخ (§13). شناسه با درهم ذخیره می‌شود، نه خام.
create table auth.login_attempt (
  id bigserial primary key,
  occurred_at timestamptz not null default now(),
  identifier_hash text not null check (length(identifier_hash) >= 32),
  user_id uuid references auth.app_user (id) on delete set null,
  kind text not null default 'password' check (kind in ('password', 'otp', 'webauthn', 'recovery', 'refresh', 'step_up')),
  succeeded boolean not null,
  failure_reason text,
  ip inet,
  device_hash text,
  request_id text,
  /** ارزیابی ریسک در لحظهٔ تلاش؛ بعداً برای تحلیل قابل بازبینی است. */
  risk_score smallint check (risk_score is null or risk_score between 0 and 100)
);

comment on table auth.login_attempt is 'تلاش‌های ورود؛ ورودی ریسک و محدودیت نرخ، با شناسهٔ درهم‌شده (§13)';

create index login_attempt_identifier_idx on auth.login_attempt (identifier_hash, occurred_at desc);
create index login_attempt_user_idx on auth.login_attempt (user_id, occurred_at desc) where user_id is not null;
create index login_attempt_ip_idx on auth.login_attempt (ip, occurred_at desc) where ip is not null;
-- شمارش تلاش ناموفق اخیر برای تصمیم ریسک، بدون اسکن جدول.
create index login_attempt_failures_idx on auth.login_attempt (identifier_hash, occurred_at desc) where not succeeded;

-- ------------------------------------------------------------------ مجوزها و نقش‌های پلتفرم
create table auth.permission (
  key text primary key check (key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'),
  name_fa text not null,
  /** دسته برای نمایش در ماتریس مجوز: profile, business, member, content, media, design, seo, platform, billing. */
  category text not null,
  description text,
  /** «حساس» یعنی برای اجرا، تأیید مجدد هویت لازم است (§11). */
  is_sensitive boolean not null default false,
  is_system boolean not null default true
);

comment on table auth.permission is 'مجوزهای دانه‌درشت‌دانه؛ منبع حقیقت ماتریس دسترسی (§16)';

create index permission_category_idx on auth.permission (category, key);

create table auth.platform_role (
  key text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  name_fa text not null,
  description text,
  /** ترتیب اعتماد؛ برای مقایسهٔ نقش‌ها در تصمیم‌های سریع. */
  rank smallint not null default 100,
  is_system boolean not null default true
);

comment on table auth.platform_role is 'نقش‌های پلتفرمی (پنل مدیریت) — جدا از نقش‌های کسب‌وکار (§28)';

create table auth.platform_role_permission (
  role_key text not null references auth.platform_role (key) on delete cascade,
  permission_key text not null references auth.permission (key) on delete cascade,
  primary key (role_key, permission_key)
);

comment on table auth.platform_role_permission is 'اتصال نقش پلتفرمی به مجوز (§16)';

create table auth.user_platform_role (
  user_id uuid not null references auth.app_user (id) on delete cascade,
  role_key text not null references auth.platform_role (key) on delete restrict,
  granted_by uuid references auth.app_user (id) on delete set null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  primary key (user_id, role_key)
);

comment on table auth.user_platform_role is 'نقش‌های پلتفرمی کاربر؛ با تاریخ انقضا و رد حسابرسی (§16)';

create index user_platform_role_active_idx on auth.user_platform_role (user_id) where revoked_at is null;

-- ------------------------------------------------------------------ توابع دسترسی به راز
-- همه با `security definer` و `search_path` بسته.
--
-- چرا `search_path` را می‌بندیم: در تابع `security definer`، اگر مسیر جست‌وجو
-- باز باشد، یک نقش می‌تواند شیئی هم‌نام در فضای نام خودش بسازد و تابع ما را
-- به اجرای آن بکشاند. این کلاسیک‌ترین راه بالا رفتن از دسترسی در PostgreSQL
-- است؛ پس هیچ تابع ممتازی بدون آن نوشته نمی‌شود.

/** یافتن نامزد ورود با شناسهٔ درهم‌شده. خروجی: کمینه‌ترین چیزی که ورود لازم دارد. */
-- شناسه با `hashIdentifier` در برنامه درهم می‌شود و اینجا فقط مقایسه می‌شود.
-- پس حتی خواندن جدول هویت هم، ارزش متن خام را لو نمی‌دهد.
create or replace function auth.find_login_candidate(p_identifier_hash text)
returns table (
  user_id uuid,
  password_hash text,
  user_status text,
  mfa_required boolean,
  failed_login_count integer,
  locked_until timestamptz,
  identity_id uuid
)
language sql
security definer
set search_path = pg_catalog, auth
as $$
  select u.id, c.secret_hash, u.status, u.mfa_required, u.failed_login_count, u.locked_until, i.id
  from auth.identity i
  join auth.app_user u on u.id = i.user_id
  left join auth.credential c
    on c.user_id = u.id and c.kind = 'password' and c.revoked_at is null
  where i.value_key = p_identifier_hash
    and i.deleted_at is null
    and u.deleted_at is null
  limit 1
$$;

comment on function auth.find_login_candidate is
  'نامزد ورود بر پایهٔ شناسهٔ درهم‌شده؛ تنها مسیر خواندن اعتبارنامه در جریان ورود';

/**
 * ثبت نتیجهٔ تلاش ورود و اعمال قفل تدریجی.
 *
 * قفل تدریجی: ۵ خطا → ۱ دقیقه، ۱۰ خطا → ۱۵ دقیقه، ۱۵+ خطا → ۱ ساعت. قفل
 * ثابت، هم کاربر واقعی را می‌آزارد و هم مهاجم را فقط چند دقیقه زمین می‌زند.
 */
create or replace function auth.record_login_attempt(
  p_identifier_hash text,
  p_user_id uuid,
  p_kind text,
  p_succeeded boolean,
  p_failure_reason text default null,
  p_ip inet default null,
  p_device_hash text default null,
  p_request_id text default null,
  p_risk_score smallint default null
)
returns table (locked_until timestamptz, failed_login_count integer)
language plpgsql
security definer
set search_path = pg_catalog, auth
as $$
declare
  v_failures integer;
  v_lock timestamptz;
begin
  insert into auth.login_attempt (
    identifier_hash, user_id, kind, succeeded, failure_reason, ip, device_hash, request_id, risk_score
  ) values (
    p_identifier_hash, p_user_id, p_kind, p_succeeded, p_failure_reason, p_ip, p_device_hash, p_request_id, p_risk_score
  );

  if p_user_id is null or p_succeeded then
    if p_user_id is not null and p_succeeded then
      update auth.app_user
      set failed_login_count = 0, locked_until = null, last_login_at = now()
      where id = p_user_id;
    end if;
    return query
      select null::timestamptz,
             coalesce((select u.failed_login_count from auth.app_user u where u.id = p_user_id), 0);
    return;
  end if;

  /*
   * نام ستون صریحاً با نام جدول مقید می‌شود.
   *
   * این تابع با `returns table (…, failed_login_count integer)` یک متغیر
   * خروجی هم‌نام ستون دارد؛ در `set failed_login_count = failed_login_count + 1`
   * سمت راست مبهم می‌شود و پلنر خطا می‌دهد. قید کردن نام، ابهام را می‌بندد.
   */
  update auth.app_user
  set failed_login_count = auth.app_user.failed_login_count + 1
  where app_user.id = p_user_id
  returning auth.app_user.failed_login_count into v_failures;

  v_lock := case
    when v_failures >= 15 then now() + interval '1 hour'
    when v_failures >= 10 then now() + interval '15 minutes'
    when v_failures >= 5 then now() + interval '1 minute'
    else null
  end;

  if v_lock is not null then
    update auth.app_user set locked_until = v_lock where id = p_user_id;
  end if;

  return query select v_lock, v_failures;
end
$$;

comment on function auth.record_login_attempt is
  'ثبت تلاش ورود و قفل تدریجی حساب (۵→۱دقیقه، ۱۰→۱۵دقیقه، ۱۵+→۱ساعت) (§13)';

/** شمارش خطاهای اخیر یک شناسه، برای ارزیابی ریسک. */
create or replace function auth.recent_failures(p_identifier_hash text, p_window_minutes integer default 15)
returns integer
language sql
stable
security definer
set search_path = pg_catalog, auth
as $$
  select count(*)::int
  from auth.login_attempt
  where identifier_hash = p_identifier_hash
    and not succeeded
    and occurred_at > now() - make_interval(mins => greatest(1, least(p_window_minutes, 1440)))
$$;

/**
 * مصرف یک توکن یکبارمصرف.
 *
 * «یک بار» بودن را همین‌جا تحمیل می‌کنیم، نه در کد: `update ... where
 * consumed_at is null returning` اتمی است، پس دو درخواست هم‌زمان نمی‌توانند
 * یک توکن را دو بار مصرف کنند — و این همان چیزی است که «یکبارمصرف» را واقعی
 * می‌کند، نه تشریفاتی.
 */
create or replace function auth.consume_one_time_token(
  p_token_hash text,
  p_purpose text
)
returns table (user_id uuid, target_key text, metadata jsonb)
language plpgsql
security definer
set search_path = pg_catalog, auth
as $$
declare
  v_row auth.one_time_token;
begin
  select * into v_row
  from auth.one_time_token t
  where t.token_hash = p_token_hash
    and t.purpose = p_purpose
    and t.consumed_at is null
    and t.expires_at > now()
    and t.attempts < t.max_attempts
  for update;

  if not found then
    -- شمارش تلاش روی توکن‌های موجود با همین درهم (اگر منقضی یا مصرف‌شده
    -- باشند، بی‌اثر است). این شمارش، حملهٔ حدس زدن را کند می‌کند.
    update auth.one_time_token t set attempts = least(t.attempts + 1, t.max_attempts)
    where t.token_hash = p_token_hash and t.purpose = p_purpose and t.consumed_at is null;
    return;
  end if;

  update auth.one_time_token t
  set consumed_at = now(), attempts = t.attempts + 1
  where t.id = v_row.id;

  return query select v_row.user_id, v_row.target_key, v_row.metadata;
end
$$;

comment on function auth.consume_one_time_token is
  'مصرف اتمی توکن یکبارمصرف؛ دو درخواست هم‌زمان نمی‌توانند یک توکن را دو بار مصرف کنند (§11)';

-- ------------------------------------------------------------------ RLS
alter table auth.app_user enable row level security;
alter table auth.identity enable row level security;
alter table auth.credential enable row level security;
alter table auth.device enable row level security;
alter table auth.session enable row level security;
alter table auth.one_time_token enable row level security;
alter table auth.recovery_code enable row level security;
alter table auth.login_attempt enable row level security;
alter table auth.permission enable row level security;
alter table auth.platform_role enable row level security;
alter table auth.platform_role_permission enable row level security;
alter table auth.user_platform_role enable row level security;

-- کاربر: خودش را می‌بیند. کارکنان پلتفرم همه را.
create policy app_user_self_select on auth.app_user
  for select to pv_app
  using (id = app.current_user_id() or app.current_platform_role() is not null);

create policy app_user_self_update on auth.app_user
  for update to pv_app
  using (id = app.current_user_id() or app.current_platform_role() is not null)
  with check (id = app.current_user_id() or app.current_platform_role() is not null);

-- ثبت‌نام: بی‌نام می‌تواند کاربر بسازد، ولی بعدش فقط ردیف خودش را می‌بیند —
-- و در همان تراکنش، کد سمت سرور زمینه را ست می‌کند.
create policy app_user_signup_insert on auth.app_user
  for insert to pv_app, pv_public
  with check (true);

create policy app_user_reader on auth.app_user
  for select to pv_reader
  using (true);

create policy identity_self on auth.identity
  for all to pv_app
  using (user_id = app.current_user_id() or app.current_platform_role() is not null)
  with check (user_id = app.current_user_id() or app.current_platform_role() is not null);

create policy identity_signup_insert on auth.identity
  for insert to pv_app, pv_public
  with check (true);

create policy identity_reader on auth.identity
  for select to pv_reader
  using (true);

-- اعتبارنامه: هیچ سیاستی برای `pv_app`/`pv_public` وجود ندارد.
-- نبود سیاست یعنی «دیده نشدن» — پس حتی یک خطای شرط فراموش‌شده در کد، اینجا
-- به نشت تبدیل نمی‌شود. دسترسی فقط از راه توابع بالا.
create policy credential_reader on auth.credential
  for select to pv_reader
  using (true);

create policy credential_staff_select on auth.credential
  for select to pv_app, pv_worker
  using (app.current_platform_role() = 'superadmin');

create policy device_self on auth.device
  for all to pv_app
  using (user_id = app.current_user_id())
  with check (user_id = app.current_user_id());

create policy device_insert_login on auth.device
  for insert to pv_app, pv_public
  with check (true);

create policy device_staff_select on auth.device
  for select to pv_app, pv_reader
  using (app.current_platform_role() is not null);

create policy session_self on auth.session
  for all to pv_app
  using (user_id = app.current_user_id())
  with check (user_id = app.current_user_id());

/**
 * ساخت نشست، فقط برای خودِ کاربر — و یک استثنای صریح: جعل هویت (§31).
 *
 * پیش‌تر این سیاست `with check (true)` بود، به این بهانه که «در لحظهٔ ورود،
 * هنوز نشستی وجود ندارد». اما این کار، امکان ساخت نشست برای کاربر دیگر را
 * بی‌سروصدا باز می‌گذاشت. امروز جریان ورود، پیش از ساخت نشست، زمینهٔ کاربر
 * تأییدشده را ست می‌کند و سیاست `session_self` آن را می‌پوشاند؛ پس این
 * سیاست فقط برای نشست جعل هویت لازم است و دو قید دارد: سازنده باید نقش
 * پلتفرمی داشته باشد، و باید خودش به‌عنوان جاعل ثبت شود.
 */
create policy session_insert_impersonation on auth.session
  for insert to pv_app, pv_public
  with check (
    user_id = app.current_user_id()
    or (impersonated_by = app.current_user_id() and app.current_platform_role() is not null)
  );

create policy session_staff_select on auth.session
  for select to pv_app, pv_reader
  using (app.current_platform_role() is not null);

create policy device_reader on auth.device
  for select to pv_reader
  using (true);

create policy session_reader on auth.session
  for select to pv_reader
  using (true);

-- توکن‌های یکبارمصرف: نوشتن برای ساخت، خواندن برای کارکنان؛ مصرف از راه تابع.
create policy one_time_token_insert on auth.one_time_token
  for insert to pv_app, pv_public
  with check (true);

create policy one_time_token_staff_select on auth.one_time_token
  for select to pv_app, pv_worker
  using (app.current_platform_role() is not null);

create policy one_time_token_reader on auth.one_time_token
  for select to pv_reader
  using (true);

create policy recovery_code_reader on auth.recovery_code
  for select to pv_reader
  using (true);

create policy login_attempt_insert on auth.login_attempt
  for insert to pv_app, pv_public
  with check (true);

create policy login_attempt_staff_select on auth.login_attempt
  for select to pv_app, pv_worker
  using (app.current_platform_role() is not null);

create policy login_attempt_reader on auth.login_attempt
  for select to pv_reader
  using (true);

create policy permission_read on auth.permission
  for select to pv_app, pv_public, pv_worker, pv_reader
  using (true);

create policy platform_role_read on auth.platform_role
  for select to pv_app, pv_public, pv_worker, pv_reader
  using (true);

create policy platform_role_permission_read on auth.platform_role_permission
  for select to pv_app, pv_public, pv_worker, pv_reader
  using (true);

create policy platform_catalog_write on auth.permission
  for all to pv_app, pv_worker
  using (app.current_platform_role() = 'superadmin')
  with check (app.current_platform_role() = 'superadmin');

create policy platform_role_write on auth.platform_role
  for all to pv_app, pv_worker
  using (app.current_platform_role() = 'superadmin')
  with check (app.current_platform_role() = 'superadmin');

create policy platform_role_permission_write on auth.platform_role_permission
  for all to pv_app, pv_worker
  using (app.current_platform_role() = 'superadmin')
  with check (app.current_platform_role() = 'superadmin');

create policy user_platform_role_self on auth.user_platform_role
  for select to pv_app
  using (user_id = app.current_user_id());

create policy user_platform_role_staff on auth.user_platform_role
  for all to pv_app, pv_worker
  using (app.current_platform_role() is not null)
  with check (app.current_platform_role() is not null);

-- ------------------------------------------------------------------ گرنت‌ها
-- نکته: `auth.credential`، `auth.recovery_code` و `auth.one_time_token` هیچ
-- `select`ی برای نقش‌های اجرایی نمی‌گیرند. این عمدی است.
grant select, insert, update on auth.app_user to pv_app;
grant select, insert, update on auth.identity to pv_app;
grant select, insert, update on auth.device to pv_app;
grant select, insert, update, delete on auth.session to pv_app;
grant insert on auth.one_time_token to pv_app;
grant insert on auth.login_attempt to pv_app;
grant select on auth.permission, auth.platform_role, auth.platform_role_permission to pv_app;
grant select, insert, update, delete on auth.user_platform_role to pv_app;

grant insert on auth.app_user, auth.identity, auth.device, auth.session to pv_public;
grant insert on auth.one_time_token, auth.login_attempt to pv_public;
grant select on auth.permission, auth.platform_role, auth.platform_role_permission to pv_public;

grant select, insert, update on auth.app_user, auth.identity, auth.credential, auth.device, auth.session to pv_worker;
grant select, insert, update on auth.one_time_token, auth.login_attempt, auth.recovery_code to pv_worker;
grant select on auth.permission, auth.platform_role, auth.platform_role_permission, auth.user_platform_role to pv_worker;

grant select on auth.app_user, auth.identity, auth.credential, auth.device, auth.session to pv_reader;
grant select on auth.one_time_token, auth.recovery_code, auth.login_attempt to pv_reader;
grant select on auth.permission, auth.platform_role, auth.platform_role_permission, auth.user_platform_role to pv_reader;

-- توابع: اجرا برای نقش‌های لازم، و بستن مسیر پیش‌فرض `public`.
revoke all on function auth.find_login_candidate(text) from public;
revoke all on function auth.record_login_attempt(text, uuid, text, boolean, text, inet, text, text, smallint) from public;
revoke all on function auth.recent_failures(text, integer) from public;
revoke all on function auth.consume_one_time_token(text, text) from public;
revoke all on function auth.count_active_tokens(text, uuid, text) from public;

grant execute on function auth.find_login_candidate(text) to pv_app, pv_public;
grant execute on function auth.record_login_attempt(text, uuid, text, boolean, text, inet, text, text, smallint) to pv_app, pv_public;
grant execute on function auth.recent_failures(text, integer) to pv_app, pv_public;
grant execute on function auth.consume_one_time_token(text, text) to pv_app, pv_public;
grant execute on function auth.count_active_tokens(text, uuid, text) to pv_app;
