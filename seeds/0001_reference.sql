-- ---------------------------------------------------------------------------
-- seed 0001 — دادهٔ مرجع
--
-- این فایل، «دادهٔ نمونه» نیست. دادهٔ واقعیِ سیستمی است که برنامه بدون آن کار
-- نمی‌کند: مجوزها، نقش‌ها، انواع کسب‌وکار، تاکسونومی صنعت، تقسیمات مکانی،
-- کامپوننت‌های ثبت‌شده، قالب‌های سئو و رجیستری امکانات.
--
-- قاعده: هر ردیف اینجا باید **قطعی و ایدمپوتنت** باشد (§180). اجرای دوبارهٔ
-- seed نباید خطا بدهد و نباید داده را عوض کند؛ فقط غایب‌ها را اضافه می‌کند.
-- پس همه‌جا `on conflict do update` (برای دادهٔ مرجع که باید به‌روز شود) یا
-- `on conflict do nothing` (برای دادهٔ تاریخی) استفاده می‌شود.
--
-- هیچ رمز، هیچ کسب‌وکار نمونه، و هیچ کاربر آزمایشی اینجا ساخته نمی‌شود.
-- دادهٔ توسعه، اگر لازم شد، seed جداگانه و صریح خواهد داشت.
-- ---------------------------------------------------------------------------

-- ================================================================== مجوزها
-- فهرست بسته. الگوی نام: `<دامنه>.<موضوع>[.<عمل>]`.
-- «حساس» یعنی برای اجرا، تأیید مجدد هویت لازم است (§11).
insert into auth.permission (key, name_fa, category, description, is_sensitive) values
  ('business.create', 'ایجاد کسب‌وکار', 'business', 'ساخت کسب‌وکار تازه', false),
  ('business.update', 'ویرایش پروفایل کسب‌وکار', 'business', 'تغییر اطلاعات پایه و پروفایل', false),
  ('business.publish', 'انتشار کسب‌وکار', 'business', 'تبدیل پیش‌نویس به پروفایل عمومی', true),
  ('business.delete', 'حذف کسب‌وکار', 'business', 'حذف نرم کسب‌وکار', true),
  ('business.archive', 'بایگانی کسب‌وکار', 'business', 'بایگانی بدون حذف', true),
  ('business.contact.manage', 'مدیریت راه‌های تماس', 'business', 'افزودن و نمایش عمومی راه تماس', false),
  ('business.verification.submit', 'ارسال درخواست تأیید', 'business', 'ارسال مدارک برای تأیید', false),
  ('business.location.manage', 'مدیریت مکان‌ها', 'business', 'شعبه، انبار و محدودهٔ خدمت', false),
  ('business.role.manage', 'مدیریت نقش‌ها', 'business', 'ساخت و ویرایش نقش سفارشی', true),
  ('business.member.invite', 'دعوت عضو', 'member', 'ارسال دعوت‌نامه به کسب‌وکار', false),
  ('business.member.manage', 'مدیریت اعضا', 'member', 'تغییر نقش، تعلیق و حذف عضو', true),
  ('business.member.remove', 'حذف عضو', 'member', 'برداشتن دسترسی یک عضو', true),
  ('business.transfer.initiate', 'شروع انتقال مالکیت', 'business', 'آغاز فرایند انتقال مالکیت', true),
  ('business.transfer.accept', 'پذیرش مالکیت', 'business', 'پذیرش مالکیت منتقل‌شده', true),
  ('business.relationship.manage', 'مدیریت روابط', 'business', 'گراف شریک/تأمین‌کننده/مشتری', false),
  ('business.analytics.view', 'مشاهدهٔ تحلیل کسب‌وکار', 'business', 'آمار بازدید و تعامل', false),
  ('business.billing.manage', 'مدیریت صورت‌حساب', 'billing', 'پلن، پرداخت و فاکتور', true),

  ('profile.view', 'مشاهدهٔ پروفایل', 'profile', 'دیدن پروفایل کسب‌وکار', false),
  ('profile.edit', 'ویرایش پروفایل', 'profile', 'ویرایش نام، توضیح و رسانهٔ پروفایل', false),

  ('content.create', 'ایجاد محتوا', 'content', 'ساخت آگهی، خدمت، مقاله', false),
  ('content.update', 'ویرایش محتوا', 'content', 'ویرایش محتوای موجود', false),
  ('content.publish', 'انتشار محتوا', 'content', 'انتشار عمومی محتوا', true),
  ('content.delete', 'حذف محتوا', 'content', 'حذف نرم محتوا', true),
  ('content.review', 'بازبینی محتوا', 'content', 'تأیید یا درخواست تغییر', false),
  ('content.category.manage', 'مدیریت دسته‌ها', 'content', 'دسته‌بندی محتوا', false),

  ('media.upload', 'بارگذاری رسانه', 'media', 'افزودن تصویر و ویدیو', false),
  ('media.manage', 'مدیریت رسانه', 'media', 'ویرایش فراداده، آلبوم و حذف', false),

  ('design.view', 'مشاهدهٔ استودیو', 'design', 'دیدن توکن‌ها و صفحه‌ها', false),
  ('design.manage', 'مدیریت استودیو', 'design', 'ویرایش توکن، تم و صفحه', true),
  ('design.publish', 'انتشار طراحی', 'design', 'انتشار بستهٔ طراحی', true),
  ('design.rollback', 'بازگردانی طراحی', 'design', 'بازگشت به نسخهٔ پیشین', true),

  ('seo.manage', 'مدیریت سئو', 'seo', 'تنظیمات، قالب‌ها و متادیتا', false),
  ('seo.redirect.manage', 'مدیریت تغییر مسیر', 'seo', 'ساخت و ویرایش تغییر مسیر', false),
  ('seo.audit.run', 'اجرای بازرسی سئو', 'seo', 'اجرای بازرسی فنی سئو', false),
  ('seo.keyword.manage', 'مدیریت کلیدواژه', 'seo', 'کلیدواژه، موضوع و خوشه', false),

  ('shop.product.manage', 'مدیریت محصول', 'shop', 'محصول و موجودی', false),
  ('shop.order.view', 'مشاهدهٔ سفارش', 'shop', 'دیدن سفارش‌های کسب‌وکار', false),
  ('shop.order.manage', 'مدیریت سفارش', 'shop', 'تغییر وضعیت و ارسال', false),
  ('shop.discount.manage', 'مدیریت تخفیف', 'shop', 'کد تخفیف و کمپین', false),

  ('platform.business.review', 'بازبینی کسب‌وکار', 'platform', 'تأیید یا رد کسب‌وکار', true),
  ('platform.business.moderate', 'نظارت بر کسب‌وکار', 'platform', 'تعلیق و رفع تعلیق', true),
  ('platform.user.view', 'مشاهدهٔ کاربران', 'platform', 'دیدن کاربران پلتفرم', true),
  ('platform.user.suspend', 'تعلیق کاربر', 'platform', 'قفل و آزادسازی حساب', true),
  ('platform.impersonate', 'ورود با اختیار کاربر', 'platform', 'مشاهدهٔ سیستم از دید کاربر', true),
  ('platform.content.moderate', 'نظارت بر محتوا', 'platform', 'بررسی و حذف محتوای نامناسب', true),
  ('platform.taxonomy.manage', 'مدیریت تاکسونومی', 'platform', 'نوع کسب‌وکار، صنعت، مکان', true),
  ('platform.design.manage', 'مدیریت طراحی پلتفرم', 'platform', 'توکن، تم و قالب سیستمی', true),
  ('platform.seo.manage', 'مدیریت سئوی پلتفرم', 'platform', 'قالب‌ها، نقشهٔ سایت، ایندکس', true),
  ('platform.audit.view', 'مشاهدهٔ حسابرسی', 'platform', 'رد حسابرسی و رخداد امنیتی', true),
  ('platform.security.manage', 'مدیریت امنیت', 'platform', 'رسیدگی به رخداد امنیتی', true),
  ('platform.feature.manage', 'مدیریت امکانات', 'platform', 'رجیستری، چرخهٔ عمر و بودجه', true),
  ('platform.automation.manage', 'مدیریت خودکارسازی', 'platform', 'قاعده‌ها و گردش‌کارها', true),
  ('platform.job.manage', 'مدیریت صف', 'platform', 'صف کار، تلاش دوباره و صف مرده', true),
  ('platform.backup.manage', 'مدیریت پشتیبان', 'platform', 'پشتیبان‌گیری و بازیابی', true),
  ('platform.settings.manage', 'مدیریت تنظیمات', 'platform', 'تنظیمات سراسری', true),
  ('platform.role.manage', 'مدیریت نقش‌های پلتفرم', 'platform', 'نقش و مجوز کارکنان', true),
  ('platform.api_key.manage', 'مدیریت کلید API', 'platform', 'کلید برنامه‌نویسی کسب‌وکار', true),
  ('platform.export', 'خروجی داده', 'platform', 'خروجی کامل داده‌های پلتفرم', true),
  ('business.integration.manage', 'مدیریت یکپارچه‌سازی و وبهوک', 'business', 'ساخت و مدیریت مقصد وبهوک و کلید یکپارچه‌سازی کسب‌وکار', true),
  ('platform.job.observe', 'پایش صف', 'platform', 'دیدن وضعیت صف و خطاها', false),
  ('automation.manage', 'مدیریت خودکارسازی', 'automation', 'ساخت، ویرایش و فعال‌سازی قاعدهٔ خودکارسازی', true)
on conflict (key) do update
  set name_fa = excluded.name_fa,
      category = excluded.category,
      description = excluded.description,
      is_sensitive = excluded.is_sensitive;

-- ================================================================== نقش‌های کسب‌وکار (الگو)
insert into app.role (business_id, key, name_fa, description, rank, is_system) values
  (null, 'owner', 'مالک', 'دسترسی کامل؛ فقط یکی در هر کسب‌وکار و انتقال‌پذیر با تأیید مجدد.', 10, true),
  (null, 'admin', 'مدیر', 'همهٔ کارهای روزمره به‌جز انتقال مالکیت و حذف کسب‌وکار.', 20, true),
  (null, 'editor', 'ویرایشگر محتوا', 'ساخت و ویرایش محتوا و رسانه، بدون انتشار.', 40, true),
  (null, 'marketer', 'بازاریاب', 'محتوا، سئو و تحلیل؛ بدون دسترسی به اعضا و صورت‌حساب.', 45, true),
  (null, 'member', 'عضو', 'ویرایش پروفایل و ساخت محتوای پیش‌نویس.', 60, true),
  (null, 'viewer', 'ناظر', 'فقط مشاهده؛ هیچ عملیات نوشتنی.', 80, true)
on conflict (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), key) do update
  set name_fa = excluded.name_fa, description = excluded.description, rank = excluded.rank;

-- اتصال نقش به مجوز.
-- مالک: همه مجوزهای دامنه‌ای، جز آن‌هایی که فقط کارکنان پلتفرم دارند.
insert into app.role_permission (role_id, permission_key)
select r.id, p.key
from app.role r
cross join auth.permission p
where r.is_system and r.key = 'owner'
  and p.category <> 'platform'
on conflict do nothing;

insert into app.role_permission (role_id, permission_key)
select r.id, p.key
from app.role r
cross join auth.permission p
where r.is_system and r.key = 'admin'
  and p.key in (
    'business.update', 'business.publish', 'business.archive', 'business.contact.manage',
    'business.verification.submit', 'business.location.manage', 'business.role.manage',
    'business.member.invite', 'business.member.manage', 'business.relationship.manage',
    'business.analytics.view', 'profile.view', 'profile.edit',
    'content.create', 'content.update', 'content.publish', 'content.review', 'content.category.manage',
    'media.upload', 'media.manage', 'design.view', 'design.manage', 'design.publish',
    'seo.manage', 'seo.redirect.manage', 'seo.audit.run', 'seo.keyword.manage',
    'shop.product.manage', 'shop.order.view', 'shop.order.manage', 'shop.discount.manage',
    'business.integration.manage'
  )
