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

  [switch]$RunWhenUserLoggedOff,

  [System.Management.Automation.PSCredential]$WindowsCredential
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
if ($RunWhenUserLoggedOff) {
  if (-not $WindowsCredential) {
    throw 'A Windows credential is required to run the backup while the user is signed out.'
  }

  $plainWindowsPassword = $WindowsCredential.GetNetworkCredential().Password
  if ([string]::IsNullOrWhiteSpace($plainWindowsPassword)) {
    throw 'The Windows credential does not contain a password.'
  }

  $principal = New-ScheduledTaskPrincipal `
    -UserId $WindowsCredential.UserName `
    -LogonType Password `
    -RunLevel Limited
  $task = New-ScheduledTask `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description $Description

  try {
    # Task Scheduler encrypts this credential in Windows. It is never written
    # to the repository or the backup configuration file.
    Register-ScheduledTask `
      -TaskName $TaskName `
      -InputObject $task `
      -User $WindowsCredential.UserName `
      -Password $plainWindowsPassword `
      -Force | Out-Null
  }
  finally {
    $plainWindowsPassword = $null
  }

  Write-Host "Background schedule created: $TaskName at $ScheduleTime" -ForegroundColor Green
  Write-Host 'It can run while this Windows user is signed out, subject to Docker Desktop being available.' -ForegroundColor Cyan
  return
}

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

Write-Host "Interactive schedule created and enabled: $TaskName at $ScheduleTime" -ForegroundColor Green
