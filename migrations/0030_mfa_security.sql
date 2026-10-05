-- §10–17، §31: Credential backend-only، anti-replay، challengeهای یک‌بارمصرف.
alter table auth.session add column step_up_aal smallint not null default 1;
create table auth.challenge(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.app_user(id),session_id uuid references auth.session(id),purpose text not null check(purpose in('totp_setup','webauthn_register','webauthn_authenticate')),challenge text not null,material jsonb not null default '{}',expires_at timestamptz not null default now()+interval '5 minutes',consumed_at timestamptz,created_at timestamptz not null default now());
create index challenge_user_idx on auth.challenge(user_id,purpose,expires_at);
alter table auth.challenge enable row level security;create policy challenge_closed on auth.challenge for all to pv_app,pv_public using(false) with check(false);
revoke all on auth.challenge from public,pv_app,pv_public,pv_worker,pv_reader;
create function app.auth_mfa_material(p_user uuid default null) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,app,auth as $$
declare u uuid:=coalesce(p_user,app.current_user_id());c auth.credential;required_new boolean;staff_new boolean;
begin
 if u is null then raise exception 'permission denied' using errcode='42501';end if;
 if p_user is not null and not exists(select 1 from auth.login_ticket t where t.request_id=app.current_request_id() and (select user_id from auth.find_login_candidate(t.identifier_hash) limit 1)=p_user and t.expires_at>now() and t.consumed_at is null) then raise exception 'login ticket required' using errcode='42501';end if;
 select * into c from auth.credential where user_id=u and kind='totp' and revoked_at is null order by created_at desc limit 1;
 select mfa_required into required_new from auth.app_user where id=u;select exists(select 1 from auth.user_platform_role where user_id=u) into staff_new;
 return jsonb_build_object('user_id',u,'required',required_new,'staff',staff_new,'totp',case when c.id is null then null else jsonb_build_object('id',c.id,'cipher',c.secret_hash,'counter',coalesce((c.hash_params->>'last_counter')::bigint,-1)) end,'webauthn',coalesce((select jsonb_agg(jsonb_build_object('id',id,'external_id',external_id,'params',hash_params)) from auth.credential where user_id=u and kind='webauthn' and revoked_at is null),'[]'::jsonb));
end $$;
create function app.consume_totp(p_user uuid,p_counter bigint) returns boolean language plpgsql security definer set search_path=pg_catalog,app,auth as $$
begin
 if p_user is distinct from app.current_user_id() and not exists(select 1 from auth.login_ticket t where t.request_id=app.current_request_id() and (select user_id from auth.find_login_candidate(t.identifier_hash) limit 1)=p_user and t.consumed_at is null and t.expires_at>now()) then raise exception 'permission denied' using errcode='42501';end if;
 update auth.credential set hash_params=jsonb_set(hash_params,'{last_counter}',to_jsonb(p_counter)),last_used_at=now(),used_count=used_count+1 where user_id=p_user and kind='totp' and revoked_at is null and coalesce((hash_params->>'last_counter')::bigint,-1)<p_counter;return found;
