[CmdletBinding()]
param(
  [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA 'NawasrahBackup\config.json')
)

$ErrorActionPreference = 'Stop'
$automationRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$environmentPath = Join-Path $automationRoot '.env'
$feedEnvironmentPath = Join-Path $automationRoot '.env.feed'
$channelEnvironmentPath = Join-Path $automationRoot '.env.channels'
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) "nawasrah-n8n-$([Guid]::NewGuid().ToString('N'))"
$rawArchive = Join-Path $temporaryRoot 'n8n-backup.tgz'
$verifiedArchive = Join-Path $temporaryRoot 'n8n-backup-verified.tgz'
$partialArchive = $null
$archivePassphrase = $null

function ConvertTo-PlainText {
  param([Parameter(Mandatory = $true)][Security.SecureString]$SecureValue)

  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

try {
  if (-not (Test-Path -LiteralPath $ConfigPath)) {
    throw "Encrypted backup configuration was not found: $ConfigPath"
  }
  if (-not (Test-Path -LiteralPath $environmentPath)) {
    throw 'The protected n8n .env file was not found. Run setup.ps1 first.'
  }
  if (-not (Test-Path -LiteralPath $feedEnvironmentPath)) {
    throw 'The protected n8n feed secret was not found. Run setup.ps1 first.'
  }
  if (-not (Test-Path -LiteralPath $channelEnvironmentPath)) {
    throw 'The protected notification destination settings were not found. Run setup.ps1 first.'
  }

  $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
  $archivePassphraseSecure = ConvertTo-SecureString -String $config.archivePassphrase
  $archivePassphrase = ConvertTo-PlainText -SecureValue $archivePassphraseSecure
  $backupRoot = [string]$config.backupRoot
  New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
  New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null

  $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $archivePath = Join-Path $backupRoot "nawasrah-n8n-$timestamp.nwb"
  $partialArchive = "$archivePath.partial"

  & docker.exe run --rm `
    --volume nawasrah_n8n_data:/source/n8n-data:ro `
    --volume nawasrah_n8n_files:/source/n8n-files:ro `
    --volume "${environmentPath}:/source/config/n8n.env:ro" `
    --volume "${feedEnvironmentPath}:/source/config/feed.env:ro" `
    --volume "${channelEnvironmentPath}:/source/config/channels.env:ro" `
    --volume "${temporaryRoot}:/backup" `
    alpine:3.21 `
    tar -czf /backup/n8n-backup.tgz -C /source n8n-data n8n-files config

  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $rawArchive)) {
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

  Move-Item -LiteralPath $partialArchive -Destination $archivePath
  $partialArchive = $null
  $hash = Get-FileHash -LiteralPath $archivePath -Algorithm SHA256
  Write-Host "Encrypted n8n backup: $archivePath" -ForegroundColor Green
  Write-Host "SHA256: $($hash.Hash)"
}
finally {
  Remove-Item Env:NAWASRAH_BACKUP_INPUT -ErrorAction SilentlyContinue
  Remove-Item Env:NAWASRAH_BACKUP_OUTPUT -ErrorAction SilentlyContinue
  Remove-Item Env:NAWASRAH_BACKUP_VERIFY -ErrorAction SilentlyContinue
  Remove-Item Env:NAWASRAH_BACKUP_PASSPHRASE -ErrorAction SilentlyContinue
  if ($partialArchive) {
    Remove-Item -LiteralPath $partialArchive -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
  $archivePassphrase = $null
}
