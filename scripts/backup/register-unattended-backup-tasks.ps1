[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$MachineConfigPath,
  [Parameter(Mandatory = $true)][string]$UserConfigPath,
  [ValidatePattern('^([01]\d|2[0-3]):[0-5]\d$')][string]$ScheduleTime = '23:30',
  [ValidatePattern('^([01]\d|2[0-3]):[0-5]\d$')][string]$RestoreDrillScheduleTime = '02:17',
  [string]$TaskName = 'Nawasrah ERP Nightly Backup',
  [string]$RestoreDrillTaskName = 'Nawasrah ERP Quarterly Restore Drill'
)

$ErrorActionPreference = 'Stop'
$windowsIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$windowsPrincipal = [Security.Principal.WindowsPrincipal]::new($windowsIdentity)
$isAdministrator = $windowsPrincipal.IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $isAdministrator) {
  throw 'Administrator approval is required to register the unattended SYSTEM task.'
}
if (-not (Test-Path -LiteralPath $MachineConfigPath -PathType Leaf)) {
  throw "Machine-protected backup configuration was not found: $MachineConfigPath"
}
if (-not (Test-Path -LiteralPath $UserConfigPath -PathType Leaf)) {
  throw "User-protected backup configuration was not found: $UserConfigPath"
}

$scheduleScript = Join-Path $PSScriptRoot 'register-backup-schedule.ps1'
$runBackupScript = Join-Path $PSScriptRoot 'run-backup.ps1'
$runRestoreDrillScript = Join-Path $PSScriptRoot 'run-scheduled-restore-drill.ps1'

& $scheduleScript -RunScript $runBackupScript -ConfigPath $MachineConfigPath `
  -ScheduleTime $ScheduleTime -TaskName $TaskName `
  -Description 'Unattended encrypted daily backup for Nawasrah ERP using native PostgreSQL tools.' `
  -RunAsSystem

& $scheduleScript -RunScript $runRestoreDrillScript -ConfigPath $UserConfigPath `
  -ScheduleTime $RestoreDrillScheduleTime -TaskName $RestoreDrillTaskName `
  -Description 'Runs an isolated encrypted Nawasrah ERP restore drill only when due.'

Write-Host 'Both Nawasrah backup tasks were registered successfully.' -ForegroundColor Green
