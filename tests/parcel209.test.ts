import assert from 'node:assert/strict';
import test from 'node:test';
import {inventoryBeforeTrialD} from '../scripts/audit/source-before-trial-sale-receipts.mjs';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {posSaleModeForProduct,posCartSaleMethodConflict} from '../src/features/pos/saleMethods';
import {wholeParcelReplacementItems} from '../src/features/orders/aftercarePresentation';
import {prepareProducts} from '../src/features/goLive/goLiveImport';
import type {Product} from '../src/types';
import type {PosCartItem} from '../src/features/pos/posV2Cart';
import type {AdminAftercareContext} from '../src/services/supabase/salesAftercare.service';
import {parcel209Pins,sourceBeforeParcel209} from '../scripts/audit/source-before-parcel209.mjs';
import {verifyProbeCoverage} from '../scripts/audit/table-access-probes.mjs';
import {assert209History} from '../scripts/operations/frankfurt-owner-upgrade209.mjs';
import {assertReady209Catalog,assert209PublicationTransition} from '../scripts/operations/frankfurt-reference209.mjs';
import {realtime151Tables} from '../scripts/testing/realtime151-contract.mjs';
const read=(file:string)=>readFileSync(file,'utf8').replaceAll('\r\n','\n');
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
test('new POS lines use only allowed method;existing cart identities/quantity/price stay unchanged',()=>{
 const product={id:'p',parcelOnly:true,unitsPerSalePackage:10} as Product;
 assert.equal(posSaleModeForProduct(product,'base_unit'),'legacy_single_sku_parcel');
 assert.equal(posSaleModeForProduct({...product,parcelOnly:false,unitsPerSalePackage:1},'legacy_single_sku_parcel'),'base_unit');
 assert.equal(posSaleModeForProduct({...product,parcelOnly:false},'base_unit'),'base_unit');
 const line={productId:'p',productName:'شيبس',quantity:10,price:1.5,v2Line:{commercial_line_kind:'base_unit',product_id:'p',base_quantity:10}} as unknown as PosCartItem;
 const before=structuredClone(line);assert.match(posCartSaleMethodConflict([line],new Map([['p',product]]))!,/احذف سطر المفرد/);assert.deepEqual(line,before);
 assert.equal(posCartSaleMethodConflict([line],new Map([['p',{...product,parcelOnly:false}]])),null);
});
test('whole mixed replacement includes actual current physical leaves and rejects missing/duplicate/wrong identities',()=>{
 type Parcel=AdminAftercareContext['parcelInstances'][number];
 const source=(id:string,quantity:number,productId:string,sourceKind='parcel_component')=>({sourceId:id,sourceKind,productId,remainingQuantity:quantity});
 const parcel={components:[{productId:'a',quantity:2,physicalRepresentatives:[source('old-a',1,'a'),source('new-a',1,'a','replacement_item')]},{productId:'b',quantity:3,physicalRepresentatives:[source('b',3,'b')]}]} as unknown as Parcel;
 assert.deepEqual(wholeParcelReplacementItems(parcel),[{sourceKind:'parcel_component',sourceId:'old-a',quantity:1},{sourceKind:'replacement_item',sourceId:'new-a',quantity:1},{sourceKind:'parcel_component',sourceId:'b',quantity:3}]);
 const missing=structuredClone(parcel);missing.components[0].physicalRepresentatives.pop();assert.throws(()=>wholeParcelReplacementItems(missing),/لم يعد كاملاً/);
 const wrong=structuredClone(parcel);wrong.components[0].physicalRepresentatives[0].productId='b';assert.throws(()=>wholeParcelReplacementItems(wrong),/غير متطابقة/);
 const duplicate=structuredClone(parcel);duplicate.components[0].physicalRepresentatives[1]={...duplicate.components[0].physicalRepresentatives[0]};assert.throws(()=>wholeParcelReplacementItems(duplicate),/غير متطابقة/);
 assert.throws(()=>wholeParcelReplacementItems({...parcel,components:[]}),/غير مكتملة/);
});
test('Excel optional omission keeps historical payload identity;explicit values are strict and N1 is rejected',()=>{
 const values={sku:'209-EXCEL',barcode:'',name_ar:'شيبس',category_name:'تسالي',base_unit_name:'باكيت',purchase_unit_name:'طرد',units_per_purchase_unit:'10',sale_unit_name:'طرد',units_per_sale_unit:'10',sale_package_price:'15.000',purchase_package_price:'10.000',cost_per_base_unit:'1.000',min_stock_level:'0'};
 const prepare=(extra:Record<string,string>)=>prepareProducts([{row:2,values:{...values,...extra}}]);
 for(const optional of [{},{parcel_only:''}] as Record<string,string>[]){const result=prepare(optional);assert.deepEqual(result.errors,[]);assert.equal(Object.hasOwn(result.payload[0],'parcel_only'),false);}
 for(const text of ['نعم',' TRUE ','1']){const result=prepare({parcel_only:text});assert.deepEqual(result.errors,[]);assert.equal(result.payload[0].parcel_only,true);}
 for(const text of ['لا','false','0'])assert.equal(prepare({parcel_only:text}).payload[0].parcel_only,false);
 assert.equal(prepare({parcel_only:'أحياناً'}).errors.length,1);assert.equal(prepare({parcel_only:'نعم',units_per_sale_unit:'1'}).errors.length,1);
});
test('209 explicit copies bind delivered208 bodies and approved extensions without dynamic migration rewriting',()=>{
 const fixture=JSON.parse(read('tests/fixtures/parcel209-function-contracts.json'));
 const sql=read('supabase/migrations/209_product_sale_methods.sql');assert.equal(fixture.baseline,'d7779f56dc0bdfe77091bb4881cbae4ad50ced3a');
 for(const contract of fixture.contracts){assert.equal(hash(contract.before),contract.baselineSha256);assert.equal(hash(contract.after),contract.currentDefinitionSha256);assert.ok(sql.includes(contract.after.trimEnd()+';'),contract.name);}
 assert.doesNotMatch(sql,/pg_get_functiondef|EXECUTE\s+format|ALTER\s+FUNCTION[^;]*RENAME/iu);
 const pos=fixture.contracts.find((c:{name:string})=>c.name==='parcel209_pos_sale_internal').after as string;
 assert.ok(pos.indexOf('parcel209_guard_modern_lines_internal')>pos.indexOf("RETURN v_replay->'result_snapshot'"));
 assert.ok(pos.indexOf('parcel209_guard_modern_lines_internal')<pos.indexOf('PERFORM configuration.id'));
 assert.ok(pos.indexOf('parcel209_guard_modern_lines_internal')<pos.indexOf('PERFORM family.id'));
 const old=execFileSync('git',['diff','--name-only','d7779f56dc0bdfe77091bb4881cbae4ad50ced3a','--','supabase/migrations'],{encoding:'utf8'}).trim().split('\n').filter(f=>f&&Number(f.split('/').at(-1)!.slice(0,3))<=208);assert.deepEqual(old,[],'all tracked001-208 immutable;209 is additive');
});
test('209 exact inverse restores every touched source to deliveredA and rejects extra mutations',()=>{
 for(const [file,pin]of Object.entries(parcel209Pins) as [string,{added?:boolean}][]){const current=read(file),restored=sourceBeforeParcel209(file,current);assert.throws(()=>sourceBeforeParcel209(file,current+'\nvoid unapproved;\n'));
  if(pin.added)assert.equal(restored,null);else{const baseline=execFileSync('git',['show','d7779f56dc0bdfe77091bb4881cbae4ad50ced3a:'+file],{encoding:'utf8',maxBuffer:32*1024**2}).replaceAll('\r\n','\n');assert.equal(restored,baseline);assert.throws(()=>sourceBeforeParcel209(file,baseline+'\nvoid unapproved;\n'));}}
});
test('frozen209 SDK proof binds every accepted source and role/query variant through exact D inverse',async()=>{
 const source=await inventoryBeforeTrialD(),proof=JSON.parse(read('docs/operations/TABLE_ACCESS_AFTER_209.json'));assert.equal(proof.migrationCeiling,209);assert.equal(proof.managedAccess,false);assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);assert.deepEqual(proof.sourceHashes,source.sources);assert.deepEqual(proof.coverage,verifyProbeCoverage(source,proof.results));assert.ok(proof.results.every((r:{sqlstate:string|null})=>r.sqlstate===null));
 for(const field of ['ok','ownerV5RestMutation','adminBarcodeMethod','noRoleRefused','readZeroWrites'])assert.equal(proof.parcel209Access[field],true);
 assert.deepEqual(proof.parcel209Access.publicInheritedMethods,[{role:'anon',rows:3,parcelOnly:true},{role:'authenticated',rows:3,parcelOnly:true}]);
});
test('209 owner catalog rejects nullable/default drift,invalid constraint and public/private grant bypasses',()=>{
 const catalog=JSON.parse(read('docs/operations/TABLE_ACCESS_AFTER_209.json')).catalog;assertReady209Catalog(catalog);
 for(const mutation of ['nullable','default','private','public','check']){
  const copy=structuredClone(catalog),column=copy.tables.find((t:{schema:string;name:string})=>t.schema==='public'&&t.name==='products').columns.find((c:{name:string})=>c.name==='parcel_only');
  if(mutation==='nullable')column.notNull=false;
  if(mutation==='default')column.default='true';
  if(mutation==='private')copy.functions.find((f:{identity:string})=>f.identity.startsWith('parcel209_guard_modern_lines_internal(')).acl.push('authenticated=X/postgres');
  if(mutation==='public')copy.functions.find((f:{identity:string})=>f.identity.startsWith('update_product_master_v5(')).acl.push('=X/postgres');
  if(mutation==='check')copy.constraints.find((c:{name:string})=>c.name==='products_parcel_only_sale_size_check').validated=false;
  assert.throws(()=>assertReady209Catalog(copy),mutation);
 }
 // Use all thirteen approved members and their real209 catalog columns.
 const publication={publication:{name:'supabase_realtime',owner:'postgres',allTables:false},tables:realtime151Tables.map((name:string)=>({schema:'public',name,columns:catalog.tables.find((t:{schema:string;name:string})=>t.schema==='public'&&t.name===name).columns.map((c:{name:string})=>c.name),filter:null}))};
 const before=structuredClone(publication);const products=before.tables.find((t:{name:string})=>t.name==='products')!;products.columns=products.columns.filter((name:string)=>name!=='parcel_only');assert209PublicationTransition(before,publication);
 for(const change of ['member','column','filter','owner']){const bad=structuredClone(publication);if(change==='member')bad.tables.pop();if(change==='column')bad.tables[0].columns.push('unapproved');if(change==='filter')Object.assign(bad.tables[0],{filter:'true'});if(change==='owner')bad.publication.owner='authenticated';assert.throws(()=>assert209PublicationTransition(before,bad),change);}
});
test('owner209 requires complete208 history and never backfills reserved lanes',()=>{
 const base=Array.from({length:170},(_,i)=>String(i));const ref={prefixes:{'208':{appliedVersions:base}},appliedVersions:[...base,'209']};assert.deepEqual(assert209History(base,ref),['209']);assert.deepEqual(assert209History(ref.appliedVersions,ref),[]);assert.throws(()=>assert209History(base.slice(1),ref));assert.throws(()=>assert209History([...base.slice(0,-1),'208-unreviewed'],ref));
});
