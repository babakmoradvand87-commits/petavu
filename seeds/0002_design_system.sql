-- ============================================================================
-- 0002_design_system — توکن‌های طراحی و تم پیش‌فرض
--
-- چرا توکن‌ها داده‌اند و نه ثابت‌های کد: ظاهر پلتفرم باید قابل نسخه‌برداری،
-- مقایسه، پیش‌نمایش و بازگردانی باشد؛ و در پنل، قابل ویرایش — ولی هرگز با
-- CSS یا JS خام (§43، §167). توکن، همان مرز امن است: مقداری که در یک قالب
-- جای می‌گیرد، نه کدی که اجرا می‌شود.
--
-- مرجع: §32–۴۴ و §161–۱۶۹ (Design Studio، Registry، Tokens)، Addendum §4–۱۹
--       (فونت، CLS، انیمیشن با transform/opacity)، §45–۴۷ (Mobile-first RTL،
--       تایپوگرافی حرفه‌ای، ۴۴×۴۴، reduced-motion)
--
-- قاعدهٔ اعداد: ریتم فاصله روی شبکهٔ ۴ پیکسلی است، نه اعداد دلبخواه. هر
-- مقدار تازه باید از همین مقیاس بیاید؛ تست، همین را می‌سنجد.
-- ============================================================================

