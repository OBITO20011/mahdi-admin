import assert from 'node:assert/strict';
import {execFile, spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..');
const bootstrapPath = path.join(scriptDirectory, 'bootstrap-isolated-supabase.mjs');
const phase3SqlPath = path.join(
  scriptDirectory,
  'phase3-configurable-parcel-contracts-runtime.sql',
);
const cliPath = path.join(projectRoot, 'node_modules', 'supabase', 'dist', 'supabase.js');
const projectId = 'nawasrah-phase44-lineage-test';
const databaseContainer = `supabase_db_${projectId}`;
const ownerId = '92400000-0000-0000-0000-000000000001';
const warehouseId = '92400000-0000-0000-0000-000000000201';
const branchId = '92400000-0000-0000-0000-000000000200';
const productA = '92400000-0000-0000-0000-000000000101';
const productB = '92400000-0000-0000-0000-000000000102';
const familyId = '92400000-0000-0000-0000-000000000100';
const configurationId = '92400000-0000-0000-0000-000000000300';
const ownerClaims = `SELECT set_config('request.jwt.claims',
  '{"sub":"${ownerId}","role":"authenticated","aal":"aal2"}',false);`;

const ORIGINAL_A_COST = 10;
const ORIGINAL_B_COST = 6;
const REPLACEMENT_1_COST = 111.111111;
const REPLACEMENT_2_COST = 222.222222;
const CURRENT_RETURN_WAC = 999.999999;
const CURRENT_MUTATED_PRICE = 7777;

const SLICE_2_BREAK_MATRIX = Object.freeze({
  replacementDepthTwo: 'original leaf to Replacement 1 to Replacement 2 to whole Parcel Return',
  historicalPriceIsolation: 'current price mutation cannot alter frozen damage valuation',
  historicalCostIsolation: 'current WAC mutation cannot replace current-leaf issuance cost',
  originalLeafAfterReplacement: 'consumed original quantity cannot masquerade as current leaf',
  staleFirstReplacement: 'Replacement 1 cannot represent the unit after Replacement 2',
  wrongParentOrRoot: 'current leaf cannot be rebound to another root component',
  sameTupleWrongPhysicalIdentity: 'foreign same-product/cost leaf cannot satisfy physical identity',
  committedReplayZeroWrite: 'same-key replay after lineage evolution has zero durable writes',
});

let isolatedProjectRoot = '';
const sqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;

const runSqlText = async (sql, label, {expectFailure = false} = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn('docker', [
      'exec', '-i', databaseContainer,
      'psql', '-U', 'postgres', '-d', 'postgres',
      '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
    ], {cwd: projectRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      const result = {code, stdout: stdout.trim(), stderr: stderr.trim()};
      if ((!expectFailure && code !== 0) || (expectFailure && code === 0)) {
        reject(new Error(`${label} had unexpected exit ${code}:\n${stderr}\n${stdout}`));
        return;
      }
      resolve(result);
    });
    child.stdin.end(`SET statement_timeout='60s'; SET lock_timeout='30s';\n${sql}`);
  });

const readJson = async (sql, label) => {
  const result = await runSqlText(sql, label);
  const value = result.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).at(-1);
  assert.ok(value, `${label} did not return JSON.`);
  return JSON.parse(value);
};

const expectSqlError = async (sql, label) => {
  const result = await runSqlText(sql, label, {expectFailure: true});
  assert.match(result.stderr, /PHASE4|RETURN_|LINEAGE|CONSUMPTION/u);
};

const setProductEconomics = (productId, cost, price) => runSqlText(`UPDATE public.products
  SET wac_cost_in_minor_units_exact=${cost},
      cost_price_in_minor_units=ROUND(${cost}),
      default_sale_price_in_minor_units=${price},
      sale_price_in_minor_units=${price},
      wholesale_price_in_minor_units=${price}
  WHERE id=${sqlLiteral(productId)};`, `Set product economics ${productId}`);

