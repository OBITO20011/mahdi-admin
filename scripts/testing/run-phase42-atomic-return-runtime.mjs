import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..');
const bootstrapPath = path.join(scriptDirectory, 'bootstrap-isolated-supabase.mjs');
const phase3SqlPath = path.join(
  scriptDirectory,
  'phase3-configurable-parcel-contracts-runtime.sql',
);
const cliPath = path.join(projectRoot, 'node_modules', 'supabase', 'dist', 'supabase.js');
const projectId = 'nawasrah-phase42-return-test';
const databaseContainer = `supabase_db_${projectId}`;
const ownerId = '92400000-0000-0000-0000-000000000001';
const warehouseId = '92400000-0000-0000-0000-000000000201';
const branchId = '92400000-0000-0000-0000-000000000200';
const productA = '92400000-0000-0000-0000-000000000101';
const productB = '92400000-0000-0000-0000-000000000102';
const familyId = '92400000-0000-0000-0000-000000000100';
const configurationId = '92400000-0000-0000-0000-000000000300';
const customerId = '92420000-0000-4000-8000-000000000001';
const ownerClaims = `SELECT set_config('request.jwt.claims',
  '{"sub":"${ownerId}","role":"authenticated","aal":"aal2"}',false);`;
let isolatedProjectRoot = '';

const sqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;

const runSqlText = async (sql, label, { expectFailure = false } = {}) => {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', [
      'exec', '-i', databaseContainer,
      'psql', '-U', 'postgres', '-d', 'postgres',
      '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
    ], { cwd: projectRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      const result = { code, stdout: stdout.trim(), stderr: stderr.trim() };
      if ((!expectFailure && code !== 0) || (expectFailure && code === 0)) {
        reject(new Error(`${label} had unexpected exit ${code}:\n${stderr}\n${stdout}`));
        return;
      }
      resolve(result);
    });
    child.stdin.end(`SET statement_timeout='60s'; SET lock_timeout='30s';\n${sql}`);
  });
};

const readJson = async (sql, label = 'Phase 4.2 JSON query') => {
  const result = await runSqlText(sql, label);
  const value = result.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).at(-1);
  assert.ok(value, `${label} did not return JSON.`);
  return JSON.parse(value);
};

const expectSqlError = async (sql, pattern, label) => {
  const result = await runSqlText(sql, label, { expectFailure: true });
  assert.match(result.stderr, pattern);
  return result;
};

const baseItems = (quantity, productId = productA) => JSON.stringify([{
  commercial_line_kind: 'base_unit',
  product_id: productId,
  base_quantity: quantity,
  price_authority: 'server_catalog',
  line_discount_in_minor_units: 0,
}]);

const createBaseSale = async ({ key, quantity, paymentMethod, amountPaid, customer = null,
  targetWarehouseId = warehouseId, targetBranchId = branchId }) => {
  const result = await readJson(`${ownerClaims}
    SELECT public.create_pos_sale_v2(
      ${sqlLiteral(targetWarehouseId)},${sqlLiteral(targetBranchId)},
      ${customer ? sqlLiteral(customer) : 'NULL'},${sqlLiteral(`Phase42 ${key}`)},
      ${sqlLiteral(paymentMethod)},${sqlLiteral(baseItems(quantity))}::jsonb,
      0,${amountPaid},${sqlLiteral(key)}
    );`, `Create sale ${key}`);
  assert.equal(result.success, true);
  const fixture = await readJson(`SELECT jsonb_build_object(
    'orderId',customer_order.id,'orderItemId',item.id,
    'shiftId',customer_order.cash_shift_id,'total',customer_order.total_in_minor_units,
    'branchId',customer_order.branch_id,'warehouseId',customer_order.warehouse_id,
    'amountPaid',customer_order.amount_paid_in_minor_units,
    'quantity',item.quantity,'entitlement',item.net_refundable_amount_snapshot_in_minor_units,
    'cogs',item.cogs_in_minor_units,'productId',item.product_id,
    'exactCogs',item.exact_cogs_snapshot_in_minor_units,
    'operationId',customer_order.operation_id,
    'completion',(SELECT completed_at FROM public.business_operations
      WHERE id=customer_order.operation_id)
  ) FROM public.orders customer_order
  JOIN public.order_items item ON item.order_id=customer_order.id
  WHERE customer_order.id=${sqlLiteral(result.orderId)};`, `Read sale ${key}`);
  return fixture;
};

const replacementSettlementSql = ({ fixture, key, operationId, eventId, itemId }) => `
  BEGIN;
  INSERT INTO public.business_operations(
    id,operation_type,idempotency_key,request_fingerprint,initiated_by,
    result_snapshot,completed_at,request_identity_version,
    request_identity_snapshot,actor_scope_type,actor_scope_hash
  ) VALUES (
    ${sqlLiteral(operationId)},'phase4_replacement_v1',${sqlLiteral(key)},repeat('a',64),
    ${sqlLiteral(ownerId)},jsonb_build_object('success',true,
      'operationId',${sqlLiteral(operationId)},'replacementId',${sqlLiteral(eventId)}),
    clock_timestamp(),401,jsonb_build_object('order_id',${sqlLiteral(fixture.orderId)}),
    'erp_user',repeat('b',64)
  );
  INSERT INTO public.sales_replacement_events(
    id,operation_id,root_order_id,branch_id,warehouse_id,contract_version,
    original_completed_at_snapshot,reason,created_by
  ) VALUES (
    ${sqlLiteral(eventId)},${sqlLiteral(operationId)},${sqlLiteral(fixture.orderId)},
    ${sqlLiteral(fixture.branchId)},${sqlLiteral(fixture.warehouseId)},401,
    ${sqlLiteral(fixture.completion)},'Concurrent Return interlock',${sqlLiteral(ownerId)}
  );
  INSERT INTO public.sales_replacement_items(
    id,replacement_event_id,operation_id,root_order_item_id,product_id,quantity,
    replacement_unit_cost_snapshot_in_minor_units_exact,
    replacement_cogs_snapshot_in_minor_units,condition_code
  ) VALUES (
    ${sqlLiteral(itemId)},${sqlLiteral(eventId)},${sqlLiteral(operationId)},
    ${sqlLiteral(fixture.orderItemId)},${sqlLiteral(fixture.productId)},1,
    ${Number(fixture.exactCogs) / Number(fixture.quantity)},
    ${Math.round(Number(fixture.cogs) / Number(fixture.quantity))},'supplier_defect'
  );
  INSERT INTO public.sales_aftercare_consumptions(
    operation_id,replacement_item_id,source_kind,source_id,product_id,
    consumed_quantity,consumption_kind
  ) VALUES (
    ${sqlLiteral(operationId)},${sqlLiteral(itemId)},'base_order_item',
    ${sqlLiteral(fixture.orderItemId)},${sqlLiteral(fixture.productId)},1,'replacement'
  );
  SELECT public.phase4_finalize_aftercare_operation_internal(${sqlLiteral(operationId)});
  COMMIT;`;

const createDedicatedShiftSale = async ({ suffix, branchUuid, warehouseUuid, shiftUuid }) => {
  await runSqlText(`
    INSERT INTO public.branches(id,code,name_ar,is_active)
    VALUES (${sqlLiteral(branchUuid)},${sqlLiteral(`P42-${suffix}`)},
      ${sqlLiteral(`Phase 4.2 ${suffix}`)},true);
    INSERT INTO public.warehouses(id,branch_id,code,name_ar,is_active)
    VALUES (${sqlLiteral(warehouseUuid)},${sqlLiteral(branchUuid)},
      ${sqlLiteral(`P42-WH-${suffix}`)},${sqlLiteral(`Phase 4.2 warehouse ${suffix}`)},true);
    INSERT INTO public.cash_shifts(
      id,shift_number,branch_id,opened_by,opening_cash_in_minor_units
    ) VALUES (${sqlLiteral(shiftUuid)},${sqlLiteral(`P42-SHIFT-${suffix}`)},
      ${sqlLiteral(branchUuid)},${sqlLiteral(ownerId)},0);
    INSERT INTO public.inventory_balances(
      warehouse_id,product_id,on_hand_quantity,reserved_quantity
    ) VALUES (${sqlLiteral(warehouseUuid)},${sqlLiteral(productA)},10,0);`,
  `Create dedicated Shift fixture ${suffix}`);
  return createBaseSale({
    key: `phase42-full-shift-${suffix}-sale`, quantity: 1,
    paymentMethod: 'cash', amountPaid: 1000,
    targetWarehouseId: warehouseUuid, targetBranchId: branchUuid,
  });
};

const returnItems = (fixture, quantity, disposition = 'restock') => JSON.stringify([{
  return_scope: 'base_unit',
  order_item_id: fixture.orderItemId,
  quantity,
  stock_disposition: disposition,
}]);

const settleReturnSql = ({ fixture, key, quantity, disposition = 'restock', method = null,
  reference = null, reason = 'Phase 4.2 runtime proof' }) => `${ownerClaims}
  SELECT public.settle_sales_return_v1(
    ${sqlLiteral(fixture.orderId)},${sqlLiteral(key)},
    ${sqlLiteral(returnItems(fixture, quantity, disposition))}::jsonb,
    ${sqlLiteral(reason)},${method ? sqlLiteral(method) : 'NULL'},
    ${reference ? sqlLiteral(reference) : 'NULL'},NULL
  );`;

