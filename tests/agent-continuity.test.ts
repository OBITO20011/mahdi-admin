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

test('closed Phase 4 and active Phase 5 Slice 1 state with Migration 123 candidate are explicit', () => {
  const state = JSON.parse(read('docs/agent/project-state.json')) as {
    closedPhases: string[];
    phase4Closed: boolean;
    currentPhase: string | null;
    nextPermittedPhase: null;
    phase43Started: boolean;
    phase44Started: boolean;
    phase45Started: boolean;
    phase5Started: boolean;
    phase5Slice1Closed: boolean;
    migrationCeiling: number;
    migration121Sha256: string;
    migration122HistoricalRawWindowsSha256: string;
    migration122CanonicalLfSha256: string;
    migration123MustBeAbsent: boolean;
    migration123Sha256: string;
  };
  assert.deepEqual(state.closedPhases, ['3', '4.1', '4.2', '4.3', '4.4', '4.5']);
  assert.equal(state.phase4Closed, true);
  assert.equal(state.currentPhase, '5');
  assert.equal(state.phase45Started, true);
  assert.equal(state.phase5Started, true);
  assert.equal(state.phase5Slice1Closed, true);
  assert.equal(state.nextPermittedPhase, null);
  assert.equal(state.phase43Started, true);
  assert.equal(state.phase44Started, true);
  assert.equal(state.migrationCeiling, 123);
  assert.equal(state.migration121Sha256, '9779212034A901DBB971A68EC485D16B0AA4BE329478B9DAF1A4263CE6989BDD');
  assert.equal(state.migration122HistoricalRawWindowsSha256, 'DED829F8EF84F49EABD8D9AAA76D460632E36B86A8D041228DDB91692CA15C24');
  assert.equal(state.migration122CanonicalLfSha256, 'DF991DE73F32931B81C9C4B9C2F611F44731E99044ACBC2F5F60F4FE1192C066');
  assert.equal(state.migration123MustBeAbsent, false);
  assert.equal(state.migration123Sha256, '3F5FE7554B17BBC6BE872175682C36D7F17B5F2B72F00BD32EAE0F6A97483E80');
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
  assert.match(start, /dirty worktree/u);
  assert.match(resume, /workingTreeFingerprint/u);
  assert.match(verify, /possible secret material/u);
  assert.doesNotMatch(preflight + start + resume + verify, /Object\.entries\(process\.env\)/u);
});
