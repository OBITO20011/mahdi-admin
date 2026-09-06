[CmdletBinding()]
param(
  [string]$ConfigPath = 'C:\ProgramData\NawasrahDeveloperMonitoring\config.json',
  [string]$BackupMachineConfigPath = (Join-Path $env:LOCALAPPDATA 'NawasrahBackup\config-machine.json'),
  [string]$TaskName = 'Nawasrah Developer Watchdog',
  [string]$CredentialEnvelopePath = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security -ErrorAction Stop
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host 'Windows will request Administrator approval before credentials are entered.' -ForegroundColor Cyan
  $arguments = @(
    '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', "`"$($MyInvocation.MyCommand.Path)`""
  )
  if ($CredentialEnvelopePath) {
    $arguments += @('-CredentialEnvelopePath', "`"$CredentialEnvelopePath`"")
  }
  $elevated = Start-Process powershell.exe -ArgumentList $arguments -Verb RunAs -Wait -PassThru
  exit $elevated.ExitCode
}

function ConvertTo-PlainText {
  param([Parameter(Mandatory = $true)][Security.SecureString]$SecureValue)
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Protect-MachineValue {
  param([Parameter(Mandatory = $true)][string]$PlainValue)
  $plainBytes = [Text.Encoding]::UTF8.GetBytes($PlainValue)
  try {
    $protectedBytes = [Security.Cryptography.ProtectedData]::Protect(
      $plainBytes,
      $null,
      [Security.Cryptography.DataProtectionScope]::LocalMachine
    )
    return [Convert]::ToBase64String($protectedBytes)
  }
  finally { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
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

function Set-RestrictedConfigAcl {
  param([Parameter(Mandatory = $true)][string]$Path)
  $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
  $administrators = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
  $acl = [Security.AccessControl.FileSecurity]::new()
  $acl.SetOwner($currentUser)
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($identity in @($currentUser, $system, $administrators)) {
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
      $identity,
      [Security.AccessControl.FileSystemRights]::FullControl,
      [Security.AccessControl.AccessControlType]::Allow
    ))
  }
  Set-Acl -LiteralPath $Path -AclObject $acl
}

if (-not (Test-Path -LiteralPath $BackupMachineConfigPath -PathType Leaf)) {
  throw 'Machine-protected ERP backup configuration is required before monitoring setup.'
}

$dpapiProbeScript = Join-Path $PSScriptRoot 'test-system-dpapi.ps1'
$dpapiProbeResultPath = 'C:\ProgramData\NawasrahDeveloperMonitoring\dpapi-system-probe-result.json'
& powershell.exe `
  -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass `
  -File $dpapiProbeScript -Elevated -ResultPath $dpapiProbeResultPath
if ($LASTEXITCODE -ne 0) {
  throw "SYSTEM DPAPI interoperability probe exited with code $LASTEXITCODE."
}
$dpapiProbeResult = Get-Content -LiteralPath $dpapiProbeResultPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($dpapiProbeResult.ok -ne $true -or $dpapiProbeResult.identity -ne 'NT AUTHORITY\SYSTEM') {
  throw 'SYSTEM cannot decrypt machine-protected monitoring values safely.'
}
Write-Host 'DPAPI LocalMachine interoperability with SYSTEM verified.' -ForegroundColor Green

$telegramToken = $null
$cloudflareToken = $null
$resolvedEnvelopePath = $null
if ($CredentialEnvelopePath) {
  $resolvedEnvelopePath = (Resolve-Path -LiteralPath $CredentialEnvelopePath).Path
  $envelope = Get-Content -LiteralPath $resolvedEnvelopePath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($envelope.formatVersion -ne 1 -or $envelope.protectionScope -ne 'LocalMachine') {
    throw 'The developer monitoring credential envelope is invalid.'
  }
  $telegramToken = Unprotect-MachineValue -ProtectedValue ([string]$envelope.telegramBotToken)
  $telegramChatId = ([string]$envelope.telegramChatId).Trim()
  $cloudflareToken = Unprotect-MachineValue -ProtectedValue ([string]$envelope.cloudflareApiToken)
  $cloudflareAccountId = ([string]$envelope.cloudflareAccountId).Trim()
}
else {
  Write-Host 'Use a developer-only Telegram bot and chat. Do not reuse the Business bot or owner chat.' -ForegroundColor Yellow
  $telegramTokenSecure = Read-Host 'Developer Telegram Bot Token' -AsSecureString
  $telegramChatId = (Read-Host 'Developer Telegram Chat ID').Trim()
  $cloudflareTokenSecure = Read-Host 'Cloudflare API Token (Pages read-only)' -AsSecureString
  $cloudflareAccountId = (Read-Host 'Cloudflare Account ID').Trim()
  $telegramToken = ConvertTo-PlainText $telegramTokenSecure
  $cloudflareToken = ConvertTo-PlainText $cloudflareTokenSecure
}

try {
  if ($telegramToken -notmatch '^\d+:[A-Za-z0-9_-]{20,}$' -or $telegramChatId -notmatch '^-?\d+$') {
    throw 'Developer Telegram credentials are invalid.'
  }
  if ($cloudflareToken.Length -lt 20 -or $cloudflareAccountId -notmatch '^[a-f0-9]{32}$') {
    throw 'Cloudflare read-only API configuration is invalid.'
  }

  try {
    $telegramCheck = Invoke-RestMethod `
      -Method Get `
      -Uri "https://api.telegram.org/bot$telegramToken/getChat?chat_id=$telegramChatId" `
      -TimeoutSec 15
  }
  catch {
    throw 'Developer Telegram channel validation failed.'
  }
  if ($telegramCheck.ok -ne $true) { throw 'Developer Telegram channel validation failed.' }

  foreach ($project in @('nawasrah-admin', 'nawasrah-store')) {
    try {
      $cloudflareCheck = Invoke-RestMethod `
        -Method Get `
        -Uri "https://api.cloudflare.com/client/v4/accounts/$cloudflareAccountId/pages/projects/$project" `
        -Headers @{Authorization = "Bearer $cloudflareToken"} `
        -TimeoutSec 20
    }
    catch {
      throw "Cloudflare read-only access failed for $project."
    }
    if ($cloudflareCheck.success -ne $true) { throw "Cloudflare read-only access failed for $project." }
  }

  $configRoot = Split-Path -Parent $ConfigPath
  New-Item -ItemType Directory -Path $configRoot -Force | Out-Null
  $config = [ordered]@{
    formatVersion = 1
    protectionScope = 'LocalMachine'
    projectRoot = $projectRoot
    backupMachineConfigPath = (Resolve-Path -LiteralPath $BackupMachineConfigPath).Path
    telegramBotToken = Protect-MachineValue $telegramToken
    telegramChatId = $telegramChatId
    cloudflareApiToken = Protect-MachineValue $cloudflareToken
    cloudflareAccountId = $cloudflareAccountId
  }
  $temporaryPath = "$ConfigPath.tmp"
  $config | ConvertTo-Json | Set-Content -LiteralPath $temporaryPath -Encoding UTF8
  Move-Item -LiteralPath $temporaryPath -Destination $ConfigPath -Force
  Set-RestrictedConfigAcl $ConfigPath

  $registerScript = Join-Path $PSScriptRoot 'register-developer-watchdog.ps1'
  $runScript = Join-Path $PSScriptRoot 'run-developer-watchdog.ps1'
  & $registerScript -RunScript $runScript -ConfigPath $ConfigPath -TaskName $TaskName

  Invoke-RestMethod `
    -Method Post `
    -Uri "https://api.telegram.org/bot$telegramToken/sendMessage" `
    -ContentType 'application/json' `
    -Body (@{chat_id = $telegramChatId; text = 'Nawasrah Developer Alerts channel is active.'} | ConvertTo-Json) `
    -TimeoutSec 15 | Out-Null
  Write-Host 'Developer monitoring configured securely. Add the same dedicated Telegram values to GitHub Secrets before enabling workflow alerts.' -ForegroundColor Green
}
finally {
  $telegramToken = $null
  $cloudflareToken = $null
  if ($resolvedEnvelopePath -and (Test-Path -LiteralPath $resolvedEnvelopePath -PathType Leaf)) {
    Remove-Item -LiteralPath $resolvedEnvelopePath -Force -ErrorAction SilentlyContinue
  }
}
