[CmdletBinding()]
param(
  [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA 'NawasrahBackup\config.json'),
  [string]$ArchivePath,
  [string]$PostgresImage,
  [switch]$NoDockerStart
)

$ErrorActionPreference = 'Stop'
if (-not (Get-Command ConvertTo-SecureString -ErrorAction SilentlyContinue)) {
  Import-Module -Name Microsoft.PowerShell.Security -ErrorAction Stop
}
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

function Test-DockerReady {
  $docker = Get-Command docker.exe -ErrorAction SilentlyContinue
  if (-not $docker) {
    return $false
  }
  $processInfo = New-Object System.Diagnostics.ProcessStartInfo
  $processInfo.FileName = $docker.Source
  $processInfo.Arguments = 'info --format "{{.ServerVersion}}"'
  $processInfo.UseShellExecute = $false
  $processInfo.CreateNoWindow = $true
  $processInfo.RedirectStandardOutput = $true
  $processInfo.RedirectStandardError = $true
  $process = [System.Diagnostics.Process]::Start($processInfo)
  $process.WaitForExit()
  return $process.ExitCode -eq 0
}

function Wait-ForDocker {
  param([int]$TimeoutSeconds = 120)
  if (Test-DockerReady) {
    return
  }
  if ($NoDockerStart) {
    throw 'Docker Desktop is not running.'
  }
  $dockerDesktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (-not (Test-Path -LiteralPath $dockerDesktop)) {
    throw 'Docker Desktop is not installed or could not be started automatically.'
  }
  Start-Process -FilePath $dockerDesktop -WindowStyle Hidden
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Seconds 3
    if (Test-DockerReady) {
      return
    }
  } while ((Get-Date) -lt $deadline)
  throw 'Docker Desktop did not become ready within two minutes.'
}

function Find-LatestBackupArchive {
  param([Parameter(Mandatory = $true)]$Config)

  $roots = New-Object System.Collections.Generic.List[string]
  if ($Config.backupRoot -and (Test-Path -LiteralPath $Config.backupRoot)) {
    $roots.Add([string]$Config.backupRoot)
  }
  if ($env:OneDrive -and (Test-Path -LiteralPath $env:OneDrive)) {
    Get-ChildItem -LiteralPath $env:OneDrive -Directory -Recurse -Filter 'Nawasrah ERP Backups' -ErrorAction SilentlyContinue |
      ForEach-Object {
        if (-not $roots.Contains($_.FullName)) {
          $roots.Add($_.FullName)
        }
      }
  }

  $latest = $roots |
    ForEach-Object {
      Get-ChildItem -LiteralPath $_ -Filter 'nawasrah-backup-*.nwb' -File -ErrorAction SilentlyContinue
    } |
    Sort-Object Name -Descending |
    Select-Object -First 1

  if (-not $latest) {
    throw 'No encrypted Nawasrah backup archive was found in the configured or OneDrive backup folders.'
  }
  return $latest.FullName
}

if (-not (Test-Path -LiteralPath $ConfigPath)) {
  throw "Backup configuration was not found: $ConfigPath"
}

$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
if (-not $ArchivePath) {
  $ArchivePath = Find-LatestBackupArchive -Config $config
}
if (-not (Test-Path -LiteralPath $ArchivePath -PathType Leaf)) {
  throw "Backup archive was not found: $ArchivePath"
}

if (-not $PostgresImage) {
  $versionPath = Join-Path $projectRoot 'supabase\.temp\postgres-version'
  $postgresVersion = if (Test-Path -LiteralPath $versionPath) {
    (Get-Content -LiteralPath $versionPath -Raw).Trim()
  }
  else {
    '17.6.1.147'
  }
  $PostgresImage = "public.ecr.aws/supabase/postgres:$postgresVersion"
}

$reportPath = Join-Path (Split-Path -Parent $ArchivePath) 'last-restore-drill-status.json'
$archivePassphraseSecure = ConvertTo-SecureString -String $config.archivePassphrase
$archivePassphrase = ConvertTo-PlainText -SecureValue $archivePassphraseSecure

try {
  Wait-ForDocker
  $env:NAWASRAH_BACKUP_PASSPHRASE = $archivePassphrase
  Push-Location $projectRoot
  try {
    & node.exe (Join-Path $PSScriptRoot 'restore-drill.mjs') `
      --file $ArchivePath `
      --report $reportPath `
      --image $PostgresImage
    if ($LASTEXITCODE -ne 0) {
      throw "Restore drill exited with code $LASTEXITCODE."
    }
  }
  finally {
    Pop-Location
  }
}
finally {
  Remove-Item Env:NAWASRAH_BACKUP_PASSPHRASE -ErrorAction SilentlyContinue
  $archivePassphrase = $null
}
