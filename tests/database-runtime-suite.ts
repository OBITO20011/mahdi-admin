import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDirectory, '..');
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

test(
  'isolated Supabase runtime suites do not compete for Docker resources',
  { timeout: 1_800_000 },
  async (context) => {
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
          },
        );

        const result: { ok?: boolean; runtime_scenarios?: number } =
          JSON.parse(stdout);
        assert.equal(result.ok, true);
        assert.equal(result.runtime_scenarios, 9);
      },
    );

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
  },
);
