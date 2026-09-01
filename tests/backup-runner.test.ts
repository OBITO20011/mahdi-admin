import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('backup runner prefers native PostgreSQL tools and keeps Docker as an interactive fallback', async () => {
  const source = await readFile('scripts/backup/run-backup.ps1', 'utf8');
  const backupSource = await readFile('scripts/backup/create-backup.mjs', 'utf8');
  assert.match(source, /function Test-DockerReady/u);
  assert.match(source, /NAWASRAH_PG_BIN/u);
  assert.match(source, /pg_dump\.exe/u);
  assert.match(source, /protectionScope -eq 'LocalMachine'/u);
  assert.match(source, /DataProtectionScope\]::LocalMachine/u);
  assert.match(source, /RedirectStandardError/u);
  assert.match(source, /process\.ExitCode -eq 0/u);
  assert.doesNotMatch(source, /& \$docker\.Source info/u);
  assert.match(backupSource, /'--data-only',[\s\S]*'--disable-triggers'/u);
});

test('backup package scripts isolate Windows PowerShell from inherited PowerShell 7 modules', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
  const runner = await readFile('scripts/backup/run-powershell-script.mjs', 'utf8');
  assert.match(runner, /delete environment\.PSModulePath/u);
  assert.match(runner, /powershell\.exe/u);
  for (const name of [
    'backup:setup',
    'backup:update-password',
    'backup:run',
    'backup:verify',
    'backup:restore-test',
    'backup:restore-schedule',
    'backup:status',
    'backup:schedule',
    'backup:background',
  ]) {
    assert.match(packageJson.scripts[name], /^node scripts\/backup\/run-powershell-script\.mjs scripts\/backup\/.+\.ps1$/u);
  }
});

test('backup setup enables the schedule only after the first real backup succeeds', async () => {
  const source = await readFile('scripts/backup/setup-backup.ps1', 'utf8');
  const preflight = await readFile('scripts/backup/preflight.mjs', 'utf8');
  const firstBackup = source.indexOf('Creating and verifying the first backup now');
  const registerSchedule = source.indexOf('& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scheduleScript');
  assert.ok(firstBackup > 0);
  assert.ok(registerSchedule > firstBackup);
  assert.match(source, /daily schedule was not enabled/u);
  assert.match(preflight, /if \(!nativePgTools\)/u);
  assert.match(preflight, /process\.exitCode = 1/u);
});

test('database password updater validates before enabling the existing schedule', async () => {
  const source = await readFile('scripts/backup/update-database-password.ps1', 'utf8');
  const validate = source.indexOf('test-database-connection.ps1');
  const backup = source.indexOf('run-backup.ps1');
  const enable = source.indexOf('& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scheduleScript');
  assert.ok(validate > 0);
  assert.ok(backup > validate);
  assert.ok(enable > backup);
  assert.match(source, /previousEncryptedPassword/u);
  assert.match(source, /Disable-ScheduledTask/u);
  assert.match(source, /\[switch\]\$UseClipboard/u);
  assert.match(source, /Get-Clipboard -Raw/u);
  assert.match(source, /Set-Clipboard -Value 'Nawasrah backup password removed from clipboard\.'/u);
  assert.match(source, /The backup succeeded, but Windows could not clear the clipboard automatically/u);
});

test('schedule helper supports an unattended SYSTEM task with catch-up and bounded retries', async () => {
  const source = await readFile('scripts/backup/register-backup-schedule.ps1', 'utf8');
  assert.match(source, /Register-ScheduledTask/u);
  assert.match(source, /-StartWhenAvailable/u);
  assert.match(source, /-AllowStartIfOnBatteries/u);
  assert.match(source, /-DontStopIfGoingOnBatteries/u);
  assert.match(source, /-WakeToRun/u);
  assert.match(source, /New-ScheduledTaskTrigger -AtStartup/u);
  assert.match(source, /\$startupTrigger\.Delay = 'PT5M'/u);
  assert.match(source, /-Trigger \$triggers/u);
  assert.match(source, /-RestartCount 3/u);
  assert.match(source, /-RestartInterval/u);
  assert.match(source, /\[switch\]\$RunAsSystem/u);
  assert.match(source, /-UserId 'SYSTEM'/u);
  assert.match(source, /-LogonType ServiceAccount/u);
  assert.match(source, /-LogonType Interactive/u);
  assert.doesNotMatch(source, /RunWhenUserLoggedOff/u);
  assert.doesNotMatch(source, /-LogonType Password/u);
  assert.doesNotMatch(source, /PSCredential\]\$WindowsCredential/u);
  assert.match(source, /-Force/u);
});

