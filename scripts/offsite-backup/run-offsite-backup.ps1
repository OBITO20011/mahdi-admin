[CmdletBinding()]
param(
  [ValidateSet('Probe', 'Upload', 'Verify', 'RestoreDrill')][string]$Mode = 'Upload',
  [string]$ConfigPath = 'C:\ProgramData\NawasrahOffsiteBackup\config.json',
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security -ErrorAction Stop
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$statusRoot = Split-Path -Parent $ConfigPath
$logRoot = Join-Path $statusRoot 'logs'
$logPath = Join-Path $logRoot ("offsite-{0}.log" -f (Get-Date).ToString('yyyyMMdd'))
$lockHandle = $null
$accessKeyId = $null
$secretAccessKey = $null
$archivePassphrase = $null
$workRoot = $null

function Unprotect-MachineValue {
  param([Parameter(Mandatory = $true)][string]$ProtectedValue)
  $protectedBytes = [Convert]::FromBase64String($ProtectedValue)
  $plainBytes = [Security.Cryptography.ProtectedData]::Unprotect(
    $protectedBytes, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine
  )
  try { return [Text.Encoding]::UTF8.GetString($plainBytes) }
  finally { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
}

function Write-SafeLog([string]$Level, [string]$Message) {
  $safe = $Message -replace '(?i)(secret|token|password|key)(\s*[=:]\s*)\S+', '$1$2[REDACTED]'
  if ($safe.Length -gt 1200) { $safe = $safe.Substring(0, 1200) }
  "$(Get-Date -Format o)`t$Level`t$safe" | Add-Content -LiteralPath $logPath -Encoding UTF8
}

function Test-Due([string]$Pipeline, [string]$Property, [double]$Hours) {
  if ($Force) { return $true }
  $path = Join-Path $statusRoot "$Pipeline-status.json"
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $true }
  try {
    $status = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
    $value = [string]$status.$Property
    if ([string]::IsNullOrWhiteSpace($value)) { return $true }
    return (([DateTimeOffset]::UtcNow - [DateTimeOffset]::Parse($value).ToUniversalTime()).TotalHours -ge $Hours)
  }
  catch { return $true }
}

try {
  New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
  try { $lockHandle = [IO.File]::Open((Join-Path $statusRoot 'offsite.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
  catch { Write-SafeLog 'SKIPPED' 'Another off-site backup process owns the lock.'; exit 0 }
  if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) { throw 'Off-site backup configuration is unavailable.' }
  $config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($config.protectionScope -ne 'LocalMachine') { throw 'Off-site credentials are not machine protected.' }
  $accessKeyId = Unprotect-MachineValue ([string]$config.accessKeyId)
  $secretAccessKey = Unprotect-MachineValue ([string]$config.secretAccessKey)
  $erpConfig = Get-Content -LiteralPath ([string]$config.erpMachineConfigPath) -Raw -Encoding UTF8 | ConvertFrom-Json
  $archivePassphrase = Unprotect-MachineValue ([string]$erpConfig.archivePassphrase)
  $env:NAWASRAH_OFFSITE_STATUS_ROOT = $statusRoot
  $env:NAWASRAH_R2_ACCOUNT_ID = [string]$config.accountId
  $env:NAWASRAH_R2_ACCESS_KEY_ID = $accessKeyId
  $env:NAWASRAH_R2_SECRET_ACCESS_KEY = $secretAccessKey
  $env:NAWASRAH_R2_BUCKET = [string]$config.bucket
  $env:NAWASRAH_R2_JURISDICTION = [string]$config.jurisdiction
  $env:NAWASRAH_ERP_BACKUP_STATUS = [string]$config.erpStatusPath
  $env:NAWASRAH_N8N_BACKUP_STATUS = [string]$config.n8nStatusPath
  $runner = Join-Path $PSScriptRoot 'run-offsite-uploader.mjs'
  Write-SafeLog 'STARTED' "Mode=$Mode"
  if ($Mode -eq 'Probe') {
    & node.exe $runner probe
  }
  elseif ($Mode -eq 'Upload') {
    & node.exe $runner upload
  }
  elseif ($Mode -eq 'Verify') {
    if (-not ((Test-Due 'erp' 'lastDownloadVerifiedAt' 168) -or (Test-Due 'n8n' 'lastDownloadVerifiedAt' 168))) {
      Write-SafeLog 'SKIPPED' 'Weekly remote verification is not due.'
      exit 0
    }
    $workRoot = Join-Path $statusRoot "work\verify-$([Guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Path $workRoot -Force | Out-Null
    $env:NAWASRAH_OFFSITE_DOWNLOAD_ROOT = $workRoot
    & node.exe $runner verify
  }
  elseif ($Mode -eq 'RestoreDrill') {
    if (-not ((Test-Due 'erp' 'lastRestoreVerifiedAt' 2160) -or (Test-Due 'n8n' 'lastRestoreVerifiedAt' 2160))) {
      Write-SafeLog 'SKIPPED' 'The 90-day remote restore drill is not due.'
      exit 0
    }
    $workRoot = Join-Path $statusRoot "work\restore-$([Guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Path $workRoot -Force | Out-Null
    $env:NAWASRAH_OFFSITE_DOWNLOAD_ROOT = $workRoot
    & node.exe $runner download-restore
    if ($LASTEXITCODE -ne 0) { throw "Remote download exited with code $LASTEXITCODE." }
    $inputs = Get-Content -LiteralPath (Join-Path $workRoot 'restore-inputs.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $erpInput = $inputs | Where-Object pipeline -eq 'erp' | Select-Object -First 1
    $n8nInput = $inputs | Where-Object pipeline -eq 'n8n' | Select-Object -First 1
    $erpRestoreScript = Join-Path $projectRoot 'scripts\backup\run-restore-drill.ps1'
    & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass `
      -File $erpRestoreScript `
      -ConfigPath ([string]$config.erpMachineConfigPath) `
      -ArchivePath ([string]$erpInput.outputPath) `
      -NoDockerStart
    if ($LASTEXITCODE -ne 0) { throw 'ERP off-site restore drill failed.' }
    $env:NAWASRAH_BACKUP_PASSPHRASE = $archivePassphrase
    & (Join-Path $projectRoot 'automation\n8n\verify-offsite-restore.ps1') -ArchivePath ([string]$n8nInput.outputPath)
    if ($LASTEXITCODE -ne 0) { throw 'n8n off-site restore drill failed.' }
    $resultPath = Join-Path $workRoot 'restore-results.json'
    [pscustomobject]@{
      completedAt = [DateTimeOffset]::UtcNow.ToString('o')
      results = @($erpInput, $n8nInput)
      isolated = $true
      productionTouched = $false
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $resultPath -Encoding UTF8
    $env:NAWASRAH_OFFSITE_RESTORE_RESULT = $resultPath
    & node.exe $runner mark-restore
  }
  if ($LASTEXITCODE -ne 0) { throw "Off-site backup mode $Mode exited with code $LASTEXITCODE." }
  Write-SafeLog 'SUCCESS' "Mode=$Mode completed."
}
catch {
  Write-SafeLog 'FAILED' $_.Exception.Message
  throw
}
finally {
  foreach ($name in @(
    'NAWASRAH_OFFSITE_STATUS_ROOT'
    'NAWASRAH_R2_ACCOUNT_ID'
    'NAWASRAH_R2_ACCESS_KEY_ID'
    'NAWASRAH_R2_SECRET_ACCESS_KEY'
    'NAWASRAH_R2_BUCKET'
    'NAWASRAH_R2_JURISDICTION'
    'NAWASRAH_ERP_BACKUP_STATUS'
    'NAWASRAH_N8N_BACKUP_STATUS'
    'NAWASRAH_OFFSITE_DOWNLOAD_ROOT'
    'NAWASRAH_BACKUP_PASSPHRASE'
    'NAWASRAH_OFFSITE_RESTORE_RESULT'
  )) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
  if ($workRoot) { Remove-Item -LiteralPath $workRoot -Recurse -Force -ErrorAction SilentlyContinue }
  $accessKeyId = $null; $secretAccessKey = $null; $archivePassphrase = $null
  if ($lockHandle) { $lockHandle.Dispose() }
}
