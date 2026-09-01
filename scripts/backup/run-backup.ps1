[CmdletBinding()]
param(
  [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA 'NawasrahBackup\config.json'),
  [switch]$NoDockerStart
)

$ErrorActionPreference = 'Stop'
if (-not (Get-Command ConvertTo-SecureString -ErrorAction SilentlyContinue)) {
  Import-Module -Name Microsoft.PowerShell.Security -ErrorAction Stop
}
Add-Type -AssemblyName System.Security -ErrorAction Stop
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$statusFallback = Join-Path (Split-Path -Parent $ConfigPath) 'runner.log'

function Resolve-NodeExecutable {
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($node) {
    return $node.Source
  }
  $systemNode = Join-Path $env:ProgramFiles 'nodejs\node.exe'
  if (Test-Path -LiteralPath $systemNode -PathType Leaf) {
    return $systemNode
  }
  throw 'Node.js was not found in PATH or Program Files.'
}

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

function Unprotect-MachineValue {
  param([Parameter(Mandatory = $true)][string]$ProtectedValue)

  $protectedBytes = [Convert]::FromBase64String($ProtectedValue)
  $plainBytes = [Security.Cryptography.ProtectedData]::Unprotect(
    $protectedBytes,
    $null,
    [Security.Cryptography.DataProtectionScope]::LocalMachine
  )
  try {
    return [Text.Encoding]::UTF8.GetString($plainBytes)
  }
  finally {
    [Array]::Clear($plainBytes, 0, $plainBytes.Length)
  }
}

function Wait-ForDocker {
  param([int]$TimeoutSeconds = 600)

  $docker = Get-Command docker.exe -ErrorAction SilentlyContinue
  if (-not $docker) {
    throw 'Docker Desktop is not installed. It is required by Supabase db dump.'
  }

  function Test-DockerReady {
    $stdoutPath = [IO.Path]::GetTempFileName()
    $stderrPath = [IO.Path]::GetTempFileName()
    try {
      $process = Start-Process `
        -FilePath $docker.Source `
        -ArgumentList @('info', '--format', '{{.ServerVersion}}') `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -WindowStyle Hidden `
        -Wait `
        -PassThru
      return $process.ExitCode -eq 0
    }
    finally {
      Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
    }
  }

  if (Test-DockerReady) {
    return
  }

  if ($NoDockerStart) {
    throw 'Docker Desktop is not running.'
  }

  $dockerDesktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (-not (Test-Path -LiteralPath $dockerDesktop)) {
    throw 'Docker Desktop could not be started automatically.'
  }

  Start-Process -FilePath $dockerDesktop -WindowStyle Hidden
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Seconds 3
    if (Test-DockerReady) {
      return
    }
  } while ((Get-Date) -lt $deadline)

  throw 'Docker Desktop did not become ready within ten minutes.'
}

try {
  New-Item -ItemType Directory -Path (Split-Path -Parent $statusFallback) -Force | Out-Null
  "$(Get-Date -Format o)`tSTARTED`t$([Security.Principal.WindowsIdentity]::GetCurrent().Name)" |
    Add-Content -LiteralPath $statusFallback -Encoding UTF8
  if (-not (Test-Path -LiteralPath $ConfigPath)) {
    throw "Backup configuration was not found: $ConfigPath"
  }

  $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
  if ($config.protectionScope -eq 'LocalMachine') {
    $databasePassword = Unprotect-MachineValue -ProtectedValue $config.databasePassword
    $archivePassphrase = Unprotect-MachineValue -ProtectedValue $config.archivePassphrase
  }
  else {
    $databasePasswordSecure = ConvertTo-SecureString -String $config.databasePassword
    $archivePassphraseSecure = ConvertTo-SecureString -String $config.archivePassphrase
    $databasePassword = ConvertTo-PlainText -SecureValue $databasePasswordSecure
    $archivePassphrase = ConvertTo-PlainText -SecureValue $archivePassphraseSecure
  }

  $pgBinPath = if ($config.pgBinPath) { [string]$config.pgBinPath } else { $null }
  if ($pgBinPath) {
    foreach ($tool in @('pg_dump.exe', 'pg_dumpall.exe', 'pg_restore.exe', 'psql.exe')) {
      if (-not (Test-Path -LiteralPath (Join-Path $pgBinPath $tool) -PathType Leaf)) {
        throw "Native PostgreSQL backup tool was not found: $tool"
      }
    }
  }
  else {
    Wait-ForDocker
  }

  $env:SUPABASE_DB_PASSWORD = $databasePassword
  $env:NAWASRAH_BACKUP_PASSPHRASE = $archivePassphrase
  $env:NAWASRAH_BACKUP_OUTPUT = [string]$config.backupRoot
  $env:NAWASRAH_BACKUP_RETENTION = [string]$config.retentionCount
  $env:NAWASRAH_PROJECT_ROOT = $projectRoot
  $env:NAWASRAH_BACKUP_EXECUTION_IDENTITY = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  if ($pgBinPath) {
    $env:NAWASRAH_PG_BIN = $pgBinPath
  }

  Push-Location $projectRoot
  try {
    $nodeExecutable = Resolve-NodeExecutable
    & $nodeExecutable (Join-Path $PSScriptRoot 'create-backup.mjs')
    if ($LASTEXITCODE -ne 0) {
      throw "Backup process exited with code $LASTEXITCODE."
    }
    "$(Get-Date -Format o)`tSUCCESS`tScheduled backup runner completed." |
      Add-Content -LiteralPath $statusFallback -Encoding UTF8
  }
  finally {
    Pop-Location
  }
}
catch {
  $logDirectory = Split-Path -Parent $statusFallback
  New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
  "$(Get-Date -Format o)`tFAILED`t$($_.Exception.Message)" |
    Add-Content -LiteralPath $statusFallback -Encoding UTF8
  throw
}
finally {
  Remove-Item Env:SUPABASE_DB_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:NAWASRAH_BACKUP_PASSPHRASE -ErrorAction SilentlyContinue
  Remove-Item Env:NAWASRAH_BACKUP_OUTPUT -ErrorAction SilentlyContinue
  Remove-Item Env:NAWASRAH_BACKUP_RETENTION -ErrorAction SilentlyContinue
  Remove-Item Env:NAWASRAH_PROJECT_ROOT -ErrorAction SilentlyContinue
  Remove-Item Env:NAWASRAH_BACKUP_EXECUTION_IDENTITY -ErrorAction SilentlyContinue
  Remove-Item Env:NAWASRAH_PG_BIN -ErrorAction SilentlyContinue
  $databasePassword = $null
  $archivePassphrase = $null
}
