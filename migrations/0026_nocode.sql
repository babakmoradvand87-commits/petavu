-- Addendum §73–87: تعریف‌ها داده‌اند؛ CRUD به همان app.content و همان workflow وصل است.
create table design.definition(
 id uuid primary key default gen_random_uuid(),business_id uuid references app.business(id),
 key text not null check(key ~ '^[a-z][a-z0-9_]{1,59}$'),kind text not null check(kind in('field','relationship','form','crud')),
 draft_spec jsonb not null,live_spec jsonb,live_enabled boolean not null default false,
 live_release_id uuid references design.release(id),revision int not null default 1,
 created_by uuid references auth.app_user(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),version int not null default 1,
 constraint definition_spec_size check(octet_length(draft_spec::text)<=65536)
);
create unique index definition_scope_key_idx on design.definition(coalesce(business_id,'00000000-0000-0000-0000-000000000000'::uuid),kind,key);
create index definition_business_kind_idx on design.definition(business_id,kind,id);
create trigger definition_touch before update on design.definition for each row execute function app.touch();
create table design.definition_revision(id uuid primary key default gen_random_uuid(),definition_id uuid not null references design.definition(id),revision int not null,spec jsonb not null,spec_hash text not null,created_by uuid references auth.app_user(id),created_at timestamptz not null default now(),unique(definition_id,revision));
create trigger definition_revision_append before update or delete on design.definition_revision for each row execute function app.forbid_mutation();
-- دادهٔ خصوصی بیرون از سطر عمومی content است؛ هیچ گرنت عمومی روی آن نیست.
create table app.content_extension(content_id uuid primary key references app.content(id) on delete restrict,business_id uuid references app.business(id),definition_id uuid not null references design.definition(id),values jsonb not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),version int not null default 1);
create index content_extension_scope_idx on app.content_extension(business_id,definition_id,content_id);
create index content_extension_values_idx on app.content_extension using gin(values);
create trigger content_extension_touch before update on app.content_extension for each row execute function app.touch();
create table app.form_submission(id uuid primary key default gen_random_uuid(),business_id uuid references app.business(id),form_id uuid not null references design.definition(id),schema_hash text not null,values jsonb not null,consented boolean not null check(consented),idempotency_key uuid not null,payload_hash text not null,request_id text,created_at timestamptz not null default now());
create unique index form_submission_dedupe_idx on app.form_submission(coalesce(business_id,'00000000-0000-0000-0000-000000000000'::uuid),form_id,idempotency_key);
create index form_submission_scope_idx on app.form_submission(business_id,created_at desc,id desc);
create trigger form_submission_append before update or delete on app.form_submission for each row execute function app.forbid_mutation();

alter table design.definition enable row level security;
alter table design.definition_revision enable row level security;
alter table app.content_extension enable row level security;
alter table app.form_submission enable row level security;
create policy definition_read on design.definition for select to pv_app,pv_worker using((business_id=app.current_business_id() and app.has_permission(business_id,'design.manage')) or (business_id is null and app.has_platform_permission('platform.design.manage')));
create policy definition_write on design.definition for all to pv_app using((business_id=app.current_business_id() and app.has_permission(business_id,'design.manage')) or (business_id is null and app.has_platform_permission('platform.design.manage'))) with check((business_id=app.current_business_id() and app.has_permission(business_id,'design.manage')) or (business_id is null and app.has_platform_permission('platform.design.manage')));
create policy definition_reader on design.definition for select to pv_reader using(true);
create policy definition_revision_read on design.definition_revision for select to pv_app using(exists(select 1 from design.definition d where d.id=definition_id));
create policy definition_revision_reader on design.definition_revision for select to pv_reader using(true);
create policy extension_read on app.content_extension for select to pv_app using((business_id=app.current_business_id() and app.has_permission(business_id,'content.update')) or app.has_platform_permission('platform.content.moderate'));
create policy extension_write on app.content_extension for all to pv_app using((business_id=app.current_business_id() and app.has_permission(business_id,'content.update')) or app.has_platform_permission('platform.content.moderate')) with check((business_id=app.current_business_id() and app.has_permission(business_id,'content.create')) or app.has_platform_permission('platform.content.moderate'));
create policy extension_reader on app.content_extension for select to pv_reader using(true);
create policy submission_read on app.form_submission for select to pv_app using((business_id=app.current_business_id() and app.has_permission(business_id,'content.review')) or (business_id is null and app.has_platform_permission('platform.design.manage')));
create policy submission_reader on app.form_submission for select to pv_reader using(true);
revoke all on design.definition,design.definition_revision,app.content_extension,app.form_submission from public,pv_public,pv_app,pv_worker,pv_reader;
grant select,insert,update on design.definition to pv_app;
grant select on design.definition to pv_worker,pv_reader;
grant select on design.definition_revision to pv_app,pv_reader;
grant select,insert,update on app.content_extension to pv_app;
grant select on app.content_extension to pv_reader;
grant select on app.form_submission to pv_app,pv_reader;

