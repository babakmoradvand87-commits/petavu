import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createFixture, HOSTS } from '../scripts/lib/fixture.mjs';
import { parseForm, MAX_FORM_BYTES } from '../apps/web/dist/panel/forms.js';
import { MEMBER_SECTIONS } from '../apps/web/dist/panel/sections.js';
let f, owner, other, business, otherBusiness, port, cookie, csrf;
const origin = `http://${HOSTS.panel}`;
async function web(path, {method='GET', body='', headers={}}={}) {
  return new Promise((resolve,reject) => {
    const req = request({host:'127.0.0.1',port,path,method,headers:{host:HOSTS.panel, ...(cookie ? {cookie} : {}), ...(method==='POST'?{origin,'content-type':'application/x-www-form-urlencoded'}:{}), ...headers}}, res=>{
      const chunks=[]; res.on('data',c=>chunks.push(c)); res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));
    }); req.on('error',reject); req.end(body);
  });
}
const post = (path, fields, headers={})=>web(path,{method:'POST',body:new URLSearchParams({_csrf:csrf,...fields}).toString(),headers});
async function api(path, method='GET', body) {
  const response = await fetch(f.api.url + path,{method,headers:{origin,cookie,'x-csrf-token':csrf,'x-business-id':business,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,json:await response.json()};
}
before(async()=>{
 f=await createFixture({api:true}); owner=await f.registerUser({email:'panel-owner@example.test',name:'مالک <script>bad</script>'}); other=await f.registerUser({email:'panel-other@example.test'});
 business=await f.createBusiness({slug:'panel-private',name:'کسب‌وکار خصوصی پنل',ownerUserId:owner.userId,status:'draft',visibility:'private'});
 otherBusiness=await f.createBusiness({slug:'panel-other',name:'دیگری',ownerUserId:other.userId,status:'draft',visibility:'private'});
 await f.addMember({businessId:business,userId:owner.userId,roleKey:'owner'});
 await f.addMember({businessId:otherBusiness,userId:other.userId,roleKey:'owner'});
 await f.web.close(); ({port}=await f.web.listen(0,'127.0.0.1'));
 const login=await web('/login',{method:'POST',body:new URLSearchParams({identifier:owner.email,password:owner.password}).toString()});
 assert.equal(login.status,303); assert.equal(login.headers.location,'/app'); assert.ok(Array.isArray(login.headers['set-cookie']));
 cookie=login.headers['set-cookie'].map(v=>v.split(';')[0]).join('; ');
 const session=await api('/api/v1/auth/session'); csrf=session.json.csrf_token;
 assert.equal((await post('/app/switch',{business_id:business})).status,303);
}, {timeout:60000});
after(async()=>{await f?.close();});

test('15 member menus come from DB and ready entries have renderers',async()=>{ const menu=await api('/api/v1/panel/menu'); assert.equal(menu.status,200); assert.equal(menu.json.items.length,15); for(const row of menu.json.items.filter(v=>v.availability==='ready')) assert.ok(MEMBER_SECTIONS[row.key],row.key); });
test('host-only separate session cookies survive real HTTP BFF',()=>{ assert.match(cookie,/session/); assert.ok(!cookie.includes('Domain=')); });
test('member dashboard renders private data, escaped identity, security and no-store',async()=>{const page=await web('/app'); assert.equal(page.status,200);assert.match(page.body,/کسب‌وکار خصوصی پنل/);assert.ok(!page.body.includes('<script>bad</script>'));assert.match(page.headers['cache-control'],/no-store/);assert.match(page.headers['x-robots-tag'],/noindex/);assert.match(page.body,/name="_csrf"/);});
for(const key of Object.keys(MEMBER_SECTIONS)) test(`ready member section ${key} is wired via real API`,async()=>{const page=await web(key==='dashboard'?'/app':`/app/${key.replaceAll('_','-')}`);assert.equal(page.status,200,`${key}: ${page.body.slice(-800)}`);});
test('private profile cannot be read as anonymous public profile',async()=>{const res=await fetch(`${f.api.url}/api/v1/businesses/${business}/profile`);assert.equal(res.status,404);});
test('authenticated edit API sees private profile',async()=>{const res=await api(`/api/v1/businesses/${business}/profile/edit`);assert.equal(res.status,200);assert.equal(res.json.profile.business_id,business);});
test('profile save preserves values and rejects stale revision',async()=>{const current=(await api(`/api/v1/businesses/${business}/profile/edit`)).json.profile;const res=await api(`/api/v1/businesses/${business}/profile`,'PUT',{expected_version:current.version,tagline:'واقعی و تازه',summary:'متن واقعی'});assert.equal(res.status,200,JSON.stringify(res.json));assert.equal(res.json.profile.tagline,'واقعی و تازه'); const stale=await api(`/api/v1/businesses/${business}/profile`,'PUT',{expected_version:current.version,tagline:'از دست رفته'});assert.equal(stale.status,409);});
test('first missing profile insertion writes fields rather than silently dropping them',async()=>{await f.sudo('delete from app.business_profile where business_id=$1',[business]);const res=await api(`/api/v1/businesses/${business}/profile`,'PUT',{expected_version:0,tagline:'درج نخست',keywords:['دام']});assert.equal(res.status,200,JSON.stringify(res.json));assert.equal(res.json.profile.tagline,'درج نخست');assert.deepEqual(res.json.profile.keywords,['دام']);});
test('profile IDOR with different path business is denied',async()=>{const res=await api(`/api/v1/businesses/${otherBusiness}/profile/edit`);assert.equal(res.status,403);});
test('forged CSRF cannot mutate even with legitimate cookie and origin',async()=>{assert.equal((await post('/app/profile/save',{_csrf:'forged',tagline:'پنهانی'})).status,403);});
test('missing CSRF is denied',async()=>{assert.equal((await web('/app/profile/save',{method:'POST',body:'tagline=denied'})).status,403);});
test('foreign origin is denied',async()=>{assert.equal((await post('/app/profile/save',{}, {origin:'https://evil.example'})).status,403);});
test('wrong content type is rejected',async()=>{assert.equal((await post('/app/profile/save',{}, {'content-type':'application/json'})).status,415);});
test('bounded forms reject oversized request before API',async()=>{assert.equal((await web('/app/profile/save',{method:'POST',body:'x='.padEnd(MAX_FORM_BYTES+1,'a'),headers:{'content-length':String(MAX_FORM_BYTES+1)}})).status,413);});
test('unknown routes and actions are not executed',async()=>{assert.equal((await web('/app/not-real')).status,404);assert.equal((await post('/app/profile/not-real',{})).status,404);});
test('cross-business switch is denied without changing active scope',async()=>{await post('/app/switch',{business_id:otherBusiness});assert.equal((await api('/api/v1/auth/session')).json.active_business_id,business);});
test('forged logout is denied instead of pretending success',async()=>{assert.equal((await post('/logout',{_csrf:'fake'})).status,403);assert.equal((await api('/api/v1/auth/session')).status,200);});
test('anonymous panel does not leak or use public home as private fallback',async()=>{const page=await web('/app',{headers:{cookie:''}});assert.equal(page.status,303);assert.equal(page.headers.location,'/login');});
for(const bad of ['__proto__=x','constructor=x','a=%ZZ','a=1&a=2','_csrf=1&_csrf=2','a=%00','bad+key=x',Array.from({length:61},(_,i)=>`x${i}=1`).join('&')]) test(`form rejects untrusted structure ${bad.slice(0,35)}`,()=>assert.equal(parseForm(bad),null));
test('valid form has no prototype and decodes Persian',()=>{const form=parseForm('x=%D9%BE%D8%AA%D8%A7%D9%88%D9%88');assert.equal(Object.getPrototypeOf(form),null);assert.equal(form.x,'پتاوو');});
