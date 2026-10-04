-- Addendum §36–55: public projection، RLS و freshness؛ مشاهدهٔ واقعی، نه امتیاز AI ساختگی.
create table seo.search_document(id uuid primary key default gen_random_uuid(),entity_kind text not null check(entity_kind in('business','content','design_page')),entity_id uuid not null,business_id uuid references app.business(id),source_version int not null,title text not null,body_text text not null default '',canonical_path text not null,is_public boolean not null default false,normalized_text text not null,search_vector tsvector generated always as(to_tsvector('simple',normalized_text)) stored,updated_at timestamptz not null default now(),version int not null default 1,unique(entity_kind,entity_id));
create index search_document_fts_idx on seo.search_document using gin(search_vector);
create index search_document_scope_idx on seo.search_document(business_id,entity_kind,entity_id);
create trigger search_document_touch before update on seo.search_document for each row execute function app.touch();
alter table seo.search_document enable row level security;
create function seo.search_document_public(p_kind text,p_id uuid,p_version int) returns boolean language sql stable security definer set search_path=pg_catalog,app,design as $$
 select case p_kind when 'business' then exists(select 1 from app.business b where b.id=p_id and b.version=p_version and b.status='active' and b.visibility='public' and b.deleted_at is null) when 'content' then exists(select 1 from app.content c where c.id=p_id and c.version=p_version and c.status='published' and c.visibility='public' and c.deleted_at is null and (c.business_id is null or exists(select 1 from app.business b where b.id=c.business_id and b.status='active' and b.visibility='public' and b.deleted_at is null))) when 'design_page' then exists(select 1 from design.page p where p.id=p_id and p.version=p_version and p.status='published' and (p.business_id is null or exists(select 1 from app.business b where b.id=p.business_id and b.status='active' and b.visibility='public' and b.deleted_at is null))) else false end
$$;
create policy search_public on seo.search_document for select to pv_public,pv_app using((business_id is null or exists(select 1 from app.business b where b.id=business_id and b.status='active' and b.visibility='public' and b.deleted_at is null)) and is_public and seo.search_document_public(entity_kind,entity_id,source_version));
create policy search_worker on seo.search_document for all to pv_worker using(true) with check(true);
create policy search_reader on seo.search_document for select to pv_reader using(true);
revoke all on seo.search_document from public;
grant select on seo.search_document to pv_public,pv_app,pv_reader;
grant select,insert,update,delete on seo.search_document to pv_worker;

create function seo.refresh_search_scope(p_business uuid) returns int language plpgsql security definer set search_path=pg_catalog,app,design,seo as $$
declare n int:=0; part int;
begin
 insert into seo.search_document(entity_kind,entity_id,business_id,source_version,title,body_text,canonical_path,is_public,normalized_text)
 select 'business',b.id,b.id,b.version,b.name,coalesce(p.summary,''),'/b/'||design.uri_segment(b.slug),b.status='active' and b.visibility='public' and b.deleted_at is null,app.normalize_fa(b.name||' '||coalesce(p.summary,'')) from app.business b left join app.business_profile p on p.business_id=b.id where b.id=p_business
 on conflict(entity_kind,entity_id) do update set source_version=excluded.source_version,title=excluded.title,body_text=excluded.body_text,canonical_path=excluded.canonical_path,is_public=excluded.is_public,normalized_text=excluded.normalized_text;get diagnostics part=row_count;n:=n+part;
 insert into seo.search_document(entity_kind,entity_id,business_id,source_version,title,body_text,canonical_path,is_public,normalized_text)
 select 'content',c.id,c.business_id,c.version,c.title,coalesce(c.body_text,''),case when c.business_id is null then '/'||design.uri_segment(c.slug) else '/b/'||(select design.uri_segment(slug) from app.business where id=c.business_id)||'/c/'||design.uri_segment(c.slug) end,c.status='published' and c.visibility='public' and c.deleted_at is null,app.normalize_fa(c.title||' '||coalesce(c.body_text,'')) from app.content c where c.business_id is not distinct from p_business
 on conflict(entity_kind,entity_id) do update set source_version=excluded.source_version,title=excluded.title,body_text=excluded.body_text,canonical_path=excluded.canonical_path,is_public=excluded.is_public,normalized_text=excluded.normalized_text;get diagnostics part=row_count;n:=n+part;
 insert into seo.search_document(entity_kind,entity_id,business_id,source_version,title,body_text,canonical_path,is_public,normalized_text)
 select 'design_page',p.id,p.business_id,p.version,p.title,coalesce(p.description,''),design.public_path(p.key,p.business_id),p.status='published',app.normalize_fa(p.title||' '||coalesce(p.description,'')) from design.page p where p.business_id is not distinct from p_business
 on conflict(entity_kind,entity_id) do update set source_version=excluded.source_version,title=excluded.title,body_text=excluded.body_text,canonical_path=excluded.canonical_path,is_public=excluded.is_public,normalized_text=excluded.normalized_text;get diagnostics part=row_count;n:=n+part;
 return n;
