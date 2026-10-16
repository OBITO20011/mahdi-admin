import { writeFileSync } from 'node:fs';
import { git, parseArgs, readJson, statusEntries, taskPath, workingTreeFingerprint } from './lib.mjs';
import {checkpointFileManifest,checkpointFilesPath} from './checkpoint-files.mjs';

const args = parseArgs(process.argv.slice(2));
const task = readJson(taskPath);
const owner = typeof args.owner === 'string' ? args.owner : task.owner;
const next = typeof args.next === 'string' ? args.next.trim() : '';
if (!next) {
  console.error('Usage: npm run agent:checkpoint -- --next "exact next action" [--owner codex|claude] [--status ACTIVE|PAUSED|IDLE]');
  process.exit(2);
}

const entries = statusEntries();
const manifest=checkpointFileManifest(entries);
// Write before the working-tree fingerprint:the manifest itself is protected.
writeFileSync(checkpointFilesPath,manifest.text,'utf8');

const updated = {
  ...task,
  status: typeof args.status === 'string' ? args.status.toUpperCase() : 'PAUSED',
  owner,
  baselineSha: task.baselineSha || git(['rev-parse', 'HEAD']),
  branch: git(['branch', '--show-current']),
  checkpointedAt: new Date().toISOString(),
  filesTouched:manifest.filesTouched,
  filesTouchedCount:manifest.filesTouchedCount,
  filesTouchedManifestSha256:manifest.filesTouchedManifestSha256,
  nextExactAction: next,
  workingTreeFingerprint: workingTreeFingerprint(),
};

writeFileSync(taskPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
console.log(`Checkpoint saved for ${updated.owner || 'unassigned agent'}; ${manifest.filesTouchedCount} task file(s) in ${checkpointFilesPath}; status ${updated.status}.`);
