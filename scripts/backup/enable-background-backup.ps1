[CmdletBinding()]
param(
  [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA 'NawasrahBackup\config.json'),

  [string]$TaskName = 'Nawasrah ERP Nightly Backup'
)

$ErrorActionPreference = 'Stop'
$scheduleScript = Join-Path $PSScriptRoot 'register-backup-schedule.ps1'
$runScript = Join-Path $PSScriptRoot 'run-backup.ps1'

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
    -RunWhenUserLoggedOff `
    -WindowsCredential $windowsCredential
}
catch {
  throw "Windows could not save the background task credential. The existing task was not intentionally removed. $($_.Exception.Message)"
}

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
if ($task.Principal.LogonType -ne 'Password') {
  throw 'Windows did not register the backup task with Password logon mode.'
}

Write-Host ''
Write-Host 'Background backup is enabled. Run backup:status to verify its state after the next schedule.' -ForegroundColor Green
