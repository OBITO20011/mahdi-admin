[CmdletBinding()]
param(
  [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA 'NawasrahBackup\config.json'),
  [switch]$UseClipboard
)

$ErrorActionPreference = 'Stop'
if (-not (Get-Command ConvertTo-SecureString -ErrorAction SilentlyContinue)) {
  Import-Module -Name Microsoft.PowerShell.Security -ErrorAction Stop
}
$taskName = 'Nawasrah ERP Nightly Backup'
$testScript = Join-Path $PSScriptRoot 'test-database-connection.ps1'
$runScript = Join-Path $PSScriptRoot 'run-backup.ps1'
$scheduleScript = Join-Path $PSScriptRoot 'register-backup-schedule.ps1'

if (-not (Test-Path -LiteralPath $ConfigPath)) {
  throw "Backup configuration was not found: $ConfigPath"
}

Write-Host ''
Write-Host 'Nawasrah ERP - Update database password' -ForegroundColor Cyan
Write-Host 'Enter only the Database password that was reset in Supabase Database Settings.'
Write-Host 'The saved archive passphrase will remain unchanged.' -ForegroundColor Yellow
Write-Host ''

$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$previousEncryptedPassword = $config.databasePassword
if ($UseClipboard) {
  $clipboardPassword = [string](Get-Clipboard -Raw)
  $clipboardPassword = $clipboardPassword.TrimEnd("`r", "`n")
  if ($clipboardPassword.Length -lt 16) {
    throw 'Windows clipboard does not contain the generated Database password.'
  }
  $newDatabasePassword = ConvertTo-SecureString -String $clipboardPassword -AsPlainText -Force
  $clipboardPassword = $null
}
else {
  $newDatabasePassword = Read-Host 'New Supabase Database password' -AsSecureString
}
$config.databasePassword = ConvertFrom-SecureString -SecureString $newDatabasePassword
$config | ConvertTo-Json | Set-Content -LiteralPath $ConfigPath -Encoding UTF8

try {
  Write-Host ''
  Write-Host 'Checking the password through the official Supabase pooler...' -ForegroundColor Cyan
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $testScript -ConfigPath $ConfigPath
  if ($LASTEXITCODE -ne 0) {
    throw 'Database password validation failed. Read the specific connection error shown above.'
  }

  Write-Host 'Creating and verifying the first encrypted backup...' -ForegroundColor Cyan
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runScript -ConfigPath $ConfigPath
  if ($LASTEXITCODE -ne 0) {
    throw 'The password is valid, but the first backup failed.'
  }

  $scheduleTime = if ($config.scheduleTime) { [string]$config.scheduleTime } else { '23:30' }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scheduleScript `
    -RunScript $runScript `
    -ConfigPath $ConfigPath `
    -ScheduleTime $scheduleTime `
    -TaskName $taskName
  if ($LASTEXITCODE -ne 0) {
    throw 'The first backup succeeded, but Windows could not create the daily schedule.'
  }

  Write-Host ''
  Write-Host "Database password verified, first backup completed, and daily schedule enabled at $scheduleTime." -ForegroundColor Green
  if ($UseClipboard) {
    try {
      Set-Clipboard -Value 'Nawasrah backup password removed from clipboard.'
      Write-Host 'The temporary Database password was cleared from the Windows clipboard.' -ForegroundColor Green
    }
    catch {
      Write-Warning 'The backup succeeded, but Windows could not clear the clipboard automatically. Copy any harmless text now.'
    }
  }
}
catch {
  $config.databasePassword = $previousEncryptedPassword
  $config | ConvertTo-Json | Set-Content -LiteralPath $ConfigPath -Encoding UTF8
  Disable-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Out-Null
  throw
}
