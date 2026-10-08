import {test, expect} from './isolated-test';

const receiptId = '92600000-0000-4000-8000-000000009001';
const preview = {receiptId, receiptNumber: 'SR-1000', total: 1000000, payable: 1000000, paymentsTotal: 400000,
  supplierBalanceBefore: 600000, supplierBalanceAfter: 0,
  payments: [{id: 'payment', amount: 400000, method: 'cash', date: '2026-10-08T08:00:00Z', cashShiftId: 'shift', cashShiftStatus: 'closed'}]};

test('paid receipt confirmation includes authoritative payment/balances and closed shift; changed facts require another confirmation', async ({page}) => {
  let reads = 0, writes = 0;
  await page.route('**/rest/v1/rpc/preview_supplier_receipt_cancellation', route => {
    reads++;
    return route.fulfill({json: reads === 1 ? preview : {...preview, supplierBalanceBefore: 700000, supplierBalanceAfter: 100000}});
  });
  await page.route('**/rest/v1/rpc/cancel_supplier_receipt', route => {writes++; return route.fulfill({json: {success: false, error: 'اختبار الحد الفعلي'}});});
  await page.goto('/e2e/package-e-supplier-ux-harness.html');
  const section = page.getByRole('region', {name: 'الدفعات التي ستُعكس'});
  await expect(section).toContainText('400.000');
  await expect(section).toContainText('نقداً');
  await expect(section).toContainText('وردية مغلقة');
  await expect(section).toContainText('رصيد المورد قبل: 600.000');
  await expect(section).toContainText('رصيد المورد بعد: 0.000');
  const confirm = page.getByRole('button', {name: 'إلغاء السند وعكس دفعة 400.000'});
  await confirm.click();
  await expect(page.getByRole('alert')).toContainText('تغيّرت الدفعات');
  expect(writes).toBe(0);
  await expect(section).toContainText('رصيد المورد قبل: 700.000');
  await confirm.click();
  await expect.poll(() => writes).toBe(1);
});

test('failed confirmation read never allows cancellation', async ({page}) => {
  let writes = 0;
  await page.route('**/rest/v1/rpc/preview_supplier_receipt_cancellation', route => route.fulfill({status: 400, json: {message: 'معاينة غير متاحة'}}));
  await page.route('**/rest/v1/rpc/cancel_supplier_receipt', route => {writes++; return route.fulfill({json: {success: true}});});
  await page.goto('/e2e/package-e-supplier-ux-harness.html');
  await expect(page.getByRole('alert')).toContainText('معاينة غير متاحة');
  await expect(page.getByRole('button', {name: 'نعم، إلغاء السند'})).toBeDisabled();
  expect(writes).toBe(0);
});

test('PO actual cap rejection displays all three amounts and suggests maximum without automatic payment', async ({page}) => {
  await page.route('**/rest/v1/suppliers*', route => route.fulfill({json: [{id: '92600000-0000-4000-8000-000000009003', company_name: 'مورد الاختبار', is_active: true}]}));
  await page.route('**/rest/v1/rpc/get_purchase_orders_page', route => route.fulfill({json: {orders: [], total_count: 0}}));
  let writes = 0;
  await page.route('**/rest/v1/rpc/record_supplier_payment', route => {writes++; return route.fulfill({status: 400,
    json: {code: 'P0001', message: 'SUPPLIER_PO_PAYMENT_EXCEEDS_PAYABLE', details: JSON.stringify({payable: 1050, paid: 400, maxAllowed: 650})}});});
  await page.goto('/e2e/package-e-supplier-ux-harness.html?payment');
  const input = page.getByRole('spinbutton');
  await expect(input).toHaveValue('1');
  await page.getByRole('button', {name: 'تأكيد وطباعة سند الصرف'}).click();
  await expect(page.getByText(/المستحق الفعلي 1\.050/u)).toContainText('المدفوع 0.400');
  await expect(page.getByText(/الحد الأقصى المسموح الآن/u)).toContainText('0.650');
  await expect(input).toHaveValue('0.65');
  expect(writes).toBe(1);
});
