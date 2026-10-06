import {test, expect} from './isolated-test';

// UI presentation only. Financial truth is proven separately by the real 001-130/131 RPC runner.
const report = {
  success: true, generatedAt: '2026-10-06T08:00:00Z',
  period: {dateFrom: '2026-10-06', dateTo: '2026-10-06', branchId: 'phase6-branch', branchName: 'فرع الاختبار'},
  sales: {grossSalesInMinorUnits: 11000, returnEntitlementInMinorUnits: 5000,
    netSalesInMinorUnits: 6000, refundsInMinorUnits: 1000, debtReductionInMinorUnits: 4000,
    replacementCostInMinorUnits: 2333, restockRecoveryInMinorUnits: 2000,
    aftercareAdjustedMarginInMinorUnits: -333, cogsInMinorUnits: 6000,
    grossProfitInMinorUnits: 4000, netProfitInMinorUnits: -333,
    collectedInMinorUnits: 6000, outstandingInMinorUnits: 1000, discountInMinorUnits: 0},
  cashFlow: {cashCollectedInMinorUnits: 0, cliqCollectedInMinorUnits: 6000,
    cashRefundedInMinorUnits: 1000, cliqRefundedInMinorUnits: 0,
    cashNetFlowInMinorUnits: -1000, cliqNetFlowInMinorUnits: 6000},
  balances: {customerDueInMinorUnits: 1000}, expenses: {totalInMinorUnits: 0}, inventory: {}, purchases: {}, inventoryMovements: {},
};
const debtOrder = {id: 'debt-order', order_number: 'P6-001', customer_name: 'عميل الاختبار',
  total_in_minor_units: 11000, amount_paid_in_minor_units: 6000, amount_due_in_minor_units: 1000};

test('التقرير بسيط، والتكلفة في تفاصيل؛ الدقة ثلاثية والربح السالب محفوظ', async ({page}) => {
  await page.route('**/rest/v1/rpc/get_operational_business_report', route => route.fulfill({json: report}));
  await page.goto('/e2e/phase6-package-a-harness.html');
  const main = page.locator('main');
  await expect(main.locator(':scope > section > article')).toHaveCount(9);
  for (const label of ['المبيعات', 'المرتجعات', 'صافي المبيعات', 'المقبوض — كاش', 'المقبوض — CliQ', 'المصاري المرجّعة', 'الذمم', 'المصاريف', 'الربح']) {
    await expect(main.locator(':scope > section').getByText(label, {exact: true})).toBeVisible();
  }
  const details = page.getByTestId('report-details');
  await expect(details).not.toHaveAttribute('open', '');
  await expect(main.getByText('تكلفة الاستبدال', {exact: true})).not.toBeVisible();
  const profit = main.locator(':scope > section > article').filter({has: page.getByText('الربح', {exact: true})});
  const signed = (-0.333).toLocaleString('ar-JO', {minimumFractionDigits: 3, maximumFractionDigits: 3});
  await expect(profit).toContainText(signed);
  await details.locator('summary').click();
  await expect(main.getByText('تكلفة الاستبدال', {exact: true})).toBeVisible();
  await expect(main.getByText('استرجاع التكلفة', {exact: true})).toBeVisible();
  await expect(main.getByText('ذمم الموردين', {exact: true})).toBeVisible();
});

test('لا يعرض التقرير القديم الناقص كأرقام صحيحة', async ({page}) => {
  await page.route('**/rest/v1/rpc/get_operational_business_report', route => route.fulfill({json: {...report, cashFlow: undefined}}));
  await page.goto('/e2e/phase6-package-a-harness.html');
  await expect(page.getByText(/بيانات التقرير غير مكتملة/)).toBeVisible();
  await expect(page.locator('main')).toHaveCount(0);
});

test('سند القبض Cash/CliQ فقط ومرجع CliQ مطلوب؛ البحث الخالي ليس ذممًا صفرًا', async ({page}) => {
  let submitted = 0;
  await page.route('**/rest/v1/rpc/record_customer_order_payment_once', route => { submitted++; return route.fulfill({json: {success: true}}); });
  await page.route('**/rest/v1/rpc/get_customer_outstanding_orders_page', route => {
    const search = route.request().postDataJSON().p_search;
    return route.fulfill({json: {orders: search ? [] : [debtOrder], total_count: search ? 0 : 1}});
  });
  await page.goto('/e2e/phase6-package-a-harness.html?kind=payments');
  const method = page.locator('select').nth(1);
  await expect(method.locator('option')).toHaveCount(2);
  expect(await method.locator('option').evaluateAll(options => options.map(o => (o as HTMLOptionElement).value))).toEqual(['cash', 'cliq']);
  await method.selectOption('cliq');
  await expect(page.getByPlaceholder('رقم مرجع CliQ')).toHaveAttribute('required', '');
  await page.getByRole('button', {name: 'حفظ سند القبض وتحديث الذمة'}).click();
  expect(submitted).toBe(0);
  await page.getByPlaceholder('ابحث برقم الطلب أو العميل أو الهاتف').fill('غير موجود');
  await expect(page.getByText('لا توجد نتائج لهذا البحث', {exact: true})).toBeVisible();
  await expect(page.getByText('لا توجد ذمم مستحقة', {exact: true})).not.toBeVisible();
  await page.getByRole('button', {name: 'مسح البحث'}).click();
  await expect(method).toBeVisible();
});

test('حالة المنتجات لا تدّعي التحديث قبل انتهاء القراءة', async ({page}) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/rest/v1/rpc/get_admin_product_page', async route => {
    await held;
    await route.fulfill({json: {products: [], total_count: 0, page: 1, page_size: 24, metrics: {}}});
  });
  await page.goto('/e2e/phase6-package-a-harness.html?kind=products');
  await expect(page.getByText('جاري تحديث المنتجات…', {exact: true})).toBeVisible();
  await expect(page.getByText('متصل ومحدّث من Supabase', {exact: true})).not.toBeVisible();
  release();
  await expect(page.getByText('متصل ومحدّث من Supabase', {exact: true})).toBeVisible();
});

test('تفصيل الإغلاق يعرض كميات مختلطة دون نسبة مال المرتجع كله للتلف', async ({page}) => {
  await page.route('**/rest/v1/rpc/get_cash_shift_closing_report', route => route.fulfill({json: {
    success: true, shift: {shiftNumber: 'P6-SHIFT', status: 'open'},
    sales: {}, collections: {}, outflows: {cashRefundsInMinorUnits: 1000}, reconciliation: {},
    returnBreakdown: [{refundMethod: 'cash', stockDisposition: 'damaged', count: 1, amountInMinorUnits: 1000}],
    returnQuantityBreakdown: [{eventId: 'event', productId: 'product', productName: 'المكوّن المختلط',
      sellableQuantity: 1, defectQuantity: 2, customerDamageQuantity: 3}],
  }}));
  await page.goto('/e2e/phase6-package-a-harness.html?kind=closing');
  await expect(page.getByText('تفصيل كميات المرتجعات', {exact: true})).toBeVisible();
  await expect(page.getByText('قابل للبيع: 1 · عيب/غير قابل للبيع: 2 · ضرر عميل: 3', {exact: true})).toBeVisible();
  // Event-level refund money stays visible next to the quantity detail.
  await expect(page.getByText('كاش • تالفة (1)', {exact: true})).toBeVisible();
  await expect(page.getByText(/المبلغ المسترد محسوب لكل مرتجع/)).toBeVisible();
});
