-- دادهٔ مرجعِ schema است، نه نمونهٔ کسب‌وکار/lead/record. هیچ درخواست جعلی seed نمی‌شود.
insert into design.definition(key,kind,draft_spec,live_spec,live_enabled)
select k,'field',s,s,true from(values
 ('name','{"type":"text","label_fa":"نام","label_en":"Name","required":true,"max_length":100,"public":false}'::jsonb),
 ('phone','{"type":"phone","label_fa":"شماره تماس","label_en":"Phone","required":true,"max_length":30,"public":false,"sensitive":true}'::jsonb),
 ('message','{"type":"longtext","label_fa":"پیام","label_en":"Message","required":true,"max_length":2000,"public":false,"sensitive":true}'::jsonb),
 ('need','{"type":"longtext","label_fa":"شرح درخواست","label_en":"Request","required":true,"max_length":2000,"public":false}'::jsonb),
 ('email','{"type":"email","label_fa":"ایمیل","label_en":"Email","required":true,"max_length":200,"public":false,"sensitive":true}'::jsonb)
) d(k,s) on conflict do nothing;
insert into design.definition(key,kind,draft_spec,live_spec,live_enabled)
select key,'form',spec,spec,true from(
 select 'contact' key,jsonb_build_object('title_fa','فرم تماس','title_en','Contact','field_ids',(select jsonb_agg(id::text order by key) from design.definition where business_id is null and kind='field' and key in('name','phone','message')),'purpose','contact','public',true,'consent_required',true,'success_message','درخواست شما در سامانه ثبت شد.') spec
 union all select 'lead',jsonb_build_object('title_fa','درخواست همکاری','title_en','Business inquiry','field_ids',(select jsonb_agg(id::text order by key) from design.definition where business_id is null and kind='field' and key in('name','phone','need')),'purpose','lead','public',true,'consent_required',true,'success_message','درخواست همکاری شما ثبت شد.')
 union all select 'newsletter',jsonb_build_object('title_fa','ثبت درخواست خبرنامه','title_en','Newsletter request','field_ids',(select jsonb_agg(id::text) from design.definition where business_id is null and kind='field' and key='email'),'purpose','newsletter','public',true,'consent_required',true,'success_message','درخواست عضویت ثبت شد؛ ارسال پیام تابع پیکربندی و رضایت شماست.')
) forms on conflict do nothing;
insert into design.definition(key,kind,draft_spec,live_spec,live_enabled)
select 'relationship_'||kind,'relationship',spec,spec,true from(select kind,jsonb_build_object('label_fa',label,'relationship_kind',kind,'symmetric',kind='partner') spec from(values('partner','شریک'),('supplier','تأمین‌کننده'),('customer','مشتری'),('parent','شرکت مادر'),('branch_of','شعبه'),('affiliate','همکار')) v(kind,label)) d on conflict do nothing;
update design.component set props_schema=props_schema||'{"formId":{"type":"string","maxLength":36,"pattern":"^[0-9a-fA-F-]{36}$"}}'::jsonb where key in('form.contact_form','form.lead_form','form.newsletter');
insert into design.component(key,name_fa,description,category,props_schema,slots,a11y,seo,performance,status,schema_version)
values('form.schema_form','فرم ساخت‌یافته','فرمِ واقعی از definition منتشرشده، با کنترل consent و ضداسپم.','form','{"formId":{"type":"string","required":true,"maxLength":36,"pattern":"^[0-9a-fA-F-]{36}$"},"title":{"type":"string"},"submitLabel":{"type":"string"}}','{}','{"labelRequired":true,"minTouchTarget":44}','{}','{"weight_kb":3,"rateLimited":true}','active',1),
('data.crud_list','فهرست CRUD','فهرست دادهٔ واقعی و عمومیِ مدل؛ دادهٔ خصوصی وارد آن نمی‌شود.','data','{"definitionId":{"type":"string","required":true,"maxLength":36,"pattern":"^[0-9a-fA-F-]{36}$"}}','{}','{}','{"contributesToStructure":true}','{"weight_kb":2,"queriesDatabase":true}','active',1) on conflict(key) do nothing;
update ops.menu_item set availability='ready',planned_step=null where surface='admin' and key='nocode';
insert into ops.page_budget(route_pattern,scope,name_fa,lcp_ms,inp_ms,cls,weight_kb,request_count,html_kb,css_kb,js_kb,font_kb)
values('/b/:slug/c/:content','platform','محتوای کسب‌وکار',2500,200,0.1,160,12,45,40,8,90) on conflict(scope,route_pattern) do nothing;
