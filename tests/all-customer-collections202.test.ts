import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {parseCustomerCollections,customerCollectionRows} from '../src/utils/customerCollections';
import {CustomerCollectionsSection} from '../src/features/reports/CustomerCollectionsSection';
import {DashboardHome} from '../src/features/dashboard/DashboardHome';
import {homeFixture,shiftFixture} from '../e2e/package-f-home.fixture';
import {financialReport} from '../e2e/package-f-financial.fixture';
import {collections202Pins,sourceBeforeCollections202} from '../scripts/audit/source-before-collections202.mjs';
import {assert202History} from '../scripts/operations/frankfurt-owner-upgrade202.mjs';
const amounts={cashInMinorUnits:123456,cliqInMinorUnits:54321,bankTransferInMinorUnits:98765,chequeInMinorUnits:12345,otherInMinorUnits:0,totalInMinorUnits:288887};
test('202 receipt parser validates all methods,total,safe integer and signed reversal;missing is unavailable',()=>{
 assert.equal(parseCustomerCollections(undefined),undefined);assert.deepEqual(parseCustomerCollections(amounts),amounts);
 assert.deepEqual(parseCustomerCollections({...amounts,cashInMinorUnits:-123456,totalInMinorUnits:41975}),{...amounts,cashInMinorUnits:-123456,totalInMinorUnits:41975});
 for(const bad of [null,[],{},0,{...amounts,totalInMinorUnits:0},{...amounts,chequeInMinorUnits:undefined},{...amounts,cliqInMinorUnits:'54321'},{...amounts,otherInMinorUnits:1.5},{...amounts,cashInMinorUnits:Number.MAX_SAFE_INTEGER+1}])assert.throws(()=>parseCustomerCollections(bad));
 assert.equal(customerCollectionRows(amounts).length,4);assert.equal(customerCollectionRows({...amounts,otherInMinorUnits:100}).length,5);
});
test('202 Home total includes transfer+cheque with exact once conversion and four-method disclosure',()=>{
 const data=structuredClone(homeFixture);data.summary.todayCollections=amounts;data.summary.todayCashCollectedInMinorUnits=amounts.cashInMinorUnits;data.summary.todayCliqCollectedInMinorUnits=amounts.cliqInMinorUnits;
 const render=()=>renderToStaticMarkup(React.createElement(DashboardHome,{data,currentUserName:'مهدي',currentShift:shiftFixture,loading:false,error:null,realtimeConnected:false,onRefresh(){},onOrders(){},onAccounts(){},onInventory(){},onProducts(){},onShift(){},onSell(){},onReceive(){},onExpense(){}}));
 for(const text of ['288.887','123.456','54.321','98.765','12.345','تحويل','شيك'])assert.ok(render().includes(text),text);
 data.summary.todayCashCollectedInMinorUnits=0;assert.ok(!render().includes('288.887'),'inconsistent capability is unavailable');
});
test('202 report four methods,legacy other,missing and successful zero remain explicit',()=>{
 const render=(collections=amounts)=>renderToStaticMarkup(React.createElement(CustomerCollectionsSection,{collections}));
 for(const text of ['288.887','123.456','54.321','98.765','12.345','الكاش داخل الدرج','صرف الشيك المستلم ليس قبضًا جديدًا'])assert.ok(render().includes(text),text);
 assert.ok(!render().includes('وسائل أخرى'));assert.ok(render({...amounts,otherInMinorUnits:100,totalInMinorUnits:288987}).includes('وسائل أخرى'));
 const missing=renderToStaticMarkup(React.createElement(CustomerCollectionsSection,{}));assert.ok(missing.includes('غير متاح'));assert.ok(!missing.includes('0.000'));
 const zero=Object.fromEntries(Object.keys(amounts).map(k=>[k,0])) as typeof amounts;assert.ok(render(zero).includes('0.000'));
});
test('202 actual report mapper keeps minor units;invalid present capability rejects whole report',async()=>{
 const js=ts.transpileModule(readFileSync('src/services/supabase/reports.service.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 let collections:unknown=amounts;const exports:Record<string,(...args:unknown[])=>Promise<{cashFlow:{customerCollections?:typeof amounts}}>>={};
 runInNewContext(js,{exports,require:(name:string)=>{
  if(name==='../../utils/customerCollections')return {parseCustomerCollections};
  if(name==='../../lib/supabase')return {isSupabaseConfigured:true,supabase:{rpc:async()=>({error:null,data:{...financialReport,cashFlow:{...financialReport.cashFlow,customerCollections:collections}}})}};
  if(name==='../../utils/receivingCalculations')return {minorUnitsToJod:(n:number)=>n/1000};throw Error(name);
 }});
 const read=()=>exports.fetchOperationalBusinessReportFromSupabase('branch','2026-10-19','2026-10-19');assert.deepEqual((await read()).cashFlow.customerCollections,amounts);
 collections=undefined;assert.equal((await read()).cashFlow.customerCollections,undefined);
 for(const invalid of [null,{...amounts,totalInMinorUnits:0},{...amounts,bankTransferInMinorUnits:null}]){collections=invalid;await assert.rejects(read,/المقبوض/);}
});
test('202 exact source inverse restores committed201 bytes and rejects unrelated changes',()=>{
 for(const file of Object.keys(collections202Pins)){
  const source=readFileSync(file,'utf8').replaceAll('\r\n','\n'),restored=sourceBeforeCollections202(file,source);
  assert.throws(()=>sourceBeforeCollections202(file,source+'\n// drift\n'));
  if(restored!==null){const old=execFileSync('git',['show','79b30bef201907d5a5f44d69db290f55e75102ab:'+file],{encoding:'utf8',windowsHide:true}).replaceAll('\r\n','\n');assert.equal(restored,old);}
 }
});
test('202 upgrade accepts every complete199..202 prefix only,never gap/backfill/skipping200',()=>{
 const manifest=JSON.parse(readFileSync('docs/operations/TABLE_ACCESS_AFTER_201.json','utf8')).manifest as string[],base=manifest.map(n=>n.slice(0,3)).filter(v=>Number(v)<=199),versions=[...base,'200','201','202'];
 const reference={prefixes:{'199':{appliedVersions:base}},appliedVersions:versions};
 for(let n=161;n<=164;n++)assert.deepEqual(assert202History(versions.slice(0,n),reference),versions.slice(n));
 for(const bad of [base.slice(1),[...base,'201'],[...base,'200','202'],[...versions,'203'],[...base,'152']])assert.throws(()=>assert202History(bad,reference));
});
