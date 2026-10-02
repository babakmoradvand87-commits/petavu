-- ---------------------------------------------------------------------------
-- 0006 — سئو به‌عنوان داده
--
-- مرجع: Addendum §۳۹–۵۵ (مدل دادهٔ سئو، موتور قالب، قصد جست‌وجو، خوشهٔ موضوعی،
--       گراف دانش، دادهٔ ساختاریافته، robots، نقشهٔ سایت، کانونیکال، تغییر مسیر،
--       پیوند داخلی، محتوای یتیم، فرصت محتوایی)، §۱۰۳ (منبع حقیقت).
--
-- چرا سئو یک اسکیماست و نه یک لایهٔ کد:
--
--   اگر قواعد سئو در کد باشند، هر تغییر یک استقرار می‌خواهد و هیچ‌کس نمی‌داند
--   چرا صفحهٔ فلان دسته، ایندکس نمی‌شود. اینجا هر قاعده یک ردیف است: قابل
--   دیدن، قابل مقایسه، قابل بازگردانی، و قابل حسابرسی.
--
--   ولی مرز روشن است (§103): این جدول‌ها **منبع حقیقت قواعد** هستند؛ خودِ
--   رندر عنوان و توضیح، کار موتور سئو در `packages/seo` است.
-- ---------------------------------------------------------------------------

-- ------------------------------------------------------------------ تنظیمات سئو
-- دوسطحی: سراسری پلتفرم (business_id تهی) و کسب‌وکاری.
create table seo.settings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references app.business (id) on delete cascade,
  /** نمایش نام در عنوان: «نام کسب‌وکار | PETAVU» یا برعکس. */
  title_separator text not null default '|' check (length(title_separator) between 1 and 5),
  title_template text not null default '{page} {sep} {site}',
  description_fallback text,
  /** پیشوند نامک عمومی؛ برای کسب‌وکارهایی که مسیر اختصاصی می‌خواهند. */
  slug_prefix text,
  /** نماد سایت و تنظیمات پیش‌فرض اشتراک‌گذاری. */
  logo_asset_id uuid references media.asset (id) on delete set null,
  default_share_asset_id uuid references media.asset (id) on delete set null,
  twitter_handle text,
  /** زبان و منطقهٔ پیش‌فرض؛ برای hreflang و دادهٔ ساختاریافته. */
  default_locale text not null default 'fa-IR',
  default_region text not null default 'IR',
  /** بررسی ایندکس: فعال بودن، ممکن است موقتاً برای محیط غیرتولیدی خاموش شود. */
  indexing_enabled boolean not null default true,
  /** محیط: تولید یا غیرتولیدی؛ robots از همین پیروی می‌کند (Addendum §42). */
  environment text not null default 'production' check (environment in ('production', 'staging', 'development')),
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

comment on table seo.settings is 'تنظیمات سئو، سراسری و کسب‌وکاری؛ مبنا برای robots و قالب عنوان (Addendum §39–42)';

create unique index seo_settings_scope_idx
  on seo.settings (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid));

create trigger seo_settings_touch
  before update on seo.settings
  for each row execute function app.touch();

