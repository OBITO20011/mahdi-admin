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
Write-Host ''
Write-Host 'Nawasrah ERP - Enable reliable scheduled backup' -ForegroundColor Cyan
Write-Host 'Docker Desktop requires an active Windows session, so these tasks run after Windows sign-in.' -ForegroundColor Yellow
Write-Host 'StartWhenAvailable makes Windows catch up after a missed scheduled time.' -ForegroundColor Yellow
Write-Host ''

try {
  & $scheduleScript `
    -RunScript $runScript `
    -ConfigPath $ConfigPath `
    -ScheduleTime $scheduleTime `
    -TaskName $TaskName `
    -Description 'Encrypted daily database and product image backup for Nawasrah ERP.'

  & $scheduleScript `
    -RunScript $scheduledRestoreDrillScript `
    -ConfigPath $ConfigPath `
    -ScheduleTime $RestoreDrillScheduleTime `
    -TaskName $RestoreDrillTaskName `
    -Description 'Runs an isolated encrypted Nawasrah ERP restore drill only when no successful drill exists in the previous 90 days.'
}
catch {
  throw "Windows could not register the reliable backup schedules. $($_.Exception.Message)"
}

foreach ($registeredTaskName in @($TaskName, $RestoreDrillTaskName)) {
  $task = Get-ScheduledTask -TaskName $registeredTaskName -ErrorAction Stop
  if ($task.Principal.LogonType -ne 'Interactive') {
    throw "Windows did not register '$registeredTaskName' with the Docker-compatible Interactive logon mode."
  }
}

Write-Host ''
Write-Host 'The nightly backup and 90-day restore drill are enabled. Run backup:status to verify their state.' -ForegroundColor Green
