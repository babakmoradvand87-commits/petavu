-- §32–44، §56، §161–169، Addendum §96–100: انتشار تنها از خط لولهٔ معتبر.
alter table design.page add column published_indexable boolean not null default false;
alter table design.page add column draft_title text;
alter table design.page add column draft_description text;
alter table design.page add column has_draft_metadata boolean not null default false;
alter table design.page add column draft_archived boolean not null default false;
alter table design.token add column live_enabled boolean not null default true;
alter table design.theme add column live_enabled boolean not null default true;
alter table design.token add column draft_value jsonb;
alter table design.token add column draft_alias_of text;
alter table design.token add column has_draft boolean not null default false;
alter table design.theme add column draft_settings jsonb;
alter table design.release add column previewed_at timestamptz;
alter table design.release add column previewed_by uuid references auth.app_user(id);
alter table design.release add column previewed_hash text;
alter table design.release add column source_hash text;
alter table design.release add column lock_version integer not null default 1;
alter table design.release add column rollback_of uuid references design.release(id);
-- version شمارهٔ انتشار است، نه شمارندهٔ UPDATE؛ trigger قبلی updated_atِ ناموجود می‌خواست.
drop trigger release_touch on design.release;

create function design.assert_access(p_business uuid,p_action text default 'manage') returns void
language plpgsql stable security definer set search_path=pg_catalog,app,design as $$
begin
 if app.current_user_id() is null or p_action not in ('manage','publish','rollback') then raise exception 'permission denied' using errcode='42501'; end if;
 if p_business is null then
   if not app.has_platform_permission('platform.design.manage') then raise exception 'permission denied' using errcode='42501'; end if;
 elsif p_business is distinct from app.current_business_id() or not app.has_permission(p_business,'design.'||p_action) then
   raise exception 'permission denied' using errcode='42501';
 end if;
end $$;

alter function design.validate_tree(jsonb) rename to validate_tree_shallow;
create function design.validate_tree(p_tree jsonb) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,design as $$
declare findings jsonb:='[]'; queue jsonb:='[]'; item jsonb; n jsonb; c design.component; k text; spec jsonb; child jsonb; d int; count_nodes int:=0; ids text[]:='{}';
begin
 if octet_length(p_tree::text)>262144 then return '[{"rule":"structure.size","severity":"blocker","message":"درخت بیش از ۲۵۶ کیبی‌بایت است."}]';end if;
 if jsonb_typeof(p_tree) is distinct from 'object' or jsonb_typeof(p_tree->'root') is distinct from 'array' or jsonb_typeof(p_tree->'version') is distinct from 'number' or p_tree->>'version'<>'1' then
  return '[{"rule":"structure.tree_invalid","severity":"blocker","message":"درخت نسخهٔ ۱ با ریشهٔ آرایه لازم است."}]'; end if;
 for k in select jsonb_object_keys(p_tree) loop if k not in ('version','root') then findings:=findings||jsonb_build_array(jsonb_build_object('rule','security.unknown_root_field','severity','blocker','message','فیلد درخت مجاز نیست','path',k));end if;end loop;
 for n in select jsonb_array_elements(p_tree->'root') loop queue:=queue||jsonb_build_array(jsonb_build_object('n',n,'d',1)); end loop;
 while jsonb_array_length(queue)>0 loop
  item:=queue->0;queue:=queue-0;n:=item->'n';d:=(item->>'d')::int;count_nodes:=count_nodes+1;
  if count_nodes>400 or d>12 then findings:=findings||'[{"rule":"structure.limit","severity":"blocker","message":"سقف عمق یا تعداد گره رد شد."}]';exit; end if;
  if jsonb_typeof(n) is distinct from 'object' or jsonb_typeof(n->'component') is distinct from 'string' then findings:=findings||'[{"rule":"structure.component_missing","severity":"blocker","message":"کامپوننت معتبر لازم است."}]';continue;end if;
  if coalesce(n->>'id','') !~ '^[A-Za-z0-9_-]{1,60}$' or n->>'id'=any(ids) then findings:=findings||'[{"rule":"structure.id","severity":"blocker","message":"شناسهٔ گره باید معتبر و یکتا باشد."}]';end if;ids:=ids||coalesce(n->>'id','');
  for k in select jsonb_object_keys(n) loop if k not in ('id','component','props','slots') then findings:=findings||jsonb_build_array(jsonb_build_object('rule','security.unknown_node_field','severity','blocker','message','فیلد گره مجاز نیست','path',k));end if;end loop;
  select * into c from design.component where key=n->>'component';
  if not found then findings:=findings||jsonb_build_array(jsonb_build_object('rule','registry.component_unknown','severity','blocker','message','کامپوننت ناشناس','path',n->>'id'));continue;end if;
  if c.status<>'active' then findings:=findings||'[{"rule":"registry.component_inactive","severity":"blocker","message":"کامپوننت فعال نیست."}]';end if;
  if jsonb_typeof(coalesce(n->'props','{}'))<>'object' or jsonb_typeof(coalesce(n->'slots','{}'))<>'object' then findings:=findings||'[{"rule":"structure.props_slots","severity":"blocker","message":"پراپ و اسلات باید شیء باشند."}]';continue;end if;
  findings:=findings||design.validate_tree_shallow(jsonb_build_object('root',jsonb_build_array(n)));
  for k in select jsonb_object_keys(coalesce(n->'props','{}')) loop
   spec:=c.props_schema->k;
   if spec is null or k ~* '^(html|script|sql|css|style|on[a-z]+)$' then findings:=findings||jsonb_build_array(jsonb_build_object('rule','security.unknown_prop','severity','blocker','message','پراپ مجاز نیست','path',k));
   elsif spec->>'type' in ('string','longtext','url','enum','asset') and jsonb_typeof(n->'props'->k)<>'string' then findings:=findings||jsonb_build_array(jsonb_build_object('rule','structure.prop_type','severity','blocker','message','نوع پراپ معتبر نیست','path',k));
   elsif spec->>'type' in ('array','object','boolean','number') and jsonb_typeof(n->'props'->k)<>spec->>'type' then findings:=findings||jsonb_build_array(jsonb_build_object('rule','structure.prop_type','severity','blocker','message','نوع پراپ معتبر نیست','path',k)); end if;
  end loop;
  for k in select jsonb_object_keys(coalesce(n->'slots','{}')) loop
   if not c.slots ? k or jsonb_typeof(n->'slots'->k)<>'array' then findings:=findings||'[{"rule":"structure.unknown_slot","severity":"blocker","message":"اسلات یا نوع آن مجاز نیست."}]';continue;end if;
   if jsonb_array_length(n->'slots'->k)>coalesce((c.slots->k->>'max')::int,60) then findings:=findings||'[{"rule":"structure.slot_limit","severity":"blocker","message":"سقف اسلات رد شد."}]';continue;end if;
   for child in select jsonb_array_elements(n->'slots'->k) loop queue:=queue||jsonb_build_array(jsonb_build_object('n',child,'d',d+1));end loop;
  end loop;
 end loop;
 return findings;
