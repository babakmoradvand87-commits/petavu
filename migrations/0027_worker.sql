-- §61، §93، Addendum §56–72: outbox اتمی، lease، نتیجهٔ واقعی، کار زمان‌بندی‌شده.
alter table ops.event add column dispatched_at timestamptz;
alter table ops.job add column lease_id uuid;
alter table ops.job add column lease_expires_at timestamptz;
alter table ops.job add column result jsonb not null default '{}';
create index event_undispatched_idx on ops.event(occurred_at,id) where dispatched_at is null and processed_at is null;
create table ops.schedule(key text primary key,kind text not null,payload jsonb not null default '{}',every_seconds int not null check(every_seconds between 60 and 2678400),is_active boolean not null default true,next_run_at timestamptz not null default now(),last_run_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),version int not null default 1);
create trigger schedule_touch before update on ops.schedule for each row execute function app.touch();
alter table ops.schedule enable row level security;
create policy schedule_worker on ops.schedule for all to pv_worker using(true) with check(true);
create policy schedule_staff on ops.schedule for all to pv_app using(app.has_platform_permission('platform.job.manage')) with check(app.has_platform_permission('platform.job.manage'));
create policy schedule_reader on ops.schedule for select to pv_reader using(true);
revoke all on ops.schedule from public;
grant select,insert,update on ops.schedule to pv_worker,pv_app;
grant select on ops.schedule to pv_reader;

create function ops.dispatch_outbox(p_limit int default 50) returns int language plpgsql security definer set search_path=pg_catalog,ops as $$
declare e ops.event; n int:=0;
begin
 for e in select * from ops.event where processed_at is null and dispatched_at is null order by occurred_at,id limit least(greatest(p_limit,1),100) for update skip locked loop
  insert into ops.job(kind,payload,business_id,dedupe_key,request_id) values('event.dispatch',jsonb_build_object('event_id',e.id),e.business_id,'event:'||e.id::text,e.request_id) on conflict do nothing;
  update ops.event set dispatched_at=now() where id=e.id;n:=n+1;
 end loop;return n;
end $$;
create function ops.claim_leased(p_worker text,p_limit int default 10) returns setof ops.job language plpgsql security definer set search_path=pg_catalog,ops as $$
declare j ops.job;
begin
 if coalesce(length(p_worker),0) not between 3 and 120 then raise exception 'invalid worker' using errcode='22023';end if;
 for j in select * from ops.claim_job(p_worker,null,least(greatest(p_limit,1),20)) loop
  update ops.job set lease_id=gen_random_uuid(),lease_expires_at=now()+interval '90 seconds' where id=j.id returning * into j;return next j;
 end loop;
