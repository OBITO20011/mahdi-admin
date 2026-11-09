import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCashShiftClosingReport} from '../src/services/supabase/expenses-shifts.service';
import {isSalesOnlyShiftReport} from '../src/services/supabase/salesOnlyShiftReport';
import {liteClosingDocument,liteShiftId} from '../e2e/sales-only-phase2-closing.fixture';

test('lite immutable shift document maps genuine cash/CliQ/refund/withdrawal fields without fabricated full report sections',()=>{
 const report=parseCashShiftClosingReport(liteClosingDocument,liteShiftId);assert.ok(isSalesOnlyShiftReport(report));
 assert.equal(report.shift.expectedCash,22.5);assert.equal(report.shift.actualCash,22.5);assert.equal(report.shift.cashDiscrepancy,0);
 assert.equal(report.shift.cashRefunds,2);assert.equal(report.shift.cliqRefunds,1);assert.equal(report.shift.cashExpenses,1.5);
 assert.equal(report.shift.ownerWithdrawals,2.5);assert.equal(report.shift.ownerWithdrawalReturns,.5);assert.equal(report.netMovementInMinorUnits,20000);
 assert.equal(report.orderCount,1);assert.equal(report.returnEntitlementInMinorUnits,4000);assert.equal(report.snapshotStatus,'immutable');
 assert.doesNotMatch(JSON.stringify(report),/profit|cogs|inventory|salesDefinitionVersion|salesDetailStatus/);
});
test('wrong or incomplete lite snapshots are rejected instead of becoming successful zero-valued full reports',()=>{
 const base=liteClosingDocument;
 for(const patch of [{shiftId:'other'},{summary:{...base.summary,expectedCashInMinorUnits:undefined}},{summary:{...base.summary,cashRefundsInMinorUnits:0}},
  {summary:{...base.summary,actualCashInMinorUnits:null}},{summary:{...base.summary,ownerWithdrawalsInMinorUnits:'2500'}},
  {reconciliation:{...base.reconciliation,netMovementInMinorUnits:20001}},{sales:[...base.sales,...base.sales]},{returns:null}])assert.throws(()=>parseCashShiftClosingReport({...base,...patch},liteShiftId),/SHIFT-01/);
});
