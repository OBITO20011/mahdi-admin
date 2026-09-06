[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$RunScript,
  [Parameter(Mandatory = $true)][string]$ConfigPath,
  [string]$TaskName = 'Nawasrah Developer Watchdog'
)

$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  $argumentLine = @(
    '-NoLogo -NoProfile -ExecutionPolicy Bypass',
    "-File `"$($MyInvocation.MyCommand.Path)`"",
    "-RunScript `"$RunScript`"",
    "-ConfigPath `"$ConfigPath`"",
    "-TaskName `"$TaskName`""
  ) -join ' '
  $elevated = Start-Process powershell.exe -ArgumentList $argumentLine -Verb RunAs -Wait -PassThru
  exit $elevated.ExitCode
}

$statusPath = Join-Path (Split-Path -Parent $ConfigPath) 'registration-status.json'
try {
  $arguments = "-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$RunScript`" -ConfigPath `"$ConfigPath`""
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
  $intervalTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 5)
  $startupTrigger = New-ScheduledTaskTrigger -AtStartup
  $startupTrigger.Delay = 'PT3M'
  $settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 4) `
    -MultipleInstances IgnoreNew
  $taskPrincipal = New-ScheduledTaskPrincipal `
    -UserId 'SYSTEM' `
    -LogonType ServiceAccount `
    -RunLevel Highest

  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  }

  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger @($intervalTrigger, $startupTrigger) `
    -Settings $settings `
    -Principal $taskPrincipal `
    -Description 'Independent developer-only monitoring for Nawasrah infrastructure.' `
    -Force | Out-Null

  $registered = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  [pscustomobject]@{
    ok = $true
    identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    principal = $registered.Principal.UserId
    taskName = $registered.TaskName
    verifiedAt = (Get-Date).ToUniversalTime().ToString('o')
  } | ConvertTo-Json | Set-Content -LiteralPath $statusPath -Encoding UTF8
  Write-Host 'Nawasrah Developer Watchdog registered under SYSTEM every five minutes.' -ForegroundColor Green
}
catch {
  [pscustomobject]@{
    ok = $false
    identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    error = $_.Exception.Message
    verifiedAt = (Get-Date).ToUniversalTime().ToString('o')
  } | ConvertTo-Json | Set-Content -LiteralPath $statusPath -Encoding UTF8
  throw
}
