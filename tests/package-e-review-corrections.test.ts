import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import test from 'node:test';
import {parseSupplierCancellationPreview} from '../src/utils/supplierCancellationPreview';
import {supplierPaymentLimit} from '../src/utils/supplierPaymentLimit';

const preview = {receiptId: 'receipt', receiptNumber: 'SR-1000', total: 1000, payable: 1000, paymentsTotal: 400,
  supplierBalanceBefore: 600, supplierBalanceAfter: 0,
  payments: [{id: 'payment', amount: 400, method: 'cash', date: '2026-10-08T08:00:00Z', cashShiftId: 'shift', cashShiftStatus: 'closed'}]};
test('cancellation preview binds receipt, exact active payment list and signed supplier balances', () => {
  assert.deepEqual(parseSupplierCancellationPreview(preview, 'receipt'), preview);
  assert.equal(parseSupplierCancellationPreview({...preview, supplierBalanceBefore: -100, supplierBalanceAfter: -700}, 'receipt').supplierBalanceAfter, -700);
  for (const bad of [{...preview, receiptId: 'other'}, {...preview, paymentsTotal: 401}, {...preview, supplierBalanceAfter: 1},
    {...preview, payments: [...preview.payments, ...preview.payments], paymentsTotal: 800, supplierBalanceAfter: 400},
    {...preview, payments: [{...preview.payments[0], date: 'invalid'}]}, {...preview, payable: null}]) {
    assert.throws(() => parseSupplierCancellationPreview(bad, 'receipt'));
  }
});
test('authoritative PO limit reports actual payable, paid and proposal; inconsistent details fail closed', () => {
  const result = supplierPaymentLimit(JSON.stringify({payable: 1050, paid: 400, maxAllowed: 650}));
  assert.equal(result?.maxAllowedInMinorUnits, 650);
  assert.match(result?.error || '', /المستحق الفعلي 1\.050.*المدفوع 0\.400.*الحد الأقصى المسموح الآن 0\.650/u);
  for (const value of ['', 'null', JSON.stringify({payable: 1050, paid: 400, maxAllowed: 1000}),
    JSON.stringify({payable: -1, paid: 0, maxAllowed: 0})]) assert.equal(supplierPaymentLimit(value), null);
});
test('retired inventory V1 receiving cannot reappear in store/service/UI', () => {
  assert.equal(existsSync('src/features/inventory/ReceiveGoodsModal.tsx'), false);
  assert.doesNotMatch(readFileSync('src/stores/useAppStore.ts', 'utf8'), /\breceiveGoods\b|receiveInventoryInSupabase/u);
  assert.doesNotMatch(readFileSync('src/services/supabase/inventory.service.ts', 'utf8'), /receive_inventory|receiveInventoryInSupabase/u);
});
test('new narrow status and cancellation preview are explicitly authorized read-only projections', () => {
  const status = readFileSync('supabase/migrations/134_package_e_read_performance.sql', 'utf8').split('CREATE FUNCTION public.get_aftercare_integrity_status()')[1].split('$$;')[0];
  assert.match(status, /STABLE SECURITY DEFINER\s+SET search_path=public,pg_temp/u);
  assert.match(status, /ARRAY\['owner','admin','manager','accountant'\]/u);
  assert.doesNotMatch(status, /\b(?:INSERT|UPDATE|DELETE)\b/u);
  const confirmation = readFileSync('supabase/migrations/133_package_e_supplier_po_financial_consistency.sql', 'utf8').split('CREATE FUNCTION public.preview_supplier_receipt_cancellation(')[1].split('$$;')[0];
  assert.match(confirmation, /WHERE p\.supplier_receipt_id=p_receipt_id AND NOT p\.is_reversed/u);
  assert.doesNotMatch(confirmation, /\b(?:INSERT|UPDATE|DELETE)\b/u);
});
