-- §28، §10، §14–17، §24: مسیرهای محدود و حسابرسی‌شدهٔ مدیریت.
create function app.require_recent_auth() returns void language plpgsql security definer set search_path=pg_catalog,app,auth as $$
begin
  if not exists(select 1 from auth.session s where s.id=app.current_session_id() and s.user_id=app.current_user_id()
    and s.revoked_at is null and s.expires_at>now() and app.step_up_is_fresh(s.step_up_at)) then
    raise exception 'recent authentication required' using errcode='42501';
  end if;
end $$;
create function app.own_password_hash() returns text language sql stable security definer set search_path=pg_catalog,app,auth as $$
  select c.secret_hash from auth.credential c where app.current_user_id() is not null and c.user_id=app.current_user_id()
  and c.kind='password' and c.revoked_at is null order by c.created_at desc limit 1
$$;
create function app.complete_reauth(p_verified boolean) returns boolean language plpgsql security definer set search_path=pg_catalog,app,auth as $$
begin
  if p_verified is not true or app.current_user_id() is null then return false; end if;
  update auth.session s set step_up_at=now() where s.id=app.current_session_id() and s.user_id=app.current_user_id()
    and s.revoked_at is null and s.expires_at>now();
  if not found then return false; end if;
  perform app.record_audit('auth.reauthenticated','session',app.current_session_id()::text);
  return true;
end $$;
create function app.admin_users(p_cursor uuid default null,p_limit integer default 21)
returns table(id uuid,display_name text,status text,locale text,mfa_required boolean,last_login_at timestamptz,created_at timestamptz,version integer)
language plpgsql stable security definer set search_path=pg_catalog,app,auth as $$
begin
 if app.current_user_id() is null or not app.has_platform_permission('platform.user.view') then raise exception 'permission denied' using errcode='42501'; end if;
 return query select u.id,u.display_name,u.status,u.locale,u.mfa_required,u.last_login_at,u.created_at,u.version from auth.app_user u
 where u.deleted_at is null and (p_cursor is null or u.id>p_cursor) order by u.id limit least(greatest(p_limit,1),101);
end $$;
create function app.admin_role_matrix() returns jsonb language plpgsql stable security definer set search_path=pg_catalog,app,auth as $$
begin
 if app.current_user_id() is null or not app.has_platform_permission('platform.role.manage') then raise exception 'permission denied' using errcode='42501'; end if;
 return jsonb_build_object('roles',(select jsonb_agg(jsonb_build_object('key',r.key,'name_fa',r.name_fa,'rank',r.rank)) from auth.platform_role r),
  'grants',(select jsonb_agg(jsonb_build_object('role_key',g.role_key,'permission_key',g.permission_key)) from auth.platform_role_permission g),
  'assignments',(select jsonb_agg(jsonb_build_object('user_id',g.user_id,'role_key',g.role_key)) from auth.user_platform_role g));
