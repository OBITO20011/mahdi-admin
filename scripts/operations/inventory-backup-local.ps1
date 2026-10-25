[CmdletBinding()]
param([string]$ReportPath)
$ErrorActionPreference = 'Stop'
# Read-only inventory. Never execute tasks or decrypt credentials; project refs are public.
function Read-Projection([string]$File, [string[]]$Fields) {
  if (!(Test-Path -LiteralPath $File)) { return @{ path=$File; exists=$false } }
  $value=Get-Content -LiteralPath $File -Raw -Encoding UTF8 | ConvertFrom-Json
  $result=[ordered]@{path=$File;exists=$true;modifiedAt=(Get-Item -LiteralPath $File).LastWriteTimeUtc.ToString('o')}
  foreach($field in $Fields) { $result[$field]=$value.$field }
  return $result
}
$taskNames=@('Nawasrah Docker Safe Startup','Nawasrah ERP Nightly Backup','Nawasrah ERP Quarterly Restore Drill','Nawasrah Developer Watchdog','Nawasrah Offsite Backup Upload','Nawasrah Offsite Backup Weekly Verify','Nawasrah Offsite Backup Restore Drill','Nawasrah n8n Daily Backup')
$service=New-Object -ComObject 'Schedule.Service'; $service.Connect()
$tasks=@(foreach($name in $taskNames) {
  try {
    $task=$service.GetFolder('\').GetTask($name)
    [xml]$xml=$task.Xml
    [ordered]@{name=$name;visibility='readable';lastRunAt=$task.LastRunTime.ToString('o');nextRunAt=$task.NextRunTime.ToString('o');result=$task.LastTaskResult;principal=$xml.Task.Principals.Principal.UserId;scriptPaths=@([regex]::Matches($task.Xml,'[A-Za-z]:\\[^"<>]*?\.(?:ps1|mjs)') | ForEach-Object Value)}
  } catch { [ordered]@{name=$name;visibility='unreadable';hresult=('{0:X8}' -f $_.Exception.HResult);notEvidenceOfAbsence=$true} }
})
$bk=Get-Content "$env:LOCALAPPDATA\NawasrahBackup\config-machine.json" -Raw|ConvertFrom-Json
$statusFields=@('ok','finishedAt','completedAt','createdAt','lastUploadAt','lastDownloadVerifiedAt','lastRestoreVerifiedAt','remoteVerified','remoteRestoreVerified','restoreVerified','storageObjectCount','archiveBytes')
$statuses=@(
  (Read-Projection (Join-Path $bk.backupRoot 'last-backup-status.json') $statusFields)
  (Read-Projection (Join-Path $bk.backupRoot 'last-restore-drill-status.json') $statusFields)
  (Read-Projection 'C:\ProgramData\NawasrahOffsiteBackup\erp-status.json' $statusFields)
  (Read-Projection 'C:\ProgramData\NawasrahOffsiteBackup\n8n-status.json' $statusFields)
  (Read-Projection 'C:\ProgramData\NawasrahN8nBackup\last-status.json' $statusFields)
  (Read-Projection 'C:\ProgramData\NawasrahDockerRecovery\last-status.json' @('result','stage','startedAt','completedAt','dockerServerVersion','n8nHealth'))
  (Read-Projection 'C:\ProgramData\NawasrahDeveloperMonitoring\incidents.json' @('updatedAt'))
)
$monitor=Get-Content 'C:\ProgramData\NawasrahDeveloperMonitoring\config.json' -Raw|ConvertFrom-Json
$report=[ordered]@{formatVersion=1;observedAt=[DateTimeOffset]::UtcNow.ToString('o');hostedConnectionsMade=$false;credentialsDecrypted=$false;tasks=$tasks;statuses=$statuses;legacyBackupRoot=$bk.backupRoot;legacyRepository=$bk.projectRoot;dailySupabaseChecksEnabled=($monitor.supabaseDailyChecksEnabled -eq $true);dockerExit=@{decimal=3221225786;hex='C000013A';interpretation='process interrupted; last startup log reached Docker ready; terminating actor unproven'};limitations=@('Task ACL may hide SYSTEM tasks: access denied is not missing','No remote task, GitHub schedule, R2 object or database state verified')}
$json=$report|ConvertTo-Json -Depth 10
if($ReportPath) { $json|Set-Content -LiteralPath $ReportPath -Encoding UTF8 } else { $json }
