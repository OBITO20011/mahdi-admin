import assert from 'node:assert/strict';
import {executeInput} from '../operations/build-empty-supabase.mjs';
import {returnPayload215} from './aftercare215-return-cases.mjs';
import {raceAftercare215} from './aftercare215-race.mjs';

export async function verifySealedReturn215(c, pass) {
  const {q, j, rpc, key, setup, stock, facts, fingerprint, fail, sql, json} = c;
  const preview = payload => rpc(`preview_admin_sales_return_v2(${j(payload)})`, undefined, undefined, undefined, true);
  const writer = (payload, p, identity = key()) => `settle_admin_sales_return_v2(${j(payload)},${q(identity)},${q(p.previewFingerprint)})`;
  const legacy = (s, payload, identity = key()) => `settle_admin_sales_return_v1(${q(s.sale.orderId)},${q(identity)},${j(payload.items)},${j(payload.physicalSources)},${q(payload.reason)},'cash',NULL,NULL)`;
  for (const supplierHeld of [false, true]) {
    const s = await setup(), payload = returnPayload215(s, {supplierId: supplierHeld ? c.supplier : null}), p = await preview(payload), f = await facts();
    const identity = key(), call = writer(payload, p, identity), result = await rpc(call);
    assert.equal(result.success, true); assert.equal(result.moneyRefundInMinorUnits, '9000');
    assert.equal(result.goodQuantity, 11); assert.equal(result.badQuantity, 1);
    assert.equal((await stock(s.pid)).quantity, 111);
    assert.equal((await facts()).sales.netProfitInMinorUnits - f.sales.netProfitInMinorUnits, supplierHeld ? -3000 : -3500);
    const stable = await fingerprint(); assert.deepEqual(await rpc(call), {...result, idempotentReplay: true}); assert.deepEqual(await fingerprint(), stable);
    await fail(writer({...payload, reason: 'سبب آخر بنفس الهوية'}, p, identity), /IDEMPOTENCY_CONFLICT/);
    pass(`sealed return ${supplierHeld ? 'supplier' : 'final'}: matches preview,11good1bad, exact money/profit, immutable whole-operation replay`);
  }

  const mixed = await setup({kind: 'base', soldQuantity: 5}), payload = returnPayload215(mixed, {quantity: 2, good: 1}), p = await preview(payload), k = key();
  const f = await facts(), result = await rpc(writer(payload, p, k));
  assert.equal(result.entitlementInMinorUnits, '2000'); assert.equal((await stock(mixed.pid)).quantity, 101);
  assert.equal((await facts()).sales.netProfitInMinorUnits - f.sales.netProfitInMinorUnits, -1500);
  await fail(legacy(mixed, payload), /ALLOCATION_MISMATCH/);
  await fail(writer({...payload, physicalSources: [{...payload.physicalSources[0], sellable_restock_quantity: 2, defect_non_sellable_quantity: 0}]}, p, k), /IDEMPOTENCY_CONFLICT/);
  const stable = await fingerprint(); await rpc(writer(payload, p, k)); assert.deepEqual(await fingerprint(), stable);
  pass('new v2 atomically classifies independent packets1good1bad; old public route still refuses same shape despite remaining stock/capacity; changed identity rejected');

  const old = await setup({kind: 'base', soldQuantity: 5}), oldPayload = returnPayload215(old, {quantity: 1, good: 1}), oldKey = key();
  await rpc(legacy(old, oldPayload, oldKey));
  const oldPreview = await preview(oldPayload);
  await fail(writer(oldPayload, oldPreview, oldKey), /LEGACY_KEY_CONFLICT/);
  pass('pre-existing legacy return cannot acquire a retroactive v2 envelope or supplier tail with the same key');

  const a = await setup(), b = await setup();
  const sale = await rpc(`create_pos_sale_v2(${q(c.warehouse)},${q(c.branch)},${q(c.id(401))},'تجربة مصيرين','cash',${j([a, b].map(s => ({commercial_line_kind: 'legacy_single_sku_parcel', product_id: s.pid, parcel_quantity: 1, units_per_parcel: 12, price_authority: 'server_catalog', line_discount_in_minor_units: 0})))},0,18000,${q(key())})`);
  const rows = await json(`SELECT jsonb_agg(jsonb_build_object('id',id,'productId',product_id) ORDER BY product_id) FROM public.order_items WHERE order_id=${q(sale.orderId)};`);
  const parts = rows.map(row => returnPayload215({sale, item: row.id, pid: row.productId}));
  const subset = {...parts[0], items: parts.flatMap(x => x.items), physicalSources: parts.flatMap(x => x.physicalSources),
    supplierAssignments: [{sourceKind: 'base_order_item', sourceId: rows[0].id, supplierId: c.supplier}]};
  const beforeSubset = await facts(), subsetResult = await rpc(writer(subset, await preview(subset)));
  assert.equal(subsetResult.moneyRefundInMinorUnits, '18000');
  assert.equal((await facts()).sales.netProfitInMinorUnits - beforeSubset.sales.netProfitInMinorUnits, -6500);
  assert.equal(await sql(`SELECT count(*) FROM public.supplier_replacement_cases claim JOIN public.inventory_damage_events d ON d.id=claim.damage_event_id WHERE d.return_event_id=${q(subsetResult.returnId)};`), '1');
  assert.equal(await sql(`SELECT count(*) FROM public.inventory_damage_events WHERE return_event_id=${q(subsetResult.returnId)};`), '2');
  pass('one atomic refund with two bad SKUs can hold only the chosen supplier packet; other bad packet stays final, no forced all-defects claim');

  const stale = await setup({kind: 'base', soldQuantity: 3, paymentMethod: 'debt'}), stalePayload = returnPayload215(stale, {quantity: 1, good: 1, method: 'cash'}), sp = await preview(stalePayload);
  await rpc(`record_customer_order_payment(${q(stale.sale.orderId)},2500,'cash',NULL,'تحصيل بين المعاينة والتأكيد')`);
  await fail(writer(stalePayload, sp), /PREVIEW_CHANGED/);
  const cliq = await setup({paymentMethod: 'cliq'}), noReference = returnPayload215(cliq), np = await preview(noReference);
  await fail(writer(noReference, np), /FIELDS_REQUIRED/);
  pass('changed debt/collection invalidates the sealed preview; unresolved CliQ reference is a named refusal before context/financial writes');

  const concurrent = await setup(), concurrentPayload = returnPayload215(concurrent), cp = await preview(concurrentPayload), call = writer(concurrentPayload, cp);
  const loser = await raceAftercare215(c)(call, call);
  assert.equal(loser.code, 0, loser.stderr); assert.equal(JSON.parse(loser.stdout.trim().split('\n').at(-1)).idempotentReplay, true);
  assert.equal((await stock(concurrent.pid)).quantity, 111);
  pass('two actual sessions on sealed return key block then replay one refund/restock; one physical capacity consumption');

  const rollback = await setup(), rp = returnPayload215(rollback, {supplierId: c.supplier}), rpreview = await preview(rp);
  await sql(`CREATE FUNCTION public.tb215_return_failure() RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public,pg_temp AS $$ BEGIN RAISE EXCEPTION 'TB215_RETURN_INJECTED_FAILURE'; END $$;CREATE TRIGGER tb215_return_failure BEFORE INSERT ON public.aftercare215_return_results FOR EACH ROW EXECUTE FUNCTION public.tb215_return_failure();`);
  try {
    const before = await fingerprint(), r = await executeInput(c.executor, c.auth(`SELECT public.${writer(rp, rpreview)};`));
    assert.notEqual(r.code, 0); assert.match(r.stderr, /TB215_RETURN_INJECTED_FAILURE/);
    assert.deepEqual(await fingerprint(), {...before, sequences: {...before.sequences, inventory_movement_mutation_seq: before.sequences.inventory_movement_mutation_seq + 1}});
  } finally { await sql('DROP TRIGGER tb215_return_failure ON public.aftercare215_return_results;DROP FUNCTION public.tb215_return_failure();'); }
  assert.equal((await stock(rollback.pid)).quantity, 100);
  pass('failure after actual refund/restock/supplier hold rolls all money/debt/stock/claims/envelopes back; only one existing113 technical stamp consumed');
}
