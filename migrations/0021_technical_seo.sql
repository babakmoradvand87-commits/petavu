/*
 * گام ۲۶ — سئوی فنی: نقشهٔ سایت، پیوند داخلی، فرصت‌های سئو.
 *
 * چهار چیز، هر کدام یک شکافِ پیدا‌شده در ساخت نقشهٔ سایت و گراف پیوند:
 *
 *   ۱) `seo.noindex_routes` و `seo.sitemap_businesses/_count` و
 *      `seo.sitemap_content/_count`.
 *      نقشهٔ سایتِ قدیمی همهٔ کسب‌وکارها را می‌گذاشت، حتی آن‌هایی که **فرادادهٔ
 *      سئوشان `is_indexable = false` بود** — صفحه‌ای که خودش `noindex` است در نقشهٔ
 *      سایت، به موتور جست‌وجو دو پیام متناقض می‌دهد. و چون `pv_public` سیاست
 *      خواندن روی `seo.metadata` ندارد (RLS بی‌صدا پنهانش می‌کند)، این فیلتر فقط از
 *      راه تابع `security definer` ممکن است. تابع‌ها فقط ستون‌های بی‌خطر
 *      برمی‌گردانند (نامک، تاریخ، سطح تأیید).
 *
 *   ۲) صفحه‌بندیِ نقشهٔ سایت. نسخهٔ قبل `listPublicBusinesses({limit: 5000})` را صدا
 *      می‌زد، ولی سقف صفحه‌بندیِ DAL ۱۰۰ است؛ پس نقشهٔ سایت **بی‌صدا در ۱۰۰
 *      کسب‌وکار قطع می‌شد**. این‌جا `limit/offset` صریح و شمارش جداست.
 *
 *   ۳) `seo.internal_link`: سیاست `internal_link_read_public` از روز اول مرده بود
 *      (گرنت `select` به `pv_public` داده نشده بود؛ قرارداد پوشش در گام ۲۵ پیدایش
 *      کرد). حالا گرنت هست و سیاست فقط پیوند **فعالِ سراسری** را باز می‌کند.
 *
 *   ۴) یکتایی فرصت‌های باز سئو. ثبت «صفحهٔ یتیم» باید ایدمپوتنت باشد (§180): اجرای
 *      دوبارهٔ خزش نباید هر بار یک ردیف تازه بسازد.
 */

-- ------------------------------------------------------------------ ۱) مسیرهای noindex

/*
 * کدام یک از این مسیرها، فرادادهٔ سئوی `noindex` دارد؟
 *
 * ورودی jsonb است نه آرایه: لایهٔ داده، آرایه را به فهرست پارامتر باز می‌کند و
 * `= any($1::text[])` با «malformed array literal» می‌افتد. یک پارامتر jsonb،
 * همیشه یک پارامتر است.
 */
create function seo.noindex_routes(p_routes jsonb, p_locale text default 'fa-IR')
returns setof text
language sql
stable
security definer
set search_path = pg_catalog, seo
as $$
  select m.route_key
  from seo.metadata m
  where m.route_key in (select jsonb_array_elements_text(p_routes))
    and m.locale = p_locale
    and m.is_indexable = false
$$;

comment on function seo.noindex_routes(jsonb, text) is
  'مسیرهایی از فهرست داده‌شده که فرادادهٔ سئوشان noindex است؛ برای نقشهٔ سایت. §39–۴۰';

revoke all on function seo.noindex_routes(jsonb, text) from public;
grant execute on function seo.noindex_routes(jsonb, text) to pv_public, pv_app, pv_worker;

-- ------------------------------------------------------------------ ۲) کسب‌وکارهای نقشهٔ سایت

create function seo.sitemap_business_count()
returns integer
language sql
stable
security definer
set search_path = pg_catalog, seo, app
as $$
  select count(*)::integer
  from app.business b
  where b.status = 'active' and b.visibility = 'public' and b.deleted_at is null
    and not exists (
      select 1 from seo.metadata m
      where m.entity_kind = 'business' and m.entity_id = b.id and m.locale = 'fa-IR' and m.is_indexable = false
    )
$$;

