import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {parseManualAvailability,readManualAvailabilityWithRpc,setManualAvailabilityWithRpc} from '../src/services/supabase/manualAvailability.service';

const pid='11111111-1111-4111-8111-111111111111',parent='22222222-2222-4222-8222-222222222222';
const row=()=>({productId:pid,available:true,effectiveAvailable:true,revision:0,active:true,parentAvailable:true,flavorMasterProductId:null as string|null});
const payload=()=>({contractVersion:'sales-only-availability2-v1',fullAccounting:false,products:[row()]});
test('availability isexplicitboolean/CASrevision,not a fabricated stockquantity;unknown extra fields are not propagated',()=>{
 const p=payload();Object.assign(p.products[0],{cost:1234,customerName:'SYNTHETIC PRIVATE',token:'SYNTHETIC SECRET'});
 const result=parseManualAvailability(p,[pid]);assert.deepEqual(result.products,[row()]);
 assert.doesNotMatch(JSON.stringify(result),/quantity|cost|SYNTHETIC|token/);
 const inherited=payload();inherited.products[0]={...row(),flavorMasterProductId:parent,parentAvailable:false,effectiveAvailable:false};
 assert.equal(parseManualAvailability(inherited,[pid]).products[0].available,true);
 assert.equal(parseManualAvailability(inherited,[pid]).products[0].effectiveAvailable,false);
});
test('missing/duplicate/substituted identity or inconsistent inheritedavailability neverdefaults toavailable',()=>{
 for(const products of [[],[row(),row()],[{...row(),productId:parent}],[{...row(),parentAvailable:false}],[{...row(),revision:-1}],[{...row(),available:'true'}]]){
  assert.throws(()=>parseManualAvailability({...payload(),products},[pid]),/MANUAL_AVAILABILITY_UNVERIFIED/);
 }
 assert.throws(()=>parseManualAvailability({...payload(),fullAccounting:'false'},[pid]),/MANUAL_AVAILABILITY_UNVERIFIED/);
});
test('read isbounded andset sends originalrevision once;lostresponse neitherretries nor guessesrevision',async()=>{
 assert.deepEqual(await readManualAvailabilityWithRpc([pid,pid],async(name,args)=>{
  assert.equal(name,'lite1_product_availability2');assert.deepEqual(args,{p_product_ids:[pid]});return {data:payload(),error:null};
 }),payload());
 let calls=0;await assert.rejects(setManualAvailabilityWithRpc(pid,false,0,async(name,args)=>{
  calls++;assert.equal(name,'lite1_set_available2');assert.deepEqual(args,{p_product:pid,p_available:false,p_revision:0});return {data:null,error:{message:'network error WITH PRIVATE FIELD'}};
 }),/MANUAL_AVAILABILITY_UNVERIFIED/);assert.equal(calls,1);
 assert.deepEqual(await setManualAvailabilityWithRpc(pid,false,0,async()=>({data:{available:false,revision:1},error:null})),{available:false,revision:1});
 await assert.rejects(setManualAvailabilityWithRpc(pid,false,0,async()=>({data:{available:false,revision:2},error:null})),/MANUAL_AVAILABILITY_UNVERIFIED/);
});
test('quarantined availability wrapper delegates existingCAS;original219 and8bridges unchanged',()=>{
 const sql=readFileSync('docs/design/sales-only-phase2/availability.sql','utf8');
 assert.match(sql,/cardinality\(p_product_ids\) NOT BETWEEN 1 AND 200/);
 assert.match(sql,/sales_lite1\.available\(p.id\)/);assert.match(sql,/RETURN public\.lite1_set_available\(p_product,p_available,p_revision\)/);
 assert.match(sql,/IF NOT sales_lite1\.enabled\(\)/);
 assert.doesNotMatch(sql,/CREATE OR REPLACE|inventory_balances|inventory_movements|cost_price|wac_cost/);
});
