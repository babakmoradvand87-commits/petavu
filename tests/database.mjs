import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
for(const f of (await readdir('packages/db/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile('packages/db/migrations/'+f,'utf8'));
const a='10000000-0000-4000-8000-000000000001',b='10000000-0000-4000-8000-000000000002';
const o1='20000000-0000-4000-8000-000000000001',o2='20000000-0000-4000-8000-000000000002';
await db.exec(`INSERT INTO identity.actors(id,display_name) VALUES('${a}','Tenant A'),('${b}','Tenant B');INSERT INTO network.organizations(id,slug,name) VALUES('${o1}','tenant-a','Organization A'),('${o2}','tenant-b','Organization B');INSERT INTO network.memberships(organization_id,actor_id,role,status) VALUES('${o1}','${a}','owner','active'),('${o2}','${b}','owner','active');INSERT INTO network.organization_private(organization_id,contact_email) VALUES('${o1}','a@example.test'),('${o2}','b@example.test');`);
async function asRole(role,actor,fn){await db.exec('SET ROLE '+role);await db.query("SELECT set_config('petavu.actor_id',$1,false)",[actor||'']);try{return await fn()}finally{await db.exec('RESET ROLE')}}
const results=[];
async function check(name,fn){await fn();results.push(name);console.log('PASS:',name)}
await check('Business taxonomy includes 8 categories',async()=>assert.equal((await db.query('SELECT * FROM network.business_categories')).rows.length,8));
await check('Tenant A sees only its own pending organization',()=>asRole('petavu_member',a,async()=>{const r=await db.query('SELECT id FROM network.organizations');assert.deepEqual(r.rows.map(x=>x.id),[o1])}));
await check('Tenant B cannot read Tenant A private contact',()=>asRole('petavu_member',b,async()=>{const r=await db.query('SELECT contact_email FROM network.organization_private');assert.deepEqual(r.rows.map(x=>x.contact_email),['b@example.test'])}));
await check('Member cannot self-verify an organization',()=>asRole('petavu_member',a,async()=>assert.rejects(()=>db.exec(`UPDATE network.organizations SET status='verified' WHERE id='${o1}'`),/permission denied/)));
await check('Member cannot grant itself a membership or admin capability',()=>asRole('petavu_member',a,async()=>{await assert.rejects(()=>db.exec(`INSERT INTO network.memberships(organization_id,actor_id,status) VALUES('${o2}','${a}','active')`),/permission denied/);await assert.rejects(()=>db.exec(`INSERT INTO identity.staff_assignments VALUES('${a}','site.manage',now())`),/permission denied/)}));
await check('Site administrator cannot read shop products',()=>asRole('petavu_adminpanel',a,async()=>assert.rejects(()=>db.query('SELECT * FROM commerce.products'),/permission denied/)));
await check('Shop administrator cannot read private documents',()=>asRole('petavu_adminshop',a,async()=>assert.rejects(()=>db.query('SELECT * FROM network.documents'),/permission denied/)));
await check('Public role sees no pending organizations',()=>asRole('petavu_public',null,async()=>assert.equal((await db.query('SELECT * FROM network.organizations')).rows.length,0)));
await db.exec(`UPDATE network.organizations SET status='verified',directory_visible=true WHERE id='${o1}'`);
await check('Public role sees only verified opted-in directory profiles',()=>asRole('petavu_public',null,async()=>assert.deepEqual((await db.query('SELECT id FROM network.organizations')).rows.map(x=>x.id),[o1])));
await check('Audit events cannot be altered or removed by a runtime member',()=>asRole('petavu_member',a,async()=>{await db.query("INSERT INTO operations.audit_events(actor_id,action,resource_type,request_id) VALUES($1,'demo.test','test',gen_random_uuid())",[a]);await assert.rejects(()=>db.exec('DELETE FROM operations.audit_events'),/permission denied/);await assert.rejects(()=>db.exec("UPDATE operations.audit_events SET action='changed'"),/permission denied/)}));
await check('Missing actor context grants no private tenant access',()=>asRole('petavu_member',null,async()=>assert.equal((await db.query('SELECT * FROM network.organization_private')).rows.length,0)));
await db.close();
console.log(`\n${results.length} SQL/RLS checks passed on PGlite's embedded PostgreSQL engine. Not a test of a live Supabase project, network security or authentication backend.`);
