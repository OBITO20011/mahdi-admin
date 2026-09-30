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
const cliPath = path.join(projectRoot, 'node_modules', 'supabase', 'dist', 'supabase.js');
const projectId = 'nawasrah-phase5-slice2-runtime-test';
const databaseContainer = `supabase_db_${projectId}`;
const collisionProjectId = 'nawasrah-p5s2-conflict-test';
const collisionDatabaseContainer = `supabase_db_${collisionProjectId}`;
const migration124Path = path.join(
  projectRoot, 'supabase', 'migrations',
  '124_phase5_canonical_collection_reversal_writers.sql',
);
let isolatedProjectRoot = '';
let collisionProjectRoot = '';

const runSqlIn = async (container, sql, label, { failure = false } = {}) => new Promise((resolve, reject) => {
  const child = spawn('docker', [
    'exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
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
    if ((!failure && code !== 0) || (failure && code === 0)) {
      reject(new Error(`${label} unexpected exit ${code}:\n${stderr}\n${stdout}`));
      return;
    }
    resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
  });
  child.stdin.end(sql);
});

const runSql = (sql, label, options) => runSqlIn(
  databaseContainer, sql, label, options,
);

const jsonSql = async (sql, label) => {
  const result = await runSql(sql, label);
  const line = result.stdout.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean).at(-1);
  assert.ok(line, `${label} returned no result`);
  return JSON.parse(line);
};

const openRaceSession = (applicationName) => {
  const child = spawn('docker', [
    'exec', '-i', databaseContainer, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
  ], { cwd: projectRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const session = { child, stdout: '', stderr: '', finished: false };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { session.stdout += chunk; });
  child.stderr.on('data', (chunk) => { session.stderr += chunk; });
  session.completion = new Promise((resolve) => {
    child.on('error', (error) => { session.stderr += error.message; });
    child.on('close', (code) => {
      session.finished = true;
      resolve({ code, stdout: session.stdout.trim(), stderr: session.stderr.trim() });
    });
  });
  child.stdin.write(`SET application_name='${applicationName}';
    SET statement_timeout='10s'; BEGIN;\n`);
  return session;
};

const waitForRaceCondition = async (condition, label) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    // Poll a witnessed state, rather than delaying a participant to guess overlap.
    await new Promise((resolve) => { setTimeout(resolve, 50); });
  }
  assert.fail(`${label}: required runtime barrier was not observed`);
};