on conflict do nothing;

insert into app.role_permission (role_id, permission_key)
select r.id, p.key
from app.role r
cross join auth.permission p
where r.is_system and r.key = 'editor'
  and p.key in (
    'profile.view', 'profile.edit',
    'content.create', 'content.update', 'content.category.manage',
    'media.upload', 'media.manage', 'design.view', 'business.analytics.view'
  )
on conflict do nothing;

insert into app.role_permission (role_id, permission_key)
select r.id, p.key
from app.role r
cross join auth.permission p
where r.is_system and r.key = 'marketer'
  and p.key in (
    'profile.view', 'profile.edit', 'content.create', 'content.update', 'content.publish',
    'media.upload', 'media.manage', 'seo.manage', 'seo.redirect.manage', 'seo.audit.run',
    'seo.keyword.manage', 'business.analytics.view', 'design.view'
  )
on conflict do nothing;

insert into app.role_permission (role_id, permission_key)
select r.id, p.key
from app.role r
cross join auth.permission p
where r.is_system and r.key = 'member'
  and p.key in ('profile.view', 'profile.edit', 'content.create', 'content.update', 'media.upload', 'business.analytics.view')
on conflict do nothing;

insert into app.role_permission (role_id, permission_key)
select r.id, p.key
from app.role r
cross join auth.permission p
where r.is_system and r.key = 'viewer'
  and p.key in ('profile.view', 'business.analytics.view')
on conflict do nothing;

-- ================================================================== نقش‌های پلتفرم
insert into auth.platform_role (key, name_fa, description, rank) values
  ('superadmin', 'مدیر ارشد پلتفرم', 'دسترسی کامل؛ هر عملیات حساس با تأیید مجدد و رد حسابرسی.', 10),
  ('admin', 'مدیر پلتفرم', 'بازبینی کسب‌وکار و محتوا، بدون دسترسی به رازهای سیستم.', 20),
  ('moderator', 'ناظر محتوا', 'بررسی گزارش‌ها، تعلیق محتوا و کسب‌وکار.', 40),
  ('support', 'پشتیبانی', 'دیدن اطلاعات کاربر برای پاسخ‌گویی؛ بدون تغییر.', 60),
  ('analyst', 'تحلیل‌گر', 'دسترسی خواندنی به داده و گزارش‌ها.', 70)
on conflict (key) do update
  set name_fa = excluded.name_fa, description = excluded.description, rank = excluded.rank;

insert into auth.platform_role_permission (role_key, permission_key)
select r.key, p.key
from auth.platform_role r
cross join auth.permission p
where r.key = 'superadmin'
on conflict do nothing;

insert into auth.platform_role_permission (role_key, permission_key)
select r.key, p.key
from auth.platform_role r
cross join auth.permission p
where r.key = 'admin'
  and p.key in (
    'platform.business.review', 'platform.business.moderate', 'platform.user.view',
    'platform.content.moderate', 'platform.taxonomy.manage', 'platform.design.manage',
    'platform.seo.manage', 'platform.audit.view', 'platform.job.observe', 'platform.feature.manage',
    'platform.export'
  )
on conflict do nothing;

insert into auth.platform_role_permission (role_key, permission_key)
select r.key, p.key
from auth.platform_role r
cross join auth.permission p
where r.key = 'moderator'
  and p.key in ('platform.business.review', 'platform.business.moderate', 'platform.user.view', 'platform.content.moderate')
on conflict do nothing;

insert into auth.platform_role_permission (role_key, permission_key)
select r.key, p.key
from auth.platform_role r
cross join auth.permission p
where r.key = 'support'
  and p.key in ('platform.user.view', 'platform.business.review')
on conflict do nothing;

insert into auth.platform_role_permission (role_key, permission_key)
select r.key, p.key
from auth.platform_role r
cross join auth.permission p
where r.key = 'analyst'
  and p.key in ('platform.user.view', 'platform.audit.view', 'platform.export', 'platform.job.observe')
on conflict do nothing;

-- ================================================================== نوع کسب‌وکار
insert into ref.business_type (key, name_fa, plural_fa, description, depth, schema_type, icon_key, sort_order) values
  ('veterinary_clinic', 'کلینیک دامپزشکی', 'کلینیک‌های دامپزشکی', 'مرکز درمان سرپایی حیوانات خانگی با تیم دامپزشک و تجهیزات تشخیصی.', 0, 'VeterinaryCare', 'stethoscope', 10),
  ('veterinary_hospital', 'بیمارستان دامپزشکی', 'بیمارستان‌های دامپزشکی', 'مرکز درمان با بستری، جراحی و مراقبت شبانه‌روزی.', 0, 'VeterinaryCare', 'hospital', 15),
  ('mobile_vet', 'دامپزشک سیار', 'دامپزشکان سیار', 'خدمات درمانی در محل، برای حیوانات خانگی و دام.', 0, 'VeterinaryCare', 'car', 20),
  ('pet_shop', 'پت‌شاپ', 'پت‌شاپ‌ها', 'فروشگاه لوازم، خوراک و ملزومات نگه‌داری حیوانات خانگی.', 0, 'PetStore', 'store', 30),
  ('pet_supplies_wholesale', 'عمده‌فروشی لوازم حیوانات', 'عمده‌فروشان لوازم حیوانات', 'تأمین عمدهٔ خوراک، لوازم و تجهیزات برای فروشگاه‌ها و کلینیک‌ها.', 0, 'WholesaleStore', 'warehouse', 35),
  ('grooming_salon', 'آرایشگاه و شست‌وشو', 'آرایشگاه‌های حیوانات', 'شست‌وشو، آرایش و مراقبت پوست و مو.', 0, 'HairSalon', 'scissors', 40),
  ('pet_boarding', 'پانسیون و نگه‌داری', 'پانسیون‌های حیوانات', 'نگه‌داری موقت حیوان در سفر یا غیبت صاحب.', 0, 'LodgingBusiness', 'home', 45),
  ('pet_transport', 'حمل و جابه‌جایی حیوان', 'خدمات حمل حیوان', 'جابه‌جایی داخلی و بین‌شهری با تجهیزات مناسب.', 0, 'MovingCompany', 'truck', 50),
  ('pet_training', 'آموزش و تربیت', 'مراکز آموزش حیوانات', 'آموزش فرمان‌پذیری، اصلاح رفتار و تربیت توله.', 0, 'EducationalOrganization', 'graduation', 55),
  ('animal_nutrition', 'تغذیه و جیره‌نویسی', 'متخصصان تغذیهٔ حیوانات', 'طراحی جیره و مشاورهٔ تغذیه برای حیوانات خانگی و دام.', 0, 'ProfessionalService', 'bowl', 60),
  ('livestock_farm', 'دامداری و پرورش', 'دامداری‌ها', 'پرورش دام سبک و سنگین، طیور و آبزیان.', 0, 'Farm', 'barn', 70),
  ('equine_center', 'باشگاه و مرکز سوارکاری', 'باشگاه‌های سوارکاری', 'آموزش سوارکاری، نگه‌داری و پرورش اسب.', 0, 'SportsActivityLocation', 'horse', 80),
  ('equine_vet', 'دامپزشک اسب', 'دامپزشکان اسب', 'درمان تخصصی اسب: لنگش، دندان، تولیدمثل.', 0, 'VeterinaryCare', 'horse-medical', 85),
  ('farrier', 'ناپای اسب (فری‌یر)', 'ناپایان اسب', 'اصلاح و نعل‌بندی سم اسب.', 0, 'ProfessionalService', 'horseshoe', 90),
  ('pet_food_brand', 'تولیدکنندهٔ خوراک', 'تولیدکنندگان خوراک حیوانات', 'تولید خوراک خشک، تر و مکمل.', 0, 'Manufacturer', 'factory', 95),
  ('pet_pharma', 'شرکت دارو و مکمل', 'شرکت‌های دارویی', 'تولید یا پخش دارو، واکسن و مکمل دامی و خانگی.', 0, 'Manufacturer', 'pill', 100),
  ('pet_insurance', 'بیمهٔ حیوانات خانگی', 'بیمه‌های حیوانات', 'پوشش درمانی و مسئولیت برای حیوانات خانگی.', 0, 'InsuranceAgency', 'shield', 105),
  ('animal_lab', 'آزمایشگاه دامپزشکی', 'آزمایشگاه‌های دامپزشکی', 'آزمایش خون، پاتولوژی، میکروبیولوژی و ژنتیک.', 0, 'DiagnosticLab', 'microscope', 110),
  ('animal_imaging', 'تصویربرداری دامپزشکی', 'مراکز تصویربرداری', 'رادیوگرافی، سونوگرافی، CT و MRI دامپزشکی.', 0, 'DiagnosticLab', 'scan', 115),
  ('animal_ambulance', 'آمبولانس و اورژانس دامپزشکی', 'اورژانس‌های دامپزشکی', 'خدمات فوری شبانه‌روزی و انتقال بیمار.', 0, 'EmergencyService', 'ambulance', 120),
  ('pet_photography', 'عکاسی حیوانات', 'عکاسان حیوانات', 'عکاسی پرتره، رویداد و تبلیغاتی.', 0, 'ProfessionalService', 'camera', 125),
  ('pet_daycare', 'مهدکودک و مراقبت روزانه', 'مراکز مراقبت روزانه', 'نگه‌داری روزانه و بازی گروهی.', 0, 'ChildCare', 'sun', 130),
  ('animal_shelter', 'پناهگاه و حمایت', 'پناهگاه‌های حیوانات', 'نگه‌داری، واگذاری و حمایت از حیوانات بی‌سرپرست.', 0, 'AnimalShelter', 'heart', 135),
  ('breeder', 'پرورش‌دهندهٔ نژاد', 'پرورش‌دهندگان نژاد', 'پرورش نژادهای خاص با ثبت شجره.', 0, 'LocalBusiness', 'paw', 140),
  ('pet_grooming_products', 'تولید لوازم نگه‌داری', 'تولیدکنندگان لوازم', 'قفس، قلاده، اسباب‌بازی و لوازم جانبی.', 0, 'Manufacturer', 'box', 145),
  ('veterinary_equipment', 'تجهیزات و مصرفی دامپزشکی', 'پخش‌کنندگان تجهیزات', 'فروش و پخش دستگاه‌ها، ابزار و مواد مصرفی.', 0, 'WholesaleStore', 'tools', 150),
  ('pet_sitter', 'حیوان‌داری و نگه‌داری خانگی', 'خدمات نگه‌داری خانگی', 'مراقبت در خانهٔ حیوان یا صاحب.', 0, 'ProfessionalService', 'key', 155),
  ('aquarium_shop', 'آکواریوم و آبزیان', 'فروشگاه‌های آبزیان', 'فروش ماهی، گیاه و تجهیزات آکواریوم.', 0, 'PetStore', 'fish', 160),
  ('wildlife_rehab', 'بازتوانی حیات وحش', 'مراکز بازتوانی', 'درمان و بازگرداندن پرندگان و حیوانات وحشی به طبیعت.', 0, 'AnimalShelter', 'leaf', 165)
on conflict (key) do update
  set name_fa = excluded.name_fa,
      plural_fa = excluded.plural_fa,
      description = excluded.description,
      schema_type = excluded.schema_type,
      icon_key = excluded.icon_key,
      sort_order = excluded.sort_order;