-- ------------------------------------------------------------------ رنگ پایه
insert into design.token (group_key, key, value, value_type, alias_of, description, theme_mode, is_system) values
  -- برند: پترولِ عمیق. انتخاب عمدی: رنگ‌های «آبیِ عمومی» چیزی به برند اضافه
  -- نمی‌کنند؛ این پرده در کنار کهربایی گرم، همان فضای سینماتیک را می‌سازد.
  ('color', 'color.brand.50',  '"#EAF6F7"'::jsonb, 'color', null, 'پایهٔ برند ۵۰', 'light', true),
  ('color', 'color.brand.100', '"#CDE9EC"'::jsonb, 'color', null, 'پایهٔ برند ۱۰۰', 'light', true),
  ('color', 'color.brand.200', '"#9AD3D8"'::jsonb, 'color', null, 'پایهٔ برند ۲۰۰', 'light', true),
  ('color', 'color.brand.300', '"#66BDC4"'::jsonb, 'color', null, 'پایهٔ برند ۳۰۰', 'light', true),
  ('color', 'color.brand.400', '"#33A7B0"'::jsonb, 'color', null, 'پایهٔ برند ۴۰۰', 'light', true),
  ('color', 'color.brand.500', '"#0E7C86"'::jsonb, 'color', null, 'رنگ اصلی برند', 'light', true),
  ('color', 'color.brand.600', '"#0B626A"'::jsonb, 'color', null, 'برند تیره؛ متن روی زمینهٔ روشن', 'light', true),
  ('color', 'color.brand.700', '"#08494F"'::jsonb, 'color', null, 'برند تیره‌تر', 'light', true),
  ('color', 'color.brand.800', '"#053134"'::jsonb, 'color', null, 'برند بسیار تیره', 'light', true),
  ('color', 'color.brand.900', '"#03201F"'::jsonb, 'color', null, 'برند شبانه', 'light', true),

  -- کهربایی گرم: رنگ تأکید و کنش. کم‌مصرف است؛ اگر همه‌جا باشد، هیچ‌جا نیست.
  ('color', 'color.accent.50',  '"#FFF7E6"'::jsonb, 'color', null, 'پایهٔ تأکید ۵۰', 'light', true),
  ('color', 'color.accent.100', '"#FFE9BF"'::jsonb, 'color', null, 'پایهٔ تأکید ۱۰۰', 'light', true),
  ('color', 'color.accent.200', '"#FFD37F"'::jsonb, 'color', null, 'پایهٔ تأکید ۲۰۰', 'light', true),
  ('color', 'color.accent.300', '"#FFBC40"'::jsonb, 'color', null, 'پایهٔ تأکید ۳۰۰', 'light', true),
  ('color', 'color.accent.400', '"#F5A623"'::jsonb, 'color', null, 'رنگ تأکید', 'light', true),
  ('color', 'color.accent.500', '"#D4881A"'::jsonb, 'color', null, 'تأکید تیره‌تر', 'light', true),
  ('color', 'color.accent.600', '"#A96914"'::jsonb, 'color', null, 'تأکید تیره؛ متن روی زمینهٔ روشن', 'light', true),
  ('color', 'color.accent.700', '"#7D4C0F"'::jsonb, 'color', null, 'تأکید بسیار تیره', 'light', true),

  ('color', 'color.neutral.0',    '"#FFFFFF"'::jsonb, 'color', null, 'خنثی سفید', 'light', true),
  ('color', 'color.neutral.50',   '"#F7F8F9"'::jsonb, 'color', null, 'خنثی ۵۰', 'light', true),
  ('color', 'color.neutral.100',  '"#EDEFF2"'::jsonb, 'color', null, 'خنثی ۱۰۰', 'light', true),
  ('color', 'color.neutral.200',  '"#DDE1E6"'::jsonb, 'color', null, 'خنثی ۲۰۰ — مرز روشن', 'light', true),
  ('color', 'color.neutral.300',  '"#C1C7CF"'::jsonb, 'color', null, 'خنثی ۳۰۰', 'light', true),
  ('color', 'color.neutral.400',  '"#9AA3AE"'::jsonb, 'color', null, 'خنثی ۴۰۰ — مرز قوی', 'light', true),
  ('color', 'color.neutral.500',  '"#6F7883"'::jsonb, 'color', null, 'خنثی ۵۰۰', 'light', true),
  ('color', 'color.neutral.600',  '"#4C545E"'::jsonb, 'color', null, 'خنثی ۶۰۰ — متن کم‌رنگ', 'light', true),
  ('color', 'color.neutral.700',  '"#343A42"'::jsonb, 'color', null, 'خنثی ۷۰۰', 'light', true),
  ('color', 'color.neutral.800',  '"#22262C"'::jsonb, 'color', null, 'خنثی ۸۰۰', 'light', true),
  ('color', 'color.neutral.900',  '"#14171A"'::jsonb, 'color', null, 'خنثی ۹۰۰ — متن اصلی', 'light', true),
  ('color', 'color.neutral.1000', '"#0B0D0F"'::jsonb, 'color', null, 'خنثی ۱۰۰۰ — نزدیک به سیاه', 'light', true),

  ('color', 'color.success.500', '"#1F8A54"'::jsonb, 'color', null, 'موفقیت', 'light', true),
  ('color', 'color.success.600', '"#166B40"'::jsonb, 'color', null, 'موفقیت تیره', 'light', true),
  ('color', 'color.warning.500', '"#B9791A"'::jsonb, 'color', null, 'هشدار', 'light', true),
  ('color', 'color.warning.600', '"#8F5D13"'::jsonb, 'color', null, 'هشدار تیره', 'light', true),
  ('color', 'color.danger.500',  '"#C0392B"'::jsonb, 'color', null, 'خطر', 'light', true),
  ('color', 'color.danger.600',  '"#97291E"'::jsonb, 'color', null, 'خطر تیره', 'light', true),
  ('color', 'color.info.500',    '"#2A6FA8"'::jsonb, 'color', null, 'اطلاع', 'light', true),
  ('color', 'color.info.600',    '"#205884"'::jsonb, 'color', null, 'اطلاع تیره', 'light', true)
on conflict (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), group_key, key, theme_mode)
do update set value = excluded.value, value_type = excluded.value_type, alias_of = excluded.alias_of,
              description = excluded.description, is_system = excluded.is_system;

