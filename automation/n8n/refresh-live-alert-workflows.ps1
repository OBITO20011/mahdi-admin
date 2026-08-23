[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$ProjectId,

  [ValidateSet('nawasrahTelegramAlerts', 'nawasrahWhatsappAlerts')]
  [string[]]$WorkflowId = @('nawasrahTelegramAlerts', 'nawasrahWhatsappAlerts')
)

$ErrorActionPreference = 'Stop'
$automationRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$workflowPath = Join-Path $automationRoot 'workflows\nawasrah-alerts.json'
$temporaryLivePath = Join-Path ([IO.Path]::GetTempPath()) "nawasrah-live-alerts-$([Guid]::NewGuid().ToString('N')).json"
$temporaryMergedPath = Join-Path ([IO.Path]::GetTempPath()) "nawasrah-refreshed-alerts-$([Guid]::NewGuid().ToString('N')).json"
$containerLivePath = '/tmp/nawasrah-live-alerts.json'
$containerMergedPath = '/tmp/nawasrah-refreshed-alerts.json'

function Get-WorkflowNode($Workflow, [string]$NodeId) {
  $node = @($Workflow.nodes | Where-Object { $_.id -eq $NodeId }) | Select-Object -First 1
  if ($null -eq $node) {
    throw "Expected node '$NodeId' was not found in workflow '$($Workflow.id)'."
  }

  return $node
}

function Get-WorkflowById($Workflows, [string]$WorkflowId) {
  $workflow = @($Workflows | Where-Object { $_.id -eq $WorkflowId }) | Select-Object -First 1
  if ($null -eq $workflow) {
    throw "The live n8n workflow '$WorkflowId' was not found. No changes were made."
  }

  return $workflow
}

try {
  if (-not (Test-Path -LiteralPath $workflowPath)) {
    throw 'The Nawasrah alert workflow template is missing.'
  }

  # Read the source template explicitly as UTF-8. Arabic must not be passed
  # through the Windows ANSI code page.
  $templateWorkflows = Get-Content -LiteralPath $workflowPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if (@($templateWorkflows).Count -ne 2) {
    throw 'Expected exactly two Nawasrah alert workflow templates.'
  }
  $selectedTemplateWorkflows = @($templateWorkflows | Where-Object { $WorkflowId -contains $_.id })
  if ($selectedTemplateWorkflows.Count -ne $WorkflowId.Count) {
    throw 'One or more requested alert workflow templates were not found.'
  }

  & docker.exe exec nawasrah-n8n n8n export:workflow --all --output=$containerLivePath
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not export the current n8n workflows.'
  }

  & docker.exe cp "nawasrah-n8n:$containerLivePath" $temporaryLivePath
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not copy the current n8n workflows for a safe refresh.'
  }

  $liveWorkflows = Get-Content -LiteralPath $temporaryLivePath -Raw -Encoding UTF8 | ConvertFrom-Json
  $mergedWorkflows = @()

  foreach ($templateWorkflow in $selectedTemplateWorkflows) {
    $liveWorkflow = Get-WorkflowById -Workflows $liveWorkflows -WorkflowId $templateWorkflow.id
    if ($liveWorkflow.active) {
      throw "Workflow '$($liveWorkflow.name)' is active. Refresh it in the n8n editor so regular-mode import cannot accidentally deactivate it."
    }

    foreach ($nodeId in @('telegram-send', 'telegram-note', 'whatsapp-send', 'whatsapp-note')) {
      $templateNode = @($templateWorkflow.nodes | Where-Object { $_.id -eq $nodeId }) | Select-Object -First 1
      if ($null -eq $templateNode) {
        continue
      }

      $liveNode = Get-WorkflowNode -Workflow $liveWorkflow -NodeId $nodeId
      if ($nodeId -eq 'telegram-send') {
        $liveNode.parameters.text = $templateNode.parameters.text
      }
      elseif ($nodeId -eq 'whatsapp-send') {
        $liveNode.parameters.textBody = $templateNode.parameters.textBody
      }
      else {
        $liveNode.parameters.content = $templateNode.parameters.content
      }
    }

    # Keep the actual node credentials and activation state. Only the message
    # templates above are refreshed, so the working Telegram bot stays linked.
    $mergedWorkflows += [PSCustomObject]@{
      id          = $liveWorkflow.id
      name        = $liveWorkflow.name
      active      = [bool]$liveWorkflow.active
      nodes       = $liveWorkflow.nodes
      connections = $liveWorkflow.connections
      settings    = $liveWorkflow.settings
      versionId   = $liveWorkflow.versionId
      meta        = $liveWorkflow.meta
      tags        = $liveWorkflow.tags
    }
  }

  $mergedContent = $mergedWorkflows | ConvertTo-Json -Depth 100
  [IO.File]::WriteAllText(
    $temporaryMergedPath,
    $mergedContent,
    [Text.UTF8Encoding]::new($false)
  )

  & docker.exe cp $temporaryMergedPath "nawasrah-n8n:$containerMergedPath"
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not copy the refreshed alert workflows into n8n.'
  }

  & docker.exe exec nawasrah-n8n n8n import:workflow `
    --input=$containerMergedPath `
    --projectId=$ProjectId
  if ($LASTEXITCODE -ne 0) {
    throw 'n8n rejected the refreshed alert workflow import.'
  }

  & docker.exe exec nawasrah-n8n n8n export:workflow --all --output=$containerLivePath
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not verify the refreshed n8n workflows.'
  }

  & docker.exe cp "nawasrah-n8n:$containerLivePath" $temporaryLivePath
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not copy the refreshed n8n workflows for verification.'
  }

  $verifiedWorkflows = Get-Content -LiteralPath $temporaryLivePath -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($templateWorkflow in $selectedTemplateWorkflows) {
    $verifiedWorkflow = Get-WorkflowById -Workflows $verifiedWorkflows -WorkflowId $templateWorkflow.id
    $templateSendNode = @($templateWorkflow.nodes | Where-Object { $_.id -like '*-send' }) | Select-Object -First 1
    $verifiedSendNode = @($verifiedWorkflow.nodes | Where-Object { $_.id -eq $templateSendNode.id }) | Select-Object -First 1

    $templateText = if ($templateSendNode.id -eq 'telegram-send') { $templateSendNode.parameters.text } else { $templateSendNode.parameters.textBody }
    $verifiedText = if ($verifiedSendNode.id -eq 'telegram-send') { $verifiedSendNode.parameters.text } else { $verifiedSendNode.parameters.textBody }
    if ($verifiedText -ne $templateText) {
      throw "UTF-8 verification failed for workflow '$($templateWorkflow.id)'."
    }
  }

  Write-Host 'Refreshed the Arabic Telegram and WhatsApp alert templates safely.' -ForegroundColor Green
}
finally {
  & docker.exe exec --user root nawasrah-n8n rm -f $containerLivePath $containerMergedPath 2>$null
  Remove-Item -LiteralPath $temporaryLivePath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $temporaryMergedPath -Force -ErrorAction SilentlyContinue
}
