/*
 * Seed 0007 — بودجهٔ مسیرها: الگوی درست، و بودجهٔ منبع‌به‌منبع (گام ۲۷).
 *
 * ۱) الگوی مسیرهای تودرتوی تاکسونومی. `/i/:path` فقط یک بخش را می‌گیرد، ولی نشانی‌ها
 *    `/i/الف/ب` و `/l/استان/شهر` و `/k/الف/ب`‌اند؛ الگوی «یک بخش یا بیشتر» `:path*` است
 *    (تطبیق قطعه‌به‌قطعه، مهاجرت ۰۰۲۲). به‌روزرسانی فقط وقتی انجام می‌شود که ردیف هنوز
 *    الگوی نخست را دارد (ردیفی که دست‌کاری شده، بازنویسی نمی‌شود).
 *
 * ۲) بودجهٔ منبع‌به‌منبع (Addendum §۱–۴) برای مسیرهای عمومی. عددها از **اندازه‌گیری** آمده‌اند
 *    (فشردهٔ brotli، با فشاری که محتوا بالا ببرد): HTML ≈ ۲–۳KB، CSS ≈ ۸٫۵KB، فونت ۸۳KB،
 *    JavaScript فقط بیکن سنجش ≈ ۱–۲KB. سقف‌ها چند برابرِ وضع امروزند تا رشد عادیِ محتوا
 *    دروازه را نبندد، ولی یک پرش واقعی (مثلاً یک کتابخانهٔ JS) را بگیرد.
 */

-- پایگاه‌دادهٔ با seed نخست (الگوی تک‌بخشی): ردیف قدیمی به الگوی درست می‌رود؛ اگر الگوی درست هم
-- هست (اجرای دوبارهٔ seed نخست)، ردیف قدیمی حذف می‌شود تا یکتایی نشکند.
delete from ops.page_budget b
where b.route_pattern in ('/i/:path', '/l/:path', '/k/:path')
  and exists (select 1 from ops.page_budget x where x.scope = b.scope and x.route_pattern = b.route_pattern || '*');

update ops.page_budget
set route_pattern = route_pattern || '*'
where route_pattern in ('/i/:path', '/l/:path', '/k/:path');

update ops.page_budget b
set html_kb = v.html_kb, css_kb = v.css_kb, js_kb = v.js_kb, image_kb = v.image_kb, font_kb = v.font_kb
from (values
  --  الگو                 html css js img  font
  ('/',                     30, 25, 10, 300, 120),
  ('/businesses',           30, 25, 10, 300, 120),
  ('/t',                    30, 25, 10, 200, 120),
  ('/t/:slug',              30, 25, 10, 300, 120),
  ('/i',                    30, 25, 10, 200, 120),
  ('/i/:path*',             30, 25, 10, 300, 120),
  ('/l',                    40, 25, 10, 200, 120),
  ('/l/:path*',             30, 25, 10, 300, 120),
  ('/k',                    30, 25, 10, 200, 120),
  ('/k/:path*',             30, 25, 10, 300, 120),
  ('/search',               30, 25, 10, 300, 120),
  ('/b/:slug',              40, 25, 10, 600, 120),
  ('/:slug',                40, 25, 10, 400, 120)
) as v(route_pattern, html_kb, css_kb, js_kb, image_kb, font_kb)
where b.route_pattern = v.route_pattern and b.scope = 'platform';
