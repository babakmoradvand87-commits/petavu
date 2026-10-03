-- ============================================================================
-- 0008_domain_functions — توابع دامنه: چرخهٔ عمر، دعوت، انتقال مالکیت، رخداد
--
-- چرا توابع دامنه و نه کد برنامه: این‌ها رفتارهایی‌اند که اگر در کد باشند،
-- هر مسیر تازه (API، پنل، کارگر صف، مهاجرت داده) باید دوباره یادش بیاید که
-- «انتشار باید تاریخ بگذارد»، «پذیرش دعوت باید یک‌بارمصرف باشد»، «انتقال
-- مالکیت باید نقش‌ها را جابه‌جا کند». اگر در پایگاه‌داده باشند، یک‌بار درست
-- نوشته می‌شوند و همهٔ مسیرها ناچاراً همان را اجرا می‌کنند (§103، §191).
--
-- اصل حاکم بر این فایل: هر تابع `security definer`، خودش باید *همان* بررسی
-- را انجام دهد که RLS انجام می‌داد — چون از RLS عبور می‌کند. هر تابع، اول
-- مجوز می‌پرسد، بعد می‌نویسد، بعد رخداد و حسابرسی می‌گذارد.
--
-- مرجع: §17، §23–۲۴، §57–۵۸، §93–۹۴، §139–۱۴۱، §180، §191؛ Addendum §56–72
-- ============================================================================

-- ------------------------------------------------------------------ رخداد و حسابرسی
/**
 * ثبت رخداد دامنه، با بازیگرِ درست.
 *
 * بازیگر از زمینهٔ تراکنش خوانده می‌شود، نه از ورودی تابع: اگر پارامتر بود،
 * هر فراخوان می‌توانست خودش را «سیستم» معرفی کند و رد حسابرسی بی‌ارزش شود.
 */
