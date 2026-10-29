import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {parseCustomerCollections} from '../src/utils/customerCollections';
import type {OperationalBusinessReport} from '../src/types/reports';
import {DamageLossReportSection} from '../src/features/reports/DamageLossReportSection';
test('215 report accepts signed already-counted warranty recovery without deducting it from profit again;208 rules stay strict',async()=>{
  const js=ts.transpileModule(readFileSync('src/services/supabase/reports.service.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const sales=Object.fromEntries(['returnEntitlement','debtReduction','replacementCost','restockRecovery','aftercareAdjustedMargin','grossSales','netSales','refunds','cogs','grossProfit','netProfit','collected','outstanding','discount'].map(f=>[f+'InMinorUnits',0]));sales.netProfitInMinorUnits=1000;
  const cashFlow=Object.fromEntries(['cashCollected','cliqCollected','cashRefunded','cliqRefunded','cashNetFlow','cliqNetFlow'].map(f=>[f+'InMinorUnits',0]));
  const valid={contractVersion:215,totalInMinorUnits:-500,additionalInMinorUnits:0,alreadyIncludedInMinorUnits:-500,grossInMinorUnits:0,recoveredInMinorUnits:500,
    reasons:[{code:'customer_replacement_inspected',count:1,quantity:0,amountInMinorUnits:-500,alreadyIncludedInMinorUnits:-500,grossInMinorUnits:0,recoveredInMinorUnits:500}]};
  let damage:unknown=valid;const exports:Record<string,(...args:unknown[])=>Promise<OperationalBusinessReport>>={};
  runInNewContext(js,{exports,require:(name:string)=>{
    if(name==='../../utils/customerCollections')return{parseCustomerCollections};
    if(name==='../../lib/supabase')return{isSupabaseConfigured:true,supabase:{rpc:async()=>({data:{success:true,sales:{...sales,damageLosses:damage},cashFlow,expenses:{totalInMinorUnits:0},balances:{customerDueInMinorUnits:0}},error:null})}};
    if(name==='../../utils/receivingCalculations')return{minorUnitsToJod:(v:number)=>v/1000};throw Error(name);
  }});
  const read=()=>exports.fetchOperationalBusinessReportFromSupabase('branch','2026-10-28','2026-10-28');
  const report=await read();assert.equal(report.sales.damageLosses?.contractVersion,215);assert.equal(report.sales.damageLosses?.total,-0.5);assert.equal(report.sales.netProfit,1);
  const html=renderToStaticMarkup(React.createElement(DamageLossReportSection,{losses:report.sales.damageLosses}));assert.match(html,/دون خصم ثانٍ/);assert.match(html,/صافي تكلفة استبدالات الزبائن/);assert.match(html,/صافي خسائر التلف/);
  for(const bad of [{...valid,totalInMinorUnits:-499},{...valid,contractVersion:208},{...valid,alreadyIncludedInMinorUnits:null},{...valid,reasons:[{...valid.reasons[0],amountInMinorUnits:-499}]}]){damage=bad;await assert.rejects(read);}
});
