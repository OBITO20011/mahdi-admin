import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) => readFile(path, 'utf8');

type ProjectContinuityState = {
  approvedBaseline: string;
  closedPhases: string[];
  phase4Closed: boolean;
  currentPhase: string | null;
  phase44Started: boolean;
  phase45Started: boolean;
  phase5Started: boolean;
  phase5Slice1Closed: boolean;
  phase5Slice2Started: boolean;
  phase5Slice2Closed: boolean;
  phase5Slice3ImplementationStarted: boolean;
  phase5Slice3Closed: boolean;
  phase5Slice3ClosureBaseline: string;
  phase5Slice3ClosureExactShaCi: string;
  phase5Slice4DesignStatus: string;
  phase5Slice4Started: boolean;
  phase5Slice4Closed: boolean;
  phase5Slice4IndependentReSignOff: string;
  phase5PublicActivationAllowed: boolean;
  phase5Slice3AuthorizationBaseline: string;
};

type ActiveTaskContinuityState = {
  status: string;
  objective: string;
  slice3ImplementationAuthorization: {
    approved: boolean; baselineSha: string; migration: number; publicActivationAllowed: boolean;
  };
  slice3Closure: {
    status: string; baselineSha: string; migration126Sha256: string;
    independentReSignOff: string; critical: number; high: number; medium: number;
    low: number; materialEvidenceGaps: number; commit: string; push: string;
    exactShaCi: string; publicActivation: string;
    ciEvent: string; ciBranch: string; codeQualityRun: number; secretScanningRun: number;
  };
  slice4DesignAuthorization: {
    approved: boolean; scope: string; implementationAllowed: boolean; publicActivationAllowed: boolean;
  };
  slice4ImplementationAuthorization: {
    approved: boolean; baselineSha: string; migration: number; publicActivationAllowed: boolean; scope: string;
  };
  slice4Closure: {
    status: string; baselineSha: string; migration127Sha256: string;
    independentReSignOff: string; critical: number; high: number; medium: number;
    low: number; materialEvidenceGaps: number; commit: string; push: string;
    exactShaCi: string; publicActivation: string;
  };
  slice4DeliveryAuthorization: {
    approved: boolean; oneCommitOnly: boolean; pushTarget: string;
    exactShaCiRequired: boolean; deployAllowed: boolean;
    laterSliceAllowed: boolean; productionAccessAllowed: boolean;
  };
  baselineSha: string;
  completed: string[];
  inProgress: string[];
  notStarted: string[];
  testsRemaining: string[];
  prohibitions: string[];
};

const closureSha = '247980af9636ab01b20c80cac6bb3d23de2cc584';
const assertPhase4Closed = (
  projectState: ProjectContinuityState,
  phaseStatus: string,
  task: ActiveTaskContinuityState,
) => {
  assert.equal(projectState.approvedBaseline, closureSha);
  assert.deepEqual(projectState.closedPhases, ['3', '4.1', '4.2', '4.3', '4.4', '4.5']);
  assert.equal(projectState.phase4Closed, true);
  assert.equal(projectState.phase44Started, true);
  assert.equal(projectState.phase45Started, true);
  assert.match(phaseStatus, /\| Phase 4\.4 \| OWNER-CLOSED \|/u);
  assert.match(phaseStatus, /\| Phase 4\.5 \| OWNER-CLOSED \|/u);
  assert.match(phaseStatus, /\| Phase 4 \(overall\) \| OWNER-CLOSED \|/u);
  assert.ok(task.completed.includes('Phase 4.4 owner-closed'));
  assert.ok(task.completed.includes(
    `Phase 4.4 closure commit ${closureSha} pushed to origin/main`,
  ));
  assert.ok(task.completed.includes(
    `Exact-SHA Nawasrah code quality and secret scanning CI passed for ${closureSha}`,
  ));
  assert.ok(task.completed.includes(
    'Phase 4.5 independent closure sign-off passed with zero findings and zero material evidence gaps',
  ));
  assert.ok(task.completed.includes('Phase 4 owner-closed'));
};

