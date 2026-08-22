[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$automationRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$environmentPath = Join-Path $automationRoot '.env'

if (-not (Test-Path -LiteralPath $environmentPath)) {
  throw 'The n8n environment file does not exist.'
}

Push-Location $automationRoot
try {
  & docker.exe compose --env-file $environmentPath -f compose.yaml stop
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not stop n8n.'
  }
} finally {
  Pop-Location
}