const readCompletedCustomerV2Fixture = async () => {
  const key = randomUUID();
  const phoneSuffix = String(Math.floor(Math.random() * 9000000) + 1000000);
  await runSqlText(`UPDATE public.storefront_settings
    SET orders_enabled=true,minimum_order_in_minor_units=0,
      inside_ramtha_delivery_fee_in_minor_units=0,
      outside_ramtha_delivery_fee_in_minor_units=0;
    INSERT INTO public.inventory_balances(
      warehouse_id,product_id,on_hand_quantity,reserved_quantity
    ) SELECT warehouse.id,${sqlLiteral(productA)},100,0
      FROM public.warehouses warehouse
      JOIN public.branches branch ON branch.id=warehouse.branch_id
      WHERE warehouse.is_active AND branch.is_active
    ON CONFLICT (warehouse_id,product_id) DO UPDATE
      SET on_hand_quantity=public.inventory_balances.on_hand_quantity+100;`,
  'Enable isolated Customer V2 M1 fixture');
  const submitted = await readJson(`SELECT set_config(
      'request.jwt.claim.role','service_role',false);
    SELECT public.submit_guest_customer_order_v2(
      ${sqlLiteral(key)},repeat('c',64),repeat('d',64),'عميل Phase 4.2 M1',
      ${sqlLiteral(`079${phoneSuffix}`)},'إربد','الرمثا','الحي الشرقي','شارع الاختبار',
      NULL,NULL,NULL,NULL,NULL,NULL,
      ${sqlLiteral(JSON.stringify([{
        commercial_line_kind: 'base_unit', product_id: productA,
        base_quantity: 1, expected_unit_price_in_minor_units: 1000,
      }]))}::jsonb,
      NULL,'cash_on_delivery','inside_ramtha',1000,0,0,1000
    );`, 'Create Customer V2 M1 fixture');
  assert.ok(submitted?.order_id);
  await runSqlText(`INSERT INTO public.cash_shifts(
      id,shift_number,branch_id,opened_by,opening_cash_in_minor_units
    ) SELECT ${sqlLiteral(randomUUID())},${sqlLiteral(`P42-M1-${phoneSuffix}`)},
      customer_order.branch_id,${sqlLiteral(ownerId)},0
    FROM public.orders customer_order
    WHERE customer_order.id=${sqlLiteral(submitted.order_id)}
      AND NOT EXISTS (
        SELECT 1 FROM public.cash_shifts shift_row
        WHERE shift_row.branch_id=customer_order.branch_id
          AND shift_row.status='open'
      );
    UPDATE public.orders SET status='ready'
    WHERE id=${sqlLiteral(submitted.order_id)};`, 'Ready Customer V2 M1 fixture');
  const completed = await readJson(`${ownerClaims}
    SELECT public.complete_website_order_with_settlement_v2(
      ${sqlLiteral(submitted.order_id)},${sqlLiteral(randomUUID())},
      'cash',1000,0,NULL,'Phase 4.2 M1 Customer completion'
    );`, 'Complete Customer V2 M1 fixture');
  assert.equal(completed.success, true);

  const fixture = await readJson(`SELECT jsonb_build_object(
    'orderId',customer_order.id,'orderItemId',item.id,
    'shiftId',customer_order.cash_shift_id,'total',customer_order.total_in_minor_units,
    'branchId',customer_order.branch_id,'warehouseId',customer_order.warehouse_id,
    'amountPaid',customer_order.amount_paid_in_minor_units,
    'quantity',item.quantity,'entitlement',item.net_refundable_amount_snapshot_in_minor_units,
    'cogs',item.cogs_in_minor_units,'productId',item.product_id,
    'exactCogs',item.exact_cogs_snapshot_in_minor_units,
    'operationId',customer_order.operation_id,
    'completion',creation.completed_at
  ) FROM public.orders customer_order
  JOIN public.business_operations creation ON creation.id=customer_order.operation_id
  JOIN public.order_items item ON item.order_id=customer_order.id
  WHERE customer_order.id=${sqlLiteral(submitted.order_id)}
    AND customer_order.status='completed'
    AND creation.operation_type='phase3_customer_reservation_v1'
    AND item.commercial_line_kind='base_unit'
    AND item.product_id IS NOT NULL
    AND item.net_refundable_amount_snapshot_in_minor_units IS NOT NULL
  ORDER BY item.id LIMIT 1;`,
  'Read completed Customer V2 fixture');
  assert.ok(fixture?.orderId && fixture?.orderItemId,
    'Phase 3 prerequisite did not create a completed Customer V2 Base Unit sale.');
  return fixture;
};

const foundationOnlyReturnSql = ({
  fixture, operationId, eventId, key, coordinatorVersion = 'NULL',
  withGuard = false, withEvidence = false, malformedEvidence = false,
  stockDisposition = 'damaged', disableTransitionTrigger = false,
  bypassFinalizer = false,
  effectSql = '',
  finalizer = 'phase4_finalize_aftercare_operation_internal',
}) => {
  const returnNumber = `M1-${operationId.slice(0, 8)}`;
  const result = JSON.stringify({
    success: true,
    idempotentReplay: false,
    operationId,
    returnId: eventId,
    returnNumber,
    orderId: fixture.orderId,
    merchandiseEntitlementInMinorUnits: Number(fixture.entitlement),
    debtReductionInMinorUnits: 0,
    moneyRefundInMinorUnits: Number(fixture.entitlement),
    refundMethod: 'cash',
    deliveryRefundInMinorUnits: 0,
    taxRefundInMinorUnits: 0,
  });
  return `BEGIN;
    INSERT INTO public.business_operations(
      id,operation_type,idempotency_key,request_fingerprint,initiated_by,
      result_snapshot,completed_at,request_identity_version,
      request_identity_snapshot,actor_scope_type,actor_scope_hash
    ) VALUES (
      ${sqlLiteral(operationId)},'phase4_return_v1',${sqlLiteral(key)},repeat('a',64),
      ${sqlLiteral(ownerId)},${sqlLiteral(result)}::jsonb,clock_timestamp(),401,
      jsonb_build_object('order_id',${sqlLiteral(fixture.orderId)}),
      'erp_user',repeat('b',64)
    );
    INSERT INTO public.sales_return_events(
      id,return_number,operation_id,order_id,branch_id,warehouse_id,
      cash_shift_id,reason,refund_method,
      merchandise_refund_amount_in_minor_units,contract_version,
      settlement_status,outstanding_debt_before_snapshot_in_minor_units,
      net_collected_before_snapshot_in_minor_units,
      debt_reduction_amount_in_minor_units,money_refund_amount_in_minor_units,
      raw_customer_damage_deduction_in_minor_units,
      applied_customer_damage_deduction_in_minor_units,
      settlement_coordinator_version
    ) VALUES (
      ${sqlLiteral(eventId)},${sqlLiteral(returnNumber)},${sqlLiteral(operationId)},
      ${sqlLiteral(fixture.orderId)},${sqlLiteral(fixture.branchId)},
      ${sqlLiteral(fixture.warehouseId)},${sqlLiteral(fixture.shiftId)},
      'M1 operational evidence probe','cash',${Number(fixture.entitlement)},401,
      'draft',0,${Number(fixture.entitlement)},0,${Number(fixture.entitlement)},
      0,0,${coordinatorVersion}
    );
    INSERT INTO public.sales_return_items(
      sales_return_event_id,operation_id,order_id,order_item_id,
      return_scope,product_id,returned_quantity,
      refund_amount_snapshot_in_minor_units,stock_disposition,
      accepted_base_quantity,rejected_base_quantity,
      original_cogs_snapshot_in_minor_units,
      raw_customer_damage_deduction_in_minor_units,
      applied_customer_damage_deduction_in_minor_units
    ) VALUES (
      ${sqlLiteral(eventId)},${sqlLiteral(operationId)},${sqlLiteral(fixture.orderId)},
      ${sqlLiteral(fixture.orderItemId)},'base_unit',${sqlLiteral(fixture.productId)},
      1,${Number(fixture.entitlement)},${sqlLiteral(stockDisposition)},1,0,${Number(fixture.cogs)},0,0
    );
    INSERT INTO public.sales_aftercare_consumptions(
      operation_id,return_item_id,source_kind,source_id,product_id,
      consumed_quantity,consumption_kind
    ) SELECT ${sqlLiteral(operationId)},item.id,'base_order_item',
      ${sqlLiteral(fixture.orderItemId)},${sqlLiteral(fixture.productId)},1,'return'
    FROM public.sales_return_items item
    WHERE item.sales_return_event_id=${sqlLiteral(eventId)};
    ${effectSql}
    ${withGuard ? `INSERT INTO public.phase42_return_settlement_guards(
      transaction_id,operation_id,return_event_id
    ) VALUES (pg_current_xact_id(),${sqlLiteral(operationId)},${sqlLiteral(eventId)});` : ''}
    ${withEvidence ? `INSERT INTO public.phase42_return_settlement_evidence(
      operation_id,return_event_id,order_id,result_snapshot,inventory_effects_snapshot
    ) VALUES (
      ${sqlLiteral(operationId)},${sqlLiteral(eventId)},${sqlLiteral(fixture.orderId)},
      ${malformedEvidence ? `'{}'::jsonb` : `${sqlLiteral(result)}::jsonb`},
      public.phase42_inventory_effects_snapshot_internal(${sqlLiteral(operationId)})
    );` : ''}
    ${disableTransitionTrigger ? `ALTER TABLE public.sales_return_events DISABLE TRIGGER
      trg_phase42_require_evidence_before_return_settlement;` : ''}
    ${bypassFinalizer ? `SELECT set_config('nawasrah.phase4_finalization_operation_id',
      ${sqlLiteral(operationId)},true);
      UPDATE public.sales_return_events
      SET settlement_status='settled',settled_at=clock_timestamp()
      WHERE id=${sqlLiteral(eventId)};` : `SELECT public.${finalizer}(
      ${sqlLiteral(operationId)}
    );`}
    ${disableTransitionTrigger ? `ALTER TABLE public.sales_return_events ENABLE TRIGGER
      trg_phase42_require_evidence_before_return_settlement;` : ''}
    COMMIT;`;
};

const forgedInventoryEffectSql = ({
  fixture, operationId, eventId, movementId, movementReferenceId,
  effectWarehouseId = fixture.warehouseId,
  sourceEvidenceSql = "expected.value->'sourceEvidence'",
}) => `
  INSERT INTO public.inventory_movements(
    id,warehouse_id,product_id,movement_type,quantity,
    balance_before,balance_after,reference_type,reference_id,notes,created_by
  ) VALUES (
    ${sqlLiteral(movementId)},${sqlLiteral(effectWarehouseId)},
    ${sqlLiteral(fixture.productId)},'return_in',1,10,11,
    'phase4_sales_return',${sqlLiteral(movementReferenceId)},
    'Phase 4.2 adversarial evidence binding probe',${sqlLiteral(ownerId)}
  );
  INSERT INTO public.phase42_return_inventory_effects(
    operation_id,return_event_id,warehouse_id,product_id,
    inventory_movement_id,sellable_quantity,
    historical_restock_value_in_minor_units_exact,
    opening_global_quantity,target_balance_before,target_balance_after,
    prior_wac_in_minor_units_exact,resulting_wac_in_minor_units_exact,
    resulting_global_quantity,resulting_global_value_in_minor_units_exact,
    source_evidence
  )
  SELECT ${sqlLiteral(operationId)},${sqlLiteral(eventId)},
    ${sqlLiteral(effectWarehouseId)},${sqlLiteral(fixture.productId)},
    ${sqlLiteral(movementId)},1,
    (expected.value->>'historicalValueExact')::NUMERIC,
    10,10,11,1,
    ROUND((10 + (expected.value->>'historicalValueExact')::NUMERIC) / 11,6),
    11,ROUND(10 + (expected.value->>'historicalValueExact')::NUMERIC,6),
    ${sourceEvidenceSql}
  FROM JSONB_EACH(
    public.phase42_expected_return_inventory_effects_internal(
      ${sqlLiteral(operationId)}
    )
  ) expected
  WHERE expected.key=${sqlLiteral(fixture.productId)};
`;