const createParcelSale = async (label) => {
  const lines = JSON.stringify([{
    commercial_line_kind: 'configurable_parcel',
    family_product_id: familyId,
    parcel_configuration_id: configurationId,
    configuration_revision: 1,
    price_authority: 'server_catalog',
    line_discount_in_minor_units: 0,
    parcel_instances: [{components: [
      {product_id: productA, base_quantity: 2},
      {product_id: productB, base_quantity: 3},
    ]}],
  }]);
  const result = await readJson(`${ownerClaims}
    SELECT public.create_pos_sale_v2(
      ${sqlLiteral(warehouseId)},${sqlLiteral(branchId)},NULL,
      ${sqlLiteral(`Phase 4.4 ${label}`)},'cash',${sqlLiteral(lines)}::jsonb,
      0,5000,${sqlLiteral(`phase44-lineage-${label}-${randomUUID()}`)}
    );`, `Create ${label} Parcel sale`);
  assert.equal(result.success, true);
  return readJson(`SELECT jsonb_build_object(
    'orderId',customer_order.id,'orderItemId',order_item.id,
    'parcelInstanceId',instance.id,'warehouseId',customer_order.warehouse_id,
    'entitlement',instance.net_refundable_amount_snapshot_in_minor_units,
    'originalInstanceCogs',instance.cogs_snapshot_in_minor_units,
    'originalInstanceExactCogs',instance.exact_cogs_snapshot_in_minor_units,
    'components',(SELECT jsonb_agg(jsonb_build_object(
      'id',component.id,'productId',component.product_id,
      'quantity',component.base_quantity,
      'damagePrice',component.effective_standalone_unit_sale_price_snapshot_in_minor_units,
      'cogs',component.cogs_snapshot_in_minor_units,
      'exactCogs',component.exact_cogs_snapshot_in_minor_units
    ) ORDER BY component.product_id) FROM public.order_parcel_components component
      WHERE component.parcel_instance_id=instance.id)
  ) FROM public.orders customer_order
  JOIN public.order_items order_item ON order_item.order_id=customer_order.id
    AND order_item.commercial_line_kind='configurable_parcel'
  JOIN public.order_parcel_instances instance ON instance.order_item_id=order_item.id
  WHERE customer_order.id=${sqlLiteral(result.orderId)};`, `Read ${label} Parcel sale`);
};

const settleReplacement = async ({orderId, sourceKind, sourceId, reason}) => {
  const key = `phase44-replacement-${randomUUID()}`;
  const request = JSON.stringify([{sourceKind, sourceId, quantity: 1}]);
  const result = await readJson(`${ownerClaims}
    SELECT public.settle_sales_replacement_v1(
      ${sqlLiteral(orderId)},${sqlLiteral(key)},${sqlLiteral(request)}::jsonb,
      ${sqlLiteral(reason)},NULL
    );`, reason);
  assert.equal(result.success, true);
  const item = await readJson(`SELECT jsonb_build_object(
      'id',item.id,'operationId',item.operation_id,
      'parentId',item.parent_replacement_item_id,
      'rootComponentId',item.root_parcel_component_id,
      'productId',item.product_id,'quantity',item.quantity,
      'unitCost',item.replacement_unit_cost_snapshot_in_minor_units_exact,
      'cogs',item.replacement_cogs_snapshot_in_minor_units
    ) FROM public.sales_replacement_items item
    WHERE item.operation_id=${sqlLiteral(result.operationId)};`, `Read ${reason} item`);
  return {key, request, result, item};
};