-- ------------------------------------------------------------------ رنگ معنایی (روشن)
insert into design.token (group_key, key, value, value_type, alias_of, description, theme_mode, is_system) values
  ('color', 'color.bg',             '"#FFFFFF"'::jsonb, 'color', 'color.neutral.0',    'زمینهٔ صفحه', 'light', true),
  ('color', 'color.bg.subtle',      '"#F7F8F9"'::jsonb, 'color', 'color.neutral.50',   'زمینهٔ کم‌کنتراست', 'light', true),
  ('color', 'color.surface',        '"#FFFFFF"'::jsonb, 'color', 'color.neutral.0',    'سطح کارت', 'light', true),
  ('color', 'color.surface.raised', '"#FFFFFF"'::jsonb, 'color', 'color.neutral.0',    'سطح برجسته (با سایه)', 'light', true),
  ('color', 'color.surface.sunken', '"#EDEFF2"'::jsonb, 'color', 'color.neutral.100',  'سطح فرورفته', 'light', true),
  ('color', 'color.border',         '"#DDE1E6"'::jsonb, 'color', 'color.neutral.200',  'مرز پیش‌فرض', 'light', true),
  ('color', 'color.border.strong',  '"#9AA3AE"'::jsonb, 'color', 'color.neutral.400',  'مرز پرکنتراست', 'light', true),
  ('color', 'color.text',           '"#14171A"'::jsonb, 'color', 'color.neutral.900',  'متن اصلی', 'light', true),
  ('color', 'color.text.muted',     '"#4C545E"'::jsonb, 'color', 'color.neutral.600',  'متن کم‌رنگ', 'light', true),
  ('color', 'color.text.inverse',   '"#FFFFFF"'::jsonb, 'color', 'color.neutral.0',    'متن روی زمینهٔ تیره', 'light', true),
  ('color', 'color.link',           '"#0B626A"'::jsonb, 'color', 'color.brand.600',    'پیوند', 'light', true),
  ('color', 'color.link.hover',     '"#08494F"'::jsonb, 'color', 'color.brand.700',    'پیوند در حالت اشاره', 'light', true),
  ('color', 'color.focus.ring',     '"#F5A623"'::jsonb, 'color', 'color.accent.400',   'حلقهٔ تمرکز — هرگز حذف نمی‌شود', 'light', true),
  ('color', 'color.overlay',       '"rgba(11, 13, 15, 0.60)"'::jsonb, 'color', null, 'پردهٔ پشت پنجره', 'light', true)
on conflict (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), group_key, key, theme_mode)
do update set value = excluded.value, value_type = excluded.value_type, alias_of = excluded.alias_of,
              description = excluded.description, is_system = excluded.is_system;

-- ------------------------------------------------------------------ رنگ معنایی (تاریک)
insert into design.token (group_key, key, value, value_type, alias_of, description, theme_mode, is_system) values
  ('color', 'color.bg',            '"#0B0D0F"'::jsonb, 'color', null, 'زمینهٔ صفحه در حالت تاریک', 'dark', true),
  ('color', 'color.bg.subtle',     '"#14171A"'::jsonb, 'color', null, 'زمینهٔ کم‌کنتراست در حالت تاریک', 'dark', true),
  ('color', 'color.surface',       '"#14171A"'::jsonb, 'color', null, 'سطح کارت در حالت تاریک', 'dark', true),
  ('color', 'color.surface.raised', '"#22262C"'::jsonb, 'color', null, 'سطح برجسته در حالت تاریک', 'dark', true),
  ('color', 'color.surface.sunken', '"#0B0D0F"'::jsonb, 'color', null, 'سطح فرورفته در حالت تاریک', 'dark', true),
  ('color', 'color.border',        '"#343A42"'::jsonb, 'color', null, 'مرز در حالت تاریک', 'dark', true),
  ('color', 'color.border.strong', '"#4C545E"'::jsonb, 'color', null, 'مرز پرکنتراست در حالت تاریک', 'dark', true),
  ('color', 'color.text',          '"#EDEFF2"'::jsonb, 'color', null, 'متن اصلی در حالت تاریک', 'dark', true),
  ('color', 'color.text.muted',    '"#9AA3AE"'::jsonb, 'color', null, 'متن کم‌رنگ در حالت تاریک', 'dark', true),
  ('color', 'color.text.inverse',  '"#0B0D0F"'::jsonb, 'color', null, 'متن روی زمینهٔ روشن، در حالت تاریک', 'dark', true),
  ('color', 'color.link',          '"#66BDC4"'::jsonb, 'color', null, 'پیوند در حالت تاریک', 'dark', true),
  ('color', 'color.link.hover',    '"#9AD3D8"'::jsonb, 'color', null, 'پیوند در حالت اشاره و تاریک', 'dark', true),
  ('color', 'color.overlay',       '"rgba(0, 0, 0, 0.72)"'::jsonb, 'color', null, 'پردهٔ پشت پنجره در حالت تاریک', 'dark', true)
