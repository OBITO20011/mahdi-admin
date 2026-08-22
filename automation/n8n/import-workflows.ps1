[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$ProjectId
)

$ErrorActionPreference = 'Stop'
$automationRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$workflowPath = Join-Path $automationRoot 'workflows\nawasrah-alerts.json'
$channelEnvironmentPath = Join-Path $automationRoot '.env.channels'
$temporaryWorkflowPath = Join-Path ([IO.Path]::GetTempPath()) "nawasrah-alert-workflows-$([Guid]::NewGuid().ToString('N')).json"
$containerPath = '/tmp/nawasrah-alert-workflows.json'

function Read-EnvironmentSettings([string]$Path) {
  $settings = @{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith('#')) {
      continue
    }
    $separator = $line.IndexOf('=')
    if ($separator -lt 1) {
      continue
    }
    $settings[$line.Substring(0, $separator).Trim()] = $line.Substring($separator + 1).Trim()
  }
  return $settings
}

try {
  if (-not (Test-Path -LiteralPath $channelEnvironmentPath)) {
    throw 'Run setup.ps1 first to create the protected .env.channels file.'
  }

  $channelSettings = Read-EnvironmentSettings -Path $channelEnvironmentPath
  $telegramChatId = [string]$channelSettings['NAWASRAH_TELEGRAM_CHAT_ID']
  $whatsappRecipient = [string]$channelSettings['NAWASRAH_WHATSAPP_RECIPIENT']

  if ($telegramChatId -and $telegramChatId -notmatch '^-?\d+$') {
    throw 'NAWASRAH_TELEGRAM_CHAT_ID must contain only a numeric Telegram Chat ID.'
  }
  if ($whatsappRecipient -notmatch '^\d{8,15}$') {
    throw 'NAWASRAH_WHATSAPP_RECIPIENT must use international digits only.'
  }

  $workflowContent = Get-Content -LiteralPath $workflowPath -Raw
  if ($telegramChatId) {
    $workflowContent = $workflowContent.Replace(
      'REPLACE_WITH_TELEGRAM_CHAT_ID',
      $telegramChatId
    )
  }
  $workflowContent = $workflowContent.Replace(
    'REPLACE_WITH_WHATSAPP_RECIPIENT',
    $whatsappRecipient
  )
  [IO.File]::WriteAllText(
    $temporaryWorkflowPath,
    $workflowContent,
    [Text.UTF8Encoding]::new($false)
  )

  $workflows = $workflowContent | ConvertFrom-Json
  if ($workflows.Count -ne 2) {
    throw 'Expected exactly two Nawasrah alert workflows.'
  }
  foreach ($workflow in $workflows) {
    if ($workflow.active) {
      throw 'Alert workflows must be imported inactive.'
    }
  }

  & docker.exe cp $temporaryWorkflowPath "nawasrah-n8n:$containerPath"
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not copy the workflows into n8n.'
  }

  & docker.exe exec nawasrah-n8n n8n import:workflow `
    --input=$containerPath `
    --projectId=$ProjectId
  if ($LASTEXITCODE -ne 0) {
    throw 'n8n rejected the alert workflow import.'
  }

  Write-Host 'Imported Telegram and WhatsApp alert workflows as inactive.' `
    -ForegroundColor Green
}
finally {
  & docker.exe exec --user root nawasrah-n8n rm -f $containerPath 2>$null
  Remove-Item -LiteralPath $temporaryWorkflowPath -Force -ErrorAction SilentlyContinue
}