create function seo.sitemap_businesses(p_limit integer, p_offset integer)
returns table (slug text, last_modified timestamptz, verification_level text)
language sql
stable
security definer
set search_path = pg_catalog, seo, app
as $$
  select b.slug,
         greatest(b.updated_at, coalesce(p.updated_at, b.updated_at)) as last_modified,
         b.verification_level
  from app.business b
  left join app.business_profile p on p.business_id = b.id
  where b.status = 'active' and b.visibility = 'public' and b.deleted_at is null
    and not exists (
      select 1 from seo.metadata m
      where m.entity_kind = 'business' and m.entity_id = b.id and m.locale = 'fa-IR' and m.is_indexable = false
    )
  order by b.id
  limit greatest(1, least(coalesce(p_limit, 1000), 50000))
  offset greatest(0, coalesce(p_offset, 0))
$$;

-- ------------------------------------------------------------------ ۳) محتوای سراسری نقشهٔ سایت

/*
 * فقط محتوای **پلتفرم** (`business_id` تهی). محتوای کسب‌وکار نشانی مستقل ندارد؛
 * روی پروفایل همان کسب‌وکار می‌نشیند و پروفایل در نقشهٔ کسب‌وکارهاست.
 */
create function seo.sitemap_content_count()
returns integer
language sql
stable
security definer
set search_path = pg_catalog, seo, app
as $$
  select count(*)::integer
  from app.content c
  where c.business_id is null and c.status = 'published' and c.visibility = 'public' and c.deleted_at is null
    and (c.published_at is null or c.published_at <= now())
    and not exists (
      select 1 from seo.metadata m
      where m.entity_kind = 'content' and m.entity_id = c.id and m.locale = 'fa-IR' and m.is_indexable = false
    )
$$;

create function seo.sitemap_content(p_limit integer, p_offset integer)
returns table (slug text, last_modified timestamptz, kind text)
language sql
stable
security definer
set search_path = pg_catalog, seo, app
as $$
  select c.slug, c.updated_at as last_modified, c.kind
  from app.content c
  where c.business_id is null and c.status = 'published' and c.visibility = 'public' and c.deleted_at is null
    and (c.published_at is null or c.published_at <= now())
    and not exists (
      select 1 from seo.metadata m
      where m.entity_kind = 'content' and m.entity_id = c.id and m.locale = 'fa-IR' and m.is_indexable = false
    )
  order by c.id
  limit greatest(1, least(coalesce(p_limit, 1000), 50000))
  offset greatest(0, coalesce(p_offset, 0))
$$;

revoke all on function seo.sitemap_business_count() from public;
revoke all on function seo.sitemap_businesses(integer, integer) from public;
revoke all on function seo.sitemap_content_count() from public;
revoke all on function seo.sitemap_content(integer, integer) from public;
grant execute on function seo.sitemap_business_count() to pv_public, pv_app, pv_worker;
grant execute on function seo.sitemap_businesses(integer, integer) to pv_public, pv_app, pv_worker;
grant execute on function seo.sitemap_content_count() to pv_public, pv_app, pv_worker;
grant execute on function seo.sitemap_content(integer, integer) to pv_public, pv_app, pv_worker;

-- ------------------------------------------------------------------ ۴) پیوند داخلی

/*
 * پیوند داخلیِ سراسری و فعال، برای همه خواندنی است (§39–۴۷: Internal Linking).
 * سیاست قبلی `is_active` را نمی‌سنجید؛ پیوندِ خاموش‌شده هم دیده می‌شد.
 */
drop policy if exists internal_link_read_public on seo.internal_link;

create policy internal_link_read_public on seo.internal_link
  for select to pv_public
  using (business_id is null and is_active);

grant select on seo.internal_link to pv_public;

-- ------------------------------------------------------------------ ۵) فرصت‌های باز، یکتا

/*
 * یک نوع فرصت برای یک مسیر، تا وقتی باز است، یک‌بار ثبت می‌شود. بستن (`done`،
 * `dismissed`، `expired`) یکتایی را آزاد می‌کند و فرصتِ دوباره‌ظاهرشده، ردیف
 * تازه می‌گیرد.
 */
create unique index content_opportunity_open_unique
  on seo.content_opportunity (kind, coalesce(path, ''), coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status in ('open', 'planned', 'in_progress');