-- ------------------------------------------------------------------ موتور قالب متادیتا
create table seo.template (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references app.business (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'),
  /** برای کدام نوع موجودیت: business, content, listing, category, business_type, industry, location, search. */
  entity_kind text not null check (entity_kind in (
    'business', 'content', 'listing', 'category', 'business_type', 'industry', 'location', 'search', 'home'
  )),
  /** دامنهٔ دقیق‌تر: مثلاً فقط محتوای نوع `service`. */
  subtype text,
  /** قالب عنوان با متغیرهای `{name}`, `{city}`, `{type}`, `{site}`. */
  title_template text not null check (length(title_template) between 3 and 300),
  description_template text,
  /** قالب نامک؛ برای مسیرهای داینامیک مثل `{type}/{city}/{slug}`. */
  slug_template text,
  /** قالب کانونیکال؛ تهی یعنی خودنویس. */
  canonical_template text,
  /** قالب عنوان و توضیح برای اشتراک‌گذاری اجتماعی. */
  og_title_template text,
  og_description_template text,
  /** اولویت در تخصیص: بزرگ‌تر، مقدم. */
  priority integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

comment on table seo.template is 'قالب عنوان/توضیح/نامک/کانونیکال برای هر نوع موجودیت (Addendum §40)';

create unique index seo_template_scope_key_idx
  on seo.template (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), key);
create index seo_template_lookup_idx on seo.template (entity_kind, subtype, priority desc) where is_active;

create trigger seo_template_touch
  before update on seo.template
  for each row execute function app.touch();

-- ------------------------------------------------------------------ متادیتای موجودیت
-- متادیتای مؤثر هر صفحه. این جدول، **خروجی** موتور است، نه جای ویرایش دستی
-- همه‌چیز: اگر فیلدی تهی باشد، موتور از قالب پر می‌کند. اگر کسی دستی ویرایش
-- کند، `is_manual` روشن می‌شود و موتور آن را بازنویسی نمی‌کند.
create table seo.metadata (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references app.business (id) on delete cascade,
  entity_kind text not null check (entity_kind in (
    'business', 'content', 'listing', 'category', 'business_type', 'industry', 'location', 'search', 'home'
  )),
  entity_id uuid,
  /** کلید یکتای مسیر، برای صفحات بدون موجودیت (مثل جست‌وجو). */
  route_key text,
  locale text not null default 'fa-IR',

  title text check (title is null or length(title) between 3 and 300),
  description text check (description is null or length(description) <= 400),
  canonical_url text,
  /** سرصفحه‌های اضافه: لینک‌های hreflang، prev/next. */
  extra_head jsonb not null default '[]'::jsonb,
  /** تصویر اشتراک‌گذاری و متن جانشین آن. */
  share_asset_id uuid references media.asset (id) on delete set null,
  share_title text,
  share_caption text,

  /* سیاست ایندکس */
  is_indexable boolean not null default true,
  robots_directives text[] not null default '{}',
  /** دلیل غیرقابل‌ایندکس بودن؛ برای بازرسی، نه برای خروجی HTML. */
  non_indexable_reason text check (non_indexable_reason is null or non_indexable_reason in (
    'thin_content', 'duplicate', 'private', 'filtered', 'staging', 'low_quality', 'expired', 'user_choice'
  )),

  is_manual boolean not null default false,
  /** کیفیت: امتیاز ۰..۱۰۰ از موتور بازرسی سئو (Addendum §89). */
  quality_score smallint check (quality_score is null or quality_score between 0 and 100),
  last_audited_at timestamptz,

  /** اثر انگشت محتوای مبنا؛ اگر تغییر نکرد، بازرسی سئو دوباره اجرا نمی‌شود. */
  source_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,

  constraint seo_metadata_target_shape check (entity_id is not null or route_key is not null)
);

comment on table seo.metadata is 'متادیتای سئوی مؤثر هر مسیر؛ خروجی موتور با امکان ویرایش دستی (Addendum §41)';

create unique index seo_metadata_entity_idx
  on seo.metadata (entity_kind, coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(route_key, ''), locale);
create index seo_metadata_business_idx on seo.metadata (business_id, entity_kind) where business_id is not null;
create index seo_metadata_audit_idx on seo.metadata (last_audited_at) where entity_kind in ('business', 'content');
create index seo_metadata_robots_idx on seo.metadata (is_indexable, entity_kind);

create trigger seo_metadata_touch
  before update on seo.metadata
  for each row execute function app.touch();

-- ------------------------------------------------------------------ دادهٔ ساختاریافته
create table seo.structured_data (
  id uuid primary key default gen_random_uuid(),
  entity_kind text not null check (entity_kind in (
    'business', 'content', 'listing', 'category', 'business_type', 'industry', 'location', 'home'
  )),
  entity_id uuid,
  route_key text,
  locale text not null default 'fa-IR',
  /** نوع اسکیما.org: LocalBusiness, Organization, Article, FAQPage, BreadcrumbList, WebSite … */
  schema_type text not null,
  /** نوع دقیق‌تر: VeterinaryCare, PetStore, … */
  subtype text,
  /** پیلود JSON-LD؛ بدون HTML و اسکریپت. */
  payload jsonb not null,
  /** آیا از یک ردیف موجودیت ساخته شده یا دستی؟ */
  source text not null default 'engine' check (source in ('engine', 'manual', 'template')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint structured_data_target_shape check (entity_id is not null or route_key is not null)
);

comment on table seo.structured_data is 'بلوک‌های JSON-LD برای هر مسیر؛ موتور دادهٔ ساختاریافته (Addendum §48–52)';

create unique index structured_data_target_idx
  on seo.structured_data (coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(route_key, ''), schema_type, locale)
  where is_active;
create index structured_data_type_idx on seo.structured_data (schema_type) where is_active;

create trigger structured_data_touch
  before update on seo.structured_data
  for each row execute function app.touch();

-- ------------------------------------------------------------------ کانونیکال
create table seo.canonical (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references app.business (id) on delete cascade,
  /** مسیر داخلی که این قاعده به آن اعمال می‌شود؛ می‌تواند الگو باشد. */
  source_path text not null,
  canonical_path text not null,
  match_kind text not null default 'exact' check (match_kind in ('exact', 'prefix', 'pattern')),
  reason text not null check (reason in ('duplicate', 'filtered', 'pagination', 'locale', 'legacy', 'manual')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint canonical_not_self check (source_path <> canonical_path)
);

comment on table seo.canonical is 'قواعد کانونیکال؛ تصمیم یک‌جا گرفته می‌شود، نه در هر رندر (Addendum §44)';

create unique index canonical_scope_source_idx
  on seo.canonical (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), source_path, match_kind)
  where is_active;

create trigger canonical_touch
  before update on seo.canonical
  for each row execute function app.touch();

-- ------------------------------------------------------------------ تغییر مسیر
create table seo.redirect (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references app.business (id) on delete cascade,
  source_path text not null,
  target_path text,
  status_code smallint not null default 301 check (status_code in (301, 302, 307, 308, 410)),
  /** 410 یعنی «رفته و برنمی‌گردد»؛ `target_path` تهی می‌شود. */
  reason text,
  /** شمارش بازدید، برای تصمیم‌گیری دربارهٔ نگه‌داشتن مسیر. */
  hit_count integer not null default 0 check (hit_count >= 0),
  last_hit_at timestamptz,
  is_active boolean not null default true,
  created_by uuid references auth.app_user (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint redirect_target_shape check (
    (status_code = 410 and target_path is null) or (status_code <> 410 and target_path is not null)
  ),
  constraint redirect_not_self check (target_path is null or source_path <> target_path)
);

comment on table seo.redirect is 'قواعد تغییر مسیر با کد وضعیت درست؛ ۴۱۰ برای محتوای حذف‌شده (Addendum §45)';

create unique index redirect_scope_source_idx
  on seo.redirect (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), source_path)
  where is_active;
create index redirect_target_idx on seo.redirect (target_path) where is_active and target_path is not null;

create trigger redirect_touch
  before update on seo.redirect
  for each row execute function app.touch();

/**
 * تشخیص زنجیره و حلقهٔ تغییر مسیر.
 *
 * بدون این، پس از چند ماه بازآرایی نامک‌ها، زنجیره‌های پنج‌مرحله‌ای می‌سازیم که
 * سرعت خزش را می‌کشند و در بعضی موارد به حلقه می‌رسند. تابع، مسیر را تا انتها
 * دنبال می‌کند و اگر بیش از `p_max_hops` شد یا به خودش برگشت، مشکل را گزارش
 * می‌دهد. سقف بازگشت (۲۵ گام)، محافظ در برابر دادهٔ حلقه‌ای موجود است.
 */
create or replace function seo.redirect_chain_issue(p_source_path text, p_max_hops integer default 5)
returns table (issue text, chain jsonb, final_path text)
language plpgsql
stable
as $$
declare
  v_current text := p_source_path;
  v_next text;
  v_chain text[] := array[p_source_path];
  v_hops integer := 0;
begin
  loop
    v_hops := v_hops + 1;
    if v_hops > 25 then
      return query select 'limit_exceeded'::text, to_jsonb(v_chain), v_current;
      return;
    end if;

    select r.target_path into v_next
    from seo.redirect r
    where r.is_active
      and r.source_path = v_current
      and r.status_code <> 410
    limit 1;

    if v_next is null then
      if v_hops > greatest(1, least(p_max_hops, 10)) then
        return query select 'chain_too_long'::text, to_jsonb(v_chain), v_current;
      end if;
      return;
    end if;

    if v_next = any (v_chain) then
      v_chain := v_chain || v_next;
      return query select 'loop'::text, to_jsonb(v_chain), v_next;
      return;
    end if;

    v_chain := v_chain || v_next;
    v_current := v_next;
  end loop;
end
$$;

comment on function seo.redirect_chain_issue is 'تشخیص زنجیرهٔ بلند و حلقهٔ تغییر مسیر (Addendum §45)';

-- ------------------------------------------------------------------ سایتمپ و ایندکس
create table seo.sitemap (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references app.business (id) on delete cascade,
  /** نام فایل بدون مسیر: `sitemap-businesses`, `sitemap-contents`. */
  name text not null check (name ~ '^[a-z0-9-]{3,80}$'),
  kind text not null check (kind in ('index', 'page', 'business', 'content', 'category', 'type', 'industry', 'location', 'image', 'news', 'custom')),
  scope text not null default 'platform' check (scope in ('platform', 'business')),
  path text not null,
  /** حداکثر ۵۰٬۰۰۰ نشانی یا ۵۰ مگابایت، طبق استاندارد. */
  url_count integer not null default 0 check (url_count between 0 and 50000),
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  last_built_at timestamptz,
  last_submitted_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'building', 'ready', 'failed', 'stale')),
  failure_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

comment on table seo.sitemap is 'وضعیت فایل‌های نقشهٔ سایت، با شمار و اندازه و زمان ساخت (Addendum §43)';

create unique index sitemap_scope_name_idx
  on seo.sitemap (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), name);
