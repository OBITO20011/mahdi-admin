import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync, readdirSync} from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const git = (args: string[]) => execFileSync('git', args, {encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']}).trim();
type State = {
  branch: string; currentPhase: string | null; closedPhases: string[];
  approvedBaseline: string; migrationCeiling: number; productionAccessAllowed: boolean;
  [key: string]: unknown;
};
type Task = {
  phase: string; status: string; owner: string; branch: string; baselineSha: string;
  historyBaseline?: string; objective: string; prohibitions: string[];
};
const state = JSON.parse(read('docs/agent/project-state.json')) as State;
const task = JSON.parse(read('docs/agent/ACTIVE_TASK.json')) as Task;
const phaseStatus = read('docs/agent/PHASE_STATUS.md');
const migrationNumbers = readdirSync(new URL('../supabase/migrations/', import.meta.url), {withFileTypes: true})
  .filter(entry => entry.isFile() && /^\d{3}_.*\.sql$/u.test(entry.name))
  .map(entry => Number(entry.name.slice(0, 3)));
assert.ok(migrationNumbers.length > 0, 'Migration inventory must not be empty');
const highestMigration = Math.max(...migrationNumbers);
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

function assertContinuity(candidate: State, current: Task, status: string, ceiling: number) {
  assert.equal(candidate.migrationCeiling, ceiling);
  assert.equal(current.branch, candidate.branch);
  assert.ok(['ACTIVE', 'PAUSED', 'IDLE'].includes(current.status));
  assert.ok(['codex', 'claude'].includes(current.owner));
  assert.ok(current.objective.trim().length > 0);
  assert.equal(new Set(candidate.closedPhases).size, candidate.closedPhases.length);
  const documentedClosed = [...status.matchAll(/^\| Phase (\d+(?:\.\d+)?) \| OWNER-CLOSED \|/gmu)].map(match => match[1]);
  assert.deepEqual([...candidate.closedPhases].sort(), documentedClosed.sort());
  for (const phase of candidate.closedPhases) {
    assert.match(status, new RegExp(`\\| Phase ${escape(phase)} \\| OWNER-CLOSED \\|`, 'u'));
    const key = `phase${phase}Closed`;
    if (key in candidate) assert.equal(candidate[key], true);
  }
  for (const [key, closed] of Object.entries(candidate)) {
    const phase = key.match(/^phase(\d+)Closed$/u)?.[1];
    if (phase && phase !== '4') assert.equal(closed, candidate.closedPhases.includes(phase));
    const pkg = key.match(/^package([A-Z])Closed$/u)?.[1];
    if (pkg) assert.equal(closed, new RegExp(`\\| Package ${pkg} \\| OWNER-CLOSED \\|`, 'u').test(status));
    if (key.endsWith('ClosureBaseline') && candidate[key.replace(/ClosureBaseline$/u, 'Closed')] === true) {
      assert.match(String(candidate[key]), /^[a-f0-9]{40}$/u);
      assert.equal(candidate[key.replace(/Baseline$/u, 'ExactShaCi')], 'PASS');
      const runs = candidate[key.replace(/Baseline$/u, 'CiRuns')];
      if (runs) {
        const ids = runs as {codeQuality: number; secretScanning: number};
        assert.ok(Number.isSafeInteger(ids.codeQuality) && ids.codeQuality > 0);
        assert.ok(Number.isSafeInteger(ids.secretScanning) && ids.secretScanning > 0);
      }
    }
  }
  assert.equal(candidate.phase4Closed, /\| Phase 4 \(overall\) \| OWNER-CLOSED \|/u.test(status));
  if (candidate.phase4Closed === true) {
    assert.match(status, /\| Phase 4 \(overall\) \| OWNER-CLOSED \|/u);
    for (const child of ['4.1', '4.2', '4.3', '4.4', '4.5']) assert.ok(candidate.closedPhases.includes(child));
  }
  if (current.prohibitions.some(value => /Production/iu.test(value))) assert.equal(candidate.productionAccessAllowed, false);
  if (candidate.packageDPrivateLayerRetiredByMigration132 === true) assert.equal(candidate.phase5PublicActivationAllowed, false);
  if (current.status !== 'IDLE') {
    assert.equal(current.phase, candidate.currentPhase);
    assert.ok(!candidate.closedPhases.includes(current.phase), 'A closed phase is not active authority');
    const pkg = current.phase.match(/^PACKAGE_([A-Z])$/u)?.[1];
    const prefix = pkg ? `package${pkg}` : `phase${current.phase.replaceAll('.', '')}`;
    assert.equal(candidate[`${prefix}ImplementationAllowed`], true, 'Explicit current-scope authorization required');
    assert.notEqual(candidate[`${prefix}Closed`], true);
    if (pkg) assert.match(status, new RegExp(`\\| Package ${pkg} \\| IN PROGRESS`, 'u'));
  }
}

test('Codex and Claude resolve the same agent-neutral project contract', () => {
  const agents = read('AGENTS.md');
  const claude = read('CLAUDE.md');
  for (const contract of [
    'docs/agent/OPERATING_RULES.md',
    'docs/agent/PHASE_STATUS.md',
    'docs/agent/ACTIVE_TASK.json',
  ]) {
    assert.match(agents, new RegExp(contract.replace(/[./]/gu, '\\$&'), 'u'));
    assert.match(claude, new RegExp(contract.replace(/[./]/gu, '\\$&'), 'u'));
  }
  assert.match(agents + claude, /one (?:writing )?agent|one agent may write/iu);
  assert.match(agents + claude, /Production/iu);
});


test('current continuity matches declared authorization, closure evidence and actual migration inventory', () => {
  assertContinuity(state, task, phaseStatus, highestMigration);
});

test('continuity rejects scope drift, unauthorized progression, lost closure and fabricated CI state', () => {
  // Synthetic contracts keep these negative probes independent of the live
  // task's phase/status. They do not authorize or start any repository phase.
  const fixture: State = {branch: 'main', currentPhase: 'PACKAGE_A', closedPhases: ['3'],
    phase3Closed: true, phase4Closed: false, packageAImplementationAllowed: true,
    phase3ClosureBaseline: '1'.repeat(40), phase3ClosureExactShaCi: 'PASS',
    approvedBaseline: '1'.repeat(40), migrationCeiling: 3, productionAccessAllowed: false};
  const attempt: Task = {phase: 'PACKAGE_A', status: 'ACTIVE', owner: 'codex', branch: 'main',
    baselineSha: '1'.repeat(40), objective: 'Synthetic authorized scope', prohibitions: ['Production/deploy']};
  const documented = '| Phase 3 | OWNER-CLOSED |\n| Package A | IN PROGRESS |';
  assertContinuity(fixture, attempt, documented, 3);
  assertContinuity(fixture, {...attempt, status: 'IDLE'}, documented, 3);
  assert.throws(() => assertContinuity({...fixture, migrationCeiling: 2}, attempt, documented, 3));
  assert.throws(() => assertContinuity(fixture, {...attempt, branch: 'unapproved-branch'}, documented, 3));
  assert.throws(() => assertContinuity(fixture, {...attempt, phase: 'unauthorized-phase'}, documented, 3));
  assert.throws(() => assertContinuity({...fixture, currentPhase: '7'}, {...attempt, phase: '7'}, documented, 3));
  assert.throws(() => assertContinuity({...fixture, packageAImplementationAllowed: false}, attempt, documented, 3));
  assert.throws(() => assertContinuity({...fixture, productionAccessAllowed: true}, attempt, documented, 3));
  assert.throws(() => assertContinuity({...fixture, phase4Closed: true}, attempt, documented, 3));
  assert.throws(() => assertContinuity({...fixture, closedPhases: []}, attempt, documented, 3));
  assert.throws(() => assertContinuity({...fixture, phase3Closed: false}, attempt, documented, 3));
  assert.throws(() => assertContinuity(fixture, attempt, documented.replace('OWNER-CLOSED', 'OPEN'), 3));
  assert.throws(() => assertContinuity({...fixture, phase3ClosureBaseline: 'invalid-sha'}, attempt, documented, 3));
  assert.throws(() => assertContinuity({...fixture, phase3ClosureExactShaCi: 'PENDING'}, attempt, documented, 3));
});

test('checkpoint history is concise and descends from the approved Git baseline', () => {
  assert.ok(Buffer.byteLength(read('docs/agent/ACTIVE_TASK.json'), 'utf8') <= 4096);
  for (const sha of [state.approvedBaseline, task.baselineSha]) assert.match(sha, /^[a-f0-9]{40}$/u);
  git(['merge-base', '--is-ancestor', state.approvedBaseline, task.baselineSha]);
  if ('historyBaseline' in task) {
    assert.match(task.historyBaseline!, /^[a-f0-9]{40}$/u);
    git(['merge-base', '--is-ancestor', task.historyBaseline!, task.baselineSha]);
  }
  git(['merge-base', '--is-ancestor', task.baselineSha, 'HEAD']);
  const parent = git(['rev-parse', `${task.baselineSha}^`]);
  assert.throws(() => git(['merge-base', '--is-ancestor', task.baselineSha, parent]));
  assert.throws(() => git(['merge-base', '--is-ancestor', '0'.repeat(40), task.baselineSha]));
  for (const historicalField of ['slice3Closure', 'slice4Closure', 'slice3DesignProposal']) assert.equal(historicalField in task, false);
});

test('handoff tooling is fail-closed and never stores environment values', () => {
  const preflight = read('scripts/agent/preflight.mjs');
  const start = read('scripts/agent/start.mjs');
  const resume = read('scripts/agent/resume.mjs');
  const verify = read('scripts/agent/verify-handoff.mjs');
  assert.match(preflight, /productionEnvironmentNames/u);
  assert.match(preflight, /migration121Sha256/u);
  assert.match(preflight, /migration122CanonicalLfSha256/u);
  assert.match(preflight, /migration123Sha256/u);
  assert.match(preflight, /migration124CanonicalLfSha256/u);
  assert.match(preflight, /migration125CanonicalLfSha256/u);
  assert.match(preflight, /migration126CanonicalLfSha256/u);
  assert.match(preflight, /migration127CanonicalLfSha256/u);
  assert.match(preflight, /unexpectedAboveCeiling/u);
  assert.match(start, /dirty worktree/u);
  assert.match(resume, /workingTreeFingerprint/u);
  assert.match(verify, /possible secret material/u);
  assert.doesNotMatch(preflight + start + resume + verify, /Object\.entries\(process\.env\)/u);
});
