import { commandVersion, git, migrationInventory, productionEnvironmentNames, readJson, root, statePath, statusEntries, taskPath } from './lib.mjs';

const state = readJson(statePath);
const task = readJson(taskPath);
const branch = git(['branch', '--show-current']);
const head = git(['rev-parse', 'HEAD']);
const repoRoot = git(['rev-parse', '--show-toplevel']).replaceAll('\\', '/');
const migrations = migrationInventory();
const productionNames = productionEnvironmentNames();
const failures = [];
const baselineIsAncestor = (() => {
  try {
    git(['merge-base', '--is-ancestor', state.approvedBaseline, head]);
    return true;
  } catch {
    return false;
  }
})();

if (branch !== state.branch) failures.push(`branch ${branch} != ${state.branch}`);
if (task.status === 'IDLE' && !baselineIsAncestor) failures.push('HEAD does not descend from the approved closed-phase baseline');
if (task.status !== 'IDLE' && head !== task.baselineSha) failures.push('active task HEAD differs from handoff baseline');
if (!migrations.migration121Exists || migrations.migration121Sha256 !== state.migration121Sha256) failures.push('Migration 121 hash mismatch');
if (state.migration122MustBeAbsent && migrations.migration122Exists) failures.push('Migration 122 is present');
if (state.migration122Sha256
  && (!migrations.migration122Exists || migrations.migration122Sha256 !== state.migration122Sha256)) {
  failures.push('Migration 122 hash mismatch');
}
if (state.migration123MustBeAbsent && !migrations.migration123Absent) failures.push('Migration 123 is present');
if (state.migration123Sha256
  && (!migrations.migration123Exists || migrations.migration123Sha256 !== state.migration123Sha256)) {
  failures.push('Migration 123 hash mismatch');
}
if (productionNames.length > 0) failures.push(`production-sensitive environment names are set: ${productionNames.join(', ')}`);

const report = {
  ok: failures.length === 0,
  root: repoRoot,
  expectedRoot: root.replaceAll('\\', '/'),
  branch,
  head,
  taskStatus: task.status,
  approvedBaselineIsAncestor: baselineIsAncestor,
  workingTreeEntries: statusEntries(),
  migrations,
  productionSensitiveEnvironmentNames: productionNames,
  tools: {
    node: process.version,
    npm: commandVersion('npm', ['--version']),
    git: commandVersion('git', ['--version']),
    codex: commandVersion('codex', ['--version']),
    claude: commandVersion('claude', ['--version']),
    code: commandVersion('code', ['--version']),
    docker: commandVersion('docker', ['--version']),
  },
  failures,
};

console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;
