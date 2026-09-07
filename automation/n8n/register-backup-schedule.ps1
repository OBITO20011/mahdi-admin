[CmdletBinding()]
param(
  [string]$TaskName = 'Nawasrah n8n Daily Backup',
  [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA 'NawasrahBackup\config-machine.json'),
  [string]$StatusRoot = 'C:\ProgramData\NawasrahN8nBackup',
  [string]$ScheduleTime = '01:30'
)

$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  $arguments = @(
    '-NoLogo -NoProfile -ExecutionPolicy Bypass',
    "-File `"$($MyInvocation.MyCommand.Path)`"",
    "-TaskName `"$TaskName`"",
    "-ConfigPath `"$ConfigPath`"",
    "-StatusRoot `"$StatusRoot`"",
    "-ScheduleTime `"$ScheduleTime`""
  ) -join ' '
  $elevated = Start-Process powershell.exe -ArgumentList $arguments -Verb RunAs -Wait -PassThru
  exit $elevated.ExitCode
}

if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
  throw "Machine-protected backup configuration was not found: $ConfigPath"
}
$config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($config.protectionScope -ne 'LocalMachine') {
  throw 'The scheduled n8n backup requires a LocalMachine DPAPI configuration.'
}

New-Item -ItemType Directory -Path (Join-Path $StatusRoot 'logs') -Force | Out-Null
$acl = New-Object Security.AccessControl.DirectorySecurity
$inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
$propagation = [Security.AccessControl.PropagationFlags]::None
foreach ($account in @('NT AUTHORITY\SYSTEM', 'BUILTIN\Administrators', $identity.Name)) {
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
    $account, 'FullControl', $inherit, $propagation, 'Allow'
  ))
}
Set-Acl -LiteralPath $StatusRoot -AclObject $acl

$runScript = Join-Path $PSScriptRoot 'backup.ps1'
$actionArgs = "-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runScript`" -ConfigPath `"$ConfigPath`" -StatusRoot `"$StatusRoot`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $actionArgs
$daily = New-ScheduledTaskTrigger -Daily -At $ScheduleTime
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
  -MultipleInstances IgnoreNew
$taskPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $daily `
  -Settings $settings `
  -Principal $taskPrincipal `
  -Description 'Daily encrypted n8n backup with isolated restore verification.' `
  -Force | Out-Null

[pscustomobject]@{
  ok = $true
  taskName = $TaskName
  principal = 'SYSTEM'
  schedule = $ScheduleTime
  startWhenAvailable = $true
  registeredAt = (Get-Date).ToUniversalTime().ToString('o')
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $StatusRoot 'registration-status.json') -Encoding UTF8

Write-Host 'Nawasrah n8n Daily Backup registered under SYSTEM.' -ForegroundColor Green
