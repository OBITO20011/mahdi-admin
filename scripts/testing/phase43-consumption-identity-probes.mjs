import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Real coordinator fixture; corruption exists only in rollback-only transactions.
export async function verifyConsumptionIdentity({createParcelSale, runSql, json,
  literal, ownerClaims, productId, productBId}) {
  const sale = await createParcelSale();
  const costs = await json(`SELECT jsonb_agg(to_jsonb(p)) FROM products p
    WHERE id IN (${literal(productId)},${literal(productBId)});`, 'capture fixture costs');
  await runSql(`UPDATE products SET wac_cost_in_minor_units_exact=100,
    cost_price_in_minor_units=100 WHERE id IN (${literal(productId)},${literal(productBId)});`, 'equal issuance costs');
  const request = JSON.stringify(sale.components.map(c => ({sourceKind: 'parcel_component', sourceId: c.id, quantity: 1})));
  const key = `consumption-identity-${randomUUID()}`;
  const call = `public.settle_sales_replacement_v1(${literal(sale.orderId)},${literal(key)},${literal(request)}::jsonb,'Identity probe',NULL)`;
  const issued = await json(`${ownerClaims} SELECT ${call};`, 'issue two authoritative items');
  assert.equal(issued.success, true);
  for (const p of costs) await runSql(`UPDATE products SET
    wac_cost_in_minor_units_exact=${p.wac_cost_in_minor_units_exact},
    cost_price_in_minor_units=${p.cost_price_in_minor_units} WHERE id=${literal(p.id)};`, 'restore fixture pricing');
  const op = literal(issued.operationId);
  const items = await json(`SELECT jsonb_agg(id ORDER BY id) FROM sales_replacement_items WHERE operation_id=${op};`, 'authoritative identities');
  assert.equal(items.length, 2);
  const [a,b] = items.map(literal);
  const foreign = await createParcelSale();
  const foreignIssued = await json(`${ownerClaims} SELECT public.settle_sales_replacement_v1(
    ${literal(foreign.orderId)},${literal(randomUUID())},
    ${literal(JSON.stringify([{sourceKind: 'parcel_component', sourceId: foreign.components[0].id, quantity: 1}]))}::jsonb,
    'Foreign authoritative identity',NULL);`, 'foreign authoritative item');
  const foreignItem = await json(`SELECT to_jsonb(id) FROM sales_replacement_items WHERE operation_id=${literal(foreignIssued.operationId)};`, 'foreign item identity');
  const remove = id => `DELETE FROM sales_aftercare_consumptions WHERE operation_id=${op} AND replacement_item_id=${id};`;
  const duplicate = id => `INSERT INTO sales_aftercare_consumptions SELECT
    (jsonb_populate_record(NULL::sales_aftercare_consumptions,to_jsonb(c)||jsonb_build_object('id',gen_random_uuid()))).*
    FROM sales_aftercare_consumptions c WHERE operation_id=${op} AND replacement_item_id=${id};`;
  const cases = {
    'A,B -> A,A': remove(b)+duplicate(a),
    'A,B -> B,B': remove(a)+duplicate(b),
    'missing A': remove(a), 'missing B': remove(b),
    'duplicate A plus B': duplicate(a), 'A plus duplicate B': duplicate(b),
    'extra unrelated authoritative item': `INSERT INTO sales_aftercare_consumptions SELECT
      (jsonb_populate_record(NULL::sales_aftercare_consumptions,to_jsonb(c)||jsonb_build_object('id',gen_random_uuid(),'operation_id',${op}::uuid))).*
      FROM sales_aftercare_consumptions c WHERE replacement_item_id=${literal(foreignItem)};`,
    'wrong source': `UPDATE sales_aftercare_consumptions SET source_id=gen_random_uuid() WHERE operation_id=${op} AND replacement_item_id=${a};`,
    'same product wrong lineage': `UPDATE sales_aftercare_consumptions SET source_id=${literal(foreign.components[0].id)}
      WHERE operation_id=${op} AND product_id=${literal(productId)};`,
  };
  // Include all rows in these relations, not only counts or reachable evidence.
  const snapshot = `SELECT jsonb_build_object(${[
    'business_operations','sales_replacement_events','sales_replacement_items',
    'sales_aftercare_consumptions','phase43_replacement_inventory_effects',
    'phase43_replacement_settlement_evidence','inventory_movements','inventory_balances',
  ].map(t => `'${t}',(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public.${t} t)`).join(',')})`;
  const original = await json(snapshot, 'pre-probe durable graph');
  let checked = 0;
  for (const mode of ['replay','finalization']) for (const [name,mutation] of Object.entries(cases)) {
    const setup = mode === 'replay' ? '' : `UPDATE sales_replacement_events SET replacement_status='draft',settled_at=NULL,issuance_status='not_issued',issued_at=NULL WHERE operation_id=${op};
      UPDATE sales_aftercare_consumptions SET consumption_state='draft',settled_at=NULL WHERE operation_id=${op};
      INSERT INTO phase43_replacement_issuance_guards VALUES(pg_current_xact_id(),${op},${literal(issued.replacementId)});`;
    const invocation = mode === 'replay' ? `PERFORM ${call};` : `PERFORM public.phase4_finalize_aftercare_operation_internal(${op});`;
    const probe = await runSql(`BEGIN; SET LOCAL session_replication_role=replica;
      ${setup} ${mutation} SET LOCAL session_replication_role=origin; ${ownerClaims}
      DO $$ DECLARE before_call JSONB; after_call JSONB; rejected BOOLEAN := false;
      BEGIN before_call := (${snapshot});
        BEGIN ${invocation}
        EXCEPTION WHEN SQLSTATE 'P0001' THEN
          IF SQLERRM NOT LIKE 'PHASE43_REPLACEMENT_EFFECTS_INCOMPLETE:%'
            AND SQLERRM NOT LIKE 'PHASE4_REPLACEMENT_CONSUMPTION_INVALID:%' THEN RAISE; END IF;
          rejected := true;
        END;
        IF NOT rejected THEN RAISE EXCEPTION 'IDENTITY_PROBE_ACCEPTED_CORRUPTION'; END IF;
        after_call := (${snapshot});
        IF before_call IS DISTINCT FROM after_call THEN RAISE EXCEPTION 'IDENTITY_PROBE_PARTIAL_WRITES'; END IF;
      END $$; ROLLBACK;`, `${mode}: ${name}`);
    assert.equal(probe.code, 0);
    assert.deepEqual(await json(snapshot, 'post-rollback durable graph'), original);
    checked++;
  }
  const replay = await json(`${ownerClaims} SELECT ${call};`, 'clean replay');
  assert.deepEqual(replay, issued);
  assert.deepEqual(await json(snapshot, 'clean replay zero writes'), original);
  console.log(JSON.stringify({consumptionIdentityCases: checked, validReplay: true,
    rejectedCallZeroWritesBeforeRollback: true, fullRollback: true}));
}
