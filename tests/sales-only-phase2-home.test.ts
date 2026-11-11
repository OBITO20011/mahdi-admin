import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseSalesOnlyHome} from '../src/services/supabase/salesOnlyHome.service';
import {liteHomeDocument} from '../e2e/sales-only-phase2-home.fixture';
import {posFixtureIds} from '../e2e/package-f-pos.fixture';
test('same Home gets a distinct cost-free DTO;year/month boundary seven days,all payment methods and unknown-field projection',()=>{
 for(const today of ['2026-11-01','2027-01-01']){
  const v=liteHomeDocument(today),actual=parseSalesOnlyHome({...v,cost:'PRIVATE',summary:{...v.summary,monthProfitInMinorUnits:500},secret:'PRIVATE'},posFixtureIds.branch);
  assert.equal(actual.summary.todaySalesInMinorUnits,12500);assert.equal(actual.summary.todayCollections?.totalInMinorUnits,8000);assert.equal(actual.sevenDaySales.at(-1)?.date,today);
  assert.doesNotMatch(JSON.stringify(actual),/PRIVATE|Profit|stock|cost/);
  for(const patch of [{branchId:'other'},{accountingTracked:true},{financialFactsAvailable:false},{summary:{...v.summary,todaySalesInMinorUnits:0}},{summary:{...v.summary,activeProductsCount:-1}},{sevenDaySales:[...v.sevenDaySales].reverse()}])assert.throws(()=>parseSalesOnlyHome({...v,...patch},posFixtureIds.branch),/HOME-01/);
 }
});
test('new home reuses one union-period report;does not read stock/cost or write existing ledger',()=>{
 const sql=readFileSync('docs/design/sales-only-phase2/simple-home.sql','utf8');
 assert.match(sql,/public.lite1_business_report2\(p_branch_id,LEAST\(month_start,today-6\),today\)/);assert.match(sql,/sales_lite1.owner\(\)/);assert.match(sql,/direction='incoming'/);
 assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|ALTER)\b|inventory|cogs|wac|cost_price/iu);
});
