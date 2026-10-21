import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {canUseSupplierReplacement,exactReplacementAmount,readReplacementCase,readReplacementResult} from '../src/utils/supplierReplacement';
import {parseCustomerCollections} from '../src/utils/customerCollections';
import type {OperationalBusinessReport} from '../src/types/reports';
const baseCase={id:'case',supplierId:'supplier',supplierName:'مورد',productId:'product',productName:'صنف',warehouseId:'warehouse',branchId:'branch',origin:'shop',quantity:10,commercialQuantity:2,unitsPerCommercialUnit:5,unitName:'طرد',baseUnitName:'باكيت',pendingQuantity:10,receivedQuantity:0,writtenOffQuantity:0,occurredAt:'2026-10-21T10:00:00Z',events:[]};
test('208 typed quantities are independent of optional exact owner values;commercial snapshot cannot drift',()=>{
 const staff=readReplacementCase(baseCase);assert.equal(staff.quantity,10);assert.ok(!('unitCostInMinorUnitsExact' in staff));
 const owner=readReplacementCase({...baseCase,unitCostInMinorUnitsExact:'0.333333',pendingValueInMinorUnitsExact:'3.333330'});assert.equal(owner.unitCostInMinorUnitsExact,'0.333333');
 for(const v of [{...baseCase,quantity:9},{...baseCase,pendingQuantity:11},{...baseCase,quantity:'10'},{...baseCase,unitCostInMinorUnitsExact:'0.333333'},
  {...baseCase,unitCostInMinorUnitsExact:0.333333,pendingValueInMinorUnitsExact:'3.333330'}])assert.throws(()=>readReplacementCase(v));
 for(const v of [null,1,'-1','NaN','1e3','0.0000001'])assert.throws(()=>exactReplacementAmount(v));
});
test('208 authoritative response must bind the exact action and durable request key before success is saved',()=>{
 const result={success:true,contractVersion:208,action:'receive',idempotencyKey:'sr208:exact',idempotent:true,operationId:'operation',cases:[baseCase]};
 assert.equal(readReplacementResult(result,'receive','sr208:exact').recovered,true);
 for(const changed of [{...result,action:'writeoff'},{...result,idempotencyKey:'sr208:other'},{...result,success:'true'},{...result,cases:[]}])assert.throws(()=>readReplacementResult(changed,'receive','sr208:exact'));
 assert.throws(()=>readReplacementResult({...result,action:'customer_return'},'customer_return','sr208:exact'));
});
test('208 role3 capabilities do not implicitly include admin/accountant/cashier',()=>{
 for(const role of ['owner','manager','warehouse_keeper'])assert.ok(canUseSupplierReplacement([role]));
 for(const role of ['admin','accountant','cashier','sales'])assert.equal(canUseSupplierReplacement([role]),false);
 assert.ok(canUseSupplierReplacement(['admin','warehouse_keeper']));
});
test('208 signed report contract validates gross-recovery-net and keeps201 negative rejection',async()=>{
 const source=ts.transpileModule(readFileSync('src/services/supabase/reports.service.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const sales=Object.fromEntries(['returnEntitlement','debtReduction','replacementCost','restockRecovery','aftercareAdjustedMargin','grossSales','netSales','refunds','cogs','grossProfit','netProfit','collected','outstanding','discount'].map(f=>[f+'InMinorUnits',0]));
 const cashFlow=Object.fromEntries(['cashCollected','cliqCollected','cashRefunded','cliqRefunded','cashNetFlow','cliqNetFlow'].map(f=>[f+'InMinorUnits',0]));
 const good={contractVersion:208,totalInMinorUnits:-60,additionalInMinorUnits:-60,alreadyIncludedInMinorUnits:0,grossInMinorUnits:0,recoveredInMinorUnits:60,
  reasons:[{code:'supplier_writeoff_reversal',count:1,quantity:1,amountInMinorUnits:-60,alreadyIncludedInMinorUnits:0,grossInMinorUnits:0,recoveredInMinorUnits:60}]};
 let damage:unknown=good;const exports:Record<string,(...args:unknown[])=>Promise<OperationalBusinessReport>>={};
 runInNewContext(source,{exports,require:(name:string)=>{
  if(name==='../../utils/customerCollections')return {parseCustomerCollections};
  if(name==='../../lib/supabase')return {isSupabaseConfigured:true,supabase:{rpc:async()=>({error:null,data:{success:true,sales:{...sales,damageLosses:damage},cashFlow,expenses:{totalInMinorUnits:0},balances:{customerDueInMinorUnits:0}}})}};
  if(name==='../../utils/receivingCalculations')return {minorUnitsToJod:(v:number)=>v/1000};throw Error(name);
 }});
 const read=()=>exports.fetchOperationalBusinessReportFromSupabase('branch','2026-10-21','2026-10-21');
 const result=(await read()).sales.damageLosses!;assert.equal(result.total,-0.06);assert.equal(result.recovered,0.06);
 for(const bad of [{...good,totalInMinorUnits:0},{...good,recoveredInMinorUnits:-1},{...good,reasons:[]},{...good,contractVersion:209},
  {...good,grossInMinorUnits:20,recoveredInMinorUnits:80},{...good,alreadyIncludedInMinorUnits:10,additionalInMinorUnits:-70},
  {...good,reasons:[{...good.reasons[0],amountInMinorUnits:0}]},{...good,contractVersion:201},{...good,contractVersion:undefined}]){
  damage=bad;await assert.rejects(read,/بيانات.*خسائر التلف/);
 }
});
