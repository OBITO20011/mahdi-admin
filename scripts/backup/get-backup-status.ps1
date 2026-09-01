[CmdletBinding()]
param(
  [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA 'NawasrahBackup\config.json'),

  [string]$MachineConfigPath = (Join-Path $env:LOCALAPPDATA 'NawasrahBackup\config-machine.json'),

  [string]$TaskName = 'Nawasrah ERP Nightly Backup',

  [string]$RestoreDrillTaskName = 'Nawasrah ERP Quarterly Restore Drill'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security -ErrorAction Stop
$configFound = Test-Path -LiteralPath $ConfigPath
$backupRoot = $null
$latestStatus = $null
$latestRestoreDrillStatus = $null
$configDecryptable = $false
$machineConfigFound = Test-Path -LiteralPath $MachineConfigPath
$machineConfigDecryptable = $false
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

if ($machineConfigFound) {
  try {
    $machineConfig = Get-Content -LiteralPath $MachineConfigPath -Raw | ConvertFrom-Json
    foreach ($protectedValue in @($machineConfig.archivePassphrase, $machineConfig.databasePassword)) {
      $protectedBytes = [Convert]::FromBase64String([string]$protectedValue)
      $plainBytes = [Security.Cryptography.ProtectedData]::Unprotect(
        $protectedBytes,
        $null,
        [Security.Cryptography.DataProtectionScope]::LocalMachine
      )
      [Array]::Clear($plainBytes, 0, $plainBytes.Length)
    }
    $machineConfigDecryptable = $machineConfig.protectionScope -eq 'LocalMachine'
  }
  catch {
    $machineConfigDecryptable = $false
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
elseif (($task.Principal.UserId -notin @('SYSTEM', 'S-1-5-18')) -or ($task.Principal.LogonType -ne 'ServiceAccount')) {
  $actionRequired += 'The daily backup task is not using the unattended SYSTEM service account.'
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
if (-not $machineConfigFound) {
  $actionRequired += 'The machine-protected unattended backup configuration does not exist.'
}
elseif (-not $machineConfigDecryptable) {
  $actionRequired += 'The machine-protected backup configuration cannot be decrypted safely.'
}
if ($latestStatus -and $latestStatus.finishedAt) {
  try {
    $backupAge = [DateTimeOffset]::UtcNow - [DateTimeOffset]::Parse([string]$latestStatus.finishedAt).ToUniversalTime()
    if ($backupAge.TotalHours -gt 36) {
      $actionRequired += 'The latest successful backup is older than 36 hours.'
    }
  }
  catch {
    $actionRequired += 'The latest backup timestamp is invalid.'
  }
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
  machineConfigurationFound = $machineConfigFound
  machineConfigDecryptable = $machineConfigDecryptable
  backupRoot = $backupRoot
  task = if ($task) {
    [ordered]@{
      state = [string]$task.State
      enabled = [bool]($task.State -ne 'Disabled')
      logonType = [string]$task.Principal.LogonType
      lastRunTime = $taskInfo.LastRunTime
      nextRunTime = $taskInfo.NextRunTime
      lastTaskResult = $taskInfo.LastTaskResult
      restartCount = $task.Settings.RestartCount
      restartInterval = [string]$task.Settings.RestartInterval
    }
  } else { $null }
  latestBackup = if ($latestStatus) {
    [ordered]@{
      ok = [bool]$latestStatus.ok
      startedAt = $latestStatus.startedAt
      finishedAt = $latestStatus.finishedAt
      archivePath = $latestStatus.archivePath
      dumpProvider = $latestStatus.dumpProvider
      executionIdentity = $latestStatus.executionIdentity
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
    'The nightly backup runs as SYSTEM with native PostgreSQL tools and does not require a signed-in user.'
    'StartWhenAvailable and three bounded retries cover restart, missed schedule, and transient network failure.'
    'The isolated restore drill remains interactive because it intentionally uses Docker Desktop.'
  )
  actionRequired = $actionRequired
} | ConvertTo-Json -Depth 5
