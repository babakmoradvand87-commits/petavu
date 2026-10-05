import {tag,escapeText} from '../html.js';
import {card,formBlock,pageHeader,htmlOf} from './kit.js';
import {describeProblem} from './core.js';
import type {Section} from './types.js';
export function secureAccount(base:Section):Section {
 return {
  ...base,
  async render(c) {
   const original=await base.render(c),status=await c.api('GET','/api/v1/auth/mfa/status');
   const body=htmlOf(
    tag('p',{},status.json?.['required']?'MFA فعال است؛ عملیات حساس به عامل دوم نیاز دارد.':'MFA هنوز فعال نیست.'),
    formBlock({id:'mfa-auth',action:'/app/auth/reauth',csrf:c.csrf,fields:[{name:'password',label:'رمز فعلی',type:'password',required:true},{name:'totp',label:'کد authenticator اگر فعال است',maxLength:6,dir:'ltr'},{name:'recovery_code',label:'کد بازیابی به جای TOTP',maxLength:64,dir:'ltr'}],submit:'تأیید قوی هویت'}),
    formBlock({id:'mfa-start',action:'/app/account/mfa-setup',csrf:c.csrf,fields:[],submit:'راه‌اندازی authenticator'}),
    formBlock({id:'mfa-recovery',action:'/app/account/mfa-recovery',csrf:c.csrf,fields:[],submit:'تولید کدهای بازیابی (نمایش یک‌بار)'}),
    tag('div',{class:'cluster'},tag('button',{type:'button',class:'button','data-passkey':'register'},'ثبت Passkey')+tag('button',{type:'button',class:'button','data-passkey':'authenticate'},'تأیید هویت با Passkey'))+tag('p',{id:'passkey-status',role:'status'},'')+tag('p',{},'Passkey با challenge/Origin/RPID/UV و کلید عمومی واقعی پشتیبانی می‌شود؛ کلید خصوصی هرگز به سرور نمی‌رود.')
   );
   return {...original,html:original.html+card('MFA / TOTP / Passkey',body)};
  },
  actions:{
   ...base.actions,
   async 'mfa-setup'(c) {
    const r=await c.api('POST','/api/v1/auth/mfa/setup',{});
    if(r.status!==200)return {redirect:'/app/account',flash:{kind:'error',text:describeProblem(r)}};
    const challenge=r.json?.['challenge'] as Record<string,unknown>;
    const html=htmlOf(pageHeader('Secret فقط همین‌بار'),card('در authenticator وارد کنید',tag('code',{class:'secret',dir:'ltr'},escapeText(String(r.json?.['secret'])))+tag('p',{},escapeText(String(r.json?.['uri'])))),formBlock({id:'mfa-confirm',action:'/app/account/mfa-confirm',csrf:c.csrf,fields:[{name:'challenge_id',label:'',type:'hidden',value:String(challenge['id'])},{name:'code',label:'کد ۶ رقمی واقعی',required:true,maxLength:6,dir:'ltr'}],submit:'تأیید مالکیت authenticator'}));
    return {page:{title:'راه‌اندازی امن authenticator',html}};
   },
   async 'mfa-confirm'(c) {
    const r=await c.api('POST','/api/v1/auth/mfa/confirm',{challenge_id:c.form?.['challenge_id'],code:c.form?.['code']});
    return {redirect:'/app/account',flash:{kind:r.status===200?'success':'error',text:r.status===200?'MFA با اثبات واقعی فعال شد.':describeProblem(r)}};
   },
   async 'impersonation-stop'(c){const r=await c.api('POST','/api/v1/auth/impersonation/stop',{});return {redirect:'/login',flash:{kind:r.status===200?'success':'error',text:r.status===200?'پایان یافت؛ کارمند باید دوباره وارد شود.':describeProblem(r)}};},
   async 'mfa-recovery'(c) {
    const r=await c.api('POST','/api/v1/auth/mfa/recovery',{});
    return {page:{title:'کدهای بازیابی یک‌بارمصرف',status:r.status,html:htmlOf(pageHeader('بازیابی — نگهداری آفلاین'),tag('pre',{class:'secret',dir:'ltr'},escapeText(r.status===200?(r.json?.['codes'] as string[]).join('\n'):describeProblem(r))))}};
   }
  }
 };
}
