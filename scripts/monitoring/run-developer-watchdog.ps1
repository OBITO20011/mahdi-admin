[CmdletBinding()]
param(
  [string]$ConfigPath = 'C:\ProgramData\NawasrahDeveloperMonitoring\config.json'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security -ErrorAction Stop
$monitorRoot = Split-Path -Parent $ConfigPath
$logRoot = Join-Path $monitorRoot 'logs'
$logPath = Join-Path $logRoot ("watchdog-{0}.log" -f (Get-Date).ToString('yyyyMMdd'))
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

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
function Resolve-NodeExecutable {
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($node) { return $node.Source }
  $systemNode = Join-Path $env:ProgramFiles 'nodejs\node.exe'
  if (Test-Path -LiteralPath $systemNode -PathType Leaf) { return $systemNode }
  throw 'Node.js was not found.'
}

New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
try {
  if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    throw 'Developer monitoring is not configured. Run setup-developer-monitoring.ps1.'
  }
  $config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($config.protectionScope -ne 'LocalMachine') {
    throw 'Developer monitoring configuration is not machine-protected.'
  }
  $backupConfigPath = [string]$config.backupMachineConfigPath
  if (-not (Test-Path -LiteralPath $backupConfigPath -PathType Leaf)) {
    throw 'Machine-protected backup configuration was not found.'
  }
  $backupConfig = Get-Content -LiteralPath $backupConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($backupConfig.protectionScope -ne 'LocalMachine') {
    throw 'Backup configuration is not machine-protected.'
  }

  $telegramToken = Unprotect-MachineValue -ProtectedValue $config.telegramBotToken
  $cloudflareToken = Unprotect-MachineValue -ProtectedValue $config.cloudflareApiToken
  $databasePassword = Unprotect-MachineValue -ProtectedValue $backupConfig.databasePassword
  $poolerPath = Join-Path ([string]$backupConfig.projectRoot) 'supabase\.temp\pooler-url'
  if (-not (Test-Path -LiteralPath $poolerPath -PathType Leaf)) {
    throw 'Supabase pooler URL is unavailable to the developer watchdog.'
  }
  $databaseUrl = ((Get-Content -LiteralPath $poolerPath -Raw -Encoding UTF8).Trim() + '?sslmode=require&connect_timeout=15')
  $psqlPath = Join-Path ([string]$backupConfig.pgBinPath) 'psql.exe'
  if (-not (Test-Path -LiteralPath $psqlPath -PathType Leaf)) {
    throw 'Native PostgreSQL psql.exe is unavailable to the developer watchdog.'
  }

  $env:NAWASRAH_DEVELOPER_MONITOR_ROOT = $monitorRoot
  $env:NAWASRAH_DEV_TELEGRAM_BOT_TOKEN = $telegramToken
  $env:NAWASRAH_DEV_TELEGRAM_CHAT_ID = [string]$config.telegramChatId
  $env:CLOUDFLARE_API_TOKEN = $cloudflareToken
  $env:CLOUDFLARE_ACCOUNT_ID = [string]$config.cloudflareAccountId
  $env:NAWASRAH_PROJECT_ROOT = [string]$backupConfig.projectRoot
  $env:NAWASRAH_BACKUP_ROOT = [string]$backupConfig.backupRoot
  $env:NAWASRAH_N8N_BACKUP_STATUS_ROOT = 'C:\ProgramData\NawasrahN8nBackup'
  $env:NAWASRAH_OFFSITE_STATUS_ROOT = 'C:\ProgramData\NawasrahOffsiteBackup'
  $env:NAWASRAH_PSQL_PATH = $psqlPath
  $env:NAWASRAH_SUPABASE_DATABASE_URL = $databaseUrl
  $env:SUPABASE_DB_PASSWORD = $databasePassword

  $node = Resolve-NodeExecutable
  $output = & $node (Join-Path $PSScriptRoot 'run-developer-watchdog.mjs') 2>&1
  $exitCode = $LASTEXITCODE
  "$(Get-Date -Format o)`tEXIT=$exitCode`t$($output -join ' ')" |
    Add-Content -LiteralPath $logPath -Encoding UTF8
  if ($exitCode -ne 0) { throw "Developer watchdog exited with code $exitCode." }
}
catch {
  "$(Get-Date -Format o)`tFAILED`t$($_.Exception.Message)" |
    Add-Content -LiteralPath $logPath -Encoding UTF8
  throw
}
finally {
  foreach ($name in @(
    'NAWASRAH_DEVELOPER_MONITOR_ROOT', 'NAWASRAH_DEV_TELEGRAM_BOT_TOKEN',
    'NAWASRAH_DEV_TELEGRAM_CHAT_ID', 'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_ACCOUNT_ID', 'NAWASRAH_PROJECT_ROOT', 'NAWASRAH_BACKUP_ROOT',
    'NAWASRAH_N8N_BACKUP_STATUS_ROOT', 'NAWASRAH_OFFSITE_STATUS_ROOT',
    'NAWASRAH_PSQL_PATH', 'NAWASRAH_SUPABASE_DATABASE_URL', 'SUPABASE_DB_PASSWORD'
  )) {
    Remove-Item "Env:$name" -ErrorAction SilentlyContinue
  }
  $telegramToken = $null
  $cloudflareToken = $null
  $databasePassword = $null
  $databaseUrl = $null
}
