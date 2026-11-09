import {readOperatingShiftReportWithRpc} from '../src/services/supabase/operatingShiftReport';
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCashShiftClosingReport} from '../src/services/supabase/expenses-shifts.service';
import {isSalesOnlyShiftReport} from '../src/services/supabase/salesOnlyShiftReport';
import {liteClosingDocument,liteShiftId,mixedClosingDocument} from '../e2e/sales-only-phase2-closing.fixture';

test('lite immutable shift document maps genuine cash/CliQ/refund/withdrawal fields without fabricated full report sections',()=>{
 const report=parseCashShiftClosingReport(liteClosingDocument,liteShiftId);assert.ok(isSalesOnlyShiftReport(report));
 assert.equal(report.shift.expectedCash,22.5);assert.equal(report.shift.actualCash,22.5);assert.equal(report.shift.cashDiscrepancy,0);
 assert.equal(report.shift.cashRefunds,2);assert.equal(report.shift.cliqRefunds,1);assert.equal(report.shift.cashExpenses,1.5);
 assert.equal(report.shift.ownerWithdrawals,2.5);assert.equal(report.shift.ownerWithdrawalReturns,.5);assert.equal(report.netMovementInMinorUnits,20000);
 assert.ok(!report.historyWithoutCost);assert.equal(report.orderCount,1);assert.equal(report.returnEntitlementInMinorUnits,4000);assert.equal(report.snapshotStatus,'immutable');
 assert.doesNotMatch(JSON.stringify(report),/profit|cogs|inventory|salesDefinitionVersion|salesDetailStatus/);
});
test('wrong or incomplete lite snapshots are rejected instead of becoming successful zero-valued full reports',()=>{
 const base=liteClosingDocument;
 for(const patch of [{shiftId:'other'},{summary:{...base.summary,expectedCashInMinorUnits:undefined}},{summary:{...base.summary,cashRefundsInMinorUnits:0}},
  {summary:{...base.summary,actualCashInMinorUnits:null}},{summary:{...base.summary,ownerWithdrawalsInMinorUnits:'2500'}},
  {reconciliation:{...base.reconciliation,netMovementInMinorUnits:20001}},{sales:[...base.sales,...base.sales]},{returns:null}])assert.throws(()=>parseCashShiftClosingReport({...base,...patch},liteShiftId),/SHIFT-01/);
});

test('mixed immutable full-shift snapshot has true refund money/count,not fabricated entitlement or profit',()=>{const report=parseCashShiftClosingReport(mixedClosingDocument,liteShiftId);assert.ok(isSalesOnlyShiftReport(report)&&report.historyWithoutCost);assert.equal(report.returnCount,2);assert.equal(report.returnMoneyInMinorUnits,3000);assert.equal(report.shift.cashRefunds,2);assert.equal(report.shift.expectedCash,22.5);assert.ok(!('returnEntitlementInMinorUnits' in report));for(const patch of [{returnCount:0},{returnMoneyInMinorUnits:3001},{orderCount:-1},{contractVersion:'unknown'},{historyWithoutCost:undefined}])assert.throws(()=>parseCashShiftClosingReport({...mixedClosingDocument,...patch},liteShiftId),/SHIFT-01/);});

test('shift reader only exact missing RPC permits219 fallback and keeps shiftidentity;malformed/role/network never fallback',async()=>{const calls:unknown[]=[];await readOperatingShiftReportWithRpc(async(name,args)=>{calls.push([name,args]);return name==='lite1_shift_closing2'?{data:null,error:{code:'PGRST202',message:'public.lite1_shift_closing2'},status:404}:{data:{},error:null};},liteShiftId);assert.deepEqual(calls,[['lite1_shift_closing2',{p_shift_id:liteShiftId}],['get_cash_shift_closing_report',{p_shift_id:liteShiftId}]]);for(const bad of [{data:{},error:null,status:200},{data:null,error:{code:'42501',message:'denied'},status:404},{data:null,error:{code:'PGRST202',message:'other'},status:404},{data:null,error:{code:'PGRST202',message:'lite1_shift_closing2'},status:500}]){let count=0;await readOperatingShiftReportWithRpc(async()=>{count++;return bad;},liteShiftId);assert.equal(count,1);}});
