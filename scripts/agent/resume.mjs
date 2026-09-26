import { git, readJson, taskPath, workingTreeFingerprint } from './lib.mjs';

const task = readJson(taskPath);
const failures = [];
if (task.status === 'IDLE') failures.push('No active or paused task exists');
if (git(['branch', '--show-current']) !== task.branch) failures.push('Branch differs from checkpoint');
if (git(['rev-parse', 'HEAD']) !== task.baselineSha) failures.push('HEAD differs from checkpoint baseline');
if (!task.workingTreeFingerprint) failures.push('Checkpoint has no working-tree fingerprint');
if (task.workingTreeFingerprint && workingTreeFingerprint() !== task.workingTreeFingerprint) failures.push('Working tree differs from checkpoint');

console.log(JSON.stringify({
  safeToResume: failures.length === 0,
  task: {
    status: task.status,
    owner: task.owner,
    objective: task.objective,
    phase: task.phase,
    filesTouched: task.filesTouched,
    testsPassed: task.testsPassed,
    testsRemaining: task.testsRemaining,
    blockers: task.blockers,
    nextExactAction: task.nextExactAction,
    activeProcesses: task.activeProcesses,
    prohibitions: task.prohibitions,
  },
  failures,
}, null, 2));
process.exitCode = failures.length === 0 ? 0 : 1;
