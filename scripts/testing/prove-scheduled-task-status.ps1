$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\monitoring\scheduled-task-status.ps1')
$now = [DateTimeOffset]::UtcNow
foreach ($case in @(
  @{ code = 0; age = 60; expected = 'succeeded'; healthy = $true },
  @{ code = 267009; age = 60; expected = 'running'; healthy = $true },
  @{ code = 267009; age = 20000; expected = 'running_overdue'; healthy = $false },
  @{ code = 267011; age = 60; expected = 'not_run_yet'; healthy = $true },
  @{ code = 1; age = 60; expected = 'failed'; healthy = $false }
)) {
  $task = [pscustomobject]@{ LastTaskResult = $case.code; LastRunTime = $now.AddSeconds(-$case.age).UtcDateTime }
  $actual = Get-NawasrahScheduledTaskStatus -TaskInfo $task
  if ($actual.status -ne $case.expected -or $actual.healthy -ne $case.healthy) { throw "Scheduler proof failed for $($case.code)." }
}
@{ ok = $true; cases = 5; schedulerAccess = $false; secretsRead = $false } | ConvertTo-Json -Compress
