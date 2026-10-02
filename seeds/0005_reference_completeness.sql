-- ============================================================================
-- 0005_reference_completeness — کامل کردن فرادادهٔ مرجع
--
-- چرا فایل جدا: `0001_reference.sql` فهرست کامپوننت‌ها و امکانات را می‌سازد؛
-- ولی چند ردیف، فرادادهٔ خالی داشتند (`a11y = {}`، `seo = {}`) و یک امکان
-- ایندکس‌پذیر، بودجهٔ عملکرد نداشت. تست گام ۱۷ همین را گرفت و اینجا — با
-- `||` (ادغام، نه بازنویسی) — کامل می‌شود.
--
-- ادغام عمدی است: اگر در آینده کسی فیلدی به همین کامپوننت‌ها اضافه کند،
-- اجرای دوبارهٔ seed آن را پاک نمی‌کند.
--
-- مرجع: §43–۴۷ (Registry و دسترس‌پذیری)، Addendum §21–۲۴ (فرادادهٔ فیچر)،
--       §4–۱۹ (بودجهٔ عملکرد)
-- ============================================================================

-- ------------------------------------------------------------------ دسترس‌پذیری
-- «کامپوننت بدون فرادادهٔ دسترس‌پذیری» یعنی کسی تصمیم نگرفته نقش، برچسب و
-- ترتیب خواندنش چه باشد. همین «تصمیم نگرفتن» است که به رابط غیرقابل‌استفاده
-- می‌انجامد (§46).
update design.component as c
   set a11y = c.a11y || v.a11y
  from (values
    ('content.paragraph', '{"semantic_tag": "p", "contrast_min": 4.5, "line_length_max_ch": 68}'::jsonb),
    ('content.stat', '{"value_announced": true, "tabular_numbers": true, "label_required": true}'::jsonb),
    ('layout.columns', '{"reading_order": "dom", "mobile_stack": true, "min_target_px": 44}'::jsonb),
    ('layout.grid', '{"reading_order": "dom", "mobile_stack": true, "focus_order_visible": true}'::jsonb),
    ('utility.spacer', '{"presentational": true, "aria_hidden": true, "no_focus": true}'::jsonb)
  ) as v(key, a11y)
 where c.key = v.key;

-- ------------------------------------------------------------------ فرادادهٔ سئو
/*
 * کامپوننتی که در ساختار سند ظاهر می‌شود (عنوان، فهرست، جدول، گالری، زبانه)
 * باید بگوید به ساختار کمک می‌کند یا نه، و اگر می‌کند، در چه سطحی. کامپوننت
 * صرفاً تزئینی هم باید همین را *بگوید* — خالی گذاشتن یعنی «نمی‌دانم».
 */
update design.component as c
   set seo = c.seo || v.seo
  from (values
    ('content.card',        '{"contributes_to_structure": true, "heading_levels": [3,4], "link_text_meaningful": true}'::jsonb),
    ('content.list',        '{"contributes_to_structure": true, "heading_levels": [], "list_semantics": "ul_ol"}'::jsonb),
    ('content.feature_grid','{"contributes_to_structure": true, "heading_levels": [3,4]}'::jsonb),
    ('content.steps',       '{"contributes_to_structure": true, "heading_levels": [3], "ordered_semantics": true}'::jsonb),
    ('content.table',       '{"contributes_to_structure": true, "table_caption_required": true, "heading_levels": []}'::jsonb),
    ('content.cta_banner',  '{"contributes_to_structure": false, "heading_levels": [2], "link_text_meaningful": true}'::jsonb),
    ('content.callout',     '{"contributes_to_structure": false, "heading_levels": []}'::jsonb),
    ('content.quote',       '{"contributes_to_structure": false, "quote_semantics": "blockquote", "attribution_required": true}'::jsonb),
    ('content.stat',        '{"contributes_to_structure": false, "heading_levels": []}'::jsonb),
    ('content.badge',       '{"contributes_to_structure": false, "decorative": true}'::jsonb),
    ('content.button',      '{"contributes_to_structure": false, "link_text_meaningful": true, "avoid_generic_text": true}'::jsonb),
    ('media.gallery',       '{"contributes_to_structure": true, "images_need_alt": true, "image_contributes_seo": true}'::jsonb),
    ('navigation.tabs',     '{"contributes_to_structure": false, "crawlable": true, "url_backed": true}'::jsonb),
    ('commerce.cart_button','{"contributes_to_structure": false, "indexable": false, "noscript_fallback_required": true}'::jsonb)
  ) as v(key, seo)
 where c.key = v.key;

-- ------------------------------------------------------------------ بودجهٔ عملکرد
/*
 * امکان `content.core` محتوای ایندکس‌پذیر تولید می‌کند، پس صفحه‌ای که این
 * امکان می‌سازد بودجهٔ عملکرد لازم دارد. نبودِ آن یک شکاف واقعی بود: دروازهٔ
 * انتشار، فیچر را بی‌بودجه می‌دید و اجازهٔ انتشار نمی‌داد — که درست بود، ولی
 * خودِ شکاف باید همین‌جا بسته شود، نه اینکه دروازه دور زده شود.
 */
update ops.feature
   set performance_budget = performance_budget || '{"lcp_ms": 2600, "cls": 0.08, "page_weight_kb": 800, "api_p95_ms": 450}'::jsonb
 where key = 'content.core';

-- قالب سئو برای فهرست‌ها (سطح فروشگاه) که در فهرست اولیه جا افتاده بود.
insert into seo.template (business_id, key, entity_kind, title_template, description_template, slug_template, priority, is_active)
values (
  null,
  'listing.default',
  'listing',
  '{title} | PETAVU',
  '{title}: مشخصات، قیمت و راه تماس در پتاوو.',
  '{slug}',
  110,
  true
)
on conflict (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), key)
do update set entity_kind = excluded.entity_kind, title_template = excluded.title_template,
              description_template = excluded.description_template, slug_template = excluded.slug_template,
              priority = excluded.priority, is_active = excluded.is_active;

-- ------------------------------------------------------------------ مجوز خودکارسازی برای مدیر
/*
 * `automation.manage` در seed نخست فقط به مالک داده شده بود. ولی کسی که
 * قاعده‌های بازاریابی و اعلان را می‌چیند، مدیر کسب‌وکار است، نه لزوماً مالک.
 * مالک این مجوز را از راه «همهٔ مجوزهای دامنه‌ای» دارد؛ مدیر باید صریح بگیرد.
 */
insert into app.role_permission (role_id, permission_key)
select r.id, 'automation.manage'
from app.role r
where r.business_id is null and r.key in ('admin', 'marketer')
on conflict do nothing;
