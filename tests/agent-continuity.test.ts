import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

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

test('owner-closed Phases 4-5 and authorized Phase 6 package B are explicit', () => {
  const state = JSON.parse(read('docs/agent/project-state.json')) as {
    closedPhases: string[];
    phase4Closed: boolean;
    phase5Closed: boolean;
    phase5ClosureBaseline: string;
    phase5ClosureExactShaCi: string;
    phase5ClosureCiRuns: { codeQuality: number; secretScanning: number };
    phase6PlanningAllowed: boolean;
    phase6ImplementationStarted: boolean;
    phase6AuthorizedPackage: string;
    phase6NextPackageAllowed: boolean;
    currentPhase: string | null;
    nextPermittedPhase: null;
    phase43Started: boolean;
    phase44Started: boolean;
    phase45Started: boolean;
    phase5Started: boolean;
    phase5Slice1Closed: boolean;
    phase5Slice2Started: boolean;
    phase5Slice2Closed: boolean;
    migrationCeiling: number;
    migration121Sha256: string;
    migration122HistoricalRawWindowsSha256: string;
    migration122CanonicalLfSha256: string;
    migration123MustBeAbsent: boolean;
    migration123Sha256: string;
    migration124MustBeAbsent: boolean;
    migration124CanonicalLfSha256: string;
    migration125CanonicalLfSha256: string;
    phase5Slice3ImplementationStarted: boolean;
    phase5Slice3Closed: boolean;
    phase5Slice4Started: boolean;
    phase5Slice4Closed: boolean;
    phase5Slice4ImplementationStatus: string;
    phase5Slice4IndependentReSignOff: string;
    phase5Slice4ClosureBaseline: string;
    phase5Slice4ClosureExactShaCi: string;
    phase5PublicActivationAllowed: boolean;
    migration126CanonicalLfSha256: string;
  };
  assert.deepEqual(state.closedPhases, ['3', '4.1', '4.2', '4.3', '4.4', '4.5', '5']);
  assert.equal(state.phase4Closed, true);
  assert.equal(state.currentPhase, '6');
  assert.equal(state.phase5Closed, true);
  assert.equal(state.phase5ClosureBaseline, 'bdea567562b1de8c64fe3aa286076258decf3d26');
  assert.equal(state.phase5ClosureExactShaCi, 'PASS');
  assert.deepEqual(state.phase5ClosureCiRuns, {
    codeQuality: 37408582997, secretScanning: 37408583034,
  });
  assert.equal(state.phase6PlanningAllowed, true);
  assert.equal(state.phase6ImplementationStarted, true);
  assert.equal(state.phase6AuthorizedPackage, 'B');
  assert.equal(state.phase6NextPackageAllowed, false);
  assert.equal(state.phase45Started, true);
  assert.equal(state.phase5Started, true);
  assert.equal(state.phase5Slice1Closed, true);
  assert.equal(state.phase5Slice2Started, true);
  assert.equal(state.phase5Slice2Closed, true);
  assert.equal(state.nextPermittedPhase, null);
  assert.equal(state.phase43Started, true);
  assert.equal(state.phase44Started, true);
  assert.equal(state.migrationCeiling, 131);
  assert.equal(state.phase5Slice3ImplementationStarted, true);
  assert.equal(state.phase5Slice3Closed, true);
  assert.equal(state.phase5Slice4Started, true);
  assert.equal(state.phase5Slice4Closed, true);
  assert.equal(state.phase5Slice4ImplementationStatus, 'OWNER_CLOSED_PRIVATE_ONLY');
  assert.equal(state.phase5Slice4IndependentReSignOff, 'PASS');
  assert.equal(state.phase5Slice4ClosureBaseline, '5405ed7a17656e4e18587b4f07ff0825a1efa838');
  assert.equal(state.phase5Slice4ClosureExactShaCi, 'PASS');
  assert.equal(state.phase5PublicActivationAllowed, false);
  assert.equal(state.migration126CanonicalLfSha256, '4C099804BA1D6B97DF6AF3FA0C0A8D514FD616397BDE1BC7F5E5DAE3EB8B1D21');
  assert.equal(state.migration121Sha256, '9779212034A901DBB971A68EC485D16B0AA4BE329478B9DAF1A4263CE6989BDD');
  assert.equal(state.migration122HistoricalRawWindowsSha256, 'DED829F8EF84F49EABD8D9AAA76D460632E36B86A8D041228DDB91692CA15C24');
  assert.equal(state.migration122CanonicalLfSha256, 'DF991DE73F32931B81C9C4B9C2F611F44731E99044ACBC2F5F60F4FE1192C066');
  assert.equal(state.migration123MustBeAbsent, false);
  assert.equal(state.migration123Sha256, '3F5FE7554B17BBC6BE872175682C36D7F17B5F2B72F00BD32EAE0F6A97483E80');
  assert.equal(state.migration124MustBeAbsent, false);
  assert.equal(state.migration124CanonicalLfSha256, '4B6A50442DDF0DBEE24233CB9036469B428CE20991E0315EB6C1FAFE4BDD4F41');
  assert.equal(state.migration125CanonicalLfSha256, 'D1CDA688B835C2791A0890F4E000A85FA7309B1A4E4DE02F21819491330A546B');
});

test('current task stays concise while historical evidence stays pinned in Git', () => {
  const text = read('docs/agent/ACTIVE_TASK.json');
  const task = JSON.parse(text) as { historyBaseline: string };
  assert.equal(task.historyBaseline, 'bdea567562b1de8c64fe3aa286076258decf3d26');
  assert.ok(Buffer.byteLength(text, 'utf8') <= 4096, 'Current task must not accumulate history');
  for (const historicalField of ['slice3Closure', 'slice4Closure', 'slice3DesignProposal']) {
    assert.equal(historicalField in task, false);
  }
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
