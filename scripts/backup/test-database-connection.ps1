[CmdletBinding()]
param(
  [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA 'NawasrahBackup\config.json')
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

if (-not (Test-Path -LiteralPath $ConfigPath)) {
  throw "Backup configuration was not found: $ConfigPath"
}

$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$databasePasswordSecure = ConvertTo-SecureString -String $config.databasePassword
$databasePassword = ConvertTo-PlainText -SecureValue $databasePasswordSecure
$poolerUrl = (Get-Content -LiteralPath (Join-Path $projectRoot 'supabase\.temp\pooler-url') -Raw).Trim()
$postgresVersion = (Get-Content -LiteralPath (Join-Path $projectRoot 'supabase\.temp\postgres-version') -Raw).Trim()
$image = "public.ecr.aws/supabase/postgres:$postgresVersion"
$connectionUrl = "$poolerUrl`?sslmode=require"

try {
  $docker = Get-Command docker.exe -ErrorAction Stop
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $docker.Source
  $startInfo.Arguments = "run --rm -e PGPASSWORD $image psql $connectionUrl -X -tAc select/**/1"
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.EnvironmentVariables['PGPASSWORD'] = $databasePassword

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  if (-not $process.Start()) {
    throw 'Docker could not start the database connection check.'
  }

  $output = $process.StandardOutput.ReadToEnd().Trim()
  $errorText = $process.StandardError.ReadToEnd().Trim()
  $process.WaitForExit()

  if ($process.ExitCode -ne 0) {
    if ($errorText -match 'password authentication failed') {
      throw 'Supabase rejected the Database password through the official pooler.'
    }
    throw "Database connection check failed: $errorText"
  }

  if ($output -ne '1') {
    throw "Database connection returned an unexpected result. Output: '$output' Error: '$errorText'"
  }

  Write-Output 'PASS: Supabase database password and pooler connection are valid.'
}
finally {
  $databasePassword = $null
}
