-- ---------------------------------------------------------------------------
-- 0004 — محتوا و رسانه
--
-- مرجع: §23–§24 (چرخهٔ عمر محتوا و حسابرسی)، §74–§75 (بارگذاری امن و لایهٔ
--       ذخیره‌سازی)، §132 (حذف نرم)، Addendum §۲۵–۳۲ (خط لولهٔ تصویر و دارایی).
--
-- تصمیم‌های کلیدی:
--
--   ۱. **رسانه و محتوا دو چیزند.** «دارایی» یک فایل با فراداده و مشتقاتش است؛
--      «محتوا» یک متن با چرخهٔ تأیید و انتشار. مخلوط‌کردنشان همان اشتباهی است
--      که بعداً «حذف عکس، آگهی را هم پاک می‌کند» می‌سازد.
--
--   ۲. **فایل هرگز داخل پایگاه‌داده نمی‌نشیند.** فقط کلید انبار و فراداده.
--      دلیلش: پشتیبان‌گیری، انتقال و CDN با دادهٔ دودویی در پایگاه‌داده به
--      کابوس تبدیل می‌شود (§75).
--
--   ۳. **مشتق‌ها صریح‌اند.** هر نسخه از تصویر (اندازه، قالب) یک ردیف است، با
--      وضعیت پردازش. پس «این تصویر بهینه شده یا نه» یک پرس‌وجو است، نه حدس.
--
--   ۴. **نام فایل کاربر هرگز در مسیر نمی‌نشیند.** کلید انبار از شناسهٔ دارایی
--      ساخته می‌شود. نام اصلی فقط برای نمایش است. این، هم پیمایش مسیر را
--      می‌بندد و هم نام‌های تکراری و نویسه‌های خطرناک را بی‌اثر می‌کند.
-- ---------------------------------------------------------------------------

-- ------------------------------------------------------------------ دارایی‌ها
create table media.asset (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references app.business (id) on delete cascade,
  uploaded_by uuid references auth.app_user (id) on delete set null,

  /** کلید در انبار؛ ساختهٔ سرور، نه کاربر. */
  storage_key text not null check (length(storage_key) between 8 and 400),
  driver text not null default 'local' check (driver in ('local', 's3', 'supabase', 'external')),
  bucket text,

  /** نام اصلی فقط برای نمایش؛ هرگز در مسیر استفاده نمی‌شود. */
  original_name text check (original_name is null or length(original_name) <= 255),
  /** نوع اعلام‌شده (از هدر) و نوع تشخیص‌داده‌شده (از امضای فایل). */
  declared_mime text,
  detected_mime text not null,
  kind text not null check (kind in ('image', 'video', 'audio', 'document', 'archive', 'font', 'other')),

  size_bytes bigint not null check (size_bytes > 0),
  checksum_sha256 text check (checksum_sha256 is null or length(checksum_sha256) = 64),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  duration_seconds numeric(10, 3) check (duration_seconds is null or duration_seconds >= 0),
  pages integer check (pages is null or pages > 0),

  /** فرادادهٔ استخراج‌شده: EXIF پاک‌شده، پالت رنگ، متن جانشین پیشنهادی. */
  metadata jsonb not null default '{}'::jsonb,
  width_height_ratio numeric(10, 6)
    generated always as (case when width is not null and height is not null and height > 0
      then round(width::numeric / height::numeric, 6) end) stored,

  /** متن جانشین؛ برای دسترس‌پذیری و سئو (§45، Addendum §44). */
  alt_text text check (alt_text is null or length(alt_text) <= 300),
  caption text,

  /** دارایی همگانی: برای تصاویر سیستمی و پیش‌فرض‌ها. */
  is_public boolean not null default true,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'ready', 'quarantined', 'failed', 'deleted')),

  /** دادهٔ ویروس/تطبیق امضا: هر برخوردی، دارایی را قرنطینه می‌کند. */
  scan_status text not null default 'not_scanned'
    check (scan_status in ('not_scanned', 'clean', 'infected', 'skipped')),
  scan_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,

  constraint asset_mime_shape check (position('/' in detected_mime) > 1),
  constraint asset_quarantine_shape check ((status = 'quarantined') = (scan_status = 'infected'))
);