on conflict (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), group_key, key, theme_mode)
do update set value = excluded.value, value_type = excluded.value_type, alias_of = excluded.alias_of,
              description = excluded.description, is_system = excluded.is_system;

-- ------------------------------------------------------------------ فاصله: شبکهٔ ۴ پیکسلی
insert into design.token (group_key, key, value, value_type, alias_of, description, theme_mode, is_system) values
  ('spacing', 'space.0',  '"0px"'::jsonb,    'length', null, 'بی‌فاصله', 'light', true),
  ('spacing', 'space.1',  '"4px"'::jsonb,    'length', null, 'یک واحد شبکه', 'light', true),
  ('spacing', 'space.2',  '"8px"'::jsonb,    'length', null, 'دو واحد', 'light', true),
  ('spacing', 'space.3',  '"12px"'::jsonb,   'length', null, 'سه واحد', 'light', true),
  ('spacing', 'space.4',  '"16px"'::jsonb,   'length', null, 'چهار واحد — فاصلهٔ پایهٔ موبایل', 'light', true),
  ('spacing', 'space.5',  '"20px"'::jsonb,   'length', null, 'پنج واحد', 'light', true),
  ('spacing', 'space.6',  '"24px"'::jsonb,   'length', null, 'شش واحد — فاصلهٔ پایهٔ دسکتاپ', 'light', true),
  ('spacing', 'space.8',  '"32px"'::jsonb,   'length', null, 'هشت واحد', 'light', true),
  ('spacing', 'space.10', '"40px"'::jsonb,   'length', null, 'ده واحد', 'light', true),
  ('spacing', 'space.12', '"48px"'::jsonb,   'length', null, 'دوازده واحد', 'light', true),
  ('spacing', 'space.16', '"64px"'::jsonb,   'length', null, 'شانزده واحد', 'light', true),
  ('spacing', 'space.20', '"80px"'::jsonb,   'length', null, 'بیست واحد', 'light', true),
  ('spacing', 'space.24', '"96px"'::jsonb,   'length', null, 'بیست‌وچهار واحد — ریتم بخش‌های صفحه', 'light', true),
  ('spacing', 'space.32', '"128px"'::jsonb,  'length', null, 'سی‌ودو واحد', 'light', true),
  ('spacing', 'space.40', '"160px"'::jsonb,  'length', null, 'چهل واحد', 'light', true),
  ('spacing', 'space.48', '"192px"'::jsonb,  'length', null, 'چهل‌وهشت واحد — فاصلهٔ سینماتیک دسکتاپ', 'light', true),
  ('spacing', 'space.grid', '"4px"'::jsonb,  'length', null, 'ریتم پایه؛ هر فاصلهٔ تازه باید مضرب این باشد', 'light', true),
  ('spacing', 'space.gutter', '"16px"'::jsonb, 'length', null, 'فاصلهٔ کناری موبایل', 'light', true)
on conflict (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), group_key, key, theme_mode)
do update set value = excluded.value, value_type = excluded.value_type, alias_of = excluded.alias_of,
              description = excluded.description, is_system = excluded.is_system;

