[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$ArchivePath)

$ErrorActionPreference = 'Stop'
$automationRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$workRoot = Join-Path $env:TEMP "nawasrah-n8n-offsite-$([Guid]::NewGuid().ToString('N'))"
$tarPath = Join-Path $workRoot 'restore.tgz'
$restoreRoot = Join-Path $workRoot 'restore'
try {
  if (-not (Test-Path -LiteralPath $ArchivePath -PathType Leaf)) { throw 'Off-site n8n archive is unavailable.' }
  if ([string]::IsNullOrWhiteSpace($env:NAWASRAH_BACKUP_PASSPHRASE)) { throw 'Backup passphrase is unavailable.' }
  & docker.exe info --format '{{.ServerVersion}}' *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Docker Server is unavailable for isolated n8n restore verification.' }
  New-Item -ItemType Directory -Path $restoreRoot -Force | Out-Null
  $env:NAWASRAH_N8N_RESTORE_INPUT = $ArchivePath
  $env:NAWASRAH_N8N_RESTORE_OUTPUT = $tarPath
  & node.exe (Join-Path $automationRoot 'decrypt-backup.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Could not decrypt the downloaded n8n archive.' }
  & docker.exe run --rm --network none --volume "${workRoot}:/drill" alpine:3.21 `
    sh -c 'mkdir -p /drill/restore && tar -xzf /drill/restore.tgz -C /drill/restore && test -s /drill/restore/n8n-data/database.sqlite && test -f /drill/restore/config/n8n.env && test -f /drill/restore/config/feed.env && test -f /drill/restore/config/channels.env'
  if ($LASTEXITCODE -ne 0) { throw 'Downloaded n8n archive contents are incomplete.' }
  $environmentPath = Join-Path $restoreRoot 'config\n8n.env'
  $imageLine = Get-Content -LiteralPath $environmentPath -Encoding UTF8 |
    Where-Object { $_ -match '^N8N_IMAGE=' } | Select-Object -First 1
  $image = if ($imageLine) { ($imageLine -split '=', 2)[1].Trim() } else { 'docker.n8n.io/n8nio/n8n:stable' }
  & docker.exe run --rm --network none --user root `
    --env N8N_USER_FOLDER=/home/node `
    --env-file $environmentPath `
    --volume "$(Join-Path $restoreRoot 'n8n-data'):/home/node/.n8n" `
    --volume "$(Join-Path $restoreRoot 'n8n-files'):/home/node/.n8n-files" `
    $image export:workflow --all --output=/tmp/restored-workflows.json *> $null
  if ($LASTEXITCODE -ne 0) { throw 'n8n could not open the downloaded restored database.' }
  Write-Host 'Downloaded n8n backup passed isolated restore verification.' -ForegroundColor Green
}
finally {
  Remove-Item Env:NAWASRAH_N8N_RESTORE_INPUT -ErrorAction SilentlyContinue
  Remove-Item Env:NAWASRAH_N8N_RESTORE_OUTPUT -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $workRoot -Recurse -Force -ErrorAction SilentlyContinue
}
