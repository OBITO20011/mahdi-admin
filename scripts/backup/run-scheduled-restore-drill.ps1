[CmdletBinding()]
param(
  [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA 'NawasrahBackup\config.json'),

  [ValidateRange(1, 366)]
  [int]$MinimumDays = 90
)

$ErrorActionPreference = 'Stop'
$fallbackLogDirectory = Join-Path $env:LOCALAPPDATA 'NawasrahBackup'
$fallbackLogPath = Join-Path $fallbackLogDirectory 'restore-drill-runner.log'

function Write-RunnerLog {
  param([Parameter(Mandatory = $true)][string]$Message)

  try {
    New-Item -ItemType Directory -Path $fallbackLogDirectory -Force | Out-Null
    Add-Content -LiteralPath $fallbackLogPath -Encoding UTF8 -Value "$(Get-Date -Format o) $Message"
  }
  catch {
    # The primary error still reaches Task Scheduler even if the local log is unavailable.
  }
}

try {
  if (-not (Test-Path -LiteralPath $ConfigPath)) {
    throw "Backup configuration was not found: $ConfigPath"
  }

  $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
  $backupRoot = [string]$config.backupRoot
  if ([string]::IsNullOrWhiteSpace($backupRoot)) {
    throw 'The backup configuration does not contain a backupRoot.'
  }

  $reportPath = Join-Path $backupRoot 'last-restore-drill-status.json'
  $lastSuccessfulDrill = $null
  if (Test-Path -LiteralPath $reportPath) {
    try {
      $candidate = Get-Content -LiteralPath $reportPath -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($candidate.ok -eq $true -and $candidate.liveSupabaseTouched -eq $false -and $candidate.completedAt) {
        $lastSuccessfulDrill = [DateTimeOffset]::Parse([string]$candidate.completedAt).ToUniversalTime()
      }
    }
    catch {
      Write-RunnerLog "The existing restore-drill report could not be trusted and will be replaced. $($_.Exception.Message)"
    }
  }

  if ($lastSuccessfulDrill) {
    $age = [DateTimeOffset]::UtcNow - $lastSuccessfulDrill
    if ($age.TotalDays -ge 0 -and $age.TotalDays -lt $MinimumDays) {
      Write-Host "Restore drill is not due yet. Last safe drill was $([math]::Floor($age.TotalDays)) day(s) ago." -ForegroundColor Cyan
      exit 0
    }
  }

  Write-Host 'Running the isolated restore drill because a recent successful drill was not found.' -ForegroundColor Yellow
  $restoreDrillScript = Join-Path $PSScriptRoot 'run-restore-drill.ps1'
  & $restoreDrillScript -ConfigPath $ConfigPath
  if ($LASTEXITCODE -ne 0) {
    throw "Restore drill exited with code $LASTEXITCODE."
  }

  Write-Host 'Scheduled restore drill completed successfully without touching live Supabase.' -ForegroundColor Green
}
catch {
  Write-RunnerLog $_.Exception.Message
  throw
}
