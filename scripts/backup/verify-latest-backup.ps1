[CmdletBinding()]
param(
  [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA 'NawasrahBackup\config.json'),
  [string]$ArchivePath,
  [string]$ExtractTo
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

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

if (-not (Test-Path -LiteralPath $ConfigPath)) {
  throw "Backup configuration was not found: $ConfigPath"
}

$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
if (-not $ArchivePath) {
  $latest = Get-ChildItem -LiteralPath $config.backupRoot -Filter 'nawasrah-backup-*.nwb' -File |
    Sort-Object Name -Descending |
    Select-Object -First 1
  if (-not $latest) {
    throw "No backup archive was found in $($config.backupRoot)."
  }
  $ArchivePath = $latest.FullName
}

$archivePassphraseSecure = ConvertTo-SecureString -String $config.archivePassphrase
$archivePassphrase = ConvertTo-PlainText -SecureValue $archivePassphraseSecure
try {
  $env:NAWASRAH_BACKUP_PASSPHRASE = $archivePassphrase
  $arguments = @((Join-Path $PSScriptRoot 'verify-backup.mjs'), '--file', $ArchivePath)
  if ($ExtractTo) {
    $arguments += @('--extract-to', $ExtractTo)
  }
  & node.exe $arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Backup verification exited with code $LASTEXITCODE."
  }
}
finally {
  Remove-Item Env:NAWASRAH_BACKUP_PASSPHRASE -ErrorAction SilentlyContinue
  $archivePassphrase = $null
}
