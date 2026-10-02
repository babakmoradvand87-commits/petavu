-- ---------------------------------------------------------------------------
-- 0005 — طراحی (Design Studio)
--
-- مرجع: §32–§44 (توکن، تم، نسخه، انتشار، بازگردانی)، §161–§169 (Registry
--       کامپوننت و درخت JSON)، Addendum §۹۶–۱۰۰ (خط لولهٔ انتشار).
--
-- چهار تصمیم که این اسکیما را از یک «جدول تنظیمات ظاهری» جدا می‌کند:
--
--   ۱. **توکن، رکورد است نه فایل.** رنگ، فاصله، شعاع، سایه، تایپوگرافی —
--      همه ردیف دارند. نتیجه: بازبینی، مقایسه، بازگردانی و حسابرسی ممکن است.
--
--   ۲. **صفحه، درخت JSON است نه HTML.** هر گره، نام یک کامپوننت ثبت‌شده و
--      پراپ‌هایش است. پس نه JS، نه SQL و نه HTML خام از کاربر اجرا می‌شود
--      (§43، §74، Addendum §۷۳–۸۰). رندر، کار سرور است.
--
--   ۳. **مرجع یکتای انتشار.** `design.release` یک تصویر کامل و تغییرناپذیر از
--      توکن‌ها + تم + صفحه‌های منتشرشده است. بازگردانی، برگشتن به همین بسته است
--      — نه اجرای معکوس تغییرات (که همیشه کامل نیست).
--
--   ۴. **پیش‌نویس و منتشرشده، دو ردیف.** ویرایش هرگز مستقیم روی چیزی که
--      کاربران می‌بینند نمی‌نشیند. این تفاوت، همان چیزی است که بین «سایت
--      نیمه‌خراب» و «انتشار کنترل‌شده» فاصله می‌اندازد (§36).
-- ---------------------------------------------------------------------------

-- ------------------------------------------------------------------ توکن‌ها
create table design.token (
  id uuid primary key default gen_random_uuid(),
  /** دامنهٔ کاربرد: سراسری پلتفرم یا یک کسب‌وکار مشخص. */
  business_id uuid references app.business (id) on delete cascade,
  /** گروه توکن: color, spacing, radius, shadow, typography, motion, breakpoint, z. */
  group_key text not null check (group_key in (
    'color', 'spacing', 'radius', 'shadow', 'typography', 'motion', 'breakpoint', 'z', 'border', 'opacity'
  )),
  /** نام توکن، نقطه‌دار: `color.primary`, `space.4`, `radius.md`. */
  key text not null check (key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'),
  /** مقدار: رشته، عدد یا شیء ساختاریافته (مثلاً سایه با چند لایه). */
  value jsonb not null,
  /** نوع مقدار، برای اعتبارسنجی و ویرایشگر: color, length, number, shadow, font, duration, cubic. */
  value_type text not null check (value_type in ('color', 'length', 'number', 'shadow', 'font', 'duration', 'cubic', 'list')),
  /** توکن معنایی: `color.text.muted` به `color.neutral.600` اشاره می‌کند. */
  alias_of text,
  description text,
  /** حالت‌های تم: روشن (light)، تاریک (dark)، پرکنتراست. */
  theme_mode text not null default 'light' check (theme_mode in ('light', 'dark', 'high_contrast')),
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint token_alias_shape check (alias_of is null or alias_of ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$')
);

comment on table design.token is 'توکن طراحی؛ منبع حقیقت ظاهر، به‌صورت داده و قابل بازگردانی (§33، §161)';

create unique index token_scope_key_idx
  on design.token (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), group_key, key, theme_mode);
create index token_business_idx on design.token (business_id) where business_id is not null;

create trigger token_touch
  before update on design.token
  for each row execute function app.touch();

-- ------------------------------------------------------------------ تم
-- تم = بستهٔ نام‌دار از توکن‌ها + تنظیمات تایپوگرافی و چیدمان.
create table design.theme (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references app.business (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_-]{1,48}$'),
  name_fa text not null,
  description text,
  /** تنظیمات پایه: نوع فونت، مقیاس تایپوگرافی، اندازهٔ شعاع پایه، ریتم فاصله. */
  settings jsonb not null default '{}'::jsonb,
  /** تم پیش‌فرض پلتفرم یا کسب‌وکار. */
  is_default boolean not null default false,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

comment on table design.theme is 'بستهٔ توکن‌ها و تنظیمات ظاهری؛ مبنای پنجرهٔ پیش‌نمایش و انتشار (§33)';

create unique index theme_scope_key_idx
  on design.theme (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), key);
create unique index theme_default_idx
  on design.theme (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid)) where is_default;

