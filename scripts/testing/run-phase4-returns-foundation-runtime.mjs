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
const phase3SqlPath = path.join(
  scriptDirectory,
  'phase3-configurable-parcel-contracts-runtime.sql',
);
const phase4SqlPath = path.join(scriptDirectory, 'phase4-returns-foundation-runtime.sql');
const cliPath = path.join(projectRoot, 'node_modules', 'supabase', 'dist', 'supabase.js');
const projectId = 'nawasrah-phase4-foundation-test';
const databaseContainer = `supabase_db_${projectId}`;
let isolatedProjectRoot = '';

const runSqlText = async (sql, label) => {
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
      if (code !== 0) {
        reject(new Error(`${label} failed:\n${stderr}\n${stdout}`));
        return;
      }
      resolve(stdout.trim());
    });
    child.stdin.end(`SET statement_timeout='60s'; SET lock_timeout='30s';\n${sql}`);
  });
};

const runSql = async (sqlPath, label) => {
  const sql = await readFile(sqlPath, 'utf8');
  return runSqlText(sql, label);
};

const readJson = async (sql) => {
  const output = await runSqlText(sql, 'Phase 4.1 JSON query');
  const value = output.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).at(-1);
  assert.ok(value, 'Expected JSON SQL output.');
  return JSON.parse(value);
};

const startPsqlSession = (applicationName) => {
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
  child.stdin.write(
    `SET application_name = '${applicationName}'; SET statement_timeout='30s'; SET lock_timeout='20s';\n`,
  );
  const completed = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
  return {
    child,
    completed,
    output: () => ({ stdout, stderr }),
  };
};

