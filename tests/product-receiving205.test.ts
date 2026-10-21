import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {parsePurchaseContexts,parseReceiptDisplay,purchasePriceRise,quoteForQuantity,receivingSaleQuote,type LastPurchaseQuote} from '../src/utils/receivingPurchaseContext';
import {formatWholesaleInventory,summarizeFlavorFamilyInventory} from '../src/utils/inventoryFormatter';
import {isContentUnitOption} from '../src/utils/unitLabels';
import {receiving205Pins,sourceBeforeProductReceiving205,inventoryBeforeProductReceiving205} from '../scripts/audit/source-before-product-receiving205.mjs';
import {assert205History} from '../scripts/operations/frankfurt-owner-upgrade205.mjs';
import {verifyProbeCoverage} from '../scripts/audit/table-access-probes.mjs';
const read=(f:string)=>readFileSync(f,'utf8').replaceAll('\r\n','\n');
const quote:LastPurchaseQuote={receiptId:'receipt',receiptNumber:'GRN-205',source:'direct',receivedAt:'2026-10-20T08:00:00Z',supplierId:null,supplierName:null,grossInMinorUnits:100000,baseQuantity:200,baseUnitName:'باكيت'};
test('old saved packet packaging displays parcels;physical/base quantities and no-package basis stay exact',()=>{
  const display=formatWholesaleInventory(203,10,'باكيت','باكيت');assert.equal(display.cartonFormatted,'20 طرد + 3 باكيتات');assert.equal(display.cartons,20);assert.equal(display.remainingPieces,3);assert.equal(display.totalPiecesFormatted,'(203 باكيت)');
  assert.equal(formatWholesaleInventory(3,1,'كرتونة','قنينة').cartonFormatted,'3 قناني');
  const family=[{onHandQuantity:10,reservedQuantity:0,availableQuantity:10,unitsPerPackage:10,purchasePackage:'باكيت',unit:'باكيت'},{onHandQuantity:20,reservedQuantity:0,availableQuantity:20,unitsPerPackage:10,purchasePackage:'كرتونة',unit:'باكيت'}];
  assert.equal(summarizeFlavorFamilyInventory(family).hasCompatiblePackaging,true);
  assert.equal(summarizeFlavorFamilyInventory([family[0],{...family[1],unitsPerPackage:24}]).hasCompatiblePackaging,false);
  assert.equal(isContentUnitOption({code:'PARCEL',nameAr:'طرد'}),false);
  assert.equal(isContentUnitOption({code:'CTN',nameAr:'كرتونة'}),false);
  assert.equal(isContentUnitOption({code:'PKT',nameAr:'باكيت'}),true);
  assert.equal(isContentUnitOption({code:'SACK',nameAr:'شوال'}),true);
});
test('last purchase is rational gross/base and preserves zero quote;no history differs from invalid/missing data',()=>{
  const parsed=parsePurchaseContexts({products:[{productId:'water',lastPurchase:quote},{productId:'new',lastPurchase:null}]},['water','new']);assert.deepEqual(parsed.water,quote);assert.equal(parsed.new,null);
  assert.equal(quoteForQuantity(quote,10),5000);assert.equal(quoteForQuantity({...quote,grossInMinorUnits:1000,baseQuantity:24},24),1000);assert.equal(quoteForQuantity({...quote,grossInMinorUnits:0},10),0);
  for(const bad of [{products:[]},{products:[{productId:'other',lastPurchase:quote}]},{products:[{productId:'water',lastPurchase:{...quote,baseQuantity:0}}]},{products:[{productId:'water',lastPurchase:{...quote,grossInMinorUnits:null}}]},{products:[{productId:'water',lastPurchase:quote},{productId:'water',lastPurchase:quote}]}])assert.throws(()=>parsePurchaseContexts(bad,['water']));
});
test('price-rise comparison uses the same physical basis across24/40 and never WAC or packaging size as price authority',()=>{
  const q={...quote,grossInMinorUnits:12000,baseQuantity:24};assert.equal(purchasePriceRise(q,20000,40,{grossInMinorUnits:24000,baseQuantity:40}),null);assert.equal(purchasePriceRise(q,12000,24,{grossInMinorUnits:14400,baseQuantity:24}),null);
  assert.deepEqual(purchasePriceRise(q,22000,40,{grossInMinorUnits:24000,baseQuantity:40}),{oldPrice:20000,newPrice:22000,oldProfit:4000,newProfit:2000,isLoss:false});assert.equal(purchasePriceRise(q,25000,40,{grossInMinorUnits:24000,baseQuantity:40})?.isLoss,true);assert.equal(purchasePriceRise(q,25000,40,null)?.newProfit,null);
});
test('receipt parser retains stored commercial basis;missing sale stays null,never synthetic zero',()=>{
  const line={id:'line',kind:'legacy_single_sku_parcel',commercialQuantity:20,unitsPerParcel:10,baseUnitName:'باكيت',baseQuantity:200,grossInMinorUnits:100000,lineDiscountInMinorUnits:0,netInMinorUnits:100000,acquisitionInMinorUnits:100000,components:[{itemId:'i',productId:'p',nameAr:'مياه',sku:'W',baseQuantity:200,currentSaleUnitPriceInMinorUnits:null}]};
  assert.equal(parseReceiptDisplay({receiptId:'r',lines:[line]},'r')[0].components[0].currentSaleUnitPriceInMinorUnits,null);
  assert.throws(()=>parseReceiptDisplay({receiptId:'other',lines:[line]},'r'));assert.throws(()=>parseReceiptDisplay({receiptId:'r',lines:[{...line,baseQuantity:199}]},'r'));assert.throws(()=>parseReceiptDisplay({receiptId:'r',lines:[line,line]},'r'));
});
test('205 exact inverse restores entire accepted204 source before query parsing;extra statements cannot be normalized',async()=>{
  const historical=await inventoryBeforeProductReceiving205(),proof=JSON.parse(read('docs/operations/TABLE_ACCESS_AFTER_204.json'));
  assert.deepEqual(historical.sources,proof.sourceHashes);assert.deepEqual(verifyProbeCoverage(historical,proof.results),proof.coverage);
  for(const [file,pin]of Object.entries(receiving205Pins) as Array<[string,{before?:string;after:string;added?:boolean}]>){const current=read(file),restored=sourceBeforeProductReceiving205(file,current);assert.throws(()=>sourceBeforeProductReceiving205(file,current+'\nvoid 205;\n'),/(?:RECEIVING205|NAVIGATION206|CORRECTIONS207)_ENTIRE_CURRENT_FILE_CHANGED/u);if(pin.added)assert.equal(restored,null);else assert.equal(createHash('sha256').update(restored!).digest('hex'),pin.before);}
});
test('new205 readers are stable existing-role reads only;001-204 immutable and payload converters untouched',()=>{
  const sql=read('supabase/migrations/205_product_receiving_display_read_models.sql');assert.equal((sql.match(/CREATE OR REPLACE FUNCTION/gu)??[]).length,2);assert.equal((sql.match(/LANGUAGE plpgsql STABLE SECURITY DEFINER/gu)??[]).length,2);assert.equal((sql.match(/ARRAY\['owner','admin','manager','accountant','warehouse_keeper'\]/gu)??[]).length,2);assert.doesNotMatch(sql,/\b(?:INSERT INTO|UPDATE public\.|DELETE FROM|ALTER TABLE|CREATE TABLE)\b/u);
  const base='d2a3d14e3a2688152caba0acf8e32acaed2679a8';
  for(const f of ['src/utils/receivingV2.ts','src/utils/receivingCalculations.ts','src/services/supabase/purchases.service.ts','src/utils/productCalculations.ts'])assert.equal(read(f),execFileSync('git',['show',base+':'+f],{encoding:'utf8'}).replaceAll('\r\n','\n'));
  const state=JSON.parse(read('docs/agent/project-state.json'));assert.equal(state.migrationCeiling,207);assert.equal(state.migration205CanonicalLfSha256,createHash('sha256').update(sql).digest('hex').toUpperCase());
  assert.match(read('scripts/operations/frankfurt-owner-build.mjs'),/d810bf28e7f6aa89b954430f11ab2194da0748e4b93ce58ffb0bfac0444d1d7d/u);
});
test('205 upgrade requires complete ordered199..205 prefixes;no missing204 or lower gap backfill',()=>{
  const base=(JSON.parse(read('docs/operations/TABLE_ACCESS_AFTER_204.json')).manifest as string[]).filter(f=>Number(f.slice(0,3))<=199).map(f=>f.slice(0,3)),versions=[...base,'200','201','202','203','204','205'],reference={prefixes:{'199':{appliedVersions:base}},appliedVersions:versions};
  for(let n=161;n<=167;n++)assert.deepEqual(assert205History(versions.slice(0,n),reference),versions.slice(n));
  for(const bad of [[...base,'205'],[...base,'200','201','202','203','205'],[...versions,'206'],[...base,'152']])assert.throws(()=>assert205History(bad,reference));
});

test('stored parcel gross wins over rounded unit quote: sale1000/24 versus purchase1005 is loss5,not profit3',()=>{
 const sale=receivingSaleQuote({salePackagePrice:1,unitsPerSalePackage:24,retailPrice:0.042});assert.deepEqual(sale,{grossInMinorUnits:1000,baseQuantity:24});const rise=purchasePriceRise({...quote,grossInMinorUnits:1000,baseQuantity:24},1005,24,sale);assert.equal(rise?.newProfit,-5);assert.equal(rise?.oldProfit,0);assert.equal(rise?.isLoss,true);assert.deepEqual(receivingSaleQuote({salePackagePrice:1,unitsPerSalePackage:1,retailPrice:0.042}),{grossInMinorUnits:42,baseQuantity:1});
});