comment on table media.asset is 'دارایی رسانه‌ای؛ فایل بیرون، فراداده درون (§75، Addendum §25–32)';

create unique index asset_storage_key_idx on media.asset (driver, storage_key) where deleted_at is null;
create index asset_business_idx on media.asset (business_id, created_at desc) where deleted_at is null;
create index asset_kind_idx on media.asset (kind, status) where deleted_at is null;
create index asset_checksum_idx on media.asset (checksum_sha256) where checksum_sha256 is not null and deleted_at is null;
create index asset_pending_idx on media.asset (created_at) where status in ('pending', 'processing');
create index asset_metadata_idx on media.asset using gin (metadata jsonb_path_ops);

create trigger asset_touch
  before update on media.asset
  for each row execute function app.touch();

-- ------------------------------------------------------------------ مشتقات
create table media.derivative (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references media.asset (id) on delete cascade,
  /** kind: thumbnail, small, medium, large, og, avif, webp، یا نسخهٔ ویدیویی. */
  variant text not null check (variant ~ '^[a-z0-9_-]{2,32}$'),
  format text not null check (format in ('jpeg', 'png', 'webp', 'avif', 'mp4', 'webm', 'mp3', 'pdf', 'json', 'webvtt')),
  storage_key text not null,
  driver text not null default 'local' check (driver in ('local', 's3', 'supabase')),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  size_bytes bigint not null check (size_bytes > 0),
  quality smallint check (quality is null or quality between 1 and 100),
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  error_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  /** مسیر ثابت برای همان دارایی و تنوع: اجرای دوبارهٔ خط لوله، ردیف تکراری نمی‌سازد. */
  unique (asset_id, variant, format)
);

comment on table media.derivative is 'نسخه‌های بهینه‌شدهٔ دارایی (اندازه و قالب)؛ مبنای srcset و AVIF/WebP (Addendum §6–19)';

create index derivative_asset_idx on media.derivative (asset_id, status);
create index derivative_pending_idx on media.derivative (created_at) where status = 'pending';

create trigger derivative_touch
  before update on media.derivative
  for each row execute function app.touch();

-- ------------------------------------------------------------------ آلبوم
create table media.album (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references app.business (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9\u0600-\u06ff-]{2,80}$'),
  title text not null check (length(btrim(title)) between 2 and 160),
  description text,
  cover_asset_id uuid references media.asset (id) on delete set null,
  visibility text not null default 'public' check (visibility in ('private', 'unlisted', 'public')),
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);

comment on table media.album is 'آلبوم رسانه‌ای کسب‌وکار (§75)';

create unique index album_slug_idx on media.album (business_id, slug) where deleted_at is null;

create trigger album_touch
  before update on media.album
  for each row execute function app.touch();

create table media.album_item (
  album_id uuid not null references media.album (id) on delete cascade,
  asset_id uuid not null references media.asset (id) on delete cascade,
  sort_order integer not null default 100,
  note text,
  added_at timestamptz not null default now(),
  primary key (album_id, asset_id)
);

comment on table media.album_item is 'اتصال دارایی به آلبوم، با ترتیب (§75)';

create index album_item_asset_idx on media.album_item (asset_id);

