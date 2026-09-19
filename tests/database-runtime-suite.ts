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
const phase2ReceivingRuntimeScript = path.join(
  projectRoot,
  'scripts',
  'testing',
  'run-phase2-configurable-receiving-runtime.mjs',
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
              reversalFirst?: boolean;
              internalWaitObserved?: boolean;
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
        assert.equal(result.phase2Closure?.independentNewOperationFixesLocallyVerified, true);
        assert.equal(result.phase2Closure?.ownerPolicyImplemented, true);
        assert.equal(result.phase2Closure?.phase2Closed, true);
        assert.equal(result.phase2Closure?.finalVerdict, 'PHASE 2 = READY TO CLOSE');
      },
    );
  },
);
