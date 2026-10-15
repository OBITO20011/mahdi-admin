import assert from 'node:assert/strict';
import test from 'node:test';
import {businessCronJobs} from '../scripts/operations/build-cron-report.mjs';
import {heldTrigger,heldJobNames,expectedHeldNotifications,notificationTransitionSql,validateOriginalNotifications,assertHeldCatalog} from '../scripts/operations/frankfurt-notification-hold.mjs';

const original={trigger:{schema:'public',table:'orders',name:heldTrigger,enabled:'O',
 definition:`CREATE TRIGGER ${heldTrigger} AFTER INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION notify_new_website_order_push()`},
 jobs:businessCronJobs.map((j,i)=>({id:i+1,name:j.name,schedule:'fixture',command:'SELECT '+j.calls+';',
 host:'localhost',port:5432,database:'postgres',username:'postgres',active:true}))};
test('hold preserves exact job definitions and trigger;only four active bits and one trigger state change',()=>{
 const held=expectedHeldNotifications(original);
 assert.equal(held.trigger.enabled,'D');assert.equal(original.trigger.enabled,'O');
 assert.deepEqual(held.jobs.filter((j:typeof original.jobs[number])=>!j.active).map((j:typeof original.jobs[number])=>j.name),heldJobNames);
 for(let i=0;i<held.jobs.length;i++)assert.deepEqual({...held.jobs[i],active:true},original.jobs[i]);
 assert.equal(held.jobs.find((j:typeof original.jobs[number])=>j.name==='cleanup-guest-order-gateway-requests')?.active,true);
 const forward=notificationTransitionSql(original),reverse=notificationTransitionSql(original,true);
 assert.match(forward,/BEGIN ISOLATION LEVEL SERIALIZABLE;[\s\S]*LOCK TABLE public.orders/u);
 assert.doesNotMatch(forward+reverse,/LOCK TABLE cron\.job|GRANT|SET ROLE/u);
 assert.match(forward,/DISABLE TRIGGER trg_notify_new_website_order_push/u);
 assert.match(reverse,/ENABLE TRIGGER trg_notify_new_website_order_push/u);
 assert.equal((forward.match(/cron.alter_job\(/gu)??[]).length,4);
 assert.equal((reverse.match(/active := true/gu)??[]).length,4);
 assert.match(reverse,/NOTIFICATION_HOLD_SNAPSHOT_CHANGED/u);assert.match(reverse,/NOTIFICATION_HOLD_POSTCONDITION/u);
 assert.doesNotMatch(forward+reverse,/unschedule|DROP|http_post|vault\./u);
 const extra=structuredClone(original);extra.jobs.push({...original.jobs[0],id:999,name:'unexpected'});
 assert.throws(()=>validateOriginalNotifications(extra));
});
test('expected catalog delta is one exact trigger bit,not an exclusion for any object or other bit',()=>{
 const a={triggers:[original.trigger],functions:[{identity:'f()',definition:'unchanged'}]};
 const b=structuredClone(a);b.triggers[0].enabled='D';
 assert.equal(assertHeldCatalog(a,b).expectedDifferenceCount,1);
 assert.throws(()=>assertHeldCatalog(a,a),'Hold must actually be applied');
 const changed=structuredClone(b);changed.triggers[0].definition+=' changed';
 assert.throws(()=>assertHeldCatalog(a,changed));
 const another=structuredClone(b);another.functions[0].definition='changed';
 assert.throws(()=>assertHeldCatalog(a,another));
 const missing=structuredClone(b);missing.functions=[];assert.throws(()=>assertHeldCatalog(a,missing));
});