-- ------------------------------------------------------------------ محتوا
create table app.content (
  id uuid primary key default gen_random_uuid(),
  /** محتوای سراسری پلتفرم (راهنما، مقالهٔ پایه) یا محتوای کسب‌وکار. */
  business_id uuid references app.business (id) on delete cascade,
  kind text not null
    check (kind in ('page', 'article', 'guide', 'faq', 'listing', 'service', 'product', 'event', 'announcement')),
  slug text not null check (slug ~ '^[a-z0-9\u0600-\u06ff]+(-[a-z0-9\u0600-\u06ff]+)*$'),
  title text not null check (length(btrim(title)) between 2 and 200),
  subtitle text check (subtitle is null or length(subtitle) <= 300),
  summary text check (summary is null or length(summary) <= 600),
  /** بدنه به‌صورت متن ساختاریافته (JSON AST)؛ هرگز HTML خام از کاربر (§74). */
  body jsonb not null default '{"type":"doc","blocks":[]}'::jsonb,
  /** نسخهٔ متنی برای جست‌وجو و استخراج؛ از بدنه تولید می‌شود. */
  body_text text,

  cover_asset_id uuid references media.asset (id) on delete set null,
  author_user_id uuid references auth.app_user (id) on delete set null,
  /** نویسندهٔ نمایشی: ممکن است کسب‌وکار باشد، نه یک کاربر مشخص. */
  author_display text,

  status text not null default 'draft'
    check (status in ('draft', 'in_review', 'changes_requested', 'approved', 'scheduled', 'published', 'unpublished', 'archived')),
  visibility text not null default 'public' check (visibility in ('private', 'unlisted', 'public')),

  /** زبان محتوا؛ برای i18n آماده (§123–125). */
  locale text not null default 'fa-IR' check (position('-' in locale) > 1),
  /** ترجمه‌های یک محتوا، به هم می‌چسبند. */
  translation_of uuid references app.content (id) on delete set null,

  /* روابط موضوعی */
  business_type_key text references ref.business_type (key) on delete set null,
  industry_key text references ref.industry (key) on delete set null,

  /** ترتیب پیش‌فرض در فهرست‌ها؛ سنگین‌تر یعنی جلوب‌تر. */
  weight integer not null default 0,
  /** محتوای شاخص: در صفحهٔ اصلی و فهرست‌ها برجسته می‌شود. */
  is_featured boolean not null default false,

  published_at timestamptz,
  scheduled_for timestamptz,
  unpublished_at timestamptz,
  archived_at timestamptz,
  deleted_at timestamptz,

  /** رکورد تغییر برای هم‌روندی خوش‌بینانه روی محتوای پرمصرف (§58). */
  content_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,

  /*
   * چرخهٔ عمر، در سطح داده بسته می‌شود — نه در کد (§23).
   *
   * `published` بی `published_at` یعنی محتوایی که «منتشر شده» ولی هیچ‌جا تاریخ
   * انتشار ندارد؛ چنین ردیفی، سایت‌مپ و متادیتا و ترتیب فهرست‌ها را خراب می‌کند.
   * `unpublished` باید هر دو مهر را داشته باشد (بود، پس پس گرفته شد) و
   * `archived` هم مهر خودش را.
   */
  constraint content_publish_shape check (
    case status
      when 'published' then published_at is not null
      when 'unpublished' then published_at is not null and unpublished_at is not null
      when 'archived' then archived_at is not null
      else published_at is null and unpublished_at is null
    end
  ),
  constraint content_schedule_shape check ((status = 'scheduled') = (scheduled_for is not null)),
  constraint content_schedule_future check (scheduled_for is null or scheduled_for > created_at)
);

comment on table app.content is 'محتوا با چرخهٔ عمر کامل: پیش‌نویس → بازبینی → تأیید → زمان‌بندی → انتشار (§23)';

create unique index content_slug_idx on app.content (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, locale, slug)
  where deleted_at is null;
create index content_business_idx on app.content (business_id, kind, status, updated_at desc) where deleted_at is null;
create index content_public_idx on app.content (published_at desc)
  where status = 'published' and visibility = 'public' and deleted_at is null;
create index content_type_idx on app.content (business_type_key, is_featured, published_at desc)
  where status = 'published' and deleted_at is null;
create index content_industry_idx on app.content (industry_key, published_at desc)
  where status = 'published' and deleted_at is null;
create index content_schedule_idx on app.content (scheduled_for) where status = 'scheduled';
create index content_translation_idx on app.content (translation_of) where translation_of is not null;
-- جست‌وجوی متنی: بدون وابستگی به افزونه، بر پایهٔ `simple` و ستون متنی تولیدشده.
create index content_body_fts_idx on app.content using gin (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(body_text, '')));

create trigger content_touch
  before update on app.content
  for each row execute function app.touch();