-- ------------------------------------------------------------------ شعاع، مرز، شفافیت
insert into design.token (group_key, key, value, value_type, alias_of, description, theme_mode, is_system) values
  ('radius', 'radius.none', '"0px"'::jsonb,    'length', null, 'بی‌گردی', 'light', true),
  ('radius', 'radius.xs',   '"2px"'::jsonb,    'length', null, 'گردی حداقلی', 'light', true),
  ('radius', 'radius.sm',   '"4px"'::jsonb,    'length', null, 'گردی کوچک', 'light', true),
  ('radius', 'radius.md',   '"8px"'::jsonb,    'length', null, 'گردی پیش‌فرض', 'light', true),
  ('radius', 'radius.lg',   '"12px"'::jsonb,   'length', null, 'گردی کارت', 'light', true),
  ('radius', 'radius.xl',   '"16px"'::jsonb,   'length', null, 'گردی بخش', 'light', true),
  ('radius', 'radius.2xl',  '"24px"'::jsonb,   'length', null, 'گردی سینماتیک', 'light', true),
  ('radius', 'radius.full', '"9999px"'::jsonb, 'length', null, 'کاملاً گرد (قرص)', 'light', true),

  ('border', 'border.width.hairline', '"1px"'::jsonb, 'length', null, 'مرز مو', 'light', true),
  ('border', 'border.width.thick',    '"2px"'::jsonb, 'length', null, 'مرز ضخیم', 'light', true),
  ('border', 'border.width.focus',    '"3px"'::jsonb, 'length', null, 'ضخامت حلقهٔ تمرکز', 'light', true),

  ('opacity', 'opacity.hidden',   '"0"'::jsonb,    'number', null, 'پنهان', 'light', true),
  ('opacity', 'opacity.disabled', '"0.5"'::jsonb,  'number', null, 'غیرفعال', 'light', true),
  ('opacity', 'opacity.muted',    '"0.72"'::jsonb, 'number', null, 'کم‌رنگ', 'light', true),
  ('opacity', 'opacity.overlay',  '"0.6"'::jsonb,  'number', null, 'پردهٔ پشت پنجره', 'light', true)
on conflict (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), group_key, key, theme_mode)
do update set value = excluded.value, value_type = excluded.value_type, alias_of = excluded.alias_of,
              description = excluded.description, is_system = excluded.is_system;

-- ------------------------------------------------------------------ سایه
insert into design.token (group_key, key, value, value_type, alias_of, description, theme_mode, is_system) values
  ('shadow', 'shadow.xs', '[{"x":0,"y":1,"blur":2,"spread":0,"color":"rgba(11,13,15,0.06)"}]'::jsonb,
   'shadow', null, 'سایهٔ حداقلی', 'light', true),
  ('shadow', 'shadow.sm', '[{"x":0,"y":1,"blur":3,"spread":0,"color":"rgba(11,13,15,0.08)"},{"x":0,"y":1,"blur":2,"spread":0,"color":"rgba(11,13,15,0.04)"}]'::jsonb,
   'shadow', null, 'سایهٔ کوچک', 'light', true),
  ('shadow', 'shadow.md', '[{"x":0,"y":4,"blur":8,"spread":-2,"color":"rgba(11,13,15,0.10)"},{"x":0,"y":2,"blur":4,"spread":-2,"color":"rgba(11,13,15,0.06)"}]'::jsonb,
   'shadow', null, 'سایهٔ کارت', 'light', true),
  ('shadow', 'shadow.lg', '[{"x":0,"y":12,"blur":24,"spread":-6,"color":"rgba(11,13,15,0.14)"},{"x":0,"y":4,"blur":8,"spread":-4,"color":"rgba(11,13,15,0.08)"}]'::jsonb,
   'shadow', null, 'سایهٔ سطح برجسته', 'light', true),
  ('shadow', 'shadow.xl', '[{"x":0,"y":24,"blur":48,"spread":-12,"color":"rgba(11,13,15,0.20)"}]'::jsonb,
   'shadow', null, 'سایهٔ پنجره و لایهٔ سینماتیک', 'light', true),
  ('shadow', 'shadow.focus', '[{"x":0,"y":0,"blur":0,"spread":3,"color":"rgba(245,166,35,0.40)"}]'::jsonb,
   'shadow', null, 'هالهٔ تمرکز؛ مکمل حلقه، جانشین آن نیست', 'light', true)