-- ================================================================== صنعت
-- ساختار سه‌سطحی: حوزهٔ کلان → تخصص → زیرتخصص.
insert into ref.industry (key, name_fa, parent_key, path, depth, synonyms, sort_order) values
  ('animal_health', 'بهداشت و درمان حیوانات', null, 'animal_health', 0, array['درمان','دامپزشکی','سلامت'], 10),
  ('animal_health.clinic', 'کلینیک و درمانگاه', 'animal_health', 'animal_health.clinic', 1, array['درمانگاه','مطب'], 20),
  ('animal_health.surgery', 'جراحی', 'animal_health', 'animal_health.surgery', 1, array['عمل','جراح'], 30),
  ('animal_health.dentistry', 'دندان‌پزشکی', 'animal_health', 'animal_health.dentistry', 1, array['دندان','دهان'], 40),
  ('animal_health.ophthalmology', 'چشم‌پزشکی', 'animal_health', 'animal_health.ophthalmology', 1, array['چشم'], 50),
  ('animal_health.dermatology', 'پوست و مو', 'animal_health', 'animal_health.dermatology', 1, array['پوست','آلرژی'], 60),
  ('animal_health.orthopedics', 'ارتوپدی و استخوان', 'animal_health', 'animal_health.orthopedics', 1, array['شکستگی','استخوان'], 70),
  ('animal_health.diagnostics', 'تشخیص و آزمایش', 'animal_health', 'animal_health.diagnostics', 1, array['آزمایش','تصویربرداری','رادیولوژی'], 80),
  ('animal_health.emergency', 'اورژانس', 'animal_health', 'animal_health.emergency', 1, array['فوری','شبانه‌روزی'], 90),
  ('animal_health.reproduction', 'تولیدمثل', 'animal_health', 'animal_health.reproduction', 1, array['زایمان','باروری'], 100),
  ('animal_health.equine', 'اسب', 'animal_health', 'animal_health.equine', 1, array['اسب','ناپا','لنگش'], 110),
  ('animal_health.livestock', 'دام و طیور', 'animal_health', 'animal_health.livestock', 1, array['دام','گاو','گوسفند','مرغ'], 120),
  ('animal_health.preventive', 'پیشگیری و واکسیناسیون', 'animal_health', 'animal_health.preventive', 1, array['واکسن','پیشگیری','ضد انگل'], 130),

  ('animal_care', 'مراقبت و نگه‌داری', null, 'animal_care', 0, array['نگه‌داری','مراقبت'], 140),
  ('animal_care.grooming', 'آرایش و شست‌وشو', 'animal_care', 'animal_care.grooming', 1, array['آرایشگاه','شامپو'], 150),
  ('animal_care.boarding', 'پانسیون', 'animal_care', 'animal_care.boarding', 1, array['پانسیون','هتل'], 160),
  ('animal_care.training', 'آموزش و رفتار', 'animal_care', 'animal_care.training', 1, array['تربیت','رفتار'], 170),
  ('animal_care.daycare', 'مراقبت روزانه', 'animal_care', 'animal_care.daycare', 1, array['مهدکودک'], 180),
  ('animal_care.sitting', 'نگه‌داری خانگی', 'animal_care', 'animal_care.sitting', 1, array['حیوان‌دار','سیتر'], 190),
  ('animal_care.transport', 'حمل و نقل', 'animal_care', 'animal_care.transport', 1, array['حمل','جابه‌جایی'], 200),
  ('animal_care.nutrition', 'تغذیه', 'animal_care', 'animal_care.nutrition', 1, array['غذا','جیره'], 210),
  ('animal_care.behavior_correction', 'اصلاح رفتار', 'animal_care', 'animal_care.behavior_correction', 1, array['پرخاشگری','اضطراب'], 220),

  ('pet_supply', 'تأمین کالا', null, 'pet_supply', 0, array['لوازم','تأمین'], 230),
  ('pet_supply.food', 'خوراک و تشویقی', 'pet_supply', 'pet_supply.food', 1, array['غذا','تشویقی','کنسرو'], 240),
  ('pet_supply.accessories', 'لوازم جانبی', 'pet_supply', 'pet_supply.accessories', 1, array['قلاده','اسباب‌بازی'], 250),
  ('pet_supply.equipment', 'تجهیزات', 'pet_supply', 'pet_supply.equipment', 1, array['دستگاه','ابزار'], 260),
  ('pet_supply.housing', 'قفس و محل نگه‌داری', 'pet_supply', 'pet_supply.housing', 1, array['قفس','خانه'], 270),
  ('pet_supply.wholesale', 'عمده‌فروشی', 'pet_supply', 'pet_supply.wholesale', 1, array['عمده','توزیع'], 280),
  ('pet_supply.import', 'واردات و پخش', 'pet_supply', 'pet_supply.import', 1, array['واردات','پخش'], 290),
  ('pet_supply.aquarium', 'آکواریوم و آبزیان', 'pet_supply', 'pet_supply.aquarium', 1, array['ماهی','آکواریوم'], 300),

  ('livestock', 'دام و آبزیان', null, 'livestock', 0, array['دام','دامداری','آبزیان'], 310),
  ('livestock.breeding', 'پرورش و اصلاح نژاد', 'livestock', 'livestock.breeding', 1, array['پرورش','نژاد'], 320),
  ('livestock.dairy', 'شیر و لبنیات', 'livestock', 'livestock.dairy', 1, array['شیر','لبنیات'], 330),
  ('livestock.poultry', 'طیور', 'livestock', 'livestock.poultry', 1, array['مرغ','طیور'], 340),
  ('livestock.aquaculture', 'آبزی‌پروری', 'livestock', 'livestock.aquaculture', 1, array['ماهی','پرورش'], 350),
  ('livestock.feed', 'خوراک دام', 'livestock', 'livestock.feed', 1, array['علوفه','خوراک'], 360),
  ('livestock.facility', 'تجهیزات دامداری', 'livestock', 'livestock.facility', 1, array['تجهیزات','شیردوش'], 370),

  ('equine', 'اسب', null, 'equine', 0, array['اسب','سوارکاری'], 380),
  ('equine.riding', 'سوارکاری و آموزش', 'equine', 'equine.riding', 1, array['سوارکاری','آموزش'], 390),
  ('equine.breeding', 'پرورش اسب', 'equine', 'equine.breeding', 1, array['پرورش','نژاد'], 400),
  ('equine.farriery', 'ناپایی', 'equine', 'equine.farriery', 1, array['سم','نعل'], 410),
  ('equine.facility', 'تجهیزات و اصطبل', 'equine', 'equine.facility', 1, array['اصطبل','تجهیزات'], 420),
  ('equine.sport', 'مسابقات و ورزش', 'equine', 'equine.sport', 1, array['مسابقه','ورزش'], 430),
  ('equine.nutrition', 'تغذیهٔ اسب', 'equine', 'equine.nutrition', 1, array['خوراک','یونجه'], 440),

  ('services', 'خدمات تخصصی', null, 'services', 0, array['خدمات'], 450),
  ('services.insurance', 'بیمه', 'services', 'services.insurance', 1, array['بیمه'], 460),
  ('services.legal', 'حقوقی و مجوز', 'services', 'services.legal', 1, array['مجوز','حقوقی'], 470),
  ('services.lab', 'آزمایشگاه', 'services', 'services.lab', 1, array['آزمایش'], 480),
  ('services.photography', 'عکاسی', 'services', 'services.photography', 1, array['عکس'], 490),
  ('services.education', 'آموزش و انتشارات', 'services', 'services.education', 1, array['آموزش','کتاب'], 500),
  ('services.consulting', 'مشاوره', 'services', 'services.consulting', 1, array['مشاوره'], 510),
  ('services.rescue', 'امداد و نجات', 'services', 'services.rescue', 1, array['امداد','نجات'], 520),
  ('services.adoption', 'واگذاری و حمایت', 'services', 'services.adoption', 1, array['واگذاری','حمایت'], 530)
on conflict (key) do update
  set name_fa = excluded.name_fa,
      parent_key = excluded.parent_key,
      path = excluded.path,
      depth = excluded.depth,
      synonyms = excluded.synonyms,
      sort_order = excluded.sort_order;

-- ================================================================== مکان‌ها
-- ساختار: کشور → استان → شهر. مراکز تقریبی برای جست‌وجوی «نزدیک من».
do $$
declare
  v_country uuid;
  v_province uuid;
  v_province_slug text;
  v_row record;
  v_provinces jsonb := '[
    {"slug":"tehran","name":"تهران","lat":35.6892,"lon":51.3890,"cities":[["tehran","تهران",35.6892,51.3890],["shahriar","شهریار",35.6596,51.0590],["varamin","ورامین",35.3242,51.6456],["pakdasht","پاکدشت",35.4785,51.6814],["pardis","پردیس",35.7550,51.8000],["damavand","دماوند",35.7178,52.0653],["robat-karim","رباط‌کریم",35.4846,51.0828],["eslamshahr","اسلامشهر",35.5518,51.2384]]},
    {"slug":"isfahan","name":"اصفهان","lat":32.6546,"lon":51.6680,"cities":[["isfahan","اصفهان",32.6546,51.6680],["kashan","کاشان",33.9833,51.4364],["najafabad","نجف‌آباد",32.6336,51.3667],["shahin-shahr","شاهین‌شهر",32.8667,51.5500]]},
    {"slug":"fars","name":"فارس","lat":29.5918,"lon":52.5837,"cities":[["shiraz","شیراز",29.5918,52.5837],["marvdasht","مرودشت",29.8740,52.8025],["jahrom","جهرم",28.5000,53.5605]]},
    {"slug":"khorasan-razavi","name":"خراسان رضوی","lat":36.2605,"lon":59.6168,"cities":[["mashhad","مشهد",36.2605,59.6168],["neyshabur","نیشابور",36.2133,58.7958],["sabzevar","سبزوار",36.2126,57.6819]]},
    {"slug":"alborz","name":"البرز","lat":35.8290,"lon":50.9915,"cities":[["karaj","کرج",35.8290,50.9915],["fardis","فردیس",35.7250,50.9810],["nazarabad","نظرآباد",35.9500,50.6100]]},
    {"slug":"east-azerbaijan","name":"آذربایجان شرقی","lat":38.0800,"lon":46.2919,"cities":[["tabriz","تبریز",38.0800,46.2919],["maragheh","مراغه",37.3897,46.2375],["marand","مرند",38.4329,45.7735]]},
    {"slug":"west-azerbaijan","name":"آذربایجان غربی","lat":37.5527,"lon":45.0761,"cities":[["urmia","ارومیه",37.5527,45.0761],["khoy","خوی",38.5500,44.9500]]},
    {"slug":"gilan","name":"گیلان","lat":37.2808,"lon":49.5832,"cities":[["rasht","رشت",37.2808,49.5832],["anzali","انزلی",37.4726,49.4571],["lahijan","لاهیجان",37.2073,50.0039]]},
    {"slug":"mazandaran","name":"مازندران","lat":36.5659,"lon":53.0584,"cities":[["sari","ساری",36.5659,53.0584],["babol","بابل",36.5513,52.6790],["amol","آمل",36.4700,52.3500],["noshahr","نوشهر",36.6500,51.5000]]},
    {"slug":"khuzestan","name":"خوزستان","lat":31.3183,"lon":48.6706,"cities":[["ahvaz","اهواز",31.3183,48.6706],["abadan","آبادان",30.3392,48.3043],["dezful","دزفول",32.3800,48.4000]]},
    {"slug":"kerman","name":"کرمان","lat":30.2839,"lon":57.0834,"cities":[["kerman","کرمان",30.2839,57.0834],["rafsanjan","رفسنجان",30.4066,55.9963],["bam","بم",29.1060,58.3560]]},
    {"slug":"qom","name":"قم","lat":34.6416,"lon":50.8746,"cities":[["qom","قم",34.6416,50.8746]]},
    {"slug":"yazd","name":"یزد","lat":31.8974,"lon":54.3569,"cities":[["yazd","یزد",31.8974,54.3569],["mehriz","مهریز",31.5900,54.4400]]},
    {"slug":"hormozgan","name":"هرمزگان","lat":27.1832,"lon":56.2666,"cities":[["bandar-abbas","بندرعباس",27.1832,56.2666],["kish","کیش",26.5578,53.9800],["qeshm","قشم",26.9580,56.2720]]},
    {"slug":"golestan","name":"گلستان","lat":36.8416,"lon":54.4436,"cities":[["gorgan","گرگان",36.8416,54.4436],["gonbad","گنبد کاووس",37.2500,55.1672]]},
    {"slug":"kermanshah","name":"کرمانشاه","lat":34.3142,"lon":47.0650,"cities":[["kermanshah","کرمانشاه",34.3142,47.0650]]},
    {"slug":"markazi","name":"مرکزی","lat":34.0917,"lon":49.6892,"cities":[["arak","اراک",34.0917,49.6892],["saveh","ساوه",35.0215,50.3566]]},
    {"slug":"hamedan","name":"همدان","lat":34.7983,"lon":48.5148,"cities":[["hamedan","همدان",34.7983,48.5148],["malayer","ملایر",34.2961,48.8236]]},
    {"slug":"sistan-baluchestan","name":"سیستان و بلوچستان","lat":29.4963,"lon":60.8629,"cities":[["zahedan","زاهدان",29.4963,60.8629],["chabahar","چابهار",25.2919,60.6430]]},
    {"slug":"ardabil","name":"اردبیل","lat":38.2498,"lon":48.2933,"cities":[["ardabil","اردبیل",38.2498,48.2933]]},
    {"slug":"bushehr","name":"بوشهر","lat":28.9234,"lon":50.8200,"cities":[["bushehr","بوشهر",28.9234,50.8200]]},
    {"slug":"chaharmahal","name":"چهارمحال و بختیاری","lat":32.3256,"lon":50.8644,"cities":[["shahrekord","شهرکرد",32.3256,50.8644]]},
    {"slug":"kurdistan","name":"کردستان","lat":35.3118,"lon":46.9960,"cities":[["sanandaj","سنندج",35.3118,46.9960]]},
    {"slug":"lorestan","name":"لرستان","lat":33.4878,"lon":48.3558,"cities":[["khorramabad","خرم‌آباد",33.4878,48.3558]]},
    {"slug":"ilam","name":"ایلام","lat":33.6374,"lon":46.4227,"cities":[["ilam","ایلام",33.6374,46.4227]]},
    {"slug":"zanjan","name":"زنجان","lat":36.6769,"lon":48.4963,"cities":[["zanjan","زنجان",36.6769,48.4963]]},
    {"slug":"semnan","name":"سمنان","lat":35.5729,"lon":53.3971,"cities":[["semnan","سمنان",35.5729,53.3971],["shahrud","شاهرود",36.4180,54.9747]]},
    {"slug":"south-khorasan","name":"خراسان جنوبی","lat":32.8663,"lon":59.2211,"cities":[["birjand","بیرجند",32.8663,59.2211]]},
    {"slug":"north-khorasan","name":"خراسان شمالی","lat":37.4718,"lon":57.3313,"cities":[["bojnurd","بجنورد",37.4718,57.3313]]},
    {"slug":"kohgiluyeh","name":"کهگیلویه و بویراحمد","lat":30.6681,"lon":51.5880,"cities":[["yasuj","یاسوج",30.6681,51.5880]]},
    {"slug":"qazvin","name":"قزوین","lat":36.2688,"lon":50.0041,"cities":[["qazvin","قزوین",36.2688,50.0041],["takestan","تاکستان",36.0700,49.6960]]}
  ]'::jsonb;
