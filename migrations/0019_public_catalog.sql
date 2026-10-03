/*
 * گام ۲۵ — کاتالوگ عمومی: نرمال‌سازی متن فارسی و جست‌وجوی واقعی در پایگاه‌داده.
 *
 * یک نقص واقعی که در ساخت صفحهٔ جست‌وجو پیدا شد:
 *
 *   `GET /api/v1/search` یک صفحه از فهرست کسب‌وکارها را می‌خواند و **بعد** در
 *   حافظه فیلتر می‌کرد. نتیجه: کسب‌وکاری که در صفحهٔ دوم فهرست بود، با هر
 *   عبارتی هم که جست‌وجو می‌شد پیدا نمی‌شد. جست‌وجو یعنی شرط در پرس‌وجو، نه
 *   فیلتر روی پاسخ.
 *
 * راه‌حل در همان جایی است که داده هست (§103: پایگاه‌داده، منبع حقیقت). دو تابع:
 *
 *   • `app.normalize_fa` — یک نرمال‌سازی واحد برای فارسی؛ «ي/ك» عربی، «ة/ۀ»،
 *     ارقام عربی/فارسی، حرکات، کشیده، نیم‌فاصله. بدون آن، «کلینیک» با «كلينيك»
 *     یکی نیست و جست‌وجوی «۲۴ ساعته» با «24 ساعته» نمی‌خواند.
 *   • `app.search_businesses` — همه‌ی واژه‌های پرس‌وجو باید در متنِ نرمال‌شدهٔ
 *     کسب‌وکار باشند (AND)، با امتیاز: نام دقیق > شروع نام > شامل نام > سایر.
 *
 * نیم‌فاصله و فاصله در مقایسه یکی گرفته می‌شوند («پت‌شاپ» = «پت شاپ» = «پتشاپ»).
 *
 * مقیاس: این جست‌وجو روی PostgreSQL ساده و بدون افزونه کار می‌کند (هم موتور
 * محلی، هم تولید). مسیر رشد، آداپتور موتور جست‌وجو است (§57–۶۰؛ گام ۳۳) که
 * همین قرارداد را نگه می‌دارد.
 *
 * هر دو تابع `security invoker` هستند: RLS همان‌طور که برای خود جدول‌ها اجرا
 * می‌شود، برای جست‌وجو هم اجرا می‌شود. شرط وضعیت عمومی در متن تابع تکرار شده
 * است (سیاست، مرز امنیتی است و شرط، بهینه‌سازی؛ هیچ‌کدام جای دیگری را
 * نمی‌گیرد).
 */

-- ------------------------------------------------------------------ ۱) نرمال‌سازی فارسی

create or replace function app.normalize_fa(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select btrim(
    regexp_replace(
      lower(
        translate(
          coalesce(p_text, ''),
          /*
           * بخش اول (۲۷ نویسه) نگاشت می‌شود، باقی (حرکات، کشیده، نویسه‌های
           * جهت‌دهنده) چون در `to` همتا ندارند **حذف** می‌شوند:
           *   ي→ی  ك→ک  ة→ه  ۀ→ه  أ→ا  إ→ا   ارقام عربی و فارسی→لاتین   نیم‌فاصله→فاصله
           */
          U&'\064A\0643\0629\06C0\0623\0625\0660\0661\0662\0663\0664\0665\0666\0667\0668\0669\06F0\06F1\06F2\06F3\06F4\06F5\06F6\06F7\06F8\06F9\200C\064B\064C\064D\064E\064F\0650\0651\0652\0640\200D\200E\200F\061C',
          U&'\06CC\06A9\0647\0647\0627\0627' || '01234567890123456789' || ' '
        )
      ),
      '\s+', ' ', 'g'
    )
  )
$$;

comment on function app.normalize_fa(text) is
  'نرمال‌سازی متن فارسی برای مقایسه و جست‌وجو (ي/ك، ارقام، حرکات، نیم‌فاصله). §123–۱۲۵';

revoke all on function app.normalize_fa(text) from public;
grant execute on function app.normalize_fa(text) to pv_public, pv_app, pv_worker, pv_reader;

-- ------------------------------------------------------------------ ۲) جست‌وجوی کسب‌وکار

