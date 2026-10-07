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
const projectId = 'nawasrah-phase44-concurrency-test';
const databaseContainer = `supabase_db_${projectId}`;
const ownerId = '92400000-0000-0000-0000-000000000001';
const warehouseId = '92400000-0000-0000-0000-000000000201';
const branchId = '92400000-0000-0000-0000-000000000200';
const productId = '92400000-0000-0000-0000-000000000101';
const ownerClaims = `SELECT set_config('request.jwt.claims',
  '{"sub":"${ownerId}","role":"authenticated","aal":"aal2"}',false);`;
const applicationName = (name) => name.slice(0, 50);

const SLICE_3_BREAK_MATRIX = Object.freeze({
  firstFlightSameKey: 'two first-flight callers share one committed operation and result',
  committedReplayRace: 'concurrent committed replays are identical and zero-write',
  sameKeyChangedPayload: 'one key cannot adopt a changed immutable payload',
  replayVersusNewIntent: 'read-only replay cannot grant or consume new capacity',
  compatibleReturnCapacity: 'two one-unit Returns may consume exact two-unit capacity',
  oversubscribedReturnCapacity: 'competing requests cannot exceed remaining capacity',
  returnVersusReplacement: 'incompatible actions have one winner for one physical source',
  replacementVersusReplacement: 'one physical source receives one authoritative successor',
  sameSkuWarehouseDifferentSales: 'shared inventory serialization preserves sale isolation',
  loserOperationScopedZeroWrite: 'losing keys own no operation/effect/evidence footprint',
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
    child.stdin.end(`SET statement_timeout='45s'; SET lock_timeout='30s';\n${sql}`);
  });

const readJson = async (sql, label) => {
  const result = await runSqlText(sql, label);
  const value = result.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).at(-1);
  assert.ok(value, `${label} did not return JSON.`);
  return JSON.parse(value);
};

const parseSessionJson = (result, label) => {
  assert.equal(result.code, 0, `${label}: ${result.stderr}`);
  const value = result.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).at(-1);
  assert.ok(value, `${label} did not return JSON.`);
  return JSON.parse(value);
};

const assertBusinessFailure = (result, pattern, label) => {
  assert.notEqual(result.code, 0, `${label} unexpectedly succeeded`);
  assert.doesNotMatch(result.stderr, /40P01|deadlock detected|lock timeout|55P03/iu);
  assert.match(result.stderr, pattern);
};

const createBaseSale = async (label, quantity) => {
  const items = JSON.stringify([{
    commercial_line_kind: 'base_unit',
    product_id: productId,
    base_quantity: quantity,
    price_authority: 'server_catalog',
    line_discount_in_minor_units: 0,
  }]);
  const result = await readJson(`${ownerClaims}
    SELECT public.create_pos_sale_v2(
      ${sqlLiteral(warehouseId)},${sqlLiteral(branchId)},NULL,
      ${sqlLiteral(`Phase 4.4 ${label}`)},'cash',${sqlLiteral(items)}::jsonb,
      0,${quantity * 1000},${sqlLiteral(`phase44-${label}-${randomUUID()}`)}
    );`, `Create ${label} sale`);
  assert.equal(result.success, true);
  return readJson(`SELECT jsonb_build_object(
      'orderId',customer_order.id,'orderItemId',item.id,
      'warehouseId',customer_order.warehouse_id,'productId',item.product_id,
      'quantity',item.quantity
    ) FROM public.orders customer_order
    JOIN public.order_items item ON item.order_id=customer_order.id
    WHERE customer_order.id=${sqlLiteral(result.orderId)}
      AND item.commercial_line_kind='base_unit';`, `Read ${label} sale`);
};

const returnSql = ({fixture, key, quantity, reason = 'Phase 4.4 concurrent Return'}) => {
  const items = JSON.stringify([{
    return_scope: 'base_unit',
    order_item_id: fixture.orderItemId,
    quantity,
    stock_disposition: 'restock',
  }]);
  return `${ownerClaims}
    SELECT public.settle_sales_return_v1(
      ${sqlLiteral(fixture.orderId)},${sqlLiteral(key)},${sqlLiteral(items)}::jsonb,
      ${sqlLiteral(reason)},'cash',NULL,NULL
    );`;
};

