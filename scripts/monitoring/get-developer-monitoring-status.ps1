[CmdletBinding()]
param(
  [string]$ConfigPath = 'C:\ProgramData\NawasrahDeveloperMonitoring\config.json',
  [string]$TaskName = 'Nawasrah Developer Watchdog'
)

$monitorRoot = Split-Path -Parent $ConfigPath
$statePath = Join-Path $monitorRoot 'incidents.json'
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$taskInfo = if ($task) { Get-ScheduledTaskInfo -TaskName $TaskName } else { $null }
$state = if (Test-Path -LiteralPath $statePath -PathType Leaf) {
  try { Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json }
  catch { $null }
} else { $null }
$activeIncidents = if ($state -and $state.incidents) {
  @($state.incidents.psobject.Properties | Where-Object { $_.Value.active -eq $true } | ForEach-Object {
    [ordered]@{
      eventKey = $_.Name
      severity = $_.Value.severity
      source = $_.Value.source
      firstObservedAt = $_.Value.firstObservedAt
      lastNotifiedAt = $_.Value.lastNotifiedAt
    }
  })
} else { @() }

[ordered]@{
  configured = Test-Path -LiteralPath $ConfigPath -PathType Leaf
  task = if ($task) {
    [ordered]@{
      state = [string]$task.State
      runAs = [string]$task.Principal.UserId
      lastRunTime = $taskInfo.LastRunTime.ToString('o')
      nextRunTime = $taskInfo.NextRunTime.ToString('o')
      lastTaskResult = $taskInfo.LastTaskResult
    }
  } else { $null }
  stateUpdatedAt = if ($state) { $state.updatedAt } else { $null }
  activeIncidents = $activeIncidents
} | ConvertTo-Json -Depth 6