test('schedule repair creates machine-protected config and status never emits backup secrets', async () => {
  const background = await readFile('scripts/backup/enable-background-backup.ps1', 'utf8');
  const status = await readFile('scripts/backup/get-backup-status.ps1', 'utf8');
  assert.doesNotMatch(background, /Get-Credential/u);
  assert.match(background, /DataProtectionScope\]::LocalMachine/u);
  assert.match(background, /config-machine\.json/u);
  assert.match(background, /Set-RestrictedConfigAcl/u);
  assert.match(background, /register-unattended-backup-tasks\.ps1/u);
  assert.match(background, /-Verb RunAs/u);
  assert.match(background, /Quarterly Restore Drill/u);
  assert.match(background, /LogonType -ne 'ServiceAccount'/u);
  assert.match(status, /actionRequired/u);
  assert.match(status, /last-backup-status\.json/u);
  assert.match(status, /-Encoding UTF8/u);
  assert.match(status, /startedAt = \$latestStatus\.startedAt/u);
  assert.match(status, /configDecryptable/u);
  assert.match(status, /machineConfigDecryptable/u);
  assert.match(status, /older than 36 hours/u);
  assert.match(status, /executionIdentity/u);
  assert.match(status, /dumpProvider/u);
  assert.match(status, /restoreDrillTask/u);
  assert.match(status, /latestRestoreDrill/u);
  assert.match(status, /last-restore-drill-status\.json/u);
  assert.match(status, /taskHasNotRunYetResult = 267011/u);
  assert.match(status, /ConvertTo-SecureString -String \$config\.archivePassphrase/u);
  assert.doesNotMatch(status, /GetNetworkCredential/u);
  assert.doesNotMatch(status, /Write-(Host|Output).*Passphrase/iu);
  assert.doesNotMatch(status, /Write-(Host|Output).*databasePassword/iu);
});

test('backup and restore runners bound every external dependency wait', async () => {
  const backup = await readFile('scripts/backup/run-backup.ps1', 'utf8');
  const restore = await readFile('scripts/backup/run-restore-drill.ps1', 'utf8');
  for (const source of [backup, restore]) {
    assert.match(source, /TimeoutSeconds = 600/u);
    assert.match(source, /within ten minutes/u);
  }
  const createBackup = await readFile('scripts/backup/create-backup.mjs', 'utf8');
  assert.match(createBackup, /NATIVE_DUMP_TIMEOUT_MS = 10 \* 60 \* 1000/u);
  assert.match(createBackup, /Native PostgreSQL dump exceeded the ten-minute safety timeout/u);
  assert.match(createBackup, /--no-role-passwords/u);
  assert.match(createBackup, /native-postgresql-17/u);
  assert.match(createBackup, /createPublicSchemaMatches\.length !== 1/u);
  assert.match(createBackup, /public schema is created by the verified restore target/u);
});

test('scheduled restore drill runs only when the previous isolated success is at least 90 days old', async () => {
  const source = await readFile('scripts/backup/run-scheduled-restore-drill.ps1', 'utf8');
  assert.match(source, /\[int\]\$MinimumDays = 90/u);
  assert.match(source, /last-restore-drill-status\.json/u);
  assert.match(source, /candidate\.ok -eq \$true/u);
  assert.match(source, /candidate\.liveSupabaseTouched -eq \$false/u);
  assert.match(source, /\$age\.TotalDays -lt \$MinimumDays/u);
  assert.match(source, /run-restore-drill\.ps1/u);
  assert.doesNotMatch(source, /SUPABASE_DB_PASSWORD/u);
  assert.doesNotMatch(source, /databasePassword/u);
});