end $$;
create table seo.search_query(id bigserial primary key,business_id uuid references app.business(id),query_key text not null check(length(query_key) between 1 and 160),result_count int not null check(result_count>=0),occurred_at timestamptz not null default now());
create index search_query_scope_idx on seo.search_query(business_id,occurred_at desc);
create index search_query_zero_idx on seo.search_query(query_key,occurred_at desc) where result_count=0;
alter table seo.search_query enable row level security;
create policy query_staff on seo.search_query for select to pv_app using(app.has_platform_permission('platform.seo.manage'));
create policy query_worker on seo.search_query for all to pv_worker using(true) with check(true);
create policy query_reader on seo.search_query for select to pv_reader using(true);
revoke all on seo.search_query from public;
grant select on seo.search_query to pv_app,pv_reader;
grant select,insert on seo.search_query to pv_worker;
create function seo.record_search(p_query text,p_count int) returns void language plpgsql security definer set search_path=pg_catalog,seo,app,design as $$
declare q text:=app.normalize_fa(p_query);
begin
 -- ایمیل/تلفن/شناسه‌ها، دادهٔ opportunity نیستند؛ نه IP و نه هویت کاربر ثبت می‌شود.
 if length(q) not between 2 and 160 or q~'@|[0-9]{6,}' then return;end if;
 insert into seo.search_query(query_key,result_count) values(q,greatest(p_count,0));
 if p_count=0 then insert into seo.content_opportunity(business_id,kind,title,description,suggested_action,priority,status,path,evidence) values(null,'keyword_gap','جست‌وجوی بی‌نتیجه: '||left(q,100),'داده از جست‌وجوی واقعی، بدون شناسهٔ شخصی است.',jsonb_build_object('action','review_demand_and_create_evidence_based_content'),50,'open','/search?q='||design.uri_segment(q),jsonb_build_object('query',q)) on conflict do nothing;end if;
end $$;
create table seo.visibility_observation(id uuid primary key default gen_random_uuid(),business_id uuid references app.business(id),entity_id uuid references seo.entity(id),source text not null check(source in('manual','gsc','bing','indexnow','ai')),metric text not null check(metric in('clicks','impressions','position','mention','crawl')),value numeric not null check(value>=0),observed_at timestamptz not null,source_url text,provenance jsonb not null,created_by uuid references auth.app_user(id),created_at timestamptz not null default now());
create index visibility_scope_time_idx on seo.visibility_observation(business_id,observed_at desc,id);
alter table seo.visibility_observation enable row level security;
create policy visibility_read on seo.visibility_observation for select to pv_app using((business_id=app.current_business_id() and app.has_permission(business_id,'seo.manage')) or app.has_platform_permission('platform.seo.manage'));
create policy visibility_write on seo.visibility_observation for insert to pv_app with check((business_id=app.current_business_id() and app.has_permission(business_id,'seo.manage')) or (business_id is null and app.has_platform_permission('platform.seo.manage')));
create policy visibility_worker on seo.visibility_observation for all to pv_worker using(true) with check(true);
create policy visibility_reader on seo.visibility_observation for select to pv_reader using(true);
revoke all on seo.visibility_observation from public;
grant select,insert on seo.visibility_observation to pv_app,pv_worker;
grant select on seo.visibility_observation to pv_reader;