create trigger theme_touch
  before update on design.theme
  for each row execute function app.touch();

create table design.theme_token (
  theme_id uuid not null references design.theme (id) on delete cascade,
  token_key text not null,
  value jsonb not null,
  theme_mode text not null default 'light' check (theme_mode in ('light', 'dark', 'high_contrast')),
  primary key (theme_id, token_key, theme_mode)
);

comment on table design.theme_token is 'مقادیر توکن در یک تم؛ لایهٔ بازنویسی روی توکن‌های پایه';

-- ------------------------------------------------------------------ Registry کامپوننت
/**
 * Registry کامپوننت‌ها: فهرست بستهٔ آنچه می‌توان در صفحه به کار برد.
 *
 * §43 و Addendum §۹۶ می‌گویند هیچ‌چیز خارج از این فهرست قابل استفاده نیست.
 * چرا این یک جدول است و نه یک آرایه در کد: چون پنل مدیریت باید بتواند
 * کامپوننت را «بازنشسته» کند و بداند کدام صفحه‌ها از آن استفاده می‌کنند —
 * پیش از حذف. این همان Dependency Graph در Addendum §۲۴ است.
 */
create table design.component (
  key text primary key check (key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'),
  name_fa text not null,
  description text,
  category text not null check (category in (
    'layout', 'content', 'media', 'navigation', 'data', 'form', 'commerce', 'social', 'utility'
  )),
  /** نسخهٔ طرح کامپوننت؛ تغییر ساختار پراپ‌ها، نسخه را جلو می‌برد. */
  schema_version integer not null default 1,
  /** طرح پراپ‌ها: `{key: {type, required, default, enum, min, max, pattern}}`. */
  props_schema jsonb not null default '{}'::jsonb,
  /** کدام اسلات‌ها فرزند می‌پذیرند و چند تا. */
  slots jsonb not null default '{}'::jsonb,
  /** پیش‌فرض‌های دسترس‌پذیری: نقش، برچسب لازم، ترتیب فوکوس. */
  a11y jsonb not null default '{}'::jsonb,
  /** فرادادهٔ سئو: آیا این کامپوننت به ساختار عنوان یا دادهٔ ساختاریافته کمک می‌کند. */
  seo jsonb not null default '{}'::jsonb,
  /** بودجهٔ عملکرد: وزن تقریبی، آیا محتوای LCP تولید می‌کند. */
  performance jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'deprecated', 'removed')),
  since_release text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

comment on table design.component is 'Registry کامپوننت‌ها؛ فهرست بستهٔ عناصر مجاز در صفحه (§43، §161)';

create index component_category_idx on design.component (category, status);

create trigger component_touch
  before update on design.component
  for each row execute function app.touch();

