import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { verifyConsumptionIdentity } from './phase43-consumption-identity-probes.mjs';

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..');
const bootstrapPath = path.join(scriptDirectory, 'bootstrap-isolated-supabase.mjs');
const phase3SqlPath = path.join(scriptDirectory, 'phase3-configurable-parcel-contracts-runtime.sql');
const cliPath = path.join(projectRoot, 'node_modules', 'supabase', 'dist', 'supabase.js');
const projectId = 'nawasrah-phase43-aftercare-test';
const databaseContainer = `supabase_db_${projectId}`;
const ownerId = '92400000-0000-0000-0000-000000000001';
const warehouseId = '92400000-0000-0000-0000-000000000201';
const branchId = '92400000-0000-0000-0000-000000000200';
const productId = '92400000-0000-0000-0000-000000000101';
const productBId = '92400000-0000-0000-0000-000000000102';
const familyProductId = '92400000-0000-0000-0000-000000000100';
const parcelConfigurationId = '92400000-0000-0000-0000-000000000300';
const ownerClaims = `SELECT set_config('request.jwt.claims',
  '{"sub":"${ownerId}","role":"authenticated","aal":"aal2"}',false);`;
let isolatedProjectRoot = '';

const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;

const runSql = async (sql, label, {failure = false} = {}) => new Promise((resolve, reject) => {
  const child = spawn('docker', ['exec', '-i', databaseContainer, 'psql', '-U', 'postgres',
    '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'],
  {cwd: projectRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', (code) => {
    if ((!failure && code !== 0) || (failure && code === 0)) {
      reject(new Error(`${label} unexpected exit ${code}:\n${stderr}\n${stdout}`)); return;
    }
    resolve({code, stdout: stdout.trim(), stderr: stderr.trim()});
  });
  child.stdin.end(`SET statement_timeout='60s'; SET lock_timeout='30s';\n${sql}`);
});

const json = async (sql, label) => {
  const result = await runSql(sql, label);
  const value = result.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).at(-1);
  assert.ok(value, `${label} returned no JSON`);
  return JSON.parse(value);
};

const createSale = async (key, quantity = 2) => {
  const items = JSON.stringify([{commercial_line_kind: 'base_unit', product_id: productId,
    base_quantity: quantity, price_authority: 'server_catalog', line_discount_in_minor_units: 0}]);
  const result = await json(`${ownerClaims}
    SELECT public.create_pos_sale_v2(${literal(warehouseId)},${literal(branchId)},NULL,
      'Phase 4.3 replacement runtime','cash',${literal(items)}::jsonb,0,10000,${literal(key)});`,
  `create sale ${key}`);
  assert.equal(result.success, true);
  return json(`SELECT jsonb_build_object('orderId',customer_order.id,
    'orderItemId',item.id,'productId',item.product_id,'warehouseId',customer_order.warehouse_id,
    'branchId',customer_order.branch_id,'operationId',customer_order.operation_id,
    'completion',operation.completed_at,'quantity',item.quantity)
    FROM public.orders customer_order JOIN public.order_items item ON item.order_id=customer_order.id
    JOIN public.business_operations operation ON operation.id=customer_order.operation_id
    WHERE customer_order.id=${literal(result.orderId)};`, `read sale ${key}`);
};

