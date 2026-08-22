[CmdletBinding()]
param(
  [switch]$SkipPull
)

$ErrorActionPreference = 'Stop'
$automationRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$composePath = Join-Path $automationRoot 'compose.yaml'
$environmentPath = Join-Path $automationRoot '.env'
$feedEnvironmentPath = Join-Path $automationRoot '.env.feed'
$channelEnvironmentPath = Join-Path $automationRoot '.env.channels'

function Test-DockerReady {
  $docker = Get-Command docker.exe -ErrorAction SilentlyContinue
  if (-not $docker) {
    return $false
  }

  & $docker.Source info --format '{{.ServerVersion}}' *> $null
  return $LASTEXITCODE -eq 0
}

function Wait-ForDocker {
  if (Test-DockerReady) {
    return
  }

  $dockerDesktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (-not (Test-Path -LiteralPath $dockerDesktop)) {
    throw 'Docker Desktop is not installed.'
  }

  Start-Process -FilePath $dockerDesktop -WindowStyle Hidden
  for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
    Start-Sleep -Seconds 2
    if (Test-DockerReady) {
      return
    }
  }

  throw 'Docker Desktop did not become ready within two minutes.'
}

function New-EncryptionKey {
  $bytes = [byte[]]::new(48)
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
  } finally {
    $generator.Dispose()
  }
  return [Convert]::ToBase64String($bytes)
}

function Protect-EnvironmentFile([string]$path) {
  $currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $acl = New-Object Security.AccessControl.FileSecurity
  $inheritance = [Security.AccessControl.InheritanceFlags]::None
  $propagation = [Security.AccessControl.PropagationFlags]::None
  $rights = [Security.AccessControl.FileSystemRights]::FullControl
  $allow = [Security.AccessControl.AccessControlType]::Allow

  foreach ($identity in @($currentIdentity, 'NT AUTHORITY\SYSTEM', 'BUILTIN\Administrators')) {
    $rule = New-Object Security.AccessControl.FileSystemAccessRule(
      $identity, $rights, $inheritance, $propagation, $allow
    )
    $acl.AddAccessRule($rule)
  }

  Set-Acl -LiteralPath $path -AclObject $acl
}

Wait-ForDocker

if (-not (Test-Path -LiteralPath $environmentPath)) {
  $encryptionKey = New-EncryptionKey
  $content = @(
    'N8N_IMAGE=docker.n8n.io/n8nio/n8n:stable'
    'N8N_PORT=5678'
    "N8N_ENCRYPTION_KEY=$encryptionKey"
  ) -join [Environment]::NewLine

  [IO.File]::WriteAllText(
    $environmentPath,
    $content + [Environment]::NewLine,
    [Text.UTF8Encoding]::new($false)
  )
  Protect-EnvironmentFile -path $environmentPath
  Write-Host 'Created a protected local .env file.' -ForegroundColor Green
}

if (-not (Test-Path -LiteralPath $feedEnvironmentPath)) {
  $automationSecret = New-EncryptionKey
  [IO.File]::WriteAllText(
    $feedEnvironmentPath,
    "NAWASRAH_AUTOMATION_SECRET=$automationSecret$([Environment]::NewLine)",
    [Text.UTF8Encoding]::new($false)
  )
  Protect-EnvironmentFile -path $feedEnvironmentPath
  Write-Host 'Created the protected Supabase-to-n8n feed secret.' -ForegroundColor Green
}

if (-not (Test-Path -LiteralPath $channelEnvironmentPath)) {
  $channelContent = @(
    'NAWASRAH_TELEGRAM_CHAT_ID='
    'NAWASRAH_WHATSAPP_RECIPIENT=962772838886'
  ) -join [Environment]::NewLine
  [IO.File]::WriteAllText(
    $channelEnvironmentPath,
    $channelContent + [Environment]::NewLine,
    [Text.UTF8Encoding]::new($false)
  )
  Protect-EnvironmentFile -path $channelEnvironmentPath
  Write-Host 'Created the protected notification destination settings.' -ForegroundColor Green
}

foreach ($protectedPath in @(
  $environmentPath,
  $feedEnvironmentPath,
  $channelEnvironmentPath
)) {
  Protect-EnvironmentFile -path $protectedPath
}

Push-Location $automationRoot
try {
  & docker.exe compose --env-file $environmentPath -f $composePath config --quiet
  if ($LASTEXITCODE -ne 0) {
    throw 'The n8n Docker Compose configuration is invalid.'
  }

  if (-not $SkipPull) {
    & docker.exe compose --env-file $environmentPath -f $composePath pull
    if ($LASTEXITCODE -ne 0) {
      throw 'Could not download the official n8n image.'
    }
  }

  & docker.exe compose --env-file $environmentPath -f $composePath up --detach
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not start n8n.'
  }
} finally {
  Pop-Location
}

for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
  try {
    $health = Invoke-WebRequest -Uri 'http://127.0.0.1:5678/healthz' -UseBasicParsing -TimeoutSec 3
    if ($health.StatusCode -eq 200) {
      Write-Host 'n8n is healthy at http://127.0.0.1:5678' -ForegroundColor Cyan
      Write-Host 'Create the owner account in the browser. Do not reuse the Supabase password.' -ForegroundColor Yellow
      exit 0
    }
  } catch {
    Start-Sleep -Seconds 3
  }
}

throw 'n8n started but did not become healthy. Run status.ps1 for details.'