const runSettlementEvidenceBindingMatrix = async () => {
  const pos = await createBaseSale({
    key: `phase42-m1-pos-${randomUUID()}`, quantity: 1,
    paymentMethod: 'cash', amountPaid: 1000,
  });
  const customer = await readCompletedCustomerV2Fixture();

  for (const [label, fixture] of [['pos', pos], ['customer', customer]]) {
    for (const finalizer of [
      'phase4_finalize_aftercare_operation_internal',
      'phase4_finalize_aftercare_operation_foundation_internal',
    ]) {
      const operationId = randomUUID();
      const eventId = randomUUID();
      await expectSqlError(foundationOnlyReturnSql({
        fixture, operationId, eventId,
        key: `phase42-m1-${label}-null-${randomUUID()}`, finalizer,
      }), /PHASE42_OPERATIONAL_EVIDENCE_INVALID/u,
      `Modern ${label} foundation-only NULL coordinator via ${finalizer}`);
      const state = await readJson(`SELECT jsonb_build_object(
        'operations',(SELECT count(*) FROM public.business_operations WHERE id=${sqlLiteral(operationId)}),
        'events',(SELECT count(*) FROM public.sales_return_events WHERE id=${sqlLiteral(eventId)}),
        'effects',(SELECT count(*) FROM public.phase42_return_inventory_effects WHERE operation_id=${sqlLiteral(operationId)}),
        'evidence',(SELECT count(*) FROM public.phase42_return_settlement_evidence WHERE operation_id=${sqlLiteral(operationId)})
      );`, `Read ${label} rejected finalization state`);
      assert.deepEqual(state, { operations: 0, events: 0, effects: 0, evidence: 0 });
    }

    for (const finalizer of [
      'phase4_finalize_aftercare_operation_internal',
      'phase4_finalize_aftercare_operation_foundation_internal',
    ]) {
      const operationId = randomUUID();
      const eventId = randomUUID();
      await expectSqlError(foundationOnlyReturnSql({
        fixture, operationId, eventId,
        key: `phase42-m1-${label}-missing-restock-${randomUUID()}`,
        coordinatorVersion: '402', withGuard: true, withEvidence: true,
        stockDisposition: 'restock', finalizer,
      }), /PHASE42_OPERATIONAL_EFFECTS_INCOMPLETE/u,
      `Modern ${label} missing durable restock effects via ${finalizer}`);
      const state = await readJson(`SELECT jsonb_build_object(
        'operations',(SELECT count(*) FROM public.business_operations WHERE id=${sqlLiteral(operationId)}),
        'events',(SELECT count(*) FROM public.sales_return_events WHERE id=${sqlLiteral(eventId)}),
        'effects',(SELECT count(*) FROM public.phase42_return_inventory_effects WHERE operation_id=${sqlLiteral(operationId)}),
        'evidence',(SELECT count(*) FROM public.phase42_return_settlement_evidence WHERE operation_id=${sqlLiteral(operationId)})
      );`, `Read ${label} rejected missing-restock state`);
      assert.deepEqual(state, { operations: 0, events: 0, effects: 0, evidence: 0 });
    }

    const wrongReferenceOperation = randomUUID();
    const wrongReferenceEvent = randomUUID();
    const wrongReferenceMovement = randomUUID();
    await expectSqlError(foundationOnlyReturnSql({
      fixture,
      operationId: wrongReferenceOperation,
      eventId: wrongReferenceEvent,
      key: `phase42-m1-${label}-wrong-movement-reference-${randomUUID()}`,
      coordinatorVersion: '402',
      withGuard: true,
      withEvidence: true,
      stockDisposition: 'restock',
      effectSql: forgedInventoryEffectSql({
        fixture,
        operationId: wrongReferenceOperation,
        eventId: wrongReferenceEvent,
        movementId: wrongReferenceMovement,
        movementReferenceId: randomUUID(),
      }),
    }), /PHASE42_OPERATIONAL_EFFECTS_INVALID/u,
    `Modern ${label} movement reference binding`);

    const wrongWarehouseOperation = randomUUID();
    const wrongWarehouseEvent = randomUUID();
    const wrongWarehouseMovement = randomUUID();
    const wrongBranch = randomUUID();
    const wrongWarehouse = randomUUID();
    await runSqlText(`
      INSERT INTO public.branches(id,code,name_ar,is_active)
      VALUES (${sqlLiteral(wrongBranch)},${sqlLiteral(`M1-${label}-${wrongBranch.slice(0, 6)}`)},
        'M1 wrong warehouse probe',true);
      INSERT INTO public.warehouses(id,branch_id,code,name_ar,is_active)
      VALUES (${sqlLiteral(wrongWarehouse)},${sqlLiteral(wrongBranch)},
        ${sqlLiteral(`M1-WH-${wrongWarehouse.slice(0, 6)}`)},
        'M1 wrong warehouse probe',true);`,
    `Create ${label} wrong-warehouse fixture`);
    await expectSqlError(foundationOnlyReturnSql({
      fixture,
      operationId: wrongWarehouseOperation,
      eventId: wrongWarehouseEvent,
      key: `phase42-m1-${label}-wrong-warehouse-${randomUUID()}`,
      coordinatorVersion: '402',
      withGuard: true,
      withEvidence: true,
      stockDisposition: 'restock',
      effectSql: forgedInventoryEffectSql({
        fixture,
        operationId: wrongWarehouseOperation,
        eventId: wrongWarehouseEvent,
        movementId: wrongWarehouseMovement,
        movementReferenceId: wrongWarehouseEvent,
        effectWarehouseId: wrongWarehouse,
      }),
    }), /PHASE42_OPERATIONAL_EFFECTS_INVALID/u,
    `Modern ${label} authoritative warehouse binding`);

    const wrongSourceOperation = randomUUID();
    const wrongSourceEvent = randomUUID();
    await expectSqlError(foundationOnlyReturnSql({
      fixture,
      operationId: wrongSourceOperation,
      eventId: wrongSourceEvent,
      key: `phase42-m1-${label}-wrong-source-${randomUUID()}`,
      coordinatorVersion: '402',
      withGuard: true,
      withEvidence: true,
      stockDisposition: 'restock',
      effectSql: forgedInventoryEffectSql({
        fixture,
        operationId: wrongSourceOperation,
        eventId: wrongSourceEvent,
        movementId: randomUUID(),
        movementReferenceId: wrongSourceEvent,
        sourceEvidenceSql: `'[{}]'::JSONB`,
      }),
    }), /PHASE42_OPERATIONAL_EFFECTS_INCOMPLETE/u,
    `Modern ${label} immutable source evidence binding`);
  }

  const missingEvidenceOperation = randomUUID();
  const missingEvidenceEvent = randomUUID();
  await expectSqlError(foundationOnlyReturnSql({
    fixture: pos, operationId: missingEvidenceOperation,
    eventId: missingEvidenceEvent,
    key: `phase42-m1-missing-evidence-${randomUUID()}`,
    coordinatorVersion: '402', withGuard: true,
  }), /PHASE42_OPERATIONAL_EVIDENCE_INVALID/u,
  '402 coordinator marker without durable evidence');

  const inconsistentOperation = randomUUID();
  const inconsistentEvent = randomUUID();
  await expectSqlError(foundationOnlyReturnSql({
    fixture: pos, operationId: inconsistentOperation, eventId: inconsistentEvent,
    key: `phase42-m1-inconsistent-evidence-${randomUUID()}`,
    coordinatorVersion: '402', withGuard: true, withEvidence: true,
    malformedEvidence: true,
  }), /PHASE42_OPERATIONAL_EVIDENCE_INVALID/u,
  'Inconsistent durable evidence binding');

  const malformedOperation = randomUUID();
  const malformedEvent = randomUUID();
  await expectSqlError(foundationOnlyReturnSql({
    fixture: pos, operationId: malformedOperation, eventId: malformedEvent,
    key: `phase42-m1-malformed-version-${randomUUID()}`,
    coordinatorVersion: '999',
  }), /sales_return_events_coordinator_version_check/u,
  'Malformed coordinator version');

  const evidenceWithoutGuardOperation = randomUUID();
  const evidenceWithoutGuardEvent = randomUUID();
  await expectSqlError(foundationOnlyReturnSql({
    fixture: pos, operationId: evidenceWithoutGuardOperation,
    eventId: evidenceWithoutGuardEvent,
    key: `phase42-m1-unguarded-evidence-${randomUUID()}`,
    coordinatorVersion: '402', withEvidence: true,
  }), /PHASE42_COORDINATOR_REQUIRED/u,
  'Durable evidence insert without coordinator guard');

  const replayOperation = randomUUID();
  const replayEvent = randomUUID();
  const replayKey = `phase42-m1-foundation-replay-${randomUUID()}`;
  const replayReturnNumber = `M1-${replayOperation.slice(0, 8)}`;
  const replayResult = JSON.stringify({
    success: true,
    idempotentReplay: false,
    operationId: replayOperation,
    returnId: replayEvent,
    returnNumber: replayReturnNumber,
    orderId: pos.orderId,
    merchandiseEntitlementInMinorUnits: 0,
    debtReductionInMinorUnits: 0,
    moneyRefundInMinorUnits: 0,
    refundMethod: null,
    deliveryRefundInMinorUnits: 0,
    taxRefundInMinorUnits: 0,
  });
  await runSqlText(`BEGIN;
    INSERT INTO public.business_operations(
      id,operation_type,idempotency_key,request_fingerprint,initiated_by,
      result_snapshot,completed_at,request_identity_version,
      request_identity_snapshot,actor_scope_type,actor_scope_hash
    ) VALUES (
      ${sqlLiteral(replayOperation)},'phase4_return_v1',${sqlLiteral(replayKey)},
      repeat('a',64),${sqlLiteral(ownerId)},${sqlLiteral(replayResult)}::jsonb,
      clock_timestamp(),401,jsonb_build_object('order_id',${sqlLiteral(pos.orderId)}),
      'erp_user',repeat('b',64)
    );
    INSERT INTO public.sales_return_events(
      id,return_number,operation_id,order_id,branch_id,warehouse_id,
      reason,merchandise_refund_amount_in_minor_units,contract_version,
      settlement_status,outstanding_debt_before_snapshot_in_minor_units,
      net_collected_before_snapshot_in_minor_units,
      debt_reduction_amount_in_minor_units,money_refund_amount_in_minor_units,
      raw_customer_damage_deduction_in_minor_units,
      applied_customer_damage_deduction_in_minor_units,
      settlement_coordinator_version
    ) VALUES (
      ${sqlLiteral(replayEvent)},${sqlLiteral(replayReturnNumber)},
      ${sqlLiteral(replayOperation)},${sqlLiteral(pos.orderId)},
      ${sqlLiteral(pos.branchId)},${sqlLiteral(pos.warehouseId)},
      'Foundation-only replay adoption probe',0,401,'draft',0,0,0,0,0,0,NULL
    );
    SELECT set_config('nawasrah.phase4_finalization_operation_id',
      ${sqlLiteral(replayOperation)},true);
    ALTER TABLE public.sales_return_events DISABLE TRIGGER
      trg_phase42_require_evidence_before_return_settlement;
    UPDATE public.sales_return_events
    SET settlement_status='settled',settled_at=clock_timestamp()
    WHERE id=${sqlLiteral(replayEvent)};
    ALTER TABLE public.sales_return_events ENABLE TRIGGER
      trg_phase42_require_evidence_before_return_settlement;
    COMMIT;`, 'Create foundation-only settled-looking replay state');
  const beforeReplay = await readJson(`SELECT jsonb_build_object(
    'operation',(SELECT to_jsonb(operation) FROM public.business_operations operation
      WHERE id=${sqlLiteral(replayOperation)}),
    'event',(SELECT to_jsonb(event) FROM public.sales_return_events event
      WHERE id=${sqlLiteral(replayEvent)}),
    'evidence',(SELECT count(*) FROM public.phase42_return_settlement_evidence
      WHERE operation_id=${sqlLiteral(replayOperation)}),
    'effects',(SELECT count(*) FROM public.phase42_return_inventory_effects
      WHERE operation_id=${sqlLiteral(replayOperation)})
  );`, 'Foundation-only replay state before rejection');
  await expectSqlError(`SELECT public.phase4_resolve_operation_replay_internal(
    'phase4_return_v1',${sqlLiteral(replayKey)},repeat('b',64),repeat('a',64)
  );`, /PHASE42_OPERATIONAL_EVIDENCE_INVALID/u,
  'Foundation-only successful replay adoption');
  const afterReplay = await readJson(`SELECT jsonb_build_object(
    'operation',(SELECT to_jsonb(operation) FROM public.business_operations operation
      WHERE id=${sqlLiteral(replayOperation)}),
    'event',(SELECT to_jsonb(event) FROM public.sales_return_events event
      WHERE id=${sqlLiteral(replayEvent)}),
    'evidence',(SELECT count(*) FROM public.phase42_return_settlement_evidence
      WHERE operation_id=${sqlLiteral(replayOperation)}),
    'effects',(SELECT count(*) FROM public.phase42_return_inventory_effects
      WHERE operation_id=${sqlLiteral(replayOperation)})
  );`, 'Foundation-only replay state after rejection');
  assert.deepEqual(afterReplay, beforeReplay);

  const incompleteReplayOperation = randomUUID();
  const incompleteReplayEvent = randomUUID();
  const incompleteReplayKey = `phase42-m1-incomplete-restock-replay-${randomUUID()}`;
  await runSqlText(foundationOnlyReturnSql({
    fixture: pos, operationId: incompleteReplayOperation,
    eventId: incompleteReplayEvent, key: incompleteReplayKey,
    coordinatorVersion: '402', withGuard: true, withEvidence: true,
    stockDisposition: 'restock', disableTransitionTrigger: true,
    bypassFinalizer: true,
    finalizer: 'phase4_finalize_aftercare_operation_foundation_internal',
  }), 'Create incomplete-restock settled-looking replay state');
  const incompleteBefore = await readJson(`SELECT jsonb_build_object(
    'operation',(SELECT to_jsonb(operation) FROM public.business_operations operation
      WHERE id=${sqlLiteral(incompleteReplayOperation)}),
    'event',(SELECT to_jsonb(event) FROM public.sales_return_events event
      WHERE id=${sqlLiteral(incompleteReplayEvent)}),
    'evidence',(SELECT count(*) FROM public.phase42_return_settlement_evidence
      WHERE operation_id=${sqlLiteral(incompleteReplayOperation)}),
    'effects',(SELECT count(*) FROM public.phase42_return_inventory_effects
      WHERE operation_id=${sqlLiteral(incompleteReplayOperation)})
  );`, 'Incomplete-restock replay state before rejection');
  await expectSqlError(`SELECT public.phase4_resolve_operation_replay_internal(
    'phase4_return_v1',${sqlLiteral(incompleteReplayKey)},repeat('b',64),repeat('a',64)
  );`, /PHASE42_OPERATIONAL_EFFECTS_INCOMPLETE/u,
  'Incomplete-restock successful replay adoption');
  const incompleteAfter = await readJson(`SELECT jsonb_build_object(
    'operation',(SELECT to_jsonb(operation) FROM public.business_operations operation
      WHERE id=${sqlLiteral(incompleteReplayOperation)}),
    'event',(SELECT to_jsonb(event) FROM public.sales_return_events event
      WHERE id=${sqlLiteral(incompleteReplayEvent)}),
    'evidence',(SELECT count(*) FROM public.phase42_return_settlement_evidence
      WHERE operation_id=${sqlLiteral(incompleteReplayOperation)}),
    'effects',(SELECT count(*) FROM public.phase42_return_inventory_effects
      WHERE operation_id=${sqlLiteral(incompleteReplayOperation)})
  );`, 'Incomplete-restock replay state after rejection');
  assert.deepEqual(incompleteAfter, incompleteBefore);

  return {
    modernPosFoundationBypassBlocked: true,
    modernCustomerFoundationBypassBlocked: true,
    nullCoordinatorBlocked: true,
    malformedCoordinatorBlocked: true,
    missingEvidenceBlocked: true,
    inconsistentEvidenceBlocked: true,
    unguardedEvidenceInsertBlocked: true,
    foundationOnlyReplayAdoptionBlocked: true,
    incompleteRestockReplayAdoptionBlocked: true,
    movementReferenceBindingBlocked: true,
    authoritativeWarehouseBindingBlocked: true,
    immutableSourceEvidenceBindingBlocked: true,
    replayRejectionZeroWrites: true,
    rejectedTransactionsZeroWrites: true,
  };
};

