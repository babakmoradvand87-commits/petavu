-- ============================================================================
-- 0003_platform_defaults — تنظیمات پایهٔ پلتفرم
--
-- چرا این‌ها داده‌اند و نه ثابت‌های کد: این‌ها *سیاست* هستند، نه پیاده‌سازی.
-- سیاست باید قابل دیدن، مقایسه و تغییر باشد بی‌آن‌که انتشار کد لازم شود — و
-- در پنل مدیریت، در یک جا دیده شود.
--
-- مرجع: §80–۹۲ (پیکربندی و انتقال‌پذیری)، Addendum §4–۱۹ (تصویر، فونت،
--       حافظهٔ نهان)، §39–۴۲ (robots پویا و محیط‌آگاه)، §56–۷۲ (پایش و
--       هم‌بستگی)، §79 و §152 (راز پیکربندی نیست)، §101 (حفظ داده)
-- ============================================================================

insert into ops.setting (key, value, description, is_secret) values
  -- زبان، منطقه و تقویم. «آماده برای چندزبانه» یعنی همین‌که از روز اول یک
  -- تصمیم داده باشد، نه اینکه رشته‌ها در کد پخش باشند (§123–۱۲۵).
  ('platform.locale', '{
     "default": "fa-IR",
     "fallback": "en",
     "enabled": ["fa-IR"],
     "planned": ["en"],
     "direction": "rtl",
     "calendar": "persian",
     "number_system": "latin",
     "timezone": "Asia/Tehran",
     "week_start": "saturday"
   }'::jsonb,
   'زبان پیش‌فرض، جهت، تقویم، منطقهٔ زمانی و آغاز هفته', false),

  ('platform.brand', '{
     "name": "PETAVU",
     "name_fa": "پتاوو",
     "tagline_fa": "زیرساخت حرفه‌ای کسب‌وکارهای پت و اسب",
     "domain": "petavu.ir",
     "subdomains": ["panel", "adminpanel", "shop", "adminshop"],
     "entity_key": "petavu",
     "locale_default": "fa-IR"
   }'::jsonb,
   'هویت برند و نقشهٔ زیردامنه‌ها؛ پنج سطح مستقل، یک هستهٔ مشترک (§5، قانون ۵)', false),

  -- ثبت‌نامهٔ سرویس‌های بیرونی (Addendum: third-party فقط با purpose/cost/loading).
  -- خالی است و خالی می‌ماند تا کسی آگاهانه ردیف اضافه کند: هر سرویس بیرونی،
  -- هزینهٔ عملکرد و ریسک حریم خصوصی دارد.
  ('platform.third_party', '{
     "policy": "هر سرویس بیرونی باید purpose، cost و loading_strategy داشته باشد",
     "entries": []
   }'::jsonb,
   'ثبت‌نامهٔ سرویس‌های ثالث؛ فهرست بسته، نه یک یادداشت پراکنده', false),

  -- خط لولهٔ تصویر: اعتبارسنجی، فرمت مدرن، و مهم‌تر از همه: تصویر LCP هرگز lazy نمی‌شود.
  ('platform.image_pipeline', '{
     "accepted_mime": ["image/jpeg", "image/png", "image/avif", "image/webp"],
     "verify_signature": true,
     "strip_exif": true,
     "max_bytes": 15000000,
     "max_pixels": 40000000,
     "output_formats": ["avif", "webp"],
     "fallback_format": "webp",
     "widths": [320, 640, 960, 1280, 1600, 1920, 2560],
     "quality": {"avif": 50, "webp": 72},
     "lcp_image_eager": true,
     "reserve_dimensions": true,
     "placeholder": "average_color"
   }'::jsonb,
   'اعتبارسنجی، فرمت، ابعاد و بارگذاری تصویر (Addendum §9–۱۲)', false),

  ('platform.fonts', '{
     "family": "Vazirmatn",
     "format": "woff2",
     "subset": "persian+latin",
     "preload_weights": [400, 700],
     "max_preload": 2,
     "font_display": "swap",
     "self_hosted": true,
     "fallback_metrics_adjusted": true
   }'::jsonb,
   'فونت خودمیزبان، WOFF2، با سقف دو پیش‌بار؛ جایگزین با متریک تنظیم‌شده تا CLS نلرزد', false),

  ('platform.cache', '{
     "html": {"s_maxage": 60, "stale_while_revalidate": 300, "must_revalidate": false},
     "api": {"cache_control": "private, no-store"},
     "static_assets": {"cache_control": "public, max-age=31536000, immutable"},
     "images": {"cache_control": "public, max-age=31536000, immutable"},
     "cdn_ready": true,
     "vary": ["accept-encoding", "accept-language"],
     "purge_on_publish": true
   }'::jsonb,
   'سیاست حافظهٔ نهان چندلایه و آمادگی CDN؛ دارایی نامتغیر با نام درهم', false),

  ('platform.observability', '{
     "request_id_header": "x-request-id",
     "log_level": "info",
     "log_format": "structured-json",
     "slow_query_ms": 200,
     "slow_request_ms": 1000,
     "rum_metrics": ["lcp", "inp", "cls", "ttfb"],
     "error_tracking": "self_hosted",
     "sample_errors": 1.0
   }'::jsonb,
   'لاگ ساخت‌یافته با شناسهٔ درخواست و آستانه‌های هشدار تنگی (§93–۹۵، Addendum §95)', false),

  ('platform.api', '{
     "version": "v1",
     "base_path": "/api/v1",
     "page_size_default": 20,
     "page_size_max": 100,
     "pagination": "cursor",
     "timeout_ms": 15000,
     "error_shape": "structured",
     "openapi_required": true,
     "idempotency_header": "idempotency-key"
   }'::jsonb,
   'قرارداد API: نسخه‌دار، صفحه‌بندی نشانگری، خطای ساختاریافته و کلید ایدمپوتنسی (§64–۷۸)', false),

  ('platform.security', '{
     "session_idle_minutes": 60,
     "session_absolute_days": 30,
     "step_up_minutes": 15,
     "mfa_required_for": ["platform_staff", "business_owner", "ownership_transfer"],
     "password_min_length": 12,
     "password_breach_check": true,
     "argon2": {"memory_kib": 65536, "time_cost": 3, "parallelism": 1},
     "cookie": {"secure": true, "http_only": true, "same_site": "lax", "host_only": true},
     "domain_cookie_broadcast": false,
     "csp": {"mode": "enforce", "report_uri": "/api/v1/security/csp-report"},
     "rate_limit": {"login_per_ip_per_minute": 10, "login_per_account_per_hour": 20, "api_per_token_per_minute": 120},
     "service_role_key_in_browser": false
   }'::jsonb,
   'سیاست امنیتی پایه؛ کوکی میزبان‌محور و بدون پخش روی دامنهٔ مادر (§10، §72، §79)', false),

  ('platform.backup', '{
     "schedule": "daily",
     "retention_days": 30,
     "retention_long_days": 365,
     "encryption": "aes-256",
     "checksum": "sha256",
     "restore_test_required": true,
     "restore_test_interval_days": 30,
     "offsite": true,
     "secrets_included": false
   }'::jsonb,
   'پشتیبان کامل با آزمون بازیابی اجباری؛ پشتیبان بی‌آزمون، پشتیبان نیست (§86–۸۹، §191)', false),

  ('platform.robots', '{
     "dynamic": true,
     "environment_aware": true,
     "index_in_non_production": false,
     "disallow": ["/panel", "/adminpanel", "/design-studio", "/api/", "/cart", "/checkout", "/auth/"],
     "allow_ai_crawlers": true,
     "llms_txt": true,
     "sitemap_index": true,
     "crawl_delay_seconds": 0
   }'::jsonb,
   'robots پویا و محیط‌آگاه؛ محیط غیرتولیدی هرگز ایندکس نمی‌شود (Addendum §39–۴۷)', false),

  ('platform.content', '{
     "default_locale": "fa-IR",
     "min_words_public": 120,
     "require_meta_before_publish": true,
     "require_alt_text": true,
     "slug_max_length": 80,
     "soft_delete_retention_days": 90,
     "moderation_first_publish": true
   }'::jsonb,
   'قواعد محتوای عمومی: پرهیز از محتوای نازک، متادیتای اجباری پیش از انتشار (§44، §46)', false),

  ('platform.rate_limit', '{
     "vitals_per_ip_per_minute": 60,
     "vitals_batch_max": 50,
     "upload_per_user_per_hour": 120,
     "search_per_ip_per_minute": 90,
     "invitation_per_business_per_day": 50,
     "report_per_user_per_day": 20
   }'::jsonb,
   'سقف نرخ مسیرهای پرترافیک؛ همان اعدادی که در API اعمال می‌شوند (§13)', false)
