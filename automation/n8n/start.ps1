[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$automationRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$environmentPath = Join-Path $automationRoot '.env'

if (-not (Test-Path -LiteralPath $environmentPath)) {
  throw 'Run setup.ps1 once before starting n8n.'
}

Push-Location $automationRoot
try {
  & docker.exe compose --env-file $environmentPath -f compose.yaml up --detach
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not start n8n.'
  }
} finally {
  Pop-Location
}

Write-Host 'n8n: http://127.0.0.1:5678' -ForegroundColor Cyan
