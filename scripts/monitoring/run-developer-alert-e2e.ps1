[CmdletBinding()]
param(
  [string]$ConfigPath = 'C:\ProgramData\NawasrahDeveloperMonitoring\config.json'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security -ErrorAction Stop

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

$config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
try {
  $env:NAWASRAH_DEV_TELEGRAM_BOT_TOKEN = Unprotect-MachineValue $config.telegramBotToken
  $env:NAWASRAH_DEV_TELEGRAM_CHAT_ID = [string]$config.telegramChatId
  & node.exe (Join-Path $PSScriptRoot 'run-developer-alert-e2e.mjs')
  if ($LASTEXITCODE -ne 0) { throw "Developer alert E2E exited with code $LASTEXITCODE." }
}
finally {
  Remove-Item Env:NAWASRAH_DEV_TELEGRAM_BOT_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:NAWASRAH_DEV_TELEGRAM_CHAT_ID -ErrorAction SilentlyContinue
}