const waitForOutput = async (session, marker, timeoutMs = 10_000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (session.output().stdout.includes(marker)) return;
    if (session.child.exitCode !== null) {
      const output = session.output();
      throw new Error(`Session ended before ${marker}:\n${output.stderr}\n${output.stdout}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const output = session.output();
  throw new Error(`Timed out waiting for ${marker}:\n${output.stderr}\n${output.stdout}`);
};

const waitForBlockedSession = async (applicationName, timeoutMs = 10_000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = await readJson(`SELECT jsonb_build_object('blocked',EXISTS(
      SELECT 1 FROM pg_stat_activity activity
      WHERE activity.application_name=${sqlLiteral(applicationName)}
        AND cardinality(pg_blocking_pids(activity.pid))>0));`);
    if (state.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out waiting for blocked session ${applicationName}.`);
};

const sqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;

const buildConcurrentReturnDraftSql = (fixture, identity, readyMarker) => {
  const componentRows = fixture.components.map((component) => `(
    ${sqlLiteral(identity.item)}, ${sqlLiteral(identity.operation)},
    ${sqlLiteral(component.id)}, ${sqlLiteral(component.operationId)},
    ${sqlLiteral(component.productId)}, ${Number(component.baseQuantity)}, 0,
    'sellable', 'restock'
  )`).join(',\n');
  const consumptionRows = fixture.components.map((component) => `(
    ${sqlLiteral(identity.operation)}, ${sqlLiteral(identity.item)},
    'parcel_component', ${sqlLiteral(component.id)}, ${sqlLiteral(component.productId)},
    ${Number(component.baseQuantity)}, 'return'
  )`).join(',\n');
  return `
BEGIN;
INSERT INTO public.business_operations(
  id, operation_type, idempotency_key, request_fingerprint, initiated_by,
  result_snapshot, completed_at, request_identity_version,
  request_identity_snapshot, actor_scope_type, actor_scope_hash
) VALUES (
  ${sqlLiteral(identity.operation)}, 'phase4_return_v1', ${sqlLiteral(identity.key)},
  repeat(${sqlLiteral(identity.fingerprint)}, 64), ${sqlLiteral(fixture.ownerId)},
  JSONB_BUILD_OBJECT('success',true,
    'operationId',${sqlLiteral(identity.operation)},
    'returnId',${sqlLiteral(identity.event)}), statement_timestamp(), 401,
  JSONB_BUILD_OBJECT('order_id', ${sqlLiteral(fixture.orderId)}),
  'erp_user', repeat(${sqlLiteral(identity.scopeHash)}, 64)
);
INSERT INTO public.sales_return_events(
  id, return_number, operation_id, order_id, branch_id, warehouse_id,
  cash_shift_id, reason, refund_method,
  merchandise_refund_amount_in_minor_units, contract_version,
  settlement_status, outstanding_debt_before_snapshot_in_minor_units,
  net_collected_before_snapshot_in_minor_units,
  debt_reduction_amount_in_minor_units, money_refund_amount_in_minor_units,
  raw_customer_damage_deduction_in_minor_units,
  applied_customer_damage_deduction_in_minor_units
) VALUES (
  ${sqlLiteral(identity.event)}, ${sqlLiteral(identity.returnNumber)},
  ${sqlLiteral(identity.operation)}, ${sqlLiteral(fixture.orderId)},
  ${sqlLiteral(fixture.branchId)}, ${sqlLiteral(fixture.warehouseId)},
  ${sqlLiteral(fixture.shiftId)}, 'Concurrent whole Parcel proof', 'cash',
  ${Number(fixture.entitlement)}, 401, 'draft', 0, ${Number(fixture.entitlement)},
  0, ${Number(fixture.entitlement)}, 0, 0
);
INSERT INTO public.sales_return_items(
  id, sales_return_event_id, operation_id, order_id, order_item_id,
  return_scope, parcel_instance_id, returned_quantity,
  refund_amount_snapshot_in_minor_units, stock_disposition,
  accepted_base_quantity, rejected_base_quantity,
  original_cogs_snapshot_in_minor_units,
  raw_customer_damage_deduction_in_minor_units,
  applied_customer_damage_deduction_in_minor_units
) VALUES (
  ${sqlLiteral(identity.item)}, ${sqlLiteral(identity.event)},
  ${sqlLiteral(identity.operation)}, ${sqlLiteral(fixture.orderId)},
  ${sqlLiteral(fixture.orderItemId)}, 'parcel_instance',
  ${sqlLiteral(fixture.parcelId)}, 1, ${Number(fixture.entitlement)}, 'restock',
  ${Number(fixture.units)}, 0, ${Number(fixture.cogs)}, 0, 0
);
INSERT INTO public.sales_return_component_inspections(
  sales_return_item_id, return_operation_id, parcel_component_id,
  original_sale_operation_id, product_id, accepted_quantity,
  rejected_quantity, accepted_condition, accepted_stock_disposition
) VALUES ${componentRows};
INSERT INTO public.sales_aftercare_consumptions(
  operation_id, return_item_id, source_kind, source_id, product_id,
  consumed_quantity, consumption_kind
) VALUES ${consumptionRows};
SELECT ${sqlLiteral(readyMarker)};
`;
};

const createConcurrentParcelFixture = async (suffix) => {
  const sale = await readJson(`${ownerClaimsSql}
    SELECT public.create_pos_sale_v2(
      '92400000-0000-0000-0000-000000000201',
      '92400000-0000-0000-0000-000000000200', NULL,
      ${sqlLiteral(`Phase 4 concurrent ${suffix}`)}, 'cash',
      jsonb_build_array(jsonb_build_object(
        'commercial_line_kind','configurable_parcel',
        'family_product_id','92400000-0000-0000-0000-000000000100',
        'parcel_configuration_id','92400000-0000-0000-0000-000000000300',
        'configuration_revision',1,'price_authority','server_catalog',
        'line_discount_in_minor_units',0,
        'parcel_instances',jsonb_build_array(jsonb_build_object(
          'components',jsonb_build_array(
            jsonb_build_object('product_id','92400000-0000-0000-0000-000000000101','base_quantity',2),
            jsonb_build_object('product_id','92400000-0000-0000-0000-000000000102','base_quantity',3)
          )
        ))
      )), 0, 5000, ${sqlLiteral(`phase4-concurrent-source-${suffix}`)}
    );
  `);
  assert.equal(sale.success, true);

  const fixture = await readJson(`
    SELECT JSONB_BUILD_OBJECT(
      'ownerId', '92400000-0000-0000-0000-000000000001',
      'orderId', customer_order.id,
      'orderItemId', item.id,
      'parcelId', instance.id,
      'branchId', customer_order.branch_id,
      'warehouseId', customer_order.warehouse_id,
      'shiftId', customer_order.cash_shift_id,
      'completion', public.phase4_authoritative_completion_internal(customer_order.id),
      'entitlement', instance.net_refundable_amount_snapshot_in_minor_units,
      'cogs', instance.cogs_snapshot_in_minor_units,
      'units', instance.units_per_parcel_snapshot,
      'components', (
        SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
          'id', component.id,
          'operationId', component.operation_id,
          'productId', component.product_id,
          'baseQuantity', component.base_quantity
        ) ORDER BY component.id)
        FROM public.order_parcel_components component
        WHERE component.parcel_instance_id = instance.id
      )
    )
    FROM public.orders customer_order
    JOIN public.order_items item ON item.order_id = customer_order.id
    JOIN public.order_parcel_instances instance ON instance.order_item_id = item.id
    WHERE customer_order.id = ${sqlLiteral(sale.orderId)}
      AND customer_order.status = 'completed'
      AND customer_order.source = 'pos'
      AND item.commercial_line_kind = 'configurable_parcel'
    ORDER BY instance.id LIMIT 1;
  `);
  assert.ok(fixture?.orderId && fixture?.shiftId && fixture?.components?.length > 0);
  return fixture;
};

const finalizeConcurrentReturnSql = (identity, marker) => `
SELECT public.phase4_finalize_aftercare_operation_internal(
  ${sqlLiteral(identity.operation)}
);
SELECT ${sqlLiteral(marker)};
COMMIT;
`;

const runConcurrentDraftFinalizationDirection = async ({
  fixture,
  first,
  second,
  winnerLabel,
}) => {
  const firstReady = `PHASE4_${winnerLabel}_DRAFT_READY`;
  const firstSettled = `PHASE4_${winnerLabel}_SETTLED`;
  const firstSession = startPsqlSession(`phase4-return-${winnerLabel.toLowerCase()}-first`);
  firstSession.child.stdin.write(
    buildConcurrentReturnDraftSql(fixture, first, firstReady),
  );
  await waitForOutput(firstSession, firstReady);

  const secondSession = startPsqlSession(`phase4-return-${winnerLabel.toLowerCase()}-second`);
  secondSession.child.stdin.end(`${buildConcurrentReturnDraftSql(
    fixture,
    second,
    `PHASE4_${winnerLabel}_SECOND_DRAFT_READY`,
  )}${finalizeConcurrentReturnSql(second, `PHASE4_${winnerLabel}_SECOND_SETTLED`)}`);

  let waitObserved = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const state = await readJson(`
      SELECT JSONB_BUILD_OBJECT(
        'blocked', EXISTS (
          SELECT 1 FROM pg_stat_activity activity
          WHERE activity.application_name = ${sqlLiteral(`phase4-return-${winnerLabel.toLowerCase()}-second`)}
            AND CARDINALITY(pg_blocking_pids(activity.pid)) > 0
        )
      );
    `);
    if (state.blocked) {
      waitObserved = true;
      break;
    }
    if (secondSession.child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(waitObserved, true, 'Competing Return never waited on the root Order gate.');

  const blockedState = await readJson(`SELECT JSONB_BUILD_OBJECT(
    'operationRows',(SELECT COUNT(*) FROM public.business_operations
      WHERE id=${sqlLiteral(second.operation)}),
    'eventRows',(SELECT COUNT(*) FROM public.sales_return_events
      WHERE operation_id=${sqlLiteral(second.operation)}),
    'itemRows',(SELECT COUNT(*) FROM public.sales_return_items
      WHERE operation_id=${sqlLiteral(second.operation)}),
    'inspectionRows',(SELECT COUNT(*) FROM public.sales_return_component_inspections
      WHERE return_operation_id=${sqlLiteral(second.operation)}),
    'consumptionRows',(SELECT COUNT(*) FROM public.sales_aftercare_consumptions
      WHERE operation_id=${sqlLiteral(second.operation)})
  );`);
  assert.deepEqual(blockedState, {
    operationRows: 0,
    eventRows: 0,
    itemRows: 0,
    inspectionRows: 0,
    consumptionRows: 0,
  });

  firstSession.child.stdin.end(finalizeConcurrentReturnSql(first, firstSettled));
  const [firstResult, secondResult] = await Promise.all([
    firstSession.completed,
    secondSession.completed,
  ]);
  assert.equal(firstResult.code, 0, `First Return failed:\n${firstResult.stderr}`);
  assert.match(firstResult.stdout, new RegExp(firstSettled, 'u'));
  assert.notEqual(secondResult.code, 0, 'Competing Return unexpectedly committed.');
  assert.match(
    secondResult.stderr,
    /ERROR:\s+P0001:\s+PHASE4_PARCEL_RETURN_ALREADY_CONSUMED:/u,
  );

  const finalState = await readJson(`SELECT JSONB_BUILD_OBJECT(
    'winnerOperationRows',(SELECT COUNT(*) FROM public.business_operations
      WHERE id=${sqlLiteral(first.operation)}),
    'winnerSettledEvents',(SELECT COUNT(*) FROM public.sales_return_events
      WHERE operation_id=${sqlLiteral(first.operation)} AND settlement_status='settled'),
    'winnerSettledConsumptionRows',(SELECT COUNT(*) FROM public.sales_aftercare_consumptions
      WHERE operation_id=${sqlLiteral(first.operation)} AND consumption_state='settled'),
    'winnerSettledQuantity',(SELECT COALESCE(SUM(consumed_quantity),0)
      FROM public.sales_aftercare_consumptions
      WHERE operation_id=${sqlLiteral(first.operation)} AND consumption_state='settled'),
    'loserOperationRows',(SELECT COUNT(*) FROM public.business_operations
      WHERE id=${sqlLiteral(second.operation)}),
    'loserEventRows',(SELECT COUNT(*) FROM public.sales_return_events
      WHERE operation_id=${sqlLiteral(second.operation)}),
    'loserItemRows',(SELECT COUNT(*) FROM public.sales_return_items
      WHERE operation_id=${sqlLiteral(second.operation)}),
    'loserInspectionRows',(SELECT COUNT(*) FROM public.sales_return_component_inspections
      WHERE return_operation_id=${sqlLiteral(second.operation)}),
    'loserConsumptionRows',(SELECT COUNT(*) FROM public.sales_aftercare_consumptions
      WHERE operation_id=${sqlLiteral(second.operation)}),
    'settledParcelReturns',(SELECT COUNT(*)
      FROM public.sales_return_items return_item
      JOIN public.sales_return_events return_event
        ON return_event.id=return_item.sales_return_event_id
      WHERE return_item.parcel_instance_id=${sqlLiteral(fixture.parcelId)}
        AND return_event.settlement_status='settled')
  );`);
  assert.equal(finalState.winnerOperationRows, 1);
  assert.equal(finalState.winnerSettledEvents, 1);
  assert.equal(finalState.winnerSettledConsumptionRows, fixture.components.length);
  assert.equal(Number(finalState.winnerSettledQuantity), Number(fixture.units));
  assert.equal(finalState.loserOperationRows, 0);
  assert.equal(finalState.loserEventRows, 0);
  assert.equal(finalState.loserItemRows, 0);
  assert.equal(finalState.loserInspectionRows, 0);
  assert.equal(finalState.loserConsumptionRows, 0);
  assert.equal(finalState.settledParcelReturns, 1);

  return {
    winner: winnerLabel,
    waitObserved,
    secondHadZeroPreGateWrites: true,
    exactlyOneSettlement: true,
    strictFailureIdentity: true,
    loserZeroPartialWrites: true,
    remainingEntitlementCorrect: true,
  };
};

const runConcurrentParcelReturnProof = async () => {
  const fixtureA = await createConcurrentParcelFixture('a-first');
  const fixtureB = await createConcurrentParcelFixture('b-first');

  const a1 = {
    operation: 'f4450000-0000-4000-8000-000000000001',
    event: 'f4450000-0000-4000-8000-000000000002',
    item: 'f4450000-0000-4000-8000-000000000003',
    key: 'phase4-concurrent-return-a1',
    returnNumber: 'P4-CONCURRENT-A1',
    fingerprint: 'a',
    scopeHash: 'b',
  };
  const b1 = {
    operation: 'f4460000-0000-4000-8000-000000000001',
    event: 'f4460000-0000-4000-8000-000000000002',
    item: 'f4460000-0000-4000-8000-000000000003',
    key: 'phase4-concurrent-return-b1',
    returnNumber: 'P4-CONCURRENT-B1',
    fingerprint: 'c',
    scopeHash: 'd',
  };
  const a2 = {
    operation: 'f4470000-0000-4000-8000-000000000001',
    event: 'f4470000-0000-4000-8000-000000000002',
    item: 'f4470000-0000-4000-8000-000000000003',
    key: 'phase4-concurrent-return-a2',
    returnNumber: 'P4-CONCURRENT-A2',
    fingerprint: 'e',
    scopeHash: 'f',
  };
  const b2 = {
    operation: 'f4480000-0000-4000-8000-000000000001',
    event: 'f4480000-0000-4000-8000-000000000002',
    item: 'f4480000-0000-4000-8000-000000000003',
    key: 'phase4-concurrent-return-b2',
    returnNumber: 'P4-CONCURRENT-B2',
    fingerprint: '1',
    scopeHash: '2',
  };
  const deadlocksBefore = await readJson(`
    SELECT JSONB_BUILD_OBJECT('value', deadlocks)
    FROM pg_stat_database WHERE datname = current_database();
  `);

  const directions = [
    await runConcurrentDraftFinalizationDirection({
      fixture: fixtureA, first: a1, second: b1, winnerLabel: 'A',
    }),
    await runConcurrentDraftFinalizationDirection({
      fixture: fixtureB, first: b2, second: a2, winnerLabel: 'B',
    }),
  ];
  const deadlocksAfter = await readJson(`
    SELECT JSONB_BUILD_OBJECT('value', deadlocks)
    FROM pg_stat_database WHERE datname = current_database();
  `);
  assert.equal(Number(deadlocksAfter.value) - Number(deadlocksBefore.value), 0);

  return {
    directions,
    bothStartOrders: true,
    waitObserved: directions.every((direction) => direction.waitObserved),
    earlyGateBeforeDraftWrites: directions.every(
      (direction) => direction.secondHadZeroPreGateWrites,
    ),
    oneSettlementWon: true,
    strictFailureIdentity: true,
    loserRolledBack: true,
    remainingEntitlementCorrect: true,
    deadlockDelta: 0,
  };
};

const runRootGateBlockedWrite = async ({ fixture, label, sql, zeroSql, successSql }) => {
  const blockerName = `phase4-family-${label}-blocker`;
  const writerName = `phase4-family-${label}-writer`;
  const blocker = startPsqlSession(blockerName);
  blocker.child.stdin.write(`BEGIN;
    SELECT pg_advisory_xact_lock(hashtextextended(
      'phase4-order|' || ${sqlLiteral(fixture.orderId)}::uuid::text,0));
    SELECT ${sqlLiteral(`PHASE4_${label}_ROOT_HELD`)};
  `);
  await waitForOutput(blocker, `PHASE4_${label}_ROOT_HELD`);
  const writer = startPsqlSession(writerName);
  writer.child.stdin.end(`BEGIN; ${sql}; COMMIT;`);
  let advisoryWaitObserved = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const wait = await readJson(`SELECT jsonb_build_object(
      'blocked',EXISTS(SELECT 1 FROM pg_stat_activity activity
        WHERE activity.application_name=${sqlLiteral(writerName)}
          AND cardinality(pg_blocking_pids(activity.pid))>0
          AND activity.wait_event_type='Lock'
          AND activity.wait_event='advisory'));
    `);
    if (wait.blocked) { advisoryWaitObserved = true; break; }
    if (writer.child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  assert.equal(advisoryWaitObserved, true, `${label} bypassed the root Order gate.`);
  const before = await readJson(zeroSql);
  assert.equal(Number(before.value), 0, `${label} wrote evidence before acquiring the root gate.`);
  blocker.child.stdin.end('COMMIT;\n');
  assert.equal((await blocker.completed).code, 0);
  const writerResult = await writer.completed;
  assert.equal(writerResult.code, 0, `${label} failed after root gate release:\n${writerResult.stderr}`);
  const after = await readJson(successSql);
  assert.equal(Number(after.value), 1, `${label} did not persist exactly one intended row.`);
  return { label, advisoryWaitObserved, zeroPreGateWrites: true, committedAfterRelease: true };
};

const runPhase4ChildAndCancellationLockMatrixProof = async () => {
  const fixture = await createConcurrentParcelFixture('family-lock-matrix');
  const component = fixture.components[0];
  const identities = {
    returnItem: ['f4500001-0000-4000-8000-000000000001', 'f4500001-0000-4000-8000-000000000002', 'f4500001-0000-4000-8000-000000000003'],
    inspection: ['f4500002-0000-4000-8000-000000000001', 'f4500002-0000-4000-8000-000000000002', 'f4500002-0000-4000-8000-000000000003'],
    replacement: ['f4500003-0000-4000-8000-000000000001', 'f4500003-0000-4000-8000-000000000002', 'f4500003-0000-4000-8000-000000000003'],
    cancel: ['f4500004-0000-4000-8000-000000000001', 'f4500004-0000-4000-8000-000000000002'],
    writerFirst: ['f4500005-0000-4000-8000-000000000001', 'f4500005-0000-4000-8000-000000000002', 'f4500005-0000-4000-8000-000000000003'],
    cancelFirst: ['f4500006-0000-4000-8000-000000000001', 'f4500006-0000-4000-8000-000000000002', 'f4500006-0000-4000-8000-000000000003'],
  };
  const operation = (id, event, type, key, hash) => `(
    ${sqlLiteral(id)},${sqlLiteral(type)},${sqlLiteral(key)},repeat(${sqlLiteral(hash)},64),
    ${sqlLiteral(fixture.ownerId)},jsonb_build_object('success',true,
      'operationId',${sqlLiteral(id)},
      ${sqlLiteral(type === 'phase4_return_v1' ? 'returnId' : 'replacementId')},${sqlLiteral(event)}),
    clock_timestamp(),401,jsonb_build_object('order_id',${sqlLiteral(fixture.orderId)}),
    'erp_user',repeat(${sqlLiteral(hash)},64))`;
  const returnEvent = (identity, number) => `(
    ${sqlLiteral(identity[1])},${sqlLiteral(number)},${sqlLiteral(identity[0])},
    ${sqlLiteral(fixture.orderId)},${sqlLiteral(fixture.branchId)},
    ${sqlLiteral(fixture.warehouseId)},${sqlLiteral(fixture.shiftId)},
    'Family lock proof','cash',${Number(fixture.entitlement)},401,'draft',
    0,${Number(fixture.entitlement)},0,${Number(fixture.entitlement)},0,0)`;
  const returnItem = (identity) => `INSERT INTO public.sales_return_items(
    id,sales_return_event_id,operation_id,order_id,order_item_id,
    return_scope,parcel_instance_id,returned_quantity,
    refund_amount_snapshot_in_minor_units,stock_disposition,
    accepted_base_quantity,rejected_base_quantity,
    original_cogs_snapshot_in_minor_units,
    raw_customer_damage_deduction_in_minor_units,
    applied_customer_damage_deduction_in_minor_units
  ) VALUES (${sqlLiteral(identity[2])},${sqlLiteral(identity[1])},${sqlLiteral(identity[0])},
    ${sqlLiteral(fixture.orderId)},${sqlLiteral(fixture.orderItemId)},
    'parcel_instance',${sqlLiteral(fixture.parcelId)},1,${Number(fixture.entitlement)},
    'restock',${Number(fixture.units)},0,${Number(fixture.cogs)},0,0)`;

  await runSqlText(`
    INSERT INTO public.business_operations(
      id,operation_type,idempotency_key,request_fingerprint,initiated_by,
      result_snapshot,completed_at,request_identity_version,
      request_identity_snapshot,actor_scope_type,actor_scope_hash
    ) VALUES
      ${operation(identities.returnItem[0],identities.returnItem[1],'phase4_return_v1','phase4-family-return-item','1')},
      ${operation(identities.inspection[0],identities.inspection[1],'phase4_return_v1','phase4-family-inspection','2')},
      ${operation(identities.replacement[0],identities.replacement[1],'phase4_replacement_v1','phase4-family-replacement','3')},
      ${operation(identities.cancel[0],identities.cancel[1],'phase4_return_v1','phase4-family-cancel','4')},
      ${operation(identities.writerFirst[0],identities.writerFirst[1],'phase4_return_v1','phase4-family-writer-first','5')},
      ${operation(identities.cancelFirst[0],identities.cancelFirst[1],'phase4_return_v1','phase4-family-cancel-first','6')};
    INSERT INTO public.sales_return_events(
      id,return_number,operation_id,order_id,branch_id,warehouse_id,
      cash_shift_id,reason,refund_method,
      merchandise_refund_amount_in_minor_units,contract_version,
      settlement_status,outstanding_debt_before_snapshot_in_minor_units,
      net_collected_before_snapshot_in_minor_units,
      debt_reduction_amount_in_minor_units,money_refund_amount_in_minor_units,
      raw_customer_damage_deduction_in_minor_units,
      applied_customer_damage_deduction_in_minor_units
    ) VALUES
      ${returnEvent(identities.returnItem,'P4-FAMILY-RETURN-ITEM')},
      ${returnEvent(identities.inspection,'P4-FAMILY-INSPECTION')},
      ${returnEvent(identities.cancel,'P4-FAMILY-CANCEL')},
      ${returnEvent(identities.writerFirst,'P4-FAMILY-WRITER-FIRST')},
      ${returnEvent(identities.cancelFirst,'P4-FAMILY-CANCEL-FIRST')};
    ${returnItem(identities.inspection)};
    INSERT INTO public.sales_replacement_events(
      id,operation_id,root_order_id,branch_id,warehouse_id,contract_version,
      original_completed_at_snapshot,reason,created_by
    ) VALUES (${sqlLiteral(identities.replacement[1])},${sqlLiteral(identities.replacement[0])},
      ${sqlLiteral(fixture.orderId)},${sqlLiteral(fixture.branchId)},
      ${sqlLiteral(fixture.warehouseId)},401,${sqlLiteral(fixture.completion)},
      'Family lock replacement',${sqlLiteral(fixture.ownerId)});
  `, 'Phase 4 child lock matrix fixture');

  const deadlocksBefore = await readJson(`SELECT jsonb_build_object('value',deadlocks)
    FROM pg_stat_database WHERE datname=current_database();`);
  const results = [];
  results.push(await runRootGateBlockedWrite({
    fixture, label: 'RETURN_ITEM', sql: returnItem(identities.returnItem),
    zeroSql: `SELECT jsonb_build_object('value',count(*)) FROM public.sales_return_items WHERE id=${sqlLiteral(identities.returnItem[2])};`,
    successSql: `SELECT jsonb_build_object('value',count(*)) FROM public.sales_return_items WHERE id=${sqlLiteral(identities.returnItem[2])};`,
  }));
  results.push(await runRootGateBlockedWrite({
    fixture, label: 'INSPECTION',
    sql: `INSERT INTO public.sales_return_component_inspections(
      sales_return_item_id,return_operation_id,parcel_component_id,
      original_sale_operation_id,product_id,accepted_quantity,rejected_quantity,
      accepted_condition,accepted_stock_disposition
    ) VALUES (${sqlLiteral(identities.inspection[2])},${sqlLiteral(identities.inspection[0])},
      ${sqlLiteral(component.id)},${sqlLiteral(component.operationId)},
      ${sqlLiteral(component.productId)},${Number(component.baseQuantity)},0,
      'sellable','restock')`,
    zeroSql: `SELECT jsonb_build_object('value',count(*)) FROM public.sales_return_component_inspections WHERE return_operation_id=${sqlLiteral(identities.inspection[0])};`,
    successSql: `SELECT jsonb_build_object('value',count(*)) FROM public.sales_return_component_inspections WHERE return_operation_id=${sqlLiteral(identities.inspection[0])};`,
  }));
  results.push(await runRootGateBlockedWrite({
    fixture, label: 'REPLACEMENT_ITEM',
    sql: `INSERT INTO public.sales_replacement_items(
      id,replacement_event_id,operation_id,root_order_item_id,
      root_parcel_instance_id,root_parcel_component_id,
      original_sale_operation_id,product_id,quantity,
      replacement_unit_cost_snapshot_in_minor_units_exact,
      replacement_cogs_snapshot_in_minor_units,condition_code
    ) VALUES (${sqlLiteral(identities.replacement[2])},${sqlLiteral(identities.replacement[1])},
      ${sqlLiteral(identities.replacement[0])},${sqlLiteral(fixture.orderItemId)},
      ${sqlLiteral(fixture.parcelId)},${sqlLiteral(component.id)},
      ${sqlLiteral(component.operationId)},${sqlLiteral(component.productId)},1,0,0,
      'supplier_defect')`,
    zeroSql: `SELECT jsonb_build_object('value',count(*)) FROM public.sales_replacement_items WHERE id=${sqlLiteral(identities.replacement[2])};`,
    successSql: `SELECT jsonb_build_object('value',count(*)) FROM public.sales_replacement_items WHERE id=${sqlLiteral(identities.replacement[2])};`,
  }));
  results.push(await runRootGateBlockedWrite({
    fixture, label: 'CONSUMPTION',
    sql: `INSERT INTO public.sales_aftercare_consumptions(
      operation_id,return_item_id,source_kind,source_id,product_id,
      consumed_quantity,consumption_kind
    ) VALUES (${sqlLiteral(identities.inspection[0])},${sqlLiteral(identities.inspection[2])},
      'parcel_component',${sqlLiteral(component.id)},${sqlLiteral(component.productId)},
      ${Number(component.baseQuantity)},'return')`,
    zeroSql: `SELECT jsonb_build_object('value',count(*)) FROM public.sales_aftercare_consumptions WHERE operation_id=${sqlLiteral(identities.inspection[0])};`,
    successSql: `SELECT jsonb_build_object('value',count(*)) FROM public.sales_aftercare_consumptions WHERE operation_id=${sqlLiteral(identities.inspection[0])};`,
  }));
  results.push(await runRootGateBlockedWrite({
    fixture, label: 'CANCELLATION',
    sql: `SELECT public.phase4_cancel_draft_aftercare_internal(${sqlLiteral(identities.cancel[0])})`,
    zeroSql: `SELECT jsonb_build_object('value',count(*)) FROM public.sales_return_events WHERE operation_id=${sqlLiteral(identities.cancel[0])} AND settlement_status='cancelled';`,
    successSql: `SELECT jsonb_build_object('value',count(*)) FROM public.sales_return_events WHERE operation_id=${sqlLiteral(identities.cancel[0])} AND settlement_status='cancelled';`,
  }));

  // Writer-first: child evidence owns the root gate; cancellation waits, then
  // succeeds after the child transaction commits.
  const writerFirst = startPsqlSession('phase4-family-writer-first');
  writerFirst.child.stdin.write(`BEGIN; ${returnItem(identities.writerFirst)};
    SELECT 'PHASE4_FAMILY_WRITER_FIRST_READY';\n`);
  await waitForOutput(writerFirst, 'PHASE4_FAMILY_WRITER_FIRST_READY');
  const cancelSecond = startPsqlSession('phase4-family-cancel-second');
  cancelSecond.child.stdin.end(`SELECT public.phase4_cancel_draft_aftercare_internal(
    ${sqlLiteral(identities.writerFirst[0])});\n`);
  await waitForBlockedSession('phase4-family-cancel-second');
  writerFirst.child.stdin.end('COMMIT;\n');
  assert.equal((await writerFirst.completed).code, 0);
  assert.equal((await cancelSecond.completed).code, 0);

  // Cancel-first: the cancelled parent keeps the root gate; a later child
  // writer waits, then fails closed without a row after cancellation commits.
  const cancelFirst = startPsqlSession('phase4-family-cancel-first');
  cancelFirst.child.stdin.write(`BEGIN; SELECT public.phase4_cancel_draft_aftercare_internal(
    ${sqlLiteral(identities.cancelFirst[0])});
    SELECT 'PHASE4_FAMILY_CANCEL_FIRST_READY';\n`);
  await waitForOutput(cancelFirst, 'PHASE4_FAMILY_CANCEL_FIRST_READY');
  const writerSecond = startPsqlSession('phase4-family-writer-second');
  writerSecond.child.stdin.end(`${returnItem(identities.cancelFirst)};\n`);
  await waitForBlockedSession('phase4-family-writer-second');
  cancelFirst.child.stdin.end('COMMIT;\n');
  assert.equal((await cancelFirst.completed).code, 0);
  const writerSecondResult = await writerSecond.completed;
  assert.notEqual(writerSecondResult.code, 0);
  assert.match(writerSecondResult.stderr, /PHASE4_RETURN_EVIDENCE_CLOSED/u);
  const final = await readJson(`SELECT jsonb_build_object(
    'writerFirstCancelled',(SELECT settlement_status='cancelled'
      FROM public.sales_return_events WHERE operation_id=${sqlLiteral(identities.writerFirst[0])}),
    'writerFirstItem',(SELECT count(*) FROM public.sales_return_items
      WHERE id=${sqlLiteral(identities.writerFirst[2])}),
    'cancelFirstItem',(SELECT count(*) FROM public.sales_return_items
      WHERE id=${sqlLiteral(identities.cancelFirst[2])})
  );`);
  assert.equal(final.writerFirstCancelled, true);
  assert.equal(final.writerFirstItem, 1);
  assert.equal(final.cancelFirstItem, 0);
  const deadlocksAfter = await readJson(`SELECT jsonb_build_object('value',deadlocks)
    FROM pg_stat_database WHERE datname=current_database();`);
  const deadlockDelta = Number(deadlocksAfter.value) - Number(deadlocksBefore.value);
  assert.equal(deadlockDelta, 0);
  return {
    paths: results,
    writerFirstCancellation: true,
    cancellationFirstChildRejected: true,
    deadlockDelta,
  };
};

const runOperationContractBoundaryProof = async () => {
  const fixture = await readJson(`SELECT jsonb_build_object(
    'orderId',customer_order.id,'branchId',customer_order.branch_id,
    'warehouseId',customer_order.warehouse_id,
    'ownerId','92400000-0000-0000-0000-000000000001',
    'completion',public.phase4_authoritative_completion_internal(customer_order.id)
  ) FROM public.orders customer_order
  WHERE customer_order.status='completed'
  ORDER BY customer_order.created_at DESC LIMIT 1;`);
  const ids = {
    returnNullOp: 'f44d0000-0000-4000-8000-000000000001',
    returnNullEvent: 'f44d0000-0000-4000-8000-000000000002',
    replacementNullOp: 'f44d0000-0000-4000-8000-000000000011',
    replacementNullEvent: 'f44d0000-0000-4000-8000-000000000012',
    returnCrossOp: 'f44d0000-0000-4000-8000-000000000021',
    returnCrossEvent: 'f44d0000-0000-4000-8000-000000000022',
    replacementCrossOp: 'f44d0000-0000-4000-8000-000000000031',
    replacementCrossEvent: 'f44d0000-0000-4000-8000-000000000032',
    mismatchOp: 'f44d0000-0000-4000-8000-000000000041',
    mismatchEvent: 'f44d0000-0000-4000-8000-000000000042',
    unsupportedOp: 'f44d0000-0000-4000-8000-000000000051',
    unsupportedEvent: 'f44d0000-0000-4000-8000-000000000052',
  };
  const operationRow = (operationId, type, eventId, entityKey, suffix) => `(
    ${sqlLiteral(operationId)},${sqlLiteral(type)},${sqlLiteral(`phase4-binding-${suffix}`)},
    repeat(${sqlLiteral(suffix.slice(-1))},64),${sqlLiteral(fixture.ownerId)},
    jsonb_build_object('success',true,'operationId',${sqlLiteral(operationId)},
      ${sqlLiteral(entityKey)},${sqlLiteral(eventId)}),clock_timestamp(),401,
    jsonb_build_object('order_id',${sqlLiteral(fixture.orderId)}),
    'erp_user',repeat(${sqlLiteral(suffix.slice(-1))},64))`;
  await runSqlText(`BEGIN;
    INSERT INTO public.business_operations(
      id,operation_type,idempotency_key,request_fingerprint,initiated_by,
      result_snapshot,completed_at,request_identity_version,
      request_identity_snapshot,actor_scope_type,actor_scope_hash
    ) VALUES
      ${operationRow(ids.returnNullOp, 'phase4_return_v1', ids.returnNullEvent, 'returnId', 'a')},
      ${operationRow(ids.replacementNullOp, 'phase4_replacement_v1', ids.replacementNullEvent, 'replacementId', 'b')},
      ${operationRow(ids.returnCrossOp, 'phase4_return_v1', ids.returnCrossEvent, 'returnId', 'c')},
      ${operationRow(ids.replacementCrossOp, 'phase4_replacement_v1', ids.replacementCrossEvent, 'replacementId', 'd')},
      ${operationRow(ids.unsupportedOp, 'phase4_return_v1', ids.unsupportedEvent, 'returnId', 'f')};
    DO $proof$
    DECLARE state TEXT; message TEXT;
    BEGIN
      BEGIN
        INSERT INTO public.business_operations(
          id,operation_type,idempotency_key,request_fingerprint,initiated_by,
          result_snapshot,completed_at,request_identity_version,
          request_identity_snapshot,actor_scope_type,actor_scope_hash
        ) VALUES ${operationRow(ids.mismatchOp, 'phase4_return_v1', ids.mismatchEvent, 'replacementId', 'e')};
        RAISE EXCEPTION 'Mismatched structural result was accepted';
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS state=RETURNED_SQLSTATE,message=MESSAGE_TEXT;
        IF state<>'P0001' OR position('PHASE4_OPERATION_RESULT_IDENTITY_INVALID' in message)=0 THEN RAISE; END IF;
      END;
      BEGIN
        INSERT INTO public.sales_return_events(
          id,return_number,operation_id,order_id,branch_id,warehouse_id,reason,
          merchandise_refund_amount_in_minor_units,contract_version,
          settlement_status,raw_customer_damage_deduction_in_minor_units,
          applied_customer_damage_deduction_in_minor_units
        ) VALUES (${sqlLiteral(ids.returnNullEvent)},'P4-BIND-NULL-RETURN',
          ${sqlLiteral(ids.returnNullOp)},${sqlLiteral(fixture.orderId)},
          ${sqlLiteral(fixture.branchId)},${sqlLiteral(fixture.warehouseId)},
          'NULL contract proof',0,NULL,'draft',0,0);
        RAISE EXCEPTION 'NULL Return contract was accepted';
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS state=RETURNED_SQLSTATE,message=MESSAGE_TEXT;
        IF state<>'P0001' OR position('PHASE4_OPERATION_ENTITY_CONTRACT_MISMATCH' in message)=0 THEN RAISE; END IF;
      END;
      BEGIN
        INSERT INTO public.sales_replacement_events(
          id,operation_id,root_order_id,branch_id,warehouse_id,contract_version,
          original_completed_at_snapshot,reason,created_by
        ) VALUES (${sqlLiteral(ids.replacementNullEvent)},${sqlLiteral(ids.replacementNullOp)},
          ${sqlLiteral(fixture.orderId)},${sqlLiteral(fixture.branchId)},
          ${sqlLiteral(fixture.warehouseId)},NULL,${sqlLiteral(fixture.completion)},
          'NULL contract proof',${sqlLiteral(fixture.ownerId)});
        RAISE EXCEPTION 'NULL Replacement contract was accepted';
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS state=RETURNED_SQLSTATE,message=MESSAGE_TEXT;
        IF state<>'P0001' OR position('PHASE4_OPERATION_ENTITY_CONTRACT_MISMATCH' in message)=0 THEN RAISE; END IF;
      END;
      BEGIN
        INSERT INTO public.sales_replacement_events(
          id,operation_id,root_order_id,branch_id,warehouse_id,contract_version,
          original_completed_at_snapshot,reason,created_by
        ) VALUES (${sqlLiteral(ids.returnCrossEvent)},${sqlLiteral(ids.returnCrossOp)},
          ${sqlLiteral(fixture.orderId)},${sqlLiteral(fixture.branchId)},
          ${sqlLiteral(fixture.warehouseId)},401,${sqlLiteral(fixture.completion)},
          'Cross entity proof',${sqlLiteral(fixture.ownerId)});
        RAISE EXCEPTION 'Return operation accepted Replacement entity';
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS state=RETURNED_SQLSTATE,message=MESSAGE_TEXT;
        IF state<>'P0001' OR position('PHASE4_OPERATION_ENTITY_CONTRACT_MISMATCH' in message)=0 THEN RAISE; END IF;
      END;
      BEGIN
        INSERT INTO public.sales_return_events(
          id,return_number,operation_id,order_id,branch_id,warehouse_id,reason,
          merchandise_refund_amount_in_minor_units,contract_version,
          settlement_status,outstanding_debt_before_snapshot_in_minor_units,
          net_collected_before_snapshot_in_minor_units,
          debt_reduction_amount_in_minor_units,money_refund_amount_in_minor_units,
          raw_customer_damage_deduction_in_minor_units,
          applied_customer_damage_deduction_in_minor_units
        ) VALUES (${sqlLiteral(ids.replacementCrossEvent)},'P4-BIND-CROSS-RETURN',
          ${sqlLiteral(ids.replacementCrossOp)},${sqlLiteral(fixture.orderId)},
          ${sqlLiteral(fixture.branchId)},${sqlLiteral(fixture.warehouseId)},
          'Cross entity proof',0,401,'draft',0,0,0,0,0,0);
        RAISE EXCEPTION 'Replacement operation accepted Return entity';
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS state=RETURNED_SQLSTATE,message=MESSAGE_TEXT;
        IF state<>'P0001' OR position('PHASE4_OPERATION_ENTITY_CONTRACT_MISMATCH' in message)=0 THEN RAISE; END IF;
      END;
      BEGIN
        INSERT INTO public.sales_return_events(
          id,return_number,operation_id,order_id,branch_id,warehouse_id,reason,
          merchandise_refund_amount_in_minor_units,contract_version,
          settlement_status,outstanding_debt_before_snapshot_in_minor_units,
          net_collected_before_snapshot_in_minor_units,
          debt_reduction_amount_in_minor_units,money_refund_amount_in_minor_units,
          raw_customer_damage_deduction_in_minor_units,
          applied_customer_damage_deduction_in_minor_units
        ) VALUES (${sqlLiteral(ids.unsupportedEvent)},'P4-BIND-UNSUPPORTED',
          ${sqlLiteral(ids.unsupportedOp)},${sqlLiteral(fixture.orderId)},
          ${sqlLiteral(fixture.branchId)},${sqlLiteral(fixture.warehouseId)},
          'Unsupported contract proof',0,402,'draft',0,0,0,0,0,0);
        RAISE EXCEPTION 'Unsupported Return contract was accepted';
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS state=RETURNED_SQLSTATE,message=MESSAGE_TEXT;
        IF state<>'P0001' OR position('PHASE4_OPERATION_ENTITY_CONTRACT_MISMATCH' in message)=0 THEN RAISE; END IF;
      END;
    END $proof$;
    COMMIT;`, 'Phase 4 operation-contract boundary proof');
  const fresh = await readJson(`SELECT jsonb_build_object(
    'operationCount',(SELECT count(*) FROM public.business_operations
      WHERE id IN (${Object.values(ids).filter((_, index) => index % 2 === 0).map(sqlLiteral).join(',')})),
    'returnHeaders',(SELECT count(*) FROM public.sales_return_events
      WHERE id IN (${[ids.returnNullEvent, ids.replacementCrossEvent, ids.mismatchEvent, ids.unsupportedEvent].map(sqlLiteral).join(',')})),
    'replacementHeaders',(SELECT count(*) FROM public.sales_replacement_events
      WHERE id IN (${[ids.replacementNullEvent, ids.returnCrossEvent].map(sqlLiteral).join(',')}))
  );`);
  assert.equal(fresh.operationCount, 5);
  assert.equal(fresh.returnHeaders, 0);
  assert.equal(fresh.replacementHeaders, 0);
  return { negativeCases: 6, strictErrorIdentity: true, freshConnectionZeroHeaders: true };
};

const runOperationInsertShapeMatrixProof = async () => {
  const fixture = await readJson(`SELECT jsonb_build_object(
    'orderId',customer_order.id,
    'ownerId','92400000-0000-0000-0000-000000000001'
  ) FROM public.orders customer_order
  WHERE customer_order.status='completed'
  ORDER BY customer_order.created_at DESC LIMIT 1;`);
  const baseId = (index) => `f44e${String(index).padStart(4, '0')}-0000-4000-8000-000000000001`;
  const eventId = (index) => `f44e${String(index).padStart(4, '0')}-0000-4000-8000-000000000002`;
  const valid = (index, overrides = {}, type = 'phase4_return_v1') => {
    const id = baseId(index);
    const entity = eventId(index);
    const entityKey = type === 'phase4_return_v1' ? 'returnId' : 'replacementId';
    const resolvedOverrides = { ...overrides };
    if (typeof resolvedOverrides.result === 'function') {
      resolvedOverrides.result = resolvedOverrides.result({ id, entity, entityKey });
    }
    return {
      id: sqlLiteral(id),
      type: sqlLiteral(type),
      key: sqlLiteral(`phase4-shape-${index}`),
      fingerprint: "repeat('a',64)",
      owner: sqlLiteral(fixture.ownerId),
      result: `jsonb_build_object('success',true,'operationId',${sqlLiteral(id)},${sqlLiteral(entityKey)},${sqlLiteral(entity)})`,
      completed: 'clock_timestamp()',
      identityVersion: '401',
      request: `jsonb_build_object('order_id',${sqlLiteral(fixture.orderId)})`,
      actorType: "'erp_user'",
      actorHash: "repeat('b',64)",
      ...resolvedOverrides,
    };
  };
  const statement = (row) => `INSERT INTO public.business_operations(
    id,operation_type,idempotency_key,request_fingerprint,initiated_by,
    result_snapshot,completed_at,request_identity_version,
    request_identity_snapshot,actor_scope_type,actor_scope_hash
  ) VALUES (${row.id},${row.type},${row.key},${row.fingerprint},${row.owner},
    ${row.result},${row.completed},${row.identityVersion},${row.request},
    ${row.actorType},${row.actorHash})`;
  const cases = [
    { name: 'idempotency-null', override: { key: 'NULL' } },
    { name: 'fingerprint-null', override: { fingerprint: 'NULL' } },
    { name: 'initiator-null', override: { owner: 'NULL' } },
    { name: 'result-sql-null', override: { result: 'NULL' } },
    { name: 'result-json-null', override: { result: "'null'::jsonb" } },
    { name: 'result-array', override: { result: "'[]'::jsonb" } },
    { name: 'result-success-missing', override: { result: ({ id, entity, entityKey }) => `jsonb_build_object('operationId',${sqlLiteral(id)},${sqlLiteral(entityKey)},${sqlLiteral(entity)})` } },
    { name: 'result-success-false', override: { result: ({ id, entity, entityKey }) => `jsonb_build_object('success',false,'operationId',${sqlLiteral(id)},${sqlLiteral(entityKey)},${sqlLiteral(entity)})` } },
    { name: 'result-success-string-true', override: { result: ({ id, entity, entityKey }) => `jsonb_build_object('success','true','operationId',${sqlLiteral(id)},${sqlLiteral(entityKey)},${sqlLiteral(entity)})` } },
    { name: 'result-success-string-false', override: { result: ({ id, entity, entityKey }) => `jsonb_build_object('success','false','operationId',${sqlLiteral(id)},${sqlLiteral(entityKey)},${sqlLiteral(entity)})` } },
    { name: 'result-success-json-null', override: { result: ({ id, entity, entityKey }) => `jsonb_build_object('success','null'::jsonb,'operationId',${sqlLiteral(id)},${sqlLiteral(entityKey)},${sqlLiteral(entity)})` } },
    { name: 'result-success-number', override: { result: ({ id, entity, entityKey }) => `jsonb_build_object('success',1,'operationId',${sqlLiteral(id)},${sqlLiteral(entityKey)},${sqlLiteral(entity)})` } },
    { name: 'result-success-object', override: { result: ({ id, entity, entityKey }) => `jsonb_build_object('success',jsonb_build_object('value',true),'operationId',${sqlLiteral(id)},${sqlLiteral(entityKey)},${sqlLiteral(entity)})` } },
    { name: 'result-success-array', override: { result: ({ id, entity, entityKey }) => `jsonb_build_object('success',jsonb_build_array(true),'operationId',${sqlLiteral(id)},${sqlLiteral(entityKey)},${sqlLiteral(entity)})` } },
    { name: 'result-operation-missing', override: { result: ({ entity, entityKey }) => `jsonb_build_object('success',true,${sqlLiteral(entityKey)},${sqlLiteral(entity)})` } },
    { name: 'result-operation-mismatch', override: { result: ({ entity, entityKey }) => `jsonb_build_object('success',true,'operationId','f44e9999-0000-4000-8000-000000000001',${sqlLiteral(entityKey)},${sqlLiteral(entity)})` } },
    { name: 'result-entity-missing', override: { result: ({ id }) => `jsonb_build_object('success',true,'operationId',${sqlLiteral(id)})` } },
    { name: 'result-cross-entity', override: { result: ({ id, entity, entityKey }) => `jsonb_build_object('success',true,'operationId',${sqlLiteral(id)},${sqlLiteral(entityKey === 'returnId' ? 'replacementId' : 'returnId')},${sqlLiteral(entity)})` } },
    { name: 'completed-null', override: { completed: 'NULL' } },
    { name: 'identity-version-null', override: { identityVersion: 'NULL' } },
    { name: 'identity-version-wrong', override: { identityVersion: '402' } },
    { name: 'request-sql-null', override: { request: 'NULL' } },
    { name: 'request-json-null', override: { request: "'null'::jsonb" } },
    { name: 'request-array', override: { request: "'[]'::jsonb" } },
    { name: 'request-order-missing', override: { request: "'{}'::jsonb" } },
    { name: 'request-order-invalid', override: { request: "jsonb_build_object('order_id','not-a-uuid')" } },
    { name: 'actor-type-null', override: { actorType: 'NULL' } },
    { name: 'actor-type-wrong', override: { actorType: "'guest_gateway'" } },
    { name: 'actor-hash-null', override: { actorHash: 'NULL' } },
    { name: 'idempotency-blank', override: { key: "'   '" } },
    { name: 'idempotency-too-long', override: { key: "repeat('x',256)" } },
    { name: 'fingerprint-malformed', override: { fingerprint: "repeat('z',64)" } },
    { name: 'actor-hash-malformed', override: { actorHash: "repeat('z',64)" } },
  ];
  const matrix = [
    ...cases.map((test, index) => ({
      name: `return-${test.name}`,
      row: valid(index + 1, test.override),
    })),
    ...cases.map((test, index) => ({
      name: `replacement-${test.name}`,
      row: valid(index + 40, test.override, 'phase4_replacement_v1'),
    })),
    {
      name: 'malformed-actor-duplicate-owner-a',
      row: valid(80, {
        key: "'phase4-malformed-actor-duplicate'", actorType: 'NULL', actorHash: 'NULL',
      }),
    },
    {
      name: 'malformed-actor-duplicate-owner-b',
      row: valid(81, {
        key: "'phase4-malformed-actor-duplicate'", actorType: 'NULL', actorHash: 'NULL',
      }),
    },
  ];
  const blocks = matrix.map(({ name, row }) => {
    const keyFailure = name.includes('-idempotency-null')
      || name.includes('-idempotency-blank')
      || name.includes('-idempotency-too-long');
    const resultFailure = name.includes('-result-');
    const expectedState = keyFailure || resultFailure ? 'P0001' : '23514';
    const expectedIdentity = keyFailure
      ? 'PHASE4_IDEMPOTENCY_KEY_INVALID'
      : resultFailure
        ? 'PHASE4_OPERATION_RESULT_IDENTITY_INVALID'
        : 'PHASE4_OPERATION_INSERT_SHAPE_INVALID';
    return `BEGIN
      ${statement(row)};
      RAISE EXCEPTION ${sqlLiteral(`${name} unexpectedly passed`)};
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS state=RETURNED_SQLSTATE,message=MESSAGE_TEXT;
      IF state<>${sqlLiteral(expectedState)} OR position(${sqlLiteral(expectedIdentity)} in message)=0 THEN RAISE; END IF;
    END;`;
  }).join('\n');
  await runSqlText(`DO $matrix$
    DECLARE state TEXT; message TEXT;
    BEGIN ${blocks} END
  $matrix$;`, 'Phase 4 operation INSERT shape matrix');

  const validReturn = valid(90, { key: "'  phase4-shape-90  '" });
  const validReplacement = valid(91, {}, 'phase4_replacement_v1');
  await runSqlText(`
    ${statement(validReturn)};
    ${statement(validReplacement)};
    INSERT INTO public.business_operations(id,operation_type,initiated_by)
    VALUES ('f44e0092-0000-4000-8000-000000000001',
      'phase4_family_legacy_probe',${sqlLiteral(fixture.ownerId)});
  `, 'Phase 4 operation INSERT positive controls');
  const state = await readJson(`SELECT jsonb_build_object(
    'invalidRows',(SELECT count(*) FROM public.business_operations
      WHERE id::text LIKE 'f44e00%' AND id NOT IN (
        'f44e0090-0000-4000-8000-000000000001',
        'f44e0091-0000-4000-8000-000000000001',
        'f44e0092-0000-4000-8000-000000000001')),
    'validRows',(SELECT count(*) FROM public.business_operations WHERE id IN (
      'f44e0090-0000-4000-8000-000000000001',
      'f44e0091-0000-4000-8000-000000000001',
      'f44e0092-0000-4000-8000-000000000001')),
    'canonicalKey',(SELECT idempotency_key FROM public.business_operations
      WHERE id='f44e0090-0000-4000-8000-000000000001')
  );`);
  assert.equal(state.invalidRows, 0);
  assert.equal(state.validRows, 3);
  assert.equal(state.canonicalKey, 'phase4-shape-90');
  return {
    negativeCases: matrix.length,
    zeroInvalidRows: true,
    positiveControls: 3,
    typedSuccessMatrix: true,
    canonicalKeyStored: true,
  };
};

const runIdempotencyReplayContractProof = async (phase4Result) => {
  const scenarios = new Set(phase4Result.scenarios);
  for (const scenario of [
    'equivalent_return_key_replay',
    'equivalent_replacement_key_replay',
    'duplicate_normalized_return_key_blocked',
    'duplicate_normalized_replacement_key_blocked',
    'actor_scoped_idempotency_conflict_zero_write',
    'cross_actor_idempotency_privacy',
  ]) assert.equal(scenarios.has(scenario), true, `Missing runtime proof: ${scenario}`);

  const fixtures = [
    {
      type: 'phase4_return_v1',
      key: 'phase4-shape-90',
      operationId: 'f44e0090-0000-4000-8000-000000000001',
    },
    {
      type: 'phase4_replacement_v1',
      key: 'phase4-shape-91',
      operationId: 'f44e0091-0000-4000-8000-000000000001',
    },
  ];
  const results = {};
  for (const fixture of fixtures) {
    await runSqlText(`DO $proof$
      DECLARE state TEXT; message TEXT;
      BEGIN
      BEGIN
        PERFORM public.phase4_resolve_operation_replay_internal(
          ${sqlLiteral(fixture.type)},${sqlLiteral(`  ${fixture.key}  `)},
          repeat('b',64),repeat('a',64));
        RAISE EXCEPTION 'Canonicalized existing operation unexpectedly returned';
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS state=RETURNED_SQLSTATE,message=MESSAGE_TEXT;
        IF state<>'P0001' OR position('PHASE4_OPERATION_NOT_SETTLED' in message)=0 THEN RAISE; END IF;
      END;
      BEGIN
        PERFORM public.phase4_resolve_operation_replay_internal(
          ${sqlLiteral(fixture.type)},${sqlLiteral(fixture.key)},
          repeat('b',64),repeat('e',64));
        RAISE EXCEPTION 'Changed payload unexpectedly replayed';
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS state=RETURNED_SQLSTATE,message=MESSAGE_TEXT;
        IF state<>'P0001' OR position('PHASE4_IDEMPOTENCY_CONFLICT' in message)=0 THEN RAISE; END IF;
      END;
      END;
    $proof$;`, `${fixture.type} canonical identity and conflict`);

    const otherActor = await readJson(`SELECT public.phase4_resolve_operation_replay_internal(
      ${sqlLiteral(fixture.type)},${sqlLiteral(fixture.key)},repeat('f',64),repeat('a',64)
    );`);
    assert.equal(otherActor.decision, 'NEW');
    const caseDistinct = await readJson(`SELECT public.phase4_resolve_operation_replay_internal(
      ${sqlLiteral(fixture.type)},${sqlLiteral(fixture.key.toUpperCase())},
      repeat('b',64),repeat('a',64)
    );`);
    assert.equal(caseDistinct.decision, 'NEW');
    const noMatch = await readJson(`SELECT public.phase4_resolve_operation_replay_internal(
      ${sqlLiteral(fixture.type)},${sqlLiteral(`${fixture.key}-new`)},
      repeat('b',64),repeat('a',64)
    );`);
    assert.equal(noMatch.decision, 'NEW');
    const owner = await readJson(`SELECT jsonb_build_object(
      'ownerCount',count(*),'storedKey',min(idempotency_key)
    ) FROM public.business_operations
    WHERE id=${sqlLiteral(fixture.operationId)};`);
    assert.equal(owner.ownerCount, 1);
    assert.equal(owner.storedKey, fixture.key);
    results[fixture.type] = {
      equivalentRepresentationReplay: true,
      canonicalExistingIdentityFound: true,
      changedPayloadConflict: true,
      crossActorNoLeakage: true,
      casePreserved: true,
      validNoMatchIsNew: true,
      exactlyOneOwner: true,
      differentRootOrderDuplicateBlocked: true,
      zeroCandidateWrites: true,
    };
  }

  await runSqlText(`DO $proof$
    DECLARE state TEXT; message TEXT;
    BEGIN
    BEGIN
      PERFORM public.phase4_resolve_operation_replay_internal(
        NULL,'phase4-null-operation-type',repeat('a',64),repeat('b',64));
      RAISE EXCEPTION 'NULL operation type returned NEW';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS state=RETURNED_SQLSTATE,message=MESSAGE_TEXT;
      IF state<>'P0001' OR position('PHASE4_IDEMPOTENCY_INPUT_INVALID' in message)=0 THEN RAISE; END IF;
    END;
    BEGIN
      PERFORM public.phase4_resolve_operation_replay_internal(
        'phase4_unknown_v1','phase4-unsupported-operation-type',repeat('a',64),repeat('b',64));
      RAISE EXCEPTION 'Unsupported operation type returned NEW';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS state=RETURNED_SQLSTATE,message=MESSAGE_TEXT;
      IF state<>'P0001' OR position('PHASE4_IDEMPOTENCY_INPUT_INVALID' in message)=0 THEN RAISE; END IF;
    END;
    BEGIN
      PERFORM public.phase4_resolve_operation_replay_internal(
        'phase4_return_v1','   ',repeat('a',64),repeat('b',64));
      RAISE EXCEPTION 'Whitespace-only key returned NEW';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS state=RETURNED_SQLSTATE,message=MESSAGE_TEXT;
      IF state<>'P0001' OR position('PHASE4_IDEMPOTENCY_KEY_INVALID' in message)=0 THEN RAISE; END IF;
    END;
    END;
  $proof$;`, 'Phase 4 malformed replay identity matrix');

  return {
    canonicalIdentity: 'BTRIM ordinary edge spaces; case-sensitive',
    return: results.phase4_return_v1,
    replacement: results.phase4_replacement_v1,
    equivalentCommittedReplays: 2,
    duplicateNormalizedKeySettlementsBlocked: 2,
    nullOperationTypeRejected: true,
    unsupportedOperationTypeRejected: true,
    whitespaceOnlyKeyRejected: true,
  };
};

const runReturnItemEvidenceMatrixProof = async () => {
  const fixture = await readJson(`SELECT jsonb_build_object(
    'orderId',customer_order.id,'orderItemId',item.id,
    'productId',item.product_id,'branchId',customer_order.branch_id,
    'warehouseId',customer_order.warehouse_id,
    'entitlement',item.net_refundable_amount_snapshot_in_minor_units,
    'cogs',item.cogs_in_minor_units,
    'ownerId','92400000-0000-0000-0000-000000000001'
  ) FROM public.orders customer_order
  JOIN public.order_items item ON item.order_id=customer_order.id
  WHERE customer_order.status='completed'
    AND item.commercial_line_kind='base_unit'
    AND item.product_id IS NOT NULL
    AND item.net_refundable_amount_snapshot_in_minor_units IS NOT NULL
  ORDER BY customer_order.created_at DESC,item.id LIMIT 1;`);
  assert.ok(fixture?.orderId && fixture?.orderItemId);
  const operationId = 'f44f0000-0000-4000-8000-000000000001';
  const eventId = 'f44f0000-0000-4000-8000-000000000002';
  await runSqlText(`
    INSERT INTO public.business_operations(
      id,operation_type,idempotency_key,request_fingerprint,initiated_by,
      result_snapshot,completed_at,request_identity_version,
      request_identity_snapshot,actor_scope_type,actor_scope_hash
    ) VALUES (${sqlLiteral(operationId)},'phase4_return_v1',
      'phase4-return-item-null-matrix',repeat('c',64),${sqlLiteral(fixture.ownerId)},
      jsonb_build_object('success',true,'operationId',${sqlLiteral(operationId)},
        'returnId',${sqlLiteral(eventId)}),clock_timestamp(),401,
      jsonb_build_object('order_id',${sqlLiteral(fixture.orderId)}),
      'erp_user',repeat('d',64));
    INSERT INTO public.sales_return_events(
      id,return_number,operation_id,order_id,branch_id,warehouse_id,
      reason,merchandise_refund_amount_in_minor_units,contract_version,
      settlement_status,outstanding_debt_before_snapshot_in_minor_units,
      net_collected_before_snapshot_in_minor_units,
      debt_reduction_amount_in_minor_units,money_refund_amount_in_minor_units,
      raw_customer_damage_deduction_in_minor_units,
      applied_customer_damage_deduction_in_minor_units
    ) VALUES (${sqlLiteral(eventId)},'P4-ITEM-NULL-MATRIX',${sqlLiteral(operationId)},
      ${sqlLiteral(fixture.orderId)},${sqlLiteral(fixture.branchId)},
      ${sqlLiteral(fixture.warehouseId)},'Return Item evidence matrix',
      ${Number(fixture.entitlement)},401,'draft',${Number(fixture.entitlement)},
      0,${Number(fixture.entitlement)},0,0,0);
  `, 'Phase 4 Return Item evidence fixture');

  const insertItem = (id, evidence) => `INSERT INTO public.sales_return_items(
    id,sales_return_event_id,operation_id,order_id,order_item_id,
    return_scope,product_id,returned_quantity,
    refund_amount_snapshot_in_minor_units,stock_disposition,
    accepted_base_quantity,rejected_base_quantity,
    original_cogs_snapshot_in_minor_units,
    raw_customer_damage_deduction_in_minor_units,
    applied_customer_damage_deduction_in_minor_units
  ) VALUES (${sqlLiteral(id)},${sqlLiteral(eventId)},${sqlLiteral(operationId)},
    ${sqlLiteral(fixture.orderId)},${sqlLiteral(fixture.orderItemId)},'base_unit',
    ${sqlLiteral(fixture.productId)},1,${Number(fixture.entitlement)},'restock',
    ${evidence.accepted},${evidence.rejected},${evidence.cogs},
    ${evidence.raw},${evidence.applied})`;
  const cases = [
    { accepted: 'NULL', rejected: '0', cogs: '0', raw: '0', applied: '0' },
    { accepted: '1', rejected: 'NULL', cogs: '0', raw: '0', applied: '0' },
    { accepted: '1', rejected: '0', cogs: 'NULL', raw: '0', applied: '0' },
    { accepted: '1', rejected: '0', cogs: '0', raw: 'NULL', applied: '0' },
    { accepted: '1', rejected: '0', cogs: '0', raw: '0', applied: 'NULL' },
    { accepted: 'NULL', rejected: 'NULL', cogs: 'NULL', raw: 'NULL', applied: 'NULL' },
  ];
  const blocks = cases.map((evidence, index) => `BEGIN
    ${insertItem(`f44f000${index + 1}-0000-4000-8000-000000000003`, evidence)};
    RAISE EXCEPTION 'Incomplete Return Item evidence passed';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS state=RETURNED_SQLSTATE,message=MESSAGE_TEXT;
    IF state<>'23514' OR position('PHASE4_RETURN_ITEM_EVIDENCE_INCOMPLETE' in message)=0 THEN RAISE; END IF;
  END;`).join('\n');
  await runSqlText(`DO $matrix$
    DECLARE state TEXT; message TEXT;
    BEGIN ${blocks} END
  $matrix$;
  ${insertItem('f44f0090-0000-4000-8000-000000000003', {
    accepted: '1', rejected: '0', cogs: String(Number(fixture.cogs)), raw: '0', applied: '0',
  })};
  `, 'Phase 4 Return Item NULL matrix');

  const legacyOperation = 'f44f0091-0000-4000-8000-000000000001';
  const legacyEvent = 'f44f0091-0000-4000-8000-000000000002';
  const legacyItem = 'f44f0091-0000-4000-8000-000000000003';
  await runSqlText(`
    INSERT INTO public.business_operations(id,operation_type,initiated_by)
    VALUES (${sqlLiteral(legacyOperation)},'phase4_family_legacy_return',
      ${sqlLiteral(fixture.ownerId)});
    INSERT INTO public.sales_return_events(
      id,return_number,operation_id,order_id,branch_id,warehouse_id,
      reason,merchandise_refund_amount_in_minor_units
    ) VALUES (${sqlLiteral(legacyEvent)},'P4-LEGACY-ITEM-PROBE',
      ${sqlLiteral(legacyOperation)},${sqlLiteral(fixture.orderId)},
      ${sqlLiteral(fixture.branchId)},${sqlLiteral(fixture.warehouseId)},
      'Legacy nullable evidence control',0);
    INSERT INTO public.sales_return_items(
      id,sales_return_event_id,operation_id,order_id,order_item_id,
      return_scope,product_id,returned_quantity,
      refund_amount_snapshot_in_minor_units,stock_disposition
    ) VALUES (${sqlLiteral(legacyItem)},${sqlLiteral(legacyEvent)},
      ${sqlLiteral(legacyOperation)},${sqlLiteral(fixture.orderId)},
      ${sqlLiteral(fixture.orderItemId)},'base_unit',${sqlLiteral(fixture.productId)},
      1,0,'restock');
  `, 'Phase 4 Legacy Return Item positive control');
  const state = await readJson(`SELECT jsonb_build_object(
    'invalidRows',(SELECT count(*) FROM public.sales_return_items
      WHERE id::text LIKE 'f44f000%'),
    'validVersioned',(SELECT count(*) FROM public.sales_return_items
      WHERE id='f44f0090-0000-4000-8000-000000000003'),
    'validLegacy',(SELECT count(*) FROM public.sales_return_items
      WHERE id=${sqlLiteral(legacyItem)}
        AND accepted_base_quantity IS NULL
        AND original_cogs_snapshot_in_minor_units IS NULL),
    'validParcel',(SELECT count(*) FROM public.sales_return_items item
      JOIN public.sales_return_events event ON event.id=item.sales_return_event_id
      WHERE event.contract_version=401 AND item.return_scope='parcel_instance'
        AND item.accepted_base_quantity IS NOT NULL
        AND item.rejected_base_quantity IS NOT NULL
        AND item.original_cogs_snapshot_in_minor_units IS NOT NULL
        AND item.raw_customer_damage_deduction_in_minor_units IS NOT NULL
        AND item.applied_customer_damage_deduction_in_minor_units IS NOT NULL)
  );`);
  assert.equal(state.invalidRows, 0);
  assert.equal(state.validVersioned, 1);
  assert.equal(state.validLegacy, 1);
  assert.ok(state.validParcel > 0);
  return {
    negativeCases: cases.length,
    validBaseUnit: true,
    validParcel: true,
    legacyPreserved: true,
  };
};

const ownerClaimsSql = `SELECT set_config('request.jwt.claims',
  '{"sub":"92400000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}',
  false);`;

const runCompletionReplayAfterShiftCloseProof = async () => {
  const fixture = await readJson(`
    UPDATE public.configurable_parcel_feature_settings
      SET feature_state='ENABLED', updated_at=NOW()
      WHERE feature_key='configurable_parcels';
    INSERT INTO public.inventory_balances(
      warehouse_id, product_id, on_hand_quantity, reserved_quantity
    ) SELECT warehouse.id,
      '92400000-0000-0000-0000-000000000101', 100, 0
    FROM public.warehouses warehouse
    JOIN public.branches branch ON branch.id=warehouse.branch_id
    WHERE warehouse.is_active AND branch.is_active
    ORDER BY warehouse.created_at,warehouse.id LIMIT 1
    ON CONFLICT (warehouse_id, product_id) DO UPDATE
      SET on_hand_quantity=100, reserved_quantity=0;
    SELECT set_config('request.jwt.claim.role','service_role',false),
      set_config('request.jwt.claims','{"role":"service_role"}',false);
    SELECT public.submit_guest_customer_order_v2(
      'f44a0000-0000-4000-8000-000000000001', repeat('1',64), repeat('2',64),
      'Phase 4 replay customer','0795550441','إربد','الرمثا','الحي','الشارع',
      NULL,NULL,NULL,NULL,NULL,NULL,
      jsonb_build_array(jsonb_build_object(
        'commercial_line_kind','base_unit',
        'product_id','92400000-0000-0000-0000-000000000101',
        'base_quantity',1,
        'expected_unit_price_in_minor_units',1000
      )),
      NULL,'cash_on_delivery','inside_ramtha',1000,0,0,1000
    );
  `);
  const orderId = fixture.order_id;
  assert.ok(orderId);
  await runSqlText(`UPDATE public.orders SET status='ready' WHERE id=${sqlLiteral(orderId)};`,
    'Prepare Customer V2 replay fixture');
  const location = await readJson(`SELECT jsonb_build_object(
    'branchId',customer_order.branch_id,
    'openShiftId',(SELECT shift.id FROM public.cash_shifts shift
      WHERE shift.branch_id=customer_order.branch_id AND shift.status='open'
      ORDER BY shift.opened_at,shift.id LIMIT 1)
  ) FROM public.orders customer_order WHERE customer_order.id=${sqlLiteral(orderId)};`);
  if (!location.openShiftId) {
    await readJson(`${ownerClaimsSql}
      SELECT public.open_cash_shift(${sqlLiteral(location.branchId)},0);`);
  }
  const completionKey = 'phase4-completion-replay-after-shift-close';
  const completed = await readJson(`${ownerClaimsSql}
    SELECT public.complete_website_order_with_settlement_v2(
      ${sqlLiteral(orderId)}, ${sqlLiteral(completionKey)}, 'cash', 1000, 0,
      NULL, 'Phase 4 replay proof'
    );
  `);
  const before = await readJson(`SELECT jsonb_build_object(
    'order',(SELECT to_jsonb(customer_order) FROM public.orders customer_order
      WHERE customer_order.id=${sqlLiteral(orderId)}),
    'operation',(SELECT to_jsonb(operation) FROM public.business_operations operation
      WHERE operation.operation_type='phase3_customer_completion_v1'
        AND operation.idempotency_key=${sqlLiteral(completionKey)}),
    'payments',(SELECT jsonb_agg(to_jsonb(payment) ORDER BY payment.id)
      FROM public.customer_payments payment WHERE payment.order_id=${sqlLiteral(orderId)}),
    'movements',(SELECT jsonb_agg(to_jsonb(movement) ORDER BY movement.id)
      FROM public.inventory_movements movement WHERE movement.reference_id=${sqlLiteral(orderId)})
  );`);
  const shiftId = before.order.cash_shift_id;
  const closeAmount = await readJson(`SELECT jsonb_build_object(
    'value',expected_cash_in_minor_units
  ) FROM public.cash_shifts WHERE id=${sqlLiteral(shiftId)};`);
  await readJson(`${ownerClaimsSql}
    SELECT public.close_cash_shift(
      ${sqlLiteral(shiftId)},${Number(closeAmount.value)},'Isolated replay proof'
    );`);
  const replay = await readJson(`${ownerClaimsSql}
    SELECT public.complete_website_order_with_settlement_v2(
      ${sqlLiteral(orderId)}, ${sqlLiteral(completionKey)}, 'cash', 1000, 0,
      NULL, 'Phase 4 replay proof'
    );
  `);
  const after = await readJson(`SELECT jsonb_build_object(
    'order',(SELECT to_jsonb(customer_order) FROM public.orders customer_order
      WHERE customer_order.id=${sqlLiteral(orderId)}),
    'operation',(SELECT to_jsonb(operation) FROM public.business_operations operation
      WHERE operation.operation_type='phase3_customer_completion_v1'
        AND operation.idempotency_key=${sqlLiteral(completionKey)}),
    'payments',(SELECT jsonb_agg(to_jsonb(payment) ORDER BY payment.id)
      FROM public.customer_payments payment WHERE payment.order_id=${sqlLiteral(orderId)}),
    'movements',(SELECT jsonb_agg(to_jsonb(movement) ORDER BY movement.id)
      FROM public.inventory_movements movement WHERE movement.reference_id=${sqlLiteral(orderId)})
  );`);
  assert.deepEqual(replay, completed);
  assert.deepEqual(after, before);
  return { storedResultReplayed: true, zeroWrites: true, changedShiftIgnored: true };
};

const runUnauthorizedBeforeLockProof = async () => {
  const fixture = await readJson(`SELECT jsonb_build_object(
    'shiftId',(SELECT id FROM public.cash_shifts WHERE status='open'
      ORDER BY opened_at,id LIMIT 1),
    'before',(SELECT COUNT(*) FROM public.cash_shift_reversals)
  );`);
  const blocker = startPsqlSession('phase4-unauthorized-shift-blocker');
  blocker.child.stdin.write(`BEGIN; SELECT 1 FROM public.cash_shifts
    WHERE id=${sqlLiteral(fixture.shiftId)} FOR UPDATE;
    SELECT 'PHASE4_UNAUTHORIZED_BLOCKER_READY';\n`);
  await waitForOutput(blocker, 'PHASE4_UNAUTHORIZED_BLOCKER_READY');
  const startedAt = Date.now();
  let failure;
  try {
    await runSqlText(`SELECT set_config('request.jwt.claims',
      '{"sub":"92400000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',false);
      SELECT public.reverse_cash_shift_with_operations(
        ${sqlLiteral(fixture.shiftId)}, 'Unauthorized timing proof',
        'phase4-unauthorized-lock-proof'
      );`, 'Unauthorized full Shift reversal');
  } catch (error) {
    failure = error;
  }
  const elapsedMs = Date.now() - startedAt;
  assert.ok(failure, 'Unauthorized actor unexpectedly reached full Shift reversal.');
  assert.match(String(failure), /P0001/u);
  assert.ok(elapsedMs < 2_000, `Unauthorized actor waited on business lock for ${elapsedMs}ms.`);
  blocker.child.stdin.end('ROLLBACK;\n');
  const blockerResult = await blocker.completed;
  assert.equal(blockerResult.code, 0);
  const after = await readJson(`SELECT jsonb_build_object(
    'value',(SELECT COUNT(*) FROM public.cash_shift_reversals)
  );`);
  assert.equal(after.value, fixture.before);
  return { rejectedBeforeBusinessLock: true, elapsedMs, zeroWrites: true };
};

const runDeadlineAfterLockWaitProof = async () => {
  const fixture = await readJson(`
    WITH source AS (
      SELECT customer_order.branch_id, customer_order.warehouse_id,
        customer_order.cash_shift_id
      FROM public.orders customer_order
      WHERE customer_order.status='completed' AND customer_order.source='pos'
      ORDER BY customer_order.created_at DESC LIMIT 1
    ), operation AS (
      INSERT INTO public.business_operations(
        id, operation_type, idempotency_key, request_fingerprint, initiated_by,
        result_snapshot, completed_at, request_identity_version,
        request_identity_snapshot, actor_scope_type, actor_scope_hash
      ) VALUES (
        'f44b0000-0000-4000-8000-000000000001','phase3_pos_sale_v1',
        'phase4-deadline-sale-proof',repeat('3',64),
        '92400000-0000-0000-0000-000000000001','{"success":true}'::jsonb,
        clock_timestamp()-interval '48 hours'+interval '1500 milliseconds',301,
        '{"fixture":"deadline"}'::jsonb,'erp_user',repeat('4',64)
      ) RETURNING id, completed_at
    ), inserted_order AS (
      INSERT INTO public.orders(
        id, order_number, branch_id, warehouse_id, status, payment_method,
        payment_status, subtotal_in_minor_units, total_in_minor_units,
        customer_name_snapshot, amount_paid_in_minor_units, source,
        idempotency_key, cash_shift_id, operation_id, cost_finalized_at
      ) SELECT
        'f44b0000-0000-4000-8000-000000000002','P4-DEADLINE-SALE',
        source.branch_id,source.warehouse_id,'completed','cash','paid',1000,1000,
        'Phase 4 deadline fixture',1000,'pos','phase4-deadline-sale-proof',
        source.cash_shift_id,operation.id,operation.completed_at
      FROM source,operation RETURNING *
    ), inserted_item AS (
      INSERT INTO public.order_items(
        id,order_id,product_id,product_name_snapshot,sku_snapshot,quantity,
        unit_price_in_minor_units,line_total_in_minor_units,
        unit_cost_in_minor_units,cogs_in_minor_units,profit_in_minor_units,
        commercial_line_kind,base_unit_name_snapshot,
        allocated_discount_snapshot_in_minor_units,
        net_refundable_amount_snapshot_in_minor_units,
        unit_cost_snapshot_in_minor_units_exact,
        exact_cogs_snapshot_in_minor_units,cost_finalized_at
      ) SELECT
        'f44b0000-0000-4000-8000-000000000003',inserted_order.id,
        '92400000-0000-0000-0000-000000000101','Deadline SKU','P4-DEADLINE',1,
        1000,1000,0,0,1000,'base_unit','Packet',0,1000,0.000000,0.000000,
        inserted_order.cost_finalized_at
      FROM inserted_order RETURNING *
    ), return_operation AS (
      INSERT INTO public.business_operations(
        id, operation_type, idempotency_key, request_fingerprint, initiated_by,
        result_snapshot, completed_at, request_identity_version,
        request_identity_snapshot, actor_scope_type, actor_scope_hash
      ) VALUES (
        'f44b0000-0000-4000-8000-000000000011','phase4_return_v1',
        'phase4-deadline-return-proof',repeat('5',64),
        '92400000-0000-0000-0000-000000000001',
        jsonb_build_object('success',true,
          'operationId','f44b0000-0000-4000-8000-000000000011',
          'returnId','f44b0000-0000-4000-8000-000000000012'),
        clock_timestamp(),401,jsonb_build_object(
          'order_id','f44b0000-0000-4000-8000-000000000002'
        ),
        'erp_user',repeat('6',64)
      ) RETURNING id
    ), return_event AS (
      INSERT INTO public.sales_return_events(
        id,return_number,operation_id,order_id,branch_id,warehouse_id,
        reason,merchandise_refund_amount_in_minor_units,contract_version,
        settlement_status,outstanding_debt_before_snapshot_in_minor_units,
        net_collected_before_snapshot_in_minor_units,
        debt_reduction_amount_in_minor_units,money_refund_amount_in_minor_units,
        raw_customer_damage_deduction_in_minor_units,
        applied_customer_damage_deduction_in_minor_units
      ) SELECT
        'f44b0000-0000-4000-8000-000000000012','P4-DEADLINE-RETURN',
        return_operation.id,inserted_order.id,inserted_order.branch_id,
        inserted_order.warehouse_id,'Deadline lock proof',1000,401,'draft',
        1000,0,1000,0,0,0
      FROM return_operation,inserted_order RETURNING *
    ), return_item AS (
      INSERT INTO public.sales_return_items(
        id,sales_return_event_id,operation_id,order_id,order_item_id,
        return_scope,product_id,returned_quantity,
        refund_amount_snapshot_in_minor_units,stock_disposition,
        accepted_base_quantity,rejected_base_quantity,
        original_cogs_snapshot_in_minor_units,
        raw_customer_damage_deduction_in_minor_units,
        applied_customer_damage_deduction_in_minor_units
      ) SELECT
        'f44b0000-0000-4000-8000-000000000013',return_event.id,
        return_event.operation_id,return_event.order_id,inserted_item.id,
        'base_unit',inserted_item.product_id,1,1000,'restock',1,0,
        inserted_item.cogs_in_minor_units,0,0
      FROM return_event,inserted_item RETURNING *
    )
    INSERT INTO public.sales_aftercare_consumptions(
      operation_id,return_item_id,source_kind,source_id,product_id,
      consumed_quantity,consumption_kind
    ) SELECT return_item.operation_id,return_item.id,'base_order_item',
      return_item.order_item_id,return_item.product_id,1,'return'
    FROM return_item;
    SELECT jsonb_build_object(
      'operationId','f44b0000-0000-4000-8000-000000000011',
      'eventId','f44b0000-0000-4000-8000-000000000012'
    );
  `);
  const blocker = startPsqlSession('phase4-deadline-blocker');
  blocker.child.stdin.write(`BEGIN; SELECT 1 FROM public.business_operations
    WHERE id=${sqlLiteral(fixture.operationId)} FOR UPDATE;
    SELECT 'PHASE4_DEADLINE_BLOCKER_READY';\n`);
  await waitForOutput(blocker, 'PHASE4_DEADLINE_BLOCKER_READY');
  const finalizer = startPsqlSession('phase4-deadline-finalizer');
  finalizer.child.stdin.end(`SELECT public.phase4_finalize_aftercare_operation_internal(
    ${sqlLiteral(fixture.operationId)});\n`);
  let blocked = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const state = await readJson(`SELECT jsonb_build_object('blocked',EXISTS(
      SELECT 1 FROM pg_stat_activity activity
      WHERE activity.application_name='phase4-deadline-finalizer'
        AND cardinality(pg_blocking_pids(activity.pid))>0));`);
    if (state.blocked) { blocked = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  assert.equal(blocked, true);
  await new Promise((resolve) => setTimeout(resolve, 1_700));
  blocker.child.stdin.end('COMMIT;\n');
  assert.equal((await blocker.completed).code, 0);
  const finalizerResult = await finalizer.completed;
  assert.notEqual(finalizerResult.code, 0);
  if (!/P0001:\s+PHASE4_RETURN_WINDOW_EXPIRED:/u.test(finalizerResult.stderr)) {
    const diagnostic = await readJson(`SELECT jsonb_build_object(
      'orderItem',(SELECT to_jsonb(item) FROM public.order_items item
        WHERE item.id='f44b0000-0000-4000-8000-000000000003'),
      'returnItem',(SELECT to_jsonb(item) FROM public.sales_return_items item
        WHERE item.id='f44b0000-0000-4000-8000-000000000013'),
      'consumptions',(SELECT jsonb_agg(to_jsonb(consumption) ORDER BY consumption.id)
        FROM public.sales_aftercare_consumptions consumption
        WHERE consumption.operation_id=${sqlLiteral(fixture.operationId)})
    );`);
    assert.match(
      finalizerResult.stderr,
      /P0001:\s+PHASE4_RETURN_WINDOW_EXPIRED:/u,
      JSON.stringify(diagnostic),
    );
  }
  const state = await readJson(`SELECT jsonb_build_object(
    'eventStatus',(SELECT settlement_status FROM public.sales_return_events
      WHERE id=${sqlLiteral(fixture.eventId)}),
    'settledConsumptions',(SELECT COUNT(*) FROM public.sales_aftercare_consumptions
      WHERE operation_id=${sqlLiteral(fixture.operationId)}
        AND consumption_state='settled')
  );`);
  assert.equal(state.eventStatus, 'draft');
  assert.equal(state.settledConsumptions, 0);
  return { waitObserved: true, postLockClockRejected: true, zeroPartialWrites: true };
};

const runSettledReplayAfterDeadlineProof = async () => {
  const identity = {
    saleOperation: 'f44c0000-0000-4000-8000-000000000001',
    order: 'f44c0000-0000-4000-8000-000000000002',
    orderItem: 'f44c0000-0000-4000-8000-000000000003',
    operation: 'f44c0000-0000-4000-8000-000000000011',
    event: 'f44c0000-0000-4000-8000-000000000012',
    item: 'f44c0000-0000-4000-8000-000000000013',
    key: 'phase4-settled-replay-after-deadline',
    actorHash: 'b'.repeat(64),
    fingerprint: 'a'.repeat(64),
  };
  const fixture = await readJson(`
    WITH source AS (
      SELECT customer_order.branch_id, customer_order.warehouse_id,
        customer_order.cash_shift_id
      FROM public.orders customer_order
      WHERE customer_order.status='completed' AND customer_order.source='pos'
      ORDER BY customer_order.created_at DESC LIMIT 1
    ), sale_operation AS (
      INSERT INTO public.business_operations(
        id, operation_type, idempotency_key, request_fingerprint, initiated_by,
        result_snapshot, completed_at, request_identity_version,
        request_identity_snapshot, actor_scope_type, actor_scope_hash
      ) VALUES (
        ${sqlLiteral(identity.saleOperation)},'phase3_pos_sale_v1',
        'phase4-settled-replay-sale',repeat('8',64),
        '92400000-0000-0000-0000-000000000001','{"success":true}'::jsonb,
        clock_timestamp()-interval '48 hours'+interval '4 seconds',301,
        '{"fixture":"settled-replay-deadline"}'::jsonb,
        'erp_user',repeat('9',64)
      ) RETURNING id,completed_at
    ), inserted_order AS (
      INSERT INTO public.orders(
        id,order_number,branch_id,warehouse_id,status,payment_method,
        payment_status,subtotal_in_minor_units,total_in_minor_units,
        customer_name_snapshot,amount_paid_in_minor_units,source,
        idempotency_key,cash_shift_id,operation_id,cost_finalized_at
      ) SELECT
        ${sqlLiteral(identity.order)},'P4-SETTLED-REPLAY-SALE',source.branch_id,
        source.warehouse_id,'completed','cash','paid',1000,1000,
        'Phase 4 settled replay fixture',1000,'pos',
        'phase4-settled-replay-sale',source.cash_shift_id,sale_operation.id,
        sale_operation.completed_at
      FROM source,sale_operation RETURNING *
    ), inserted_item AS (
      INSERT INTO public.order_items(
        id,order_id,product_id,product_name_snapshot,sku_snapshot,quantity,
        unit_price_in_minor_units,line_total_in_minor_units,
        unit_cost_in_minor_units,cogs_in_minor_units,profit_in_minor_units,
        commercial_line_kind,base_unit_name_snapshot,
        allocated_discount_snapshot_in_minor_units,
        net_refundable_amount_snapshot_in_minor_units,
        unit_cost_snapshot_in_minor_units_exact,
        exact_cogs_snapshot_in_minor_units,cost_finalized_at
      ) SELECT
        ${sqlLiteral(identity.orderItem)},inserted_order.id,
        '92400000-0000-0000-0000-000000000101','Replay Deadline SKU',
        'P4-SETTLED-REPLAY',1,1000,1000,0,0,1000,'base_unit','Packet',
        0,1000,0.000000,0.000000,inserted_order.cost_finalized_at
      FROM inserted_order RETURNING *
    ), return_operation AS (
      INSERT INTO public.business_operations(
        id,operation_type,idempotency_key,request_fingerprint,initiated_by,
        result_snapshot,completed_at,request_identity_version,
        request_identity_snapshot,actor_scope_type,actor_scope_hash
      ) VALUES (
        ${sqlLiteral(identity.operation)},'phase4_return_v1',
        ${sqlLiteral(identity.key)},${sqlLiteral(identity.fingerprint)},
        '92400000-0000-0000-0000-000000000001',
        jsonb_build_object('success',true,'operationId',${sqlLiteral(identity.operation)},
          'returnId',${sqlLiteral(identity.event)}),
        clock_timestamp(),401,jsonb_build_object('order_id',${sqlLiteral(identity.order)}),
        'erp_user',${sqlLiteral(identity.actorHash)}
      ) RETURNING id
    ), return_event AS (
      INSERT INTO public.sales_return_events(
        id,return_number,operation_id,order_id,branch_id,warehouse_id,
        reason,merchandise_refund_amount_in_minor_units,contract_version,
        settlement_status,outstanding_debt_before_snapshot_in_minor_units,
        net_collected_before_snapshot_in_minor_units,
        debt_reduction_amount_in_minor_units,money_refund_amount_in_minor_units,
        raw_customer_damage_deduction_in_minor_units,
        applied_customer_damage_deduction_in_minor_units
      ) SELECT
        ${sqlLiteral(identity.event)},'P4-SETTLED-REPLAY-RETURN',
        return_operation.id,inserted_order.id,inserted_order.branch_id,
        inserted_order.warehouse_id,'Settled replay after deadline',1000,401,
        'draft',1000,0,1000,0,0,0
      FROM return_operation,inserted_order RETURNING *
    ), return_item AS (
      INSERT INTO public.sales_return_items(
        id,sales_return_event_id,operation_id,order_id,order_item_id,
        return_scope,product_id,returned_quantity,
        refund_amount_snapshot_in_minor_units,stock_disposition,
        accepted_base_quantity,rejected_base_quantity,
        original_cogs_snapshot_in_minor_units,
        raw_customer_damage_deduction_in_minor_units,
        applied_customer_damage_deduction_in_minor_units
      ) SELECT
        ${sqlLiteral(identity.item)},return_event.id,return_event.operation_id,
        return_event.order_id,inserted_item.id,'base_unit',inserted_item.product_id,
        1,1000,'restock',1,0,inserted_item.cogs_in_minor_units,0,0
      FROM return_event,inserted_item RETURNING *
    )
    INSERT INTO public.sales_aftercare_consumptions(
      operation_id,return_item_id,source_kind,source_id,product_id,
      consumed_quantity,consumption_kind
    ) SELECT return_item.operation_id,return_item.id,'base_order_item',
      return_item.order_item_id,return_item.product_id,1,'return'
    FROM return_item;
    SELECT jsonb_build_object(
      'deadline',(SELECT completed_at+interval '48 hours'
        FROM public.business_operations WHERE id=${sqlLiteral(identity.saleOperation)}),
      'dbNow',clock_timestamp()
    );
  `);
  assert.ok(Date.parse(fixture.deadline) > Date.parse(fixture.dbNow));

  await readJson(`SELECT public.phase4_finalize_aftercare_operation_internal(
    ${sqlLiteral(identity.operation)});`);
  const settled = await readJson(`SELECT jsonb_build_object(
    'status',(SELECT settlement_status FROM public.sales_return_events
      WHERE id=${sqlLiteral(identity.event)}),
    'settledAt',(SELECT settled_at FROM public.sales_return_events
      WHERE id=${sqlLiteral(identity.event)}),
    'deadline',(SELECT completed_at+interval '48 hours'
      FROM public.business_operations WHERE id=${sqlLiteral(identity.saleOperation)}),
    'dbNow',clock_timestamp()
  );`);
  assert.equal(settled.status, 'settled');
  assert.ok(Date.parse(settled.settledAt) <= Date.parse(settled.deadline));

  const waitMs = Date.parse(settled.deadline) - Date.now() + 300;
  assert.ok(waitMs > 0 && waitMs < 10_000, `Unexpected deadline wait ${waitMs}ms.`);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  const afterDeadline = await readJson(`SELECT jsonb_build_object(
    'passed',clock_timestamp() > (
      SELECT completed_at+interval '48 hours' FROM public.business_operations
      WHERE id=${sqlLiteral(identity.saleOperation)}
    )
  );`);
  assert.equal(afterDeadline.passed, true);

  const before = await readJson(`SELECT jsonb_build_object(
    'operation',(SELECT to_jsonb(operation) FROM public.business_operations operation
      WHERE operation.id=${sqlLiteral(identity.operation)}),
    'event',(SELECT to_jsonb(event) FROM public.sales_return_events event
      WHERE event.id=${sqlLiteral(identity.event)}),
    'items',(SELECT jsonb_agg(to_jsonb(item) ORDER BY item.id)
      FROM public.sales_return_items item
      WHERE item.operation_id=${sqlLiteral(identity.operation)}),
    'consumptions',(SELECT jsonb_agg(to_jsonb(consumption) ORDER BY consumption.id)
      FROM public.sales_aftercare_consumptions consumption
      WHERE consumption.operation_id=${sqlLiteral(identity.operation)}),
    'payments',(SELECT count(*) FROM public.customer_payments payment
      WHERE payment.order_id=${sqlLiteral(identity.order)}),
    'movements',(SELECT count(*) FROM public.inventory_movements movement
      WHERE movement.reference_id IN (${sqlLiteral(identity.order)},${sqlLiteral(identity.operation)}))
  );`);
  const replay = await readJson(`SELECT public.phase4_resolve_operation_replay_internal(
    'phase4_return_v1',${sqlLiteral(identity.key)},${sqlLiteral(identity.actorHash)},
    ${sqlLiteral(identity.fingerprint)}
  );`);
  const after = await readJson(`SELECT jsonb_build_object(
    'operation',(SELECT to_jsonb(operation) FROM public.business_operations operation
      WHERE operation.id=${sqlLiteral(identity.operation)}),
    'event',(SELECT to_jsonb(event) FROM public.sales_return_events event
      WHERE event.id=${sqlLiteral(identity.event)}),
    'items',(SELECT jsonb_agg(to_jsonb(item) ORDER BY item.id)
      FROM public.sales_return_items item
      WHERE item.operation_id=${sqlLiteral(identity.operation)}),
    'consumptions',(SELECT jsonb_agg(to_jsonb(consumption) ORDER BY consumption.id)
      FROM public.sales_aftercare_consumptions consumption
      WHERE consumption.operation_id=${sqlLiteral(identity.operation)}),
    'payments',(SELECT count(*) FROM public.customer_payments payment
      WHERE payment.order_id=${sqlLiteral(identity.order)}),
    'movements',(SELECT count(*) FROM public.inventory_movements movement
      WHERE movement.reference_id IN (${sqlLiteral(identity.order)},${sqlLiteral(identity.operation)}))
  );`);
  assert.equal(replay.decision, 'REPLAY');
  assert.equal(replay.operation_id, identity.operation);
  assert.equal(replay.result_snapshot.operationId, identity.operation);
  assert.equal(replay.result_snapshot.returnId, identity.event);
  assert.deepEqual(after, before);
  return {
    settledBeforeDeadline: true,
    replayedAfterDeadline: true,
    storedResultReplayed: true,
    zeroWrites: true,
  };
};

const runMixedReversalLockOrderProof = async () => {
  const sale = await readJson(`${ownerClaimsSql}
    SELECT public.create_pos_sale_v2(
      '92400000-0000-0000-0000-000000000201',
      '92400000-0000-0000-0000-000000000200',NULL,
      'Phase 4 lock order','cash',jsonb_build_array(jsonb_build_object(
        'commercial_line_kind','base_unit',
        'product_id','92400000-0000-0000-0000-000000000102',
        'base_quantity',1,'price_authority','server_catalog',
        'line_discount_in_minor_units',0
      )),0,1000,'phase4-mixed-reversal-lock-order');
  `);
  const orderId = sale.orderId;
  const shiftId = sale.cashShiftId;
  const deadlocksBefore = await readJson(`SELECT jsonb_build_object('value',deadlocks)
    FROM pg_stat_database WHERE datname=current_database();`);
  const blocker = startPsqlSession('phase4-mixed-reversal-shift-blocker');
  blocker.child.stdin.write(`BEGIN; SELECT 1 FROM public.cash_shifts
    WHERE id=${sqlLiteral(shiftId)} FOR UPDATE;
    SELECT 'PHASE4_MIXED_BLOCKER_READY';\n`);
  await waitForOutput(blocker, 'PHASE4_MIXED_BLOCKER_READY');

  const pos = startPsqlSession('phase4-mixed-pos-reversal');
  pos.child.stdin.end(`${ownerClaimsSql}
    SELECT public.reverse_pos_sale(${sqlLiteral(orderId)},
      'Phase 4 mixed lock order','phase4-mixed-pos-reversal-key');\n`);
  let posBlocked = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const state = await readJson(`SELECT jsonb_build_object('blocked',EXISTS(
      SELECT 1 FROM pg_stat_activity activity
      WHERE activity.application_name='phase4-mixed-pos-reversal'
        AND cardinality(pg_blocking_pids(activity.pid))>0));`);
    if (state.blocked) { posBlocked = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  assert.equal(posBlocked, true);

  const full = startPsqlSession('phase4-mixed-full-shift-locker');
  full.child.stdin.end(`SELECT public.phase4_lock_full_shift_context_internal(
    ${sqlLiteral(shiftId)});\n`);
  let fullBlocked = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const state = await readJson(`SELECT jsonb_build_object('blocked',EXISTS(
      SELECT 1 FROM pg_stat_activity activity
      WHERE activity.application_name='phase4-mixed-full-shift-locker'
        AND cardinality(pg_blocking_pids(activity.pid))>0));`);
    if (state.blocked) { fullBlocked = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  assert.equal(fullBlocked, true);
  blocker.child.stdin.end('COMMIT;\n');
  assert.equal((await blocker.completed).code, 0);
  const [posResult, fullResult] = await Promise.all([pos.completed, full.completed]);
  assert.equal(posResult.code, 0, posResult.stderr);
  assert.equal(fullResult.code, 0, fullResult.stderr);
  const deadlocksAfter = await readJson(`SELECT jsonb_build_object('value',deadlocks)
    FROM pg_stat_database WHERE datname=current_database();`);
  const deadlockDelta = Number(deadlocksAfter.value) - Number(deadlocksBefore.value);
  assert.equal(deadlockDelta, 0);
  return { posBlocked, fullBlocked, deadlockDelta, bothCompleted: true };
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

  const phase3Output = await runSql(phase3SqlPath, 'Phase 3 prerequisite fixture');
  const phase3Result = JSON.parse(phase3Output.split(/\r?\n/u).filter(Boolean).at(-1));
  assert.equal(phase3Result.ok, true);

  const phase4Output = await runSql(phase4SqlPath, 'Phase 4.1 foundation runtime');
  const phase4Result = JSON.parse(phase4Output.split(/\r?\n/u).filter(Boolean).at(-1));
  assert.equal(phase4Result.ok, true);
  assert.equal(phase4Result.scenarioCount, 35);

  const operationContractBinding = await runOperationContractBoundaryProof();
  const operationInsertShapeMatrix = await runOperationInsertShapeMatrixProof();
  const idempotencyReplayContract = await runIdempotencyReplayContractProof(phase4Result);
  const concurrency = await runConcurrentParcelReturnProof();
  const returnItemEvidenceMatrix = await runReturnItemEvidenceMatrixProof();
  const childAndCancellationLockMatrix =
    await runPhase4ChildAndCancellationLockMatrixProof();
  const completionReplay = await runCompletionReplayAfterShiftCloseProof();
  const unauthorizedBeforeLock = await runUnauthorizedBeforeLockProof();
  const deadlineAfterLockWait = await runDeadlineAfterLockWaitProof();
  const settledReplayAfterDeadline = await runSettledReplayAfterDeadlineProof();
  const mixedReversalLockOrder = await runMixedReversalLockOrderProof();

  const { stdout: lintOutput } = await execFileAsync(
    process.execPath,
    [cliPath, 'db', 'lint', '--local', '--level', 'warning', '--workdir', isolatedProjectRoot],
    {
      cwd: projectRoot,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      timeout: 120_000,
    },
  );
  if (/ERROR:/u.test(lintOutput)) throw new Error(`Database lint failed:\n${lintOutput}`);

  console.log(JSON.stringify({
    ok: true,
    freshRebuild: '001-120',
    phase3PrerequisiteScenarios: phase3Result.scenarios.length,
    ...phase4Result,
    operationContractBinding,
    operationInsertShapeMatrix,
    idempotencyReplayContract,
    returnItemEvidenceMatrix,
    concurrency,
    childAndCancellationLockMatrix,
    completionReplay,
    unauthorizedBeforeLock,
    deadlineAfterLockWait,
    settledReplayAfterDeadline,
    mixedReversalLockOrder,
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