-- Source freshness باعث می‌شود ایندکسِ قدیمی، داده‌ای که خصوصی شده را برنگرداند.
create function seo.search_public(p_query text,p_limit int default 24,p_cursor uuid default null,p_kind text default null) returns table(id uuid,entity_kind text,entity_id uuid,title text,snippet text,path text,business_id uuid,rank real) language sql stable security definer set search_path=pg_catalog,seo,app as $$
 select d.id,d.entity_kind,d.entity_id,d.title,left(d.body_text,280),d.canonical_path,d.business_id,ts_rank(d.search_vector,websearch_to_tsquery('simple',app.normalize_fa(p_query)))
 from seo.search_document d where d.is_public and seo.search_document_public(d.entity_kind,d.entity_id,d.source_version) and (p_kind is null or d.entity_kind=p_kind) and (p_cursor is null or d.id<p_cursor) and (d.search_vector@@websearch_to_tsquery('simple',app.normalize_fa(p_query)) or d.normalized_text like '%'||app.normalize_fa(p_query)||'%') order by d.id desc limit least(greatest(p_limit,1),50)
$$;
revoke all on function seo.search_document_public(text,uuid,int),seo.refresh_search_scope(uuid),seo.record_search(text,int),seo.search_public(text,int,uuid,text) from public;
grant execute on function seo.search_document_public(text,uuid,int),seo.search_public(text,int,uuid,text) to pv_public,pv_app,pv_worker,pv_reader;
grant execute on function seo.record_search(text,int) to pv_public,pv_app;
grant execute on function seo.refresh_search_scope(uuid) to pv_worker;

create unique index opportunity_zero_query_once_idx on seo.content_opportunity((evidence->>'query')) where kind='keyword_gap' and status='open' and evidence?'query';
do $$ begin if exists(select 1 from pg_available_extensions where name='pg_trgm') then create extension if not exists pg_trgm;execute 'create index search_document_trigram_idx on seo.search_document using gin(normalized_text gin_trgm_ops)';end if;end $$;
create function seo.refresh_graph_scope(p_business uuid) returns int language plpgsql security definer set search_path=pg_catalog,app,seo as $$
declare b app.business; id_new uuid; brand uuid;
begin
 select id into brand from seo.entity where is_brand_anchor;select * into b from app.business where id=p_business and status='active' and visibility='public' and deleted_at is null;if not found then return 0;end if;
 select id into id_new from seo.entity where kind='business' and key='business.'||b.id::text;
 if id_new is null then insert into seo.entity(kind,key,name_fa,name_en,description) values('business','business.'||b.id,b.name,b.name_latin,(select summary from app.business_profile where business_id=b.id)) returning id into id_new;else update seo.entity set name_fa=b.name,name_en=b.name_latin where id=id_new;end if;
 insert into seo.entity_mention(entity_id,entity_kind,entity_ref_id,strength) values(id_new,'business',b.id,'primary') on conflict do nothing;
 if brand is not null then insert into seo.entity_link(from_entity_id,to_entity_id,relation,weight) values(brand,id_new,'related_to',50) on conflict do nothing;end if;return 1;
end $$;
create function seo.sitemap_business_content(p_limit int default 1000,p_offset int default 0) returns table(path text,last_modified timestamptz) language sql stable security definer set search_path=pg_catalog,app,design,seo as $$
 select '/b/'||design.uri_segment(b.slug)||'/c/'||design.uri_segment(c.slug),c.updated_at from app.content c join app.business b on b.id=c.business_id where c.status='published' and c.visibility='public' and c.deleted_at is null and b.status='active' and b.visibility='public' and b.deleted_at is null and length(coalesce(c.body_text,''))>=80 and not exists(select 1 from seo.metadata m where m.entity_kind='content' and m.entity_id=c.id and not m.is_indexable) order by c.id limit least(greatest(p_limit,1),50000) offset greatest(p_offset,0)
