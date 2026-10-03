/*
 * گام ۲۴ — فرادادهٔ سئوی مسیرمحور و کانونیکالِ ایمن.
 *
 * دو شکاف که در ساخت هد SSR پیدا شد و هر دو در پایگاه‌داده بسته می‌شوند، نه
 * در کد وب:
 *
 *   ۱) `seo.metadata_for_public` فقط با `entity_id` کار می‌کند. صفحه‌هایی مثل
 *      «خانه» و «فهرست کسب‌وکارها» موجودیت ندارند و فراداده‌شان با `route_key`
 *      ثبت می‌شود؛ پس آن مسیر هیچ‌وقت فراداده نمی‌خواند. تابع تازه، همان
 *      نگهبان‌ها را دارد و فقط کلید جست‌وجو عوض شده است.
 *
 *   ۲) قاعدهٔ کانونیکال می‌توانست به دامنهٔ دیگری اشاره کند. بازرسی سمت وب هم
 *      گذاشته شد، ولی «دادهٔ خطرناک نباید پذیرفته شود» قاعدهٔ پایگاه‌داده است:
 *      قید، ورود نشانی مطلق را از همان ابتدا می‌بندد (§191: هیچ امنیتی فقط
 *      در لایهٔ بالاتر).
 */

-- ------------------------------------------------------------------ ۰) رفع یک تلهٔ پنهان

/*
 * `seo.metadata_for_public` نوع **مرکب** برمی‌گرداند، نه مجموعه. نتیجهٔ عملی:
 * وقتی ردیفی نیست، تابع یک **ردیف تمام-تهی** می‌دهد، نه «هیچ ردیف». هر
 * مصرف‌کننده‌ای که `select m.* from seo.metadata_for_public(...) m` بنویسد،
 * بی‌خبر یک ردیف تهی می‌گیرد و منطق «آیا فراداده داریم؟» بی‌صدا غلط می‌شود.
 *
 * تغییر نوع بازگشتی با `create or replace` ممکن نیست، پس حذف و ساخت دوبارهٔ
 * همان تابع — با همان بدنه و همان مجوزها. هیچ مصرف‌کنندهٔ دیگری به آن وابسته
 * نیست (`pg_depend` بررسی شد؛ تنها مصرف‌کننده `packages/db` است و شکل فراخوانی
 * در `from`، که با `setof` هم کار می‌کند).
 */
drop function if exists seo.metadata_for_public(text, uuid, text);

create function seo.metadata_for_public(
  p_entity_kind text,
  p_entity_id uuid,
  p_locale text default 'fa-IR'
)
returns setof seo.metadata
language sql
stable
security definer
set search_path = pg_catalog, seo, app
as $$
  select m
  from seo.metadata m
  where m.entity_kind = p_entity_kind
    and m.entity_id = p_entity_id
    and m.locale = p_locale
    and m.is_indexable
    and (
      m.entity_kind <> 'content'
      or exists (
        select 1 from app.content c
        where c.id = m.entity_id
          and c.status = 'published'
          and c.visibility = 'public'
      )
    )
$$;

comment on function seo.metadata_for_public is
  'فرادادهٔ سئوی قابل‌نمایش عمومی (setof؛ ردیف تهی نمی‌دهد) — بازتعریف در گام ۲۴';

revoke all on function seo.metadata_for_public(text, uuid, text) from public;
grant execute on function seo.metadata_for_public(text, uuid, text) to pv_public, pv_app, pv_worker;

-- ------------------------------------------------------------------ ۱) فرادادهٔ مسیر

create or replace function seo.metadata_for_route(
  p_entity_kind text,
  p_route_key text,
  p_locale text default 'fa-IR'
)
returns setof seo.metadata
language sql
stable
security definer
set search_path = pg_catalog, seo, app
as $$
  select m
  from seo.metadata m
  where m.entity_kind = p_entity_kind
    and m.route_key = p_route_key
    and m.locale = p_locale
    and m.is_indexable
$$;

comment on function seo.metadata_for_route is
  'فرادادهٔ سئوی صفحه‌های بدون موجودیت (خانه، فهرست، جست‌وجو) — گام ۲۴';

revoke all on function seo.metadata_for_route(text, text, text) from public;
grant execute on function seo.metadata_for_route(text, text, text) to pv_public, pv_app, pv_worker;

/**
 * سیاست نمایه‌شدن یک صفحه — **حتی وقتی صفحه noindex است**.
 *
 * چرا جدا از `metadata_for_public`: آن تابع عامدانه ردیف‌های `is_indexable =
 * false` را پنهان می‌کند، چون نباید عنوان/توضیح محتوای خصوصی به بی‌نام برسد.
 * اما همین «noindex بودن» اطلاعاتی است که صفحه **باید** ببیند؛ وگرنه صفحه‌ای
 * که کسی عامدانه از نمایه بیرون کشیده، دوباره ایندکس‌شدنی می‌شود. پس اینجا فقط
 * سه ستون سیاست برمی‌گردد: قابل‌نمایه‌شدن، دستورهای robots، و دلیل.
 */