create function design.validate_definition(p_kind text,p_spec jsonb) returns void language plpgsql immutable set search_path=pg_catalog,design as $$
declare k text; allowed text[];
begin
 if jsonb_typeof(p_spec) is distinct from 'object' or octet_length(p_spec::text)>65536 then raise exception 'invalid definition' using errcode='22023';end if;
 allowed:=case p_kind when 'field' then array['type','label_fa','label_en','required','public','sensitive','min','max','max_length','options','reference_model','read_permission'] when 'form' then array['title_fa','title_en','field_ids','purpose','public','consent_required','success_message','submit_label'] when 'crud' then array['title_fa','title_en','field_ids','content_kind','title_field','summary_field','search_fields'] when 'relationship' then array['label_fa','label_en','relationship_kind','symmetric'] end;
 if allowed is null then raise exception 'invalid kind' using errcode='22023';end if;
 for k in select jsonb_object_keys(p_spec) loop if not k=any(allowed) then raise exception 'unknown definition property' using errcode='22023';end if;end loop;
 if p_kind='field' and (p_spec->>'type' not in ('text','longtext','number','boolean','date','email','phone','url','enum','reference','asset') or coalesce(length(p_spec->>'label_fa'),0)=0 or (p_spec->>'public'='true' and p_spec->>'sensitive'='true')) then raise exception 'invalid field' using errcode='22023';end if;
 if p_kind in('form','crud') and (jsonb_typeof(p_spec->'field_ids') is distinct from 'array' or jsonb_array_length(p_spec->'field_ids') not between 1 and 30) then raise exception 'invalid fields' using errcode='22023';end if;
 if p_kind='form' and (p_spec->>'consent_required' is distinct from 'true' or p_spec->>'purpose' not in('contact','lead','newsletter','custom')) then raise exception 'consent required' using errcode='22023';end if;
 if p_kind='crud' and p_spec->>'content_kind' not in('page','article','service','listing') then raise exception 'unsafe CRUD target' using errcode='22023';end if;
 if p_kind='relationship' and p_spec->>'relationship_kind' not in('partner','supplier','customer','parent','branch_of','affiliate') then raise exception 'invalid relationship kind' using errcode='22023';end if;