on conflict (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), group_key, key, theme_mode)
do update set value = excluded.value, value_type = excluded.value_type, alias_of = excluded.alias_of,
              description = excluded.description, is_system = excluded.is_system;

-- ------------------------------------------------------------------ تایپوگرافی
insert into design.token (group_key, key, value, value_type, alias_of, description, theme_mode, is_system) values
  -- فونت: WOFF2، زیرمجموعهٔ فارسی، و حداکثر دو وزن پیش‌بار. هر وزن بیشتر، LCP است.
  ('typography', 'font.family.sans',    '"Vazirmatn, system-ui, -apple-system, Segoe UI, sans-serif"'::jsonb,
   'font', null, 'خوانا برای متن فارسی؛ خودمیزبان', 'light', true),
  ('typography', 'font.family.mono',    '"Vazirmatn Code, ui-monospace, SFMono-Regular, monospace"'::jsonb,
   'font', null, 'عدد و کد؛ ارقام جدولی', 'light', true),

  ('typography', 'font.size.xs',   '"12px"'::jsonb, 'length', null, 'ریز (برچسب وضعیت)', 'light', true),
  ('typography', 'font.size.sm',   '"14px"'::jsonb, 'length', null, 'کوچک (فرعی)', 'light', true),
  ('typography', 'font.size.base', '"16px"'::jsonb, 'length', null, 'متن پایه؛ کمینهٔ ورودی‌ها تا زوم موبایل فعال بماند', 'light', true),
  ('typography', 'font.size.lg',   '"18px"'::jsonb, 'length', null, 'متن برجسته', 'light', true),
  ('typography', 'font.size.xl',   '"20px"'::jsonb, 'length', null, 'زیرعنوان', 'light', true),
  ('typography', 'font.size.2xl',  '"24px"'::jsonb, 'length', null, 'عنوان کارت', 'light', true),
  ('typography', 'font.size.3xl',  '"30px"'::jsonb, 'length', null, 'عنوان بخش', 'light', true),
  ('typography', 'font.size.4xl',  '"36px"'::jsonb, 'length', null, 'عنوان صفحه', 'light', true),
  ('typography', 'font.size.5xl',  '"48px"'::jsonb, 'length', null, 'عنوان سینماتیک', 'light', true),
  ('typography', 'font.size.6xl',  '"60px"'::jsonb, 'length', null, 'عنوان نمایشی', 'light', true),
  ('typography', 'font.size.display', '"76px"'::jsonb, 'length', null, 'عدد یا تیتر قهرمان صفحهٔ اصلی', 'light', true),

  ('typography', 'font.weight.regular', '"400"'::jsonb, 'number', null, 'متن', 'light', true),
  ('typography', 'font.weight.medium',  '"500"'::jsonb, 'number', null, 'تأکید ملایم', 'light', true),
  ('typography', 'font.weight.semibold','"600"'::jsonb, 'number', null, 'زیرعنوان', 'light', true),
  ('typography', 'font.weight.bold',    '"700"'::jsonb, 'number', null, 'عنوان', 'light', true),

  -- ارتفاع خط فارسی باید بازتر از لاتین باشد؛ وگرنه اعراب و کشیدگی‌ها بریده می‌شوند.
  ('typography', 'font.leading.tight',   '"1.2"'::jsonb,  'number', null, 'عنوان نمایشی', 'light', true),
  ('typography', 'font.leading.heading', '"1.4"'::jsonb,  'number', null, 'عنوان', 'light', true),
  ('typography', 'font.leading.snug',    '"1.6"'::jsonb,  'number', null, 'متن فشرده (رابط)', 'light', true),
  ('typography', 'font.leading.body',    '"1.8"'::jsonb,  'number', null, 'متن بلند فارسی', 'light', true),

  ('typography', 'font.tracking.tight',  '"-0.01em"'::jsonb, 'length', null, 'عنوان‌های بزرگ', 'light', true),
  ('typography', 'font.tracking.normal', '"0em"'::jsonb,     'length', null, 'پیش‌فرض', 'light', true),
  ('typography', 'font.tracking.wide',   '"0.02em"'::jsonb,  'length', null, 'برچسب‌های تمام‌بزرگ لاتین', 'light', true),

  ('typography', 'font.measure.prose',  '"68ch"'::jsonb, 'length', null, 'عرض خوانا برای مقاله', 'light', true),
  ('typography', 'font.measure.narrow', '"45ch"'::jsonb, 'length', null, 'عرض باریک برای فرم', 'light', true)
