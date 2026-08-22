[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$ProjectId
)

$ErrorActionPreference = 'Stop'
$automationRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$feedEnvironmentPath = Join-Path $automationRoot '.env.feed'
$temporaryRoot = Join-Path (
  [IO.Path]::GetTempPath()
) "nawasrah-n8n-credential-$([Guid]::NewGuid().ToString('N'))"
$localImportPath = Join-Path $temporaryRoot 'feed-credential.json'
$localExportPath = Join-Path $temporaryRoot 'feed-credential-export.json'
$containerImportPath = '/tmp/nawasrah-feed-credential.json'
$containerExportPath = '/tmp/nawasrah-feed-credential-export.json'
$feedSecret = $null

try {
  if (-not (Test-Path -LiteralPath $feedEnvironmentPath)) {
    throw 'The protected feed secret is missing. Run setup.ps1 first.'
  }

  $secretLine = Get-Content -LiteralPath $feedEnvironmentPath |
    Where-Object { $_ -like 'NAWASRAH_AUTOMATION_SECRET=*' } |
    Select-Object -First 1
  if (-not $secretLine) {
    throw 'NAWASRAH_AUTOMATION_SECRET is missing from .env.feed.'
  }
  $feedSecret = $secretLine.Substring($secretLine.IndexOf('=') + 1)
  if ($feedSecret.Length -lt 32) {
    throw 'The automation feed secret is too short.'
  }

  New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null
  $credential = @(
    [ordered]@{
      id = 'nawasrahFeedAuth'
      name = 'Nawasrah Supabase Alert Feed'
      type = 'httpHeaderAuth'
      data = [ordered]@{
        name = 'x-nawasrah-automation-secret'
        value = $feedSecret
      }
    }
  )
  [IO.File]::WriteAllText(
    $localImportPath,
    (ConvertTo-Json -InputObject $credential -Depth 8),
    [Text.UTF8Encoding]::new($false)
  )

  & docker.exe cp $localImportPath "nawasrah-n8n:$containerImportPath"
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not copy the temporary feed credential into n8n.'
  }

  & docker.exe exec nawasrah-n8n n8n import:credentials `
    --input=$containerImportPath `
    --projectId=$ProjectId `
    --include=id,name,type,data
  if ($LASTEXITCODE -ne 0) {
    throw 'n8n rejected the feed credential import.'
  }

  & docker.exe exec nawasrah-n8n n8n export:credentials `
    --id=nawasrahFeedAuth `
    --output=$containerExportPath
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not verify the imported n8n credential.'
  }
  & docker.exe cp "nawasrah-n8n:$containerExportPath" $localExportPath
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not read the encrypted credential verification export.'
  }

  $encryptedExport = Get-Content -LiteralPath $localExportPath -Raw
  if ($encryptedExport.Contains($feedSecret)) {
    throw 'n8n exported the credential in plain text unexpectedly.'
  }
  if (
    -not $encryptedExport.Contains('Nawasrah Supabase Alert Feed') -or
    -not $encryptedExport.Contains('httpHeaderAuth')
  ) {
    throw 'The imported feed credential could not be verified.'
  }

  Write-Host 'Imported and verified the encrypted n8n feed credential.' `
    -ForegroundColor Green
}
finally {
  & docker.exe exec --user root nawasrah-n8n rm -f `
    $containerImportPath $containerExportPath 2>$null
  Remove-Item -LiteralPath $temporaryRoot -Recurse -Force `
    -ErrorAction SilentlyContinue
  $feedSecret = $null
}