const readImmutableAnchors = (fixture, replacement1, replacement2) => readJson(`SELECT jsonb_build_object(
    'parcelEntitlement',instance.net_refundable_amount_snapshot_in_minor_units,
    'originalInstanceCogs',instance.cogs_snapshot_in_minor_units,
    'originalInstanceExactCogs',instance.exact_cogs_snapshot_in_minor_units,
    'components',(SELECT jsonb_agg(jsonb_build_object(
      'id',component.id,'productId',component.product_id,
      'quantity',component.base_quantity,
      'damagePrice',component.effective_standalone_unit_sale_price_snapshot_in_minor_units,
      'cogs',component.cogs_snapshot_in_minor_units,
      'exactCogs',component.exact_cogs_snapshot_in_minor_units
    ) ORDER BY component.product_id) FROM public.order_parcel_components component
      WHERE component.parcel_instance_id=instance.id),
    'replacement1',(SELECT jsonb_build_object(
      'id',item.id,'parentId',item.parent_replacement_item_id,
      'rootId',item.root_parcel_component_id,'unitCost',item.replacement_unit_cost_snapshot_in_minor_units_exact,
      'cogs',item.replacement_cogs_snapshot_in_minor_units)
      FROM public.sales_replacement_items item WHERE item.id=${sqlLiteral(replacement1.item.id)}),
    'replacement2',(SELECT jsonb_build_object(
      'id',item.id,'parentId',item.parent_replacement_item_id,
      'rootId',item.root_parcel_component_id,'unitCost',item.replacement_unit_cost_snapshot_in_minor_units_exact,
      'cogs',item.replacement_cogs_snapshot_in_minor_units)
      FROM public.sales_replacement_items item WHERE item.id=${sqlLiteral(replacement2.item.id)})
  ) FROM public.order_parcel_instances instance
  WHERE instance.id=${sqlLiteral(fixture.parcelInstanceId)};`, 'Read immutable valuation anchors');

const readCurrentPhysicalContext = async (orderId) => {
  const context = await readJson(`${ownerClaims}
    SELECT public.get_admin_sales_aftercare_context_v1(${sqlLiteral(orderId)});`,
  'Read current physical lineage context');
  return context.parcelInstances[0];
};

const buildReturnItems = (parcel) => JSON.stringify([{
  return_scope: 'parcel_instance',
  order_item_id: parcel.orderItemId,
  parcel_instance_id: parcel.parcelInstanceId,
  components: parcel.components.map((component) => ({
    parcel_component_id: component.parcelComponentId,
    accepted_quantity: component.productId === productB ? 2 : 2,
    rejected_quantity: component.productId === productB ? 1 : 0,
    accepted_condition: 'sellable',
    accepted_stock_disposition: 'restock',
    rejection_reason: component.productId === productB ? 'customer_damage' : null,
    rejected_stock_disposition: component.productId === productB ? 'returned_to_customer' : null,
  })),
}]);

const buildCorrectPhysicalSources = (parcel) => parcel.components.flatMap((component) =>
  component.physicalRepresentatives.map((source) => ({
    root_source_kind: 'parcel_component',
    root_source_id: component.parcelComponentId,
    source_kind: source.sourceKind,
    source_id: source.sourceId,
    product_id: source.productId,
    quantity: source.remainingQuantity,
    sellable_restock_quantity:
      component.productId === productB ? source.remainingQuantity - 1 : source.remainingQuantity,
    defect_non_sellable_quantity: 0,
    customer_damage_quantity: component.productId === productB ? 1 : 0,
  })),
);

const settleReturnSql = ({orderId, key, items, physicalSources}) => `${ownerClaims}
  SELECT public.settle_admin_sales_return_v1(
    ${sqlLiteral(orderId)},${sqlLiteral(key)},${sqlLiteral(items)}::jsonb,
    ${sqlLiteral(JSON.stringify(physicalSources))}::jsonb,
    'Phase 4.4 depth-two lineage Return','cash',NULL,NULL
  );`;

