import { expect, test } from './isolated-test';

for (const source of ['create-direct', 'receive'] as const) {
  test(`225 ${source} reviews saved receipt prices without writing a price on dismiss`, async ({ page }) => {
    const calls: string[] = [];
    const receiptRpc = source === 'receive' ? 'receive_purchase_order_v2' : 'create_direct_supplier_receipt_v2';
    const purchase = {
      receiptId: '88888888-8888-4888-8888-000000002050', receiptNumber: 'GRN-225-PRIOR', source: 'direct',
      receivedAt: '2026-10-20T08:00:00Z', supplierId: null, supplierName: null,
      grossInMinorUnits: 100000, baseQuantity: 200, baseUnitName: 'باكيت',
    };
    await page.route('**/rest/v1/rpc/get_receiving_purchase_context', route => {
      const { p_product_ids } = route.request().postDataJSON() as { p_product_ids: string[] };
      return route.fulfill({ json: { products: p_product_ids.map(productId => ({ productId, lastPurchase: purchase })) } });
    });
    await page.route(`**/rest/v1/rpc/${receiptRpc}`, route => {
      calls.push('receipt');
      return route.fulfill({ json: {
        success: true, receipt_id: purchase.receiptId, receipt_number: 'GRN-225-SAVED',
        supplier_invoice_payable_total_in_minor_units: 5000, supplier_outstanding_balance_effect_in_minor_units: 5000,
      } });
    });
    await page.route('**/rest/v1/rpc/get_receipt_pricing_warnings225', route => {
      calls.push('warning');
      const { p_product_ids } = route.request().postDataJSON() as { p_product_ids: string[] };
      return route.fulfill({ json: p_product_ids.map(productId => ({
        productId, priceProductId: productId, name: 'عصير', unit: 'باكيت', parcelUnit: 'صندوق',
        unitPrice: 500, parcelPrice: 6000, originalUnitPrice: 1000, originalParcelPrice: null,
        parcelEnabled: false, wacInMinorUnitsExact: '800.000000', unitBelowCost: true, parcelBelowCost: false,
      })) });
    });
    await page.route('**/rest/v1/rpc/update_product_master_v*', route => {
      calls.push('price write');
      return route.fulfill({ status: 400, json: { code: 'P0001', message: 'UNEXPECTED_PRICE_WRITE' } });
    });

    await page.goto(`/e2e/package-f-purchasing-harness.html?purchase205=1&view=${source}`);
    const review = page.getByRole('region', { name: 'مراجعة أسعار البيع بعد الاستلام' });
    await expect(review).toHaveCount(0);
    if (source === 'create-direct') {
      await page.getByRole('textbox', { name: /ابحث/u }).first().fill('عصير');
      await page.locator('[data-receiving-product-result]').first().click();
      await page.getByRole('button', { name: 'حفظ واستلام البضاعة', exact: true }).click();
    } else {
      const row = page.locator('[data-receiving-line]').first();
      await row.getByRole('radio', { name: 'طرد', exact: true }).click();
      await row.getByLabel('كم طرد؟', { exact: true }).fill('1');
      await page.getByRole('button', { name: 'تأكيد الاستلام وزيادة المخزون', exact: true }).click();
    }

    await expect(review.getByRole('status')).toContainText('تم حفظ الاستلام');
    await expect(review).toContainText('0.500');
    await expect(review).toContainText('1.000');
    await expect(review).toContainText('0.800');
    await expect(review.getByRole('button', { name: 'استرجاع السعر الأصلي لـباكيت' })).toBeVisible();
    await review.getByRole('button', { name: 'إبقاؤه كما هو' }).click();
    await expect(review.getByRole('heading', { name: 'عصير' })).toHaveCount(0);
    await review.getByRole('button', { name: 'تم', exact: true }).click();
    await expect(review).toHaveCount(0);
    expect(calls).toEqual(['receipt', 'warning']);
  });
}