end $$;
create function design.save_definition(p_id uuid,p_lock int,p_spec jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,app,design as $$
declare d design.definition;
begin
 select * into d from design.definition where id=p_id for update;if not found then raise exception 'not found' using errcode='P0002';end if;perform design.assert_access(d.business_id);
 if d.version<>p_lock then raise exception 'version conflict' using errcode='P0409';end if;perform design.validate_definition(d.kind,p_spec);
 if d.draft_spec=p_spec then return to_jsonb(d);end if;
 update design.definition set draft_spec=p_spec,revision=revision+1 where id=p_id returning * into d;
 insert into design.definition_revision(definition_id,revision,spec,spec_hash,created_by) values(d.id,d.revision,p_spec,design.bundle_hash(p_spec),app.current_user_id());
 perform app.record_audit('nocode.definition_drafted','definition',d.id::text,d.business_id,null,jsonb_build_object('revision',d.revision));perform app.emit_event('nocode.definition_updated','definition',d.id::text,d.business_id,jsonb_build_object('kind',d.kind));return to_jsonb(d);
end $$;
create function design.guard_definition() returns trigger language plpgsql as $$
begin
 if current_user in('pv_app','pv_worker') then
  if tg_op='DELETE' or (tg_op='INSERT' and new.live_enabled) then raise exception 'pipeline required' using errcode='55000';end if;
  if tg_op='UPDATE' and (new.live_spec is distinct from old.live_spec or new.live_enabled<>old.live_enabled or new.live_release_id is distinct from old.live_release_id or new.business_id is distinct from old.business_id or new.key<>old.key or new.kind<>old.kind) then raise exception 'immutable scope / pipeline required' using errcode='55000';end if;
 end if;return new;
end $$;
create trigger definition_live_guard before insert or update or delete on design.definition for each row execute function design.guard_definition();
create function design.list_definitions(p_business uuid,p_drafts boolean default true) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,app,design as $$
declare frozen jsonb;
begin
 if p_drafts then perform design.assert_access(p_business);
 elsif app.current_user_id() is null or (p_business is not null and (p_business is distinct from app.current_business_id() or not app.is_member_of(p_business))) or (p_business is null and not(app.has_platform_permission('platform.design.manage') or app.has_platform_permission('platform.content.moderate'))) then raise exception 'permission denied' using errcode='42501';end if;
 if not p_drafts then select bundle->'definitions' into frozen from design.release where business_id is not distinct from p_business and is_current and status='published';if frozen is not null then return frozen;end if;end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'business_id',d.business_id,'key',d.key,'kind',d.kind,'spec',case when p_drafts and d.business_id is not distinct from p_business then d.draft_spec else d.live_spec end,'version',case when d.business_id is not distinct from p_business then d.version end,'revision',d.revision,'live_enabled',d.live_enabled) order by d.kind,d.key) from design.definition d where (p_drafts and d.business_id is not distinct from p_business) or (d.live_enabled and (d.business_id is null or d.business_id=p_business))),'[]'::jsonb);
end $$;
alter function design.snapshot(uuid) rename to snapshot_design_0025;
revoke execute on function design.snapshot_design_0025(uuid) from pv_app;
create function design.snapshot(p_business uuid) returns jsonb language sql stable security definer set search_path=pg_catalog,design as $$
 select design.snapshot_design_0025(p_business)||jsonb_build_object('definitions',design.list_definitions(p_business,true))
$$;
alter function design.activate_release(uuid,int,boolean) rename to activate_design_0025;
revoke execute on function design.activate_design_0025(uuid,int,boolean) from pv_app;
create function design.activate_release(p_id uuid,p_lock int,p_rollback boolean default false) returns jsonb language plpgsql security definer set search_path=pg_catalog,app,design as $$
declare r design.release; item jsonb; result jsonb;
begin
 result:=design.activate_design_0025(p_id,p_lock,p_rollback);select * into r from design.release where id=p_id;
 update design.definition set live_enabled=false where business_id is not distinct from r.business_id and live_enabled and not exists(select 1 from jsonb_array_elements(coalesce(r.bundle->'definitions','[]'::jsonb)) d where (d->>'id')::uuid=design.definition.id);
 for item in select jsonb_array_elements(coalesce(r.bundle->'definitions','[]'::jsonb)) loop
  update design.definition set live_enabled=true,live_spec=item->'spec',live_release_id=p_id where id=(item->>'id')::uuid and business_id is not distinct from r.business_id and (live_spec is distinct from item->'spec' or not live_enabled or live_release_id is distinct from p_id);
 end loop;perform app.reproject_nocode_content(r.business_id);return result;
end $$;

-- فقط مشخصات منتشرشده از release همان receiver؛ پیکربندی خصوصی/پیش‌نویس هرگز عمومی نیست.
create function design.public_definitions(p_business uuid default null) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,app,design as $$
declare b jsonb;
begin
 if p_business is not null and not exists(select 1 from app.business where id=p_business and status='active' and visibility='public' and deleted_at is null) then return '[]';end if;
 select bundle into b from design.release where business_id is not distinct from p_business and is_current and status='published';
 if b?'definitions' then return b->'definitions';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'business_id',business_id,'key',key,'kind',kind,'spec',live_spec,'version',version)) from design.definition where live_enabled and (business_id is null or business_id=p_business)),'[]'::jsonb);
