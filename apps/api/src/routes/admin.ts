/* §28، §14–17، §24: کنسول از همان DAL و RLS استفاده می‌کند؛ فهرست بسته، نه SQL از داده. */
import { buildPage, decodeCursor, normalizeLimit } from '@petavu/db';
import { AppError, isUuid } from '@petavu/shared';
import { RATE_LIMITS } from '@petavu/security';
import type { RouteDefinition } from '../types.js';
import { validator } from '../validate.js';

const RESOURCES = {
  businesses: { permission: 'platform.business.moderate', table: 'app.business', fields: 'id, name, slug, business_type_key, status, visibility, version, updated_at', where: 'deleted_at is null', id: 'id' },
  content: { permission: 'platform.content.moderate', table: 'app.content', fields: 'id, business_id, title, kind, status, version, updated_at', where: 'deleted_at is null', id: 'id' },
  taxonomy: { permission: 'platform.taxonomy.manage', table: 'ref.business_type', fields: 'key as id, key, name_fa, parent_key, depth, is_active, version', where: 'true', id: 'key' },
  seo: { permission: 'platform.seo.manage', table: 'seo.template', fields: 'id, key, entity_kind, title_template, description_template, priority, is_active, version', where: 'business_id is null', id: 'id' },
  redirects: { permission: 'platform.seo.manage', table: 'seo.redirect', fields: 'id, source_path, target_path, status_code, reason, hit_count, is_active, version', where: 'business_id is null', id: 'id' },
  indexing: { permission: 'platform.seo.manage', table: 'seo.indexing_event', fields: 'id, channel, action, status, url_count, response_code, occurred_at', where: 'true', id: 'id' },
  jobs: { permission: 'platform.job.observe', table: 'ops.job', fields: 'id, kind, status, attempts, max_attempts, available_at, locked_by, request_id, version', where: 'true', id: 'id' },
  automation: { permission: 'platform.automation.manage', table: 'ops.automation_rule', fields: 'id, name_fa, event_type, status, conditions, actions, version', where: 'business_id is null', id: 'id' },
  performance: { permission: 'platform.job.observe', table: 'ops.performance_regression', fields: 'id, route_pattern, metric, severity, status, detected_at', where: 'true', id: 'id' },
  security: { permission: 'platform.security.manage', table: 'ops.security_event', fields: 'id, kind, severity, occurred_at, acknowledged_at, actor_id, request_id', where: 'true', id: 'id' },
  audit: { permission: 'platform.audit.view', table: 'ops.audit_log', fields: 'id, occurred_at, actor_type, actor_id, impersonated_by, business_id, action, entity_type, entity_id, request_id', where: 'true', id: 'id' },
  backups: { permission: 'platform.backup.manage', table: 'ops.backup', fields: 'id, kind, status, driver, size_bytes, checksum_sha256, is_encrypted, schema_version, started_at, finished_at', where: 'true', id: 'id' },
  retention: { permission: 'platform.backup.manage', table: 'ops.retention_policy', fields: 'id, scope, name_fa, retain_days, action, legal_hold, is_active, next_run_at, version', where: 'true', id: 'id' },
} as const;

export const adminRoutes: RouteDefinition[] = Object.entries(RESOURCES).map(([key, spec]) => ({
  method: 'GET', path: `/api/v1/admin/${key}`, name: `admin.${key}`, summary: `فهرست مدیریت: ${key}`, tags: ['admin'],
  auth: 'session', role: 'pv_app', platformPermission: spec.permission,
  handler: async (request, scope) => {
    const cursor = decodeCursor(request.query.get('cursor')); const limit = normalizeLimit(Number(request.query.get('limit') ?? 20));
    // تمام identifierها ثابت و محلی‌اند؛ ورودی فقط به پارامتر $1/$2 می‌رود.
    const items = await scope.query(`select ${spec.fields} from ${spec.table} where ${spec.where} and ($1::text is null or ${spec.id}::text > $1) order by ${spec.id}::text limit $2`, [cursor?.id ?? null, limit + 1]);
    return { body: buildPage(items, limit, row => ({key:String(row['id']),id:String(row['id'])})) };
  },
}));

