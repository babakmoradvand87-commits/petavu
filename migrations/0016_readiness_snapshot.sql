-- ---------------------------------------------------------------------------
-- 0016 — عکس لحظه‌ای آمادگی، به‌جای گرنت خواندن جدول‌های عملیاتی (§93–۹۷، §14)
--
-- ماجرا: `/api/v1/ready` باید عددهای واقعی بگوید — چند مهاجرت اجرا شده، آخرین
-- کی بود، چند جدول هست، فیچرها در چه وضعی‌اند. این پرسش‌ها به `ops.migration`
-- و `ops.feature` می‌خورند، و آن جدول‌ها به نقش بی‌نام/برنامه هیچ گرنتی
-- ندارند (و نباید داشته باشند).
--
-- دو راه بود: جدول را باز کنیم، یا یک تابع باریک بدهیم. راه دوم انتخاب شد،
-- چون:
--   • باز‌کردن جدول، «همهٔ سطرها» را می‌دهد؛ اینجا فقط چهار عدد لازم است.
--   • فهرست مهاجرت‌ها، نقشهٔ راه زیرساخت است؛ بخشی از اطلاعات، همان اندازه
--     که لازم است. (کمینهٔ افشا، §13)
--   • گرنت روی یک تابع، در بازبینی امنیتی *یک سطر* است؛ گرنت روی جدول، یک
--     تصمیم همیشگی که کسی بعداً به یاد نمی‌آورد چرا باز شد.
--
-- تابع به‌صورت `security definer` و با `search_path` بسته نوشته می‌شود؛ پس
-- حتی اگر روزی امتیازها جابه‌جا شد، رفتار عوض نمی‌شود (§191).
-- ---------------------------------------------------------------------------

create or replace function ops.readiness_snapshot()
returns table (
  migrations integer,
  last_applied_at timestamptz,
  tables integer,
  features_development integer,
  features_published integer
)
language sql
stable
security definer
set search_path = pg_catalog, ops, pg_temp
as $$
  select
    (select count(*)::int from ops.migration),
    (select max(m.applied_at) from ops.migration m),
    (
      select count(*)::int
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r'
        and n.nspname in ('ref', 'auth', 'app', 'media', 'design', 'seo', 'ops', 'analytics')
    ),
    (select count(*)::int from ops.feature f where f.status = 'development'),
    (select count(*)::int from ops.feature f where f.status = 'published')
$$;

comment on function ops.readiness_snapshot is
  'عددهای آمادگی (مهاجرت‌ها، جدول‌ها، وضعیت فیچرها) برای /ready؛ بدون بازکردن جدول‌ها (§93–۹۷)';

revoke all on function ops.readiness_snapshot() from public;
grant execute on function ops.readiness_snapshot() to pv_public, pv_app, pv_worker, pv_reader;
