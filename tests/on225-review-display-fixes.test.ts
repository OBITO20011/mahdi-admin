import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reportProfitSteps} from '../src/utils/reportProfitSteps';
import {RECENT_RETURNED_ORDERS_LIMIT,matchesReturnedOrderSearch} from '../src/utils/returnedOrdersSearch';

const source=(path:string)=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8').replaceAll('\r\n','\n');
const fils=(value:number)=>Math.round(value*1000);
const signed=(step:{amount:number;sign:string})=>step.sign==='+'||step.sign==='='?fils(step.amount):-fils(step.amount);

test('review A: goods cost is the server COGS; damage and replacement get their own line', () => {
  // Codex reproduction: no sales, COGS 0, damage 5.000, no expenses, profit −5.000.
  const damageOnly=reportProfitSteps({grossSales:0,returnEntitlement:0,netSales:0,cogs:0,netProfit:-5},0)!;
  assert.equal(damageOnly.find(step=>step.key==='cost')!.amount,0);
  const adjustments=damageOnly.find(step=>step.key==='adjustments')!;
  assert.deepEqual([adjustments.label,adjustments.sign,adjustments.amount],['التلف والاستبدال (صافي)','−',5]);
  // A recovered past loss adds back to profit: «+», never a negative cost line.
  const recovered=reportProfitSteps({grossSales:10,returnEntitlement:0,netSales:10,cogs:6,netProfit:5},0)!;
  const back=recovered.find(step=>step.key==='adjustments')!;
  assert.deepEqual([back.sign,back.amount],['+',1]);
  assert.ok(recovered.every(step=>step.amount>=0||step.key==='profit'));
  // Every case still adds up exactly to the server profit.
  for(const steps of [damageOnly,recovered,reportProfitSteps({grossSales:0.3,returnEntitlement:0.1,netSales:0.2,cogs:0.1,netProfit:0.067},0.033)!]){
    const profit=steps.at(-1)!;
    assert.equal(steps.slice(0,-1).reduce((sum,step)=>sum+signed(step),0),fils(profit.amount));
  }
  // The view prints the sign for every line except the first one.
  const view=source('src/features/reports/ReportsCenterView.tsx');
  assert.match(view,/reportProfitSteps\(report\.sales, report\.expenses\.total\)/);
  assert.match(view,/\{step\.key==='gross'\?'':`\$\{step\.sign\} `\}/);
});

test('review B: shift profit is labelled as the whole day and re-read with the shift report', () => {
  const summary=source('src/features/shifts/ShiftOwnerSummary.tsx');
  assert.match(summary,/ربح يوم الوردية/);
  assert.doesNotMatch(summary,/>ربح الوردية</);
  assert.match(summary,/وليس هذه الوردية وحدها/);
  assert.match(summary,/أكثر الأصناف ربحاً في يوم الوردية/);
  assert.match(summary,/\},\[shift\.id,shift\.branchId,days\.from,days\.to,report\.generatedAt\]\);/);
});

test('review C + E: sales history net box states it ignores filters, in general Arabic', () => {
  const line=source('src/features/salesHistory/SalesReturnsLine.tsx');
  assert.match(line,/ولا تتأثر بالفلاتر أو البحث/);
  assert.match(line,/filtered\?'font-bold text-nw-warn':'text-nw-muted'/);
  for(const colloquial of ['انعمل','بهالأيام','حسب تقرير نفس الأيام'])assert.ok(!line.includes(colloquial),colloquial);
  const history=source('src/features/salesHistory/SalesHistoryView.tsx');
  assert.match(history,/filtered=\{method!=='all'\|\|source!=='all'\|\|customer\.trim\(\)!==''\|\|number\.trim\(\)!==''\}/);
});

test('review D: returned tab states its latest-30 limit and follows the search', () => {
  const row={orderNumber:'NW-2026-0042',customerName:'محمد أحمد'};
  assert.equal(matchesReturnedOrderSearch(row,''),true);
  assert.equal(matchesReturnedOrderSearch(row,'  nw-2026-0042 '),true);
  assert.equal(matchesReturnedOrderSearch(row,'أحمد'),true);
  assert.equal(matchesReturnedOrderSearch(row,'0099'),false);
  const badge=source('src/features/orders/OrderReturnBadge.tsx');
  assert.match(badge,/تعرض آخر \{RECENT_RETURNED_ORDERS_LIMIT\} فاتورة فقط/);
  assert.match(badge,/للفاتورة الأقدم ابحث برقمها في «كل الطلبات»/);
  assert.match(badge,/rows\.filter\(\(row\) => matchesReturnedOrderSearch\(row, searchQuery\)\)/);
  assert.match(badge,/fetchRecentReturnedOrders\(RECENT_RETURNED_ORDERS_LIMIT\)/);
  // The screen's stated limit is the service default; the read itself is unchanged.
  assert.equal(RECENT_RETURNED_ORDERS_LIMIT,30);
  assert.match(source('src/services/supabase/orderReturnStates.service.ts'),/fetchRecentReturnedOrders\(limit = 30\)/);
  assert.match(source('src/features/orders/OrdersCenterView.tsx'),/<ReturnedAfterSaleOrders onOpen=\{openOrderDetails\} refreshKey=\{listLoadVersion\} searchQuery=\{debouncedSearchQuery\} \/>/);
});
