import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('backup runner probes Docker without turning expected stderr into a fatal PowerShell error', async () => {
  const source = await readFile('scripts/backup/run-backup.ps1', 'utf8');
  assert.match(source, /function Test-DockerReady/u);
  assert.match(source, /RedirectStandardError/u);
  assert.match(source, /process\.ExitCode -eq 0/u);
  assert.doesNotMatch(source, /& \$docker\.Source info/u);
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
  ]) {
    assert.match(packageJson.scripts[name], /^node scripts\/backup\/run-powershell-script\.mjs scripts\/backup\/.+\.ps1$/u);
  }
});

test('backup setup enables the schedule only after the first real backup succeeds', async () => {
  const source = await readFile('scripts/backup/setup-backup.ps1', 'utf8');
  const firstBackup = source.indexOf('Creating and verifying the first backup now');
  const registerSchedule = source.indexOf('& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scheduleScript');
  assert.ok(firstBackup > 0);
  assert.ok(registerSchedule > firstBackup);
  assert.match(source, /daily schedule was not enabled/u);
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

test('schedule helper creates or replaces the Windows task only after it is invoked', async () => {
  const source = await readFile('scripts/backup/register-backup-schedule.ps1', 'utf8');
  assert.match(source, /Register-ScheduledTask/u);
  assert.match(source, /-StartWhenAvailable/u);
  assert.match(source, /-LogonType Interactive/u);
  assert.match(source, /-Force/u);
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
  assert.match(source, /alter database.*owner to postgres/u);
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
  assert.doesNotMatch(source, /archivePassphrase\s*=/u);
  assert.doesNotMatch(source, /databasePassword\s*=/u);
});
