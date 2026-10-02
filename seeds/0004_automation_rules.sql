-- ============================================================================
-- 0004_automation_rules — قاعده‌های سیستمی خودکارسازی
--
-- این‌ها «قاعده‌های پیش‌فرض محصول»‌اند: همان چیزی که یک پلتفرم حرفه‌ای از روز
-- اول باید داشته باشد، ولی به‌شکل داده تا هر کسب‌وکار بتواند ببیندشان، بسنجدشان
-- و کنارشان بگذارد.
--
-- **همه خاموش‌اند** و دلیلش هم صریح است: کارگر (گام ۳۲) هنوز وجود ندارد.
-- قاعدهٔ فعالی که کسی پردازشش نمی‌کند، رخدادهایی می‌سازد که در صف می‌مانند و
-- کسی نمی‌فهمد چرا. خاموش‌بودن، اینجا یعنی «آماده، ولی روشن‌نشده».
--
-- مرجع: Addendum §56–۷۲ (خودکارسازی و اعلان)، §74 (کنش‌های بسته)، §100
-- ============================================================================

insert into ops.automation_rule (
  business_id, key, name_fa, description, event_type, conditions, actions, status, priority,
  cooldown_seconds, max_runs_per_day, is_system
) values
  -- خوش‌آمدگویی: عضو تازه به تیم می‌پیوندد؛ مالک باید بداند.
  (null, 'platform.team_welcome', 'خوش‌آمدگویی عضو تازه',
   'هنگام پیوستن عضو تازه، به دارندهٔ کسب‌وکار اعلان می‌دهد. خاموش است تا کارگر راه بیفتد.',
   'member.joined',
   '{"all":[]}'::jsonb,
   '[{"type":"notify","recipient":"business_owner","kind":"member.joined","severity":"info","title":"عضو تازه به تیم پیوست","body":"یک عضو تازه به کسب‌وکار شما اضافه شد.","action_path":"/panel/team"}]'::jsonb,
   'paused', 50, 0, 0, true),

  -- پس از انتشار محتوا، فراداده و نقشهٔ سایت باید خودشان را به‌روز کنند.
  -- این قاعده، همان زنجیرهٔ Entity→SEO/Search/Sitemap است، ولی به‌صورت داده.
  (null, 'platform.rebuild_seo_after_publish', 'بازسازی سئو پس از انتشار',
   'پس از انتشار محتوا، کار بازسازی فراداده و نقشهٔ سایت را در صف می‌گذارد.',
   'content.published',
   '{"all":[]}'::jsonb,
   '[{"type":"enqueue_job","kind":"seo.metadata_rebuild","dedupe_key":"seo-rebuild","payload":{"source":"content.published"}}]'::jsonb,
   'paused', 60, 0, 0, true),

  -- نگهبان فرادادهٔ دستی: اگر ویرایش دستی محافظت شد، مالک باید بداند که
  -- فراداده‌اش بازنویسی نشده است.
  (null, 'platform.manual_metadata_notice', 'اطلاع ویرایش دستی فراداده',
   'وقتی فرادادهٔ دستی محافظت می‌شود و بازنویسی نمی‌گردد، به مالک اطلاع می‌دهد.',
   'seo.metadata_skipped_manual',
   '{"all":[]}'::jsonb,
   '[{"type":"notify","recipient":"business_owner","kind":"seo.metadata_manual_kept","severity":"info","title":"فرادادهٔ دستی شما حفظ شد","body":"سامانه فرادادهٔ دستی را بازنویسی نکرد.","action_path":"/panel/seo"}]'::jsonb,
   'paused', 70, 3600, 5, true),

  -- تغییر وضعیت فیچر: تصمیمی است که کارکنان پلتفرم باید ببینند.
  (null, 'platform.feature_status_watch', 'پایش تغییر وضعیت فیچر',
   'هر تغییر وضعیت در رجیستری فیچر را به دارندهٔ کسب‌وکارهای مرتبط اطلاع می‌دهد.',
   'feature.status_changed',
   '{"all":[]}'::jsonb,
   '[{"type":"notify","recipient":"business_owner","kind":"feature.status_changed","severity":"info","title":"وضعیت یک امکان تغییر کرد","body":"جزئیات در رجیستری امکانات.","action_path":"/panel/features"}]'::jsonb,
   'paused', 80, 60, 20, true)
on conflict (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), key)
do update set name_fa = excluded.name_fa, description = excluded.description,
              event_type = excluded.event_type, conditions = excluded.conditions,
              actions = excluded.actions, priority = excluded.priority,
              cooldown_seconds = excluded.cooldown_seconds, max_runs_per_day = excluded.max_runs_per_day,
              is_system = excluded.is_system;
-- توجه: `status` عمداً در `do update` نیست. اپراتور اگر قاعده‌ای را روشن کرد،
-- اجرای دوبارهٔ seed نباید آن را خاموش کند. دادهٔ مرجع، تصمیم اپراتور را
-- بازنویسی نمی‌کند.
