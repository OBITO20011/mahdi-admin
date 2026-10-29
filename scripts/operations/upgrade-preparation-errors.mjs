// Only repository-owned codes leave preparation; never echo native stderr,
// file paths, connection strings, assertion operands or environment values.
const known = new Set([
 'UPGRADE_BACKUP_WINDOWS_TASK_PREFLIGHT_REQUIRED',
 'UPGRADE_BACKUP_TASKS_NOT_VISIBLE_RUN_AS_ADMINISTRATOR',
 'UPGRADE_ADMINISTRATOR_CHECK_FAILED', 'UPGRADE_BACKUP_TASKS_READ_FAILED',
 'UPGRADE_BACKUP_TASKS_INVALID_RESPONSE', 'UPGRADE_POWERSHELL_NOT_FOUND',
 'UPGRADE_PREPARATION_TIMEOUT', 'UPGRADE_PREPARATION_FILE_NOT_FOUND',
 'UPGRADE_PREPARATION_ACCESS_DENIED', 'UPGRADE_PREPARATION_INVALID_JSON',
 'UPGRADE_PREPARATION_INVALID_ARGUMENTS', 'UPGRADE_PREPARATION_ASSERTION_FAILED',
 'UPGRADE_PREPARATION_UNEXPECTED_FAILURE',
 'OPERATIONAL_CEILING_DRIFT', 'OPERATIONAL_TOOL_MANIFEST_NOT_REVIEWED',
 'OPERATIONAL_ARCHIVE_FORMAT_DRIFT', 'UPGRADE_ADAPTER_NOT_CURRENT',
 'OLD_BACKUP_LINK_CHANGED', 'LINK_TARGET_MISMATCH', 'OWNER_CONFIRMATION_REQUIRED',
 'OWNER_INTERACTIVE_TERMINAL_REQUIRED', 'CLI_OVERRIDE_NOT_ALLOWED',
 'OFFICIAL_CLI_STEP_FAILED', 'CONNECTED_VERSION_READ_FAILED', 'POSTGRES_MAJOR_MISMATCH',
 'TLS_ROOT_CERT_MISSING', 'TLS_CA_BUNDLE_INVALID',
]);
const taskCodes = new Set([
 'UPGRADE_BACKUP_TASK_REQUIRED', 'UPGRADE_BACKUP_TASK_DISABLED',
 'UPGRADE_BACKUP_TASK_ACTION_AMBIGUOUS', 'UPGRADE_BACKUP_TASK_OLD_CHECKOUT',
 'UPGRADE_BACKUP_TASK_EXECUTABLE', 'UPGRADE_BACKUP_TASK_ARGUMENTS_UNREVIEWED',
 'UPGRADE_BACKUP_TASK_OLD_SCRIPT', 'UPGRADE_BACKUP_TASK_CONFIG_PATH',
]);
export function upgradePreparationCode(error) {
 if (known.has(error?.code)) return error.code;
 if (known.has(error?.diagnostic?.category)) return error.diagnostic.category;
 if (known.has(error?.message)) return error.message;
 // Only inspect repository assertion labels, never native-tool messages.
 if (error?.code === 'ERR_ASSERTION') {
  const first = String(error.message).split('\n')[0];
  if (known.has(first)) return first;
  if (/^UPGRADE_BACKUP_TASK_[A-Z_]+:(Backup|Upload|VerifyRemote|RestoreRemote|Watchdog)$/u.test(first)
   && taskCodes.has(first.split(':')[0])) return first;
  if (['UNKNOWN_OPTION', 'UNKNOWN_OFFLINE_OPTION', 'ONE_MODE_REQUIRED'].includes(first)) return 'UPGRADE_PREPARATION_INVALID_ARGUMENTS';
  return 'UPGRADE_PREPARATION_ASSERTION_FAILED';
 }
 if (error?.code === 'ENOENT') return 'UPGRADE_PREPARATION_FILE_NOT_FOUND';
 if (['EACCES', 'EPERM'].includes(error?.code)) return 'UPGRADE_PREPARATION_ACCESS_DENIED';
 if (error?.code === 'ETIMEDOUT' || error?.killed === true) return 'UPGRADE_PREPARATION_TIMEOUT';
 if (error instanceof SyntaxError) return 'UPGRADE_PREPARATION_INVALID_JSON';
 return 'UPGRADE_PREPARATION_UNEXPECTED_FAILURE';
}
export function upgradePreparationFailure(code) {
 if (!known.has(code)) throw new Error('UNREVIEWED_UPGRADE_PREPARATION_CODE');
 return Object.assign(new Error(code), {code});
}
