[CmdletBinding()]
param(
  [string]$ConfigPath = 'C:\ProgramData\NawasrahOffsiteBackup\config.json',
  [string]$TaskPrefix = 'Nawasrah Offsite Backup'
)

$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Off-site Scheduled Tasks must be registered from an elevated process.'
}
$runScript = (Resolve-Path (Join-Path $PSScriptRoot 'run-offsite-backup.ps1')).Path
$taskPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew `
  -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 10)

function Register-OffsiteTask([string]$Name, [string]$Mode, $Trigger, [string]$Description) {
  $arguments = "-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runScript`" -Mode $Mode -ConfigPath `"$ConfigPath`""
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
  if (Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $Name -Confirm:$false
  }
  Register-ScheduledTask -TaskName $Name -Action $action -Trigger $Trigger -Settings $settings `
    -Principal $taskPrincipal -Description $Description -Force | Out-Null
}

$daily = New-ScheduledTaskTrigger -Daily -At '02:10'
$startup = New-ScheduledTaskTrigger -AtStartup
$startup.Delay = 'PT20M'
Register-OffsiteTask "$TaskPrefix Upload" 'Upload' @($daily, $startup) 'Uploads verified encrypted ERP and n8n backups to private Cloudflare R2.'

$weekly = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At '03:00'
Register-OffsiteTask "$TaskPrefix Weekly Verify" 'Verify' $weekly 'Downloads and verifies the newest ERP and n8n R2 objects every week.'

$restoreGate = New-ScheduledTaskTrigger -Daily -At '03:30'
Register-OffsiteTask "$TaskPrefix Restore Drill" 'RestoreDrill' $restoreGate 'Runs due-gated 90-day isolated restore drills from downloaded R2 objects.'

$tasks = @('Upload', 'Weekly Verify', 'Restore Drill') | ForEach-Object {
  $task = Get-ScheduledTask -TaskName "$TaskPrefix $_" -ErrorAction Stop
  [pscustomobject]@{ name = $task.TaskName; principal = $task.Principal.UserId; state = [string]$task.State }
}
[pscustomobject]@{
  ok = $true
  registeredAt = [DateTimeOffset]::UtcNow.ToString('o')
  tasks = $tasks
} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path (Split-Path -Parent $ConfigPath) 'registration-status.json') -Encoding UTF8
Write-Host 'Off-site backup tasks registered under SYSTEM.' -ForegroundColor Green