-- ------------------------------------------------------------------ صفحه
create table design.page (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references app.business (id) on delete cascade,
  /** کلید یکتا در محدودهٔ خود: `home`, `about`, `contact`, `booking`. */
  key text not null check (key ~ '^[a-z][a-z0-9_-]{1,60}$'),
  title text not null,
  description text,
  /** نوع صفحه: سراسری پلتفرم (قالب) یا مختص یک کسب‌وکار. */
  scope text not null default 'business' check (scope in ('platform', 'business')),
  /** قالب صفحه‌ای که این صفحه از آن ساخته شده. */
  template_key text,
  is_system boolean not null default false,

  /* دو درخت: پیش‌نویس و منتشرشده (§36) */
  draft_tree jsonb not null default '{"version":1,"root":[]}'::jsonb,
  draft_updated_at timestamptz,
  draft_updated_by uuid references auth.app_user (id) on delete set null,
  draft_revision integer not null default 0,

  published_tree jsonb,
  published_at timestamptz,
  published_by uuid references auth.app_user (id) on delete set null,
  published_release_id uuid,

  status text not null default 'draft'
    check (status in ('draft', 'in_review', 'approved', 'published', 'unpublished', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint page_scope_shape check ((scope = 'platform') = (business_id is null)),
  constraint page_publish_shape check ((status = 'published') = (published_tree is not null))
);

comment on table design.page is 'صفحهٔ ساخته‌شده از درخت JSON؛ پیش‌نویس و منتشرشده جدا (§32–36)';

create unique index page_scope_key_idx
  on design.page (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), key);
create index page_business_idx on design.page (business_id, status) where business_id is not null;
create index page_status_idx on design.page (scope, status);

create trigger page_touch
  before update on design.page
  for each row execute function app.touch();

-- ------------------------------------------------------------------ نسخه‌های صفحه
-- تاریخچهٔ کامل: هر ذخیره، یک ردیف. این همان چیزی است که «مقایسه» و
-- «بازگردانی» را ممکن می‌کند (§37، §164).
create table design.page_revision (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references design.page (id) on delete cascade,
  revision integer not null check (revision > 0),
  tree jsonb not null,
  /** خلاصهٔ تغییر، برای فهرست تاریخچه. */
  change_summary text,
  created_by uuid references auth.app_user (id) on delete set null,
  created_at timestamptz not null default now(),
  /** امضای محتوایی درخت؛ تشخیص «تغییر بی‌اثر» و حذف تکرار. */
  tree_hash text not null,
  unique (page_id, revision)
);

comment on table design.page_revision is 'تاریخچهٔ نسخه‌های صفحه؛ مبنای مقایسه و بازگردانی (§37)';

-- تاریخچه، سابقه است: هیچ نسخه‌ای ویرایش یا حذف نمی‌شود (§37).
create trigger page_revision_append_only
  before update or delete on design.page_revision
  for each row execute function app.forbid_mutation();

-- ایندکس مستأجر: بدون این، هر کوئری تم/بازرسی، پیمایش کامل با اجرای RLS روی
-- هر ردیف است (Addendum §79–۸۰). ایندکس `design.token` از پیش در همین فایل هست.
create index theme_business_idx on design.theme (business_id);
create index page_revision_page_idx on design.page_revision (page_id, revision desc);
create index page_revision_hash_idx on design.page_revision (page_id, tree_hash);

-- ------------------------------------------------------------------ انتشار
create table design.release (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references app.business (id) on delete cascade,
  version integer not null check (version > 0),
  /** بستهٔ کامل: توکن‌ها، تم، صفحه‌ها، تنظیمات سئو. تغییرناپذیر. */
  bundle jsonb not null,
  bundle_hash text not null,
  /** امضای سلامت: نتیجهٔ بازرسی‌های پیش از انتشار (§38، Addendum §۹۶). */
  validation_report jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'validating', 'approved', 'published', 'failed', 'rolled_back', 'superseded')),
  scope text not null default 'business' check (scope in ('platform', 'business')),

  created_by uuid references auth.app_user (id) on delete set null,
  created_at timestamptz not null default now(),
  validated_at timestamptz,
  approved_by uuid references auth.app_user (id) on delete set null,
  approved_at timestamptz,
  published_at timestamptz,
  rolled_back_at timestamptz,
  failure_note text,

  /** انتشار جاری این محدوده. */
  is_current boolean not null default false,
  constraint release_scope_shape check ((scope = 'platform') = (business_id is null)),
  constraint release_publish_shape check ((status in ('published', 'rolled_back', 'superseded')) = (published_at is not null) or status in ('pending', 'validating', 'approved', 'failed'))
);

comment on table design.release is 'بستهٔ انتشار تغییرناپذیر؛ بازگردانی به همین بسته برمی‌گردد، نه با اجرای معکوس (§38)';

create unique index release_scope_version_idx
  on design.release (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), version);
create unique index release_current_idx
  on design.release (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid)) where is_current;