const assertSlices12Closed = (
  projectState: ProjectContinuityState,
  phaseStatus: string,
  task: ActiveTaskContinuityState,
) => {
  assert.equal(projectState.currentPhase, '5');
  assert.equal(projectState.phase5Started, true);
  assert.equal(projectState.phase5Slice1Closed, true);
  assert.equal(projectState.phase5Slice2Started, true);
  assert.equal(projectState.phase5Slice2Closed, true);
  assert.match(phaseStatus, /\| Phase 5 \| IN PROGRESS \|/u);
  assert.match(phaseStatus, /Slice 1 private inactive financial evidence foundation is OWNER-CLOSED/u);
  assert.match(phaseStatus, /Slice 2 private canonical collection and exact-payment-reversal writers are OWNER-CLOSED/u);
  assert.equal(projectState.phase5Slice3ImplementationStarted, true);
  assert.equal(projectState.phase5Slice3Closed, true);
  assert.equal(projectState.phase5Slice4Started, true);
  assert.equal(projectState.phase5Slice4Closed, true);
  assert.equal(projectState.phase5Slice4IndependentReSignOff, 'PASS');
  assert.match(phaseStatus, /Slice 4 private financial read\/reconciliation in Migration 127 is OWNER-CLOSED/u);
  assert.equal(projectState.phase5PublicActivationAllowed, false);
  assert.equal(projectState.phase5Slice3AuthorizationBaseline, '6fac32ac422206a3b5e5716159304806f30d0aed');
  assert.deepEqual(task.slice3ImplementationAuthorization, {
    approved: true, baselineSha: projectState.phase5Slice3AuthorizationBaseline,
    migration: 126, publicActivationAllowed: false,
  });
  assert.ok(['ACTIVE', 'PAUSED'].includes(task.status));
  assert.equal(projectState.phase5Slice3ClosureBaseline, '095245e6bd30d2f40850e8779232f806f2cd0beb');
  assert.equal(projectState.phase5Slice3ClosureExactShaCi, 'PASS');
  assert.equal(projectState.phase5Slice4DesignStatus, 'THREE_GAP_BOUNDED_DESIGN_CONFIRMATION_PASS');
  assert.equal(task.baselineSha, projectState.phase5Slice3ClosureBaseline);
  assert.deepEqual(task.slice4DesignAuthorization, {
    approved: true, scope: 'Continuity synchronization and source-grounded scope/design proposal only',
    implementationAllowed: false, publicActivationAllowed: false,
  });
  assert.deepEqual(task.slice4ImplementationAuthorization, {
    approved: true, baselineSha: '095245e6bd30d2f40850e8779232f806f2cd0beb', migration: 127,
    publicActivationAllowed: false,
    scope: 'Private financial facts/position/reconciliation; total discovery, exact money and STABLE zero-write snapshot proof',
  });
  assert.equal(task.objective, 'Phase 5 Slice 4 owner closure and authorized baseline commit/push/CI verification; later slices and public activation not started.');
  assert.deepEqual(task.inProgress, ['Owner-authorized Slice 4 baseline commit/push and exact-SHA CI verification']);
  assert.deepEqual(task.slice4DeliveryAuthorization, {
    approved: true, oneCommitOnly: true, pushTarget: 'origin/main',
    exactShaCiRequired: true, deployAllowed: false,
    laterSliceAllowed: false, productionAccessAllowed: false,
  });
  assert.deepEqual(task.testsRemaining, []);
  assert.deepEqual(task.slice4Closure, {
    status: 'OWNER-CLOSED', baselineSha: '095245e6bd30d2f40850e8779232f806f2cd0beb',
    migration127Sha256: 'A2C9561EF071E959152D7DD06CAFC0F9BE933F18F845F4AE03D2B1A8971BE60D',
    independentReSignOff: 'PASS', critical: 0, high: 0, medium: 0, low: 0,
    materialEvidenceGaps: 0, commit: 'NOT PERFORMED', push: 'NOT PERFORMED',
    exactShaCi: 'NOT RUN FOR UNCOMMITTED CANDIDATE', publicActivation: 'NOT PERFORMED',
  });
  assert.ok(task.completed.includes('Phase 5 Slice 4 owner-closed'));
  assert.ok(task.completed.includes('Phase 5 Slice 4 bounded independent read-only re-sign-off PASS with zero scoped findings and material evidence gaps'));
  assert.deepEqual(task.slice3Closure, {
    status: 'OWNER-CLOSED', baselineSha: '6fac32ac422206a3b5e5716159304806f30d0aed',
    migration126Sha256: '4C099804BA1D6B97DF6AF3FA0C0A8D514FD616397BDE1BC7F5E5DAE3EB8B1D21',
    independentReSignOff: 'PASS', critical: 0, high: 0, medium: 0, low: 0,
    materialEvidenceGaps: 0, commit: '095245e6bd30d2f40850e8779232f806f2cd0beb', push: 'VERIFIED origin/main',
    exactShaCi: 'PASS', publicActivation: 'NOT PERFORMED',
    ciEvent: 'push', ciBranch: 'main', codeQualityRun: 36808501724, secretScanningRun: 36808501743,
  });
  assert.ok(task.completed.includes('Phase 5 Slice 3 owner-closed'));
  assert.ok(task.completed.includes('Phase 5 Slice 3 bounded independent historical-membership re-sign-off PASS with zero scoped findings and material evidence gaps'));
  assert.deepEqual(task.notStarted, ['Later Phase 5 slices and public activation']);
  assert.ok(task.prohibitions.includes('Start Phase 5 Slice 4 or public activation without owner authorization'));
  assert.ok(task.completed.includes(
    'Phase 5 Slice 1 bounded independent re-review passed with zero remaining findings and zero material evidence gaps',
  ));
  assert.ok(task.completed.includes('Phase 5 Slice 1 owner-closed'));
  assert.ok(task.completed.includes('Phase 5 Slice 2 owner-closed'));
  assert.ok(task.completed.includes('Phase 5 Slice 2 bounded independent Low/P3 re-sign-off PASS with zero remaining scoped findings and material evidence gaps'));
};

