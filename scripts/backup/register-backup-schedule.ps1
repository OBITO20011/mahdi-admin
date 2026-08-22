[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$RunScript,

  [Parameter(Mandatory = $true)]
  [string]$ConfigPath,

  [ValidatePattern('^([01]\d|2[0-3]):[0-5]\d$')]
  [string]$ScheduleTime = '23:30',

  [string]$TaskName = 'Nawasrah ERP Nightly Backup'
)

$ErrorActionPreference = 'Stop'
$schedule = [DateTime]::ParseExact($ScheduleTime, 'HH:mm', [Globalization.CultureInfo]::InvariantCulture)
$actionArguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$RunScript`" -ConfigPath `"$ConfigPath`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $actionArguments
$trigger = New-ScheduledTaskTrigger -Daily -At $schedule
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
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
  -Description 'Encrypted daily database and product image backup for Nawasrah ERP.' `
  -Force | Out-Null

Write-Host "Scheduled task created and enabled: $TaskName at $ScheduleTime" -ForegroundColor Green
