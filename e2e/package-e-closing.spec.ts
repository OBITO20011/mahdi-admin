import {test,expect} from './isolated-test';

// Presentation/service fixture only. Actual before/after DB/public RPC proof is
// independently exercised by run-package-e-closing-runtime.mjs.
function fixture(modern:boolean,historicalCard=0){return {
  success:true,generatedAt:'2026-10-07T10:00:00Z',snapshotStatus:'immutable',
  shift:{id:'92600000-0000-4000-8000-000000000500',branchName:'فرع الاختبار',status:'closed',
    startTime:'2026-10-07T06:00:00Z',endTime:'2026-10-07T10:00:00Z',
    cashSalesInMinorUnits:21000-historicalCard,cliqSalesInMinorUnits:18000,cardSalesInMinorUnits:historicalCard},
  sales:{orderCount:11,posOrderCount:9,websiteOrderCount:2,packageCount:6,uniqueProductCount:3,
    grossSalesInMinorUnits:modern?67000:39000,refundsInMinorUnits:12000,netSalesInMinorUnits:modern?52000:27000,
    ...(modern?{salesDefinitionVersion:133,collectedDirectSalesInMinorUnits:39000,
      initialReceiptPaymentsInMinorUnits:6000,initialReceiptCashInMinorUnits:0,initialReceiptCliqInMinorUnits:6000,
      creditSalesInMinorUnits:22000,returnEntitlementInMinorUnits:15000,debtReductionInMinorUnits:3000}:{})},
  collections:{count:2,cashInMinorUnits:3000,cliqInMinorUnits:6000,
    ...(modern?{initialPaymentsInMinorUnits:6000,initialCashInMinorUnits:0,initialCliqInMinorUnits:6000}:{})},
  outflows:{cashRefundsInMinorUnits:11000,cliqRefundsInMinorUnits:1000},
  reconciliation:{totalInflowsInMinorUnits:48000,totalOutflowsInMinorUnits:59700,netMovementInMinorUnits:-11700,
    netCliqMovementInMinorUnits:23000,openingCashInMinorUnits:200000,expectedCashInMinorUnits:197300-historicalCard,
    actualCashInMinorUnits:197300-historicalCard,cashDiscrepancyInMinorUnits:0,isBalanced:true},
  expenseBreakdown:[],returnBreakdown:[],
};}
test('new closing shows first receipts and sale-time credit without moving CliQ or double-counting inflows',async({page})=>{
  await page.route('**/rest/v1/rpc/get_cash_shift_closing_report',route=>route.fulfill({json:fixture(true)}));
  await page.goto('/e2e/package-e-closing-harness.html');
  const row=(label:string)=>page.getByText(label,{exact:true}).locator('..');
  await expect(row('إجمالي المبيعات')).toContainText('67.000');
  await expect(row('المرتجعات')).toContainText('15.000');
  await expect(row('مبالغ مرجعة')).toContainText('12.000');
  await expect(row('تخفيض دين')).toContainText('3.000');
  await expect(row('صافي المبيعات')).toContainText('52.000');
  await expect(row('مبيعات كاش')).toContainText('21.000');
  await expect(row('مبيعات CliQ')).toContainText('18.000');
  await expect(row('آجل متبقي')).toContainText('22.000');
  await expect(row('دفعات أولى عند الاستلام (مسجلة ضمن سندات القبض)')).toContainText('6.000');
  await expect(page.getByText(/منها 6\.000.*دفعات أولى عند البيع/u)).toContainText('CliQ: 6.000');
  await expect(row('إجمالي الداخل')).toContainText('48.000');
  await expect(row('الكاش المتوقع')).toContainText('197.300');
  await expect(row('فرق الصندوق')).toContainText('0.000');
});
test('historical snapshot does not invent initial-payment or credit fields',async({page})=>{
  await page.route('**/rest/v1/rpc/get_cash_shift_closing_report',route=>route.fulfill({json:fixture(false)}));
  await page.goto('/e2e/package-e-closing-harness.html');
  await expect(page.getByText('إجمالي المبيعات',{exact:true}).locator('..')).toContainText('39.000');
  await expect(page.getByText('مبيعات بطاقة',{exact:true})).toHaveCount(0);
  await expect(page.getByText(/Invalid Date/u)).toHaveCount(0);
  await expect(page.getByText('آجل متبقي',{exact:true})).toHaveCount(0);
  await expect(page.getByText('توزيع استحقاق المرتجعات',{exact:true})).toHaveCount(0);
  await expect(page.getByText('دفعات أولى عند الاستلام (مسجلة ضمن سندات القبض)',{exact:true})).toHaveCount(0);
  await expect(page.getByText(/منها .*دفعات أولى عند البيع/u)).toHaveCount(0);
  await expect(page.getByText('إجمالي الداخل',{exact:true}).locator('..')).toContainText('48.000');
});
test('historical nonzero card sales remain visible without inventing modern credit or changing gross/inflows',async({page})=>{
  await page.route('**/rest/v1/rpc/get_cash_shift_closing_report',route=>route.fulfill({json:fixture(false,7000)}));
  await page.goto('/e2e/package-e-closing-harness.html');
  await expect(page.getByText('مبيعات بطاقة',{exact:true}).locator('..')).toContainText('7.000');
  await expect(page.getByText('مبيعات كاش',{exact:true}).locator('..')).toContainText('14.000');
  await expect(page.getByText('إجمالي المبيعات',{exact:true}).locator('..')).toContainText('39.000');
  await expect(page.getByText('إجمالي الداخل',{exact:true}).locator('..')).toContainText('48.000');
  await expect(page.getByText('الكاش المتوقع',{exact:true}).locator('..')).toContainText('190.300');
  await expect(page.getByText('آجل متبقي',{exact:true})).toHaveCount(0);
  await expect(page.getByText(/Invalid Date/u)).toHaveCount(0);
});
