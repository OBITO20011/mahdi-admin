[CmdletBinding()]
param(
  [ValidatePattern('^([01]\d|2[0-3]):[0-5]\d$')]
  [string]$ScheduleTime = '23:30',

  [ValidateRange(2, 365)]
  [int]$RetentionCount = 30,

  [string]$BackupRoot,

  [switch]$SkipInitialBackup
)

$ErrorActionPreference = 'Stop'
if (-not (Get-Command ConvertTo-SecureString -ErrorAction SilentlyContinue)) {
  Import-Module -Name Microsoft.PowerShell.Security -ErrorAction Stop
}
$taskName = 'Nawasrah ERP Nightly Backup'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$runScript = Join-Path $PSScriptRoot 'run-backup.ps1'
$scheduleScript = Join-Path $PSScriptRoot 'enable-background-backup.ps1'
$configDirectory = Join-Path $env:LOCALAPPDATA 'NawasrahBackup'
$configPath = Join-Path $configDirectory 'config.json'

if (-not $BackupRoot) {
  $oneDriveRoot = @($env:OneDriveCommercial, $env:OneDrive, (Join-Path $env:USERPROFILE 'OneDrive')) |
    Where-Object { $_ -and (Test-Path -LiteralPath $_) } |
    Select-Object -First 1

  if ($oneDriveRoot) {
    $BackupRoot = Join-Path $oneDriveRoot 'Nawasrah ERP Backups'
  }
  else {
    $BackupRoot = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Nawasrah ERP Backups'
  }
}

Write-Host ''
Write-Host 'Nawasrah ERP - Secure automatic backup setup' -ForegroundColor Cyan
Write-Host 'Passwords are encrypted for this Windows user and are not saved in the project.'
Write-Host 'Keep the archive passphrase written in a separate safe place; it is required after Windows recovery.' -ForegroundColor Yellow
Write-Host ''

& node.exe (Join-Path $PSScriptRoot 'preflight.mjs')
if ($LASTEXITCODE -ne 0) {
  throw 'Backup preflight failed. Resolve the reported prerequisite before saving credentials.'
}
Write-Host ''

$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existingTask) {
  Disable-ScheduledTask -TaskName $taskName | Out-Null
  Write-Host 'The existing backup schedule is paused until the new credentials pass a real backup.' -ForegroundColor Yellow
  Write-Host ''
}

$databasePassword = Read-Host 'Supabase database password' -AsSecureString
$archivePassphrase = Read-Host 'Backup archive passphrase (minimum 16 characters)' -AsSecureString
$archivePassphraseConfirmation = Read-Host 'Confirm backup archive passphrase' -AsSecureString

function ConvertTo-PlainText {
  param([Parameter(Mandatory = $true)][Security.SecureString]$SecureValue)
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

$plainPassphrase = ConvertTo-PlainText -SecureValue $archivePassphrase
$plainPassphraseConfirmation = ConvertTo-PlainText -SecureValue $archivePassphraseConfirmation
try {
  if ($plainPassphrase.Length -lt 16) {
    throw 'Backup archive passphrase must contain at least 16 characters.'
  }
  if ($plainPassphrase -cne $plainPassphraseConfirmation) {
    throw 'Backup archive passphrases do not match.'
  }
}
finally {
  $plainPassphrase = $null
  $plainPassphraseConfirmation = $null
}

New-Item -ItemType Directory -Path $configDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null

$config = [ordered]@{
  formatVersion = 1
  projectRoot = $projectRoot
  backupRoot = (Resolve-Path $BackupRoot).Path
  retentionCount = $RetentionCount
  scheduleTime = $ScheduleTime
  databasePassword = ConvertFrom-SecureString -SecureString $databasePassword
  archivePassphrase = ConvertFrom-SecureString -SecureString $archivePassphrase
}
$config | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8

Write-Host ''
Write-Host 'Checking the Database password before starting the backup...' -ForegroundColor Cyan
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'test-database-connection.ps1') -ConfigPath $configPath
if ($LASTEXITCODE -ne 0) {
  throw 'Database password validation failed, so no backup or schedule was enabled. Read the specific connection error shown above.'
}

if (-not $SkipInitialBackup) {
  Write-Host ''
  Write-Host 'Creating and verifying the first backup now...' -ForegroundColor Cyan
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runScript -ConfigPath $configPath
  if ($LASTEXITCODE -ne 0) {
    throw 'The first backup failed, so the daily schedule was not enabled. Check the reported error.'
  }
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scheduleScript `
  -ConfigPath $configPath
if ($LASTEXITCODE -ne 0) {
  throw 'The first backup succeeded, but Windows could not create the unattended daily schedule.'
}

Write-Host ''
Write-Host "Backup folder: $BackupRoot"
Write-Host "Configuration: $configPath"