const readDurableFingerprint = (orderId) => readJson(`WITH operation_ids AS (
    SELECT operation.id FROM public.business_operations operation
    WHERE operation.request_identity_snapshot->>'order_id'=${sqlLiteral(orderId)}
  ), replacement_events AS (
    SELECT event.id FROM public.sales_replacement_events event
    WHERE event.root_order_id=${sqlLiteral(orderId)}
  ), return_events AS (
    SELECT event.id FROM public.sales_return_events event
    WHERE event.order_id=${sqlLiteral(orderId)}
  ) SELECT jsonb_build_object(
    'operations',(SELECT COALESCE(jsonb_agg(to_jsonb(operation) ORDER BY operation.id),'[]')
      FROM public.business_operations operation WHERE operation.id IN (SELECT id FROM operation_ids)),
    'replacementEvents',(SELECT COALESCE(jsonb_agg(to_jsonb(event) ORDER BY event.id),'[]')
      FROM public.sales_replacement_events event WHERE event.id IN (SELECT id FROM replacement_events)),
    'replacementItems',(SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item.id),'[]')
      FROM public.sales_replacement_items item WHERE item.replacement_event_id IN (SELECT id FROM replacement_events)),
    'replacementEffects',(SELECT COALESCE(jsonb_agg(to_jsonb(effect) ORDER BY effect.id),'[]')
      FROM public.phase43_replacement_inventory_effects effect WHERE effect.operation_id IN (SELECT id FROM operation_ids)),
    'replacementEvidence',(SELECT COALESCE(jsonb_agg(to_jsonb(evidence) ORDER BY evidence.operation_id),'[]')
      FROM public.phase43_replacement_settlement_evidence evidence WHERE evidence.operation_id IN (SELECT id FROM operation_ids)),
    'returnEvents',(SELECT COALESCE(jsonb_agg(to_jsonb(event) ORDER BY event.id),'[]')
      FROM public.sales_return_events event WHERE event.id IN (SELECT id FROM return_events)),
    'returnItems',(SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item.id),'[]')
      FROM public.sales_return_items item WHERE item.sales_return_event_id IN (SELECT id FROM return_events)),
    'inspections',(SELECT COALESCE(jsonb_agg(to_jsonb(inspection) ORDER BY inspection.id),'[]')
      FROM public.sales_return_component_inspections inspection
      WHERE inspection.return_operation_id IN (SELECT id FROM operation_ids)),
    'consumptions',(SELECT COALESCE(jsonb_agg(to_jsonb(consumption) ORDER BY consumption.id),'[]')
      FROM public.sales_aftercare_consumptions consumption WHERE consumption.operation_id IN (SELECT id FROM operation_ids)),
    'returnEffects',(SELECT COALESCE(jsonb_agg(to_jsonb(effect) ORDER BY effect.id),'[]')
      FROM public.phase42_return_inventory_effects effect WHERE effect.operation_id IN (SELECT id FROM operation_ids)),
    'returnEvidence',(SELECT COALESCE(jsonb_agg(to_jsonb(evidence) ORDER BY evidence.operation_id),'[]')
      FROM public.phase42_return_settlement_evidence evidence WHERE evidence.operation_id IN (SELECT id FROM operation_ids)),
    'movements',(SELECT COALESCE(jsonb_agg(to_jsonb(movement) ORDER BY movement.id),'[]')
      FROM public.inventory_movements movement WHERE movement.operation_id IN (SELECT id FROM operation_ids)),
    'balances',(SELECT COALESCE(jsonb_agg(to_jsonb(balance) ORDER BY balance.product_id),'[]')
      FROM public.inventory_balances balance WHERE balance.warehouse_id=${sqlLiteral(warehouseId)}
        AND balance.product_id IN (${sqlLiteral(productA)},${sqlLiteral(productB)})),
    'products',(SELECT COALESCE(jsonb_agg(to_jsonb(product) ORDER BY product.id),'[]')
      FROM public.products product WHERE product.id IN (${sqlLiteral(productA)},${sqlLiteral(productB)})),
    'components',(SELECT COALESCE(jsonb_agg(to_jsonb(component) ORDER BY component.id),'[]')
      FROM public.order_parcel_components component
      JOIN public.order_parcel_instances instance ON instance.id=component.parcel_instance_id
      WHERE instance.order_id=${sqlLiteral(orderId)})
  );`, 'Read lineage durable fingerprint');