create index release_business_idx on design.release (business_id, created_at desc);

-- بستهٔ انتشار، ستون `version` دارد؛ پس ماشهٔ نسخه لازم دارد (§58).
create trigger release_touch
  before update on design.release
  for each row execute function app.touch();

-- انتشار، سابقه است: نامهٔ تغییر آن قابل ویرایش نیست.
create trigger release_append_only
  before delete on design.release
  for each row execute function app.forbid_mutation();

-- ------------------------------------------------------------------ بازرسی طراحی
create table design.audit (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references app.business (id) on delete cascade,
  page_id uuid references design.page (id) on delete cascade,
  release_id uuid references design.release (id) on delete set null,
  check_kind text not null check (check_kind in (
    'structure', 'a11y', 'performance', 'seo', 'security', 'token_usage', 'component_registry', 'link', 'contrast'
  )),
  severity text not null check (severity in ('blocker', 'error', 'warning', 'info')),
  rule_key text not null,
  message text not null,
  path text,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  resolved_at timestamptz
);

comment on table design.audit is 'یافته‌های بازرسی طراحی؛ سنگین‌تر از اطلاعات، جلوی انتشار را می‌گیرد (§40)';

create index design_audit_page_idx on design.audit (page_id, severity, occurred_at desc);
create index design_audit_open_idx on design.audit (severity, occurred_at desc) where resolved_at is null;
create index design_audit_release_idx on design.audit (release_id) where release_id is not null;
create index design_audit_business_idx on design.audit (business_id, occurred_at desc);

