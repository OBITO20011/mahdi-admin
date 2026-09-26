import { readFileSync } from 'node:fs';
import { readJson, taskPath, workingTreeFingerprint } from './lib.mjs';

const taskText = readFileSync(taskPath, 'utf8');
const task = readJson(taskPath);
const required = [
  'schemaVersion', 'status', 'objective', 'baselineSha', 'branch', 'completed', 'inProgress',
  'notStarted', 'filesTouched', 'testsPassed', 'testsRemaining', 'findings', 'blockers',
  'nextExactAction', 'activeProcesses', 'prohibitions', 'workingTreeFingerprint',
];
const failures = required.filter((key) => !(key in task)).map((key) => `missing ${key}`);
const secretPatterns = [
  /(?:service[_-]?role|secret|token|password|api[_-]?key)\s*[=:]\s*["']?[A-Za-z0-9_\-.]{12,}/iu,
  /(?:postgres(?:ql)?:\/\/)[^\s"']+@/iu,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
];
if (secretPatterns.some((pattern) => pattern.test(taskText))) failures.push('possible secret material in handoff');
if (!Array.isArray(task.filesTouched) || !Array.isArray(task.activeProcesses)) failures.push('handoff list fields must be arrays');
if (task.status !== 'IDLE' && task.workingTreeFingerprint !== workingTreeFingerprint()) failures.push('working-tree fingerprint mismatch');

console.log(JSON.stringify({ valid: failures.length === 0, status: task.status, failures }, null, 2));
process.exitCode = failures.length === 0 ? 0 : 1;