const runCoreMatrix = async () => {
  await runSqlText(`INSERT INTO public.customers(
      id,full_name,phone,credit_limit_in_minor_units
    ) VALUES (
      ${sqlLiteral(customerId)},'Phase 4.2 Customer','0794200001',1000000
    );`, 'Create debt customer');

  const cashSale = await createBaseSale({
    key: 'phase42-cash-partial-sale-0001', quantity: 2, // gitleaks:allow test fixture
    paymentMethod: 'cash', amountPaid: 2000,
  });
  const originalCogs = cashSale.cogs;
  const productBefore = await readJson(`SELECT jsonb_build_object(
    'quantity',(SELECT sum(on_hand_quantity) FROM public.inventory_balances
      WHERE product_id=${sqlLiteral(cashSale.productId)}),
    'wac',(SELECT wac_cost_in_minor_units_exact FROM public.products
      WHERE id=${sqlLiteral(cashSale.productId)})
  );`);
  const first = await readJson(settleReturnSql({
    fixture: cashSale, key: 'phase42-cash-partial-return-0001', // gitleaks:allow test fixture
    quantity: 1, method: 'cash',
  }), 'First partial Return');
  assert.equal(first.moneyRefundInMinorUnits, 1000);
  assert.equal(first.debtReductionInMinorUnits, 0);
  const replay = await readJson(settleReturnSql({
    fixture: cashSale, key: 'phase42-cash-partial-return-0001', // gitleaks:allow test fixture
    quantity: 1, method: 'cash',
  }), 'Committed replay');
  assert.deepEqual(replay, first);
  await expectSqlError(settleReturnSql({
    fixture: cashSale, key: 'phase42-cash-partial-return-0001', // gitleaks:allow test fixture
    quantity: 1, disposition: 'damaged', method: 'cash',
  }), /PHASE4_IDEMPOTENCY_CONFLICT/u, 'Changed-payload replay conflict');
  const second = await readJson(settleReturnSql({
    fixture: cashSale, key: 'phase42-cash-partial-return-0002', // gitleaks:allow test fixture
    quantity: 1, disposition: 'damaged', method: 'cash',
  }), 'Second partial Return');
  assert.equal(second.moneyRefundInMinorUnits, 1000);
  await expectSqlError(settleReturnSql({
    fixture: cashSale, key: 'phase42-cash-partial-return-0003', // gitleaks:allow test fixture
    quantity: 1, method: 'cash',
  }), /PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED/u, 'Above-capacity Return');
  const partialState = await readJson(`SELECT jsonb_build_object(
    'settled',(SELECT count(*) FROM public.sales_return_events
      WHERE order_id=${sqlLiteral(cashSale.orderId)} AND settlement_status='settled'),
    'inventoryEffects',(SELECT count(*) FROM public.phase42_return_inventory_effects effect
      JOIN public.sales_return_events event ON event.id=effect.return_event_id
      WHERE event.order_id=${sqlLiteral(cashSale.orderId)}),
    'settlementEvidence',(SELECT count(*) FROM public.phase42_return_settlement_evidence evidence
      JOIN public.sales_return_events event ON event.id=evidence.return_event_id
      WHERE event.order_id=${sqlLiteral(cashSale.orderId)}),
    'movementEffects',(SELECT count(*) FROM public.inventory_movements movement
      JOIN public.sales_return_events event ON event.id=movement.reference_id
      WHERE event.order_id=${sqlLiteral(cashSale.orderId)}
        AND movement.reference_type='phase4_sales_return'),
    'quantity',(SELECT sum(on_hand_quantity) FROM public.inventory_balances
      WHERE product_id=${sqlLiteral(cashSale.productId)}),
    'cogs',(SELECT cogs_in_minor_units FROM public.order_items
      WHERE id=${sqlLiteral(cashSale.orderItemId)}),
    'effect',(SELECT to_jsonb(effect) FROM public.phase42_return_inventory_effects effect
      WHERE effect.operation_id=${sqlLiteral(first.operationId)})
  );`);
  assert.equal(partialState.settled, 2);
  assert.equal(partialState.inventoryEffects, 1);
  assert.equal(partialState.settlementEvidence, 2);
  assert.equal(partialState.movementEffects, 1);
  assert.equal(Number(partialState.quantity), Number(productBefore.quantity) + 1);
  assert.equal(Number(partialState.cogs), Number(originalCogs));
  assert.equal(partialState.effect.sellable_quantity, 1);

  const debtSale = await createBaseSale({
    key: 'phase42-debt-only-sale-0001', quantity: 1,
    paymentMethod: 'debt', amountPaid: 0, customer: customerId,
  });
  const debtOnly = await readJson(settleReturnSql({
    fixture: debtSale, key: 'phase42-debt-only-return-0001', quantity: 1,
    disposition: 'damaged',
  }), 'Debt-only Return');
  assert.equal(debtOnly.debtReductionInMinorUnits, 1000);
  assert.equal(debtOnly.moneyRefundInMinorUnits, 0);
  const debtEvent = await readJson(`SELECT to_jsonb(event)
    FROM public.sales_return_events event
    WHERE event.id=${sqlLiteral(debtOnly.returnId)};`);
  assert.equal(debtEvent.cash_shift_id, null);
  assert.equal(debtEvent.refund_method, null);

  const mixedCashSale = await createBaseSale({
    key: 'phase42-mixed-cash-sale-0001', quantity: 2, // gitleaks:allow test fixture
    paymentMethod: 'debt', amountPaid: 0, customer: customerId,
  });
  await readJson(`${ownerClaims} SELECT public.record_customer_order_payment(
    ${sqlLiteral(mixedCashSale.orderId)},1500,'cash',NULL,'Phase42 cash collection');`);
  const mixedCash = await readJson(settleReturnSql({
    fixture: mixedCashSale, key: 'phase42-mixed-cash-return-0001', // gitleaks:allow test fixture
    quantity: 2, disposition: 'damaged', method: 'cash',
  }), 'Debt plus Cash Return');
  assert.equal(mixedCash.debtReductionInMinorUnits, 500);
  assert.equal(mixedCash.moneyRefundInMinorUnits, 1500);

  const mixedCliqSale = await createBaseSale({
    key: 'phase42-mixed-cliq-sale-0001', quantity: 2, // gitleaks:allow test fixture
    paymentMethod: 'debt', amountPaid: 0, customer: customerId,
  });
  await readJson(`${ownerClaims} SELECT public.record_customer_order_payment(
    ${sqlLiteral(mixedCliqSale.orderId)},1500,'cliq','P42-COLLECT-1','Phase42 CliQ collection');`);
  const mixedCliq = await readJson(settleReturnSql({
    fixture: mixedCliqSale, key: 'phase42-mixed-cliq-return-0001', // gitleaks:allow test fixture
    quantity: 2, disposition: 'damaged', method: 'cliq', reference: 'P42-REFUND-1',
  }), 'Debt plus CliQ Return');
  assert.equal(mixedCliq.debtReductionInMinorUnits, 500);
  assert.equal(mixedCliq.moneyRefundInMinorUnits, 1500);

  const parcelSale = await readJson(`${ownerClaims} SELECT public.create_pos_sale_v2(
    ${sqlLiteral(warehouseId)},${sqlLiteral(branchId)},NULL,'Phase42 Parcel','cash',
    jsonb_build_array(jsonb_build_object(
      'commercial_line_kind','configurable_parcel',
      'family_product_id',${sqlLiteral(familyId)},
      'parcel_configuration_id',${sqlLiteral(configurationId)},
      'configuration_revision',1,'price_authority','server_catalog',
      'line_discount_in_minor_units',0,
      'parcel_instances',jsonb_build_array(jsonb_build_object(
        'components',jsonb_build_array(
          jsonb_build_object('product_id',${sqlLiteral(productA)},'base_quantity',2),
          jsonb_build_object('product_id',${sqlLiteral(productB)},'base_quantity',3)
        )
      ))
    )),0,5000,'phase42-parcel-sale-0001');`, 'Create Parcel sale');
  const parcel = await readJson(`SELECT jsonb_build_object(
    'orderId',customer_order.id,'orderItemId',item.id,'parcelId',instance.id,
    'entitlement',instance.net_refundable_amount_snapshot_in_minor_units,
    'components',(SELECT jsonb_agg(jsonb_build_object(
      'id',component.id,'productId',component.product_id,
      'quantity',component.base_quantity,'damagePrice',
        component.effective_standalone_unit_sale_price_snapshot_in_minor_units
    ) ORDER BY component.id) FROM public.order_parcel_components component
      WHERE component.parcel_instance_id=instance.id)
  ) FROM public.orders customer_order
  JOIN public.order_items item ON item.order_id=customer_order.id
  JOIN public.order_parcel_instances instance ON instance.order_item_id=item.id
  WHERE customer_order.id=${sqlLiteral(parcelSale.orderId)};`);
  const [componentOne, componentTwo] = parcel.components;
  const parcelRequest = JSON.stringify([{
    return_scope: 'parcel_instance', order_item_id: parcel.orderItemId,
    parcel_instance_id: parcel.parcelId,
    components: [
      {
        parcel_component_id: componentOne.id,
        accepted_quantity: componentOne.quantity - 1, rejected_quantity: 1,
        accepted_condition: 'sellable', accepted_stock_disposition: 'restock',
        rejection_reason: 'customer_damage',
        rejected_stock_disposition: 'returned_to_customer',
      },
      {
        parcel_component_id: componentTwo.id,
        accepted_quantity: componentTwo.quantity, rejected_quantity: 0,
        accepted_condition: 'supplier_defect',
        accepted_stock_disposition: 'non_sellable',
        rejection_reason: null, rejected_stock_disposition: null,
      },
    ],
  }]);
  const parcelReturn = await readJson(`${ownerClaims} SELECT public.settle_sales_return_v1(
    ${sqlLiteral(parcel.orderId)},'phase42-parcel-return-0001',
    ${sqlLiteral(parcelRequest)}::jsonb,'Parcel customer damage','cash',NULL,NULL);`);
  assert.equal(
    parcelReturn.merchandiseEntitlementInMinorUnits,
    Number(parcel.entitlement) - Number(componentOne.damagePrice),
  );
  const parcelEffects = await readJson(`SELECT jsonb_build_object(
    'effectCount',(SELECT count(*) FROM public.phase42_return_inventory_effects
      WHERE operation_id=${sqlLiteral(parcelReturn.operationId)}),
    'restockedQuantity',(SELECT coalesce(sum(sellable_quantity),0)
      FROM public.phase42_return_inventory_effects
      WHERE operation_id=${sqlLiteral(parcelReturn.operationId)}),
    'promotionRows',(SELECT count(*) FROM public.promotion_redemptions
      WHERE order_id=${sqlLiteral(parcel.orderId)})
  );`);
  assert.equal(parcelEffects.effectCount, 1);
  assert.equal(Number(parcelEffects.restockedQuantity), Number(componentOne.quantity) - 1);

  const failureSale = await createBaseSale({
    key: 'phase42-failure-sale-0001', quantity: 1, // gitleaks:allow test fixture
    paymentMethod: 'cash', amountPaid: 1000,
  });
  await runSqlText(`CREATE FUNCTION public.phase42_runtime_fail_inventory()
    RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      RAISE EXCEPTION 'PHASE42_INJECTED_FAILURE';
    END $$;
    CREATE TRIGGER trg_phase42_runtime_fail_inventory
    AFTER INSERT ON public.phase42_return_inventory_effects
    FOR EACH ROW EXECUTE FUNCTION public.phase42_runtime_fail_inventory();`,
  'Install isolated failure trigger');
  await expectSqlError(settleReturnSql({
    fixture: failureSale, key: 'phase42-failure-return-0001', quantity: 1, // gitleaks:allow test fixture
    method: 'cash',
  }), /PHASE42_INJECTED_FAILURE/u, 'Injected atomic rollback');
  await runSqlText(`DROP TRIGGER trg_phase42_runtime_fail_inventory
      ON public.phase42_return_inventory_effects;
    DROP FUNCTION public.phase42_runtime_fail_inventory();`, 'Remove isolated failure trigger');
  const rollbackState = await readJson(`SELECT jsonb_build_object(
    'operations',(SELECT count(*) FROM public.business_operations
      WHERE idempotency_key='phase42-failure-return-0001'), -- gitleaks:allow test fixture
    'events',(SELECT count(*) FROM public.sales_return_events
      WHERE order_id=${sqlLiteral(failureSale.orderId)}),
    'movements',(SELECT count(*) FROM public.inventory_movements movement
      WHERE movement.reference_type='phase4_sales_return'
        AND movement.reference_id IN (SELECT id FROM public.sales_return_events
          WHERE order_id=${sqlLiteral(failureSale.orderId)}))
  );`);
  assert.deepEqual(rollbackState, { operations: 0, events: 0, movements: 0 });

  const legacyGuard = await expectSqlError(`${ownerClaims}
    SELECT public.return_completed_website_order(
      ${sqlLiteral(failureSale.orderId)},'Legacy bypass','restock','cash',NULL,NULL);`,
  /PHASE42_COORDINATOR_REQUIRED/u, 'Modern-sale legacy guard');
  assert.notEqual(legacyGuard.code, 0);

  const acl = await readJson(`SELECT jsonb_build_object(
    'coordinatorAuthenticated',has_function_privilege('authenticated',
      'public.settle_sales_return_v1(uuid,text,jsonb,text,text,text,text)','EXECUTE'),
    'inventoryHelperAuthenticated',has_function_privilege('authenticated',
      'public.phase42_apply_return_inventory_internal(uuid,uuid,uuid,jsonb,uuid)','EXECUTE'),
    'finalizerAuthenticated',has_function_privilege('authenticated',
      'public.phase4_finalize_aftercare_operation_internal(uuid)','EXECUTE'),
    'evidenceHelperAuthenticated',has_function_privilege('authenticated',
      'public.phase42_assert_operational_return_evidence_internal(uuid,boolean)','EXECUTE'),
    'evidenceInsertAuthenticated',has_table_privilege('authenticated',
      'public.phase42_return_settlement_evidence','INSERT'),
    'evidenceInsertServiceRole',has_table_privilege('service_role',
      'public.phase42_return_settlement_evidence','INSERT')
  );`);
  assert.deepEqual(acl, {
    coordinatorAuthenticated: true,
    inventoryHelperAuthenticated: false,
    finalizerAuthenticated: false,
    evidenceHelperAuthenticated: false,
    evidenceInsertAuthenticated: false,
    evidenceInsertServiceRole: false,
  });
  const cashierClaims = `SELECT set_config('request.jwt.claims',
    '{"sub":"92400000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',false);`;
  await expectSqlError(`${cashierClaims}
    SELECT public.settle_sales_return_v1(
      ${sqlLiteral(failureSale.orderId)},'phase42-unauthorized-return',
      ${sqlLiteral(returnItems(failureSale, 1))}::jsonb,
      'Unauthorized coordinator proof','cash',NULL,NULL);`,
  /P0001/u, 'Unauthorized coordinator access');
  const unauthorizedState = await readJson(`SELECT jsonb_build_object(
    'operations',(SELECT count(*) FROM public.business_operations
      WHERE idempotency_key='phase42-unauthorized-return'),
    'events',(SELECT count(*) FROM public.sales_return_events
      WHERE order_id=${sqlLiteral(failureSale.orderId)})
  );`);
  assert.deepEqual(unauthorizedState, { operations: 0, events: 0 });

  return {
    partialBaseUnit: true,
    repeatedPartialExactCapacity: true,
    aboveCapacityRejected: true,
    sameKeyReplay: true,
    changedPayloadConflict: true,
    debtOnly: true,
    debtPlusCash: true,
    debtPlusCliq: true,
    zeroMoneyNoFakeRefund: true,
    wholeParcel: true,
    customerDamageHistoricalPrice: true,
    supplierDefectNoRestock: true,
    sellableOnlyRestock: true,
    immutableOriginalCogs: true,
    exactWacEvidence: true,
    atomicInjectedRollback: true,
    modernLegacyGuard: true,
    grants: true,
    unauthorizedCoordinatorRejectedZeroWrites: true,
  };
};

