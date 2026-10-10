import { commandVersion, git, migrationInventory, productionEnvironmentNames, readJson, root, statePath, statusEntries, taskPath } from './lib.mjs';

const state = readJson(statePath);
const task = readJson(taskPath);
const branch = git(['branch', '--show-current']);
const head = git(['rev-parse', 'HEAD']);
const repoRoot = git(['rev-parse', '--show-toplevel']).replaceAll('\\', '/');
const migrations = migrationInventory();
const productionNames = productionEnvironmentNames();
const failures = [];
if (state.migrationCeiling >= 137 && (!state.migration137CanonicalLfSha256
  || !migrations.migration137Exists
  || migrations.migration137CanonicalLfSha256 !== state.migration137CanonicalLfSha256)) {
  failures.push('Migration 137 hash missing or mismatch');
}
if (state.migrationCeiling >= 136 && (!state.migration136CanonicalLfSha256
  || !migrations.migration136Exists
  || migrations.migration136CanonicalLfSha256 !== state.migration136CanonicalLfSha256)) {
  failures.push('Migration 136 hash missing or mismatch');
}
if (state.migrationCeiling >= 135 && (!state.migration135CanonicalLfSha256
  || !migrations.migration135Exists
  || migrations.migration135CanonicalLfSha256 !== state.migration135CanonicalLfSha256)) {
  failures.push('Migration 135 hash missing or mismatch');
}
if (state.migrationCeiling >= 134 && (!state.migration134CanonicalLfSha256
  || !migrations.migration134Exists
  || migrations.migration134CanonicalLfSha256 !== state.migration134CanonicalLfSha256)) {
  failures.push('Migration 134 hash missing or mismatch');
}
if (state.migrationCeiling >= 133 && (!state.migration133CanonicalLfSha256
  || !migrations.migration133Exists
  || migrations.migration133CanonicalLfSha256 !== state.migration133CanonicalLfSha256)) {
  failures.push('Migration 133 hash missing or mismatch');
}
if (state.migrationCeiling >= 132 && (!state.migration132CanonicalLfSha256
  || !migrations.migration132Exists
  || migrations.migration132CanonicalLfSha256 !== state.migration132CanonicalLfSha256)) {
  failures.push('Migration 132 hash missing or mismatch');
}
if (state.migrationCeiling >= 131 && (!state.migration131CanonicalLfSha256
  || !migrations.migration131Exists
  || migrations.migration131CanonicalLfSha256 !== state.migration131CanonicalLfSha256)) {
  failures.push('Migration 131 hash missing or mismatch');
}
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
if (state.migrationCeiling >= 130 && (!state.migration130CanonicalLfSha256
  || !migrations.migration130Exists
  || migrations.migration130CanonicalLfSha256 !== state.migration130CanonicalLfSha256)) {
  failures.push('Migration 130 hash missing or mismatch');
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