begin
  select id into v_country from ref.location where kind = 'country' and slug = 'iran';
  if v_country is null then
    insert into ref.location (kind, name_fa, parent_id, path, slug, latitude, longitude)
    values ('country', 'ایران', null, 'iran', 'iran', 32.4279, 53.6880)
    returning id into v_country;
  end if;

  for v_row in select * from jsonb_array_elements(v_provinces) as p
  loop
    v_province_slug := v_row.value ->> 'slug';

    select id into v_province from ref.location where parent_id = v_country and slug = v_province_slug;
    if v_province is null then
      insert into ref.location (kind, name_fa, parent_id, path, slug, latitude, longitude)
      values (
        'province', v_row.value ->> 'name', v_country, 'iran.' || v_province_slug, v_province_slug,
        (v_row.value ->> 'lat')::numeric, (v_row.value ->> 'lon')::numeric
      )
      returning id into v_province;
    end if;

    for v_row in select * from jsonb_array_elements(v_row.value -> 'cities') as c
    loop
      insert into ref.location (kind, name_fa, parent_id, path, slug, latitude, longitude)
      values (
        'city', v_row.value ->> 1, v_province, 'iran.' || v_province_slug || '.' || (v_row.value ->> 0),
        v_row.value ->> 0, (v_row.value ->> 2)::numeric, (v_row.value ->> 3)::numeric
      )
      on conflict do nothing;
    end loop;
  end loop;
end
$$;

-- ================================================================== دسته‌بندی محتوا
insert into ref.category (scope, business_id, parent_id, slug, name_fa, description, path, sort_order)
values
  ('content', null, null, 'health', 'سلامت و درمان', 'مراقبت، پیشگیری و درمان حیوانات.', 'health', 10),
  ('content', null, null, 'nutrition', 'تغذیه', 'خوراک، جیره و مکمل.', 'nutrition', 20),
  ('content', null, null, 'behavior', 'رفتار و تربیت', 'آموزش، اصلاح رفتار و روان‌شناسی حیوان.', 'behavior', 30),
  ('content', null, null, 'grooming', 'آرایش و نگه‌داری', 'شست‌وشو، مو و پوست.', 'grooming', 40),
  ('content', null, null, 'industry_news', 'اخبار صنف', 'رویدادها، نمایشگاه‌ها و مقررات.', 'industry_news', 50),
  ('content', null, null, 'business_guides', 'راهنمای کسب‌وکار', 'مدیریت، بازاریابی و رشد کسب‌وکار صنف.', 'business_guides', 60),
  ('content', null, null, 'livestock', 'دام و طیور', 'پرورش، خوراک و سلامت دام.', 'livestock', 70),
  ('content', null, null, 'equine', 'اسب و سوارکاری', 'نگه‌داری، نعل‌بندی، آموزش و مسابقات.', 'equine', 80)
on conflict do nothing;

-- زیردسته‌ها
insert into ref.category (scope, business_id, parent_id, slug, name_fa, path, sort_order)
select 'content', null, p.id, c.slug, c.name_fa, p.path || '.' || c.slug, c.sort_order
from ref.category p
join (values
  ('health', 'vaccination', 'واکسیناسیون', 11),
  ('health', 'parasites', 'انگل و ضد انگل', 12),
  ('health', 'surgery', 'جراحی', 13),
  ('health', 'dental', 'دندان', 14),
  ('health', 'emergency', 'اورژانس', 15),
  ('health', 'chronic', 'بیماری‌های مزمن', 16),
  ('nutrition', 'dry_food', 'خوراک خشک', 21),
  ('nutrition', 'wet_food', 'خوراک تر', 22),
  ('nutrition', 'treats', 'تشویقی', 23),
  ('nutrition', 'supplements', 'مکمل', 24),
  ('nutrition', 'special_diet', 'جیرهٔ خاص', 25),
  ('behavior', 'puppy_training', 'آموزش توله', 31),
  ('behavior', 'aggression', 'پرخاشگری', 32),
  ('behavior', 'anxiety', 'اضطراب جدایی', 33),
  ('behavior', 'litter', 'آموزش دستشویی', 34),
  ('grooming', 'bathing', 'شست‌وشو', 41),
  ('grooming', 'haircut', 'اصلاح مو', 42),
  ('grooming', 'skin', 'پوست و آلرژی', 43)
) as c(parent_slug, slug, name_fa, sort_order) on p.slug = c.parent_slug and p.scope = 'content'
on conflict do nothing;

