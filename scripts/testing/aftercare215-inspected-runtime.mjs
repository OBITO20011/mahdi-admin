import assert from 'node:assert/strict';

export async function verifyInspectedReplacement215(c, pass) {
  const {rpc, setup, stock, money, facts, fail, fingerprint, key, q, j, json, sql, supplier} = c;
  const preview = payload => rpc(`preview_inspected_sales_replacement_v2(${j(payload)})`, undefined, undefined, undefined, true);
  const writer = (payload, seal, k = key()) => `settle_inspected_sales_replacement_v2(${j(payload)},${q(k)},${q(seal)})`;
  for (const only of [false, true]) {
    const s = await setup({only}), beforeMoney = await money(), before = await facts();
    const unchanged = await fingerprint(), p = await preview(s.payload);
    assert.deepEqual(await fingerprint(), unchanged, 'PREVIEW_IS_ACTUALLY_READ_ONLY');
    assert.equal(p.issuedQuantity, 12); assert.equal(p.restockedQuantity, 11); assert.equal(p.badQuantity, 1);
    assert.equal(p.issuedCostInMinorUnits, '6000'); assert.equal(p.goodRecoveryInMinorUnits, '5500');
    assert.equal(p.profitDeltaInMinorUnits, '-500');
    const k = key(), call = writer(s.payload, p.previewFingerprint, k), result = await rpc(call);
    assert.equal(result.success, true); assert.equal(result.restockedQuantity, 11);
    assert.deepEqual(await stock(s.pid), {quantity: 99, wac: '500.000000', reserved: 0});
    const after = await facts();
    assert.equal(after.sales.netProfitInMinorUnits - before.sales.netProfitInMinorUnits, -500);
    assert.equal(after.sales.restockRecoveryInMinorUnits - before.sales.restockRecoveryInMinorUnits, 5500);
    assert.equal(after.sales.netSalesInMinorUnits, before.sales.netSalesInMinorUnits);
    assert.deepEqual(await money(), beforeMoney);
    const committed = await fingerprint();
    assert.deepEqual(await rpc(call), {...result, idempotentReplay: true});
    assert.deepEqual(await fingerprint(), committed);
    await fail(writer({...s.payload, items: [{...s.payload.items[0], goodQuantity: 10}]}, p.previewFingerprint, k), /IDEMPOTENCY_CONFLICT/);
    await fail(`settle_sales_replacement_v1(${q(s.sale.orderId)},${q(k)},${j([{sourceKind: 'base_order_item', sourceId: s.item, quantity: 12}])},'محتوى مختلف',NULL)`, /IDEMPOTENCY_CONFLICT/);
    pass(`owner parcel example ${only ? 'parcel-only' : 'regular'}: +11 good/-12 replacement, cost500, profit-500, no money, immutable replay`);
  }
  for (const good of [0, 12]) {
    const s = await setup({good}), before = await facts(), p = await preview(s.payload);
    await rpc(writer(s.payload, p.previewFingerprint));
    assert.equal((await stock(s.pid)).quantity, 100 - 12 + good);
    assert.equal((await facts()).sales.netProfitInMinorUnits - before.sales.netProfitInMinorUnits, -6000 + good * 500);
    pass(`explicit inspection all-${good === 0 ? 'bad' : 'good'} has exact stock/profit; no implicit all-bad default`);
  }
  const s = await setup({good: 10, supplierHeld: true}), before = await facts(), beforeMoney = await money(), p = await preview(s.payload);
  assert.equal(p.supplierHeldInMinorUnits, '1000'); assert.equal(p.profitDeltaInMinorUnits, '0');
  const result = await rpc(writer(s.payload, p.previewFingerprint));
  assert.equal(result.caseIds.length, 1); const caseId = result.caseIds[0];
  assert.equal(await sql(`SELECT quantity FROM supplier_replacement_cases WHERE id=${q(caseId)};`), '2');
  assert.equal((await stock(s.pid)).quantity, 98);
  assert.equal((await facts()).sales.netProfitInMinorUnits, before.sales.netProfitInMinorUnits);
  const receive = `execute_supplier_replacement_v1('receive',${j({caseId, quantity: 1, reason: 'وصل البديل من المورد'})},${q(key())})`;
  await rpc(receive);
  assert.equal((await stock(s.pid)).quantity, 99);
  assert.equal((await facts()).sales.netProfitInMinorUnits, before.sales.netProfitInMinorUnits);
  const reject = `execute_supplier_replacement_v1('writeoff',${j({caseId, quantity: 1, reason: 'رفض المورد الباكيت المتبقي'})},${q(key())})`;
  await rpc(reject);
  assert.equal((await stock(s.pid)).quantity, 99);
  assert.equal((await facts()).sales.netProfitInMinorUnits - before.sales.netProfitInMinorUnits, -500);
  assert.deepEqual(await money(), beforeMoney);
  const settled = await fingerprint(); await rpc(reject); assert.deepEqual(await fingerprint(), settled);
  pass('only two bad packets held, partial historical-cost receipt then one refusal; once-only loss, no drawer/debt');

  const narrow = await setup({only: true});
  const partialGood = {...narrow.payload, items: [{...narrow.payload.items[0], quantity: 1, goodQuantity: 1}]};
  await fail(`preview_inspected_sales_replacement_v2(${j(partialGood)})`, /WHOLE_SINGLE_SKU_PARCEL_REQUIRED/);
  const defective = {...narrow.payload, items: [{...narrow.payload.items[0], quantity: 1, goodQuantity: 0}]};
  const np = await preview(defective); await rpc(writer(defective, np.previewFingerprint));
  assert.equal((await stock(narrow.pid)).quantity, 99);
  await fail(`create_pos_sale_v2(${q(c.warehouse)},${q(c.branch)},${q(c.id(401))},'اختبار','cash',${j([{commercial_line_kind: 'base_unit', product_id: narrow.pid, base_quantity: 1, price_authority: 'server_catalog', line_discount_in_minor_units: 0}])},0,1000,${q(key())})`, /UNIT_SALE_FORBIDDEN/);
  pass('ordinary parcel/parcel-only exception remains defective-only same-SKU; good partial parcel and unit sale rejected with zero writes');

  const final = await setup(), fp = await preview(final.payload), beforeFinal = await facts();
  const finalResult = await rpc(writer(final.payload, fp.previewFingerprint));
  const leaf = await json(`SELECT to_jsonb(replacement_item_id) FROM public.aftercare215_inspection_items WHERE operation_id=${q(finalResult.operationId)};`);
  const candidates = await rpc(`get_aftercare_damage_candidates_v1(${q(final.sale.orderId)})`);
  assert.equal(candidates.candidates.length, 1); assert.equal(candidates.candidates[0].quantity, 1);
  const reclass = await rpc(`preview_aftercare_supplier_v1('replacement',${q(leaf)},${q(supplier)})`);
  const reclassified = await rpc(`execute_aftercare_supplier_v1('reclassify_replacement',${q(key())},${j({sourceId: leaf, supplierId: supplier, reason: 'تحويل الباكيت المعيب فقط للمورد', previewFingerprint: reclass.previewFingerprint})})`);
  assert.equal(reclassified.cases[0].quantity, 1);
  assert.equal((await facts()).sales.netProfitInMinorUnits, beforeFinal.sales.netProfitInMinorUnits);
  const noBad = await setup({good: 12}), noBadPreview = await preview(noBad.payload);
  await rpc(writer(noBad.payload, noBadPreview.previewFingerprint));
  assert.deepEqual((await rpc(`get_aftercare_damage_candidates_v1(${q(noBad.sale.orderId)})`)).candidates, []);
  pass('existing J5 reclassifies only one inspected bad packet; good11 never become supplier claim; all-good inspection has no damage candidate');

  const stale = await setup(), sp = await preview(stale.payload);
  await c.receive(stale.pid, 10, 750);
  await fail(writer(stale.payload, sp.previewFingerprint), /PREVIEW_CHANGED/);
  await fail(writer(stale.payload, '0'.repeat(64)), /PREVIEW_CHANGED/);
  await fail(`preview_inspected_sales_replacement_v2(${j({...stale.payload, cost: 0})})`, /REQUEST_INVALID/);
  await fail(`preview_inspected_sales_replacement_v2(${j({...stale.payload, items: [stale.payload.items[0], stale.payload.items[0]]})})`, /DUPLICATE_SOURCE/);
  assert.equal(await json(`SELECT count(*)::INTEGER FROM public.aftercare215_inspection_items WHERE good_quantity<0 OR bad_quantity<0;`), 0);
  pass('changed inventory preview, forged cost and duplicate physical source all refuse without any write');
}
