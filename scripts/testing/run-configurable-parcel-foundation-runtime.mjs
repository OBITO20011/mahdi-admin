import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..');
const bootstrapPath = path.join(scriptDirectory, 'bootstrap-isolated-supabase.mjs');
const runtimeSqlPath = path.join(scriptDirectory, 'configurable-parcel-foundation-runtime.sql');
const cliPath = path.join(projectRoot, 'node_modules', 'supabase', 'dist', 'supabase.js');
const projectId = process.env.NAWASRAH_PARCEL_FOUNDATION_PROJECT_ID ||
  'nawasrah-parcel-foundation-test';
const databaseContainer = `supabase_db_${projectId}`;
let isolatedProjectRoot = '';

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
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', (code) => {
    if (code === 0) resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    else reject(new Error(
      `Configurable parcel foundation SQL failed: ${stderr}\n${stdout}`,
    ));
  });
  child.stdin.end(sql);
});

const readJson = async (sql) => {
  const result = await runSql(sql);
  const value = result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  assert.ok(value, 'Expected JSON SQL output.');
  return JSON.parse(value);
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

const assertSqlFailureIdentity = (
  message,
  { sqlState, constraint = null, applicationIdentity = null },
) => {
  assert.match(
    message,
    new RegExp(`ERROR:\\s+${escapeRegExp(sqlState)}:`, 'u'),
    `Expected PostgreSQL SQLSTATE ${sqlState}.`,
  );
  if (constraint) {
    assert.match(
      message,
      new RegExp(
        `CONSTRAINT NAME:\\s+${escapeRegExp(constraint)}(?:\\r?\\n|$)`,
        'u',
      ),
      `Expected PostgreSQL constraint ${constraint}.`,
    );
  }
  if (applicationIdentity) {
    assert.match(
      message,
      new RegExp(
        `ERROR:\\s+${escapeRegExp(sqlState)}:\\s+${escapeRegExp(applicationIdentity)}:`,
        'u',
      ),
      `Expected application error identity ${applicationIdentity}.`,
    );
  }
  assert.ok(
    constraint || applicationIdentity,
    'A strict constraint or application error identity is required.',
  );
};

const expectSqlFailure = async (
  sql,
  { sqlState, constraint = null, applicationIdentity = null },
) => {
  try {
    await runSql(sql);
    assert.fail('Expected isolated SQL transaction to fail.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assertSqlFailureIdentity(message, { sqlState, constraint, applicationIdentity });
    return message;
  }
};

const waitForDatabaseState = async (sql, predicate, label, timeoutMs = 8_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await readJson(sql);
    if (predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`Timed out waiting for ${label}.`);
};

const buildParcelTransaction = ({
  itemId,
  instanceId,
  componentId,
  instanceSequence,
  quantity,
  finalize,
  afterComponentSql = '',
  afterFinalizeSql = '',
  lineKind = 'configurable_parcel',
  orderItemProductId = null,
  finish = 'COMMIT',
}) => `
  BEGIN;
  UPDATE public.configurable_parcel_feature_settings
  SET feature_state = 'ENABLED', updated_at = NOW()
  WHERE feature_key = 'configurable_parcels';
  INSERT INTO public.order_items (
    id, order_id, product_id, product_name_snapshot, quantity,
    unit_price_in_minor_units, line_total_in_minor_units,
    commercial_line_kind, family_product_id, parcel_configuration_id,
    parcel_configuration_revision, base_unit_name_snapshot,
    allocated_discount_snapshot_in_minor_units,
    net_refundable_amount_snapshot_in_minor_units
  ) VALUES (
    '${itemId}', '91200000-0000-0000-0000-000000000030',
    ${orderItemProductId ? `'${orderItemProductId}'` : 'NULL'},
    'Commit boundary parcel', 5, 5000, 5000,
    ${lineKind === null ? 'NULL' : `'${lineKind}'`},
    '91200000-0000-0000-0000-000000000010',
    '91200000-0000-0000-0000-000000000032',
    2, 'باكيت', 0, 5000
  );
  INSERT INTO public.order_parcel_instances (
    id, order_item_id, order_id, operation_id, parcel_configuration_id,
    family_product_id, instance_sequence, configuration_revision,
    units_per_parcel_snapshot, parcel_unit_name_snapshot,
    gross_amount_snapshot_in_minor_units,
    allocated_discount_snapshot_in_minor_units,
    net_refundable_amount_snapshot_in_minor_units,
    cogs_snapshot_in_minor_units, composition_fingerprint
  ) VALUES (
    '${instanceId}', '${itemId}',
    '91200000-0000-0000-0000-000000000030',
    '91200000-0000-0000-0000-000000000031',
    '91200000-0000-0000-0000-000000000032',
    '91200000-0000-0000-0000-000000000010',
    ${instanceSequence}, 2, 5, 'طرد', 5000, 0, 5000,
    ${quantity * 800}, repeat('8', 64)
  );
  INSERT INTO public.order_parcel_components (
    id, parcel_instance_id, operation_id, product_id, base_quantity,
    product_name_snapshot, sku_snapshot, base_unit_name_snapshot,
    unit_cost_snapshot_in_minor_units, cogs_snapshot_in_minor_units
  ) VALUES (
    '${componentId}', '${instanceId}',
    '91200000-0000-0000-0000-000000000031',
    '91200000-0000-0000-0000-000000000011',
    ${quantity}, 'نكهة أ', 'PARCEL-A', 'باكيت', 800, ${quantity * 800}
  );
  ${afterComponentSql}
  ${finalize
    ? `SELECT public.finalize_order_parcel_instance_internal('${instanceId}');`
    : ''}
  ${afterFinalizeSql}
  UPDATE public.configurable_parcel_feature_settings
  SET feature_state = 'OFF', updated_at = NOW()
  WHERE feature_key = 'configurable_parcels';
  ${finish};
`;

const assertNoPartialParcelState = async ({ itemId, instanceId, componentId }) => {
  const cleanup = await readJson(`
    SELECT jsonb_build_object(
      'items', (SELECT COUNT(*) FROM public.order_items WHERE id = '${itemId}'),
      'instances', (SELECT COUNT(*) FROM public.order_parcel_instances WHERE id = '${instanceId}'),
      'components', (SELECT COUNT(*) FROM public.order_parcel_components WHERE id = '${componentId}'),
      'reservations', (
        SELECT COUNT(*) FROM public.order_inventory_reservations
        WHERE order_item_id = '${itemId}' OR parcel_instance_id = '${instanceId}'
      ),
      'movements', (
        SELECT COUNT(*) FROM public.inventory_movements
        WHERE parcel_component_id = '${componentId}'
      ),
      'returns', (
        SELECT COUNT(*) FROM public.sales_return_items
        WHERE order_item_id = '${itemId}' OR parcel_instance_id = '${instanceId}'
      )
    );
  `);
  assert.deepEqual(cleanup, {
    items: 0,
    instances: 0,
    components: 0,
    reservations: 0,
    movements: 0,
    returns: 0,
  });
};

const assertNoReturnItem = async (returnItemId) => {
  const state = await readJson(`
    SELECT jsonb_build_object(
      'returnItems', (
        SELECT COUNT(*) FROM public.sales_return_items
        WHERE id = '${returnItemId}'
      )
    );
  `);
  assert.deepEqual(state, { returnItems: 0 });
};

const assertOrderItemIdentity = async (
  orderItemId,
  expectedLineKind,
  expectedProductId,
) => {
  const state = await readJson(`
    SELECT jsonb_build_object(
      'lineKind', commercial_line_kind,
      'productId', product_id,
      'rows', COUNT(*) OVER ()
    )
    FROM public.order_items
    WHERE id = '${orderItemId}';
  `);
  assert.deepEqual(state, {
    lineKind: expectedLineKind,
    productId: expectedProductId,
    rows: 1,
  });
};

const readReturnHistoryState = async ({
  orderItemId,
  returnItemId,
  parcelInstanceId = null,
}) => readJson(`
  SELECT jsonb_build_object(
    'orderItem', (
      SELECT TO_JSONB(item) FROM public.order_items item
      WHERE item.id = '${orderItemId}'
    ),
    'returnItem', (
      SELECT TO_JSONB(return_item) FROM public.sales_return_items return_item
      WHERE return_item.id = '${returnItemId}'
    ),
    'parcelInstance', (
      SELECT TO_JSONB(instance) FROM public.order_parcel_instances instance
      WHERE instance.id = ${parcelInstanceId ? `'${parcelInstanceId}'` : 'NULL'}
    ),
    'reservations', (
      SELECT COUNT(*) FROM public.order_inventory_reservations
      WHERE order_item_id = '${orderItemId}'
    ),
    'movements', (
      SELECT COUNT(*)
      FROM public.inventory_movements movement
      JOIN public.order_inventory_reservations reservation
        ON reservation.id = movement.reservation_id
      WHERE reservation.order_item_id = '${orderItemId}'
    )
  );
`);

try {
  const { stdout } = await execFileAsync(process.execPath, [bootstrapPath], {
    cwd: projectRoot,
    env: { ...process.env, NAWASRAH_ISOLATED_PROJECT_ID: projectId },
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    timeout: 360_000,
  });
  const bootstrap = JSON.parse(stdout);
  assert.equal(bootstrap.ok, true);
  isolatedProjectRoot = bootstrap.isolatedProjectRoot;

  const runtimeSql = await readFile(runtimeSqlPath, 'utf8');
  const result = await runSql(runtimeSql);
  const lastLine = result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  assert.ok(lastLine, 'Expected configurable parcel foundation runtime output.');
  const summary = JSON.parse(lastLine);
  assert.equal(summary.ok, true);
  assert.equal(summary.featureState, 'OFF');
  assert.equal(summary.scenarios.length, 21);

  const underfilled = {
    itemId: '91200000-0000-0000-0000-000000000080',
    instanceId: '91200000-0000-0000-0000-000000000081',
    componentId: '91200000-0000-0000-0000-000000000082',
  };
  await expectSqlFailure(
    buildParcelTransaction({
      ...underfilled,
      instanceSequence: 10,
      quantity: 4,
      finalize: false,
    }),
    {
      sqlState: '23514',
      constraint: 'order_parcel_instance_finalized_at_check',
    },
  );
  await assertNoPartialParcelState(underfilled);

  const overfilled = {
    itemId: '91200000-0000-0000-0000-000000000083',
    instanceId: '91200000-0000-0000-0000-000000000084',
    componentId: '91200000-0000-0000-0000-000000000085',
  };
  await expectSqlFailure(
    buildParcelTransaction({
      ...overfilled,
      instanceSequence: 11,
      quantity: 6,
      finalize: true,
    }),
    {
      sqlState: '23514',
      constraint: 'order_parcel_composition_total_check',
    },
  );
  await assertNoPartialParcelState(overfilled);

  const explicitRollback = {
    itemId: '91200000-0000-0000-0000-000000000086',
    instanceId: '91200000-0000-0000-0000-000000000087',
    componentId: '91200000-0000-0000-0000-000000000088',
  };
  await runSql(buildParcelTransaction({
    ...explicitRollback,
    instanceSequence: 12,
    quantity: 5,
    finalize: true,
    finish: 'ROLLBACK',
  }));
  await assertNoPartialParcelState(explicitRollback);

  const validParcel = {
    itemId: '91200000-0000-0000-0000-000000000089',
    instanceId: '91200000-0000-0000-0000-000000000090',
    componentId: '91200000-0000-0000-0000-000000000091',
  };
  await runSql(buildParcelTransaction({
    ...validParcel,
    instanceSequence: 13,
    quantity: 5,
    finalize: true,
  }));
  const committedParcel = await readJson(`
    SELECT jsonb_build_object(
      'items', (SELECT COUNT(*) FROM public.order_items WHERE id = '${validParcel.itemId}'),
      'instances', (SELECT COUNT(*) FROM public.order_parcel_instances WHERE id = '${validParcel.instanceId}' AND finalized_at IS NOT NULL),
      'components', (SELECT COUNT(*) FROM public.order_parcel_components WHERE id = '${validParcel.componentId}' AND base_quantity = 5)
    );
  `);
  assert.deepEqual(committedParcel, { items: 1, instances: 1, components: 1 });

  await expectSqlFailure(`
    BEGIN;
    UPDATE public.order_parcel_instances
    SET family_product_id = '91200000-0000-0000-0000-000000000013'
    WHERE id = '${validParcel.instanceId}';
    COMMIT;
  `, {
    sqlState: 'P0001',
    applicationIdentity: 'FINALIZED_PARCEL_IMMUTABLE',
  });

  const familySwitch = {
    itemId: '91200000-0000-0000-0000-000000000103',
    instanceId: '91200000-0000-0000-0000-000000000104',
    componentId: '91200000-0000-0000-0000-000000000105',
  };
  await expectSqlFailure(
    buildParcelTransaction({
      ...familySwitch,
      instanceSequence: 21,
      quantity: 5,
      finalize: false,
      afterComponentSql: `
        UPDATE public.order_parcel_instances
        SET family_product_id = '91200000-0000-0000-0000-000000000013'
        WHERE id = '${familySwitch.instanceId}';
      `,
    }),
    {
      sqlState: 'P0001',
      applicationIdentity: 'PARCEL_IDENTITY_IMMUTABLE',
    },
  );
  await assertNoPartialParcelState(familySwitch);

  const orderItemReparent = {
    itemId: '91200000-0000-0000-0000-000000000106',
    instanceId: '91200000-0000-0000-0000-000000000107',
    componentId: '91200000-0000-0000-0000-000000000108',
  };
  await expectSqlFailure(
    buildParcelTransaction({
      ...orderItemReparent,
      instanceSequence: 22,
      quantity: 5,
      finalize: false,
      afterComponentSql: `
        UPDATE public.order_parcel_instances
        SET order_item_id = '91200000-0000-0000-0000-000000000034'
        WHERE id = '${orderItemReparent.instanceId}';
      `,
    }),
    {
      sqlState: 'P0001',
      applicationIdentity: 'PARCEL_IDENTITY_IMMUTABLE',
    },
  );
  await assertNoPartialParcelState(orderItemReparent);

  const configurationSwitch = {
    itemId: '91200000-0000-0000-0000-000000000109',
    instanceId: '91200000-0000-0000-0000-000000000110',
    componentId: '91200000-0000-0000-0000-000000000111',
  };
  await expectSqlFailure(
    buildParcelTransaction({
      ...configurationSwitch,
      instanceSequence: 23,
      quantity: 5,
      finalize: false,
      afterComponentSql: `
        UPDATE public.order_parcel_instances
        SET configuration_revision = 1
        WHERE id = '${configurationSwitch.instanceId}';
      `,
    }),
    {
      sqlState: 'P0001',
      applicationIdentity: 'PARCEL_IDENTITY_IMMUTABLE',
    },
  );
  await assertNoPartialParcelState(configurationSwitch);

  await expectSqlFailure(`
    BEGIN;
    UPDATE public.order_parcel_instances
    SET finalized_at = NOW()
    WHERE id = '${validParcel.instanceId}';
    COMMIT;
  `, {
    sqlState: 'P0001',
    applicationIdentity: 'FINALIZED_PARCEL_IMMUTABLE',
  });

  const secondParcel = {
    itemId: '91200000-0000-0000-0000-000000000121',
    instanceId: '91200000-0000-0000-0000-000000000122',
    componentId: '91200000-0000-0000-0000-000000000123',
  };
  await runSql(buildParcelTransaction({
    ...secondParcel,
    instanceSequence: 26,
    quantity: 5,
    finalize: true,
  }));

  await runSql(`
    INSERT INTO public.order_items (
      id, order_id, product_id, product_name_snapshot, sku_snapshot,
      quantity, unit_price_in_minor_units, line_total_in_minor_units,
      commercial_line_kind
    ) VALUES (
      '91200000-0000-0000-0000-000000000119',
      '91200000-0000-0000-0000-000000000030',
      '91200000-0000-0000-0000-000000000011',
      'Base reservation item', 'PARCEL-A', 1, 1000, 1000, 'base_unit'
    );
    INSERT INTO public.warehouses (id, branch_id, code, name_ar, is_active)
    VALUES (
      '91200000-0000-0000-0000-000000000130',
      '91200000-0000-0000-0000-000000000020',
      'PARCEL-WH-OTHER', 'مستودع اختبار آخر', true
    );
  `);

  await runSql(`
    INSERT INTO public.order_inventory_reservations (
      id, operation_id, order_id, order_item_id, parcel_instance_id,
      warehouse_id, product_id, reserved_quantity
    ) VALUES (
      '91200000-0000-0000-0000-000000000112',
      '91200000-0000-0000-0000-000000000031',
      '91200000-0000-0000-0000-000000000030',
      '${validParcel.itemId}', '${validParcel.instanceId}',
      '91200000-0000-0000-0000-000000000021',
      '91200000-0000-0000-0000-000000000011', 1
    );
    INSERT INTO public.order_inventory_reservations (
      id, operation_id, order_id, order_item_id, parcel_instance_id,
      warehouse_id, product_id, reserved_quantity
    ) VALUES (
      '91200000-0000-0000-0000-000000000120',
      '91200000-0000-0000-0000-000000000031',
      '91200000-0000-0000-0000-000000000030',
      '91200000-0000-0000-0000-000000000119', NULL,
      '91200000-0000-0000-0000-000000000021',
      '91200000-0000-0000-0000-000000000011', 1
    );
    INSERT INTO public.order_inventory_reservations (
      id, operation_id, order_id, order_item_id, parcel_instance_id,
      warehouse_id, product_id, reserved_quantity
    ) VALUES (
      '91200000-0000-0000-0000-000000000124',
      '91200000-0000-0000-0000-000000000031',
      '91200000-0000-0000-0000-000000000030',
      '${secondParcel.itemId}', '${secondParcel.instanceId}',
      '91200000-0000-0000-0000-000000000021',
      '91200000-0000-0000-0000-000000000011', 1
    );
    INSERT INTO public.inventory_movements (
      id, warehouse_id, product_id, movement_type, quantity,
      balance_before, balance_after, operation_id,
      parcel_component_id, reservation_id
    ) VALUES (
      '91200000-0000-0000-0000-000000000125',
      '91200000-0000-0000-0000-000000000021',
      '91200000-0000-0000-0000-000000000011',
      'sales_deduction', -1, 10, 9,
      '91200000-0000-0000-0000-000000000031',
      '${validParcel.componentId}',
      '91200000-0000-0000-0000-000000000112'
    );
    INSERT INTO public.inventory_movements (
      id, warehouse_id, product_id, movement_type, quantity,
      balance_before, balance_after, operation_id, reservation_id
    ) VALUES (
      '91200000-0000-0000-0000-000000000133',
      '91200000-0000-0000-0000-000000000021',
      '91200000-0000-0000-0000-000000000011',
      'sales_deduction', -1, 10, 9,
      '91200000-0000-0000-0000-000000000031',
      '91200000-0000-0000-0000-000000000120'
    );

    INSERT INTO public.supplier_receipt_items (
      id, supplier_receipt_id, product_id, package_quantity,
      units_per_package, total_base_units, package_price_in_minor_units,
      base_unit_cost_in_minor_units, line_total_in_minor_units,
      commercial_line_id, operation_id
    ) VALUES (
      '91200000-0000-0000-0000-000000000134',
      '91200000-0000-0000-0000-000000000061',
      '91200000-0000-0000-0000-000000000011',
      1, 1, 1, 800, 800, 800,
      '91200000-0000-0000-0000-000000000063',
      '91200000-0000-0000-0000-000000000031'
    );

    INSERT INTO public.business_operations (
      id, operation_type, idempotency_key, request_fingerprint
    ) VALUES (
      '91200000-0000-0000-0000-000000000136',
      'base_return_test', 'parcel-foundation-base-return', repeat('6', 64)
    );
    INSERT INTO public.sales_return_events (
      id, return_number, operation_id, order_id, branch_id, warehouse_id,
      cash_shift_id, reason, refund_method,
      merchandise_refund_amount_in_minor_units
    ) VALUES (
      '91200000-0000-0000-0000-000000000137', 'PARCEL-BASE-RETURN-1',
      '91200000-0000-0000-0000-000000000136',
      '91200000-0000-0000-0000-000000000030',
      '91200000-0000-0000-0000-000000000020',
      '91200000-0000-0000-0000-000000000021',
      '91200000-0000-0000-0000-000000000050',
      'Valid base return relationship', 'cash', 1000
    );
    INSERT INTO public.sales_return_items (
      id, sales_return_event_id, operation_id, order_id, order_item_id,
      return_scope, product_id, returned_quantity,
      refund_amount_snapshot_in_minor_units, stock_disposition
    ) VALUES (
      '91200000-0000-0000-0000-000000000138',
      '91200000-0000-0000-0000-000000000137',
      '91200000-0000-0000-0000-000000000136',
      '91200000-0000-0000-0000-000000000030',
      '91200000-0000-0000-0000-000000000119',
      'base_unit', '91200000-0000-0000-0000-000000000011',
      1, 1000, 'restock'
    );
  `);

  const positiveRelationships = await readJson(`
    SELECT jsonb_build_object(
      'baseReservation', (SELECT COUNT(*) FROM public.order_inventory_reservations WHERE id = '91200000-0000-0000-0000-000000000120' AND parcel_instance_id IS NULL),
      'firstParcelReservation', (SELECT COUNT(*) FROM public.order_inventory_reservations WHERE id = '91200000-0000-0000-0000-000000000112' AND parcel_instance_id = '${validParcel.instanceId}'),
      'secondParcelReservation', (SELECT COUNT(*) FROM public.order_inventory_reservations WHERE id = '91200000-0000-0000-0000-000000000124' AND parcel_instance_id = '${secondParcel.instanceId}'),
      'sameChainMovement', (SELECT COUNT(*) FROM public.inventory_movements WHERE id = '91200000-0000-0000-0000-000000000125'),
      'sameWarehouseMovement', (SELECT COUNT(*) FROM public.inventory_movements WHERE id = '91200000-0000-0000-0000-000000000133'),
      'supplierFamily', (SELECT COUNT(*) FROM public.supplier_receipt_items WHERE id = '91200000-0000-0000-0000-000000000134'),
      'baseReturn', (SELECT COUNT(*) FROM public.sales_return_items WHERE id = '91200000-0000-0000-0000-000000000138')
    );
  `);
  assert.deepEqual(positiveRelationships, {
    baseReservation: 1,
    firstParcelReservation: 1,
    secondParcelReservation: 1,
    sameChainMovement: 1,
    sameWarehouseMovement: 1,
    supplierFamily: 1,
    baseReturn: 1,
  });

  const baseParcelAttempt = {
    itemId: '91200000-0000-0000-0000-000000000201',
    instanceId: '91200000-0000-0000-0000-000000000202',
    componentId: '91200000-0000-0000-0000-000000000203',
  };
  await expectSqlFailure(
    buildParcelTransaction({
      ...baseParcelAttempt,
      instanceSequence: 31,
      quantity: 5,
      finalize: false,
      lineKind: 'base_unit',
      orderItemProductId: '91200000-0000-0000-0000-000000000011',
    }),
    {
      sqlState: '23514',
      constraint: 'order_parcel_instances_order_item_kind_check',
    },
  );
  await assertNoPartialParcelState(baseParcelAttempt);

  const finalizedBaseParcelAttempt = {
    itemId: '91200000-0000-0000-0000-000000000204',
    instanceId: '91200000-0000-0000-0000-000000000205',
    componentId: '91200000-0000-0000-0000-000000000206',
  };
  await expectSqlFailure(
    buildParcelTransaction({
      ...finalizedBaseParcelAttempt,
      instanceSequence: 32,
      quantity: 5,
      finalize: true,
      lineKind: 'base_unit',
      orderItemProductId: '91200000-0000-0000-0000-000000000011',
    }),
    {
      sqlState: '23514',
      constraint: 'order_parcel_instances_order_item_kind_check',
    },
  );
  await assertNoPartialParcelState(finalizedBaseParcelAttempt);

  const finalizedParcelKindMutation = {
    itemId: '91200000-0000-0000-0000-000000000207',
    instanceId: '91200000-0000-0000-0000-000000000208',
    componentId: '91200000-0000-0000-0000-000000000209',
  };
  await expectSqlFailure(
    buildParcelTransaction({
      ...finalizedParcelKindMutation,
      instanceSequence: 33,
      quantity: 5,
      finalize: true,
      afterFinalizeSql: `
        UPDATE public.order_items
        SET commercial_line_kind = 'base_unit'
        WHERE id = '${finalizedParcelKindMutation.itemId}';
      `,
    }),
    {
      sqlState: 'P0001',
      applicationIdentity: 'PARCEL_LINE_IMMUTABLE',
    },
  );
  await assertNoPartialParcelState(finalizedParcelKindMutation);

  const legacyNullParcelAttempt = {
    itemId: '91200000-0000-0000-0000-000000000210',
    instanceId: '91200000-0000-0000-0000-000000000211',
    componentId: '91200000-0000-0000-0000-000000000212',
  };
  await expectSqlFailure(
    buildParcelTransaction({
      ...legacyNullParcelAttempt,
      instanceSequence: 34,
      quantity: 5,
      finalize: false,
      lineKind: null,
      orderItemProductId: '91200000-0000-0000-0000-000000000011',
    }),
    {
      sqlState: '23514',
      constraint: 'order_parcel_instances_order_item_kind_check',
    },
  );
  await assertNoPartialParcelState(legacyNullParcelAttempt);

  const legacySingleSkuParcelAttempt = {
    itemId: '91200000-0000-0000-0000-000000000213',
    instanceId: '91200000-0000-0000-0000-000000000214',
    componentId: '91200000-0000-0000-0000-000000000215',
  };
  await expectSqlFailure(
    buildParcelTransaction({
      ...legacySingleSkuParcelAttempt,
      instanceSequence: 35,
      quantity: 5,
      finalize: false,
      lineKind: 'legacy_single_sku_parcel',
      orderItemProductId: '91200000-0000-0000-0000-000000000011',
    }),
    {
      sqlState: '23514',
      constraint: 'order_parcel_instances_order_item_kind_check',
    },
  );
  await assertNoPartialParcelState(legacySingleSkuParcelAttempt);

  const returnParcel = {
    itemId: '91200000-0000-0000-0000-000000000216',
    instanceId: '91200000-0000-0000-0000-000000000217',
    componentId: '91200000-0000-0000-0000-000000000218',
  };
  await runSql(buildParcelTransaction({
    ...returnParcel,
    instanceSequence: 36,
    quantity: 5,
    finalize: true,
    orderItemProductId: '91200000-0000-0000-0000-000000000011',
  }));
  await runSql(`
    INSERT INTO public.order_items (
      id, order_id, product_id, product_name_snapshot, sku_snapshot,
      quantity, unit_price_in_minor_units, line_total_in_minor_units,
      commercial_line_kind
    ) VALUES
      (
        '91200000-0000-0000-0000-000000000219',
        '91200000-0000-0000-0000-000000000030',
        '91200000-0000-0000-0000-000000000011',
        'Return mode Base Unit', 'PARCEL-A', 1, 1000, 1000, 'base_unit'
      ),
      (
        '91200000-0000-0000-0000-000000000220',
        '91200000-0000-0000-0000-000000000030',
        '91200000-0000-0000-0000-000000000011',
        'Untouched historical return line', 'PARCEL-A', 1, 1000, 1000, NULL
      ),
      (
        '91200000-0000-0000-0000-000000000221',
        '91200000-0000-0000-0000-000000000030',
        '91200000-0000-0000-0000-000000000011',
        'Legacy single-SKU return line', 'PARCEL-A', 1, 1000, 1000,
        'legacy_single_sku_parcel'
      );
  `);

  const returnModeFailures = [
    {
      label: 'Base Unit return from configurable Parcel line',
      returnItemId: '91200000-0000-0000-0000-000000000222',
      orderItemId: returnParcel.itemId,
      parcelInstanceId: returnParcel.instanceId,
      expectedLineKind: 'configurable_parcel',
      sql: `
        BEGIN;
        INSERT INTO public.sales_return_items (
          id, sales_return_event_id, operation_id, order_id, order_item_id,
          return_scope, product_id, returned_quantity,
          refund_amount_snapshot_in_minor_units, stock_disposition
        ) VALUES (
          '91200000-0000-0000-0000-000000000222',
          '91200000-0000-0000-0000-000000000137',
          '91200000-0000-0000-0000-000000000136',
          '91200000-0000-0000-0000-000000000030',
          '${returnParcel.itemId}', 'base_unit',
          '91200000-0000-0000-0000-000000000011', 1, 1000, 'restock'
        );
        COMMIT;
      `,
      expectedError: {
        sqlState: '23514',
        constraint: 'sales_return_items_parcel_line_kind_check',
      },
    },
    {
      label: 'Parcel return from Base Unit line',
      returnItemId: '91200000-0000-0000-0000-000000000223',
      orderItemId: '91200000-0000-0000-0000-000000000219',
      parcelInstanceId: returnParcel.instanceId,
      expectedLineKind: 'base_unit',
      sql: `
        BEGIN;
        INSERT INTO public.sales_return_items (
          id, sales_return_event_id, operation_id, order_id, order_item_id,
          return_scope, parcel_instance_id, returned_quantity,
          refund_amount_snapshot_in_minor_units, stock_disposition
        ) VALUES (
          '91200000-0000-0000-0000-000000000223',
          '91200000-0000-0000-0000-000000000137',
          '91200000-0000-0000-0000-000000000136',
          '91200000-0000-0000-0000-000000000030',
          '91200000-0000-0000-0000-000000000219', 'parcel_instance',
          '${returnParcel.instanceId}', 1, 5000, 'restock'
        );
        COMMIT;
      `,
      expectedError: {
        sqlState: '23514',
        constraint: 'sales_return_items_base_line_kind_check',
      },
    },
    {
      label: 'Parcel return with wrong Parcel Instance',
      returnItemId: '91200000-0000-0000-0000-000000000224',
      orderItemId: returnParcel.itemId,
      parcelInstanceId: secondParcel.instanceId,
      expectedLineKind: 'configurable_parcel',
      sql: `
        BEGIN;
        INSERT INTO public.sales_return_items (
          id, sales_return_event_id, operation_id, order_id, order_item_id,
          return_scope, parcel_instance_id, returned_quantity,
          refund_amount_snapshot_in_minor_units, stock_disposition
        ) VALUES (
          '91200000-0000-0000-0000-000000000224',
          '91200000-0000-0000-0000-000000000137',
          '91200000-0000-0000-0000-000000000136',
          '91200000-0000-0000-0000-000000000030',
          '${returnParcel.itemId}', 'parcel_instance',
          '${secondParcel.instanceId}', 1, 5000, 'restock'
        );
        COMMIT;
      `,
      expectedError: {
        sqlState: '23514',
        constraint: 'sales_return_items_original_parcel_check',
      },
    },
    {
      label: 'legacy NULL line new Return Item',
      returnItemId: '91200000-0000-0000-0000-000000000225',
      orderItemId: '91200000-0000-0000-0000-000000000220',
      expectedLineKind: null,
      sql: `
        BEGIN;
        INSERT INTO public.sales_return_items (
          id, sales_return_event_id, operation_id, order_id, order_item_id,
          return_scope, product_id, returned_quantity,
          refund_amount_snapshot_in_minor_units, stock_disposition
        ) VALUES (
          '91200000-0000-0000-0000-000000000225',
          '91200000-0000-0000-0000-000000000137',
          '91200000-0000-0000-0000-000000000136',
          '91200000-0000-0000-0000-000000000030',
          '91200000-0000-0000-0000-000000000220', 'base_unit',
          '91200000-0000-0000-0000-000000000011', 1, 1000, 'restock'
        );
        COMMIT;
      `,
      expectedError: {
        sqlState: '23514',
        constraint: 'sales_return_items_supported_line_kind_check',
      },
    },
    {
      label: 'legacy single-SKU line new Return Item',
      returnItemId: '91200000-0000-0000-0000-000000000226',
      orderItemId: '91200000-0000-0000-0000-000000000221',
      expectedLineKind: 'legacy_single_sku_parcel',
      sql: `
        BEGIN;
        INSERT INTO public.sales_return_items (
          id, sales_return_event_id, operation_id, order_id, order_item_id,
          return_scope, product_id, returned_quantity,
          refund_amount_snapshot_in_minor_units, stock_disposition
        ) VALUES (
          '91200000-0000-0000-0000-000000000226',
          '91200000-0000-0000-0000-000000000137',
          '91200000-0000-0000-0000-000000000136',
          '91200000-0000-0000-0000-000000000030',
          '91200000-0000-0000-0000-000000000221', 'base_unit',
          '91200000-0000-0000-0000-000000000011', 1, 1000, 'restock'
        );
        COMMIT;
      `,
      expectedError: {
        sqlState: '23514',
        constraint: 'sales_return_items_supported_line_kind_check',
      },
    },
  ];
  for (const testCase of returnModeFailures) {
    const stateBeforeRejection = await readReturnHistoryState({
      orderItemId: testCase.orderItemId,
      returnItemId: testCase.returnItemId,
      parcelInstanceId: testCase.parcelInstanceId || null,
    });
    await expectSqlFailure(testCase.sql, testCase.expectedError);
    const stateAfterRejection = await readReturnHistoryState({
      orderItemId: testCase.orderItemId,
      returnItemId: testCase.returnItemId,
      parcelInstanceId: testCase.parcelInstanceId || null,
    });
    assert.deepEqual(
      stateAfterRejection,
      stateBeforeRejection,
      `${testCase.label} changed historical state despite rejection.`,
    );
    await assertNoReturnItem(testCase.returnItemId);
    await assertOrderItemIdentity(
      testCase.orderItemId,
      testCase.expectedLineKind,
      '91200000-0000-0000-0000-000000000011',
    );
  }

  await runSql(`
    INSERT INTO public.sales_return_items (
      id, sales_return_event_id, operation_id, order_id, order_item_id,
      return_scope, parcel_instance_id, returned_quantity,
      refund_amount_snapshot_in_minor_units, stock_disposition
    ) VALUES (
      '91200000-0000-0000-0000-000000000227',
      '91200000-0000-0000-0000-000000000137',
      '91200000-0000-0000-0000-000000000136',
      '91200000-0000-0000-0000-000000000030',
      '${returnParcel.itemId}', 'parcel_instance', '${returnParcel.instanceId}',
      1, 5000, 'restock'
    );
  `);
  const validParcelReturn = await readJson(`
    SELECT jsonb_build_object(
      'scope', return_scope,
      'parcelInstanceId', parcel_instance_id,
      'productId', product_id
    )
    FROM public.sales_return_items
    WHERE id = '91200000-0000-0000-0000-000000000227';
  `);
  assert.deepEqual(validParcelReturn, {
    scope: 'parcel_instance',
    parcelInstanceId: returnParcel.instanceId,
    productId: null,
  });

  const returnedProductFixture = {
    orderItemId: '91200000-0000-0000-0000-000000000228',
    returnItemId: '91200000-0000-0000-0000-000000000229',
  };
  await runSql(`
    INSERT INTO public.order_items (
      id, order_id, product_id, product_name_snapshot, sku_snapshot,
      quantity, unit_price_in_minor_units, line_total_in_minor_units,
      commercial_line_kind
    ) VALUES (
      '${returnedProductFixture.orderItemId}',
      '91200000-0000-0000-0000-000000000030',
      '91200000-0000-0000-0000-000000000011',
      'Returned product immutability', 'PARCEL-A',
      1, 1000, 1000, 'base_unit'
    );
    INSERT INTO public.sales_return_items (
      id, sales_return_event_id, operation_id, order_id, order_item_id,
      return_scope, product_id, returned_quantity,
      refund_amount_snapshot_in_minor_units, stock_disposition
    ) VALUES (
      '${returnedProductFixture.returnItemId}',
      '91200000-0000-0000-0000-000000000137',
      '91200000-0000-0000-0000-000000000136',
      '91200000-0000-0000-0000-000000000030',
      '${returnedProductFixture.orderItemId}', 'base_unit',
      '91200000-0000-0000-0000-000000000011', 1, 1000, 'restock'
    );
  `);
  const returnedProductStateBefore = await readReturnHistoryState({
    orderItemId: returnedProductFixture.orderItemId,
    returnItemId: returnedProductFixture.returnItemId,
  });
  await expectSqlFailure(`
    BEGIN;
    UPDATE public.order_items
    SET product_id = '91200000-0000-0000-0000-000000000012'
    WHERE id = '${returnedProductFixture.orderItemId}';
    COMMIT;
  `, {
    sqlState: 'P0001',
    applicationIdentity: 'RETURNED_ORDER_ITEM_IMMUTABLE',
  });
  const returnedProductStateAfter = await readReturnHistoryState({
    orderItemId: returnedProductFixture.orderItemId,
    returnItemId: returnedProductFixture.returnItemId,
  });
  assert.deepEqual(
    returnedProductStateAfter,
    returnedProductStateBefore,
    'Rejected product mutation changed Return or Order Item history.',
  );

  const relationshipFailures = [
    {
      label: 'base reservation product mismatch',
      expectedError: {
        sqlState: '23514',
        constraint: 'order_inventory_reservations_base_product_check',
      },
      sql: `
        BEGIN;
        INSERT INTO public.order_inventory_reservations (
          id, operation_id, order_id, order_item_id, parcel_instance_id,
          warehouse_id, product_id, reserved_quantity
        ) VALUES (
          '91200000-0000-0000-0000-000000000126',
          '91200000-0000-0000-0000-000000000031',
          '91200000-0000-0000-0000-000000000030',
          '91200000-0000-0000-0000-000000000119', NULL,
          '91200000-0000-0000-0000-000000000021',
          '91200000-0000-0000-0000-000000000012', 1
        );
        COMMIT;
      `,
    },
    {
      label: 'parcel reservation missing Parcel identity',
      expectedError: {
        sqlState: '23514',
        constraint: 'order_inventory_reservations_parcel_required_check',
      },
      sql: `
        BEGIN;
        INSERT INTO public.order_inventory_reservations (
          id, operation_id, order_id, order_item_id, parcel_instance_id,
          warehouse_id, product_id, reserved_quantity
        ) VALUES (
          '91200000-0000-0000-0000-000000000127',
          '91200000-0000-0000-0000-000000000031',
          '91200000-0000-0000-0000-000000000030',
          '${validParcel.itemId}', NULL,
          '91200000-0000-0000-0000-000000000021',
          '91200000-0000-0000-0000-000000000011', 1
        );
        COMMIT;
      `,
    },
    {
      label: 'reservation product mismatch',
      expectedError: {
        sqlState: '23503',
        constraint: 'order_inventory_reservations_parcel_instance_id_product_id_fkey',
      },
      sql: `
        BEGIN;
        INSERT INTO public.order_inventory_reservations (
          id, operation_id, order_id, order_item_id, parcel_instance_id,
          warehouse_id, product_id, reserved_quantity
        ) VALUES (
          '91200000-0000-0000-0000-000000000092',
          '91200000-0000-0000-0000-000000000031',
          '91200000-0000-0000-0000-000000000030',
          '${validParcel.itemId}', '${validParcel.instanceId}',
          '91200000-0000-0000-0000-000000000021',
          '91200000-0000-0000-0000-000000000013', 1
        );
        COMMIT;
      `,
    },
    {
      label: 'movement NULL operation bypass',
      expectedError: {
        sqlState: '23514',
        constraint: 'inventory_movements_parcel_identity_shape_check',
      },
      sql: `
        BEGIN;
        INSERT INTO public.inventory_movements (
          id, warehouse_id, product_id, movement_type, quantity,
          balance_before, balance_after, parcel_component_id
        ) VALUES (
          '91200000-0000-0000-0000-000000000093',
          '91200000-0000-0000-0000-000000000021',
          '91200000-0000-0000-0000-000000000011',
          'sales_deduction', -1, 10, 9, '${validParcel.componentId}'
        );
        COMMIT;
      `,
    },
    {
      label: 'movement component product mismatch',
      expectedError: {
        sqlState: '23503',
        constraint: 'inventory_movements_component_operation_fk',
      },
      sql: `
        BEGIN;
        INSERT INTO public.inventory_movements (
          id, warehouse_id, product_id, movement_type, quantity,
          balance_before, balance_after, operation_id, parcel_component_id
        ) VALUES (
          '91200000-0000-0000-0000-000000000094',
          '91200000-0000-0000-0000-000000000021',
          '91200000-0000-0000-0000-000000000012',
          'sales_deduction', -1, 10, 9,
          '91200000-0000-0000-0000-000000000031',
          '${validParcel.componentId}'
        );
        COMMIT;
      `,
    },
    {
      label: 'movement cross-Parcel source mismatch',
      expectedError: {
        sqlState: '23514',
        constraint: 'inventory_movements_source_chain_check',
      },
      sql: `
        BEGIN;
        INSERT INTO public.inventory_movements (
          id, warehouse_id, product_id, movement_type, quantity,
          balance_before, balance_after, operation_id,
          parcel_component_id, reservation_id
        ) VALUES (
          '91200000-0000-0000-0000-000000000128',
          '91200000-0000-0000-0000-000000000021',
          '91200000-0000-0000-0000-000000000011',
          'sales_deduction', -1, 10, 9,
          '91200000-0000-0000-0000-000000000031',
          '${validParcel.componentId}',
          '91200000-0000-0000-0000-000000000124'
        );
        COMMIT;
      `,
    },
    {
      label: 'movement reservation warehouse mismatch',
      expectedError: {
        sqlState: '23514',
        constraint: 'inventory_movements_reservation_warehouse_check',
      },
      sql: `
        BEGIN;
        INSERT INTO public.inventory_movements (
          id, warehouse_id, product_id, movement_type, quantity,
          balance_before, balance_after, operation_id, reservation_id
        ) VALUES (
          '91200000-0000-0000-0000-000000000129',
          '91200000-0000-0000-0000-000000000130',
          '91200000-0000-0000-0000-000000000011',
          'sales_deduction', -1, 10, 9,
          '91200000-0000-0000-0000-000000000031',
          '91200000-0000-0000-0000-000000000112'
        );
        COMMIT;
      `,
    },
    {
      label: 'base return wrong SKU',
      expectedError: {
        sqlState: '23514',
        constraint: 'sales_return_items_base_line_kind_check',
      },
      sql: `
        BEGIN;
        INSERT INTO public.sales_return_items (
          id, sales_return_event_id, operation_id, order_id, order_item_id,
          return_scope, product_id, returned_quantity,
          refund_amount_snapshot_in_minor_units, stock_disposition
        ) VALUES (
          '91200000-0000-0000-0000-000000000095',
          '91200000-0000-0000-0000-000000000052',
          '91200000-0000-0000-0000-000000000051',
          '91200000-0000-0000-0000-000000000030',
          '91200000-0000-0000-0000-000000000119',
          'base_unit', '91200000-0000-0000-0000-000000000012',
          1, 1000, 'restock'
        );
        COMMIT;
      `,
    },
    {
      label: 'supplier Family configuration mismatch',
      expectedError: {
        sqlState: '23503',
        constraint: 'supplier_receipt_commercial_l_parcel_configuration_id_fami_fkey',
      },
      sql: `
        BEGIN;
        INSERT INTO public.supplier_receipt_commercial_lines (
          id, supplier_receipt_id, operation_id, line_sequence,
          commercial_line_kind, family_product_id, parcel_configuration_id,
          configuration_revision, commercial_quantity,
          units_per_parcel_snapshot, base_unit_name_snapshot,
          parcel_unit_name_snapshot, gross_amount_snapshot_in_minor_units,
          discount_snapshot_in_minor_units, line_total_snapshot_in_minor_units
        ) VALUES (
          '91200000-0000-0000-0000-000000000096',
          '91200000-0000-0000-0000-000000000061',
          '91200000-0000-0000-0000-000000000031', 9,
          'configurable_parcel',
          '91200000-0000-0000-0000-000000000013',
          '91200000-0000-0000-0000-000000000032',
          2, 1, 5, 'باكيت', 'طرد', 4000, 0, 4000
        );
        COMMIT;
      `,
    },
    {
      label: 'supplier component product mismatch',
      expectedError: {
        sqlState: '23514',
        constraint: 'supplier_receipt_item_commercial_family_check',
      },
      sql: `
        BEGIN;
        INSERT INTO public.supplier_receipt_items (
          id, supplier_receipt_id, product_id, package_quantity,
          units_per_package, total_base_units, package_price_in_minor_units,
          base_unit_cost_in_minor_units, line_total_in_minor_units,
          commercial_line_id, operation_id
        ) VALUES (
          '91200000-0000-0000-0000-000000000097',
          '91200000-0000-0000-0000-000000000061',
          '91200000-0000-0000-0000-000000000013',
          1, 1, 1, 800, 800, 800,
          '91200000-0000-0000-0000-000000000063',
          '91200000-0000-0000-0000-000000000031'
        );
        COMMIT;
      `,
    },
    {
      label: 'movement operation chain mismatch',
      expectedError: {
        sqlState: '23503',
        constraint: 'inventory_movements_component_operation_fk',
      },
      sql: `
        BEGIN;
        INSERT INTO public.inventory_movements (
          id, warehouse_id, product_id, movement_type, quantity,
          balance_before, balance_after, operation_id, parcel_component_id
        ) VALUES (
          '91200000-0000-0000-0000-000000000098',
          '91200000-0000-0000-0000-000000000021',
          '91200000-0000-0000-0000-000000000011',
          'sales_deduction', -1, 10, 9,
          '91200000-0000-0000-0000-000000000041',
          '${validParcel.componentId}'
        );
        COMMIT;
      `,
    },
    {
      label: 'movement reservation product mismatch',
      expectedError: {
        sqlState: '23503',
        constraint: 'inventory_movements_reservation_operation_fk',
      },
      sql: `
        BEGIN;
        INSERT INTO public.inventory_movements (
          id, warehouse_id, product_id, movement_type, quantity,
          balance_before, balance_after, operation_id, reservation_id
        ) VALUES (
          '91200000-0000-0000-0000-000000000113',
          '91200000-0000-0000-0000-000000000021',
          '91200000-0000-0000-0000-000000000012',
          'sales_deduction', -1, 10, 9,
          '91200000-0000-0000-0000-000000000031',
          '91200000-0000-0000-0000-000000000112'
        );
        COMMIT;
      `,
    },
  ];
  await runSql(`
    UPDATE public.configurable_parcel_feature_settings
    SET feature_state = 'ENABLED', updated_at = NOW()
    WHERE feature_key = 'configurable_parcels';
  `);
  for (const testCase of relationshipFailures) {
    await expectSqlFailure(testCase.sql, testCase.expectedError);
  }
  const failedRelationshipRows = await readJson(`
    SELECT jsonb_build_object(
      'reservations', (SELECT COUNT(*) FROM public.order_inventory_reservations WHERE id IN (
        '91200000-0000-0000-0000-000000000092',
        '91200000-0000-0000-0000-000000000126',
        '91200000-0000-0000-0000-000000000127'
      )),
      'movements', (SELECT COUNT(*) FROM public.inventory_movements WHERE id IN (
        '91200000-0000-0000-0000-000000000093',
        '91200000-0000-0000-0000-000000000094',
        '91200000-0000-0000-0000-000000000098',
        '91200000-0000-0000-0000-000000000113',
        '91200000-0000-0000-0000-000000000128',
        '91200000-0000-0000-0000-000000000129'
      )),
      'returns', (SELECT COUNT(*) FROM public.sales_return_items WHERE id = '91200000-0000-0000-0000-000000000095'),
      'supplierLines', (SELECT COUNT(*) FROM public.supplier_receipt_commercial_lines WHERE id = '91200000-0000-0000-0000-000000000096'),
      'supplierItems', (SELECT COUNT(*) FROM public.supplier_receipt_items WHERE id = '91200000-0000-0000-0000-000000000097')
    );
  `);
  assert.deepEqual(failedRelationshipRows, {
    reservations: 0,
    movements: 0,
    returns: 0,
    supplierLines: 0,
    supplierItems: 0,
  });

  const conflictingMovementAttempt = (
    movementId,
    componentId,
    reservationId,
  ) => runSql(`
    BEGIN;
    SET LOCAL lock_timeout = '10s';
    INSERT INTO public.inventory_movements (
      id, warehouse_id, product_id, movement_type, quantity,
      balance_before, balance_after, operation_id,
      parcel_component_id, reservation_id
    ) VALUES (
      '${movementId}',
      '91200000-0000-0000-0000-000000000021',
      '91200000-0000-0000-0000-000000000011',
      'sales_deduction', -1, 10, 9,
      '91200000-0000-0000-0000-000000000031',
      '${componentId}', '${reservationId}'
    );
    COMMIT;
  `);
  const concurrentRelationshipResults = await Promise.allSettled([
    conflictingMovementAttempt(
      '91200000-0000-0000-0000-000000000139',
      validParcel.componentId,
      '91200000-0000-0000-0000-000000000124',
    ),
    conflictingMovementAttempt(
      '91200000-0000-0000-0000-000000000140',
      secondParcel.componentId,
      '91200000-0000-0000-0000-000000000112',
    ),
  ]);
  for (const resultItem of concurrentRelationshipResults) {
    assert.equal(resultItem.status, 'rejected');
    assertSqlFailureIdentity(
      resultItem.reason instanceof Error
        ? resultItem.reason.message
        : String(resultItem.reason),
      {
        sqlState: '23514',
        constraint: 'inventory_movements_source_chain_check',
      },
    );
  }
  const concurrentRelationshipState = await readJson(`
    SELECT jsonb_build_object(
      'movements', (SELECT COUNT(*) FROM public.inventory_movements WHERE id IN (
        '91200000-0000-0000-0000-000000000139',
        '91200000-0000-0000-0000-000000000140'
      ))
    );
  `);
  assert.deepEqual(concurrentRelationshipState, { movements: 0 });

  await runSql(`
    INSERT INTO public.order_items (
      id, order_id, product_id, product_name_snapshot, sku_snapshot,
      quantity, unit_price_in_minor_units, line_total_in_minor_units,
      commercial_line_kind
    ) VALUES (
      '91200000-0000-0000-0000-000000000141',
      '91200000-0000-0000-0000-000000000030',
      '91200000-0000-0000-0000-000000000011',
      'Concurrent Base reservation item', 'PARCEL-A',
      1, 1000, 1000, 'base_unit'
    );
  `);
  const reservationBuilder = runSql(`
    SET application_name = 'base_reservation_builder_test';
    BEGIN;
    SET LOCAL statement_timeout = '15s';
    INSERT INTO public.order_inventory_reservations (
      id, operation_id, order_id, order_item_id, parcel_instance_id,
      warehouse_id, product_id, reserved_quantity
    ) VALUES (
      '91200000-0000-0000-0000-000000000142',
      '91200000-0000-0000-0000-000000000031',
      '91200000-0000-0000-0000-000000000030',
      '91200000-0000-0000-0000-000000000141', NULL,
      '91200000-0000-0000-0000-000000000021',
      '91200000-0000-0000-0000-000000000011', 1
    );
    SELECT pg_sleep(5);
    COMMIT;
  `);
  const reservationRaceActivitySql = `
    SELECT jsonb_build_object(
      'builderReady', EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE application_name = 'base_reservation_builder_test'
          AND wait_event = 'PgSleep'
      ),
      'mutatorWaiting', EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE application_name = 'base_reservation_item_mutator_test'
          AND wait_event_type = 'Lock'
      )
    );
  `;
  await waitForDatabaseState(
    reservationRaceActivitySql,
    (state) => state.builderReady === true,
    'Base reservation builder to hold the Order Item lock',
  );
  const reservationItemMutator = runSql(`
    SET application_name = 'base_reservation_item_mutator_test';
    BEGIN;
    SET LOCAL lock_timeout = '10s';
    UPDATE public.order_items
    SET product_id = '91200000-0000-0000-0000-000000000012'
    WHERE id = '91200000-0000-0000-0000-000000000141';
    COMMIT;
  `);
  const reservationRaceLockState = await waitForDatabaseState(
    reservationRaceActivitySql,
    (state) => state.builderReady === true && state.mutatorWaiting === true,
    'Base Order Item mutation to wait for reservation construction',
  );
  const [reservationBuilderResult, reservationMutatorResult] =
    await Promise.allSettled([reservationBuilder, reservationItemMutator]);
  assert.equal(reservationBuilderResult.status, 'fulfilled');
  assert.equal(reservationMutatorResult.status, 'rejected');
  assertSqlFailureIdentity(
    reservationMutatorResult.reason instanceof Error
      ? reservationMutatorResult.reason.message
      : String(reservationMutatorResult.reason),
    {
      sqlState: 'P0001',
      applicationIdentity: 'RESERVED_ORDER_ITEM_IMMUTABLE',
    },
  );
  assert.deepEqual(reservationRaceLockState, {
    builderReady: true,
    mutatorWaiting: true,
  });
  const reservationRaceState = await readJson(`
    SELECT jsonb_build_object(
      'itemProduct', (SELECT product_id FROM public.order_items WHERE id = '91200000-0000-0000-0000-000000000141'),
      'reservationProduct', (SELECT product_id FROM public.order_inventory_reservations WHERE id = '91200000-0000-0000-0000-000000000142'),
      'reservations', (SELECT COUNT(*) FROM public.order_inventory_reservations WHERE id = '91200000-0000-0000-0000-000000000142')
    );
  `);
  assert.deepEqual(reservationRaceState, {
    itemProduct: '91200000-0000-0000-0000-000000000011',
    reservationProduct: '91200000-0000-0000-0000-000000000011',
    reservations: 1,
  });

  await runSql(`
    INSERT INTO public.order_items (
      id, order_id, product_id, product_name_snapshot, sku_snapshot,
      quantity, unit_price_in_minor_units, line_total_in_minor_units,
      commercial_line_kind
    ) VALUES (
      '91200000-0000-0000-0000-000000000230',
      '91200000-0000-0000-0000-000000000030',
      '91200000-0000-0000-0000-000000000011',
      'Concurrent Return Base Unit', 'PARCEL-A', 1, 1000, 1000, 'base_unit'
    );
  `);
  const returnBuilder = runSql(`
    SET application_name = 'return_item_builder_lock_test';
    BEGIN;
    SET LOCAL statement_timeout = '15s';
    INSERT INTO public.sales_return_items (
      id, sales_return_event_id, operation_id, order_id, order_item_id,
      return_scope, product_id, returned_quantity,
      refund_amount_snapshot_in_minor_units, stock_disposition
    ) VALUES (
      '91200000-0000-0000-0000-000000000231',
      '91200000-0000-0000-0000-000000000137',
      '91200000-0000-0000-0000-000000000136',
      '91200000-0000-0000-0000-000000000030',
      '91200000-0000-0000-0000-000000000230', 'base_unit',
      '91200000-0000-0000-0000-000000000011', 1, 1000, 'restock'
    );
    SELECT pg_sleep(5);
    COMMIT;
  `);
  const returnRaceActivitySql = `
    SELECT jsonb_build_object(
      'builderReady', EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE application_name = 'return_item_builder_lock_test'
          AND wait_event = 'PgSleep'
      ),
      'mutatorWaiting', EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE application_name = 'return_item_mutator_lock_test'
          AND wait_event_type = 'Lock'
      )
    );
  `;
  await waitForDatabaseState(
    returnRaceActivitySql,
    (state) => state.builderReady === true,
    'Return Item builder to hold the Order Item lock',
  );
  const returnItemMutator = runSql(`
    SET application_name = 'return_item_mutator_lock_test';
    BEGIN;
    SET LOCAL lock_timeout = '10s';
    UPDATE public.order_items
    SET commercial_line_kind = 'configurable_parcel'
    WHERE id = '91200000-0000-0000-0000-000000000230';
    COMMIT;
  `);
  const returnRaceLockState = await waitForDatabaseState(
    returnRaceActivitySql,
    (state) => state.builderReady === true && state.mutatorWaiting === true,
    'Order Item mutation to wait for Return Item construction',
  );
  const [returnBuilderResult, returnMutatorResult] =
    await Promise.allSettled([returnBuilder, returnItemMutator]);
  assert.equal(returnBuilderResult.status, 'fulfilled');
  assert.equal(returnMutatorResult.status, 'rejected');
  assertSqlFailureIdentity(
    returnMutatorResult.reason instanceof Error
      ? returnMutatorResult.reason.message
      : String(returnMutatorResult.reason),
    {
      sqlState: 'P0001',
      applicationIdentity: 'RETURNED_ORDER_ITEM_IMMUTABLE',
    },
  );
  assert.deepEqual(returnRaceLockState, {
    builderReady: true,
    mutatorWaiting: true,
  });
  const returnRaceState = await readJson(`
    SELECT jsonb_build_object(
      'lineKind', item.commercial_line_kind,
      'productId', item.product_id,
      'returnScope', return_item.return_scope,
      'returnProductId', return_item.product_id,
      'returnItems', (
        SELECT COUNT(*) FROM public.sales_return_items
        WHERE id = '91200000-0000-0000-0000-000000000231'
      )
    )
    FROM public.order_items item
    JOIN public.sales_return_items return_item
      ON return_item.order_item_id = item.id
    WHERE item.id = '91200000-0000-0000-0000-000000000230';
  `);
  assert.deepEqual(returnRaceState, {
    lineKind: 'base_unit',
    productId: '91200000-0000-0000-0000-000000000011',
    returnScope: 'base_unit',
    returnProductId: '91200000-0000-0000-0000-000000000011',
    returnItems: 1,
  });

  await runSql(`
    UPDATE public.configurable_parcel_feature_settings
    SET feature_state = 'OFF', updated_at = NOW()
    WHERE feature_key = 'configurable_parcels';
  `);

  await runSql(`
    UPDATE public.configurable_parcel_feature_settings
    SET feature_state = 'ENABLED', updated_at = NOW()
    WHERE feature_key = 'configurable_parcels';
    INSERT INTO public.order_items (
      id, order_id, product_name_snapshot, quantity,
      unit_price_in_minor_units, line_total_in_minor_units,
      commercial_line_kind, family_product_id, parcel_configuration_id,
      parcel_configuration_revision, base_unit_name_snapshot,
      allocated_discount_snapshot_in_minor_units,
      net_refundable_amount_snapshot_in_minor_units
    ) VALUES (
      '91200000-0000-0000-0000-000000000114',
      '91200000-0000-0000-0000-000000000030',
      'Concurrent incomplete attempts', 10, 5000, 10000,
      'configurable_parcel',
      '91200000-0000-0000-0000-000000000010',
      '91200000-0000-0000-0000-000000000032',
      2, 'باكيت', 0, 10000
    );
  `);
  const incompleteAttempt = (instanceId, componentId, sequence) => runSql(`
    BEGIN;
    SET LOCAL lock_timeout = '10s';
    INSERT INTO public.order_parcel_instances (
      id, order_item_id, order_id, operation_id, parcel_configuration_id,
      family_product_id, instance_sequence, configuration_revision,
      units_per_parcel_snapshot, parcel_unit_name_snapshot,
      gross_amount_snapshot_in_minor_units,
      allocated_discount_snapshot_in_minor_units,
      net_refundable_amount_snapshot_in_minor_units,
      cogs_snapshot_in_minor_units, composition_fingerprint
    ) VALUES (
      '${instanceId}', '91200000-0000-0000-0000-000000000114',
      '91200000-0000-0000-0000-000000000030',
      '91200000-0000-0000-0000-000000000031',
      '91200000-0000-0000-0000-000000000032',
      '91200000-0000-0000-0000-000000000010',
      ${sequence}, 2, 5, 'طرد', 5000, 0, 5000, 3200, repeat('a', 64)
    );
    INSERT INTO public.order_parcel_components (
      id, parcel_instance_id, operation_id, product_id, base_quantity,
      product_name_snapshot, sku_snapshot, base_unit_name_snapshot,
      unit_cost_snapshot_in_minor_units, cogs_snapshot_in_minor_units
    ) VALUES (
      '${componentId}', '${instanceId}',
      '91200000-0000-0000-0000-000000000031',
      '91200000-0000-0000-0000-000000000011',
      4, 'نكهة أ', 'PARCEL-A', 'باكيت', 800, 3200
    );
    COMMIT;
  `);
  const concurrentIncompleteResults = await Promise.allSettled([
    incompleteAttempt(
      '91200000-0000-0000-0000-000000000115',
      '91200000-0000-0000-0000-000000000116',
      24,
    ),
    incompleteAttempt(
      '91200000-0000-0000-0000-000000000117',
      '91200000-0000-0000-0000-000000000118',
      25,
    ),
  ]);
  for (const resultItem of concurrentIncompleteResults) {
    assert.equal(resultItem.status, 'rejected');
    assertSqlFailureIdentity(
      resultItem.reason instanceof Error
        ? resultItem.reason.message
        : String(resultItem.reason),
      {
        sqlState: '23514',
        constraint: 'order_parcel_instance_finalized_at_check',
      },
    );
  }
  const concurrentIncompleteState = await readJson(`
    SELECT jsonb_build_object(
      'instances', (SELECT COUNT(*) FROM public.order_parcel_instances WHERE id IN (
        '91200000-0000-0000-0000-000000000115',
        '91200000-0000-0000-0000-000000000117'
      )),
      'components', (SELECT COUNT(*) FROM public.order_parcel_components WHERE id IN (
        '91200000-0000-0000-0000-000000000116',
        '91200000-0000-0000-0000-000000000118'
      ))
    );
  `);
  assert.deepEqual(concurrentIncompleteState, { instances: 0, components: 0 });
  await runSql(`
    DELETE FROM public.order_items
    WHERE id = '91200000-0000-0000-0000-000000000114';
    UPDATE public.configurable_parcel_feature_settings
    SET feature_state = 'OFF', updated_at = NOW()
    WHERE feature_key = 'configurable_parcels';
  `);

  await runSql(`
    UPDATE public.configurable_parcel_feature_settings
    SET feature_state = 'ENABLED', updated_at = NOW()
    WHERE feature_key = 'configurable_parcels';
    INSERT INTO public.order_items (
      id, order_id, product_name_snapshot, quantity,
      unit_price_in_minor_units, line_total_in_minor_units,
      commercial_line_kind, family_product_id, parcel_configuration_id,
      parcel_configuration_revision, base_unit_name_snapshot,
      allocated_discount_snapshot_in_minor_units,
      net_refundable_amount_snapshot_in_minor_units
    ) VALUES (
      '91200000-0000-0000-0000-000000000100',
      '91200000-0000-0000-0000-000000000030',
      'Lock hierarchy parcel', 5, 5000, 5000, 'configurable_parcel',
      '91200000-0000-0000-0000-000000000010',
      '91200000-0000-0000-0000-000000000032',
      2, 'باكيت', 0, 5000
    );
  `);

  const builder = runSql(`
    SET application_name = 'parcel_builder_lock_test';
    BEGIN;
    SET LOCAL statement_timeout = '15s';
    INSERT INTO public.order_parcel_instances (
      id, order_item_id, order_id, operation_id, parcel_configuration_id,
      family_product_id, instance_sequence, configuration_revision,
      units_per_parcel_snapshot, parcel_unit_name_snapshot,
      gross_amount_snapshot_in_minor_units,
      allocated_discount_snapshot_in_minor_units,
      net_refundable_amount_snapshot_in_minor_units,
      cogs_snapshot_in_minor_units, composition_fingerprint
    ) VALUES (
      '91200000-0000-0000-0000-000000000101',
      '91200000-0000-0000-0000-000000000100',
      '91200000-0000-0000-0000-000000000030',
      '91200000-0000-0000-0000-000000000031',
      '91200000-0000-0000-0000-000000000032',
      '91200000-0000-0000-0000-000000000010',
      20, 2, 5, 'طرد', 5000, 0, 5000, 4000, repeat('9', 64)
    );
    INSERT INTO public.order_parcel_components (
      id, parcel_instance_id, operation_id, product_id, base_quantity,
      product_name_snapshot, sku_snapshot, base_unit_name_snapshot,
      unit_cost_snapshot_in_minor_units, cogs_snapshot_in_minor_units
    ) VALUES (
      '91200000-0000-0000-0000-000000000102',
      '91200000-0000-0000-0000-000000000101',
      '91200000-0000-0000-0000-000000000031',
      '91200000-0000-0000-0000-000000000011',
      5, 'نكهة أ', 'PARCEL-A', 'باكيت', 800, 4000
    );
    SELECT pg_advisory_xact_lock(112001);
    SELECT pg_sleep(5);
    SELECT public.finalize_order_parcel_instance_internal(
      '91200000-0000-0000-0000-000000000101'
    );
    COMMIT;
  `);

  const activitySql = `
    SELECT jsonb_build_object(
      'builderReady', EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE application_name = 'parcel_builder_lock_test'
          AND wait_event = 'PgSleep'
      ),
      'mutatorWaiting', EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE application_name = 'parcel_item_mutator_lock_test'
          AND wait_event_type = 'Lock'
      )
    );
  `;
  await waitForDatabaseState(
    activitySql,
    (state) => state.builderReady === true,
    'Parcel builder to hold the Order Item lock',
  );

  const mutator = runSql(`
    SET application_name = 'parcel_item_mutator_lock_test';
    BEGIN;
    SET LOCAL lock_timeout = '10s';
    UPDATE public.order_items
    SET commercial_line_kind = 'base_unit'
    WHERE id = '91200000-0000-0000-0000-000000000100';
    COMMIT;
  `);
  const observedLockState = await waitForDatabaseState(
    activitySql,
    (state) => state.builderReady === true && state.mutatorWaiting === true,
    'Order Item mutation to wait on the shared lock hierarchy',
  );
  const [builderResult, mutatorResult] = await Promise.allSettled([
    builder,
    mutator,
  ]);
  assert.equal(builderResult.status, 'fulfilled');
  assert.equal(mutatorResult.status, 'rejected');
  assertSqlFailureIdentity(
    mutatorResult.reason instanceof Error
      ? mutatorResult.reason.message
      : String(mutatorResult.reason),
    {
      sqlState: 'P0001',
      applicationIdentity: 'PARCEL_LINE_IMMUTABLE',
    },
  );
  assert.deepEqual(observedLockState, {
    builderReady: true,
    mutatorWaiting: true,
  });

  const concurrencySummary = await readJson(`
    SELECT jsonb_build_object(
      'lineTotal', item.line_total_in_minor_units,
      'finalized', instance.finalized_at IS NOT NULL,
      'quantity', component.base_quantity
    )
    FROM public.order_items item
    JOIN public.order_parcel_instances instance
      ON instance.order_item_id = item.id
    JOIN public.order_parcel_components component
      ON component.parcel_instance_id = instance.id
    WHERE item.id = '91200000-0000-0000-0000-000000000100';
  `);
  assert.deepEqual(concurrencySummary, {
    lineTotal: 5000,
    finalized: true,
    quantity: 5,
  });
  await runSql(`
    UPDATE public.configurable_parcel_feature_settings
    SET feature_state = 'OFF', updated_at = NOW()
    WHERE feature_key = 'configurable_parcels';
  `);

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

  console.log(JSON.stringify({
    ok: true,
    migrationRebuild: '001-112',
    runtime: summary,
    commitBoundary: {
      incompleteCommitRejected: true,
      overfilledFinalizationRejected: true,
      failedTransactionsLeftNoRows: true,
      explicitRollbackLeftNoRows: true,
      completeParcelCommitted: true,
      concurrentIncompleteRejected: true,
    },
    relationshipIntegrity: {
      negativeCases: relationshipFailures.length,
      failedTransactionsLeftNoRows: true,
      positiveControlsPassed: true,
      concurrentConflictsRejected: true,
      baseReservationRaceSerialized: true,
    },
    lineKindIntegrity: {
      negativeCases: 11,
      strictErrorIdentity: true,
      parcelLineKindEnforced: true,
      returnModeEnforced: true,
      returnedProductImmutable: true,
      rejectedCasesPreservedHistory: true,
      legacyNewModelWritesRejected: true,
      positiveControlsPassed: true,
      returnRaceSerialized: true,
    },
    concurrency: {
      serializedAgainstFinalization: true,
      invalidFinalizationRolledBack: true,
      orderItemWaitObserved: observedLockState.mutatorWaiting,
      finalizedHistoryMutationRejected: true,
      deadlockDetected: false,
    },
    dbLint: (lintOutput || lintError).trim() || 'PASS',
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