on conflict (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), group_key, key, theme_mode)
do update set value = excluded.value, value_type = excluded.value_type, alias_of = excluded.alias_of,
              description = excluded.description, is_system = excluded.is_system;

-- ------------------------------------------------------------------ حرکت
insert into design.token (group_key, key, value, value_type, alias_of, description, theme_mode, is_system) values
  -- حرکت، کم و هدفمند. و هر جا حرکت هست، `prefers-reduced-motion` محترم است
  -- (§46): مدت‌ها صفر می‌شوند، ولی چیدمان به هم نمی‌ریزد.
  ('motion', 'motion.duration.instant',   '"100ms"'::jsonb, 'duration', null, 'بازخورد فوری (فشار)', 'light', true),
  ('motion', 'motion.duration.fast',      '"160ms"'::jsonb, 'duration', null, 'گذرهای ریز', 'light', true),
  ('motion', 'motion.duration.base',      '"240ms"'::jsonb, 'duration', null, 'پیش‌فرض رابط', 'light', true),
  ('motion', 'motion.duration.slow',      '"400ms"'::jsonb, 'duration', null, 'ورود لایه', 'light', true),
  ('motion', 'motion.duration.cinematic', '"700ms"'::jsonb, 'duration', null, 'پردهٔ صفحهٔ اصلی؛ فقط یک بار', 'light', true),
  ('motion', 'motion.ease.standard',   '"cubic-bezier(0.2, 0, 0, 1)"'::jsonb,    'cubic', null, 'استاندارد', 'light', true),
  ('motion', 'motion.ease.emphasized', '"cubic-bezier(0.22, 1, 0.36, 1)"'::jsonb, 'cubic', null, 'ورود با تأکید', 'light', true),
  ('motion', 'motion.ease.exit',       '"cubic-bezier(0.4, 0, 1, 1)"'::jsonb,    'cubic', null, 'خروج', 'light', true),
  ('motion', 'motion.parallax.max',    '"24px"'::jsonb, 'length', null, 'سقف جابه‌جایی پارالاکس؛ بیشتر از این، تهوع‌آور است', 'light', true)
on conflict (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), group_key, key, theme_mode)
do update set value = excluded.value, value_type = excluded.value_type, alias_of = excluded.alias_of,
              description = excluded.description, is_system = excluded.is_system;