$$;
create function seo.sitemap_business_content_count() returns bigint language sql stable security definer set search_path=pg_catalog,app,seo as $$
 select count(*) from app.content c join app.business b on b.id=c.business_id where c.status='published' and c.visibility='public' and c.deleted_at is null and b.status='active' and b.visibility='public' and b.deleted_at is null and length(coalesce(c.body_text,''))>=80 and not exists(select 1 from seo.metadata m where m.entity_kind='content' and m.entity_id=c.id and not m.is_indexable)
$$;
revoke all on function seo.refresh_graph_scope(uuid),seo.sitemap_business_content(int,int),seo.sitemap_business_content_count() from public;
grant execute on function seo.refresh_graph_scope(uuid) to pv_worker;
grant execute on function seo.sitemap_business_content(int,int),seo.sitemap_business_content_count() to pv_public,pv_app,pv_worker;
-- همان runner و lease؛ pipeline سرچ/گراف به event، نه درخواست UI، وصل است.
alter function ops.execute_core_job(uuid,text,uuid) rename to execute_core_job_0027;
revoke execute on function ops.execute_core_job_0027(uuid,text,uuid) from pv_worker;
create function ops.execute_core_job(p_job uuid,p_worker text,p_lease uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,ops,seo as $$
declare j ops.job;e ops.event;n int;g int;result jsonb;
begin
 j:=ops.assert_lease(p_job,p_worker,p_lease);
 if j.kind in('search.reindex','search.index_content','search.index_business') then n:=seo.refresh_search_scope(j.business_id);g:=seo.refresh_graph_scope(j.business_id);return jsonb_build_object('adapter','postgres','indexed_rows',n,'graph_entities',g,'scope',j.business_id,'indexed_at',now());end if;
 result:=ops.execute_core_job_0027(p_job,p_worker,p_lease);
 if j.kind='event.dispatch' then select * into e from ops.event where id=(j.payload->>'event_id')::uuid;
  if e.entity_type in('business','content','design_release') then insert into ops.job(kind,payload,business_id,dedupe_key,request_id) values('search.reindex',jsonb_build_object('event_id',e.id),j.business_id,'search:'||e.id,e.request_id) on conflict do nothing;end if;
 end if;return result;
end $$;
revoke all on function ops.execute_core_job(uuid,text,uuid) from public;
grant execute on function ops.execute_core_job(uuid,text,uuid) to pv_worker;

create function seo.public_answers(p_origin text) returns jsonb language sql stable security definer set search_path=pg_catalog,app,seo,design as $$
 select jsonb_build_object('brand',(select jsonb_build_object('id',id,'name_fa',name_fa,'name_en',name_en,'description',description,'updated_at',updated_at) from seo.entity where is_brand_anchor),'businesses',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'description',p.summary,'verification',b.verification_level,'source',p_origin||'/b/'||design.uri_segment(b.slug),'updated_at',b.updated_at,'provenance','published_by_business_not_independently_verified')) from (select id,name,slug,verification_level,updated_at from app.business where status='active' and visibility='public' and deleted_at is null order by id limit 50) b left join app.business_profile p on p.business_id=b.id),'[]'::jsonb),'graph',coalesce((select jsonb_agg(jsonb_build_object('from_entity_id',l.from_entity_id,'to_entity_id',l.to_entity_id,'relation',l.relation,'weight',l.weight)) from seo.entity_link l join seo.entity anchor on anchor.id=l.from_entity_id and anchor.is_brand_anchor join seo.entity_mention m on m.entity_id=l.to_entity_id and m.entity_kind='business' join app.business b on b.id=m.entity_ref_id and b.status='active' and b.visibility='public' and b.deleted_at is null),'[]'::jsonb),'visibility_claims',null,'reason','no AI-provider observations assumed')