end $$;
create function app.create_auth_challenge(p_purpose text,p_challenge text,p_material jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,app,auth as $$
declare c auth.challenge;
begin if app.current_user_id() is null then raise exception 'permission denied' using errcode='42501';end if;if p_purpose in('totp_setup','webauthn_register') then perform app.require_recent_auth();end if;
 insert into auth.challenge(user_id,session_id,purpose,challenge,material) values(app.current_user_id(),app.current_session_id(),p_purpose,p_challenge,p_material) returning * into c;return jsonb_build_object('id',c.id,'expires_at',c.expires_at);end $$;
create function app.own_auth_challenge(p_id uuid,p_purpose text) returns jsonb language sql stable security definer set search_path=pg_catalog,app,auth as $$
 select to_jsonb(c) from auth.challenge c where c.id=p_id and c.user_id=app.current_user_id() and c.session_id=app.current_session_id() and c.purpose=p_purpose and c.expires_at>now() and c.consumed_at is null
$$;
create function app.finish_auth_challenge(p_id uuid,p_purpose text,p_external text,p_secret text,p_params jsonb) returns boolean language plpgsql security definer set search_path=pg_catalog,app,auth as $$
declare c auth.challenge;
begin
 select * into c from auth.challenge where id=p_id and user_id=app.current_user_id() and session_id=app.current_session_id() and purpose=p_purpose and consumed_at is null and expires_at>now() for update;if not found then raise exception 'expired or consumed challenge' using errcode='55000';end if;
 if p_purpose='totp_setup' then update auth.credential set revoked_at=now(),revoked_reason='replacement' where user_id=c.user_id and kind='totp' and revoked_at is null;end if;
 insert into auth.credential(user_id,kind,external_id,secret_hash,hash_params,label) values(c.user_id,case when p_purpose='totp_setup' then 'totp' else 'webauthn' end,p_external,p_secret,p_params,'Authenticator');
 update auth.challenge set consumed_at=now() where id=c.id;update auth.app_user set mfa_required=true where id=c.user_id;perform app.record_audit('auth.mfa_enrolled','user',c.user_id::text);return true;
end $$;
create function app.complete_reauth_mfa(p_verified boolean,p_aal smallint) returns boolean language plpgsql security definer set search_path=pg_catalog,app,auth as $$
begin if p_verified is not true then return false;end if;if exists(select 1 from auth.app_user where id=app.current_user_id() and mfa_required) and p_aal<2 then raise exception 'MFA required' using errcode='42501';end if;update auth.session set step_up_at=now(),step_up_aal=p_aal where id=app.current_session_id() and user_id=app.current_user_id() and revoked_at is null;perform app.record_audit('auth.reauthenticated','session',app.current_session_id()::text);return found;end $$;
create or replace function app.complete_reauth(p_verified boolean) returns boolean language plpgsql security definer set search_path=pg_catalog,app as $$ begin return app.complete_reauth_mfa(p_verified,1::smallint);end $$;
create or replace function app.require_recent_auth() returns void language plpgsql security definer set search_path=pg_catalog,app,auth as $$ begin if not exists(select 1 from auth.session s join auth.app_user u on u.id=s.user_id where s.id=app.current_session_id() and s.user_id=app.current_user_id() and s.revoked_at is null and s.expires_at>now() and app.step_up_is_fresh(s.step_up_at) and (not u.mfa_required or s.step_up_aal>=2)) then raise exception 'recent strong authentication required' using errcode='42501';end if;end $$;
create function app.mfa_recovery_codes(p_hashes jsonb) returns void language plpgsql security definer set search_path=pg_catalog,app,auth as $$
declare h text;
begin perform app.require_recent_auth();if not exists(select 1 from auth.app_user where id=app.current_user_id() and mfa_required) then raise exception 'MFA enrollment required' using errcode='55000';end if;delete from auth.recovery_code where user_id=app.current_user_id();for h in select jsonb_array_elements_text(p_hashes) loop insert into auth.recovery_code(user_id,code_hash) values(app.current_user_id(),h);end loop;perform app.record_audit('auth.recovery_codes_rotated','user',app.current_user_id()::text);end $$;
create function app.consume_recovery(p_user uuid,p_hash text) returns boolean language plpgsql security definer set search_path=pg_catalog,app,auth as $$
begin if p_user is distinct from app.current_user_id() and not exists(select 1 from auth.login_ticket t where t.request_id=app.current_request_id() and (select user_id from auth.find_login_candidate(t.identifier_hash) limit 1)=p_user and t.expires_at>now() and t.consumed_at is null) then raise exception 'permission denied' using errcode='42501';end if;update auth.recovery_code set used_at=now() where user_id=p_user and code_hash=p_hash and used_at is null;return found;end $$;
create function app.update_passkey_counter(p_id uuid,p_counter bigint) returns boolean language plpgsql security definer set search_path=pg_catalog,app,auth as $$
begin update auth.credential set hash_params=jsonb_set(hash_params,'{counter}',to_jsonb(p_counter)),last_used_at=now(),used_count=used_count+1 where id=p_id and user_id=app.current_user_id() and kind='webauthn' and revoked_at is null and (p_counter=0 or coalesce((hash_params->>'counter')::bigint,0)<p_counter);return found;end $$;
revoke all on function app.auth_mfa_material(uuid),app.consume_totp(uuid,bigint),app.create_auth_challenge(text,text,jsonb),app.own_auth_challenge(uuid,text),app.finish_auth_challenge(uuid,text,text,text,jsonb),app.complete_reauth_mfa(boolean,smallint),app.mfa_recovery_codes(jsonb),app.consume_recovery(uuid,text),app.update_passkey_counter(uuid,bigint) from public;
grant execute on function app.auth_mfa_material(uuid),app.consume_totp(uuid,bigint),app.consume_recovery(uuid,text) to pv_app,pv_public;
grant execute on function app.create_auth_challenge(text,text,jsonb),app.own_auth_challenge(uuid,text),app.finish_auth_challenge(uuid,text,text,text,jsonb),app.complete_reauth_mfa(boolean,smallint),app.mfa_recovery_codes(jsonb),app.update_passkey_counter(uuid,bigint) to pv_app;
create function app.consume_auth_challenge(p_id uuid) returns boolean language plpgsql security definer set search_path=pg_catalog,app,auth as $$ begin update auth.challenge set consumed_at=now() where id=p_id and user_id=app.current_user_id() and session_id=app.current_session_id() and consumed_at is null and expires_at>now();if not found then raise exception 'consumed challenge' using errcode='55000';end if;return true;end $$;
revoke all on function app.consume_auth_challenge(uuid) from public;
grant execute on function app.consume_auth_challenge(uuid) to pv_app;
create function app.start_impersonation(p_target uuid,p_session uuid,p_hash text,p_reason text) returns jsonb language plpgsql security definer set search_path=pg_catalog,app,auth as $$
declare actor uuid:=app.current_user_id();expires_new timestamptz:=now()+interval '15 minutes';
begin
 if not app.has_platform_permission('platform.impersonate') or app.current_impersonated_by() is not null then raise exception 'permission denied' using errcode='42501';end if;perform app.require_recent_auth();
 if p_target=actor or not exists(select 1 from auth.app_user where id=p_target and status='active' and deleted_at is null) or exists(select 1 from auth.user_platform_role where user_id=p_target) then raise exception 'target not allowed' using errcode='42501';end if;
 insert into auth.session(id,user_id,secret_hash,aal,expires_at,absolute_expires_at,impersonated_by,impersonation_reason,request_id) values(p_session,p_target,p_hash,1,expires_new,expires_new,actor,p_reason,app.current_request_id());perform app.record_audit('auth.impersonation_started','user',p_target::text,null,null,jsonb_build_object('actor',actor,'reason',p_reason,'session_id',p_session,'expires_at',expires_new));return jsonb_build_object('session_id',p_session,'expires_at',expires_new);
end $$;
create function app.stop_impersonation() returns boolean language plpgsql security definer set search_path=pg_catalog,app,auth as $$
begin if app.current_impersonated_by() is null then raise exception 'not impersonating' using errcode='55000';end if;update auth.session set revoked_at=now(),revoked_reason='logout' where id=app.current_session_id() and user_id=app.current_user_id();perform app.record_audit('auth.impersonation_stopped','session',app.current_session_id()::text);return true;end $$;
revoke all on function app.start_impersonation(uuid,uuid,text,text),app.stop_impersonation() from public;
grant execute on function app.start_impersonation(uuid,uuid,text,text),app.stop_impersonation() to pv_app;
