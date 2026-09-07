[CmdletBinding()]
param(
  [string]$TaskName = 'Nawasrah n8n Daily Backup',
  [string]$StatusRoot = 'C:\ProgramData\NawasrahN8nBackup'
)

$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  $arguments = @(
    '-NoLogo -NoProfile -ExecutionPolicy Bypass',
    "-File `"$($MyInvocation.MyCommand.Path)`"",
    "-TaskName `"$TaskName`"",
    "-StatusRoot `"$StatusRoot`""
  ) -join ' '
  $elevated = Start-Process powershell.exe -ArgumentList $arguments -Verb RunAs -Wait -PassThru
  exit $elevated.ExitCode
}

$resultPath = Join-Path $StatusRoot 'scheduled-run-result.json'
$startedAt = (Get-Date).ToUniversalTime()
try {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  if ($task.Principal.UserId -ne 'SYSTEM') { throw 'The n8n backup task is not registered under SYSTEM.' }
  Start-ScheduledTask -TaskName $TaskName
  $deadline = (Get-Date).AddMinutes(20)
  do {
    Start-Sleep -Seconds 2
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  } while ($task.State -eq 'Running' -and (Get-Date) -lt $deadline)
  if ($task.State -eq 'Running') { throw 'The scheduled n8n backup exceeded twenty minutes.' }
  $info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction Stop
  if ($info.LastTaskResult -ne 0) { throw "The scheduled n8n backup exited with code $($info.LastTaskResult)." }
  [pscustomobject]@{
    ok = $true
    taskName = $TaskName
    principal = $task.Principal.UserId
    lastTaskResult = $info.LastTaskResult
    lastRunTime = $info.LastRunTime.ToUniversalTime().ToString('o')
    nextRunTime = $info.NextRunTime.ToUniversalTime().ToString('o')
    startedAt = $startedAt.ToString('o')
    finishedAt = (Get-Date).ToUniversalTime().ToString('o')
  } | ConvertTo-Json | Set-Content -LiteralPath $resultPath -Encoding UTF8
}
catch {
  [pscustomobject]@{
    ok = $false
    taskName = $TaskName
    error = $_.Exception.Message
    startedAt = $startedAt.ToString('o')
    finishedAt = (Get-Date).ToUniversalTime().ToString('o')
  } | ConvertTo-Json | Set-Content -LiteralPath $resultPath -Encoding UTF8
  throw
}