-- ------------------------------------------------------------------ شکست، لایه، شبکه
insert into design.token (group_key, key, value, value_type, alias_of, description, theme_mode, is_system) values
  ('breakpoint', 'breakpoint.sm',  '"480px"'::jsonb,  'length', null, 'موبایل بزرگ', 'light', true),
  ('breakpoint', 'breakpoint.md',  '"768px"'::jsonb,  'length', null, 'تبلت', 'light', true),
  ('breakpoint', 'breakpoint.lg',  '"1024px"'::jsonb, 'length', null, 'دسکتاپ کوچک', 'light', true),
  ('breakpoint', 'breakpoint.xl',  '"1280px"'::jsonb, 'length', null, 'دسکتاپ', 'light', true),
  ('breakpoint', 'breakpoint.2xl', '"1536px"'::jsonb, 'length', null, 'دسکتاپ بزرگ', 'light', true),

  ('z', 'z.base',     '"0"'::jsonb,   'number', null, 'جریان عادی', 'light', true),
  ('z', 'z.sticky',   '"100"'::jsonb, 'number', null, 'نوار چسبان', 'light', true),
  ('z', 'z.dropdown', '"200"'::jsonb, 'number', null, 'فهرست بازشو', 'light', true),
  ('z', 'z.overlay',  '"300"'::jsonb, 'number', null, 'پرده', 'light', true),
  ('z', 'z.modal',    '"400"'::jsonb, 'number', null, 'پنجره', 'light', true),
  ('z', 'z.toast',    '"500"'::jsonb, 'number', null, 'اعلان کوتاه', 'light', true),
  ('z', 'z.tooltip',  '"600"'::jsonb, 'number', null, 'راهنمای شناور', 'light', true)
on conflict (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), group_key, key, theme_mode)
do update set value = excluded.value, value_type = excluded.value_type, alias_of = excluded.alias_of,
              description = excluded.description, is_system = excluded.is_system;

-- ------------------------------------------------------------------ تم پیش‌فرض
/*
 * تم = لایهٔ بازنویسی روی توکن‌های پایه.
 *
 * یک تم پیش‌فرض سیستمی داریم و فقط یکی (`theme_default_idx` یکتایی جزئی همین را
 * تضمین می‌کند). کسب‌وکارها تم خودشان را می‌سازند و همان توکن‌ها را بازنویسی
 * می‌کنند — بی‌آنکه به CSS دست بزنند.
 */
insert into design.theme (key, name_fa, description, settings, is_default, is_system)
values (
  'petavu-cinematic',
  'پتاوو — سینماتیک',
  'تم پیش‌فرض: مینیمال، فارسی‌خوان، با حرکت کم و هدفمند. ریشه در شبکهٔ ۴ پیکسلی و مقیاس تایپوگرافی بسته.',
  '{
    "font_family_token": "font.family.sans",
    "base_font_size_token": "font.size.base",
    "space_rhythm_token": "space.grid",
    "radius_base_token": "radius.lg",
    "heading_leading_token": "font.leading.heading",
    "body_leading_token": "font.leading.body",
    "default_motion_token": "motion.duration.base",
    "easing_token": "motion.ease.standard",
    "content_measure_token": "font.measure.prose",
    "direction": "rtl",
    "touch_target_min_px": 44,
    "respects_reduced_motion": true
  }'::jsonb,
  true,
  true
)
on conflict (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), key)
do update set name_fa = excluded.name_fa, description = excluded.description,
              settings = excluded.settings, is_default = excluded.is_default, is_system = excluded.is_system;

-- بازنویسی‌های همین تم روی توکن‌های پایه (لایهٔ تم، نه نسخهٔ دوم توکن).
insert into design.theme_token (theme_id, token_key, value, theme_mode)
select t.id, v.token_key, v.value::jsonb, v.theme_mode
from design.theme t
cross join (values
  ('radius.md', '"10px"'::jsonb, 'light'),
  ('radius.md', '"10px"'::jsonb, 'dark'),
  ('space.24',  '"88px"'::jsonb, 'light'),
  ('space.24',  '"72px"'::jsonb, 'dark'),
  ('motion.duration.base', '"220ms"'::jsonb, 'light'),
  ('motion.duration.base', '"220ms"'::jsonb, 'dark')
) as v(token_key, value, theme_mode)
where t.business_id is null and t.key = 'petavu-cinematic'
on conflict (theme_id, token_key, theme_mode) do update set value = excluded.value;
