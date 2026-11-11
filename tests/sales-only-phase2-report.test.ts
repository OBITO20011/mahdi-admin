import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {simpleReportSource,simpleReportHunks} from '../scripts/testing/sales-only-phase2-report.mjs';
import {bridgedSource} from '../scripts/testing/sales-only-phase1-bridges.mjs';
import {parseSalesOnlyBusinessReport} from '../src/services/supabase/salesOnlyReport.service';
import {liteReportBranch,liteReportDocument} from '../e2e/sales-only-phase2-report.fixture';
test('parallel report applies exactly documented cost omissions/private return source to approved219 body;unknown bytes refused',()=>{
 const sql=readFileSync('supabase/migrations/219_home_financial_facts_narrow_projection.sql','utf8').replaceAll('\r\n','\n'),a=sql.indexOf('AS $$\n')+5,b=sql.indexOf('\n$$;',a)+1;
 const row={name:'phase6_financial_facts_before208_internal',signature:'phase6_financial_facts_before208_internal(uuid,timestamp with time zone,timestamp with time zone,text,boolean)',source:sql.slice(a,b)};
 let expected=bridgedSource(row);for(const [from,to] of simpleReportHunks)expected=expected.replace(from,()=>to);assert.equal(simpleReportSource(row),expected);assert.equal(simpleReportHunks.length,10);
 assert.doesNotMatch(expected,/cogs|wac|profit|cost_snapshot|inventory_damage_period/iu);assert.match(expected,/UNION ALL SELECT order_id,completed_at FROM sales_lite1.completions/);assert.match(expected,/FROM sales_lite1.returns r JOIN order_scope/);assert.match(expected,/phase42_assert_operational_return_evidence_internal/);
 assert.throws(()=>simpleReportSource({...row,source:row.source+'UNKNOWN'}));
 const wrapper=readFileSync('docs/design/sales-only-phase2/simple-report.sql','utf8');for(const value of ['sales_lite1.owner()','tb215_exchange_financial_adjustment_internal','tb215_assert_inspection_internal','tb215_assert_return_internal','Asia/Amman','REVOKE ALL'])assert.ok(wrapper.includes(value));
});
test('strict cost-free report keeps integer fils and projects only documented fields,never source customer/technical text',()=>{
 const value=liteReportDocument('2026-11-09'),parsed=parseSalesOnlyBusinessReport({...value,rawCustomer:'private name',sales:{...value.sales,cost:'private cost'},cashFlow:{...value.cashFlow,customerCollections:{...value.cashFlow.customerCollections,token:'private token'}}},liteReportBranch,'2026-11-09','2026-11-09');
 assert.equal(parsed.sales.netSalesInMinorUnits,10000);assert.equal(parsed.cashFlow.customerCollections.totalInMinorUnits,8000);assert.doesNotMatch(JSON.stringify(parsed),/private|token|cost|profit/);
 for(const patch of [{accountingTracked:true},{branchId:'other'},{sales:{...value.sales,refundsInMinorUnits:undefined}},{sales:{...value.sales,netSalesInMinorUnits:9999}},
  {cashFlow:{...value.cashFlow,cashNetFlowInMinorUnits:4001}},{dailyBreakdown:[...value.dailyBreakdown,...value.dailyBreakdown]}])assert.throws(()=>parseSalesOnlyBusinessReport({...value,...patch},liteReportBranch,'2026-11-09','2026-11-09'),/SREP-01/);
});