const backdateSaleCompletion = async (operationId) => {
  await runSqlText(`
    ALTER TABLE public.business_operations
      DISABLE TRIGGER trg_guard_business_operation_history;
    UPDATE public.business_operations
    SET completed_at=clock_timestamp()-interval '49 hours'
    WHERE id=${sqlLiteral(operationId)};
    ALTER TABLE public.business_operations
      ENABLE TRIGGER trg_guard_business_operation_history;`,
  'Backdate isolated sale completion evidence');
};

const runTemporalAndEvidenceMatrix = async () => {
  const expiredSale = await createBaseSale({
    key: 'phase42-expired-new-sale', quantity: 1,
    paymentMethod: 'cash', amountPaid: 1000,
  });
  await backdateSaleCompletion(expiredSale.operationId);
  await expectSqlError(settleReturnSql({
    fixture: expiredSale, key: 'phase42-expired-new-return', quantity: 1,
    method: 'cash',
  }), /PHASE4_RETURN_WINDOW_EXPIRED/u, 'Expired new Return');
  const expiredState = await readJson(`SELECT jsonb_build_object(
    'operations',(SELECT count(*) FROM public.business_operations
      WHERE idempotency_key='phase42-expired-new-return'),
    'events',(SELECT count(*) FROM public.sales_return_events
      WHERE order_id=${sqlLiteral(expiredSale.orderId)})
  );`);
  assert.deepEqual(expiredState, { operations: 0, events: 0 });

  const replaySale = await createBaseSale({
    key: 'phase42-expired-replay-sale', quantity: 1,
    paymentMethod: 'cash', amountPaid: 1000,
  });
  const settled = await readJson(settleReturnSql({
    fixture: replaySale, key: 'phase42-expired-replay-return', quantity: 1,
    method: 'cash',
  }), 'Settle Return before deadline');
  const replayBefore = await readJson(`SELECT jsonb_build_object(
    'operations',(SELECT count(*) FROM public.business_operations
      WHERE idempotency_key='phase42-expired-replay-return'),
    'events',(SELECT count(*) FROM public.sales_return_events
      WHERE order_id=${sqlLiteral(replaySale.orderId)}),
    'movements',(SELECT count(*) FROM public.inventory_movements
      WHERE reference_type='phase4_sales_return'
        AND reference_id=${sqlLiteral(settled.returnId)})
  );`);
  await backdateSaleCompletion(replaySale.operationId);
  const replay = await readJson(settleReturnSql({
    fixture: replaySale, key: 'phase42-expired-replay-return', quantity: 1,
    method: 'cash',
  }), 'Replay settled Return after deadline');
  assert.deepEqual(replay, settled);
  const replayAfter = await readJson(`SELECT jsonb_build_object(
    'operations',(SELECT count(*) FROM public.business_operations
      WHERE idempotency_key='phase42-expired-replay-return'),
    'events',(SELECT count(*) FROM public.sales_return_events
      WHERE order_id=${sqlLiteral(replaySale.orderId)}),
    'movements',(SELECT count(*) FROM public.inventory_movements
      WHERE reference_type='phase4_sales_return'
        AND reference_id=${sqlLiteral(settled.returnId)})
  );`);
  assert.deepEqual(replayAfter, replayBefore);

  const parcelSale = await readJson(`${ownerClaims} SELECT public.create_pos_sale_v2(
    ${sqlLiteral(warehouseId)},${sqlLiteral(branchId)},NULL,'Missing price evidence','cash',
    jsonb_build_array(jsonb_build_object(
      'commercial_line_kind','configurable_parcel',
      'family_product_id',${sqlLiteral(familyId)},
      'parcel_configuration_id',${sqlLiteral(configurationId)},
      'configuration_revision',1,'price_authority','server_catalog',
      'line_discount_in_minor_units',0,
      'parcel_instances',jsonb_build_array(jsonb_build_object(
        'components',jsonb_build_array(
          jsonb_build_object('product_id',${sqlLiteral(productA)},'base_quantity',2),
          jsonb_build_object('product_id',${sqlLiteral(productB)},'base_quantity',3)
        )
      ))
    )),0,5000,'phase42-missing-price-sale');`, 'Create missing-price Parcel sale');
  const parcel = await readJson(`SELECT jsonb_build_object(
    'orderId',customer_order.id,'orderItemId',item.id,'parcelId',instance.id,
    'components',(SELECT jsonb_agg(jsonb_build_object(
      'id',component.id,'productId',component.product_id,
      'quantity',component.base_quantity) ORDER BY component.id)
      FROM public.order_parcel_components component
      WHERE component.parcel_instance_id=instance.id)
  ) FROM public.orders customer_order
  JOIN public.order_items item ON item.order_id=customer_order.id
  JOIN public.order_parcel_instances instance ON instance.order_item_id=item.id
  WHERE customer_order.id=${sqlLiteral(parcelSale.orderId)};`);
  const [damaged, accepted] = parcel.components;
  await runSqlText(`
    ALTER TABLE public.order_parcel_components
      DISABLE TRIGGER trg_guard_order_parcel_component_history;
    UPDATE public.order_parcel_components
    SET effective_standalone_unit_sale_price_snapshot_in_minor_units=NULL
    WHERE id=${sqlLiteral(damaged.id)};
    ALTER TABLE public.order_parcel_components
      ENABLE TRIGGER trg_guard_order_parcel_component_history;`,
  'Remove isolated historical standalone price evidence');
  const request = JSON.stringify([{
    return_scope: 'parcel_instance', order_item_id: parcel.orderItemId,
    parcel_instance_id: parcel.parcelId,
    components: [
      {
        parcel_component_id: damaged.id,
        accepted_quantity: damaged.quantity - 1, rejected_quantity: 1,
        accepted_condition: 'sellable', accepted_stock_disposition: 'restock',
        rejection_reason: 'customer_damage',
        rejected_stock_disposition: 'returned_to_customer',
      },
      {
        parcel_component_id: accepted.id,
        accepted_quantity: accepted.quantity, rejected_quantity: 0,
        accepted_condition: 'sellable', accepted_stock_disposition: 'restock',
        rejection_reason: null, rejected_stock_disposition: null,
      },
    ],
  }]);
  await expectSqlError(`${ownerClaims} SELECT public.settle_sales_return_v1(
    ${sqlLiteral(parcel.orderId)},'phase42-missing-price-return',
    ${sqlLiteral(request)}::jsonb,'Missing historical price','cash',NULL,NULL);`,
  /PHASE42_PARCEL_COMPONENT_EVIDENCE_INVALID/u,
  'Missing historical standalone price rejection');
  const missingPriceState = await readJson(`SELECT jsonb_build_object(
    'operations',(SELECT count(*) FROM public.business_operations
      WHERE idempotency_key='phase42-missing-price-return'), -- gitleaks:allow test fixture
    'events',(SELECT count(*) FROM public.sales_return_events
      WHERE order_id=${sqlLiteral(parcel.orderId)})
  );`);
  assert.deepEqual(missingPriceState, { operations: 0, events: 0 });

  return {
    expiredNewOperationRejected: true,
    committedReplayAfter48h: true,
    replayZeroNewBusinessWrites: true,
    missingHistoricalStandalonePriceFailsSafe: true,
  };
};

