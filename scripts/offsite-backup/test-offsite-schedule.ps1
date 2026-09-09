[CmdletBinding()]
param(
  [string]$TaskName = 'Nawasrah Offsite Backup Upload',
  [string]$ResultPath = 'C:\ProgramData\NawasrahOffsiteBackup\scheduled-run-result.json'
)
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Scheduled off-site verification must be launched from an elevated process.'
}
try {
  $before = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction Stop
  Start-ScheduledTask -TaskName $TaskName
  $deadline = (Get-Date).AddMinutes(5)
  do {
    Start-Sleep -Seconds 1
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    $info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction Stop
  } while (($task.State -eq 'Running' -or $info.LastRunTime -le $before.LastRunTime) -and (Get-Date) -lt $deadline)
  if ($task.State -eq 'Running' -or $info.LastRunTime -le $before.LastRunTime) {
    throw 'Scheduled off-site upload did not finish within five minutes.'
  }
  $registration = Get-Content -LiteralPath 'C:\ProgramData\NawasrahOffsiteBackup\registration-status.json' -Raw -Encoding UTF8 | ConvertFrom-Json
  [pscustomobject]@{
    ok = ($info.LastTaskResult -eq 0)
    taskName = $TaskName
    identity = $task.Principal.UserId
    state = [string]$task.State
    lastRunTime = $info.LastRunTime.ToUniversalTime().ToString('o')
    lastTaskResult = $info.LastTaskResult
    nextRunTime = $info.NextRunTime.ToUniversalTime().ToString('o')
    registrationOk = $registration.ok -eq $true
    verifiedAt = [DateTimeOffset]::UtcNow.ToString('o')
  } | ConvertTo-Json | Set-Content -LiteralPath $ResultPath -Encoding UTF8
  if ($info.LastTaskResult -ne 0) { throw "Scheduled off-site upload exited with code $($info.LastTaskResult)." }
  Write-Host 'Scheduled off-site upload completed under SYSTEM.' -ForegroundColor Green
}
catch {
  [pscustomobject]@{ok=$false;error=$_.Exception.Message;verifiedAt=[DateTimeOffset]::UtcNow.ToString('o')} |
    ConvertTo-Json | Set-Content -LiteralPath $ResultPath -Encoding UTF8
  throw
}
