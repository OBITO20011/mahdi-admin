[CmdletBinding()]
param(
  [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA 'NawasrahBackup\config.json'),
  [string]$MachineConfigPath = (Join-Path $env:LOCALAPPDATA 'NawasrahBackup\config-machine.json'),
  [string]$PgBinPath = (Join-Path $env:LOCALAPPDATA 'NawasrahBackup\postgresql-17.11\bin'),
  [string]$TaskName = 'Nawasrah ERP Nightly Backup',
  [string]$RestoreDrillTaskName = 'Nawasrah ERP Quarterly Restore Drill',
  [ValidatePattern('^([01]\d|2[0-3]):[0-5]\d$')]
  [string]$RestoreDrillScheduleTime = '02:17'
)

$ErrorActionPreference = 'Stop'
if (-not (Get-Command ConvertTo-SecureString -ErrorAction SilentlyContinue)) {
  Import-Module -Name Microsoft.PowerShell.Security -ErrorAction Stop
}
Add-Type -AssemblyName System.Security -ErrorAction Stop
$registerTasksScript = Join-Path $PSScriptRoot 'register-unattended-backup-tasks.ps1'

function ConvertTo-PlainText {
  param([Parameter(Mandatory = $true)][Security.SecureString]$SecureValue)
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Protect-MachineValue {
  param([Parameter(Mandatory = $true)][string]$PlainValue)
  $plainBytes = [Text.Encoding]::UTF8.GetBytes($PlainValue)
  try {
    $protectedBytes = [Security.Cryptography.ProtectedData]::Protect(
      $plainBytes,
      $null,
      [Security.Cryptography.DataProtectionScope]::LocalMachine
    )
    return [Convert]::ToBase64String($protectedBytes)
  }
  finally { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
}

function Set-RestrictedConfigAcl {
  param([Parameter(Mandatory = $true)][string]$Path)
  $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
  $administrators = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
  $acl = [Security.AccessControl.FileSecurity]::new()
  $acl.SetOwner($currentUser)
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($identity in @($currentUser, $system, $administrators)) {
    $rule = [Security.AccessControl.FileSystemAccessRule]::new(
      $identity,
      [Security.AccessControl.FileSystemRights]::FullControl,
      [Security.AccessControl.AccessControlType]::Allow
    )
    $acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $Path -AclObject $acl
}

if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
  throw "Backup configuration was not found: $ConfigPath"
}
foreach ($tool in @('pg_dump.exe', 'pg_dumpall.exe', 'pg_restore.exe', 'psql.exe')) {
  if (-not (Test-Path -LiteralPath (Join-Path $PgBinPath $tool) -PathType Leaf)) {
    throw "PostgreSQL 17 native tool is missing: $tool. Read scripts/backup/README.md."
  }
}
if (-not (Test-Path -LiteralPath $registerTasksScript -PathType Leaf)) {
  throw "Unattended task registration helper was not found: $registerTasksScript"
}

$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$databasePasswordSecure = ConvertTo-SecureString -String $config.databasePassword
$archivePassphraseSecure = ConvertTo-SecureString -String $config.archivePassphrase
$databasePassword = ConvertTo-PlainText -SecureValue $databasePasswordSecure
$archivePassphrase = ConvertTo-PlainText -SecureValue $archivePassphraseSecure

try {
  $machineConfig = [ordered]@{
    formatVersion = 2
    protectionScope = 'LocalMachine'
    projectRoot = [string]$config.projectRoot
    backupRoot = [string]$config.backupRoot
    retentionCount = [int]$config.retentionCount
    scheduleTime = if ($config.scheduleTime) { [string]$config.scheduleTime } else { '23:30' }
    pgBinPath = (Resolve-Path -LiteralPath $PgBinPath).Path
    databasePassword = Protect-MachineValue -PlainValue $databasePassword
    archivePassphrase = Protect-MachineValue -PlainValue $archivePassphrase
  }
  $machineConfigDirectory = Split-Path -Parent $MachineConfigPath
  New-Item -ItemType Directory -Path $machineConfigDirectory -Force | Out-Null
  $temporaryConfigPath = "$MachineConfigPath.tmp"
  $machineConfig | ConvertTo-Json | Set-Content -LiteralPath $temporaryConfigPath -Encoding UTF8
  Move-Item -LiteralPath $temporaryConfigPath -Destination $MachineConfigPath -Force
  Set-RestrictedConfigAcl -Path $MachineConfigPath
}
finally {
  $databasePassword = $null
  $archivePassphrase = $null
}

$scheduleTime = if ($config.scheduleTime) { [string]$config.scheduleTime } else { '23:30' }
$arguments = @(
  '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
  '-File', "`"$registerTasksScript`"",
  '-MachineConfigPath', "`"$MachineConfigPath`"",
  '-UserConfigPath', "`"$ConfigPath`"",
  '-ScheduleTime', $scheduleTime,
  '-RestoreDrillScheduleTime', $RestoreDrillScheduleTime,
  '-TaskName', "`"$TaskName`"",
  '-RestoreDrillTaskName', "`"$RestoreDrillTaskName`""
)

Write-Host 'Windows will request one Administrator approval to register the unattended SYSTEM task.' -ForegroundColor Cyan
$registration = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments `
  -Verb RunAs -WindowStyle Hidden -Wait -PassThru
if ($registration.ExitCode -ne 0) {
  throw "Unattended task registration exited with code $($registration.ExitCode)."
}

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
$restoreTask = Get-ScheduledTask -TaskName $RestoreDrillTaskName -ErrorAction Stop
if (($task.Principal.UserId -notin @('SYSTEM', 'S-1-5-18')) -or ($task.Principal.LogonType -ne 'ServiceAccount')) {
  throw 'The nightly backup task was not registered as the unattended SYSTEM service account.'
}
if ($restoreTask.Principal.LogonType -ne 'Interactive') {
  throw 'The isolated Docker restore drill must remain an interactive task.'
}

Write-Host 'Unattended nightly backup is enabled without a signed-in user dependency.' -ForegroundColor Green
Write-Host 'The quarterly isolated restore drill remains interactive because it intentionally uses Docker.' -ForegroundColor Yellow
