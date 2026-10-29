import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {assertReady217Catalog} from '../scripts/operations/frankfurt-reference217.mjs';
import {assert217History} from '../scripts/operations/frankfurt-owner-upgrade217.mjs';
import {expectedHeld217Notifications,ownerTelegramJob} from '../scripts/operations/owner-telegram217-notifications.mjs';
import {expectedHeldNotifications,heldTrigger} from '../scripts/operations/frankfurt-notification-hold.mjs';
import {businessCronJobs} from '../scripts/operations/build-cron-report.mjs';

const proof=JSON.parse(readFileSync('docs/operations/TABLE_ACCESS_AFTER_217.json','utf8'));
test('217 current actual catalog satisfies private settings and service-only transport contract',()=>{
 assertReady217Catalog(proof.catalog);
 for(const mutate of [
  (c:any)=>{c.tables.find((t:any)=>t.name==='owner_telegram_dispatch_settings').rls=false;},
  (c:any)=>{c.tables.find((t:any)=>t.name==='owner_telegram_dispatch_settings').acl.push('authenticated=r/postgres');},
  (c:any)=>{c.functions.find((f:any)=>f.identity.startsWith('claim_owner_telegram_deliveries_v1(')).owner='supabase_admin';},
  (c:any)=>{c.functions.find((f:any)=>f.identity.startsWith('claim_owner_telegram_deliveries_v1(')).configuration=[];},
  (c:any)=>{c.functions.find((f:any)=>f.identity.startsWith('claim_owner_telegram_deliveries_v1(')).definition=c.functions.find((f:any)=>f.identity.startsWith('claim_owner_telegram_deliveries_v1(')).definition.replace('SECURITY DEFINER','SECURITY INVOKER');},
  (c:any)=>{c.functions.find((f:any)=>f.identity.startsWith('owner217_claim_deliveries_internal(')).acl.push('service_role=X/postgres');},
 ]){const changed=structuredClone(proof.catalog);mutate(changed);assert.throws(()=>assertReady217Catalog(changed));}
});
test('217 owner upgrade admits exact complete216 or217 only, never replayed duplicate, gap or future',()=>{
 const full=proof.manifest.map((f:string)=>f.slice(0,3)),base=full.slice(0,-1),reference={prefixes:{'216':{appliedVersions:base}},appliedVersions:full};
 assert.equal(base.length,178);assert.equal(full.length,179);assert.deepEqual(assert217History(base,reference),['217']);assert.deepEqual(assert217History(full,reference),[]);
 for(const history of [base.slice(1),base.slice(0,-1),[...base,'218'],[...full,'217'],[...full,'218']])assert.throws(()=>assert217History(history,reference));
});
test('217 notification transition preserves all five original rows and admits only one exact inactive new job',()=>{
 const old={trigger:{schema:'public',table:'orders',name:heldTrigger,enabled:'O',definition:`CREATE TRIGGER ${heldTrigger} AFTER INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION notify_new_website_order_push()`},
  jobs:businessCronJobs.map((j:any,i:number)=>({id:i+1,name:j.name,schedule:'fixture',command:'SELECT '+j.calls+';',host:'localhost',port:5432,database:'postgres',username:'postgres',active:true})).sort((a:any,b:any)=>a.name.localeCompare(b.name,'en'))};
 const extra={id:217,...ownerTelegramJob,host:'localhost',port:5432,database:'postgres',username:'postgres',active:false};
 const original={...old,jobs:[...old.jobs,extra]},held=expectedHeld217Notifications(original,original),base=expectedHeldNotifications(old);
 assert.equal(JSON.stringify(held.jobs.find((j:any)=>j.name===extra.name)),JSON.stringify(extra));
 const reordered={...original,jobs:original.jobs.map(j=>j.name===extra.name?Object.fromEntries(Object.entries(j).reverse()):j)};
 assert.equal(JSON.stringify(expectedHeld217Notifications(original,reordered).jobs.find((j:any)=>j.name===extra.name)),JSON.stringify(reordered.jobs.find(j=>j.name===extra.name)));
 assert.deepEqual(held.trigger,base.trigger);assert.deepEqual(held.jobs.filter((j:any)=>j.name!==extra.name),base.jobs);
 for(const mutate of [
  (s:any)=>{s.jobs.find((j:any)=>j.name===extra.name).active=true;},
  (s:any)=>{s.jobs.find((j:any)=>j.name===extra.name).command='SELECT 1;';},
  (s:any)=>{s.jobs.find((j:any)=>j.name===extra.name).host='other.invalid';},
  (s:any)=>{s.jobs.push({...extra,id:218});},
  (s:any)=>{s.jobs=s.jobs.filter((j:any)=>j.name!==extra.name);},
 ]){const changed=structuredClone(original);mutate(changed);assert.throws(()=>expectedHeld217Notifications(original,changed));}
});