create index sitemap_stale_idx on seo.sitemap (updated_at) where status in ('stale', 'failed');

create trigger sitemap_touch
  before update on seo.sitemap
  for each row execute function app.touch();

create table seo.indexing_event (
  id bigserial primary key,
  occurred_at timestamptz not null default now(),
  /** کانال: indexnow, google, bing, manual, api. */
  channel text not null check (channel in ('indexnow', 'google', 'bing', 'yandex', 'manual', 'api', 'sitemap')),
  action text not null check (action in ('submit', 'update', 'delete', 'resubmit', 'ping', 'status')),
  url_count integer not null default 1 check (url_count >= 0),
  status text not null default 'queued' check (status in ('queued', 'sent', 'accepted', 'rejected', 'failed', 'throttled')),
  /** پاسخ ارائه‌دهنده: کد وضعیت و متن کوتاه، بدون داده حساس. */
  response_code integer,
  response_note text,
  request_id text,
  job_id uuid,
  payload jsonb not null default '{}'::jsonb
);

comment on table seo.indexing_event is 'تاریخچهٔ درخواست‌های ایندکس (IndexNow/GSC) با نتیجه (Addendum §46)';

create index indexing_event_time_idx on seo.indexing_event (occurred_at desc);
create index indexing_event_status_idx on seo.indexing_event (status, occurred_at desc) where status in ('queued', 'failed', 'throttled');
create index indexing_event_channel_idx on seo.indexing_event (channel, action, occurred_at desc);