end $$;
create function ops.assert_lease(p_job uuid,p_worker text,p_lease uuid) returns ops.job language plpgsql stable security definer set search_path=pg_catalog,ops as $$
declare j ops.job;
begin select * into j from ops.job where id=p_job and status='running' and locked_by=p_worker and lease_id=p_lease and lease_expires_at>now();if not found then raise exception 'lease not owned' using errcode='42501';end if;return j;end $$;
create function ops.finish_owned(p_job uuid,p_worker text,p_lease uuid,p_success boolean,p_result jsonb default '{}',p_error text default null,p_retry int default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,ops as $$
declare j ops.job;
begin
 perform ops.assert_lease(p_job,p_worker,p_lease);j:=ops.finish_job(p_job,p_success,p_error,p_retry);
 update ops.job set result=p_result,lease_id=null,lease_expires_at=null where id=p_job returning * into j;return to_jsonb(j);
end $$;
create function ops.retry_job(p_id uuid,p_version int,p_reason text) returns jsonb language plpgsql security definer set search_path=pg_catalog,app,ops as $$
declare j ops.job;
begin
 if not app.has_platform_permission('platform.job.manage') then raise exception 'permission denied' using errcode='42501';end if;perform app.require_recent_auth();
 select * into j from ops.job where id=p_id for update;if not found then raise exception 'not found' using errcode='P0002';end if;
 if j.version<>p_version then raise exception 'version conflict' using errcode='P0409';end if;if j.status not in('dead','failed') then raise exception 'terminal failure required' using errcode='55000';end if;
 update ops.job set status='pending',attempts=0,available_at=now(),locked_by=null,locked_at=null,lease_id=null,lease_expires_at=null,finished_at=null,last_error=null where id=p_id returning * into j;
 perform app.record_audit('job.retried','job',p_id::text,j.business_id,null,jsonb_build_object('reason',p_reason));return to_jsonb(j);
end $$;
create function ops.schedule_due() returns int language plpgsql security definer set search_path=pg_catalog,ops as $$
declare s ops.schedule; n int:=0;
begin
 for s in select * from ops.schedule where is_active and next_run_at<=now() order by next_run_at limit 50 for update skip locked loop
  insert into ops.job(kind,payload,dedupe_key) values(s.kind,s.payload,'schedule:'||s.key||':'||s.next_run_at::text) on conflict do nothing;
  update ops.schedule set last_run_at=now(),next_run_at=now()+make_interval(secs=>s.every_seconds) where key=s.key;n:=n+1;
 end loop;return n;
end $$;
create function ops.job_context(p_job uuid,p_worker text,p_lease uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,ops as $$
declare j ops.job;e ops.event;
begin
 j:=ops.assert_lease(p_job,p_worker,p_lease);
 if j.payload?'event_id' then select * into e from ops.event where id=(j.payload->>'event_id')::uuid and business_id is not distinct from j.business_id;end if;
 return jsonb_build_object('job',to_jsonb(j),'event',case when e.id is null then null else to_jsonb(e) end);
end $$;
create function ops.execute_core_job(p_job uuid,p_worker text,p_lease uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,app,ops,seo,design as $$
declare j ops.job; e ops.event; s jsonb; entity uuid; c app.content; b app.business; n int:=0; r design.release; target uuid; path text;
begin
 j:=ops.assert_lease(p_job,p_worker,p_lease);
 perform set_config('app.business_id',coalesce(j.business_id::text,''),true);perform set_config('app.request_id',coalesce(j.request_id,p_job::text),true);
 if j.payload?'event_id' then select * into e from ops.event where id=(j.payload->>'event_id')::uuid and business_id is not distinct from j.business_id;end if;
 if j.kind='event.dispatch' then
  if e.id is null then raise exception 'event scope mismatch' using errcode='42501';end if;
  s:=ops.process_event(e.id);if exists(select 1 from ops.automation_run where event_id=e.id and status='failed') then raise exception 'automation failed' using errcode='55000';end if;
  if e.entity_type in('content','business') then insert into ops.job(kind,payload,business_id,dedupe_key,request_id) values('seo.metadata_rebuild',jsonb_build_object('event_id',e.id),e.business_id,'seo:'||e.id,e.request_id) on conflict do nothing;end if;
  if e.event_type in('design.published','design.rolled_back') then insert into ops.job(kind,payload,business_id,dedupe_key,request_id) values('design.monitor',jsonb_build_object('release_id',e.entity_id),e.business_id,'monitor:'||e.id,e.request_id) on conflict do nothing;end if;
  if e.event_type='form.submitted' and e.business_id is not null then select owner_user_id into target from app.business where id=e.business_id;
   if target is not null then insert into ops.notification(recipient_user_id,business_id,kind,title,body,action_path,correlation_id,channel) values(target,e.business_id,'form.received','درخواست جدید','فرم واقعی برای بررسی ثبت شده است.','/app/pages?builder=nocode',e.id,'in_app') on conflict do nothing;end if;
  end if;
  perform ops.fan_out_webhook(e.id);return jsonb_build_object('event_id',e.id,'automation',s,'dispatched',true);
 elsif j.kind='seo.metadata_rebuild' then
  if e.id is not null then entity:=e.entity_id::uuid;else entity:=nullif(j.payload->>'entity_id','')::uuid;end if;
  if entity is null then raise exception 'entity required' using errcode='22023';end if;
  select * into c from app.content where id=entity and business_id is not distinct from j.business_id;
  if found then
   path:=case when c.business_id is null then '/'||c.slug else '/b/'||(select slug from app.business where id=c.business_id)||'/c/'||c.slug end;
   update seo.metadata set title=case when is_manual then title else c.title end,description=case when is_manual then description else c.summary end,is_indexable=c.status='published' and c.visibility='public' and c.deleted_at is null and length(coalesce(c.body_text,''))>=80,non_indexable_reason=case when length(coalesce(c.body_text,''))<80 then 'thin_content' else null end,last_audited_at=now() where entity_kind='content' and entity_id=c.id;
   if not found then insert into seo.metadata(business_id,entity_kind,entity_id,route_key,locale,title,description,is_indexable,non_indexable_reason) values(c.business_id,'content',c.id,path,c.locale,c.title,c.summary,c.status='published' and c.visibility='public' and c.deleted_at is null and length(coalesce(c.body_text,''))>=80,case when length(coalesce(c.body_text,''))<80 then 'thin_content' end);end if;
   return jsonb_build_object('content_id',c.id,'metadata_generated',true,'path',path);
  end if;
  select * into b from app.business where id=entity and id is not distinct from j.business_id;
  if found then update seo.metadata set title=case when is_manual then title else b.name end,is_indexable=b.status='active' and b.visibility='public' and b.deleted_at is null where entity_kind='business' and entity_id=b.id;
   if not found then insert into seo.metadata(business_id,entity_kind,entity_id,title,is_indexable) values(b.id,'business',b.id,b.name,b.status='active' and b.visibility='public' and b.deleted_at is null);end if;return jsonb_build_object('business_id',b.id,'metadata_generated',true);
  end if;return jsonb_build_object('not_applicable',true,'reason','entity_removed_or_not_indexable_kind');
 elsif j.kind in('search.index_content','search.index_business','search.reindex','seo.sitemap_rebuild','seo.structured_data_rebuild','seo.ai_rebuild') then
  select count(*)::int,design.bundle_hash(coalesce(jsonb_agg(jsonb_build_object('id',id,'version',version,'title',title,'vector',to_tsvector('simple',coalesce(body_text,''))::text) order by id),'[]'::jsonb)) into n,path from app.content where business_id is not distinct from j.business_id and status='published' and visibility='public' and deleted_at is null;
  return jsonb_build_object('adapter','postgres','strategy','transactional_source_projection','event_id',e.id,'scope',j.business_id,'source_documents',n,'source_hash',path,'checked_at',now(),'external_index','not_configured');
 elsif j.kind='performance.rollup' then
  return jsonb_build_object('rollups',ops.rollup_vitals(),'baselines',ops.compute_baselines(),'regressions',ops.detect_regressions());
 elsif j.kind='ops.maintenance' then
  return jsonb_build_object('reclaimed',ops.reclaim_stale_jobs(120,50),'rate_windows_pruned',ops.prune_rate_limit_counters(86400));
 elsif j.kind='notification.deliver' then
  entity:=nullif(j.payload->>'notification_id','')::uuid;update ops.notification set status='sent',sent_at=now(),attempts=attempts+1 where id=entity and business_id is not distinct from j.business_id and channel='in_app' and status='pending';get diagnostics n=row_count;return jsonb_build_object('in_app_delivered',n);
 else raise exception 'no registered handler' using errcode='0A000';end if;
end $$;
create function ops.queue_deliveries() returns int language plpgsql security definer set search_path=pg_catalog,ops as $$
declare n int;
begin
 insert into ops.job(kind,payload,business_id,dedupe_key,request_id)
 select 'notification.deliver',jsonb_build_object('notification_id',id),business_id,'notification:'||id,correlation_id::text from ops.notification where status='pending' and not exists(select 1 from ops.job j where j.dedupe_key='notification:'||ops.notification.id and j.status in('pending','running','succeeded')) limit 50 on conflict do nothing;get diagnostics n=row_count;
 insert into ops.job(kind,payload,business_id,dedupe_key,request_id)
 select 'webhook.deliver',jsonb_build_object('delivery_id',id),business_id,'webhook:'||id,event_id::text from ops.webhook_delivery where status in('pending','failed') and next_attempt_at<=now() and not exists(select 1 from ops.job j where j.dedupe_key='webhook:'||ops.webhook_delivery.id and j.status in('pending','running','succeeded')) limit 50 on conflict do nothing;return n;
end $$;
create function ops.monitor_report(p_job uuid,p_worker text,p_lease uuid,p_report jsonb) returns void language plpgsql security definer set search_path=pg_catalog,ops,design as $$
declare j ops.job;r design.release;
begin
 j:=ops.assert_lease(p_job,p_worker,p_lease);select * into r from design.release where id=(j.payload->>'release_id')::uuid and business_id is not distinct from j.business_id;if not found then raise exception 'release scope' using errcode='42501';end if;
 update design.release set validation_report=design.report_stage(validation_report,'MONITOR',case when p_report->>'passed'='true' then 'passed' else 'failed' end,p_report) where id=r.id;
end $$;
revoke all on function ops.dispatch_outbox(int),ops.claim_leased(text,int),ops.assert_lease(uuid,text,uuid),ops.finish_owned(uuid,text,uuid,boolean,jsonb,text,int),ops.retry_job(uuid,int,text),ops.schedule_due(),ops.job_context(uuid,text,uuid),ops.execute_core_job(uuid,text,uuid),ops.queue_deliveries(),ops.monitor_report(uuid,text,uuid,jsonb) from public;
grant execute on function ops.dispatch_outbox(int),ops.claim_leased(text,int),ops.assert_lease(uuid,text,uuid),ops.finish_owned(uuid,text,uuid,boolean,jsonb,text,int),ops.schedule_due(),ops.job_context(uuid,text,uuid),ops.execute_core_job(uuid,text,uuid),ops.queue_deliveries(),ops.monitor_report(uuid,text,uuid,jsonb) to pv_worker;
grant execute on function ops.retry_job(uuid,int,text) to pv_app;
create function ops.delivery_material(p_job uuid,p_worker text,p_lease uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,app,auth,ops,design as $$
declare j ops.job;n ops.notification;d ops.webhook_delivery;e ops.webhook_endpoint;r design.release;email text;slug_new text;
begin
 j:=ops.assert_lease(p_job,p_worker,p_lease);
 if j.kind='webhook.deliver' then
  select * into d from ops.webhook_delivery where id=(j.payload->>'delivery_id')::uuid and business_id is not distinct from j.business_id;select * into e from ops.webhook_endpoint where id=d.endpoint_id and is_active;
  if d.id is null or e.id is null then return jsonb_build_object('not_applicable',true,'reason','endpoint_or_delivery_inactive');end if;
  return jsonb_build_object('delivery',to_jsonb(d),'endpoint',jsonb_build_object('url',e.url,'secret_ref',e.secret_ref,'timeout_ms',e.timeout_ms));
 elsif j.kind='notification.deliver' then
  select * into n from ops.notification where id=(j.payload->>'notification_id')::uuid and business_id is not distinct from j.business_id;
  if n.id is null or n.status in('sent','read') then return jsonb_build_object('not_applicable',true,'reason','already_delivered_or_missing');end if;
  select value_key into email from auth.identity where user_id=n.recipient_user_id and kind='email' and verified_at is not null order by created_at limit 1;
  return jsonb_build_object('notification',to_jsonb(n),'email',email);
 elsif j.kind='design.monitor' then
  select * into r from design.release where id=(j.payload->>'release_id')::uuid and business_id is not distinct from j.business_id;
  if r.id is null or not r.is_current then return jsonb_build_object('not_applicable',true,'reason','release_not_current');end if;
  if j.business_id is not null then select slug into slug_new from app.business where id=j.business_id and status='active' and visibility='public' and deleted_at is null;if slug_new is null then return jsonb_build_object('not_applicable',true,'reason','scope_not_public');end if;end if;
  return jsonb_build_object('release_id',r.id,'hash',r.bundle_hash,'pages',r.bundle->'pages','business_slug',slug_new);
 end if;return '{}';
end $$;
create function ops.delivery_result(p_job uuid,p_worker text,p_lease uuid,p_success boolean,p_code int default null,p_error text default null) returns void language plpgsql security definer set search_path=pg_catalog,ops as $$
declare j ops.job;
begin
 j:=ops.assert_lease(p_job,p_worker,p_lease);
 if j.kind='webhook.deliver' then perform ops.record_webhook_result((j.payload->>'delivery_id')::uuid,p_success,p_code,p_error);
 elsif j.kind='notification.deliver' then update ops.notification set status=case when p_success then 'sent' else 'failed' end,sent_at=case when p_success then now() else sent_at end,attempts=attempts+1,last_error=p_error where id=(j.payload->>'notification_id')::uuid and business_id is not distinct from j.business_id;end if;
end $$;
create unique index notification_system_once_idx on ops.notification(recipient_user_id,correlation_id,kind,channel) where rule_id is null and correlation_id is not null;
create function ops.notification_scope_guard() returns trigger language plpgsql security definer set search_path=pg_catalog,app,ops as $$
begin
 if new.business_id is not null and not exists(select 1 from app.business b where b.id=new.business_id and b.owner_user_id=new.recipient_user_id) and not exists(select 1 from app.membership m where m.business_id=new.business_id and m.user_id=new.recipient_user_id and m.status='active') then raise exception 'recipient not in event scope' using errcode='42501';end if;return new;
end $$;
create trigger notification_scope_guard before insert on ops.notification for each row execute function ops.notification_scope_guard();
revoke all on function ops.delivery_material(uuid,text,uuid),ops.delivery_result(uuid,text,uuid,boolean,int,text),ops.notification_scope_guard() from public;
grant execute on function ops.delivery_material(uuid,text,uuid),ops.delivery_result(uuid,text,uuid,boolean,int,text) to pv_worker;