end $$;
create function design.public_form(p_id uuid,p_business uuid default null) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,app,design as $$
declare defs jsonb; f jsonb; fields jsonb;
begin
 defs:=design.public_definitions(p_business);
 select d into f from jsonb_array_elements(defs) d where d->>'id'=p_id::text and d->>'kind'='form' and d->'spec'->>'public'='true';if f is null then return null;end if;
 if p_business is not null and not exists(select 1 from design.page p where p.business_id=p_business and p.status='published' and (p.published_tree::text like '%'||p_id::text||'%' or p.published_tree::text like '%form.'||case f->'spec'->>'purpose' when 'contact' then 'contact_form' when 'lead' then 'lead_form' when 'newsletter' then 'newsletter' else 'schema_form' end||'%')) then return null;end if;
 select coalesce(jsonb_agg(d),'[]'::jsonb) into fields from jsonb_array_elements(defs) d where d->>'kind'='field' and f->'spec'->'field_ids' @> jsonb_build_array(d->>'id');
 if jsonb_array_length(fields)<>jsonb_array_length(f->'spec'->'field_ids') then return null;end if;
 return jsonb_build_object('form',f,'fields',fields,'schema_hash',design.bundle_hash(jsonb_build_object('form',f->'spec','fields',fields)),'business_id',p_business);
