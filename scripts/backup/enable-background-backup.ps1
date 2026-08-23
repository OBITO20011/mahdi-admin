[CmdletBinding()]
param(
  [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA 'NawasrahBackup\config.json'),

  [string]$TaskName = 'Nawasrah ERP Nightly Backup',

  [string]$RestoreDrillTaskName = 'Nawasrah ERP Quarterly Restore Drill',

  [ValidatePattern('^([01]\d|2[0-3]):[0-5]\d$')]
  [string]$RestoreDrillScheduleTime = '02:17'
)

$ErrorActionPreference = 'Stop'
$scheduleScript = Join-Path $PSScriptRoot 'register-backup-schedule.ps1'
$runScript = Join-Path $PSScriptRoot 'run-backup.ps1'
$scheduledRestoreDrillScript = Join-Path $PSScriptRoot 'run-scheduled-restore-drill.ps1'

if (-not (Test-Path -LiteralPath $ConfigPath)) {
  throw "Backup configuration was not found: $ConfigPath"
}

$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$scheduleTime = if ($config.scheduleTime) { [string]$config.scheduleTime } else { '23:30' }
$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name

Write-Host ''
Write-Host 'Nawasrah ERP - Enable unattended nightly backup' -ForegroundColor Cyan
Write-Host 'Enter this Windows account password only in the secure Windows prompt.' -ForegroundColor Yellow
Write-Host 'It is stored by Windows Task Scheduler, not in the project or backup configuration.' -ForegroundColor Yellow
Write-Host ''

$windowsCredential = Get-Credential `
  -UserName $currentUser `
  -Message 'Windows account used to run Nawasrah ERP backup while signed out'

if (-not $windowsCredential) {
  throw 'Background backup setup was cancelled before any task was changed.'
}

try {
  # Keep the PSCredential in this PowerShell process. Passing it to a child
  # powershell.exe process can degrade the account identity to plain text and
  # makes Task Scheduler reject the Windows account SID mapping.
  & $scheduleScript `
    -RunScript $runScript `
    -ConfigPath $ConfigPath `
    -ScheduleTime $scheduleTime `
    -TaskName $TaskName `
    -Description 'Encrypted daily database and product image backup for Nawasrah ERP.' `
    -RunWhenUserLoggedOff `
    -WindowsCredential $windowsCredential

  & $scheduleScript `
    -RunScript $scheduledRestoreDrillScript `
    -ConfigPath $ConfigPath `
    -ScheduleTime $RestoreDrillScheduleTime `
    -TaskName $RestoreDrillTaskName `
    -Description 'Runs an isolated encrypted Nawasrah ERP restore drill only when no successful drill exists in the previous 90 days.' `
    -RunWhenUserLoggedOff `
    -WindowsCredential $windowsCredential
}
catch {
  throw "Windows could not save the background task credential. The existing task was not intentionally removed. $($_.Exception.Message)"
}

foreach ($registeredTaskName in @($TaskName, $RestoreDrillTaskName)) {
  $task = Get-ScheduledTask -TaskName $registeredTaskName -ErrorAction Stop
  if ($task.Principal.LogonType -ne 'Password') {
    throw "Windows did not register '$registeredTaskName' with Password logon mode."
  }
}

Write-Host ''
Write-Host 'Background backup and the 90-day restore drill are enabled. Run backup:status to verify their state.' -ForegroundColor Green
