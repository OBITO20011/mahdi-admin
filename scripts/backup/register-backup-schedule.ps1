[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$RunScript,

  [Parameter(Mandatory = $true)]
  [string]$ConfigPath,

  [ValidatePattern('^([01]\d|2[0-3]):[0-5]\d$')]
  [string]$ScheduleTime = '23:30',

  [string]$TaskName = 'Nawasrah ERP Nightly Backup',

  [string]$Description = 'Encrypted daily database and product image backup for Nawasrah ERP.',

  [switch]$RunAsSystem
)

$ErrorActionPreference = 'Stop'
$schedule = [DateTime]::ParseExact($ScheduleTime, 'HH:mm', [Globalization.CultureInfo]::InvariantCulture)
$actionArguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$RunScript`" -ConfigPath `"$ConfigPath`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $actionArguments
$trigger = New-ScheduledTaskTrigger -Daily -At $schedule
$triggers = @($trigger)
if ($RunAsSystem) {
  # A machine that is fully powered off cannot be woken by Task Scheduler.
  # This delayed startup trigger provides a deterministic catch-up run after boot.
  $startupTrigger = New-ScheduledTaskTrigger -AtStartup
  # Windows PowerShell accepts -RandomDelay for -AtStartup but can silently omit it
  # from the registered task. Set the Task Scheduler ISO-8601 delay explicitly.
  $startupTrigger.Delay = 'PT5M'
  $triggers += $startupTrigger
}
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -WakeToRun `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 15) `
  -MultipleInstances IgnoreNew
$principal = if ($RunAsSystem) {
  New-ScheduledTaskPrincipal `
    -UserId 'SYSTEM' `
    -LogonType ServiceAccount `
    -RunLevel Highest
}
else {
  New-ScheduledTaskPrincipal `
    -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) `
    -LogonType Interactive `
    -RunLevel Limited
}

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $triggers `
  -Settings $settings `
  -Principal $principal `
  -Description $Description `
  -Force | Out-Null

$mode = if ($RunAsSystem) { 'unattended SYSTEM' } else { 'interactive Docker-compatible' }
Write-Host "Reliable $mode schedule created: $TaskName at $ScheduleTime" -ForegroundColor Green
Write-Host 'StartWhenAvailable, a delayed startup catch-up, and bounded retries cover missed schedules and transient failures.' -ForegroundColor Cyan
