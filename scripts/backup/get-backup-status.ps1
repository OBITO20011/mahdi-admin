[CmdletBinding()]
param(
  [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA 'NawasrahBackup\config.json'),

  [string]$TaskName = 'Nawasrah ERP Nightly Backup',

  [string]$RestoreDrillTaskName = 'Nawasrah ERP Quarterly Restore Drill'
)

$ErrorActionPreference = 'Stop'
$configFound = Test-Path -LiteralPath $ConfigPath
$backupRoot = $null
$latestStatus = $null
$latestRestoreDrillStatus = $null
$configDecryptable = $false
$executionIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name

if ($configFound) {
  $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
  $backupRoot = [string]$config.backupRoot
  try {
    # This only asks Windows DPAPI whether the encrypted values belong to the
    # current Windows account. No clear-text secret is read or emitted.
    $null = ConvertTo-SecureString -String $config.archivePassphrase -ErrorAction Stop
    $null = ConvertTo-SecureString -String $config.databasePassword -ErrorAction Stop
    $configDecryptable = $true
  }
  catch {
    $configDecryptable = $false
  }
  $statusPath = Join-Path $backupRoot 'last-backup-status.json'
  if (Test-Path -LiteralPath $statusPath) {
    try {
      $latestStatus = Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    catch {
      $latestStatus = $null
    }
  }
  $restoreDrillStatusPath = Join-Path $backupRoot 'last-restore-drill-status.json'
  if (Test-Path -LiteralPath $restoreDrillStatusPath) {
    try {
      $latestRestoreDrillStatus = Get-Content -LiteralPath $restoreDrillStatusPath -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    catch {
      $latestRestoreDrillStatus = $null
    }
  }
}

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$taskInfo = if ($task) { Get-ScheduledTaskInfo -TaskName $TaskName } else { $null }
$restoreDrillTask = Get-ScheduledTask -TaskName $RestoreDrillTaskName -ErrorAction SilentlyContinue
$restoreDrillTaskInfo = if ($restoreDrillTask) { Get-ScheduledTaskInfo -TaskName $RestoreDrillTaskName } else { $null }
$actionRequired = @()

if (-not $configFound) {
  $actionRequired += 'Backup setup has not been completed.'
}
if (-not $task) {
  $actionRequired += 'The daily backup task does not exist.'
}
if ($taskInfo -and $taskInfo.LastTaskResult -ne 0) {
  $actionRequired += 'The latest Windows task attempt did not return 0. Review backup.log.'
}
if ($latestStatus -and $latestStatus.ok -ne $true) {
  $actionRequired += 'The latest backup report was not successful. Review backup.log before relying on it.'
}
if ($configFound -and -not $configDecryptable) {
  $actionRequired += 'This Windows account cannot decrypt the protected backup configuration. Run this command from the same Windows account that created the backup setup.'
}
if (-not $restoreDrillTask) {
  $actionRequired += 'The 90-day restore drill task does not exist. Run backup:schedule once to create it.'
}
# 267011 (0x41303) is the documented Task Scheduler result for a newly
# registered task that has not run yet. A manual restore report can already be
# valid at that point, so it must not be presented as a failed scheduled run.
$taskHasNotRunYetResult = 267011
if ($restoreDrillTaskInfo -and $restoreDrillTaskInfo.LastTaskResult -notin @(0, $taskHasNotRunYetResult)) {
  $actionRequired += 'The latest restore drill task attempt did not return 0. Review restore-drill-runner.log.'
}
if (-not $latestRestoreDrillStatus) {
  $actionRequired += 'No restore drill report exists yet. Run backup:restore-test once now to verify recovery safely.'
}
elseif ($latestRestoreDrillStatus.ok -ne $true -or $latestRestoreDrillStatus.liveSupabaseTouched -ne $false) {
  $actionRequired += 'The latest restore drill was not a verified isolated success. Review last-restore-drill-status.json.'
}

[ordered]@{
  ok = ($actionRequired.Count -eq 0)
  executionIdentity = $executionIdentity
  configurationFound = $configFound
  configDecryptable = $configDecryptable
  backupRoot = $backupRoot
  task = if ($task) {
    [ordered]@{
      state = [string]$task.State
      enabled = [bool]($task.State -ne 'Disabled')
      logonType = [string]$task.Principal.LogonType
      lastRunTime = $taskInfo.LastRunTime
      nextRunTime = $taskInfo.NextRunTime
      lastTaskResult = $taskInfo.LastTaskResult
    }
  } else { $null }
  latestBackup = if ($latestStatus) {
    [ordered]@{
      ok = [bool]$latestStatus.ok
      startedAt = $latestStatus.startedAt
      finishedAt = $latestStatus.finishedAt
      archivePath = $latestStatus.archivePath
    }
  } else { $null }
  restoreDrillTask = if ($restoreDrillTask) {
    [ordered]@{
      state = [string]$restoreDrillTask.State
      enabled = [bool]($restoreDrillTask.State -ne 'Disabled')
      logonType = [string]$restoreDrillTask.Principal.LogonType
      lastRunTime = $restoreDrillTaskInfo.LastRunTime
      nextRunTime = $restoreDrillTaskInfo.NextRunTime
      lastTaskResult = $restoreDrillTaskInfo.LastTaskResult
    }
  } else { $null }
  latestRestoreDrill = if ($latestRestoreDrillStatus) {
    [ordered]@{
      ok = [bool]$latestRestoreDrillStatus.ok
      completedAt = $latestRestoreDrillStatus.completedAt
      liveSupabaseTouched = [bool]$latestRestoreDrillStatus.liveSupabaseTouched
      archiveName = $latestRestoreDrillStatus.archiveName
      durationSeconds = $latestRestoreDrillStatus.durationSeconds
    }
  } else { $null }
  operationalNotes = @(
    'Docker Desktop requires an active Windows session. Interactive task logon is intentional.'
    'StartWhenAvailable catches up after the computer was off or the user was signed out at the planned time.'
  )
  actionRequired = $actionRequired
} | ConvertTo-Json -Depth 5