const startSession = (name) => {
  const child = spawn('docker', [
    'exec', '-i', databaseContainer, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
  ], { cwd: projectRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdin.write(`SET application_name=${sqlLiteral(name)};
    SET statement_timeout='30s'; SET lock_timeout='20s';\n`);
  const completed = new Promise((resolve) => {
    child.on('close', (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
  return { child, completed, output: () => ({ stdout, stderr }) };
};

const waitForBlocked = async (name) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = await readJson(`SELECT jsonb_build_object('blocked',exists(
      SELECT 1 FROM pg_stat_activity activity
      WHERE activity.application_name=${sqlLiteral(name)}
        AND cardinality(pg_blocking_pids(activity.pid))>0));`);
    if (state.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Session ${name} did not block as expected.`);
};

const runReturnRace = async () => {
  const fixture = await createBaseSale({
    key: 'phase42-race-return-sale-0001', quantity: 1, // gitleaks:allow test fixture
    paymentMethod: 'cash', amountPaid: 1000,
  });
  const deadlocksBefore = await readJson(`SELECT jsonb_build_object('value',deadlocks)
    FROM pg_stat_database WHERE datname=current_database();`);
  const blocker = startSession('phase42-return-race-blocker');
  blocker.child.stdin.write(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended(
    'phase4-order|'||${sqlLiteral(fixture.orderId)}::uuid::text,0));
    SELECT 'ROOT_HELD';\n`);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (blocker.output().stdout.includes('ROOT_HELD')) break;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  const first = startSession('phase42-return-race-a');
  const second = startSession('phase42-return-race-b');
  first.child.stdin.end(`${settleReturnSql({ fixture,
    key: 'phase42-race-return-a-0001', quantity: 1, method: 'cash' })}\n`); // gitleaks:allow test fixture
  second.child.stdin.end(`${settleReturnSql({ fixture,
    key: 'phase42-race-return-b-0001', quantity: 1, method: 'cash' })}\n`); // gitleaks:allow test fixture
  await Promise.all([
    waitForBlocked('phase42-return-race-a'),
    waitForBlocked('phase42-return-race-b'),
  ]);
  blocker.child.stdin.end('COMMIT;\n');
  await blocker.completed;
  const results = await Promise.all([first.completed, second.completed]);
  assert.equal(results.filter((result) => result.code === 0).length, 1);
  assert.equal(results.filter((result) => result.code !== 0).length, 1);
  assert.match(results.find((result) => result.code !== 0).stderr,
    /PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED/u);
  const finalState = await readJson(`SELECT jsonb_build_object(
    'settled',(SELECT count(*) FROM public.sales_return_events
      WHERE order_id=${sqlLiteral(fixture.orderId)} AND settlement_status='settled'),
    'effects',(SELECT count(*) FROM public.phase42_return_inventory_effects effect
      JOIN public.sales_return_events event ON event.id=effect.return_event_id
      WHERE event.order_id=${sqlLiteral(fixture.orderId)}),
    'consumed',(SELECT coalesce(sum(consumption.consumed_quantity),0)
      FROM public.sales_aftercare_consumptions consumption
      JOIN public.business_operations operation ON operation.id=consumption.operation_id
      WHERE operation.request_identity_snapshot->>'order_id'=${sqlLiteral(fixture.orderId)})
  );`);
  assert.deepEqual(finalState, { settled: 1, effects: 1, consumed: 1 });
  const deadlocksAfter = await readJson(`SELECT jsonb_build_object('value',deadlocks)
    FROM pg_stat_database WHERE datname=current_database();`);
  const deadlockDelta = Number(deadlocksAfter.value) - Number(deadlocksBefore.value);
  assert.equal(deadlockDelta, 0);
  return { deadlockDelta, exactlyOneSettlement: true, loserZeroPartialWrites: true };
};

const runQueuedRace = async ({ label, orderId, firstSql, secondSql }) => {
  const blockerName = `phase42-${label}-blocker`;
  const firstName = `phase42-${label}-first`;
  const secondName = `phase42-${label}-second`;
  const blocker = startSession(blockerName);
  blocker.child.stdin.write(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended(
    'phase4-order|'||${sqlLiteral(orderId)}::uuid::text,0));
    SELECT 'ROOT_HELD';\n`);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (blocker.output().stdout.includes('ROOT_HELD')) break;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  const first = startSession(firstName);
  first.child.stdin.end(`${firstSql}\n`);
  await waitForBlocked(firstName);
  const second = startSession(secondName);
  second.child.stdin.end(`${secondSql}\n`);
  await waitForBlocked(secondName);
  blocker.child.stdin.end('COMMIT;\n');
  await blocker.completed;
  const [firstResult, secondResult] = await Promise.all([
    first.completed, second.completed,
  ]);
  return { firstResult, secondResult };
};

const runReturnPosReversalRace = async () => {
  const posFirstSale = await createBaseSale({
    key: 'phase42-pos-first-race-sale', quantity: 1,
    paymentMethod: 'cash', amountPaid: 1000,
  });
  const rootBlocker = startSession('phase42-pos-first-root-blocker');
  rootBlocker.child.stdin.write(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended(
    'phase4-order|'||${sqlLiteral(posFirstSale.orderId)}::uuid::text,0));
    SELECT 'ROOT_HELD';\n`);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (rootBlocker.output().stdout.includes('ROOT_HELD')) break;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  const waitingReturn = startSession('phase42-pos-first-return-waiter');
  waitingReturn.child.stdin.end(`${settleReturnSql({
    fixture: posFirstSale, key: 'phase42-pos-first-return', quantity: 1,
    method: 'cash',
  })}\n`);
  await waitForBlocked('phase42-pos-first-return-waiter');
  const reversal = await readJson(`${ownerClaims} SELECT public.reverse_pos_sale(
    ${sqlLiteral(posFirstSale.orderId)},'POS wins concurrency proof',
    'phase42-pos-first-reversal-key');`);
  assert.equal(reversal.success, true);
  rootBlocker.child.stdin.end('COMMIT;\n');
  await rootBlocker.completed;
  const returnAfterReversal = await waitingReturn.completed;
  assert.notEqual(returnAfterReversal.code, 0);
  assert.match(returnAfterReversal.stderr, /PHASE42_ORIGINAL_SALE_INVALID/u);

  const returnFirstSale = await createBaseSale({
    key: 'phase42-return-first-pos-race-sale', quantity: 1,
    paymentMethod: 'cash', amountPaid: 1000,
  });
  const shiftBlocker = startSession('phase42-return-first-shift-blocker');
  shiftBlocker.child.stdin.write(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended(
    'cash-shift-full-reversal:'||${sqlLiteral(returnFirstSale.shiftId)}::uuid::text,0));
    SELECT 'SHIFT_GATE_HELD';\n`);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (shiftBlocker.output().stdout.includes('SHIFT_GATE_HELD')) break;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  const waitingReversal = startSession('phase42-return-first-pos-waiter');
  waitingReversal.child.stdin.end(`${ownerClaims} SELECT public.reverse_pos_sale(
    ${sqlLiteral(returnFirstSale.orderId)},'Return wins concurrency proof',
    'phase42-return-first-pos-reversal-key');\n`);
  await waitForBlocked('phase42-return-first-pos-waiter');
  const settledReturn = await readJson(settleReturnSql({
    fixture: returnFirstSale, key: 'phase42-return-first-pos-return', quantity: 1,
    method: 'cash',
  }));
  assert.equal(settledReturn.success, true);
  shiftBlocker.child.stdin.end('COMMIT;\n');
  await shiftBlocker.completed;
  const reversalAfterReturn = await waitingReversal.completed;
  assert.notEqual(reversalAfterReturn.code, 0);
  assert.match(reversalAfterReturn.stderr,
    /PHASE4_AFTERCARE_DEPENDENCY_BLOCKS_REVERSAL|PHASE3_POS_REVERSAL_LATER_MOVEMENT/u);

  const state = await readJson(`SELECT jsonb_build_object(
    'posFirstReturnRows',(SELECT count(*) FROM public.sales_return_events
      WHERE order_id=${sqlLiteral(posFirstSale.orderId)}),
    'returnFirstSettled',(SELECT count(*) FROM public.sales_return_events
      WHERE order_id=${sqlLiteral(returnFirstSale.orderId)}
        AND settlement_status='settled'),
    'returnFirstReversals',(SELECT count(*) FROM public.pos_sale_reversals
      WHERE order_id=${sqlLiteral(returnFirstSale.orderId)})
  );`);
  assert.deepEqual(state, {
    posFirstReturnRows: 0,
    returnFirstSettled: 1,
    returnFirstReversals: 0,
  });
  return { posWinsDirection: true, returnWinsDirection: true };
};

const runReturnFullShiftRace = async () => {
  const shiftFirstSale = await createDedicatedShiftSale({
    suffix: 'SHIFT-FIRST',
    branchUuid: '92500000-0000-4000-8000-000000000101',
    warehouseUuid: '92500000-0000-4000-8000-000000000102',
    shiftUuid: '92500000-0000-4000-8000-000000000103',
  });
  const rootBlocker = startSession('phase42-shift-first-root-blocker');
  rootBlocker.child.stdin.write(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended(
    'phase4-order|'||${sqlLiteral(shiftFirstSale.orderId)}::uuid::text,0));
    SELECT 'ROOT_HELD';\n`);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (rootBlocker.output().stdout.includes('ROOT_HELD')) break;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  const waitingReturn = startSession('phase42-shift-first-return-waiter');
  waitingReturn.child.stdin.end(`${settleReturnSql({
    fixture: shiftFirstSale, key: 'phase42-shift-first-return', quantity: 1,
    method: 'cash',
  })}\n`);
  await waitForBlocked('phase42-shift-first-return-waiter');
  const reversedShift = await readJson(`${ownerClaims}
    SELECT public.reverse_cash_shift_with_operations(
      ${sqlLiteral(shiftFirstSale.shiftId)},'Shift wins concurrency proof',
      'phase42-shift-first-reversal');`, 'Full Shift reversal wins');
  assert.equal(reversedShift.success, true);
  rootBlocker.child.stdin.end('COMMIT;\n');
  await rootBlocker.completed;
  const returnAfterShift = await waitingReturn.completed;
  assert.notEqual(returnAfterShift.code, 0);
  assert.match(returnAfterShift.stderr,
    /PHASE4_OPEN_SHIFT_REQUIRED|PHASE42_ORIGINAL_SALE_INVALID|PHASE4_ORIGINAL_SALE_NOT_COMPLETED/u);

  const returnFirstSale = await createDedicatedShiftSale({
    suffix: 'RETURN-FIRST',
    branchUuid: '92500000-0000-4000-8000-000000000111',
    warehouseUuid: '92500000-0000-4000-8000-000000000112',
    shiftUuid: '92500000-0000-4000-8000-000000000113',
  });
  const shiftBlocker = startSession('phase42-return-first-full-shift-blocker');
  shiftBlocker.child.stdin.write(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended(
    'cash-shift-full-reversal:'||${sqlLiteral(returnFirstSale.shiftId)}::uuid::text,0));
    SELECT 'SHIFT_GATE_HELD';\n`);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (shiftBlocker.output().stdout.includes('SHIFT_GATE_HELD')) break;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  const waitingShift = startSession('phase42-return-first-full-shift-waiter');
  waitingShift.child.stdin.end(`${ownerClaims}
    SELECT public.reverse_cash_shift_with_operations(
      ${sqlLiteral(returnFirstSale.shiftId)},'Return wins concurrency proof',
      'phase42-return-first-shift-reversal');\n`);
  await waitForBlocked('phase42-return-first-full-shift-waiter');
  const settledReturn = await readJson(settleReturnSql({
    fixture: returnFirstSale, key: 'phase42-return-first-shift-return', quantity: 1,
    method: 'cash',
  }), 'Return wins over full Shift reversal');
  assert.equal(settledReturn.success, true);
  shiftBlocker.child.stdin.end('COMMIT;\n');
  await shiftBlocker.completed;
  const shiftAfterReturn = await waitingShift.completed;
  assert.notEqual(shiftAfterReturn.code, 0);
  assert.match(shiftAfterReturn.stderr, /PHASE42_SETTLED_RETURN_REFUND_DEPENDENCY/u);

  const state = await readJson(`SELECT jsonb_build_object(
    'shiftFirstReturns',(SELECT count(*) FROM public.sales_return_events
      WHERE order_id=${sqlLiteral(shiftFirstSale.orderId)}),
    'shiftFirstReversal',(SELECT count(*) FROM public.cash_shift_reversals
      WHERE shift_id=${sqlLiteral(shiftFirstSale.shiftId)}),
    'returnFirstSettled',(SELECT count(*) FROM public.sales_return_events
      WHERE order_id=${sqlLiteral(returnFirstSale.orderId)}
        AND settlement_status='settled'),
    'returnFirstReversal',(SELECT count(*) FROM public.cash_shift_reversals
      WHERE shift_id=${sqlLiteral(returnFirstSale.shiftId)})
  );`);
  assert.deepEqual(state, {
    shiftFirstReturns: 0,
    shiftFirstReversal: 1,
    returnFirstSettled: 1,
    returnFirstReversal: 0,
  });
  return { shiftWinsDirection: true, returnWinsDirection: true };
};

const runReturnReplacementRace = async () => {
  const replacementFirstSale = await createBaseSale({
    key: 'phase42-replacement-first-sale', quantity: 1,
    paymentMethod: 'cash', amountPaid: 1000,
  });
  const replacementFirstIds = {
    operationId: '92510000-0000-4000-8000-000000000101',
    eventId: '92510000-0000-4000-8000-000000000102',
    itemId: '92510000-0000-4000-8000-000000000103',
  };
  const replacementFirst = await runQueuedRace({
    label: 'replacement-first', orderId: replacementFirstSale.orderId,
    firstSql: replacementSettlementSql({
      fixture: replacementFirstSale, key: 'phase42-replacement-first-operation',
      ...replacementFirstIds,
    }),
    secondSql: settleReturnSql({
      fixture: replacementFirstSale, key: 'phase42-replacement-first-return',
      quantity: 1, method: 'cash',
    }),
  });
  assert.equal(replacementFirst.firstResult.code, 0,
    replacementFirst.firstResult.stderr);
  assert.notEqual(replacementFirst.secondResult.code, 0);
  assert.match(replacementFirst.secondResult.stderr,
    /PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED/u);

  const returnFirstSale = await createBaseSale({
    key: 'phase42-return-first-replacement-sale', quantity: 1,
    paymentMethod: 'cash', amountPaid: 1000,
  });
  const returnFirstIds = {
    operationId: '92510000-0000-4000-8000-000000000111',
    eventId: '92510000-0000-4000-8000-000000000112',
    itemId: '92510000-0000-4000-8000-000000000113',
  };
  const returnFirst = await runQueuedRace({
    label: 'return-before-replacement', orderId: returnFirstSale.orderId,
    firstSql: settleReturnSql({
      fixture: returnFirstSale, key: 'phase42-return-before-replacement', // gitleaks:allow test fixture
      quantity: 1, method: 'cash',
    }),
    secondSql: replacementSettlementSql({
      fixture: returnFirstSale, key: 'phase42-return-first-replacement-operation',
      ...returnFirstIds,
    }),
  });
  assert.equal(returnFirst.firstResult.code, 0, returnFirst.firstResult.stderr);
  assert.notEqual(returnFirst.secondResult.code, 0);
  assert.match(returnFirst.secondResult.stderr,
    /PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED/u);

  const state = await readJson(`SELECT jsonb_build_object(
    'replacementFirstSettled',(SELECT count(*) FROM public.sales_replacement_events
      WHERE id=${sqlLiteral(replacementFirstIds.eventId)}
        AND replacement_status='settled'),
    'replacementFirstReturns',(SELECT count(*) FROM public.sales_return_events
      WHERE order_id=${sqlLiteral(replacementFirstSale.orderId)}),
    'returnFirstSettled',(SELECT count(*) FROM public.sales_return_events
      WHERE order_id=${sqlLiteral(returnFirstSale.orderId)}
        AND settlement_status='settled'),
    'returnFirstReplacementOperations',(SELECT count(*) FROM public.business_operations
      WHERE id=${sqlLiteral(returnFirstIds.operationId)}),
    'returnFirstReplacementEvents',(SELECT count(*) FROM public.sales_replacement_events
      WHERE id=${sqlLiteral(returnFirstIds.eventId)}),
    'returnFirstReplacementItems',(SELECT count(*) FROM public.sales_replacement_items
      WHERE id=${sqlLiteral(returnFirstIds.itemId)})
  );`);
  assert.deepEqual(state, {
    replacementFirstSettled: 1,
    replacementFirstReturns: 0,
    returnFirstSettled: 1,
    returnFirstReplacementOperations: 0,
    returnFirstReplacementEvents: 0,
    returnFirstReplacementItems: 0,
  });
  return { replacementWinsDirection: true, returnWinsDirection: true };
};

const runCrossOperationConcurrency = async () => {
  const deadlocksBefore = await readJson(`SELECT jsonb_build_object('value',deadlocks)
    FROM pg_stat_database WHERE datname=current_database();`);

  const returnFirstSale = await createBaseSale({
    key: 'phase42-payment-race-return-first-sale', quantity: 1,
    paymentMethod: 'debt', amountPaid: 0, customer: customerId,
  });
  const returnFirst = await runQueuedRace({
    label: 'payment-return-first', orderId: returnFirstSale.orderId,
    firstSql: settleReturnSql({
      fixture: returnFirstSale, key: 'phase42-payment-race-return-first', quantity: 1,
    }),
    secondSql: `${ownerClaims} SELECT public.record_customer_order_payment(
      ${sqlLiteral(returnFirstSale.orderId)},1000,'cash',NULL,'Concurrent payment');`,
  });
  assert.equal(returnFirst.firstResult.code, 0, returnFirst.firstResult.stderr);
  assert.notEqual(returnFirst.secondResult.code, 0);
  assert.match(returnFirst.secondResult.stderr,
    /PHASE42_CUSTOMER_PAYMENT_EXCEEDS_EFFECTIVE_OUTSTANDING/u);

  const paymentFirstSale = await createBaseSale({
    key: 'phase42-payment-race-payment-first-sale', quantity: 1,
    paymentMethod: 'debt', amountPaid: 0, customer: customerId,
  });
  const paymentFirst = await runQueuedRace({
    label: 'payment-payment-first', orderId: paymentFirstSale.orderId,
    firstSql: `${ownerClaims} SELECT public.record_customer_order_payment(
      ${sqlLiteral(paymentFirstSale.orderId)},1000,'cash',NULL,'Concurrent payment');`,
    secondSql: settleReturnSql({
      fixture: paymentFirstSale, key: 'phase42-payment-race-payment-second', quantity: 1,
    }),
  });
  assert.equal(paymentFirst.firstResult.code, 0, paymentFirst.firstResult.stderr);
  assert.notEqual(paymentFirst.secondResult.code, 0);
  assert.match(paymentFirst.secondResult.stderr, /PHASE42_REFUND_METHOD_INVALID/u);

  const reversalSale = await createBaseSale({
    key: 'phase42-payment-reversal-race-sale', quantity: 1,
    paymentMethod: 'debt', amountPaid: 0, customer: customerId,
  });
  await readJson(`${ownerClaims} SELECT public.record_customer_order_payment(
    ${sqlLiteral(reversalSale.orderId)},1000,'cash',NULL,'Reversal race payment');`);
  const payment = await readJson(`SELECT jsonb_build_object('id',id)
    FROM public.customer_payments
    WHERE order_id=${sqlLiteral(reversalSale.orderId)} AND is_reversed=false;`);
  const reversalRace = await runQueuedRace({
    label: 'payment-reversal', orderId: reversalSale.orderId,
    firstSql: settleReturnSql({
      fixture: reversalSale, key: 'phase42-payment-reversal-return', quantity: 1,
      method: 'cash',
    }),
    secondSql: `${ownerClaims} SELECT public.reverse_customer_order_payment(
      ${sqlLiteral(payment.id)},'Concurrent reversal blocked by Return');`,
  });
  assert.equal(reversalRace.firstResult.code, 0, reversalRace.firstResult.stderr);
  assert.notEqual(reversalRace.secondResult.code, 0);
  assert.match(reversalRace.secondResult.stderr,
    /PHASE4_AFTERCARE_DEPENDENCY_BLOCKS_REVERSAL/u);

  const posReversal = await runReturnPosReversalRace();
  const fullShiftReversal = await runReturnFullShiftRace();
  const replacement = await runReturnReplacementRace();

  const state = await readJson(`SELECT jsonb_build_object(
    'returnFirstSettled',(SELECT count(*) FROM public.sales_return_events
      WHERE order_id=${sqlLiteral(returnFirstSale.orderId)} AND settlement_status='settled'),
    'paymentFirstReturnRows',(SELECT count(*) FROM public.sales_return_events
      WHERE order_id=${sqlLiteral(paymentFirstSale.orderId)}),
    'reversalStillActive',(SELECT count(*) FROM public.customer_payments
      WHERE id=${sqlLiteral(payment.id)} AND is_reversed=false),
    'returnFirstPosDirection',${posReversal.returnWinsDirection}
  );`);
  assert.deepEqual(state, {
    returnFirstSettled: 1,
    paymentFirstReturnRows: 0,
    reversalStillActive: 1,
    returnFirstPosDirection: true,
  });

  const deadlocksAfter = await readJson(`SELECT jsonb_build_object('value',deadlocks)
    FROM pg_stat_database WHERE datname=current_database();`);
  const deadlockDelta = Number(deadlocksAfter.value) - Number(deadlocksBefore.value);
  assert.equal(deadlockDelta, 0);
  return {
    returnVsPaymentBothDirections: true,
    returnVsPaymentReversal: true,
    returnVsPosReversal: posReversal,
    returnVsFullShiftReversal: fullShiftReversal,
    returnVsReplacement: replacement,
    deadlockDelta,
    losingTransactionsZeroPartialWrites: true,
  };
};

try {
  const { stdout } = await execFileAsync(process.execPath, [bootstrapPath], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NAWASRAH_ISOLATED_PROJECT_ID: projectId,
      NAWASRAH_SKIP_REDUNDANT_DB_RESET: 'true',
      NAWASRAH_SUPABASE_EXCLUDE:
        'realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor',
    },
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    timeout: 420_000,
  });
  const bootstrap = JSON.parse(stdout);
  assert.equal(bootstrap.ok, true);
  assert.equal(bootstrap.authBaselineEmpty, true);
  isolatedProjectRoot = bootstrap.isolatedProjectRoot;

  const phase3Sql = await readFile(phase3SqlPath, 'utf8');
  const phase3 = await readJson(phase3Sql, 'Phase 3 prerequisite fixture');
  assert.equal(phase3.ok, true);
  const settlementEvidenceBinding = await runSettlementEvidenceBindingMatrix();
  const core = await runCoreMatrix();
  const temporalAndEvidence = await runTemporalAndEvidenceMatrix();
  const concurrency = await runReturnRace();
  const crossOperationConcurrency = await runCrossOperationConcurrency();

  const { stdout: lintOutput } = await execFileAsync(
    process.execPath,
    [cliPath, 'db', 'lint', '--local', '--level', 'warning', '--workdir', isolatedProjectRoot],
    { cwd: projectRoot, windowsHide: true, maxBuffer: 1024 * 1024, timeout: 120_000 },
  );
  if (/ERROR:/u.test(lintOutput)) throw new Error(`Database lint failed:\n${lintOutput}`);

  console.log(JSON.stringify({
    ok: true,
    freshRebuild: '001-121',
    phase3PrerequisiteScenarios: phase3.scenarios.length,
    settlementEvidenceBinding,
    core,
    temporalAndEvidence,
    concurrency,
    crossOperationConcurrency,
  }, null, 2));
} finally {
  if (isolatedProjectRoot) {
    await execFileAsync(
      process.execPath,
      [cliPath, 'stop', '--no-backup', '--workdir', isolatedProjectRoot],
      { cwd: projectRoot, windowsHide: true, maxBuffer: 1024 * 1024, timeout: 120_000 },
    );
  }
}