-- ================================================================== کامپوننت‌های ثبت‌شده
-- این فهرست، «فهرست بسته» است: هیچ ساختاری خارج از این‌ها در صفحه اجرا نمی‌شود.
insert into design.component (key, name_fa, description, category, props_schema, slots, a11y, seo, performance, status, since_release)
values
  ('layout.section', 'بخش', 'نگه‌دارندهٔ محتوا با فاصله و پس‌زمینهٔ قابل تنظیم.', 'layout',
   '{"title":{"type":"string"},"background":{"type":"enum","enum":["none","surface","muted","brand","image"]},"padding":{"type":"enum","enum":["none","sm","md","lg","xl"]},"align":{"type":"enum","enum":["start","center"]},"anchor":{"type":"string"}}'::jsonb,
   '{"default":{"multiple":true,"allowed":["*"]}}'::jsonb,
   '{"landmark":"region","labelledBy":"title"}'::jsonb, '{}'::jsonb, '{"weight_kb":2,"affects_lcp":false}'::jsonb, 'active', '1.0.0'),

  ('layout.grid', 'شبکه', 'چیدمان ستونی واکنش‌گرا.', 'layout',
   '{"columns":{"type":"enum","enum":["1","2","3","4"],"default":"3"},"gap":{"type":"enum","enum":["sm","md","lg"],"default":"md"}}'::jsonb,
   '{"default":{"multiple":true,"allowed":["*"]}}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{"weight_kb":1}'::jsonb, 'active', '1.0.0'),

  ('layout.columns', 'دو ستون', 'چیدمان دوستونی با توزیع قابل تنظیم.', 'layout',
   '{"ratio":{"type":"enum","enum":["50-50","60-40","40-60","70-30","30-70"],"default":"50-50"},"reverse":{"type":"boolean","default":false}}'::jsonb,
   '{"start":{"multiple":true,"allowed":["*"]},"end":{"multiple":true,"allowed":["*"]}}'::jsonb,
   '{}'::jsonb, '{}'::jsonb, '{"weight_kb":1}'::jsonb, 'active', '1.0.0'),

  ('content.heading', 'عنوان', 'عنوان بخش با سطح مشخص.', 'content',
   '{"text":{"type":"string","required":true},"level":{"type":"enum","enum":["h1","h2","h3","h4"],"default":"h2"},"align":{"type":"enum","enum":["start","center"],"default":"start"}}'::jsonb,
   '{}'::jsonb,
   '{"heading":true,"requiresH1Unique":true}'::jsonb,
   '{"contributesToStructure":true}'::jsonb, '{"weight_kb":1}'::jsonb, 'active', '1.0.0'),

  ('content.paragraph', 'پاراگراف', 'متن توضیحی؛ محتوای آن ساختاریافته است، نه HTML.', 'content',
   '{"text":{"type":"longtext","required":true},"size":{"type":"enum","enum":["sm","md","lg"],"default":"md"}}'::jsonb,
   '{}'::jsonb, '{}'::jsonb, '{"wordCount":true}'::jsonb, '{"weight_kb":1}'::jsonb, 'active', '1.0.0'),

  ('content.hero', 'سرصفحه', 'بخش نخست صفحه: عنوان، توضیح، کنش و تصویر.', 'content',
   '{"title":{"type":"string","required":true},"subtitle":{"type":"string"},"primaryCta":{"type":"cta"},"secondaryCta":{"type":"cta"},"assetId":{"type":"asset"},"layout":{"type":"enum","enum":["centered","split","overlay"],"default":"split"}}'::jsonb,
   '{"actions":{"multiple":true,"allowed":["content.button","content.badge"]}}'::jsonb,
   '{"heading":true,"firstHeadingLevel":"h1","imageRequiresAlt":true}'::jsonb,
   '{"contributesToStructure":true,"lcpCandidate":true}'::jsonb,
   '{"weight_kb":8,"affects_lcp":true,"lcp_budget_ms":2500}'::jsonb, 'active', '1.0.0'),

  ('content.button', 'دکمه', 'کنش با هدف و سبک مشخص.', 'content',
   '{"label":{"type":"string","required":true},"href":{"type":"url"},"variant":{"type":"enum","enum":["primary","secondary","ghost","link"],"default":"primary"},"size":{"type":"enum","enum":["sm","md","lg"],"default":"md"},"icon":{"type":"string"}}'::jsonb,
   '{}'::jsonb,
   '{"minTouchTarget":44,"focusVisible":true,"ariaLabelFrom":"label"}'::jsonb,
   '{}'::jsonb, '{"weight_kb":1}'::jsonb, 'active', '1.0.0'),

  ('content.badge', 'برچسب', 'نشان کوچک وضعیت یا دسته.', 'content',
   '{"text":{"type":"string","required":true},"tone":{"type":"enum","enum":["neutral","success","warning","info","brand"],"default":"neutral"}}'::jsonb,
   '{}'::jsonb, '{"decorativeWhenEmpty":true}'::jsonb, '{}'::jsonb, '{"weight_kb":1}'::jsonb, 'active', '1.0.0'),

  ('content.card', 'کارت', 'کارت محتوا با تصویر و متن.', 'content',
   '{"title":{"type":"string","required":true},"description":{"type":"string"},"assetId":{"type":"asset"},"href":{"type":"url"},"tone":{"type":"enum","enum":["surface","muted","outline"],"default":"surface"}}'::jsonb,
   '{"footer":{"multiple":true,"allowed":["content.button","content.badge"]}}'::jsonb,
   '{"heading":true,"headingLevel":"h3","imageRequiresAlt":true}'::jsonb,
   '{}'::jsonb, '{"weight_kb":3,"affects_lcp":true}'::jsonb, 'active', '1.0.0'),

  ('content.list', 'فهرست', 'فهرست نشانه‌دار یا شماره‌دار.', 'content',
   '{"items":{"type":"array","items":"string","required":true},"ordered":{"type":"boolean","default":false}}'::jsonb,
   '{}'::jsonb, '{"listSemantics":true}'::jsonb, '{}'::jsonb, '{"weight_kb":1}'::jsonb, 'active', '1.0.0'),

  ('content.feature_grid', 'شبکهٔ ویژگی‌ها', 'چند کارت ویژگی در یک شبکه.', 'content',
   '{"items":{"type":"array","required":true,"items":"object","fields":{"icon":"string","title":"string","text":"string"}},"columns":{"type":"enum","enum":["2","3","4"],"default":"3"}}'::jsonb,
   '{}'::jsonb, '{"heading":true,"headingLevel":"h3"}'::jsonb, '{}'::jsonb, '{"weight_kb":2}'::jsonb, 'active', '1.0.0'),

  ('content.stat', 'عدد کلیدی', 'نمایش یک شاخص با برچسب.', 'content',
   '{"value":{"type":"string","required":true},"label":{"type":"string","required":true},"suffix":{"type":"string"}}'::jsonb,
   '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{"weight_kb":1}'::jsonb, 'active', '1.0.0'),

  ('content.pricing', 'جدول قیمت', 'پلن‌ها و ویژگی‌هایشان.', 'commerce',
   '{"plans":{"type":"array","required":true,"items":"object","fields":{"name":"string","price":"string","period":"string","features":"array","cta":"cta","highlighted":"boolean"}}}'::jsonb,
   '{}'::jsonb, '{"tableSemantics":true}'::jsonb, '{"schemaType":"Offer"}'::jsonb, '{"weight_kb":3}'::jsonb, 'active', '1.0.0'),

  ('content.faq', 'پرسش‌های متداول', 'پرسش و پاسخ تاشو.', 'content',
   '{"items":{"type":"array","required":true,"items":"object","fields":{"question":"string","answer":"longtext"}}}'::jsonb,
   '{}'::jsonb, '{"disclosureSemantics":true,"keyboardOperable":true}'::jsonb,
   '{"schemaType":"FAQPage","contributesToStructure":true}'::jsonb, '{"weight_kb":4}'::jsonb, 'active', '1.0.0'),

  ('content.quote', 'نقل قول', 'نقل قول با منبع.', 'content',
   '{"text":{"type":"longtext","required":true},"source":{"type":"string"},"role":{"type":"string"}}'::jsonb,
   '{}'::jsonb, '{"blockquoteSemantics":true}'::jsonb, '{}'::jsonb, '{"weight_kb":1}'::jsonb, 'active', '1.0.0'),

  ('content.callout', 'هشدار', 'کادر تأکید یا هشدار.', 'content',
   '{"text":{"type":"longtext","required":true},"tone":{"type":"enum","enum":["info","success","warning","danger"],"default":"info"},"title":{"type":"string"}}'::jsonb,
   '{}'::jsonb, '{"role":"note"}'::jsonb, '{}'::jsonb, '{"weight_kb":1}'::jsonb, 'active', '1.0.0'),

  ('content.steps', 'مراحل', 'راهنمای گام‌به‌گام.', 'content',
   '{"items":{"type":"array","required":true,"items":"object","fields":{"title":"string","text":"longtext"}},"ordered":{"type":"boolean","default":true}}'::jsonb,
   '{}'::jsonb, '{"listSemantics":true}'::jsonb, '{}'::jsonb, '{"weight_kb":2}'::jsonb, 'active', '1.0.0'),

  ('content.table', 'جدول', 'جدول داده با سرستون.', 'data',
   '{"caption":{"type":"string"},"columns":{"type":"array","required":true,"items":"string"},"rows":{"type":"array","required":true,"items":"array"}}'::jsonb,
   '{}'::jsonb, '{"tableSemantics":true,"captionRequired":true,"responsiveScroll":true}'::jsonb,
   '{}'::jsonb, '{"weight_kb":2}'::jsonb, 'active', '1.0.0'),

  ('content.cta_banner', 'بنر کنش', 'دعوت به اقدام با پس‌زمینه.', 'content',
   '{"title":{"type":"string","required":true},"text":{"type":"string"},"cta":{"type":"cta","required":true},"tone":{"type":"enum","enum":["brand","dark","muted"],"default":"brand"}}'::jsonb,
   '{}'::jsonb, '{"heading":true,"headingLevel":"h2"}'::jsonb, '{}'::jsonb, '{"weight_kb":2}'::jsonb, 'active', '1.0.0'),

  ('content.contact_block', 'بلوک تماس', 'نمایش راه‌های تماس تأییدشدهٔ کسب‌وکار.', 'content',
   '{"showHours":{"type":"boolean","default":true},"showMap":{"type":"boolean","default":false},"title":{"type":"string"}}'::jsonb,
   '{}'::jsonb, '{"heading":true,"headingLevel":"h2"}'::jsonb,
   '{"schemaType":"ContactPoint"}'::jsonb, '{"weight_kb":3}'::jsonb, 'active', '1.0.0'),

  ('content.map', 'نقشه', 'موقعیت مکانی روی نقشه.', 'content',
   '{"latitude":{"type":"number","required":true},"longitude":{"type":"number","required":true},"zoom":{"type":"number","default":15},"title":{"type":"string"}}'::jsonb,
   '{}'::jsonb, '{"heading":true,"headingLevel":"h3"}'::jsonb,
   '{"schemaType":"GeoCoordinates"}'::jsonb,
   '{"weight_kb":0,"thirdParty":true,"loadingStrategy":"on-interaction","thirdPartyNote":"کد نقشه تنها پس از تعامل کاربر بارگذاری می‌شود (Addendum §20)."}'::jsonb,
   'active', '1.0.0'),

  ('media.image', 'تصویر', 'تصویر با متن جانشین و نسبت ابعاد مشخص.', 'media',
   '{"assetId":{"type":"asset","required":true},"alt":{"type":"string","required":true},"caption":{"type":"string"},"ratio":{"type":"enum","enum":["1:1","4:3","3:2","16:9","21:9"],"default":"3:2"},"rounded":{"type":"boolean","default":true},"loading":{"type":"enum","enum":["lazy","eager"],"default":"lazy"},"priority":{"type":"boolean","default":false}}'::jsonb,
   '{}'::jsonb, '{"altRequired":true,"decorativeAllowed":false}'::jsonb,
   '{"imageContributesSeo":true,"requiresAlt":true}'::jsonb,
   '{"weight_kb":0,"affects_lcp":true,"note":"وزن واقعی تابع دارایی است؛ فایل بدون بعد مشخص نمی‌شود تا CLS رخ ندهد."}'::jsonb,
   'active', '1.0.0'),

  ('media.gallery', 'گالری', 'چند تصویر با چیدمان شبکه.', 'media',
   '{"items":{"type":"array","required":true,"items":"object","fields":{"assetId":"asset","alt":"string","caption":"string"}},"columns":{"type":"enum","enum":["2","3","4"],"default":"3"},"lightbox":{"type":"boolean","default":true}}'::jsonb,
   '{}'::jsonb, '{"altRequired":true,"keyboardOperable":true,"focusTrap":true}'::jsonb,
   '{}'::jsonb, '{"weight_kb":4,"note":"بارگذاری تصاویر گالری تنبل است؛ تنها تصویر اول eager می‌شود."}'::jsonb, 'active', '1.0.0'),

  ('media.logo', 'لوگو', 'نشان کسب‌وکار با اندازهٔ کنترل‌شده.', 'media',
   '{"assetId":{"type":"asset","required":true},"alt":{"type":"string","default":""},"size":{"type":"enum","enum":["sm","md","lg"],"default":"md"},"href":{"type":"url"}}'::jsonb,
   '{}'::jsonb, '{"decorativeAllowed":true}'::jsonb, '{"schemaType":"Organization"}'::jsonb, '{"weight_kb":0,"affects_lcp":true}'::jsonb, 'active', '1.0.0'),

  ('media.video', 'ویدیو', 'پخش‌کنندهٔ ویدیو با پوستر.', 'media',
   '{"assetId":{"type":"asset","required":true},"posterAssetId":{"type":"asset"},"caption":{"type":"string"},"controls":{"type":"boolean","default":true},"autoplay":{"type":"boolean","default":false},"loop":{"type":"boolean","default":false},"muted":{"type":"boolean","default":true}}'::jsonb,
   '{}'::jsonb, '{"captionsRequired":true,"noAutoplayWithSound":true}'::jsonb,
   '{"schemaType":"VideoObject"}'::jsonb,
   '{"weight_kb":0,"affects_lcp":false,"loadingStrategy":"on-interaction","note":"پیش‌بارگذاری نمی‌شود؛ فایل فقط با درخواست کاربر می‌آید."}'::jsonb,
   'active', '1.0.0'),

  ('navigation.breadcrumb', 'مسیر راهنما', 'مسیر ناوبری صفحه.', 'navigation',
   '{"items":{"type":"array","required":true,"items":"object","fields":{"label":"string","href":"url"}}}'::jsonb,
   '{}'::jsonb, '{"navLandmark":"breadcrumb"}'::jsonb,
   '{"schemaType":"BreadcrumbList","contributesToStructure":true}'::jsonb, '{"weight_kb":1}'::jsonb, 'active', '1.0.0'),

  ('navigation.tabs', 'زبانه‌ها', 'تبدیل محتوا میان چند بخش.', 'navigation',
   '{"items":{"type":"array","required":true,"items":"object","fields":{"label":"string","anchor":"string"}},"style":{"type":"enum","enum":["pill","underline","segment"],"default":"pill"}}'::jsonb,
   '{}'::jsonb, '{"tabSemantics":true,"keyboardOperable":true,"roles":["tablist","tab","tabpanel"]}'::jsonb,
   '{}'::jsonb, '{"weight_kb":2}'::jsonb, 'active', '1.0.0'),

  ('navigation.toc', 'فهرست مطالب', 'فهرست پیوندی بخش‌های صفحه.', 'navigation',
   '{"title":{"type":"string","default":"در این صفحه"},"depth":{"type":"enum","enum":["2","3"],"default":"2"}}'::jsonb,
   '{}'::jsonb, '{"navLandmark":"toc"}'::jsonb, '{"contributesToStructure":true}'::jsonb, '{"weight_kb":1}'::jsonb, 'active', '1.0.0'),

  ('data.business_list', 'فهرست کسب‌وکارها', 'فهرست زندهٔ کسب‌وکارها بر پایهٔ فیلتر.', 'data',
   '{"businessTypeKey":{"type":"string"},"industryKey":{"type":"string"},"locationId":{"type":"string"},"limit":{"type":"number","default":6},"layout":{"type":"enum","enum":["grid","list","carousel"],"default":"grid"},"title":{"type":"string"}}'::jsonb,
   '{}'::jsonb, '{"heading":true,"headingLevel":"h2"}'::jsonb,
   '{"schemaType":"ItemList","dynamic":true}'::jsonb,
   '{"weight_kb":2,"queriesDatabase":true,"note":"خروجی با کش لایه‌ای همراه است (Addendum §2)."}'::jsonb, 'active', '1.0.0'),

  ('data.content_list', 'فهرست محتوا', 'آخرین محتوای منتشرشده بر پایهٔ دسته.', 'data',
   '{"categorySlug":{"type":"string"},"kind":{"type":"string"},"limit":{"type":"number","default":6},"layout":{"type":"enum","enum":["grid","list"],"default":"grid"},"title":{"type":"string"}}'::jsonb,
   '{}'::jsonb, '{"heading":true,"headingLevel":"h2"}'::jsonb,
   '{"schemaType":"ItemList","dynamic":true}'::jsonb, '{"weight_kb":2,"queriesDatabase":true}'::jsonb, 'active', '1.0.0'),

  ('data.search_box', 'جعبهٔ جست‌وجو', 'ورودی جست‌وجو با پیشنهاد.', 'data',
   '{"placeholder":{"type":"string","default":"جست‌وجو در PETAVU"},"scope":{"type":"enum","enum":["all","business","content","listing"],"default":"all"},"compact":{"type":"boolean","default":false}}'::jsonb,
   '{}'::jsonb, '{"searchLandmark":true,"labelRequired":true,"role":"search"}'::jsonb,
   '{"schemaType":"SearchAction"}'::jsonb, '{"weight_kb":3,"queriesDatabase":true}'::jsonb, 'active', '1.0.0'),

  ('data.price_table', 'جدول قیمت محصولات', 'قیمت و مشخصات محصولات.', 'data',
   '{"productIds":{"type":"array","items":"string"},"limit":{"type":"number","default":4}}'::jsonb,
   '{}'::jsonb, '{"tableSemantics":true}'::jsonb, '{"schemaType":"Product"}'::jsonb, '{"weight_kb":3,"queriesDatabase":true}'::jsonb, 'active', '1.0.0'),

  ('form.contact_form', 'فرم تماس', 'فرم عمومی تماس با بررسی ضدربات.', 'form',
   '{"title":{"type":"string"},"fields":{"type":"array","items":"string","default":["name","phone","message"]},"submitLabel":{"type":"string","default":"ارسال"},"successMessage":{"type":"string"}}'::jsonb,
   '{}'::jsonb, '{"labelRequired":true,"errorAnnounce":true,"minTouchTarget":44}'::jsonb, '{}'::jsonb,
   '{"weight_kb":3,"rateLimited":true}'::jsonb, 'active', '1.0.0'),

  ('form.lead_form', 'فرم درخواست', 'درخواست قیمت یا مشاوره.', 'form',
   '{"title":{"type":"string"},"fields":{"type":"array","items":"string","default":["name","phone","need"]},"submitLabel":{"type":"string","default":"ارسال درخواست"},"privacyNote":{"type":"string"}}'::jsonb,
   '{}'::jsonb, '{"labelRequired":true,"errorAnnounce":true}'::jsonb, '{}'::jsonb,
   '{"weight_kb":3,"rateLimited":true,"createsLead":true}'::jsonb, 'active', '1.0.0'),

  ('form.newsletter', 'عضویت خبرنامه', 'ثبت ایمیل یا موبایل برای خبرنامه.', 'form',
   '{"title":{"type":"string"},"placeholder":{"type":"string","default":"نشانی ایمیل"},"consentText":{"type":"string","required":true},"submitLabel":{"type":"string","default":"عضویت"}}'::jsonb,
   '{}'::jsonb, '{"labelRequired":true,"consentRequired":true}'::jsonb, '{}'::jsonb,
   '{"weight_kb":2,"rateLimited":true}'::jsonb, 'active', '1.0.0'),

  ('social.review_list', 'نظرات', 'نظرات تأییدشده با امتیاز.', 'social',
   '{"source":{"type":"enum","enum":["internal","google","mixed"],"default":"internal"},"limit":{"type":"number","default":6},"title":{"type":"string"}}'::jsonb,
   '{}'::jsonb, '{"heading":true,"headingLevel":"h2"}'::jsonb,
   '{"schemaType":"AggregateRating"}'::jsonb, '{"weight_kb":2,"queriesDatabase":true}'::jsonb, 'active', '1.0.0'),

  ('social.share', 'اشتراک‌گذاری', 'دکمه‌های اشتراک‌گذاری صفحه.', 'social',
   '{"channels":{"type":"array","items":"string","default":["copy","telegram","whatsapp","linkedin"]},"label":{"type":"string","default":"اشتراک‌گذاری"}}'::jsonb,
   '{}'::jsonb, '{"labelRequired":true,"minTouchTarget":44}'::jsonb, '{}'::jsonb,
   '{"weight_kb":2,"thirdParty":false}'::jsonb, 'active', '1.0.0'),

  ('utility.accordion', 'تاشو', 'بخش‌های بازشو.', 'utility',
   '{"items":{"type":"array","required":true,"items":"object","fields":{"title":"string","text":"longtext","open":"boolean"}}}'::jsonb,
   '{}'::jsonb, '{"disclosureSemantics":true,"keyboardOperable":true}'::jsonb, '{}'::jsonb, '{"weight_kb":2}'::jsonb, 'active', '1.0.0'),

  ('utility.divider', 'جداکننده', 'خط جداکنندهٔ بخش‌ها.', 'utility',
   '{"spacing":{"type":"enum","enum":["sm","md","lg"],"default":"md"},"style":{"type":"enum","enum":["solid","dashed"],"default":"solid"}}'::jsonb,
   '{}'::jsonb, '{"decorative":true}'::jsonb, '{}'::jsonb, '{"weight_kb":1}'::jsonb, 'active', '1.0.0'),

  ('utility.spacer', 'فاصله', 'فاصلهٔ عمودی.', 'utility',
   '{"size":{"type":"enum","enum":["sm","md","lg","xl"],"default":"md"},"showOn":{"type":"enum","enum":["all","mobile","desktop"],"default":"all"}}'::jsonb,
   '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{"weight_kb":1}'::jsonb, 'active', '1.0.0'),

  ('utility.anchor_nav', 'ناوبری چسبان', 'ناوبری بخش‌ها که هنگام اسکرول می‌چسبد.', 'utility',
   '{"items":{"type":"array","items":"object","fields":{"label":"string","anchor":"string"}},"offset":{"type":"number","default":72}}'::jsonb,
   '{}'::jsonb, '{"navLandmark":true,"keyboardOperable":true}'::jsonb, '{}'::jsonb, '{"weight_kb":2}'::jsonb, 'active', '1.0.0'),

  ('commerce.product_grid', 'شبکهٔ محصولات', 'محصولات فروشگاه با قیمت.', 'commerce',
   '{"categoryId":{"type":"string"},"limit":{"type":"number","default":8},"columns":{"type":"enum","enum":["2","3","4"],"default":"3"},"showPrice":{"type":"boolean","default":true}}'::jsonb,
   '{}'::jsonb, '{"heading":true,"headingLevel":"h2"}'::jsonb,
   '{"schemaType":"ItemList"}'::jsonb, '{"weight_kb":3,"queriesDatabase":true}'::jsonb, 'active', '1.0.0'),

  ('commerce.cart_button', 'دکمهٔ سبد خرید', 'نمایش وضعیت سبد خرید.', 'commerce',
   '{"label":{"type":"string","default":"سبد خرید"},"showCount":{"type":"boolean","default":true}}'::jsonb,
   '{}'::jsonb, '{"labelRequired":true,"minTouchTarget":44}'::jsonb, '{}'::jsonb,
   '{"weight_kb":2,"requiresClientJs":true,"note":"تنها کامپوننتی که کد کلاینت لازم دارد؛ برای شمارندهٔ زنده."}'::jsonb,
   'active', '1.0.0')