const assertRejectedWithoutWrites = async ({fixture, items, sources, label}) => {
  const before = await readDurableFingerprint(fixture.orderId);
  const key = `phase44-stale-${randomUUID()}`;
  await expectSqlError(settleReturnSql({
    orderId: fixture.orderId, key, items, physicalSources: sources,
  }), label);
  const after = await readDurableFingerprint(fixture.orderId);
  assert.deepEqual(after, before, `${label} changed durable state`);
  const operation = await readJson(`SELECT jsonb_build_object('count',count(*))
    FROM public.business_operations WHERE idempotency_key=${sqlLiteral(key)};`,
  `${label} rejected operation count`);
  assert.equal(operation.count, 0);
};

const readPerIdentityReturnEvidence = (operationId) => readJson(`SELECT jsonb_build_object(
    'consumptions',(SELECT jsonb_agg(jsonb_build_object(
      'sourceKind',consumption.source_kind,'sourceId',consumption.source_id,
      'productId',consumption.product_id,'quantity',consumption.consumed_quantity,
      'state',consumption.consumption_state
    ) ORDER BY consumption.source_kind,consumption.source_id)
      FROM public.sales_aftercare_consumptions consumption
      WHERE consumption.operation_id=${sqlLiteral(operationId)}
        AND consumption.consumption_kind='return'),
    'effects',(SELECT jsonb_agg(jsonb_build_object(
      'productId',effect.product_id,'quantity',effect.sellable_quantity,
      'historicalValue',effect.historical_restock_value_in_minor_units_exact,
      'sources',effect.source_evidence
    ) ORDER BY effect.product_id) FROM public.phase42_return_inventory_effects effect
      WHERE effect.operation_id=${sqlLiteral(operationId)}),
    'financial',(SELECT jsonb_build_object(
      'entitlement',event.merchandise_refund_amount_in_minor_units,
      'rawDamage',event.raw_customer_damage_deduction_in_minor_units,
      'appliedDamage',event.applied_customer_damage_deduction_in_minor_units,
      'refund',event.money_refund_amount_in_minor_units)
      FROM public.sales_return_events event WHERE event.operation_id=${sqlLiteral(operationId)})
  );`, 'Read per-identity Return evidence');

