function Get-NawasrahScheduledTaskStatus {
  param($TaskInfo, [double]$NormalDurationSeconds = 0, [double]$MaxRunningSeconds = 8100)
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  $nodePath = if ($node) { $node.Source } else { Join-Path $env:ProgramFiles 'nodejs\node.exe' }
  if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) { throw 'Node.js is required for task status evaluation.' }
  $inputData = @{
    task = @{
      lastTaskResult = if ($TaskInfo) { $TaskInfo.LastTaskResult } else { $null }
      lastRunTime = if ($TaskInfo) { ([DateTimeOffset]$TaskInfo.LastRunTime).ToUniversalTime().ToString('o') } else { $null }
      normalDurationSeconds = $NormalDurationSeconds
      maxRunningSeconds = $MaxRunningSeconds
    }
  } | ConvertTo-Json -Compress
  $result = $inputData | & $nodePath (Join-Path $PSScriptRoot 'scheduled-task-status.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Task status evaluation failed.' }
  return ($result | ConvertFrom-Json)
}
