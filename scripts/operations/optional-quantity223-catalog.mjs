import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {readFileSync} from 'node:fs';
import {assertReady222Catalog} from './independent-prices222-catalog.mjs';
import {canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';
import {catalogDifference} from '../testing/schema-catalog.mjs';

export const quantity223Migration='223_optional_sales_quantity.sql';
export const quantity223Tables=Object.freeze(['quantity_counters','quantity_events','quantity_requests']);
const schema='sales_lite3';
const privateFunctions=[
 'alert_transition223','assert_owner223','cancel_credit223','component_debit223','confirm_plan223',
 'consume223','effective_available223','guard_base_unit223','immutable223','item_debit223',
 'plan_quantities223','return_credit223',
];
const publicFunctions=['lite3_counter_context223','lite3_low_counters223','lite3_pos_quantity_check223','lite3_set_counter223'];
const modifiedFunctions=['catalog_page','parcel_options','pos'];
const newTriggers={
 'public.order_items':['optional_quantity_item223'],
 'public.order_parcel_components':['optional_quantity_component223'],
 'public.orders':['optional_quantity_cancel223'],
 'public.products':['optional_quantity_unit223'],
 'sales_lite2.return_details':['optional_quantity_return223'],
};
const name=row=>row.identity.split('(')[0];
const isNewTrigger=row=>newTriggers[row.schema+'.'+row.table]?.includes(row.name)??false;
const isPrivate=(section,row)=>row.schema===schema||(section==='schemas'&&row.name===schema);
const isNewFunction=row=>row.schema==='public'&&publicFunctions.includes(name(row));
const isModifiedFunction=row=>row.schema==='sales_lite2'&&modifiedFunctions.includes(name(row));
const pinUrl=new URL('../../docs/design/off-quantity-counter223/catalog223-pins.json',import.meta.url);
export const migration223Sha256=()=>sha256(canonicalLf(readFileSync(new URL('../../supabase/migrations/'+quantity223Migration,import.meta.url),'utf8')));

export function quantity223CatalogDelta(before,after,dates=undefined){
 const differences=catalogDifference(before,after,dates);
 const addedPublic=[],addedPrivate=[],changed=[],triggers=[],tables=[],schemas=[];
 for(const difference of differences){
  const {section,before:old,after:row}=difference;
  assert.ok(row,'QUANTITY223_UNAPPROVED_CATALOG_REMOVAL:'+difference.identity);
  if(isPrivate(section,row)){
   assert.equal(old,null,'QUANTITY223_EXISTING_PRIVATE_OBJECT');
   assert.ok(['schemas','tables','constraints','indexes','functions','triggers'].includes(section),'QUANTITY223_PRIVATE_SECTION:'+section);
   if(section==='schemas')schemas.push(row.name);
   if(section==='functions'){
    addedPrivate.push(name(row));
    assert.deepEqual(row.acl,['postgres=X/postgres'],'QUANTITY223_PRIVATE_EXECUTE_ACL');
   }
   if(section==='tables'){
    tables.push(row.name);
    assert.equal(row.owner,'postgres');
    assert.equal(row.rls,true);
    assert.equal(row.kind,'r');
    assert.ok(row.acl===null||row.acl.every(value=>/^postgres=[a-zA-Z]+\/postgres$/u.test(value)),'QUANTITY223_PRIVATE_TABLE_ACL');
   }
  }else if(section==='functions'&&isNewFunction(row)){
   assert.equal(old,null);
   assert.equal(row.owner,'postgres');
   assert.deepEqual([...row.acl].sort(),['authenticated=X/postgres','postgres=X/postgres']);
   addedPublic.push(name(row));
  }else if(section==='functions'&&isModifiedFunction(row)){
   assert.ok(old);
   assert.deepEqual({...row,definition:old.definition},old,'QUANTITY223_MODIFIED_FUNCTION_METADATA');
   changed.push(name(row));
  }else if(section==='triggers'&&isNewTrigger(row)){
   assert.equal(old,null);
   assert.equal(row.enabled,'O');
   triggers.push(row.name);
  }else{
   assert.fail('QUANTITY223_UNAPPROVED_CATALOG_CHANGE:'+section+':'+difference.identity);
  }
 }
 assert.deepEqual(schemas,[schema]);
 assert.deepEqual(tables.sort(),[...quantity223Tables]);
 assert.deepEqual(addedPublic.sort(),publicFunctions);
 assert.deepEqual(addedPrivate.sort(),privateFunctions);
 assert.deepEqual(changed.sort(),modifiedFunctions);
 assert.deepEqual(triggers.sort(),Object.values(newTriggers).flat().sort());
 return differences;
}

function readPins(){
 const pins=JSON.parse(readFileSync(pinUrl,'utf8'));
 assert.equal(pins.format,1);
 assert.equal(pins.migrationSha256,migration223Sha256(),'QUANTITY223_MIGRATION_PIN_DRIFT');
 assert.equal(pins.base222PinSha256,sha256(canonicalLf(readFileSync(new URL('../../docs/design/independent-parcel-prices222/catalog222-pins.json',import.meta.url),'utf8'))));
 return pins;
}

export function assertQuantity223CatalogDelta(before,after,dates=undefined){
 assert.deepEqual(quantity223CatalogDelta(before,after,dates),readPins().changes,'QUANTITY223_CATALOG_PIN_DRIFT');
}

export function assertReady223Catalog(catalog,options){
 const pins=readPins();
 const observed=structuredClone(catalog);
 const base=Object.fromEntries(Object.entries(observed).map(([section,rows])=>[section,rows.flatMap(row=>{
  if(isPrivate(section,row)||section==='triggers'&&isNewTrigger(row)||section==='functions'&&isNewFunction(row))return [];
  if(section==='functions'&&isModifiedFunction(row)){
   const reviewed=pins.changes.find(change=>change.section==='functions'&&change.before?.identity===row.identity&&change.before.schema===row.schema);
   assert.ok(reviewed&&isDeepStrictEqual(reviewed.after,row),'QUANTITY223_PRIVATE_WRITER_CHANGED:'+row.identity);
   return [reviewed.before];
  }
  return [row];
 })]));
 assertReady222Catalog(base,options);
 assertQuantity223CatalogDelta(base,observed);
 return catalog;
}
