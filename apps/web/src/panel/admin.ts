/* §28: ۲۸ مورد از DB؛ بخش‌ها فقط مشتری API‌اند. هیچ SQL/Repository/مجوز کلاینتی ندارند. */
import {studioSection} from './studio.js';
import { escapeText, raw, tag } from '../html.js';
import { describeProblem } from './core.js';
import { card, dataTable, emptyNote, formBlock, htmlOf, metricCard, pageHeader, type Cell, type Field } from './kit.js';
import { MEMBER_SECTIONS, shortDate, statusBadge } from './sections.js';
import type { ActionOutcome, PanelCtx, Section, SectionRegistry } from './types.js';

type Json = Record<string, unknown>;
const str=(v:unknown):string=>v===null||v===undefined?'':typeof v==='object'?JSON.stringify(v):String(v);
const rows=(j:Json|null,key='items'):Json[]=>Array.isArray(j?.[key])?j[key] as Json[]:[];
const reauth=(ctx:PanelCtx)=>card('تأیید دوبارهٔ هویت',formBlock({id:'reauth',action:'/app/auth/reauth',csrf:ctx.csrf,fields:[{name:'password',label:'رمز فعلی',type:'password',autocomplete:'current-password',required:true,hint:'کنش‌های حساس، تأیید مجدد در ۱۵ دقیقهٔ اخیر می‌خواهند.'}],submit:'تأیید هویت'}));
const failed=(title:string,response:{status:number;json:Json|null;cookies:readonly string[]})=>({html:htmlOf(pageHeader(title),card('انجام نشد',emptyNote(describeProblem(response)))),status:response.status});
const outcome=(path:string,response:{status:number;json:Json|null;cookies:readonly string[]}):ActionOutcome=>({redirect:path,flash:{kind:response.status>=200&&response.status<300?'success':'error',text:response.status>=200&&response.status<300?'ثبت شد.':describeProblem(response)}});
const COLUMNS:Record<string,readonly [string,string][]>={
 users:[['display_name','نام'],['status','وضعیت'],['locale','زبان'],['mfa_required','دومرحله‌ای'],['last_login_at','آخرین ورود']],
 businesses:[['name','کسب‌وکار'],['business_type_key','نوع'],['status','وضعیت'],['visibility','دسترسی']],
 content:[['title','عنوان'],['kind','نوع'],['status','وضعیت'],['business_id','کسب‌وکار']],
 taxonomy:[['key','کلید'],['name_fa','نام'],['parent_key','والد'],['depth','عمق'],['is_active','فعال']],
 seo:[['key','کلید'],['entity_kind','موجودیت'],['title_template','قالب عنوان'],['priority','اولویت']],
 redirects:[['source_path','مبدأ'],['target_path','مقصد'],['status_code','کد'],['hit_count','بازدید'],['is_active','فعال']],
 indexing:[['channel','کانال'],['action','کنش'],['status','وضعیت'],['url_count','تعداد URL'],['occurred_at','زمان']],
 jobs:[['kind','نوع'],['status','وضعیت'],['attempts','تلاش'],['max_attempts','سقف تلاش'],['available_at','زمان اجرا']],
 automation:[['name_fa','نام'],['event_type','وقتی'],['status','وضعیت'],['conditions','اگر'],['actions','آنگاه']],
 performance:[['route_pattern','مسیر'],['metric','سنجه'],['severity','اهمیت'],['status','وضعیت'],['detected_at','کشف']],
 security:[['kind','نوع'],['severity','اهمیت'],['actor_id','بازیگر'],['occurred_at','زمان'],['acknowledged_at','رسیدگی']],
 audit:[['action','کنش'],['entity_type','موجودیت'],['actor_type','بازیگر'],['impersonated_by','جانشین‌کننده'],['request_id','همبستگی'],['occurred_at','زمان']],
 backups:[['kind','نوع'],['status','وضعیت'],['is_encrypted','رمزنگاری'],['size_bytes','بایت'],['checksum_sha256','SHA-256'],['started_at','زمان']],
 retention:[['scope','دامنه'],['retain_days','روز'],['action','کنش'],['legal_hold','نگهداشت قانونی'],['next_run_at','نوبت بعد']],
};
const TITLES:Record<string,string>={users:'کاربران',businesses:'کسب‌وکارها',content:'نظارت بر محتوا',taxonomy:'تاکسونومی',seo:'سئوی پلتفرم',redirects:'تغییر مسیرها',indexing:'نمایه‌سازی',jobs:'صف کار',automation:'خودکارسازی',performance:'عملکرد',security:'رخدادهای امنیتی',audit:'حسابرسی',backups:'پشتیبان',retention:'نگهداشت داده'};
const EXTRA_FIELDS:Record<string,Field[]>={
 taxonomy:[{name:'key',label:'کلید لاتین',required:true,dir:'ltr'},{name:'name_fa',label:'نام فارسی',required:true},{name:'parent_key',label:'کلید والد',dir:'ltr'}],
 redirects:[{name:'source_path',label:'مسیر مبدأ',required:true,dir:'ltr'},{name:'target_path',label:'مسیر مقصد',dir:'ltr'},{name:'status_code',label:'کد',type:'select',options:['301','302','307','308','410'].map(value=>({value,label:value}))},{name:'reason',label:'دلیل'}],
};
function stateForm(ctx:PanelCtx,key:string,row:Json):string {
 const states=key==='users'?['active','suspended']:key==='businesses'?['active','suspended','archived']:['approved','changes_requested','unpublished','archived'];
 return formBlock({id:`state-${str(row['id'])}`,action:`/app/${key}/state`,csrf:ctx.csrf,fields:[{name:'id',label:'',type:'hidden',value:str(row['id'])},{name:'expected_version',label:'',type:'hidden',value:str(row['version'])},{name:'to',label:'وضعیت مقصد',type:'select',options:states.map(value=>({value,label:value}))},{name:'reason',label:'دلیل تصمیم',required:true,maxLength:500}],submit:'ثبت تصمیم'});
}
function collection(key:string):Section {
 const title=TITLES[key]??key;
 return {key,title,async render(ctx){
  const cursor=ctx.url.searchParams.get('cursor'); const response=await ctx.api('GET',`/api/v1/admin/${key}${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`);
  if(response.status!==200)return failed(title,response);
  const columns=(COLUMNS[key]??[]).map(([key,label])=>({key,label}));
  const mutable=['users','businesses','content'].includes(key);if(mutable)columns.push({key:'act',label:'تصمیم نسخه‌دار'});
  const tableRows=rows(response.json).map(row=>{const cells:Record<string,Cell>={};for(const col of columns){const v=row[col.key];cells[col.key]=col.key==='act'?raw(stateForm(ctx,key,row)):col.key==='status'?statusBadge(str(v)):col.key.endsWith('_at')?shortDate(v):typeof v==='boolean'?(v?'بله':'خیر'):str(v);}return cells;});
  const next=str(response.json?.['nextCursor']);
  return {html:htmlOf(pageHeader(title,{subtitle:'دادهٔ زنده؛ عملیات حساس با مجوز سرور، نسخه و حسابرسی.'}),card(title,dataTable({caption:title,columns,rows:tableRows,empty:'رکوردی ثبت نشده است.'})),next?tag('a',{class:'button button--ghost',href:`/app/${key}?cursor=${encodeURIComponent(next)}`},'صفحهٔ بعد'):null,
   EXTRA_FIELDS[key]?card('افزودن',formBlock({id:`add-${key}`,action:`/app/${key}/create`,csrf:ctx.csrf,fields:EXTRA_FIELDS[key]!,submit:'ثبت'})):null,
   mutable||EXTRA_FIELDS[key]?reauth(ctx):null)};
 },actions:{async state(ctx){const f=ctx.form??{};return outcome(`/app/${key}`,await ctx.api('POST',`/api/v1/admin/${key}/${encodeURIComponent(f['id']??'')}/state`,{expected_version:Number(f['expected_version']),to:f['to'],reason:f['reason']}));},async create(ctx){const body:Json={};for(const field of EXTRA_FIELDS[key]??[])if(ctx.form?.[field.name])body[field.name]=field.name==='status_code'?Number(ctx.form[field.name]):ctx.form[field.name];return outcome(`/app/${key}`,await ctx.api('POST',`/api/v1/admin/${key}`,body));}}};
}
const dashboard:Section={key:'dashboard',title:'نمای کلی',async render(ctx){const r=await ctx.api('GET','/api/v1/admin/dashboard');if(r.status!==200)return failed('نمای کلی',r);const queue=r.json?.['queue'] as Json|null;const metrics=queue?Object.entries(queue).filter(([,v])=>typeof v==='number').map(([key,value])=>metricCard(key,str(value))).join(''):emptyNote('دسترسی آمار صف برای این نقش فعال نیست.');return {html:htmlOf(pageHeader('نمای کلی پلتفرم'),tag('div',{class:'panel-metrics'},metrics),r.json?.['performance']?card('عملکرد',tag('pre',{class:'secret',dir:'ltr'},escapeText(JSON.stringify(r.json['performance'],null,2)))):null,reauth(ctx))};}};
const roles:Section={key:'roles',title:'نقش‌ها و مجوزها',async render(ctx){const r=await ctx.api('GET','/api/v1/admin/roles');if(r.status!==200)return failed('نقش‌ها',r);const m=r.json?.['matrix'] as Json;return{html:htmlOf(pageHeader('ماتریس مجوز پلتفرم'),card('نقش‌ها',dataTable({caption:'نقش‌ها',columns:[{key:'key',label:'کلید'},{key:'name_fa',label:'نام'},{key:'rank',label:'رتبه'}],rows:rows(m,'roles').map(v=>({key:str(v['key']),name_fa:str(v['name_fa']),rank:str(v['rank'])})),empty:'نقشی ثبت نشده'})),card('مجوزها',tag('pre',{class:'secret',dir:'ltr'},escapeText(JSON.stringify(m['grants']??[],null,2)))))};}};
const features:Section={key:'features',title:'امکانات',async render(ctx){const r=await ctx.api('GET','/api/v1/ops/features');if(r.status!==200)return failed('امکانات',r);return{html:htmlOf(pageHeader('رجیستری امکانات'),card('چرخه و اتصال‌ها',dataTable({caption:'امکانات',columns:[{key:'name',label:'امکان'},{key:'status',label:'وضعیت'},{key:'dependencies',label:'وابستگی'},{key:'wiring',label:'اتصال‌ها'}],rows:rows(r.json,'features').map(v=>({name:str(v['name_fa']),status:statusBadge(str(v['status'])),dependencies:str(v['dependencies']),wiring:str(v['wiring'])})),empty:'امکانی ثبت نشده'})))};}};
const settings:Section={key:'settings',title:'تنظیمات سراسری',async render(ctx){const r=await ctx.api('GET','/api/v1/admin/settings');if(r.status!==200)return failed('تنظیمات',r);return{html:htmlOf(pageHeader('تنظیمات سراسری',{subtitle:'رازها نمایش داده یا از این ویرایشگر تغییر داده نمی‌شوند.'}),...rows(r.json).map(v=>card(str(v['key']),v['is_secret']?emptyNote('این مقدار در Secret Store مدیریت می‌شود.'):formBlock({id:`setting-${str(v['id'])}`,action:'/app/settings/save',csrf:ctx.csrf,fields:[{name:'key',label:'',type:'hidden',value:str(v['key'])},{name:'expected_version',label:'',type:'hidden',value:str(v['version'])},{name:'value',label:str(v['description']??v['key']),type:'textarea',value:JSON.stringify(v['value'],null,2),dir:'ltr',required:true}],submit:'ذخیرهٔ نسخه‌دار'}))),reauth(ctx))};},actions:{async save(ctx){let value:unknown;try{value=JSON.parse(ctx.form?.['value']??'');}catch{return{redirect:'/app/settings',flash:{kind:'error',text:'JSON معتبر نیست.'}};}return outcome('/app/settings',await ctx.api('PUT',`/api/v1/admin/settings/${encodeURIComponent(ctx.form?.['key']??'')}`,{expected_version:Number(ctx.form?.['expected_version']),value}));}}};
export const ADMIN_SECTIONS:SectionRegistry={dashboard,design:studioSection('design'),tokens:studioSection('tokens'),roles,features,settings,notifications:MEMBER_SECTIONS['notifications']!,...Object.fromEntries(Object.keys(COLUMNS).map(key=>[key,collection(key)]))};