test('public uptime monitor checks both Cloudflare applications without storing a secret', async () => {
  const source = await readFile('.github/workflows/public-uptime.yml', 'utf8');
  assert.match(source, /https:\/\/nawasrah-store\.pages\.dev\//u);
  assert.match(source, /https:\/\/nawasrah-admin\.pages\.dev\//u);
  assert.match(source, /7,37 \* \* \* \*/u);
  assert.match(source, /strict-transport-security/u);
  assert.match(source, /content-security-policy/u);
  assert.doesNotMatch(source, /(token|password|secret)\s*:/iu);
});

test('database connection check captures Docker output without nullable temporary-file reads', async () => {
  const source = await readFile('scripts/backup/test-database-connection.ps1', 'utf8');
  assert.match(source, /System\.Diagnostics\.ProcessStartInfo/u);
  assert.match(source, /RedirectStandardOutput = \$true/u);
  assert.match(source, /EnvironmentVariables\['PGPASSWORD'\]/u);
  assert.match(source, /StandardOutput\.ReadToEnd\(\)\.Trim\(\)/u);
  assert.doesNotMatch(source, /GetTempFileName/u);
  assert.doesNotMatch(source, /Output:.*databasePassword/u);
});

test('restore drill is isolated from live Supabase and always cleans up its Docker container', async () => {
  const source = await readFile('scripts/backup/restore-drill.mjs', 'utf8');
  assert.match(source, /verifyBackupArchive/u);
  assert.match(source, /'run', '--detach', '--rm'/u);
  assert.match(source, /liveSupabaseTouched: false/u);
  assert.match(source, /docker\(\['rm', '--force', containerName\]\)/u);
  assert.match(source, /rm\(resolvedTempRoot, \{ recursive: true, force: true \}\)/u);
  assert.match(source, /rolesFileVerifiedButNotApplied: true/u);
  assert.match(source, /seedAuthUserPlaceholders/u);
  assert.match(source, /authUserPlaceholdersCreated/u);
  assert.match(source, /authCredentialsRestored: false/u);
  assert.match(source, /con\.confrelid = 'auth\.users'::regclass/u);
  assert.match(source, /alter database.*owner to postgres/u);
  assert.match(source, /session_replication_role = replica/u);
  assert.match(source, /session_replication_role = origin/u);
  assert.match(source, /username: 'supabase_admin'/u);
  assert.match(source, /PostgreSQL init process complete; ready for start up\./u);
  assert.doesNotMatch(source, /SUPABASE_DB_PASSWORD/u);
  assert.doesNotMatch(source, /supabase\s+db\s+(push|reset)/iu);
  assert.doesNotMatch(source, /acjtabdqqnpwhdvbvnyw/u);
});

test('restore drill runner reads only the encrypted archive passphrase and supports moved OneDrive folders', async () => {
  const source = await readFile('scripts/backup/run-restore-drill.ps1', 'utf8');
  assert.match(source, /Get-Command ConvertTo-SecureString/u);
  assert.match(source, /Import-Module -Name Microsoft\.PowerShell\.Security -ErrorAction Stop/u);
  assert.match(source, /Find-LatestBackupArchive/u);
  assert.match(source, /Nawasrah ERP Backups/u);
  assert.match(source, /archivePassphrase/u);
  assert.match(source, /last-restore-drill-status\.json/u);
  assert.doesNotMatch(source, /databasePassword/u);
  assert.doesNotMatch(source, /SUPABASE_DB_PASSWORD/u);
});

test('backup destination updater preserves the encrypted configuration and validates its target', async () => {
  const source = await readFile('scripts/backup/update-backup-root.ps1', 'utf8');
  assert.match(source, /Test-Path -LiteralPath \$BackupRoot -PathType Container/u);
  assert.match(source, /\$config\.backupRoot = \$resolvedBackupRoot/u);
  assert.match(source, /Move-Item -LiteralPath \$temporaryConfigPath/u);
  assert.match(source, /enable-background-backup\.ps1/u);
  assert.match(source, /if \(\$LASTEXITCODE -ne 0\)/u);
  assert.doesNotMatch(source, /archivePassphrase\s*=/u);
  assert.doesNotMatch(source, /databasePassword\s*=/u);
});