-- ------------------------------------------------------------------ پیش‌نمایش
create table design.preview_link (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references design.page (id) on delete cascade,
  token_hash text not null check (length(token_hash) >= 32),
  /** مخاطب: خودی (تیم) یا مشتری/کارفرما. */
  audience text not null default 'internal' check (audience in ('internal', 'external')),
  created_by uuid references auth.app_user (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  view_count integer not null default 0 check (view_count >= 0),
  last_viewed_at timestamptz
);

comment on table design.preview_link is 'پیوند پیش‌نمایش با انقضا و ابطال؛ پیش‌نمایش عمومی نیست (§36)';

create unique index preview_link_token_idx on design.preview_link (token_hash);
create index preview_link_page_idx on design.preview_link (page_id, created_at desc);

-- ------------------------------------------------------------------ قالب صفحه
create table design.page_template (
  key text primary key check (key ~ '^[a-z][a-z0-9_-]{1,60}$'),
  name_fa text not null,
  description text,
  /** برای چه نوع کسب‌وکاری مناسب است؛ [] یعنی همه. */
  business_type_keys text[] not null default '{}',
  /** صفحاتی که در ساخت کسب‌وکار تازه به‌طور پیش‌فرض ساخته می‌شوند. */
  page_keys text[] not null default '{}',
  tree jsonb not null default '{"version":1,"root":[]}'::jsonb,
  thumbnail_asset_id uuid references media.asset (id) on delete set null,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

comment on table design.page_template is 'قالب صفحات پیش‌فرض، آگاه به نوع کسب‌وکار (§19، §34)';

create trigger page_template_touch
  before update on design.page_template
  for each row execute function app.touch();

-- ------------------------------------------------------------------ اعتبارسنجی درخت
/**
 * بازرسی ساختاری درخت صفحه.
 *
 * این تابع، «دروازهٔ» خط لولهٔ انتشار است (§38، Addendum §۹۶). سه چیز را
 * می‌سنجد و هیچ‌کدام به کد رندر وابسته نیست:
 *
 *   ۱. هر گره، کلید یک کامپوننت **ثبت‌شده و فعال** باشد.
 *   ۲. اسلات‌های مورد استفاده، در طرح کامپوننت تعریف شده باشند.
 *   ۳. پراپ‌های الزامی، حاضر باشند.
 *
 * خروجی: فهرست یافته‌ها. خالی‌بودن فهرست، یعنی عبور.
 */
create or replace function design.validate_tree(p_tree jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, design
as $$
declare
  v_findings jsonb := '[]'::jsonb;
  v_node jsonb;
  v_component design.component;
  v_props jsonb;
  v_required text;
begin
  /*
   * `is distinct from` اینجا حیاتی است: `jsonb_typeof(null)` مقدار `null` می‌دهد
   * و `null <> 'array'` هم `null` است، نه `true`؛ پس با عملگر `<>` درختِ بدون
   * ریشه از بازرسی رد می‌شد و «بی‌ریشه» سالم به نظر می‌رسید.
   */
  if jsonb_typeof(p_tree) is distinct from 'object' then
    return jsonb_build_array(jsonb_build_object(
      'rule', 'structure.tree_invalid',
      'severity', 'blocker',
      'message', 'درخت صفحه باید یک شیء JSON باشد.'
    ));
  end if;

  if jsonb_typeof(p_tree -> 'root') is distinct from 'array' then
    return jsonb_build_array(jsonb_build_object(
      'rule', 'structure.root_missing',
      'severity', 'blocker',
      'message', 'ریشهٔ درخت صفحه باید یک آرایه باشد.'
    ));
  end if;

  for v_node in select * from jsonb_array_elements(p_tree -> 'root')
  loop
    if jsonb_typeof(v_node -> 'component') <> 'string' then
      v_findings := v_findings || jsonb_build_object(
        'rule', 'structure.component_missing',
        'severity', 'blocker',
        'message', 'هر گره باید کلید کامپوننت داشته باشد.'
      );
      continue;
    end if;

    select * into v_component from design.component c where c.key = v_node ->> 'component';

    if not found then
      v_findings := v_findings || jsonb_build_object(
        'rule', 'registry.component_unknown',
        'severity', 'blocker',
        'message', format('کامپوننت «%s» در Registry ثبت نشده است.', v_node ->> 'component'),
        'path', v_node ->> 'id'
      );
      continue;
    end if;

    if v_component.status <> 'active' then
      v_findings := v_findings || jsonb_build_object(
        'rule', 'registry.component_inactive',
        'severity', 'error',
        'message', format('کامپوننت «%s» بازنشسته شده است.', v_component.key)
      );
    end if;

    v_props := coalesce(v_node -> 'props', '{}'::jsonb);
    for v_required in
      select key from jsonb_each(v_component.props_schema)
      where (value ->> 'required')::boolean is true
    loop
      if not (v_props ? v_required) and not ((v_component.props_schema -> v_required) ? 'default') then
        v_findings := v_findings || jsonb_build_object(
          'rule', 'structure.required_prop_missing',
          'severity', 'error',
          'message', format('پراپ الزامی «%s» در کامپوننت «%s» حاضر نیست.', v_required, v_component.key),
          'path', v_node ->> 'id'
        );
      end if;
    end loop;

    for v_required in select jsonb_object_keys(coalesce(v_node -> 'slots', '{}'::jsonb))
    loop
      if not (v_component.slots ? v_required) then
        v_findings := v_findings || jsonb_build_object(
          'rule', 'structure.unknown_slot',
          'severity', 'error',
          'message', format('اسلات «%s» در کامپوننت «%s» تعریف نشده است.', v_required, v_component.key),
          'path', v_node ->> 'id'
        );
      end if;
    end loop;
  end loop;

  return v_findings;
end
$$;

comment on function design.validate_tree is 'بازرسی ساختاری درخت صفحه؛ دروازهٔ خط لولهٔ انتشار (§38، Addendum §96)';

/**
 * اثر انگشت درخت — برای تشخیص «تغییر بی‌اثر» و جلوگیری از ثبت نسخهٔ تکراری.
 *
 * الگوریتم `md5` است و این انتخاب، عمدی و محدود است: بدون افزونهٔ `pgcrypto`
 * (که در همهٔ میزبان‌ها نیست و درست به همین دلیل استفاده نمی‌کنیم) تابع
 * `sha256` در دسترس نیست. اما این هش **امنیتی نیست**؛ یک اثر انگشت محتوایی
 * است تا دو ذخیرهٔ یکسان، دو نسخه نشوند. هر هش امنیتی — رمز، توکن، شناسه —
 * در لایهٔ برنامه با SHA-256 و Argon2id ساخته می‌شود، نه اینجا.
 */
create or replace function design.tree_hash(p_tree jsonb)
returns text
language sql
immutable
as $$
  select 'md5:' || md5(p_tree::text)
$$;

-- ------------------------------------------------------------------ RLS
alter table design.token enable row level security;
alter table design.theme enable row level security;
alter table design.theme_token enable row level security;
alter table design.component enable row level security;
alter table design.page enable row level security;
alter table design.page_revision enable row level security;
alter table design.release enable row level security;
alter table design.audit enable row level security;
alter table design.preview_link enable row level security;
alter table design.page_template enable row level security;

-- توکن‌ها و تم‌ها: خواندن عمومی (چون در رندر لازم‌اند)، نوشتن با مجوز طراحی.
/*
 * توکن و تم: سراسری (سرور طراحی پلتفرم) یا متعلق به یک کسب‌وکار.
 * بی‌نام فقط سراسری‌ها را می‌بیند؛ تم منتشرشدهٔ یک کسب‌وکار، در بستهٔ انتشار
 * (`design.release`) به مرورگر می‌رود، نه از این جدول.
 */
create policy token_read_public on design.token
  for select to pv_public using (business_id is null);

create policy token_read_app on design.token
  for select to pv_app, pv_worker using (
    business_id is null or app.is_member_of(business_id) or app.current_platform_role() is not null
  );

create policy token_read_reader on design.token
  for select to pv_reader using (true);
create policy token_write on design.token
  for all to pv_app, pv_worker
  using (business_id is not null and app.has_permission(business_id, 'design.manage') or app.current_platform_role() is not null)
  with check (business_id is not null and app.has_permission(business_id, 'design.manage') or app.current_platform_role() is not null);

create policy theme_read_public on design.theme
  for select to pv_public using (business_id is null);

create policy theme_read_app on design.theme
  for select to pv_app, pv_worker using (
    business_id is null or app.is_member_of(business_id) or app.current_platform_role() is not null
  );

create policy theme_read_reader on design.theme
  for select to pv_reader using (true);
create policy theme_write on design.theme
  for all to pv_app, pv_worker
  using (business_id is not null and app.has_permission(business_id, 'design.manage') or app.current_platform_role() is not null)
  with check (business_id is not null and app.has_permission(business_id, 'design.manage') or app.current_platform_role() is not null);

create policy theme_token_read on design.theme_token
  for select to pv_app, pv_public, pv_worker, pv_reader using (true);
create policy theme_token_write on design.theme_token
  for all to pv_app, pv_worker
  using (exists (
    select 1 from design.theme t
    where t.id = theme_id
      and ((t.business_id is not null and app.has_permission(t.business_id, 'design.manage')) or app.current_platform_role() is not null)
  ))
  with check (exists (
    select 1 from design.theme t
    where t.id = theme_id
      and ((t.business_id is not null and app.has_permission(t.business_id, 'design.manage')) or app.current_platform_role() is not null)
  ));

-- Registry: خواندن برای همه، نوشتن فقط کارکنان پلتفرم. «بازنشسته کردن» یک
-- کامپوننت، تصمیم پلتفرمی است نه تصمیم یک کسب‌وکار.
create policy component_read on design.component
  for select to pv_app, pv_public, pv_worker, pv_reader using (true);
create policy component_write on design.component
  for all to pv_app, pv_worker
  using (app.current_platform_role() is not null)
  with check (app.current_platform_role() is not null);

create policy page_read_member on design.page
  for select to pv_app
  using ((business_id is not null and app.is_member_of(business_id)) or app.current_platform_role() is not null);
create policy page_public_select on design.page
  for select to pv_public
  using (
    status = 'published' and published_tree is not null
    and (business_id is null or exists (
      select 1 from app.business b where b.id = business_id and b.status = 'active' and b.visibility = 'public' and b.deleted_at is null
    ))
  );
create policy page_write on design.page
  for all to pv_app
  using ((business_id is not null and app.has_permission(business_id, 'design.manage')) or app.current_platform_role() is not null)
  with check ((business_id is not null and app.has_permission(business_id, 'design.manage')) or app.current_platform_role() is not null);
create policy page_worker on design.page
  for select to pv_worker using (app.current_platform_role() is not null);
create policy page_reader on design.page
  for select to pv_reader using (true);

create policy page_revision_member on design.page_revision
  for select to pv_app
  using (exists (
    select 1 from design.page p where p.id = page_id
      and ((p.business_id is not null and app.is_member_of(p.business_id)) or app.current_platform_role() is not null)
  ));
create policy page_revision_insert on design.page_revision
  for insert to pv_app
  with check (exists (
    select 1 from design.page p where p.id = page_id
      and ((p.business_id is not null and app.has_permission(p.business_id, 'design.manage')) or app.current_platform_role() is not null)
  ));
create policy page_revision_reader on design.page_revision
  for select to pv_reader using (true);

create policy release_member on design.release
  for select to pv_app
  using ((business_id is not null and app.is_member_of(business_id)) or app.current_platform_role() is not null);
create policy release_insert on design.release
  for insert to pv_app, pv_worker
  with check ((business_id is not null and app.has_permission(business_id, 'design.publish')) or app.current_platform_role() is not null);
create policy release_update on design.release
  for update to pv_app, pv_worker
  using ((business_id is not null and app.has_permission(business_id, 'design.publish')) or app.current_platform_role() is not null)
  with check ((business_id is not null and app.has_permission(business_id, 'design.publish')) or app.current_platform_role() is not null);
create policy release_reader on design.release
  for select to pv_reader using (true);

create policy design_audit_member on design.audit
  for select to pv_app
  using ((business_id is not null and app.is_member_of(business_id)) or app.current_platform_role() is not null);
create policy design_audit_insert on design.audit
  for insert to pv_app, pv_worker
  with check ((business_id is not null and app.is_member_of(business_id)) or app.current_platform_role() is not null);
create policy design_audit_reader on design.audit
  for select to pv_reader using (true);

create policy preview_link_member on design.preview_link
  for all to pv_app
  using (exists (
    select 1 from design.page p where p.id = page_id
      and ((p.business_id is not null and app.has_permission(p.business_id, 'design.manage')) or app.current_platform_role() is not null)
  ))
  with check (exists (
    select 1 from design.page p where p.id = page_id
      and ((p.business_id is not null and app.has_permission(p.business_id, 'design.manage')) or app.current_platform_role() is not null)
  ));
create policy preview_link_reader on design.preview_link
  for select to pv_reader using (true);

create policy page_template_read on design.page_template
  for select to pv_app, pv_public, pv_worker, pv_reader using (true);
create policy page_template_write on design.page_template
  for all to pv_app, pv_worker
  using (app.current_platform_role() is not null)
  with check (app.current_platform_role() is not null);

-- ------------------------------------------------------------------ گرنت‌ها
grant select on design.token, design.theme, design.theme_token, design.component, design.page_template to pv_app, pv_public, pv_worker, pv_reader;
grant insert, update, delete on design.token, design.theme, design.theme_token to pv_app, pv_worker;
grant insert, update, delete on design.component, design.page_template to pv_app, pv_worker;

grant select, insert, update on design.page to pv_app;
grant select on design.page to pv_public, pv_worker, pv_reader;
grant select, insert on design.page_revision to pv_app;
grant select on design.page_revision to pv_reader;
grant select, insert, update on design.release to pv_app, pv_worker;
grant select on design.release to pv_reader;
grant select, insert on design.audit to pv_app, pv_worker;
grant select on design.audit to pv_reader;
grant select, insert, update, delete on design.preview_link to pv_app;
grant select on design.preview_link to pv_reader;

revoke update, delete on design.page_revision from pv_app, pv_worker, pv_reader;

revoke all on function design.validate_tree(jsonb) from public;
revoke all on function design.tree_hash(jsonb) from public;
grant execute on function design.validate_tree(jsonb) to pv_app, pv_public, pv_worker;
grant execute on function design.tree_hash(jsonb) to pv_app, pv_public, pv_worker, pv_reader;