adminRoutes.push(
  { method: 'GET', path: '/api/v1/admin/users', name: 'admin.users', summary: 'کاربران، بدون هویت/اعتبارنامهٔ خصوصی', tags: ['admin'], auth: 'session', role: 'pv_app', platformPermission: 'platform.user.view',
    handler: async(request,scope)=>{ const cursor=decodeCursor(request.query.get('cursor')); if(cursor&&!isUuid(cursor.id)) throw new AppError('validation_failed'); const limit=normalizeLimit(Number(request.query.get('limit')??20));
      const items=await scope.query('select id,display_name,status,locale,mfa_required,last_login_at,created_at,version from app.admin_users($1::uuid,$2)',[cursor?.id??null,limit+1]); return {body:buildPage(items,limit,row=>({key:String(row['id']),id:String(row['id'])}))}; }
  },
  { method:'GET',path:'/api/v1/admin/roles',name:'admin.roles',summary:'ماتریس نقش‌ها و تخصیص کارکنان',tags:['admin'],auth:'session',role:'pv_app',platformPermission:'platform.role.manage',handler:async(_r,s)=>({body:{matrix:(await s.query('select app.admin_role_matrix() as matrix'))[0]?.['matrix']}}) },
  { method:'GET',path:'/api/v1/admin/dashboard',name:'admin.dashboard',summary:'نمای کلی قابل دسترسی کارکنان',tags:['admin'],auth:'session',role:'pv_app',handler:async(_r,s)=>{
      const [staff]=await s.query<{ok:boolean}>('select app.current_platform_role() is not null as ok'); if(!staff?.ok) throw new AppError('forbidden');
      const [can]=await s.query<{ok:boolean}>("select app.has_platform_permission('platform.job.observe') as ok");
      return {body:{queue:can?.ok?await s.repos.ops.jobHealth():null,performance:can?.ok?await s.repos.ops.performanceHealth():null}};
    }
  },
  { method:'POST',path:'/api/v1/auth/reauth',name:'auth.reauth',summary:'تأیید مجدد رمز، بدون صدور نشست تازه',tags:['auth'],auth:'session',role:'pv_app',rateLimit:RATE_LIMITS.loginIp,
    handler:async(r,s)=>{const b=validator(r.body);const password=b.string('password',{min:1,max:200});b.done();const [material]=await s.query<{hash:string|null}>('select app.own_password_hash() as hash');
      const valid=material?.hash?await s.services.passwords.verify(material.hash,password):false;
      if(!valid) throw new AppError('unauthenticated');const [done]=await s.query<{ok:boolean}>('select app.complete_reauth($1) as ok',[valid]);return {status:200,body:{reauthenticated:done?.ok===true}};
    }
  },
);
for (const [key, permission, fn] of [ ['users','platform.user.suspend','app.admin_user_state'], ['businesses','platform.business.moderate','app.admin_business_state'], ['content','platform.content.moderate','app.admin_content_state'] ] as const) {
  adminRoutes.push({method:'POST',path:`/api/v1/admin/${key}/:id/state`,name:`admin.${key}State`,summary:`گذر وضعیت نسخه‌دار ${key}`,tags:['admin'],auth:'session',role:'pv_app',platformPermission:permission,
    handler:async(r,s)=>{if(!isUuid(r.params.id))throw new AppError('validation_failed');const b=validator(r.body);const version=b.integer('expected_version',{min:1});const to=b.string('to',{min:3,max:30});const reason=b.string('reason',{min:3,max:500});b.done();
      const [result]=await s.query(`select ${fn}($1::uuid,$2,$3,$4) as result`,[r.params.id,version,to,reason]);return {status:200,body:{result:result?.['result']}};
    }
  });
}
adminRoutes.push(
 {method:'POST',path:'/api/v1/admin/taxonomy',name:'admin.createBusinessType',summary:'افزودن نوع کسب‌وکار بدون استقرار',tags:['admin'],auth:'session',role:'pv_app',platformPermission:'platform.taxonomy.manage',
  handler:async(r,s)=>{const b=validator(r.body);const key=b.string('key',{min:2,max:60});const name=b.string('name_fa',{min:2,max:100});const parent=b.optionalString('parent_key',{max:60});b.done();if(!/^[a-z][a-z0-9_]*$/.test(key))throw new AppError('validation_failed');await s.query('select app.require_recent_auth()');
    const [item]=await s.query(`insert into ref.business_type(key,name_fa,parent_key,depth) values($1,$2,$3,coalesce((select depth+1 from ref.business_type where key=$3),0)) returning key,name_fa,depth,version`,[key,name,parent]);
    await s.query("select app.record_audit('taxonomy.created','business_type',$1)",[key]);await s.query("select app.emit_event('taxonomy.created','business_type',$1)",[key]);return {status:201,body:{item}};
  }},
 {method:'POST',path:'/api/v1/admin/redirects',name:'admin.createRedirect',summary:'تغییر مسیر سراسری با نگهبان حلقه',tags:['admin'],auth:'session',role:'pv_app',platformPermission:'platform.seo.manage',handler:async(r,s)=>{
   const b=validator(r.body);const source=b.string('source_path',{min:1,max:2048});const target=b.optionalString('target_path',{max:2048});const code=b.oneOfNumber('status_code',[301,302,307,308,410],301);const reason=b.optionalString('reason',{max:500});b.done();await s.query('select app.require_recent_auth()');
   const redirect=await s.repos.seo.createRedirect({sourcePath:source,targetPath:target ?? '',statusCode:code as 301|302|307|308|410,reason,businessId:null});await s.query("select app.record_audit('redirect.created','redirect',$1)",[String(redirect['id'])]);return {status:201,body:{redirect}};
 }},
 {method:'GET',path:'/api/v1/admin/settings',name:'admin.settings',summary:'تنظیمات سراسری، رازها پرده‌دار',tags:['admin'],auth:'session',role:'pv_app',platformPermission:'platform.settings.manage',handler:async(_r,s)=>({body:{items:await s.query('select id,key,case when is_secret then null else value end as value,is_secret,description,version from ops.setting where business_id is null order by key')}})},
 {method:'PUT',path:'/api/v1/admin/settings/:key',name:'admin.patchSetting',summary:'ویرایش نسخه‌دار تنظیم موجود غیرراز',tags:['admin'],auth:'session',role:'pv_app',platformPermission:'platform.settings.manage',handler:async(r,s)=>{
    const b=validator(r.body);const version=b.integer('expected_version',{min:1});const value=b.raw('value');b.done();if(value===undefined)throw new AppError('validation_failed');await s.query('select app.require_recent_auth()');
    const items=await s.query('update ops.setting set value=$1::jsonb,updated_by=app.current_user_id() where business_id is null and key=$2 and version=$3 and not is_secret returning id,key,value,version',[JSON.stringify(value),r.params.key,version]);
    if(!items.length)throw new AppError('conflict');await s.query("select app.record_audit('setting.updated','setting',$1,null,null,$2::jsonb)",[r.params.key,JSON.stringify({version:items[0]?.['version']})]);return {body:{item:items[0]}};
 }}
);