create or replace function seo.index_policy_for_public(
  p_entity_kind text,
  p_entity_id uuid,
  p_route_key text,
  p_locale text default 'fa-IR'
)
returns table (is_indexable boolean, robots_directives text[], non_indexable_reason text)
language sql
stable
security definer
set search_path = pg_catalog, seo
as $$
  select m.is_indexable, m.robots_directives, m.non_indexable_reason
  from seo.metadata m
  where m.entity_kind = p_entity_kind
    and m.locale = p_locale
    and (
      (p_entity_id is not null and m.entity_id = p_entity_id)
      or (p_route_key is not null and m.route_key = p_route_key)
    )
  limit 1
$$;

comment on function seo.index_policy_for_public is
  'سیاست نمایه‌شدن صفحه برای رندر عمومی؛ شامل صفحه‌های noindex (گام ۲۴)';

revoke all on function seo.index_policy_for_public(text, uuid, text, text) from public;
grant execute on function seo.index_policy_for_public(text, uuid, text, text) to pv_public, pv_app, pv_worker;

/**
 * نشانی نسخه‌های زبانی دیگر همان موجودیت — مبنای `hreflang`.
 *
 * چرا تابع و نه کوئری مستقیم: نقش بی‌نام (`pv_public`) روی `seo.metadata`
 * سیاست خواندن ندارد و RLS، ردیف‌ها را **بی‌خطا** پنهان می‌کند؛ نتیجه‌اش
 * «hreflang ساکت» است، یعنی خطایی که هیچ‌وقت دیده نمی‌شود. پس مثل بقیهٔ
 * خواندن‌های عمومی، از یک تابع `security definer` عبور می‌کند که فقط همان
 * چیزی را برمی‌گرداند که برای hreflang لازم است.
 */
create or replace function seo.public_alternates(
  p_entity_kind text,
  p_entity_id uuid,
  p_locale text
)
returns table (locale text, canonical_url text, canonical_path text)
language sql
stable
security definer
set search_path = pg_catalog, seo
as $$
  select m.locale, m.canonical_url, m.route_key
  from seo.metadata m
  where m.entity_id = p_entity_id
    and m.entity_kind = p_entity_kind
    and m.locale <> p_locale
    and m.is_indexable
    and coalesce(m.canonical_url, m.route_key) is not null
  order by m.locale
  limit 10
$$;

comment on function seo.public_alternates is
  'نشانی نسخه‌های زبانی دیگر برای hreflang (گام ۲۴)';

revoke all on function seo.public_alternates(text, uuid, text) from public;
grant execute on function seo.public_alternates(text, uuid, text) to pv_public, pv_app, pv_worker;

-- ------------------------------------------------------------------ ۲) کانونیکال هم‌دامنه

/*
 * قید تازه: `canonical_path` باید مسیر داخلی باشد (با `/` شروع شود) و
 * `source_path` هم همین‌طور. نشانی مطلق (با طرح و میزبان) از این پس وارد
 * نمی‌شود؛ برای انتقال‌های بین‌دامنه‌ای، جدول `seo.redirect` ساخته شده است —
 * همان ابزار درست.
 *
 * چرا نه `check` روی ستون موجود: افزودن قید به جدولِ داده‌دار، مهاجرت را شکننده
 * می‌کند (اگر ردیف ناسازگاری باشد، مهاجرت می‌افتد). اینجا ابتدا ردیف‌های
 * ناسازگار **گزارش** می‌شوند و سپس قید اضافه می‌شود.
 */
do $$
declare
  v_bad integer;
begin
  select count(*) into v_bad
  from seo.canonical c
  where c.canonical_path !~ '^/'
     or c.source_path !~ '^/';

  if v_bad > 0 then
    raise warning 'seo.canonical: % ردیف با مسیر نامعتبر (باید با / شروع شود)، آن‌ها غیرفعال شدند', v_bad;
    update seo.canonical set is_active = false
    where canonical_path !~ '^/' or source_path !~ '^/';
  end if;
end
$$;

alter table seo.canonical
  add constraint canonical_path_shape check (
    canonical_path ~ '^/'
    and length(canonical_path) <= 512
    and canonical_path !~ '//'
    and canonical_path !~ '[[:space:]]'
  ),
  add constraint canonical_source_shape check (
    source_path ~ '^/'
    and length(source_path) <= 512
    and source_path !~ '[[:space:]]'
  );
