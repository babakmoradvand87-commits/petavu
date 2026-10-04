-- تنها پس از وجود API/handler واقعی، منو فعال می‌شود.
update ops.menu_item set availability='ready',planned_step=null where (surface='panel' and key='pages') or (surface='admin' and key in ('design','tokens'));
insert into ops.page_budget(route_pattern,scope,name_fa,lcp_ms,inp_ms,cls,weight_kb,request_count,api_p95_ms,html_kb,css_kb,js_kb,image_kb,font_kb)
values('/p/:key','platform','صفحهٔ طراحی عمومی',2500,200,0.10,150,12,200,45,40,8,75,90),('/b/:slug/:page','platform','صفحهٔ طراحی کسب‌وکار',2500,200,0.10,150,12,200,45,40,8,75,90)
on conflict(scope,route_pattern) do nothing;
-- متن روی دکمهٔ برند مستقل از inverseِ زمینهٔ روشن است، به‌خصوص در حالت تاریک.
insert into design.token(group_key,key,value,value_type,theme_mode,is_system)
values('color','color.on.primary','"#FFFFFF"'::jsonb,'color','light',true)
on conflict(coalesce(business_id,'00000000-0000-0000-0000-000000000000'::uuid),group_key,key,theme_mode) do nothing;
