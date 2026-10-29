import assert from 'node:assert/strict';
import {returnPayload215} from './aftercare215-return-cases.mjs';

// This stage proves the new pure reader against the existing financial writer.
// The sealed v2 coordinator and its mixed-independent-packet context follow.
export async function verifyReturnPreview215(c, pass) {
  const {q, j, rpc, key, setup, stock, facts, fingerprint, fail} = c;
  const preview = (payload, uid) => rpc(`preview_admin_sales_return_v2(${j(payload)})`, uid, undefined, undefined, true);
  const legacy = (s, payload, p) => rpc(`settle_admin_sales_return_v1(${q(s.sale.orderId)},${q(key())},${j(payload.items)},${j(payload.physicalSources)},${q(payload.reason)},${q(p.refundMethod)},${q(p.referenceNumber)},NULL)`);
  for (const paymentMethod of ['cash', 'cliq', 'debt']) {
    const s = await setup({paymentMethod}), payload = returnPayload215(s, {reference: paymentMethod === 'cliq' ? 'TB215-refund-local-reference' : null});
    const before = await fingerprint(), p = await preview(payload);
    assert.deepEqual(await fingerprint(), before, 'READ_ONLY_PREVIEW_ZERO_WRITES');
    assert.equal(p.canConfirm, true); assert.deepEqual(p.issues, []);
    assert.equal(p.entitlementInMinorUnits, '9000');
    assert.equal(p.debtReductionInMinorUnits, paymentMethod === 'debt' ? '9000' : '0');
    assert.equal(p.moneyRefundInMinorUnits, paymentMethod === 'debt' ? '0' : '9000');
    assert.equal(p.refundMethod, paymentMethod === 'debt' ? null : paymentMethod);
    assert.equal(p.goodQuantity, 11); assert.equal(p.badQuantity, 1);
    assert.equal(Number(p.goodRestockValueExact), 5500); assert.equal(Number(p.profitDeltaExactInMinorUnits), -3500);
    const f = await facts(), result = await legacy(s, payload, p);
    assert.equal(result.merchandiseEntitlementInMinorUnits, Number(p.entitlementInMinorUnits));
    assert.equal(result.debtReductionInMinorUnits, Number(p.debtReductionInMinorUnits));
    assert.equal(result.moneyRefundInMinorUnits, Number(p.moneyRefundInMinorUnits));
    assert.equal((await stock(s.pid)).quantity, 111);
    assert.equal((await facts()).sales.netProfitInMinorUnits - f.sales.netProfitInMinorUnits, -3500);
    pass(`read-only full-parcel preview ${paymentMethod}: default/refund/debt/11good1bad exactly match existing121/122 financial coordinator`);
  }
  const cliq = await setup({paymentMethod: 'cliq'}), cliqPayload = returnPayload215(cliq), cp = await preview(cliqPayload);
  assert.equal(cp.canConfirm, false);
  assert.ok(cp.issues.some(i => i.field === 'referenceNumber' && i.code === 'AFTERCARE215_REFUND_REFERENCE_REQUIRED'));
  assert.equal(cp.refundMethod, 'cliq'); assert.equal(cp.moneyRefundInMinorUnits, '9000');
  pass('CliQ default never reuses payment reference; missing refund reference has an explicit field-level refusal');

  const collected = await setup({kind: 'base', soldQuantity: 3, discount: 750, paymentMethod: 'debt'});
  await rpc(`record_customer_order_payment(${q(collected.sale.orderId)},2000,'cash',NULL,'تحصيل لاحق لفاتورة دين قائمة')`);
  const payload = returnPayload215(collected, {quantity: 1, good: 1});
  const incomplete = await preview(payload);
  assert.equal(incomplete.entitlementInMinorUnits, '750'); assert.equal(incomplete.debtReductionInMinorUnits, '250'); assert.equal(incomplete.moneyRefundInMinorUnits, '500');
  assert.ok(incomplete.issues.some(i => i.field === 'refundMethod'));
  const cashPayload = {...payload, refundMethod: 'cash'}, complete = await preview(cashPayload), result = await legacy(collected, cashPayload, complete);
  assert.equal(complete.canConfirm, true); assert.equal(result.debtReductionInMinorUnits, 250); assert.equal(result.moneyRefundInMinorUnits, 500);
  pass('existing full-debt sale then separate old collection: same-invoice250 reduced first, actual500 refund; no T-C upfront partial-sale implementation');

  const partial = await setup({kind: 'base', soldQuantity: 3, discount: 749});
  for (const amount of ['750', '750', '751']) {
    const payload = returnPayload215(partial, {quantity: 1, good: 1}), p = await preview(payload);
    assert.equal(p.entitlementInMinorUnits, amount);
    assert.equal((await legacy(partial, payload, p)).merchandiseEntitlementInMinorUnits, Number(amount));
  }
  pass('discounted2251/3 cumulative preview equals actual750+750+751; final packet takes exact remainder');

  const mixed = await setup({kind: 'base', soldQuantity: 3}), mixedPayload = returnPayload215(mixed, {quantity: 3, good: 2});
  const mp = await preview(mixedPayload); assert.equal(mp.goodQuantity, 2); assert.equal(mp.badQuantity, 1); assert.equal(mp.entitlementInMinorUnits, '3000');
  // Preserve old admission until the new private v2 context is in place.
  await fail(`settle_admin_sales_return_v1(${q(mixed.sale.orderId)},${q(key())},${j(mixedPayload.items)},${j(mixedPayload.physicalSources)},'مسار قديم لا يتوسع','cash',NULL,NULL)`, /ALLOCATION_MISMATCH/);
  pass('new preview classifies independent packets; original legacy route remains fail-closed for mixed packet inspection until v2 admission');

  const admin = c.id(215100), s = await setup(), p = await preview(returnPayload215(s), admin);
  for (const name of ['goodRestockValueExact', 'badLossInMinorUnits', 'supplierHeldInMinorUnits', 'profitDeltaExactInMinorUnits']) assert.equal(name in p, false);
  assert.equal(p.moneyRefundInMinorUnits, '9000');
  await fail(`preview_admin_sales_return_v2(${j(returnPayload215(s))})`, /صلاحية/, c.id(215101));
  await fail(`tb215_prepare_return_internal(${j(returnPayload215(s))})`, /permission denied/);
  await fail(`preview_admin_sales_return_v2(${j({...returnPayload215(s), unitCost: 0})})`, /RETURN_REQUEST_INVALID/);
  pass('admin sees only permitted settlement amounts; owner cost/profit omitted; manager/private helper/forged cost denied without writes');
}
