import test from 'node:test';import assert from 'node:assert/strict';
import {readSalesOnly220Pins,assertSalesOnly220PublicGuards} from '../scripts/operations/sales-only220-catalog.mjs';
const original=readSalesOnly220Pins().publicTriggers;
test('220 readiness binds the one notification trigger to explicit build or held state;every other guard stays exact',()=>{
 assertSalesOnly220PublicGuards(original);const held=structuredClone(original);held.find((t:{name:string})=>t.name==='trg_notify_new_website_order_push')!.enabled='D';assertSalesOnly220PublicGuards(held,{notificationTriggerEnabled:'D'});
 assert.throws(()=>assertSalesOnly220PublicGuards(held));assert.throws(()=>assertSalesOnly220PublicGuards(original,{notificationTriggerEnabled:'D'}));
 for(const mutate of [(v:typeof held)=>{v.find((t:{name:string})=>t.name==='trg_notify_new_website_order_push')!.enabled='R';},(v:typeof held)=>{v.find((t:{name:string})=>t.name==='trg_notify_new_website_order_push')!.name+='unknown';},(v:typeof held)=>{v.find((t:{name:string})=>t.name!=='trg_notify_new_website_order_push')!.enabled='D';},(v:typeof held)=>{v.pop();}]){const changed=structuredClone(held);mutate(changed);assert.throws(()=>assertSalesOnly220PublicGuards(changed,{notificationTriggerEnabled:'D'}));}
});