try {
  const {stdout} = await execFileAsync(process.execPath, [bootstrapPath], {
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

  await setProductEconomics(productA, ORIGINAL_A_COST, 1000);
  await setProductEconomics(productB, ORIGINAL_B_COST, 1000);
  const fixture = await createParcelSale('depth-two');
  const componentA = fixture.components.find((component) => component.productId === productA);
  const componentB = fixture.components.find((component) => component.productId === productB);
  assert.ok(componentA && componentB);
  assert.equal(Number(fixture.entitlement), 5000);
  assert.equal(Number(componentA.damagePrice), 1000);
  assert.equal(Number(componentB.damagePrice), 1000);

  await setProductEconomics(productA, REPLACEMENT_1_COST, 1000);
  const replacement1 = await settleReplacement({
    orderId: fixture.orderId,
    sourceKind: 'parcel_component',
    sourceId: componentA.id,
    reason: 'Phase 4.4 Replacement depth 1',
  });
  assert.equal(Number(replacement1.item.unitCost), REPLACEMENT_1_COST);

  await setProductEconomics(productA, REPLACEMENT_2_COST, 1000);
  const replacement2 = await settleReplacement({
    orderId: fixture.orderId,
    sourceKind: 'replacement_item',
    sourceId: replacement1.item.id,
    reason: 'Phase 4.4 Replacement depth 2',
  });
  assert.equal(replacement2.item.parentId, replacement1.item.id);
  assert.equal(Number(replacement2.item.unitCost), REPLACEMENT_2_COST);

  const anchors = await readImmutableAnchors(fixture, replacement1, replacement2);
  assert.equal(Number(anchors.parcelEntitlement), 5000);
  assert.equal(Number(anchors.replacement1.unitCost), REPLACEMENT_1_COST);
  assert.equal(Number(anchors.replacement2.unitCost), REPLACEMENT_2_COST);
  assert.notEqual(Number(anchors.replacement1.unitCost), Number(anchors.replacement2.unitCost));

  await setProductEconomics(productA, CURRENT_RETURN_WAC, CURRENT_MUTATED_PRICE);
  await setProductEconomics(productB, CURRENT_RETURN_WAC + 100, CURRENT_MUTATED_PRICE);

  const parcel = await readCurrentPhysicalContext(fixture.orderId);
  const contextA = parcel.components.find((component) => component.productId === productA);
  const contextB = parcel.components.find((component) => component.productId === productB);
  assert.ok(contextA && contextB);
  assert.deepEqual(
    contextA.physicalRepresentatives.map((source) => ({
      kind: source.sourceKind, id: source.sourceId, quantity: source.remainingQuantity,
    })).sort((left, right) => left.kind.localeCompare(right.kind)),
    [
      {kind: 'parcel_component', id: componentA.id, quantity: 1},
      {kind: 'replacement_item', id: replacement2.item.id, quantity: 1},
    ],
  );
  assert.equal(contextA.physicalRepresentatives.some(
    (source) => source.sourceId === replacement1.item.id,
  ), false);
  assert.deepEqual(contextB.physicalRepresentatives.map((source) => ({
    kind: source.sourceKind, id: source.sourceId, quantity: source.remainingQuantity,
  })), [{kind: 'parcel_component', id: componentB.id, quantity: 3}]);

  const items = buildReturnItems(parcel);
  const correctSources = buildCorrectPhysicalSources(parcel);
  const aOriginal = correctSources.find((source) =>
    source.root_source_id === componentA.id && source.source_kind === 'parcel_component');
  const aReplacement2 = correctSources.find((source) => source.source_id === replacement2.item.id);
  const bOriginal = correctSources.find((source) => source.root_source_id === componentB.id);
  assert.ok(aOriginal && aReplacement2 && bOriginal);

  const originalOnly = [
    {...aOriginal, quantity: 2, sellable_restock_quantity: 2},
    bOriginal,
  ];
  await assertRejectedWithoutWrites({
    fixture, items, sources: originalOnly,
    label: 'Reject consumed original leaf after replacement',
  });

  const staleFirstReplacement = [
    aOriginal,
    {...aReplacement2, source_id: replacement1.item.id},
    bOriginal,
  ];
  await assertRejectedWithoutWrites({
    fixture, items, sources: staleFirstReplacement,
    label: 'Reject stale Replacement 1 after Replacement 2',
  });

  const wrongRoot = [
    aOriginal,
    {...aReplacement2, root_source_id: componentB.id},
    bOriginal,
  ];
  await assertRejectedWithoutWrites({
    fixture, items, sources: wrongRoot,
    label: 'Reject wrong physical root binding',
  });

  const foreignFixture = await createParcelSale('foreign-same-tuple');
  const foreignA = foreignFixture.components.find((component) => component.productId === productA);
  assert.ok(foreignA);
  await setProductEconomics(productA, REPLACEMENT_2_COST, CURRENT_MUTATED_PRICE);
  const foreignReplacement = await settleReplacement({
    orderId: foreignFixture.orderId,
    sourceKind: 'parcel_component',
    sourceId: foreignA.id,
    reason: 'Phase 4.4 foreign same-tuple leaf',
  });
  assert.equal(Number(foreignReplacement.item.unitCost), REPLACEMENT_2_COST);
  await setProductEconomics(productA, CURRENT_RETURN_WAC, CURRENT_MUTATED_PRICE);
  const wrongIdentity = [
    aOriginal,
    {...aReplacement2, source_id: foreignReplacement.item.id},
    bOriginal,
  ];
  await assertRejectedWithoutWrites({
    fixture, items, sources: wrongIdentity,
    label: 'Reject same tuple with foreign physical identity',
  });

  const returnKey = `phase44-depth-two-return-${randomUUID()}`;
  const result = await readJson(settleReturnSql({
    orderId: fixture.orderId,
    key: returnKey,
    items,
    physicalSources: correctSources,
  }), 'Settle depth-two whole Parcel Return');
  assert.equal(result.success, true);
  assert.equal(result.merchandiseEntitlementInMinorUnits, 4000);
  assert.equal(result.moneyRefundInMinorUnits, 4000);

  const evidence = await readPerIdentityReturnEvidence(result.operationId);
  assert.equal(evidence.financial.rawDamage, 1000);
  assert.equal(evidence.financial.appliedDamage, 1000);
  const consumptionById = new Map(evidence.consumptions.map((row) => [row.sourceId, row]));
  assert.equal(consumptionById.get(componentA.id)?.quantity, 1);
  assert.equal(consumptionById.get(replacement2.item.id)?.quantity, 1);
  assert.equal(consumptionById.get(componentB.id)?.quantity, 3);
  assert.equal(consumptionById.has(replacement1.item.id), false);

  const productAEffect = evidence.effects.find((effect) => effect.productId === productA);
  const productBEffect = evidence.effects.find((effect) => effect.productId === productB);
  assert.ok(productAEffect && productBEffect);
  const aEvidence = new Map(productAEffect.sources.map((source) => [source.source_id, source]));
  assert.equal(Number(aEvidence.get(componentA.id)?.historical_value_exact), ORIGINAL_A_COST);
  assert.equal(
    Number(aEvidence.get(replacement2.item.id)?.historical_value_exact),
    REPLACEMENT_2_COST,
  );
  assert.notEqual(
    Number(aEvidence.get(replacement2.item.id)?.historical_value_exact),
    CURRENT_RETURN_WAC,
  );
  assert.equal(Number(productBEffect.historicalValue), ORIGINAL_B_COST * 2);

  const anchorsAfter = await readImmutableAnchors(fixture, replacement1, replacement2);
  assert.deepEqual(anchorsAfter, anchors);

  const beforeReplay = await readDurableFingerprint(fixture.orderId);
  const replay = await readJson(settleReturnSql({
    orderId: fixture.orderId,
    key: returnKey,
    items,
    physicalSources: correctSources,
  }), 'Replay depth-two whole Parcel Return');
  const afterReplay = await readDurableFingerprint(fixture.orderId);
  assert.deepEqual(replay, result);
  assert.deepEqual(afterReplay, beforeReplay);

  console.log(JSON.stringify({
    ok: true,
    phase: '4.4',
    slice: 'lineage-valuation',
    freshRebuild: '001-122',
    migration123: 'ABSENT',
    breakMatrix: SLICE_2_BREAK_MATRIX,
    scenarios: Object.fromEntries(Object.keys(SLICE_2_BREAK_MATRIX).map((key) => [key, true])),
    multiComponentWholeParcel: true,
    perIdentityConsumptionSet: true,
    valuationExpectationsDerivedIndependently: true,
    productionAccess: 'ZERO',
  }, null, 2));
} finally {
  if (isolatedProjectRoot) {
    await execFileAsync(process.execPath, [
      cliPath, 'stop', '--no-backup', '--workdir', isolatedProjectRoot,
    ], {
      cwd: projectRoot,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      timeout: 120_000,
    });
  }
}