const createCustomerV2Sale = async () => {
  const key = randomUUID();
  const phone = `079${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
  await runSql(`UPDATE public.storefront_settings SET orders_enabled=true,
      minimum_order_in_minor_units=0,inside_ramtha_delivery_fee_in_minor_units=0,
      outside_ramtha_delivery_fee_in_minor_units=0;
    INSERT INTO public.inventory_balances(warehouse_id,product_id,on_hand_quantity,reserved_quantity)
    SELECT warehouse.id,${literal(productId)},100,0 FROM public.warehouses warehouse
    JOIN public.branches branch ON branch.id=warehouse.branch_id
    WHERE warehouse.is_active AND branch.is_active
    ON CONFLICT (warehouse_id,product_id) DO UPDATE
      SET on_hand_quantity=public.inventory_balances.on_hand_quantity+100;`,
  'enable Customer V2 fixture');
  const submitted = await json(`SELECT set_config('request.jwt.claim.role','service_role',false);
    SELECT public.submit_guest_customer_order_v2(
      ${literal(key)},repeat('c',64),repeat('d',64),'Phase 4.3 customer',${literal(phone)},
      'إربد','الرمثا','الحي الشرقي','شارع الاختبار',NULL,NULL,NULL,NULL,NULL,NULL,
      ${literal(JSON.stringify([{commercial_line_kind: 'base_unit', product_id: productId,
        base_quantity: 1, expected_unit_price_in_minor_units: 1000}]))}::jsonb,
      NULL,'cash_on_delivery','inside_ramtha',1000,0,0,1000);`, 'submit Customer V2');
  assert.ok(submitted.order_id);
  await runSql(`INSERT INTO public.cash_shifts(
      id,shift_number,branch_id,opened_by,opening_cash_in_minor_units
    ) SELECT ${literal(randomUUID())},${literal(`P43-${phone}`)},customer_order.branch_id,
      ${literal(ownerId)},0 FROM public.orders customer_order
      WHERE customer_order.id=${literal(submitted.order_id)}
      AND NOT EXISTS (SELECT 1 FROM public.cash_shifts shift_row
        WHERE shift_row.branch_id=customer_order.branch_id AND shift_row.status='open');
    UPDATE public.orders SET status='ready' WHERE id=${literal(submitted.order_id)};`,
  'ready Customer V2');
  const completed = await json(`${ownerClaims}
    SELECT public.complete_website_order_with_settlement_v2(
      ${literal(submitted.order_id)},${literal(randomUUID())},'cash',1000,0,NULL,
      'Phase 4.3 Customer completion');`, 'complete Customer V2');
  assert.equal(completed.success, true);
  return json(`SELECT jsonb_build_object('orderId',customer_order.id,
    'orderItemId',item.id,'productId',item.product_id,
    'warehouseId',customer_order.warehouse_id,'operationId',customer_order.operation_id,
    'quantity',item.quantity) FROM public.orders customer_order
    JOIN public.order_items item ON item.order_id=customer_order.id
    WHERE customer_order.id=${literal(submitted.order_id)};`, 'read Customer V2');
};

const createParcelSale = async () => {
  await runSql(`UPDATE public.configurable_parcel_feature_settings
    SET feature_state='OWNER_PILOT',updated_at=clock_timestamp()
    WHERE feature_key='configurable_parcels';`, 'enable parcel fixture');
  const key = `phase43-parcel-${randomUUID()}`;
  const lines = JSON.stringify([{
    commercial_line_kind: 'configurable_parcel',
    family_product_id: familyProductId,
    parcel_configuration_id: parcelConfigurationId,
    configuration_revision: 1,
    price_authority: 'server_catalog',
    line_discount_in_minor_units: 0,
    parcel_instances: [{components: [
      {product_id: productId, base_quantity: 2},
      {product_id: productBId, base_quantity: 3},
    ]}],
  }]);
  const result = await json(`${ownerClaims} SELECT public.create_pos_sale_v2(
    ${literal(warehouseId)},${literal(branchId)},NULL,'Phase 4.3 parcel family',
    'cash',${literal(lines)}::jsonb,0,5000,${literal(key)});`, 'create parcel sale');
  assert.equal(result.success, true);
  return json(`SELECT jsonb_build_object(
    'orderId',customer_order.id,'orderItemId',order_item.id,
    'parcelInstanceId',instance.id,'warehouseId',customer_order.warehouse_id,
    'components',(SELECT jsonb_agg(jsonb_build_object(
      'id',component.id,'productId',component.product_id,'quantity',component.base_quantity
    ) ORDER BY component.product_id) FROM public.order_parcel_components component
      WHERE component.parcel_instance_id=instance.id)
  ) FROM public.orders customer_order
  JOIN public.order_items order_item ON order_item.order_id=customer_order.id
    AND order_item.commercial_line_kind='configurable_parcel'
  JOIN public.order_parcel_instances instance ON instance.order_item_id=order_item.id
  WHERE customer_order.id=${literal(result.orderId)};`, 'read parcel sale');
};

const createLegacyPosSale = async () => {
  const key = `phase43-legacy-pos-${randomUUID()}`;
  const result = await json(`${ownerClaims} SELECT public.create_pos_sale(
    ${literal(warehouseId)},${literal(branchId)},NULL,'Legacy POS fixture','cash',
    ${literal(JSON.stringify([{product_id: productId, quantity: 1}]))}::jsonb,
    0,1000000,${literal(key)});`, 'create real Legacy POS V1');
  assert.equal(result.success, true);
  return result.orderId;
};

const createLegacyWebsiteSale = async () => {
  const key = randomUUID();
  const phone = `078${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
  await runSql(`UPDATE public.storefront_settings SET orders_enabled=true,
      minimum_order_in_minor_units=0,inside_ramtha_delivery_fee_in_minor_units=0;`,
  'enable Legacy Website fixture');
  const submitted = await json(`SELECT set_config('request.jwt.claim.role','service_role',false);
    SELECT public.submit_guest_customer_order(
      ${literal(key)},'Legacy Website fixture',${literal(phone)},'إربد','الرمثا',
      'الحي الشرقي','شارع الاختبار',NULL,NULL,NULL,NULL,NULL,NULL,
      ${literal(JSON.stringify([{product_id: productId, quantity: 1}]))}::jsonb,
      NULL,'cash_on_delivery','inside_ramtha');`, 'create real Legacy Website V1');
  const orderId = submitted.order_id;
  assert.ok(orderId);
  await json(`${ownerClaims} SELECT public.accept_order_for_preparation(
    ${literal(orderId)},'Legacy fixture acceptance');`, 'accept Legacy Website V1');
  await json(`${ownerClaims} SELECT public.update_order_status(
    ${literal(orderId)},'ready','Legacy fixture ready');`, 'ready Legacy Website V1');
  const total = Number((await runSql(`SELECT total_in_minor_units FROM public.orders
    WHERE id=${literal(orderId)};`, 'Legacy Website total')).stdout);
  const completed = await json(`${ownerClaims} SELECT public.complete_website_order_with_settlement(
    ${literal(orderId)},'cash',${total},0,NULL,'Legacy fixture completion');`,
  'complete Legacy Website V1');
  assert.equal(completed.success, true);
  return orderId;
};

try {
  const {stdout} = await execFileAsync(process.execPath, [bootstrapPath], {
    cwd: projectRoot,
    env: {...process.env, NAWASRAH_ISOLATED_PROJECT_ID: projectId,
      NAWASRAH_SKIP_REDUNDANT_DB_RESET: 'true',
      NAWASRAH_SUPABASE_EXCLUDE:
        'realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'},
    windowsHide: true, maxBuffer: 1024 * 1024, timeout: 420_000,
  });
  const bootstrap = JSON.parse(stdout);
  assert.equal(bootstrap.ok, true);
  isolatedProjectRoot = bootstrap.isolatedProjectRoot;
  const phase3Sql = await readFile(phase3SqlPath, 'utf8');
  const prerequisite = await json(phase3Sql, 'Phase 3 prerequisite fixture');
  assert.equal(prerequisite.ok, true);
  await verifyConsumptionIdentity({createParcelSale, runSql, json, literal,
    ownerClaims, productId, productBId});

  const sale = await createSale(`phase43-sale-${randomUUID()}`);
  const key = `phase43-replacement-${randomUUID()}`;
  const request = JSON.stringify([{sourceKind: 'base_order_item', sourceId: sale.orderItemId, quantity: 1}]);
  const before = await json(`SELECT jsonb_build_object(
    'stock',(SELECT on_hand_quantity FROM public.inventory_balances
      WHERE warehouse_id=${literal(sale.warehouseId)} AND product_id=${literal(sale.productId)}),
    'wac',(SELECT wac_cost_in_minor_units_exact FROM public.products WHERE id=${literal(sale.productId)}),
    'movements',(SELECT count(*) FROM public.inventory_movements WHERE reference_type='phase4_replacement_item')
  );`, 'before replacement');
  const result = await json(`${ownerClaims} SELECT public.settle_sales_replacement_v1(
    ${literal(sale.orderId)},${literal(key)},${literal(request)}::jsonb,
    'Supplier defect',NULL);`, 'operational replacement');
  assert.equal(result.success, true);
  assert.equal(result.operationalCoordinatorVersion, 403);
  assert.equal(result.issuedQuantity, 1);

  const committed = await json(`SELECT jsonb_build_object(
    'eventStatus',event.replacement_status,'issuanceStatus',event.issuance_status,
    'coordinator',event.issuance_coordinator_version,
    'items',(SELECT count(*) FROM public.sales_replacement_items item WHERE item.operation_id=event.operation_id),
    'effects',(SELECT count(*) FROM public.phase43_replacement_inventory_effects effect WHERE effect.operation_id=event.operation_id),
    'evidence',(SELECT count(*) FROM public.phase43_replacement_settlement_evidence evidence WHERE evidence.operation_id=event.operation_id),
    'stock',(SELECT on_hand_quantity FROM public.inventory_balances WHERE warehouse_id=event.warehouse_id AND product_id=${literal(sale.productId)}),
    'movements',(SELECT count(*) FROM public.inventory_movements WHERE operation_id=event.operation_id),
    'replacementItemId',(SELECT id FROM public.sales_replacement_items item WHERE item.operation_id=event.operation_id),
    'unitCost',(SELECT replacement_unit_cost_snapshot_in_minor_units_exact FROM public.sales_replacement_items item WHERE item.operation_id=event.operation_id),
    'wac',(SELECT wac_cost_in_minor_units_exact FROM public.products WHERE id=${literal(sale.productId)}),
    'refunds',(SELECT count(*) FROM public.sales_return_events returned WHERE returned.order_id=event.root_order_id)
  ) FROM public.sales_replacement_events event WHERE event.id=${literal(result.replacementId)};`,
  'committed replacement evidence');
  assert.deepEqual({eventStatus: committed.eventStatus, issuanceStatus: committed.issuanceStatus,
    coordinator: committed.coordinator, items: committed.items, effects: committed.effects,
    evidence: committed.evidence, movements: committed.movements, refunds: committed.refunds},
  {eventStatus: 'settled', issuanceStatus: 'issued', coordinator: 403,
    items: 1, effects: 1, evidence: 1, movements: 1, refunds: 0});
  assert.equal(Number(committed.stock), Number(before.stock) - 1);
  assert.equal(Number(committed.unitCost), Number(before.wac));
  assert.equal(Number(committed.wac), Number(before.wac));

  const replay = await json(`${ownerClaims} SELECT public.settle_sales_replacement_v1(
    ${literal(sale.orderId)},${literal(key)},${literal(request)}::jsonb,
    'Supplier defect',NULL);`, 'replacement replay');
  assert.equal(replay.operationId, result.operationId);
  const afterReplay = await json(`SELECT jsonb_build_object(
    'stock',(SELECT on_hand_quantity FROM public.inventory_balances
      WHERE warehouse_id=${literal(sale.warehouseId)} AND product_id=${literal(sale.productId)}),
    'movements',(SELECT count(*) FROM public.inventory_movements WHERE operation_id=${literal(result.operationId)}),
    'effects',(SELECT count(*) FROM public.phase43_replacement_inventory_effects WHERE operation_id=${literal(result.operationId)})
  );`, 'after replay');
  assert.deepEqual(afterReplay, {stock: committed.stock, movements: 1, effects: 1});

  const extraMovementReplay = await runSql(`BEGIN;
    INSERT INTO public.inventory_movements(
      warehouse_id,product_id,movement_type,quantity,balance_before,balance_after,
      reference_type,reference_id,notes,created_by,operation_id
    )
    SELECT effect.warehouse_id,effect.product_id,'sales_deduction',-effect.issued_quantity,
      effect.target_balance_before,effect.target_balance_after,
      'phase4_replacement_item',gen_random_uuid(),'Injected extra operation movement',
      operation.initiated_by,effect.operation_id
    FROM public.phase43_replacement_inventory_effects effect
    JOIN public.business_operations operation ON operation.id=effect.operation_id
    WHERE effect.operation_id=${literal(result.operationId)};
    ${ownerClaims}
    SELECT public.settle_sales_replacement_v1(
      ${literal(sale.orderId)},${literal(key)},${literal(request)}::jsonb,
      'Supplier defect',NULL);`, 'extra operation movement replay', {failure: true});
  assert.match(extraMovementReplay.stderr, /PHASE43_REPLACEMENT_EFFECTS_INCOMPLETE/u);

  const extraMovementFinalization = await runSql(`BEGIN;
    SET LOCAL session_replication_role=replica;
    UPDATE public.sales_replacement_events
    SET replacement_status='draft',settled_at=NULL,issuance_status='not_issued',issued_at=NULL
    WHERE operation_id=${literal(result.operationId)};
    UPDATE public.sales_aftercare_consumptions
    SET consumption_state='draft',settled_at=NULL
    WHERE operation_id=${literal(result.operationId)};
    SET LOCAL session_replication_role=origin;
    INSERT INTO public.inventory_movements(
      warehouse_id,product_id,movement_type,quantity,balance_before,balance_after,
      reference_type,reference_id,notes,created_by,operation_id
    )
    SELECT effect.warehouse_id,effect.product_id,'sales_deduction',-effect.issued_quantity,
      effect.target_balance_before,effect.target_balance_after,
      'phase4_replacement_item',gen_random_uuid(),'Injected pre-finalization movement',
      operation.initiated_by,effect.operation_id
    FROM public.phase43_replacement_inventory_effects effect
    JOIN public.business_operations operation ON operation.id=effect.operation_id
    WHERE effect.operation_id=${literal(result.operationId)};
    INSERT INTO public.phase43_replacement_issuance_guards(
      transaction_id,operation_id,replacement_event_id
    ) VALUES (
      pg_current_xact_id(),${literal(result.operationId)},${literal(result.replacementId)}
    );
    SELECT public.phase4_finalize_aftercare_operation_internal(
      ${literal(result.operationId)});`, 'extra operation movement finalization', {failure: true});
  assert.match(extraMovementFinalization.stderr, /PHASE43_REPLACEMENT_EFFECTS_INCOMPLETE/u);

  const missingEffect = await runSql(`BEGIN;
    SET LOCAL session_replication_role=replica;
    DELETE FROM public.phase43_replacement_inventory_effects
    WHERE operation_id=${literal(result.operationId)};
    UPDATE public.phase43_replacement_settlement_evidence
    SET inventory_effects_snapshot=public.phase43_inventory_effects_snapshot_internal(
      ${literal(result.operationId)})
    WHERE operation_id=${literal(result.operationId)};
    SET LOCAL session_replication_role=origin;
    ${ownerClaims}
    SELECT public.settle_sales_replacement_v1(
      ${literal(sale.orderId)},${literal(key)},${literal(request)}::jsonb,
      'Supplier defect',NULL);`, 'missing effect with orphan movement replay', {failure: true});
  assert.match(missingEffect.stderr, /PHASE43_REPLACEMENT_EFFECTS_INCOMPLETE/u);

  const orphanEffect = await runSql(`BEGIN;
    SET LOCAL session_replication_role=replica;
    WITH inserted_movement AS (
      INSERT INTO public.inventory_movements(
        warehouse_id,product_id,movement_type,quantity,balance_before,balance_after,
        reference_type,reference_id,notes,created_by,operation_id
      )
      SELECT effect.warehouse_id,effect.product_id,'sales_deduction',-effect.issued_quantity,
        effect.target_balance_before,effect.target_balance_after,
        'phase4_replacement_item',effect.replacement_item_id,'Injected foreign movement',
        operation.initiated_by,NULL
      FROM public.phase43_replacement_inventory_effects effect
      JOIN public.business_operations operation ON operation.id=effect.operation_id
      WHERE effect.operation_id=${literal(result.operationId)}
      RETURNING id
    )
    UPDATE public.phase43_replacement_inventory_effects effect
    SET inventory_movement_id=inserted_movement.id
    FROM inserted_movement
    WHERE effect.operation_id=${literal(result.operationId)};
    UPDATE public.phase43_replacement_settlement_evidence
    SET inventory_effects_snapshot=public.phase43_inventory_effects_snapshot_internal(
      ${literal(result.operationId)})
    WHERE operation_id=${literal(result.operationId)};
    SET LOCAL session_replication_role=origin;
    ${ownerClaims}
    SELECT public.settle_sales_replacement_v1(
      ${literal(sale.orderId)},${literal(key)},${literal(request)}::jsonb,
      'Supplier defect',NULL);`, 'effect linked to foreign movement replay', {failure: true});
  assert.match(orphanEffect.stderr, /PHASE43_REPLACEMENT_EFFECTS_INCOMPLETE/u);

  const duplicateEffect = await runSql(`INSERT INTO public.phase43_replacement_inventory_effects(
      operation_id,replacement_event_id,replacement_item_id,warehouse_id,product_id,
      inventory_movement_id,source_kind,source_id,issued_quantity,
      replacement_unit_cost_snapshot_in_minor_units_exact,
      replacement_cogs_snapshot_in_minor_units,target_balance_before,target_balance_after
    ) SELECT operation_id,replacement_event_id,replacement_item_id,warehouse_id,product_id,
      inventory_movement_id,source_kind,source_id,issued_quantity,
      replacement_unit_cost_snapshot_in_minor_units_exact,
      replacement_cogs_snapshot_in_minor_units,target_balance_before,target_balance_after
    FROM public.phase43_replacement_inventory_effects
    WHERE operation_id=${literal(result.operationId)};`, 'duplicate effect insert', {failure: true});
  assert.match(duplicateEffect.stderr, /unique constraint|duplicate key/u);

  const mismatchedEffect = await runSql(`BEGIN;
    ALTER TABLE public.phase43_replacement_inventory_effects
      DISABLE TRIGGER trg_phase43_guard_replacement_effect_history;
    ALTER TABLE public.phase43_replacement_settlement_evidence
      DISABLE TRIGGER trg_phase43_guard_replacement_settlement_evidence;
    UPDATE public.phase43_replacement_inventory_effects
    SET source_id=${literal(randomUUID())}
    WHERE operation_id=${literal(result.operationId)};
    UPDATE public.phase43_replacement_settlement_evidence
    SET inventory_effects_snapshot=public.phase43_inventory_effects_snapshot_internal(
      ${literal(result.operationId)})
    WHERE operation_id=${literal(result.operationId)};
    ${ownerClaims}
    SELECT public.settle_sales_replacement_v1(
      ${literal(sale.orderId)},${literal(key)},${literal(request)}::jsonb,
      'Supplier defect',NULL);`, 'mismatched durable source replay', {failure: true});
  assert.match(mismatchedEffect.stderr, /PHASE43_REPLACEMENT_EFFECTS_INCOMPLETE/u);

  const alternateWarehouse = (await runSql(`SELECT id FROM public.warehouses
    WHERE id <> ${literal(sale.warehouseId)} ORDER BY id LIMIT 1;`,
  'find alternate warehouse for relational corruption')).stdout;
  assert.ok(alternateWarehouse, 'The isolated fixture requires a second warehouse.');
  const mismatchedWarehouse = await runSql(`BEGIN;
    SET LOCAL session_replication_role=replica;
    UPDATE public.phase43_replacement_inventory_effects
    SET warehouse_id=${literal(alternateWarehouse)}
    WHERE operation_id=${literal(result.operationId)};
    UPDATE public.inventory_movements
    SET warehouse_id=${literal(alternateWarehouse)}
    WHERE operation_id=${literal(result.operationId)};
    UPDATE public.phase43_replacement_settlement_evidence
    SET inventory_effects_snapshot=public.phase43_inventory_effects_snapshot_internal(
      ${literal(result.operationId)})
    WHERE operation_id=${literal(result.operationId)};
    SET LOCAL session_replication_role=origin;
    ${ownerClaims}
    SELECT public.settle_sales_replacement_v1(
      ${literal(sale.orderId)},${literal(key)},${literal(request)}::jsonb,
      'Supplier defect',NULL);`, 'mismatched durable warehouse replay', {failure: true});
  assert.match(mismatchedWarehouse.stderr, /PHASE43_REPLACEMENT_EFFECTS_INCOMPLETE/u);

  const mismatchedCost = await runSql(`BEGIN;
    SET LOCAL session_replication_role=replica;
    UPDATE public.sales_replacement_items
    SET replacement_cogs_snapshot_in_minor_units =
      replacement_cogs_snapshot_in_minor_units + 7
    WHERE operation_id=${literal(result.operationId)};
    UPDATE public.phase43_replacement_inventory_effects
    SET replacement_cogs_snapshot_in_minor_units =
      replacement_cogs_snapshot_in_minor_units + 7
    WHERE operation_id=${literal(result.operationId)};
    UPDATE public.business_operations
    SET result_snapshot=jsonb_set(result_snapshot,'{replacementCogsInMinorUnits}',
      to_jsonb((result_snapshot->>'replacementCogsInMinorUnits')::BIGINT + 7))
    WHERE id=${literal(result.operationId)};
    UPDATE public.phase43_replacement_settlement_evidence evidence
    SET result_snapshot=operation.result_snapshot,
      inventory_effects_snapshot=public.phase43_inventory_effects_snapshot_internal(
        ${literal(result.operationId)})
    FROM public.business_operations operation
    WHERE evidence.operation_id=operation.id
      AND evidence.operation_id=${literal(result.operationId)};
    SET LOCAL session_replication_role=origin;
    ${ownerClaims}
    SELECT public.settle_sales_replacement_v1(
      ${literal(sale.orderId)},${literal(key)},${literal(request)}::jsonb,
      'Supplier defect',NULL);`, 'derived COGS mismatch replay', {failure: true});
  assert.match(mismatchedCost.stderr, /PHASE43_REPLACEMENT_EFFECTS_INCOMPLETE/u);

  const foreignSale = await createSale(`phase43-foreign-root-${randomUUID()}`, 1);
  const mismatchedRoot = await runSql(`BEGIN;
    SET LOCAL session_replication_role=replica;
    UPDATE public.sales_replacement_items
    SET root_order_item_id=${literal(foreignSale.orderItemId)}
    WHERE operation_id=${literal(result.operationId)};
    SET LOCAL session_replication_role=origin;
    ${ownerClaims}
    SELECT public.settle_sales_replacement_v1(
      ${literal(sale.orderId)},${literal(key)},${literal(request)}::jsonb,
      'Supplier defect',NULL);`, 'cross-order replacement root replay', {failure: true});
  assert.match(mismatchedRoot.stderr, /PHASE43_REPLACEMENT_EFFECTS_INCOMPLETE/u);

  const cancelledConsumption = await runSql(`BEGIN;
    SET LOCAL session_replication_role=replica;
    UPDATE public.sales_aftercare_consumptions
    SET consumption_state='cancelled', settled_at=NULL
    WHERE operation_id=${literal(result.operationId)}
      AND consumption_kind='replacement';
    SET LOCAL session_replication_role=origin;
    ${ownerClaims}
    SELECT public.settle_sales_replacement_v1(
      ${literal(sale.orderId)},${literal(key)},${literal(request)}::jsonb,
      'Supplier defect',NULL);`, 'cancelled consumption replay', {failure: true});
  assert.match(cancelledConsumption.stderr, /PHASE43_REPLACEMENT_EFFECTS_INCOMPLETE/u);

  // The commercial refund remains rooted in the original sale, while the
  // returned physical unit and its valuation follow the operationally-issued
  // Replacement leaf. A later WAC change must not rewrite that leaf snapshot.
  await runSql(`UPDATE public.products SET wac_cost_in_minor_units_exact =
      wac_cost_in_minor_units_exact + 137.250000,
      cost_price_in_minor_units = ROUND(wac_cost_in_minor_units_exact + 137.250000)
    WHERE id=${literal(sale.productId)};`, 'change current WAC after issuance');
  const returnKey = `phase43-return-leaf-${randomUUID()}`;
  const returnItems = JSON.stringify([{return_scope: 'base_unit',
    order_item_id: sale.orderItemId, quantity: 1, stock_disposition: 'restock'}]);
  const physicalSources = JSON.stringify([{
    root_source_kind: 'base_order_item', root_source_id: sale.orderItemId,
    source_kind: 'replacement_item', source_id: committed.replacementItemId,
    product_id: sale.productId, quantity: 1, sellable_restock_quantity: 1,
    defect_non_sellable_quantity: 0, customer_damage_quantity: 0,
  }]);
  const returned = await json(`${ownerClaims} SELECT public.settle_admin_sales_return_v1(
    ${literal(sale.orderId)},${literal(returnKey)},${literal(returnItems)}::jsonb,
    ${literal(physicalSources)}::jsonb,'Return current replacement leaf','cash',NULL,NULL);`,
  'return current replacement leaf');
  assert.equal(returned.success, true);
  const returnEvidence = await json(`SELECT jsonb_build_object(
    'sourceKind',consumption.source_kind,'sourceId',consumption.source_id,
    'restockValue',effect.historical_restock_value_in_minor_units_exact,
    'originalCogs',item.original_cogs_snapshot_in_minor_units,
    'replacementCost',replacement.replacement_unit_cost_snapshot_in_minor_units_exact,
    'currentWac',(SELECT wac_cost_in_minor_units_exact FROM public.products WHERE id=${literal(sale.productId)})
  ) FROM public.sales_aftercare_consumptions consumption
  JOIN public.sales_return_items item ON item.id=consumption.return_item_id
  JOIN public.phase42_return_inventory_effects effect ON effect.operation_id=consumption.operation_id
  JOIN public.sales_replacement_items replacement ON replacement.id=consumption.source_id
  WHERE consumption.operation_id=${literal(returned.operationId)};`, 'physical lineage Return evidence');
  assert.equal(returnEvidence.sourceKind, 'replacement_item');
  assert.equal(returnEvidence.sourceId, committed.replacementItemId);
  assert.equal(Number(returnEvidence.restockValue), Number(returnEvidence.replacementCost));
  assert.notEqual(Number(returnEvidence.restockValue), Number(returnEvidence.currentWac));

  const parcelSale = await createParcelSale();
  const parcelReplacementKey = `phase43-parcel-replacement-${randomUUID()}`;
  const parcelReplacementItems = parcelSale.components.map((component) => ({
    sourceKind: 'parcel_component', sourceId: component.id, quantity: 1,
  }));
  const parcelReplacement = await json(`${ownerClaims}
    SELECT public.settle_sales_replacement_v1(${literal(parcelSale.orderId)},
      ${literal(parcelReplacementKey)},${literal(JSON.stringify(parcelReplacementItems))}::jsonb,
      'Two-component supplier defect',NULL);`, 'replace two parcel components');
  assert.equal(parcelReplacement.success, true);
  assert.equal(parcelReplacement.issuedQuantity, 2);

  const parcelContext = await json(`${ownerClaims}
    SELECT public.get_admin_sales_aftercare_context_v1(${literal(parcelSale.orderId)});`,
  'read multi-leaf parcel context');
  const parcel = parcelContext.parcelInstances[0];
  const allocations = [];
  const componentRequests = [];
  for (const [componentIndex, component] of parcel.components.entries()) {
    let sellable = 0;
    let defect = 0;
    let damage = 0;
    for (const source of component.physicalRepresentatives) {
      const allocation = {
        root_source_kind: 'parcel_component', root_source_id: component.parcelComponentId,
        source_kind: source.sourceKind, source_id: source.sourceId,
        product_id: source.productId, quantity: source.remainingQuantity,
        sellable_restock_quantity: source.remainingQuantity,
        defect_non_sellable_quantity: 0, customer_damage_quantity: 0,
      };
      if (componentIndex === 0 && source.sourceKind === 'replacement_item') {
        allocation.sellable_restock_quantity = 0;
        allocation.defect_non_sellable_quantity = source.remainingQuantity;
      }
      if (componentIndex === 1 && source.sourceKind === 'parcel_component') {
        allocation.customer_damage_quantity = 1;
        allocation.sellable_restock_quantity -= 1;
      }
      sellable += allocation.sellable_restock_quantity;
      defect += allocation.defect_non_sellable_quantity;
      damage += allocation.customer_damage_quantity;
      allocations.push(allocation);
    }
    componentRequests.push({
      parcel_component_id: component.parcelComponentId,
      accepted_quantity: sellable + defect,
      rejected_quantity: damage,
      accepted_condition: sellable > 0 ? 'sellable' : defect > 0 ? 'supplier_defect' : null,
      accepted_stock_disposition: sellable > 0 ? 'restock' : defect > 0 ? 'non_sellable' : null,
      rejection_reason: damage > 0 ? 'customer_damage' : null,
      rejected_stock_disposition: damage > 0 ? 'returned_to_customer' : null,
    });
  }
  const parcelReturnItems = [{
    return_scope: 'parcel_instance', order_item_id: parcel.orderItemId,
    parcel_instance_id: parcel.parcelInstanceId, components: componentRequests,
  }];
  const parcelReturn = await json(`${ownerClaims}
    SELECT public.settle_admin_sales_return_v1(${literal(parcelSale.orderId)},
      ${literal(`phase43-parcel-return-${randomUUID()}`)},
      ${literal(JSON.stringify(parcelReturnItems))}::jsonb,
      ${literal(JSON.stringify(allocations))}::jsonb,
      'Mixed per-leaf parcel inspection','cash',NULL,NULL);`,
  'whole parcel return with two replaced roots');
  assert.equal(parcelReturn.success, true);
  const parcelEvidence = await json(`SELECT jsonb_build_object(
    'consumptionRows',(SELECT count(*) FROM public.sales_aftercare_consumptions
      WHERE operation_id=${literal(parcelReturn.operationId)} AND consumption_kind='return'),
    'consumedQuantity',(SELECT sum(consumed_quantity) FROM public.sales_aftercare_consumptions
      WHERE operation_id=${literal(parcelReturn.operationId)} AND consumption_kind='return'),
    'sellableQuantity',(SELECT sum(sellable_quantity) FROM public.phase42_return_inventory_effects
      WHERE operation_id=${literal(parcelReturn.operationId)}),
    'replacementLeaves',(SELECT count(*) FROM public.sales_aftercare_consumptions
      WHERE operation_id=${literal(parcelReturn.operationId)} AND source_kind='replacement_item'),
    'damageQuantity',(SELECT sum(rejected_quantity) FROM public.sales_return_component_inspections
      WHERE return_operation_id=${literal(parcelReturn.operationId)})
  );`, 'multi-root physical evidence');
  assert.deepEqual(parcelEvidence, {consumptionRows: 4, consumedQuantity: 5,
    sellableQuantity: 3, replacementLeaves: 2, damageQuantity: 1});

  const conflict = await runSql(`${ownerClaims} SELECT public.settle_sales_replacement_v1(
    ${literal(sale.orderId)},${literal(key)},${literal(JSON.stringify([{
      sourceKind: 'base_order_item', sourceId: sale.orderItemId, quantity: 2,
    }]))}::jsonb,'Supplier defect',NULL);`, 'changed payload conflict', {failure: true});
  assert.match(conflict.stderr, /PHASE4_IDEMPOTENCY_CONFLICT/u);

  const context = await json(`${ownerClaims} SELECT public.get_admin_sales_aftercare_context_v1(
    ${literal(sale.orderId)});`, 'Admin aftercare context');
  assert.equal(context.contractVersion, 403);
  assert.equal(context.replacements[0].operationalStatus, 'issued');

  const privileges = await json(`SELECT jsonb_build_object(
    'coordinator',has_function_privilege('authenticated','public.settle_sales_replacement_v1(uuid,text,jsonb,text,text)','EXECUTE'),
    'context',has_function_privilege('authenticated','public.get_admin_sales_aftercare_context_v1(uuid)','EXECUTE'),
    'finalizer',has_function_privilege('authenticated','public.phase4_finalize_aftercare_operation_internal(uuid)','EXECUTE'),
    'evidenceInsert',has_table_privilege('authenticated','public.phase43_replacement_settlement_evidence','INSERT')
  );`, 'privilege boundary');
  assert.deepEqual(privileges, {coordinator: true, context: true, finalizer: false, evidenceInsert: false});

  const customerSale = await createCustomerV2Sale();
  const customerReplacement = await json(`${ownerClaims}
    SELECT public.settle_sales_replacement_v1(${literal(customerSale.orderId)},
      ${literal(`phase43-customer-${randomUUID()}`)},
      ${literal(JSON.stringify([{sourceKind: 'base_order_item',
        sourceId: customerSale.orderItemId, quantity: 1}]))}::jsonb,
      'Customer V2 supplier defect',NULL);`, 'Customer V2 replacement');
  assert.equal(customerReplacement.success, true);

  const rollbackSale = await createSale(`phase43-rollback-${randomUUID()}`, 1);
  const rollbackBefore = await json(`SELECT jsonb_build_object(
    'stock',(SELECT on_hand_quantity FROM public.inventory_balances
      WHERE warehouse_id=${literal(rollbackSale.warehouseId)} AND product_id=${literal(rollbackSale.productId)}),
    'operations',(SELECT count(*) FROM public.business_operations WHERE operation_type='phase4_replacement_v1')
  );`, 'rollback baseline');
  await runSql(`CREATE FUNCTION public.phase43_runtime_fail_effect() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'PHASE43_INJECTED_FAILURE'; END $$;
    CREATE TRIGGER trg_phase43_runtime_fail_effect AFTER INSERT
    ON public.phase43_replacement_inventory_effects FOR EACH ROW
    EXECUTE FUNCTION public.phase43_runtime_fail_effect();`, 'install rollback failure');
  const rollbackKey = `phase43-rollback-replacement-${randomUUID()}`;
  await runSql(`${ownerClaims} SELECT public.settle_sales_replacement_v1(
    ${literal(rollbackSale.orderId)},${literal(rollbackKey)},
    ${literal(JSON.stringify([{sourceKind: 'base_order_item',
      sourceId: rollbackSale.orderItemId, quantity: 1}]))}::jsonb,
    'Injected rollback',NULL);`, 'injected rollback', {failure: true});
  await runSql('DROP TRIGGER trg_phase43_runtime_fail_effect ON public.phase43_replacement_inventory_effects; DROP FUNCTION public.phase43_runtime_fail_effect();',
    'remove rollback failure');
  const rollbackAfter = await json(`SELECT jsonb_build_object(
    'stock',(SELECT on_hand_quantity FROM public.inventory_balances
      WHERE warehouse_id=${literal(rollbackSale.warehouseId)} AND product_id=${literal(rollbackSale.productId)}),
    'operations',(SELECT count(*) FROM public.business_operations WHERE operation_type='phase4_replacement_v1'),
    'keyRows',(SELECT count(*) FROM public.business_operations WHERE idempotency_key=${literal(rollbackKey)}),
    'movements',(SELECT count(*) FROM public.inventory_movements WHERE notes='Phase 4.3 operational Replacement issuance')
  );`, 'rollback final state');
  assert.equal(rollbackAfter.stock, rollbackBefore.stock);
  assert.equal(rollbackAfter.operations, rollbackBefore.operations);
  assert.equal(rollbackAfter.keyRows, 0);

  const foundationSale = await createSale(`phase43-foundation-${randomUUID()}`, 1);
  const foundationOperationId = randomUUID();
  const foundationEventId = randomUUID();
  const foundationItemId = randomUUID();
  const foundationKey = `phase43-foundation-replay-${randomUUID()}`;
  const foundationReason = 'Foundation only replay probe';
  const foundationRequest = JSON.stringify([{sourceKind: 'base_order_item',
    sourceId: foundationSale.orderItemId, quantity: 1}]);
  await runSql(`BEGIN;
    WITH identity AS (SELECT
      public.phase43_canonicalize_replacement_request_internal(
        ${literal(foundationSale.orderId)},${literal(foundationRequest)}::jsonb,
        ${literal(foundationReason)},NULL) canonical)
    INSERT INTO public.business_operations(
      id,operation_type,idempotency_key,request_fingerprint,initiated_by,
      result_snapshot,completed_at,request_identity_version,
      request_identity_snapshot,actor_scope_type,actor_scope_hash
    ) SELECT ${literal(foundationOperationId)},'phase4_replacement_v1',
      ${literal(foundationKey)},public.phase3_request_fingerprint_internal(canonical),
      ${literal(ownerId)},jsonb_build_object('success',true,
        'operationId',${literal(foundationOperationId)},
        'replacementId',${literal(foundationEventId)}),clock_timestamp(),401,
      canonical,'erp_user',public.phase3_actor_scope_hash_internal(
        'erp_user',${literal(ownerId)},NULL,NULL) FROM identity;
    INSERT INTO public.sales_replacement_events(
      id,operation_id,root_order_id,branch_id,warehouse_id,contract_version,
      original_completed_at_snapshot,reason,created_by
    ) VALUES (${literal(foundationEventId)},${literal(foundationOperationId)},
      ${literal(foundationSale.orderId)},${literal(foundationSale.branchId)},
      ${literal(foundationSale.warehouseId)},401,${literal(foundationSale.completion)},
      ${literal(foundationReason)},${literal(ownerId)});
    INSERT INTO public.sales_replacement_items(
      id,replacement_event_id,operation_id,root_order_item_id,product_id,quantity,
      replacement_unit_cost_snapshot_in_minor_units_exact,
      replacement_cogs_snapshot_in_minor_units,condition_code
    ) SELECT ${literal(foundationItemId)},${literal(foundationEventId)},
      ${literal(foundationOperationId)},${literal(foundationSale.orderItemId)},
      ${literal(foundationSale.productId)},1,product.wac_cost_in_minor_units_exact,
      ROUND(product.wac_cost_in_minor_units_exact),'supplier_defect'
    FROM public.products product WHERE product.id=${literal(foundationSale.productId)};
    INSERT INTO public.sales_aftercare_consumptions(
      operation_id,replacement_item_id,source_kind,source_id,product_id,
      consumed_quantity,consumption_kind
    ) VALUES (${literal(foundationOperationId)},${literal(foundationItemId)},
      'base_order_item',${literal(foundationSale.orderItemId)},
      ${literal(foundationSale.productId)},1,'replacement');
    SELECT public.phase4_finalize_aftercare_operation_internal(${literal(foundationOperationId)});
    COMMIT;`, 'create foundation-only settled Replacement');
  const rejectedReplay = await runSql(`${ownerClaims}
    SELECT public.settle_sales_replacement_v1(${literal(foundationSale.orderId)},
      ${literal(foundationKey)},${literal(foundationRequest)}::jsonb,
      ${literal(foundationReason)},NULL);`, 'foundation-only replay rejection', {failure: true});
  assert.match(
    rejectedReplay.stderr,
    /PHASE43_(?:OPERATIONAL_REPLACEMENT_UNPROVEN|REPLACEMENT_NOT_ISSUED)/u,
  );

  const concurrentSale = await createSale(`phase43-concurrent-${randomUUID()}`, 1);
  const deadlocksBefore = Number((await runSql("SELECT deadlocks FROM pg_stat_database WHERE datname=current_database();", 'deadlocks before')).stdout);
  const concurrentRequest = literal(JSON.stringify([{sourceKind: 'base_order_item',
    sourceId: concurrentSale.orderItemId, quantity: 1}]));
  const concurrentRuns = await Promise.allSettled([1, 2].map((index) => runSql(
    `${ownerClaims} SELECT public.settle_sales_replacement_v1(${literal(concurrentSale.orderId)},
      ${literal(`phase43-concurrent-${index}-${randomUUID()}`)},${concurrentRequest}::jsonb,
      'Concurrent supplier defect',NULL);`, `concurrent replacement ${index}`)));
  assert.equal(concurrentRuns.filter((run) => run.status === 'fulfilled').length, 1);
  assert.equal(concurrentRuns.filter((run) => run.status === 'rejected').length, 1);
  const deadlocksAfter = Number((await runSql("SELECT deadlocks FROM pg_stat_database WHERE datname=current_database();", 'deadlocks after')).stdout);
  assert.equal(deadlocksAfter - deadlocksBefore, 0);
  const concurrentEvidence = await json(`SELECT jsonb_build_object(
    'settled',(SELECT count(*) FROM public.sales_replacement_events
      WHERE root_order_id=${literal(concurrentSale.orderId)} AND issuance_status='issued'),
    'movements',(SELECT count(*) FROM public.inventory_movements movement
      JOIN public.sales_replacement_items item ON item.id=movement.reference_id
      JOIN public.sales_replacement_events event ON event.id=item.replacement_event_id
      WHERE event.root_order_id=${literal(concurrentSale.orderId)}
        AND movement.reference_type='phase4_replacement_item')
  );`, 'concurrency final state');
  assert.deepEqual(concurrentEvidence, {settled: 1, movements: 1});

  const legacyPosOrderId = await createLegacyPosSale();
  const legacyPosBefore = await json(`SELECT jsonb_build_object(
    'legacyReturns',(SELECT count(*) FROM public.sales_returns
      WHERE order_id=${literal(legacyPosOrderId)}),
    'phase4Returns',(SELECT count(*) FROM public.sales_return_events
      WHERE order_id=${literal(legacyPosOrderId)}),
    'replacements',(SELECT count(*) FROM public.sales_replacement_events
      WHERE root_order_id=${literal(legacyPosOrderId)}));`, 'Legacy POS state before read');
  const legacyPosContext = await json(`${ownerClaims}
    SELECT public.get_admin_sales_aftercare_context_v1(${literal(legacyPosOrderId)});`,
  'Legacy POS V1 aftercare context');
  assert.equal(legacyPosContext.supported, false);
  assert.equal(legacyPosContext.capability, 'legacy_pos_v1_unsupported');
  assert.equal(legacyPosContext.financial, null);
  assert.deepEqual(legacyPosContext.baseItems, []);
  assert.deepEqual(legacyPosContext.parcelInstances, []);
  const legacyPosAfter = await json(`SELECT jsonb_build_object(
    'legacyReturns',(SELECT count(*) FROM public.sales_returns
      WHERE order_id=${literal(legacyPosOrderId)}),
    'phase4Returns',(SELECT count(*) FROM public.sales_return_events
      WHERE order_id=${literal(legacyPosOrderId)}),
    'replacements',(SELECT count(*) FROM public.sales_replacement_events
      WHERE root_order_id=${literal(legacyPosOrderId)}));`, 'Legacy POS state after read');
  assert.deepEqual(legacyPosAfter, legacyPosBefore);
  const legacyPosWebsiteReturn = await runSql(`${ownerClaims}
    SELECT public.return_completed_website_order(${literal(legacyPosOrderId)},
      'Legacy POS must not use Website Return','damaged','cash',NULL,NULL);`,
  'Legacy POS Website Return rejection', {failure: true});
  assert.match(legacyPosWebsiteReturn.stderr, /مرتجع البيع المباشر يجب أن يتم من مسار نقطة البيع/u);

  const legacyWebsiteOrderId = await createLegacyWebsiteSale();
  const legacyWebsiteContext = await json(`${ownerClaims}
    SELECT public.get_admin_sales_aftercare_context_v1(${literal(legacyWebsiteOrderId)});`,
  'Legacy Website V1 aftercare context');
  assert.equal(legacyWebsiteContext.supported, false);
  assert.equal(legacyWebsiteContext.capability, 'legacy_website_return_v1');
  assert.equal(legacyWebsiteContext.financial, null);
  const legacyWebsiteReturn = await json(`${ownerClaims}
    SELECT public.return_completed_website_order(${literal(legacyWebsiteOrderId)},
      'Legacy Website historical return','damaged','cash',NULL,
      'Phase 4.3 Legacy compatibility fixture');`, 'return real Legacy Website V1');
  assert.equal(legacyWebsiteReturn.success, true);
  const legacyWebsiteFinal = await json(`SELECT jsonb_build_object(
    'status',customer_order.status,'paymentStatus',customer_order.payment_status,
    'returnCount',(SELECT count(*) FROM public.sales_returns legacy_return
      WHERE legacy_return.order_id=customer_order.id),
    'phase4ReturnCount',(SELECT count(*) FROM public.sales_return_events event
      WHERE event.order_id=customer_order.id)
  ) FROM public.orders customer_order WHERE customer_order.id=${literal(legacyWebsiteOrderId)};`,
  'Legacy Website historical return evidence');
  assert.deepEqual(legacyWebsiteFinal,
    {status: 'returned', paymentStatus: 'refunded', returnCount: 1, phase4ReturnCount: 0});

  const {stdout: lint} = await execFileAsync(process.execPath,
    [cliPath, 'db', 'lint', '--local', '--level', 'warning', '--workdir', isolatedProjectRoot],
    {cwd: projectRoot, windowsHide: true, maxBuffer: 1024 * 1024, timeout: 120_000});
  if (/ERROR:/u.test(lint)) throw new Error(`DB lint failed:\n${lint}`);
  console.log(JSON.stringify({ok: true, freshRebuild: '001-122', operationalReplacement: true,
    replayZeroDuplicateEffects: true, physicalLineageReturn: true,
    changedPayloadConflict: true,
    customerV2: true, atomicRollback: true, foundationReplayBlocked: true,
    exactSourceBinding: true, exactWarehouseBinding: true, multiRootLeafAllocation: true,
    concurrencyDeadlockDelta: 0,
    readModel: true, legacyPosV1: true, legacyPosWebsiteReturnBlocked: true,
    legacyWebsiteV1: true, legacyWebsiteHistoricalReturn: true,
    securityBoundary: true}, null, 2));
} finally {
  if (isolatedProjectRoot) await execFileAsync(process.execPath,
    [cliPath, 'stop', '--no-backup', '--workdir', isolatedProjectRoot],
    {cwd: projectRoot, windowsHide: true, maxBuffer: 1024 * 1024, timeout: 120_000});
}
