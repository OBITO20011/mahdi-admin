import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { observeOutcome, assertLifecycleRace } from './phase3-lifecycle-harness.mjs';

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..');
const bootstrapPath = path.join(scriptDirectory, 'bootstrap-isolated-supabase.mjs');
const runtimeSqlPath = path.join(
  scriptDirectory,
  'phase3-configurable-parcel-contracts-runtime.sql',
);
const cliPath = path.join(projectRoot, 'node_modules', 'supabase', 'dist', 'supabase.js');
const projectId = process.env.NAWASRAH_PHASE3_CONTRACTS_PROJECT_ID ||
  'nawasrah-phase3-contracts-test';
const databaseContainer = `supabase_db_${projectId}`;
let isolatedProjectRoot = '';

const OWNER = '92400000-0000-0000-0000-000000000001';
const CASHIER = '92400000-0000-0000-0000-000000000002';
const FAMILY = '92400000-0000-0000-0000-000000000100';
const SKU_A = '92400000-0000-0000-0000-000000000101';
const SKU_B = '92400000-0000-0000-0000-000000000102';
const OTHER = '92400000-0000-0000-0000-000000000103';
const CONFIG = '92400000-0000-0000-0000-000000000300';
const OPERATION = '92400000-0000-0000-0000-000000000400';
const SUPPLIER = '92400000-0000-0000-0000-000000000500';
const BRANCH = '92400000-0000-0000-0000-000000000200';
const WAREHOUSE = '92400000-0000-0000-0000-000000000201';
const SHIFT = '92400000-0000-0000-0000-000000000202';
const LEGACY_BRANCH_B = '92400000-0000-0000-0000-000000000210';
const LEGACY_WAREHOUSE_B = '92400000-0000-0000-0000-000000000211';
const LEGACY_SHIFT_B = '92400000-0000-0000-0000-000000000212';
const LEGACY_INACTIVE_WAREHOUSE = '92400000-0000-0000-0000-000000000213';

assert.match(databaseContainer, /^supabase_db_nawasrah-[a-z0-9-]+-test$/u);

const runSql = (sql) => new Promise((resolve, reject) => {
  const child = spawn(
    'docker',
    [
      'exec', '-i', databaseContainer,
      'psql', '-U', 'postgres', '-d', 'postgres',
      '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1',
      '-v', 'VERBOSITY=verbose',
    ],
    { cwd: projectRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let stdout = '';
  let stderr = '';
  let completed = false;
  const timeout = setTimeout(() => {
    if (completed) return;
    completed = true;
    child.kill('SIGKILL');
    reject(new Error('Phase 3.1 SQL process exceeded 60 seconds.'));
  }, 60_000);
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', (error) => {
    if (completed) return;
    completed = true;
    clearTimeout(timeout);
    reject(error);
  });
  child.on('close', (code) => {
    if (completed) return;
    completed = true;
    clearTimeout(timeout);
    if (code === 0) resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    else reject(new Error(`Phase 3.1 SQL failed: ${stderr}\n${stdout}`));
  });
  child.stdin.end(`SET statement_timeout='45s'; SET lock_timeout='35s';\n${sql}`);
});

const readJson = async (sql) => {
  const { stdout } = await runSql(sql);
  const value = stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).at(-1);
  assert.ok(value, 'Expected JSON SQL output.');
  return JSON.parse(value);
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const sqlValue = (value) => value === null
  ? 'NULL'
  : `'${String(value).replaceAll("'", "''")}'`;
const assertFailureIdentity = (
  message,
  {
    sqlState,
    constraint = null,
    applicationIdentity = null,
    wrappedApplicationIdentity = null,
  },
) => {
  assert.match(message, new RegExp(`ERROR:\\s+${escapeRegExp(sqlState)}:`, 'u'));
  if (constraint) {
    assert.match(
      message,
      new RegExp(`CONSTRAINT NAME:\\s+${escapeRegExp(constraint)}(?:\\r?\\n|$)`, 'u'),
    );
  }
  if (applicationIdentity) {
    assert.match(
      message,
      new RegExp(
        `ERROR:\\s+${escapeRegExp(sqlState)}:\\s+${escapeRegExp(applicationIdentity)}:`,
        'u',
      ),
    );
  }
  if (wrappedApplicationIdentity) {
    assert.match(
      message,
      new RegExp(
        `ERROR:\\s+${escapeRegExp(sqlState)}:[^\\n]*${escapeRegExp(wrappedApplicationIdentity)}:`,
        'u',
      ),
    );
  }
  assert.ok(
    constraint || applicationIdentity || wrappedApplicationIdentity,
    'Strict failure identity is required.',
  );
};

const expectSqlFailure = async (sql, expected) => {
  try {
    await runSql(sql);
    assert.fail('Expected isolated SQL operation to fail.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assertFailureIdentity(message, expected);
    return message;
  }
};

const expectExactSqlFailure = async (sql, {sqlState, messageText}) => {
  try {
    await runSql(sql);
    assert.fail('Expected isolated SQL operation to fail.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.match(
      message,
      new RegExp(
        `ERROR:\\s+${escapeRegExp(sqlState)}:\\s+${escapeRegExp(messageText)}(?:\\r?\\n|$)`,
        'u',
      ),
    );
    return message;
  }
};

const assertMixedCommittedStateSnapshot = ({state, expectations, beforeBalances}) => {
  assert.equal(state.orders.length, expectations.length, 'Unexpected mixed-version Order count.');
  assert.equal(state.items.length, expectations.length, 'Unexpected mixed-version Order Item count.');
  assert.equal(state.orphanReservations, 0, 'Orphan reservation exists.');

  const expectedOperations = expectations.filter((expected) => expected.operationType !== null);
  const expectedReservations = expectations.filter(
    (expected) => expected.detailedReservationQuantity > 0,
  );
  assert.equal(
    state.operations.length,
    expectedOperations.length,
    'Unexpected mixed-version business operation count.',
  );
  assert.equal(
    state.reservations.length,
    expectedReservations.length,
    'Unexpected mixed-version detailed reservation count.',
  );

  const expectedCustomers = new Map();
  for (const expected of expectations) {
    expectedCustomers.set(expected.customerId, expected.normalizedPhone);
    const matchingOrders = state.orders.filter(
      (order) => order.idempotencyKey === expected.idempotencyKey,
    );
    assert.equal(
      matchingOrders.length,
      1,
      `Expected exactly one Order for ${expected.idempotencyKey}.`,
    );
    const order = matchingOrders[0];
    assert.equal(
      order.customerId,
      expected.customerId,
      `Customer linkage mismatch for ${expected.idempotencyKey}.`,
    );
    assert.equal(order.source, 'website', `Order source mismatch for ${expected.idempotencyKey}.`);

    const matchingItems = state.items.filter((item) => item.orderId === order.id);
    assert.equal(
      matchingItems.length,
      1,
      `Expected exactly one Order Item for ${expected.idempotencyKey}.`,
    );
    const item = matchingItems[0];
    assert.equal(
      item.productId,
      expected.productId,
      `Product linkage mismatch for ${expected.idempotencyKey}.`,
    );
    assert.equal(
      item.quantity,
      expected.persistedLineQuantity,
      `Persisted line quantity mismatch for ${expected.idempotencyKey}.`,
    );
    assert.equal(
      item.salePackageQuantity,
      expected.salePackageQuantity,
      `Sale-package quantity mismatch for ${expected.idempotencyKey}.`,
    );
    assert.equal(
      item.unitsPerSalePackage,
      expected.unitsPerSalePackage,
      `Units-per-package mismatch for ${expected.idempotencyKey}.`,
    );
    assert.equal(
      item.lineKind,
      expected.lineKind,
      `Line kind mismatch for ${expected.idempotencyKey}.`,
    );

    const matchingOperations = state.operations.filter(
      (operation) => operation.idempotencyKey === expected.idempotencyKey,
    );
    if (expected.operationType === null) {
      assert.equal(order.operationId, null, `V1 Order unexpectedly has an operation ID for ${expected.idempotencyKey}.`);
      assert.equal(matchingOperations.length, 0, `V1 Order unexpectedly has a business operation for ${expected.idempotencyKey}.`);
    } else {
      assert.ok(order.operationId, `V2 Order lacks an operation ID for ${expected.idempotencyKey}.`);
      assert.equal(matchingOperations.length, 1, `V2 business operation count mismatch for ${expected.idempotencyKey}.`);
      assert.equal(matchingOperations[0].id, order.operationId);
      assert.equal(matchingOperations[0].operationType, expected.operationType);
    }

    const matchingReservations = state.reservations.filter(
      (reservation) => reservation.orderId === order.id,
    );
    if (expected.detailedReservationQuantity === 0) {
      assert.equal(
        matchingReservations.length,
        0,
        `V1 Order unexpectedly has a Phase-3 reservation for ${expected.idempotencyKey}.`,
      );
    } else {
      assert.equal(
        matchingReservations.length,
        1,
        `V2 reservation count mismatch for ${expected.idempotencyKey}.`,
      );
      const reservation = matchingReservations[0];
      assert.equal(
        reservation.orderId,
        order.id,
        `Reservation Order linkage mismatch for ${expected.idempotencyKey}.`,
      );
      assert.equal(
        reservation.operationId,
        order.operationId,
        `Reservation operation linkage mismatch for ${expected.idempotencyKey}.`,
      );
      assert.equal(
        reservation.productId,
        expected.productId,
        `Reservation Product linkage mismatch for ${expected.idempotencyKey}.`,
      );
      assert.equal(
        reservation.quantity,
        expected.detailedReservationQuantity,
        `Reservation quantity mismatch for ${expected.idempotencyKey}.`,
      );
      assert.equal(
        reservation.state,
        'active',
        `Reservation state mismatch for ${expected.idempotencyKey}.`,
      );
    }
  }

  assert.equal(state.customers.length, expectedCustomers.size, 'Unexpected fixture Customer count.');
  for (const [customerId, normalizedPhone] of expectedCustomers) {
    const customers = state.customers.filter((customer) => customer.id === customerId);
    assert.equal(customers.length, 1, `Expected fixture Customer ${customerId} exactly once.`);
    assert.equal(customers[0].normalizedPhone, normalizedPhone);
  }

  const fixtureReservedEffects = new Map();
  for (const expected of expectations) {
    fixtureReservedEffects.set(
      expected.productId,
      (fixtureReservedEffects.get(expected.productId) || 0)
        + expected.inventoryReservedEffect,
    );
  }
  for (const productId of [SKU_A, SKU_B]) {
    const expectedReservedEffect = fixtureReservedEffects.get(productId) || 0;
    assert.ok(state.balances[productId], `Missing actual balance for ${productId}.`);
    assert.ok(beforeBalances[productId], `Missing baseline balance for ${productId}.`);
    assert.equal(
      state.balances[productId].onHand,
      beforeBalances[productId].onHand,
      `On-hand balance changed unexpectedly for ${productId}.`,
    );
    assert.equal(
      state.balances[productId].reserved,
      beforeBalances[productId].reserved + expectedReservedEffect,
      `Aggregate reserved quantity mismatch for ${productId}.`,
    );
  }
};

const targetedState = () => readJson(`
  SELECT jsonb_build_object(
    'operations', (SELECT jsonb_agg(to_jsonb(operation) ORDER BY operation.id)
      FROM public.business_operations operation
      WHERE operation.id='${OPERATION}'),
    'orders', (SELECT jsonb_agg(to_jsonb(orders) ORDER BY orders.id)
      FROM public.orders orders WHERE orders.operation_id='${OPERATION}'),
    'items', (SELECT jsonb_agg(to_jsonb(item) ORDER BY item.id)
      FROM public.order_items item
      WHERE item.order_id IN (SELECT id FROM public.orders WHERE operation_id='${OPERATION}')),
    'instances', (SELECT jsonb_agg(to_jsonb(instance) ORDER BY instance.id)
      FROM public.order_parcel_instances instance WHERE instance.operation_id='${OPERATION}'),
    'components', (SELECT jsonb_agg(to_jsonb(component) ORDER BY component.id)
      FROM public.order_parcel_components component WHERE component.operation_id='${OPERATION}'),
    'reservations', (SELECT jsonb_agg(to_jsonb(reservation) ORDER BY reservation.id)
      FROM public.order_inventory_reservations reservation WHERE reservation.operation_id='${OPERATION}'),
    'balances', (SELECT jsonb_agg(to_jsonb(balance) ORDER BY balance.product_id)
      FROM public.inventory_balances balance
      WHERE balance.product_id IN ('${SKU_A}', '${SKU_B}', '${OTHER}')),
    'products', (SELECT jsonb_agg(to_jsonb(product) ORDER BY product.id)
      FROM public.products product WHERE product.id IN ('${SKU_A}', '${SKU_B}', '${OTHER}')),
    'movements', (SELECT jsonb_agg(to_jsonb(movement) ORDER BY movement.id)
      FROM public.inventory_movements movement WHERE movement.operation_id='${OPERATION}')
  );
`);

// Every invocation opens a new psql connection.  This intentionally observes
// committed state after the tested RPC has completed rather than relying on a
// timestamp or a snapshot from the caller's transaction.
const saleBusinessState = (idempotencyKey) => readJson(`
  WITH target_orders AS (
    SELECT orders.id, orders.operation_id
    FROM public.orders orders
    WHERE orders.idempotency_key='${idempotencyKey}'
  ), target_operations AS (
    SELECT operation.id
    FROM public.business_operations operation
    WHERE operation.idempotency_key='${idempotencyKey}'
  )
  SELECT jsonb_build_object(
    'operations', (SELECT jsonb_agg(to_jsonb(operation) ORDER BY operation.id)
      FROM public.business_operations operation
      WHERE operation.id IN (SELECT id FROM target_operations)),
    'orders', (SELECT jsonb_agg(to_jsonb(orders) ORDER BY orders.id)
      FROM public.orders orders WHERE orders.id IN (SELECT id FROM target_orders)),
    'items', (SELECT jsonb_agg(to_jsonb(item) ORDER BY item.id)
      FROM public.order_items item
      WHERE item.order_id IN (SELECT id FROM target_orders)),
    'instances', (SELECT jsonb_agg(to_jsonb(instance) ORDER BY instance.id)
      FROM public.order_parcel_instances instance
      WHERE instance.order_id IN (SELECT id FROM target_orders)),
    'components', (SELECT jsonb_agg(to_jsonb(component) ORDER BY component.id)
      FROM public.order_parcel_components component
      WHERE component.operation_id IN (SELECT id FROM target_operations)),
    'reservations', (SELECT jsonb_agg(to_jsonb(reservation) ORDER BY reservation.id)
      FROM public.order_inventory_reservations reservation
      WHERE reservation.operation_id IN (SELECT id FROM target_operations)),
    'movements', (SELECT jsonb_agg(to_jsonb(movement) ORDER BY movement.id)
      FROM public.inventory_movements movement
      WHERE movement.operation_id IN (SELECT id FROM target_operations)
        OR movement.reference_id IN (SELECT id FROM target_orders)),
    'statusHistory', (SELECT jsonb_agg(to_jsonb(history) ORDER BY history.id)
      FROM public.order_status_history history
      WHERE history.order_id IN (SELECT id FROM target_orders)),
    'customerPayments', (SELECT jsonb_agg(to_jsonb(payment) ORDER BY payment.id)
      FROM public.customer_payments payment
      WHERE payment.order_id IN (SELECT id FROM target_orders)),
    'balances', (SELECT jsonb_agg(to_jsonb(balance) ORDER BY balance.product_id)
      FROM public.inventory_balances balance
      WHERE balance.warehouse_id='${WAREHOUSE}'
        AND balance.product_id IN ('${SKU_A}','${SKU_B}','${OTHER}')),
    'products', (SELECT jsonb_agg(jsonb_build_object(
        'id', product.id,
        'legacyWac', product.cost_price_in_minor_units,
        'exactWac', product.wac_cost_in_minor_units_exact,
        'updatedAt', product.updated_at
      ) ORDER BY product.id)
      FROM public.products product
      WHERE product.id IN ('${SKU_A}','${SKU_B}','${OTHER}')),
    'shift', (SELECT to_jsonb(shift) FROM public.cash_shifts shift
      WHERE shift.id='${SHIFT}'),
    'counts', jsonb_build_object(
      'operations', (SELECT count(*) FROM public.business_operations),
      'orders', (SELECT count(*) FROM public.orders),
      'items', (SELECT count(*) FROM public.order_items),
      'instances', (SELECT count(*) FROM public.order_parcel_instances),
      'components', (SELECT count(*) FROM public.order_parcel_components),
      'reservations', (SELECT count(*) FROM public.order_inventory_reservations),
      'movements', (SELECT count(*) FROM public.inventory_movements),
      'payments', (SELECT count(*) FROM public.customer_payments),
      'auditLogs', (SELECT count(*) FROM public.audit_logs)
    )
  );
`);

const financialReadState = () => readJson(`${ownerClaimsSql}
  SELECT jsonb_build_object(
    'shift', public.get_cash_shift_summary('${SHIFT}'),
    'report', public.get_operational_business_report(
      '${BRANCH}',
      (NOW() AT TIME ZONE 'Asia/Amman')::DATE,
      (NOW() AT TIME ZONE 'Asia/Amman')::DATE
    ),
    'customerPaymentCount', (SELECT count(*) FROM public.customer_payments)
  );
`);

const stableFinancialReadState = (state) => {
  const stable = structuredClone(state);
  delete stable.report?.generatedAt;
  return stable;
};

const waitFor = async (predicate, label, timeoutMs = 15_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  assert.fail(`Timed out waiting for ${label}.`);
};

const ownerClaimsSql = `SELECT set_config(
  'request.jwt.claims',
  '{"sub":"${OWNER}","role":"authenticated","aal":"aal2"}',
  false
);`;

const startLockHolder = async (lockSql, applicationName) => {
  const child = spawn('docker', [
    'exec', '-i', databaseContainer,
    'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A',
    '-v', 'ON_ERROR_STOP=1',
  ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const closed = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => code === 0
      ? resolve()
      : reject(new Error(`${applicationName} lock holder failed: ${stderr}`)));
  });
  child.stdin.write(`SET application_name='${applicationName}'; BEGIN;
    ${lockSql}; SELECT 'PHASE3_HOLDER_READY';\n`);
  await waitFor(
    async () => stdout.includes('PHASE3_HOLDER_READY'),
    `${applicationName} lock holder`,
  );
  return {
    release: async () => {
      child.stdin.end('COMMIT;\n\\q\n');
      await closed;
    },
  };
};

const waitForBlockedApplications = async (applicationNames) => {
  await waitFor(async () => {
    const result = await readJson(`SELECT jsonb_build_object(
      'blocked', COUNT(DISTINCT waiter.application_name)
    ) FROM pg_stat_activity waiter
    WHERE waiter.application_name = ANY(ARRAY[${applicationNames
      .map((name) => `'${name}'`)
      .join(',')}])
      AND CARDINALITY(pg_blocking_pids(waiter.pid)) > 0;`);
    return result.blocked === applicationNames.length;
  }, `blocked applications ${applicationNames.join(', ')}`);
};

const parcelLine = (instanceCount = 1) => ({
  commercial_line_kind: 'configurable_parcel',
  family_product_id: FAMILY,
  parcel_configuration_id: CONFIG,
  configuration_revision: 1,
  price_authority: 'server_catalog',
  line_discount_in_minor_units: 0,
  parcel_instances: Array.from({ length: instanceCount }, () => ({
    components: [
      { product_id: SKU_A, base_quantity: 2 },
      { product_id: SKU_B, base_quantity: 3 },
    ],
  })),
});

const baseLine = (productId, quantity) => ({
  commercial_line_kind: 'base_unit',
  product_id: productId,
  base_quantity: quantity,
  price_authority: 'server_catalog',
  line_discount_in_minor_units: 0,
});

const callPosV2 = (key, customerName, paymentMethod, lines, discount, tender) =>
  readJson(`${ownerClaimsSql}
    SELECT public.create_pos_sale_v2(
      '${WAREHOUSE}', '${BRANCH}', NULL,
      '${customerName}', '${paymentMethod}',
      $phase3$${JSON.stringify(lines)}$phase3$::jsonb,
      ${discount}, ${tender}, '${key}'
    );`);

const storedDiscountState = (orderId) => readJson(`
  SELECT jsonb_build_object(
    'lineDiscountTotal', COALESCE((SELECT sum(allocated_discount_snapshot_in_minor_units)
      FROM public.order_items WHERE order_id='${orderId}'), 0),
    'lineNetTotal', COALESCE((SELECT sum(net_refundable_amount_snapshot_in_minor_units)
      FROM public.order_items WHERE order_id='${orderId}'), 0),
    'lines', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'kind', item.commercial_line_kind,
        'productId', item.product_id,
        'quantity', item.quantity,
        'gross', item.line_total_in_minor_units,
        'discount', item.allocated_discount_snapshot_in_minor_units,
        'net', item.net_refundable_amount_snapshot_in_minor_units
      ) ORDER BY item.commercial_line_kind, item.product_id NULLS FIRST, item.quantity)
      FROM public.order_items item WHERE item.order_id='${orderId}'), '[]'::jsonb),
    'instances', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'parentQuantity', item.quantity,
        'sequence', instance.instance_sequence,
        'gross', instance.gross_amount_snapshot_in_minor_units,
        'discount', instance.allocated_discount_snapshot_in_minor_units,
        'net', instance.net_refundable_amount_snapshot_in_minor_units
      ) ORDER BY item.quantity, instance.instance_sequence)
      FROM public.order_parcel_instances instance
      JOIN public.order_items item ON item.id=instance.order_item_id
      WHERE instance.order_id='${orderId}'), '[]'::jsonb),
    'parentReconciled', NOT EXISTS (
      SELECT 1 FROM public.order_items item
      WHERE item.order_id='${orderId}'
        AND item.commercial_line_kind='configurable_parcel'
        AND (
          SELECT COALESCE(sum(instance.allocated_discount_snapshot_in_minor_units),0)
          FROM public.order_parcel_instances instance
          WHERE instance.order_item_id=item.id
        ) IS DISTINCT FROM item.allocated_discount_snapshot_in_minor_units
    ),
    'parentNetReconciled', NOT EXISTS (
      SELECT 1 FROM public.order_items item
      WHERE item.order_id='${orderId}'
        AND item.commercial_line_kind='configurable_parcel'
        AND (
          SELECT COALESCE(sum(instance.net_refundable_amount_snapshot_in_minor_units),0)
          FROM public.order_parcel_instances instance
          WHERE instance.order_item_id=item.id
        ) IS DISTINCT FROM item.net_refundable_amount_snapshot_in_minor_units
    ),
    'componentRevenueDiscountColumns', (
      SELECT count(*) FROM information_schema.columns
      WHERE table_schema='public' AND table_name='order_parcel_components'
        AND column_name LIKE '%discount%'
    )
  );
`);

const assertLineAllocation = (state, selector, expectedDiscount, expectedNet) => {
  const line = state.lines.find((candidate) =>
    candidate.kind === selector.kind
      && (selector.productId === undefined || candidate.productId === selector.productId)
      && (selector.quantity === undefined || candidate.quantity === selector.quantity));
  assert.ok(line, `Missing stored line for ${JSON.stringify(selector)}.`);
  assert.equal(line.discount, expectedDiscount);
  assert.equal(line.net, expectedNet);
};

const runDiscountAllocationMatrix = async () => {
  await runSql(`UPDATE public.configurable_parcel_feature_settings
    SET feature_state='ENABLED', updated_at=NOW()
    WHERE feature_key='configurable_parcels';
    UPDATE public.inventory_balances
    SET on_hand_quantity=5000, reserved_quantity=0
    WHERE warehouse_id='${WAREHOUSE}'
      AND product_id IN ('${SKU_A}','${SKU_B}');`);

  const cases = [
    {
      name: 'single-parcel', lines: [parcelLine(1)], discount: 1, total: 4999,
      expected: [{ selector: { kind: 'configurable_parcel', quantity: 1 }, discount: 1, net: 4999 }],
      instanceDiscounts: [1],
    },
    {
      name: 'parcel-plus-base', lines: [parcelLine(2), baseLine(SKU_A, 5)],
      discount: 6, total: 14994,
      expected: [
        { selector: { kind: 'configurable_parcel', quantity: 2 }, discount: 4, net: 9996 },
        { selector: { kind: 'base_unit', productId: SKU_A, quantity: 5 }, discount: 2, net: 4998 },
      ],
      instanceDiscounts: [2, 2],
    },
    {
      name: 'base-plus-parcel-reversed', lines: [baseLine(SKU_A, 5), parcelLine(2)],
      discount: 6, total: 14994,
      expected: [
        { selector: { kind: 'configurable_parcel', quantity: 2 }, discount: 4, net: 9996 },
        { selector: { kind: 'base_unit', productId: SKU_A, quantity: 5 }, discount: 2, net: 4998 },
      ],
      instanceDiscounts: [2, 2],
    },
    {
      name: 'two-parcel-parents', lines: [parcelLine(2), parcelLine(1)],
      discount: 6, total: 14994,
      expected: [
        { selector: { kind: 'configurable_parcel', quantity: 2 }, discount: 4, net: 9996 },
        { selector: { kind: 'configurable_parcel', quantity: 1 }, discount: 2, net: 4998 },
      ],
      instanceDiscounts: [2, 2, 2],
    },
    {
      name: 'multiple-instances', lines: [parcelLine(3)], discount: 4, total: 14996,
      expected: [{ selector: { kind: 'configurable_parcel', quantity: 3 }, discount: 4, net: 14996 }],
      instanceDiscounts: [2, 1, 1],
    },
    {
      name: 'three-mixed-lines', lines: [parcelLine(2), baseLine(SKU_A, 5), baseLine(SKU_B, 3)],
      discount: 7, total: 17993,
      expected: [
        { selector: { kind: 'configurable_parcel', quantity: 2 }, discount: 4, net: 9996 },
        { selector: { kind: 'base_unit', productId: SKU_A, quantity: 5 }, discount: 2, net: 4998 },
        { selector: { kind: 'base_unit', productId: SKU_B, quantity: 3 }, discount: 1, net: 2999 },
      ],
      instanceDiscounts: [2, 2],
    },
    {
      name: 'order-residual', lines: [parcelLine(1), baseLine(SKU_A, 1)],
      discount: 1, total: 5999,
      expected: [
        { selector: { kind: 'configurable_parcel', quantity: 1 }, discount: 1, net: 4999 },
        { selector: { kind: 'base_unit', productId: SKU_A, quantity: 1 }, discount: 0, net: 1000 },
      ],
      instanceDiscounts: [1],
    },
    {
      name: 'instance-residual', lines: [parcelLine(2)], discount: 1, total: 9999,
      expected: [{ selector: { kind: 'configurable_parcel', quantity: 2 }, discount: 1, net: 9999 }],
      instanceDiscounts: [1, 0],
    },
    {
      name: 'zero-discount', lines: [parcelLine(1), baseLine(SKU_A, 1)],
      discount: 0, total: 6000,
      expected: [
        { selector: { kind: 'configurable_parcel', quantity: 1 }, discount: 0, net: 5000 },
        { selector: { kind: 'base_unit', productId: SKU_A, quantity: 1 }, discount: 0, net: 1000 },
      ],
      instanceDiscounts: [0],
    },
  ];

  for (const [index, testCase] of cases.entries()) {
    const result = await callPosV2(
      `phase3-discount-matrix-${String(index + 1).padStart(2, '0')}-0001`,
      `Discount matrix ${index + 1}`,
      'cash', testCase.lines, testCase.discount, testCase.total,
    );
    assert.equal(result.success, true);
    assert.equal(result.discountInMinorUnits, testCase.discount);
    assert.equal(result.totalInMinorUnits, testCase.total);
    const state = await storedDiscountState(result.orderId);
    assert.equal(state.lineDiscountTotal, testCase.discount);
    assert.equal(state.lineNetTotal, testCase.total);
    assert.equal(state.parentReconciled, true);
    assert.equal(state.parentNetReconciled, true);
    assert.equal(state.componentRevenueDiscountColumns, 0);
    for (const expectation of testCase.expected) {
      assertLineAllocation(
        state, expectation.selector, expectation.discount, expectation.net,
      );
    }
    assert.deepEqual(
      state.instances.map((instance) => instance.discount),
      testCase.instanceDiscounts,
    );
  }

  const tenWayTie = await readJson(`SELECT jsonb_agg(jsonb_build_object(
      'key', allocation_key, 'amount', allocated_amount
    ) ORDER BY allocation_key)
    FROM public.phase2_allocate_largest_remainder_internal(2,
      (SELECT jsonb_agg(jsonb_build_object('key', value::text, 'weight', 1))
       FROM generate_series(1,10) value));`);
  assert.deepEqual(
    tenWayTie.filter((allocation) => allocation.amount === 1)
      .map((allocation) => allocation.key),
    ['1', '10'],
  );

  return {
    scenarios: cases.length,
    exactStoredAllocations: true,
    lineAndInstanceReconciliation: true,
    deterministicTenWayTie: true,
  };
};

