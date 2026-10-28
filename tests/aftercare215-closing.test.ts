import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {exchangeClosingCredit215} from '../src/utils/exchangeClosing215';
import {cashReportFixture} from '../e2e/package-f-cash.fixture';
import {trialDOrder} from '../e2e/trial-d-receipt.fixture';
import {OrderCommercialSummary} from '../src/features/orders/OrderCommercialSummary';
import type {ShiftClosingReport} from '../src/types';
const report215=()=>({...structuredClone(cashReportFixture),sales:{...cashReportFixture.sales,salesDefinitionVersion:215,internalExchangeCreditInMinorUnits:'9000',grossSalesInMinorUnits:1101000,returnEntitlementInMinorUnits:28000}});
test('215 closing preserves gross/return decomposition with exact internal credit and no cash inflow',()=>{
  const payload=report215();assert.equal(exchangeClosingCredit215(payload),'9000');assert.deepEqual(payload.shift,cashReportFixture.shift);assert.equal(exchangeClosingCredit215(cashReportFixture),undefined);
  for(const patch of [{internalExchangeCreditInMinorUnits:9000},{internalExchangeCreditInMinorUnits:'9001'},{grossSalesInMinorUnits:1101001},{returnEntitlementInMinorUnits:28001},{netSalesInMinorUnits:1073001}])assert.throws(()=>exchangeClosingCredit215({...payload,sales:{...payload.sales,...patch}}));
  assert.throws(()=>exchangeClosingCredit215({...payload,collections:{...payload.collections,initialPaymentsInMinorUnits:1}}));
});
test('215 actual closing service retains all modern133 detail fields for215 and exact internal credit',async()=>{
  const js=ts.transpileModule(readFileSync('src/services/supabase/expenses-shifts.service.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  let payload:unknown=report215();const exports:Record<string,(...a:unknown[])=>Promise<ShiftClosingReport>>={};
  runInNewContext(js,{exports,require:(name:string)=>{
    if(name==='../../utils/exchangeClosing215')return{exchangeClosingCredit215};
    if(name==='../../lib/supabase')return{isSupabaseConfigured:true,supabase:{rpc:async()=>({data:payload,error:null})}};throw Error(name);
  }});
  const report=await exports.fetchCashShiftClosingReportFromSupabase('shift');assert.equal(report.sales.salesDefinitionVersion,215);assert.equal(report.sales.internalExchangeCreditInMinorUnits,'9000');assert.equal(report.sales.creditSales,58);assert.equal(report.sales.returnEntitlement,28);assert.equal(report.collections.initialPayments,0);assert.equal(report.shift.totalCashSales,734);
  payload=cashReportFixture;const old=await exports.fetchCashShiftClosingReportFromSupabase('shift');assert.equal(old.sales.salesDefinitionVersion,133);assert.equal(old.sales.internalExchangeCreditInMinorUnits,undefined);
});
test('215 invoice commercial summary uses saved exact funding and separates the actual difference',()=>{
  const order={...structuredClone(trialDOrder),paymentMethod:'exchange_credit' as const,items:[trialDOrder.items[0]],discount:0,deliveryFee:0,
    exchangeFunding:{internalCreditInMinorUnits:'9007199254740993',newTotalInMinorUnits:'9007199254740993',moneyReceivedInMinorUnits:'0',moneyRefundInMinorUnits:'0',differenceMethod:null}};
  const html=renderToStaticMarkup(React.createElement(OrderCommercialSummary,{order}));assert.match(html,/9,007,199,254,740\.993/u);assert.match(html,/مقابل التبديل/u);assert.match(html,/فرق المال: 0\.000/u);assert.doesNotMatch(html,/15\.000/u);
  const missing=renderToStaticMarkup(React.createElement(OrderCommercialSummary,{order:{...order,exchangeFunding:undefined}}));assert.match(missing,/غير مكتمل/u);assert.doesNotMatch(missing,/الإجمالي/u);
});