const replacementSql = ({fixture, key, reason = 'Phase 4.4 concurrent Replacement'}) => {
  const items = JSON.stringify([{
    sourceKind: 'base_order_item',
    sourceId: fixture.orderItemId,
    quantity: 1,
  }]);
  return `${ownerClaims}
    SELECT public.settle_sales_replacement_v1(
      ${sqlLiteral(fixture.orderId)},${sqlLiteral(key)},${sqlLiteral(items)}::jsonb,
      ${sqlLiteral(reason)},NULL
    );`;
};

const startSession = (name) => {
  const effectiveName = applicationName(name);
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
  child.stdin.write(`SET application_name=${sqlLiteral(effectiveName)};
    SET statement_timeout='30s'; SET lock_timeout='20s';\n`);
  let closedResult = null;
  const completed = new Promise((resolve) => {
    child.on('close', (code) => {
      closedResult = {code, stdout: stdout.trim(), stderr: stderr.trim()};
      resolve(closedResult);
    });
  });
  return {
    child,
    completed,
    output: () => ({stdout, stderr}),
    closedResult: () => closedResult,
  };
};

const waitForOutput = async (session, marker) => {
  for (let attempt = 0; attempt < 125; attempt += 1) {
    if (session.output().stdout.includes(marker)) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Session did not emit ${marker}.`);
};

const waitForBlocked = async (name, session = null) => {
  const effectiveName = applicationName(name);
  for (let attempt = 0; attempt < 125; attempt += 1) {
    if (session?.closedResult()) {
      const result = session.closedResult();
      throw new Error(`Session ${name} exited before blocking: code=${result.code}\n${result.stderr}\n${result.stdout}`);
    }
    const state = await readJson(`SELECT jsonb_build_object(
      'blocked',exists(SELECT 1 FROM pg_stat_activity activity
        WHERE activity.application_name=${sqlLiteral(effectiveName)}
          AND cardinality(pg_blocking_pids(activity.pid))>0),
      'waitEvent',(SELECT wait_event FROM pg_stat_activity activity
        WHERE activity.application_name=${sqlLiteral(effectiveName)} LIMIT 1)
    );`, `Wait state ${name}`);
    if (state.blocked) {
      return state.waitEvent ?? 'BLOCKING_PID_CONFIRMED';
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  const output = session?.output();
  throw new Error(`Session ${name} did not block as expected.\n${output?.stderr ?? ''}\n${output?.stdout ?? ''}`);
};

const startRootBlocker = async (orderId, name) => {
  const blocker = startSession(name);
  blocker.child.stdin.write(`BEGIN;
    SELECT pg_advisory_xact_lock(hashtextextended(
      'phase4-order|'||${sqlLiteral(orderId)}::uuid::text,0));
    SELECT 'ROOT_HELD';\n`);
  await waitForOutput(blocker, 'ROOT_HELD');
  return blocker;
};

const runRootQueuedPair = async ({label, orderId, firstSql, secondSql}) => {
  const blocker = await startRootBlocker(orderId, `${label}-blocker`);
  const first = startSession(`${label}-first`);
  first.child.stdin.end(`${firstSql}\n`);
  const firstWait = await waitForBlocked(`${label}-first`, first);
  const second = startSession(`${label}-second`);
  second.child.stdin.end(`${secondSql}\n`);
  const secondWait = await waitForBlocked(`${label}-second`, second);
  blocker.child.stdin.end('COMMIT;\n');
  await blocker.completed;
  const [firstResult, secondResult] = await Promise.all([first.completed, second.completed]);
  return {firstResult, secondResult, waits: [firstWait, secondWait]};
};

const readOperationFootprint = (key) => readJson(`WITH operation_row AS (
    SELECT operation.id FROM public.business_operations operation
    WHERE public.phase4_canonicalize_idempotency_key_internal(operation.idempotency_key)
      =public.phase4_canonicalize_idempotency_key_internal(${sqlLiteral(key)})
  ) SELECT jsonb_build_object(
    'operations',(SELECT count(*) FROM operation_row),
    'returns',(SELECT count(*) FROM public.sales_return_events event
      WHERE event.operation_id IN (SELECT id FROM operation_row)),
    'replacements',(SELECT count(*) FROM public.sales_replacement_events event
      WHERE event.operation_id IN (SELECT id FROM operation_row)),
    'replacementItems',(SELECT count(*) FROM public.sales_replacement_items item
      WHERE item.operation_id IN (SELECT id FROM operation_row)),
    'consumptions',(SELECT count(*) FROM public.sales_aftercare_consumptions consumption
      WHERE consumption.operation_id IN (SELECT id FROM operation_row)),
    'returnEffects',(SELECT count(*) FROM public.phase42_return_inventory_effects effect
      WHERE effect.operation_id IN (SELECT id FROM operation_row)),
    'replacementEffects',(SELECT count(*) FROM public.phase43_replacement_inventory_effects effect
      WHERE effect.operation_id IN (SELECT id FROM operation_row)),
    'returnEvidence',(SELECT count(*) FROM public.phase42_return_settlement_evidence evidence
      WHERE evidence.operation_id IN (SELECT id FROM operation_row)),
    'replacementEvidence',(SELECT count(*) FROM public.phase43_replacement_settlement_evidence evidence
      WHERE evidence.operation_id IN (SELECT id FROM operation_row)),
    'movements',(SELECT count(*) FROM public.inventory_movements movement
      WHERE movement.id IN (
        SELECT effect.inventory_movement_id
        FROM public.phase42_return_inventory_effects effect
        WHERE effect.operation_id IN (SELECT id FROM operation_row)
        UNION
        SELECT effect.inventory_movement_id
        FROM public.phase43_replacement_inventory_effects effect
        WHERE effect.operation_id IN (SELECT id FROM operation_row)
      )),
    'debt',(SELECT coalesce(sum(event.debt_reduction_amount_in_minor_units),0)
      FROM public.sales_return_events event
      WHERE event.operation_id IN (SELECT id FROM operation_row)),
    'refund',(SELECT coalesce(sum(event.money_refund_amount_in_minor_units),0)
      FROM public.sales_return_events event
      WHERE event.operation_id IN (SELECT id FROM operation_row))
  );`, `Read operation footprint ${key}`);

const assertZeroFootprint = async (key) => {
  const footprint = await readOperationFootprint(key);
  assert.deepEqual(footprint, {
    operations: 0,
    returns: 0,
    replacements: 0,
    replacementItems: 0,
    consumptions: 0,
    returnEffects: 0,
    replacementEffects: 0,
    returnEvidence: 0,
    replacementEvidence: 0,
    movements: 0,
    debt: 0,
    refund: 0,
  });
};

const readOrderState = (fixture) => readJson(`SELECT jsonb_build_object(
    'returns',(SELECT count(*) FROM public.sales_return_events event
      WHERE event.order_id=${sqlLiteral(fixture.orderId)} AND event.settlement_status='settled'),
    'replacements',(SELECT count(*) FROM public.sales_replacement_events event
      WHERE event.root_order_id=${sqlLiteral(fixture.orderId)} AND event.issuance_status='issued'),
    'consumed',(SELECT coalesce(sum(consumption.consumed_quantity),0)
      FROM public.sales_aftercare_consumptions consumption
      JOIN public.business_operations operation ON operation.id=consumption.operation_id
      WHERE operation.request_identity_snapshot->>'order_id'=${sqlLiteral(fixture.orderId)}
        AND consumption.consumption_state='settled'),
    'returnEffects',(SELECT count(*) FROM public.phase42_return_inventory_effects effect
      JOIN public.sales_return_events event ON event.id=effect.return_event_id
      WHERE event.order_id=${sqlLiteral(fixture.orderId)}),
    'replacementEffects',(SELECT count(*) FROM public.phase43_replacement_inventory_effects effect
      JOIN public.sales_replacement_events event ON event.id=effect.replacement_event_id
      WHERE event.root_order_id=${sqlLiteral(fixture.orderId)}),
    'movements',(
      (SELECT count(*) FROM public.phase42_return_inventory_effects effect
        JOIN public.sales_return_events event ON event.id=effect.return_event_id
        WHERE event.order_id=${sqlLiteral(fixture.orderId)})
      +
      (SELECT count(*) FROM public.phase43_replacement_inventory_effects effect
        JOIN public.sales_replacement_events event ON event.id=effect.replacement_event_id
        WHERE event.root_order_id=${sqlLiteral(fixture.orderId)})
    ),
    'refund',(SELECT coalesce(sum(event.money_refund_amount_in_minor_units),0)
      FROM public.sales_return_events event WHERE event.order_id=${sqlLiteral(fixture.orderId)}
        AND event.settlement_status='settled'),
    'stock',(SELECT balance.on_hand_quantity FROM public.inventory_balances balance
      WHERE balance.warehouse_id=${sqlLiteral(fixture.warehouseId)}
        AND balance.product_id=${sqlLiteral(fixture.productId)})
  );`, `Read order state ${fixture.orderId}`);

const readCurrentRepresentatives = (fixture) => readJson(`SELECT jsonb_build_object(
    'representatives',public.phase43_current_physical_representatives_internal(
      'base_order_item',${sqlLiteral(fixture.orderItemId)},${sqlLiteral(fixture.productId)})
  );`, 'Read current physical representatives');

const runSameKeyScenarios = async () => {
  const fixture = await createBaseSale('same-key', 2);
  const key = `phase44-same-key-${randomUUID()}`;
  const sql = returnSql({fixture, key, quantity: 1});
  const firstFlight = await runRootQueuedPair({
    label: `p44-same-key-${randomUUID()}`,
    orderId: fixture.orderId,
    firstSql: sql,
    secondSql: sql,
  });
  const first = parseSessionJson(firstFlight.firstResult, 'same-key first caller');
  const second = parseSessionJson(firstFlight.secondResult, 'same-key second caller');
  assert.deepEqual(second, first);
  const firstFootprint = await readOperationFootprint(key);
  assert.deepEqual({
    operations: firstFootprint.operations,
    returns: firstFootprint.returns,
    consumptions: firstFootprint.consumptions,
    returnEffects: firstFootprint.returnEffects,
    returnEvidence: firstFootprint.returnEvidence,
    movements: firstFootprint.movements,
    refund: firstFootprint.refund,
  }, {
    operations: 1, returns: 1, consumptions: 1,
    returnEffects: 1, returnEvidence: 1, movements: 1, refund: 1000,
  });

  const beforeReplay = await readOrderState(fixture);
  const replayA = startSession(`p44-replay-a-${randomUUID()}`);
  const replayB = startSession(`p44-replay-b-${randomUUID()}`);
  replayA.child.stdin.end(`${sql}\n`);
  replayB.child.stdin.end(`${sql}\n`);
  const replayResults = await Promise.all([replayA.completed, replayB.completed]);
  assert.deepEqual(parseSessionJson(replayResults[0], 'committed replay A'), first);
  assert.deepEqual(parseSessionJson(replayResults[1], 'committed replay B'), first);
  const afterReplay = await readOrderState(fixture);
  assert.deepEqual(afterReplay, beforeReplay);

  const changed = await runSqlText(returnSql({
    fixture, key, quantity: 2, reason: 'Changed same-key payload',
  }), 'Same-key changed payload', {expectFailure: true});
  assertBusinessFailure(changed, /PHASE4_IDEMPOTENCY_CONFLICT/u, 'same-key changed payload');
  assert.deepEqual(await readOperationFootprint(key), firstFootprint);
  return {firstFlightSameKey: true, committedReplayRace: true, changedPayload: true};
};

const runReplayVersusNewIntent = async () => {
  const fixture = await createBaseSale('replay-new-intent', 2);
  const committedKey = `phase44-committed-${randomUUID()}`;
  const committedSql = returnSql({fixture, key: committedKey, quantity: 1});
  const committed = await readJson(committedSql, 'Commit initial Return');
  const committedFootprint = await readOperationFootprint(committedKey);
  const newKey = `phase44-new-intent-${randomUUID()}`;
  const blocker = await startRootBlocker(fixture.orderId, `p44-replay-new-blocker-${randomUUID()}`);
  const newIntentName = `p44-new-intent-${randomUUID()}`;
  const newIntent = startSession(newIntentName);
  newIntent.child.stdin.end(`${returnSql({fixture, key: newKey, quantity: 1})}\n`);
  await waitForBlocked(newIntentName, newIntent);
  return {fixture, committedKey, committedSql, committed, committedFootprint, newKey, blocker, newIntent};
};

const completeReplayVersusNewIntent = async (state) => {
  const replayName = `p44-overlap-replay-${randomUUID()}`;
  const replay = startSession(replayName);
  replay.child.stdin.end(`${state.committedSql}\n`);
  const replayResult = await Promise.race([
    replay.completed,
    new Promise((_, reject) => setTimeout(
      () => reject(new Error('Committed replay incorrectly waited on the root business lock.')),
      5000,
    )),
  ]);
  assert.deepEqual(parseSessionJson(replayResult, 'overlapping committed replay'), state.committed);
  state.blocker.child.stdin.end('COMMIT;\n');
  await state.blocker.completed;
  const newResult = await state.newIntent.completed;
  parseSessionJson(newResult, 'overlapping new intent');
  assert.deepEqual(await readOperationFootprint(state.committedKey), state.committedFootprint);
  const newFootprint = await readOperationFootprint(state.newKey);
  assert.equal(newFootprint.operations, 1);
  assert.equal(newFootprint.returns, 1);
  assert.equal(newFootprint.consumptions, 1);
  const finalState = await readOrderState(state.fixture);
  assert.equal(finalState.consumed, 2);
  assert.equal(finalState.returns, 2);
};

const runReturnCapacityScenarios = async () => {
  const compatible = await createBaseSale('compatible-capacity', 2);
  const compatibleA = `phase44-compatible-a-${randomUUID()}`;
  const compatibleB = `phase44-compatible-b-${randomUUID()}`;
  const compatibleRace = await runRootQueuedPair({
    label: `p44-compatible-${randomUUID()}`,
    orderId: compatible.orderId,
    firstSql: returnSql({fixture: compatible, key: compatibleA, quantity: 1}),
    secondSql: returnSql({fixture: compatible, key: compatibleB, quantity: 1}),
  });
  parseSessionJson(compatibleRace.firstResult, 'compatible Return A');
  parseSessionJson(compatibleRace.secondResult, 'compatible Return B');
  assert.equal((await readOrderState(compatible)).consumed, 2);

  const fullFirst = await createBaseSale('oversubscribed-full-first', 2);
  const fullWinner = `phase44-full-winner-${randomUUID()}`;
  const partialLoser = `phase44-partial-loser-${randomUUID()}`;
  const fullRace = await runRootQueuedPair({
    label: `p44-full-first-${randomUUID()}`,
    orderId: fullFirst.orderId,
    firstSql: returnSql({fixture: fullFirst, key: fullWinner, quantity: 2}),
    secondSql: returnSql({fixture: fullFirst, key: partialLoser, quantity: 1}),
  });
  parseSessionJson(fullRace.firstResult, 'full-capacity winner');
  assertBusinessFailure(
    fullRace.secondResult,
    /PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED/u,
    'full-capacity loser',
  );
  await assertZeroFootprint(partialLoser);
  assert.equal((await readOrderState(fullFirst)).consumed, 2);

  const partialFirst = await createBaseSale('oversubscribed-partial-first', 2);
  const partialWinner = `phase44-partial-winner-${randomUUID()}`;
  const fullLoser = `phase44-full-loser-${randomUUID()}`;
  const partialRace = await runRootQueuedPair({
    label: `p44-partial-first-${randomUUID()}`,
    orderId: partialFirst.orderId,
    firstSql: returnSql({fixture: partialFirst, key: partialWinner, quantity: 1}),
    secondSql: returnSql({fixture: partialFirst, key: fullLoser, quantity: 2}),
  });
  parseSessionJson(partialRace.firstResult, 'partial-capacity winner');
  assertBusinessFailure(
    partialRace.secondResult,
    /PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED/u,
    'oversized second loser',
  );
  await assertZeroFootprint(fullLoser);
  assert.equal((await readOrderState(partialFirst)).consumed, 1);
  return {compatible: true, oversubscribedBothDirections: true};
};

const runReturnReplacementRace = async () => {
  const returnFirst = await createBaseSale('return-before-replacement', 1);
  const returnKey = `phase44-return-first-${randomUUID()}`;
  const replacementLoser = `phase44-replacement-loser-${randomUUID()}`;
  const returnRace = await runRootQueuedPair({
    label: `p44-return-first-${randomUUID()}`,
    orderId: returnFirst.orderId,
    firstSql: returnSql({fixture: returnFirst, key: returnKey, quantity: 1}),
    secondSql: replacementSql({fixture: returnFirst, key: replacementLoser}),
  });
  parseSessionJson(returnRace.firstResult, 'Return-first winner');
  assertBusinessFailure(
    returnRace.secondResult,
    /PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED/u,
    'Replacement loser after Return',
  );
  await assertZeroFootprint(replacementLoser);

  const replacementFirst = await createBaseSale('replacement-before-return', 1);
  const replacementKey = `phase44-replacement-first-${randomUUID()}`;
  const returnLoser = `phase44-return-loser-${randomUUID()}`;
  const replacementRace = await runRootQueuedPair({
    label: `p44-replacement-first-${randomUUID()}`,
    orderId: replacementFirst.orderId,
    firstSql: replacementSql({fixture: replacementFirst, key: replacementKey}),
    secondSql: returnSql({fixture: replacementFirst, key: returnLoser, quantity: 1}),
  });
  const replacementResult = parseSessionJson(
    replacementRace.firstResult,
    'Replacement-first winner',
  );
  assertBusinessFailure(
    replacementRace.secondResult,
    /PHASE43_RETURN_PHYSICAL_LINEAGE_REQUIRED|PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED/u,
    'Return loser after Replacement',
  );
  await assertZeroFootprint(returnLoser);
  const representatives = await readCurrentRepresentatives(replacementFirst);
  assert.equal(representatives.representatives.length, 1);
  assert.equal(representatives.representatives[0].sourceKind, 'replacement_item');
  const issuedItem = await readJson(`SELECT jsonb_build_object('id',item.id)
    FROM public.sales_replacement_items item
    WHERE item.operation_id=${sqlLiteral(replacementResult.operationId)};`,
  'Read winning Replacement item');
  assert.equal(representatives.representatives[0].sourceId, issuedItem.id);
  return {returnWinsDirection: true, replacementWinsDirection: true};
};

const runReplacementReplacementRace = async () => {
  const runDirection = async (label) => {
    const fixture = await createBaseSale(label, 1);
    const winnerKey = `phase44-${label}-winner-${randomUUID()}`;
    const loserKey = `phase44-${label}-loser-${randomUUID()}`;
    const race = await runRootQueuedPair({
      label: `p44-${label}-${randomUUID()}`,
      orderId: fixture.orderId,
      firstSql: replacementSql({fixture, key: winnerKey}),
      secondSql: replacementSql({fixture, key: loserKey}),
    });
    parseSessionJson(race.firstResult, `${label} Replacement winner`);
    assertBusinessFailure(
      race.secondResult,
      /PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED/u,
      `${label} Replacement loser`,
    );
    await assertZeroFootprint(loserKey);
    const state = await readOrderState(fixture);
    assert.equal(state.replacements, 1);
    assert.equal(state.replacementEffects, 1);
    assert.equal(state.consumed, 1);
  };
  await runDirection('replacement-race-a');
  await runDirection('replacement-race-b');
};

const runCrossSaleInventoryRace = async () => {
  const first = await createBaseSale('cross-sale-a', 1);
  const second = await createBaseSale('cross-sale-b', 1);
  const before = Number((await readJson(`SELECT jsonb_build_object(
    'stock',on_hand_quantity) FROM public.inventory_balances
    WHERE warehouse_id=${sqlLiteral(warehouseId)} AND product_id=${sqlLiteral(productId)};`,
  'Read cross-sale stock before')).stock);
  const blocker = startSession(`p44-product-blocker-${randomUUID()}`);
  blocker.child.stdin.write(`BEGIN;
    SELECT id FROM public.products WHERE id=${sqlLiteral(productId)} FOR UPDATE;
    SELECT 'PRODUCT_HELD';\n`);
  await waitForOutput(blocker, 'PRODUCT_HELD');
  const firstKey = `phase44-cross-sale-a-${randomUUID()}`;
  const secondKey = `phase44-cross-sale-b-${randomUUID()}`;
  const firstSessionName = `p44-cross-sale-a-${randomUUID()}`;
  const secondSessionName = `p44-cross-sale-b-${randomUUID()}`;
  const firstSession = startSession(firstSessionName);
  const secondSession = startSession(secondSessionName);
  firstSession.child.stdin.end(`${replacementSql({fixture: first, key: firstKey})}\n`);
  secondSession.child.stdin.end(`${replacementSql({fixture: second, key: secondKey})}\n`);
  await Promise.all([
    waitForBlocked(firstSessionName, firstSession),
    waitForBlocked(secondSessionName, secondSession),
  ]);
  blocker.child.stdin.end('COMMIT;\n');
  await blocker.completed;
  const [firstResult, secondResult] = await Promise.all([
    firstSession.completed,
    secondSession.completed,
  ]);
  parseSessionJson(firstResult, 'Cross-sale Replacement A');
  parseSessionJson(secondResult, 'Cross-sale Replacement B');
  const after = Number((await readJson(`SELECT jsonb_build_object(
    'stock',on_hand_quantity) FROM public.inventory_balances
    WHERE warehouse_id=${sqlLiteral(warehouseId)} AND product_id=${sqlLiteral(productId)};`,
  'Read cross-sale stock after')).stock);
  assert.equal(after, before - 2);
  for (const [fixture, key] of [[first, firstKey], [second, secondKey]]) {
    const footprint = await readOperationFootprint(key);
    assert.equal(footprint.operations, 1);
    assert.equal(footprint.replacements, 1);
    assert.equal(footprint.replacementEffects, 1);
    assert.equal(footprint.movements, 1);
    const state = await readOrderState(fixture);
    assert.equal(state.replacements, 1);
    assert.equal(state.consumed, 1);
  }
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
  const deadlocksBefore = Number((await readJson(`SELECT jsonb_build_object(
    'value',deadlocks) FROM pg_stat_database WHERE datname=current_database();`,
  'Read deadlocks before')).value);

  const sameKey = await runSameKeyScenarios();
  const replayNew = await runReplayVersusNewIntent();
  await completeReplayVersusNewIntent(replayNew);
  const returnCapacity = await runReturnCapacityScenarios();
  const returnReplacement = await runReturnReplacementRace();
  await runReplacementReplacementRace();
  await runCrossSaleInventoryRace();

  const deadlocksAfter = Number((await readJson(`SELECT jsonb_build_object(
    'value',deadlocks) FROM pg_stat_database WHERE datname=current_database();`,
  'Read deadlocks after')).value);
  const deadlockDelta = deadlocksAfter - deadlocksBefore;
  assert.equal(deadlockDelta, 0);

  console.log(JSON.stringify({
    ok: true,
    phase: '4.4',
    slice: 'concurrency-replay',
    freshRebuild: currentPackageD ? '001-131' : '001-123',
    operationalSchema: currentPackageD ? '001-132' : 'historical',
    migration123: currentPackageD ? 'RETIRED_BY_132' : 'PRIVATE_INACTIVE',
    breakMatrix: SLICE_3_BREAK_MATRIX,
    scenarios: Object.fromEntries(Object.keys(SLICE_3_BREAK_MATRIX).map((key) => [key, true])),
    sameKey,
    returnCapacity,
    returnReplacement,
    deadlockDelta,
    lockTimeouts: 0,
    loserOperationScopedFootprint: 'ZERO',
    sharedFinalState: 'EXACT_WINNER_EFFECTS',
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
