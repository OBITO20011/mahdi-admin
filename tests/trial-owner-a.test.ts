import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {SupplierReceiptItemsPreview} from '../src/features/directReceiving/SupplierReceiptItemsPreview';
import type {SupplierReceiptItem} from '../src/types/directReceiving';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {trialOwnerAPins,sourceBeforeTrialOwnerA} from '../scripts/audit/source-before-trial-owner-a.mjs';
import {inventoryBeforeParcel209} from '../scripts/audit/source-before-parcel209.mjs';
import {verifyProbeCoverage} from '../scripts/audit/table-access-probes.mjs';

const item=(id:string,productId:string,name:string,quantity:number,size:number,unit='باكيت'):SupplierReceiptItem=>({
 id,productId,productName:name,supplierReceiptId:'receipt',packageQuantity:quantity,unitsPerPackage:size,baseUnitName:unit,
 purchaseUnitName:'كرتونة',totalBaseUnits:quantity*size,packagePriceInMinorUnits:0,baseUnitCostInMinorUnits:0,
 discountInMinorUnits:0,lineTotalInMinorUnits:0,createdAt:'2026-10-22T08:00:00Z',
});
test('receipt preview counts distinct products and keeps parcel/base quantities separate',()=>{
 const html=renderToStaticMarkup(createElement(SupplierReceiptItemsPreview,{items:[item('1','a','عصير',10,12),item('2','a','عصير',3,1),
  item('3','b','أرز',2,1,'شوال'),item('4','c','ماء',4,10)]}));
 const text=html.replace(/<[^>]+>/g,'');
 assert.match(text,/عصير — 10 طرد \+ 3 باكيت/);assert.match(text,/أرز — 2 شوال/);assert.match(text,/\+1 أصناف أخرى/);
 assert.doesNotMatch(text,/ماء|كرتونة/);
});
test('receipt preview preserves different historical parcel sizes and explains missing items',()=>{
 const text=renderToStaticMarkup(createElement(SupplierReceiptItemsPreview,{items:[item('1','a','صنف',2,10),item('2','a','صنف',1,20)]})).replace(/<[^>]+>/g,'');
 assert.match(text,/2 طرد \(10 باكيت\) \+ 1 طرد \(20 باكيت\)/);
 assert.match(renderToStaticMarkup(createElement(SupplierReceiptItemsPreview,{items:[]})),/لا توجد تفاصيل أصناف/);
});
test('modern receipt preview uses saved commercial quantity rather than physical rows or current parcel size',()=>{
 const physical=item('physical','a','عصير',240,1);
 const displayLines=[{id:'commercial',kind:'legacy_single_sku_parcel' as const,commercialQuantity:10,unitsPerParcel:24,
  baseUnitName:'باكيت',baseQuantity:240,grossInMinorUnits:0,lineDiscountInMinorUnits:0,netInMinorUnits:0,acquisitionInMinorUnits:0,
  components:[{itemId:physical.id,productId:'a',nameAr:'عصير',sku:'A',baseQuantity:240,currentSaleUnitPriceInMinorUnits:0}]}];
 const html=renderToStaticMarkup(createElement(SupplierReceiptItemsPreview,{items:[physical],displayLines})).replace(/<[^>]+>/g,'');
 assert.match(html,/عصير — 10 طرد/);assert.doesNotMatch(html,/240 باكيت/);
 const failure=renderToStaticMarkup(createElement(SupplierReceiptItemsPreview,{items:[physical],error:'قراءة غير متاحة'}));
 assert.match(failure,/تعذر عرض كميات السند/);assert.doesNotMatch(failure,/10 طرد|240/);
});
test('trial A exact inverse preserves every delivered source byte and rejects current or restored mutation',()=>{
 for(const [file,pin]of Object.entries(trialOwnerAPins) as [string,{added?:boolean}][]){
  const current=readFileSync(file,'utf8').replaceAll('\r\n','\n'),restored=sourceBeforeTrialOwnerA(file,current);
  assert.throws(()=>sourceBeforeTrialOwnerA(file,current+'\nvoid unapproved;\n'));
  if(pin.added)assert.equal(restored,null);else{
   const baseline=execFileSync('git',['show','4795e70e40b0462100e92fe5006b61cd62df1b9d:'+file],{encoding:'utf8',maxBuffer:32*1024**2}).replaceAll('\r\n','\n');
   assert.equal(restored,baseline);assert.throws(()=>sourceBeforeTrialOwnerA(file,baseline+'\nvoid unapproved;\n'));
  }
 }
 assert.equal(execFileSync('git',['diff','--name-only','4795e70e40b0462100e92fe5006b61cd62df1b9d','d7779f56dc0bdfe77091bb4881cbae4ad50ced3a','--','supabase/migrations'],{encoding:'utf8'}).trim(),'');
});
test('trial A frozen SDK proof retains every accepted source and real query behind exact209 inverse',async()=>{
 const current=await inventoryBeforeParcel209(),proof=JSON.parse(readFileSync('docs/operations/TABLE_ACCESS_AFTER_TRIAL_A.json','utf8'));
 const state=JSON.parse(readFileSync('docs/agent/project-state.json','utf8'));
 assert.equal(state.currentTableReadinessEvidence,'docs/operations/TABLE_ACCESS_AFTER_214_TELEGRAM_FORMAT.json');
 assert.equal(state.migrationCeiling,214);assert.deepEqual(current.sources,proof.sourceHashes);
 assert.deepEqual(verifyProbeCoverage(current,proof.results),proof.coverage);
 assert.equal(proof.results.length,148);assert.ok(proof.results.every((r:{sqlstate:string|null})=>r.sqlstate===null));
 assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);assert.equal(proof.managedAccess,false);
 assert.equal(proof.trialAReceiptSearch.ok,true);assert.equal(proof.trialAReceiptSearch.realPostgrest,true);
 assert.equal(proof.trialAReceiptSearch.matchingOutsideFirstPage,true);assert.equal(proof.trialAReceiptSearch.zeroWrites,true);
});
