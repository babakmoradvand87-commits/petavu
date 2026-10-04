/*
 * Seed 0008 — منوی پنل‌ها و ویجت‌های داشبورد (گام ۲۸؛ §26–۲۸، §103).
 *
 * منو داده است. هر ردیف به یک مجوز گره خورده (UI مجوز نمی‌دهد؛ فقط از آنچه بازیگر می‌تواند ببیند، منو را
 * می‌سازد) و `availability` صادق است: بخشی که هنوز ساخته نشده، `planned` با شمارهٔ گام است — پنهان یا جعل
 * نمی‌شود، می‌گوید چه زمانی می‌آید.
 *
 *   • پنل عضو: دقیقاً ۱۵ مورد (§26).
 *   • پنل مدیریت: دقیقاً ۲۸ مورد (§28)؛ آزمون این دو شمار را می‌سنجد.
 *
 * اجرای دوباره بی‌اثر است (`on conflict (surface, key) do update`).
 */

insert into ops.menu_item (surface, key, label_fa, path, icon_key, permission_key, platform_permission_key, availability, planned_step, description, sort_order)
values
  -- ============================== پنل عضو (۱۵) ==============================
  ('panel', 'dashboard',     'داشبورد',            '/app',               'home',      null,                              null, 'ready',   null, 'نمای کلی کسب‌وکار، متناسب با نوع آن', 10),
  ('panel', 'profile',       'پروفایل عمومی',      '/app/profile',       'user',      'profile.view',                    null, 'ready',   null, 'آنچه در سایت عمومی دیده می‌شود', 20),
  ('panel', 'team',          'تیم و دعوت‌ها',      '/app/team',          'users',     'business.member.manage',          null, 'ready',   null, 'اعضا، نقش‌ها و دعوت‌نامه‌ها', 30),
  ('panel', 'content',       'محتوا',              '/app/content',       'file',      'content.update',                  null, 'ready',   null, 'مقاله‌ها، صفحه‌ها و پیش‌نویس‌ها', 40),
  ('panel', 'approvals',     'بازبینی و تأیید',    '/app/approvals',     'check',     'content.review',                  null, 'ready',   null, 'محتوای منتظر بازبینی', 50),
  ('panel', 'media',         'رسانه',              '/app/media',         'image',     'content.update',                  null, 'ready',   null, 'کتابخانهٔ تصویر و فایل', 60),
  ('panel', 'pages',         'صفحه‌ها و طراحی',    '/app/pages',         'layout',    'design.manage',                   null, 'planned', 30,   'استودیوی طراحی صفحه', 70),
  ('panel', 'seo',           'سئو',                '/app/seo',           'search',    'seo.manage',                      null, 'ready',   null, 'فراداده، تغییر مسیر و بازرسی', 80),
  ('panel', 'automation',    'خودکارسازی',         '/app/automation',    'bolt',      'automation.manage',               null, 'ready',   null, 'قاعده‌های «وقتی… اگر… آنگاه»', 90),
  ('panel', 'performance',   'عملکرد',             '/app/performance',   'gauge',     'business.analytics.view',         null, 'ready',   null, 'دروازهٔ انتشار و پس‌رفت‌ها', 100),
  ('panel', 'relationships', 'روابط',              '/app/relationships', 'link',      'profile.view',                    null, 'ready',   null, 'تأمین‌کننده، توزیع‌کننده و مشتری', 110),
  ('panel', 'integrations',  'یکپارچه‌سازی',       '/app/integrations',  'plug',      'business.integration.manage',     null, 'ready',   null, 'کلیدهای API', 120),
  ('panel', 'notifications', 'اعلان‌ها',           '/app/notifications', 'bell',      null,                              null, 'ready',   null, 'پیام‌های سامانه برای شما', 130),
  ('panel', 'account',       'حساب و امنیت',       '/app/account',       'shield',    null,                              null, 'ready',   null, 'نشست، کدهای بازیابی و خروج', 140),
  ('panel', 'settings',      'تنظیمات کسب‌وکار',   '/app/settings',      'cog',       'business.update',                 null, 'ready',   null, 'نام و مشخصات پایهٔ کسب‌وکار', 150),

  -- ============================== پنل مدیریت (۲۸) ==============================
  ('admin', 'dashboard',     'نمای کلی',           '/app',               'home',      null, null,                             'ready',   null, 'وضعیت پلتفرم', 10),
  ('admin', 'users',         'کاربران',            '/app/users',         'users',     null, 'platform.user.view',             'ready',   null, 'حساب‌ها و وضعیتشان', 20),
  ('admin', 'businesses',    'کسب‌وکارها',         '/app/businesses',    'building',  null, 'platform.business.moderate',     'ready',   null, 'نظارت بر چرخهٔ عمر کسب‌وکارها', 30),
  ('admin', 'content',       'نظارت بر محتوا',     '/app/content',       'file',      null, 'platform.content.moderate',      'ready',   null, 'صف بازبینی محتوا', 40),
  ('admin', 'taxonomy',      'تاکسونومی',          '/app/taxonomy',      'tree',      null, 'platform.taxonomy.manage',       'ready',   null, 'نوع، صنف، مکان و دسته', 50),
  ('admin', 'roles',         'نقش‌ها و مجوزها',    '/app/roles',         'key',       null, 'platform.role.manage',           'ready',   null, 'ماتریس مجوز', 60),
  ('admin', 'design',        'طراحی پلتفرم',       '/app/design',        'layout',    null, 'platform.design.manage',         'planned', 30,   'استودیوی طراحی سراسری', 70),
  ('admin', 'tokens',        'توکن‌ها و تم',       '/app/tokens',        'palette',   null, 'platform.design.manage',         'planned', 30,   'توکن‌های طراحی و نسخه‌ها', 80),
  ('admin', 'seo',           'سئوی پلتفرم',        '/app/seo',           'search',    null, 'platform.seo.manage',            'ready',   null, 'تنظیمات، قالب‌ها و فرصت‌ها', 90),
  ('admin', 'redirects',     'تغییر مسیرها',       '/app/redirects',     'redirect',  null, 'platform.seo.manage',            'ready',   null, 'قواعد ۳۰۱/۳۰۲/۴۱۰', 100),
  ('admin', 'indexing',      'نمایه‌سازی',         '/app/indexing',      'globe',     null, 'platform.seo.manage',            'ready',   null, 'نقشهٔ سایت، IndexNow و رویدادها', 110),
  ('admin', 'features',      'امکانات',            '/app/features',      'toggle',    null, 'platform.feature.manage',        'ready',   null, 'رجیستری و چرخهٔ عمر امکانات', 120),
  ('admin', 'jobs',          'صف کار',             '/app/jobs',          'queue',     null, 'platform.job.observe',           'ready',   null, 'سلامت صف و کارها', 130),
  ('admin', 'automation',    'خودکارسازی',         '/app/automation',    'bolt',      null, 'platform.automation.manage',     'ready',   null, 'قاعده‌های سیستمی', 140),
  ('admin', 'performance',   'عملکرد',             '/app/performance',   'gauge',     null, 'platform.job.observe',           'ready',   null, 'سنجش میدانی، بودجه و پس‌رفت', 150),
  ('admin', 'security',      'رخدادهای امنیتی',    '/app/security',      'shield',    null, 'platform.security.manage',       'ready',   null, 'ورود ناموفق، قفل، رخدادهای مشکوک', 160),
  ('admin', 'audit',         'حسابرسی',            '/app/audit',         'scroll',    null, 'platform.audit.view',            'ready',   null, 'چه کسی، چه چیزی، کِی', 170),
  ('admin', 'backups',       'پشتیبان',            '/app/backups',       'archive',   null, 'platform.backup.manage',         'ready',   null, 'پشتیبان‌ها و آزمون بازیابی', 180),
  ('admin', 'retention',     'نگهداشت داده',       '/app/retention',     'clock',     null, 'platform.settings.manage',       'ready',   null, 'پاک‌سازی مطابق سیاست', 190),
  ('admin', 'settings',      'تنظیمات',            '/app/settings',      'cog',       null, 'platform.settings.manage',       'ready',   null, 'تنظیمات سراسری پلتفرم', 200),
  ('admin', 'notifications', 'اعلان‌ها',           '/app/notifications', 'bell',      null, null,                             'ready',   null, 'پیام‌های سامانه برای شما', 210),
  ('admin', 'api_keys',      'کلیدهای پلتفرم',     '/app/api-keys',      'plug',      null, 'platform.api_key.manage',        'planned', 32,   'کلیدهای یکپارچه‌سازی سطح پلتفرم', 220),
  ('admin', 'impersonation', 'ورود با اختیار کاربر','/app/impersonation', 'mask',     null, 'platform.impersonate',           'planned', 35,   'جانشینی زمان‌دار با بنر و ثبت کامل (§31)', 230),
  ('admin', 'export',        'خروجی داده',         '/app/export',        'download',  null, 'platform.export',                'planned', 36,   'خروجی کامل با پشتیبان و آزمون بازیابی', 240),
  ('admin', 'nocode',        'سازنده‌های No-Code', '/app/nocode',        'blocks',    null, 'platform.design.manage',         'planned', 31,   'فیلد، رابطه، فرم و صفحه', 250),
  ('admin', 'worker',        'کارگر و DLQ',        '/app/worker',        'cpu',       null, 'platform.job.manage',            'planned', 32,   'اجرای کارها، تلاش دوباره و صف مرده', 260),
  ('admin', 'search',        'جست‌وجو و GEO',      '/app/search',        'compass',   null, 'platform.seo.manage',            'planned', 33,   'آداپتور جست‌وجو و داشبورد دیده‌شدن', 270),
  ('admin', 'shop',          'فروشگاه',            '/app/shop',          'cart',      null, 'platform.settings.manage',       'planned', 34,   'سطح فروشگاه و مدیریت آن', 280)
