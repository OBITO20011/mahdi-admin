import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reportProfitSteps} from '../src/utils/reportProfitSteps';

const source=(path:string)=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8').replaceAll('\r\n','\n');

test('item 15 design A: profit steps always add up to the server profit', () => {
  // Trial day 2026-11-20: 50.800 sales, 13.900 returns, 36.900 net, 0 expenses, 18.350 profit.
  const steps=reportProfitSteps({grossSales:50.8,returnEntitlement:13.9,netSales:36.9,netProfit:18.35},0)!;
  assert.deepEqual(steps.map(step=>step.key),['gross','returns','cost','expenses','profit']);
  assert.equal(steps.find(step=>step.key==='cost')!.amount,18.55);
  const fils=(value:number)=>Math.round(value*1000);
  const [gross,returns,cost,expenses,profit]=steps.map(step=>fils(step.amount));
  assert.equal(gross-returns-cost-expenses,profit);
  // Float-prone values stay exact; a loss stays negative.
  const loss=reportProfitSteps({grossSales:0.3,returnEntitlement:0.1,netSales:0.2,netProfit:-0.333},0.033)!;
  assert.equal(loss.find(step=>step.key==='cost')!.amount,0.5);
  assert.equal(loss.at(-1)!.amount,-0.333);
  assert.equal(reportProfitSteps({grossSales:Number.NaN,returnEntitlement:0,netSales:0,netProfit:0},0),null);
});

test('item 15 design A: profit and four numbers first, the rest folds away in general wording', () => {
  const view=source('src/features/reports/ReportsCenterView.tsx');
  const summary=view.slice(view.indexOf('data-testid="report-plain-summary"'),view.indexOf('<SupplierReplacementSummary ownerOnly />'));
  for(const label of ['صافي الربح','صافي المبيعات','الديون على الزبائن','صافي النقد (كاش)','صافي CliQ','المستحق للموردين','كيف تم حساب الربح'])assert.ok(summary.includes(label),label);
  for(const value of ['report.sales.netProfit','report.sales.netSales','report.balances.customerDue','report.cashFlow.cashNetFlow','report.cashFlow.cliqNetFlow','report.balances.supplierDue'])assert.ok(summary.includes(value),value);
  // No colloquial wording and no duplicated metric cards above the folds.
  for(const colloquial of ['ضل إلك','لسا','ديون لك','رجّعته','يعني:'])assert.ok(!summary.includes(colloquial),colloquial);
  assert.ok(!summary.includes('<MetricCard'));
  const folds=[...view.matchAll(/<details [^>]*data-report-details data-testid="([^"]+)"/g)].map(match=>match[1]);
  assert.deepEqual(folds,['report-top-products','report-stock-purchases','report-details']);
  const accountant=view.slice(view.indexOf('data-testid="report-details"'));
  assert.ok(accountant.includes('تفاصيل للمحاسب'));
  assert.ok(accountant.includes('<MetricCard label="الربح"'));
  // Printing opens every fold, not only the accountant one.
  assert.match(view,/querySelectorAll<HTMLDetailsElement>\('details\[data-report-details\]'\)/);
});