end $$;

create function design.save_page(p_id uuid,p_version int,p_tree jsonb,p_summary text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,app,design as $$
declare p design.page; findings jsonb; updated design.page;
begin
 select * into p from design.page where id=p_id for update;if not found then raise exception 'not found' using errcode='P0002';end if;
 perform design.assert_access(p.business_id);
 if p.version<>p_version then raise exception 'version conflict' using errcode='P0409';end if;
 findings:=design.validate_tree(p_tree);if jsonb_array_length(findings)>0 then raise exception 'invalid tree' using errcode='22023',detail=findings::text;end if;
 if p.draft_tree=p_tree and p.draft_revision>0 then return to_jsonb(p);end if;
 update design.page set draft_tree=p_tree,draft_revision=draft_revision+1,draft_updated_at=now(),draft_updated_by=app.current_user_id() where id=p_id returning * into updated;
 insert into design.page_revision(page_id,revision,tree,tree_hash,change_summary,created_by) values(p_id,updated.draft_revision,p_tree,design.tree_hash(p_tree),p_summary,app.current_user_id());
 perform app.record_audit('design.draft_saved','design_page',p_id::text,p.business_id,jsonb_build_object('revision',p.draft_revision),jsonb_build_object('revision',updated.draft_revision));
 perform app.emit_event('design.page_updated','design_page',p_id::text,p.business_id,jsonb_build_object('revision',updated.draft_revision));
 return to_jsonb(updated);
end $$;

create function design.snapshot(p_business uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,app,design,seo as $$
begin
 perform design.assert_access(p_business);
 return jsonb_build_object(
 'pages',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'key',p.key,'title',case when p.has_draft_metadata then p.draft_title else p.title end,'description',case when p.has_draft_metadata then p.draft_description else p.description end,'revision',p.draft_revision,'version',p.version,'tree',p.draft_tree) order by p.key) from design.page p where p.business_id is not distinct from p_business and p.status<>'archived' and not p.draft_archived),'[]'::jsonb),
 'tokens',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'business_id',t.business_id,'key',t.key,'group_key',t.group_key,'value',case when t.has_draft and t.business_id is not distinct from p_business then t.draft_value else t.value end,'value_type',t.value_type,'alias_of',case when t.has_draft and t.business_id is not distinct from p_business then t.draft_alias_of else t.alias_of end,'theme_mode',t.theme_mode,'is_system',t.is_system,'version',case when t.business_id is not distinct from p_business then t.version end) order by (t.business_id is not null),t.key,t.theme_mode) from design.token t where t.business_id is not distinct from p_business or (t.business_id is null and t.live_enabled)),'[]'::jsonb),
 'themes',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'business_id',t.business_id,'key',t.key,'name_fa',t.name_fa,'settings',case when t.business_id is not distinct from p_business then coalesce(t.draft_settings,t.settings) else t.settings end,'is_default',t.is_default,'version',case when t.business_id is not distinct from p_business then t.version end) order by (t.business_id is not null),t.key) from design.theme t where t.business_id is not distinct from p_business or (t.business_id is null and t.live_enabled)),'[]'::jsonb),
 'assets',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'checksum_sha256',a.checksum_sha256,'size_bytes',a.size_bytes,'width',a.width,'height',a.height,'detected_mime',a.detected_mime,'version',a.version) order by a.id) from media.asset a where a.is_public and a.status='ready' and a.deleted_at is null and (a.business_id is null or a.business_id=p_business) and exists(select 1 from design.page p cross join lateral (select v as ref from jsonb_path_query(p.draft_tree,'$.**.assetId') v union all select v as ref from jsonb_path_query(p.draft_tree,'$.**.posterAssetId') v) references_found where p.business_id is not distinct from p_business and (references_found.ref#>>'{}')=a.id::text)),'[]'::jsonb),
 'registry',coalesce((select jsonb_agg(jsonb_build_object('key',c.key,'name_fa',c.name_fa,'category',c.category,'status',c.status,'props_schema',c.props_schema,'slots',c.slots,'a11y',c.a11y,'seo',c.seo,'performance',c.performance,'version',c.version) order by c.key) from design.component c where c.status='active'),'[]'::jsonb),
 'seo',coalesce((select jsonb_build_object('title_separator',s.title_separator,'title_template',s.title_template,'description_fallback',s.description_fallback,'slug_prefix',s.slug_prefix,'default_locale',s.default_locale,'default_region',s.default_region,'extra',s.extra,'version',s.version) from seo.settings s where s.business_id is not distinct from p_business),'{}'::jsonb));
end $$;
create function design.bundle_hash(p_bundle jsonb) returns text language sql immutable as $$ select 'sha256:'||encode(sha256(convert_to(p_bundle::text,'UTF8')),'hex') $$;
create function design.report_stage(p_report jsonb,p_stage text,p_status text,p_evidence jsonb) returns jsonb language sql immutable as $$
 select jsonb_set(coalesce(p_report,'{}'::jsonb),'{checks}',coalesce((select jsonb_agg(case when c->>'stage'=p_stage then jsonb_build_object('stage',p_stage,'status',p_status,'evidence',p_evidence) else c end) from jsonb_array_elements(coalesce(p_report->'checks','[]'::jsonb)) c),'[]'::jsonb),true)
$$;
create function design.create_release(p_business uuid) returns uuid language plpgsql security definer set search_path=pg_catalog,app,design as $$
declare b jsonb; id_new uuid; v int;
begin
 perform design.assert_access(p_business);perform pg_advisory_xact_lock(hashtextextended(coalesce(p_business::text,'platform')||'.design',0));b:=design.snapshot(p_business);
 select id into id_new from design.release where business_id is not distinct from p_business and source_hash=design.bundle_hash(b) and status in ('pending','validating','approved','failed') order by version desc limit 1;
 if found then return id_new;end if;
 if jsonb_array_length(b->'pages')=0 then raise exception 'empty release' using errcode='55000';end if;
 select coalesce(max(version),0)+1 into v from design.release where business_id is not distinct from p_business;
 insert into design.release(business_id,version,bundle,bundle_hash,source_hash,scope,created_by) values(p_business,v,b,design.bundle_hash(b),design.bundle_hash(b),case when p_business is null then 'platform' else 'business' end,app.current_user_id()) returning id into id_new;
 perform app.record_audit('design.release_created','design_release',id_new::text,p_business,null,jsonb_build_object('hash',design.bundle_hash(b),'version',v));return id_new;
end $$;
create function design.guard_release() returns trigger language plpgsql as $$
begin
 if new.bundle is distinct from old.bundle or new.bundle_hash is distinct from old.bundle_hash or new.version<>old.version or new.business_id is distinct from old.business_id or new.scope<>old.scope then raise exception 'immutable release' using errcode='55000';end if;
 if current_user in ('pv_app','pv_worker') then raise exception 'use pipeline functions' using errcode='42501';end if;
 new.lock_version:=old.lock_version+1;return new;
end $$;
create trigger release_lock_touch before update on design.release for each row execute function design.guard_release();
create function design.guard_live() returns trigger language plpgsql as $$
begin
 if tg_op='DELETE' and current_user not in ('pv_app','pv_worker') then return old;end if;
 if current_user in ('pv_app','pv_worker') then
  if tg_op='DELETE' then raise exception 'pipeline required' using errcode='55000';end if;
  if tg_op='INSERT' then
   if tg_table_name='page' then if new.published_tree is not null or new.status='published' then raise exception 'pipeline required' using errcode='55000';end if;
   elsif tg_table_name in ('token','theme') then new.live_enabled:=false;end if;return new;end if;
  if tg_table_name='page' then if (new.published_tree is distinct from old.published_tree or new.published_release_id is distinct from old.published_release_id or new.published_at is distinct from old.published_at or (new.status is distinct from old.status and (old.published_tree is not null or new.status='published')) or new.business_id is distinct from old.business_id or new.key is distinct from old.key or new.scope is distinct from old.scope or new.is_system<>old.is_system or (old.published_tree is not null and (new.title is distinct from old.title or new.description is distinct from old.description))) then raise exception 'pipeline required' using errcode='55000';end if;
  elsif tg_table_name='token' then if (new.value is distinct from old.value or new.alias_of is distinct from old.alias_of or new.live_enabled<>old.live_enabled) then raise exception 'pipeline required' using errcode='55000';end if;
  elsif tg_table_name='theme' then if new.settings is distinct from old.settings or new.live_enabled<>old.live_enabled then raise exception 'pipeline required' using errcode='55000';end if;end if;
 end if;return new;
end $$;
create trigger page_live_guard before insert or update or delete on design.page for each row execute function design.guard_live();
create trigger token_live_guard before insert or update or delete on design.token for each row execute function design.guard_live();
create trigger theme_live_guard before insert or update or delete on design.theme for each row execute function design.guard_live();

create function design.record_validation(p_id uuid,p_report jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,app,design as $$
declare r design.release; s text;
begin
 select * into r from design.release where id=p_id for update;if not found then raise exception 'not found' using errcode='P0002';end if;perform design.assert_access(r.business_id);
 if r.status not in ('pending','validating','failed') then raise exception 'invalid state' using errcode='55000';end if;
 if jsonb_typeof(p_report->'checks') is distinct from 'array' then raise exception 'invalid report' using errcode='22023';end if;
 foreach s in array array['CHANGE','VALIDATE','SECURITY','DB','API','PERFORMANCE','A11Y','SEO','SD','SEARCH','SITEMAP','AI','AUTOMATION'] loop
  if not exists(select 1 from jsonb_array_elements(p_report->'checks') c where c->>'stage'=s and c->>'status' in ('passed','not_applicable')) then
   update design.release set status='failed',validation_report=p_report,failure_note='validation blocked',validated_at=now() where id=p_id returning * into r;return to_jsonb(r);
  end if;
 end loop;
 update design.release set status='validating',validation_report=p_report,validated_at=now(),failure_note=null where id=p_id returning * into r;
 perform app.record_audit('design.validated','design_release',p_id::text,r.business_id,null,jsonb_build_object('hash',r.bundle_hash));return to_jsonb(r);
end $$;
create function design.mark_preview(p_id uuid,p_hash text) returns jsonb language plpgsql security definer set search_path=pg_catalog,app,design as $$
declare r design.release;
begin
 select * into r from design.release where id=p_id for update;if not found then raise exception 'not found' using errcode='P0002';end if;perform design.assert_access(r.business_id);
 if r.status in ('published','superseded','rolled_back') and r.bundle_hash=p_hash then perform app.record_audit('design.release_viewed','design_release',p_id::text,r.business_id,null,jsonb_build_object('hash',p_hash));return to_jsonb(r);end if;
 if r.bundle_hash<>p_hash or r.status not in ('pending','validating') then raise exception 'invalid preview' using errcode='55000';end if;
 update design.release set previewed_at=now(),previewed_by=app.current_user_id(),previewed_hash=p_hash,validation_report=design.report_stage(validation_report,'PREVIEW','passed',jsonb_build_object('hash',p_hash,'viewer',app.current_user_id(),'viewed_at',now())) where id=p_id returning * into r;
 perform app.record_audit('design.previewed','design_release',p_id::text,r.business_id,null,jsonb_build_object('hash',p_hash));return to_jsonb(r);
end $$;
create function design.approve_release(p_id uuid,p_lock int) returns jsonb language plpgsql security definer set search_path=pg_catalog,app,design as $$
declare r design.release;
begin
 select * into r from design.release where id=p_id for update;if not found then raise exception 'not found' using errcode='P0002';end if;perform design.assert_access(r.business_id,'publish');perform app.require_recent_auth();
 if r.lock_version<>p_lock then raise exception 'version conflict' using errcode='P0409';end if;
 if r.status<>'validating' or r.validated_at is null or r.previewed_at is null or r.previewed_hash<>r.bundle_hash or r.source_hash<>design.bundle_hash(design.snapshot(r.business_id)) then raise exception 'preview or validation required / source changed' using errcode='55000';end if;
 update design.release set status='approved',approved_by=app.current_user_id(),approved_at=now(),validation_report=design.report_stage(validation_report,'APPROVAL','passed',jsonb_build_object('approver',app.current_user_id(),'hash',bundle_hash,'approved_at',now())) where id=p_id returning * into r;
 perform app.record_audit('design.approved','design_release',p_id::text,r.business_id,null,jsonb_build_object('hash',r.bundle_hash));return to_jsonb(r);
end $$;
create function design.uri_segment(p_value text) returns text language plpgsql immutable as $$
declare bytes bytea:=convert_to(p_value,'UTF8'); output text:=''; i int; b int;
begin for i in 0..length(bytes)-1 loop b:=get_byte(bytes,i);output:=output||case when b between 65 and 90 or b between 97 and 122 or b between 48 and 57 or b in (45,95,46,126) then chr(b) else '%'||upper(lpad(to_hex(b),2,'0')) end;end loop;return output;end $$;
create function design.public_path(p_key text,p_business uuid default null) returns text language sql stable security definer set search_path=pg_catalog,app,design as $$
 select case when p_business is not null then '/b/'||design.uri_segment((select slug from app.business where id=p_business))||case when p_key='home' then '' else '/'||design.uri_segment(p_key) end when p_key='home' then '/' when p_key in ('about','contact','privacy','terms') then '/'||p_key else '/p/'||design.uri_segment(p_key) end
$$;
create function design.activate_release(p_id uuid,p_lock int,p_rollback boolean default false) returns jsonb language plpgsql security definer set search_path=pg_catalog,app,design,seo as $$
declare r design.release; row_json jsonb; old_id uuid; event_id uuid; audit_id uuid; path_new text; meta_kind text; meta_id uuid; indexable_new boolean; locale_new text;
begin
 select * into r from design.release where id=p_id;if not found then raise exception 'not found' using errcode='P0002';end if;
 perform design.assert_access(r.business_id,case when p_rollback then 'rollback' else 'publish' end);perform app.require_recent_auth();
 perform pg_advisory_xact_lock(hashtextextended(coalesce(r.business_id::text,'platform')||'.design',0));
 select * into r from design.release where id=p_id for update;
 if r.lock_version<>p_lock then raise exception 'version conflict' using errcode='P0409';end if;
 if not p_rollback and (r.status<>'approved' or r.previewed_hash is distinct from r.bundle_hash or r.source_hash<>design.bundle_hash(design.snapshot(r.business_id))) then raise exception 'unapproved or stale release' using errcode='55000';end if;
 if p_rollback and (r.published_at is null or r.status not in ('published','superseded','rolled_back')) then raise exception 'rollback needs a previous published bundle' using errcode='55000';end if;
 select id into old_id from design.release where business_id is not distinct from r.business_id and is_current;
 if p_rollback and old_id=p_id then return to_jsonb(r);end if;
 update design.release set is_current=false,status=case when p_rollback then 'rolled_back' else 'superseded' end,rolled_back_at=case when p_rollback then now() else rolled_back_at end where business_id is not distinct from r.business_id and is_current and id<>p_id;
 update design.page p set status='unpublished',published_tree=null,published_release_id=p_id where p.business_id is not distinct from r.business_id and p.published_tree is not null and not exists(select 1 from jsonb_array_elements(r.bundle->'pages') b where (b->>'id')::uuid=p.id);
 for row_json in select jsonb_array_elements(r.bundle->'pages') loop
  select coalesce((v->>'indexable')::boolean,false) into indexable_new from jsonb_array_elements(coalesce((select c->'evidence'->'pages' from jsonb_array_elements(r.validation_report->'checks') c where c->>'stage'='SEO'),'[]'::jsonb)) v where v->>'id'=row_json->>'id';
  indexable_new:=coalesce(indexable_new,false);
  update design.page set published_indexable=indexable_new,title=row_json->>'title',description=row_json->>'description',has_draft_metadata=case when p_rollback then has_draft_metadata else false end,draft_title=case when p_rollback then draft_title end,draft_description=case when p_rollback then draft_description end,published_tree=row_json->'tree',published_at=now(),published_by=app.current_user_id(),published_release_id=p_id,status='published' where id=(row_json->>'id')::uuid and business_id is not distinct from r.business_id;
  if not found then raise exception 'snapshot page missing' using errcode='55000';end if;
  path_new:=design.public_path(row_json->>'key',r.business_id);locale_new:=coalesce(r.bundle->'seo'->>'default_locale','fa-IR');
  meta_kind:=case when row_json->>'key'='home' then case when r.business_id is null then 'home' else 'business' end else 'content' end;meta_id:=case when meta_kind='business' then r.business_id end;
  update seo.metadata set title=row_json->>'title',description=row_json->>'description',is_indexable=indexable_new,non_indexable_reason=case when indexable_new then null else 'thin_content' end,source_hash=r.bundle_hash where business_id is not distinct from r.business_id and entity_kind=meta_kind and entity_id is not distinct from meta_id and locale=locale_new and (route_key=path_new or (meta_id is not null and route_key is null));
  if not found then insert into seo.metadata(business_id,entity_kind,entity_id,route_key,locale,title,description,is_indexable,non_indexable_reason,source_hash) values(r.business_id,meta_kind,meta_id,path_new,locale_new,row_json->>'title',row_json->>'description',indexable_new,case when indexable_new then null else 'thin_content' end,r.bundle_hash);end if;
 end loop;
 update design.token set live_enabled=false where business_id is not distinct from r.business_id and live_enabled;
 update design.theme set live_enabled=false where business_id is not distinct from r.business_id and live_enabled;
 for row_json in select jsonb_array_elements(r.bundle->'tokens') loop
  if (row_json->>'business_id')::uuid is not distinct from r.business_id then
   update design.token set live_enabled=true,value=row_json->'value',alias_of=row_json->>'alias_of',has_draft=case when p_rollback then has_draft else false end,draft_value=case when p_rollback then draft_value end,draft_alias_of=case when p_rollback then draft_alias_of end where id=(row_json->>'id')::uuid and business_id is not distinct from r.business_id;
  end if;
 end loop;
 for row_json in select jsonb_array_elements(r.bundle->'themes') loop
  update design.theme set live_enabled=true,settings=row_json->'settings',draft_settings=case when p_rollback then draft_settings end where id=(row_json->>'id')::uuid and business_id is not distinct from r.business_id;
 end loop;
 if r.bundle->'seo'<>'{}'::jsonb then update seo.settings set title_separator=r.bundle->'seo'->>'title_separator',title_template=r.bundle->'seo'->>'title_template',description_fallback=r.bundle->'seo'->>'description_fallback',default_locale=r.bundle->'seo'->>'default_locale',default_region=r.bundle->'seo'->>'default_region',extra=r.bundle->'seo'->'extra' where business_id is not distinct from r.business_id;end if;
 update design.release set status='published',is_current=true,published_at=coalesce(published_at,now()) where id=p_id returning * into r;
 audit_id:=app.record_audit(case when p_rollback then 'design.rolled_back' else 'design.published' end,'design_release',p_id::text,r.business_id,jsonb_build_object('release_id',old_id),jsonb_build_object('release_id',p_id,'hash',r.bundle_hash));
 event_id:=app.emit_event(case when p_rollback then 'design.rolled_back' else 'design.published' end,'design_release',p_id::text,r.business_id,jsonb_build_object('release_id',p_id,'hash',r.bundle_hash));
 update design.release set validation_report=design.report_stage(design.report_stage(design.report_stage(validation_report,'PUBLISH','passed',jsonb_build_object('hash',bundle_hash,'published_at',now(),'rollback',p_rollback)),'MONITOR','pending',jsonb_build_object('event_id',event_id,'reason','awaiting_worker_measurement')),'AUDIT','passed',jsonb_build_object('audit_id',audit_id)) where id=p_id returning * into r;
 return to_jsonb(r);
end $$;

-- فقط دادهٔ منتشرشدهٔ امن از این تابع به وب عمومی می‌رسد. پیش‌نویس/راز در خروجی نیست.
create function design.public_tokens(p_business uuid default null)
returns table(key text,group_key text,value jsonb,value_type text,alias_of text,theme_mode text,description text)
language plpgsql stable security definer set search_path=pg_catalog,app,design as $$
declare b jsonb;
begin
 if p_business is not null and not exists(select 1 from app.business where id=p_business and status='active' and visibility='public' and deleted_at is null) then return;end if;
 select bundle into b from design.release where business_id is not distinct from p_business and is_current and status='published';
 if b is not null then return query select t->>'key',t->>'group_key',t->'value',t->>'value_type',t->>'alias_of',t->>'theme_mode',null::text from jsonb_array_elements(b->'tokens') t;return;end if;
 return query select t.key,t.group_key,t.value,t.value_type,t.alias_of,t.theme_mode,t.description from design.token t where t.live_enabled and (t.business_id is null or t.business_id=p_business) order by (t.business_id is not null),t.key;
end $$;
create function design.public_fingerprint(p_business uuid default null) returns text language sql stable security definer set search_path=pg_catalog,app,design as $$
 select case when p_business is not null and not exists(select 1 from app.business where id=p_business and status='active' and visibility='public' and deleted_at is null) then 'unavailable' else coalesce((select id::text from design.release where business_id is not distinct from p_business and is_current and status='published'),(select max(updated_at)::text from design.token where business_id is null),'bootstrap') end
$$;
revoke all on function design.assert_access(uuid,text),design.validate_tree(jsonb),design.save_page(uuid,int,jsonb,text),design.snapshot(uuid),design.create_release(uuid),design.record_validation(uuid,jsonb),design.mark_preview(uuid,text),design.approve_release(uuid,int),design.activate_release(uuid,int,boolean),design.public_tokens(uuid),design.public_fingerprint(uuid) from public;
grant execute on function design.assert_access(uuid,text),design.validate_tree(jsonb),design.save_page(uuid,int,jsonb,text),design.snapshot(uuid),design.create_release(uuid),design.record_validation(uuid,jsonb),design.mark_preview(uuid,text),design.approve_release(uuid,int),design.activate_release(uuid,int,boolean) to pv_app;
grant execute on function design.public_tokens(uuid),design.public_fingerprint(uuid) to pv_public,pv_app,pv_worker,pv_reader;

revoke all on function design.bundle_hash(jsonb),design.report_stage(jsonb,text,text,jsonb),design.guard_release(),design.guard_live() from public;
grant execute on function design.bundle_hash(jsonb) to pv_app,pv_worker;
-- RLSِ عمومی، هیچ ردیف تازه/پیش‌نویسِ نامنتشر را نمی‌بیند؛ Draft پلتفرم برای عضو هم خصوصی است.
drop policy token_read_public on design.token;
create policy token_read_public on design.token for select to pv_public using(business_id is null and live_enabled);
drop policy token_read_app on design.token;
create policy token_read_app on design.token for select to pv_app,pv_worker using(
 (business_id is null and app.has_platform_permission('platform.design.manage')) or
 (business_id=app.current_business_id() and app.has_permission(business_id,'design.manage')));
drop policy theme_read_app on design.theme;
create policy theme_read_app on design.theme for select to pv_app,pv_worker using(
 (business_id is null and app.has_platform_permission('platform.design.manage')) or
 (business_id=app.current_business_id() and app.has_permission(business_id,'design.manage')));
create function design.studio_tokens(p_business uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,app,design as $$
begin
 perform design.assert_access(p_business);
 return coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'business_id',t.business_id,'key',t.key,'group_key',t.group_key,'value',t.value,'value_type',t.value_type,'alias_of',t.alias_of,'theme_mode',t.theme_mode,'is_system',t.is_system,'version',t.version,'draft_value',case when t.business_id is not distinct from p_business then t.draft_value end,'draft_alias_of',case when t.business_id is not distinct from p_business then t.draft_alias_of end,'has_draft',case when t.business_id is not distinct from p_business then t.has_draft else false end) order by (t.business_id is not null),t.key,t.theme_mode) from design.token t where t.business_id is not distinct from p_business or (t.business_id is null and t.live_enabled)),'[]'::jsonb);