on conflict (key) do update
  set name_fa = excluded.name_fa,
      description = excluded.description,
      category = excluded.category,
      props_schema = excluded.props_schema,
      slots = excluded.slots,
      a11y = excluded.a11y,
      seo = excluded.seo,
      performance = excluded.performance,
      status = excluded.status;

-- ================================================================== قالب صفحات
insert into design.page_template (key, name_fa, description, business_type_keys, page_keys, tree, sort_order)
values
  ('business_default', 'قالب پیش‌فرض کسب‌وکار', 'صفحهٔ اصلی معرفی‌کننده: سرصفحه، خدمات، درباره، تماس.', '{}',
   array['home', 'about', 'services', 'contact'],
   '{"version":1,"root":[{"id":"hero-1","component":"content.hero","props":{"title":"{business_name}","subtitle":"{tagline}","primaryCta":{"label":"تماس","href":"/contact"},"layout":"split"}},{"id":"grid-1","component":"layout.grid","props":{"columns":"3"},"slots":{"default":[{"id":"feat-1","component":"content.feature_grid","props":{"items":[],"columns":"3"}}]}},{"id":"cta-1","component":"content.cta_banner","props":{"title":"آمادهٔ همکاری هستیم","cta":{"label":"تماس با ما","href":"/contact"},"tone":"brand"}}]}'::jsonb,
   10),
  ('clinic_default', 'قالب کلینیک', 'برای کلینیک و بیمارستان: خدمات درمانی، تیم، نوبت‌گیری.', '{"veterinary_clinic","veterinary_hospital","mobile_vet","animal_ambulance","equine_vet"}',
   array['home', 'about', 'services', 'team', 'contact', 'booking'],
   '{"version":1,"root":[{"id":"hero-1","component":"content.hero","props":{"title":"درمان تخصصی {type_name}","subtitle":"{tagline}","primaryCta":{"label":"نوبت‌گیری","href":"/booking"},"secondaryCta":{"label":"خدمات","href":"#services"},"layout":"split"}},{"id":"sec-services","component":"layout.section","props":{"title":"خدمات ما","anchor":"services"},"slots":{"default":[{"id":"fg-1","component":"content.feature_grid","props":{"items":[],"columns":"3"}}]}},{"id":"sec-faq","component":"layout.section","props":{"title":"پرسش‌های متداول"},"slots":{"default":[{"id":"faq-1","component":"content.faq","props":{"items":[]}}]}},{"id":"contact-1","component":"content.contact_block","props":{"showHours":true,"showMap":true,"title":"تماس و آدرس"}}]}'::jsonb,
   20),
  ('shop_default', 'قالب پت‌شاپ', 'برای فروشگاه‌ها: محصولات، دسته‌ها، پیشنهاد ویژه.', '{"pet_shop","aquarium_shop","pet_supplies_wholesale","pet_grooming_products","veterinary_equipment"}',
   array['home', 'about', 'products', 'contact'],
   '{"version":1,"root":[{"id":"hero-1","component":"content.hero","props":{"title":"{business_name}","subtitle":"{tagline}","primaryCta":{"label":"فروشگاه","href":"/products"},"layout":"overlay"}},{"id":"sec-products","component":"layout.section","props":{"title":"پرفروش‌ترها"},"slots":{"default":[{"id":"pg-1","component":"commerce.product_grid","props":{"limit":8,"columns":"4","showPrice":true}}]}},{"id":"sec-usps","component":"layout.grid","props":{"columns":"3"},"slots":{"default":[{"id":"fg-1","component":"content.feature_grid","props":{"items":[],"columns":"3"}}]}},{"id":"contact-1","component":"content.contact_block","props":{"showHours":true,"showMap":false,"title":"تماس با ما"}}]}'::jsonb,
   30),
  ('equine_default', 'قالب باشگاه سوارکاری', 'برای باشگاه، مرکز پرورش و خدمات اسب.', '{"equine_center","equine_vet","farrier","breeder"}',
   array['home', 'about', 'services', 'gallery', 'contact'],
   '{"version":1,"root":[{"id":"hero-1","component":"content.hero","props":{"title":"{business_name}","subtitle":"{tagline}","primaryCta":{"label":"تماس","href":"/contact"},"layout":"overlay"}},{"id":"gal-1","component":"media.gallery","props":{"items":[],"columns":"3","lightbox":true}},{"id":"sec-services","component":"layout.section","props":{"title":"خدمات"},"slots":{"default":[{"id":"fg-1","component":"content.feature_grid","props":{"items":[],"columns":"2"}}]}},{"id":"contact-1","component":"content.contact_block","props":{"showHours":true,"showMap":true}}]}'::jsonb,
   40),
  ('content_hub', 'قالب هاب محتوا', 'صفحهٔ فهرست مقالات و راهنماها.', '{}',
   array['home'],
   '{"version":1,"root":[{"id":"hero-1","component":"content.hero","props":{"title":"راهنما و مقالات","subtitle":"دانش کاربردی صنف","layout":"centered"}},{"id":"list-1","component":"data.content_list","props":{"limit":12,"layout":"grid","title":"تازه‌ترین‌ها"}}]}'::jsonb,
   50)
