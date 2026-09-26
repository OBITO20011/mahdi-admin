import { writeFileSync } from 'node:fs';
import { git, parseArgs, readJson, taskPath, workingTreeFingerprint } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const task = readJson(taskPath);
const objective = typeof args.objective === 'string' ? args.objective.trim() : '';
const phase = typeof args.phase === 'string' ? args.phase.trim() : null;
const owner = typeof args.owner === 'string' ? args.owner.trim().toLowerCase() : null;

if (task.status !== 'IDLE') {
  console.error(`Cannot start: ACTIVE_TASK status is ${task.status}. Resume or close that task first.`);
  process.exit(1);
}
if (!objective || !owner || !['codex', 'claude'].includes(owner)) {
  console.error('Usage: npm run agent:start -- --owner codex|claude --objective "bounded objective" [--phase 4.3]');
  process.exit(2);
}

const entries = git(['status', '--porcelain=v1', '--untracked-files=all']);
if (entries) {
  console.error('Cannot start a new task from a dirty worktree. Account for or commit the existing work first.');
  process.exit(1);
}

const now = new Date().toISOString();
const updated = {
  ...task,
  status: 'ACTIVE',
  owner,
  objective,
  baselineSha: git(['rev-parse', 'HEAD']),
  branch: git(['branch', '--show-current']),
  phase,
  startedAt: now,
  checkpointedAt: now,
  inProgress: [objective],
  filesTouched: [],
  testsPassed: [],
  testsRemaining: [],
  findings: [],
  blockers: [],
  nextExactAction: 'Inspect the approved task contract and begin the first bounded step.',
  activeProcesses: [],
  workingTreeFingerprint: workingTreeFingerprint(),
};
writeFileSync(taskPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
console.log(`Started ${phase ? `Phase ${phase} ` : ''}task for ${owner} at ${updated.baselineSha}.`);