on conflict (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), key)
do update set value = excluded.value, description = excluded.description, is_secret = excluded.is_secret;

-- ---------------------------------------------------------------------------
-- تنظیمات سئوی سراسری.
--
-- در ۰۰۰۱ یک ردیف پایه ساخته شده؛ اینجا سیاست روشن‌تر می‌شود: عنوان، توضیح
-- جانشین، رفتار ایندکس و محیط. «سئو به‌عنوان داده» یعنی همین (§Addendum §39).
-- ---------------------------------------------------------------------------
insert into seo.settings (business_id, title_separator, title_template, description_fallback, default_locale, default_region, indexing_enabled, environment, extra)
values (
  null,
  '|',
  '{page} | PETAVU',
  'پتاوو، زیرساخت حرفه‌ای کسب‌وکارهای پت و اسب: پروفایل، آگهی، فروشگاه و ابزار رشد.',
  'fa-IR',
  'IR',
  -- محیط و ایندکس، از روز اول «تولید» نیست.
  --
  -- نصب تازه، seed را اجرا می‌کند؛ اگر پیش‌فرض «تولید با ایندکس باز» باشد،
  -- ممکن است یک نسخهٔ آزمایشی یا کلون staging پیش از آنکه کسی بفهمد، در
  -- موتور جست‌وجو ایندکس شود. پس پیش‌فرض، محافظه‌کارانه است و بالا بردنش یک
  -- اقدام آگاهانه در استقرار است (همگام با PETAVU_ENVIRONMENT).
  false,
  'development',
  '{
    "knowledge_graph": {"entity_key": "petavu", "type": "Organization"},
    "structured_data": {"default_types": ["Organization", "WebSite", "BreadcrumbList"]},
    "pagination_policy": "self_canonical",
    "trailing_slash": false,
    "lowercase_urls": true,
    "redirect_status_default": 301,
    "indexing": {"allow_ai_crawlers": true, "max_sitemap_urls": 45000}
  }'::jsonb
)
on conflict (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid))
do update set title_separator = excluded.title_separator, title_template = excluded.title_template,
              description_fallback = excluded.description_fallback, default_locale = excluded.default_locale,
              default_region = excluded.default_region, extra = excluded.extra;
-- و `indexing_enabled`/`environment` عمداً در به‌روزرسانی نیستند: این دو،
-- وضعیت استقرارند نه دادهٔ مرجع. اجرای دوبارهٔ seed نباید سایت تولیدی را
-- دوباره «توسعه» کند و ایندکس را ببندد.
