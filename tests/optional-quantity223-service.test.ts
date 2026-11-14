import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOptionalQuantityContext,parseOptionalQuantityInput,readOptionalQuantityWithRpc,setOptionalQuantityWithRpc,readOptionalQuantityShortagesWithRpc} from '../src/services/supabase/optionalQuantity.service';
const id='92600000-0000-4000-8000-000000000103',unit='92600000-0000-4000-8000-000000000010';
const row={productId:id,name:'اختبار الكمية',flavorName:null,sku:'Q-TEST',unitId:unit,unitName:'باكيت',enabled:true,quantity:3,threshold:2,revision:1,everEnabled:true,active:true,manualAvailable:true,effectiveAvailable:true};
const context={contractVersion:'optional-quantity223-v1',fullAccounting:false,productId:id,isFamily:false,products:[row]};

test('optional quantity parses Arabic whole units;negative,fractional,empty and over-limit values refuse',()=>{
 assert.equal(parseOptionalQuantityInput('٣'),3);assert.equal(parseOptionalQuantityInput('۰'),0);assert.equal(parseOptionalQuantityInput('1000000000'),1_000_000_000);
 for(const value of ['','-1','1.5','١٫٥','1000000001','3e2'])assert.equal(parseOptionalQuantityInput(value),null,value);
});
test('quantity context verifies exact requested leaf,unit,revision and effective availability;malformed reads fail closed',()=>{
 assert.deepEqual(parseOptionalQuantityContext(context,id).products,[row]);
 const invalid=[null,{...context,fullAccounting:true},{...context,productId:unit},{...context,products:[row,row]},{...context,products:[{...row,quantity:-1}]},{...context,products:[{...row,quantity:0}]},{...context,products:[{...row,unitName:''}]},{...context,products:[{...row,revision:NaN}]}];
 for(const value of invalid)assert.throws(()=>parseOptionalQuantityContext(value,id),/OPTIONAL_QUANTITY_UNVERIFIED/u);
 assert.equal(parseOptionalQuantityContext({...context,products:[{...row,quantity:0,effectiveAvailable:false}]},id).products[0].effectiveAvailable,false);
});
test('manual quantity uses one key and one CAS;errors or a lost reply cause no automatic retry',async()=>{
 let calls=0;const key='92600000-0000-4000-8000-000000000901';
 const result=await setOptionalQuantityWithRpc(row,{enabled:true,quantity:50,threshold:5},key,(name,args)=>{
  calls++;assert.equal(name,'lite3_set_counter223');assert.deepEqual(args,{p_product_id:id,p_enabled:true,p_quantity:50,p_low_threshold:5,p_expected_revision:1,p_key:key});
  return Promise.resolve({error:null,data:{success:true,idempotentReplay:false,productId:id,enabled:true,quantity:50,threshold:5,revision:2}});
 });assert.equal(result.revision,2);assert.equal(calls,1);
 for(const response of [{error:{code:'conflict'},data:null},{error:null,data:{success:true,revision:99}}]){
  calls=0;await assert.rejects(setOptionalQuantityWithRpc(row,{enabled:true,quantity:50,threshold:5},key,()=>{calls++;return Promise.resolve(response);}),/OPTIONAL_QUANTITY_UNVERIFIED/u);assert.equal(calls,1);
 }
 calls=0;await assert.rejects(setOptionalQuantityWithRpc(row,{enabled:true,quantity:50,threshold:5},key,()=>{calls++;return Promise.reject(Error('lost reply'));}),/lost reply/u);assert.equal(calls,1);
});
test('unverified owner quantity reads never synthesize a disabled state from missing RPC/network errors',async()=>{
 let calls=0;
 await assert.rejects(readOptionalQuantityWithRpc(id,()=>{calls++;return Promise.resolve({data:null,error:{code:'PGRST202'}});}),/OPTIONAL_QUANTITY_UNVERIFIED/u);assert.equal(calls,1);
});
test('owner POS shortage precheck validates current cart identities and actual unit quantities without retry',async()=>{
 const lines=[{commercial_line_kind:'base_unit' as const,product_id:id,base_quantity:4}];
 const shortage={productId:id,name:row.name,unitName:'باكيت',quantity:3,required:4,revision:1};let calls=0;
 const read=async(shortages:unknown[])=>readOptionalQuantityShortagesWithRpc(lines,(name,args)=>{
  calls++;assert.equal(name,'lite3_pos_quantity_check223');assert.deepEqual(args,{p_lines:lines});
  return Promise.resolve({error:null,data:{contractVersion:'optional-quantity223-v1',fullAccounting:false,shortages}});
 });
 assert.deepEqual(await read([shortage]),[shortage]);assert.equal(calls,1);assert.deepEqual(await read([]),[]);
 for(const wrong of [[shortage,shortage],[{...shortage,productId:unit}],[{...shortage,required:3}],[{...shortage,quantity:-1}],[{...shortage,unitName:''}]])await assert.rejects(read(wrong),/OPTIONAL_QUANTITY_UNVERIFIED/u);
});
