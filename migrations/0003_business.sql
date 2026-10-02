-- ---------------------------------------------------------------------------
-- 0003 — کسب‌وکار
--
-- مرجع: §6 (هویت ≠ کسب‌وکار)، §14–§17 (authz، نقش، ماتریس مجوز، دعوت، انتقال
--       مالکیت)، §18–§21 (کسب‌وکار، نوع داینامیک، تاکسونومی صنعت، گراف)،
--       §22 (پروفایل عمومی جدا)، §189 (برنامهٔ پروفایل‌ها).
--
-- سه تصمیم کلیدی این فایل:
--
--   ۱. **نوع کسب‌وکار داده است، نه کد.** §19 می‌گوید نوع کسب‌وکار باید
--      داینامیک باشد. پس `ref.business_type` یک جدول است با فیلدهای لازم و
--      بخش‌های پیش‌فرض؛ افزودن «کلینیک چشم‌پزشکی دامپزشکی» نیاز به استقرار
--      کد ندارد.
--
--   ۲. **مجوزها دانه‌درشت‌دانه و در پایگاه‌داده.** نقش، صرفاً مجموعه‌ای از
--      مجوزهاست. تصمیم همیشه سمت سرور و بر پایهٔ همین جدول‌ها گرفته می‌شود؛
--      رابط کاربری فقط دکمه را پنهان می‌کند (§15، §191).
--
--   ۳. **توابع دسترسی، `security definer`.** سیاست‌های RLS روی جدول‌های
--      tenant به `app.is_member_of(...)` تکیه می‌کنند. اگر این تابع با
--      دسترسی معمولی عضویت را می‌خواند، خواندن عضویت خودش سیاست RLS داشت و
--      بازگشت بی‌نهایت می‌شد. اجرا با نقش مالک، هم بازگشت را قطع می‌کند و هم
--      هیچ راهی برای جعل عضویت باقی نمی‌گذارد — چون تابع فقط می‌خواند.
-- ---------------------------------------------------------------------------

