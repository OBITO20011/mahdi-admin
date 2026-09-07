[CmdletBinding()]
param(
  [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA 'NawasrahBackup\config-machine.json'),
  [string]$StatusRoot = 'C:\ProgramData\NawasrahN8nBackup'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security -ErrorAction Stop
$automationRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$environmentPath = Join-Path $automationRoot '.env'
$feedEnvironmentPath = Join-Path $automationRoot '.env.feed'
$channelEnvironmentPath = Join-Path $automationRoot '.env.channels'
$temporaryRoot = Join-Path (Join-Path $StatusRoot 'work') "nawasrah-n8n-$([Guid]::NewGuid().ToString('N'))"
$rawArchive = Join-Path $temporaryRoot 'n8n-backup.tgz'
$verifiedArchive = Join-Path $temporaryRoot 'n8n-backup-verified.tgz'
$restoreRoot = Join-Path $temporaryRoot 'restore'
$partialArchive = $null
$archivePassphrase = $null
$lockHandle = $null
$startedAt = (Get-Date).ToUniversalTime()
$logRoot = Join-Path $StatusRoot 'logs'
$logPath = Join-Path $logRoot ("backup-{0}.log" -f (Get-Date).ToString('yyyyMMdd'))
$statusPath = Join-Path $StatusRoot 'last-status.json'

function ConvertTo-PlainText {
  param([Parameter(Mandatory = $true)][Security.SecureString]$SecureValue)
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Unprotect-MachineValue {
  param([Parameter(Mandatory = $true)][string]$ProtectedValue)
  $protectedBytes = [Convert]::FromBase64String($ProtectedValue)
  $plainBytes = [Security.Cryptography.ProtectedData]::Unprotect(
    $protectedBytes,
    $null,
    [Security.Cryptography.DataProtectionScope]::LocalMachine
  )
  try { return [Text.Encoding]::UTF8.GetString($plainBytes) }
  finally { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
}

function Write-BackupLog {
  param([Parameter(Mandatory = $true)][string]$Level, [Parameter(Mandatory = $true)][string]$Message)
  "$(Get-Date -Format o)`t$Level`t$Message" | Add-Content -LiteralPath $logPath -Encoding UTF8
}

function Write-BackupStatus {
  param([Parameter(Mandatory = $true)][hashtable]$Status)
  $temporaryStatus = "$statusPath.tmp"
  $Status | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $temporaryStatus -Encoding UTF8
  Move-Item -LiteralPath $temporaryStatus -Destination $statusPath -Force
}

function Assert-DockerReady {
  & docker.exe info --format '{{.ServerVersion}}' *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Docker Server is unavailable.' }
  $health = (& docker.exe inspect --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' nawasrah-n8n 2>$null)
  if ($LASTEXITCODE -ne 0 -or $health -ne 'running|healthy') {
    throw 'n8n container is not running and healthy.'
  }
}

function Get-SafeDiagnostic {
  param([object[]]$Output)
  $text = (($Output | ForEach-Object { [string]$_ }) -join ' ').Trim()
  $text = $text -replace '(?i)(key|token|secret|password)(\s*[=:]\s*)\S+', '$1$2[REDACTED]'
  if ($text.Length -gt 1000) { return $text.Substring(0, 1000) }
  return $text
}

try {
  New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
  $lockPath = Join-Path $StatusRoot 'backup.lock'
  try {
    $lockHandle = [IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None')
  }
  catch {
    Write-BackupLog -Level 'SKIPPED' -Message 'Another n8n backup instance owns the lock.'
    exit 0
  }

  Write-BackupLog -Level 'STARTED' -Message 'Scheduled n8n backup started.'
  if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    throw "Encrypted backup configuration was not found: $ConfigPath"
  }
  foreach ($protectedPath in @($environmentPath, $feedEnvironmentPath, $channelEnvironmentPath)) {
    if (-not (Test-Path -LiteralPath $protectedPath -PathType Leaf)) {
      throw 'A protected n8n configuration file is unavailable.'
    }
  }

  $config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($config.protectionScope -eq 'LocalMachine') {
    $archivePassphrase = Unprotect-MachineValue -ProtectedValue $config.archivePassphrase
  }
  else {
    $securePassphrase = ConvertTo-SecureString -String $config.archivePassphrase
    $archivePassphrase = ConvertTo-PlainText -SecureValue $securePassphrase
  }
  $backupRoot = [string]$config.backupRoot
  $retentionCount = [int]$config.retentionCount
  if ([string]::IsNullOrWhiteSpace($backupRoot)) { throw 'Backup root is not configured.' }
  if ($retentionCount -lt 2 -or $retentionCount -gt 365) { throw 'Backup retention must be between 2 and 365 archives.' }

  Assert-DockerReady
  New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
  New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null
  New-Item -ItemType Directory -Path $restoreRoot -Force | Out-Null

  $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $archivePath = Join-Path $backupRoot "nawasrah-n8n-$timestamp.nwb"
  $partialArchive = "$archivePath.partial"

  $archiveOutput = & docker.exe run --rm `
    --volume nawasrah_n8n_data:/source/n8n-data:ro `
    --volume nawasrah_n8n_files:/source/n8n-files:ro `
    --volume "${environmentPath}:/source/config/n8n.env:ro" `
    --volume "${feedEnvironmentPath}:/source/config/feed.env:ro" `
    --volume "${channelEnvironmentPath}:/source/config/channels.env:ro" `
    --volume "${temporaryRoot}:/backup" `
    alpine:3.21 `
    tar -czf /backup/n8n-backup.tgz -C /source n8n-data n8n-files config 2>&1
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $rawArchive)) {
    $safeDiagnostic = Get-SafeDiagnostic -Output $archiveOutput
    Write-BackupLog -Level 'ARCHIVE_FAILED' -Message "Docker archive failed: $safeDiagnostic"
    throw 'Could not create the temporary n8n archive.'
  }

  $env:NAWASRAH_BACKUP_INPUT = $rawArchive
  $env:NAWASRAH_BACKUP_OUTPUT = $partialArchive
  $env:NAWASRAH_BACKUP_VERIFY = $verifiedArchive
  $env:NAWASRAH_BACKUP_PASSPHRASE = $archivePassphrase
  & node.exe (Join-Path $automationRoot 'encrypt-backup.mjs')
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $partialArchive)) {
    throw 'Could not encrypt and verify the n8n backup archive.'
  }

  $env:NAWASRAH_N8N_RESTORE_INPUT = $partialArchive
  $env:NAWASRAH_N8N_RESTORE_OUTPUT = (Join-Path $temporaryRoot 'restore.tgz')
  & node.exe (Join-Path $automationRoot 'decrypt-backup.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Could not decrypt the n8n backup for restore verification.' }
  & docker.exe run --rm --network none `
    --volume "${temporaryRoot}:/drill" `
    alpine:3.21 `
    sh -c 'mkdir -p /drill/restore && tar -xzf /drill/restore.tgz -C /drill/restore && test -s /drill/restore/n8n-data/database.sqlite && test -f /drill/restore/config/n8n.env && test -f /drill/restore/config/feed.env && test -f /drill/restore/config/channels.env'
  if ($LASTEXITCODE -ne 0) { throw 'The isolated n8n restore archive is incomplete.' }

  $n8nImageLine = Get-Content -LiteralPath $environmentPath -Encoding UTF8 |
    Where-Object { $_ -match '^N8N_IMAGE=' } | Select-Object -First 1
  $n8nImage = if ($n8nImageLine) { ($n8nImageLine -split '=', 2)[1].Trim() } else { 'docker.n8n.io/n8nio/n8n:stable' }
  $restoreCliOutput = & docker.exe run --rm --network none `
    --user root `
    --env N8N_USER_FOLDER=/home/node `
    --env-file (Join-Path $restoreRoot 'config\n8n.env') `
    --volume "$(Join-Path $restoreRoot 'n8n-data'):/home/node/.n8n" `
    --volume "$(Join-Path $restoreRoot 'n8n-files'):/home/node/.n8n-files" `
    $n8nImage `
    export:workflow --all --output=/tmp/restored-workflows.json 2>&1
  if ($LASTEXITCODE -ne 0) {
    $safeDiagnostic = Get-SafeDiagnostic -Output $restoreCliOutput
    Write-BackupLog -Level 'RESTORE_FAILED' -Message "n8n CLI restore verification failed: $safeDiagnostic"
    throw 'The restored n8n database could not be opened by n8n.'
  }

  Move-Item -LiteralPath $partialArchive -Destination $archivePath
  $partialArchive = $null
  $archiveInfo = Get-Item -LiteralPath $archivePath
  $hash = Get-FileHash -LiteralPath $archivePath -Algorithm SHA256

  Get-ChildItem -LiteralPath $backupRoot -Filter 'nawasrah-n8n-*.nwb' -File |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -Skip $retentionCount |
    Remove-Item -Force
  Get-ChildItem -LiteralPath $logRoot -Filter 'backup-*.log' -File |
    Where-Object { $_.LastWriteTimeUtc -lt (Get-Date).ToUniversalTime().AddDays(-30) } |
    Remove-Item -Force

  $finishedAt = (Get-Date).ToUniversalTime()
  Write-BackupStatus -Status @{
    version = 1
    ok = $true
    archiveName = $archiveInfo.Name
    archivePath = $archiveInfo.FullName
    archiveBytes = $archiveInfo.Length
    sha256 = $hash.Hash
    retentionCount = $retentionCount
    restoreVerified = $true
    liveVolumesModified = $false
    startedAt = $startedAt.ToString('o')
    finishedAt = $finishedAt.ToString('o')
  }
  Write-BackupLog -Level 'SUCCESS' -Message "Encrypted archive published; isolated restore verified; bytes=$($archiveInfo.Length)."
  Write-Host "Encrypted n8n backup verified: $($archiveInfo.Name)" -ForegroundColor Green
}
catch {
  New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
  $safeFailure = Get-SafeDiagnostic -Output @($_.Exception.Message)
  Write-BackupStatus -Status @{
    version = 1
    ok = $false
    restoreVerified = $false
    liveVolumesModified = $false
    startedAt = $startedAt.ToString('o')
    finishedAt = (Get-Date).ToUniversalTime().ToString('o')
    error = $safeFailure
  }
  Write-BackupLog -Level 'FAILED' -Message $safeFailure
  throw
}
finally {
  foreach ($name in @(
    'NAWASRAH_BACKUP_INPUT', 'NAWASRAH_BACKUP_OUTPUT',
    'NAWASRAH_BACKUP_VERIFY', 'NAWASRAH_BACKUP_PASSPHRASE',
    'NAWASRAH_N8N_RESTORE_INPUT', 'NAWASRAH_N8N_RESTORE_OUTPUT'
  )) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
  if ($partialArchive) { Remove-Item -LiteralPath $partialArchive -Force -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
  $archivePassphrase = $null
  if ($lockHandle) { $lockHandle.Dispose() }
}