const runLegacyLocationCompatibilityTests = async () => {
  await runSql(`
    UPDATE public.warehouses SET created_at='2020-01-01T00:00:00Z'
    WHERE id='${WAREHOUSE}';
    INSERT INTO public.branches (id, code, name_ar, is_active)
    VALUES ('${LEGACY_BRANCH_B}', 'P3-BR-B', 'فرع Phase 3 ب', true);
    INSERT INTO public.warehouses (id, branch_id, code, name_ar, is_active, created_at)
    VALUES
      ('${LEGACY_WAREHOUSE_B}', '${LEGACY_BRANCH_B}', 'P3-WH-B',
        'مستودع Phase 3 ب', true, '2021-01-01T00:00:00Z'),
      ('${LEGACY_INACTIVE_WAREHOUSE}', '${LEGACY_BRANCH_B}', 'P3-WH-X',
        'مستودع غير نشط', false, '2022-01-01T00:00:00Z');
    INSERT INTO public.cash_shifts (
      id, shift_number, branch_id, opened_by, opening_cash_in_minor_units
    ) VALUES (
      '${LEGACY_SHIFT_B}', 'P3-SHIFT-2', '${LEGACY_BRANCH_B}', '${OWNER}', 0
    );
    INSERT INTO public.inventory_balances (
      warehouse_id, product_id, on_hand_quantity, reserved_quantity
    ) VALUES ('${LEGACY_WAREHOUSE_B}', '${OTHER}', 500, 0);
    UPDATE public.inventory_balances SET on_hand_quantity=500, reserved_quantity=0
    WHERE warehouse_id='${WAREHOUSE}' AND product_id='${OTHER}';
  `);

  const expectedResultKeys = [
    'amountPaidInMinorUnits', 'branchId', 'changeDueInMinorUnits',
    'customerName', 'discountInMinorUnits', 'idempotentReplay', 'items',
    'message', 'orderId', 'orderNumber', 'paymentMethod', 'paymentStatus',
    'subtotalInMinorUnits', 'success', 'totalInMinorUnits', 'warehouseId',
  ].sort();
  const callLegacy = (warehouseId, branchId, key, customerName) => readJson(`
    ${ownerClaimsSql}
    SELECT public.create_pos_sale(
      ${sqlValue(warehouseId)}::uuid,
      ${sqlValue(branchId)}::uuid,
      NULL,
      ${sqlValue(customerName)},
      'cash',
      '[{"product_id":"${OTHER}","quantity":1}]'::jsonb,
      0,
      4500,
      ${sqlValue(key)}
    );`);
  const locationState = (orderId) => readJson(`SELECT jsonb_build_object(
    'warehouseId', orders.warehouse_id,
    'branchId', orders.branch_id,
    'shiftId', orders.cash_shift_id,
    'source', orders.source,
    'status', orders.status,
    'inventoryA', (SELECT on_hand_quantity FROM public.inventory_balances
      WHERE warehouse_id='${WAREHOUSE}' AND product_id='${OTHER}'),
    'inventoryB', (SELECT on_hand_quantity FROM public.inventory_balances
      WHERE warehouse_id='${LEGACY_WAREHOUSE_B}' AND product_id='${OTHER}')
  ) FROM public.orders orders WHERE orders.id='${orderId}';`);
  const assertSuccess = async ({ name, warehouseId, branchId, key,
    expectedWarehouseId, expectedBranchId, expectedShiftId }) => {
    const before = await readJson(`SELECT jsonb_build_object(
      'a', (SELECT on_hand_quantity FROM public.inventory_balances
        WHERE warehouse_id='${WAREHOUSE}' AND product_id='${OTHER}'),
      'b', (SELECT on_hand_quantity FROM public.inventory_balances
        WHERE warehouse_id='${LEGACY_WAREHOUSE_B}' AND product_id='${OTHER}')
    );`);
    const result = await callLegacy(warehouseId, branchId, key, name);
    assert.equal(result.success, true);
    assert.equal(result.idempotentReplay, false);
    assert.deepEqual(Object.keys(result).sort(), expectedResultKeys);
    assert.equal(result.warehouseId, expectedWarehouseId);
    assert.equal(result.branchId, expectedBranchId);
    const state = await locationState(result.orderId);
    assert.equal(state.warehouseId, expectedWarehouseId);
    assert.equal(state.branchId, expectedBranchId);
    assert.equal(state.shiftId, expectedShiftId);
    assert.equal(state.source, 'pos');
    assert.equal(state.status, 'completed');
    assert.equal(
      state.inventoryA,
      before.a - (expectedWarehouseId === WAREHOUSE ? 5 : 0),
    );
    assert.equal(
      state.inventoryB,
      before.b - (expectedWarehouseId === LEGACY_WAREHOUSE_B ? 5 : 0),
    );
    return { result, state };
  };

  const explicit = await assertSuccess({
    name: 'Explicit', warehouseId: WAREHOUSE, branchId: BRANCH,
    key: 'phase3-v1-location-explicit-0001',
    expectedWarehouseId: WAREHOUSE, expectedBranchId: BRANCH, expectedShiftId: SHIFT,
  });
  const inferred = await assertSuccess({
    name: 'Inferred', warehouseId: WAREHOUSE, branchId: null,
    key: 'phase3-v1-location-inferred-0001',
    expectedWarehouseId: WAREHOUSE, expectedBranchId: BRANCH, expectedShiftId: SHIFT,
  });
  const defaulted = await assertSuccess({
    name: 'Default', warehouseId: null, branchId: null,
    key: 'phase3-v1-location-default-0001',
    expectedWarehouseId: WAREHOUSE, expectedBranchId: BRANCH, expectedShiftId: SHIFT,
  });
  const explicitBranchIgnored = await assertSuccess({
    name: 'Null warehouse', warehouseId: null, branchId: LEGACY_BRANCH_B,
    key: 'phase3-v1-location-null-wh-branch-0001',
    expectedWarehouseId: WAREHOUSE, expectedBranchId: BRANCH, expectedShiftId: SHIFT,
  });
  const mismatch = await assertSuccess({
    name: 'Mismatch', warehouseId: WAREHOUSE, branchId: LEGACY_BRANCH_B,
    key: 'phase3-v1-location-mismatch-0001',
    expectedWarehouseId: WAREHOUSE, expectedBranchId: LEGACY_BRANCH_B,
    expectedShiftId: LEGACY_SHIFT_B,
  });
  const withoutKey = await assertSuccess({
    name: 'No key', warehouseId: WAREHOUSE, branchId: null, key: null,
    expectedWarehouseId: WAREHOUSE, expectedBranchId: BRANCH, expectedShiftId: SHIFT,
  });

  const replayAfterClose = async (sale, key, warehouseId, branchId, customerName) => {
    const before = await saleBusinessState(key);
    const replay = await readJson(`BEGIN;
      UPDATE public.cash_shifts SET status='cancelled', cancelled_by='${OWNER}',
        cancelled_at=NOW(), cancellation_reason='isolated location replay'
      WHERE id='${sale.state.shiftId}';
      ${ownerClaimsSql}
      SELECT public.create_pos_sale(
        ${sqlValue(warehouseId)}::uuid, ${sqlValue(branchId)}::uuid,
        NULL, ${sqlValue(customerName)}, 'cash',
        '[{"product_id":"${OTHER}","quantity":1}]'::jsonb,
        0, 4500, ${sqlValue(key)}
      );
      ROLLBACK;`);
    assert.equal(replay.orderId, sale.result.orderId);
    assert.equal(replay.idempotentReplay, true);
    assert.deepEqual(await saleBusinessState(key), before);
  };
  await replayAfterClose(
    inferred, 'phase3-v1-location-inferred-0001', WAREHOUSE, null, 'Inferred',
  );
  await replayAfterClose(
    defaulted, 'phase3-v1-location-default-0001', null, null, 'Default',
  );

  const expectLegacyFailure = async (warehouseId, expectedMessage) => {
    try {
      await callLegacy(
        warehouseId, null, `phase3-v1-location-rejected-${warehouseId}-0001`, 'Rejected',
      );
      assert.fail('Expected legacy location rejection.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /ERROR:\s+P0001:/u);
      assert.match(message, new RegExp(escapeRegExp(expectedMessage), 'u'));
    }
  };
  await expectLegacyFailure(
    '92400000-0000-0000-0000-000000000299',
    'المستودع المحدد غير موجود أو غير نشط.',
  );
  await expectLegacyFailure(
    LEGACY_INACTIVE_WAREHOUSE,
    'المستودع المحدد غير موجود أو غير نشط.',
  );
  await runSql(`UPDATE public.warehouses SET is_active=false;`);
  await expectLegacyFailure(null, 'لا يوجد مستودع نشط لتنفيذ البيع.');
  await runSql(`UPDATE public.warehouses SET is_active=true
    WHERE id IN ('${WAREHOUSE}','${LEGACY_WAREHOUSE_B}');`);

  return {
    oracleHead: 114,
    explicitWarehouseAndBranch: explicit.state,
    explicitWarehouseNullBranch: inferred.state,
    nullWarehouseNullBranch: defaulted.state,
    nullWarehouseExplicitBranch: explicitBranchIgnored.state,
    mismatchedWarehouseAndBranch: mismatch.state,
    nullIdempotencyFallback: withoutKey.state,
    replayAfterShiftClose: true,
    replayZeroWrites: true,
    invalidAndInactiveCompatibility: true,
    noActiveWarehouseCompatibility: true,
    responseShapeCompatible: true,
  };
};

const runPhase35bReportingTests = async () => {
  const ROUND_BRANCH = '93500000-0000-4000-8000-000000000001';
  const ROUND_WAREHOUSE = '93500000-0000-4000-8000-000000000002';
  const FAMILY_BRANCH = '93500000-0000-4000-8000-000000000003';
  const FAMILY_WAREHOUSE = '93500000-0000-4000-8000-000000000004';
  const SALES_BRANCH = '93500000-0000-4000-8000-000000000005';
  const SALES_WAREHOUSE = '93500000-0000-4000-8000-000000000006';
  const SALES_SHIFT = '93500000-0000-4000-8000-000000000007';
  const ROUND_PRODUCT = '93500000-0000-4000-8000-000000000010';
  const VALUE_FAMILY = '93500000-0000-4000-8000-000000000020';
  const VALUE_CHILD_A = '93500000-0000-4000-8000-000000000021';
  const VALUE_CHILD_B = '93500000-0000-4000-8000-000000000022';
  const LEGACY_SINGLE_UNIT_PRODUCT = '93500000-0000-4000-8000-000000000023';

  await runSql(`
    INSERT INTO public.branches (id, code, name_ar, is_active) VALUES
      ('${ROUND_BRANCH}', 'P35-RND', 'فرع تقريب Phase 3.5', true),
      ('${FAMILY_BRANCH}', 'P35-FAM', 'فرع عائلة Phase 3.5', true),
      ('${SALES_BRANCH}', 'P35-SALE', 'فرع مبيعات Phase 3.5', true);
    INSERT INTO public.warehouses (id, branch_id, code, name_ar, is_active) VALUES
      ('${ROUND_WAREHOUSE}', '${ROUND_BRANCH}', 'P35-RND-WH', 'مستودع التقريب', true),
      ('${FAMILY_WAREHOUSE}', '${FAMILY_BRANCH}', 'P35-FAM-WH', 'مستودع العائلة', true),
      ('${SALES_WAREHOUSE}', '${SALES_BRANCH}', 'P35-SALE-WH', 'مستودع المبيعات', true);

    INSERT INTO public.products (
      id, sku, name_ar, category_id, unit_id, purchase_unit_id, sale_unit_id,
      units_per_purchase_unit, units_per_sale_unit,
      default_purchase_price_in_minor_units, default_sale_price_in_minor_units,
      cost_price_in_minor_units, sale_price_in_minor_units,
      wholesale_price_in_minor_units, min_stock_level, is_active,
      is_flavor_master, wac_cost_in_minor_units_exact
    ) VALUES
      ('${ROUND_PRODUCT}', 'P35-ROUND', 'منتج تقريب Phase 3.5',
        '92400000-0000-0000-0000-000000000011',
        '92400000-0000-0000-0000-000000000010',
        '92400000-0000-0000-0000-000000000010',
        '92400000-0000-0000-0000-000000000010',
        1, 1, 11, 100, 11, 100, 100, 0, true, false, 10.600000),
      ('${LEGACY_SINGLE_UNIT_PRODUCT}', 'P35-LEGACY-ONE', 'عبوة Legacy من وحدة واحدة',
        '92400000-0000-0000-0000-000000000011',
        '92400000-0000-0000-0000-000000000010',
        '92400000-0000-0000-0000-000000000010',
        '92400000-0000-0000-0000-000000000010',
        1, 1, 7, 1000, 7, 1000, 1000, 0, true, false, 7.000000),
      ('${VALUE_FAMILY}', 'P35-FAMILY', 'عائلة تقييم Phase 3.5',
        '92400000-0000-0000-0000-000000000011',
        '92400000-0000-0000-0000-000000000010',
        '92400000-0000-0000-0000-000000000010',
        '92400000-0000-0000-0000-000000000010',
        5, 5, 999000, 5000, 999000, 1000, 5000, 0, true, true, 999000.000000);
    INSERT INTO public.products (
      id, sku, name_ar, category_id, flavor_master_product_id, flavor_name_ar,
      min_stock_level, is_active
    ) VALUES
      ('${VALUE_CHILD_A}', 'P35-FAMILY-A', 'نكهة تقييم أ',
        '92400000-0000-0000-0000-000000000011', '${VALUE_FAMILY}', 'أ', 0, true),
      ('${VALUE_CHILD_B}', 'P35-FAMILY-B', 'نكهة تقييم ب',
        '92400000-0000-0000-0000-000000000011', '${VALUE_FAMILY}', 'ب', 0, true);
    UPDATE public.products
    SET unit_id='92400000-0000-0000-0000-000000000010',
        purchase_unit_id='92400000-0000-0000-0000-000000000010',
        sale_unit_id='92400000-0000-0000-0000-000000000010',
        units_per_purchase_unit=1, units_per_sale_unit=1,
        default_purchase_price_in_minor_units=CASE id
          WHEN '${VALUE_CHILD_A}' THEN 11 ELSE 0 END,
        default_sale_price_in_minor_units=100,
        cost_price_in_minor_units=CASE id
          WHEN '${VALUE_CHILD_A}' THEN 11 ELSE 0 END,
        wac_cost_in_minor_units_exact=CASE id
          WHEN '${VALUE_CHILD_A}' THEN 10.600000::NUMERIC(24,6)
          ELSE 0.400000::NUMERIC(24,6) END,
        sale_price_in_minor_units=100,
        wholesale_price_in_minor_units=100
    WHERE id IN ('${VALUE_CHILD_A}', '${VALUE_CHILD_B}');

    INSERT INTO public.inventory_balances (
      warehouse_id, product_id, on_hand_quantity, reserved_quantity
    ) VALUES
      ('${ROUND_WAREHOUSE}', '${ROUND_PRODUCT}', 2, 0),
      ('${FAMILY_WAREHOUSE}', '${VALUE_CHILD_A}', 2, 0),
      ('${FAMILY_WAREHOUSE}', '${VALUE_CHILD_B}', 1, 0),
      ('${SALES_WAREHOUSE}', '${SKU_A}', 100, 0),
      ('${SALES_WAREHOUSE}', '${SKU_B}', 100, 0),
      ('${SALES_WAREHOUSE}', '${OTHER}', 100, 0),
      ('${SALES_WAREHOUSE}', '${LEGACY_SINGLE_UNIT_PRODUCT}', 100, 0);
    INSERT INTO public.cash_shifts (
      id, shift_number, branch_id, opened_by, opening_cash_in_minor_units
    ) VALUES ('${SALES_SHIFT}', 'P35-SHIFT', '${SALES_BRANCH}', '${OWNER}', 0);
  `);

  const valuation = await readJson(`${ownerClaimsSql}
    WITH expected AS (
      SELECT ROUND(COALESCE(SUM(
        balance.on_hand_quantity::NUMERIC
          * COALESCE(product.wac_cost_in_minor_units_exact,
              product.cost_price_in_minor_units::NUMERIC)
      ), 0), 0)::BIGINT AS value
      FROM public.inventory_balances balance
      JOIN public.products product ON product.id=balance.product_id
      WHERE product.is_active=true AND product.is_flavor_master=false
    ), surfaces AS (
      SELECT public.get_home_dashboard() AS home,
        public.get_admin_product_page(1,1,NULL,NULL,'all','name') AS products,
        public.get_admin_inventory_product_page(1,1,NULL,NULL,NULL,NULL,'all') AS inventory,
        public.get_operational_business_report(
          '${ROUND_BRANCH}', (NOW() AT TIME ZONE 'Asia/Amman')::DATE,
          (NOW() AT TIME ZONE 'Asia/Amman')::DATE
        ) AS rounding_report,
        public.get_operational_business_report(
          '${FAMILY_BRANCH}', (NOW() AT TIME ZONE 'Asia/Amman')::DATE,
          (NOW() AT TIME ZONE 'Asia/Amman')::DATE
        ) AS family_report
    )
    SELECT jsonb_build_object(
      'expectedGlobal',(SELECT value FROM expected),
      'home', (home #>> '{summary,inventoryValueInMinorUnits}')::BIGINT,
      'adminProducts', (products #>> '{metrics,inventory_cost_in_minor_units}')::BIGINT,
      'adminInventory', (inventory #>> '{metrics,total_cost_in_minor_units}')::BIGINT,
      'roundingBranch', (rounding_report #>> '{inventory,valueInMinorUnits}')::BIGINT,
      'familyBranch', (family_report #>> '{inventory,valueInMinorUnits}')::BIGINT,
      'masterProxyValue', 3 * (SELECT cost_price_in_minor_units
        FROM public.products WHERE id='${VALUE_FAMILY}')
    ) FROM surfaces;`);
  assert.equal(valuation.roundingBranch, 21);
  assert.equal(valuation.familyBranch, 22);
  assert.equal(valuation.home, valuation.expectedGlobal);
  assert.equal(valuation.adminProducts, valuation.expectedGlobal);
  assert.equal(valuation.adminInventory, valuation.expectedGlobal);
  assert.notEqual(valuation.familyBranch, valuation.masterProxyValue);

  const mixedLines = [
    baseLine(SKU_A, 2),
    {
      commercial_line_kind: 'legacy_single_sku_parcel',
      product_id: OTHER,
      parcel_quantity: 1,
      units_per_parcel: 5,
      price_authority: 'server_catalog',
      line_discount_in_minor_units: 0,
    },
    parcelLine(2),
  ];
  const mixed = await readJson(`${ownerClaimsSql}
    SELECT public.create_pos_sale_v2(
      '${SALES_WAREHOUSE}', '${SALES_BRANCH}', NULL,
      'Phase 3.5 Mixed', 'cash',
      $phase35$${JSON.stringify(mixedLines)}$phase35$::JSONB,
      0, 16500, 'phase35-report-mixed-0001'
    );`);
  assert.equal(mixed.success, true);
  const historicalLegacy = await readJson(`${ownerClaimsSql}
    SELECT public.create_pos_sale(
      '${SALES_WAREHOUSE}', '${SALES_BRANCH}', NULL,
      'Phase 3.5 Historical', 'cash',
      '[{"product_id":"${OTHER}","quantity":1}]'::JSONB,
      0, 4500, 'phase35-report-v1-legacy-0001'
    );`);
  assert.equal(historicalLegacy.success, true);
  const historicalSingleUnitLegacy = await readJson(`${ownerClaimsSql}
    SELECT public.create_pos_sale(
      '${SALES_WAREHOUSE}', '${SALES_BRANCH}', NULL,
      'Phase 3.5 Historical Single Unit', 'cash',
      '[{"product_id":"${LEGACY_SINGLE_UNIT_PRODUCT}","quantity":2}]'::JSONB,
      0, 2000, 'phase35-report-v1-single-unit-legacy-0001'
    );`);
  assert.equal(historicalSingleUnitLegacy.success, true);

  const reportingBusinessState = () => readJson(`
    WITH target_orders AS (
      SELECT * FROM public.orders WHERE branch_id='${SALES_BRANCH}'
    ), target_operations AS (
      SELECT * FROM public.business_operations
      WHERE id IN (SELECT operation_id FROM target_orders)
        OR idempotency_key LIKE 'phase35-report-%'
        OR request_identity_snapshot->>'order_id' IN (
          SELECT id::TEXT FROM target_orders
        )
    )
    SELECT jsonb_build_object(
      'orders',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY id)
        FROM target_orders t),'[]'),
      'items',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY id)
        FROM public.order_items t
        WHERE order_id IN (SELECT id FROM target_orders)),'[]'),
      'instances',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY id)
        FROM public.order_parcel_instances t
        WHERE order_id IN (SELECT id FROM target_orders)),'[]'),
      'components',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY id)
        FROM public.order_parcel_components t
        WHERE operation_id IN (SELECT id FROM target_operations)),'[]'),
      'reservations',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY id)
        FROM public.order_inventory_reservations t
        WHERE order_id IN (SELECT id FROM target_orders)),'[]'),
      'operations',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY id)
        FROM target_operations t),'[]'),
      'balances',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY product_id)
        FROM public.inventory_balances t
        WHERE warehouse_id='${SALES_WAREHOUSE}'),'[]'),
      'movements',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY id)
        FROM public.inventory_movements t
        WHERE reference_id IN (SELECT id FROM target_orders)
          OR (warehouse_id='${SALES_WAREHOUSE}' AND product_id IN (
            '${SKU_A}','${SKU_B}','${OTHER}','${LEGACY_SINGLE_UNIT_PRODUCT}'
          ))),'[]'),
      'payments',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY id)
        FROM public.customer_payments t
        WHERE order_id IN (SELECT id FROM target_orders)),'[]'),
      'shift',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY id)
        FROM public.cash_shifts t WHERE id='${SALES_SHIFT}'),'[]'),
      'history',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY id)
        FROM public.order_status_history t
        WHERE order_id IN (SELECT id FROM target_orders)),'[]'),
      'counts',jsonb_build_object(
        'orders',(SELECT COUNT(*) FROM public.orders),
        'items',(SELECT COUNT(*) FROM public.order_items),
        'instances',(SELECT COUNT(*) FROM public.order_parcel_instances),
        'components',(SELECT COUNT(*) FROM public.order_parcel_components),
        'reservations',(SELECT COUNT(*) FROM public.order_inventory_reservations),
        'operations',(SELECT COUNT(*) FROM public.business_operations),
        'redemptions',(SELECT COUNT(*) FROM public.promotion_redemptions),
        'movements',(SELECT COUNT(*) FROM public.inventory_movements),
        'payments',(SELECT COUNT(*) FROM public.customer_payments)
      )
    );`);
  const reportStateBefore = await reportingBusinessState();

  const reporting = await readJson(`${ownerClaimsSql}
    WITH report AS (
      SELECT public.get_operational_business_report(
        '${SALES_BRANCH}', (NOW() AT TIME ZONE 'Asia/Amman')::DATE,
        (NOW() AT TIME ZONE 'Asia/Amman')::DATE
      ) AS value
    ), shift_report AS (
      SELECT public.get_cash_shift_closing_report('${SALES_SHIFT}') AS value
    ), expected AS (
      SELECT
        (SELECT SUM(orders.total_in_minor_units)::BIGINT
         FROM public.orders orders
         WHERE orders.branch_id='${SALES_BRANCH}' AND orders.status='completed') AS revenue,
        (SELECT SUM(items.cogs_in_minor_units)::BIGINT
         FROM public.order_items items
         JOIN public.orders orders ON orders.id=items.order_id
         WHERE orders.branch_id='${SALES_BRANCH}' AND orders.status='completed') AS cogs,
        (SELECT SUM(items.profit_in_minor_units)::BIGINT
         FROM public.order_items items
         JOIN public.orders orders ON orders.id=items.order_id
         WHERE orders.branch_id='${SALES_BRANCH}' AND orders.status='completed') AS profit
    )
    SELECT jsonb_build_object(
      'baseUnits', (report.value #>> '{sales,baseUnitCount}')::BIGINT,
      'packages', (report.value #>> '{sales,packageCount}')::BIGINT,
      'shiftPackages', (shift_report.value #>> '{sales,packageCount}')::BIGINT,
      'revenue', (report.value #>> '{sales,grossSalesInMinorUnits}')::BIGINT,
      'cogs', (report.value #>> '{sales,cogsInMinorUnits}')::BIGINT,
      'profit', (report.value #>> '{sales,grossProfitInMinorUnits}')::BIGINT,
      'expectedRevenue', expected.revenue,
      'expectedCogs', expected.cogs,
      'expectedProfit', expected.profit,
      'topProducts', report.value->'topProducts',
      'lineKinds', (SELECT jsonb_agg(jsonb_build_object(
        'kind', item.commercial_line_kind,
        'sku', item.sku_snapshot,
        'salePackageQuantity', item.sale_package_quantity,
        'unitsPerSalePackage', item.units_per_sale_package,
        'lineTotal', item.line_total_in_minor_units,
        'cogs', item.cogs_in_minor_units,
        'profit', item.profit_in_minor_units,
        'baseUnits', public.phase35_report_base_unit_count_internal(
          item.id, item.commercial_line_kind, item.quantity),
        'packages', public.phase35_report_package_count_internal(
          item.id, item.commercial_line_kind, item.sale_package_quantity,
          item.units_per_sale_package)
      ) ORDER BY item.commercial_line_kind NULLS LAST)
      FROM public.order_items item
      JOIN public.orders orders ON orders.id=item.order_id
      WHERE orders.branch_id='${SALES_BRANCH}')
    )
    FROM report CROSS JOIN shift_report CROSS JOIN expected;`);
  const reportStateAfter = await reportingBusinessState();
  assert.deepEqual(reportStateAfter, reportStateBefore);
  assert.equal(reporting.baseUnits, 24);
  assert.equal(reporting.packages, 6);
  assert.equal(reporting.shiftPackages, 6);
  assert.equal(reporting.revenue, reporting.expectedRevenue);
  assert.equal(reporting.cogs, reporting.expectedCogs);
  assert.equal(reporting.profit, reporting.expectedProfit);

  const baseLineEvidence = reporting.lineKinds.find((line) => line.kind === 'base_unit');
  const configurableEvidence = reporting.lineKinds.find(
    (line) => line.kind === 'configurable_parcel',
  );
  const explicitLegacyEvidence = reporting.lineKinds.find(
    (line) => line.kind === 'legacy_single_sku_parcel',
  );
  const historicalLegacyEvidence = reporting.lineKinds.find(
    (line) => line.kind === null && line.sku === 'P3-OTHER',
  );
  const historicalSingleUnitEvidence = reporting.lineKinds.find(
    (line) => line.kind === null && line.sku === 'P35-LEGACY-ONE',
  );
  assert.deepEqual(
    {
      kind: baseLineEvidence.kind,
      sku: baseLineEvidence.sku,
      salePackageQuantity: baseLineEvidence.salePackageQuantity,
      unitsPerSalePackage: baseLineEvidence.unitsPerSalePackage,
      baseUnits: baseLineEvidence.baseUnits,
      packages: baseLineEvidence.packages,
    },
    {
      kind: 'base_unit', sku: 'P3-A', salePackageQuantity: 2,
      unitsPerSalePackage: 1, baseUnits: 2, packages: 0,
    },
  );
  assert.deepEqual(
    {
      kind: configurableEvidence.kind,
      sku: configurableEvidence.sku,
      salePackageQuantity: configurableEvidence.salePackageQuantity,
      unitsPerSalePackage: configurableEvidence.unitsPerSalePackage,
      baseUnits: configurableEvidence.baseUnits,
      packages: configurableEvidence.packages,
    },
    {
      kind: 'configurable_parcel', sku: 'P3-FAMILY', salePackageQuantity: 2,
      unitsPerSalePackage: 5, baseUnits: 10, packages: 2,
    },
  );
  assert.deepEqual(
    {
      kind: explicitLegacyEvidence.kind,
      sku: explicitLegacyEvidence.sku,
      salePackageQuantity: explicitLegacyEvidence.salePackageQuantity,
      unitsPerSalePackage: explicitLegacyEvidence.unitsPerSalePackage,
      baseUnits: explicitLegacyEvidence.baseUnits,
      packages: explicitLegacyEvidence.packages,
    },
    {
      kind: 'legacy_single_sku_parcel', sku: 'P3-OTHER', salePackageQuantity: 1,
      unitsPerSalePackage: 5, baseUnits: 5, packages: 1,
    },
  );
  assert.deepEqual(
    {
      kind: historicalLegacyEvidence.kind,
      sku: historicalLegacyEvidence.sku,
      salePackageQuantity: historicalLegacyEvidence.salePackageQuantity,
      unitsPerSalePackage: historicalLegacyEvidence.unitsPerSalePackage,
      baseUnits: historicalLegacyEvidence.baseUnits,
      packages: historicalLegacyEvidence.packages,
    },
    {
      kind: null, sku: 'P3-OTHER', salePackageQuantity: 1,
      unitsPerSalePackage: 5, baseUnits: 5, packages: 1,
    },
  );
  assert.deepEqual(
    historicalSingleUnitEvidence,
    {
      kind: null, sku: 'P35-LEGACY-ONE', salePackageQuantity: 2,
      unitsPerSalePackage: 1, lineTotal: 2000, cogs: 14, profit: 1986,
      baseUnits: 2, packages: 2,
    },
  );

  const topBySku = new Map(reporting.topProducts.map((row) => [row.sku, row]));
  assert.equal(topBySku.get('P3-FAMILY')?.packageCount, 2);
  assert.equal(topBySku.get('P3-OTHER')?.packageCount, 2);
  assert.equal(topBySku.get('P3-A')?.packageCount, 0);
  assert.equal(topBySku.get('P35-LEGACY-ONE')?.packageCount, 2);
  assert.equal(topBySku.get('P3-FAMILY')?.revenueInMinorUnits, 10000);
  assert.equal(topBySku.get('P3-OTHER')?.revenueInMinorUnits, 9000);
  assert.equal(topBySku.get('P3-A')?.revenueInMinorUnits, 2000);
  assert.equal(topBySku.get('P35-LEGACY-ONE')?.revenueInMinorUnits, 2000);

  return {
    exactWacRoundingBoundary: true,
    familyUsesStockedChildCosts: true,
    crossSurfaceValuationConsistent: true,
    explicitBaseUnitNeverCountsAsPackage: true,
    legacyFallbackPreserved: true,
    legacySingleUnitPackagePreserved: true,
    reportReadsZeroWrite: true,
    configurableInstancesAndComponentsCounted: true,
    topProductsCommercialQuantityNoFanOut: true,
    financialTotalsUnchanged: true,
    valuation,
    quantityResult: {baseUnits: reporting.baseUnits, packages: reporting.packages},
  };
};

const runCrossVersionConcurrencyTest = async () => {
  const key = 'phase3-cross-version-concurrent-0001';
  const appV1 = 'phase3-cross-v1';
  const appV2 = 'phase3-cross-v2';
  const v2Request = JSON.stringify([{
    commercial_line_kind: 'legacy_single_sku_parcel',
    product_id: OTHER,
    parcel_quantity: 1,
    units_per_parcel: 5,
    price_authority: 'server_catalog',
    line_discount_in_minor_units: 0,
  }]);
  const deadlocksBefore = await readJson(`SELECT jsonb_build_object('value', deadlocks)
    FROM pg_stat_database WHERE datname=current_database();`);
  const stockBefore = await readJson(`SELECT jsonb_build_object('value', on_hand_quantity)
    FROM public.inventory_balances
    WHERE warehouse_id='92400000-0000-0000-0000-000000000201'
      AND product_id='${OTHER}';`);
  const holder = await startLockHolder(
    `SELECT pg_advisory_xact_lock(hashtext('${key}'))`,
    'phase3-cross-holder',
  );
  const v1 = readJson(`SET application_name='${appV1}'; ${ownerClaimsSql}
    SELECT public.create_pos_sale(
      '92400000-0000-0000-0000-000000000201',
      '92400000-0000-0000-0000-000000000200', NULL,
      'Concurrent V1', 'cash',
      '[{"product_id":"${OTHER}","quantity":1}]'::jsonb,
      0, 4500, '${key}'
    );`);
  const v2 = readJson(`SET application_name='${appV2}'; ${ownerClaimsSql}
    SELECT public.create_pos_sale_v2(
      '92400000-0000-0000-0000-000000000201',
      '92400000-0000-0000-0000-000000000200', NULL,
      'Concurrent V2', 'cash',
      '${v2Request}'::jsonb,
      0, 4500, '${key}'
    );`);
  await waitForBlockedApplications([appV1, appV2]);
  await holder.release();
  const settled = await Promise.allSettled([v1, v2]);
  const successes = settled.filter((entry) => entry.status === 'fulfilled');
  const failures = settled.filter((entry) => entry.status === 'rejected');
  assert.equal(successes.length, 1);
  assert.equal(failures.length, 1);
  assert.match(
    failures[0].reason instanceof Error
      ? failures[0].reason.message
      : String(failures[0].reason),
    /(?:PHASE3_)?IDEMPOTENCY_CONFLICT/u,
  );
  const finalState = await readJson(`SELECT jsonb_build_object(
    'orders', (SELECT COUNT(*) FROM public.orders WHERE idempotency_key='${key}'),
    'operations', (SELECT COUNT(*) FROM public.business_operations
      WHERE idempotency_key='${key}'),
    'stock', (SELECT on_hand_quantity FROM public.inventory_balances
      WHERE warehouse_id='92400000-0000-0000-0000-000000000201'
        AND product_id='${OTHER}'),
    'movements', (SELECT COUNT(*) FROM public.inventory_movements
      WHERE reference_id=(SELECT id FROM public.orders WHERE idempotency_key='${key}'))
  );`);
  assert.equal(finalState.orders, 1);
  assert.ok(finalState.operations === 0 || finalState.operations === 1);
  assert.equal(finalState.stock, stockBefore.value - 5);
  assert.equal(finalState.movements, 1);
  const deadlocksAfter = await readJson(`SELECT jsonb_build_object('value', deadlocks)
    FROM pg_stat_database WHERE datname=current_database();`);
  assert.equal(deadlocksAfter.value - deadlocksBefore.value, 0);
  return { oneLogicalSale: true, waitObserved: true, deadlockDelta: 0 };
};

const runCompetingParcelSalesTest = async () => {
  const appA = 'phase3-parcel-sale-a';
  const appB = 'phase3-parcel-sale-b';
  await runSql(`UPDATE public.configurable_parcel_feature_settings
    SET feature_state='ENABLED', updated_at=NOW()
    WHERE feature_key='configurable_parcels';
    UPDATE public.inventory_balances SET on_hand_quantity=CASE product_id
      WHEN '${SKU_A}'::uuid THEN 2 ELSE 3 END, reserved_quantity=0
    WHERE warehouse_id='92400000-0000-0000-0000-000000000201'
      AND product_id IN ('${SKU_A}','${SKU_B}');`);
  const deadlocksBefore = await readJson(`SELECT jsonb_build_object('value', deadlocks)
    FROM pg_stat_database WHERE datname=current_database();`);
  const holder = await startLockHolder(
    `SELECT pg_advisory_xact_lock(hashtextextended('inventory-product:${SKU_A}',0))`,
    'phase3-parcel-holder',
  );
  const requestA = JSON.stringify([{
    commercial_line_kind: 'configurable_parcel',
    family_product_id: FAMILY,
    parcel_configuration_id: CONFIG,
    configuration_revision: 1,
    price_authority: 'server_catalog',
    line_discount_in_minor_units: 0,
    parcel_instances: [{ components: [
      { product_id: SKU_A, base_quantity: 2 },
      { product_id: SKU_B, base_quantity: 3 },
    ] }],
  }]);
  const requestB = JSON.stringify([{
    commercial_line_kind: 'configurable_parcel',
    family_product_id: FAMILY,
    parcel_configuration_id: CONFIG,
    configuration_revision: 1,
    price_authority: 'server_catalog',
    line_discount_in_minor_units: 0,
    parcel_instances: [{ components: [
      { product_id: SKU_B, base_quantity: 3 },
      { product_id: SKU_A, base_quantity: 2 },
    ] }],
  }]);
  const call = (applicationName, key, request) => readJson(
    `SET application_name='${applicationName}'; ${ownerClaimsSql}
     SELECT public.create_pos_sale_v2(
       '92400000-0000-0000-0000-000000000201',
       '92400000-0000-0000-0000-000000000200', NULL,
       'Concurrent Parcel', 'cash', '${request}'::jsonb,
       0, 5000, '${key}'
     );`,
  );
  const first = call(appA, 'phase3-competing-parcel-sale-a-0001', requestA);
  const second = call(appB, 'phase3-competing-parcel-sale-b-0001', requestB);
  await waitForBlockedApplications([appA, appB]);
  await holder.release();
  const settled = await Promise.allSettled([first, second]);
  assert.equal(settled.filter((entry) => entry.status === 'fulfilled').length, 1);
  const failure = settled.find((entry) => entry.status === 'rejected');
  assert.ok(failure && failure.status === 'rejected');
  assert.match(failure.reason.message, /PHASE3_POS_INSUFFICIENT_INVENTORY/u);
  const state = await readJson(`SELECT jsonb_build_object(
    'orders', (SELECT COUNT(*) FROM public.orders
      WHERE idempotency_key IN (
        'phase3-competing-parcel-sale-a-0001',
        'phase3-competing-parcel-sale-b-0001'
      )),
    'operations', (SELECT COUNT(*) FROM public.business_operations
      WHERE idempotency_key IN (
        'phase3-competing-parcel-sale-a-0001',
        'phase3-competing-parcel-sale-b-0001'
      )),
    'a', (SELECT on_hand_quantity FROM public.inventory_balances
      WHERE warehouse_id='92400000-0000-0000-0000-000000000201'
        AND product_id='${SKU_A}'),
    'b', (SELECT on_hand_quantity FROM public.inventory_balances
      WHERE warehouse_id='92400000-0000-0000-0000-000000000201'
        AND product_id='${SKU_B}')
  );`);
  assert.deepEqual(state, { orders: 1, operations: 1, a: 0, b: 0 });
  const deadlocksAfter = await readJson(`SELECT jsonb_build_object('value', deadlocks)
    FROM pg_stat_database WHERE datname=current_database();`);
  assert.equal(deadlocksAfter.value - deadlocksBefore.value, 0);
  return { oneSaleAccepted: true, reversedInputSerialized: true, deadlockDelta: 0 };
};

const runSaleAndSupplierReceiptConcurrencyTest = async () => {
  const appSale = 'phase3-sale-vs-receipt-sale';
  const appReceipt = 'phase3-sale-vs-receipt-receipt';
  const saleKey = 'phase3-sale-vs-receipt-sale-0001'; // gitleaks:allow test fixture
  const receiptKey = 'phase3-sale-vs-receipt-receipt-0001'; // gitleaks:allow test fixture
  const saleRequest = JSON.stringify([{
    commercial_line_kind: 'configurable_parcel',
    family_product_id: FAMILY,
    parcel_configuration_id: CONFIG,
    configuration_revision: 1,
    price_authority: 'server_catalog',
    line_discount_in_minor_units: 0,
    parcel_instances: [{ components: [
      { product_id: SKU_A, base_quantity: 2 },
      { product_id: SKU_B, base_quantity: 3 },
    ] }],
  }]);
  const receiptLines = JSON.stringify([{
    client_line_id: '92400000-0000-0000-0000-000000000501',
    purchase_order_item_id: null,
    line_kind: 'base_unit',
    family_product_id: null,
    parcel_configuration_id: null,
    configuration_revision: null,
    commercial_quantity: 1,
    units_per_parcel: null,
    base_unit_name: 'باكيت',
    parcel_unit_name: null,
    gross_amount_in_minor_units: 100,
    line_discount_in_minor_units: 0,
    components: [{
      product_id: SKU_A,
      base_quantity: 1,
      explicit_merchandise_cost_in_minor_units: 100,
    }],
  }]);
  await runSql(`INSERT INTO public.suppliers (
      id, company_name, current_balance_in_minor_units
    ) VALUES ('${SUPPLIER}', 'Phase 3 concurrency supplier', 0)
    ON CONFLICT (id) DO NOTHING;
    UPDATE public.configurable_parcel_feature_settings
      SET feature_state='ENABLED', updated_at=NOW()
      WHERE feature_key='configurable_parcels';
    UPDATE public.inventory_balances SET on_hand_quantity=20, reserved_quantity=0
      WHERE warehouse_id='92400000-0000-0000-0000-000000000201'
        AND product_id IN ('${SKU_A}','${SKU_B}');`);
  const deadlocksBefore = await readJson(`SELECT jsonb_build_object('value', deadlocks)
    FROM pg_stat_database WHERE datname=current_database();`);
  const holder = await startLockHolder(
    `SELECT pg_advisory_xact_lock(hashtextextended('inventory-product:${SKU_A}',0))`,
    'phase3-sale-receipt-holder',
  );
  const sale = readJson(`SET application_name='${appSale}'; ${ownerClaimsSql}
    SELECT public.create_pos_sale_v2(
      '92400000-0000-0000-0000-000000000201',
      '92400000-0000-0000-0000-000000000200', NULL,
      'Sale versus receipt', 'cash', '${saleRequest}'::jsonb,
      0, 5000, '${saleKey}'
    );`);
  const receipt = readJson(`SET application_name='${appReceipt}'; ${ownerClaimsSql}
    SELECT public.create_direct_supplier_receipt_v2(
      p_supplier_id := '${SUPPLIER}',
      p_warehouse_id := '92400000-0000-0000-0000-000000000201',
      p_branch_id := '92400000-0000-0000-0000-000000000200',
      p_supplier_invoice_number := 'P3-CONC-RECEIPT-1',
      p_header_discount_in_minor_units := 0,
      p_supplier_freight_in_minor_units := 0,
      p_legacy_tax_in_minor_units := 0,
      p_amount_paid_at_receipt_in_minor_units := 0,
      p_payment_method := 'deferred',
      p_idempotency_key := '${receiptKey}',
      p_lines := '${receiptLines}'::jsonb
    );`);
  await waitForBlockedApplications([appSale, appReceipt]);
  await holder.release();
  const [saleResult, receiptResult] = await Promise.all([sale, receipt]);
  assert.equal(saleResult.success, true);
  assert.equal(receiptResult.success, true);
  const state = await readJson(`SELECT jsonb_build_object(
    'saleOrders', (SELECT COUNT(*) FROM public.orders WHERE idempotency_key='${saleKey}'),
    'receiptOperations', (SELECT COUNT(*) FROM public.business_operations
      WHERE operation_type='supplier_receipt_v2' AND idempotency_key='${receiptKey}'),
    'receiptRows', (SELECT COUNT(*) FROM public.supplier_receipts
      WHERE operation_id=(SELECT id FROM public.business_operations
        WHERE operation_type='supplier_receipt_v2' AND idempotency_key='${receiptKey}')),
    'a', (SELECT on_hand_quantity FROM public.inventory_balances
      WHERE warehouse_id='92400000-0000-0000-0000-000000000201'
        AND product_id='${SKU_A}'),
    'b', (SELECT on_hand_quantity FROM public.inventory_balances
      WHERE warehouse_id='92400000-0000-0000-0000-000000000201'
        AND product_id='${SKU_B}')
  );`);
  assert.deepEqual(state, {
    saleOrders: 1,
    receiptOperations: 1,
    receiptRows: 1,
    a: 19,
    b: 17,
  });
  const deadlocksAfter = await readJson(`SELECT jsonb_build_object('value', deadlocks)
    FROM pg_stat_database WHERE datname=current_database();`);
  assert.equal(deadlocksAfter.value - deadlocksBefore.value, 0);
  return { bothCommittedSerially: true, waitObserved: true, deadlockDelta: 0 };
};

const runSaleAndReversalConcurrencyTest = async () => {
  const originalKey = 'phase3-sale-reversal-original-0001';
  const laterSaleKey = 'phase3-sale-reversal-later-sale-0001';
  const reversalKey = 'phase3-sale-reversal-attempt-0001'; // gitleaks:allow test fixture
  const appSale = 'phase3-sale-vs-reversal-sale';
  const appReversal = 'phase3-sale-vs-reversal-reversal';
  const baseRequest = JSON.stringify([{
    commercial_line_kind: 'base_unit',
    product_id: OTHER,
    base_quantity: 1,
    price_authority: 'server_catalog',
    line_discount_in_minor_units: 0,
  }]);
  await runSql(`UPDATE public.inventory_balances
    SET on_hand_quantity=20, reserved_quantity=0
    WHERE warehouse_id='92400000-0000-0000-0000-000000000201'
      AND product_id='${OTHER}';`);
  const original = await readJson(`${ownerClaimsSql}
    SELECT public.create_pos_sale_v2(
      '92400000-0000-0000-0000-000000000201',
      '92400000-0000-0000-0000-000000000200', NULL,
      'Original sale for reversal race', 'cash', '${baseRequest}'::jsonb,
      0, 900, '${originalKey}'
    );`);
  assert.equal(original.success, true);
  const deadlocksBefore = await readJson(`SELECT jsonb_build_object('value', deadlocks)
    FROM pg_stat_database WHERE datname=current_database();`);
  const holder = await startLockHolder(
    `SELECT pg_advisory_xact_lock(hashtextextended('inventory-product:${OTHER}',0))`,
    'phase3-sale-reversal-holder',
  );
  const laterSale = readJson(`SET application_name='${appSale}'; ${ownerClaimsSql}
    SELECT public.create_pos_sale_v2(
      '92400000-0000-0000-0000-000000000201',
      '92400000-0000-0000-0000-000000000200', NULL,
      'Later sale wins before reversal', 'cash', '${baseRequest}'::jsonb,
      0, 900, '${laterSaleKey}'
    );`);
  await waitForBlockedApplications([appSale]);
  const reversal = readJson(`SET application_name='${appReversal}'; ${ownerClaimsSql}
    SELECT public.reverse_pos_sale(
      '${original.orderId}',
      'اختبار حارس الحركة اللاحقة',
      '${reversalKey}'
    );`);
  await waitForBlockedApplications([appSale, appReversal]);
  await holder.release();
  const settled = await Promise.allSettled([laterSale, reversal]);
  assert.equal(settled[0].status, 'fulfilled');
  assert.equal(settled[1].status, 'rejected');
  assertFailureIdentity(settled[1].reason.message, {
    sqlState: 'P0001',
    applicationIdentity: 'PHASE3_POS_REVERSAL_LATER_MOVEMENT',
  });
  const state = await readJson(`SELECT jsonb_build_object(
    'originalStatus', (SELECT status FROM public.orders WHERE id='${original.orderId}'),
    'laterOrders', (SELECT COUNT(*) FROM public.orders WHERE idempotency_key='${laterSaleKey}'),
    'reversals', (SELECT COUNT(*) FROM public.pos_sale_reversals
      WHERE order_id='${original.orderId}'),
    'stock', (SELECT on_hand_quantity FROM public.inventory_balances
      WHERE warehouse_id='92400000-0000-0000-0000-000000000201'
        AND product_id='${OTHER}')
  );`);
  assert.deepEqual(state, {
    originalStatus: 'completed',
    laterOrders: 1,
    reversals: 0,
    stock: 18,
  });
  const deadlocksAfter = await readJson(`SELECT jsonb_build_object('value', deadlocks)
    FROM pg_stat_database WHERE datname=current_database();`);
  assert.equal(deadlocksAfter.value - deadlocksBefore.value, 0);
  return {
    laterSaleSerializedBeforeReversal: true,
    intendedGuardRejectedReversal: true,
    waitObserved: true,
    deadlockDelta: 0,
  };
};

const runLegacySaleAndReversalConcurrencyTest = async () => {
  const deadlocksBefore = await readJson(`SELECT jsonb_build_object('value', deadlocks)
    FROM pg_stat_database WHERE datname=current_database();`);
  const results = [];
  await runSql(`UPDATE public.inventory_balances
    SET on_hand_quantity=500, reserved_quantity=0
    WHERE warehouse_id='${WAREHOUSE}' AND product_id='${OTHER}';`);

  for (let iteration = 1; iteration <= 2; iteration += 1) {
    const locationMode = iteration === 1 ? 'explicit' : 'warehouse-with-null-branch';
    const saleBranchSql = iteration === 1 ? `'${BRANCH}'` : 'NULL';
    const saleFirstOriginalKey = `phase3-v1-sale-first-original-${iteration}-0001`;
    const saleFirstLaterKey = `phase3-v1-sale-first-later-${iteration}-0001`;
    const saleFirstReversalKey = `phase3-v1-sale-first-reverse-${iteration}-0001`;
    const original = await readJson(`${ownerClaimsSql}
      SELECT public.create_pos_sale(
        '${WAREHOUSE}', ${saleBranchSql}, NULL, 'V1 sale-first original', 'cash',
        '[{"product_id":"${OTHER}","quantity":1}]'::jsonb,
        0, 4500, '${saleFirstOriginalKey}'
      );`);
    const saleHolder = await startLockHolder(`${ownerClaimsSql}
      SELECT public.create_pos_sale(
        '${WAREHOUSE}', ${saleBranchSql}, NULL, 'V1 sale-first later', 'cash',
        '[{"product_id":"${OTHER}","quantity":1}]'::jsonb,
        0, 4500, '${saleFirstLaterKey}'
      )`, `phase3-v1-sale-first-holder-${iteration}`);
    const reversalApplication = `phase3-v1-sale-first-reversal-${iteration}`;
    const reversal = readJson(`SET application_name='${reversalApplication}';
      ${ownerClaimsSql}
      SELECT public.reverse_pos_sale(
        '${original.orderId}', 'اختبار بيع V1 قبل العكس',
        '${saleFirstReversalKey}'
      );`);
    await waitForBlockedApplications([reversalApplication]);
    await saleHolder.release();
    const settledReversal = await Promise.allSettled([reversal]);
    assert.equal(settledReversal[0].status, 'rejected');
    assertFailureIdentity(settledReversal[0].reason.message, {
      sqlState: 'P0001',
      applicationIdentity: 'PHASE3_POS_REVERSAL_LATER_MOVEMENT',
    });
    const saleFirstState = await readJson(`SELECT jsonb_build_object(
      'originalStatus', (SELECT status FROM public.orders WHERE id='${original.orderId}'),
      'laterOrders', (SELECT count(*) FROM public.orders
        WHERE idempotency_key='${saleFirstLaterKey}'),
      'reversals', (SELECT count(*) FROM public.pos_sale_reversals
        WHERE order_id='${original.orderId}')
    );`);
    assert.deepEqual(saleFirstState, {
      originalStatus: 'completed', laterOrders: 1, reversals: 0,
    });

    const reversalFirstOriginalKey = `phase3-v1-reversal-first-original-${iteration}-0001`;
    const reversalFirstLaterKey = `phase3-v1-reversal-first-later-${iteration}-0001`;
    const reversalFirstKey = `phase3-v1-reversal-first-reverse-${iteration}-0001`;
    const reversalFirstOriginal = await readJson(`${ownerClaimsSql}
      SELECT public.create_pos_sale(
        '${WAREHOUSE}', ${saleBranchSql}, NULL, 'V1 reversal-first original', 'cash',
        '[{"product_id":"${OTHER}","quantity":1}]'::jsonb,
        0, 4500, '${reversalFirstOriginalKey}'
      );`);
    const reversalHolder = await startLockHolder(`${ownerClaimsSql}
      SELECT public.reverse_pos_sale(
        '${reversalFirstOriginal.orderId}', 'اختبار العكس قبل بيع V1',
        '${reversalFirstKey}'
      )`, `phase3-v1-reversal-first-holder-${iteration}`);
    const saleApplication = `phase3-v1-reversal-first-sale-${iteration}`;
    const laterSale = readJson(`SET application_name='${saleApplication}';
      ${ownerClaimsSql}
      SELECT public.create_pos_sale(
        '${WAREHOUSE}', ${saleBranchSql}, NULL, 'V1 after reversal', 'cash',
        '[{"product_id":"${OTHER}","quantity":1}]'::jsonb,
        0, 4500, '${reversalFirstLaterKey}'
      );`);
    await waitForBlockedApplications([saleApplication]);
    await reversalHolder.release();
    const laterSaleResult = await laterSale;
    assert.equal(laterSaleResult.success, true);
    const reversalFirstState = await readJson(`SELECT jsonb_build_object(
      'originalStatus', (SELECT status FROM public.orders
        WHERE id='${reversalFirstOriginal.orderId}'),
      'laterOrders', (SELECT count(*) FROM public.orders
        WHERE idempotency_key='${reversalFirstLaterKey}'),
      'reversals', (SELECT count(*) FROM public.pos_sale_reversals
        WHERE order_id='${reversalFirstOriginal.orderId}')
    );`);
    assert.deepEqual(reversalFirstState, {
      originalStatus: 'cancelled', laterOrders: 1, reversals: 1,
    });
    results.push({
      iteration,
      locationMode,
      saleFirst: 'SERIAL_REJECTION',
      reversalFirst: 'BOTH_COMMITTED',
    });
  }

  const replayKey = 'phase3-v1-closed-shift-replay-0001';
  const replayOriginal = await readJson(`${ownerClaimsSql}
    SELECT public.create_pos_sale(
      '${WAREHOUSE}', '${BRANCH}', NULL, 'V1 closed-shift replay', 'cash',
      '[{"product_id":"${OTHER}","quantity":1}]'::jsonb,
      0, 4500, '${replayKey}'
    );`);
  const replayStateBefore = await saleBusinessState(replayKey);
  const replayWhileClosed = await readJson(`BEGIN;
    UPDATE public.cash_shifts SET
      status='cancelled',
      cancelled_by='${OWNER}',
      cancelled_at=NOW(),
      cancellation_reason='حالة اختبار معزولة لإثبات replay دون وردية مفتوحة'
    WHERE id='${SHIFT}';
    ${ownerClaimsSql}
    SELECT public.create_pos_sale(
      '${WAREHOUSE}', '${BRANCH}', NULL, 'V1 closed-shift replay', 'cash',
      '[{"product_id":"${OTHER}","quantity":1}]'::jsonb,
      0, 4500, '${replayKey}'
    );
    ROLLBACK;`);
  assert.equal(replayWhileClosed.orderId, replayOriginal.orderId);
  assert.equal(replayWhileClosed.idempotentReplay, true);
  assert.deepEqual(await saleBusinessState(replayKey), replayStateBefore);

  const deadlocksAfter = await readJson(`SELECT jsonb_build_object('value', deadlocks)
    FROM pg_stat_database WHERE datname=current_database();`);
  assert.equal(deadlocksAfter.value - deadlocksBefore.value, 0);
  return {
    iterations: results,
    bothSerializationDirections: true,
    replayAfterShiftClosure: true,
    deadlockDelta: 0,
  };
};

const runCoordinatorZeroWriteTests = async () => {
  const key = 'phase3-pos-configurable-main-0001';
  const request = [parcelLine(2)];
  // The canonical runtime fixture uses a repeated SKU component in its second
  // instance. Preserve that exact logical composition for replay identity.
  request[0].parcel_instances[1].components = [
    { product_id: SKU_A, base_quantity: 1 },
    { product_id: SKU_A, base_quantity: 1 },
    { product_id: SKU_B, base_quantity: 3 },
  ];
  const baseline = await saleBusinessState(key);
  assert.ok(baseline.operations?.length === 1 && baseline.orders?.length === 1);

  const replay = await callPosV2(
    key, 'عميل Phase 3', 'cash', request, 3, 12000,
  );
  assert.equal(replay.idempotentReplay, false);
  assert.deepEqual(await saleBusinessState(key), baseline);

  const changed = structuredClone(request);
  changed[0].parcel_instances[0].components = [
    { product_id: SKU_A, base_quantity: 1 },
    { product_id: SKU_B, base_quantity: 4 },
  ];
  await expectSqlFailure(`${ownerClaimsSql}
    SELECT public.create_pos_sale_v2(
      '${WAREHOUSE}', '${BRANCH}', NULL, 'عميل Phase 3', 'cash',
      $phase3$${JSON.stringify(changed)}$phase3$::jsonb,
      3, 12000, '${key}'
    );`, {
    sqlState: 'P0001', applicationIdentity: 'PHASE3_IDEMPOTENCY_CONFLICT',
  });
  assert.deepEqual(await saleBusinessState(key), baseline);

  const cashierClaims = `SELECT set_config(
    'request.jwt.claims',
    '{"sub":"${CASHIER}","role":"authenticated","aal":"aal1"}',
    false
  );`;
  await expectSqlFailure(`${cashierClaims}
    SELECT public.create_pos_sale_v2(
      '${WAREHOUSE}', '${BRANCH}', NULL, 'عميل Phase 3', 'cash',
      $phase3$${JSON.stringify(request)}$phase3$::jsonb,
      3, 12000, '${key}'
    );`, {
    sqlState: 'P0001', applicationIdentity: 'PHASE3_IDEMPOTENCY_CONFLICT',
  });
  assert.deepEqual(await saleBusinessState(key), baseline);

  return {
    freshConnectionSnapshots: true,
    exactReplayZeroWrites: true,
    changedPayloadConflictZeroWrites: true,
    crossActorConflictZeroWrites: true,
  };
};

const runConfigurableRollbackTest = async () => {
  const key = 'phase3-configurable-rollback-0001';
  await runSql(`UPDATE public.configurable_parcel_feature_settings
    SET feature_state='ENABLED', updated_at=NOW()
    WHERE feature_key='configurable_parcels';
    UPDATE public.inventory_balances SET
      on_hand_quantity=CASE product_id
        WHEN '${SKU_A}'::uuid THEN 20
        WHEN '${SKU_B}'::uuid THEN 1
      END,
      reserved_quantity=0
    WHERE warehouse_id='${WAREHOUSE}'
      AND product_id IN ('${SKU_A}','${SKU_B}');`);
  const baseline = await saleBusinessState(key);
  await expectSqlFailure(`${ownerClaimsSql}
    SELECT public.create_pos_sale_v2(
      '${WAREHOUSE}', '${BRANCH}', NULL, 'Configurable rollback', 'cash',
      $phase3$${JSON.stringify([parcelLine(1)])}$phase3$::jsonb,
      0, 5000, '${key}'
    );`, {
    sqlState: 'P0001', applicationIdentity: 'PHASE3_POS_INSUFFICIENT_INVENTORY',
  });
  const after = await saleBusinessState(key);
  assert.deepEqual(after, baseline);
  assert.equal(after.operations, null);
  assert.equal(after.orders, null);
  assert.equal(after.items, null);
  assert.equal(after.instances, null);
  assert.equal(after.components, null);
  assert.equal(after.movements, null);
  assert.equal(after.customerPayments, null);
  return {
    strictFailureIdentity: true,
    sufficientComponentUnchanged: true,
    insufficientComponentUnchanged: true,
    noPartialBusinessRows: true,
    shiftAndFinancialStateUnchanged: true,
    wacUnchanged: true,
  };
};

const numericDelta = (after, before, path) => {
  const read = (value) => path.reduce((current, key) => current?.[key], value);
  return Number(read(after)) - Number(read(before));
};

const runFinancialReadSideTests = async () => {
  await runSql(`UPDATE public.configurable_parcel_feature_settings
    SET feature_state='ENABLED', updated_at=NOW()
    WHERE feature_key='configurable_parcels';
    UPDATE public.inventory_balances SET on_hand_quantity=500, reserved_quantity=0
    WHERE warehouse_id='${WAREHOUSE}'
      AND product_id IN ('${SKU_A}','${SKU_B}');`);

  const beforeCash = await financialReadState();
  const cash = await callPosV2(
    'phase3-financial-cash-0001', 'Financial cash', 'cash',
    [parcelLine(1)], 1, 4999,
  );
  assert.equal(cash.totalInMinorUnits, 4999);
  assert.equal(cash.items[0].cogsInMinorUnits, 38);
  assert.equal(cash.items[0].profitInMinorUnits, 4961);
  const afterCash = await financialReadState();
  assert.equal(
    numericDelta(afterCash, beforeCash, ['shift', 'cashSalesInMinorUnits']),
    4999,
  );
  assert.equal(
    numericDelta(afterCash, beforeCash, ['report', 'sales', 'grossSalesInMinorUnits']),
    4999,
  );
  assert.equal(
    numericDelta(afterCash, beforeCash, ['report', 'sales', 'cogsInMinorUnits']),
    38,
  );
  assert.equal(
    numericDelta(afterCash, beforeCash, ['report', 'sales', 'grossProfitInMinorUnits']),
    4961,
  );
  assert.equal(
    numericDelta(afterCash, beforeCash, ['report', 'sales', 'discountInMinorUnits']),
    1,
  );
  assert.equal(afterCash.customerPaymentCount, beforeCash.customerPaymentCount);

  const beforeCliq = afterCash;
  const cliq = await callPosV2(
    'phase3-financial-cliq-0001', 'Financial CliQ', 'cliq',
    [baseLine(SKU_A, 1)], 0, 1000,
  );
  assert.equal(cliq.totalInMinorUnits, 1000);
  assert.equal(cliq.items[0].cogsInMinorUnits, 10);
  assert.equal(cliq.items[0].profitInMinorUnits, 990);
  const afterCliq = await financialReadState();
  assert.equal(
    numericDelta(afterCliq, beforeCliq, ['shift', 'cliqSalesInMinorUnits']),
    1000,
  );
  assert.equal(
    numericDelta(afterCliq, beforeCliq, ['report', 'sales', 'grossSalesInMinorUnits']),
    1000,
  );
  assert.equal(
    numericDelta(afterCliq, beforeCliq, ['report', 'sales', 'cogsInMinorUnits']),
    10,
  );
  assert.equal(
    numericDelta(afterCliq, beforeCliq, ['report', 'sales', 'grossProfitInMinorUnits']),
    990,
  );
  assert.equal(afterCliq.customerPaymentCount, beforeCliq.customerPaymentCount);

  const replayBaseline = stableFinancialReadState(await financialReadState());
  const cashReplay = await callPosV2(
    'phase3-financial-cash-0001', 'Financial cash', 'cash',
    [parcelLine(1)], 1, 4999,
  );
  assert.equal(cashReplay.orderId, cash.orderId);
  assert.deepEqual(
    stableFinancialReadState(await financialReadState()),
    replayBaseline,
  );

  return {
    cash: { revenue: 4999, cogs: 38, profit: 4961, shiftDelta: 4999 },
    cliq: { revenue: 1000, cogs: 10, profit: 990, shiftDelta: 1000 },
    paymentRowsCreated: 0,
    canonicalReportMatched: true,
    replayDidNotDuplicateFinancialEffect: true,
  };
};

const runLockOrderTest = async () => {
  const deadlocksBefore = await readJson(`
    SELECT jsonb_build_object('value', deadlocks)
    FROM pg_stat_database WHERE datname=current_database();
  `);
  const first = spawn('docker', [
    'exec', '-i', databaseContainer,
    'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A',
    '-v', 'ON_ERROR_STOP=1',
  ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let firstOutput = '';
  let firstError = '';
  first.stdout.setEncoding('utf8');
  first.stderr.setEncoding('utf8');
  first.stdout.on('data', (chunk) => { firstOutput += chunk; });
  first.stderr.on('data', (chunk) => { firstError += chunk; });
  const firstClosed = new Promise((resolve, reject) => {
    first.on('error', reject);
    first.on('close', (code) => code === 0
      ? resolve()
      : reject(new Error(`First lock connection failed: ${firstError}`)));
  });
  first.stdin.write(`SET application_name='phase3-lock-first'; BEGIN;
    SELECT public.phase3_lock_inventory_products_internal(
      ARRAY['${SKU_A}'::uuid,'${SKU_B}'::uuid]
    ); SELECT 'PHASE3_LOCK_READY';\n`);
  await waitFor(
    async () => firstOutput.includes('PHASE3_LOCK_READY'),
    'first Phase 3 lock holder',
  );

  const secondPromise = readJson(`
    SET application_name='phase3-lock-second';
    BEGIN;
    SELECT public.phase3_lock_inventory_products_internal(
      ARRAY['${SKU_B}'::uuid,'${SKU_A}'::uuid]
    );
    SELECT jsonb_build_object('completed', true);
    COMMIT;
  `);
  let secondError;
  secondPromise.catch((error) => { secondError = error; });
  await waitFor(async () => {
    const result = await readJson(`SELECT jsonb_build_object('waiting', EXISTS (
      SELECT 1 FROM pg_stat_activity waiter
      JOIN pg_stat_activity blocker
        ON blocker.pid = ANY(pg_blocking_pids(waiter.pid))
      WHERE waiter.application_name='phase3-lock-second'
        AND blocker.application_name='phase3-lock-first'
        AND waiter.wait_event_type='Lock'
    ));`);
    return result.waiting;
  }, 'reverse-input Phase 3 lock wait');

  first.stdin.end('COMMIT;\n\\q\n');
  await firstClosed;
  const second = await secondPromise.catch((error) => { throw secondError ?? error; });
  assert.equal(second.completed, true);
  const deadlocksAfter = await readJson(`
    SELECT jsonb_build_object('value', deadlocks)
    FROM pg_stat_database WHERE datname=current_database();
  `);
  assert.equal(deadlocksAfter.value - deadlocksBefore.value, 0);
  return {
    reverseInputSerialized: true,
    waitObserved: true,
    deadlockDelta: 0,
  };
};

const runCustomerReservationCoordinatorTests = async () => {
  const phoneHash = 'a'.repeat(64);
  const sessionHash = 'b'.repeat(64);
  const guestClaims = `SELECT set_config('request.jwt.claim.role','service_role',false);`;
  const customerLines = [
    {
      commercial_line_kind: 'base_unit',
      product_id: SKU_A,
      base_quantity: 2,
      expected_unit_price_in_minor_units: 1000,
    },
    {
      commercial_line_kind: 'configurable_parcel',
      family_product_id: FAMILY,
      parcel_configuration_id: CONFIG,
      configuration_revision: 1,
      expected_unit_price_in_minor_units: 5000,
      parcel_instances: [{
        components: [
          {product_id: SKU_A, base_quantity: 2},
          {product_id: SKU_B, base_quantity: 3},
        ],
      }],
    },
  ];
  const multiInstanceCustomerLines = [{
    commercial_line_kind: 'configurable_parcel',
    family_product_id: FAMILY,
    parcel_configuration_id: CONFIG,
    configuration_revision: 1,
    expected_unit_price_in_minor_units: 5000,
    parcel_instances: [
      {components: [
        {product_id: SKU_A, base_quantity: 2},
        {product_id: SKU_B, base_quantity: 3},
      ]},
      {components: [
        {product_id: SKU_A, base_quantity: 2},
        {product_id: SKU_B, base_quantity: 3},
      ]},
    ],
  }];
  const baseOnlyFor = (productId, baseQuantity = 1) => [{
    commercial_line_kind: 'base_unit', product_id: productId, base_quantity: baseQuantity,
    expected_unit_price_in_minor_units: 1000,
  }];
  const baseOnly = baseOnlyFor(SKU_A);
  const customerCall = (
    key,
    lines = customerLines,
    totals = [7000, 0, 0, 7000],
    phone = '0795550101',
    {
      promotionCode = null,
      deliveryZone = 'inside_ramtha',
      actorPhoneHash = phoneHash,
      actorSessionHash = sessionHash,
    } = {},
  ) => `${guestClaims}
    SELECT public.submit_guest_customer_order_v2(
      '${key}', '${actorPhoneHash}', '${actorSessionHash}', 'عميل Phase 3 V2',
      '${phone}', 'إربد', 'الرمثا', 'الحي الشرقي', 'شارع الاختبار',
      NULL, NULL, NULL, NULL, NULL, NULL,
      $customer$${JSON.stringify(lines)}$customer$::jsonb,
      ${promotionCode === null ? 'NULL' : `'${promotionCode}'`},
      'cash_on_delivery', '${deliveryZone}',
      ${totals[0]}, ${totals[1]}, ${totals[2]}, ${totals[3]}
    );`;
  const customerV1Call = (
    key,
    phone,
    quantity = 1,
    productId = SKU_A,
  ) => `${guestClaims}
    SELECT public.submit_guest_customer_order(
      '${key}', 'عميل Customer V1', '${phone}',
      'إربد', 'الرمثا', 'الحي الشرقي', 'شارع الاختبار',
      NULL, NULL, NULL, NULL, NULL, NULL,
      $customer$${JSON.stringify([{product_id: productId, quantity}])}$customer$::jsonb,
      NULL, 'cash_on_delivery', 'inside_ramtha'
    );`;
  const customerState = (key) => readJson(`
    WITH target AS (SELECT id,operation_id FROM public.orders WHERE idempotency_key='${key}')
    SELECT jsonb_build_object(
      'orders',(SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM public.orders o WHERE o.id IN (SELECT id FROM target)),
      'items',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.order_items i WHERE i.order_id IN (SELECT id FROM target)),
      'instances',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.order_parcel_instances i WHERE i.order_id IN (SELECT id FROM target)),
      'components',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.order_parcel_components c WHERE c.operation_id IN (SELECT operation_id FROM target)),
      'reservations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.order_inventory_reservations r WHERE r.order_id IN (SELECT id FROM target)),
      'movements',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM public.inventory_movements m WHERE m.reference_id IN (SELECT id FROM target)),
      'operations',(SELECT jsonb_agg(to_jsonb(op) ORDER BY op.id) FROM public.business_operations op WHERE op.id IN (SELECT operation_id FROM target) OR op.request_identity_snapshot->>'order_id' IN (SELECT id::text FROM target)),
      'balances',(SELECT jsonb_agg(jsonb_build_object('productId',product_id,'onHand',on_hand_quantity,'reserved',reserved_quantity,'updatedAt',updated_at) ORDER BY product_id) FROM public.inventory_balances WHERE warehouse_id='${WAREHOUSE}' AND product_id IN ('${SKU_A}','${SKU_B}')),
      'counts',jsonb_build_object(
        'customers',(SELECT count(*) FROM public.customers),
        'addresses',(SELECT count(*) FROM public.customer_addresses),
        'orders',(SELECT count(*) FROM public.orders),
        'operations',(SELECT count(*) FROM public.business_operations),
        'movements',(SELECT count(*) FROM public.inventory_movements),
        'payments',(SELECT count(*) FROM public.customer_payments)
      )
    );
  `);
  const runCustomerOverlap = async (
    label,
    leftSql,
    rightSql,
    holderSql = `SELECT pg_advisory_xact_lock(hashtextextended('inventory-product:${SKU_A}',0))`,
    { leftQueuesFirst = false } = {},
  ) => {
    const leftApplication = `phase3-customer-${label}-left`;
    const rightApplication = `phase3-customer-${label}-right`;
    const holder = await startLockHolder(
      holderSql,
      `phase3-customer-${label}-holder`,
    );
    let left;
    let right;
    let released = false;
    try {
      left = observeOutcome(readJson(`SET application_name='${leftApplication}'; ${leftSql}`));
      if (leftQueuesFirst) {
        await waitForBlockedApplications([leftApplication]);
      }
      right = observeOutcome(readJson(`SET application_name='${rightApplication}'; ${rightSql}`));
      await waitForBlockedApplications([leftApplication, rightApplication]);
      await holder.release();
      released = true;
      return await Promise.all([left, right]);
    } finally {
      if (!released) await holder.release().catch(() => undefined);
      await Promise.allSettled([left, right].filter(Boolean));
    }
  };
  const cancelCreatedCustomerOrder = async (result, suffix) => {
    const operationType = await readJson(`SELECT jsonb_build_object(
      'value', operation.operation_type
    ) FROM public.orders customer_order
    LEFT JOIN public.business_operations operation
      ON operation.id=customer_order.operation_id
    WHERE customer_order.id='${result.order_id}';`);
    if (operationType.value === 'phase3_customer_reservation_v1') {
      await readJson(`${ownerClaimsSql} SELECT public.cancel_customer_order_v2(
        '${result.order_id}','phase3-h2-cleanup-${suffix}',
        'Phase 3 mixed-version concurrency cleanup'
      );`);
    } else {
      await readJson(`${ownerClaimsSql} SELECT public.update_order_status(
        '${result.order_id}','cancelled','Phase 3 V1 concurrency cleanup'
      );`);
    }
  };

  const runPublicConfigurableParcelReadContractTests = async () => {
    const publicRead = async (familyIds = [FAMILY]) => {
      const startedAt = Date.now();
      const result = await readJson(`SET ROLE anon;
        SELECT public.get_public_configurable_parcel_options(
          ARRAY[${familyIds.map((id) => `'${id}'::uuid`).join(',')}]
        );
        RESET ROLE;`);
      return {result, elapsedMs: Date.now() - startedAt};
    };
    const collectKeys = (value, result = []) => {
      if (Array.isArray(value)) {
        for (const item of value) collectKeys(item, result);
        return result;
      }
      if (value && typeof value === 'object') {
        for (const [key, item] of Object.entries(value)) {
          result.push(key);
          collectKeys(item, result);
        }
      }
      return result;
    };

    await runSql(`
      UPDATE public.configurable_parcel_feature_settings
      SET feature_state='ENABLED', updated_at=NOW()
      WHERE feature_key='configurable_parcels';
      UPDATE public.product_parcel_configurations
      SET is_active=true, composition_mode='configurable_mix',
        configuration_revision=1
      WHERE id='${CONFIG}';
      UPDATE public.categories SET is_active=true
      WHERE id='92400000-0000-0000-0000-000000000011';
      UPDATE public.products SET is_active=true,
        wac_cost_in_minor_units_exact=CASE id
          WHEN '${SKU_A}' THEN 10.333333::NUMERIC(24,6)
          WHEN '${SKU_B}' THEN 5.666667::NUMERIC(24,6)
          ELSE wac_cost_in_minor_units_exact
        END
      WHERE id IN ('${FAMILY}','${SKU_A}','${SKU_B}');
      UPDATE public.warehouses SET is_active=true,
        created_at=CASE id WHEN '${WAREHOUSE}' THEN '2020-01-01T00:00:00Z'::timestamptz
          ELSE created_at END
      WHERE id IN ('${WAREHOUSE}','${LEGACY_WAREHOUSE_B}');
      UPDATE public.inventory_balances
      SET on_hand_quantity=GREATEST(on_hand_quantity, 1000)
      WHERE warehouse_id='${WAREHOUSE}'
        AND product_id IN ('${SKU_A}','${SKU_B}');
      INSERT INTO public.inventory_balances(
        warehouse_id,product_id,on_hand_quantity,reserved_quantity
      ) VALUES ('${LEGACY_WAREHOUSE_B}','${SKU_A}',9000,0)
      ON CONFLICT (warehouse_id,product_id) DO UPDATE
      SET on_hand_quantity=EXCLUDED.on_hand_quantity,
        reserved_quantity=EXCLUDED.reserved_quantity;
    `);

    const functionSecurity = await readJson(`SELECT jsonb_build_object(
      'owner',pg_get_userbyid(procedure.proowner),
      'securityDefiner',procedure.prosecdef,
      'searchPath',procedure.proconfig,
      'anonExecute',has_function_privilege(
        'anon','public.get_public_configurable_parcel_options(uuid[])','EXECUTE'
      ),
      'authenticatedExecute',has_function_privilege(
        'authenticated','public.get_public_configurable_parcel_options(uuid[])','EXECUTE'
      ),
      'anonTableSelect',has_table_privilege(
        'anon','public.product_parcel_configurations','SELECT'
      ),
      'authenticatedTableSelect',has_table_privilege(
        'authenticated','public.product_parcel_configurations','SELECT'
      )
    ) FROM pg_proc procedure
    WHERE procedure.oid='public.get_public_configurable_parcel_options(uuid[])'::regprocedure;`);
    assert.equal(functionSecurity.owner, 'postgres');
    assert.equal(functionSecurity.securityDefiner, true);
    assert.deepEqual(functionSecurity.searchPath, ['search_path=public, pg_temp']);
    assert.equal(functionSecurity.anonExecute, true);
    assert.equal(functionSecurity.authenticatedExecute, true);
    assert.equal(functionSecurity.anonTableSelect, false);
    assert.equal(functionSecurity.authenticatedTableSelect, true);

    await expectExactSqlFailure(
      `SET ROLE anon; SELECT COUNT(*) FROM public.product_parcel_configurations;`,
      {
        sqlState: '42501',
        messageText: 'permission denied for table product_parcel_configurations',
      },
    );
    const genericAuthenticatedRead = await readJson(`SET ROLE authenticated;
      SELECT jsonb_build_object('count',COUNT(*))
      FROM public.product_parcel_configurations;
      RESET ROLE;`);
    assert.equal(genericAuthenticatedRead.count, 0);
    const staffRead = await readJson(`SET ROLE authenticated;
      ${ownerClaimsSql}
      SELECT jsonb_build_object('count',COUNT(*))
      FROM public.product_parcel_configurations;
      RESET ROLE;`);
    assert.ok(staffRead.count >= 1);

    await expectSqlFailure(`SET ROLE anon;
      SELECT public.get_public_configurable_parcel_options(
        ARRAY(SELECT gen_random_uuid() FROM generate_series(1,49))
      );`, {
      sqlState: 'P0001',
      applicationIdentity: 'PUBLIC_CONFIGURABLE_PARCEL_REQUEST_INVALID',
    });

    await runSql(`UPDATE public.configurable_parcel_feature_settings
      SET feature_state='OFF' WHERE feature_key='configurable_parcels';`);
    const off = (await publicRead()).result;
    assert.equal(off.featureState, 'OFF');
    assert.equal(off.guestCreationEnabled, false);
    assert.deepEqual(off.options, []);

    await runSql(`UPDATE public.configurable_parcel_feature_settings
      SET feature_state='OWNER_PILOT' WHERE feature_key='configurable_parcels';`);
    const ownerPilot = (await publicRead()).result;
    assert.equal(ownerPilot.featureState, 'OWNER_PILOT');
    assert.equal(ownerPilot.guestCreationEnabled, false);
    assert.deepEqual(ownerPilot.options, []);

    await runSql(`UPDATE public.configurable_parcel_feature_settings
      SET feature_state='ENABLED' WHERE feature_key='configurable_parcels';`);
    const enabledRead = await publicRead();
    const enabled = enabledRead.result;
    assert.equal(enabled.featureState, 'ENABLED');
    assert.equal(enabled.guestCreationEnabled, true);
    assert.equal(enabled.options.length, 1);
    const option = enabled.options[0];
    assert.equal(option.familyProductId, FAMILY);
    assert.equal(option.parcelConfigurationId, CONFIG);
    assert.equal(option.configurationRevision, 1);
    assert.equal(option.compositionMode, 'configurable_mix');
    assert.equal(option.unitsPerParcel, 5);
    assert.equal(option.parcelPriceInMinorUnits, 5000);
    assert.equal(option.baseUnitNameAr, 'باكيت');
    assert.equal(option.saleUnitNameAr, 'باكيت');
    assert.deepEqual(
      option.components.map((component) => component.productId).sort(),
      [SKU_A, SKU_B].sort(),
    );
    const selectedWarehouseAvailability = await readJson(`SELECT jsonb_build_object(
      'skuA',(SELECT available_quantity FROM public.inventory_balances
        WHERE warehouse_id='${WAREHOUSE}' AND product_id='${SKU_A}'),
      'skuB',(SELECT available_quantity FROM public.inventory_balances
        WHERE warehouse_id='${WAREHOUSE}' AND product_id='${SKU_B}')
    );`);
    assert.equal(
      option.components.find((component) => component.productId === SKU_A).availableQuantity,
      selectedWarehouseAvailability.skuA,
    );
    assert.equal(
      option.components.find((component) => component.productId === SKU_B).availableQuantity,
      selectedWarehouseAvailability.skuB,
    );
    assert.notEqual(
      option.components.find((component) => component.productId === SKU_A).availableQuantity,
      selectedWarehouseAvailability.skuA + 9000,
    );
    assert.equal(option.components.some((component) => component.productId === OTHER), false);

    const exposedKeys = collectKeys(enabled).map((key) => key.toLowerCase());
    for (const forbiddenFragment of [
      'wac', 'cost', 'supplier', 'invoice', 'margin', 'cogs',
      'operation', 'reservation', 'actor', 'warehouseid',
    ]) {
      assert.equal(
        exposedKeys.some((key) => key.includes(forbiddenFragment)),
        false,
        `Public read leaked a forbidden field containing ${forbiddenFragment}.`,
      );
    }

    await runSql(`UPDATE public.product_parcel_configurations
      SET is_active=false WHERE id='${CONFIG}';`);
    assert.deepEqual((await publicRead()).result.options, []);
    await runSql(`UPDATE public.product_parcel_configurations
      SET is_active=true,configuration_revision=2 WHERE id='${CONFIG}';`);
    const revisionTwo = (await publicRead()).result.options[0];
    assert.equal(revisionTwo.configurationRevision, 2);

    await runSql(`UPDATE public.products SET is_active=false WHERE id='${SKU_B}';`);
    const inactiveFiltered = (await publicRead()).result.options[0];
    assert.deepEqual(
      inactiveFiltered.components.map((component) => component.productId),
      [SKU_A],
    );
    await runSql(`UPDATE public.products SET is_active=true WHERE id='${SKU_B}';`);

    const roundTripLines = [{
      commercial_line_kind: 'configurable_parcel',
      family_product_id: revisionTwo.familyProductId,
      parcel_configuration_id: revisionTwo.parcelConfigurationId,
      configuration_revision: revisionTwo.configurationRevision,
      expected_unit_price_in_minor_units: revisionTwo.parcelPriceInMinorUnits,
      parcel_instances: [{components: [
        {product_id: SKU_A, base_quantity: 2},
        {product_id: SKU_B, base_quantity: 3},
      ]}],
    }];
    const roundTripKey = '93300000-0000-4000-8000-000000000117';
    const roundTripOrder = await readJson(customerCall(
      roundTripKey,
      roundTripLines,
      [revisionTwo.parcelPriceInMinorUnits, 0, 0, revisionTwo.parcelPriceInMinorUnits],
      '0795550177',
    ));
    assert.equal(roundTripOrder.success, true);
    assert.equal(roundTripOrder.idempotent_replay, false);
    await cancelCreatedCustomerOrder(roundTripOrder, 'public-read-round-trip');

    const negativeKey = '93300000-0000-4000-8000-000000000118';
    const invalidComponents = [{
      ...roundTripLines[0],
      parcel_instances: [{components: [
        {product_id: SKU_A, base_quantity: 4},
        {product_id: OTHER, base_quantity: 1},
      ]}],
    }];
    const negativeBefore = await customerState(negativeKey);
    await expectSqlFailure(customerCall(
      negativeKey,
      invalidComponents,
      [revisionTwo.parcelPriceInMinorUnits, 0, 0, revisionTwo.parcelPriceInMinorUnits],
      '0795550178',
    ), {
      sqlState: '23514',
      constraint: 'phase3_parcel_component_family_check',
    });
    assert.deepEqual(await customerState(negativeKey), negativeBefore);

    await runSql(`UPDATE public.product_parcel_configurations
      SET configuration_revision=1 WHERE id='${CONFIG}';`);

    return {
      rpc: 'get_public_configurable_parcel_options(uuid[])',
      boundedFamilyIds: 48,
      featureStateMatrix: true,
      directAnonTableReadDenied: true,
      genericAuthenticatedRlsFiltered: true,
      activeStaffReadPreserved: true,
      authoritativeConfiguration: true,
      authoritativeRevision: true,
      authoritativeCapacityAndPrice: true,
      componentEligibility: true,
      selectedWarehouseAvailability: true,
      sensitiveFieldsAbsent: true,
      readWriteRoundTrip: true,
      negativeEligibilityRejectedZeroWrites: true,
      basicExecutionElapsedMs: enabledRead.elapsedMs,
      functionSecurity,
    };
  };

  const runPromotionPreviewV2Tests = async () => {
    const preview = (lines, promotionCode = null, phone = null) => readJson(`
      SET ROLE anon;
      SELECT public.preview_guest_promotion_v2(
        $preview$${JSON.stringify(lines)}$preview$::jsonb,
        ${sqlValue(promotionCode)}, ${sqlValue(phone)}
      );
      RESET ROLE;
    `);
    const previewSql = (lines, promotionCode = null, phone = null) => `
      SET ROLE anon;
      SELECT public.preview_guest_promotion_v2(
        $preview$${JSON.stringify(lines)}$preview$::jsonb,
        ${sqlValue(promotionCode)}, ${sqlValue(phone)}
      );`;
    const existingCustomer = '93400000-0000-4000-8000-000000000800';
    const existingAddress = '93400000-0000-4000-8000-000000000801';
    const witnessCustomer = '93400000-0000-4000-8000-000000000802';
    // These selectors are fixed before any call, not IDs discovered by BEFORE.
    // Each readJson call starts a separate psql connection and observes committed
    // state. Full targeted rows retain linkage, identity, quantities and timestamps.
    const state = () => readJson(`
      WITH customers AS (
        SELECT * FROM public.customers WHERE
          public.normalize_customer_phone(phone) ~ '^0796[123][0-9]{5}$'
          OR id IN ('${existingCustomer}','${witnessCustomer}')
      ), target_orders AS (
        SELECT * FROM public.orders WHERE customer_id IN (SELECT id FROM customers)
          OR idempotency_key LIKE '93400000-%'
          OR promotion_code_id IN (SELECT id FROM public.promotion_codes WHERE code LIKE 'P34%')
      ), target_operations AS (
        SELECT * FROM public.business_operations WHERE id IN (SELECT operation_id FROM target_orders)
          OR idempotency_key LIKE '93400000-%'
          OR request_identity_snapshot->>'order_id' IN (SELECT id::text FROM target_orders)
      )
      SELECT jsonb_build_object(
        'customers',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM customers t),'[]'),
        'addresses',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.customer_addresses t
          WHERE customer_id IN (SELECT id FROM customers) OR id='${existingAddress}'),'[]'),
        'orders',COALESCE((SELECT jsonb_agg(to_jsonb(t)-'tracking_token' ORDER BY id) FROM target_orders t),'[]'),
        'items',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.order_items t
          WHERE order_id IN (SELECT id FROM target_orders)),'[]'),
        'instances',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.order_parcel_instances t
          WHERE order_id IN (SELECT id FROM target_orders)),'[]'),
        'components',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.order_parcel_components t
          WHERE operation_id IN (SELECT id FROM target_operations)),'[]'),
        'reservations',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.order_inventory_reservations t
          WHERE order_id IN (SELECT id FROM target_orders)),'[]'),
        'operations',COALESCE((SELECT jsonb_agg(
          (to_jsonb(t)-'result_snapshot') || jsonb_build_object('result_snapshot',
            result_snapshot-'tracking_token'-'tracking_path') ORDER BY id)
          FROM target_operations t),'[]'),
        'redemptions',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.promotion_redemptions t
          WHERE customer_id IN (SELECT id FROM customers)
            OR customer_phone ~ '^0796[123][0-9]{5}$'
            OR promotion_code_id IN (SELECT id FROM public.promotion_codes WHERE code LIKE 'P34%')),'[]'),
        'promotions',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.promotion_codes t
          WHERE code LIKE 'P34%'),'[]'),
        'balances',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY warehouse_id,product_id)
          FROM public.inventory_balances t WHERE product_id IN ('${SKU_A}','${SKU_B}','${OTHER}')),'[]'),
        'movements',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.inventory_movements t
          WHERE product_id IN ('${SKU_A}','${SKU_B}','${OTHER}') OR reference_id IN (SELECT id FROM target_orders)),'[]'),
        'payments',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.customer_payments t
          WHERE customer_id IN (SELECT id FROM customers)),'[]'),
        'shiftState',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.cash_shifts t
          WHERE id='${SHIFT}' OR id IN (SELECT cash_shift_id FROM target_orders)),'[]'),
        'history',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.order_status_history t
          WHERE order_id IN (SELECT id FROM target_orders)),'[]'),
        'counts',jsonb_build_object(
          'customers',(SELECT COUNT(*) FROM public.customers),
          'addresses',(SELECT COUNT(*) FROM public.customer_addresses),
          'orders',(SELECT COUNT(*) FROM public.orders),
          'items',(SELECT COUNT(*) FROM public.order_items),
          'instances',(SELECT COUNT(*) FROM public.order_parcel_instances),
          'components',(SELECT COUNT(*) FROM public.order_parcel_components),
          'reservations',(SELECT COUNT(*) FROM public.order_inventory_reservations),
          'operations',(SELECT COUNT(*) FROM public.business_operations),
          'redemptions',(SELECT COUNT(*) FROM public.promotion_redemptions),
          'movements',(SELECT COUNT(*) FROM public.inventory_movements),
          'payments',(SELECT COUNT(*) FROM public.customer_payments)
        )
      );`);
    const rejectPreviewUnchanged = async (lines, expected, code = null, phone = null) => {
      const before = await state();
      await expectSqlFailure(previewSql(lines, code, phone), expected);
      assert.deepEqual(await state(), before);
    };

    const baseLines = [{
      commercial_line_kind: 'base_unit', product_id: OTHER, base_quantity: 3,
      expected_unit_price_in_minor_units: 100,
    }];
    const legacyLines = [{
      commercial_line_kind: 'legacy_single_sku_parcel', product_id: OTHER,
      parcel_quantity: 2, units_per_parcel: 5,
      expected_unit_price_in_minor_units: 430,
    }];
    const configurableLines = [{
      commercial_line_kind: 'configurable_parcel', family_product_id: FAMILY,
      parcel_configuration_id: CONFIG, configuration_revision: 1,
      expected_unit_price_in_minor_units: 500,
      parcel_instances: [{components: [
        {product_id: SKU_A, base_quantity: 2},
        {product_id: SKU_B, base_quantity: 3},
      ]}],
    }];
    const mixedLines = [...baseLines, ...legacyLines, ...configurableLines];
    const multipleLines = [{
      ...configurableLines[0],
      parcel_instances: [configurableLines[0].parcel_instances[0], {components: [
        {product_id: SKU_A, base_quantity: 1},
        {product_id: SKU_B, base_quantity: 4},
      ]}],
    }];
    const positiveLines = [...baseLines, ...legacyLines, ...multipleLines];

    await runSql(`
      UPDATE public.configurable_parcel_feature_settings
      SET feature_state='ENABLED' WHERE feature_key='configurable_parcels';
      UPDATE public.product_parcel_configurations
      SET is_active=true,composition_mode='configurable_mix',configuration_revision=1
      WHERE id='${CONFIG}';
      UPDATE public.products SET
        sale_price_in_minor_units=100,
        default_sale_price_in_minor_units=430,
        units_per_sale_unit=5,
        is_active=true
      WHERE id='${OTHER}';
      UPDATE public.products SET
        default_sale_price_in_minor_units=500,
        is_active=true
      WHERE id='${FAMILY}';
      INSERT INTO public.promotion_codes(
        id,code,description_ar,discount_type,discount_value,
        minimum_subtotal_in_minor_units,maximum_discount_in_minor_units,
        maximum_total_redemptions,maximum_redemptions_per_phone,is_active,
        starts_at,expires_at
      ) VALUES
        ('93400000-0000-4000-8000-000000000001','P34PCT','خصم نسبي','percentage',3333,0,NULL,100,10,true,NULL,NULL),
        ('93400000-0000-4000-8000-000000000002','P34FIX','خصم ثابت','fixed',70,0,NULL,100,10,true,NULL,NULL),
        ('93400000-0000-4000-8000-000000000003','P34THRESH','خصم حد أدنى','fixed',100,1660,NULL,100,10,true,NULL,NULL),
        ('93400000-0000-4000-8000-000000000004','P34CAP','خصم بسقف','percentage',5000,0,100,100,10,true,NULL,NULL),
        ('93400000-0000-4000-8000-000000000005','P34OFF','خصم متوقف','fixed',50,0,NULL,100,10,false,NULL,NULL),
        ('93400000-0000-4000-8000-000000000006','P34OLD','خصم منتهي','fixed',50,0,NULL,100,10,true,NOW()-INTERVAL '2 days',NOW()-INTERVAL '1 day'),
        ('93400000-0000-4000-8000-000000000007','P34FUTURE','خصم مستقبلي','fixed',50,0,NULL,100,10,true,NOW()+INTERVAL '1 day',NOW()+INTERVAL '2 days'),
        ('93400000-0000-4000-8000-000000000008','P34LOCK','خصم تزامن','fixed',80,0,NULL,100,10,true,NULL,NULL),
        ('93400000-0000-4000-8000-000000000009','P34FULL','خصم محدود بالمجموع','fixed',400,0,NULL,100,10,true,NULL,NULL);
      INSERT INTO public.customers(id,full_name,phone,governorate,customer_type,
        is_active,is_blocked,is_deleted,created_at,updated_at) VALUES
        ('${existingCustomer}','Preview existing customer','0796100001','إربد','wholesale',
          true,false,false,'2025-01-01T00:00:00Z','2025-01-02T00:00:00Z'),
        ('${witnessCustomer}','Unrelated projection witness','0796100002','إربد','wholesale',
          true,false,false,'2025-02-01T00:00:00Z','2025-02-02T00:00:00Z');
      INSERT INTO public.customer_addresses(id,customer_id,governorate,city,area,street,
        location_source,is_default,created_at) VALUES
        ('${existingAddress}','${existingCustomer}','إربد','الرمثا','الحي الشرقي',
          'Existing preview address','manual',true,'2025-01-03T00:00:00Z');
    `);

    const functionSecurity = await readJson(`SELECT jsonb_build_object(
      'owner',pg_get_userbyid(procedure.proowner),
      'securityDefiner',procedure.prosecdef,
      'searchPath',procedure.proconfig,
      'anonExecute',has_function_privilege(
        'anon','public.preview_guest_promotion_v2(jsonb,text,text)','EXECUTE'),
      'authenticatedExecute',has_function_privilege(
        'authenticated','public.preview_guest_promotion_v2(jsonb,text,text)','EXECUTE'),
      'serviceExecute',has_function_privilege(
        'service_role','public.preview_guest_promotion_v2(jsonb,text,text)','EXECUTE'),
      'anonPromotionSelect',has_table_privilege(
        'anon','public.promotion_codes','SELECT')
    ) FROM pg_proc procedure
    WHERE procedure.oid='public.preview_guest_promotion_v2(jsonb,text,text)'::regprocedure;`);
    assert.deepEqual(functionSecurity, {
      owner: 'postgres', securityDefiner: true,
      searchPath: ['search_path=public, pg_temp'],
      anonExecute: true, authenticatedExecute: true,
      serviceExecute: false, anonPromotionSelect: false,
    });

    const untouchedBefore = await state();
    assert.equal(untouchedBefore.customers.find((row) => row.id === existingCustomer).full_name,
      'Preview existing customer');
    assert.equal(untouchedBefore.addresses.find((row) => row.id === existingAddress).is_default, true);
    // Valid, pre-existing source fixtures with distinct non-ID fields exercise
    // the real SQL projection, not a JavaScript mock of its output.
    const sourceCustomer = untouchedBefore.customers.find((row) => row.id === existingCustomer);
    const witness = untouchedBefore.customers.find((row) => row.id === witnessCustomer);
    assert.notEqual(sourceCustomer.full_name, witness.full_name);
    assert.equal(Date.parse(sourceCustomer.created_at), Date.parse('2025-01-01T00:00:00Z'));
    assert.equal(Date.parse(witness.created_at), Date.parse('2025-02-01T00:00:00Z'));
    assert.equal(Date.parse(sourceCustomer.updated_at), Date.parse('2025-01-02T00:00:00Z'));
    assert.equal(Date.parse(witness.updated_at), Date.parse('2025-02-02T00:00:00Z'));
    for (let repetition = 0; repetition < 3; repetition += 1) {
      const quote = await preview(mixedLines, 'P34PCT', '0796100001');
      assert.equal(quote.merchandiseSubtotalInMinorUnits, 1660);
      assert.equal(quote.promotionDiscountInMinorUnits, 553);
      assert.equal(quote.finalMerchandiseTotalInMinorUnits, 1107);
      assert.deepEqual(await state(), untouchedBefore);
    }

    const stockAmounts = (snapshot) => snapshot.balances.map((row) => ({
      warehouseId: row.warehouse_id, productId: row.product_id,
      onHand: row.on_hand_quantity, reserved: row.reserved_quantity,
    }));
    const cleanupVerified = async (order, label, before) => {
      await cancelCreatedCustomerOrder(order, label);
      const cleaned = await state();
      assert.equal(cleaned.orders.find((row) => row.id === order.order_id).status, 'cancelled');
      const reservations = cleaned.reservations.filter((row) => row.order_id === order.order_id);
      assert.ok(reservations.length > 0);
      assert.ok(reservations.every((row) => row.reservation_state === 'cancelled' && row.resolved_at));
      assert.deepEqual(stockAmounts(cleaned), stockAmounts(before));
      // Cancellation retains financial/audit history and redemption by contract.
      // Each matrix row has a distinct phone/key; promo limits have spare quota.
      return cleaned;
    };
    const assertOrderEvidence = (snapshot, order, scenario, quote) => {
      const rows = snapshot.orders.filter((row) => row.idempotency_key === scenario.key);
      assert.equal(rows.length, 1);
      const saved = rows[0];
      assert.equal(saved.id, order.order_id);
      assert.equal(saved.status, 'new');
      assert.equal(saved.source, 'website');
      assert.equal(saved.customer_id, order.customer_id);
      assert.equal(saved.operation_id, order.operation_id);
      assert.equal(saved.subtotal_in_minor_units, quote.merchandiseSubtotalInMinorUnits);
      assert.equal(saved.discount_in_minor_units, quote.promotionDiscountInMinorUnits);
      assert.equal(saved.total_in_minor_units - saved.delivery_fee_in_minor_units,
        quote.finalMerchandiseTotalInMinorUnits);
      assert.equal(saved.promotion_code_snapshot, scenario.promotionCode);
      const operation = snapshot.operations.find((row) => row.id === order.operation_id);
      assert.ok(operation);
      assert.equal(operation.idempotency_key, scenario.key);
      assert.equal(operation.operation_type, 'phase3_customer_reservation_v1');
      assert.equal(operation.result_snapshot.contract_version, 'phase3-customer-reservation-v2');
      const redemptions = snapshot.redemptions.filter((row) => row.order_id === order.order_id);
      assert.equal(redemptions.length, scenario.promotionCode ? 1 : 0);
      if (scenario.promotionCode) {
        const promotion = snapshot.promotions.find((row) => row.code === scenario.promotionCode);
        assert.equal(saved.promotion_code_id, promotion.id);
        assert.equal(quote.promotion.code, scenario.promotionCode);
        assert.equal(order.promotion_code, scenario.promotionCode);
        assert.equal(redemptions[0].promotion_code_id, promotion.id);
        assert.equal(redemptions[0].customer_id, order.customer_id);
        assert.equal(redemptions[0].customer_phone, scenario.phone);
        assert.equal(redemptions[0].code_snapshot, scenario.promotionCode);
        assert.equal(redemptions[0].discount_in_minor_units, quote.promotionDiscountInMinorUnits);
        assert.ok(Number.isFinite(Date.parse(redemptions[0].created_at)));
      }
      return saved;
    };

    // Real commits are the positive control for the very same SQL selectors.
    // First creates existing redemption/history; second proves Preview protects
    // populated rows and selectors also discover newly inserted children.
    let positiveBefore = untouchedBefore;
    const positiveRedemptions = [];
    for (const [index, promotionCode] of ['P34PCT', 'P34FIX'].entries()) {
      const scenario = {
        key: `93400000-0000-4000-8000-00000000090${index}`,
        phone: '0796100001', promotionCode, lines: positiveLines,
      };
      for (let repetition = 0; repetition < 2; repetition += 1) {
        await preview(scenario.lines, scenario.promotionCode, scenario.phone);
        assert.deepEqual(await state(), positiveBefore);
      }
      const quote = await preview(scenario.lines, scenario.promotionCode, scenario.phone);
      const order = await readJson(customerCall(scenario.key, scenario.lines,
        [quote.merchandiseSubtotalInMinorUnits, quote.promotionDiscountInMinorUnits,
          0, quote.finalMerchandiseTotalInMinorUnits], scenario.phone, {promotionCode}));
      const after = await state();
      assertOrderEvidence(after, order, scenario, quote);
      assert.equal(order.customer_id, existingCustomer);
      assert.equal(after.customers.length, positiveBefore.customers.length);
      assert.deepEqual(after.customers.find((row) => row.id === witnessCustomer), witness);
      const customer = after.customers.find((row) => row.id === existingCustomer);
      assert.equal(customer.full_name, 'عميل Phase 3 V2');
      assert.equal(customer.created_at, sourceCustomer.created_at);
      assert.notEqual(customer.updated_at,
        positiveBefore.customers.find((row) => row.id === existingCustomer).updated_at);
      assert.equal(after.addresses.find((row) => row.id === existingAddress).is_default, false);
      assert.equal(after.addresses.length, positiveBefore.addresses.length + 1);
      const address = after.addresses.find((row) => row.id === order.customer_address_id);
      assert.equal(address.customer_id, existingCustomer);
      assert.equal(address.street, 'شارع الاختبار');
      assert.equal(address.is_default, true);
      assert.equal(after.redemptions.length, positiveBefore.redemptions.length + 1);
      positiveRedemptions.push(after.redemptions.find((row) => row.order_id === order.order_id));
      const demand = new Map([[OTHER, 13], [SKU_A, 3], [SKU_B, 7]]);
      for (const balance of after.balances) {
        const old = positiveBefore.balances.find((row) =>
          row.product_id === balance.product_id && row.warehouse_id === balance.warehouse_id);
        const quantity = balance.warehouse_id === WAREHOUSE ? demand.get(balance.product_id) : 0;
        assert.equal(balance.on_hand_quantity, old.on_hand_quantity);
        assert.equal(balance.reserved_quantity, old.reserved_quantity + quantity);
        if (quantity) assert.notEqual(balance.updated_at, old.updated_at);
        else assert.deepEqual(balance, old);
      }
      for (const [productId, quantity] of demand) {
        const holds = after.reservations.filter((row) =>
          row.order_id === order.order_id && row.product_id === productId);
        assert.ok(holds.every((row) => row.reservation_state === 'active' &&
          row.warehouse_id === WAREHOUSE && row.operation_id === order.operation_id));
        assert.equal(holds.reduce((sum, row) => sum + row.reserved_quantity, 0), quantity);
      }
      assert.deepEqual(after.movements, positiveBefore.movements);
      assert.deepEqual(after.payments, positiveBefore.payments);
      assert.deepEqual(after.shiftState, positiveBefore.shiftState);
      const instances = after.instances.filter((row) => row.order_id === order.order_id);
      assert.equal(instances.length, 2);
      const compositions = instances.map((instance) => after.components
        .filter((row) => row.parcel_instance_id === instance.id)
        .map((row) => [row.product_id, row.base_quantity]).sort()).sort();
      assert.deepEqual(compositions, [
        [[SKU_A, 2], [SKU_B, 3]], [[SKU_A, 1], [SKU_B, 4]],
      ].sort());
      // Same counts, changed fields observed through SQL after legal checkout.
      assert.equal(after.balances.length, positiveBefore.balances.length);
      assert.notEqual(after.balances.find((row) => row.product_id === OTHER && row.warehouse_id === WAREHOUSE).reserved_quantity,
        positiveBefore.balances.find((row) => row.product_id === OTHER && row.warehouse_id === WAREHOUSE).reserved_quantity);
      positiveBefore = await cleanupVerified(order, `promotion-positive-${index}`, positiveBefore);
    }
    assert.equal(positiveRedemptions[0].discount_in_minor_units, 719);
    assert.equal(positiveRedemptions[1].discount_in_minor_units, 70);
    assert.notEqual(positiveRedemptions[0].promotion_code_id, positiveRedemptions[1].promotion_code_id);
    assert.notEqual(positiveRedemptions[0].created_at, positiveRedemptions[1].created_at);

    const cases = [
      ['base-no-promo', baseLines, null, 300, 0],
      ['base-promo', baseLines, 'P34PCT', 300, 99],
      ['legacy-no-promo', legacyLines, null, 860, 0],
      ['legacy-promo', legacyLines, 'P34PCT', 860, 286],
      ['configurable-no-promo', configurableLines, null, 500, 0],
      ['configurable-promo', configurableLines, 'P34PCT', 500, 166],
      ['mixed-no-promo', mixedLines, null, 1660, 0],
      ['mixed-promo', mixedLines, 'P34PCT', 1660, 553],
      ['capped-percentage', mixedLines, 'P34CAP', 1660, 100],
      ['fixed', mixedLines, 'P34FIX', 1660, 70],
      ['fixed-subtotal-bound', baseLines, 'P34FULL', 300, 300],
      ['threshold-exact', mixedLines, 'P34THRESH', 1660, 100],
      ['threshold-above', [{...baseLines[0], base_quantity: 4}, ...legacyLines,
        ...configurableLines], 'P34THRESH', 1760, 100],
      ['multiple-no-promo', multipleLines, null, 1000, 0],
      ['multiple-promo', multipleLines, 'P34PCT', 1000, 333],
    ];
    // Use a nonzero authoritative delivery fee: it is NOT part of the quote's
    // merchandise subtotal or discount. Restore the isolated setting afterwards.
    const settingsBefore = await readJson(`SELECT to_jsonb(t) FROM public.storefront_settings t;`);
    await runSql(`UPDATE public.storefront_settings SET inside_ramtha_delivery_fee_in_minor_units=37;`);
    const deliveryFee = await readJson(`SELECT to_jsonb(inside_ramtha_delivery_fee_in_minor_units)
      FROM public.storefront_settings;`);
    const parity = {};
    for (const [index, testCase] of cases.entries()) {
      const [label, lines, promotionCode, expectedSubtotal, expectedDiscount] = testCase;
      // One descriptor is established BEFORE both calls; no independent cart
      // builders or duplicated pricing implementation can silently diverge.
      const scenario = {
        key: `93400000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`,
        phone: `07962${String(index).padStart(5, '0')}`, lines, promotionCode,
      };
      const before = await state();
      const quote = await preview(scenario.lines, scenario.promotionCode, scenario.phone);
      assert.deepEqual(await state(), before);
      assert.equal(quote.merchandiseSubtotalInMinorUnits, expectedSubtotal);
      assert.equal(quote.promotionDiscountInMinorUnits, expectedDiscount);
      assert.equal(
        quote.finalMerchandiseTotalInMinorUnits,
        expectedSubtotal - expectedDiscount,
      );
      if (label === 'capped-percentage') {
        // Independent fixture sanity: 50% of 1660 is 830, strictly above 100.
        assert.equal(before.promotions.find((row) => row.code === promotionCode).discount_value, 5000);
        assert.ok(830 > expectedDiscount);
      }
      const order = await readJson(customerCall(
        scenario.key, scenario.lines,
        [quote.merchandiseSubtotalInMinorUnits, quote.promotionDiscountInMinorUnits,
          deliveryFee, quote.finalMerchandiseTotalInMinorUnits + deliveryFee],
        scenario.phone,
        {promotionCode: scenario.promotionCode},
      ));
      assert.equal(order.subtotal, quote.merchandiseSubtotalInMinorUnits);
      assert.equal(order.discount, quote.promotionDiscountInMinorUnits);
      assert.equal(order.delivery_fee, deliveryFee);
      assert.equal(order.total - order.delivery_fee, quote.finalMerchandiseTotalInMinorUnits);
      const committed = await state();
      const saved = assertOrderEvidence(committed, order, scenario, quote);
      assert.equal(saved.delivery_fee_in_minor_units, deliveryFee);
      if (label.startsWith('multiple-')) {
        const instances = committed.instances.filter((row) => row.order_id === order.order_id);
        assert.equal(instances.length, 2);
        assert.deepEqual(instances.map((instance) => committed.components
          .filter((row) => row.parcel_instance_id === instance.id)
          .map((row) => [row.product_id, row.base_quantity]).sort()).sort(), [
          [[SKU_A, 2], [SKU_B, 3]], [[SKU_A, 1], [SKU_B, 4]],
        ].sort());
      }
      await cleanupVerified(order, `promotion-parity-${index}`, before);
      parity[label] = true;
    }

    const below = {
      key: '93400000-0000-4000-8000-000000000199', phone: '0796300002',
      promotionCode: 'P34THRESH',
      lines: [{...baseLines[0], base_quantity: 2}, ...legacyLines, ...configurableLines],
    };
    // Prove the cart/config/customer/stock prerequisites independently: the SAME
    // request succeeds without promotion, and EXACT/ABOVE already used this rule.
    const eligible = await preview(below.lines, null, below.phone);
    assert.equal(eligible.merchandiseSubtotalInMinorUnits, 1560);
    const belowBefore = await state();
    const thresholdRule = belowBefore.promotions.find((row) => row.code === below.promotionCode);
    assert.equal(thresholdRule.minimum_subtotal_in_minor_units, 1660);
    assert.equal(thresholdRule.is_active, true);
    assert.equal(thresholdRule.starts_at, null);
    assert.equal(thresholdRule.expires_at, null);
    assert.ok(belowBefore.redemptions.filter((row) => row.promotion_code_id === thresholdRule.id).length
      < thresholdRule.maximum_total_redemptions);
    assert.equal(belowBefore.redemptions.filter((row) => row.customer_phone === below.phone).length, 0);
    const prerequisiteOrder = await readJson(customerCall(below.key, below.lines,
      [1560, 0, deliveryFee, 1560 + deliveryFee], below.phone));
    await cleanupVerified(prerequisiteOrder, 'threshold-prerequisite', belowBefore);
    below.key = '93400000-0000-4000-8000-000000000198';
    await rejectPreviewUnchanged(below.lines,
      {sqlState: 'P0001', applicationIdentity: 'PHASE3_CUSTOMER_PROMOTION_INVALID'},
      below.promotionCode, below.phone);
    const rejectionBefore = await state();
    await expectSqlFailure(
      customerCall(below.key, below.lines, [1560, 0, deliveryFee, 1560 + deliveryFee],
        below.phone, {promotionCode: below.promotionCode}),
      {sqlState: 'P0001', applicationIdentity: 'PHASE3_CUSTOMER_PROMOTION_INVALID'},
    );
    assert.deepEqual(await state(), rejectionBefore);
    parity['threshold-below'] = true;
    await runSql(`UPDATE public.storefront_settings SET inside_ramtha_delivery_fee_in_minor_units=
      ${settingsBefore.inside_ramtha_delivery_fee_in_minor_units};`);

    for (const code of ['UNKNOWN', 'P34OFF', 'P34OLD', 'P34FUTURE']) {
      await rejectPreviewUnchanged(baseLines, {
        sqlState: 'P0001', applicationIdentity: 'PHASE3_CUSTOMER_PROMOTION_INVALID',
      }, code, '0796300004');
    }
    await expectSqlFailure(previewSql([{...baseLines[0], commercial_line_kind: 'unknown'}]), {
      sqlState: 'P0001', applicationIdentity: 'PHASE3_SALE_CONTRACT_INVALID',
    });
    await expectSqlFailure(previewSql([]), {
      sqlState: 'P0001', applicationIdentity: 'PHASE3_SALE_CONTRACT_INVALID',
    });
    await expectSqlFailure(previewSql([{
      commercial_line_kind: 'base_unit', base_quantity: 1,
      expected_unit_price_in_minor_units: 100,
    }]), {
      sqlState: 'P0001', applicationIdentity: 'PHASE3_SALE_CONTRACT_INVALID',
    });
    await expectSqlFailure(previewSql([{
      ...legacyLines[0], units_per_parcel: 0,
    }]), {
      sqlState: 'P0001', applicationIdentity: 'PHASE3_SALE_CONTRACT_INVALID',
    });
    await expectSqlFailure(previewSql([{
      ...baseLines[0], base_quantity: 0,
    }]), {
      sqlState: 'P0001', applicationIdentity: 'PHASE3_SALE_CONTRACT_INVALID',
    });
    await expectSqlFailure(previewSql(Array.from(
      {length: 51},
      () => ({...baseLines[0]}),
    )), {
      sqlState: 'P0001', applicationIdentity: 'PHASE3_SALE_REQUEST_LIMIT_EXCEEDED',
    });
    await expectSqlFailure(previewSql([{
      ...configurableLines[0],
      parcel_instances: [{components: Array.from(
        {length: 201},
        () => ({product_id: SKU_A, base_quantity: 1}),
      )}],
    }]), {
      sqlState: 'P0001', applicationIdentity: 'PHASE3_SALE_REQUEST_LIMIT_EXCEEDED',
    });
    await rejectPreviewUnchanged([{
      ...configurableLines[0],
      parcel_instances: [{components: [{product_id: SKU_A, base_quantity: 4}]}],
    }], {sqlState: '23514', constraint: 'phase3_parcel_capacity_check'});
    await expectSqlFailure(previewSql([{
      ...configurableLines[0],
      parcel_instances: [{components: [
        {product_id: SKU_A, base_quantity: 3},
        {product_id: SKU_B, base_quantity: 3},
      ]}],
    }]), {sqlState: '23514', constraint: 'phase3_parcel_capacity_check'});
    await rejectPreviewUnchanged([{
      ...configurableLines[0],
      parcel_instances: [{components: [
        {product_id: SKU_A, base_quantity: 4},
        {product_id: OTHER, base_quantity: 1},
      ]}],
    }], {sqlState: '23514', constraint: 'phase3_parcel_component_family_check'});
    await rejectPreviewUnchanged([{
      ...configurableLines[0], configuration_revision: 999,
    }], {sqlState: 'P0001', applicationIdentity: 'PARCEL_CONFIGURATION_STALE'});
    await runSql(`UPDATE public.product_parcel_configurations
      SET is_active=false WHERE id='${CONFIG}';`);
    await expectSqlFailure(previewSql(configurableLines), {
      sqlState: 'P0001', applicationIdentity: 'PARCEL_CONFIGURATION_STALE',
    });
    await runSql(`UPDATE public.product_parcel_configurations
      SET is_active=true WHERE id='${CONFIG}';`);

    await runSql(`UPDATE public.configurable_parcel_feature_settings
      SET feature_state='OFF' WHERE feature_key='configurable_parcels';`);
    assert.equal((await preview(baseLines)).merchandiseSubtotalInMinorUnits, 300);
    await expectSqlFailure(previewSql(configurableLines), {
      sqlState: 'P0001', applicationIdentity: 'CONFIGURABLE_PARCEL_DISABLED',
    });
    await runSql(`UPDATE public.configurable_parcel_feature_settings
      SET feature_state='OWNER_PILOT' WHERE feature_key='configurable_parcels';`);
    await expectSqlFailure(previewSql(configurableLines), {
      sqlState: 'P0001', applicationIdentity: 'CONFIGURABLE_PARCEL_DISABLED',
    });
    await runSql(`UPDATE public.configurable_parcel_feature_settings
      SET feature_state='ENABLED' WHERE feature_key='configurable_parcels';`);

    const oldPreview = await readJson(`SET ROLE anon;
      SELECT public.preview_guest_promotion(
        'P34FIX',
        '[{"product_id":"${OTHER}","quantity":1}]'::jsonb,
        '0796300005'
      ); RESET ROLE;`);
    assert.equal(oldPreview.subtotal, 430);
    assert.equal(oldPreview.discount, 70);

    const lockPhone = '0796300006';
    const lockLines = baseLines;
    const lockHolder = await startLockHolder(
      `SELECT public.preview_guest_promotion_v2(
        $preview$${JSON.stringify(lockLines)}$preview$::jsonb,
        'P34LOCK','${lockPhone}'
      )`,
      'phase34b-preview-lock-holder',
    );
    let lockOrder;
    try {
      lockOrder = await readJson(customerCall(
        '93400000-0000-4000-8000-000000000250', lockLines,
        [300, 80, 0, 220], lockPhone, {promotionCode: 'P34LOCK'},
      ));
    } finally {
      await lockHolder.release();
    }
    assert.equal(lockOrder.success, true);
    await cancelCreatedCustomerOrder(lockOrder, 'promotion-lock');

    const stalePhone = '0796300007';
    const staleQuote = await preview(baseLines, 'P34FIX', stalePhone);
    const staleKey = '93400000-0000-4000-8000-000000000251';
    const staleBefore = await customerState(staleKey);
    await runSql(`UPDATE public.promotion_codes SET discount_value=71
      WHERE code='P34FIX';`);
    await expectSqlFailure(customerCall(
      staleKey, baseLines,
      [staleQuote.merchandiseSubtotalInMinorUnits,
        staleQuote.promotionDiscountInMinorUnits, 0,
        staleQuote.finalMerchandiseTotalInMinorUnits],
      stalePhone, {promotionCode: 'P34FIX'},
    ), {sqlState: 'P0001', applicationIdentity: 'PHASE3_CUSTOMER_QUOTE_STALE'});
    assert.deepEqual(await customerState(staleKey), staleBefore);

    await runSql(`
      UPDATE public.products SET
        sale_price_in_minor_units=900,
        default_sale_price_in_minor_units=4500,
        units_per_sale_unit=5
      WHERE id='${OTHER}';
      UPDATE public.products SET default_sale_price_in_minor_units=5000
      WHERE id='${FAMILY}';
    `);

    return {
      rpc: 'preview_guest_promotion_v2(jsonb,text,text)',
      functionSecurity,
      baseParity: parity['base-no-promo'] && parity['base-promo'],
      legacyParity: parity['legacy-no-promo'] && parity['legacy-promo'],
      configurableParity:
        parity['configurable-no-promo'] && parity['configurable-promo'],
      mixedParity: parity['mixed-no-promo'] && parity['mixed-promo'],
      differentialCases: parity,
      snapshotEvidence: {
        preExistingCustomerAddressProtected: true,
        allThreeSkusIncludingOther: true,
        populatedRepeatedPreviewZeroWrites: true,
        rejectedPreviewZeroWrites: true,
        exactCheckoutPositiveControls: positiveRedemptions.length,
        realSqlFieldSensitivity: true,
        newRowsDiscovered: true,
        cleanupVerified: true,
      },
      percentageRounding: true,
      fixedAndCapRules: true,
      thresholdRule: true,
      repeatedPreviewZeroWrites: true,
      noRedemptionOnPreview: true,
      previewDoesNotBlockCheckout: true,
      stalePreviewFinalAuthority: true,
      featureStateMatrix: true,
      oldPreviewCompatible: true,
      deliveryExcluded: true,
    };
  };

  await runSql(`UPDATE public.configurable_parcel_feature_settings
    SET feature_state='ENABLED',updated_at=NOW()
    WHERE feature_key='configurable_parcels';
    UPDATE public.storefront_settings SET orders_enabled=true,
      minimum_order_in_minor_units=0,
      inside_ramtha_delivery_fee_in_minor_units=0,
      outside_ramtha_delivery_fee_in_minor_units=0;
    UPDATE public.inventory_balances SET on_hand_quantity=100,reserved_quantity=0
    WHERE warehouse_id='${WAREHOUSE}' AND product_id IN ('${SKU_A}','${SKU_B}');`);

  // H2 corrective proof: POS with a registered Customer must serialize on the
  // Customer row before entering the shared inventory hierarchy.  The fixture
  // uses enough stock for both real RPCs and verifies committed state before
  // any cleanup in all three scheduling directions.
  const registeredFixtures = [];
  for (const [index, phone] of ['0795550197', '0795550198', '0795550199'].entries()) {
    const setupKey = `93300000-0000-4000-8000-${String(97 + index).padStart(12, '0')}`;
    const setupOrder = await readJson(customerV1Call(setupKey, phone));
    const customer = await readJson(`SELECT jsonb_build_object('id',customer_id)
      FROM public.orders WHERE id='${setupOrder.order_id}';`);
    await cancelCreatedCustomerOrder(setupOrder, `registered-h2-setup-${index + 1}`);
    registeredFixtures.push({phone, customerId: customer.id});
  }
  const registeredPosLines = JSON.stringify([{
    commercial_line_kind: 'base_unit', product_id: SKU_A,
    base_quantity: 1, price_authority: 'server_catalog',
    line_discount_in_minor_units: 0,
  }]);
  const registeredPosCall = (key, customerId, claimsSql = ownerClaimsSql) => `${claimsSql}
    SELECT public.create_pos_sale_v2(
      '${WAREHOUSE}','${BRANCH}','${customerId}',
      'Phase 3 registered customer','cash',
      $lines$${registeredPosLines}$lines$::jsonb,0,1000,'${key}'
    );`;

  // Authorization/MFA must finish before the registered-Customer lookup or
  // row lock.  Exercise existing and missing IDs with the exact centralized
  // policy, then hold a conflicting Customer lock to prove rejected callers
  // never queue behind business data.
  const noRoleUser = '92400000-0000-0000-0000-000000000099';
  const noRoleClaimsSql = `SELECT set_config(
    'request.jwt.claims',
    '{"sub":"${noRoleUser}","role":"authenticated","aal":"aal2"}',
    false
  );`;
  const ownerAal1ClaimsSql = `SELECT set_config(
    'request.jwt.claims',
    '{"sub":"${OWNER}","role":"authenticated","aal":"aal1"}',
    false
  );`;
  const missingCustomerId = '92400000-0000-0000-0000-000000009999';
  const unauthorizedMessage = 'ليس لديك صلاحية تنفيذ بيع نقطة البيع بالإصدار المحمي.';
  const mfaMessage = 'يجب تأكيد رمز المصادقة الثنائية قبل تنفيذ بيع نقطة البيع بالإصدار المحمي.';
  const authGuardMetadata = await readJson(`SELECT jsonb_build_object(
    'hasBusinessLock', pg_get_functiondef(
      'public.assert_erp_role(text[],text)'::regprocedure
    ) ~* '(FOR[[:space:]]+(UPDATE|SHARE)|pg_advisory)'
  );`);
  assert.equal(authGuardMetadata.hasBusinessLock, false);

  const unauthorizedExistingKey = 'phase3-pos-auth-existing-0001';
  const unauthorizedMissingKey = 'phase3-pos-auth-missing-0001';
  const unauthorizedExistingBefore = await saleBusinessState(unauthorizedExistingKey);
  const unauthorizedMissingBefore = await saleBusinessState(unauthorizedMissingKey);
  const authLockHolder = await startLockHolder(
    `SELECT id FROM public.customers WHERE id='${registeredFixtures[0].customerId}' FOR UPDATE`,
    'phase3-pos-preauth-customer-holder',
  );
  try {
    const startedAt = Date.now();
    const unauthorizedExistingError = await expectExactSqlFailure(
      `SET application_name='phase3-pos-preauth-unauthorized';
       SET lock_timeout='750ms';
       ${registeredPosCall(
    unauthorizedExistingKey,
    registeredFixtures[0].customerId,
    noRoleClaimsSql,
  )}`,
      {sqlState: 'P0001', messageText: unauthorizedMessage},
    );
    assert.ok(Date.now() - startedAt < 5_000, 'Unauthorized POS V2 waited on Customer data.');
    assert.doesNotMatch(unauthorizedExistingError, /PHASE3_POS_CUSTOMER_INVALID/u);
  } finally {
    await authLockHolder.release();
  }
  const unauthorizedMissingError = await expectExactSqlFailure(
    registeredPosCall(unauthorizedMissingKey, missingCustomerId, noRoleClaimsSql),
    {sqlState: 'P0001', messageText: unauthorizedMessage},
  );
  assert.doesNotMatch(unauthorizedMissingError, /PHASE3_POS_CUSTOMER_INVALID/u);
  assert.deepEqual(await saleBusinessState(unauthorizedExistingKey), unauthorizedExistingBefore);
  assert.deepEqual(await saleBusinessState(unauthorizedMissingKey), unauthorizedMissingBefore);

  await runSql(`INSERT INTO auth.mfa_factors (
    id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret
  ) VALUES (
    '92400000-0000-0000-0000-000000009998', '${OWNER}',
    'Phase 3 POS authorization ordering', 'totp', 'verified', NOW(), NOW(),
    'phase3-pos-authorization-runtime-secret'
  );`);
  const mfaExistingKey = 'phase3-pos-mfa-existing-0001'; // gitleaks:allow test fixture
  const mfaMissingKey = 'phase3-pos-mfa-missing-0001'; // gitleaks:allow test fixture
  const mfaExistingBefore = await saleBusinessState(mfaExistingKey);
  const mfaMissingBefore = await saleBusinessState(mfaMissingKey);
  const mfaLockHolder = await startLockHolder(
    `SELECT id FROM public.customers WHERE id='${registeredFixtures[0].customerId}' FOR UPDATE`,
    'phase3-pos-premfa-customer-holder',
  );
  try {
    const startedAt = Date.now();
    const mfaExistingError = await expectExactSqlFailure(
      `SET application_name='phase3-pos-preauth-mfa';
       SET lock_timeout='750ms';
       ${registeredPosCall(
    mfaExistingKey,
    registeredFixtures[0].customerId,
    ownerAal1ClaimsSql,
  )}`,
      {sqlState: 'P0001', messageText: mfaMessage},
    );
    assert.ok(Date.now() - startedAt < 5_000, 'MFA-rejected POS V2 waited on Customer data.');
    assert.doesNotMatch(mfaExistingError, /PHASE3_POS_CUSTOMER_INVALID/u);
  } finally {
    await mfaLockHolder.release();
  }
  const mfaMissingError = await expectExactSqlFailure(
    registeredPosCall(mfaMissingKey, missingCustomerId, ownerAal1ClaimsSql),
    {sqlState: 'P0001', messageText: mfaMessage},
  );
  assert.doesNotMatch(mfaMissingError, /PHASE3_POS_CUSTOMER_INVALID/u);
  assert.deepEqual(await saleBusinessState(mfaExistingKey), mfaExistingBefore);
  assert.deepEqual(await saleBusinessState(mfaMissingKey), mfaMissingBefore);
  await runSql(`DELETE FROM auth.mfa_factors
    WHERE id='92400000-0000-0000-0000-000000009998';`);
  const assertRegisteredCustomerPosState = async ({
    customerKey, posKey, beforeBalance, customerId, phone,
  }) => {
    const state = await readJson(`SELECT jsonb_build_object(
      'orders',(SELECT count(*) FROM public.orders
        WHERE idempotency_key IN ('${customerKey}','${posKey}')),
      'customerOrders',(SELECT count(*) FROM public.orders
        WHERE idempotency_key='${customerKey}' AND source='website'
          AND customer_id='${customerId}'),
      'posOrders',(SELECT count(*) FROM public.orders
        WHERE idempotency_key='${posKey}' AND source='pos' AND status='completed'
          AND customer_id='${customerId}'),
      'items',(SELECT count(*) FROM public.order_items item JOIN public.orders o
        ON o.id=item.order_id WHERE o.idempotency_key IN ('${customerKey}','${posKey}')),
      'operations',(SELECT count(*) FROM public.business_operations
        WHERE idempotency_key IN ('${customerKey}','${posKey}')),
      'reservations',(SELECT count(*) FROM public.order_inventory_reservations r
        JOIN public.orders o ON o.id=r.order_id
        WHERE o.idempotency_key='${customerKey}' AND r.reservation_state='active'),
      'reservationQuantity',(SELECT coalesce(sum(r.reserved_quantity),0) FROM
        public.order_inventory_reservations r JOIN public.orders o ON o.id=r.order_id
        WHERE o.idempotency_key='${customerKey}' AND r.reservation_state='active'),
      'orphanReservations',(SELECT count(*) FROM public.order_inventory_reservations r
        LEFT JOIN public.orders o ON o.id=r.order_id
        WHERE o.id IS NULL),
      'customerRows',(SELECT count(*) FROM public.customers
        WHERE id='${customerId}'
          AND public.normalize_customer_phone(phone)='${phone}'),
      'balance',(SELECT jsonb_build_object('onHand',on_hand_quantity,
        'reserved',reserved_quantity) FROM public.inventory_balances
        WHERE warehouse_id='${WAREHOUSE}' AND product_id='${SKU_A}')
    );`);
    assert.equal(state.orders, 2);
    assert.equal(state.customerOrders, 1);
    assert.equal(state.posOrders, 1);
    assert.equal(state.items, 2);
    assert.equal(state.operations, 2);
    assert.equal(state.reservations, 1);
    assert.equal(state.reservationQuantity, 1);
    assert.equal(state.orphanReservations, 0);
    assert.equal(state.customerRows, 1);
    assert.equal(state.balance.onHand, beforeBalance.onHand - 1);
    assert.equal(state.balance.reserved, beforeBalance.reserved + 1);
    return state;
  };
  const cleanupRegisteredCustomerPos = async (outcomes, suffix) => {
    const values = outcomes.map((entry) => entry.value);
    const customerResult = values.find(
      (value) => value?.contract_version === 'phase3-customer-reservation-v2',
    );
    const posResult = values.find((value) => value?.cashShiftId);
    assert.ok(customerResult?.order_id);
    assert.ok(posResult?.orderId);
    await cancelCreatedCustomerOrder(customerResult, `${suffix}-customer`);
    await readJson(`${ownerClaimsSql} SELECT public.reverse_pos_sale(
      '${posResult.orderId}','Phase 3 registered Customer/POS cleanup',
      'phase3-h2-${suffix}-reversal'
    );`);
  };
  const registeredDeadlocksBefore = await readJson(`SELECT jsonb_build_object(
    'value',deadlocks
  ) FROM pg_stat_database WHERE datname=current_database();`);
  const registeredSchedules = [
    {label: 'customer-first', holder: `SELECT pg_advisory_xact_lock(
      hashtextextended('inventory-product:${SKU_A}',0))`, left: 'customer', fixture: 0},
    {label: 'pos-first', holder: `SELECT pg_advisory_xact_lock(
      hashtextextended('inventory-product:${SKU_A}',0))`, left: 'pos', fixture: 1},
  ];
  let registeredSequence = 80;
  for (const schedule of registeredSchedules) {
    const fixture = registeredFixtures[schedule.fixture];
    const customerKey = `93300000-0000-4000-8000-${String(registeredSequence++).padStart(12, '0')}`;
    const posKey = `phase3-h2-${schedule.label}-pos-0001`;
    const beforeBalance = await readJson(`SELECT jsonb_build_object(
      'onHand',on_hand_quantity,'reserved',reserved_quantity
    ) FROM public.inventory_balances
    WHERE warehouse_id='${WAREHOUSE}' AND product_id='${SKU_A}';`);
    const customerSql = customerCall(
      customerKey, baseOnly, [1000, 0, 0, 1000], fixture.phone,
    );
    const posSql = registeredPosCall(posKey, fixture.customerId);
    const outcomes = await runCustomerOverlap(
      `registered-${schedule.label}`,
      schedule.left === 'customer' ? customerSql : posSql,
      schedule.left === 'customer' ? posSql : customerSql,
      schedule.holder,
      {leftQueuesFirst: true},
    );
    assert.ok(outcomes.every((entry) => entry.status === 'fulfilled'));
    await assertRegisteredCustomerPosState({
      customerKey, posKey, beforeBalance,
      customerId: fixture.customerId, phone: fixture.phone,
    });
    await cleanupRegisteredCustomerPos(outcomes, schedule.label);
  }

  const simultaneousCustomerKey = '93300000-0000-4000-8000-000000000082';
  const simultaneousPosKey = ['phase3', 'h2', 'simultaneous', 'pos', '0001'].join('-');
  const simultaneousFixture = registeredFixtures[2];
  const simultaneousBefore = await readJson(`SELECT jsonb_build_object(
    'onHand',on_hand_quantity,'reserved',reserved_quantity
  ) FROM public.inventory_balances
  WHERE warehouse_id='${WAREHOUSE}' AND product_id='${SKU_A}';`);
  const simultaneousRegistered = await Promise.allSettled([
    readJson(customerCall(
      simultaneousCustomerKey, baseOnly, [1000, 0, 0, 1000], simultaneousFixture.phone,
    )),
    readJson(registeredPosCall(simultaneousPosKey, simultaneousFixture.customerId)),
  ]);
  assert.ok(
    simultaneousRegistered.every((entry) => entry.status === 'fulfilled'),
    `Registered Customer/POS simultaneous outcomes: ${JSON.stringify(
      simultaneousRegistered.map((entry) => ({
        status: entry.status,
        error: entry.status === 'rejected' ? entry.reason.message : null,
      })),
    )}`,
  );
  await assertRegisteredCustomerPosState({
    customerKey: simultaneousCustomerKey,
    posKey: simultaneousPosKey,
    beforeBalance: simultaneousBefore,
    customerId: simultaneousFixture.customerId,
    phone: simultaneousFixture.phone,
  });
  await cleanupRegisteredCustomerPos(simultaneousRegistered, 'simultaneous');
  const registeredDeadlocksAfter = await readJson(`SELECT jsonb_build_object(
    'value',deadlocks
  ) FROM pg_stat_database WHERE datname=current_database();`);
  assert.equal(registeredDeadlocksAfter.value - registeredDeadlocksBefore.value, 0);

  // H1: the published V1 lifecycle remains compatible, while immutable V2
  // lineage prevents every legacy terminal mutation boundary from bypassing
  // reservations and one-time cost finalization.
  const legacyCompleteKey = '93300000-0000-4000-8000-000000000040';
  const legacyCompleteOrder = await readJson(customerV1Call(
    legacyCompleteKey, '0795550140',
  ));
  await runSql(`UPDATE public.orders SET status='ready'
    WHERE id='${legacyCompleteOrder.order_id}';`);
  const legacyCompleted = await readJson(`${ownerClaimsSql}
    SELECT public.complete_website_order_with_settlement(
      '${legacyCompleteOrder.order_id}','debt',0,0,NULL,
      'Phase 3 V1 lifecycle compatibility completion'
    );`);
  assert.equal(legacyCompleted.status, 'completed');

  const legacyCancelKey = '93300000-0000-4000-8000-000000000041';
  const legacyCancelOrder = await readJson(customerV1Call(
    legacyCancelKey, '0795550141',
  ));
  const legacyCancelled = await readJson(`${ownerClaimsSql}
    SELECT public.update_order_status(
      '${legacyCancelOrder.order_id}','cancelled',
      'Phase 3 V1 lifecycle compatibility cancellation'
    );`);
  assert.equal(legacyCancelled.status, 'cancelled');

  const legacyBlockedBaseKey = '93300000-0000-4000-8000-000000000042';
  const legacyBlockedBase = await readJson(customerCall(
    legacyBlockedBaseKey, baseOnly, [1000, 0, 0, 1000], '0795550142',
  ));
  await runSql(`UPDATE public.orders SET status='ready'
    WHERE id='${legacyBlockedBase.order_id}';`);
  const legacyBlockedBaseBefore = await customerState(legacyBlockedBaseKey);
  await expectSqlFailure(`${ownerClaimsSql}
    SELECT public.complete_website_order_with_settlement(
      '${legacyBlockedBase.order_id}','cash',1000,0,NULL,
      'Legacy completion must not process Customer V2 base orders'
    );`, {
    sqlState: 'P0001',
    applicationIdentity: 'PHASE3_CUSTOMER_V2_LIFECYCLE_COORDINATOR_REQUIRED',
  });
  assert.deepEqual(await customerState(legacyBlockedBaseKey), legacyBlockedBaseBefore);
  await readJson(`${ownerClaimsSql} SELECT public.cancel_customer_order_v2(
    '${legacyBlockedBase.order_id}','phase3-h1-base-cleanup-0001',
    'Cleanup after legacy completion rejection'
  );`);

  const legacyBlockedParcelKey = '93300000-0000-4000-8000-000000000043';
  const legacyBlockedParcel = await readJson(customerCall(
    legacyBlockedParcelKey, customerLines, [7000, 0, 0, 7000], '0795550143',
  ));
  await runSql(`UPDATE public.orders SET status='ready'
    WHERE id='${legacyBlockedParcel.order_id}';`);
  const legacyBlockedParcelBefore = await customerState(legacyBlockedParcelKey);
  await expectSqlFailure(`${ownerClaimsSql}
    SELECT public.update_order_status(
      '${legacyBlockedParcel.order_id}','completed',
      'Legacy status completion must not process Customer V2 parcel orders'
    );`, {
    sqlState: 'P0001',
    applicationIdentity: 'PHASE3_CUSTOMER_V2_LIFECYCLE_COORDINATOR_REQUIRED',
  });
  assert.deepEqual(await customerState(legacyBlockedParcelKey), legacyBlockedParcelBefore);
  await readJson(`${ownerClaimsSql} SELECT public.cancel_customer_order_v2(
    '${legacyBlockedParcel.order_id}','phase3-h1-parcel-cleanup-0001',
    'Cleanup after legacy parcel completion rejection'
  );`);

  const legacyBlockedCancelKey = '93300000-0000-4000-8000-000000000044';
  const legacyBlockedCancel = await readJson(customerCall(
    legacyBlockedCancelKey, baseOnly, [1000, 0, 0, 1000], '0795550144',
  ));
  const legacyBlockedCancelBefore = await customerState(legacyBlockedCancelKey);
  await expectSqlFailure(`${ownerClaimsSql}
    SELECT public.update_order_status(
      '${legacyBlockedCancel.order_id}','cancelled',
      'Legacy cancellation must not release Customer V2 reservations'
    );`, {
    sqlState: 'P0001',
    applicationIdentity: 'PHASE3_CUSTOMER_V2_LIFECYCLE_COORDINATOR_REQUIRED',
  });
  assert.deepEqual(await customerState(legacyBlockedCancelKey), legacyBlockedCancelBefore);
  await readJson(`${ownerClaimsSql} SELECT public.cancel_customer_order_v2(
    '${legacyBlockedCancel.order_id}','phase3-h1-cancel-cleanup-0001',
    'Approved V2 cancellation after legacy rejection'
  );`);

  const monitoringState = () => readJson(`SELECT jsonb_object_agg(
      check_key, jsonb_build_object('status',status,'issueCount',issue_count)
    )
    FROM public.advanced_monitoring_checks
    WHERE check_key IN (
      'integrity:orders:reservations',
      'integrity:orders:stock-deductions',
      'integrity:accounting:cogs-profit'
    );`);
  await readJson(`SELECT public.run_advanced_monitoring_checks(NOW());`);
  const monitoringBaseline = await monitoringState();

  // M1: the existing two-instance POS fixture is intentionally a rounding
  // boundary discriminator: each instance rounds to 38, so the parent is 76,
  // while rounding the aggregate exact cost once would incorrectly yield 75.
  const parcelMonitorBoundary = await readJson(`SELECT jsonb_build_object(
    'parentCogs', item.cogs_in_minor_units,
    'parentExact', item.exact_cogs_snapshot_in_minor_units,
    'instanceCogs',(SELECT SUM(instance.cogs_snapshot_in_minor_units)::BIGINT
      FROM public.order_parcel_instances instance WHERE instance.order_item_id=item.id),
    'instanceExact',(SELECT SUM(instance.exact_cogs_snapshot_in_minor_units)::NUMERIC(30,6)
      FROM public.order_parcel_instances instance WHERE instance.order_item_id=item.id),
    'componentCogs',(SELECT SUM(component.cogs_snapshot_in_minor_units)::BIGINT
      FROM public.order_parcel_components component
      JOIN public.order_parcel_instances instance ON instance.id=component.parcel_instance_id
      WHERE instance.order_item_id=item.id),
    'instanceCount',(SELECT COUNT(*) FROM public.order_parcel_instances instance
      WHERE instance.order_item_id=item.id)
  ) FROM public.order_items item
  JOIN public.orders customer_order ON customer_order.id=item.order_id
  WHERE customer_order.idempotency_key='phase3-pos-configurable-main-0001'
    AND item.commercial_line_kind='configurable_parcel';`);
  assert.equal(parcelMonitorBoundary.parentCogs, 76);
  assert.equal(parcelMonitorBoundary.instanceCogs, 76);
  assert.equal(parcelMonitorBoundary.componentCogs, 76);
  assert.equal(parcelMonitorBoundary.instanceCount, 2);
  assert.equal(monitoringBaseline['integrity:accounting:cogs-profit'].status, 'healthy');

  const halfBoundary = await readJson(`SELECT public.phase3_allocate_parcel_cogs_internal(
    '[{"product_id":"${SKU_A}","base_quantity":1,"unit_cost_in_minor_units_exact":0.500000},
      {"product_id":"${SKU_B}","base_quantity":1,"unit_cost_in_minor_units_exact":0.000000}]'::jsonb
  );`);
  assert.equal(halfBoundary.total_cogs_in_minor_units, 1);
  assert.equal(
    halfBoundary.components.reduce((sum, component) =>
      sum + component.allocated_cogs_in_minor_units, 0),
    1,
  );

  const customerMonitorKey = '93300000-0000-4000-8000-000000000063';
  await runSql(`UPDATE public.products SET
    wac_cost_in_minor_units_exact=CASE id
      WHEN '${SKU_A}' THEN 10.333333::NUMERIC(24,6)
      WHEN '${SKU_B}' THEN 5.666667::NUMERIC(24,6)
    END,
    cost_price_in_minor_units=CASE id WHEN '${SKU_A}' THEN 10 ELSE 6 END
    WHERE id IN ('${SKU_A}','${SKU_B}');`);
  const customerMonitorOrder = await readJson(customerCall(
    customerMonitorKey, multiInstanceCustomerLines,
    [10000, 0, 0, 10000], '0795550163',
  ));
  await runSql(`UPDATE public.orders SET status='ready'
    WHERE id='${customerMonitorOrder.order_id}';`);
  await readJson(`${ownerClaimsSql}
    SELECT public.complete_website_order_with_settlement_v2(
      '${customerMonitorOrder.order_id}',
      'phase3-customer-monitor-rounding-0001',
      'cash',10000,0,NULL,'Customer monitor per-instance rounding boundary'
    );`);
  const customerMonitorBoundary = await readJson(`SELECT jsonb_build_object(
    'parentCogs', item.cogs_in_minor_units,
    'parentExact', item.exact_cogs_snapshot_in_minor_units,
    'roundedAggregateExact',ROUND(item.exact_cogs_snapshot_in_minor_units,0)::BIGINT,
    'instanceCogs',(SELECT SUM(instance.cogs_snapshot_in_minor_units)::BIGINT
      FROM public.order_parcel_instances instance WHERE instance.order_item_id=item.id),
    'instanceExact',(SELECT SUM(instance.exact_cogs_snapshot_in_minor_units)::NUMERIC(30,6)
      FROM public.order_parcel_instances instance WHERE instance.order_item_id=item.id),
    'componentCogs',(SELECT SUM(component.cogs_snapshot_in_minor_units)::BIGINT
      FROM public.order_parcel_components component
      JOIN public.order_parcel_instances instance ON instance.id=component.parcel_instance_id
      WHERE instance.order_item_id=item.id)
  ) FROM public.order_items item
  JOIN public.orders customer_order ON customer_order.id=item.order_id
  WHERE customer_order.idempotency_key='${customerMonitorKey}';`);
  assert.equal(customerMonitorBoundary.parentCogs, 76);
  assert.equal(customerMonitorBoundary.roundedAggregateExact, 75);
  assert.equal(customerMonitorBoundary.instanceCogs, 76);
  assert.equal(customerMonitorBoundary.componentCogs, 76);
  await readJson(`SELECT public.run_advanced_monitoring_checks(NOW());`);
  assert.equal(
    (await monitoringState())['integrity:accounting:cogs-profit'].status,
    'healthy',
  );

  await runSql(`ALTER TABLE public.order_items DISABLE TRIGGER USER;
    UPDATE public.order_items SET cogs_in_minor_units=75,
      profit_in_minor_units=net_refundable_amount_snapshot_in_minor_units-75
    WHERE id IN (
      SELECT item.id FROM public.order_items item
      JOIN public.orders customer_order ON customer_order.id=item.order_id
      WHERE customer_order.idempotency_key='${customerMonitorKey}'
        AND item.commercial_line_kind='configurable_parcel'
    );
    ALTER TABLE public.order_items ENABLE TRIGGER USER;`);
  await readJson(`SELECT public.run_advanced_monitoring_checks(NOW());`);
  const corruptedParcelMonitor = await monitoringState();
  assert.equal(corruptedParcelMonitor['integrity:accounting:cogs-profit'].status, 'critical');
  assert.ok(corruptedParcelMonitor['integrity:accounting:cogs-profit'].issueCount >= 1);
  await runSql(`ALTER TABLE public.order_items DISABLE TRIGGER USER;
    UPDATE public.order_items SET cogs_in_minor_units=76,
      profit_in_minor_units=net_refundable_amount_snapshot_in_minor_units-76
    WHERE id IN (
      SELECT item.id FROM public.order_items item
      JOIN public.orders customer_order ON customer_order.id=item.order_id
      WHERE customer_order.idempotency_key='${customerMonitorKey}'
        AND item.commercial_line_kind='configurable_parcel'
    );
    ALTER TABLE public.order_items ENABLE TRIGGER USER;`);
  await readJson(`SELECT public.run_advanced_monitoring_checks(NOW());`);
  assert.equal(
    (await monitoringState())['integrity:accounting:cogs-profit'].status,
    'healthy',
  );

  // H2: exercise the real V1 and V2 order coordinators in both queue
  // directions, at a simultaneous start, and across the shared-resource
  // matrix.  Each phone is unique so the legacy three-orders/10-minute rule
  // cannot hide lock-order defects.
  const mixedBalanceState = () => readJson(`SELECT jsonb_object_agg(
    product_id::text,jsonb_build_object('onHand',on_hand_quantity,
      'reserved',reserved_quantity)
  ) FROM public.inventory_balances
  WHERE warehouse_id='${WAREHOUSE}' AND product_id IN ('${SKU_A}','${SKU_B}');`);
  const readMixedCommittedState = async (keys) => {
    const quotedKeys = keys.map((key) => `'${key}'`).join(',');
    return readJson(`WITH target_orders AS (
      SELECT id,idempotency_key,customer_id,source,operation_id
      FROM public.orders WHERE idempotency_key IN (${quotedKeys})
    ) SELECT jsonb_build_object(
      'orders',COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id',id,'idempotencyKey',idempotency_key,'customerId',customer_id,
        'source',source,'operationId',operation_id) ORDER BY idempotency_key)
        FROM target_orders),'[]'::jsonb),
      'items',COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id',item.id,'orderId',item.order_id,'productId',item.product_id,
        'quantity',item.quantity,'lineKind',item.commercial_line_kind,
        'salePackageQuantity',item.sale_package_quantity,
        'unitsPerSalePackage',item.units_per_sale_package)
        ORDER BY item.order_id,item.id)
        FROM public.order_items item
        WHERE item.order_id IN (SELECT id FROM target_orders)),'[]'::jsonb),
      'operations',COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id',operation.id,'idempotencyKey',operation.idempotency_key,
        'operationType',operation.operation_type) ORDER BY operation.idempotency_key)
        FROM public.business_operations operation
        WHERE operation.id IN (
          SELECT operation_id FROM target_orders WHERE operation_id IS NOT NULL
        )),'[]'::jsonb),
      'reservations',COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id',reservation.id,'orderId',reservation.order_id,
        'operationId',reservation.operation_id,'productId',reservation.product_id,
        'quantity',reservation.reserved_quantity,'state',reservation.reservation_state)
        ORDER BY reservation.order_id,reservation.id)
        FROM public.order_inventory_reservations reservation
        WHERE reservation.order_id IN (SELECT id FROM target_orders)),'[]'::jsonb),
      'customers',COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id',customer.id,'normalizedPhone',public.normalize_customer_phone(customer.phone))
        ORDER BY customer.id)
        FROM public.customers customer
        WHERE customer.id IN (SELECT customer_id FROM target_orders)),'[]'::jsonb),
      'orphanReservations',(SELECT count(*) FROM public.order_inventory_reservations reservation
        LEFT JOIN public.orders customer_order ON customer_order.id=reservation.order_id
        WHERE customer_order.id IS NULL),
      'balances',(SELECT jsonb_object_agg(product_id::text,
        jsonb_build_object('onHand',on_hand_quantity,'reserved',reserved_quantity))
        FROM public.inventory_balances WHERE warehouse_id='${WAREHOUSE}'
          AND product_id IN ('${SKU_A}','${SKU_B}'))
    );`);
  };
  const assertMixedCommittedState = async ({expectations, beforeBalances}) => {
    const state = await readMixedCommittedState(
      expectations.map((expected) => expected.idempotencyKey),
    );
    assertMixedCommittedStateSnapshot({state, expectations, beforeBalances});
  };
  const mixedFixturePhones = [
    '0795550150', '0795550151', '0795550152',
    '0795550153', '0795550154', '0795550155',
  ];
  const mixedCustomerIds = new Map();
  for (const [index, phone] of mixedFixturePhones.entries()) {
    const setupKey = `93400000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    const setupOrder = await readJson(customerV1Call(setupKey, phone));
    const customer = await readJson(`SELECT jsonb_build_object('id',customer_id)
      FROM public.orders WHERE id='${setupOrder.order_id}';`);
    mixedCustomerIds.set(phone, customer.id);
    await cancelCreatedCustomerOrder(setupOrder, `mixed-customer-setup-${index + 1}`);
  }
  const legacyUnitsPerSalePackage = 5;
  const mixedRequest = ({version, phone, productId, quantity}) => {
    const baseUnitQuantity = version === 'v1'
      ? quantity * legacyUnitsPerSalePackage
      : quantity;
    return {
      version,
      phone,
      customerId: mixedCustomerIds.get(phone),
      productId,
      commercialQuantity: quantity,
      baseUnitQuantity,
      persistedLineQuantity: baseUnitQuantity,
      salePackageQuantity: quantity,
      unitsPerSalePackage: version === 'v1' ? legacyUnitsPerSalePackage : 1,
      inventoryReservedEffect: baseUnitQuantity,
      detailedReservationQuantity: version === 'v2' ? baseUnitQuantity : 0,
      lineKind: version === 'v2' ? 'base_unit' : null,
      operationType: version === 'v2' ? 'phase3_customer_reservation_v1' : null,
    };
  };
  const mixedRequestSql = (request, key) => request.version === 'v1'
    ? customerV1Call(key, request.phone, request.commercialQuantity, request.productId)
    : customerCall(
      key,
      baseOnlyFor(request.productId, request.baseUnitQuantity),
      [request.baseUnitQuantity * 1000, 0, 0, request.baseUnitQuantity * 1000],
      request.phone,
    );
  const mixedExpectation = (request, idempotencyKey) => ({
    ...request,
    idempotencyKey,
    normalizedPhone: request.phone,
  });

  const syntheticExpectations = [
    {
      ...mixedRequest({
        version: 'v1', phone: mixedFixturePhones[0], productId: SKU_A, quantity: 2,
      }),
      idempotencyKey: 'synthetic-v1', normalizedPhone: mixedFixturePhones[0],
    },
    {
      ...mixedRequest({
        version: 'v2', phone: mixedFixturePhones[0], productId: SKU_A, quantity: 3,
      }),
      idempotencyKey: 'synthetic-v2', normalizedPhone: mixedFixturePhones[0],
    },
  ];
  const syntheticCustomerId = syntheticExpectations[0].customerId;
  const syntheticBefore = {
    [SKU_A]: {onHand: 100, reserved: 10},
    [SKU_B]: {onHand: 100, reserved: 0},
  };
  const syntheticGoodState = {
    orders: [
      {
        id: 'synthetic-order-v1', idempotencyKey: 'synthetic-v1',
        customerId: syntheticCustomerId, source: 'website', operationId: null,
      },
      {
        id: 'synthetic-order-v2', idempotencyKey: 'synthetic-v2',
        customerId: syntheticCustomerId, source: 'website', operationId: 'synthetic-operation-v2',
      },
    ],
    items: [
      {
        id: 'synthetic-item-v1', orderId: 'synthetic-order-v1', productId: SKU_A,
        quantity: 10, lineKind: null, salePackageQuantity: 2, unitsPerSalePackage: 5,
      },
      {
        id: 'synthetic-item-v2', orderId: 'synthetic-order-v2', productId: SKU_A,
        quantity: 3, lineKind: 'base_unit', salePackageQuantity: 3, unitsPerSalePackage: 1,
      },
    ],
    operations: [{
      id: 'synthetic-operation-v2', idempotencyKey: 'synthetic-v2',
      operationType: 'phase3_customer_reservation_v1',
    }],
    reservations: [{
      id: 'synthetic-reservation-v2', orderId: 'synthetic-order-v2',
      operationId: 'synthetic-operation-v2', productId: SKU_A, quantity: 3, state: 'active',
    }],
    customers: [{id: syntheticCustomerId, normalizedPhone: mixedFixturePhones[0]}],
    orphanReservations: 0,
    balances: {
      [SKU_A]: {onHand: 100, reserved: 23},
      [SKU_B]: {onHand: 100, reserved: 0},
    },
  };
  assertMixedCommittedStateSnapshot({
    state: syntheticGoodState,
    expectations: syntheticExpectations,
    beforeBalances: syntheticBefore,
  });
  const assertSyntheticCorruptionRejected = (mutate, expectedMessage) => {
    const corrupted = structuredClone(syntheticGoodState);
    mutate(corrupted);
    assert.throws(
      () => assertMixedCommittedStateSnapshot({
        state: corrupted,
        expectations: syntheticExpectations,
        beforeBalances: syntheticBefore,
      }),
      expectedMessage,
    );
  };
  assertSyntheticCorruptionRejected(
    (state) => { state.items[1].quantity = 6; },
    /Persisted line quantity mismatch/u,
  );
  assertSyntheticCorruptionRejected(
    (state) => { state.orders[1].customerId = 'synthetic-wrong-customer'; },
    /Customer linkage mismatch/u,
  );
  assertSyntheticCorruptionRejected(
    (state) => { state.items[1].productId = SKU_B; },
    /Product linkage mismatch/u,
  );
  assertSyntheticCorruptionRejected(
    (state) => { state.balances[SKU_A].reserved = 14; },
    /Aggregate reserved quantity mismatch/u,
  );
  assertSyntheticCorruptionRejected(
    (state) => { state.reservations[0].orderId = 'synthetic-order-v1'; },
    /V1 Order unexpectedly has a Phase-3 reservation/u,
  );

  const mixedVersionScenarios = [
    {
      label: 'v1-first-same-phone-sku', phone: mixedFixturePhones[0],
      left: mixedRequest({
        version: 'v1', phone: mixedFixturePhones[0], productId: SKU_A, quantity: 2,
      }),
      right: mixedRequest({
        version: 'v2', phone: mixedFixturePhones[0], productId: SKU_A, quantity: 3,
      }),
    },
    {
      label: 'v2-first-same-phone-sku', phone: mixedFixturePhones[1],
      left: mixedRequest({
        version: 'v2', phone: mixedFixturePhones[1], productId: SKU_A, quantity: 3,
      }),
      right: mixedRequest({
        version: 'v1', phone: mixedFixturePhones[1], productId: SKU_A, quantity: 2,
      }),
    },
    {
      label: 'same-phone-different-sku', phone: mixedFixturePhones[2],
      left: mixedRequest({
        version: 'v1', phone: mixedFixturePhones[2], productId: SKU_A, quantity: 2,
      }),
      right: mixedRequest({
        version: 'v2', phone: mixedFixturePhones[2], productId: SKU_B, quantity: 3,
      }),
    },
  ];
  let mixedSequence = 50;
  for (const scenario of mixedVersionScenarios) {
    const leftKey = `93300000-0000-4000-8000-${String(mixedSequence++).padStart(12, '0')}`;
    const rightKey = `93300000-0000-4000-8000-${String(mixedSequence++).padStart(12, '0')}`;
    const expectations = [
      mixedExpectation(scenario.left, leftKey),
      mixedExpectation(scenario.right, rightKey),
    ];
    const beforeBalances = await mixedBalanceState();
    const mixed = await runCustomerOverlap(
      scenario.label,
      mixedRequestSql(scenario.left, leftKey),
      mixedRequestSql(scenario.right, rightKey),
      `SELECT pg_advisory_xact_lock(hashtext('${scenario.phone}')::BIGINT)`,
      {leftQueuesFirst: true},
    );
    assert.ok(mixed.every((entry) => entry.status === 'fulfilled'));
    await assertMixedCommittedState({expectations, beforeBalances});
    await cancelCreatedCustomerOrder(mixed[0].value, `${scenario.label}-left`);
    await cancelCreatedCustomerOrder(mixed[1].value, `${scenario.label}-right`);
  }

  const simultaneousV1Key = '93300000-0000-4000-8000-000000000056';
  const simultaneousV2Key = '93300000-0000-4000-8000-000000000057';
  const simultaneousV1Request = mixedRequest({
    version: 'v1', phone: mixedFixturePhones[3], productId: SKU_A, quantity: 2,
  });
  const simultaneousV2Request = mixedRequest({
    version: 'v2', phone: mixedFixturePhones[3], productId: SKU_A, quantity: 3,
  });
  const simultaneousMixedBefore = await mixedBalanceState();
  const simultaneousMixed = await Promise.allSettled([
    readJson(mixedRequestSql(simultaneousV1Request, simultaneousV1Key)),
    readJson(mixedRequestSql(simultaneousV2Request, simultaneousV2Key)),
  ]);
  assert.ok(simultaneousMixed.every((entry) => entry.status === 'fulfilled'));
  await assertMixedCommittedState({
    expectations: [
      mixedExpectation(simultaneousV1Request, simultaneousV1Key),
      mixedExpectation(simultaneousV2Request, simultaneousV2Key),
    ],
    beforeBalances: simultaneousMixedBefore,
  });
  await cancelCreatedCustomerOrder(simultaneousMixed[0].value, 'simultaneous-v1');
  await cancelCreatedCustomerOrder(simultaneousMixed[1].value, 'simultaneous-v2');

  const differentCustomerV1Key = '93300000-0000-4000-8000-000000000058';
  const differentCustomerV2Key = '93300000-0000-4000-8000-000000000059';
  const differentCustomerV1Request = mixedRequest({
    version: 'v1', phone: mixedFixturePhones[4], productId: SKU_A, quantity: 2,
  });
  const differentCustomerV2Request = mixedRequest({
    version: 'v2', phone: mixedFixturePhones[5], productId: SKU_A, quantity: 3,
  });
  const differentCustomersBefore = await mixedBalanceState();
  const differentCustomersSameSku = await runCustomerOverlap(
    'different-customer-same-sku',
    mixedRequestSql(differentCustomerV1Request, differentCustomerV1Key),
    mixedRequestSql(differentCustomerV2Request, differentCustomerV2Key),
    `SELECT 1 FROM public.inventory_balances
      WHERE warehouse_id='${WAREHOUSE}' AND product_id='${SKU_A}' FOR UPDATE`,
  );
  assert.ok(differentCustomersSameSku.every((entry) => entry.status === 'fulfilled'));
  await assertMixedCommittedState({
    expectations: [
      mixedExpectation(differentCustomerV1Request, differentCustomerV1Key),
      mixedExpectation(differentCustomerV2Request, differentCustomerV2Key),
    ],
    beforeBalances: differentCustomersBefore,
  });
  await cancelCreatedCustomerOrder(differentCustomersSameSku[0].value, 'different-customer-v1');
  await cancelCreatedCustomerOrder(differentCustomersSameSku[1].value, 'different-customer-v2');

  const v1WinsKey = '93300000-0000-4000-8000-000000000060';
  const v1Winner = await readJson(customerV1Call(v1WinsKey, '0795550156'));
  const v1WinnerState = await customerState(v1WinsKey);
  await expectSqlFailure(customerCall(
    v1WinsKey, baseOnly, [1000, 0, 0, 1000], '0795550156',
  ), {sqlState: 'P0001', applicationIdentity: 'PHASE3_IDEMPOTENCY_CONFLICT'});
  assert.deepEqual(await customerState(v1WinsKey), v1WinnerState);
  await cancelCreatedCustomerOrder(v1Winner, 'v1-wins');

  const v2WinsKey = '93300000-0000-4000-8000-000000000061';
  const v2Winner = await readJson(customerCall(
    v2WinsKey, baseOnly, [1000, 0, 0, 1000], '0795550157',
  ));
  const v2WinnerState = await customerState(v2WinsKey);
  await expectSqlFailure(customerV1Call(v2WinsKey, '0795550157'), {
    sqlState: 'P0001', applicationIdentity: 'PHASE3_IDEMPOTENCY_CONFLICT',
  });
  assert.deepEqual(await customerState(v2WinsKey), v2WinnerState);
  await cancelCreatedCustomerOrder(v2Winner, 'v2-wins');

  const crossVersionRaceKey = '93300000-0000-4000-8000-000000000062';
  const crossVersionRace = await Promise.allSettled([
    readJson(customerV1Call(crossVersionRaceKey, '0795550158')),
    readJson(customerCall(
      crossVersionRaceKey, baseOnly, [1000, 0, 0, 1000], '0795550158',
    )),
  ]);
  assert.equal(crossVersionRace.filter((entry) => entry.status === 'fulfilled').length, 1);
  assert.equal(crossVersionRace.filter((entry) => entry.status === 'rejected').length, 1);
  assertFailureIdentity(
    crossVersionRace.find((entry) => entry.status === 'rejected').reason.message,
    {sqlState: 'P0001', applicationIdentity: 'PHASE3_IDEMPOTENCY_CONFLICT'},
  );
  const crossVersionWinner = crossVersionRace.find((entry) => entry.status === 'fulfilled').value;
  const crossVersionRaceState = await customerState(crossVersionRaceKey);
  assert.equal(crossVersionRaceState.orders.length, 1);
  await cancelCreatedCustomerOrder(crossVersionWinner, 'same-key-race');

  // The focused compatibility and monitor fixtures above intentionally
  // commit real legacy/V2 completions. Restore the canonical stock baseline
  // only after their committed effects have been asserted, before entering
  // the pre-existing reservation suite whose oracle starts at 100/0.
  await runSql(`UPDATE public.inventory_balances
    SET on_hand_quantity=100,reserved_quantity=0,updated_at=NOW()
    WHERE warehouse_id='${WAREHOUSE}'
      AND product_id IN ('${SKU_A}','${SKU_B}');`);

  const offBaseKey = '93300000-0000-4000-8000-000000000020';
  await runSql(`UPDATE public.configurable_parcel_feature_settings
    SET feature_state='OFF', updated_at=NOW()
    WHERE feature_key='configurable_parcels';`);
  const offBaseOrder = await readJson(customerCall(
    offBaseKey, baseOnly, [1000, 0, 0, 1000], '0795550120',
  ));
  assert.equal(offBaseOrder.success, true);
  await readJson(`${ownerClaimsSql} SELECT public.cancel_customer_order_v2(
    '${offBaseOrder.order_id}','phase3-customer-off-base-cleanup-0001',
    'تنظيف اختبار Base Unit عند إيقاف الميزة'
  );`);
  const offParcelKey = '93300000-0000-4000-8000-000000000021';
  const offParcelBefore = await customerState(offParcelKey);
  await expectSqlFailure(customerCall(
    offParcelKey, customerLines, [7000, 0, 0, 7000], '0795550121',
  ), {sqlState: 'P0001', applicationIdentity: 'CONFIGURABLE_PARCEL_DISABLED'});
  assert.deepEqual(await customerState(offParcelKey), offParcelBefore);

  await runSql(`UPDATE public.configurable_parcel_feature_settings
    SET feature_state='OWNER_PILOT', updated_at=NOW()
    WHERE feature_key='configurable_parcels';`);
  const pilotParcelKey = '93300000-0000-4000-8000-000000000022';
  const pilotParcelBefore = await customerState(pilotParcelKey);
  await expectSqlFailure(customerCall(
    pilotParcelKey, customerLines, [7000, 0, 0, 7000], '0795550122',
  ), {sqlState: 'P0001', applicationIdentity: 'CONFIGURABLE_PARCEL_DISABLED'});
  assert.deepEqual(await customerState(pilotParcelKey), pilotParcelBefore);
  await runSql(`UPDATE public.configurable_parcel_feature_settings
    SET feature_state='ENABLED', updated_at=NOW()
    WHERE feature_key='configurable_parcels';`);

  const staleConfigKey = '93300000-0000-4000-8000-000000000026';
  const staleConfigLines = structuredClone(customerLines);
  staleConfigLines[1].configuration_revision = 999;
  const staleConfigBefore = await customerState(staleConfigKey);
  await expectSqlFailure(customerCall(
    staleConfigKey, staleConfigLines, [7000, 0, 0, 7000], '0795550126',
  ), {sqlState: 'P0001', applicationIdentity: 'PARCEL_CONFIGURATION_STALE'});
  assert.deepEqual(await customerState(staleConfigKey), staleConfigBefore);

  const unavailableKey = '93300000-0000-4000-8000-000000000027';
  await runSql(`UPDATE public.inventory_balances SET on_hand_quantity=2
    WHERE warehouse_id='${WAREHOUSE}' AND product_id='${SKU_B}';`);
  const unavailableBefore = await customerState(unavailableKey);
  await expectSqlFailure(customerCall(
    unavailableKey, customerLines, [7000, 0, 0, 7000], '0795550127',
  ), {sqlState: 'P0001', applicationIdentity: 'PHASE3_CUSTOMER_INSUFFICIENT_INVENTORY'});
  assert.deepEqual(await customerState(unavailableKey), unavailableBefore);
  await runSql(`UPDATE public.inventory_balances SET on_hand_quantity=100
    WHERE warehouse_id='${WAREHOUSE}' AND product_id='${SKU_B}';`);

  const promotionId = '93300000-0000-4000-8000-000000000080';
  const promotionKey = '93300000-0000-4000-8000-000000000028';
  await runSql(`INSERT INTO public.promotion_codes(
      id,code,description_ar,discount_type,discount_value,
      minimum_subtotal_in_minor_units,maximum_redemptions_per_phone,is_active
    ) VALUES (
      '${promotionId}','P3V2FIX','خصم اختبار Phase 3 V2','fixed',700,0,1,true
    );
    UPDATE public.storefront_settings
      SET inside_ramtha_delivery_fee_in_minor_units=250;`);
  const promoted = await readJson(customerCall(
    promotionKey, customerLines, [7000, 700, 250, 6550], '0795550128', {
      promotionCode: 'P3V2FIX',
    },
  ));
  assert.equal(promoted.discount, 700);
  assert.equal(promoted.delivery_fee, 250);
  assert.equal(promoted.total, 6550);
  const promotedState = await customerState(promotionKey);
  assert.equal(promotedState.orders[0].discount_in_minor_units, 700);
  assert.equal(promotedState.orders[0].delivery_fee_in_minor_units, 250);
  assert.equal(promotedState.orders[0].total_in_minor_units, 6550);
  assert.equal(promotedState.items.reduce(
    (sum, item) => sum + item.allocated_discount_snapshot_in_minor_units, 0,
  ), 700);
  assert.equal(promotedState.instances.reduce(
    (sum, instance) => sum + instance.allocated_discount_snapshot_in_minor_units, 0,
  ), promotedState.items.find(
    (item) => item.commercial_line_kind === 'configurable_parcel',
  ).allocated_discount_snapshot_in_minor_units);
  await runSql(`UPDATE public.storefront_settings
    SET inside_ramtha_delivery_fee_in_minor_units=999;`);
  const promotedReplay = await readJson(customerCall(
    promotionKey, customerLines, [7000, 700, 250, 6550], '0795550128', {
      promotionCode: 'P3V2FIX',
    },
  ));
  assert.equal(promotedReplay.order_id, promoted.order_id);
  assert.deepEqual(await customerState(promotionKey), promotedState);
  await readJson(`${ownerClaimsSql} SELECT public.cancel_customer_order_v2(
    '${promoted.order_id}','phase3-customer-promotion-cleanup-0001',
    'تنظيف اختبار الخصم والتوصيل'
  );`);
  await runSql(`UPDATE public.storefront_settings
    SET inside_ramtha_delivery_fee_in_minor_units=0;`);

  const key = '93300000-0000-4000-8000-000000000001';
  const created = await readJson(customerCall(key));
  assert.equal(created.success, true);
  const reservedState = await customerState(key);
  assert.equal(reservedState.reservations.length, 3);
  assert.ok(reservedState.reservations.every((row) => row.reservation_state === 'active'));
  assert.ok(reservedState.items.every((row) => row.cost_finalized_at === null));
  assert.ok(reservedState.components.every((row) => row.cost_finalized_at === null));
  assert.equal(reservedState.movements, null);
  assert.deepEqual(
    reservedState.balances.map((row) => [row.productId, row.onHand, row.reserved]),
    [[SKU_A, 100, 4], [SKU_B, 100, 3]],
  );
  await readJson(`SELECT public.run_advanced_monitoring_checks(NOW());`);
  const reservationMonitoring = await monitoringState();
  assert.deepEqual(reservationMonitoring, monitoringBaseline);

  const replayBefore = await customerState(key);
  const replay = await readJson(customerCall(key));
  assert.equal(replay.order_id, created.order_id);
  assert.deepEqual(await customerState(key), replayBefore);
  await expectSqlFailure(customerCall(
    key, customerLines, [7000, 0, 0, 7000], '0795550199', {
      actorPhoneHash: 'c'.repeat(64), actorSessionHash: 'd'.repeat(64),
    },
  ), {sqlState: 'P0001', applicationIdentity: 'PHASE3_IDEMPOTENCY_CONFLICT'});
  assert.deepEqual(await customerState(key), replayBefore);
  const changed = structuredClone(customerLines);
  changed[0].base_quantity = 3;
  await expectSqlFailure(customerCall(key, changed, [8000, 0, 0, 8000]), {
    sqlState: 'P0001', applicationIdentity: 'PHASE3_IDEMPOTENCY_CONFLICT',
  });
  assert.deepEqual(await customerState(key), replayBefore);

  const staleBaseline = await customerState(key);
  const staleLines = structuredClone(customerLines);
  staleLines[0].expected_unit_price_in_minor_units = 999;
  await expectSqlFailure(customerCall(
    '93300000-0000-4000-8000-000000000002', staleLines,
  ), {sqlState: 'P0001', applicationIdentity: 'PHASE3_CUSTOMER_QUOTE_STALE'});
  assert.deepEqual(await customerState(key), staleBaseline);

  await runSql(`UPDATE public.orders SET status='ready' WHERE id='${created.order_id}';`);
  const completionKey = 'phase3-customer-completion-runtime-0001';
  const completed = await readJson(`${ownerClaimsSql}
    SELECT public.complete_website_order_with_settlement_v2(
      '${created.order_id}','${completionKey}','cash',7000,0,NULL,'اختبار إكمال V2'
    );`);
  assert.equal(completed.status, 'completed');
  const completedState = await customerState(key);
  assert.ok(completedState.items.every((row) => row.cost_finalized_at !== null));
  assert.ok(completedState.components.every((row) => row.cost_finalized_at !== null));
  assert.ok(completedState.instances.every((row) => row.cost_finalized_at !== null));
  assert.ok(completedState.reservations.every((row) => row.reservation_state === 'consumed'));
  assert.equal(completedState.movements.length, 3);
  assert.deepEqual(
    completedState.balances.map((row) => [row.productId, row.onHand, row.reserved]),
    [[SKU_A, 96, 0], [SKU_B, 97, 0]],
  );
  await readJson(`SELECT public.run_advanced_monitoring_checks(NOW());`);
  const completionMonitoring = await monitoringState();
  assert.deepEqual(completionMonitoring, reservationMonitoring);
  const completedSnapshot = await customerState(key);
  const completionReplay = await readJson(`${ownerClaimsSql}
    SELECT public.complete_website_order_with_settlement_v2(
      '${created.order_id}','${completionKey}','cash',7000,0,NULL,'اختبار إكمال V2'
    );`);
  assert.equal(completionReplay.order_id, created.order_id);
  assert.deepEqual(await customerState(key), completedSnapshot);

  const cancelKey = '93300000-0000-4000-8000-000000000003';
  const cancelOrder = await readJson(customerCall(cancelKey, baseOnly, [1000, 0, 0, 1000]));
  const cancelResult = await readJson(`${ownerClaimsSql}
    SELECT public.cancel_customer_order_v2(
      '${cancelOrder.order_id}','phase3-customer-cancel-runtime-0001','إلغاء اختبار'
    );`);
  assert.equal(cancelResult.status, 'cancelled');
  const cancelledState = await customerState(cancelKey);
  assert.equal(cancelledState.reservations[0].reservation_state, 'cancelled');
  assert.equal(cancelledState.items[0].cost_finalized_at, null);
  assert.equal(cancelledState.movements, null);

  const expiryKey = '93300000-0000-4000-8000-000000000004';
  const expiryOrder = await readJson(customerCall(expiryKey, baseOnly, [1000, 0, 0, 1000]));
  await runSql(`UPDATE public.orders SET reservation_expires_at=NOW()-INTERVAL '1 minute'
    WHERE id='${expiryOrder.order_id}';`);
  const expiryResult = await readJson(`SELECT public.expire_stale_new_website_orders(100);`);
  assert.ok(expiryResult.expired_order_ids.includes(expiryOrder.order_id));
  const expiredState = await customerState(expiryKey);
  assert.equal(expiredState.orders[0].status, 'expired');
  assert.equal(expiredState.reservations[0].reservation_state, 'released');
  assert.equal(expiredState.items[0].cost_finalized_at, null);

  const poisonValidKey = '93300000-0000-4000-8000-000000000023';
  const poisonBadKey = '93300000-0000-4000-8000-000000000024';
  const baseOnlyB = baseOnlyFor(SKU_B);
  const poisonValidOrder = await readJson(customerCall(
    poisonValidKey, baseOnlyB, [1000, 0, 0, 1000], '0795550123',
  ));
  const poisonBadOrder = await readJson(customerCall(
    poisonBadKey, baseOnly, [1000, 0, 0, 1000], '0795550124',
  ));
  await runSql(`UPDATE public.orders SET reservation_expires_at=NOW()-INTERVAL '1 minute'
      WHERE id='${poisonValidOrder.order_id}';
    UPDATE public.orders SET reservation_expires_at=NOW()-INTERVAL '2 minutes'
      WHERE id='${poisonBadOrder.order_id}';
    UPDATE public.inventory_balances SET reserved_quantity=0
      WHERE warehouse_id='${WAREHOUSE}' AND product_id='${SKU_A}';`);
  const poisonExpiryResult = await readJson(
    `SELECT public.expire_stale_new_website_orders(1);`,
  );
  assert.equal(poisonExpiryResult.attempted_count, 2);
  assert.equal(poisonExpiryResult.expired_count, 1);
  assert.equal(poisonExpiryResult.scan_exhausted, false);
  assert.ok(poisonExpiryResult.expired_order_ids.includes(poisonValidOrder.order_id));
  assert.ok(poisonExpiryResult.failed_order_ids.includes(poisonBadOrder.order_id));
  assert.equal(poisonExpiryResult.failed_count, 1);
  const poisonEvidence = await readJson(`SELECT jsonb_build_object(
    'validStatus',(SELECT status FROM public.orders WHERE id='${poisonValidOrder.order_id}'),
    'badStatus',(SELECT status FROM public.orders WHERE id='${poisonBadOrder.order_id}'),
    'validReservation',(SELECT reservation_state FROM public.order_inventory_reservations
      WHERE order_id='${poisonValidOrder.order_id}'),
    'badReservation',(SELECT reservation_state FROM public.order_inventory_reservations
      WHERE order_id='${poisonBadOrder.order_id}'),
    'failureAudit',(SELECT COUNT(*) FROM public.audit_logs
      WHERE action='EXPIRE_STALE_WEBSITE_ORDER_FAILED'
        AND entity_id='${poisonBadOrder.order_id}')
  );`);
  assert.deepEqual(poisonEvidence, {
    validStatus: 'expired',
    badStatus: 'new',
    validReservation: 'released',
    badReservation: 'active',
    failureAudit: 1,
  });
  const poisonRepeated = await readJson(
    `SELECT public.expire_stale_new_website_orders(1);`,
  );
  assert.equal(poisonRepeated.attempted_count, 1);
  assert.equal(poisonRepeated.expired_count, 0);
  assert.equal(poisonRepeated.failed_count, 1);
  assert.equal(poisonRepeated.scan_exhausted, false);
  await runSql(`UPDATE public.inventory_balances SET reserved_quantity=1
    WHERE warehouse_id='${WAREHOUSE}' AND product_id='${SKU_A}';`);
  const recoveredPoison = await readJson(
    `SELECT public.phase3_expire_customer_order_v2_internal('${poisonBadOrder.order_id}');`,
  ).catch((error) => {
    throw new Error(`poison-row recovery failed: ${error.message}`);
  });
  assert.equal(recoveredPoison.status, 'expired');

  const multiPoisonOrders = [];
  for (let index = 0; index < 3; index += 1) {
    multiPoisonOrders.push(await readJson(customerCall(
      `93300000-0000-4000-8000-${String(70 + index).padStart(12, '0')}`,
      baseOnly, [1000, 0, 0, 1000], `079555017${index}`,
    )));
  }
  const multiPoisonValid = await readJson(customerCall(
    '93300000-0000-4000-8000-000000000073',
    baseOnlyB, [1000, 0, 0, 1000], '0795550173',
  ));
  await runSql(`${multiPoisonOrders.map((order, index) => `
      UPDATE public.orders SET reservation_expires_at=NOW()-INTERVAL '${4 - index} minutes'
      WHERE id='${order.order_id}';`).join('')}
    UPDATE public.orders SET reservation_expires_at=NOW()-INTERVAL '1 minute'
      WHERE id='${multiPoisonValid.order_id}';
    UPDATE public.inventory_balances SET reserved_quantity=0
      WHERE warehouse_id='${WAREHOUSE}' AND product_id='${SKU_A}';`);
  const multiPoisonResult = await readJson(
    `SELECT public.expire_stale_new_website_orders(1);`,
  );
  assert.equal(multiPoisonResult.attempted_count, 4);
  assert.equal(multiPoisonResult.expired_count, 1);
  assert.equal(multiPoisonResult.failed_count, 3);
  assert.equal(multiPoisonResult.scan_exhausted, false);
  assert.ok(multiPoisonResult.expired_order_ids.includes(multiPoisonValid.order_id));
  assert.deepEqual(
    [...multiPoisonResult.failed_order_ids].sort(),
    multiPoisonOrders.map((order) => order.order_id).sort(),
  );
  const multiPoisonEvidence = await readJson(`SELECT jsonb_build_object(
    'badStatuses',(SELECT jsonb_agg(status ORDER BY id) FROM public.orders
      WHERE id IN (${multiPoisonOrders.map((order) => `'${order.order_id}'`).join(',')})),
    'badReservations',(SELECT jsonb_agg(reservation_state ORDER BY order_id)
      FROM public.order_inventory_reservations
      WHERE order_id IN (${multiPoisonOrders.map((order) => `'${order.order_id}'`).join(',')})),
    'validStatus',(SELECT status FROM public.orders WHERE id='${multiPoisonValid.order_id}'),
    'validReservation',(SELECT reservation_state FROM public.order_inventory_reservations
      WHERE order_id='${multiPoisonValid.order_id}'),
    'failureAudits',(SELECT COUNT(*) FROM public.audit_logs
      WHERE action='EXPIRE_STALE_WEBSITE_ORDER_FAILED'
        AND entity_id IN (${multiPoisonOrders.map((order) => `'${order.order_id}'`).join(',')})),
    'minimumReserved',(SELECT MIN(reserved_quantity) FROM public.inventory_balances
      WHERE warehouse_id='${WAREHOUSE}' AND product_id IN ('${SKU_A}','${SKU_B}'))
  );`);
  assert.deepEqual(multiPoisonEvidence.badStatuses, ['new', 'new', 'new']);
  assert.deepEqual(multiPoisonEvidence.badReservations, ['active', 'active', 'active']);
  assert.equal(multiPoisonEvidence.validStatus, 'expired');
  assert.equal(multiPoisonEvidence.validReservation, 'released');
  assert.equal(multiPoisonEvidence.failureAudits, 3);
  assert.ok(multiPoisonEvidence.minimumReserved >= 0);
  const repeatedMultiPoison = await readJson(
    `SELECT public.expire_stale_new_website_orders(1);`,
  );
  assert.equal(repeatedMultiPoison.attempted_count, 3);
  assert.equal(repeatedMultiPoison.expired_count, 0);
  assert.equal(repeatedMultiPoison.failed_count, 3);
  assert.equal(repeatedMultiPoison.scan_exhausted, false);
  await runSql(`UPDATE public.inventory_balances SET reserved_quantity=3
    WHERE warehouse_id='${WAREHOUSE}' AND product_id='${SKU_A}';`);
  for (const order of multiPoisonOrders) {
    const recovered = await readJson(
      `SELECT public.phase3_expire_customer_order_v2_internal('${order.order_id}');`,
    );
    assert.equal(recovered.status, 'expired');
  }

  const validBeforePoison = await readJson(customerCall(
    '93300000-0000-4000-8000-000000000074',
    baseOnlyB, [1000, 0, 0, 1000], '0795550174',
  ));
  const poisonAfterValid = await readJson(customerCall(
    '93300000-0000-4000-8000-000000000075',
    baseOnly, [1000, 0, 0, 1000], '0795550175',
  ));
  await runSql(`UPDATE public.orders SET reservation_expires_at=NOW()-INTERVAL '2 minutes'
      WHERE id='${validBeforePoison.order_id}';
    UPDATE public.orders SET reservation_expires_at=NOW()-INTERVAL '1 minute'
      WHERE id='${poisonAfterValid.order_id}';
    UPDATE public.inventory_balances SET reserved_quantity=0
      WHERE warehouse_id='${WAREHOUSE}' AND product_id='${SKU_A}';`);
  const validBeforePoisonResult = await readJson(
    `SELECT public.expire_stale_new_website_orders(1);`,
  );
  assert.deepEqual(validBeforePoisonResult.expired_order_ids, [validBeforePoison.order_id]);
  assert.equal(validBeforePoisonResult.failed_count, 0);
  const poisonAfterValidResult = await readJson(
    `SELECT public.expire_stale_new_website_orders(1);`,
  );
  assert.deepEqual(poisonAfterValidResult.failed_order_ids, [poisonAfterValid.order_id]);
  assert.equal(poisonAfterValidResult.expired_count, 0);
  await runSql(`UPDATE public.inventory_balances SET reserved_quantity=1
    WHERE warehouse_id='${WAREHOUSE}' AND product_id='${SKU_A}';`);
  await readJson(`SELECT public.phase3_expire_customer_order_v2_internal(
    '${poisonAfterValid.order_id}'
  );`);

  const cliqKey = '93300000-0000-4000-8000-000000000005';
  const beforeCliqSettlement = stableFinancialReadState(await financialReadState());
  const cliqOrder = await readJson(customerCall(
    cliqKey, baseOnly, [1000, 0, 0, 1000], '0795550102',
  ));
  await runSql(`UPDATE public.orders SET status='ready' WHERE id='${cliqOrder.order_id}';`);
  const cliqCompletion = await readJson(`${ownerClaimsSql}
    SELECT public.complete_website_order_with_settlement_v2(
      '${cliqOrder.order_id}','phase3-customer-completion-runtime-cliq-0001',
      'cliq',1000,0,'CLIQ-PHASE3-RUNTIME','اختبار إكمال CliQ V2'
    );`);
  assert.equal(cliqCompletion.payment_method, 'cliq');
  assert.equal(cliqCompletion.payment_status, 'paid');
  const afterCliqSettlement = stableFinancialReadState(await financialReadState());
  assert.equal(
    numericDelta(afterCliqSettlement, beforeCliqSettlement, ['report', 'sales', 'grossSalesInMinorUnits']),
    1000,
  );
  assert.equal(
    numericDelta(afterCliqSettlement, beforeCliqSettlement, ['shift', 'cliqSalesInMinorUnits']),
    1000,
  );
  assert.equal(afterCliqSettlement.customerPaymentCount, beforeCliqSettlement.customerPaymentCount);

  const deadlocksBefore = await readJson(`SELECT jsonb_build_object('value',deadlocks)
    FROM pg_stat_database WHERE datname=current_database();`);

  await runSql(`UPDATE public.inventory_balances SET on_hand_quantity=1,reserved_quantity=0
    WHERE warehouse_id='${WAREHOUSE}' AND product_id='${SKU_A}';`);
  const reservationHolder = await startLockHolder(
    `SELECT pg_advisory_xact_lock(hashtextextended('inventory-product:${SKU_A}',0))`,
    'phase3-customer-reservation-holder',
  );
  const reservationRaceA = readJson(`SET application_name='phase3-customer-reservation-race-a';
    ${customerCall(
      '93300000-0000-4000-8000-000000000006', baseOnly,
      [1000, 0, 0, 1000], '0795550103',
    )}`);
  const reservationRaceB = readJson(`SET application_name='phase3-customer-reservation-race-b';
    ${customerCall(
      '93300000-0000-4000-8000-000000000007', baseOnly,
      [1000, 0, 0, 1000], '0795550104',
    )}`);
  await waitForBlockedApplications([
    'phase3-customer-reservation-race-a',
    'phase3-customer-reservation-race-b',
  ]);
  await reservationHolder.release();
  const reservationRace = await Promise.allSettled([reservationRaceA, reservationRaceB]);
  assert.equal(reservationRace.filter((entry) => entry.status === 'fulfilled').length, 1);
  assert.equal(reservationRace.filter((entry) => entry.status === 'rejected').length, 1);
  const reservationLoser = reservationRace.find((entry) => entry.status === 'rejected');
  assertFailureIdentity(reservationLoser.reason.message, {
    sqlState: 'P0001', applicationIdentity: 'PHASE3_CUSTOMER_INSUFFICIENT_INVENTORY',
  });
  const reservationWinner = reservationRace.find((entry) => entry.status === 'fulfilled').value;
  await readJson(`${ownerClaimsSql} SELECT public.cancel_customer_order_v2(
    '${reservationWinner.order_id}','phase3-customer-race-cleanup-0001','تنظيف fixture'
  );`);

  await runSql(`UPDATE public.inventory_balances SET on_hand_quantity=100,reserved_quantity=0
    WHERE warehouse_id='${WAREHOUSE}' AND product_id='${SKU_A}';`);
  const lifecycleOrder = await readJson(customerCall(
    '93300000-0000-4000-8000-000000000008', baseOnly,
    [1000, 0, 0, 1000], '0795550105',
  ));
  await runSql(`UPDATE public.orders SET status='ready' WHERE id='${lifecycleOrder.order_id}';`);
  const lifecycleHolder = await startLockHolder(
    `SELECT id FROM public.orders WHERE id='${lifecycleOrder.order_id}' FOR UPDATE`,
    'phase3-customer-lifecycle-holder',
  );
  const completionRace = readJson(`SET application_name='phase3-customer-complete-race';
    ${ownerClaimsSql} SELECT public.complete_website_order_with_settlement_v2(
      '${lifecycleOrder.order_id}','phase3-customer-race-complete-0001',
      'cash',1000,0,NULL,'سباق إكمال وإلغاء'
    );`);
  const cancellationRace = readJson(`SET application_name='phase3-customer-cancel-race';
    ${ownerClaimsSql} SELECT public.cancel_customer_order_v2(
      '${lifecycleOrder.order_id}','phase3-customer-race-cancel-0001','سباق إكمال وإلغاء'
    );`);
  const lifecycleResults = Promise.allSettled([completionRace, cancellationRace]);
  await waitForBlockedApplications([
    'phase3-customer-complete-race', 'phase3-customer-cancel-race',
  ]);
  await lifecycleHolder.release();
  const lifecycleRace = await lifecycleResults;
  assert.equal(lifecycleRace.filter((entry) => entry.status === 'fulfilled').length, 1);
  assert.equal(lifecycleRace.filter((entry) => entry.status === 'rejected').length, 1);
  const lifecycleLoser = lifecycleRace.find((entry) => entry.status === 'rejected');
  assertFailureIdentity(lifecycleLoser.reason.message, {
    sqlState: 'P0001', applicationIdentity: 'PHASE3_CUSTOMER_LIFECYCLE_INVALID',
  });
  const lifecycleState = await customerState('93300000-0000-4000-8000-000000000008');
  assert.ok(['completed', 'cancelled'].includes(lifecycleState.orders[0].status));
  assert.ok(lifecycleState.reservations.every((row) => row.reservation_state !== 'active'));

  await runSql(`UPDATE public.inventory_balances SET on_hand_quantity=100,reserved_quantity=0
    WHERE warehouse_id='${WAREHOUSE}' AND product_id='${SKU_A}';`);
  const expiryRaceOrder = await readJson(customerCall(
    '93300000-0000-4000-8000-000000000009', baseOnly,
    [1000, 0, 0, 1000], '0795550106',
  ));
  await runSql(`UPDATE public.orders SET reservation_expires_at=NOW()-INTERVAL '1 minute'
    WHERE id='${expiryRaceOrder.order_id}';`);
  const expiryHolder = await startLockHolder(
    `SELECT id FROM public.orders WHERE id='${expiryRaceOrder.order_id}' FOR UPDATE`,
    'phase3-customer-expiry-race-holder',
  );
  const cancelVsExpiry = readJson(`SET application_name='phase3-customer-cancel-vs-expiry';
    ${ownerClaimsSql} SELECT public.cancel_customer_order_v2(
      '${expiryRaceOrder.order_id}','phase3-customer-race-cancel-expiry-0001','سباق إلغاء وانتهاء'
    );`);
  const expiryVsCancel = readJson(`SET application_name='phase3-customer-expiry-vs-cancel';
    SELECT public.phase3_expire_customer_order_v2_internal('${expiryRaceOrder.order_id}');`)
    .catch((error) => Promise.reject(new Error(
      `cancellation-vs-expiry contender failed: ${error.message}`,
    )));
  const cancelExpiryResults = Promise.allSettled([cancelVsExpiry, expiryVsCancel]);
  await waitForBlockedApplications([
    'phase3-customer-cancel-vs-expiry', 'phase3-customer-expiry-vs-cancel',
  ]);
  await expiryHolder.release();
  const cancelExpiryRace = await cancelExpiryResults;
  assert.equal(cancelExpiryRace.filter((entry) => entry.status === 'fulfilled').length, 1);
  assert.equal(cancelExpiryRace.filter((entry) => entry.status === 'rejected').length, 1);
  const cancelWon = cancelExpiryRace[0].status === 'fulfilled';
  const cancelExpiryLoser = cancelExpiryRace.find((entry) => entry.status === 'rejected');
  assertFailureIdentity(cancelExpiryLoser.reason.message, {
    sqlState: 'P0001',
    applicationIdentity: cancelWon
      ? 'PHASE3_CUSTOMER_LIFECYCLE_INVALID'
      : 'PHASE3_CUSTOMER_RESERVATION_TERMINAL',
  });
  const expiryRaceState = await customerState('93300000-0000-4000-8000-000000000009');
  assert.ok(['cancelled', 'expired'].includes(expiryRaceState.orders[0].status));
  assert.ok(expiryRaceState.reservations.every((row) => row.reservation_state !== 'active'));

  const completionExpiryEvidence = [];
  for (const initialStatus of ['ready', 'new', 'out_for_delivery']) {
    for (const queueOrder of ['completion-first', 'expiry-first', 'simultaneous']) {
      const iteration = completionExpiryEvidence.length;
      const key = `93550000-0000-4000-8000-${String(iteration + 1).padStart(12, '0')}`;
      const order = await readJson(customerCall(
        key, baseOnly, [1000, 0, 0, 1000], `07955801${String(iteration).padStart(2, '0')}`,
      ));
      await runSql(`UPDATE public.orders SET status='${initialStatus}',
        reservation_expires_at=NOW()-INTERVAL '1 minute' WHERE id='${order.order_id}';`);
      const snapshot = () => readJson(`SELECT jsonb_build_object(
        'status',o.status,'finalized',o.cost_finalized_at IS NOT NULL,
        'paymentStatus',o.payment_status,
        'itemFinalized',i.cost_finalized_at IS NOT NULL,
        'cogs',i.cogs_in_minor_units,'profit',i.profit_in_minor_units,
        'revenue',CASE WHEN o.status='completed' THEN o.total_in_minor_units ELSE 0 END,
        'onHand',b.on_hand_quantity,'reserved',b.reserved_quantity,
        'cost',p.wac_cost_in_minor_units_exact::TEXT,
        'reservationCount',(SELECT COUNT(*) FROM public.order_inventory_reservations WHERE order_id=o.id),
        'reservationState',(SELECT reservation_state FROM public.order_inventory_reservations WHERE order_id=o.id),
        'movementCount',(SELECT COUNT(*) FROM public.inventory_movements WHERE reference_id=o.id),
        'movementQuantity',(SELECT COALESCE(SUM(quantity),0) FROM public.inventory_movements WHERE reference_id=o.id),
        'lifecycleOperations',(SELECT COUNT(*) FROM public.business_operations WHERE request_identity_snapshot->>'order_id'=o.id::TEXT),
        'completions',(SELECT COUNT(*) FROM public.business_operations WHERE request_identity_snapshot->>'order_id'=o.id::TEXT AND operation_type='phase3_customer_completion_v1'),
        'expiries',(SELECT COUNT(*) FROM public.business_operations WHERE request_identity_snapshot->>'order_id'=o.id::TEXT AND operation_type='phase3_customer_expiry_v1'),
        'terminalHistory',(SELECT COUNT(*) FROM public.order_status_history WHERE order_id=o.id AND new_status IN ('completed','expired','cancelled')),
        'paymentRows',(SELECT COUNT(*) FROM public.customer_payments WHERE order_id=o.id)
      ) FROM public.orders o JOIN public.order_items i ON i.order_id=o.id
        JOIN public.inventory_balances b ON b.warehouse_id=o.warehouse_id AND b.product_id=i.product_id
        JOIN public.products p ON p.id=i.product_id WHERE o.id='${order.order_id}';`);
      const before = await snapshot();
      const completionSql = `${ownerClaimsSql} SELECT public.complete_website_order_with_settlement_v2(
        '${order.order_id}','${key}-complete','cash',1000,0,NULL,'Harness race');`;
      const expirySql = `SELECT public.phase3_expire_customer_order_v2_internal('${order.order_id}');`;
      const apps = [`p3-complete-${iteration}`, `p3-expire-${iteration}`];
      const holder = await startLockHolder(
        `SELECT id FROM public.orders WHERE id='${order.order_id}' FOR UPDATE`,
        `p3-race-holder-${iteration}`,
      );
      const contenders = [];
      try {
        const first = queueOrder === 'expiry-first' ? 1 : 0;
        const start = (index) => observeOutcome(readJson(
          `SET application_name='${apps[index]}'; ${index === 0 ? completionSql : expirySql}`,
        ));
        contenders[first] = start(first);
        if (queueOrder !== 'simultaneous') await waitForBlockedApplications([apps[first]]);
        contenders[1-first] = start(1-first);
        await waitForBlockedApplications(apps);
      } finally {
        await holder.release();
      }
      const results = await Promise.all(contenders);
      const after = await snapshot();
      const scaledCost = BigInt(before.cost.replace('.', ''));
      const cogs = Number((scaledCost + 500000n) / 1000000n);
      assertLifecycleRace({results, initialStatus, before, after, cogs});
      const committed = await customerState(key);
      const winnerSql = initialStatus === 'new' ? expirySql : completionSql;
      const loserSql = initialStatus === 'new' ? completionSql : expirySql;
      const replay = await readJson(winnerSql);
      assert.deepEqual(replay, results[initialStatus === 'new' ? 1 : 0].value);
      await expectSqlFailure(loserSql, {
        sqlState: 'P0001', applicationIdentity: 'PHASE3_CUSTOMER_LIFECYCLE_INVALID',
      });
      assert.deepEqual(await customerState(key), committed);
      assert.deepEqual(await snapshot(), after);
      completionExpiryEvidence.push({initialStatus, queueOrder, winner: after.status,
        oneTerminalEffect: true, immutableReplay: true});
    }
  }

  const posV2BaseRequest = JSON.stringify([{
    commercial_line_kind: 'base_unit',
    product_id: SKU_A,
    base_quantity: 1,
    price_authority: 'server_catalog',
    line_discount_in_minor_units: 0,
  }]);
  const receiptBaseLines = JSON.stringify([{
    client_line_id: '93300000-0000-4000-8000-000000000090',
    purchase_order_item_id: null,
    line_kind: 'base_unit',
    family_product_id: null,
    parcel_configuration_id: null,
    configuration_revision: null,
    commercial_quantity: 1,
    units_per_parcel: null,
    base_unit_name: 'باكيت',
    parcel_unit_name: null,
    gross_amount_in_minor_units: 100,
    line_discount_in_minor_units: 0,
    components: [{
      product_id: SKU_A,
      base_quantity: 1,
      explicit_merchandise_cost_in_minor_units: 100,
    }],
  }]);

  await runSql(`UPDATE public.inventory_balances SET on_hand_quantity=100,reserved_quantity=0
    WHERE warehouse_id='${WAREHOUSE}' AND product_id='${SKU_A}';`);
  const reservationPosV2Key = '93300000-0000-4000-8000-000000000030';
  const reservationVsPosV2 = await runCustomerOverlap(
    'reservation-pos-v2',
    customerCall(reservationPosV2Key, baseOnly, [1000, 0, 0, 1000], '0795550130'),
    `${ownerClaimsSql} SELECT public.create_pos_sale_v2(
      '${WAREHOUSE}','${BRANCH}',NULL,'Customer reservation vs POS V2','cash',
      '${posV2BaseRequest}'::jsonb,0,1000,
      'phase3-customer-vs-pos-v2-sale-0001'
    );`,
  );
  assert.ok(reservationVsPosV2.every((entry) => entry.status === 'fulfilled'));
  await readJson(`${ownerClaimsSql} SELECT public.cancel_customer_order_v2(
    '${reservationVsPosV2[0].value.order_id}',
    'phase3-customer-vs-pos-v2-cleanup-0001','تنظيف اختبار التزامن'
  );`);

  await runSql(`UPDATE public.inventory_balances SET on_hand_quantity=100,reserved_quantity=0
    WHERE warehouse_id='${WAREHOUSE}' AND product_id='${SKU_A}';`);
  const reservationPosV1Key = '93300000-0000-4000-8000-000000000031';
  const reservationVsPosV1 = await runCustomerOverlap(
    'reservation-pos-v1',
    customerCall(reservationPosV1Key, baseOnly, [1000, 0, 0, 1000], '0795550131'),
    `${ownerClaimsSql} SELECT public.create_pos_sale(
      '${WAREHOUSE}','${BRANCH}',NULL,'Customer reservation vs POS V1','cash',
      '[{"product_id":"${SKU_A}","quantity":1}]'::jsonb,
      0,5000,'phase3-customer-vs-pos-v1-sale-0001'
    );`,
    `SELECT 1 FROM public.inventory_balances
      WHERE warehouse_id='${WAREHOUSE}' AND product_id='${SKU_A}' FOR UPDATE`,
  );
  assert.ok(reservationVsPosV1.every((entry) => entry.status === 'fulfilled'));
  await readJson(`${ownerClaimsSql} SELECT public.cancel_customer_order_v2(
    '${reservationVsPosV1[0].value.order_id}',
    'phase3-customer-vs-pos-v1-cleanup-0001','تنظيف اختبار التزامن'
  );`);

  await runSql(`UPDATE public.inventory_balances SET on_hand_quantity=100,reserved_quantity=0
    WHERE warehouse_id='${WAREHOUSE}' AND product_id='${SKU_A}';`);
  const reservationReceivingKey = '93300000-0000-4000-8000-000000000032';
  const reservationVsReceiving = await runCustomerOverlap(
    'reservation-receiving',
    customerCall(
      reservationReceivingKey, baseOnly, [1000, 0, 0, 1000], '0795550132',
    ),
    `${ownerClaimsSql} SELECT public.create_direct_supplier_receipt_v2(
      p_supplier_id := '${SUPPLIER}', p_warehouse_id := '${WAREHOUSE}',
      p_branch_id := '${BRANCH}', p_supplier_invoice_number := 'P3-CUST-CONC-RCV-1',
      p_header_discount_in_minor_units := 0, p_supplier_freight_in_minor_units := 0,
      p_legacy_tax_in_minor_units := 0, p_amount_paid_at_receipt_in_minor_units := 0,
      p_payment_method := 'deferred',
      p_idempotency_key := 'phase3-customer-vs-receiving-0001',
      p_lines := '${receiptBaseLines}'::jsonb
    );`,
  );
  assert.ok(reservationVsReceiving.every((entry) => entry.status === 'fulfilled'));
  await readJson(`${ownerClaimsSql} SELECT public.cancel_customer_order_v2(
    '${reservationVsReceiving[0].value.order_id}',
    'phase3-customer-vs-receiving-cleanup-0001','تنظيف اختبار التزامن'
  );`);

  await runSql(`UPDATE public.inventory_balances SET on_hand_quantity=100,reserved_quantity=0
      WHERE warehouse_id='${WAREHOUSE}' AND product_id='${SKU_A}';
    INSERT INTO public.inventory_balances(
      warehouse_id,product_id,on_hand_quantity,reserved_quantity
    ) VALUES ('${LEGACY_WAREHOUSE_B}','${SKU_A}',0,0)
    ON CONFLICT (warehouse_id,product_id) DO UPDATE SET
      on_hand_quantity=0,reserved_quantity=0,updated_at=NOW();`);
  const reservationTransferKey = '93300000-0000-4000-8000-000000000033';
  const reservationVsTransfer = await runCustomerOverlap(
    'reservation-transfer',
    customerCall(
      reservationTransferKey, baseOnly, [1000, 0, 0, 1000], '0795550133',
    ),
    `${ownerClaimsSql} SELECT public.transfer_inventory_between_warehouses(
      '${SKU_A}','${WAREHOUSE}','${LEGACY_WAREHOUSE_B}',1,
      'Customer reservation vs transfer',NOW()
    );`,
  );
  assert.ok(reservationVsTransfer.every((entry) => entry.status === 'fulfilled'));
  await readJson(`${ownerClaimsSql} SELECT public.cancel_customer_order_v2(
    '${reservationVsTransfer[0].value.order_id}',
    'phase3-customer-vs-transfer-cleanup-0001','تنظيف اختبار التزامن'
  );`);

  await runSql(`UPDATE public.inventory_balances SET on_hand_quantity=100,reserved_quantity=0
    WHERE warehouse_id='${WAREHOUSE}' AND product_id='${SKU_A}';`);
  const reservationAdjustmentKey = '93300000-0000-4000-8000-000000000034';
  const reservationVsAdjustment = await runCustomerOverlap(
    'reservation-adjustment',
    customerCall(
      reservationAdjustmentKey, baseOnly, [1000, 0, 0, 1000], '0795550134',
    ),
    `${ownerClaimsSql} SELECT public.adjust_inventory_stock(
      '${WAREHOUSE}','${SKU_A}',99,'Customer reservation vs adjustment','stock_count'
    );`,
    `SELECT 1 FROM public.inventory_balances
      WHERE warehouse_id='${WAREHOUSE}' AND product_id='${SKU_A}' FOR UPDATE`,
  );
  assert.ok(reservationVsAdjustment.every((entry) => entry.status === 'fulfilled'));
  await readJson(`${ownerClaimsSql} SELECT public.cancel_customer_order_v2(
    '${reservationVsAdjustment[0].value.order_id}',
    'phase3-customer-vs-adjustment-cleanup-0001','تنظيف اختبار التزامن'
  );`);

  await runSql(`UPDATE public.inventory_balances SET on_hand_quantity=100,reserved_quantity=0
    WHERE warehouse_id='${WAREHOUSE}' AND product_id='${SKU_A}';`);
  const completionPosKey = '93300000-0000-4000-8000-000000000035';
  const completionPosOrder = await readJson(customerCall(
    completionPosKey, baseOnly, [1000, 0, 0, 1000], '0795550135',
  ));
  await runSql(`UPDATE public.orders SET status='ready' WHERE id='${completionPosOrder.order_id}';`);
  const completionVsPos = await runCustomerOverlap(
    'completion-pos-v2',
    `${ownerClaimsSql} SELECT public.complete_website_order_with_settlement_v2(
      '${completionPosOrder.order_id}','phase3-customer-completion-vs-pos-0001',
      'cash',1000,0,NULL,'Customer completion vs POS V2'
    );`,
    `${ownerClaimsSql} SELECT public.create_pos_sale_v2(
      '${WAREHOUSE}','${BRANCH}',NULL,'Customer completion vs POS V2','cash',
      '${posV2BaseRequest}'::jsonb,0,1000,
      'phase3-customer-completion-pos-sale-0001'
    );`,
  );
  assert.ok(completionVsPos.every((entry) => entry.status === 'fulfilled'));

  await runSql(`UPDATE public.inventory_balances SET on_hand_quantity=100,reserved_quantity=0
    WHERE warehouse_id='${WAREHOUSE}' AND product_id='${SKU_A}';`);
  const completionReceivingKey = '93300000-0000-4000-8000-000000000036';
  const completionReceivingOrder = await readJson(customerCall(
    completionReceivingKey, baseOnly, [1000, 0, 0, 1000], '0795550136',
  ));
  await runSql(`UPDATE public.orders SET status='ready'
    WHERE id='${completionReceivingOrder.order_id}';`);
  const completionVsReceiving = await runCustomerOverlap(
    'completion-receiving',
    `${ownerClaimsSql} SELECT public.complete_website_order_with_settlement_v2(
      '${completionReceivingOrder.order_id}',
      'phase3-customer-completion-vs-receiving-0001',
      'cash',1000,0,NULL,'Customer completion vs receiving'
    );`,
    `${ownerClaimsSql} SELECT public.create_direct_supplier_receipt_v2(
      p_supplier_id := '${SUPPLIER}', p_warehouse_id := '${WAREHOUSE}',
      p_branch_id := '${BRANCH}', p_supplier_invoice_number := 'P3-CUST-CONC-RCV-2',
      p_header_discount_in_minor_units := 0, p_supplier_freight_in_minor_units := 0,
      p_legacy_tax_in_minor_units := 0, p_amount_paid_at_receipt_in_minor_units := 0,
      p_payment_method := 'deferred',
      p_idempotency_key := 'phase3-customer-completion-receiving-0001',
      p_lines := '${receiptBaseLines}'::jsonb
    );`,
  );
  assert.ok(completionVsReceiving.every((entry) => entry.status === 'fulfilled'));

  await runSql(`UPDATE public.inventory_balances SET on_hand_quantity=100,reserved_quantity=0
    WHERE warehouse_id='${WAREHOUSE}' AND product_id='${SKU_A}';`);
  const reversalOriginal = await readJson(`${ownerClaimsSql}
    SELECT public.create_pos_sale_v2(
      '${WAREHOUSE}','${BRANCH}',NULL,'Original for Customer completion race','cash',
      '${posV2BaseRequest}'::jsonb,0,1000,
      'phase3-customer-completion-reversal-original-0001'
    );`);
  const completionReversalKey = '93300000-0000-4000-8000-000000000037';
  const completionReversalOrder = await readJson(customerCall(
    completionReversalKey, baseOnly, [1000, 0, 0, 1000], '0795550137',
  ));
  await runSql(`UPDATE public.orders SET status='ready'
    WHERE id='${completionReversalOrder.order_id}';`);
  const completionVsReversal = await runCustomerOverlap(
    'completion-reversal',
    `${ownerClaimsSql} SELECT public.complete_website_order_with_settlement_v2(
      '${completionReversalOrder.order_id}',
      'phase3-customer-completion-vs-reversal-0001',
      'cash',1000,0,NULL,'Customer completion vs POS reversal'
    );`,
    `${ownerClaimsSql} SELECT public.reverse_pos_sale(
      '${reversalOriginal.orderId}','Customer completion vs reversal',
      'phase3-customer-pos-reversal-race-0001'
    );`,
    undefined,
    {leftQueuesFirst: true},
  );
  assert.equal(completionVsReversal[0].status, 'fulfilled');
  assert.equal(completionVsReversal[1].status, 'rejected');
  assertFailureIdentity(completionVsReversal[1].reason.message, {
    sqlState: 'P0001', applicationIdentity: 'PHASE3_POS_REVERSAL_LATER_MOVEMENT',
  });
  const completionReversalEvidence = await readJson(`SELECT jsonb_build_object(
    'customerStatus',(SELECT status FROM public.orders
      WHERE id='${completionReversalOrder.order_id}'),
    'originalPosStatus',(SELECT status FROM public.orders
      WHERE id='${reversalOriginal.orderId}'),
    'reversalRows',(SELECT COUNT(*) FROM public.pos_sale_reversals
      WHERE requested_by='${OWNER}'
        AND idempotency_key='phase3-customer-pos-reversal-race-0001'),
    'reversalMovements',(SELECT COUNT(*) FROM public.inventory_movements movement
      WHERE movement.reference_type='pos_sale_reversal'
        AND movement.reference_id IN (
          SELECT reversal.id FROM public.pos_sale_reversals reversal
          WHERE reversal.requested_by='${OWNER}'
            AND reversal.idempotency_key='phase3-customer-pos-reversal-race-0001'
        )),
    'customerConsumed',(SELECT COUNT(*) FROM public.order_inventory_reservations
      WHERE order_id='${completionReversalOrder.order_id}'
        AND reservation_state='consumed'),
    'customerFinalized',(SELECT cost_finalized_at IS NOT NULL FROM public.orders
      WHERE id='${completionReversalOrder.order_id}')
  );`);
  assert.equal(completionReversalEvidence.customerStatus, 'completed');
  assert.equal(completionReversalEvidence.originalPosStatus, 'completed');
  assert.equal(completionReversalEvidence.reversalRows, 0);
  assert.equal(completionReversalEvidence.reversalMovements, 0);
  assert.ok(completionReversalEvidence.customerConsumed > 0);
  assert.equal(completionReversalEvidence.customerFinalized, true);

  const publicReadContract = await runPublicConfigurableParcelReadContractTests();
  const promotionPreviewV2 = await runPromotionPreviewV2Tests();

  const deadlocksAfter = await readJson(`SELECT jsonb_build_object('value',deadlocks)
    FROM pg_stat_database WHERE datname=current_database();`);
  assert.equal(deadlocksAfter.value - deadlocksBefore.value, 0);

  return {
    legacyV1CompletionCompatible: true,
    legacyV1CancellationCompatible: true,
    legacyV2CompletionRejectedZeroWrites: true,
    legacyV2CancellationRejectedZeroWrites: true,
    customerV1V2SharedLockOrder: true,
    customerV1V2BothQueueDirections: true,
    customerV1V2TrueSimultaneous: true,
    customerV1V2ResourceMatrix: true,
    customerCrossVersionSameKeySingleOrder: true,
    registeredCustomerPosSharedLockOrder: true,
    registeredCustomerPosBothQueueDirections: true,
    registeredCustomerPosTrueSimultaneous: true,
    registeredCustomerPosCommittedState: true,
    reservationCreation: true,
    exactReplayZeroWrites: true,
    changedPayloadConflictZeroWrites: true,
    crossActorConflictZeroWrites: true,
    staleQuoteRollback: true,
    staleConfigRollback: true,
    unavailableComponentRollback: true,
    promotionAllocation: true,
    authoritativeDeliveryFee: true,
    historicalPriceReplay: true,
    completion: true,
    completionReplayZeroWrites: true,
    cancellation: true,
    expiry: true,
    featureStateMatrix: true,
    poisonRowIsolation: true,
    poisonRowForwardProgress: true,
    multiPoisonForwardProgress: true,
    poisonAfterValidBounded: true,
    costFinalization: true,
    movementTraceability: true,
    monitoringCompatibility: true,
    parcelCogsPerInstanceBoundary: true,
    parcelCogsHalfBoundary: true,
    corruptedParcelCogsDetected: true,
    cashSettlement: true,
    cliqSettlement: true,
    reservationRace: true,
    reservationVsPosV1: true,
    reservationVsPosV2: true,
    reservationVsReceiving: true,
    reservationVsTransfer: true,
    reservationVsAdjustment: true,
    completionVsPos: true,
    completionVsReceiving: true,
    completionVsReversal: true,
    completionVsCancellation: true,
    completionVsExpiry: true,
    completionExpiryEvidence,
    cancellationVsExpiry: true,
    publicReadContract,
    promotionPreviewV2,
    customerDeadlockDelta: 0,
  };
};

try {
  const { stdout } = await execFileAsync(process.execPath, [bootstrapPath], {
    cwd: projectRoot,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    timeout: 420_000,
    env: { ...process.env, NAWASRAH_ISOLATED_PROJECT_ID: projectId },
  });
  const bootstrap = JSON.parse(stdout);
  assert.equal(bootstrap.ok, true);
  assert.equal(bootstrap.authBaselineEmpty, true);
  isolatedProjectRoot = bootstrap.isolatedProjectRoot;

  const runtimeSql = await readFile(runtimeSqlPath, 'utf8');
  const runtime = await readJson(runtimeSql);
  assert.equal(runtime.ok, true);
  assert.equal(runtime.operationRows, 4);
  assert.equal(runtime.reservationRows, 2);
  assert.equal(runtime.featureState, 'ENABLED');
  assert.equal(runtime.scenarios.length, 30);

  const baseline = await targetedState();
  const actorHash = await readJson(`SELECT to_jsonb(public.phase3_actor_scope_hash_internal(
    'erp_user', '${OWNER}', NULL, NULL
  ));`);
  const operationFingerprint = baseline.operations[0].request_fingerprint;

  await expectSqlFailure(`SELECT public.phase3_resolve_operation_replay_internal(
    'phase3_pos_sale_v1', 'phase3-runtime-replay-key',
    'erp_user', '${actorHash}', repeat('f',64)
  );`, { sqlState: 'P0001', applicationIdentity: 'PHASE3_IDEMPOTENCY_CONFLICT' });
  assert.deepEqual(await targetedState(), baseline);

  await expectSqlFailure(`SELECT public.phase3_resolve_operation_replay_internal(
    'phase3_pos_sale_v1', 'phase3-runtime-replay-key',
    'erp_user', repeat('e',64), '${operationFingerprint}'
  );`, { sqlState: 'P0001', applicationIdentity: 'PHASE3_IDEMPOTENCY_CONFLICT' });
  assert.deepEqual(await targetedState(), baseline);

  const claims = `SELECT set_config('request.jwt.claim.role','service_role',false);`;
  await expectSqlFailure(`${claims} SELECT public.phase3_validate_configurable_parcel_internal(
    'guest_gateway', NULL, '${FAMILY}', '${CONFIG}', 1,
    '[{"product_id":"${SKU_A}","base_quantity":1},{"product_id":"${SKU_B}","base_quantity":3}]'::jsonb
  );`, {
    sqlState: '23514',
    constraint: 'phase3_parcel_capacity_check',
    applicationIdentity: 'PARCEL_CAPACITY_MISMATCH',
  });
  assert.deepEqual(await targetedState(), baseline);

  await expectSqlFailure(`${claims} SELECT public.phase3_validate_configurable_parcel_internal(
    'guest_gateway', NULL, '${FAMILY}', '${CONFIG}', 1,
    '[{"product_id":"${OTHER}","base_quantity":5}]'::jsonb
  );`, {
    sqlState: '23514',
    constraint: 'phase3_parcel_component_family_check',
    applicationIdentity: 'PARCEL_COMPONENT_FAMILY_MISMATCH',
  });
  assert.deepEqual(await targetedState(), baseline);

  await expectSqlFailure(`${claims} SELECT public.phase3_validate_configurable_parcel_internal(
    'guest_gateway', NULL, '${FAMILY}', '${CONFIG}', 1,
    '[{"product_id":"${FAMILY}","base_quantity":5}]'::jsonb
  );`, {
    sqlState: '23514',
    constraint: 'phase3_parcel_component_family_check',
    applicationIdentity: 'PARCEL_COMPONENT_FAMILY_MISMATCH',
  });
  assert.deepEqual(await targetedState(), baseline);

  await expectSqlFailure(`BEGIN; UPDATE public.products
    SET wac_cost_in_minor_units_exact=NULL WHERE id='${SKU_B}';
    ${claims} SELECT public.phase3_validate_configurable_parcel_internal(
      'guest_gateway', NULL, '${FAMILY}', '${CONFIG}', 1,
      '[{"product_id":"${SKU_A}","base_quantity":2},{"product_id":"${SKU_B}","base_quantity":3}]'::jsonb
    ); COMMIT;`, {
    sqlState: 'P0001',
    applicationIdentity: 'PHASE3_EXACT_WAC_UNAVAILABLE',
  });
  assert.deepEqual(await targetedState(), baseline);

  await expectSqlFailure(`INSERT INTO public.order_inventory_reservations (
    operation_id, order_id, order_item_id, parcel_instance_id,
    warehouse_id, product_id, reserved_quantity
  ) SELECT operation_id, order_id, order_item_id, parcel_instance_id,
    warehouse_id, product_id, 4
  FROM public.order_inventory_reservations
  WHERE operation_id='${OPERATION}' AND product_id='${SKU_B}';`, {
    sqlState: '23514',
    constraint: 'order_inventory_reservations_component_quantity_check',
    applicationIdentity: 'PARCEL_RESERVATION_COMPONENT_MISMATCH',
  });
  assert.deepEqual(await targetedState(), baseline);

  await expectSqlFailure(`INSERT INTO public.order_inventory_reservations (
    operation_id, order_id, order_item_id, parcel_instance_id,
    warehouse_id, product_id, reserved_quantity
  ) SELECT operation_id, order_id, order_item_id, parcel_instance_id,
    warehouse_id, product_id, reserved_quantity
  FROM public.order_inventory_reservations
  WHERE operation_id='${OPERATION}' AND product_id='${SKU_A}';`, {
    sqlState: '23505',
    constraint: 'uq_order_inventory_reservations_active_identity',
  });
  assert.deepEqual(await targetedState(), baseline);

  await expectSqlFailure(`UPDATE public.order_inventory_reservations
    SET reservation_state='active', resolved_at=NULL
    WHERE operation_id='${OPERATION}' AND product_id='${SKU_B}';`, {
    sqlState: 'P0001',
    applicationIdentity: 'RESERVATION_TERMINAL_STATE_IMMUTABLE',
  });
  assert.deepEqual(await targetedState(), baseline);

  const security = await readJson(`SELECT jsonb_build_object(
    'tableSelect', has_table_privilege('authenticated','public.business_operations','SELECT'),
    'safeId', has_column_privilege('authenticated','public.business_operations','id','SELECT'),
    'fingerprint', has_column_privilege('authenticated','public.business_operations','request_fingerprint','SELECT'),
    'requestSnapshot', has_column_privilege('authenticated','public.business_operations','request_identity_snapshot','SELECT'),
    'actorHash', has_column_privilege('authenticated','public.business_operations','actor_scope_hash','SELECT'),
    'helperExecute', has_function_privilege('authenticated','public.phase3_validate_configurable_parcel_internal(text,uuid,uuid,uuid,integer,jsonb)','EXECUTE'),
    'anonCustomerCoordinator', COALESCE((SELECT bool_or(has_function_privilege('anon',p.oid,'EXECUTE'))
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='submit_guest_customer_order_v2'),false),
    'authenticatedCustomerCoordinator', COALESCE((SELECT bool_or(has_function_privilege('authenticated',p.oid,'EXECUTE'))
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='submit_guest_customer_order_v2'),false),
    'anonExpiryInternal', has_function_privilege('anon','public.phase3_expire_customer_order_v2_internal(uuid)','EXECUTE'),
    'authenticatedExpiryInternal', has_function_privilege('authenticated','public.phase3_expire_customer_order_v2_internal(uuid)','EXECUTE'),
    'serviceExpiryInternal', has_function_privilege('service_role','public.phase3_expire_customer_order_v2_internal(uuid)','EXECUTE'),
    'posV2Owner', (SELECT pg_get_userbyid(p.proowner) FROM pg_proc p
      WHERE p.oid='public.create_pos_sale_v2(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)'::regprocedure),
    'posV2SecurityDefiner', (SELECT p.prosecdef FROM pg_proc p
      WHERE p.oid='public.create_pos_sale_v2(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)'::regprocedure),
    'posV2SearchPath', (SELECT p.proconfig @> ARRAY['search_path=public, pg_temp']::text[] FROM pg_proc p
      WHERE p.oid='public.create_pos_sale_v2(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)'::regprocedure),
    'posV2DefaultCount', (SELECT p.pronargdefaults FROM pg_proc p
      WHERE p.oid='public.create_pos_sale_v2(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)'::regprocedure),
    'posV2ResultType', (SELECT pg_get_function_result(p.oid) FROM pg_proc p
      WHERE p.oid='public.create_pos_sale_v2(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)'::regprocedure),
    'authenticatedPosV2', has_function_privilege('authenticated','public.create_pos_sale_v2(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)','EXECUTE'),
    'anonPosV2', has_function_privilege('anon','public.create_pos_sale_v2(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)','EXECUTE'),
    'authenticatedPrivatePosV2', has_function_privilege('authenticated','public._create_pos_sale_v2_before_registered_customer_lock(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)','EXECUTE'),
    'anonPrivatePosV2', has_function_privilege('anon','public._create_pos_sale_v2_before_registered_customer_lock(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)','EXECUTE'),
    'servicePrivatePosV2', has_function_privilege('service_role','public._create_pos_sale_v2_before_registered_customer_lock(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)','EXECUTE')
  );`);
  assert.deepEqual(security, {
    tableSelect: false,
    safeId: true,
    fingerprint: false,
    requestSnapshot: false,
    actorHash: false,
    helperExecute: false,
    anonCustomerCoordinator: false,
    authenticatedCustomerCoordinator: false,
    anonExpiryInternal: false,
    authenticatedExpiryInternal: false,
    serviceExpiryInternal: false,
    posV2Owner: 'postgres',
    posV2SecurityDefiner: true,
    posV2SearchPath: true,
    posV2DefaultCount: 3,
    posV2ResultType: 'jsonb',
    authenticatedPosV2: true,
    anonPosV2: false,
    authenticatedPrivatePosV2: false,
    anonPrivatePosV2: false,
    servicePrivatePosV2: false,
  });

  const coordinatorZeroWrites = await runCoordinatorZeroWriteTests();
  const discountAllocation = await runDiscountAllocationMatrix();
  const legacyLocationCompatibility = await runLegacyLocationCompatibilityTests();
  const configurableRollback = await runConfigurableRollbackTest();
  const financialReadSide = await runFinancialReadSideTests();
  const concurrency = await runLockOrderTest();
  const crossVersionConcurrency = await runCrossVersionConcurrencyTest();
  const competingParcelSales = await runCompetingParcelSalesTest();
  const saleAndSupplierReceipt = await runSaleAndSupplierReceiptConcurrencyTest();
  const saleAndReversal = await runSaleAndReversalConcurrencyTest();
  const legacySaleAndReversal = await runLegacySaleAndReversalConcurrencyTest();
  const customerReservationCoordinator = await runCustomerReservationCoordinatorTests();
  const phase35bReporting = await runPhase35bReportingTests();

  const { stdout: lintOutput, stderr: lintError } = await execFileAsync(
    process.execPath,
    [cliPath, 'db', 'lint', '--local', '--workdir', isolatedProjectRoot],
    {
      cwd: projectRoot,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      timeout: 120_000,
    },
  );
  const rawDbLint = (lintOutput || lintError).trim();
  let dbLint = 'PASS';
  const acceptedDbLintWarnings = [];
  if (rawDbLint && !/no schema errors found/iu.test(rawDbLint)) {
    const parsed = JSON.parse(rawDbLint);
    const results = Array.isArray(parsed) ? parsed : parsed.results;
    assert.ok(Array.isArray(results) && results.length > 0);
    const issues = results.flatMap((result) =>
      (result.issues || []).map((issue) => ({ function: result.function, ...issue })),
    );
    assert.ok(issues.length > 0);
    for (const issue of issues) {
      assert.doesNotMatch(issue.level || '', /error/iu);
      assert.match(issue.function || '', /transfer_inventory_between_warehouses/u);
      assert.match(issue.message || '', /unused parameter.*p_transfer_date/u);
      acceptedDbLintWarnings.push({
        function: issue.function,
        message: issue.message,
      });
    }
  }

  console.log(JSON.stringify({
    ok: true,
    migrationRebuild: '001-119',
    runtime,
    idempotency: {
      exactReplayZeroWrites: true,
      changedRequestConflictZeroWrites: true,
      crossActorConflictGeneric: true,
      resultSnapshotImmutable: true,
      ...coordinatorZeroWrites,
    },
    discountAllocation,
    legacyLocationCompatibility,
    configurableRollback,
    financialReadSide,
    customerReservationCoordinator,
    phase35bReporting,
    validation: {
      strictErrorIdentity: true,
      crossFamilyRejected: true,
      wrongCapacityRejected: true,
      masterProductRejected: true,
      missingExactWacRejected: true,
    },
    reservations: {
      componentQuantityBounded: true,
      duplicateActiveRejected: true,
      terminalStateImmutable: true,
    },
    security,
    concurrency: {
      ...concurrency,
      crossVersionConcurrency,
      competingParcelSales,
      saleAndSupplierReceipt,
      saleAndReversal,
      legacySaleAndReversal,
    },
    dbLint,
    acceptedDbLintWarnings,
  }, null, 2));
} finally {
  if (isolatedProjectRoot) {
    await execFileAsync(
      process.execPath,
      [cliPath, 'stop', '--no-backup', '--workdir', isolatedProjectRoot],
      {
        cwd: projectRoot,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        timeout: 120_000,
      },
    );
  }
}
