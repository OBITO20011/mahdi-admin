[CmdletBinding()]
param(
  [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA 'NawasrahBackup\config.json'),

  [string]$TaskName = 'Nawasrah ERP Nightly Backup'
)

$ErrorActionPreference = 'Stop'
$configFound = Test-Path -LiteralPath $ConfigPath
$backupRoot = $null
$latestStatus = $null
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
}

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$taskInfo = if ($task) { Get-ScheduledTaskInfo -TaskName $TaskName } else { $null }
$actionRequired = @()

if (-not $configFound) {
  $actionRequired += 'Backup setup has not been completed.'
}
if (-not $task) {
  $actionRequired += 'The daily backup task does not exist.'
}
elseif ($task.Principal.LogonType -eq 'Interactive') {
  $actionRequired += 'The task runs only after Windows sign-in. Run backup:background for signed-out operation.'
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
  actionRequired = $actionRequired
} | ConvertTo-Json -Depth 5