-- ------------------------------------------------------------------ دادهٔ مرجع: نوع کسب‌وکار
create table ref.business_type (
  key text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  name_fa text not null,
  /** نام جمع برای فهرست‌ها: «کلینیک‌های دامپزشکی». */
  plural_fa text,
  description text,
  parent_key text references ref.business_type (key) on delete restrict,
  /** ریشهٔ تاکسونومی: نوع، زیرنوع دارد ولی عمق بیش از دو سطح نمی‌رود. */
  depth smallint not null default 0 check (depth between 0 and 2),

  /** نوع دادهٔ ساختاریافتهٔ متناظر، برای موتور سئو (Addendum §48–52). */
  schema_type text,
  /** مسیر نماد برای آیکن؛ بدون فایل دودویی در پایگاه‌داده. */
  icon_key text,

  /** فیلدهایی که پروفایل این نوع باید داشته باشد: `[{key, label, required, kind}]`. */
  required_fields jsonb not null default '[]'::jsonb,
  /** بخش‌های پیش‌فرض صفحهٔ عمومی و داشبورد پنل. */
  default_sections jsonb not null default '[]'::jsonb,
  /** نوع‌هایی که این نوع می‌تواند با آن‌ها رابطه بسازد؛ [] یعنی همه. */
  allowed_relationship_kinds text[] not null default '{}',

  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

comment on table ref.business_type is 'نوع کسب‌وکار، داینامیک و قابل افزودن بدون استقرار کد (§19)';

create index business_type_parent_idx on ref.business_type (parent_key) where is_active;
create index business_type_order_idx on ref.business_type (sort_order, key) where is_active;

create trigger business_type_touch
  before update on ref.business_type
  for each row execute function app.touch();

-- ------------------------------------------------------------------ دادهٔ مرجع: صنعت
create table ref.industry (
  key text primary key check (key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$'),
  name_fa text not null,
  parent_key text references ref.industry (key) on delete restrict,
  /** مسیر مادیت‌شده برای پرس‌وجوی زیرشاخه بدون بازگشت: `pet.clinic.vet`. */
  path text not null,
  depth smallint not null default 0 check (depth between 0 and 5),
  description text,
  /** واژه‌های هم‌معنا برای جست‌وجو و سئو: «دامپزشکی، کلینیک، درمانگاه». */
  synonyms text[] not null default '{}',
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint industry_path_shape check (path like key || '%')
);

comment on table ref.industry is 'تاکسونومی صنعت با مسیر مادیت‌شده برای پرس‌وجوی ارزان زیرشاخه (§20)';

create index industry_path_idx on ref.industry (path text_pattern_ops);
create index industry_parent_idx on ref.industry (parent_key) where is_active;

create trigger industry_touch
  before update on ref.industry
  for each row execute function app.touch();

-- ------------------------------------------------------------------ دادهٔ مرجع: مکان
create table ref.location (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('country', 'province', 'county', 'city', 'district')),
  name_fa text not null,
  parent_id uuid references ref.location (id) on delete restrict,
  /** مسیر مادیت‌شدهٔ شناسه‌ها برای زیرشاخه. */
  path text not null,
  /** نامک مکانی برای سئوی محلی: `/shahr/tehran`. */
  slug text not null check (slug ~ '^[a-z0-9\u0600-\u06ff-]+$'),
  /** مرکز تقریبی برای جست‌وجوی «نزدیک من»؛ بدون نیاز به PostGIS. */
  latitude numeric(9, 6) check (latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude between -180 and 180),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint location_geo_shape check ((latitude is null) = (longitude is null))
);

comment on table ref.location is 'تقسیمات مکانی؛ مبنای سئوی محلی و فیلتر جست‌وجو (§20، Addendum §53)';

create unique index location_parent_slug_idx on ref.location (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);
create index location_path_idx on ref.location (path text_pattern_ops);
create index location_kind_idx on ref.location (kind, name_fa) where is_active;

create trigger location_touch
  before update on ref.location
  for each row execute function app.touch();

-- ------------------------------------------------------------------ کسب‌وکار
create table app.business (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,

  /** نامک عمومی؛ بخشی از نشانی است، نه بخشی از هویت (§7). */
  slug text not null check (slug ~ '^[a-z0-9\u0600-\u06ff]+(-[a-z0-9\u0600-\u06ff]+)*$'),
  name text not null check (length(btrim(name)) between 2 and 160),
  /** نام حقوقی، برای تأیید و فاکتور. */
  legal_name text,
  /** نام لاتین برای مصارف فنی و سئوی بین‌المللی. */
  name_latin text,

  business_type_key text not null references ref.business_type (key) on delete restrict,
  industry_key text references ref.industry (key) on delete set null,
  /** مکان اصلی؛ نگه‌داشتنِ آن اینجا پرس‌وجوی فهرست را ساده می‌کند. */
  primary_location_id uuid references ref.location (id) on delete set null,

  /** کاربری که مالکیت دارد؛ منبع حقیقت مالکیت، همین ستون است و عضویتِ نقش owner. */
  owner_user_id uuid not null references auth.app_user (id) on delete restrict,

  status text not null default 'draft'
    check (status in ('draft', 'pending_review', 'active', 'suspended', 'archived')),
  visibility text not null default 'private'
    check (visibility in ('private', 'unlisted', 'public')),

  verification_level text not null default 'none'
    check (verification_level in ('none', 'contact_verified', 'identity_verified', 'premium')),

  /** شمارنده‌های مادیت‌شده؛ برای فهرست و مرتب‌سازی، بدون join سنگین. */
  member_count integer not null default 1 check (member_count >= 1),
  listing_count integer not null default 0 check (listing_count >= 0),
  media_count integer not null default 0 check (media_count >= 0),

  /** نمایانی و کیفیت پروفایل: درصد تکمیل، برای راهنمایی کاربر. */
  profile_completeness smallint not null default 0 check (profile_completeness between 0 and 100),

  published_at timestamptz,
  suspended_at timestamptz,
  suspended_reason text,
  archived_at timestamptz,
  deleted_at timestamptz,

  /** منبع ساخت: کاربر، ورود داده، یا خودکارسازی. */
  created_via text not null default 'panel' check (created_via in ('panel', 'api', 'import', 'automation')),

  constraint business_slug_not_reserved check (length(slug) >= 2),
  constraint business_suspension_shape check ((status = 'suspended') = (suspended_at is not null)),
  constraint business_publish_shape check ((status in ('active', 'suspended') or published_at is null) or status = 'archived')
);

comment on table app.business is 'کسب‌وکار؛ موجودیت مرکزی چندمستأجری (§18)';

-- نامک یکتا در سطح پلتفرم، ولی نه برای ردیف‌های حذف‌شده: نامک آزادشده باید
-- قابل استفادهٔ دوباره باشد، بدون اینکه رکورد قدیمی هویتش را گم کند.
create unique index business_slug_idx on app.business (slug) where deleted_at is null;
create index business_type_idx on app.business (business_type_key, status, created_at desc) where deleted_at is null;
create index business_industry_idx on app.business (industry_key, status) where deleted_at is null and status = 'active';
create index business_location_idx on app.business (primary_location_id, status) where deleted_at is null;
create index business_owner_idx on app.business (owner_user_id) where deleted_at is null;
create index business_public_idx on app.business (published_at desc)
  where status = 'active' and visibility = 'public' and deleted_at is null;

create trigger business_touch
  before update on app.business
  for each row execute function app.touch();

-- ------------------------------------------------------------------ پروفایل
create table app.business_profile (
  business_id uuid primary key references app.business (id) on delete cascade,
  tagline text check (tagline is null or length(tagline) <= 160),
  summary text check (summary is null or length(summary) <= 600),
  description text,
  founded_year smallint check (founded_year is null or founded_year between 1200 and 2200),
  employee_range text check (employee_range is null or employee_range in ('1', '2-9', '10-49', '50-249', '250+')),

  /** دارایی‌های تصویری؛ کلید بیرونی، بدون کپی داده در این جدول. */
  logo_asset_id uuid,
  cover_asset_id uuid,

  /** پیوندهای بیرونی: `[{kind, url, label, verified_at}]`. */
  links jsonb not null default '[]'::jsonb,
  /** فیلدهای اختصاصی بر پایهٔ `ref.business_type.required_fields`. */
  attributes jsonb not null default '{}'::jsonb,
  /** کلیدواژه‌های خودِ کسب‌وکار برای نمایش و جست‌وجوی داخلی. */
  keywords text[] not null default '{}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

comment on table app.business_profile is 'پروفایل کسب‌وکار، جدا از موجودیت و از پروفایل عمومی (§22)';

create index business_profile_keywords_idx on app.business_profile using gin (keywords);

create trigger business_profile_touch
  before update on app.business_profile
  for each row execute function app.touch();

-- ------------------------------------------------------------------ مکان‌های کسب‌وکار
create table app.business_location (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references app.business (id) on delete cascade,
  kind text not null default 'main' check (kind in ('main', 'branch', 'warehouse', 'service_area')),
  label text,
  location_id uuid references ref.location (id) on delete set null,
  address_line text,
  postal_code text check (postal_code is null or postal_code ~ '^[0-9]{10}$'),
  latitude numeric(9, 6) check (latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude between -180 and 180),
  /** ساعات کار: `{sat:{open,close},…}` با پشتیبانی از بازهٔ دوتایی. */
  hours jsonb not null default '{}'::jsonb,
  /** محدودهٔ خدمت برای کسب‌وکارهای سیار. */
  service_area jsonb not null default '{}'::jsonb,
  phone text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint business_location_geo_shape check ((latitude is null) = (longitude is null))
);

comment on table app.business_location is 'مکان‌های کسب‌وکار (شعبه، انبار، محدودهٔ خدمت) (§18)';

create unique index business_location_primary_idx on app.business_location (business_id) where is_primary;
create index business_location_business_idx on app.business_location (business_id);
create index business_location_city_idx on app.business_location (location_id) where location_id is not null;

create trigger business_location_touch
  before update on app.business_location
  for each row execute function app.touch();

-- ------------------------------------------------------------------ راه‌های تماس
create table app.business_contact (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references app.business (id) on delete cascade,
  kind text not null check (kind in ('phone', 'mobile', 'email', 'whatsapp', 'telegram', 'instagram', 'website', 'fax')),
  /** مقدار یکسان‌شده برای جست‌وجو و یکتایی. */
  value_key text not null,
  value_display text not null,
  label text,
  /** آیا در پروفایل عمومی نمایش داده می‌شود؟ پیش‌فرض: نه (§22). */
  is_public boolean not null default false,
  verified_at timestamptz,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

comment on table app.business_contact is 'راه‌های تماس کسب‌وکار؛ نمایش عمومی صریح است، نه پیش‌فرض (§22)';

create unique index business_contact_unique_idx on app.business_contact (business_id, kind, value_key);
create index business_contact_public_idx on app.business_contact (business_id) where is_public;
create index business_contact_verify_idx on app.business_contact (value_key) where verified_at is null;

create trigger business_contact_touch
  before update on app.business_contact
  for each row execute function app.touch();

-- ------------------------------------------------------------------ تأیید
create table app.business_verification (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references app.business (id) on delete cascade,
  level text not null check (level in ('contact_verified', 'identity_verified', 'premium')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired')),
  /** شواهد: نوع سند، شمارهٔ مجوز، دارایی پیوست — بدون ذخیرهٔ داده حساس. */
  evidence jsonb not null default '{}'::jsonb,
  submitted_by uuid references auth.app_user (id) on delete set null,
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references auth.app_user (id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  expires_at timestamptz,
  version integer not null default 1,
  constraint verification_review_shape check ((status in ('pending', 'expired')) = (reviewed_at is null))
);

comment on table app.business_verification is 'درخواست و نتیجهٔ تأیید کسب‌وکار، با رد حسابرسی (§18، §28)';

create index business_verification_queue_idx on app.business_verification (status, submitted_at) where status = 'pending';
create index business_verification_business_idx on app.business_verification (business_id, submitted_at desc);

-- ------------------------------------------------------------------ نقش‌های کسب‌وکار
-- `business_id` تهی یعنی «الگوی سیستمی»: مالک، مدیر، ویرایشگر، ناظر.
-- کسب‌وکار می‌تواند نقش سفارشی بسازد، ولی مجوزها همان مجموعهٔ بستهٔ پلتفرم است.
create table app.role (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references app.business (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  name_fa text not null,
  description text,
  /** رتبهٔ اعتماد؛ برای مقایسه در تصمیم‌های سریع و نمایش ترتیب. */
  rank smallint not null default 100,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint role_system_scope check (not is_system or business_id is null)
);

comment on table app.role is 'نقش‌های کسب‌وکار؛ الگوهای سیستمی + نقش‌های سفارشی هر کسب‌وکار (§16)';

create unique index role_scope_key_idx
  on app.role (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

create trigger role_touch
  before update on app.role
  for each row execute function app.touch();

create table app.role_permission (
  role_id uuid not null references app.role (id) on delete cascade,
  permission_key text not null references auth.permission (key) on delete restrict,
  primary key (role_id, permission_key)
);

comment on table app.role_permission is 'اتصال نقش کسب‌وکار به مجوزهای دانه‌درشت‌دانه (§16)';

-- ------------------------------------------------------------------ عضویت
create table app.membership (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references app.business (id) on delete cascade,
  user_id uuid not null references auth.app_user (id) on delete cascade,
  role_id uuid not null references app.role (id) on delete restrict,
  status text not null default 'active' check (status in ('invited', 'active', 'suspended', 'left')),
  /** مجوزهای اضافه یا سلب‌شده روی نقش: `{grant:[], revoke:[]}`. */
  overrides jsonb not null default '{"grant":[],"revoke":[]}'::jsonb,
  job_title text,
  joined_at timestamptz,
  invited_by uuid references auth.app_user (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  left_at timestamptz,
  deleted_at timestamptz,
  constraint membership_join_shape check ((status in ('active', 'suspended', 'left')) = (joined_at is not null) or status = 'invited')
);

comment on table app.membership is 'عضویت چندبه‌چند کاربر و کسب‌وکار، با نقش و مجوزهای افزوده (§6، §16)';

-- یک کاربر در یک کسب‌وکار، یک عضویت فعال دارد. حذف‌شده‌ها آزاد می‌شوند تا
-- عضویت مجدد ممکن باشد بدون گم شدن تاریخچه.
create unique index membership_active_idx on app.membership (business_id, user_id) where deleted_at is null and status <> 'left';
create index membership_user_idx on app.membership (user_id, status) where deleted_at is null;
create index membership_business_idx on app.membership (business_id, status) where deleted_at is null;
create index membership_role_idx on app.membership (role_id);

create trigger membership_touch
  before update on app.membership
  for each row execute function app.touch();

-- ------------------------------------------------------------------ دعوت‌نامه
-- §17: یکبارمصرف، با انقضا، و رد حسابرسی. مصرف اتمی است — همان الگوی
-- مصرف توکن در مهاجرت هویت.
create table app.invitation (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references app.business (id) on delete cascade,
  role_id uuid not null references app.role (id) on delete restrict,
  /** دعوت با ایمیل یا موبایل؛ مقدار درهم می‌شود، نه خام. */
  invitee_kind text not null check (invitee_kind in ('email', 'phone')),
  invitee_hash text not null check (length(invitee_hash) >= 32),
  invitee_display text not null,
  token_hash text not null check (length(token_hash) >= 32),
  invited_by uuid not null references auth.app_user (id) on delete restrict,
  message text check (message is null or length(message) <= 500),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.app_user (id) on delete set null,
  rejected_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.app_user (id) on delete set null,
  attempts integer not null default 0 check (attempts >= 0),
  version integer not null default 1,
  constraint invitation_expiry_order check (expires_at > created_at),
  constraint invitation_terminal_shape check (
    accepted_at is null or revoked_at is null
  )
);

comment on table app.invitation is 'دعوت‌نامهٔ یکبارمصرف به کسب‌وکار، با انقضا و رد حسابرسی (§17)';

create unique index invitation_token_idx on app.invitation (token_hash);
create unique index invitation_open_idx on app.invitation (business_id, invitee_hash)
  where accepted_at is null and revoked_at is null and rejected_at is null;
create index invitation_expiry_idx on app.invitation (expires_at) where accepted_at is null and revoked_at is null;

-- ------------------------------------------------------------------ گراف کسب‌وکار
create table app.business_relationship (
  id uuid primary key default gen_random_uuid(),
  from_business_id uuid not null references app.business (id) on delete cascade,
  to_business_id uuid not null references app.business (id) on delete cascade,
  kind text not null check (kind in ('partner', 'supplier', 'customer', 'parent', 'branch_of', 'affiliate')),
  status text not null default 'pending' check (status in ('pending', 'active', 'rejected', 'ended')),
  /** رابطه دوطرفه است یا یک‌طرفه؟ «شریک» دوطرفه، «تأمین‌کننده» یک‌طرفه. */
  is_symmetric boolean not null default false,
  note text,
  requested_by uuid references auth.app_user (id) on delete set null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  ended_at timestamptz,
  version integer not null default 1,
  constraint relationship_not_self check (from_business_id <> to_business_id)
);

comment on table app.business_relationship is 'گراف روابط کسب‌وکارها (§21)';

create unique index relationship_unique_idx on app.business_relationship (from_business_id, to_business_id, kind)
  where status in ('pending', 'active');
create index relationship_from_idx on app.business_relationship (from_business_id, status);
create index relationship_to_idx on app.business_relationship (to_business_id, status);

-- ------------------------------------------------------------------ انتقال مالکیت
-- §17: انتقال مالکیت با تأیید مجدد هویت، رد حسابرسی و تراکنش. جدول، خودِ
-- فرایند را ثبت می‌کند تا انتقال، یک عملیات لحظه‌ای و بی‌ردپا نباشد.
create table app.ownership_transfer (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references app.business (id) on delete cascade,
  from_user_id uuid not null references auth.app_user (id) on delete restrict,
  to_user_id uuid not null references auth.app_user (id) on delete restrict,
  status text not null default 'requested'
    check (status in ('requested', 'awaiting_acceptance', 'completed', 'cancelled', 'rejected', 'expired')),
  reason text,
  requested_at timestamptz not null default now(),
  /** زمان تأیید مجدد هویت درخواست‌کننده؛ بدون آن انتقال پیش نمی‌رود (§11). */
  requester_step_up_at timestamptz,
  accepted_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  expires_at timestamptz not null default now() + interval '7 days',
  request_id text,
  version integer not null default 1,
  constraint transfer_distinct_parties check (from_user_id <> to_user_id),
  constraint transfer_completion_shape check ((status = 'completed') = (completed_at is not null))
);

comment on table app.ownership_transfer is 'انتقال مالکیت کسب‌وکار، با تأیید مجدد هویت و رد حسابرسی (§17)';

create unique index ownership_transfer_open_idx on app.ownership_transfer (business_id)
  where status in ('requested', 'awaiting_acceptance');
create index ownership_transfer_parties_idx on app.ownership_transfer (from_user_id, to_user_id, requested_at desc);

-- ------------------------------------------------------------------ پیوند نشست به کسب‌وکار فعال
-- نشست، «کسب‌وکار فعال» را حمل می‌کند تا هر درخواست، زمینهٔ خودش را داشته
-- باشد و لازم نباشد کلاینت بگوید در کدام کسب‌وکار است (§6، §13).
alter table auth.session
  add column active_business_id uuid references app.business (id) on delete set null;

create index session_active_business_idx on auth.session (active_business_id) where revoked_at is null;

-- ------------------------------------------------------------------ توابع دسترسی
/**
 * آیا کاربر جاری، عضو فعال این کسب‌وکار است؟
 *
 * این تابع ستون فقرات ایزوله‌سازی است: همهٔ سیاست‌های RLS روی جدول‌های tenant
 * به آن تکیه می‌کنند. سه نکته:
 *   * `security definer`: بدون این، خواندن عضویت خودش RLS داشت و بازگشت
 *     بی‌نهایت می‌شد.
 *   * `stable`: در یک پرس‌وجو چند بار صدا زده می‌شود و نباید هر بار پرس‌وجو کند.
 *   * خروجی فقط `boolean` است؛ هیچ اطلاعاتی از عضویت لو نمی‌رود.
 */
create or replace function app.is_member_of(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, app
as $$
  select exists (
    select 1
    from app.membership m
    where m.business_id = p_business_id
      and m.user_id = app.current_user_id()
      and m.status = 'active'
      and m.deleted_at is null
  )
$$;

comment on function app.is_member_of is 'ستون فقرات ایزوله‌سازی مستأجر؛ مبنای سیاست‌های RLS جدول‌های tenant (§14)';

/** نقش کاربر در کسب‌وکار، یا تهی. */
create or replace function app.role_of(p_business_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, app
as $$
  select r.key
  from app.membership m
  join app.role r on r.id = m.role_id
  where m.business_id = p_business_id
    and m.user_id = app.current_user_id()
    and m.status = 'active'
    and m.deleted_at is null
  limit 1
$$;

/**
 * آیا کاربر جاری این مجوز را در این کسب‌وکار دارد؟
 *
 * ترتیب تصمیم، دقیقاً همان چیزی است که در سند آمده:
 *   ۱. کارمند پلتفرم با نقش `superadmin` → دسترسی کامل (با رد حسابرسی، در لایهٔ API).
 *   ۲. عضویت فعال + نقش + مجوزهای افزوده/سلب‌شده.
 *   ۳. هیچ → رد. «رد پیش‌فرض» است، نه «اجازهٔ پیش‌فرض» (§14).
 */
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
  'تصمیم مجوز سمت سرور؛ رد پیش‌فرض، کارمند پلتفرم، سپس نقش و مجوزهای افزوده/سلب‌شده (§14–16)';

/** شمارش اعضای فعال کسب‌وکار — برای نمایش و کنترل سقف پلن. */
create or replace function app.active_member_count(p_business_id uuid)
returns integer
language sql
stable
security definer
set search_path = pg_catalog, app
as $$
  select count(*)::int from app.membership
  where business_id = p_business_id and status = 'active' and deleted_at is null
$$;

/** آیا کاربر جاری یکی از دو طرف است؟ برای سیاست انتقال مالکیت. */
create or replace function app.user_in_transfer(p_from uuid, p_to uuid)
returns boolean
language sql
stable
as $$
  select app.current_user_id() in (p_from, p_to)
$$;

-- ------------------------------------------------------------------ RLS
alter table ref.business_type enable row level security;
alter table ref.industry enable row level security;
alter table ref.location enable row level security;
alter table app.business enable row level security;
alter table app.business_profile enable row level security;
alter table app.business_location enable row level security;
alter table app.business_contact enable row level security;
alter table app.business_verification enable row level security;
alter table app.role enable row level security;
alter table app.role_permission enable row level security;
alter table app.membership enable row level security;
alter table app.invitation enable row level security;
alter table app.business_relationship enable row level security;
alter table app.ownership_transfer enable row level security;

-- دادهٔ مرجع: خواندن آزاد، نوشتن فقط کارکنان پلتفرم.
create policy business_type_read on ref.business_type
  for select to pv_app, pv_public, pv_worker, pv_reader using (true);
create policy business_type_write on ref.business_type
  for all to pv_app, pv_worker
  using (app.current_platform_role() is not null) with check (app.current_platform_role() is not null);

create policy industry_read on ref.industry
  for select to pv_app, pv_public, pv_worker, pv_reader using (true);
create policy industry_write on ref.industry
  for all to pv_app, pv_worker
  using (app.current_platform_role() is not null) with check (app.current_platform_role() is not null);

create policy location_read on ref.location
  for select to pv_app, pv_public, pv_worker, pv_reader using (true);
create policy location_write on ref.location
  for all to pv_app, pv_worker
  using (app.current_platform_role() is not null) with check (app.current_platform_role() is not null);

-- کسب‌وکار: عضو می‌بیند (هر وضعیتی)، بی‌نام فقط منتشرشدهٔ عمومی می‌بیند.
create policy business_member_select on app.business
  for select to pv_app
  using (app.is_member_of(id) or app.current_platform_role() is not null);

/**
 * مالک، همیشه کسب‌وکار خودش را می‌بیند.
 *
 * این سیاست اضافه نیست؛ دو مسئلهٔ واقعی را حل می‌کند:
 *
 *   ۱. **هنگام تولد کسب‌وکار.** در PostgreSQL، `insert ... returning` سیاست
 *      `select` را هم می‌سنجد. مؤسس، هنوز عضویتش ساخته نشده، پس فقط با سیاست
 *      عضویت نمی‌تواند ردیفی را که خودش ساخته برگرداند.
 *   ۲. **هنگام خرابی عضویت.** مالکیت در `owner_user_id` منبع حقیقت است (§17).
 *      اگر عضویت مالک به هر دلیلی معلق یا حذف شد، مالک باید همچنان بتواند
 *      کسب‌وکارش را ببیند و تعمیر کند — وگرنه کسب‌وکار برای همیشه قفل می‌شود.
 */
create policy business_owner_select on app.business
  for select to pv_app
  using (owner_user_id = app.current_user_id());

create policy business_public_select on app.business
  for select to pv_public
  using (status = 'active' and visibility = 'public' and deleted_at is null);

create policy business_insert_self on app.business
  for insert to pv_app
  with check (owner_user_id = app.current_user_id());

create policy business_update_member on app.business
  for update to pv_app
  using (app.has_permission(id, 'business.update') or app.current_platform_role() is not null)
  with check (app.has_permission(id, 'business.update') or app.current_platform_role() is not null);

create policy business_reader on app.business
  for select to pv_reader using (true);

-- PostgreSQL در یک سیاست، فقط یک دستور می‌پذیرد؛ پس خواندن و نوشتن کارگر
-- دو سیاست جدا می‌شوند. این محدودیت زبان است، نه سلیقه.
create policy business_worker_select on app.business
  for select to pv_worker
  using (app.current_platform_role() is not null);

create policy business_worker_update on app.business
  for update to pv_worker
  using (app.current_platform_role() is not null)
  with check (app.current_platform_role() is not null);

-- جدول‌های فرزند: نگهبان، همان تابع دسترسی روی کلید کسب‌وکار.
create policy business_profile_member on app.business_profile
  for all to pv_app
  using (app.has_permission(business_id, 'business.update') or app.current_platform_role() is not null)
  with check (app.has_permission(business_id, 'business.update') or app.current_platform_role() is not null);

create policy business_profile_public on app.business_profile
  for select to pv_public
  using (exists (
    select 1 from app.business b
    where b.id = business_id and b.status = 'active' and b.visibility = 'public' and b.deleted_at is null
  ));

create policy business_profile_reader on app.business_profile
  for select to pv_reader using (true);

create policy business_location_member on app.business_location
  for all to pv_app
  using (app.has_permission(business_id, 'business.update') or app.current_platform_role() is not null)
  with check (app.has_permission(business_id, 'business.update') or app.current_platform_role() is not null);

create policy business_location_public on app.business_location
  for select to pv_public
  using (exists (
    select 1 from app.business b
    where b.id = business_id and b.status = 'active' and b.visibility = 'public' and b.deleted_at is null
  ));

create policy business_location_reader on app.business_location
  for select to pv_reader using (true);

create policy business_contact_member on app.business_contact
  for all to pv_app
  using (app.has_permission(business_id, 'business.contact.manage') or app.current_platform_role() is not null)
  with check (app.has_permission(business_id, 'business.contact.manage') or app.current_platform_role() is not null);

-- تماس عمومی: فقط آن‌هایی که خود کسب‌وکار عمومی کرده است.
create policy business_contact_public on app.business_contact
  for select to pv_public
  using (
    is_public
    and exists (
      select 1 from app.business b
      where b.id = business_id and b.status = 'active' and b.visibility = 'public' and b.deleted_at is null
    )
  );

create policy business_contact_reader on app.business_contact
  for select to pv_reader using (true);

create policy business_verification_member on app.business_verification
  for select to pv_app
  using (app.is_member_of(business_id) or app.current_platform_role() is not null);

create policy business_verification_submit on app.business_verification
  for insert to pv_app
  with check (app.is_member_of(business_id) or app.current_platform_role() is not null);

-- تصمیم تأیید، کار کارکنان پلتفرم است؛ عضو عادی نمی‌تواند تأیید خودش را
-- بنویسد.
create policy business_verification_review on app.business_verification
  for update to pv_app, pv_worker
  using (app.current_platform_role() is not null)
  with check (app.current_platform_role() is not null);

create policy business_verification_reader on app.business_verification
  for select to pv_reader using (true);

-- نقش‌ها: الگوهای سیستمی برای همه خواندنی، نقش‌های سفارشی فقط برای اعضای همان
-- کسب‌وکار.
create policy role_read on app.role
  for select to pv_app, pv_public, pv_reader
  using (business_id is null or app.is_member_of(business_id));

create policy role_write_member on app.role
  for all to pv_app
  using (business_id is not null and app.has_permission(business_id, 'business.role.manage'))
  with check (business_id is not null and app.has_permission(business_id, 'business.role.manage'));

create policy role_staff_write on app.role
  for all to pv_app, pv_worker
  using (app.current_platform_role() is not null)
  with check (app.current_platform_role() is not null);

create policy role_permission_read on app.role_permission
  for select to pv_app, pv_reader
  using (exists (select 1 from app.role r where r.id = role_id and (r.business_id is null or app.is_member_of(r.business_id))));

create policy role_permission_member on app.role_permission
  for all to pv_app
  using (exists (select 1 from app.role r where r.id = role_id and r.business_id is not null and app.has_permission(r.business_id, 'business.role.manage')))
  with check (exists (select 1 from app.role r where r.id = role_id and r.business_id is not null and app.has_permission(r.business_id, 'business.role.manage')));

-- عضویت: کاربر عضویت خودش را می‌بیند، مدیران کسب‌وکار همهٔ اعضا را.
-- این سیاست عمداً به `app.is_member_of` تکیه نمی‌کند تا هیچ چرخه‌ای ممکن نباشد.
create policy membership_self_select on app.membership
  for select to pv_app
  using (user_id = app.current_user_id() or app.current_platform_role() is not null);

create policy membership_manager_all on app.membership
  for all to pv_app
  using (app.has_permission(business_id, 'business.member.manage') or app.current_platform_role() is not null)
  with check (app.has_permission(business_id, 'business.member.manage') or app.current_platform_role() is not null);

/**
 * تولد کسب‌وکار: کسی که کسب‌وکار را می‌سازد، مالک می‌شود.
 *
 * بدون این سیاست، یک چرخهٔ قفل‌شده می‌سازیم: برای افزودن عضویت باید مجوز
 * `business.member.manage` داشت، و برای داشتن مجوز باید عضویت داشت. این سیاست
 * حلقه را فقط در همان لحظهٔ تولد باز می‌کند و با سه قید بسته می‌شود:
 *   * فقط برای خودِ کاربر جاری،
 *   * فقط اگر او مالک ثبت‌شدهٔ همان کسب‌وکار باشد،
 *   * فقط اگر کسب‌وکار هنوز **هیچ** عضوی نداشته باشد،
 *   * و فقط با نقش `owner`.
 * پس نه راهی برای افزودن مالک دوم هست، نه برای عضو کردن خود در کسب‌وکار
 * دیگری.
 */
create policy membership_bootstrap_owner on app.membership
  for insert to pv_app
  with check (
    user_id = app.current_user_id()
    and exists (
      select 1 from app.business b
      where b.id = business_id and b.owner_user_id = app.current_user_id() and b.deleted_at is null
    )
    and exists (select 1 from app.role r where r.id = role_id and r.key = 'owner')
    and not exists (select 1 from app.membership m where m.business_id = membership.business_id and m.deleted_at is null)
  );

create policy membership_self_leave on app.membership
  for update to pv_app
  using (user_id = app.current_user_id() and app.role_of(business_id) <> 'owner')
  with check (user_id = app.current_user_id());

create policy membership_reader on app.membership
  for select to pv_reader using (true);

create policy invitation_member on app.invitation
  for all to pv_app
  using (app.has_permission(business_id, 'business.member.invite') or app.current_platform_role() is not null)
  with check (app.has_permission(business_id, 'business.member.invite') or app.current_platform_role() is not null);

-- پذیرش دعوت: کاربر با توکن درخواست می‌زند و کد سمت سرور توکن را مصرف می‌کند.
-- آنچه نقش `pv_app` می‌تواند بخواند، فقط ردیف‌هایی است که کاربر جاری ذخیره‌کننده‌شان
-- نبوده — یعنی هیچ. مصرف از راه تابع انجام می‌شود.
create policy invitation_reader on app.invitation
  for select to pv_reader using (true);

-- گراف روابط: هر طرف رابطه، آن را می‌بیند.
create policy relationship_party_select on app.business_relationship
  for select to pv_app
  using (app.is_member_of(from_business_id) or app.is_member_of(to_business_id) or app.current_platform_role() is not null);

create policy relationship_manage on app.business_relationship
  for all to pv_app
  using (app.has_permission(from_business_id, 'business.relationship.manage') or app.current_platform_role() is not null)
  with check (app.has_permission(from_business_id, 'business.relationship.manage') or app.current_platform_role() is not null);

create policy relationship_public_select on app.business_relationship
  for select to pv_public
  using (
    status = 'active'
    and exists (select 1 from app.business b where b.id = from_business_id and b.status = 'active' and b.visibility = 'public' and b.deleted_at is null)
    and exists (select 1 from app.business b where b.id = to_business_id and b.status = 'active' and b.visibility = 'public' and b.deleted_at is null)
  );

create policy relationship_reader on app.business_relationship
  for select to pv_reader using (true);

-- انتقال مالکیت: مالک درخواست می‌دهد، طرفین می‌بینند، کارکنان پلتفرم هم.
create policy ownership_transfer_select on app.ownership_transfer
  for select to pv_app
  using (
    app.is_member_of(business_id)
    or app.user_in_transfer(from_user_id, to_user_id)
    or app.current_platform_role() is not null
  );

create policy ownership_transfer_manage on app.ownership_transfer
  for all to pv_app
  using (
    (from_user_id = app.current_user_id() and app.has_permission(business_id, 'business.transfer.initiate'))
    or (to_user_id = app.current_user_id())
    or app.current_platform_role() is not null
  )
  with check (
    (from_user_id = app.current_user_id() and app.has_permission(business_id, 'business.transfer.initiate'))
    or (to_user_id = app.current_user_id())
    or app.current_platform_role() is not null
  );

create policy ownership_transfer_reader on app.ownership_transfer
  for select to pv_reader using (true);

-- ------------------------------------------------------------------ گرنت‌ها
grant select on ref.business_type, ref.industry, ref.location to pv_app, pv_public, pv_worker, pv_reader;
grant insert, update on ref.business_type, ref.industry, ref.location to pv_app, pv_worker;

grant select, insert, update on app.business to pv_app;
grant select on app.business to pv_public, pv_worker, pv_reader;
grant select, insert, update, delete on app.business_profile, app.business_location, app.business_contact to pv_app;
grant select on app.business_profile, app.business_location, app.business_contact to pv_public, pv_reader;
grant select, insert, update on app.business_verification to pv_app, pv_worker;
grant select on app.business_verification to pv_reader;
grant select, insert, update, delete on app.role, app.role_permission to pv_app;
grant select on app.role, app.role_permission to pv_public, pv_worker, pv_reader;
grant select, insert, update, delete on app.membership to pv_app;
grant select on app.membership to pv_reader;
grant select, insert, update, delete on app.invitation to pv_app;
grant select on app.invitation to pv_reader;
grant select, insert, update, delete on app.business_relationship to pv_app;
grant select on app.business_relationship to pv_public, pv_reader;
grant select, insert, update on app.ownership_transfer to pv_app;
grant select on app.ownership_transfer to pv_reader;

revoke all on function app.is_member_of(uuid) from public;
revoke all on function app.role_of(uuid) from public;
revoke all on function app.has_permission(uuid, text) from public;
revoke all on function app.active_member_count(uuid) from public;
revoke all on function app.user_in_transfer(uuid, uuid) from public;

grant execute on function app.is_member_of(uuid) to pv_app, pv_worker, pv_reader;
grant execute on function app.role_of(uuid) to pv_app, pv_worker;
grant execute on function app.has_permission(uuid, text) to pv_app, pv_worker;
grant execute on function app.active_member_count(uuid) to pv_app, pv_public, pv_worker;
grant execute on function app.user_in_transfer(uuid, uuid) to pv_app;