on conflict (surface, key) do update
  set label_fa = excluded.label_fa, path = excluded.path, icon_key = excluded.icon_key,
      permission_key = excluded.permission_key, platform_permission_key = excluded.platform_permission_key,
      availability = excluded.availability, planned_step = excluded.planned_step,
      description = excluded.description, sort_order = excluded.sort_order;

/*
 * ویجت‌های داشبورد. «آگاه به نوع کسب‌وکار» یعنی `business_type_keys`:
 *   • همه: کامل‌بودن پروفایل، شمار محتوا، تیم، اعلان.
 *   • «آگهی فعال» فقط برای نوع‌هایی که کالا یا دام عرضه می‌کنند.
 *   • «دعوت‌های باز» برای خدمات (چند عضو و نوبت‌دهی).
 *   • «پس‌رفت عملکرد» برای کسب‌وکارهایی که صفحهٔ طراحی‌شده دارند، یعنی همه، ولی دیرتر در ترتیب.
 */
insert into ref.dashboard_widget (key, name_fa, kind, source, business_type_keys, sort_order)
values
  ('completeness',  'کامل‌بودن پروفایل',        'metric',    'completeness',  null, 10),
  ('content_counts','وضعیت محتوا',               'breakdown', 'content_counts', null, 20),
  ('team',          'اعضای تیم',                 'metric',    'team',           null, 30),
  ('notifications', 'اعلان‌های نخوانده',         'metric',    'notifications',  null, 40),
  ('invitations',   'دعوت‌های باز',              'metric',    'invitations',
     array['veterinary_clinic', 'veterinary_hospital', 'mobile_vet', 'grooming_salon', 'pet_boarding', 'pet_daycare', 'pet_sitter', 'pet_transport', 'pet_training', 'equine_center', 'equine_vet', 'farrier'], 35),
  ('listings',      'آگهی‌های فعال',             'metric',    'listings',
     array['pet_shop', 'aquarium_shop', 'pet_supplies_wholesale', 'animal_nutrition', 'pet_food_brand', 'pet_grooming_products', 'livestock_farm', 'breeder'], 25),
  ('automation',    'سلامت خودکارسازی',          'breakdown', 'automation',     null, 60),
  ('regressions',   'پس‌رفت‌های عملکرد',         'metric',    'regressions',    null, 70)
on conflict (key) do update
  set name_fa = excluded.name_fa, kind = excluded.kind, source = excluded.source,
      business_type_keys = excluded.business_type_keys, sort_order = excluded.sort_order;