end $$;
create function app.admin_user_state(p_id uuid,p_version integer,p_to text,p_reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,app,auth as $$
declare old_row auth.app_user; new_row auth.app_user;
begin
 if not app.has_platform_permission('platform.user.suspend') or app.current_user_id() is null then raise exception 'permission denied' using errcode='42501'; end if;
 perform app.require_recent_auth();
 if p_id=app.current_user_id() or p_to not in ('active','suspended') or length(btrim(coalesce(p_reason,'')))<3 then raise exception 'invalid transition' using errcode='22023'; end if;
 select * into old_row from auth.app_user where id=p_id and deleted_at is null for update;
 if not found then raise exception 'not found' using errcode='P0002'; end if;
 if old_row.version<>p_version then raise exception 'version conflict' using errcode='P0409'; end if;
 if old_row.status=p_to then return jsonb_build_object('id',old_row.id,'status',old_row.status,'version',old_row.version); end if;
 if exists(select 1 from auth.user_platform_role r where r.user_id=p_id and r.role_key='superadmin') and app.current_platform_role()<>'superadmin' then raise exception 'permission denied' using errcode='42501'; end if;
 update auth.app_user set status=p_to,suspended_at=case when p_to='suspended' then now() end,suspended_reason=case when p_to='suspended' then p_reason end where id=p_id returning * into new_row;
 if p_to='suspended' then update auth.session set revoked_at=now(),revoked_reason='account_suspended' where user_id=p_id and revoked_at is null; end if;
 perform app.record_audit('user.state_changed','user',p_id::text,null,jsonb_build_object('status',old_row.status),jsonb_build_object('status',p_to),jsonb_build_object('reason',p_reason));
 perform app.emit_event('user.state_changed','user',p_id::text,null,jsonb_build_object('status',p_to));
 return jsonb_build_object('id',new_row.id,'status',new_row.status,'version',new_row.version);
end $$;
create function app.admin_business_state(p_id uuid,p_version integer,p_to text,p_reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,app,auth as $$
declare old_row app.business; new_row app.business;
begin
 if not app.has_platform_permission('platform.business.moderate') or app.current_user_id() is null then raise exception 'permission denied' using errcode='42501'; end if;
 perform app.require_recent_auth();
 select * into old_row from app.business where id=p_id and deleted_at is null for update;
 if not found then raise exception 'not found' using errcode='P0002'; end if;
 if old_row.version<>p_version then raise exception 'version conflict' using errcode='P0409'; end if;
 if old_row.status=p_to then return jsonb_build_object('id',p_id,'status',p_to,'version',old_row.version); end if;
 if length(btrim(coalesce(p_reason,'')))<3 or not ((old_row.status in ('draft','pending_review') and p_to='active') or
   (old_row.status='active' and p_to in ('suspended','archived')) or (old_row.status='suspended' and p_to in ('active','archived'))) then raise exception 'invalid transition' using errcode='55000'; end if;
 update app.business set status=p_to,published_at=case when p_to='active' then coalesce(published_at,now()) else published_at end,
  suspended_at=case when p_to='suspended' then now() end,suspended_reason=case when p_to='suspended' then p_reason end,
  archived_at=case when p_to='archived' then now() else archived_at end where id=p_id returning * into new_row;
 perform app.record_audit('business.state_changed','business',p_id::text,p_id,jsonb_build_object('status',old_row.status),jsonb_build_object('status',p_to),jsonb_build_object('reason',p_reason));
 perform app.emit_event('business.state_changed','business',p_id::text,p_id,jsonb_build_object('status',p_to));
 return jsonb_build_object('id',new_row.id,'status',new_row.status,'version',new_row.version);
end $$;
create function app.admin_content_state(p_id uuid,p_version integer,p_to text,p_reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,app,auth as $$
declare old_row app.content; new_row app.content;
begin
 if not app.has_platform_permission('platform.content.moderate') or app.current_user_id() is null then raise exception 'permission denied' using errcode='42501'; end if;
 perform app.require_recent_auth();
 select * into old_row from app.content where id=p_id and deleted_at is null for update;
 if not found then raise exception 'not found' using errcode='P0002'; end if;
 if old_row.version<>p_version then raise exception 'version conflict' using errcode='P0409'; end if;
 if old_row.status=p_to then return jsonb_build_object('id',p_id,'status',p_to,'version',old_row.version); end if;
 if p_to not in ('approved','changes_requested','unpublished','archived') or not app.content_transition_allowed(old_row.status,p_to)
   or length(btrim(coalesce(p_reason,'')))<3 then raise exception 'invalid transition' using errcode='55000'; end if;
 update app.content set status=p_to,unpublished_at=case when p_to='unpublished' then now() else unpublished_at end,
  archived_at=case when p_to='archived' then now() else archived_at end where id=p_id returning * into new_row;
 if p_to<>'archived' then insert into app.content_review(content_id,reviewer_id,decision,note,content_version) values(p_id,app.current_user_id(),p_to,p_reason,new_row.content_version); end if;
 perform app.record_audit('content.moderated','content',p_id::text,old_row.business_id,jsonb_build_object('status',old_row.status),jsonb_build_object('status',p_to),jsonb_build_object('reason',p_reason));
 perform app.emit_event('content.'||p_to,'content',p_id::text,old_row.business_id,jsonb_build_object('reason',p_reason));
 return jsonb_build_object('id',new_row.id,'status',new_row.status,'version',new_row.version);
end $$;
revoke all on function app.require_recent_auth(),app.own_password_hash(),app.complete_reauth(boolean),app.admin_users(uuid,integer),app.admin_role_matrix(),app.admin_user_state(uuid,integer,text,text),app.admin_business_state(uuid,integer,text,text),app.admin_content_state(uuid,integer,text,text) from public;
grant execute on function app.require_recent_auth(),app.own_password_hash(),app.complete_reauth(boolean),app.admin_users(uuid,integer),app.admin_role_matrix(),app.admin_user_state(uuid,integer,text,text),app.admin_business_state(uuid,integer,text,text),app.admin_content_state(uuid,integer,text,text) to pv_app;
-- فهرست صفحه‌به‌صفحهٔ کنسول، شاخص‌ها از دادهٔ واقعی.
create index audit_log_id_idx on ops.audit_log(id);
