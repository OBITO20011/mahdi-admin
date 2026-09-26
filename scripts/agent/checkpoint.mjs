import { writeFileSync } from 'node:fs';
import { git, parseArgs, readJson, statusEntries, taskPath, workingTreeFingerprint } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const task = readJson(taskPath);
const owner = typeof args.owner === 'string' ? args.owner : task.owner;
const next = typeof args.next === 'string' ? args.next.trim() : '';
if (!next) {
  console.error('Usage: npm run agent:checkpoint -- --next "exact next action" [--owner codex|claude] [--status ACTIVE|PAUSED|IDLE]');
  process.exit(2);
}

const entries = statusEntries();
const filesTouched = entries
  .map(({ path }) => path)
  .filter((path) => !['docs/agent/ACTIVE_TASK.json', 'docs/agent/HANDOFF_HISTORY.md'].includes(path));

const updated = {
  ...task,
  status: typeof args.status === 'string' ? args.status.toUpperCase() : 'PAUSED',
  owner,
  baselineSha: task.baselineSha || git(['rev-parse', 'HEAD']),
  branch: git(['branch', '--show-current']),
  checkpointedAt: new Date().toISOString(),
  filesTouched,
  nextExactAction: next,
  workingTreeFingerprint: workingTreeFingerprint(),
};

writeFileSync(taskPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
console.log(`Checkpoint saved for ${updated.owner || 'unassigned agent'}; ${filesTouched.length} task file(s); status ${updated.status}.`);
