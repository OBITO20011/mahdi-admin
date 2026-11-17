import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {
 assertPrice225Additive,assertReady225CandidateCatalog,price225FunctionNames,readPrice225CandidatePins,
} from '../scripts/operations/on-prices225-catalog.mjs';

function catalog(){
 const before=JSON.parse(readFileSync('docs/operations/TABLE_ACCESS_AFTER_224.json','utf8')).catalog;
 const after=structuredClone(before);
 const pins=readPrice225CandidatePins();
 for(const row of pins.changes){
  assert.equal(row.before,null,'Every 225 catalog change must add an object');
  after[row.section].push(structuredClone(row.after));
 }
 return {before,after,pins};
}

test('225 catalog admits exactly the captured additions and retains every224 object',()=>{
 const {before,after,pins}=catalog();
 assert.equal(price225FunctionNames.length,17);
 assert.deepEqual(assertPrice225Additive(before,after),pins.changes);
 assert.equal(assertReady225CandidateCatalog(after),after);
 assert.deepEqual(pins.changes.reduce((counts:Record<string,number>,row:{section:string})=>{
  counts[row.section]=(counts[row.section]??0)+1;return counts;
 },{}),{tables:1,indexes:1,triggers:1,functions:17,constraints:6});
});

test('225 reader privileges, owner, search path and exact body are pinned',()=>{
 for(const change of ['owner','acl','configuration','definition'] as const){
  const {after}=catalog();
  const reader=after.functions.find((row:{identity:string})=>row.identity.startsWith('get_receipt_pricing_warnings225('));
  if(change==='owner')reader.owner='anon';
  if(change==='acl')reader.acl.push('anon=X/postgres');
  if(change==='configuration')reader.configuration=['search_path=public'];
  if(change==='definition')reader.definition+='\nUNKNOWN_BYTE';
  assert.throws(()=>assertReady225CandidateCatalog(after));
 }
});

test('225 catalog protects224 functions and tables and requires its new line guard',()=>{
 const oldFunction=catalog();
 oldFunction.after.functions.find((row:{identity:string})=>row.identity.startsWith('parcel209_pos_sale_internal(')).definition+='\nUNKNOWN_BYTE';
 assert.throws(()=>assertPrice225Additive(oldFunction.before,oldFunction.after));
 const oldTable=catalog();
 oldTable.after.tables.find((row:{schema:string;name:string})=>row.schema==='public'&&row.name==='products').columns[0].notNull=false;
 assert.throws(()=>assertPrice225Additive(oldTable.before,oldTable.after));
 const oldTrigger=catalog();
 oldTrigger.after.triggers.find((row:{name:string})=>row.name==='trg_price225_guard_new_parcel').enabled='D';
 assert.throws(()=>assertReady225CandidateCatalog(oldTrigger.after),/PRICES225_NEW_LINE_GUARD_ENABLED/u);
});

test('225 pricing state remains private and incomplete or duplicate additions are refused',()=>{
 const exposed=catalog();
 exposed.after.tables.find((row:{name:string})=>row.name==='product_sale_pricing_state225').acl.push('authenticated=r/postgres');
 assert.throws(()=>assertReady225CandidateCatalog(exposed.after),/PRICES225_STATE_TABLE_ACL/u);
 const missing=catalog();
 missing.after.functions=missing.after.functions.filter((row:{identity:string})=>!row.identity.startsWith('get_receipt_pricing_warnings225('));
 assert.throws(()=>assertReady225CandidateCatalog(missing.after),/PRICES225_EXACT_NEW_FUNCTIONS/u);
 const duplicate=catalog();
 duplicate.after.functions.push(duplicate.after.functions.find((row:{identity:string})=>row.identity.startsWith('get_receipt_pricing_warnings225(')));
 assert.throws(()=>assertReady225CandidateCatalog(duplicate.after),/PRICES225_EXACT_NEW_FUNCTIONS/u);
});
