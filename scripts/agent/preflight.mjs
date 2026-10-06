import { commandVersion, git, migrationInventory, productionEnvironmentNames, readJson, root, statePath, statusEntries, taskPath } from './lib.mjs';

const state = readJson(statePath);
const task = readJson(taskPath);
const branch = git(['branch', '--show-current']);
const head = git(['rev-parse', 'HEAD']);
const repoRoot = git(['rev-parse', '--show-toplevel']).replaceAll('\\', '/');
const migrations = migrationInventory();
const productionNames = productionEnvironmentNames();
const failures = [];
if (state.migrationCeiling >= 127 && (!state.migration127CanonicalLfSha256
  || !migrations.migration127Exists
  || migrations.migration127CanonicalLfSha256 !== state.migration127CanonicalLfSha256)) {
  failures.push('Migration 127 hash missing or mismatch');
}
if (state.migrationCeiling >= 128 && (!state.migration128CanonicalLfSha256
  || !migrations.migration128Exists
  || migrations.migration128CanonicalLfSha256 !== state.migration128CanonicalLfSha256)) {
  failures.push('Migration 128 hash missing or mismatch');
}
if (state.migrationCeiling >= 129 && (!state.migration129CanonicalLfSha256
  || !migrations.migration129Exists
  || migrations.migration129CanonicalLfSha256 !== state.migration129CanonicalLfSha256)) {
  failures.push('Migration 129 hash missing or mismatch');
}
if (migrations.unexpectedAboveCeiling.length) failures.push('Migration above approved ceiling');
if (state.migration126CanonicalLfSha256
  && (!migrations.migration126Exists
    || migrations.migration126CanonicalLfSha256 !== state.migration126CanonicalLfSha256)) {
  failures.push('Migration 126 hash mismatch');
}
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
if (state.migration122CanonicalLfSha256
  && (!migrations.migration122Exists
    || migrations.migration122CanonicalLfSha256 !== state.migration122CanonicalLfSha256)) {
  failures.push('Migration 122 hash mismatch');
}
if (state.migration123MustBeAbsent && !migrations.migration123Absent) failures.push('Migration 123 is present');
if (state.migration123Sha256
  && (!migrations.migration123Exists || migrations.migration123Sha256 !== state.migration123Sha256)) {
  failures.push('Migration 123 hash mismatch');
}
if (state.migration124MustBeAbsent && !migrations.migration124Absent) failures.push('Migration 124 is present');
if (state.migration124CanonicalLfSha256
  && (!migrations.migration124Exists
    || migrations.migration124CanonicalLfSha256 !== state.migration124CanonicalLfSha256)) {
  failures.push('Migration 124 hash mismatch');
}
if (productionNames.length > 0) failures.push(`production-sensitive environment names are set: ${productionNames.join(', ')}`);
if (state.migration125CanonicalLfSha256
  && (!migrations.migration125Exists
    || migrations.migration125CanonicalLfSha256 !== state.migration125CanonicalLfSha256)) {
  failures.push('Migration 125 hash mismatch');
}

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
