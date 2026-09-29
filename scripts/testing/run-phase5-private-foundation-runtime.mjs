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
const migrationPath = path.join(
  projectRoot, 'supabase/migrations/123_phase5_private_financial_evidence_foundation.sql',
);
const projectId = 'nawasrah-phase5-slice1-runtime-test';
const databaseContainer = `supabase_db_${projectId}`;
let isolatedProjectRoot = '';

const runSql = async (sql, label, { failure = false } = {}) => new Promise((resolve, reject) => {
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

const jsonSql = async (sql, label) => {
  const result = await runSql(sql, label);
  const line = result.stdout.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean).at(-1);
  assert.ok(line, `${label} returned no result`);
  return JSON.parse(line);
};

const cleanup = async () => {
  if (!isolatedProjectRoot) return;
  await execFileAsync(process.execPath, [cliPath, 'stop', '--no-backup', '--workdir', isolatedProjectRoot], {
    cwd: projectRoot, windowsHide: true, timeout: 120_000, maxBuffer: 1024 * 1024,
  }).catch(() => undefined);
};

try {
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
    'schemaOwner',(SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='phase5_private'),
    'tables',(SELECT jsonb_agg(tablename ORDER BY tablename) FROM pg_tables
      WHERE schemaname='phase5_private'),
    'functions',(SELECT jsonb_agg(p.proname ORDER BY p.proname) FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='phase5_private'),
    'functionOwners',(SELECT jsonb_agg(DISTINCT pg_get_userbyid(p.proowner)) FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='phase5_private'),
    'securityDefiners',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='phase5_private' AND p.prosecdef),
    'unsafeSearchPaths',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='phase5_private' AND NOT (p.proconfig @> ARRAY['search_path=pg_catalog']::text[])),
    'existingTableTriggers',(SELECT count(*) FROM pg_trigger trigger_row
      JOIN pg_class relation ON relation.oid=trigger_row.tgrelid
      JOIN pg_namespace n ON n.oid=relation.relnamespace
      JOIN pg_proc p ON p.oid=trigger_row.tgfoid
      JOIN pg_namespace pn ON pn.oid=p.pronamespace
      WHERE pn.nspname='phase5_private' AND n.nspname <> 'phase5_private'
        AND NOT trigger_row.tgisinternal),
    'explicitSlice1Triggers',(SELECT count(*) FROM pg_trigger trigger_row
      JOIN pg_class relation ON relation.oid=trigger_row.tgrelid
      JOIN pg_namespace n ON n.oid=relation.relnamespace
      WHERE n.nspname='phase5_private' AND NOT trigger_row.tgisinternal),
    'internalFkTriggers',(SELECT count(*) FROM pg_trigger trigger_row
      WHERE trigger_row.tgconstraint IN (
        SELECT constraint_row.oid FROM pg_constraint constraint_row
        WHERE constraint_row.connamespace='phase5_private'::regnamespace
          AND constraint_row.contype='f'
      )),
    'internalFkTriggersOnNewTables',(SELECT count(*) FROM pg_trigger trigger_row
      JOIN pg_class relation ON relation.oid=trigger_row.tgrelid
      JOIN pg_namespace n ON n.oid=relation.relnamespace
      WHERE trigger_row.tgconstraint IN (
        SELECT constraint_row.oid FROM pg_constraint constraint_row
        WHERE constraint_row.connamespace='phase5_private'::regnamespace
          AND constraint_row.contype='f'
      ) AND n.nspname='phase5_private'),
    'internalFkTriggersOnExistingTables',(SELECT count(*) FROM pg_trigger trigger_row
      JOIN pg_class relation ON relation.oid=trigger_row.tgrelid
      JOIN pg_namespace n ON n.oid=relation.relnamespace
      WHERE trigger_row.tgconstraint IN (
        SELECT constraint_row.oid FROM pg_constraint constraint_row
        WHERE constraint_row.connamespace='phase5_private'::regnamespace
          AND constraint_row.contype='f'
      ) AND n.nspname<>'phase5_private'),
    'internalFkBusinessFunctions',(SELECT count(*) FROM pg_trigger trigger_row
      JOIN pg_proc function_row ON function_row.oid=trigger_row.tgfoid
      JOIN pg_namespace function_namespace ON function_namespace.oid=function_row.pronamespace
      WHERE trigger_row.tgconstraint IN (
        SELECT constraint_row.oid FROM pg_constraint constraint_row
        WHERE constraint_row.connamespace='phase5_private'::regnamespace
          AND constraint_row.contype='f'
      ) AND function_namespace.nspname<>'pg_catalog'),
    'directRolePrivileges',(SELECT count(*) FROM information_schema.table_privileges
      WHERE table_schema='phase5_private' AND grantee IN ('PUBLIC','anon','authenticated','service_role')),
    'schemaUsage',(SELECT count(*) FROM information_schema.usage_privileges
      WHERE object_type='SCHEMA' AND object_name='phase5_private'
        AND grantee IN ('PUBLIC','anon','authenticated','service_role')),
    'rows',(SELECT (SELECT count(*) FROM phase5_private.financial_operation_events)
      +(SELECT count(*) FROM phase5_private.collection_events)
      +(SELECT count(*) FROM phase5_private.payment_reversal_events))
  )::text;`, 'catalog contract');
  assert.deepEqual(catalog.tables, [
    'collection_events', 'financial_operation_events', 'payment_reversal_events',
  ]);
  assert.deepEqual(catalog.functions, [
    'assert_collection_source', 'reject_financial_evidence_mutation',
  ]);
  assert.equal(catalog.schemaOwner, 'postgres');
  assert.deepEqual(catalog.functionOwners, ['postgres']);
  assert.equal(catalog.securityDefiners, 0);
  assert.equal(catalog.unsafeSearchPaths, 0);
  assert.equal(catalog.existingTableTriggers, 0);
  assert.equal(catalog.explicitSlice1Triggers, 4);
  assert.equal(catalog.internalFkTriggers, 44);
  assert.equal(catalog.internalFkTriggersOnNewTables, 28);
  assert.equal(catalog.internalFkTriggersOnExistingTables, 16);
  assert.equal(catalog.internalFkBusinessFunctions, 0);
  assert.equal(catalog.directRolePrivileges, 0);
  assert.equal(catalog.schemaUsage, 0);
  assert.equal(catalog.rows, 0);

  for (const role of ['anon', 'authenticated', 'service_role']) {
    const denial = await runSql(
      `SET ROLE ${role}; SELECT count(*) FROM phase5_private.financial_operation_events;`,
      `${role} private table denial`, { failure: true },
    );
    assert.match(denial.stderr, /permission denied for schema phase5_private/iu);
  }

  const fixture = await jsonSql(`
    INSERT INTO auth.users(id,email) VALUES
      ('95000000-0000-4000-8000-000000000001','phase5-owner@example.invalid'),
      ('95000000-0000-4000-8000-000000000002','phase5-other@example.invalid');
    INSERT INTO public.profiles(id,full_name) VALUES
      ('95000000-0000-4000-8000-000000000001','Phase 5 Owner'),
      ('95000000-0000-4000-8000-000000000002','Phase 5 Other');
    INSERT INTO public.user_roles(user_id,role_id)
      SELECT '95000000-0000-4000-8000-000000000001',id FROM public.roles WHERE code='admin';
    INSERT INTO public.customers(id,full_name,phone) VALUES
      ('95000000-0000-4000-8000-000000000101','Phase 5 Customer','0795000001');
    INSERT INTO public.cash_shifts(
      id,shift_number,branch_id,opened_by,opening_cash_in_minor_units
    ) SELECT '95000000-0000-4000-8000-000000000301','P5-S1-SHIFT',id,
      '95000000-0000-4000-8000-000000000001',0
    FROM public.branches LIMIT 1;
    INSERT INTO public.orders(
      id,order_number,customer_id,branch_id,warehouse_id,status,payment_method,
      subtotal_in_minor_units,total_in_minor_units,source,cash_shift_id
    ) SELECT
      '95000000-0000-4000-8000-000000000201','P5-S1-ORDER',
      '95000000-0000-4000-8000-000000000101',branch.id,warehouse.id,
      'completed','debt',1000,1000,'pos','95000000-0000-4000-8000-000000000301'
    FROM public.branches branch
    JOIN public.warehouses warehouse ON warehouse.branch_id=branch.id
    LIMIT 1;
    SELECT set_config('request.jwt.claims',
      '{"sub":"95000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',false);
    SELECT public.record_customer_order_payment_once(
      '95000000-0000-4000-8000-000000000201',1000,'cliq','CLIQ-P5-S1',
      'Slice 1 inactive writer proof','phase5-current-writer-proof');
    SELECT jsonb_build_object(
      'paymentId',(SELECT id FROM public.customer_payments
        WHERE idempotency_key='phase5-current-writer-proof'),
      'shiftId',(SELECT id FROM public.cash_shifts WHERE shift_number='P5-S1-SHIFT'),
      'foundationRows',(SELECT count(*) FROM phase5_private.financial_operation_events)
        +(SELECT count(*) FROM phase5_private.collection_events)
        +(SELECT count(*) FROM phase5_private.payment_reversal_events)
    )::text;`, 'current writer isolation fixture');
  assert.ok(fixture.paymentId);
  assert.ok(fixture.shiftId);
  assert.equal(fixture.foundationRows, 0);

  const eventAt = '2026-09-29T12:34:56.789Z';
  await runSql(`INSERT INTO phase5_private.financial_operation_events(
      id,operation_type,actor_scope_type,actor_scope_id,idempotency_key,
      request_fingerprint,request_identity_snapshot,result_type,result_snapshot,operation_event_at
    ) VALUES (
      '95000000-0000-4000-8000-000000000401','customer_collection_v1','erp_user',
      '95000000-0000-4000-8000-000000000001','future-collection-1',repeat('A',64),
      '{"orderId":"95000000-0000-4000-8000-000000000201"}',
      'customer_collection_committed_v1','{"success":true}','${eventAt}'
    );
    INSERT INTO phase5_private.collection_events(
      id,financial_operation_id,operation_type,operation_event_at,original_payment_id,
      order_id,customer_id,cash_shift_id,tender_method,amount_in_minor_units,tender_reference
    ) VALUES (
      '95000000-0000-4000-8000-000000000501',
      '95000000-0000-4000-8000-000000000401','customer_collection_v1','${eventAt}',
      '${fixture.paymentId}','95000000-0000-4000-8000-000000000201',
      '95000000-0000-4000-8000-000000000101','${fixture.shiftId}','cliq',1000,'CLIQ-P5-S1'
    );`, 'valid collection foundation evidence');

  await runSql(`INSERT INTO phase5_private.financial_operation_events(
      operation_type,actor_scope_type,actor_scope_id,idempotency_key,request_fingerprint,
      request_identity_snapshot,result_type,result_snapshot,operation_event_at
    ) VALUES ('customer_collection_v1','erp_user',
      '95000000-0000-4000-8000-000000000001','future-collection-1',repeat('B',64),'{}',
      'customer_collection_committed_v1','{}','2026-09-29T12:35:00Z');`,
  'changed payload under same scoped key', { failure: true });

  await runSql(`INSERT INTO phase5_private.financial_operation_events(
      operation_type,actor_scope_type,actor_scope_id,idempotency_key,request_fingerprint,
      request_identity_snapshot,result_type,result_snapshot,operation_event_at
    ) VALUES ('customer_collection_v1','erp_user',
      '95000000-0000-4000-8000-000000000002','future-collection-1',repeat('B',64),'{}',
      'customer_collection_committed_v1','{}','2026-09-29T12:35:00Z');`,
  'same key under different actor scope');

  const partial = await runSql(`BEGIN;
    INSERT INTO phase5_private.financial_operation_events(
      id,operation_type,actor_scope_type,actor_scope_id,idempotency_key,request_fingerprint,
      request_identity_snapshot,result_type,result_snapshot,operation_event_at
    ) VALUES ('95000000-0000-4000-8000-000000000403','customer_payment_reversal_v1','erp_user',
      '95000000-0000-4000-8000-000000000001','future-reversal-partial',repeat('D',64),'{}',
      'customer_payment_reversal_committed_v1','{}','2026-09-29T12:37:00Z');
    INSERT INTO phase5_private.payment_reversal_events(
      financial_operation_id,operation_type,operation_event_at,original_collection_event_id,
      original_payment_id,order_id,customer_id,reversed_amount_in_minor_units,
      reversal_tender_method,cash_shift_id,reversal_reason
    ) VALUES ('95000000-0000-4000-8000-000000000403','customer_payment_reversal_v1',
      '2026-09-29T12:37:00Z','95000000-0000-4000-8000-000000000501',
      '${fixture.paymentId}','95000000-0000-4000-8000-000000000201',
      '95000000-0000-4000-8000-000000000101',300,'cash','${fixture.shiftId}','partial');`,
  'partial reversal rejection', { failure: true });
  assert.match(partial.stderr, /foreign key constraint "fk_phase5_reversal_exact_original_collection"/iu);

  await runSql(`INSERT INTO phase5_private.financial_operation_events(
      id,operation_type,actor_scope_type,actor_scope_id,idempotency_key,request_fingerprint,
      request_identity_snapshot,result_type,result_snapshot,operation_event_at
    ) VALUES ('95000000-0000-4000-8000-000000000402','customer_payment_reversal_v1','erp_user',
      '95000000-0000-4000-8000-000000000001','future-reversal-1',repeat('C',64),'{}',
      'customer_payment_reversal_committed_v1','{}','2026-09-29T12:36:00Z');
    INSERT INTO phase5_private.payment_reversal_events(
      financial_operation_id,operation_type,operation_event_at,original_collection_event_id,
      original_payment_id,order_id,customer_id,reversed_amount_in_minor_units,
      reversal_tender_method,cash_shift_id,tender_reference,reversal_reason
    ) VALUES ('95000000-0000-4000-8000-000000000402','customer_payment_reversal_v1',
      '2026-09-29T12:36:00Z','95000000-0000-4000-8000-000000000501',
      '${fixture.paymentId}','95000000-0000-4000-8000-000000000201',
      '95000000-0000-4000-8000-000000000101',1000,'cash','${fixture.shiftId}',NULL,
      'Full exact-payment reversal fixture');`, 'valid cross-tender full reversal');

  const mutation = await runSql(`UPDATE phase5_private.collection_events
    SET amount_in_minor_units=999 WHERE id='95000000-0000-4000-8000-000000000501';`,
  'immutable evidence rejection', { failure: true });
  assert.match(mutation.stderr, /IMMUTABLE_FINANCIAL_EVIDENCE/iu);

  const counts = await jsonSql(`SELECT jsonb_build_object(
    'operations',(SELECT count(*) FROM phase5_private.financial_operation_events),
    'collections',(SELECT count(*) FROM phase5_private.collection_events),
    'reversals',(SELECT count(*) FROM phase5_private.payment_reversal_events),
    'amount',(SELECT amount_in_minor_units FROM phase5_private.collection_events
      WHERE id='95000000-0000-4000-8000-000000000501')
  )::text;`, 'durable evidence counts');
  assert.deepEqual(counts, { operations: 3, collections: 1, reversals: 1, amount: 1000 });

  const status = JSON.parse((await execFileAsync(process.execPath, [
    cliPath, 'status', '--output', 'json', '--workdir', isolatedProjectRoot,
  ], { cwd: projectRoot, windowsHide: true, maxBuffer: 1024 * 1024 })).stdout);
  const apiUrl = status.API_URL || status.api_url;
  const anonKey = status.ANON_KEY || status.anon_key;
  assert.ok(apiUrl && anonKey);
  const publicResponse = await fetch(`${apiUrl}/rest/v1/financial_operation_events?select=id`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
  });
  assert.ok([404, 406].includes(publicResponse.status));
  const privateProfileResponse = await fetch(`${apiUrl}/rest/v1/financial_operation_events?select=id`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Accept-Profile': 'phase5_private',
    },
  });
  assert.ok([404, 406].includes(privateProfileResponse.status));

  const { stdout: lintStdout, stderr: lintStderr } = await execFileAsync(process.execPath, [
    cliPath, 'db', 'lint', '--local', '--workdir', isolatedProjectRoot,
  ], { cwd: projectRoot, windowsHide: true, timeout: 180_000, maxBuffer: 1024 * 1024 });
  const lintOutput = `${lintStdout}\n${lintStderr}`;
  assert.doesNotMatch(lintOutput, /\bERROR\b/iu);

  const migrationSql = await readFile(migrationPath, 'utf8');
  const reapply = await runSql(migrationSql, 'conflicting pre-existing schema', { failure: true });
  assert.match(reapply.stderr, /schema "phase5_private" already exists/iu);

  console.log(JSON.stringify({
    ok: true,
    freshRebuild001To123: true,
    privateCatalog: true,
    currentWriterFoundationEffect: 0,
    directRoleAccess: 'denied',
    postgrestSurface: 'absent',
    scopedIdempotency: true,
    fullExactReversal: true,
    immutableEvidence: true,
    incompatibleReapply: 'failed-closed',
    dbLintErrors: 0,
  }, null, 2));
} finally {
  await cleanup();
}