end $$;
create function design.override_token(p_id uuid,p_business uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,app,design as $$
declare t design.token; n design.token;
begin
 perform design.assert_access(p_business);if p_business is null then raise exception 'business scope required' using errcode='55000';end if;
 select * into t from design.token where id=p_id and business_id is null and live_enabled;if not found then raise exception 'not found' using errcode='P0002';end if;
 select * into n from design.token where business_id=p_business and key=t.key and theme_mode=t.theme_mode;
 if found then return to_jsonb(n);end if;
 insert into design.token(business_id,group_key,key,value,value_type,alias_of,theme_mode,live_enabled,has_draft,draft_value,draft_alias_of) values(p_business,t.group_key,t.key,t.value,t.value_type,t.alias_of,t.theme_mode,false,true,t.value,t.alias_of) returning * into n;
 perform app.record_audit('design.token_override_created','design_token',n.id::text,p_business);return to_jsonb(n);
end $$;
revoke all on function design.studio_tokens(uuid),design.override_token(uuid,uuid) from public;
grant execute on function design.studio_tokens(uuid),design.override_token(uuid,uuid) to pv_app;

drop policy theme_read_public on design.theme;
create policy theme_read_public on design.theme for select to pv_public using(business_id is null and live_enabled);
create function design.public_registry(p_business uuid,p_key text) returns jsonb language sql stable security definer set search_path=pg_catalog,app,design as $$
 select r.bundle->'registry' from design.page p join design.release r on r.id=p.published_release_id where p.business_id is not distinct from p_business and p.key=p_key and p.status='published' and (p.business_id is null or exists(select 1 from app.business b where b.id=p.business_id and b.status='active' and b.visibility='public' and b.deleted_at is null))
$$;
create view design.public_sitemap_source with (security_barrier=true) as select design.public_path(p.key,p.business_id) as path,p.published_at as last_modified,p.id from design.page p where p.key<>'home' and p.status='published' and p.published_indexable and (p.business_id is null or exists(select 1 from app.business b where b.id=p.business_id and b.status='active' and b.visibility='public' and b.deleted_at is null)) and not exists(select 1 from seo.metadata m where m.route_key=design.public_path(p.key,p.business_id) and not m.is_indexable);
revoke all on design.public_sitemap_source from public,pv_public,pv_app,pv_worker,pv_reader;
create index page_sitemap_idx on design.page(id,business_id,key) where status='published' and published_indexable;
create index metadata_noindex_route_idx on seo.metadata(route_key) where not is_indexable;
create function design.sitemap_pages(p_limit int default 1000,p_offset int default 0) returns table(path text,last_modified timestamptz) language sql stable security definer set search_path=pg_catalog,design as $$
 select v.path,v.last_modified from design.public_sitemap_source v order by v.id limit least(greatest(p_limit,1),50000) offset greatest(p_offset,0)
$$;
create function design.sitemap_count() returns bigint language sql stable security definer set search_path=pg_catalog,design as $$ select count(*) from design.public_sitemap_source $$;
revoke all on function design.uri_segment(text),design.public_path(text,uuid),design.public_registry(uuid,text),design.sitemap_pages(int,int),design.sitemap_count() from public;
grant execute on function design.public_registry(uuid,text),design.sitemap_pages(int,int),design.sitemap_count() to pv_public,pv_app,pv_worker,pv_reader;

create function design.public_token_records(p_business uuid default null) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,app,design as $$
declare b jsonb;
begin
 if p_business is not null and not exists(select 1 from app.business where id=p_business and status='active' and visibility='public' and deleted_at is null) then return '[]';end if;
 select bundle into b from design.release where business_id is not distinct from p_business and is_current and status='published';
 if b is not null then return coalesce((select jsonb_agg(jsonb_build_object('id',t->'id','business_id',t->'business_id','group_key',t->'group_key','key',t->'key','value',t->'value','value_type',t->'value_type','alias_of',t->'alias_of','description',null,'is_system',t->'is_system','theme_mode',t->'theme_mode')) from jsonb_array_elements(b->'tokens') t),'[]'::jsonb);end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'business_id',t.business_id,'group_key',t.group_key,'key',t.key,'value',t.value,'value_type',t.value_type,'alias_of',t.alias_of,'description',t.description,'is_system',t.is_system,'theme_mode',t.theme_mode) order by t.group_key,t.key) from design.token t where t.live_enabled and (t.business_id is null or t.business_id=p_business)),'[]'::jsonb);
end $$;
revoke all on function design.public_token_records(uuid) from public;
grant execute on function design.public_token_records(uuid) to pv_public,pv_app,pv_worker,pv_reader;

create function design.public_theme_settings(p_business uuid default null) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,app,design as $$
declare b jsonb; settings_new jsonb;
begin
 if p_business is not null and not exists(select 1 from app.business where id=p_business and status='active' and visibility='public' and deleted_at is null) then return '{}';end if;
 select bundle into b from design.release where business_id is not distinct from p_business and is_current and status='published';
 if b is not null then select t->'settings' into settings_new from jsonb_array_elements(b->'themes') t order by (t->>'business_id' is not null) desc,(t->>'is_default')::boolean desc limit 1;return coalesce(settings_new,'{}'::jsonb);end if;
 select settings into settings_new from design.theme where live_enabled and (business_id is null or business_id=p_business) order by (business_id is not null) desc,is_default desc limit 1;return coalesce(settings_new,'{}'::jsonb);
end $$;
revoke all on function design.public_theme_settings(uuid) from public;
grant execute on function design.public_theme_settings(uuid) to pv_public,pv_app,pv_worker,pv_reader;