-- ------------------------------------------------------------------ بلوک‌های محتوا
-- محتوای ساختیافته: هر بلوک یک نوع و دادهٔ خودش. دلیل جدا بودنش از `body`:
-- بخش‌های قابل پرس‌وجو (مثلاً «همهٔ پرسش‌های متداول») باید قابل فهرست‌شدن
-- باشند، نه اینکه در یک JSON بزرگ گم شوند.
create table app.content_block (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references app.content (id) on delete cascade,
  kind text not null check (kind in (
    'heading', 'paragraph', 'list', 'quote', 'callout', 'image', 'gallery',
    'video', 'table', 'faq', 'steps', 'cta', 'divider', 'embed', 'map', 'pricing', 'spec'
  )),
  sort_order integer not null default 0,
  data jsonb not null default '{}'::jsonb,
  /** متن قابل جست‌وجوی بلوک؛ برای FAQ و بلوک‌های متنی. */
  plain_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

comment on table app.content_block is 'بلوک‌های محتوای ساختیافته، قابل پرس‌وجو بر پایهٔ نوع (§23، §74)';

create index content_block_content_idx on app.content_block (content_id, sort_order);
create index content_block_kind_idx on app.content_block (kind);
create index content_block_data_idx on app.content_block using gin (data jsonb_path_ops);
create index content_block_plaintdsearch_idx on app.content_block using gin (to_tsvector('simple', coalesce(plain_text, '')));

create trigger content_block_touch
  before update on app.content_block
  for each row execute function app.touch();

-- ------------------------------------------------------------------ بازبینی محتوا
create table app.content_review (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references app.content (id) on delete cascade,
  reviewer_id uuid references auth.app_user (id) on delete set null,
  decision text not null check (decision in ('submitted', 'approved', 'changes_requested', 'rejected', 'published', 'unpublished')),
  note text,
  /** نسخهٔ محتوا در لحظهٔ تصمیم؛ برای اینکه بدانیم چه چیزی تأیید شده. */
  content_version integer not null,
  created_at timestamptz not null default now()
);

comment on table app.content_review is 'تاریخچهٔ بازبینی محتوا؛ هر تصمیم با نسخهٔ دقیق محتوا (§23)';

create index content_review_content_idx on app.content_review (content_id, created_at desc);

-- ------------------------------------------------------------------ دسته‌بندی محتوا
create table ref.category (
  id uuid primary key default gen_random_uuid(),
  /** دامنهٔ کاربرد: محتوا، آگهی، خدمت، محصول. */
  scope text not null check (scope in ('content', 'listing', 'service', 'product', 'faq')),
  business_id uuid references app.business (id) on delete cascade,
  parent_id uuid references ref.category (id) on delete set null,
  slug text not null,
  name_fa text not null,
  description text,
  icon_key text,
  path text not null,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint category_scope_shape check (business_id is null or scope <> 'content')
);

comment on table ref.category is 'دسته‌بندی چنددامنه‌ای (محتوا، آگهی، خدمت) با مسیر مادیت‌شده (§20، §23)';

create unique index category_scope_slug_idx
  on ref.category (scope, coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);
create index category_path_idx on ref.category (path text_pattern_ops) where is_active;
create index category_parent_idx on ref.category (parent_id, sort_order) where is_active;

create trigger category_touch
  before update on ref.category
  for each row execute function app.touch();

create table app.content_category (
  content_id uuid not null references app.content (id) on delete cascade,
  category_id uuid not null references ref.category (id) on delete cascade,
  primary key (content_id, category_id)
);

comment on table app.content_category is 'اتصال چندبه‌چند محتوا و دسته (§23)';

create index content_category_category_idx on app.content_category (category_id);

-- ------------------------------------------------------------------ ذخیره‌سازی: ثبت دسترسی
-- هیچ‌کس نمی‌تواند «دارایی ناموجود» را به کار ببرد. این جدول، جایی نیست که
-- دادهٔ تازه بسازد؛ فقط کلیدهای بیرونی را معتبر می‌کند.
create or replace function media.asset_is_usable(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, media
as $$
  select exists (
    select 1 from media.asset a
    where a.id = p_asset_id
      and a.deleted_at is null
      and a.status = 'ready'
      and a.scan_status in ('clean', 'skipped', 'not_scanned')
  )
$$;

comment on function media.asset_is_usable is 'آیا دارایی حاضر و قابل استفاده است؟ مبنای کنترل کلیدهای بیرونی (§75)';

/**
 * شمارندهٔ رسانهٔ کسب‌وکار را از منبع حقیقت بازمی‌سازد.
 *
 * چرا تابع و نه تریگر افزایشی: شمارندهٔ افزایشی با هر خطای میانی، بی‌سروصدا
 * واگرا می‌شود و بعد از یک سال «۲٬۰۰۰ تصویر» نشان می‌دهد برای ۲۰۰ تصویر.
 * تابع بازساز، همیشه درست است و می‌توان آن را زمان‌بندی‌شده اجرا کرد.
 */
create or replace function media.recount_assets(p_business_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, media, app
as $$
declare
  v_count integer;
begin
  select count(*)::int into v_count
  from media.asset
  where business_id = p_business_id and deleted_at is null and status <> 'deleted';

  update app.business set media_count = v_count where id = p_business_id;
  return v_count;
end
$$;

-- ------------------------------------------------------------------ RLS
alter table media.asset enable row level security;
alter table media.derivative enable row level security;
alter table media.album enable row level security;
alter table media.album_item enable row level security;
alter table app.content enable row level security;
alter table app.content_block enable row level security;
alter table app.content_review enable row level security;
alter table ref.category enable row level security;
alter table app.content_category enable row level security;

-- دارایی: مالک یا گردانندهٔ رسانهٔ کسب‌وکار. دارایی عمومی، برای همه.
create policy asset_member_all on media.asset
  for all to pv_app
  using (
    (business_id is not null and (app.has_permission(business_id, 'media.manage') or app.current_platform_role() is not null))
    or (business_id is null and uploaded_by = app.current_user_id())
  )
  with check (
    (business_id is not null and (app.has_permission(business_id, 'media.manage') or app.current_platform_role() is not null))
    or (business_id is null and uploaded_by = app.current_user_id())
  );

create policy asset_public_select on media.asset
  for select to pv_public
  using (
    is_public
    and deleted_at is null
    and status = 'ready'
    and scan_status <> 'infected'
    and (
      business_id is null
      or exists (
        select 1 from app.business b
        where b.id = business_id and b.status = 'active' and b.visibility = 'public' and b.deleted_at is null
      )
    )
  );

create policy asset_reader on media.asset
  for select to pv_reader using (true);

create policy asset_worker_select on media.asset
  for select to pv_worker
  using (true);

create policy asset_worker_update on media.asset
  for update to pv_worker
  using (true)
  with check (true);

-- مشتق‌ها: همان قاعدهٔ دارایی، ولی بدون نوشتن برای نقش بی‌نام.
create policy derivative_member on media.derivative
  for all to pv_app
  using (exists (
    select 1 from media.asset a
    where a.id = asset_id
      and ((a.business_id is not null and app.has_permission(a.business_id, 'media.manage'))
        or (a.business_id is null and a.uploaded_by = app.current_user_id())
        or app.current_platform_role() is not null)
  ))
  with check (exists (
    select 1 from media.asset a
    where a.id = asset_id
      and ((a.business_id is not null and app.has_permission(a.business_id, 'media.manage'))
        or (a.business_id is null and a.uploaded_by = app.current_user_id())
        or app.current_platform_role() is not null)
  ));

create policy derivative_public_select on media.derivative
  for select to pv_public
  using (exists (
    select 1 from media.asset a
    where a.id = asset_id and a.is_public and a.deleted_at is null and a.status = 'ready'
  ));

create policy derivative_reader on media.derivative
  for select to pv_reader using (true);

create policy derivative_worker on media.derivative
  for all to pv_worker
  using (true)
  with check (true);

create policy album_member_all on media.album
  for all to pv_app
  using (app.has_permission(business_id, 'media.manage') or app.current_platform_role() is not null)
  with check (app.has_permission(business_id, 'media.manage') or app.current_platform_role() is not null);

create policy album_public_select on media.album
  for select to pv_public
  using (
    visibility = 'public' and deleted_at is null
    and exists (select 1 from app.business b where b.id = business_id and b.status = 'active' and b.visibility = 'public' and b.deleted_at is null)
  );

create policy album_reader on media.album
  for select to pv_reader using (true);

create policy album_item_member_all on media.album_item
  for all to pv_app
  using (exists (select 1 from media.album al where al.id = album_id and app.has_permission(al.business_id, 'media.manage')))
  with check (exists (select 1 from media.album al where al.id = album_id and app.has_permission(al.business_id, 'media.manage')));

create policy album_item_public_select on media.album_item
  for select to pv_public
  using (exists (select 1 from media.album al where al.id = album_id and al.visibility = 'public' and al.deleted_at is null));

create policy album_item_reader on media.album_item
  for select to pv_reader using (true);

-- محتوا: گردانندهٔ محتوا در کسب‌وکار، یا کارکنان پلتفرم برای محتوای سراسری.
-- خواندن: هر عضو، محتوای کسب‌وکار خودش را می‌بیند (پیش‌نویس را هم).
-- نوشتن: هر دستور، مجوز خودش را می‌خواهد — «مدیریت محتوا» یک مجوز نیست،
-- بلکه نام چهار کار متفاوت است: ساخت، ویرایش، انتشار، حذف.
create policy content_member_select on app.content
  for select to pv_app
  using (
    case
      when business_id is null then app.current_platform_role() is not null
      else app.is_member_of(business_id) or app.current_platform_role() is not null
    end
  );

create policy content_member_insert on app.content
  for insert to pv_app
  with check (
    case
      when business_id is null then app.current_platform_role() is not null
      else app.has_permission(business_id, 'content.create') or app.current_platform_role() is not null
    end
  );

create policy content_member_update on app.content
  for update to pv_app
  using (
    business_id is not null and (app.has_permission(business_id, 'content.update') or app.current_platform_role() is not null)
  )
  with check (
    business_id is not null and (app.has_permission(business_id, 'content.update') or app.current_platform_role() is not null)
  );

create policy content_platform_write on app.content
  for all to pv_app
  using (business_id is null and app.current_platform_role() is not null)
  with check (business_id is null and app.current_platform_role() is not null);

create policy content_public_select on app.content
  for select to pv_public
  using (
    status = 'published'
    and visibility = 'public'
    and deleted_at is null
    and (published_at is null or published_at <= now())
    and (
      business_id is null
      or exists (select 1 from app.business b where b.id = business_id and b.status = 'active' and b.visibility = 'public' and b.deleted_at is null)
    )
  );

create policy content_reader on app.content
  for select to pv_reader using (true);

create policy content_worker_select on app.content
  for select to pv_worker
  using (app.current_platform_role() is not null);

create policy content_worker_update on app.content
  for update to pv_worker
  using (app.current_platform_role() is not null)
  with check (app.current_platform_role() is not null);

-- بلوک‌ها تابع محتوای والدشان‌اند: اگر اجازهٔ ویرایش محتوا داری، بلوک‌ها را هم
-- داری. تفکیک مجوز بلوک از محتوا، پیچیدگی بی‌فایده می‌ساخت.
create policy content_block_member_select on app.content_block
  for select to pv_app
  using (exists (
    select 1 from app.content c
    where c.id = content_id
      and (case when c.business_id is null then app.current_platform_role() is not null
                else app.is_member_of(c.business_id) or app.current_platform_role() is not null end)
  ));

create policy content_block_member_insert on app.content_block
  for insert to pv_app
  with check (exists (
    select 1 from app.content c
    where c.id = content_id
      and (case when c.business_id is null then app.current_platform_role() is not null
                else app.has_permission(c.business_id, 'content.create') or app.current_platform_role() is not null end)
  ));

create policy content_block_member_update on app.content_block
  for update to pv_app
  using (exists (
    select 1 from app.content c
    where c.id = content_id and c.business_id is not null
      and (app.has_permission(c.business_id, 'content.update') or app.current_platform_role() is not null)
  ))
  with check (exists (
    select 1 from app.content c
    where c.id = content_id and c.business_id is not null
      and (app.has_permission(c.business_id, 'content.update') or app.current_platform_role() is not null)
  ));

create policy content_block_member_delete on app.content_block
  for delete to pv_app
  using (exists (
    select 1 from app.content c
    where c.id = content_id and c.business_id is not null
      and (app.has_permission(c.business_id, 'content.delete') or app.current_platform_role() is not null)
  ));

create policy content_block_public_select on app.content_block
  for select to pv_public
  using (exists (
    select 1 from app.content c
    where c.id = content_id and c.status = 'published' and c.visibility = 'public' and c.deleted_at is null
  ));

create policy content_block_reader on app.content_block
  for select to pv_reader using (true);

create policy content_review_member_select on app.content_review
  for select to pv_app
  using (exists (
    select 1 from app.content c
    where c.id = content_id
      and (case when c.business_id is null then app.current_platform_role() is not null
                else app.is_member_of(c.business_id) or app.current_platform_role() is not null end)
  ));

create policy content_review_insert on app.content_review
  for insert to pv_app
  with check (exists (
    select 1 from app.content c
    where c.id = content_id
      and (case when c.business_id is null then app.current_platform_role() is not null
                else app.is_member_of(c.business_id) or app.current_platform_role() is not null end)
  ));

-- بازبینی، سابقه است: نوشتنِ پس از ثبت، ممنوع.
create trigger content_review_append_only
  before update or delete on app.content_review
  for each row execute function app.forbid_mutation();

create policy content_review_reader on app.content_review
  for select to pv_reader using (true);

create policy category_read on ref.category
  for select to pv_app, pv_public, pv_worker, pv_reader using (true);

create policy category_write on ref.category
  for all to pv_app, pv_worker
  using (app.current_platform_role() is not null)
  with check (app.current_platform_role() is not null);

-- دستهٔ کسب‌وکار: خواندنش کار هر عضو است، نوشتنش مجوز محتوا می‌خواهد.
create policy category_select_business on ref.category
  for select to pv_app
  using (business_id is not null and app.is_member_of(business_id));

create policy category_write_business on ref.category
  for all to pv_app
  using (business_id is not null and app.has_permission(business_id, 'content.update'))
  with check (business_id is not null and app.has_permission(business_id, 'content.update'));

create policy content_category_member_select on app.content_category
  for select to pv_app
  using (exists (
    select 1 from app.content c
    where c.id = content_id and c.business_id is not null and app.is_member_of(c.business_id)
  ));

create policy content_category_member_write on app.content_category
  for all to pv_app
  using (exists (
    select 1 from app.content c
    where c.id = content_id and c.business_id is not null and app.has_permission(c.business_id, 'content.update')
  ))
  with check (exists (
    select 1 from app.content c
    where c.id = content_id and c.business_id is not null and app.has_permission(c.business_id, 'content.update')
  ));

create policy content_category_public on app.content_category
  for select to pv_public
  using (exists (select 1 from app.content c where c.id = content_id and c.status = 'published' and c.visibility = 'public' and c.deleted_at is null));

create policy content_category_reader on app.content_category
  for select to pv_reader using (true);

-- ------------------------------------------------------------------ گرنت‌ها
grant select, insert, update, delete on media.asset, media.derivative, media.album, media.album_item to pv_app;
grant select on media.asset, media.derivative, media.album, media.album_item to pv_public, pv_reader;
grant select, insert, update on media.asset, media.derivative to pv_worker;
grant select on media.album, media.album_item to pv_worker;

grant select, insert, update, delete on app.content, app.content_block, app.content_category to pv_app;
grant select, insert on app.content_review to pv_app;
grant select on app.content, app.content_block, app.content_review, app.content_category to pv_public, pv_reader;
grant select, update on app.content to pv_worker;
grant select on app.content_block, app.content_review to pv_worker;

grant select on ref.category to pv_app, pv_public, pv_worker, pv_reader;
grant insert, update, delete on ref.category to pv_app, pv_worker;

-- جدول بازبینی، افزودنی است: `update`/`delete` از نقش‌ها گرفته می‌شود تا حتی
-- بدون تریگر هم راهی برای دست‌کاری نباشد.
revoke update, delete on app.content_review from pv_app, pv_worker, pv_reader;

revoke all on function media.asset_is_usable(uuid) from public;
revoke all on function media.recount_assets(uuid) from public;
grant execute on function media.asset_is_usable(uuid) to pv_app, pv_public, pv_worker;
grant execute on function media.recount_assets(uuid) to pv_app, pv_worker;
