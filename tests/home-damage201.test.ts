import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {parseCustomerCollections} from '../src/utils/customerCollections';
import {renderToStaticMarkup} from 'react-dom/server';
import {DashboardHome} from '../src/features/dashboard/DashboardHome';
import {DamageLossReportSection} from '../src/features/reports/DamageLossReportSection';
import {homeFixture,shiftFixture} from '../e2e/package-f-home.fixture';
import {homeDamage201Pins,sourceBeforeHomeDamage201} from '../scripts/audit/source-before-home-damage201.mjs';
import {assertReady201Catalog} from '../scripts/operations/frankfurt-reference201.mjs';
import {assert201History} from '../scripts/operations/frankfurt-owner-upgrade201.mjs';
import type {OperationalBusinessReport} from '../src/types/reports';

type HomeProps=React.ComponentProps<typeof DashboardHome>;
const render=(data=homeFixture,overrides:Partial<HomeProps>={})=>renderToStaticMarkup(React.createElement(DashboardHome,{
 data,currentUserName:'مهدي',currentShift:shiftFixture,loading:false,error:null,realtimeConnected:false,
 onRefresh(){},onOrders(){},onAccounts(){},onInventory(){},onProducts(){},onShift(){},onSell(){},onReceive(){},onExpense(){},...overrides,
}));

test('201 Home displays canonical cash+CliQ;zero,missing,error and loading stay distinct',()=>{
 const data=structuredClone(homeFixture);data.summary.todayCashCollectedInMinorUnits=123456;data.summary.todayCliqCollectedInMinorUnits=54321;data.summary.todayCollections={cashInMinorUnits:123456,cliqInMinorUnits:54321,bankTransferInMinorUnits:0,chequeInMinorUnits:0,otherInMinorUnits:0,totalInMinorUnits:177777};
 const html=render(data);assert.ok(html.includes('177.777'));assert.ok(html.includes('123.456'));assert.ok(html.includes('54.321'));
 assert.ok(!html.includes('تفصيل كاش / CliQ غير متاح'));
 data.summary.todayCashCollectedInMinorUnits=0;data.summary.todayCliqCollectedInMinorUnits=0;data.summary.todayCollections={cashInMinorUnits:0,cliqInMinorUnits:0,bankTransferInMinorUnits:0,chequeInMinorUnits:0,otherInMinorUnits:0,totalInMinorUnits:0};
 assert.ok(render(data).includes('0.000'));
 delete data.summary.todayCashCollectedInMinorUnits;assert.ok(render(data).includes('تفصيل كاش / CliQ غير متاح'));
 assert.ok(render(data,{loading:true}).includes('جاري التحميل…'));assert.ok(render(data,{error:'فشل الاتصال'}).includes('تعذر تحميل المقبوض'));
 data.financialFactsAvailable=false;data.summary.todayCashCollectedInMinorUnits=123456;
 assert.ok(!render(data).includes('123.456'));
});

test('201 shift outflow evidence includes supplier,withdrawal,refund,expense and withdrawal return',()=>{
 const currentShift={...shiftFixture,cashSupplierPayments:91.234,ownerWithdrawals:44.321,ownerWithdrawalReturns:5.123};
 const html=render(homeFixture,{currentShift});
 for(const text of ['دفعات موردين من الدرج','-91.234','سحوبات المالك','-44.321','إرجاع سحوبات المالك','5.123','-12.000','-24.000','810.300'])assert.ok(html.includes(text),text);
 assert.ok(!html.includes('mt-4 hidden space-y-3 text-sm lg:block'));
});

test('201 damage report explains already-counted amount and additional deduction,including zero and missing capability',()=>{
 const losses={total:60,additional:0,alreadyIncluded:60,reasons:[{code:'customer_return_final',count:1,quantity:1,amount:60,alreadyIncluded:60}]};
 const html=renderToStaticMarkup(React.createElement(DamageLossReportSection,{losses}));
 for(const label of ['منها محتسب أصلاً','مرتجع زبون تالف نهائي','60.000','0.000','مرة واحدة'])assert.ok(html.includes(label),label);
 const empty=renderToStaticMarkup(React.createElement(DamageLossReportSection,{losses:{total:0,additional:0,alreadyIncluded:0,reasons:[]}}));
 assert.ok(empty.includes('لا توجد خسائر تلف مسجلة'));
 const missing=renderToStaticMarkup(React.createElement(DamageLossReportSection,{}));assert.ok(missing.includes('غير متاحة'));assert.ok(!missing.includes('0.000'));
});

test('201 actual dashboard service rejects malformed/missing collection numbers instead of zero',async()=>{
 const source=readFileSync('src/services/supabase/dashboard.service.ts','utf8');
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 let cash:unknown=0,cliq:unknown=1234;const exports:Record<string,(...args:unknown[])=>Promise<{success:boolean;data:{summary:{todayCashCollectedInMinorUnits:number|null;todayCliqCollectedInMinorUnits:number|null}}}>>={};
 runInNewContext(js,{exports,require:(name:string)=>{
  if(name==='../../utils/customerCollections')return {parseCustomerCollections};
  if(name==='../../lib/supabase')return {isSupabaseConfigured:true,supabase:{rpc:(rpc:string)=>{assert.equal(rpc,'get_home_dashboard');return {abortSignal:()=>Promise.resolve({data:{summary:{todayCashCollectedInMinorUnits:cash,todayCliqCollectedInMinorUnits:cliq}},error:null})};}}};
  if(name==='../../lib/async')return {runWithTimeout:(call:(signal:AbortSignal)=>unknown)=>call(new AbortController().signal),RequestTimeoutError:class extends Error{}};
  throw Error(name);
 }});
 for(const value of [undefined,null,'0',NaN,Infinity,1.25,Number.MAX_SAFE_INTEGER+1]){
  cash=value;const result=await exports.fetchHomeDashboardFromSupabase();assert.equal(result.success,true);assert.equal(result.data.summary.todayCashCollectedInMinorUnits,null);assert.equal(result.data.summary.todayCliqCollectedInMinorUnits,1234);
 }
 cash=0;cliq=-500;const valid=await exports.fetchHomeDashboardFromSupabase();assert.equal(valid.data.summary.todayCashCollectedInMinorUnits,0);assert.equal(valid.data.summary.todayCliqCollectedInMinorUnits,-500);
});

