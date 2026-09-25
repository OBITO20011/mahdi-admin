import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDirectory, '..');
const bootstrapScript = path.join(projectRoot, 'scripts', 'testing', 'bootstrap-isolated-supabase.mjs');
const supabaseCli = path.join(projectRoot, 'node_modules', 'supabase', 'dist', 'supabase.js');
const sharedSqlProjectId = 'nawasrah-phase7-test';
const sharedSqlContainer = `supabase_db_${sharedSqlProjectId}`;
const sharedSqlEnv = {
  ...process.env,
  NAWASRAH_SKIP_BOOTSTRAP: '1',
  NAWASRAH_TEST_CONTAINER: sharedSqlContainer,
};
const runSharedSql = async (query: string) => {
  const { stdout } = await execFileAsync('docker', [
    'exec', sharedSqlContainer, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', query,
  ], { cwd: projectRoot, windowsHide: true, maxBuffer: 1024 * 1024 });
  return stdout.trim();
};
type MonitoringScheduler = {
  jobid: number; jobname: string; schedule: string; command: string;
};
const pauseSharedMonitoringScheduler = async (): Promise<MonitoringScheduler> => {
  const scheduler = JSON.parse(await runSharedSql(`SELECT row_to_json(job)::text
    FROM (SELECT jobid,jobname,schedule,command FROM cron.job
      WHERE jobname='run-advanced-monitoring' AND active) job;`)) as MonitoringScheduler;
  assert.equal(scheduler.jobname, 'run-advanced-monitoring');
  assert.match(scheduler.command, /run_advanced_monitoring_checks/u);
  await runSharedSql(`SELECT cron.unschedule(${scheduler.jobid});`);
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const running = Number(await runSharedSql(`SELECT count(*)
      FROM cron.job_run_details
      WHERE jobid=${scheduler.jobid} AND status='running';`));
    if (running === 0) return scheduler;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error('ISOLATED_MONITORING_JOB_DID_NOT_QUIESCE');
};
const restoreSharedMonitoringScheduler = async (scheduler: MonitoringScheduler) => {
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  await runSharedSql(`SELECT cron.schedule(${quote(scheduler.jobname)},
    ${quote(scheduler.schedule)},${quote(scheduler.command)});`);
};
const sharedSqlBusinessSnapshot = async (controlEmail?: 'first@example.invalid' | 'second@example.invalid') => {
  // Compare all persisted fields, including timestamps, in every public/auth
  // table. Sort row representations so physical row order cannot affect proof.
  const query = `BEGIN ISOLATION LEVEL REPEATABLE READ;
    ${controlEmail ? `INSERT INTO auth.users(id,email) VALUES
      ('d6154a3d-49d6-4a2f-85fa-2af27fbd6a98','${controlEmail}');` : ''}
    CREATE TEMP TABLE isolation_snapshot(relation text, count bigint, fingerprint text) ON COMMIT DROP;
    DO $snapshot$ DECLARE t record; BEGIN
      FOR t IN SELECT schemaname, tablename FROM pg_tables
        WHERE schemaname IN ('public','auth') ORDER BY schemaname, tablename
      LOOP
        EXECUTE format('INSERT INTO isolation_snapshot SELECT %L, count(*),
          md5(COALESCE(string_agg(to_jsonb(r)::text, E''\\n'' ORDER BY to_jsonb(r)::text), ''''))
          FROM %I.%I r', t.schemaname || '.' || t.tablename, t.schemaname, t.tablename);
      END LOOP;
    END $snapshot$;
    SELECT jsonb_agg(to_jsonb(s) ORDER BY relation)::text FROM isolation_snapshot s;
    ROLLBACK;`;
  const { stdout } = await execFileAsync('docker', [
    'exec', sharedSqlContainer, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', query,
  ], { cwd: projectRoot, windowsHide: true, maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout.trim());
};
const runtimeScript = path.join(
  projectRoot,
  'scripts',
  'testing',
  'run-supplier-payment-runtime.mjs',
);
const ordersPaginationRuntimeScript = path.join(
  projectRoot,
  'scripts',
  'testing',
  'run-operational-orders-pagination-runtime.mjs',
);
const flavorHardeningRuntimeScript = path.join(
  projectRoot,
  'scripts',
  'testing',
  'run-flavor-receiving-hardening-runtime.mjs',
);
const canonicalSchemaRuntimeScript = path.join(
  projectRoot,
  'scripts',
  'testing',
  'run-canonical-schema-runtime.mjs',
);
const parcelFoundationRuntimeScript = path.join(
  projectRoot,
  'scripts',
  'testing',
  'run-configurable-parcel-foundation-runtime.mjs',
);
const phase2ReceivingRuntimeScript = path.join(
  projectRoot,
  'scripts',
  'testing',
  'run-phase2-configurable-receiving-runtime.mjs',
);
const phase3ContractsRuntimeScript = path.join(
  projectRoot,
  'scripts',
  'testing',
  'run-phase3-configurable-parcel-contracts-runtime.mjs',
);
const phase4FoundationRuntimeScript = path.join(
  projectRoot,
  'scripts',
  'testing',
  'run-phase4-returns-foundation-runtime.mjs',
);
const guestGatewayRuntimeScript = path.join(
  projectRoot,
  'scripts',
  'testing',
  'run-guest-order-edge-http.mjs',
);

test(
  'isolated Supabase runtime suites do not compete for Docker resources',
  { timeout: 1_800_000 },
  async (context) => {
    // Fresh database volumes are rebuilt by `supabase start`; bootstrap MUST
    // reset reused volumes even with this optimization. Avoid a redundant reset
    // and services that DB-only runtime suites never call. This preserves the
    // original timeouts while reducing Docker health-check flakiness in CI.
    process.env.NAWASRAH_SKIP_REDUNDANT_DB_RESET = 'true';
    process.env.NAWASRAH_SUPABASE_EXCLUDE =
      'realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor';
    await context.test(
      'supplier payment idempotency and restricted direct writes pass',
      async () => {
        const { stdout } = await execFileAsync(process.execPath, [runtimeScript], {
          cwd: projectRoot,
          windowsHide: true,
          maxBuffer: 1024 * 1024,
          timeout: 600_000,
        });

        const result: { ok?: boolean } = JSON.parse(stdout);
        assert.equal(result.ok, true);
      },
    );

    const { stdout: sharedBootstrapOutput } = await execFileAsync(
      process.execPath, [bootstrapScript], {
        cwd: projectRoot,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        timeout: 360_000,
        env: { ...process.env, NAWASRAH_ISOLATED_PROJECT_ID: sharedSqlProjectId },
      },
    );
    const sharedBootstrap = JSON.parse(sharedBootstrapOutput) as {
      ok?: boolean; isolatedProjectId?: string; isolatedProjectRoot?: string;
      authBaselineEmpty?: boolean;
    };
    assert.equal(sharedBootstrap.ok, true);
    assert.equal(sharedBootstrap.isolatedProjectId, sharedSqlProjectId);
    assert.equal(sharedBootstrap.authBaselineEmpty, true);
    assert.equal(typeof sharedBootstrap.isolatedProjectRoot, 'string');
    const monitoringScheduler = await pauseSharedMonitoringScheduler();
    try {
    // The production scheduler is paused only in this disposable stack. Keep
    // the monitoring contract covered explicitly, then take the isolation
    // baseline after its intended writes have completed.
    const monitoringProof = JSON.parse(await runSharedSql(`
      SELECT jsonb_build_object(
        'checkCount',(SELECT count(*) FROM public.advanced_monitoring_checks),
        'completedAt',(SELECT last_scan_completed_at
          FROM public.advanced_monitoring_metrics WHERE id=true)
      )::text
      FROM (SELECT public.run_advanced_monitoring_checks(clock_timestamp())) scan;`)) as {
        checkCount?: number; completedAt?: string;
      };
    assert.ok((monitoringProof.checkCount ?? 0) > 0);
    assert.equal(typeof monitoringProof.completedAt, 'string');
    const sharedBaseline = await sharedSqlBusinessSnapshot();
    const firstControl = await sharedSqlBusinessSnapshot('first@example.invalid');
    const secondControl = await sharedSqlBusinessSnapshot('second@example.invalid');
    const firstUser = firstControl.find((row: {relation: string}) => row.relation === 'auth.users');
    const secondUser = secondControl.find((row: {relation: string}) => row.relation === 'auth.users');
    assert.equal(firstUser.count, secondUser.count);
    assert.notEqual(firstUser.fingerprint, secondUser.fingerprint,
      'same row identity/count with different email must change actual SQL fingerprint');
    assert.notDeepEqual(firstControl, sharedBaseline, 'insert/delete must be observable');
    assert.deepEqual(await sharedSqlBusinessSnapshot(), sharedBaseline, 'positive controls roll back');
    await context.test(
      'operational orders paging, search and role gates pass',
      async () => {
        const { stdout } = await execFileAsync(
          process.execPath,
          [ordersPaginationRuntimeScript],
          {
            cwd: projectRoot,
            windowsHide: true,
            maxBuffer: 1024 * 1024,
            timeout: 600_000,
            env: sharedSqlEnv,
          },
        );

        const result: { ok?: boolean; runtime_scenarios?: number } =
          JSON.parse(stdout);
        assert.equal(result.ok, true);
        assert.equal(result.runtime_scenarios, 9);
      },
    );
    assert.deepEqual(await sharedSqlBusinessSnapshot(), sharedBaseline);

    await context.test(
      'flavor master, receiving, partial PO and WAC hardening pass',
      async () => {
        const { stdout } = await execFileAsync(
          process.execPath,
          [flavorHardeningRuntimeScript],
          {
            cwd: projectRoot,
            windowsHide: true,
            maxBuffer: 1024 * 1024,
            timeout: 600_000,
            env: sharedSqlEnv,
          },
        );

        const result: {
          ok?: boolean;
          runtime_scenarios?: number;
          unexpected_failures?: number;
        } = JSON.parse(stdout);
        assert.equal(result.ok, true);
        assert.equal(result.unexpected_failures, 0);
        assert.ok((result.runtime_scenarios || 0) >= 12);
      },
    );
    assert.deepEqual(await sharedSqlBusinessSnapshot(), sharedBaseline);

    await context.test(
      'canonical schema rebuild and inventory concurrency pass',
      async () => {
        const { stdout } = await execFileAsync(
          process.execPath,
          [canonicalSchemaRuntimeScript],
          {
            cwd: projectRoot,
            windowsHide: true,
            maxBuffer: 1024 * 1024,
            timeout: 600_000,
            env: sharedSqlEnv,
          },
        );

        const result: {
          ok?: boolean;
          firstBalance?: number;
          existingBalance?: number;
          rollback?: boolean;
          schema?: { legacy?: number; triggers?: number };
        } = JSON.parse(stdout);
        assert.equal(result.ok, true);
        assert.equal(result.firstBalance, 20);
        assert.equal(result.existingBalance, 20);
        assert.equal(result.rollback, true);
        assert.equal(result.schema?.legacy, 0);
        assert.equal(result.schema?.triggers, 5);
      },
    );
    assert.deepEqual(await sharedSqlBusinessSnapshot(), sharedBaseline);
    } finally {
      try {
        await restoreSharedMonitoringScheduler(monitoringScheduler);
      } finally {
        await execFileAsync(process.execPath, [
          supabaseCli, 'stop', '--no-backup', '--workdir', sharedBootstrap.isolatedProjectRoot!,
        ], { cwd: projectRoot, windowsHide: true, maxBuffer: 1024 * 1024, timeout: 120_000 });
      }
    }

    await context.test(
      'configurable parcel foundation integrity, RLS and concurrency pass',
      async () => {
        const { stdout } = await execFileAsync(
          process.execPath,
          [parcelFoundationRuntimeScript],
          {
            cwd: projectRoot,
            windowsHide: true,
            maxBuffer: 1024 * 1024,
            timeout: 600_000,
          },
        );

        const result: {
          ok?: boolean;
          migrationRebuild?: string;
          runtime?: { scenarios?: string[] };
          concurrency?: {
            serializedAgainstFinalization?: boolean;
            invalidFinalizationRolledBack?: boolean;
            orderItemWaitObserved?: boolean;
            finalizedHistoryMutationRejected?: boolean;
            deadlockDetected?: boolean;
          };
          commitBoundary?: {
            incompleteCommitRejected?: boolean;
            failedTransactionsLeftNoRows?: boolean;
            completeParcelCommitted?: boolean;
            concurrentIncompleteRejected?: boolean;
          };
          relationshipIntegrity?: {
            negativeCases?: number;
            failedTransactionsLeftNoRows?: boolean;
            positiveControlsPassed?: boolean;
            concurrentConflictsRejected?: boolean;
            baseReservationRaceSerialized?: boolean;
          };
          lineKindIntegrity?: {
            negativeCases?: number;
            strictErrorIdentity?: boolean;
            parcelLineKindEnforced?: boolean;
            returnModeEnforced?: boolean;
            returnedProductImmutable?: boolean;
            rejectedCasesPreservedHistory?: boolean;
            legacyNewModelWritesRejected?: boolean;
            positiveControlsPassed?: boolean;
            returnRaceSerialized?: boolean;
          };
        } = JSON.parse(stdout);
        assert.equal(result.ok, true);
        assert.equal(result.migrationRebuild, '001-112');
        assert.equal(result.runtime?.scenarios?.length, 21);
        assert.equal(result.concurrency?.serializedAgainstFinalization, true);
        assert.equal(result.concurrency?.invalidFinalizationRolledBack, true);
        assert.equal(result.concurrency?.orderItemWaitObserved, true);
        assert.equal(result.concurrency?.finalizedHistoryMutationRejected, true);
        assert.equal(result.concurrency?.deadlockDetected, false);
        assert.equal(result.commitBoundary?.incompleteCommitRejected, true);
        assert.equal(result.commitBoundary?.failedTransactionsLeftNoRows, true);
        assert.equal(result.commitBoundary?.completeParcelCommitted, true);
        assert.equal(result.commitBoundary?.concurrentIncompleteRejected, true);
        assert.equal(result.relationshipIntegrity?.negativeCases, 12);
        assert.equal(result.relationshipIntegrity?.failedTransactionsLeftNoRows, true);
        assert.equal(result.relationshipIntegrity?.positiveControlsPassed, true);
        assert.equal(result.relationshipIntegrity?.concurrentConflictsRejected, true);
        assert.equal(result.relationshipIntegrity?.baseReservationRaceSerialized, true);
        assert.equal(result.lineKindIntegrity?.negativeCases, 11);
        assert.equal(result.lineKindIntegrity?.strictErrorIdentity, true);
        assert.equal(result.lineKindIntegrity?.parcelLineKindEnforced, true);
        assert.equal(result.lineKindIntegrity?.returnModeEnforced, true);
        assert.equal(result.lineKindIntegrity?.returnedProductImmutable, true);
        assert.equal(result.lineKindIntegrity?.rejectedCasesPreservedHistory, true);
        assert.equal(result.lineKindIntegrity?.legacyNewModelWritesRejected, true);
        assert.equal(result.lineKindIntegrity?.positiveControlsPassed, true);
        assert.equal(result.lineKindIntegrity?.returnRaceSerialized, true);
      },
    );

    await context.test(
      'configurable parcel receiving, exact WAC and replay safety pass',
      async () => {
        const { stdout } = await execFileAsync(
          process.execPath,
          [phase2ReceivingRuntimeScript],
          {
            cwd: projectRoot,
            windowsHide: true,
            maxBuffer: 1024 * 1024,
            timeout: 600_000,
          },
        );

        const result: {
          ok?: boolean;
          migrationRebuild?: string;
          directReceiving?: {
            parcelDecomposition?: boolean;
            twoStageAllocation?: boolean;
            exactWacPrecision?: boolean;
            zeroCostAndZeroBasis?: boolean;
            repeatedSkuLinesAggregated?: boolean;
            legacyV2MixedWacCoherent?: boolean;
            legacyZeroCostShapesVerified?: boolean;
            legacyPaymentInputShapesVerified?: boolean;
            supplierPaymentContractVerified?: boolean;
            supplierPaymentNullLockSafetyVerified?: boolean;
            supplierPaymentContractResults?: { label?: string; paymentMethod?: string;
              attachedShift?: string | null }[];
            zeroCostResults?: { final?: { quantity?: number; exact?: string } }[];
            laterPartialAndFullPaymentCommitted?: boolean;
            laterPaymentCancellationFailedClosed?: boolean;
          };
          purchaseOrderReceiving?: {
            partialThenComplete?: boolean;
            cancellationRestoredPartialState?: boolean;
            prepaidLegacyBalanceFailedClosed?: boolean;
            supplierInvoiceIdentityScoped?: boolean;
          };
          idempotency?: {
            canonicalReplayZeroWrites?: boolean;
            concurrentDifferentPayloadConflict?: boolean;
            historicalReplayWhileFeatureOff?: boolean;
            legacyV2NamespaceCollisionZeroWrites?: boolean;
            paidReplayAfterShiftClosedZeroWrites?: boolean;
            legacyNullReplayAfterShiftClosedZeroWrites?: boolean;
            legacyNewOperationIdentityAtomic?: boolean;
            legacyExactReplayZeroWrites?: boolean;
            legacyChangedQuantityConflict?: boolean;
            legacyChangedMoneyConflict?: boolean;
            legacyChangedIdentityConflict?: boolean;
            legacyLineOrderConflict?: boolean;
            legacyExplicitBusinessDateConflict?: boolean;
            legacyConcurrentSamePayloadSingleEffect?: boolean;
            legacyConcurrentDifferentPayloadConflict?: boolean;
            legacyReplayAfterLaterPaymentZeroWrites?: boolean;
            legacyCrossActorCollisionGeneric?: boolean;
            legacyReplayReturnsOriginalResultSnapshot?: boolean;
            pre113FailClosedExact?: boolean;
            pre113FailClosedChanged?: boolean;
            pre113MalformedPayloadSameIdentity?: boolean;
            pre113CrossActorCollisionGeneric?: boolean;
            pre113SafeResolverVerified?: boolean;
            pre113ZeroWritesVerified?: boolean;
            legacyReceiptItemsSnapshotVerified?: boolean;
            post113LegacyReceiptItemCount?: number;
            pre113LegacyReceiptItemCount?: number;
          };
          concurrency?: {
            sameSkuReceiptsSerialized?: boolean;
            directAndPoCrossPathSerialized?: boolean;
            deadlocksObserved?: number;
            coordinatedPairCount?: number;
            receiptAndPosSerialized?: boolean;
            receiptAndTransferSerialized?: boolean;
            differentPoWarehousesSerialized?: boolean;
            concurrentFirstBalancesSerialized?: boolean;
            paidReceiptAndPosReversalInternalSerialization?: boolean;
            paidDeadlockDelta?: number;
            supplierPaymentAndReversalInternalSerialization?: boolean;
            supplierPaymentDeadlockDelta?: number;
            supplierPaymentReversalResults?: {
              reversalFirst?: boolean; internalWaitObserved?: boolean;
              safeRetryObserved?: boolean; failedAttemptZeroWrites?: boolean;
              final?: { poPaid?: number; paymentCount?: number; reversalCount?: number };
            }[];
            paidReversalResults?: {
              receiptKind?: string;
              reversalFirst?: boolean;
              internalWaitObserved?: boolean;
              final?: { paymentMethod?: string };
            }[];
          };
          phase2Closure?: {
            independentNewOperationFixesLocallyVerified?: boolean;
            ownerPolicyImplemented?: boolean;
            phase2Closed?: boolean;
            finalVerdict?: string;
          };
        } = JSON.parse(stdout);
        assert.equal(result.ok, true);
        assert.equal(result.migrationRebuild, '001-113');
        assert.equal(result.directReceiving?.parcelDecomposition, true);
        assert.equal(result.directReceiving?.twoStageAllocation, true);
        assert.equal(result.directReceiving?.exactWacPrecision, true);
        assert.equal(result.directReceiving?.zeroCostAndZeroBasis, true);
        assert.equal(result.directReceiving?.repeatedSkuLinesAggregated, true);
        assert.equal(result.directReceiving?.legacyV2MixedWacCoherent, true);
        assert.equal(result.directReceiving?.legacyZeroCostShapesVerified, true);
        assert.equal(result.directReceiving?.legacyPaymentInputShapesVerified, true);
        assert.equal(result.directReceiving?.supplierPaymentContractVerified, true);
        assert.equal(result.directReceiving?.supplierPaymentNullLockSafetyVerified, true);
        assert.equal(result.directReceiving?.supplierPaymentContractResults?.length, 7);
        assert.equal(result.directReceiving?.zeroCostResults?.length, 4);
        assert.deepEqual(result.directReceiving?.zeroCostResults?.[0].final,
          { quantity: 8, exact: '62.500000' });
        assert.equal(result.directReceiving?.laterPartialAndFullPaymentCommitted, true);
        assert.equal(result.directReceiving?.laterPaymentCancellationFailedClosed, true);
        assert.equal(result.purchaseOrderReceiving?.partialThenComplete, true);
        assert.equal(result.purchaseOrderReceiving?.cancellationRestoredPartialState, true);
        assert.equal(result.purchaseOrderReceiving?.prepaidLegacyBalanceFailedClosed, true);
        assert.equal(result.purchaseOrderReceiving?.supplierInvoiceIdentityScoped, true);
        assert.equal(result.idempotency?.canonicalReplayZeroWrites, true);
        assert.equal(result.idempotency?.concurrentDifferentPayloadConflict, true);
        assert.equal(result.idempotency?.historicalReplayWhileFeatureOff, true);
        assert.equal(result.idempotency?.legacyV2NamespaceCollisionZeroWrites, true);
        assert.equal(result.idempotency?.paidReplayAfterShiftClosedZeroWrites, true);
        assert.equal(result.idempotency?.legacyNullReplayAfterShiftClosedZeroWrites, true);
        assert.equal(result.idempotency?.legacyNewOperationIdentityAtomic, true);
        assert.equal(result.idempotency?.legacyExactReplayZeroWrites, true);
        assert.equal(result.idempotency?.legacyChangedQuantityConflict, true);
        assert.equal(result.idempotency?.legacyChangedMoneyConflict, true);
        assert.equal(result.idempotency?.legacyChangedIdentityConflict, true);
        assert.equal(result.idempotency?.legacyLineOrderConflict, true);
        assert.equal(result.idempotency?.legacyExplicitBusinessDateConflict, true);
        assert.equal(result.idempotency?.legacyConcurrentSamePayloadSingleEffect, true);
        assert.equal(result.idempotency?.legacyConcurrentDifferentPayloadConflict, true);
        assert.equal(result.idempotency?.legacyReplayAfterLaterPaymentZeroWrites, true);
        assert.equal(result.idempotency?.legacyCrossActorCollisionGeneric, true);
        assert.equal(result.idempotency?.legacyReplayReturnsOriginalResultSnapshot, true);
        assert.equal(result.idempotency?.pre113FailClosedExact, true);
        assert.equal(result.idempotency?.pre113FailClosedChanged, true);
        assert.equal(result.idempotency?.pre113MalformedPayloadSameIdentity, true);
        assert.equal(result.idempotency?.pre113CrossActorCollisionGeneric, true);
        assert.equal(result.idempotency?.pre113SafeResolverVerified, true);
        assert.equal(result.idempotency?.pre113ZeroWritesVerified, true);
        assert.equal(result.idempotency?.legacyReceiptItemsSnapshotVerified, true);
        assert.equal(result.idempotency?.post113LegacyReceiptItemCount, 1);
        assert.equal(result.idempotency?.pre113LegacyReceiptItemCount, 1);
        assert.equal(result.concurrency?.sameSkuReceiptsSerialized, true);
        assert.equal(result.concurrency?.directAndPoCrossPathSerialized, true);
        assert.equal(result.concurrency?.deadlocksObserved, 0);
        assert.ok((result.concurrency?.coordinatedPairCount ?? 0) >= 7);
        assert.equal(result.concurrency?.receiptAndPosSerialized, true);
        assert.equal(result.concurrency?.receiptAndTransferSerialized, true);
        assert.equal(result.concurrency?.differentPoWarehousesSerialized, true);
        assert.equal(result.concurrency?.concurrentFirstBalancesSerialized, true);
        assert.equal(result.concurrency?.paidReceiptAndPosReversalInternalSerialization, true);
        assert.equal(result.concurrency?.paidDeadlockDelta, 0);
        assert.equal(result.concurrency?.paidReversalResults?.length, 8);
        assert.equal(result.concurrency?.paidReversalResults?.filter((entry) => entry.reversalFirst).length, 4);
        assert.ok(result.concurrency?.paidReversalResults?.every((entry) => entry.internalWaitObserved));
        const legacyNullResults = result.concurrency?.paidReversalResults
          ?.filter((entry) => entry.receiptKind === 'legacy-null');
        assert.equal(legacyNullResults?.length, 2);
        assert.ok(legacyNullResults?.every((entry) => entry.final?.paymentMethod === 'cash'));
        assert.equal(result.concurrency?.supplierPaymentAndReversalInternalSerialization, true);
        assert.equal(result.concurrency?.supplierPaymentDeadlockDelta, 0);
        assert.equal(result.concurrency?.supplierPaymentReversalResults?.length, 2);
        assert.ok(result.concurrency?.supplierPaymentReversalResults
          ?.every((entry) => entry.internalWaitObserved && entry.final?.poPaid === 50
            && entry.final?.paymentCount === 2 && entry.final?.reversalCount === 1));
        assert.ok(result.concurrency?.supplierPaymentReversalResults
          ?.some((entry) => entry.safeRetryObserved));
        assert.ok(result.concurrency?.supplierPaymentReversalResults
          ?.every((entry) => !entry.safeRetryObserved || entry.failedAttemptZeroWrites));
        assert.equal(result.phase2Closure?.independentNewOperationFixesLocallyVerified, true);
        assert.equal(result.phase2Closure?.ownerPolicyImplemented, true);
        assert.equal(result.phase2Closure?.phase2Closed, true);
        assert.equal(result.phase2Closure?.finalVerdict, 'PHASE 2 = READY TO CLOSE');
      },
    );

    await context.test(
      'Phase 3 configurable parcel contracts and safety primitives pass',
      async () => {
        const { stdout } = await execFileAsync(
          process.execPath,
          [phase3ContractsRuntimeScript],
          {
            cwd: projectRoot,
            windowsHide: true,
            maxBuffer: 1024 * 1024,
            timeout: 600_000,
          },
        );

        const result: {
          ok?: boolean;
          migrationRebuild?: string;
          runtime?: { scenarios?: string[] };
          idempotency?: {
            exactReplayZeroWrites?: boolean;
            changedRequestConflictZeroWrites?: boolean;
            crossActorConflictGeneric?: boolean;
            resultSnapshotImmutable?: boolean;
            freshConnectionSnapshots?: boolean;
            changedPayloadConflictZeroWrites?: boolean;
            crossActorConflictZeroWrites?: boolean;
          };
          discountAllocation?: {
            scenarios?: number;
            exactStoredAllocations?: boolean;
            lineAndInstanceReconciliation?: boolean;
            deterministicTenWayTie?: boolean;
          };
          legacyLocationCompatibility?: {
            oracleHead?: number;
            explicitWarehouseAndBranch?: { warehouseId?: string; branchId?: string; shiftId?: string };
            explicitWarehouseNullBranch?: { warehouseId?: string; branchId?: string; shiftId?: string };
            nullWarehouseNullBranch?: { warehouseId?: string; branchId?: string; shiftId?: string };
            nullWarehouseExplicitBranch?: { warehouseId?: string; branchId?: string; shiftId?: string };
            mismatchedWarehouseAndBranch?: { warehouseId?: string; branchId?: string; shiftId?: string };
            nullIdempotencyFallback?: { warehouseId?: string; branchId?: string; shiftId?: string };
            replayAfterShiftClose?: boolean;
            replayZeroWrites?: boolean;
            invalidAndInactiveCompatibility?: boolean;
            noActiveWarehouseCompatibility?: boolean;
            responseShapeCompatible?: boolean;
          };
          configurableRollback?: {
            strictFailureIdentity?: boolean;
            noPartialBusinessRows?: boolean;
            shiftAndFinancialStateUnchanged?: boolean;
            wacUnchanged?: boolean;
          };
          financialReadSide?: {
            canonicalReportMatched?: boolean;
            replayDidNotDuplicateFinancialEffect?: boolean;
            paymentRowsCreated?: number;
          };
          customerReservationCoordinator?: {
            completionExpiryEvidence?: Array<{
              initialStatus: string; queueOrder: string; winner: string;
              oneTerminalEffect: boolean; immutableReplay: boolean;
            }>;
            legacyV1CompletionCompatible?: boolean;
            legacyV1CancellationCompatible?: boolean;
            legacyV2CompletionRejectedZeroWrites?: boolean;
            legacyV2CancellationRejectedZeroWrites?: boolean;
            customerV1V2SharedLockOrder?: boolean;
            customerV1V2BothQueueDirections?: boolean;
            customerV1V2TrueSimultaneous?: boolean;
            customerV1V2ResourceMatrix?: boolean;
            customerCrossVersionSameKeySingleOrder?: boolean;
            registeredCustomerPosSharedLockOrder?: boolean;
            registeredCustomerPosBothQueueDirections?: boolean;
            registeredCustomerPosTrueSimultaneous?: boolean;
            registeredCustomerPosCommittedState?: boolean;
            reservationCreation?: boolean;
            exactReplayZeroWrites?: boolean;
            changedPayloadConflictZeroWrites?: boolean;
            staleQuoteRollback?: boolean;
            completion?: boolean;
            completionReplayZeroWrites?: boolean;
            cancellation?: boolean;
            expiry?: boolean;
            costFinalization?: boolean;
            movementTraceability?: boolean;
            poisonRowIsolation?: boolean;
            poisonRowForwardProgress?: boolean;
            multiPoisonForwardProgress?: boolean;
            poisonAfterValidBounded?: boolean;
            parcelCogsPerInstanceBoundary?: boolean;
            parcelCogsHalfBoundary?: boolean;
            corruptedParcelCogsDetected?: boolean;
            completionVsReversal?: boolean;
            publicReadContract?: {
              boundedFamilyIds?: number;
              featureStateMatrix?: boolean;
              directAnonTableReadDenied?: boolean;
              genericAuthenticatedRlsFiltered?: boolean;
              activeStaffReadPreserved?: boolean;
              authoritativeConfiguration?: boolean;
              authoritativeRevision?: boolean;
              authoritativeCapacityAndPrice?: boolean;
              componentEligibility?: boolean;
              selectedWarehouseAvailability?: boolean;
              sensitiveFieldsAbsent?: boolean;
              readWriteRoundTrip?: boolean;
              negativeEligibilityRejectedZeroWrites?: boolean;
            };
            promotionPreviewV2?: {
              baseParity?: boolean;
              legacyParity?: boolean;
              configurableParity?: boolean;
              mixedParity?: boolean;
              differentialCases?: Record<string, boolean>;
              snapshotEvidence?: {
                preExistingCustomerAddressProtected?: boolean;
                allThreeSkusIncludingOther?: boolean;
                populatedRepeatedPreviewZeroWrites?: boolean;
                rejectedPreviewZeroWrites?: boolean;
                exactCheckoutPositiveControls?: number;
                realSqlFieldSensitivity?: boolean;
                newRowsDiscovered?: boolean;
                cleanupVerified?: boolean;
              };
            };
            customerDeadlockDelta?: number;
          };
          phase35bReporting?: {
            exactWacRoundingBoundary?: boolean;
            familyUsesStockedChildCosts?: boolean;
            crossSurfaceValuationConsistent?: boolean;
            explicitBaseUnitNeverCountsAsPackage?: boolean;
            legacyFallbackPreserved?: boolean;
            legacySingleUnitPackagePreserved?: boolean;
            reportReadsZeroWrite?: boolean;
            configurableInstancesAndComponentsCounted?: boolean;
            topProductsCommercialQuantityNoFanOut?: boolean;
            financialTotalsUnchanged?: boolean;
            quantityResult?: { baseUnits?: number; packages?: number };
          };
          validation?: {
            strictErrorIdentity?: boolean;
            crossFamilyRejected?: boolean;
            wrongCapacityRejected?: boolean;
            masterProductRejected?: boolean;
            missingExactWacRejected?: boolean;
          };
          reservations?: {
            componentQuantityBounded?: boolean;
            duplicateActiveRejected?: boolean;
            terminalStateImmutable?: boolean;
          };
          concurrency?: {
            reverseInputSerialized?: boolean;
            waitObserved?: boolean;
            deadlockDelta?: number;
            crossVersionConcurrency?: {
              oneLogicalSale?: boolean;
              waitObserved?: boolean;
              deadlockDelta?: number;
            };
            competingParcelSales?: {
              oneSaleAccepted?: boolean;
              reversedInputSerialized?: boolean;
              deadlockDelta?: number;
            };
            saleAndSupplierReceipt?: {
              bothCommittedSerially?: boolean;
              waitObserved?: boolean;
              deadlockDelta?: number;
            };
            saleAndReversal?: {
              laterSaleSerializedBeforeReversal?: boolean;
              intendedGuardRejectedReversal?: boolean;
              waitObserved?: boolean;
              deadlockDelta?: number;
            };
            legacySaleAndReversal?: {
              bothSerializationDirections?: boolean;
              replayAfterShiftClosure?: boolean;
              deadlockDelta?: number;
              iterations?: unknown[];
            };
          };
          dbLint?: string;
        } = JSON.parse(stdout);
        assert.equal(result.ok, true);
        assert.equal(result.migrationRebuild, '001-119');
        assert.equal(result.phase35bReporting?.exactWacRoundingBoundary, true);
        assert.equal(result.phase35bReporting?.familyUsesStockedChildCosts, true);
        assert.equal(result.phase35bReporting?.crossSurfaceValuationConsistent, true);
        assert.equal(result.phase35bReporting?.explicitBaseUnitNeverCountsAsPackage, true);
        assert.equal(result.phase35bReporting?.legacyFallbackPreserved, true);
        assert.equal(result.phase35bReporting?.legacySingleUnitPackagePreserved, true);
        assert.equal(result.phase35bReporting?.reportReadsZeroWrite, true);
        assert.equal(
          result.phase35bReporting?.configurableInstancesAndComponentsCounted,
          true,
        );
        assert.equal(result.phase35bReporting?.topProductsCommercialQuantityNoFanOut, true);
        assert.equal(result.phase35bReporting?.financialTotalsUnchanged, true);
        assert.deepEqual(result.phase35bReporting?.quantityResult, {
          baseUnits: 24,
          packages: 6,
        });
        assert.equal(result.customerReservationCoordinator?.promotionPreviewV2?.baseParity, true);
        assert.equal(result.customerReservationCoordinator?.promotionPreviewV2?.legacyParity, true);
        assert.equal(
          result.customerReservationCoordinator?.promotionPreviewV2?.configurableParity,
          true,
        );
        assert.equal(result.customerReservationCoordinator?.promotionPreviewV2?.mixedParity, true);
        const previewEvidence = result.customerReservationCoordinator?.promotionPreviewV2;
        for (const label of [
          'base-no-promo', 'base-promo', 'legacy-no-promo', 'legacy-promo',
          'configurable-no-promo', 'configurable-promo', 'mixed-no-promo', 'mixed-promo',
          'capped-percentage', 'fixed', 'fixed-subtotal-bound',
          'threshold-below', 'threshold-exact', 'threshold-above',
          'multiple-no-promo', 'multiple-promo',
        ]) assert.equal(previewEvidence?.differentialCases?.[label], true, label);
        for (const flag of [
          'preExistingCustomerAddressProtected', 'allThreeSkusIncludingOther',
          'populatedRepeatedPreviewZeroWrites', 'rejectedPreviewZeroWrites',
          'realSqlFieldSensitivity', 'newRowsDiscovered', 'cleanupVerified',
        ] as const) assert.equal(previewEvidence?.snapshotEvidence?.[flag], true, flag);
        assert.equal(previewEvidence?.snapshotEvidence?.exactCheckoutPositiveControls, 2);
        assert.equal(result.runtime?.scenarios?.length, 30);
        assert.equal(result.idempotency?.exactReplayZeroWrites, true);
        assert.equal(result.idempotency?.changedRequestConflictZeroWrites, true);
        assert.equal(result.idempotency?.crossActorConflictGeneric, true);
        assert.equal(result.idempotency?.resultSnapshotImmutable, true);
        assert.equal(result.idempotency?.freshConnectionSnapshots, true);
        assert.equal(result.idempotency?.changedPayloadConflictZeroWrites, true);
        assert.equal(result.idempotency?.crossActorConflictZeroWrites, true);
        assert.equal(result.discountAllocation?.scenarios, 9);
        assert.equal(result.discountAllocation?.exactStoredAllocations, true);
        assert.equal(result.discountAllocation?.lineAndInstanceReconciliation, true);
        assert.equal(result.discountAllocation?.deterministicTenWayTie, true);
        const location = result.legacyLocationCompatibility;
        assert.equal(location?.oracleHead, 114);
        assert.equal(location?.explicitWarehouseAndBranch?.warehouseId,
          '92400000-0000-0000-0000-000000000201');
        assert.equal(location?.explicitWarehouseNullBranch?.branchId,
          '92400000-0000-0000-0000-000000000200');
        assert.equal(location?.nullWarehouseNullBranch?.warehouseId,
          '92400000-0000-0000-0000-000000000201');
        assert.equal(location?.nullWarehouseExplicitBranch?.branchId,
          '92400000-0000-0000-0000-000000000200');
        assert.equal(location?.mismatchedWarehouseAndBranch?.branchId,
          '92400000-0000-0000-0000-000000000210');
        assert.equal(location?.mismatchedWarehouseAndBranch?.warehouseId,
          '92400000-0000-0000-0000-000000000201');
        assert.equal(location?.nullIdempotencyFallback?.shiftId,
          '92400000-0000-0000-0000-000000000202');
        assert.equal(location?.replayAfterShiftClose, true);
        assert.equal(location?.replayZeroWrites, true);
        assert.equal(location?.invalidAndInactiveCompatibility, true);
        assert.equal(location?.noActiveWarehouseCompatibility, true);
        assert.equal(location?.responseShapeCompatible, true);
        assert.equal(result.configurableRollback?.strictFailureIdentity, true);
        assert.equal(result.configurableRollback?.noPartialBusinessRows, true);
        assert.equal(result.configurableRollback?.shiftAndFinancialStateUnchanged, true);
        assert.equal(result.configurableRollback?.wacUnchanged, true);
        assert.equal(result.financialReadSide?.canonicalReportMatched, true);
        assert.equal(result.financialReadSide?.replayDidNotDuplicateFinancialEffect, true);
        assert.equal(result.financialReadSide?.paymentRowsCreated, 0);
        assert.equal(result.customerReservationCoordinator?.legacyV1CompletionCompatible, true);
        assert.equal(result.customerReservationCoordinator?.legacyV1CancellationCompatible, true);
        assert.equal(result.customerReservationCoordinator?.legacyV2CompletionRejectedZeroWrites, true);
        assert.equal(result.customerReservationCoordinator?.legacyV2CancellationRejectedZeroWrites, true);
        assert.equal(result.customerReservationCoordinator?.customerV1V2SharedLockOrder, true);
        assert.equal(result.customerReservationCoordinator?.customerV1V2BothQueueDirections, true);
        assert.equal(result.customerReservationCoordinator?.customerV1V2TrueSimultaneous, true);
        assert.equal(result.customerReservationCoordinator?.customerV1V2ResourceMatrix, true);
        assert.equal(result.customerReservationCoordinator?.customerCrossVersionSameKeySingleOrder, true);
        assert.equal(result.customerReservationCoordinator?.registeredCustomerPosSharedLockOrder, true);
        assert.equal(result.customerReservationCoordinator?.registeredCustomerPosBothQueueDirections, true);
        assert.equal(result.customerReservationCoordinator?.registeredCustomerPosTrueSimultaneous, true);
        assert.equal(result.customerReservationCoordinator?.registeredCustomerPosCommittedState, true);
        assert.equal(result.customerReservationCoordinator?.reservationCreation, true);
        assert.equal(result.customerReservationCoordinator?.exactReplayZeroWrites, true);
        assert.equal(result.customerReservationCoordinator?.changedPayloadConflictZeroWrites, true);
        assert.equal(result.customerReservationCoordinator?.staleQuoteRollback, true);
        assert.equal(result.customerReservationCoordinator?.completion, true);
        const raceEvidence = result.customerReservationCoordinator?.completionExpiryEvidence;
        assert.equal(raceEvidence?.length, 9);
        for (const state of ['new', 'ready', 'out_for_delivery']) {
          for (const queue of ['completion-first', 'expiry-first', 'simultaneous']) {
            const matches = raceEvidence!.filter((row) => row.initialStatus === state && row.queueOrder === queue);
            assert.equal(matches.length, 1);
            assert.equal(matches[0].winner, state === 'new' ? 'expired' : 'completed');
            assert.equal(matches[0].oneTerminalEffect, true);
            assert.equal(matches[0].immutableReplay, true);
          }
        }
        assert.equal(result.customerReservationCoordinator?.completionReplayZeroWrites, true);
        assert.equal(result.customerReservationCoordinator?.cancellation, true);
        assert.equal(result.customerReservationCoordinator?.expiry, true);
        assert.equal(result.customerReservationCoordinator?.costFinalization, true);
        assert.equal(result.customerReservationCoordinator?.movementTraceability, true);
        assert.equal(result.customerReservationCoordinator?.poisonRowIsolation, true);
        assert.equal(result.customerReservationCoordinator?.poisonRowForwardProgress, true);
        assert.equal(result.customerReservationCoordinator?.multiPoisonForwardProgress, true);
        assert.equal(result.customerReservationCoordinator?.poisonAfterValidBounded, true);
        assert.equal(result.customerReservationCoordinator?.parcelCogsPerInstanceBoundary, true);
        assert.equal(result.customerReservationCoordinator?.parcelCogsHalfBoundary, true);
        assert.equal(result.customerReservationCoordinator?.corruptedParcelCogsDetected, true);
        assert.equal(result.customerReservationCoordinator?.completionVsReversal, true);
        const publicRead = result.customerReservationCoordinator?.publicReadContract;
        assert.equal(publicRead?.boundedFamilyIds, 48);
        assert.equal(publicRead?.featureStateMatrix, true);
        assert.equal(publicRead?.directAnonTableReadDenied, true);
        assert.equal(publicRead?.genericAuthenticatedRlsFiltered, true);
        assert.equal(publicRead?.activeStaffReadPreserved, true);
        assert.equal(publicRead?.authoritativeConfiguration, true);
        assert.equal(publicRead?.authoritativeRevision, true);
        assert.equal(publicRead?.authoritativeCapacityAndPrice, true);
        assert.equal(publicRead?.componentEligibility, true);
        assert.equal(publicRead?.selectedWarehouseAvailability, true);
        assert.equal(publicRead?.sensitiveFieldsAbsent, true);
        assert.equal(publicRead?.readWriteRoundTrip, true);
        assert.equal(publicRead?.negativeEligibilityRejectedZeroWrites, true);
        assert.equal(result.customerReservationCoordinator?.customerDeadlockDelta, 0);
        assert.equal(result.validation?.strictErrorIdentity, true);
        assert.equal(result.validation?.crossFamilyRejected, true);
        assert.equal(result.validation?.wrongCapacityRejected, true);
        assert.equal(result.validation?.masterProductRejected, true);
        assert.equal(result.validation?.missingExactWacRejected, true);
        assert.equal(result.reservations?.componentQuantityBounded, true);
        assert.equal(result.reservations?.duplicateActiveRejected, true);
        assert.equal(result.reservations?.terminalStateImmutable, true);
        assert.equal(result.concurrency?.reverseInputSerialized, true);
        assert.equal(result.concurrency?.waitObserved, true);
        assert.equal(result.concurrency?.deadlockDelta, 0);
        assert.equal(result.concurrency?.crossVersionConcurrency?.oneLogicalSale, true);
        assert.equal(result.concurrency?.crossVersionConcurrency?.waitObserved, true);
        assert.equal(result.concurrency?.crossVersionConcurrency?.deadlockDelta, 0);
        assert.equal(result.concurrency?.competingParcelSales?.oneSaleAccepted, true);
        assert.equal(result.concurrency?.competingParcelSales?.reversedInputSerialized, true);
        assert.equal(result.concurrency?.competingParcelSales?.deadlockDelta, 0);
        assert.equal(result.concurrency?.saleAndSupplierReceipt?.bothCommittedSerially, true);
        assert.equal(result.concurrency?.saleAndSupplierReceipt?.waitObserved, true);
        assert.equal(result.concurrency?.saleAndSupplierReceipt?.deadlockDelta, 0);
        assert.equal(result.concurrency?.saleAndReversal?.laterSaleSerializedBeforeReversal, true);
        assert.equal(result.concurrency?.saleAndReversal?.intendedGuardRejectedReversal, true);
        assert.equal(result.concurrency?.saleAndReversal?.waitObserved, true);
        assert.equal(result.concurrency?.saleAndReversal?.deadlockDelta, 0);
        assert.equal(result.concurrency?.legacySaleAndReversal?.bothSerializationDirections, true);
        assert.equal(result.concurrency?.legacySaleAndReversal?.replayAfterShiftClosure, true);
        assert.equal(result.concurrency?.legacySaleAndReversal?.deadlockDelta, 0);
        assert.equal(result.concurrency?.legacySaleAndReversal?.iterations?.length, 2);
        assert.equal(result.dbLint, 'PASS');
      },
    );

    await context.test(
      'Phase 4 return and replacement foundation contracts pass',
      async () => {
        const { stdout } = await execFileAsync(
          process.execPath,
          [phase4FoundationRuntimeScript],
          {
            cwd: projectRoot,
            windowsHide: true,
            maxBuffer: 1024 * 1024,
            timeout: 600_000,
          },
        );
        const result = JSON.parse(stdout) as {
          ok?: boolean;
          freshRebuild?: string;
          phase3PrerequisiteScenarios?: number;
          scenarioCount?: number;
          scenarios?: string[];
          concurrency?: {
            directions?: Array<{
              winner?: string;
              waitObserved?: boolean;
              secondHadZeroPreGateWrites?: boolean;
              exactlyOneSettlement?: boolean;
              strictFailureIdentity?: boolean;
              loserZeroPartialWrites?: boolean;
              remainingEntitlementCorrect?: boolean;
            }>;
            bothStartOrders?: boolean;
            waitObserved?: boolean;
            earlyGateBeforeDraftWrites?: boolean;
            oneSettlementWon?: boolean;
            strictFailureIdentity?: boolean;
            loserRolledBack?: boolean;
            remainingEntitlementCorrect?: boolean;
            deadlockDelta?: number;
          };
          completionReplay?: {
            storedResultReplayed?: boolean;
            zeroWrites?: boolean;
            changedShiftIgnored?: boolean;
          };
          unauthorizedBeforeLock?: {
            rejectedBeforeBusinessLock?: boolean;
            zeroWrites?: boolean;
          };
          deadlineAfterLockWait?: {
            waitObserved?: boolean;
            postLockClockRejected?: boolean;
            zeroPartialWrites?: boolean;
          };
          settledReplayAfterDeadline?: {
            settledBeforeDeadline?: boolean;
            replayedAfterDeadline?: boolean;
            storedResultReplayed?: boolean;
            zeroWrites?: boolean;
          };
          mixedReversalLockOrder?: {
            bothCompleted?: boolean;
            deadlockDelta?: number;
          };
          operationContractBinding?: {
            negativeCases?: number;
            strictErrorIdentity?: boolean;
            freshConnectionZeroHeaders?: boolean;
          };
          operationInsertShapeMatrix?: {
            typedSuccessMatrix?: boolean;
            canonicalKeyStored?: boolean;
          };
          idempotencyReplayContract?: {
            canonicalIdentity?: string;
            return?: {
              equivalentRepresentationReplay?: boolean;
              changedPayloadConflict?: boolean;
              crossActorNoLeakage?: boolean;
              casePreserved?: boolean;
              exactlyOneOwner?: boolean;
              differentRootOrderDuplicateBlocked?: boolean;
              zeroCandidateWrites?: boolean;
            };
            replacement?: {
              equivalentRepresentationReplay?: boolean;
              changedPayloadConflict?: boolean;
              crossActorNoLeakage?: boolean;
              casePreserved?: boolean;
              exactlyOneOwner?: boolean;
              differentRootOrderDuplicateBlocked?: boolean;
              zeroCandidateWrites?: boolean;
            };
            nullOperationTypeRejected?: boolean;
            unsupportedOperationTypeRejected?: boolean;
            whitespaceOnlyKeyRejected?: boolean;
          };
        };
        assert.equal(result.ok, true);
        assert.equal(result.freshRebuild, '001-120');
        assert.equal(result.phase3PrerequisiteScenarios, 30);
        assert.equal(result.scenarioCount, 35);
        assert.equal(result.scenarios?.length, 35);
        assert.equal(result.operationContractBinding?.negativeCases, 6);
        assert.equal(result.operationContractBinding?.strictErrorIdentity, true);
        assert.equal(result.operationContractBinding?.freshConnectionZeroHeaders, true);
        assert.equal(result.operationInsertShapeMatrix?.typedSuccessMatrix, true);
        assert.equal(result.operationInsertShapeMatrix?.canonicalKeyStored, true);
        assert.equal(
          result.idempotencyReplayContract?.canonicalIdentity,
          'BTRIM ordinary edge spaces; case-sensitive',
        );
        for (const contract of [
          result.idempotencyReplayContract?.return,
          result.idempotencyReplayContract?.replacement,
        ]) {
          assert.equal(contract?.equivalentRepresentationReplay, true);
          assert.equal(contract?.changedPayloadConflict, true);
          assert.equal(contract?.crossActorNoLeakage, true);
          assert.equal(contract?.casePreserved, true);
          assert.equal(contract?.exactlyOneOwner, true);
          assert.equal(contract?.differentRootOrderDuplicateBlocked, true);
          assert.equal(contract?.zeroCandidateWrites, true);
        }
        assert.equal(result.idempotencyReplayContract?.nullOperationTypeRejected, true);
        assert.equal(result.idempotencyReplayContract?.unsupportedOperationTypeRejected, true);
        assert.equal(result.idempotencyReplayContract?.whitespaceOnlyKeyRejected, true);
        assert.deepEqual(
          result.concurrency?.directions?.map((direction) => direction.winner),
          ['A', 'B'],
        );
        assert.equal(result.concurrency?.directions?.length, 2);
        for (const direction of result.concurrency?.directions ?? []) {
          assert.equal(direction.waitObserved, true);
          assert.equal(direction.secondHadZeroPreGateWrites, true);
          assert.equal(direction.exactlyOneSettlement, true);
          assert.equal(direction.strictFailureIdentity, true);
          assert.equal(direction.loserZeroPartialWrites, true);
          assert.equal(direction.remainingEntitlementCorrect, true);
        }
        assert.equal(result.concurrency?.bothStartOrders, true);
        assert.equal(result.concurrency?.waitObserved, true);
        assert.equal(result.concurrency?.earlyGateBeforeDraftWrites, true);
        assert.equal(result.concurrency?.oneSettlementWon, true);
        assert.equal(result.concurrency?.strictFailureIdentity, true);
        assert.equal(result.concurrency?.loserRolledBack, true);
        assert.equal(result.concurrency?.remainingEntitlementCorrect, true);
        assert.equal(result.concurrency?.deadlockDelta, 0);
        assert.equal(result.completionReplay?.storedResultReplayed, true);
        assert.equal(result.completionReplay?.zeroWrites, true);
        assert.equal(result.completionReplay?.changedShiftIgnored, true);
        assert.equal(result.unauthorizedBeforeLock?.rejectedBeforeBusinessLock, true);
        assert.equal(result.unauthorizedBeforeLock?.zeroWrites, true);
        assert.equal(result.deadlineAfterLockWait?.waitObserved, true);
        assert.equal(result.deadlineAfterLockWait?.postLockClockRejected, true);
        assert.equal(result.deadlineAfterLockWait?.zeroPartialWrites, true);
        assert.equal(result.settledReplayAfterDeadline?.settledBeforeDeadline, true);
        assert.equal(result.settledReplayAfterDeadline?.replayedAfterDeadline, true);
        assert.equal(result.settledReplayAfterDeadline?.storedResultReplayed, true);
        assert.equal(result.settledReplayAfterDeadline?.zeroWrites, true);
        assert.equal(result.mixedReversalLockOrder?.bothCompleted, true);
        assert.equal(result.mixedReversalLockOrder?.deadlockDelta, 0);
      },
    );

    await context.test(
      'real guest Gateway covers Base Unit and configurable Parcel ambiguous retry',
      async () => {
        const { stdout } = await execFileAsync(
          process.execPath,
          [guestGatewayRuntimeScript],
          {
            cwd: projectRoot,
            windowsHide: true,
            maxBuffer: 1024 * 1024,
            timeout: 600_000,
            env: {
              ...process.env,
              // Cloudflare's public always-pass testing secret. It is valid
              // only with the documented dummy token used by this isolated suite.
              TURNSTILE_TEST_SECRET: '1x0000000000000000000000000000000AA',
            },
          },
        );
        const result = JSON.parse(stdout) as {
          ok?: boolean;
          v2_timeout_after_commit?: {exact_single_effect?: boolean};
          parcel_v2_timeout_after_commit?: {
            exact_single_effect?: boolean;
            instance_count?: number;
            component_count?: number;
            reservation_count?: number;
          };
          customer_cross_version?: {
            different_actor_privacy_safe?: boolean;
            different_actor_internal_cause?: boolean;
          };
        };
        assert.equal(result.ok, true);
        assert.equal(result.v2_timeout_after_commit?.exact_single_effect, true);
        assert.equal(result.parcel_v2_timeout_after_commit?.exact_single_effect, true);
        assert.equal(result.parcel_v2_timeout_after_commit?.instance_count, 1);
        assert.equal(result.parcel_v2_timeout_after_commit?.component_count, 2);
        assert.equal(result.parcel_v2_timeout_after_commit?.reservation_count, 2);
        assert.equal(result.customer_cross_version?.different_actor_privacy_safe, true);
        assert.equal(result.customer_cross_version?.different_actor_internal_cause, true);
      },
    );
  },
);