on conflict (key) do update
  set name_fa = excluded.name_fa,
      description = excluded.description,
      business_type_keys = excluded.business_type_keys,
      page_keys = excluded.page_keys,
      tree = excluded.tree,
      sort_order = excluded.sort_order;

-- ================================================================== قالب‌های سئو
insert into seo.template (business_id, key, entity_kind, subtype, title_template, description_template, slug_template, priority) values
  (null, 'home.platform', 'home', null, '{site} {sep} شبکهٔ کسب‌وکار حیوانات خانگی و اسب',
   'پروفایل کسب‌وکارهای صنف حیوانات خانگی و اسب: کلینیک، پت‌شاپ، آموزش، دامداری و خدمات تخصصی.', null, 100),
  (null, 'business.default', 'business', null, '{name} {sep} {city} {sep} {site}',
   '{summary}', '/b/{slug}', 100),
  (null, 'business.type', 'business_type', null, '{type_plural} در {city} {sep} {site}',
   'فهرست {type_plural} فعال در {city} با اطلاعات تماس، آدرس و خدمات.', '/t/{type_slug}', 90),
  (null, 'business.industry', 'industry', null, '{industry_name} {sep} کسب‌وکارهای صنف {sep} {site}',
   'کسب‌وکارهای فعال در حوزهٔ {industry_name}؛ پروفایل، تماس و خدمات.', '/i/{industry_slug}', 90),
  (null, 'business.city', 'location', null, 'کسب‌وکارهای صنف حیوانات در {city_name} {sep} {site}',
   'فهرست کسب‌وکارهای فعال صنف حیوانات خانگی و اسب در {city_name}.', '/l/{location_slug}', 90),
  (null, 'content.article', 'content', 'article', '{title} {sep} {site}',
   '{summary}', '/c/{slug}', 100),
  (null, 'content.guide', 'content', 'guide', '{title} {sep} راهنمای {site}',
   '{summary}', '/g/{slug}', 100),
  (null, 'content.service', 'content', 'service', '{title} {sep} {business_name}',
   '{summary}', '/s/{slug}', 100),
  (null, 'content.faq', 'content', 'faq', 'پرسش‌های متداول {sep} {business_name}',
   '{summary}', '/faq/{slug}', 100),
  (null, 'category.content', 'category', null, '{category_name} {sep} {site}',
   'مقالات و راهنماهای دستهٔ {category_name}.', '/k/{category_slug}', 80),
  (null, 'search.query', 'search', null, 'جست‌وجوی «{query}» {sep} {site}',
   'نتایج جست‌وجوی «{query}» در کسب‌وکارها و محتوای {site}.', null, 60)
on conflict (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), key) do update
  set entity_kind = excluded.entity_kind,
      subtype = excluded.subtype,
      title_template = excluded.title_template,
      description_template = excluded.description_template,
      slug_template = excluded.slug_template,
      priority = excluded.priority;

-- ================================================================== تنظیمات سئو (سراسری)
insert into seo.settings (business_id, title_separator, title_template, default_locale, default_region, indexing_enabled, environment)
values (null, '|', '{page} {sep} {site}', 'fa-IR', 'IR', false, 'development')
on conflict do nothing;

-- ================================================================== گراف موجودیت: لنگر برند
insert into seo.entity (kind, key, name_fa, name_en, description, is_brand_anchor, aliases, external_refs)
values ('brand', 'petavu', 'پت‌آوو', 'PETAVU',
  'شبکهٔ کسب‌وکار صنف حیوانات خانگی و اسب؛ پروفایل، ابزار کار و ارتباط حرفه‌ای.', true,
  array['پت آوو','پتاوو','PETAVU','Petavu'],
  '{"schema":"Organization"}'::jsonb)
on conflict (kind, key) do update
  set name_fa = excluded.name_fa, name_en = excluded.name_en, description = excluded.description;

-- موجودیت‌های پایهٔ دانشی
insert into seo.entity (kind, key, name_fa, aliases, external_refs) values
  ('animal', 'dog', 'سگ', array['سگ','canine','Canis lupus familiaris'], '{"schema":"Thing"}'::jsonb),
  ('animal', 'cat', 'گربه', array['گربه','feline','Felis catus'], '{"schema":"Thing"}'::jsonb),
  ('animal', 'bird', 'پرنده', array['پرنده','طوطی','قناری'], '{"schema":"Thing"}'::jsonb),
  ('animal', 'fish', 'ماهی', array['ماهی','آبزیان'], '{"schema":"Thing"}'::jsonb),
  ('animal', 'reptile', 'خزنده', array['خزنده','مار','لاک‌پشت'], '{"schema":"Thing"}'::jsonb),
  ('animal', 'horse', 'اسب', array['اسب','equine'], '{"schema":"Thing"}'::jsonb),
  ('animal', 'livestock', 'دام', array['دام','گاو','گوسفند','بز'], '{"schema":"Thing"}'::jsonb),
  ('animal', 'poultry', 'طیور', array['مرغ','طیور','بوقلمون'], '{"schema":"Thing"}'::jsonb),
  ('service', 'vaccination', 'واکسیناسیون', array['واکسن','ایمن‌سازی'], '{"schema":"Service"}'::jsonb),
  ('service', 'grooming', 'آرایش و شست‌وشو', array['آرایشگاه','شامپو'], '{"schema":"Service"}'::jsonb),
  ('service', 'boarding', 'پانسیون', array['پانسیون','هتل حیوانات'], '{"schema":"Service"}'::jsonb),
  ('service', 'training', 'آموزش', array['تربیت','آموزش'], '{"schema":"Service"}'::jsonb),
  ('service', 'surgery', 'جراحی', array['عمل','جراحی'], '{"schema":"Service"}'::jsonb),
  ('service', 'grooming_mobile', 'آرایش سیار', array['آرایش در محل'], '{"schema":"Service"}'::jsonb),
  ('condition', 'dental_disease', 'بیماری دندان', array['جرم دندان','التهاب لثه'], '{"schema":"MedicalCondition"}'::jsonb),
  ('condition', 'obesity', 'چاقی', array['اضافه وزن'], '{"schema":"MedicalCondition"}'::jsonb),
  ('condition', 'parasites', 'انگل', array['کک','کنه','کرم'], '{"schema":"MedicalCondition"}'::jsonb),
  ('condition', 'lameness', 'لنگش', array['لنگش اسب','کوریسم'], '{"schema":"MedicalCondition"}'::jsonb)
on conflict (kind, key) do update
  set name_fa = excluded.name_fa, aliases = excluded.aliases;

-- اتصال موجودیت برند به موجودیت‌های پایه
insert into seo.entity_link (from_entity_id, to_entity_id, relation, weight)
select b.id, e.id, 'related_to', 50
from seo.entity b
cross join seo.entity e
where b.is_brand_anchor and e.kind <> 'brand'
on conflict do nothing;