-- ------------------------------------------------------------------ خوشهٔ موضوعی و گراف دانش
create table seo.topic (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references app.business (id) on delete cascade,
  slug text not null,
  title text not null,
  /** قصد جست‌وجو: اطلاعاتی، تجاری، تراکنشی، ناوبری. */
  intent text not null default 'informational'
    check (intent in ('informational', 'commercial', 'transactional', 'navigational', 'local')),
  /** موضوع مرکزی خوشه؛ تهی یعنی خودش مرکز است. */
  parent_id uuid references seo.topic (id) on delete set null,
  cluster_key text,
  /** حجم جست‌وجو و سختی؛ مقادیر تقریبی از ابزار، برای اولویت‌بندی. */
  search_volume integer check (search_volume is null or search_volume >= 0),
  difficulty smallint check (difficulty is null or difficulty between 0 and 100),
  /** موضوع رقیب یا محتوای موجود در فضای وب، برای تحلیل شکاف. */
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

comment on table seo.topic is 'موضوع و خوشهٔ موضوعی با قصد جست‌وجو (Addendum §53)';

create unique index topic_scope_slug_idx
  on seo.topic (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);
create index topic_cluster_idx on seo.topic (cluster_key) where cluster_key is not null;

create trigger topic_touch
  before update on seo.topic
  for each row execute function app.touch();

create table seo.keyword (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references app.business (id) on delete cascade,
  phrase text not null,
  /** کلید نرمال‌شده برای یکتایی و تطبیق (نیم‌فاصله و ارقام یکسان‌شده). */
  phrase_key text not null,
  intent text not null default 'informational'
    check (intent in ('informational', 'commercial', 'transactional', 'navigational', 'local')),
  search_volume integer check (search_volume is null or search_volume >= 0),
  difficulty smallint check (difficulty is null or difficulty between 0 and 100),
  cpc numeric(10, 2),
  /** جایگاه فعلی و بهترین جایگاه ثبت‌شده. */
  current_rank integer check (current_rank is null or current_rank >= 1),
  best_rank integer check (best_rank is null or best_rank >= 1),
  last_checked_at timestamptz,
  source text not null default 'manual' check (source in ('manual', 'gsc', 'research', 'competitor', 'ai')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

comment on table seo.keyword is 'کلیدواژه‌ها با قصد و جایگاه؛ منبع تصمیم محتوایی (Addendum §53–55)';

create unique index keyword_scope_key_idx
  on seo.keyword (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), phrase_key);
create index keyword_rank_idx on seo.keyword (current_rank) where current_rank is not null;

create trigger keyword_touch
  before update on seo.keyword
  for each row execute function app.touch();

create table seo.keyword_link (
  keyword_id uuid not null references seo.keyword (id) on delete cascade,
  entity_kind text not null check (entity_kind in ('business', 'content', 'listing', 'category', 'business_type', 'industry', 'location', 'topic')),
  entity_id uuid not null,
  /** نقش کلیدواژه: اصلی، ثانویه، دنبالهٔ طولانی، برندی. */
  role text not null default 'secondary' check (role in ('primary', 'secondary', 'long_tail', 'brand')),
  /** جایگاه هدف: عنوان، توضیح، متن، alt. */
  target_slot text check (target_slot is null or target_slot in ('title', 'description', 'body', 'alt', 'heading')),
  primary key (keyword_id, entity_kind, entity_id)
);

comment on table seo.keyword_link is 'اتصال کلیدواژه به موجودیت، با نقش و جایگاه هدف (Addendum §54)';

create index keyword_link_entity_idx on seo.keyword_link (entity_kind, entity_id);

-- ------------------------------------------------------------------ گراف موجودیت
create table seo.entity (
  id uuid primary key default gen_random_uuid(),
  /** نوع موجودیت دانشی: brand, business, location, service, product, animal, condition, organization. */
  kind text not null check (kind in (
    'brand', 'business', 'location', 'service', 'product', 'animal', 'condition', 'organization', 'person', 'concept'
  )),
  key text not null check (key ~ '^[a-z0-9][a-z0-9_.-]{1,80}$'),
  name_fa text not null,
  name_en text,
  /** توضیح یک‌خطی، برای دادهٔ ساختاریافته. */
  description text,
  /** موجودیت مرکزی برند PETAVU؛ تنها یک ردیف با این نشان. */
  is_brand_anchor boolean not null default false,
  /** ارجاع به موجودیت دانشی بیرونی: wikidata, schema.org, gmb. */
  external_refs jsonb not null default '{}'::jsonb,
  /** نام‌های معادل و املای جایگزین؛ برای تطبیق در متن. */
  aliases text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

comment on table seo.entity is 'گراف موجودیت‌ها؛ موجودیت برند، لنگر گراف است (Addendum §51)';

create unique index entity_kind_key_idx on seo.entity (kind, key);
create unique index entity_brand_anchor_idx on seo.entity (is_brand_anchor) where is_brand_anchor;
create index entity_aliases_idx on seo.entity using gin (aliases);

create trigger entity_touch
  before update on seo.entity
  for each row execute function app.touch();

create table seo.entity_link (
  id uuid primary key default gen_random_uuid(),
  from_entity_id uuid not null references seo.entity (id) on delete cascade,
  to_entity_id uuid not null references seo.entity (id) on delete cascade,
  relation text not null check (relation in (
    'same_as', 'part_of', 'offers', 'located_in', 'specializes_in', 'treats', 'related_to', 'parent_of', 'brand_of'
  )),
  /** وزن رابطه، برای مرتب‌سازی اهمیت. */
  weight smallint not null default 50 check (weight between 0 and 100),
  created_at timestamptz not null default now(),
  unique (from_entity_id, to_entity_id, relation),
  constraint entity_link_not_self check (from_entity_id <> to_entity_id)
);

comment on table seo.entity_link is 'روابط گراف دانش؛ مبنای پیوند داخلی معنایی (Addendum §51)';

create index entity_link_from_idx on seo.entity_link (from_entity_id, relation);
create index entity_link_to_idx on seo.entity_link (to_entity_id, relation);

/** اتصال موجودیت به کاربر دامنه: کسب‌وکار، محتوا، مکان، نوع. */
create table seo.entity_mention (
  entity_id uuid not null references seo.entity (id) on delete cascade,
  entity_kind text not null check (entity_kind in ('business', 'content', 'listing', 'location', 'business_type', 'industry')),
  entity_ref_id uuid not null,
  /** قوت ارجاع: اصلی (موضوع صفحه) یا اشاره. */
  strength text not null default 'mention' check (strength in ('primary', 'mention')),
  primary key (entity_id, entity_kind, entity_ref_id)
);

comment on table seo.entity_mention is 'اتصال موجودیت‌های دانشی به رکوردهای دامنه (Addendum §51)';

create index entity_mention_ref_idx on seo.entity_mention (entity_kind, entity_ref_id, strength);

-- ------------------------------------------------------------------ پیوند داخلی و یتیم
create table seo.internal_link (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references app.business (id) on delete cascade,
  source_path text not null,
  target_path text not null,
  /** متن لنگر و کلیدواژهٔ هدف. */
  anchor_text text,
  keyword_id uuid references seo.keyword (id) on delete set null,
  link_kind text not null default 'editorial' check (link_kind in ('editorial', 'navigation', 'breadcrumb', 'related', 'cta', 'footer', 'hub')),
  /** آیا پیوند به‌طور خودکار پیشنهاد شده یا دستی درج شده. */
  source text not null default 'manual' check (source in ('manual', 'auto', 'suggested')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint internal_link_not_self check (source_path <> target_path)
);

comment on table seo.internal_link is 'نگاشت پیوند داخلی، برای کشف یتیم و تقویت خوشهٔ موضوعی (Addendum §47)';

create index internal_link_source_idx on seo.internal_link (source_path) where is_active;
create index internal_link_target_idx on seo.internal_link (target_path) where is_active;

create trigger internal_link_touch
  before update on seo.internal_link
  for each row execute function app.touch();

-- ------------------------------------------------------------------ بازرسی سئو
create table seo.audit (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references app.business (id) on delete cascade,
  /** محیط اجرا و دامنهٔ بازرسی. */
  target_path text,
  run_kind text not null default 'on_demand' check (run_kind in ('scheduled', 'on_demand', 'on_publish', 'manual')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  /** شمار یافته‌ها به تفکیک شدت. */
  blocker_count integer not null default 0,
  error_count integer not null default 0,
  warning_count integer not null default 0,
  info_count integer not null default 0,
  /** امتیاز کلی سلامت سئو. */
  score smallint check (score is null or score between 0 and 100),
  triggered_by uuid references auth.app_user (id) on delete set null,
  job_id uuid,
  summary jsonb not null default '{}'::jsonb
);

comment on table seo.audit is 'اجرای بازرسی سئو، با شمار یافته‌ها و امتیاز (Addendum §89)';

create index seo_audit_time_idx on seo.audit (started_at desc);
create index seo_audit_business_idx on seo.audit (business_id, started_at desc) where business_id is not null;

create table seo.audit_finding (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references seo.audit (id) on delete cascade,
  rule_key text not null,
  severity text not null check (severity in ('blocker', 'error', 'warning', 'info')),
  path text,
  message text not null,
  /** راهنمای اصلاح؛ پیام بدون راه‌حل، فقط شکایت است. */
  remediation text,
  details jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  resolved_by uuid references auth.app_user (id) on delete set null
);

comment on table seo.audit_finding is 'یافته‌های بازرسی سئو، با راهنمای اصلاح و وضعیت رفع (Addendum §89)';

create index seo_audit_finding_audit_idx on seo.audit_finding (audit_id, severity);
create index seo_audit_finding_open_idx on seo.audit_finding (rule_key, severity) where resolved_at is null;

-- ------------------------------------------------------------------ فرصت محتوایی
create table seo.content_opportunity (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references app.business (id) on delete cascade,
  kind text not null check (kind in (
    'keyword_gap', 'thin_content', 'orphan_page', 'missing_page', 'decaying_rank',
    'cannibalization', 'broken_link', 'slow_page', 'missing_schema', 'duplicate'
  )),
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high', 'critical')),
  title text not null,
  description text,
  /** موجودیت مرتبط، در صورت وجود. */
  entity_kind text check (entity_kind is null or entity_kind in ('business', 'content', 'listing', 'category', 'business_type', 'industry', 'location')),
  entity_id uuid,
  path text,
  /** امتیاز اولویت: ترکیب تأثیر و تلاش. */
  priority smallint not null default 50 check (priority between 0 and 100),
  /** دادهٔ پشتیبان: حجم جست‌وجو، افت جایگاه، شمار پیوند ورودی. */
  evidence jsonb not null default '{}'::jsonb,
  /** پیشنهاد اقدام، به‌صورت متن ساختاریافته. */
  suggested_action jsonb not null default '{}'::jsonb,
  status text not null default 'open'
    check (status in ('open', 'planned', 'in_progress', 'done', 'dismissed', 'expired')),
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  assigned_to uuid references auth.app_user (id) on delete set null,
  version integer not null default 1
);

comment on table seo.content_opportunity is 'فرصت‌های محتوایی کشف‌شده با شواهد و پیشنهاد اقدام (Addendum §50، §55)';

create index content_opportunity_open_idx on seo.content_opportunity (status, priority desc, detected_at desc) where status = 'open';
create index content_opportunity_business_idx on seo.content_opportunity (business_id, status) where business_id is not null;
create index content_opportunity_kind_idx on seo.content_opportunity (kind, status);

-- ------------------------------------------------------------------ توابع سئو
/**
 * انتخاب قالب متناظر با یک موجودیت.
 * ترتیب: خاص‌ترین الگو برنده است (نوع دقیق، بعد دامنهٔ کسب‌وکار، بعد سراسری).
 */
create or replace function seo.pick_template(p_entity_kind text, p_subtype text, p_business_id uuid)
returns seo.template
language sql
stable
as $$
  select t.*
  from seo.template t
  where t.is_active
    and t.entity_kind = p_entity_kind
    and (t.subtype is null or t.subtype is not distinct from p_subtype)
    and (t.business_id is null or t.business_id = p_business_id)
  order by
    (t.business_id is not null) desc,     -- قالب اختصاصی کسب‌وکار مقدم است
    (t.subtype is not null) desc,          -- نوع دقیق مقدم بر عمومی است
    t.priority desc,
    t.key
  limit 1
$$;

comment on function seo.pick_template is 'انتخاب خاص‌ترین قالب متادیتا برای یک موجودیت (Addendum §40)';

/**
 * نزدیک‌ترین قاعدهٔ تغییر مسیر برای یک مسیر.
 *
 * ترتیب تطبیق: تطبیق دقیق، سپس پیشوندی (بلندترین پیشوند مقدم). تطبیق الگویی
 * عمداً در SQL نیست؛ آن کار موتور در `packages/seo` است که الگو را می‌فهمد.
 * انتخاب «بلندترین پیشوند»، از سایه‌افتادن قاعدهٔ اختصاصی زیر قاعدهٔ عمومی
 * جلوگیری می‌کند.
 */
create or replace function seo.match_redirect(p_path text, p_business_id uuid default null)
returns table (id uuid, target_path text, status_code smallint)
language sql
stable
as $$
  select r.id, r.target_path, r.status_code
  from seo.redirect r
  where r.is_active
    and (r.business_id is null or r.business_id = p_business_id)
    and (
      r.source_path = p_path
      or (
        r.source_path like '/%'
        and r.source_path not like '%*%'
        and p_path like r.source_path || '/%'
      )
    )
  order by length(r.source_path) desc
  limit 1
$$;

comment on function seo.match_redirect is 'نزدیک‌ترین تغییر مسیر فعال برای یک مسیر؛ بلندترین پیشوند مقدم است (Addendum §45)';

/**
 * یافتن صفحات یتیم: مسیرهایی که هیچ پیوند داخلی به آن‌ها نمی‌رسد.
 * Addendum §47 می‌گوید صفحهٔ یتیم، بودجهٔ خزش را هدر می‌دهد.
 */
create or replace function seo.find_orphans(p_business_id uuid default null, p_limit integer default 100)
returns table (path text, kind text)
language sql
stable
as $$
  with published as (
    select
      '/b/' || b.slug as path,
      'business'::text as kind
    from app.business b
    where b.status = 'active' and b.visibility = 'public' and b.deleted_at is null
      and (p_business_id is null or b.id = p_business_id)

    union all

    select
      case when c.business_id is null then '/p/' else '/c/' end || c.slug as path,
      'content'::text as kind
    from app.content c
    where c.status = 'published' and c.visibility = 'public' and c.deleted_at is null
      and (p_business_id is null or c.business_id = p_business_id)
  )
  select p.path, p.kind
  from published p
  where not exists (
    select 1 from seo.internal_link l
    where l.is_active and l.target_path = p.path
  )
  and not exists (
    select 1 from seo.metadata m
    where m.route_key = p.path and m.is_indexable = false
  )
  limit greatest(1, least(p_limit, 1000))
$$;

comment on function seo.find_orphans is 'کشف صفحات یتیم از راه نگاشت پیوند داخلی (Addendum §47)';

-- ------------------------------------------------------------------ RLS
alter table seo.settings enable row level security;
alter table seo.template enable row level security;
alter table seo.metadata enable row level security;
alter table seo.structured_data enable row level security;
alter table seo.canonical enable row level security;
alter table seo.redirect enable row level security;
alter table seo.sitemap enable row level security;
alter table seo.indexing_event enable row level security;
alter table seo.topic enable row level security;
alter table seo.keyword enable row level security;
alter table seo.keyword_link enable row level security;
alter table seo.entity enable row level security;
alter table seo.entity_link enable row level security;
alter table seo.entity_mention enable row level security;
alter table seo.internal_link enable row level security;
alter table seo.audit enable row level security;
alter table seo.audit_finding enable row level security;
alter table seo.content_opportunity enable row level security;

-- تنظیمات، قالب‌ها، کانونیکال، تغییر مسیر: خواندن آزاد (رندر لازم دارد)،
-- نوشتن با مجوز سئو.
create policy seo_settings_read on seo.settings
  for select to pv_app, pv_public, pv_worker, pv_reader using (true);
create policy seo_settings_write on seo.settings
  for all to pv_app, pv_worker
  using ((business_id is not null and app.has_permission(business_id, 'seo.manage')) or app.current_platform_role() is not null)
  with check ((business_id is not null and app.has_permission(business_id, 'seo.manage')) or app.current_platform_role() is not null);

create policy seo_template_read on seo.template
  for select to pv_app, pv_public, pv_worker, pv_reader using (true);
create policy seo_template_write on seo.template
  for all to pv_app, pv_worker
  using ((business_id is not null and app.has_permission(business_id, 'seo.manage')) or app.current_platform_role() is not null)
  with check ((business_id is not null and app.has_permission(business_id, 'seo.manage')) or app.current_platform_role() is not null);

create policy canonical_read on seo.canonical
  for select to pv_app, pv_public, pv_worker, pv_reader using (true);
create policy canonical_write on seo.canonical
  for all to pv_app, pv_worker
  using ((business_id is not null and app.has_permission(business_id, 'seo.manage')) or app.current_platform_role() is not null)
  with check ((business_id is not null and app.has_permission(business_id, 'seo.manage')) or app.current_platform_role() is not null);

create policy redirect_read on seo.redirect
  for select to pv_app, pv_public, pv_worker, pv_reader using (true);
create policy redirect_write on seo.redirect
  for all to pv_app, pv_worker
  using ((business_id is not null and app.has_permission(business_id, 'seo.redirect.manage')) or app.current_platform_role() is not null)
  with check ((business_id is not null and app.has_permission(business_id, 'seo.redirect.manage')) or app.current_platform_role() is not null);

-- متادیتا: نوشتن با مجوز سئو؛ خواندن برای رندر.
create policy seo_metadata_read on seo.metadata
  for select to pv_app, pv_public, pv_worker, pv_reader using (true);
create policy seo_metadata_write on seo.metadata
  for all to pv_app, pv_worker
  using ((business_id is not null and app.has_permission(business_id, 'seo.manage')) or app.current_platform_role() is not null)
  with check ((business_id is not null and app.has_permission(business_id, 'seo.manage')) or app.current_platform_role() is not null);

create policy structured_data_read on seo.structured_data
  for select to pv_app, pv_public, pv_worker, pv_reader using (true);
create policy structured_data_write on seo.structured_data
  for all to pv_app, pv_worker
  using (app.current_platform_role() is not null)
  with check (app.current_platform_role() is not null);

create policy sitemap_read on seo.sitemap
  for select to pv_app, pv_public, pv_worker, pv_reader using (true);
create policy sitemap_write on seo.sitemap
  for all to pv_app, pv_worker
  using (business_id is null or app.has_permission(business_id, 'seo.manage') or app.current_platform_role() is not null)
  with check (business_id is null or app.has_permission(business_id, 'seo.manage') or app.current_platform_role() is not null);

create policy indexing_event_insert on seo.indexing_event
  for insert to pv_app, pv_worker with check (true);
create policy indexing_event_read on seo.indexing_event
  for select to pv_app, pv_worker, pv_reader using (app.current_platform_role() is not null or true);

-- موضوع، کلیدواژه، موجودیت: دادهٔ برنامه‌ریزی محتوا؛ کسب‌وکاری یا پلتفرمی.
create policy topic_read on seo.topic
  for select to pv_app, pv_reader
  using (business_id is null or app.is_member_of(business_id) or app.current_platform_role() is not null);
create policy topic_write on seo.topic
  for all to pv_app
  using ((business_id is not null and app.has_permission(business_id, 'seo.manage')) or app.current_platform_role() is not null)
  with check ((business_id is not null and app.has_permission(business_id, 'seo.manage')) or app.current_platform_role() is not null);

create policy keyword_read on seo.keyword
  for select to pv_app, pv_reader
  using (business_id is null or app.is_member_of(business_id) or app.current_platform_role() is not null);
create policy keyword_write on seo.keyword
  for all to pv_app
  using ((business_id is not null and app.has_permission(business_id, 'seo.manage')) or app.current_platform_role() is not null)
  with check ((business_id is not null and app.has_permission(business_id, 'seo.manage')) or app.current_platform_role() is not null);

create policy keyword_link_read on seo.keyword_link
  for select to pv_app, pv_reader using (true);
create policy keyword_link_write on seo.keyword_link
  for all to pv_app
  using (exists (select 1 from seo.keyword k where k.id = keyword_id
    and ((k.business_id is not null and app.has_permission(k.business_id, 'seo.manage')) or app.current_platform_role() is not null)))
  with check (exists (select 1 from seo.keyword k where k.id = keyword_id
    and ((k.business_id is not null and app.has_permission(k.business_id, 'seo.manage')) or app.current_platform_role() is not null)));

-- گراف موجودیت و روابطش: دانش مشترک پلتفرم؛ خواندن آزاد، نوشتن پلتفرمی.
create policy entity_read on seo.entity
  for select to pv_app, pv_public, pv_worker, pv_reader using (true);
create policy entity_write on seo.entity
  for all to pv_app, pv_worker
  using (app.current_platform_role() is not null)
  with check (app.current_platform_role() is not null);

create policy entity_link_read on seo.entity_link
  for select to pv_app, pv_public, pv_worker, pv_reader using (true);
create policy entity_link_write on seo.entity_link
  for all to pv_app, pv_worker
  using (app.current_platform_role() is not null)
  with check (app.current_platform_role() is not null);

create policy entity_mention_read on seo.entity_mention
  for select to pv_app, pv_public, pv_worker, pv_reader using (true);
create policy entity_mention_write on seo.entity_mention
  for all to pv_app, pv_worker
  using (app.current_platform_role() is not null or app.is_member_of(
    case when entity_kind = 'business' then entity_ref_id else null end
  ))
  with check (app.current_platform_role() is not null or app.is_member_of(
    case when entity_kind = 'business' then entity_ref_id else null end
  ));

create policy internal_link_read on seo.internal_link
  for select to pv_app, pv_public, pv_worker, pv_reader using (true);
create policy internal_link_write on seo.internal_link
  for all to pv_app, pv_worker
  using ((business_id is not null and app.has_permission(business_id, 'seo.manage')) or app.current_platform_role() is not null)
  with check ((business_id is not null and app.has_permission(business_id, 'seo.manage')) or app.current_platform_role() is not null);

create policy seo_audit_read on seo.audit
  for select to pv_app, pv_worker, pv_reader
  using (business_id is null or app.is_member_of(business_id) or app.current_platform_role() is not null);
create policy seo_audit_write on seo.audit
  for all to pv_app, pv_worker
  using (app.current_platform_role() is not null or (business_id is not null and app.has_permission(business_id, 'seo.audit.run')))
  with check (app.current_platform_role() is not null or (business_id is not null and app.has_permission(business_id, 'seo.audit.run')));

create policy seo_audit_finding_read on seo.audit_finding
  for select to pv_app, pv_worker, pv_reader using (true);
create policy seo_audit_finding_write on seo.audit_finding
  for all to pv_app, pv_worker
  using (exists (select 1 from seo.audit a where a.id = audit_id
    and (a.business_id is null or app.is_member_of(a.business_id) or app.current_platform_role() is not null)))
  with check (exists (select 1 from seo.audit a where a.id = audit_id
    and (a.business_id is null or app.is_member_of(a.business_id) or app.current_platform_role() is not null)));

create policy opportunity_read on seo.content_opportunity
  for select to pv_app, pv_worker, pv_reader
  using (business_id is null or app.is_member_of(business_id) or app.current_platform_role() is not null);
create policy opportunity_write on seo.content_opportunity
  for all to pv_app, pv_worker
  using ((business_id is not null and (app.is_member_of(business_id) or app.current_platform_role() is not null)) or app.current_platform_role() is not null)
  with check ((business_id is not null and (app.is_member_of(business_id) or app.current_platform_role() is not null)) or app.current_platform_role() is not null);

-- ------------------------------------------------------------------ گرنت‌ها
grant select on seo.settings, seo.template, seo.metadata, seo.structured_data, seo.canonical, seo.redirect,
  seo.sitemap, seo.internal_link, seo.entity, seo.entity_link, seo.entity_mention, seo.topic, seo.keyword, seo.keyword_link
  to pv_app, pv_worker, pv_reader;
grant select on seo.settings, seo.template, seo.metadata, seo.structured_data, seo.canonical, seo.redirect, seo.sitemap
  to pv_public;

grant insert, update, delete on seo.settings, seo.template, seo.metadata, seo.structured_data, seo.canonical,
  seo.redirect, seo.sitemap, seo.internal_link, seo.entity, seo.entity_link, seo.entity_mention, seo.topic,
  seo.keyword, seo.keyword_link to pv_app, pv_worker;
grant update on seo.redirect to pv_public;

grant select, insert on seo.indexing_event to pv_app, pv_worker;
grant select on seo.indexing_event to pv_reader;
grant select, insert, update on seo.audit, seo.audit_finding, seo.content_opportunity to pv_app, pv_worker;
grant select on seo.audit, seo.audit_finding, seo.content_opportunity to pv_reader;

revoke all on function seo.pick_template(text, text, uuid) from public;
revoke all on function seo.match_redirect(text, uuid) from public;
revoke all on function seo.find_orphans(uuid, integer) from public;
revoke all on function seo.redirect_chain_issue(text, integer) from public;
grant execute on function seo.pick_template(text, text, uuid) to pv_app, pv_worker;
grant execute on function seo.match_redirect(text, uuid) to pv_app, pv_public, pv_worker;
grant execute on function seo.find_orphans(uuid, integer) to pv_app, pv_worker;
grant execute on function seo.redirect_chain_issue(text, integer) to pv_app, pv_worker;
