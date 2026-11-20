import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {orderReturnBadgeLabel,orderReturnState,summarizeOrderReturns} from '../src/utils/orderReturnState';
import {canShowShiftOwnerSummary,shiftDurationLabel,shiftReportDays,topProfitProducts} from '../src/utils/shiftOwnerSummary';

const source=(path:string)=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('item 9: trial invoices get the right return badge', () => {
  // POS-20261120-000002: 1.900 returned in full, no delivery.
  const pos=orderReturnState('pos',1900,1900,0);
  assert.equal(pos?.kind,'full');
  assert.equal(orderReturnBadgeLabel(pos!),'مرتجع كامل');
  // ORD-20261120-91237: 12.000 of 14.000 (13.000 goods + 1.000 delivery) returned.
  const web=orderReturnState('web',12000,14000,1000);
  assert.equal(web?.kind,'partial');
  assert.equal(orderReturnBadgeLabel(web!),'مرتجع جزئي 12.000 من 14.000');
  // All goods back while only the delivery fee stays: full.
  assert.equal(orderReturnState('w2',13000,14000,1000)?.kind,'full');
  assert.equal(orderReturnState('none',0,14000,1000),null);
});

test('item 9: several settled events add up per order; unknown rows are ignored', () => {
  const states=summarizeOrderReturns(
    [{order_id:'a',merchandise_refund_amount_in_minor_units:'500'},{order_id:'a',merchandise_refund_amount_in_minor_units:1400},{order_id:7,merchandise_refund_amount_in_minor_units:5},{order_id:'b',merchandise_refund_amount_in_minor_units:-3}],
    [{id:'a',total_in_minor_units:'1900',delivery_fee_in_minor_units:0},{id:'b',total_in_minor_units:5000,delivery_fee_in_minor_units:0}],
  );
  assert.equal(states.get('a')?.returnedInMinorUnits,1900);
  assert.equal(states.get('a')?.kind,'full');
  assert.equal(states.has('b'),false);
});

test('item 9: badges, returned tab section and net line are wired read-only', () => {
  const service=source('src/services/supabase/orderReturnStates.service.ts');
  assert.match(service,/from\('sales_return_events'\)/);
  assert.match(service,/eq\('settlement_status', 'settled'\)/);
  assert.doesNotMatch(service,/\.(insert|update|upsert|delete|rpc)\(/);
  const center=source('src/features/orders/OrdersCenterView.tsx');
  assert.match(center,/returnState=\{returnStates\?\.get\(order\.id\)\}/);
  assert.match(center,/activeFilter === 'returned' && returnedExtra/);
  assert.match(source('src/features/orders/OrderDetailModal.tsx'),/<OrderReturnBadgeForOrder orderId=\{order\.id\} refreshKey=\{order\} \/>/);
  const history=source('src/features/salesHistory/SalesHistoryView.tsx');
  assert.match(history,/<OrderReturnBadge state=\{returnStates\.get\(row\.id\)\}\/>/);
  assert.match(history,/<SalesReturnsLine /);
  const line=source('src/features/salesHistory/SalesReturnsLine.tsx');
  assert.ok(line.includes('fetchAccountingReport(branchId,fromDate,toDate)'));
  assert.match(line,/destination:'reports'/);
});

test('item 10: orders centre shows canonical receivables, not Σ(total − paid)', () => {
  const center=source('src/features/orders/OrdersCenterView.tsx');
  assert.doesNotMatch(center,/ذمم الطلبات المكتملة/);
  assert.doesNotMatch(center,/summary\.due/);
  assert.match(center,/ديون لك على الزبائن: <MoneyText amount=\{receivables\} \/>/);
  const hook=source('src/features/orders/useOrdersReceivables.ts');
  assert.match(hook,/customerReceivablesInMinorUnits \/ 1000/);
  assert.match(hook,/destination: 'home'/);
});

test('item 17: shift days, duration and top profit items', () => {
  assert.deepEqual(shiftReportDays('2026-11-20T05:00:00Z','2026-11-20T18:00:00Z'),{from:'2026-11-20',to:'2026-11-20'});
  // Closes after Amman midnight: both days.
  assert.deepEqual(shiftReportDays('2026-11-20T15:00:00Z','2026-11-20T22:30:00Z'),{from:'2026-11-20',to:'2026-11-21'});
  assert.deepEqual(shiftReportDays('2026-11-20T05:00:00Z',undefined,new Date('2026-11-20T09:00:00Z')),{from:'2026-11-20',to:'2026-11-20'});
  assert.equal(shiftReportDays(undefined),null);
  assert.equal(shiftReportDays('not-a-date'),null);
  // Partial/legacy payloads (no start time or missing figures) keep the detailed report alone instead of crashing it.
  assert.equal(canShowShiftOwnerSummary({shift:{},sales:{},reconciliation:{}}),false);
  assert.equal(canShowShiftOwnerSummary({shift:{startTime:'2026-11-20T05:00:00Z'},sales:{netSales:1},reconciliation:{}}),false);
  assert.equal(canShowShiftOwnerSummary({shift:{startTime:'2026-11-20T05:00:00Z'},sales:{netSales:1},reconciliation:{netCliqMovement:0}}),true);
  assert.equal(shiftDurationLabel('2026-11-20T05:00:00Z','2026-11-20T07:30:00Z'),'2 ساعة و30 دقيقة');
  assert.equal(shiftDurationLabel('2026-11-20T05:00:00Z','2026-11-20T05:40:00Z'),'40 دقيقة');
  const top=topProfitProducts([{productName:'أ',sku:'1',profit:1},{productName:'ب',sku:'2',profit:5},{productName:'ج',sku:'3',profit:-2},{productName:'د',sku:'4',profit:3},{productName:'ه',sku:'5',profit:2}]);
  assert.deepEqual(top.map(item=>item.sku),['2','4','5']);
});

test('item 17: summary sits on top of the closing report; cash and CliQ stay apart', () => {
  const modal=source('src/features/shifts/ShiftClosingReportModal.tsx');
  assert.ok(modal.indexOf('<ShiftOwnerSummary report={report}/>')<modal.indexOf('<CashFlowSummary shift={report.shift}/>'));
  assert.match(modal,/آجل وقت البيع/);
  assert.doesNotMatch(modal,/آجل متبقي/);
  assert.match(modal,/كاش \+ CliQ معاً · للمحاسب/);
  const summary=source('src/features/shifts/ShiftOwnerSummary.tsx');
  assert.match(summary,/report\.sales\.netSales/);
  assert.match(summary,/reconciliation\.netCliqMovement/);
  assert.match(summary,/result\.report\.sales\.netProfit/);
  assert.match(summary,/topProfitProducts\(result\.report\.topProducts\)/);
});
