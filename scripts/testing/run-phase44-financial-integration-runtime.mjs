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
const currentPackageD = process.env.NAWASRAH_PACKAGE_D_CURRENT === '1';
const phase3SqlPath = path.join(
  scriptDirectory,
  'phase3-configurable-parcel-contracts-runtime.sql',
);
const cliPath = path.join(projectRoot, 'node_modules', 'supabase', 'dist', 'supabase.js');
const projectId = 'nawasrah-phase44-financial-test';
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

const SLICE_1_BREAK_MATRIX = Object.freeze({
  debtFirstSplit: 'same-sale debt is reduced before the collected remainder is refunded',
  fullyPaidEntitlementBound: 'a fully-paid sale refunds only the selected entitlement',
  netCollectionBound: 'reversed collection cannot fund a Return refund',
  damageDeductionCap: 'raw Parcel damage above entitlement clamps to zero entitlement',
  paidDeliveryNonRefundable: 'paid delivery remains collected and is never refunded',
  unpaidDeliveryRemainsDebt: 'full merchandise Return leaves unpaid delivery debt',
  crossSaleIsolation: 'another sale collection cannot fund this sale Return',
  committedReplayZeroWrite: 'same-key replay returns immutable result without effects',
  rejectionAtomicity: 'failure after financial and inventory writes rolls back all state',
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

const expectSqlError = async (sql, pattern, label) => {
  const result = await runSqlText(sql, label, {expectFailure: true});
  assert.match(result.stderr, pattern);
  return result;
};

const baseLines = (quantity) => JSON.stringify([{
  commercial_line_kind: 'base_unit',
  product_id: productA,
  base_quantity: quantity,
  price_authority: 'server_catalog',
  line_discount_in_minor_units: 0,
}]);

const createCustomer = async (label) => {
  const id = randomUUID();
  const phone = `079${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`;
  await runSqlText(`INSERT INTO public.customers(
      id,full_name,phone,credit_limit_in_minor_units
    ) VALUES (${sqlLiteral(id)},${sqlLiteral(`Phase 4.4 ${label}`)},
      ${sqlLiteral(phone)},1000000);`, `Create customer ${label}`);
  return {id, phone};
};

const readSale = (orderId, label) => readJson(`SELECT jsonb_build_object(
    'orderId',customer_order.id,'orderItemId',item.id,
    'shiftId',customer_order.cash_shift_id,'total',customer_order.total_in_minor_units,
    'delivery',customer_order.delivery_fee_in_minor_units,
    'branchId',customer_order.branch_id,'warehouseId',customer_order.warehouse_id,
    'amountPaid',customer_order.amount_paid_in_minor_units,
    'paymentStatus',customer_order.payment_status,'customerId',customer_order.customer_id,
    'quantity',item.quantity,'entitlement',item.net_refundable_amount_snapshot_in_minor_units,
    'productId',item.product_id,'operationId',customer_order.operation_id
  ) FROM public.orders customer_order
  JOIN public.order_items item ON item.order_id=customer_order.id
  WHERE customer_order.id=${sqlLiteral(orderId)}
    AND item.commercial_line_kind='base_unit'
  ORDER BY item.id LIMIT 1;`, label);

const createBaseSale = async ({label, quantity, paymentMethod, amountPaid, customerId = null}) => {
  const key = `phase44-${label}-${randomUUID()}`;
  const result = await readJson(`${ownerClaims}
    SELECT public.create_pos_sale_v2(
      ${sqlLiteral(warehouseId)},${sqlLiteral(branchId)},
      ${customerId ? sqlLiteral(customerId) : 'NULL'},${sqlLiteral(`Phase44 ${label}`)},
      ${sqlLiteral(paymentMethod)},${sqlLiteral(baseLines(quantity))}::jsonb,
      0,${amountPaid},${sqlLiteral(key)}
    );`, `Create ${label} sale`);
  assert.equal(result.success, true);
  return readSale(result.orderId, `Read ${label} sale`);
};

const ensureOpenShift = (targetBranchId = branchId) => runSqlText(`INSERT INTO public.cash_shifts(
    id,shift_number,branch_id,opened_by,opening_cash_in_minor_units
  ) SELECT ${sqlLiteral(randomUUID())},${sqlLiteral(`P44-${randomUUID()}`)},
    ${sqlLiteral(targetBranchId)},${sqlLiteral(ownerId)},0
  WHERE NOT EXISTS (
    SELECT 1 FROM public.cash_shifts
    WHERE branch_id=${sqlLiteral(targetBranchId)} AND status='open'
  );`, 'Ensure open Phase 4.4 Shift');

const createCustomerDeliverySale = async ({label, collected}) => {
  const phone = `079${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`;
  const key = randomUUID();
  await runSqlText(`UPDATE public.storefront_settings SET
      orders_enabled=true,minimum_order_in_minor_units=0,
      inside_ramtha_delivery_fee_in_minor_units=300,
      outside_ramtha_delivery_fee_in_minor_units=300;
    INSERT INTO public.inventory_balances(
      warehouse_id,product_id,on_hand_quantity,reserved_quantity
    ) SELECT warehouse.id,${sqlLiteral(productA)},100,0
      FROM public.warehouses warehouse
      JOIN public.branches branch ON branch.id=warehouse.branch_id
      WHERE warehouse.is_active AND branch.is_active
    ON CONFLICT (warehouse_id,product_id) DO UPDATE
      SET on_hand_quantity=public.inventory_balances.on_hand_quantity+100;`,
  `Configure positive delivery for ${label}`);
  const submitted = await readJson(`SELECT set_config(
      'request.jwt.claim.role','service_role',false);
    SELECT public.submit_guest_customer_order_v2(
      ${sqlLiteral(key)},repeat('c',64),repeat('d',64),${sqlLiteral(`عميل ${label}`)},
      ${sqlLiteral(phone)},'إربد','الرمثا','الحي الشرقي','شارع الاختبار',
      NULL,NULL,NULL,NULL,NULL,NULL,
      ${sqlLiteral(JSON.stringify([{
        commercial_line_kind: 'base_unit', product_id: productA,
        base_quantity: 1, expected_unit_price_in_minor_units: 1000,
      }]))}::jsonb,
      NULL,'cash_on_delivery','inside_ramtha',1000,0,300,1300
    );`, `Submit ${label} Customer V2 order`);
  assert.ok(submitted.order_id);
  const submittedOrder = await readJson(`SELECT jsonb_build_object('branchId',branch_id)
    FROM public.orders WHERE id=${sqlLiteral(submitted.order_id)};`,
  `Read ${label} assigned branch`);
  await ensureOpenShift(submittedOrder.branchId);
  await runSqlText(`UPDATE public.orders SET status='ready'
    WHERE id=${sqlLiteral(submitted.order_id)};`, `Ready ${label} order`);
  const completed = await readJson(`${ownerClaims}
    SELECT public.complete_website_order_with_settlement_v2(
      ${sqlLiteral(submitted.order_id)},${sqlLiteral(randomUUID())},
      'cash',${collected},300,NULL,${sqlLiteral(`Complete ${label}`)}
    );`, `Complete ${label} order`);
  assert.equal(completed.success, true);
  return readSale(submitted.order_id, `Read ${label} completed order`);
};

const createDiscountedParcelSale = async () => {
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
      ${sqlLiteral(warehouseId)},${sqlLiteral(branchId)},NULL,'Phase44 damage cap',
      'cash',${sqlLiteral(lines)}::jsonb,1000,4000,
      ${sqlLiteral(`phase44-damage-cap-${randomUUID()}`)}
    );`, 'Create discounted Parcel sale');
  assert.equal(result.success, true);
  return readJson(`SELECT jsonb_build_object(
    'orderId',customer_order.id,'shiftId',customer_order.cash_shift_id,
    'warehouseId',customer_order.warehouse_id,'total',customer_order.total_in_minor_units,
    'amountPaid',customer_order.amount_paid_in_minor_units,
    'orderItemId',item.id,'parcelId',instance.id,
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
  WHERE customer_order.id=${sqlLiteral(result.orderId)};`, 'Read discounted Parcel sale');
};

const returnItems = (fixture, quantity, disposition = 'damaged') => JSON.stringify([{
  return_scope: 'base_unit',
  order_item_id: fixture.orderItemId,
  quantity,
  stock_disposition: disposition,
}]);

const settleReturnSql = ({fixture, key, quantity, disposition = 'damaged', method = null,
  reference = null, reason}) => `${ownerClaims}
  SELECT public.settle_sales_return_v1(
    ${sqlLiteral(fixture.orderId)},${sqlLiteral(key)},
    ${sqlLiteral(returnItems(fixture, quantity, disposition))}::jsonb,
    ${sqlLiteral(reason)},${method ? sqlLiteral(method) : 'NULL'},
    ${reference ? sqlLiteral(reference) : 'NULL'},NULL
  );`;

const readFinancialFacts = (orderId) => readJson(`SELECT jsonb_build_object(
    'total',customer_order.total_in_minor_units,
    'delivery',customer_order.delivery_fee_in_minor_units,
    'collected',customer_order.amount_paid_in_minor_units,
    'paymentStatus',customer_order.payment_status,
    'priorDebt',COALESCE(SUM(event.debt_reduction_amount_in_minor_units)
      FILTER (WHERE event.settlement_status='settled' AND event.contract_version=401),0),
    'priorRefunds',COALESCE(SUM(event.money_refund_amount_in_minor_units)
      FILTER (WHERE event.settlement_status='settled' AND event.contract_version=401),0)
  ) FROM public.orders customer_order
  LEFT JOIN public.sales_return_events event ON event.order_id=customer_order.id
  WHERE customer_order.id=${sqlLiteral(orderId)}
  GROUP BY customer_order.id;`, 'Read independent financial facts');

const deriveFinancialPosition = (facts) => {
  const total = Number(facts.total);
  const delivery = Number(facts.delivery);
  const collected = Number(facts.collected);
  const priorDebt = Number(facts.priorDebt);
  const priorRefunds = Number(facts.priorRefunds);
  const outstanding = Math.max(total - collected - priorDebt, 0);
  const deliveryOutstanding = Math.min(delivery, outstanding);
  return {
    outstanding,
    deliveryOutstanding,
    merchandiseDebt: Math.max(outstanding - deliveryOutstanding, 0),
    refundableCollected: Math.max(
      collected - priorRefunds - (delivery - deliveryOutstanding),
      0,
    ),
  };
};

const assertFinancialResult = ({result, facts, entitlement}) => {
  const position = deriveFinancialPosition(facts);
  const expectedDebt = Math.min(entitlement, position.merchandiseDebt);
  const expectedRefund = entitlement - expectedDebt;
  assert.ok(expectedRefund <= position.refundableCollected);
  assert.equal(result.merchandiseEntitlementInMinorUnits, entitlement);
  assert.equal(result.debtReductionInMinorUnits, expectedDebt);
  assert.equal(result.moneyRefundInMinorUnits, expectedRefund);
  assert.equal(result.deliveryRefundInMinorUnits, 0);
  assert.equal(result.debtReductionInMinorUnits + result.moneyRefundInMinorUnits, entitlement);
  return position;
};

const readReturnEvidence = (returnId) => readJson(`SELECT jsonb_build_object(
    'event',jsonb_build_object(
      'status',event.settlement_status,
      'entitlement',event.merchandise_refund_amount_in_minor_units,
      'debt',event.debt_reduction_amount_in_minor_units,
      'refund',event.money_refund_amount_in_minor_units,
      'method',event.refund_method,
      'netCollected',event.net_collected_before_snapshot_in_minor_units,
      'rawDamage',event.raw_customer_damage_deduction_in_minor_units,
      'appliedDamage',event.applied_customer_damage_deduction_in_minor_units),
    'evidenceResult',evidence.result_snapshot
  ) FROM public.sales_return_events event
  JOIN public.phase42_return_settlement_evidence evidence
    ON evidence.operation_id=event.operation_id
  WHERE event.id=${sqlLiteral(returnId)};`, 'Read Return durable financial evidence');

const readShiftRefunds = (shiftId) => readJson(`SELECT jsonb_build_object(
    'cash',cash_refunds_in_minor_units,'cliq',cliq_refunds_in_minor_units)
  FROM public.cash_shifts WHERE id=${sqlLiteral(shiftId)};`, 'Read Shift refunds');

const readDurableFingerprint = (fixture) => readJson(`SELECT jsonb_build_object(
    'order',(SELECT jsonb_build_object(
      'total',total_in_minor_units,'delivery',delivery_fee_in_minor_units,
      'paid',amount_paid_in_minor_units,'paymentStatus',payment_status)
      FROM public.orders WHERE id=${sqlLiteral(fixture.orderId)}),
    'returns',(SELECT count(*) FROM public.sales_return_events
      WHERE order_id=${sqlLiteral(fixture.orderId)}),
    'debt',(SELECT COALESCE(sum(debt_reduction_amount_in_minor_units),0)
      FROM public.sales_return_events WHERE order_id=${sqlLiteral(fixture.orderId)}
        AND settlement_status='settled'),
    'refunds',(SELECT COALESCE(sum(money_refund_amount_in_minor_units),0)
      FROM public.sales_return_events WHERE order_id=${sqlLiteral(fixture.orderId)}
        AND settlement_status='settled'),
    'operations',(SELECT count(*) FROM public.business_operations
      WHERE request_identity_snapshot->>'order_id'=${sqlLiteral(fixture.orderId)}),
    'settlementEvidence',(SELECT count(*)
      FROM public.phase42_return_settlement_evidence evidence
      JOIN public.sales_return_events event ON event.id=evidence.return_event_id
      WHERE event.order_id=${sqlLiteral(fixture.orderId)}),
    'inventoryEffects',(SELECT count(*) FROM public.phase42_return_inventory_effects effect
      JOIN public.sales_return_events event ON event.id=effect.return_event_id
      WHERE event.order_id=${sqlLiteral(fixture.orderId)}),
    'movements',(SELECT count(*) FROM public.inventory_movements movement
      JOIN public.sales_return_events event ON event.id=movement.reference_id
      WHERE event.order_id=${sqlLiteral(fixture.orderId)}
        AND movement.reference_type='phase4_sales_return'),
    'inventory',(SELECT jsonb_build_object(
      'onHand',balance.on_hand_quantity,'reserved',balance.reserved_quantity)
      FROM public.inventory_balances balance
      WHERE balance.warehouse_id=${sqlLiteral(fixture.warehouseId)}
        AND balance.product_id=${sqlLiteral(fixture.productId)}),
    'shift',(SELECT jsonb_build_object(
      'cashRefunds',cash_refunds_in_minor_units,'cliqRefunds',cliq_refunds_in_minor_units)
      FROM public.cash_shifts WHERE id=${sqlLiteral(fixture.shiftId)})
  );`, 'Read durable financial fingerprint');

const assertEvidenceMatches = async (result) => {
  const evidence = await readReturnEvidence(result.returnId);
  assert.equal(evidence.event.status, 'settled');
  assert.equal(evidence.event.entitlement, result.merchandiseEntitlementInMinorUnits);
  assert.equal(evidence.event.debt, result.debtReductionInMinorUnits);
  assert.equal(evidence.event.refund, result.moneyRefundInMinorUnits);
  assert.deepEqual(evidence.evidenceResult, result);
  return evidence;
};

const runDebtFirstSplit = async () => {
  const customer = await createCustomer('debt split');
  const fixture = await createBaseSale({
    label: 'debt-split', quantity: 2, paymentMethod: 'debt', amountPaid: 0,
    customerId: customer.id,
  });
  await readJson(`${ownerClaims} SELECT public.record_customer_order_payment(
    ${sqlLiteral(fixture.orderId)},1500,'cash',NULL,'Phase 4.4 split collection');`,
  'Record debt split collection');
  const facts = await readFinancialFacts(fixture.orderId);
  const key = `phase44-debt-split-return-${randomUUID()}`;
  const reason = 'Phase 4.4 debt-first split';
  const result = await readJson(settleReturnSql({
    fixture, key, quantity: 2, method: 'cash', reason,
  }), 'Settle debt-first split');
  const position = assertFinancialResult({result, facts, entitlement: 2000});
  assert.equal(position.merchandiseDebt, 500);
  assert.equal(position.refundableCollected, 1500);
  await assertEvidenceMatches(result);
  return {fixture, key, reason, result};
};

const runCollectionBounds = async () => {
  const fullyPaid = await createBaseSale({
    label: 'fully-paid', quantity: 2, paymentMethod: 'cash', amountPaid: 2000,
  });
  const fullFacts = await readFinancialFacts(fullyPaid.orderId);
  const fullResult = await readJson(settleReturnSql({
    fixture: fullyPaid, key: `phase44-fully-paid-return-${randomUUID()}`,
    quantity: 1, method: 'cash', reason: 'Phase 4.4 fully paid entitlement bound',
  }), 'Settle fully-paid bounded Return');
  assertFinancialResult({result: fullResult, facts: fullFacts, entitlement: 1000});
  assert.equal(fullResult.moneyRefundInMinorUnits, 1000);
  assert.notEqual(fullResult.moneyRefundInMinorUnits, Number(fullFacts.collected));
  await assertEvidenceMatches(fullResult);

  const customer = await createCustomer('net collection');
  const bounded = await createBaseSale({
    label: 'net-collection', quantity: 3, paymentMethod: 'debt', amountPaid: 0,
    customerId: customer.id,
  });
  await readJson(`${ownerClaims} SELECT public.record_customer_order_payment(
    ${sqlLiteral(bounded.orderId)},1000,'cash',NULL,'Phase 4.4 active cash');`,
  'Record active cash collection');
  await readJson(`${ownerClaims} SELECT public.record_customer_order_payment(
    ${sqlLiteral(bounded.orderId)},1000,'cliq','P44-REVERSIBLE',
    'Phase 4.4 reversible CliQ');`, 'Record reversible CliQ collection');
  const cliqPayment = await readJson(`SELECT jsonb_build_object('id',id)
    FROM public.customer_payments WHERE order_id=${sqlLiteral(bounded.orderId)}
      AND payment_method='cliq' AND reference_number='P44-REVERSIBLE'
      AND is_reversed=false;`, 'Read reversible CliQ payment');
  await readJson(`${ownerClaims} SELECT public.reverse_customer_order_payment(
    ${sqlLiteral(cliqPayment.id)},'Phase 4.4 net collection bound');`,
  'Reverse CliQ collection');
  const boundedFacts = await readFinancialFacts(bounded.orderId);
  assert.equal(Number(boundedFacts.collected), 1000);
  const boundedResult = await readJson(settleReturnSql({
    fixture: bounded, key: `phase44-net-bound-return-${randomUUID()}`,
    quantity: 3, method: 'cash', reason: 'Phase 4.4 net collection bound',
  }), 'Settle net-collection-bounded Return');
  const boundedPosition = assertFinancialResult({
    result: boundedResult, facts: boundedFacts, entitlement: 3000,
  });
  assert.equal(boundedPosition.merchandiseDebt, 2000);
  assert.equal(boundedResult.moneyRefundInMinorUnits, 1000);
  await assertEvidenceMatches(boundedResult);
};

const runDamageDeductionCap = async () => {
  const fixture = await createDiscountedParcelSale();
  const rawDamage = fixture.components.reduce(
    (sum, component) => sum + Number(component.quantity) * Number(component.damagePrice),
    0,
  );
  assert.ok(rawDamage > Number(fixture.entitlement));
  const shiftBefore = await readShiftRefunds(fixture.shiftId);
  const request = JSON.stringify([{
    return_scope: 'parcel_instance', order_item_id: fixture.orderItemId,
    parcel_instance_id: fixture.parcelId,
    components: fixture.components.map((component) => ({
      parcel_component_id: component.id,
      accepted_quantity: 0,
      rejected_quantity: component.quantity,
      accepted_condition: null,
      accepted_stock_disposition: null,
      rejection_reason: 'customer_damage',
      rejected_stock_disposition: 'returned_to_customer',
    })),
  }]);
  const beforeFacts = await readFinancialFacts(fixture.orderId);
  const result = await readJson(`${ownerClaims}
    SELECT public.settle_sales_return_v1(
      ${sqlLiteral(fixture.orderId)},${sqlLiteral(`phase44-damage-return-${randomUUID()}`)},
      ${sqlLiteral(request)}::jsonb,'Phase 4.4 capped customer damage',NULL,NULL,NULL
    );`, 'Settle capped-damage Parcel Return');
  assert.equal(result.merchandiseEntitlementInMinorUnits, 0);
  assert.equal(result.debtReductionInMinorUnits, 0);
  assert.equal(result.moneyRefundInMinorUnits, 0);
  const evidence = await assertEvidenceMatches(result);
  assert.equal(Number(evidence.event.rawDamage), rawDamage);
  assert.equal(Number(evidence.event.appliedDamage), Number(fixture.entitlement));
  const afterFacts = await readFinancialFacts(fixture.orderId);
  const shiftAfter = await readShiftRefunds(fixture.shiftId);
  assert.equal(deriveFinancialPosition(afterFacts).outstanding, 0);
  assert.equal(Number(afterFacts.total), Number(beforeFacts.total));
  assert.deepEqual(shiftAfter, shiftBefore);
  const effects = await readJson(`SELECT jsonb_build_object(
    'inventoryEffects',(SELECT count(*) FROM public.phase42_return_inventory_effects
      WHERE operation_id=${sqlLiteral(result.operationId)})
  );`, 'Read damage-cap side effects');
  assert.equal(effects.inventoryEffects, 0);
};

const settleDeliveryReturn = async (label, collected) => {
  const fixture = await createCustomerDeliverySale({label, collected});
  const facts = await readFinancialFacts(fixture.orderId);
  const result = await readJson(settleReturnSql({
    fixture, key: `phase44-${label}-return-${randomUUID()}`,
    quantity: 1, method: 'cash', reason: `Phase 4.4 ${label} delivery proof`,
  }), `Settle ${label} delivery Return`);
  const position = assertFinancialResult({result, facts, entitlement: 1000});
  assert.equal(result.deliveryRefundInMinorUnits, 0);
  await assertEvidenceMatches(result);
  const after = await readFinancialFacts(fixture.orderId);
  assert.equal(Number(after.delivery), 300);
  return {result, position, after};
};

const runDeliveryScenarios = async () => {
  const paid = await settleDeliveryReturn('paid-delivery', 1300);
  assert.equal(paid.position.deliveryOutstanding, 0);
  assert.equal(paid.result.moneyRefundInMinorUnits, 1000);
  assert.equal(paid.after.paymentStatus, 'paid');

  const unpaid = await settleDeliveryReturn('unpaid-delivery', 1000);
  assert.equal(unpaid.position.deliveryOutstanding, 300);
  assert.equal(unpaid.position.merchandiseDebt, 0);
  assert.equal(unpaid.result.debtReductionInMinorUnits, 0);
  assert.equal(unpaid.result.moneyRefundInMinorUnits, 1000);
  assert.equal(deriveFinancialPosition(unpaid.after).deliveryOutstanding, 300);
  assert.equal(unpaid.after.paymentStatus, 'partially_paid');
};

const runCrossSaleIsolation = async () => {
  const customer = await createCustomer('cross-sale');
  const saleA = await createBaseSale({
    label: 'cross-sale-a', quantity: 1, paymentMethod: 'debt', amountPaid: 0,
    customerId: customer.id,
  });
  const saleB = await createBaseSale({
    label: 'cross-sale-b', quantity: 2, paymentMethod: 'cash', amountPaid: 2000,
    customerId: customer.id,
  });
  const saleBBefore = await readDurableFingerprint(saleB);
  const factsA = await readFinancialFacts(saleA.orderId);
  assert.equal(Number(factsA.collected), 0);
  const result = await readJson(settleReturnSql({
    fixture: saleA, key: `phase44-cross-sale-return-${randomUUID()}`,
    quantity: 1, reason: 'Phase 4.4 cross-sale payment isolation',
  }), 'Settle cross-sale-isolated Return');
  assertFinancialResult({result, facts: factsA, entitlement: 1000});
  assert.equal(result.debtReductionInMinorUnits, 1000);
  assert.equal(result.moneyRefundInMinorUnits, 0);
  const evidence = await assertEvidenceMatches(result);
  assert.equal(Number(evidence.event.netCollected), 0);
  const saleBAfter = await readDurableFingerprint(saleB);
  assert.deepEqual(saleBAfter, saleBBefore);
};

const runReplayZeroWrite = async ({fixture, key, reason, result}) => {
  const before = await readDurableFingerprint(fixture);
  const replay = await readJson(settleReturnSql({
    fixture, key, quantity: 2, method: 'cash', reason,
  }), 'Replay committed debt-first Return');
  const after = await readDurableFingerprint(fixture);
  assert.deepEqual(replay, result);
  assert.deepEqual(after, before);
};

const runRejectionAtomicity = async () => {
  const fixture = await createBaseSale({
    label: 'injected-failure', quantity: 1, paymentMethod: 'cash', amountPaid: 1000,
  });
  const key = `phase44-injected-failure-${randomUUID()}`;
  const before = await readDurableFingerprint(fixture);
  await runSqlText(`CREATE FUNCTION public.phase44_fail_financial_settlement()
      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        RAISE EXCEPTION 'PHASE44_INJECTED_FINANCIAL_FAILURE';
      END $$;
    CREATE TRIGGER trg_phase44_fail_financial_settlement
      AFTER INSERT ON public.phase42_return_settlement_evidence
      FOR EACH ROW EXECUTE FUNCTION public.phase44_fail_financial_settlement();`,
  'Install Phase 4.4 rollback fault');
  try {
    await expectSqlError(settleReturnSql({
      fixture, key, quantity: 1, disposition: 'restock', method: 'cash',
      reason: 'Phase 4.4 injected rollback',
    }), /PHASE44_INJECTED_FINANCIAL_FAILURE/u, 'Injected financial rollback');
  } finally {
    await runSqlText(`DROP TRIGGER IF EXISTS trg_phase44_fail_financial_settlement
        ON public.phase42_return_settlement_evidence;
      DROP FUNCTION IF EXISTS public.phase44_fail_financial_settlement();`,
    'Remove Phase 4.4 rollback fault');
  }
  const after = await readDurableFingerprint(fixture);
  assert.deepEqual(after, before);
  const operationCount = await readJson(`SELECT jsonb_build_object('count',count(*))
    FROM public.business_operations WHERE idempotency_key=${sqlLiteral(key)};`,
  'Verify rejected operation absence');
  assert.equal(operationCount.count, 0);
};

try {
  const {stdout} = await execFileAsync(process.execPath, [bootstrapPath], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NAWASRAH_ISOLATED_PROJECT_ID: projectId,
      ...(currentPackageD ? {NAWASRAH_MAX_MIGRATION: '131'} : {}),
      NAWASRAH_SKIP_REDUNDANT_DB_RESET: 'true',
      NAWASRAH_SUPABASE_EXCLUDE:
        (currentPackageD ? 'gotrue,kong,postgrest,' : '')
        + 'realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor',
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
  if (currentPackageD) await runSqlText(await readFile(path.join(projectRoot,
    'supabase/migrations/132_package_d_system_unification.sql'),'utf8'), 'Activate current132 after historical fixtures');
  await ensureOpenShift();

  const replayFixture = await runDebtFirstSplit();
  await runCollectionBounds();
  await runDamageDeductionCap();
  await runDeliveryScenarios();
  await runCrossSaleIsolation();
  await runReplayZeroWrite(replayFixture);
  await runRejectionAtomicity();

  console.log(JSON.stringify({
    ok: true,
    phase: '4.4',
    slice: 'financial-integration',
    freshRebuild: currentPackageD ? '001-131' : '001-123',
    operationalSchema: currentPackageD ? '001-132' : 'historical',
    migration123: currentPackageD ? 'RETIRED_BY_132' : 'PRIVATE_INACTIVE',
    breakMatrix: SLICE_1_BREAK_MATRIX,
    scenarios: Object.fromEntries(Object.keys(SLICE_1_BREAK_MATRIX).map((key) => [key, true])),
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