$$;
revoke all on function seo.public_answers(text) from public;
grant execute on function seo.public_answers(text) to pv_public,pv_app,pv_worker;
-- نام/summary عمومی business یک aggregate است؛ تغییر profile باید index/cache قدیمی را stale کند.
create function app.profile_entity_revision() returns trigger language plpgsql security definer set search_path=pg_catalog,app as $$
begin update app.business set updated_at=now() where id=new.business_id;return new;end $$;
create trigger profile_entity_revision after insert or update on app.business_profile for each row execute function app.profile_entity_revision();
revoke all on function app.profile_entity_revision() from public;
create function ops.indexing_material(p_job uuid,p_worker text,p_lease uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,ops,seo as $$
declare j ops.job;config_new jsonb;urls jsonb;
begin j:=ops.assert_lease(p_job,p_worker,p_lease);select value into config_new from ops.setting where key='seo.indexnow' and business_id is null;
 select coalesce(jsonb_agg(canonical_path),'[]'::jsonb) into urls from seo.search_document where business_id is not distinct from j.business_id and is_public and seo.search_document_public(entity_kind,entity_id,source_version);
 return jsonb_build_object('config',coalesce(config_new,'{}'::jsonb),'paths',urls);end $$;
create function ops.indexing_result(p_job uuid,p_worker text,p_lease uuid,p_result jsonb) returns void language plpgsql security definer set search_path=pg_catalog,ops,seo as $$
declare j ops.job;
begin j:=ops.assert_lease(p_job,p_worker,p_lease);insert into seo.indexing_event(channel,action,url_count,status,response_code,response_note,request_id,job_id,payload) values('indexnow','submit',coalesce((p_result->>'urlCount')::int,0),p_result->>'status',(p_result->>'responseCode')::int,left(p_result->>'responseNote',500),j.request_id,j.id,jsonb_build_object('scope',j.business_id));end $$;
revoke all on function ops.indexing_material(uuid,text,uuid),ops.indexing_result(uuid,text,uuid,jsonb) from public;
grant execute on function ops.indexing_material(uuid,text,uuid),ops.indexing_result(uuid,text,uuid,jsonb) to pv_worker;
-- معیار مشترکِ محتوای مؤثر؛ کلیدهای JSON یا کلاس‌های CSS، «متن مفید» نیستند.
create function seo.content_has_substance(p_id uuid) returns boolean language sql stable security definer set search_path=pg_catalog,app as $$
 select length(coalesce(c.body_text,''))>=80 from app.content c where c.id=p_id
$$;
create or replace function seo.sitemap_content_count() returns integer language sql stable security definer set search_path=pg_catalog,seo,app as $$
 select count(*)::integer from app.content c where c.business_id is null and c.status='published' and c.visibility='public' and c.deleted_at is null and (c.published_at is null or c.published_at<=now()) and seo.content_has_substance(c.id) and not exists(select 1 from seo.metadata m where m.entity_kind='content' and m.entity_id=c.id and not m.is_indexable)
$$;
create or replace function seo.sitemap_content(p_limit int,p_offset int) returns table(slug text,last_modified timestamptz,kind text) language sql stable security definer set search_path=pg_catalog,seo,app as $$
 select c.slug,c.updated_at,c.kind from app.content c where c.business_id is null and c.status='published' and c.visibility='public' and c.deleted_at is null and (c.published_at is null or c.published_at<=now()) and seo.content_has_substance(c.id) and not exists(select 1 from seo.metadata m where m.entity_kind='content' and m.entity_id=c.id and not m.is_indexable) order by c.id limit least(greatest(p_limit,1),50000) offset greatest(p_offset,0)
$$;
revoke all on function seo.content_has_substance(uuid) from public;
grant execute on function seo.content_has_substance(uuid) to pv_public,pv_app,pv_worker;
