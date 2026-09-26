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

test('closed-phase state is explicit and Migration 121 is pinned', () => {
  const state = JSON.parse(read('docs/agent/project-state.json')) as {
    closedPhases: string[];
    nextPermittedPhase: string;
    phase43Started: boolean;
    migrationCeiling: number;
    migration121Sha256: string;
    migration122MustBeAbsent: boolean;
  };
  assert.deepEqual(state.closedPhases, ['3', '4.1', '4.2']);
  assert.equal(state.nextPermittedPhase, '4.3');
  assert.equal(state.phase43Started, false);
  assert.equal(state.migrationCeiling, 121);
  assert.equal(state.migration121Sha256, '9779212034A901DBB971A68EC485D16B0AA4BE329478B9DAF1A4263CE6989BDD');
  assert.equal(state.migration122MustBeAbsent, true);
});

test('handoff tooling is fail-closed and never stores environment values', () => {
  const preflight = read('scripts/agent/preflight.mjs');
  const start = read('scripts/agent/start.mjs');
  const resume = read('scripts/agent/resume.mjs');
  const verify = read('scripts/agent/verify-handoff.mjs');
  assert.match(preflight, /productionEnvironmentNames/u);
  assert.match(preflight, /migration121Sha256/u);
  assert.match(start, /dirty worktree/u);
  assert.match(resume, /workingTreeFingerprint/u);
  assert.match(verify, /possible secret material/u);
  assert.doesNotMatch(preflight + start + resume + verify, /Object\.entries\(process\.env\)/u);
});