-- ================================================================== رجیستری امکانات
-- منبع حقیقت امکانات سامانه، با چرخهٔ عمر و بودجهٔ عملکرد (Addendum §21–24).
insert into ops.feature (key, name_fa, description, layer, status, dependencies, performance_budget, seo_metadata, search_metadata, wiring, since_version)
values
  ('identity.account', 'حساب کاربری', 'ثبت‌نام، ورود، نشست، دستگاه، تأیید دومرحله‌ای و بازیابی.', 'platform', 'development',
   array[]::text[],
   '{"api_p95_ms":300,"page_weight_kb":120}'::jsonb,
   '{"noindex_paths":["/login","/register","/reset"]}'::jsonb,
   '{}'::jsonb,
   '{"permissions":[],"events":["user.created","user.login","user.login_failed","user.mfa_enabled"],"rate_limits":["login_account","login_ip","mfa_verify","step_up"]}'::jsonb,
   '1.0.0'),

  ('business.profile', 'پروفایل کسب‌وکار', 'کسب‌وکار، پروفایل، مکان، تماس، تأیید و صفحهٔ عمومی.', 'business', 'development',
   array['identity.account'],
   '{"lcp_ms":2500,"cls":0.05,"page_weight_kb":900,"api_p95_ms":400}'::jsonb,
   '{"schema":"LocalBusiness","indexable":true,"title_template":"business.default","sitemap":"business"}'::jsonb,
   '{"document":"business","fields":["name","summary","industry","city"],"boost":{"name":3,"city":1}}'::jsonb,
   '{"permissions":["business.create","business.update","business.publish","business.contact.manage"],"events":["business.created","business.published","business.updated","business.verification_requested","business.verification_decided"],"automations":["business.welcome","business.verification_reminder"],"notifications":["business.verified"]}'::jsonb,
   '1.0.0'),

  ('business.members', 'اعضا و نقش‌ها', 'دعوت، نقش سفارشی، ماتریس مجوز و انتقال مالکیت.', 'business', 'development',
   array['identity.account','business.profile'],
   '{"api_p95_ms":350}'::jsonb,
   '{"noindex_paths":["/panel/members"]}'::jsonb,
   '{}'::jsonb,
   '{"permissions":["business.member.invite","business.member.manage","business.role.manage","business.transfer.initiate"],"events":["member.invited","member.joined","member.removed","ownership.transfer_requested","ownership.transferred"],"audit":["membership.*","ownership_transfer.*"]}'::jsonb,
   '1.0.0'),

  ('content.core', 'محتوا و بلوک‌ها', 'چرخهٔ عمر محتوا، بلوک‌های ساختاریافته و بازبینی.', 'business', 'development',
   array['business.profile','media.library'],
   '{"api_p95_ms":450,"page_weight_kb":700}'::jsonb,
   '{"schema":"Article","indexable":true,"title_template":"content.article","sitemap":"content"}'::jsonb,
   '{"document":"content","fields":["title","summary","body_text"],"boost":{"title":3,"summary":1}}'::jsonb,
   '{"permissions":["content.create","content.update","content.publish","content.review"],"events":["content.created","content.submitted","content.approved","content.published","content.unpublished"],"automations":["content.review_reminder"],"jobs":["seo.metadata_rebuild","search.index_content"]}'::jsonb,
   '1.0.0'),

  ('media.library', 'کتابخانهٔ رسانه', 'بارگذاری امن، مشتقات تصویر، آلبوم و فراداده.', 'business', 'development',
   array['identity.account'],
   '{"api_p95_ms":600,"upload_max_mb":25,"image_variants":["thumb","small","medium","large","og"],"formats":["jpeg","png","webp","avif"]}'::jsonb,
   '{"alt_required":true,"sitemap":"image"}'::jsonb,
   '{"document":"asset","fields":["alt_text","caption"]}'::jsonb,
   '{"permissions":["media.upload","media.manage"],"events":["media.uploaded","media.processed","media.quarantined"],"jobs":["media.optimize","media.variants"]}'::jsonb,
   '1.0.0'),

  ('design.studio', 'استودیوی طراحی', 'توکن، تم، صفحه، Registry، پیش‌نمایش و خط لولهٔ انتشار.', 'business', 'development',
   array['business.profile','media.library'],
   '{"api_p95_ms":500,"builder_js_kb":180}'::jsonb,
   '{"managed_by":"design.pipeline","audited":true}'::jsonb,
   '{}'::jsonb,
   '{"permissions":["design.view","design.manage","design.publish","design.rollback"],"events":["design.page_updated","design.release_created","design.published","design.rolled_back"],"pipeline":["change","validate","security","database","api","performance","a11y","seo","structured_data","search","sitemap","ai","automation","preview","approval","publish","monitor","audit"]}'::jsonb,
   '1.0.0'),

  ('seo.engine', 'موتور سئو', 'متادیتا، دادهٔ ساختاریافته، کانونیکال، تغییر مسیر، نقشهٔ سایت و ایندکس.', 'platform', 'development',
   array['content.core','business.profile','design.studio'],
   '{"api_p95_ms":250,"sitemap_build_ms":3000}'::jsonb,
   '{"owns":["templates","metadata","structured_data","canonical","redirect","sitemap","robots"]}'::jsonb,
   '{}'::jsonb,
   '{"permissions":["seo.manage","seo.redirect.manage","seo.audit.run"],"events":["seo.metadata_updated","seo.audit_completed","seo.sitemap_built","seo.index_submitted"],"jobs":["seo.metadata_rebuild","seo.sitemap_build","seo.index_submit","seo.audit_run"]}'::jsonb,
   '1.0.0'),

  ('search.core', 'جست‌وجو', 'جست‌وجوی قابل تعویض با آداپتور؛ از PostgreSQL تا موتورهای تخصصی.', 'platform', 'development',
   array['content.core','business.profile'],
   '{"api_p95_ms":200,"result_limit_max":100}'::jsonb,
   '{"noindex_paths":["/search"]}'::jsonb,
   '{"driver":"postgres","adapters":["postgres","opensearch","elasticsearch","meilisearch"],"documents":["business","content","asset"]}'::jsonb,
   '{"jobs":["search.reindex"]}'::jsonb,
   '1.0.0'),

  ('automation.engine', 'موتور خودکارسازی', 'قاعده WHEN→IF→THEN، گردش‌کار، صف و دفتر اجرا.', 'platform', 'draft',
   array['ops.jobs'],
   '{"api_p95_ms":300,"execution_p95_ms":2000}'::jsonb, '{}'::jsonb, '{}'::jsonb,
   '{"permissions":["platform.automation.manage"],"events":["automation.rule_triggered","automation.rule_failed"],"jobs":["automation.run"]}'::jsonb,
   '1.0.0'),

  ('ops.jobs', 'صف کار', 'کار پس‌زمینه با claim، تلاش دوباره، صف مرده و پایش.', 'platform', 'development',
   array[]::text[],
   '{"claim_p95_ms":100,"max_attempts":5}'::jsonb, '{}'::jsonb, '{}'::jsonb,
   '{"permissions":["platform.job.manage","platform.job.observe"],"events":["job.failed","job.dead"]}'::jsonb,
   '1.0.0'),

  ('ops.audit', 'حسابرسی', 'رد غیرقابل‌ویرایش عملیات حساس، با رخداد امنیتی.', 'platform', 'development',
   array[]::text[],
   '{"write_p95_ms":50}'::jsonb, '{}'::jsonb, '{}'::jsonb,
   '{"permissions":["platform.audit.view","platform.security.manage"],"events":["security.event_recorded"]}'::jsonb,
   '1.0.0'),

  ('ops.feature_registry', 'رجیستری امکانات', 'منبع حقیقت امکانات، چرخهٔ عمر، وابستگی و بودجه.', 'platform', 'development',
   array[]::text[],
   '{"api_p95_ms":150}'::jsonb, '{}'::jsonb, '{}'::jsonb,
   '{"permissions":["platform.feature.manage"]}'::jsonb,
   '1.0.0'),

  ('observability.rum', 'سنجش تجربهٔ واقعی', 'نمونهٔ LCP/INP/CLS از مرورگر، rollup و تشخیص پس‌رفت.', 'platform', 'draft',
   array['ops.jobs'],
   '{"beacon_kb":2,"sample_rate":0.1}'::jsonb, '{}'::jsonb, '{}'::jsonb,
   '{"jobs":["rum.rollup","rum.regression_scan"]}'::jsonb,
   '1.0.0'),

  ('shop.commerce', 'فروشگاه', 'محصول، موجودی تراکنشی، سفارش و تخفیف روی همان هسته.', 'shop', 'draft',
   array['business.profile','media.library','ops.jobs'],
   '{"api_p95_ms":500,"lcp_ms":2500}'::jsonb,
   '{"schema":"Product","indexable":true,"sitemap":"content"}'::jsonb,
   '{"document":"product","fields":["name","sku","category"]}'::jsonb,
   '{"permissions":["shop.product.manage","shop.order.manage","shop.discount.manage"],"events":["order.created","order.paid","order.shipped","stock.low"],"jobs":["shop.stock_recount"]}'::jsonb,
   '1.0.0')
on conflict (key) do update
  set name_fa = excluded.name_fa,
      description = excluded.description,
      layer = excluded.layer,
      dependencies = excluded.dependencies,
      performance_budget = excluded.performance_budget,
      seo_metadata = excluded.seo_metadata,
      search_metadata = excluded.search_metadata,
      wiring = excluded.wiring;

-- ================================================================== نگهداشت داده (§132)
-- «حذف نرم» و «نگهداشت» دو چیزند: اولی می‌گوید کاربر دیگر نمی‌بیند، دومی
-- می‌گوید داده چند وقت می‌ماند و بعد چه می‌شود. سیاست‌ها دامنه‌محورند، نه
-- جدول‌محور؛ چون جدول‌ها با هر بازآرایی اسکیما عوض می‌شوند ولی دامنه نه.
insert into ops.retention_policy (scope, name_fa, retain_days, action, description) values
  ('audit.security', 'رخداد امنیتی', 730, 'archive',
   'دو سال نگه داشته می‌شود؛ برای رسیدگی به رخداد و تحلیل زنجیره‌ای لازم است.'),
  ('auth.login_attempts', 'تلاش‌های ورود', 180, 'delete',
   'شش ماه برای تشخیص حملهٔ تدریجی کافی است و پس از آن، خودش دادهٔ حساس است.'),
  ('auth.sessions', 'نشست‌های بسته‌شده', 90, 'delete',
   'نشست منقضی یا باطل‌شده، پس از سه ماه حذف می‌شود.'),
  ('ops.job_attempts', 'دفتر تلاش صف', 120, 'delete',
   'چهار ماه سابقهٔ تلاش برای عیب‌یابی؛ کهنه‌تر از آن فقط حجم است.'),
  ('seo.indexing_events', 'رخداد ایندکس', 400, 'archive',
   'برای تحلیل روند ایندکس‌شدن نگه داشته می‌شود.'),
  ('ops.webhook_deliveries', 'تحویل‌های وبهوک', 90, 'delete',
   'سه ماه سابقهٔ تحویل، برای بازپخش و پیگیری مشتری.'),
  ('content.deleted', 'محتوای حذف‌نرم‌شده', 365, 'anonymize',
   'یک سال فرصت بازیابی؛ پس از آن، هویت پدیدآورنده و پیوست‌ها بی‌نام می‌شوند.')
on conflict (scope) do update
  set name_fa = excluded.name_fa,
      retain_days = excluded.retain_days,
      action = excluded.action,
      description = excluded.description;

-- ---------------------------------------------------------------------------
-- بودجهٔ عملکرد پایه (Addendum §1–۴)
--
-- این اعداد «آرزو» نیستند؛ سقف‌اند. صفحه‌ای که از این‌ها بگذرد، در دروازهٔ
-- انتشار رد می‌شود. هر الگوی مسیر که در سایت هست، باید اینجا بودجه داشته
-- باشد — مسیر بی‌بودجه یعنی مسیری که هیچ‌کس اندازه‌اش نمی‌گیرد، و این دقیقاً
-- همان چیزی است که در گام ۱۴ به‌عنوان باگ پیدا شد.
-- ---------------------------------------------------------------------------
insert into ops.page_budget (
  route_pattern, scope, name_fa, lcp_ms, inp_ms, cls, ttfb_ms, weight_kb, request_count, api_p95_ms, rum_sample_rate, notes
) values
  ('/',                     'platform', 'صفحهٔ اصلی',              1800, 150, 0.05, 600,  900,  60, 300, 0.20, 'LCP سخت‌گیرانه: تصویر اصلی eager و preload'),
  ('/b/:slug',              'platform', 'پروفایل کسب‌وکار',        2200, 200, 0.08, 700, 1200,  70, 350, 0.20, 'اولین تصویر کسب‌وکار، عنصر LCP است'),
  ('/blog/:slug',           'platform', 'مقاله',                  2500, 200, 0.10, 800, 1200,  70, 400, 0.10, 'متن بلند؛ فونت زیرمجموعه و preload محدود'),
  ('/search',               'platform', 'جست‌وجو',                2000, 250, 0.08, 700, 1000,  65, 450, 0.10, 'نتیجهٔ اول باید از سرور بیاید'),
  ('/membership',           'platform', 'عضویت',                   2000, 150, 0.05, 700, 1000,  50, 300, 0.10, null),
  ('/join',                 'platform', 'ثبت‌نام',                 2000, 150, 0.05, 700,  950,  45, 300, 0.10, null),
  ('/auth/:step',           'platform', 'ورود و احراز',            1800, 150, 0.05, 600,  850,  40, 300, 0.00, 'بدون نمونه‌گیری RUM: مسیر احراز هویت'),
  ('/panel',                'business', 'داشبورد پنل',             1800, 200, 0.05, 600, 1100,  55, 350, 0.05, null),
  ('/panel/:section',       'business', 'بخش‌های پنل',             2500, 300, 0.10, 800, 1600,  90, 450, 0.05, 'جدول‌ها با صفحه‌بندی نشانگر (cursor)'),
  ('/design-studio',        'business', 'استودیو طراحی',           2500, 350, 0.10, 800, 1800, 100, 500, 0.05, 'ویرایشگر، سنگین‌تر؛ بارگذاری مرحله‌ای'),
  ('/shop/:slug',           'shop',     'فروشگاه',                 2200, 200, 0.08, 700, 1300,  75, 400, 0.10, null),
  ('/cart',                 'shop',     'سبد خرید',                1800, 200, 0.05, 600,  900,  50, 350, 0.10, null),
  ('/admin',                'admin',    'داشبورد ادمین',           2000, 250, 0.08, 700, 1300,  70, 400, 0.00, null),
  ('/admin/:section',       'admin',    'بخش‌های ادمین',           2500, 300, 0.10, 800, 1600,  90, 450, 0.00, null)
on conflict (scope, route_pattern) do nothing;

-- حداقل یک قاعدهٔ سیستمی: نگهبان رخداد دروازهٔ انتشار.
insert into ops.automation_rule (key, name_fa, description, event_type, conditions, actions, status, is_system, priority)
values (
  'platform.publish_gate_guard',
  'نگهبان دروازهٔ انتشار',
  'هر تلاش انتشار طراحی را از دروازهٔ انتشار می‌گذراند و در صورت انسداد، به دارندهٔ کسب‌وکار اعلان می‌دهد.',
  'design.publish_requested',
  '{"all":[{"path":"gate","op":"exists"}]}'::jsonb,
  '[{"type":"notify","recipient":"business_owner","kind":"design.publish_blocked","severity":"warning","title":"انتشار طراحی متوقف شد","body":"دروازهٔ انتشار مانع دارد؛ جزئیات در استودیو طراحی.","action_path":"/design-studio"}]'::jsonb,
  'paused',
  true,
  10
)
on conflict do nothing;
