[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$RunScript,

  [Parameter(Mandatory = $true)]
  [string]$ConfigPath,

  [ValidatePattern('^([01]\d|2[0-3]):[0-5]\d$')]
  [string]$ScheduleTime = '23:30',

  [string]$TaskName = 'Nawasrah ERP Nightly Backup',

  [string]$Description = 'Encrypted daily database and product image backup for Nawasrah ERP.'
)

$ErrorActionPreference = 'Stop'
$schedule = [DateTime]::ParseExact($ScheduleTime, 'HH:mm', [Globalization.CultureInfo]::InvariantCulture)
$actionArguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$RunScript`" -ConfigPath `"$ConfigPath`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $actionArguments
$trigger = New-ScheduledTaskTrigger -Daily -At $schedule
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -WakeToRun `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
  -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal `
  -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) `
  -LogonType Interactive `
  -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description $Description `
  -Force | Out-Null

Write-Host "Reliable Docker-compatible schedule created: $TaskName at $ScheduleTime" -ForegroundColor Green
Write-Host 'Windows will catch up after a missed time when this user next signs in.' -ForegroundColor Cyan