test('Slice 4 runner uses a fresh isolated full schema and both browser projects', async () => {
  const source = await read('scripts/testing/run-phase44-admin-recovery-fullstack.mjs');
  assert.match(source, /bootstrap-isolated-supabase\.mjs/u);
  assert.match(source, /phase3-configurable-parcel-contracts-runtime\.sql/u);
  assert.match(source, /desktop-chromium[\s\S]*mobile-webkit/u);
  assert.match(source, /--retries=0/u);
  assert.match(source, /CI: '1'/u);
  assert.doesNotMatch(source, /canonical|npm run quality|test:e2e/u);
});

test('Slice 4 full-stack probes use real public RPCs and deliberate response faults', async () => {
  const source = await read('e2e/phase44-admin-recovery-fullstack.spec.ts');
  for (const rpc of ['settle_sales_replacement_v1', 'settle_admin_sales_return_v1']) {
    assert.match(source, new RegExp(rpc, 'u'));
  }
  assert.match(source, /route\.fetch\(\)[\s\S]*route\.abort\('failed'\)/u);
  assert.match(source, /issuedQuantity: 99/u);
  assert.match(source, /page\.reload\(\)/u);
  assert.match(source, /browser\.newContext\(\)/u);
  assert.match(source, /context\.newPage\(\)/u);
  assert.match(source, /deliberately reordered stale response/u);
  assert.match(source, /AFTERCARE_REVIEW_REQUIRED/u);
  assert.match(source, /استعادة الاستبدال/u);
});

test('Slice 4 asserts immutable recovery identity and zero-write durable fingerprints', async () => {
  const source = await read('e2e/phase44-admin-recovery-fullstack.spec.ts');
  const runner = await read('scripts/testing/run-phase44-admin-recovery-fullstack.mjs');
  for (const field of ['idempotencyKey', 'requestFingerprint', 'intentId']) {
    assert.match(source, new RegExp(field, 'u'));
  }
  assert.match(source, /expect\(await snapshot\(fixture\)\)\.toEqual\(committed\)/u);
  assert.match(source, /expect\(await snapshot\(fixture\)\)\.toEqual\(before\)/u);
  assert.match(source, /rpcCalls\)\.toBe\(1\)/u);
  assert.match(source, /recoveryFingerprint/u);
  assert.match(source, /content-sensitive durable fingerprint detects a same-count row mutation/u);
  assert.match(runner, /extensions\.digest/u);
  assert.match(runner, /jsonb_agg\(to_jsonb/u);
  for (const relation of ['business_operations', 'sales_return_events',
    'sales_replacement_events', 'sales_aftercare_consumptions', 'inventory_movements',
    'phase42_return_inventory_effects', 'phase42_return_settlement_evidence',
    'phase43_replacement_inventory_effects', 'phase43_replacement_settlement_evidence',
    'customer_payments', 'cash_shifts', 'audit_logs']) {
    assert.match(runner, new RegExp(relation, 'u'));
  }
  assert.match(runner, /fingerprintMutationProbeSql/u);
  assert.match(runner, /ROLLBACK/u);
});

test('Slice 4 stays preserved after final Phase 4 owner closure', async () => {
  const packageState = JSON.parse(await read('package.json')) as {
    scripts: Record<string, string>;
  };
  assert.equal(
    packageState.scripts['test:phase44-admin-recovery:fullstack'],
    'node scripts/testing/run-phase44-admin-recovery-fullstack.mjs',
  );
  const projectState = JSON.parse(
    await read('docs/agent/project-state.json'),
  ) as ProjectContinuityState;
  const phaseStatus = await read('docs/agent/PHASE_STATUS.md');
  const task = JSON.parse(
    await read('docs/agent/ACTIVE_TASK.json'),
  ) as ActiveTaskContinuityState;

  assertPhase4Closed(projectState, phaseStatus, task);
  assertSlices12Closed(projectState, phaseStatus, task);
  assert.match(task.baselineSha, /^[0-9a-f]{40}$/u);
  execFileSync('git', ['merge-base', '--is-ancestor', task.baselineSha, 'HEAD']);
});