test('201 historical source inverse rejects all unrelated drift and restores exact approved whole files',()=>{
 for(const file of Object.keys(homeDamage201Pins)){
  const text=readFileSync(file,'utf8').replaceAll('\r\n','\n');const restored=sourceBeforeHomeDamage201(file,text);
  assert.throws(()=>sourceBeforeHomeDamage201(file,text+'\n// unapproved drift\n'));
  if(restored!==null)assert.equal(sourceBeforeHomeDamage201(file,restored),restored);
 }
});

test('201 report service maps exact losses and refuses incomplete or inconsistent damage capability',async()=>{
 const js=ts.transpileModule(readFileSync('src/services/supabase/reports.service.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const sales=Object.fromEntries(['returnEntitlement','debtReduction','replacementCost','restockRecovery','aftercareAdjustedMargin','grossSales','netSales','refunds','cogs','grossProfit','netProfit','collected','outstanding','discount'].map(f=>[f+'InMinorUnits',0]));
 const cashFlow=Object.fromEntries(['cashCollected','cliqCollected','cashRefunded','cliqRefunded','cashNetFlow','cliqNetFlow'].map(f=>[f+'InMinorUnits',0]));
 let damage:unknown=undefined;
 const exports:Record<string,(...args:unknown[])=>Promise<OperationalBusinessReport>>={};
 runInNewContext(js,{exports,require:(name:string)=>{
  if(name==='../../utils/customerCollections')return {parseCustomerCollections};
  if(name==='../../lib/supabase')return {isSupabaseConfigured:true,supabase:{rpc:async()=>({error:null,data:{success:true,sales:{...sales,...(damage===undefined?{}:{damageLosses:damage})},cashFlow,expenses:{totalInMinorUnits:0},balances:{customerDueInMinorUnits:0}}})}};
  if(name==='../../utils/receivingCalculations')return {minorUnitsToJod:(value:number)=>value/1000};
  throw Error(name);
 }});
 const read=()=>exports.fetchOperationalBusinessReportFromSupabase('branch','2026-10-19','2026-10-19');
 assert.equal((await read()).sales.damageLosses,undefined);
 const valid={totalInMinorUnits:180000,additionalInMinorUnits:120000,alreadyIncludedInMinorUnits:60000,reasons:[{code:'customer_return_final',count:1,quantity:1,amountInMinorUnits:60000,alreadyIncludedInMinorUnits:60000}]};
 damage=valid;const mapped=(await read()).sales.damageLosses!;assert.equal(mapped.total,180);assert.equal(mapped.additional,120);assert.equal(mapped.alreadyIncluded,60);assert.equal(mapped.reasons[0].amount,60);
 for(const invalid of [{},{...valid,totalInMinorUnits:0},{...valid,additionalInMinorUnits:null},{...valid,reasons:null},{...valid,reasons:[{...valid.reasons[0],quantity:'1'}]}]){
  damage=invalid;await assert.rejects(read,/بيانات خسائر التلف غير مكتملة/);
 }
});

test('201 upgrade history cannot skip200,backfill a gap or admit an unknown ceiling',()=>{
 const manifest=JSON.parse(readFileSync('docs/operations/TABLE_ACCESS_AFTER_201.json','utf8')).manifest as string[];
 const versions=manifest.map(n=>n.slice(0,3)),base=versions.slice(0,-1),reference={prefixes:{'200':{appliedVersions:base}},appliedVersions:versions};
 assert.deepEqual(assert201History(base,reference),['201']);assert.deepEqual(assert201History(versions,reference),[]);
 for(const history of [base.slice(0,-1),[...versions,'202'],[...base,'152'],[...base.slice(1),'201']])assert.throws(()=>assert201History(history,reference));
});

test('201 catalog rejects any client evidence grant,private helper exposure or disabled immutability/return trigger',()=>{
 const catalog=JSON.parse(readFileSync('docs/operations/TABLE_ACCESS_AFTER_201.json','utf8')).catalog;
 assertReady201Catalog(catalog);
 for(const role of ['PUBLIC','anon','authenticated']){
  const changed=structuredClone(catalog),table=changed.tables.find((t:{name:string})=>t.name==='inventory_damage_events');
  table.acl.push(`${role==='PUBLIC'?'':role}=r/postgres`);assert.throws(()=>assertReady201Catalog(changed));
 }
 for(const name of ['inventory_damage_period_totals_internal','capture_final_return_damage_internal','inventory_damage_reject_mutation_internal']){
  const changed=structuredClone(catalog),fn=changed.functions.find((f:{identity:string})=>f.identity.startsWith(name+'('));fn.acl.push('authenticated=X/postgres');assert.throws(()=>assertReady201Catalog(changed));
 }
 const changed=structuredClone(catalog);changed.triggers.find((t:{name:string})=>t.name==='capture_final_return_damage').enabled='D';assert.throws(()=>assertReady201Catalog(changed));
});
