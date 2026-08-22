[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$BackupRoot,
  [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA 'NawasrahBackup\config.json')
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
  throw "Backup configuration was not found: $ConfigPath"
}
if (-not (Test-Path -LiteralPath $BackupRoot -PathType Container)) {
  throw "Backup destination was not found: $BackupRoot"
}

$resolvedBackupRoot = (Resolve-Path -LiteralPath $BackupRoot).Path
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$config.backupRoot = $resolvedBackupRoot
$temporaryConfigPath = "$ConfigPath.tmp"

try {
  $config | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $temporaryConfigPath -Encoding UTF8
  Move-Item -LiteralPath $temporaryConfigPath -Destination $ConfigPath -Force
}
finally {
  Remove-Item -LiteralPath $temporaryConfigPath -Force -ErrorAction SilentlyContinue
}

Write-Output "Backup destination updated: $resolvedBackupRoot"
