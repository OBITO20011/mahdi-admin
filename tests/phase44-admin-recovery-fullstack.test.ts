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
};

type ActiveTaskContinuityState = {
  status: string;
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
  assert.equal(task.status, 'IDLE');
  assert.deepEqual(task.inProgress, []);
  assert.deepEqual(task.testsRemaining, []);
  assert.deepEqual(task.notStarted, ['Phase 5 Slice 3 and later slices']);
  assert.ok(task.prohibitions.includes('Start Phase 5 Slice 3 without owner authorization'));
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
  unauthorizedSlice3.notStarted = [];
  assert.throws(() => assertSlices12Closed(projectState, phaseStatus, unauthorizedSlice3));

  const staleClosedTask = structuredClone(task);
  staleClosedTask.testsRemaining = ['stale completed review'];
  assert.throws(() => assertSlices12Closed(projectState, phaseStatus, staleClosedTask));

  const staleInProgress = structuredClone(task);
  staleInProgress.inProgress = ['completed Slice 2 review'];
  assert.throws(() => assertSlices12Closed(projectState, phaseStatus, staleInProgress));
});