test('Slices 1-2 closed continuity rejects lost closure, stale work and unauthorized progression', async () => {
  const projectState = JSON.parse(
    await read('docs/agent/project-state.json'),
  ) as ProjectContinuityState;
  const phaseStatus = await read('docs/agent/PHASE_STATUS.md');
  const task = JSON.parse(
    await read('docs/agent/ACTIVE_TASK.json'),
  ) as ActiveTaskContinuityState;

  const lostPhase4Closure = structuredClone(projectState);
  lostPhase4Closure.phase4Closed = false;
  assert.throws(() => assertPhase4Closed(lostPhase4Closure, phaseStatus, task));

  const lostSlice1Closure = structuredClone(projectState);
  lostSlice1Closure.phase5Slice1Closed = false;
  assert.throws(() => assertSlices12Closed(lostSlice1Closure, phaseStatus, task));

  const lostSlice2Closure = structuredClone(projectState);
  lostSlice2Closure.phase5Slice2Closed = false;
  assert.throws(() => assertSlices12Closed(lostSlice2Closure, phaseStatus, task));

  const missingClosureEvidence = structuredClone(task);
  missingClosureEvidence.completed = missingClosureEvidence.completed.filter(
    (entry) => entry !== 'Phase 5 Slice 1 owner-closed',
  );
  assert.throws(() => assertSlices12Closed(projectState, phaseStatus, missingClosureEvidence));

  const unauthorizedSlice3 = structuredClone(task);
  unauthorizedSlice3.slice3ImplementationAuthorization.approved = false;
  assert.throws(() => assertSlices12Closed(projectState, phaseStatus, unauthorizedSlice3));

  const unauthorizedActivation = structuredClone(projectState);
  unauthorizedActivation.phase5PublicActivationAllowed = true;
  assert.throws(() => assertSlices12Closed(unauthorizedActivation, phaseStatus, task));

  const lostSlice3 = structuredClone(projectState);
  lostSlice3.phase5Slice3Closed = false;
  assert.throws(() => assertSlices12Closed(lostSlice3, phaseStatus, task));
  const unauthorizedSlice4 = structuredClone(projectState);
  unauthorizedSlice4.phase5Slice4Started = false;
  assert.throws(() => assertSlices12Closed(unauthorizedSlice4, phaseStatus, task));
  const lostSlice4Closure = structuredClone(projectState);
  lostSlice4Closure.phase5Slice4Closed = false;
  assert.throws(() => assertSlices12Closed(lostSlice4Closure, phaseStatus, task));
  const falseSlice4Review = structuredClone(task);
  falseSlice4Review.slice4Closure.independentReSignOff = 'PENDING';
  assert.throws(() => assertSlices12Closed(projectState, phaseStatus, falseSlice4Review));
  const wrongSlice4Hash = structuredClone(task);
  wrongSlice4Hash.slice4Closure.migration127Sha256 = '0'.repeat(64);
  assert.throws(() => assertSlices12Closed(projectState, phaseStatus, wrongSlice4Hash));
  const unresolvedSlice4Gap = structuredClone(task);
  unresolvedSlice4Gap.slice4Closure.materialEvidenceGaps = 1;
  assert.throws(() => assertSlices12Closed(projectState, phaseStatus, unresolvedSlice4Gap));
  const falseCi = structuredClone(task);
  falseCi.slice3Closure.exactShaCi = 'PENDING';
  assert.throws(() => assertSlices12Closed(projectState, phaseStatus, falseCi));
  const wrongCommit = structuredClone(task);
  wrongCommit.slice3Closure.commit = '6fac32ac422206a3b5e5716159304806f30d0aed';
  assert.throws(() => assertSlices12Closed(projectState, phaseStatus, wrongCommit));
  const unfinishedPush = structuredClone(task);
  unfinishedPush.slice3Closure.push = 'NOT PERFORMED';
  assert.throws(() => assertSlices12Closed(projectState, phaseStatus, unfinishedPush));
  const unauthorizedImplementation = structuredClone(task);
  unauthorizedImplementation.slice4DesignAuthorization.implementationAllowed = true;
  assert.throws(() => assertSlices12Closed(projectState, phaseStatus, unauthorizedImplementation));
  const missingReview = structuredClone(task);
  missingReview.slice3Closure.independentReSignOff = 'PENDING';
  assert.throws(() => assertSlices12Closed(projectState, phaseStatus, missingReview));

  const staleClosedTask = structuredClone(task);
  staleClosedTask.testsRemaining = ['stale completed review'];
  assert.throws(() => assertSlices12Closed(projectState, phaseStatus, staleClosedTask));

  const staleInProgress = structuredClone(task);
  staleInProgress.inProgress = ['completed Slice 2 review'];
  assert.throws(() => assertSlices12Closed(projectState, phaseStatus, staleInProgress));
});