create or replace function app.emit_event(
  p_event_type text,
  p_entity_type text,
  p_entity_id text,
  p_business_id uuid default null,
  p_payload jsonb default '{}'::jsonb,
  p_actor_type text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, ops, app
as $$
declare
  v_actor_type text;
  v_actor_id uuid;
  v_impersonator uuid;
  v_id uuid;
begin
  if position('.' in p_event_type) <= 1 then
    raise exception 'نوع رخداد باید «نام‌فضا.رخداد» باشد، نه %', p_event_type
      using errcode = 'check_violation';
  end if;

  v_actor_id := app.current_user_id();
  v_impersonator := nullif(current_setting('app.impersonated_by', true), '')::uuid;

  v_actor_type := coalesce(
    p_actor_type,
    case
      when v_impersonator is not null then 'impersonator'
      when v_actor_id is not null then 'user'
      else 'system'
    end
  );

  insert into ops.event (event_type, entity_type, entity_id, business_id, actor_type, actor_id, payload, request_id)
  values (
    p_event_type,
    p_entity_type,
    p_entity_id,
    p_business_id,
    v_actor_type,
    v_actor_id,
    coalesce(p_payload, '{}'::jsonb),
    nullif(current_setting('app.request_id', true), '')
  )
  returning id into v_id;

  return v_id;
end
$$;

comment on function app.emit_event is 'ثبت رخداد دامنه با بازیگرِ برگرفته از زمینه (§93، Addendum §56–72)';

/**
 * ثبت رد حسابرسی.
 *
 * `before_state`/`after_state` صریح گرفته می‌شوند تا «چه تغییر کرد» از خود
 * حسابرسی خوانده شود، نه از بازسازی حدسی.
 */
create or replace function app.record_audit(
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_business_id uuid default null,
  p_before jsonb default null,
  p_after jsonb default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, ops, app
as $$
declare
  v_id uuid;
  v_user uuid;
  v_impersonator uuid;
begin
  v_user := app.current_user_id();
  v_impersonator := nullif(current_setting('app.impersonated_by', true), '')::uuid;

  insert into ops.audit_log (
    actor_type, actor_id, impersonated_by, business_id, action, entity_type, entity_id,
    before_state, after_state, request_id, metadata
  )
  values (
    case
      when v_impersonator is not null then 'impersonator'
      when v_user is not null then 'user'
      when app.current_platform_role() is not null then 'worker'
      else 'anonymous'
    end,
    v_user,
    v_impersonator,
    p_business_id,
    p_action,
    p_entity_type,
    p_entity_id,
    p_before,
    p_after,
    nullif(current_setting('app.request_id', true), ''),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end
$$;

comment on function app.record_audit is 'ثبت رد حسابرسی با بازیگر و وضعیت پیش/پس (§24، §94)';

revoke all on function app.emit_event(text, text, text, uuid, jsonb, text) from public;
revoke all on function app.record_audit(text, text, text, uuid, jsonb, jsonb, jsonb) from public;
grant execute on function app.emit_event(text, text, text, uuid, jsonb, text) to pv_app, pv_worker;
grant execute on function app.record_audit(text, text, text, uuid, jsonb, jsonb, jsonb) to pv_app, pv_worker;

-- ------------------------------------------------------------------ شمارنده‌ها
/** شمار اعضای فعال یک کسب‌وکار؛ از منبع حقیقت، نه از یک ستون شمارنده. */
create or replace function app.recount_members(p_business_id uuid)
returns integer
language sql
stable
security definer
set search_path = pg_catalog, app
as $$
  select count(*)::integer
  from app.membership
  where business_id = p_business_id and status = 'active' and deleted_at is null
$$;

comment on function app.recount_members is 'شمار اعضای فعال کسب‌وکار (§17)';

revoke all on function app.recount_members(uuid) from public;
grant execute on function app.recount_members(uuid) to pv_app, pv_worker, pv_reader;

-- ------------------------------------------------------------------ چرخهٔ عمر محتوا
/**
 * گذرهای مجاز چرخهٔ عمر (§23).
 *
 * جدول، *تصمیم* است: هر گذری که اینجا نیست، ممکن نیست — حتی اگر کسی از API
 * بخواهد. «آرشیو» از هر وضعیت منتشرشده ممکن است، ولی از پیش‌نویس نه، چون
 * بایگانی محتوایی که هرگز منتشر نشده معنایی ندارد.
 */
create or replace function app.content_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select (p_from, p_to) in (
    ('draft', 'in_review'),
    ('draft', 'archived'),
    ('in_review', 'approved'),
    ('in_review', 'changes_requested'),
    ('in_review', 'draft'),
    ('changes_requested', 'in_review'),
    ('changes_requested', 'draft'),
    ('approved', 'published'),
    ('approved', 'scheduled'),
    ('approved', 'draft'),
    ('scheduled', 'published'),
    ('scheduled', 'approved'),
    ('published', 'unpublished'),
    ('published', 'archived'),
    ('unpublished', 'published'),
    ('unpublished', 'archived'),
    ('archived', 'draft')
  )
$$;

comment on function app.content_transition_allowed is 'جدول گذرهای مجاز چرخهٔ عمر محتوا (§23)';

/**
 * گذر محتوا از یک وضعیت به وضعیت دیگر — با مجوز، مهر زمانی، رخداد و حسابرسی.
 *
 * نکتهٔ امنیتی: مجوز بر اساس *مقصد* گذر است، نه مبدأ. «رفتن به انتشار» مجوز
 * `content.publish` می‌خواهد و «رفتن به بازبینی» مجوز `content.update`. این
 * تفکیک، همان چیزی است که در گام ۱۰ گرفتیم: `content.manage` یک مجوز خیالی
 * بود که همهٔ کارها را در یک کلمه جمع می‌کرد.
 */
create or replace function app.transition_content(
  p_content_id uuid,
  p_to text,
  p_reason text default null
)
returns app.content
language plpgsql
security definer
set search_path = pg_catalog, app, ops
as $$
declare
  v_before app.content;
  v_after app.content;
  v_user uuid;
  v_required text;
  v_event text;
begin
  select * into v_before from app.content c where c.id = p_content_id for update;

  if not found then
    raise exception 'محتوا % پیدا نشد', p_content_id using errcode = 'no_data_found';
  end if;

  if v_before.deleted_at is not null then
    raise exception 'محتوای % حذف نرم شده و گذر وضعیت ندارد', p_content_id
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  v_user := app.current_user_id();

  if v_before.business_id is not null then
    if v_user is null or not app.is_member_of(v_before.business_id) then
      raise exception 'کاربر جاری عضو این کسب‌وکار نیست' using errcode = 'insufficient_privilege';
    end if;
  elsif app.current_platform_role() is null then
    raise exception 'محتوای سراسری فقط با نقش پلتفرمی قابل تغییر است' using errcode = 'insufficient_privilege';
  end if;

  if v_before.status = p_to then
    raise exception 'محتوا از پیش در وضعیت «%» است', p_to using errcode = 'object_not_in_prerequisite_state';
  end if;

  if not app.content_transition_allowed(v_before.status, p_to) then
    raise exception 'گذر از «%» به «%» مجاز نیست', v_before.status, p_to
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  v_required := case
    when p_to in ('published', 'unpublished') then 'content.publish'
    when p_to in ('approved', 'changes_requested') then 'content.review'
    when p_to = 'archived' then 'content.delete'
    else 'content.update'
  end;

  if v_before.business_id is not null then
    if v_user is null or not app.has_permission(v_before.business_id, v_required) then
      raise exception 'مجوز «%» برای این گذر لازم است', v_required using errcode = 'insufficient_privilege';
    end if;
  end if;

  update app.content
     set status = p_to,
         published_at = case
           when p_to = 'published' then coalesce(published_at, now())
           else published_at
         end,
         unpublished_at = case
           when p_to = 'unpublished' then now()
           when p_to = 'published' then null
           else unpublished_at
         end,
         archived_at = case when p_to = 'archived' then now() else archived_at end,
         scheduled_for = case when p_to <> 'scheduled' then null else scheduled_for end,
         content_version = content_version + 1
   where id = p_content_id
  returning * into v_after;

  v_event := case
    when p_to = 'published' then 'content.published'
    when p_to = 'unpublished' then 'content.unpublished'
    when p_to = 'archived' then 'content.archived'
    when p_to = 'approved' then 'content.approved'
    else 'content.status_changed'
  end;

  perform app.emit_event(
    v_event,
    'content',
    p_content_id::text,
    v_after.business_id,
    jsonb_build_object('from', v_before.status, 'to', p_to, 'reason', p_reason, 'slug', v_after.slug)
  );

  perform app.record_audit(
    'content.' || p_to,
    'content',
    p_content_id::text,
    v_after.business_id,
    jsonb_build_object('status', v_before.status),
    jsonb_build_object('status', v_after.status, 'reason', p_reason)
  );

  return v_after;
end
$$;

comment on function app.transition_content is
  'گذر چرخهٔ عمر محتوا با مجوز، مهر زمانی، رخداد و حسابرسی (§23، §94)';

/** زمان‌بندی انتشار: گذری که مهر زمانی لازم دارد. */
create or replace function app.schedule_content(p_content_id uuid, p_publish_at timestamptz)
returns app.content
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
declare
  v_after app.content;
  v_before app.content;
begin
  if p_publish_at <= now() then
    raise exception 'زمان انتشار باید در آینده باشد، نه %', p_publish_at using errcode = 'check_violation';
  end if;

  select * into v_before from app.content c where c.id = p_content_id for update;

  if not found then
    raise exception 'محتوا % پیدا نشد', p_content_id using errcode = 'no_data_found';
  end if;

  if v_before.status <> 'approved' then
    raise exception 'تنها محتوای تأییدشده زمان‌بندی می‌شود؛ وضعیت کنونی «%» است', v_before.status
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if v_before.business_id is not null then
    if app.current_user_id() is null or not app.has_permission(v_before.business_id, 'content.publish') then
      raise exception 'مجوز «content.publish» برای زمان‌بندی لازم است' using errcode = 'insufficient_privilege';
    end if;
  elsif app.current_platform_role() is null then
    raise exception 'محتوای سراسری فقط با نقش پلتفرمی زمان‌بندی می‌شود' using errcode = 'insufficient_privilege';
  end if;

  /*
   * گذر و مهر زمانی، در یک به‌روزرسانی.
   *
   * قید `content_schedule_shape` می‌گوید «وضعیت scheduled یعنی scheduled_for
   * پر است». پس نمی‌شود اول وضعیت را عوض کرد و بعد تاریخ را نوشت؛ در فاصلهٔ
   * بین دو دستور، ردیف قید را نقض می‌کند.
   */
  update app.content
     set status = 'scheduled',
         scheduled_for = p_publish_at,
         unpublished_at = null,
         content_version = content_version + 1
   where id = p_content_id
  returning * into v_after;

  perform app.emit_event('content.scheduled', 'content', p_content_id::text, v_after.business_id,
    jsonb_build_object('publish_at', p_publish_at, 'from', v_before.status));

  perform app.record_audit('content.scheduled', 'content', p_content_id::text, v_after.business_id,
    jsonb_build_object('status', v_before.status), jsonb_build_object('status', 'scheduled', 'publish_at', p_publish_at));

  return v_after;
end
$$;

comment on function app.schedule_content is 'زمان‌بندی انتشار محتوا (§23)';

/**
 * انتشار آنچه وقتش رسیده — کار زمان‌بندی‌شدهٔ صف.
 *
 * به‌جای «کارگر با کد، وضعیت را ست کند»، خودِ پایگاه‌داده گذر مجاز را اجرا
 * می‌کند؛ پس هیچ راهی برای دور زدن قیدهای چرخهٔ عمر باز نمی‌ماند (§180).
 */
create or replace function app.publish_due_content(p_limit integer default 50)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    select id from app.content
     where status = 'scheduled'
       and scheduled_for is not null
       and scheduled_for <= now()
       and deleted_at is null
     order by scheduled_for
     limit greatest(p_limit, 1)
     for update skip locked
  loop
    update app.content
       set status = 'published',
           published_at = coalesce(published_at, scheduled_for, now()),
           scheduled_for = null,
           content_version = content_version + 1
     where id = v_row.id;

    perform app.emit_event('content.published', 'content', v_row.id::text,
      (select business_id from app.content where id = v_row.id), '{"via":"scheduler"}'::jsonb);

    v_count := v_count + 1;
  end loop;

  return v_count;
end
$$;

comment on function app.publish_due_content is 'انتشار محتوای زمان‌بندی‌شدهٔ سررسیده، اتمی (§23، §180)';

revoke all on function app.content_transition_allowed(text, text) from public;
revoke all on function app.transition_content(uuid, text, text) from public;
revoke all on function app.schedule_content(uuid, timestamptz) from public;
revoke all on function app.publish_due_content(integer) from public;
grant execute on function app.content_transition_allowed(text, text) to pv_app, pv_worker, pv_reader;
grant execute on function app.transition_content(uuid, text, text) to pv_app;
grant execute on function app.schedule_content(uuid, timestamptz) to pv_app;
grant execute on function app.publish_due_content(integer) to pv_worker;

-- ------------------------------------------------------------------ دعوت‌نامه
/**
 * پذیرش دعوت: یک‌بارمصرف، مقید به هویت خودِ دعوت‌شده.
 *
 * سه قید هم‌زمان:
 *   ۱. توکنِ داده‌شده با درهم ذخیره‌شده باید یکی باشد (پس دعوت حدس‌زدنی نیست).
 *   ۲. کاربر جاری باید همان کسی باشد که دعوت برایش صادر شده — با هش شناسه
 *      (ایمیل/موبایل) تطبیق داده می‌شود؛ پس فرستادن دعوتِ دیگری به خود، کار
 *      نمی‌کند.
 *   ۳. دعوت باید باز و معتبر باشد؛ پذیرش دوباره، خطای صریح می‌دهد.
 *
 * پیامدها: عضویت ساخته می‌شود، دعوت مهر پذیرش می‌خورد، رخداد و حسابرسی
 * ثبت می‌شود، و همه در یک تراکنش.
 */
create or replace function app.accept_invitation(p_invitation_id uuid, p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, app, auth, ops
as $$
declare
  v_inv app.invitation;
  v_user uuid;
  v_membership_id uuid;
begin
  v_user := app.current_user_id();

  if v_user is null then
    raise exception 'برای پذیرش دعوت باید وارد شده باشید' using errcode = 'insufficient_privilege';
  end if;

  select * into v_inv from app.invitation i where i.id = p_invitation_id for update;

  if not found then
    raise exception 'دعوت‌نامه % پیدا نشد', p_invitation_id using errcode = 'no_data_found';
  end if;

  update app.invitation set attempts = attempts + 1 where id = v_inv.id;

  if v_inv.revoked_at is not null then
    raise exception 'این دعوت‌نامه پس گرفته شده است' using errcode = 'object_not_in_prerequisite_state';
  end if;

  if v_inv.accepted_at is not null then
    raise exception 'این دعوت‌نامه پیش‌تر پذیرفته شده است' using errcode = 'object_not_in_prerequisite_state';
  end if;

  if v_inv.expires_at <= now() then
    raise exception 'این دعوت‌نامه منقضی شده است' using errcode = 'object_not_in_prerequisite_state';
  end if;

  if v_inv.token_hash <> p_token_hash then
    raise exception 'توکن دعوت‌نامه معتبر نیست' using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from auth.identity i
    where i.user_id = v_user
      and i.value_key = v_inv.invitee_hash
      and i.deleted_at is null
  ) then
    raise exception 'این دعوت‌نامه برای شما صادر نشده است' using errcode = 'insufficient_privilege';
  end if;

  if exists (
    select 1 from app.business b
    where b.id = v_inv.business_id and b.owner_user_id = v_user
  ) then
    raise exception 'شما مالک این کسب‌وکار هستید و نیازی به پذیرش دعوت ندارید'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  insert into app.membership (business_id, user_id, role_id, status, joined_at, invited_by)
  values (v_inv.business_id, v_user, v_inv.role_id, 'active', now(), v_inv.invited_by)
  on conflict (business_id, user_id) where deleted_at is null and status <> 'left' do update
    set role_id = excluded.role_id,
        status = 'active',
        deleted_at = null,
        joined_at = coalesce(app.membership.joined_at, now())
  returning id into v_membership_id;

  update app.invitation
     set accepted_at = now(), accepted_by = v_user
   where id = v_inv.id;

  perform app.emit_event(
    'member.joined', 'membership', v_membership_id::text, v_inv.business_id,
    jsonb_build_object('invitation_id', v_inv.id, 'invitee', v_inv.invitee_display)
  );

  perform app.record_audit(
    'invitation.accepted', 'invitation', v_inv.id::text, v_inv.business_id,
    jsonb_build_object('accepted_at', v_inv.accepted_at),
    jsonb_build_object('accepted_at', now(), 'user_id', v_user)
  );

  return v_membership_id;
end
$$;

comment on function app.accept_invitation is 'پذیرش یک‌بارمصرف دعوت، مقید به هویت دعوت‌شده (§16، §17)';

/** پس‌گرفتن دعوت باز؛ تنها کسی که مجوز دعوت دارد. */
create or replace function app.revoke_invitation(p_invitation_id uuid, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, app, ops
as $$
declare
  v_inv app.invitation;
  v_user uuid;
begin
  v_user := app.current_user_id();

  select * into v_inv from app.invitation i where i.id = p_invitation_id for update;

  if not found then
    raise exception 'دعوت‌نامه % پیدا نشد', p_invitation_id using errcode = 'no_data_found';
  end if;

  if v_inv.accepted_at is not null then
    raise exception 'دعوت پذیرفته‌شده پس گرفته نمی‌شود؛ عضو را حذف کنید'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if v_inv.revoked_at is not null then
    return v_inv.id;
  end if;

  if v_user is null or not app.has_permission(v_inv.business_id, 'business.member.invite') then
    raise exception 'مجوز «business.member.invite» برای پس‌گرفتن دعوت لازم است'
      using errcode = 'insufficient_privilege';
  end if;

  update app.invitation
     set revoked_at = now(), revoked_by = v_user
   where id = v_inv.id;

  perform app.emit_event('invitation.revoked', 'invitation', v_inv.id::text, v_inv.business_id,
    jsonb_build_object('reason', p_reason));

  return v_inv.id;
end
$$;

comment on function app.revoke_invitation is 'پس‌گرفتن دعوت باز (§17)';

revoke all on function app.accept_invitation(uuid, text) from public;
revoke all on function app.revoke_invitation(uuid, text) from public;
grant execute on function app.accept_invitation(uuid, text) to pv_app;
grant execute on function app.revoke_invitation(uuid, text) to pv_app;

-- ------------------------------------------------------------------ انتقال مالکیت
/** پنجرهٔ اعتبار «تأیید مجدد هویت» برای یک عملیات حساس (§11). */
create or replace function app.step_up_is_fresh(p_step_up_at timestamptz, p_window_minutes integer default 15)
returns boolean
language sql
immutable
as $$
  select p_step_up_at is not null and p_step_up_at > now() - make_interval(mins => greatest(p_window_minutes, 1))
$$;

comment on function app.step_up_is_fresh is 'آیا تأیید مجدد هویت، تازه است؟ (§11)';

/**
 * تکمیل انتقال مالکیت — تنها مسیر تغییر مالک (§17).
 *
 * قیدها:
 *   • فقط مالک فعلی می‌تواند نهایی کند؛
 *   • تأیید مجدد هویت او باید تازه باشد (بیش از ۱۵ دقیقه نگذشته)؛
 *   • انتقال باید در وضعیت باز و منقضی‌نشده باشد؛
 *   • گیرنده باید عضو فعال کسب‌وکار باشد (مالکیت به غریبه داده نمی‌شود).
 *
 * اثر: `owner_user_id` عوض می‌شود، نقش‌ها در همان تراکنش جابه‌جا می‌شوند
 * (مالک پیشین → مدیر، گیرنده → مالک)، و رخداد و حسابرسی ثبت می‌شود. اگر
 * جابه‌جایی نقش‌ها شکست بخورد، همه‌چیز برمی‌گردد.
 */
create or replace function app.complete_ownership_transfer(p_transfer_id uuid)
returns app.business
language plpgsql
security definer
set search_path = pg_catalog, app, ops
as $$
declare
  v_tr app.ownership_transfer;
  v_business app.business;
  v_user uuid;
  v_owner_role uuid;
  v_admin_role uuid;
  v_recipient_membership uuid;
begin
  v_user := app.current_user_id();

  select * into v_tr from app.ownership_transfer t where t.id = p_transfer_id for update;

  if not found then
    raise exception 'درخواست انتقال % پیدا نشد', p_transfer_id using errcode = 'no_data_found';
  end if;

  if v_tr.status in ('completed', 'cancelled', 'rejected', 'expired') then
    raise exception 'این انتقال بسته شده است (وضعیت «%»)', v_tr.status
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if v_tr.expires_at <= now() then
    update app.ownership_transfer set status = 'expired' where id = v_tr.id;
    raise exception 'این درخواست انتقال منقضی شده است' using errcode = 'object_not_in_prerequisite_state';
  end if;

  if v_user is null or v_user <> v_tr.from_user_id then
    raise exception 'تنها مالک فعلی می‌تواند انتقال را نهایی کند' using errcode = 'insufficient_privilege';
  end if;

  if not app.step_up_is_fresh(v_tr.requester_step_up_at) then
    raise exception 'تأیید مجدد هویت لازم است؛ پنجرهٔ تأیید منقضی شده' using errcode = 'insufficient_privilege';
  end if;

  select * into v_business from app.business b where b.id = v_tr.business_id for update;

  if v_business.owner_user_id <> v_tr.from_user_id then
    raise exception 'مالکیت از زمان ثبت درخواست تغییر کرده است' using errcode = 'object_not_in_prerequisite_state';
  end if;

  select m.id into v_recipient_membership
  from app.membership m
  where m.business_id = v_tr.business_id
    and m.user_id = v_tr.to_user_id
    and m.status = 'active'
    and m.deleted_at is null;

  if v_recipient_membership is null then
    raise exception 'گیرندهٔ انتقال باید عضو فعال کسب‌وکار باشد' using errcode = 'object_not_in_prerequisite_state';
  end if;

  select id into v_owner_role from app.role where business_id is null and key = 'owner';
  select id into v_admin_role from app.role where business_id is null and key = 'admin';

  update app.business
     set owner_user_id = v_tr.to_user_id
   where id = v_tr.business_id
  returning * into v_business;

  update app.membership
     set role_id = v_owner_role, overrides = '{"grant":[],"revoke":[]}'::jsonb
   where business_id = v_tr.business_id and user_id = v_tr.to_user_id and deleted_at is null;

  update app.membership
     set role_id = v_admin_role
   where business_id = v_tr.business_id
     and user_id = v_tr.from_user_id
     and deleted_at is null
     and role_id <> v_admin_role;

  update app.ownership_transfer
     set status = 'completed', accepted_at = now(), completed_at = now()
   where id = v_tr.id;

  perform app.emit_event(
    'ownership.transferred', 'business', v_tr.business_id::text, v_tr.business_id,
    jsonb_build_object('from', v_tr.from_user_id, 'to', v_tr.to_user_id, 'transfer_id', v_tr.id)
  );

  perform app.record_audit(
    'business.ownership_transferred', 'business', v_tr.business_id::text, v_tr.business_id,
    jsonb_build_object('owner_user_id', v_tr.from_user_id),
    jsonb_build_object('owner_user_id', v_tr.to_user_id, 'transfer_id', v_tr.id)
  );

  return v_business;
end
$$;

comment on function app.complete_ownership_transfer is
  'انتقال اتمی مالکیت: مالک، نقش‌ها و مهرها در یک تراکنش (§17، §139–141)';

/** لغو انتقال، پیش از تکمیل — توسط درخواست‌کننده یا گیرنده. */
create or replace function app.cancel_ownership_transfer(p_transfer_id uuid, p_reason text default null)
returns app.ownership_transfer
language plpgsql
security definer
set search_path = pg_catalog, app, ops
as $$
declare
  v_tr app.ownership_transfer;
  v_user uuid;
begin
  v_user := app.current_user_id();

  select * into v_tr from app.ownership_transfer t where t.id = p_transfer_id for update;

  if not found then
    raise exception 'درخواست انتقال % پیدا نشد', p_transfer_id using errcode = 'no_data_found';
  end if;

  if v_tr.status in ('completed', 'cancelled', 'rejected', 'expired') then
    raise exception 'این انتقال بسته شده است (وضعیت «%»)', v_tr.status
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if v_user is null or v_user not in (v_tr.from_user_id, v_tr.to_user_id) then
    raise exception 'تنها طرف‌های انتقال می‌توانند آن را لغو کنند' using errcode = 'insufficient_privilege';
  end if;

  update app.ownership_transfer
     set status = case when v_user = v_tr.to_user_id then 'rejected' else 'cancelled' end,
         cancelled_at = now()
   where id = v_tr.id
  returning * into v_tr;

  perform app.emit_event(
    'ownership.transfer_closed', 'business', v_tr.business_id::text, v_tr.business_id,
    jsonb_build_object('status', v_tr.status, 'reason', p_reason)
  );

  return v_tr;
end
$$;

comment on function app.cancel_ownership_transfer is 'لغو یا رد انتقال مالکیت پیش از تکمیل (§17)';

revoke all on function app.step_up_is_fresh(timestamptz, integer) from public;
revoke all on function app.complete_ownership_transfer(uuid) from public;
revoke all on function app.cancel_ownership_transfer(uuid, text) from public;
grant execute on function app.step_up_is_fresh(timestamptz, integer) to pv_app, pv_worker;
grant execute on function app.complete_ownership_transfer(uuid) to pv_app;
grant execute on function app.cancel_ownership_transfer(uuid, text) to pv_app;

-- ------------------------------------------------------------------ متادیتای سئو
/**
 * نوشتن فرادادهٔ سئو، با احترام به ویرایش دستی (§103).
 *
 * قاعده: نوشتن خودکار (تولید از قالب) هرگز روی ردیفی که انسان دستش را به آن
 * زده نمی‌نویسد. اگر `is_manual` باشد، تابع فقط `source_hash` را به‌روز
 * می‌کند و محتوا دست‌نخورده می‌ماند؛ در غیر این صورت، درج/به‌روزرسانی
 * انجام می‌شود. `source_hash` هم ثبت می‌شود تا «آیا منبع عوض شده؟» بدون
 * مقایسهٔ رشته‌ای جواب بگیرد.
 */
create or replace function app.upsert_seo_metadata(
  p_entity_kind text,
  p_entity_id uuid,
  p_locale text,
  p_values jsonb,
  p_source_hash text default null,
  p_business_id uuid default null
)
returns seo.metadata
language plpgsql
security definer
set search_path = pg_catalog, seo, app, ops
as $$
declare
  v_row seo.metadata;
  v_user uuid := app.current_user_id();
begin
  if p_business_id is not null then
    if v_user is null or not app.has_permission(p_business_id, 'seo.manage') then
      raise exception 'مجوز «seo.manage» برای نوشتن فرادادهٔ سئو لازم است'
        using errcode = 'insufficient_privilege';
    end if;
  elsif app.current_platform_role() is null then
    raise exception 'فرادادهٔ سراسری فقط با نقش پلتفرمی نوشته می‌شود' using errcode = 'insufficient_privilege';
  end if;

  select * into v_row
  from seo.metadata m
  where m.entity_kind = p_entity_kind and m.entity_id = p_entity_id and m.locale = p_locale
  for update;

  if found and v_row.is_manual then
    update seo.metadata
       set source_hash = coalesce(p_source_hash, source_hash)
     where id = v_row.id
    returning * into v_row;

    perform app.emit_event('seo.metadata_skipped_manual', p_entity_kind, p_entity_id::text, p_business_id,
      jsonb_build_object('locale', p_locale, 'reason', 'manual_edit_preserved'));

    return v_row;
  end if;

  insert into seo.metadata (
    business_id, entity_kind, entity_id, route_key, locale, title, description, canonical_url,
    robots_directives, is_indexable, non_indexable_reason, is_manual, source_hash,
    share_title, share_caption
  )
  values (
    p_business_id,
    p_entity_kind,
    p_entity_id,
    p_values ->> 'route_key',
    p_locale,
    p_values ->> 'title',
    p_values ->> 'description',
    p_values ->> 'canonical_url',
    coalesce(
      (select array_agg(value) from jsonb_array_elements_text(coalesce(p_values -> 'robots_directives', '[]'::jsonb)) as t(value)),
      '{}'::text[]
    ),
    coalesce((p_values ->> 'is_indexable')::boolean, true),
    p_values ->> 'non_indexable_reason',
    /*
     * `is_manual` از خودِ فراخوان می‌آید، نه از یک ثابت.
     *
     * معنایش این است: «این متن را انسان نوشته و تولیدکنندهٔ خودکار نباید
     * بازنویسی‌اش کند». اگر اینجا `false` ثابت باشد، ویرایش دستیِ ادمین هم
     * مُهر «تولیدشده» می‌خورد و بار بعد، بازتولید فراداده آن را با متن
     * ماشینی بازنویسی می‌کند — یعنی کار کاربر بی‌صدا پاک می‌شود. پیش‌فرض
     * `false` می‌ماند تا مسیرهای خودکار تغییری نکنند.
     */
    coalesce((p_values ->> 'is_manual')::boolean, false),
    p_source_hash,
    p_values ->> 'share_title',
    p_values ->> 'share_caption'
  )
  /*
   * `on conflict` باید *همان* شکل ایندکس یکتا را تکرار کند: ایندکس روی
   * `(entity_kind, coalesce(entity_id, …), coalesce(route_key, ''), locale)`
   * ساخته شده تا هر مسیر، یک ردیف داشته باشد. نوشتن صرف `(entity_kind,
   * entity_id, locale)`، تعارض را نمی‌گیرد و خطا می‌دهد.
   */
  on conflict (
    entity_kind,
    coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(route_key, ''),
    locale
  ) do update
    set title = excluded.title,
        description = excluded.description,
        canonical_url = excluded.canonical_url,
        robots_directives = excluded.robots_directives,
        is_indexable = excluded.is_indexable,
        non_indexable_reason = excluded.non_indexable_reason,
        -- دستی‌شدن یک ردیف، یک واقعیت است که ثبت می‌شود؛ برگشتن از دستی به
        -- خودکار هم فقط با `is_manual = false` صریح ممکن است.
        is_manual = excluded.is_manual,
        source_hash = excluded.source_hash,
        share_title = excluded.share_title,
        share_caption = excluded.share_caption
  returning * into v_row;

  perform app.emit_event('seo.metadata_updated', p_entity_kind, p_entity_id::text, p_business_id,
    jsonb_build_object('locale', p_locale, 'is_indexable', v_row.is_indexable));

  return v_row;
end
$$;

comment on function app.upsert_seo_metadata is
  'نوشتن فرادادهٔ سئو با احترام به ویرایش دستی و ثبت اثر انگشت منبع (§103)';

revoke all on function app.upsert_seo_metadata(text, uuid, text, jsonb, text, uuid) from public;
grant execute on function app.upsert_seo_metadata(text, uuid, text, jsonb, text, uuid) to pv_app, pv_worker;