end $$;
create function app.submit_nocode_form(p_form uuid,p_business uuid,p_schema_hash text,p_values jsonb,p_consent boolean,p_key uuid) returns uuid language plpgsql security definer set search_path=pg_catalog,app,design as $$
declare schema_data jsonb; f jsonb; s jsonb; v jsonb; k text; created uuid; old app.form_submission; hash_new text;
begin
 schema_data:=design.public_form(p_form,p_business);if schema_data is null then raise exception 'not found' using errcode='P0002';end if;
 if schema_data->>'schema_hash'<>p_schema_hash then raise exception 'form changed' using errcode='P0409';end if;
 if not coalesce(p_consent,false) or jsonb_typeof(p_values) is distinct from 'object' or octet_length(p_values::text)>32768 then raise exception 'invalid submission' using errcode='22023';end if;
 for k in select jsonb_object_keys(p_values) loop if not exists(select 1 from jsonb_array_elements(schema_data->'fields') field where field->>'key'=k) then raise exception 'unknown field' using errcode='22023';end if;end loop;
 for f in select jsonb_array_elements(schema_data->'fields') loop
  k:=f->>'key';s:=f->'spec';v:=p_values->k;
  if v is null or v='null'::jsonb or v='""'::jsonb then if s->>'required'='true' then raise exception 'required field' using errcode='22023';end if;continue;end if;
  if s->>'type' in ('boolean','number') then if jsonb_typeof(v)<>s->>'type' then raise exception 'field type' using errcode='22023';end if;
  elsif jsonb_typeof(v)<>'string' or length(v#>>'{}')>coalesce((s->>'max_length')::int,4000) then raise exception 'field text' using errcode='22023';end if;
  if s->>'type'='email' and (v#>>'{}') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'email format' using errcode='22023';end if;
  if s->>'type'='enum' and not exists(select 1 from jsonb_array_elements(s->'options') o where o->>'key'=v#>>'{}') then raise exception 'enum value' using errcode='22023';end if;
  if s->>'type'='number' and ((s?'min' and (v#>>'{}')::numeric<(s->>'min')::numeric) or (s?'max' and (v#>>'{}')::numeric>(s->>'max')::numeric)) then raise exception 'number bounds' using errcode='22023';end if;
 end loop;
 hash_new:=design.bundle_hash(p_values);
 perform pg_advisory_xact_lock(hashtextextended(coalesce(p_business::text,'platform')||p_form::text||p_key::text,0));
 select * into old from app.form_submission where form_id=p_form and business_id is not distinct from p_business and idempotency_key=p_key;
 if found then if old.payload_hash<>hash_new then raise exception 'idempotency conflict' using errcode='P0409';end if;return old.id;end if;
 insert into app.form_submission(business_id,form_id,schema_hash,values,consented,idempotency_key,payload_hash,request_id) values(p_business,p_form,p_schema_hash,p_values,true,p_key,hash_new,app.current_request_id()) returning id into created;
 perform app.emit_event('form.submitted','form_submission',created::text,p_business,jsonb_build_object('form_id',p_form,'purpose',schema_data->'form'->'spec'->>'purpose','submission_id',created));
 perform app.record_audit('form.submitted','form_submission',created::text,p_business,null,jsonb_build_object('form_id',p_form,'fields',(select count(*) from jsonb_object_keys(p_values))));
 return created;
end $$;
create function app.request_nocode_relationship(p_definition uuid,p_target uuid,p_note text default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,app,design as $$
declare d jsonb; r app.business_relationship; current_business uuid:=app.current_business_id();
begin
 if current_business is null or not app.has_permission(current_business,'business.relationship.manage') then raise exception 'permission denied' using errcode='42501';end if;
 select v into d from jsonb_array_elements(design.list_definitions(current_business,false)) v where v->>'id'=p_definition::text and v->>'kind'='relationship';if d is null then raise exception 'not found' using errcode='P0002';end if;
 if p_target=current_business or not exists(select 1 from app.business where id=p_target and status='active' and visibility='public' and deleted_at is null) then raise exception 'not found' using errcode='P0002';end if;
 insert into app.business_relationship(from_business_id,to_business_id,kind,is_symmetric,note,requested_by) values(current_business,p_target,d->'spec'->>'relationship_kind',coalesce((d->'spec'->>'symmetric')::boolean,false),p_note,app.current_user_id()) returning * into r;
 perform app.record_audit('business.relationship_requested','business_relationship',r.id::text,current_business);perform app.emit_event('business.relationship_requested','business_relationship',r.id::text,current_business,jsonb_build_object('target_business_id',p_target));return to_jsonb(r);
end $$;
create function app.relationship_state(p_id uuid,p_lock int,p_to text) returns jsonb language plpgsql security definer set search_path=pg_catalog,app as $$
declare r app.business_relationship; b uuid:=app.current_business_id();
begin
 select * into r from app.business_relationship where id=p_id for update;if not found or b not in(r.from_business_id,r.to_business_id) then raise exception 'not found' using errcode='P0002';end if;
 if not app.has_permission(b,'business.relationship.manage') then raise exception 'permission denied' using errcode='42501';end if;
 if r.version<>p_lock then raise exception 'version conflict' using errcode='P0409';end if;
 if not ((r.status='pending' and p_to in('active','rejected') and b=r.to_business_id) or (r.status='active' and p_to='ended')) then raise exception 'invalid relationship edge' using errcode='55000';end if;
 update app.business_relationship set status=p_to,confirmed_at=case when p_to='active' then now() else confirmed_at end,ended_at=case when p_to='ended' then now() else ended_at end where id=p_id returning * into r;
 perform app.record_audit('business.relationship_'||p_to,'business_relationship',r.id::text,b);perform app.emit_event('business.relationship_'||p_to,'business_relationship',r.id::text,b,jsonb_build_object('from_business_id',r.from_business_id,'to_business_id',r.to_business_id));return to_jsonb(r);
end $$;
revoke all on function design.validate_definition(text,jsonb),design.save_definition(uuid,int,jsonb),design.guard_definition(),design.list_definitions(uuid,boolean),design.snapshot(uuid),design.activate_release(uuid,int,boolean),design.public_definitions(uuid),design.public_form(uuid,uuid),app.submit_nocode_form(uuid,uuid,text,jsonb,boolean,uuid),app.request_nocode_relationship(uuid,uuid,text),app.relationship_state(uuid,int,text) from public;
grant execute on function design.validate_definition(text,jsonb),design.save_definition(uuid,int,jsonb),design.list_definitions(uuid,boolean),design.snapshot(uuid),design.activate_release(uuid,int,boolean),app.request_nocode_relationship(uuid,uuid,text),app.relationship_state(uuid,int,text) to pv_app;
grant execute on function design.public_form(uuid,uuid) to pv_public,pv_app,pv_worker,pv_reader;
grant execute on function app.submit_nocode_form(uuid,uuid,text,jsonb,boolean,uuid) to pv_public,pv_app;

create function design.public_forms(p_business uuid default null) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,app,design as $$
declare d jsonb; f jsonb; output jsonb:='[]';
begin
 for d in select jsonb_array_elements(design.public_definitions(p_business)) loop
  if d->>'kind'='form' then f:=design.public_form((d->>'id')::uuid,p_business);if f is not null then output:=output||jsonb_build_array(f);end if;end if;
 end loop;return output;
end $$;
create function app.guard_content_extension() returns trigger language plpgsql security definer set search_path=pg_catalog,app,design as $$
begin
 if not exists(select 1 from app.content c where c.id=new.content_id and c.business_id is not distinct from new.business_id) or not exists(select 1 from design.definition d where d.id=new.definition_id and d.kind='crud' and d.live_enabled and (d.business_id is null or d.business_id is not distinct from new.business_id)) then raise exception 'invalid scoped extension' using errcode='42501';end if;return new;
end $$;
create trigger content_extension_scope_guard before insert or update on app.content_extension for each row execute function app.guard_content_extension();
revoke all on function design.public_forms(uuid),app.guard_content_extension() from public;
grant execute on function design.public_forms(uuid) to pv_public,pv_app,pv_worker,pv_reader;
create function design.create_definition(p_business uuid,p_key text,p_kind text,p_spec jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,app,design as $$
declare d design.definition;
begin
 perform design.assert_access(p_business);perform design.validate_definition(p_kind,p_spec);
 if p_key in('constructor','prototype','sql','js','script','html','css') then raise exception 'reserved definition key' using errcode='22023';end if;
 insert into design.definition(business_id,key,kind,draft_spec,created_by) values(p_business,p_key,p_kind,p_spec,app.current_user_id()) returning * into d;
 insert into design.definition_revision(definition_id,revision,spec,spec_hash,created_by) values(d.id,1,p_spec,design.bundle_hash(p_spec),app.current_user_id());
 if p_kind='crud' or (p_kind='form' and p_spec->>'public'='true') then
  insert into design.page(business_id,key,title,scope,is_system,draft_tree) values(p_business,case when p_kind='form' then 'form-' else 'collection-' end||substr(p_key,1,48),p_spec->>'title_fa',case when p_business is null then 'platform' else 'business' end,p_business is null,jsonb_build_object('version',1,'root',jsonb_build_array(jsonb_build_object('id','heading','component','content.heading','props',jsonb_build_object('text',p_spec->>'title_fa','level','h1')),jsonb_build_object('id','builder','component',case when p_kind='form' then 'form.schema_form' else 'data.crud_list' end,'props',jsonb_build_object(case when p_kind='form' then 'formId' else 'definitionId' end,d.id)))));
 end if;
 perform app.record_audit('nocode.definition_created','definition',d.id::text,p_business,null,jsonb_build_object('kind',p_kind));perform app.emit_event('nocode.definition_created','definition',d.id::text,p_business,jsonb_build_object('kind',p_kind));return to_jsonb(d);
end $$;
revoke all on function design.create_definition(uuid,text,text,jsonb) from public;
grant execute on function design.create_definition(uuid,text,text,jsonb) to pv_app;

create function design.public_records(p_definition uuid,p_business uuid default null) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,app,design as $$
declare defs jsonb; model jsonb;
begin
 defs:=design.public_definitions(p_business);select d into model from jsonb_array_elements(defs) d where d->>'id'=p_definition::text and d->>'kind'='crud';if model is null then return null;end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'slug',c.slug,'business_slug',b.slug)) from (select c.id,c.title,c.slug,c.business_id from app.content c join app.content_extension e on e.content_id=c.id where e.definition_id=p_definition and c.business_id is not distinct from p_business and c.status='published' and c.visibility='public' and c.deleted_at is null order by c.id desc limit 12) c left join app.business b on b.id=c.business_id),'[]'::jsonb);
end $$;
create function app.reproject_nocode_content(p_business uuid) returns int language plpgsql security definer set search_path=pg_catalog,app,design as $$
declare ids uuid; e app.content_extension; defs jsonb; model jsonb; f jsonb; blocks jsonb; body_text_new text; title_new text; summary_new text; n int:=0;
begin
 defs:=design.list_definitions(p_business,false);
 for ids in select content_id from app.content_extension where business_id is not distinct from p_business loop
  perform 1 from app.content where id=ids for update;select * into e from app.content_extension where content_id=ids for update;
  select d into model from jsonb_array_elements(defs) d where d->>'id'=e.definition_id::text and d->>'kind'='crud';if model is null then continue;end if;
  blocks:='[]';body_text_new:='';title_new:=e.values->>(model->'spec'->>'title_field');summary_new:=case when model->'spec'?'summary_field' then e.values->>(model->'spec'->>'summary_field') end;
  if coalesce(length(title_new),0)<2 or length(title_new)>200 then raise exception 'schema requires record backfill first' using errcode='55000';end if;
  for f in select d from jsonb_array_elements(defs) d where d->>'kind'='field' and model->'spec'->'field_ids'@>jsonb_build_array(d->>'id') and d->'spec'->>'public'='true' and coalesce(d->'spec'->>'sensitive','false')<>'true' loop
   if e.values? (f->>'key') then blocks:=blocks||jsonb_build_array(jsonb_build_object('kind','paragraph','text',(f->'spec'->>'label_fa')||': '||(e.values->>(f->>'key'))));body_text_new:=body_text_new||(f->'spec'->>'label_fa')||': '||(e.values->>(f->>'key'))||E'
';end if;
  end loop;
  update app.content set title=title_new,summary=summary_new,body=jsonb_build_object('type','doc','blocks',blocks),body_text=body_text_new where id=e.content_id;
  perform app.emit_event('content.updated','content',e.content_id::text,p_business,jsonb_build_object('schema_projection',true));n:=n+1;
 end loop;
 if n>0 then perform app.record_audit('nocode.schema_reprojected','schema',coalesce(p_business::text,'platform'),p_business,null,jsonb_build_object('records',n));end if;return n;
end $$;
revoke all on function design.public_records(uuid,uuid),app.reproject_nocode_content(uuid) from public;
grant execute on function design.public_records(uuid,uuid) to pv_public,pv_app,pv_worker,pv_reader;
-- Projection و metadata از همان دادهٔ عمومی تولید می‌شوند؛ نیازمند جعل پیش‌شرط Worker نیستند.
create function app.nocode_metadata(p_content uuid) returns void language plpgsql security definer set search_path=pg_catalog,app,design,seo as $$
declare c app.content; indexable_new boolean; h text;
begin
 select * into c from app.content where id=p_content;if not found then return;end if;
 if app.current_user_id() is null or (c.business_id is not null and (c.business_id is distinct from app.current_business_id() or not (app.has_permission(c.business_id,'content.create') or app.has_permission(c.business_id,'content.update') or app.has_permission(c.business_id,'design.publish')))) or (c.business_id is null and not (app.has_platform_permission('platform.content.moderate') or app.has_platform_permission('platform.design.manage'))) then raise exception 'permission denied' using errcode='42501';end if;
 h:=design.bundle_hash(jsonb_build_object('title',c.title,'summary',c.summary,'body',c.body));indexable_new:=length(coalesce(c.body_text,''))>=80 and c.status='published' and c.visibility='public' and c.deleted_at is null;
 update seo.metadata set title=c.title,description=c.summary,is_indexable=indexable_new,non_indexable_reason=case when indexable_new then null else 'thin_content' end,source_hash=h where entity_kind='content' and entity_id=p_content;
 if not found then insert into seo.metadata(business_id,entity_kind,entity_id,locale,title,description,is_indexable,non_indexable_reason,source_hash) values(c.business_id,'content',p_content,c.locale,c.title,c.summary,indexable_new,case when indexable_new then null else 'thin_content' end,h);end if;
end $$;
create function app.nocode_projection_hook() returns trigger language plpgsql security definer set search_path=pg_catalog,app as $$
begin if exists(select 1 from app.content_extension where content_id=new.id) then perform app.nocode_metadata(new.id);end if;return new;end $$;
create trigger content_nocode_metadata after update of body,title,summary,status,visibility,deleted_at on app.content for each row execute function app.nocode_projection_hook();
revoke all on function app.nocode_metadata(uuid),app.nocode_projection_hook() from public;
grant execute on function app.nocode_metadata(uuid) to pv_app;