const runContendedCollectionRace = async ({ winnerRequest, loserRequest, sharedKey, suffix }) => {
  const winnerName = `p5s2-race-winner-${suffix}`;
  const loserName = `p5s2-race-loser-${suffix}`;
  const winner = openRaceSession(winnerName);
  let loser;
  try {
    winner.child.stdin.write(`${winnerRequest} SELECT 'P5S2_WINNER_HELD';\n`);
    await waitForRaceCondition(() => {
      assert.equal(winner.finished, false, winner.stderr);
      return winner.stdout.includes('P5S2_WINNER_HELD');
    }, `winner acquired the transaction gate ${suffix}`);

    loser = openRaceSession(loserName);
    // ROLLBACK also contains an unexpectedly successful loser without committing it.
    loser.child.stdin.end(`${loserRequest} ROLLBACK;\n`);
    await waitForRaceCondition(async () => {
      assert.equal(loser.finished, false, loser.stderr);
      const lockState = await jsonSql(`WITH expected AS (
        SELECT hashtextextended(
          'phase5-idempotency|erp_user|${ownerId}|customer_collection_v1|${sharedKey}', 0
        ) AS lock_key
      ) SELECT jsonb_build_object('contended', EXISTS (
        SELECT 1 FROM pg_stat_activity waiting
        JOIN pg_locks waiting_lock ON waiting_lock.pid=waiting.pid
        JOIN pg_stat_activity holding ON holding.application_name='${winnerName}'
        JOIN pg_locks held_lock ON held_lock.pid=holding.pid
        CROSS JOIN expected
        WHERE waiting.application_name='${loserName}'
          AND waiting.wait_event_type='Lock' AND waiting.wait_event='advisory'
          AND holding.state='idle in transaction'
          AND waiting_lock.locktype='advisory' AND NOT waiting_lock.granted
          AND held_lock.locktype='advisory' AND held_lock.granted
          AND waiting_lock.mode='ExclusiveLock' AND held_lock.mode='ExclusiveLock'
          AND waiting_lock.classid=held_lock.classid
          AND waiting_lock.objid=held_lock.objid
          AND waiting_lock.objsubid=held_lock.objsubid
          AND waiting_lock.classid::bigint=((expected.lock_key >> 32) & 4294967295)
          AND waiting_lock.objid::bigint=(expected.lock_key & 4294967295)
          AND waiting_lock.objsubid=1
          AND holding.pid=ANY(pg_blocking_pids(waiting.pid))
      ))::text;`, `observe exact idempotency lock wait ${suffix}`);
      return lockState.contended === true;
    }, `loser waiting on the winner's exact idempotency gate ${suffix}`);

    // Release only after PostgreSQL proves that both transactions overlap.
    winner.child.stdin.end('COMMIT;\n');
    const [winnerResult, loserResult] = await Promise.all([
      winner.completion, loser.completion,
    ]);
    assert.equal(winnerResult.code, 0, winnerResult.stderr);
    assert.notEqual(loserResult.code, 0, 'changed-payload loser unexpectedly succeeded');
    assert.match(loserResult.stderr, /PHASE5_COLLECTION_IDEMPOTENCY_CONFLICT/iu);
    assert.doesNotMatch(loserResult.stderr, /40P01|57014|55P03/iu);
  } finally {
    // On assertion failure, terminate only these synthetic test sessions before cleanup.
    if (!winner.finished || (loser && !loser.finished)) {
      await runSql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE application_name IN ('${winnerName}','${loserName}')
          AND pid <> pg_backend_pid();`, `release race sessions ${suffix}`);
      for (const session of [winner, loser].filter(Boolean)) {
        session.child.stdin.destroy();
        await session.completion;
      }
    }
  }
};

const cleanup = async () => {
  for (const isolatedRoot of [isolatedProjectRoot, collisionProjectRoot]) {
    if (!isolatedRoot) continue;
    await execFileAsync(process.execPath, [
      cliPath, 'stop', '--no-backup', '--workdir', isolatedRoot,
    ], {
      cwd: projectRoot, windowsHide: true, timeout: 120_000, maxBuffer: 1024 * 1024,
    }).catch(() => undefined);
  }
};

const runMigrationConflictDrill = async () => {
  const { stdout } = await execFileAsync(process.execPath, [bootstrapPath], {
    cwd: projectRoot,
    windowsHide: true,
    timeout: 360_000,
    maxBuffer: 1024 * 1024,
    env: {
      ...process.env,
      NAWASRAH_ISOLATED_PROJECT_ID: collisionProjectId,
      NAWASRAH_MAX_MIGRATION: '123',
      NAWASRAH_SUPABASE_EXCLUDE:
        'realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor',
    },
  });
  const bootstrap = JSON.parse(stdout);
  assert.equal(bootstrap.ok, true);
  collisionProjectRoot = bootstrap.isolatedProjectRoot;

  await runSqlIn(collisionDatabaseContainer, `
    CREATE FUNCTION phase5_private.commit_customer_payment_reversal_v1(
      UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT
    ) RETURNS TEXT LANGUAGE SQL SECURITY INVOKER SET search_path = pg_catalog
    AS 'SELECT ''deliberate-late-collision''::text';
    REVOKE ALL ON FUNCTION phase5_private.commit_customer_payment_reversal_v1(
      UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT
    ) FROM PUBLIC, anon, authenticated, service_role;
  `, 'create deliberate late Migration 124 collision');

  const migration124 = await readFile(migration124Path, 'utf8');
  const collision = await runSqlIn(
    collisionDatabaseContainer, migration124,
    'Migration 124 late collision rollback', { failure: true },
  );
  assert.match(collision.stderr, /already exists/iu);

  const residue = await runSqlIn(collisionDatabaseContainer, `
    SELECT jsonb_build_object(
      'deliberateFixture',(
        SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='phase5_private'
          AND p.proname='commit_customer_payment_reversal_v1'
          AND pg_get_function_result(p.oid)='text'
      ),
      'rolledBackEarlierFunctions',(
        SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='phase5_private' AND p.proname IN (
          'validate_customer_collection_operation_v1',
          'validate_customer_payment_reversal_operation_v1',
          'commit_customer_collection_v1'
        )
      ),
      'partialRoleGrants',(
        SELECT count(*) FROM information_schema.routine_privileges
        WHERE specific_schema='phase5_private'
          AND routine_name IN (
            'validate_customer_collection_operation_v1',
            'validate_customer_payment_reversal_operation_v1',
            'commit_customer_collection_v1'
          )
          AND grantee IN ('PUBLIC','anon','authenticated','service_role')
      )
    )::text;
  `, 'Migration 124 collision residue');
  const state = JSON.parse(residue.stdout.split(/\r?\n/u).filter(Boolean).at(-1));
  assert.deepEqual(state, {
    deliberateFixture: 1,
    rolledBackEarlierFunctions: 0,
    partialRoleGrants: 0,
  });
  await execFileAsync(process.execPath, [
    cliPath, 'stop', '--no-backup', '--workdir', collisionProjectRoot,
  ], {
    cwd: projectRoot, windowsHide: true, timeout: 120_000, maxBuffer: 1024 * 1024,
  });
  collisionProjectRoot = '';
  return true;
};

const ownerId = '96000000-0000-4000-8000-000000000001';
const otherId = '96000000-0000-4000-8000-000000000002';
const customerId = '96000000-0000-4000-8000-000000000100';
const shiftId = '96000000-0000-4000-8000-000000000200';
const ownerClaims = `SELECT set_config('request.jwt.claims',
  '{"sub":"${ownerId}","role":"authenticated","aal":"aal2"}',false);`;
const order1 = '96000000-0000-4000-8000-000000000301';
const order2 = '96000000-0000-4000-8000-000000000302';
const order3 = '96000000-0000-4000-8000-000000000303';
const order4 = '96000000-0000-4000-8000-000000000304';
const order5 = '96000000-0000-4000-8000-000000000305';
const payment1 = '96000000-0000-4000-8000-000000000401';
const payment2 = '96000000-0000-4000-8000-000000000402';
const payment3 = '96000000-0000-4000-8000-000000000403';
const payment4 = '96000000-0000-4000-8000-000000000404';
const payment5 = '96000000-0000-4000-8000-000000000405';
const validRaceFixtures = [
  ['96000000-0000-4000-8000-000000000306', '96000000-0000-4000-8000-000000000406', '96000000-0000-4000-8000-000000000416'],
  ['96000000-0000-4000-8000-000000000307', '96000000-0000-4000-8000-000000000407', '96000000-0000-4000-8000-000000000417'],
  ['96000000-0000-4000-8000-000000000308', '96000000-0000-4000-8000-000000000408', '96000000-0000-4000-8000-000000000418'],
  ['96000000-0000-4000-8000-000000000309', '96000000-0000-4000-8000-000000000409', '96000000-0000-4000-8000-000000000419'],
  ['96000000-0000-4000-8000-000000000310', '96000000-0000-4000-8000-000000000410', '96000000-0000-4000-8000-000000000420'],
  ['96000000-0000-4000-8000-000000000311', '96000000-0000-4000-8000-000000000411', '96000000-0000-4000-8000-000000000421'],
];

try {
  const migrationConflictAtomicity = await runMigrationConflictDrill();
  const { stdout: bootstrapOutput } = await execFileAsync(process.execPath, [bootstrapPath], {
    cwd: projectRoot,
    windowsHide: true,
    timeout: 360_000,
    maxBuffer: 1024 * 1024,
    env: {
      ...process.env,
      NAWASRAH_ISOLATED_PROJECT_ID: projectId,
      NAWASRAH_SUPABASE_EXCLUDE:
        'realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor',
    },
  });
  const bootstrap = JSON.parse(bootstrapOutput);
  assert.equal(bootstrap.ok, true);
  isolatedProjectRoot = bootstrap.isolatedProjectRoot;

  const catalog = await jsonSql(`SELECT jsonb_build_object(
    'functions',(SELECT jsonb_agg(p.proname ORDER BY p.proname) FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='phase5_private'),
    'slice2SecurityDefiners',(SELECT count(*) FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='phase5_private' AND p.proname IN (
        'validate_customer_collection_operation_v1',
        'validate_customer_payment_reversal_operation_v1',
        'commit_customer_collection_v1',
        'commit_customer_payment_reversal_v1'
      ) AND p.prosecdef),
    'slice2UnsafePaths',(SELECT count(*) FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='phase5_private' AND p.proname LIKE '%customer%v1'
        AND NOT (p.proconfig @> ARRAY['search_path=pg_catalog']::text[])),
    'roleExecute',(SELECT count(*) FROM information_schema.routine_privileges
      WHERE specific_schema='phase5_private'
        AND routine_name IN ('validate_customer_collection_operation_v1',
          'validate_customer_payment_reversal_operation_v1',
          'commit_customer_collection_v1','commit_customer_payment_reversal_v1')
        AND grantee IN ('PUBLIC','anon','authenticated','service_role')),
    'publicWrappers',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.prokind='f'
        AND CASE WHEN p.prokind='f' THEN pg_get_functiondef(p.oid) ELSE '' END
          LIKE '%phase5_private.commit_customer%')
  )::text;`, 'Slice 2 catalog');
  assert.ok(catalog.functions.includes('commit_customer_collection_v1'));
  assert.ok(catalog.functions.includes('commit_customer_payment_reversal_v1'));
  assert.equal(catalog.slice2SecurityDefiners, 0);
  assert.equal(catalog.slice2UnsafePaths, 0);
  assert.equal(catalog.roleExecute, 0);
  assert.equal(catalog.publicWrappers, 0);

  for (const role of ['anon', 'authenticated', 'service_role']) {
    const denial = await runSql(
      `SET ROLE ${role}; SELECT phase5_private.commit_customer_collection_v1(
        '${ownerId}','${order1}','${payment1}',1000,'cliq','C1','acl-denial');`,
      `${role} writer denial`, { failure: true },
    );
    assert.match(denial.stderr, /permission denied for schema phase5_private/iu);
  }

  const fixture = await jsonSql(`
    INSERT INTO auth.users(id,email) VALUES
      ('${ownerId}','phase5-slice2-owner@example.invalid'),
      ('${otherId}','phase5-slice2-other@example.invalid');
    INSERT INTO public.profiles(id,full_name) VALUES
      ('${ownerId}','Phase 5 Slice 2 Owner'),
      ('${otherId}','Phase 5 Slice 2 Other');
    INSERT INTO public.user_roles(user_id,role_id)
      SELECT '${ownerId}',id FROM public.roles WHERE code='admin';
    INSERT INTO public.customers(id,full_name,phone) VALUES
      ('${customerId}','Phase 5 Slice 2 Customer','0796000000');
    INSERT INTO public.cash_shifts(
      id,shift_number,branch_id,opened_by,opening_cash_in_minor_units
    ) SELECT '${shiftId}','P5-S2-SHIFT',id,'${ownerId}',0
      FROM public.branches ORDER BY id LIMIT 1;
    INSERT INTO public.orders(
      id,order_number,customer_id,branch_id,warehouse_id,status,payment_method,
      subtotal_in_minor_units,delivery_fee_in_minor_units,total_in_minor_units,
      amount_paid_in_minor_units,source,cash_shift_id
    ) SELECT fixture.id,fixture.number,'${customerId}',branch.id,warehouse.id,
      'completed','debt',fixture.total - 100,100,fixture.total,fixture.total,
      'pos','${shiftId}'
    FROM (VALUES
      ('${order1}'::uuid,'P5-S2-ORDER-1',1000::bigint),
      ('${order2}'::uuid,'P5-S2-ORDER-2',300::bigint),
      ('${order3}'::uuid,'P5-S2-ORDER-3',500::bigint),
      ('${order4}'::uuid,'P5-S2-ORDER-4',400::bigint),
      ('${order5}'::uuid,'P5-S2-ORDER-5',400::bigint),
      ('${validRaceFixtures[0][0]}'::uuid,'P5-S2-RACE-1',300::bigint),
      ('${validRaceFixtures[1][0]}'::uuid,'P5-S2-RACE-2',300::bigint),
      ('${validRaceFixtures[2][0]}'::uuid,'P5-S2-RACE-3',300::bigint),
      ('${validRaceFixtures[3][0]}'::uuid,'P5-S2-RACE-4',300::bigint),
      ('${validRaceFixtures[4][0]}'::uuid,'P5-S2-RACE-5',300::bigint),
      ('${validRaceFixtures[5][0]}'::uuid,'P5-S2-RACE-6',300::bigint)
    ) fixture(id,number,total)
    CROSS JOIN LATERAL (SELECT id FROM public.branches ORDER BY id LIMIT 1) branch
    CROSS JOIN LATERAL (SELECT id FROM public.warehouses
      WHERE branch_id=branch.id ORDER BY id LIMIT 1) warehouse;
    INSERT INTO public.customer_payments(
      id,payment_number,customer_id,order_id,amount_in_minor_units,payment_method,
      reference_number,created_by,cash_shift_id,idempotency_key
    ) VALUES
      ('${payment1}','P5-S2-PAY-1','${customerId}','${order1}',1000,'cliq','C1','${ownerId}','${shiftId}','source-1'),
      ('${payment2}','P5-S2-PAY-2','${customerId}','${order2}',300,'cliq','C2','${ownerId}','${shiftId}','source-2'),
      ('${payment3}','P5-S2-PAY-3','${customerId}','${order3}',500,'cash',NULL,'${ownerId}','${shiftId}','source-3'),
      ('${payment4}','P5-S2-PAY-4','${customerId}','${order4}',400,'cliq','C4','${ownerId}','${shiftId}','source-4'),
      ('${payment5}','P5-S2-PAY-5','${customerId}','${order5}',400,'cliq','C5','${ownerId}','${shiftId}','source-5'),
      ('${validRaceFixtures[0][1]}','P5-S2-RACE-A1','${customerId}','${validRaceFixtures[0][0]}',100,'cliq','RA1','${ownerId}','${shiftId}','race-a1'),
      ('${validRaceFixtures[0][2]}','P5-S2-RACE-B1','${customerId}','${validRaceFixtures[0][0]}',200,'cliq','RB1','${ownerId}','${shiftId}','race-b1'),
      ('${validRaceFixtures[1][1]}','P5-S2-RACE-A2','${customerId}','${validRaceFixtures[1][0]}',100,'cliq','RA2','${ownerId}','${shiftId}','race-a2'),
      ('${validRaceFixtures[1][2]}','P5-S2-RACE-B2','${customerId}','${validRaceFixtures[1][0]}',200,'cliq','RB2','${ownerId}','${shiftId}','race-b2'),
      ('${validRaceFixtures[2][1]}','P5-S2-RACE-A3','${customerId}','${validRaceFixtures[2][0]}',100,'cliq','RA3','${ownerId}','${shiftId}','race-a3'),
      ('${validRaceFixtures[2][2]}','P5-S2-RACE-B3','${customerId}','${validRaceFixtures[2][0]}',200,'cliq','RB3','${ownerId}','${shiftId}','race-b3'),
      ('${validRaceFixtures[3][1]}','P5-S2-RACE-A4','${customerId}','${validRaceFixtures[3][0]}',100,'cliq','RA4','${ownerId}','${shiftId}','race-a4'),
      ('${validRaceFixtures[3][2]}','P5-S2-RACE-B4','${customerId}','${validRaceFixtures[3][0]}',200,'cliq','RB4','${ownerId}','${shiftId}','race-b4'),
      ('${validRaceFixtures[4][1]}','P5-S2-RACE-A5','${customerId}','${validRaceFixtures[4][0]}',100,'cliq','RA5','${ownerId}','${shiftId}','race-a5'),
      ('${validRaceFixtures[4][2]}','P5-S2-RACE-B5','${customerId}','${validRaceFixtures[4][0]}',200,'cliq','RB5','${ownerId}','${shiftId}','race-b5'),
      ('${validRaceFixtures[5][1]}','P5-S2-RACE-A6','${customerId}','${validRaceFixtures[5][0]}',100,'cliq','RA6','${ownerId}','${shiftId}','race-a6'),
      ('${validRaceFixtures[5][2]}','P5-S2-RACE-B6','${customerId}','${validRaceFixtures[5][0]}',200,'cliq','RB6','${ownerId}','${shiftId}','race-b6');
    SELECT jsonb_build_object(
      'branchId',(SELECT branch_id FROM public.orders WHERE id='${order1}'),
      'warehouseId',(SELECT warehouse_id FROM public.orders WHERE id='${order1}'),
      'operationRows',(SELECT count(*) FROM phase5_private.financial_operation_events)
    )::text;`, 'Slice 2 fixture');
  assert.equal(fixture.operationRows, 0);

  const collection1 = await jsonSql(`SELECT phase5_private.commit_customer_collection_v1(
    '${ownerId}','${order1}','${payment1}',1000,'cliq','C1','collection-key-1'
  )::text;`, 'collection success');
  assert.equal(collection1.success, true);
  assert.equal(collection1.originalPaymentId, payment1);
  assert.equal(collection1.amountInMinorUnits, 1000);

  const beforeReplay = await jsonSql(`SELECT jsonb_build_object(
    'operations',(SELECT count(*) FROM phase5_private.financial_operation_events),
    'collections',(SELECT count(*) FROM phase5_private.collection_events),
    'reversals',(SELECT count(*) FROM phase5_private.payment_reversal_events),
    'result',(SELECT result_snapshot FROM phase5_private.financial_operation_events
      WHERE id='${collection1.operationId}')
  )::text;`, 'collection pre-replay fingerprint');
  const collectionReplay = await jsonSql(`SELECT phase5_private.commit_customer_collection_v1(
    '${ownerId}','${order1}','${payment1}',1000,'cliq','C1','collection-key-1'
  )::text;`, 'collection replay');
  const afterReplay = await jsonSql(`SELECT jsonb_build_object(
    'operations',(SELECT count(*) FROM phase5_private.financial_operation_events),
    'collections',(SELECT count(*) FROM phase5_private.collection_events),
    'reversals',(SELECT count(*) FROM phase5_private.payment_reversal_events),
    'result',(SELECT result_snapshot FROM phase5_private.financial_operation_events
      WHERE id='${collection1.operationId}')
  )::text;`, 'collection post-replay fingerprint');
  assert.deepEqual(collectionReplay, collection1);
  assert.deepEqual(afterReplay, beforeReplay);
  assert.match(collection1.operationEventAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u);

  for (const zone of ['UTC', 'Asia/Amman', 'Pacific/Auckland']) {
    const zonedReplay = await jsonSql(`SET TIME ZONE '${zone}';
      SELECT phase5_private.commit_customer_collection_v1(
        '${ownerId}','${order1}','${payment1}',1000,'cliq','C1','collection-key-1'
      )::text;`, `collection replay in ${zone}`);
    assert.deepEqual(zonedReplay, collection1);
  }
  const collectionTimezoneAfter = await jsonSql(`SELECT jsonb_build_object(
    'operations',(SELECT count(*) FROM phase5_private.financial_operation_events),
    'collections',(SELECT count(*) FROM phase5_private.collection_events),
    'reversals',(SELECT count(*) FROM phase5_private.payment_reversal_events),
    'result',(SELECT result_snapshot FROM phase5_private.financial_operation_events
      WHERE id='${collection1.operationId}')
  )::text;`, 'collection timezone replay fingerprint');
  assert.deepEqual(collectionTimezoneAfter, beforeReplay);

  const conflict = await runSql(`SELECT phase5_private.commit_customer_collection_v1(
    '${ownerId}','${order1}','${payment1}',999,'cliq','C1','collection-key-1');`,
  'collection changed-payload conflict', { failure: true });
  assert.match(conflict.stderr, /PHASE5_COLLECTION_IDEMPOTENCY_CONFLICT/iu);

  const concurrencyCalls = await Promise.all([
    runSql(`SELECT phase5_private.commit_customer_collection_v1(
      '${ownerId}','${order2}','${payment2}',300,'cliq','C2','collection-race-2');`,
    'collection race A'),
    runSql(`SELECT phase5_private.commit_customer_collection_v1(
      '${ownerId}','${order2}','${payment2}',300,'cliq','C2','collection-race-2');`,
    'collection race B'),
  ]);
  assert.equal(concurrencyCalls[0].stdout, concurrencyCalls[1].stdout);
  const collection2 = JSON.parse(concurrencyCalls[0].stdout.split(/\r?\n/u).filter(Boolean).at(-1));
  const raceRows = await jsonSql(`SELECT jsonb_build_object(
    'operations',(SELECT count(*) FROM phase5_private.financial_operation_events
      WHERE idempotency_key='collection-race-2'),
    'collections',(SELECT count(*) FROM phase5_private.collection_events
      WHERE original_payment_id='${payment2}')
  )::text;`, 'collection race rows');
  assert.deepEqual(raceRows, { operations: 1, collections: 1 });

  const raceDeadlocksBefore = await jsonSql(`SELECT deadlocks::int FROM pg_stat_database
    WHERE datname=current_database();`, 'valid race deadlocks before');
  for (let index = 0; index < validRaceFixtures.length; index += 1) {
    const [raceOrder, paymentA, paymentB] = validRaceFixtures[index];
    const suffix = index + 1;
    const sharedKey = `valid-vs-valid-race-${suffix}`;
    const requestA = `SELECT phase5_private.commit_customer_collection_v1(
      '${ownerId}','${raceOrder}','${paymentA}',100,'cliq','RA${suffix}','${sharedKey}'
    )::text;`;
    const requestB = `SELECT phase5_private.commit_customer_collection_v1(
      '${ownerId}','${raceOrder}','${paymentB}',200,'cliq','RB${suffix}','${sharedKey}'
    )::text;`;

    await runSql(`BEGIN; ${requestA} ROLLBACK;`, `valid race payload A ${suffix}`);
    await runSql(`BEGIN; ${requestB} ROLLBACK;`, `valid race payload B ${suffix}`);

    const aFirst = index < 3;
    await runContendedCollectionRace({
      winnerRequest: aFirst ? requestA : requestB,
      loserRequest: aFirst ? requestB : requestA,
      sharedKey,
      suffix,
    });

    const validRaceState = await jsonSql(`SELECT jsonb_build_object(
      'operations',(SELECT count(*) FROM phase5_private.financial_operation_events
        WHERE actor_scope_id='${ownerId}' AND operation_type='customer_collection_v1'
          AND idempotency_key='${sharedKey}'),
      'collections',(SELECT count(*) FROM phase5_private.collection_events
        WHERE order_id='${raceOrder}'),
      'mixedIdentity',(SELECT count(*) FROM phase5_private.financial_operation_events operation
        JOIN phase5_private.collection_events collection
          ON collection.financial_operation_id=operation.id
        WHERE operation.idempotency_key='${sharedKey}'
          AND (operation.request_identity_snapshot->>'originalPaymentId')::uuid
            IS DISTINCT FROM collection.original_payment_id),
      'winnerPayment',(SELECT collection.original_payment_id
        FROM phase5_private.collection_events collection WHERE collection.order_id='${raceOrder}')
    )::text;`, `valid race state ${suffix}`);
    assert.equal(validRaceState.operations, 1);
    assert.equal(validRaceState.collections, 1);
    assert.equal(validRaceState.mixedIdentity, 0);
    assert.equal(validRaceState.winnerPayment, aFirst ? paymentA : paymentB);
  }
  const raceDeadlockDelta = await jsonSql(`SELECT deadlocks::int FROM pg_stat_database
    WHERE datname=current_database();`, 'valid race deadlocks after') - raceDeadlocksBefore;
  assert.equal(raceDeadlockDelta, 0);

  const cashReversal = await jsonSql(`SELECT phase5_private.commit_customer_payment_reversal_v1(
    '${ownerId}','${order2}','${collection2.collectionEventId}','${payment2}',
    'cash',NULL,'Exact cross-tender cash reversal','reversal-key-2'
  )::text;`, 'cross-tender cash reversal');
  assert.equal(cashReversal.reversalTenderMethod, 'cash');
  assert.equal(cashReversal.cashShiftId, shiftId);

  const reversalReplayBefore = await jsonSql(`SELECT jsonb_build_object(
    'operations',(SELECT count(*) FROM phase5_private.financial_operation_events),
    'collections',(SELECT count(*) FROM phase5_private.collection_events),
    'reversals',(SELECT count(*) FROM phase5_private.payment_reversal_events),
    'result',(SELECT result_snapshot FROM phase5_private.financial_operation_events
      WHERE id='${cashReversal.operationId}')
  )::text;`, 'reversal pre-replay fingerprint');
  const cashReversalReplay = await jsonSql(`SELECT phase5_private.commit_customer_payment_reversal_v1(
    '${ownerId}','${order2}','${collection2.collectionEventId}','${payment2}',
    'cash',NULL,'Exact cross-tender cash reversal','reversal-key-2'
  )::text;`, 'reversal replay');
  const reversalReplayAfter = await jsonSql(`SELECT jsonb_build_object(
    'operations',(SELECT count(*) FROM phase5_private.financial_operation_events),
    'collections',(SELECT count(*) FROM phase5_private.collection_events),
    'reversals',(SELECT count(*) FROM phase5_private.payment_reversal_events),
    'result',(SELECT result_snapshot FROM phase5_private.financial_operation_events
      WHERE id='${cashReversal.operationId}')
  )::text;`, 'reversal post-replay fingerprint');
  assert.deepEqual(cashReversalReplay, cashReversal);
  assert.deepEqual(reversalReplayAfter, reversalReplayBefore);
  assert.match(cashReversal.operationEventAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u);

  const collectionAfterCanonicalReversal = await jsonSql(`SELECT
    phase5_private.commit_customer_collection_v1(
      '${ownerId}','${order2}','${payment2}',300,'cliq','C2','collection-race-2'
    )::text;`, 'collection replay after canonical reversal');
  assert.deepEqual(collectionAfterCanonicalReversal, collection2);

  for (const zone of ['UTC', 'Asia/Amman', 'Pacific/Auckland']) {
    const zonedReplay = await jsonSql(`SET TIME ZONE '${zone}';
      SELECT phase5_private.commit_customer_payment_reversal_v1(
        '${ownerId}','${order2}','${collection2.collectionEventId}','${payment2}',
        'cash',NULL,'Exact cross-tender cash reversal','reversal-key-2'
      )::text;`, `reversal replay in ${zone}`);
    assert.deepEqual(zonedReplay, cashReversal);
  }
  const reversalTimezoneAfter = await jsonSql(`SELECT jsonb_build_object(
    'operations',(SELECT count(*) FROM phase5_private.financial_operation_events),
    'collections',(SELECT count(*) FROM phase5_private.collection_events),
    'reversals',(SELECT count(*) FROM phase5_private.payment_reversal_events),
    'result',(SELECT result_snapshot FROM phase5_private.financial_operation_events
      WHERE id='${cashReversal.operationId}')
  )::text;`, 'reversal timezone replay fingerprint');
  assert.deepEqual(reversalTimezoneAfter, reversalReplayBefore);

  const duplicateReversal = await runSql(`SELECT phase5_private.commit_customer_payment_reversal_v1(
    '${ownerId}','${order2}','${collection2.collectionEventId}','${payment2}',
    'cash',NULL,'Different exact reversal','reversal-key-2b');`,
  'duplicate full reversal rejection', { failure: true });
  assert.match(duplicateReversal.stderr, /PHASE5_PAYMENT_ALREADY_REVERSED/iu);

  await jsonSql(`${ownerClaims} SELECT public.reverse_customer_order_payment(
    '${payment2}','Legacy reversal after canonical reversal evidence'
  )::text;`, 'legacy reversal after canonical reversal');
  const collectionAfterLegacyReversal = await jsonSql(`SELECT
    phase5_private.commit_customer_collection_v1(
      '${ownerId}','${order2}','${payment2}',300,'cliq','C2','collection-race-2'
    )::text;`, 'collection replay after later legacy reversal');
  const reversalAfterLegacyReversal = await jsonSql(`SELECT
    phase5_private.commit_customer_payment_reversal_v1(
      '${ownerId}','${order2}','${collection2.collectionEventId}','${payment2}',
      'cash',NULL,'Exact cross-tender cash reversal','reversal-key-2'
    )::text;`, 'canonical reversal replay after payment is reversed');
  assert.deepEqual(collectionAfterLegacyReversal, collection2);
  assert.deepEqual(reversalAfterLegacyReversal, cashReversal);

  await jsonSql(`${ownerClaims} SELECT public.reverse_customer_order_payment(
    '${payment1}','Unbound legacy reversal coexistence proof'
  )::text;`, 'unbound legacy reversal');
  const collectionAfterUnboundLegacyReversal = await jsonSql(`SELECT
    phase5_private.commit_customer_collection_v1(
      '${ownerId}','${order1}','${payment1}',1000,'cliq','C1','collection-key-1'
    )::text;`, 'collection replay after unbound legacy reversal');
  assert.deepEqual(collectionAfterUnboundLegacyReversal, collection1);
  const freshAgainstLegacyReversal = await runSql(`SELECT
    phase5_private.commit_customer_payment_reversal_v1(
      '${ownerId}','${order1}','${collection1.collectionEventId}','${payment1}',
      'cliq','LEGACY-BLOCK','Must not adopt legacy reversal','legacy-adoption-probe'
    );`, 'fresh canonical reversal against legacy reversal', { failure: true });
  assert.match(freshAgainstLegacyReversal.stderr, /PHASE5_PAYMENT_REVERSAL_SOURCE_INVALID/iu);

  const collection3 = await jsonSql(`SET TIME ZONE 'Asia/Amman';
    SELECT phase5_private.commit_customer_collection_v1(
    '${ownerId}','${order3}','${payment3}',500,'cash',NULL,'collection-key-3'
  )::text;`, 'cash collection created in Asia/Amman');
  const collection3UtcReplay = await jsonSql(`SET TIME ZONE 'UTC';
    SELECT phase5_private.commit_customer_collection_v1(
      '${ownerId}','${order3}','${payment3}',500,'cash',NULL,'collection-key-3'
    )::text;`, 'Asia/Amman-created collection replayed in UTC');
  assert.deepEqual(collection3UtcReplay, collection3);
  const cliqReversal = await jsonSql(`SET TIME ZONE 'Pacific/Auckland';
    SELECT phase5_private.commit_customer_payment_reversal_v1(
    '${ownerId}','${order3}','${collection3.collectionEventId}','${payment3}',
    'cliq','REV-C3','CliQ reversal after shift close','reversal-key-3'
  )::text;`, 'CliQ reversal created in Pacific/Auckland records no Cash Shift');
  assert.equal(cliqReversal.reversalTenderMethod, 'cliq');
  assert.equal(cliqReversal.cashShiftId, null);
  const cliqReversalUtcReplay = await jsonSql(`SET TIME ZONE 'UTC';
    SELECT phase5_private.commit_customer_payment_reversal_v1(
      '${ownerId}','${order3}','${collection3.collectionEventId}','${payment3}',
      'cliq','REV-C3','CliQ reversal after shift close','reversal-key-3'
    )::text;`, 'Pacific/Auckland-created reversal replayed in UTC');
  assert.deepEqual(cliqReversalUtcReplay, cliqReversal);

  const collection4 = await jsonSql(`SELECT phase5_private.commit_customer_collection_v1(
    '${ownerId}','${order4}','${payment4}',400,'cliq','C4','collection-key-4'
  )::text;`, 'legacy guard collection');
  await runSql(`
    INSERT INTO public.business_operations(id,operation_type,initiated_by)
    VALUES ('96000000-0000-4000-8000-000000000501','legacy_return','${ownerId}');
    INSERT INTO public.sales_return_events(
      id,return_number,operation_id,order_id,branch_id,warehouse_id,cash_shift_id,
      reason,refund_method,merchandise_refund_amount_in_minor_units,
      reference_number,created_by
    ) VALUES (
      '96000000-0000-4000-8000-000000000502','P5-S2-LEGACY-RETURN',
      '96000000-0000-4000-8000-000000000501','${order4}',
      '${fixture.branchId}','${fixture.warehouseId}','${shiftId}',
      'Legacy split evidence unavailable','cash',50,NULL,'${ownerId}'
    );`, 'legacy return evidence fixture');
  const legacyGuard = await runSql(`SELECT phase5_private.commit_customer_payment_reversal_v1(
    '${ownerId}','${order4}','${collection4.collectionEventId}','${payment4}',
    'cliq','REV-C4','Must fail closed on legacy evidence','reversal-key-4');`,
  'legacy evidence fail closed', { failure: true });
  assert.match(legacyGuard.stderr, /PHASE5_LEGACY_RETURN_EVIDENCE_INCOMPLETE/iu);

  const rollbackBefore = await jsonSql(`SELECT jsonb_build_object(
    'operations',(SELECT count(*) FROM phase5_private.financial_operation_events),
    'reversals',(SELECT count(*) FROM phase5_private.payment_reversal_events)
  )::text;`, 'rollback before');
  await runSql(`BEGIN;
    SELECT phase5_private.commit_customer_payment_reversal_v1(
      '${ownerId}','${order4}','${collection4.collectionEventId}','${payment4}',
      'cliq','REV-C4','Must fail closed on legacy evidence','rollback-proof');
    COMMIT;`, 'atomic failure proof', { failure: true });
  const rollbackAfter = await jsonSql(`SELECT jsonb_build_object(
    'operations',(SELECT count(*) FROM phase5_private.financial_operation_events),
    'reversals',(SELECT count(*) FROM phase5_private.payment_reversal_events)
  )::text;`, 'rollback after');
  assert.deepEqual(rollbackAfter, rollbackBefore);

  const collection5 = await jsonSql(`SELECT phase5_private.commit_customer_collection_v1(
    '${ownerId}','${order5}','${payment5}',400,'cliq','C5','collection-key-5'
  )::text;`, 'modern evidence guard collection');
  const modernSaleOperation = '96000000-0000-4000-8000-000000000510';
  const fakeReturnOperation = '96000000-0000-4000-8000-000000000511';
  const fakeReturnEvent = '96000000-0000-4000-8000-000000000512';
  await runSql(`
    INSERT INTO public.business_operations(
      id,operation_type,idempotency_key,request_fingerprint,initiated_by,
      result_snapshot,completed_at,request_identity_version,
      request_identity_snapshot,actor_scope_type,actor_scope_hash
    ) VALUES (
      '${modernSaleOperation}','phase3_pos_sale_v1','p5-s2-modern-sale',repeat('1',64),
      '${ownerId}','{"success":true}'::jsonb,clock_timestamp(),301,
      '{"fixture":"phase5-slice2-modern-sale"}'::jsonb,'erp_user',repeat('2',64)
    );
    UPDATE public.orders SET operation_id='${modernSaleOperation}' WHERE id='${order5}';
    INSERT INTO public.business_operations(
      id,operation_type,idempotency_key,request_fingerprint,initiated_by,
      result_snapshot,completed_at,request_identity_version,
      request_identity_snapshot,actor_scope_type,actor_scope_hash
    ) VALUES (
      '${fakeReturnOperation}','phase4_return_v1','p5-s2-foundation-only-return',
      repeat('3',64),'${ownerId}',jsonb_build_object(
        'success',true,'operationId','${fakeReturnOperation}'::uuid,
        'returnId','${fakeReturnEvent}'::uuid,'returnNumber','P5-S2-FAKE-RETURN',
        'orderId','${order5}'::uuid,'merchandiseEntitlementInMinorUnits',50,
        'debtReductionInMinorUnits',0,'moneyRefundInMinorUnits',50,
        'refundMethod','cliq','deliveryRefundInMinorUnits',0,
        'taxRefundInMinorUnits',0
      ),clock_timestamp(),401,jsonb_build_object('order_id','${order5}'::uuid),
      'erp_user',repeat('4',64)
    );
    INSERT INTO public.sales_return_events(
      id,return_number,operation_id,order_id,branch_id,warehouse_id,cash_shift_id,
      reason,refund_method,reference_number,
      merchandise_refund_amount_in_minor_units,contract_version,
      settlement_status,outstanding_debt_before_snapshot_in_minor_units,
      net_collected_before_snapshot_in_minor_units,
      debt_reduction_amount_in_minor_units,money_refund_amount_in_minor_units,
      raw_customer_damage_deduction_in_minor_units,
      applied_customer_damage_deduction_in_minor_units,
      settlement_coordinator_version
    ) VALUES (
      '${fakeReturnEvent}','P5-S2-FAKE-RETURN','${fakeReturnOperation}','${order5}',
      '${fixture.branchId}','${fixture.warehouseId}','${shiftId}',
      'Foundation-only capacity poisoning probe','cliq','P5-S2-FAKE-REFUND',
      50,401,'draft',0,400,0,50,0,0,402
    );
    SELECT set_config('nawasrah.phase4_finalization_operation_id',
      '${fakeReturnOperation}',true);
    ALTER TABLE public.sales_return_events DISABLE TRIGGER
      trg_guard_sales_return_event_history;
    ALTER TABLE public.sales_return_events DISABLE TRIGGER
      trg_phase42_require_evidence_before_return_settlement;
    UPDATE public.sales_return_events
    SET settlement_status='settled',settled_at=clock_timestamp()
    WHERE id='${fakeReturnEvent}';
    ALTER TABLE public.sales_return_events ENABLE TRIGGER
      trg_phase42_require_evidence_before_return_settlement;
    ALTER TABLE public.sales_return_events ENABLE TRIGGER
      trg_guard_sales_return_event_history;
  `, 'create foundation-only modern settled-looking Return');
  const modernEvidenceBefore = await jsonSql(`SELECT jsonb_build_object(
    'operations',(SELECT count(*) FROM phase5_private.financial_operation_events),
    'reversals',(SELECT count(*) FROM phase5_private.payment_reversal_events),
    'returnEvidence',(SELECT count(*) FROM public.phase42_return_settlement_evidence
      WHERE operation_id='${fakeReturnOperation}'),
    'returnEffects',(SELECT count(*) FROM public.phase42_return_inventory_effects
      WHERE operation_id='${fakeReturnOperation}')
  )::text;`, 'modern evidence guard before');
  const modernEvidenceGuard = await runSql(`SELECT phase5_private.commit_customer_payment_reversal_v1(
    '${ownerId}','${order5}','${collection5.collectionEventId}','${payment5}',
    'cliq','REV-C5','Must reject foundation-only modern Return','reversal-key-5');`,
  'foundation-only modern Return rejection', { failure: true });
  assert.match(modernEvidenceGuard.stderr, /PHASE42_OPERATIONAL_EVIDENCE_INVALID/iu);
  const modernEvidenceAfter = await jsonSql(`SELECT jsonb_build_object(
    'operations',(SELECT count(*) FROM phase5_private.financial_operation_events),
    'reversals',(SELECT count(*) FROM phase5_private.payment_reversal_events),
    'returnEvidence',(SELECT count(*) FROM public.phase42_return_settlement_evidence
      WHERE operation_id='${fakeReturnOperation}'),
    'returnEffects',(SELECT count(*) FROM public.phase42_return_inventory_effects
      WHERE operation_id='${fakeReturnOperation}')
  )::text;`, 'modern evidence guard after');
  assert.deepEqual(modernEvidenceAfter, modernEvidenceBefore);

  const corruption = await runSql(`BEGIN;
    ALTER TABLE phase5_private.financial_operation_events DISABLE TRIGGER
      trg_phase5_financial_operation_events_immutable;
    UPDATE phase5_private.financial_operation_events
    SET result_snapshot=jsonb_set(result_snapshot,'{amountInMinorUnits}','999'::jsonb)
    WHERE id='${collection1.operationId}';
    SELECT phase5_private.validate_customer_collection_operation_v1('${collection1.operationId}');
    ROLLBACK;`, 'stored result corruption rejection', { failure: true });
  assert.match(corruption.stderr, /PHASE5_COLLECTION_OPERATION_INVALID/iu);

  const finalState = await jsonSql(`SELECT jsonb_build_object(
    'operations',(SELECT count(*) FROM phase5_private.financial_operation_events),
    'collections',(SELECT count(*) FROM phase5_private.collection_events),
    'reversals',(SELECT count(*) FROM phase5_private.payment_reversal_events),
    'legacyPublicPaymentReversed',(SELECT is_reversed FROM public.customer_payments
      WHERE id='${payment2}'),
    'legacyAmountPaid',(SELECT amount_paid_in_minor_units FROM public.orders
      WHERE id='${order2}')
  )::text;`, 'final Slice 2 state');
  assert.equal(finalState.operations, 13);
  assert.equal(finalState.collections, 11);
  assert.equal(finalState.reversals, 2);
  assert.equal(finalState.legacyPublicPaymentReversed, true);
  assert.equal(finalState.legacyAmountPaid, 0);

  const { stdout: lint } = await execFileAsync(process.execPath, [
    cliPath, 'db', 'lint', '--local', '--level', 'warning', '--workdir', isolatedProjectRoot,
  ], {
    cwd: projectRoot, windowsHide: true, timeout: 120_000, maxBuffer: 1024 * 1024,
  });
  if (/ERROR:/u.test(lint)) throw new Error(`DB lint failed:\n${lint}`);

  console.log(JSON.stringify({
    ok: true,
    freshRebuild: '001-124',
    migrationConflictAtomicity,
    privateFunctions: 4,
    exactReplay: true,
    timezoneIndependentReplay: true,
    legacyCoexistenceReplay: true,
    changedPayloadConflict: true,
    validVsValidRace: true,
    observedIdempotencyLockRaces: validRaceFixtures.length,
    raceDirections: { aFirst: 3, bFirst: 3 },
    raceDeadlockDelta,
    concurrentSameKey: true,
    crossTenderCash: true,
    crossTenderCliq: true,
    legacyEvidenceFailClosed: true,
    modernOperationalEvidenceRequired: true,
    rollbackZeroPartialWrites: true,
    publicRoleExecuteGrants: 0,
    dbLintErrors: 0,
  }, null, 2));
} finally {
  await cleanup();
}