create or replace function app.search_businesses(p_query text, p_limit integer default 24)
returns table (
  id uuid,
  slug text,
  name text,
  tagline text,
  summary text,
  business_type_key text,
  type_name text,
  industry_key text,
  verification_level text,
  city_slug text,
  city_name text,
  score integer
)
language sql
stable
set search_path = pg_catalog, app, ref
as $$
  with q as (
    select
      app.normalize_fa(p_query) as phrase,
      array(
        select t.word
        from unnest(string_to_array(app.normalize_fa(p_query), ' ')) as t(word)
        where length(t.word) >= 2
        limit 6
      ) as words
  ),
  candidates as (
    select
      b.id, b.slug, b.name, p.tagline, p.summary,
      b.business_type_key, t.name_fa as type_name, b.industry_key, b.verification_level,
      l.slug as city_slug, l.name_fa as city_name,
      app.normalize_fa(b.name) as normalized_name,
      replace(
        app.normalize_fa(
          concat_ws(' ', b.name, b.name_latin, b.slug, p.tagline, p.summary,
                    array_to_string(p.keywords, ' '), t.name_fa, t.plural_fa, i.name_fa, l.name_fa)
        ),
        ' ', ''
      ) as haystack
    from app.business b
    left join app.business_profile p on p.business_id = b.id
    left join ref.location l on l.id = b.primary_location_id
    left join ref.business_type t on t.key = b.business_type_key
    left join ref.industry i on i.key = b.industry_key
    where b.status = 'active' and b.visibility = 'public' and b.deleted_at is null
  )
  select
    c.id, c.slug, c.name, c.tagline, c.summary,
    c.business_type_key, c.type_name, c.industry_key, c.verification_level,
    c.city_slug, c.city_name,
    (
      case
        when c.normalized_name = q.phrase then 100
        when starts_with(c.normalized_name, q.phrase) then 60
        when strpos(c.normalized_name, q.phrase) > 0 then 40
        else 10
      end
      + case when c.verification_level in ('premium', 'identity_verified') then 5 else 0 end
    )::integer as score
  from candidates c
  cross join q
  where cardinality(q.words) > 0
    and not exists (
      select 1 from unnest(q.words) as w(word) where strpos(c.haystack, w.word) = 0
    )
  order by score desc, c.name asc
  limit greatest(1, least(coalesce(p_limit, 24), 50))
$$;

comment on function app.search_businesses(text, integer) is
  'جست‌وجوی کسب‌وکارهای عمومی: همهٔ واژه‌ها (AND)، متن نرمال‌شده، امتیازدهی. حداکثر ۵۰ نتیجه. §57–۶۳';

revoke all on function app.search_businesses(text, integer) from public;
grant execute on function app.search_businesses(text, integer) to pv_public, pv_app, pv_worker, pv_reader;

-- ------------------------------------------------------------------ ۳) یک سیاستِ مرده

/*
 * `content_category_public` در مهاجرت ۰۰۰۴ برای `pv_public` تعریف شد ولی گرنت
 * `select` روی جدول **هرگز داده نشد**؛ فقط `app.content` و `app.content_block`
 * گرنت گرفتند. نتیجه: سیاست از روز اول مرده بود و صفحهٔ دستهٔ محتوا
 * («permission denied for table content_category») نمی‌توانست بخواند.
 *
 * سیاست، حصار است و گرنت، در. حصاری که به دری نمی‌رسد هیچ چیز را حفاظت
 * نمی‌کند؛ و بدتر، خواننده را به این باور می‌رساند که «دسترسی عمومی» برقرار است.
 *
 * گرنت، هم‌پای سیاست است: بی‌نام فقط ردیف‌های دسته‌بندیِ محتوای **منتشرشدهٔ
 * عمومی** را می‌بیند (همان شرط سیاست؛ و RLS روی `app.content` داخل زیرپرس‌وجو
 * هم اجرا می‌شود، پس محتوای کسب‌وکار غیرعمومی دیده نمی‌شود).
 */
grant select on app.content_category to pv_public;
