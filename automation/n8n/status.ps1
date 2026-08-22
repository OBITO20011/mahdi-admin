[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$automationRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$environmentPath = Join-Path $automationRoot '.env'

if (-not (Test-Path -LiteralPath $environmentPath)) {
  throw 'Run setup.ps1 first.'
}

Push-Location $automationRoot
try {
  & docker.exe compose --env-file $environmentPath -f compose.yaml ps
  & docker.exe inspect nawasrah-n8n --format 'Health={{if .State.Health}}{{.State.Health.Status}}{{else}}unknown{{end}} RestartCount={{.RestartCount}}'
} finally {
  Pop-Location
}
