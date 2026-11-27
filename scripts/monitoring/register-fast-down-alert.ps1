[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$windows = [Environment]::GetFolderPath('Windows')
$powershell = Join-Path $windows 'System32\WindowsPowerShell\v1.0\powershell.exe'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  try {
    $argumentLine = '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $PSCommandPath
    $elevated = Start-Process $powershell -ArgumentList $argumentLine -Verb RunAs -Wait -PassThru
    exit $elevated.ExitCode
  } catch {
    Write-Host 'FAST_DOWN_ELEVATION_FAILED'
    exit 1
  }
}

$stage = 'dependencies'
try {
  . (Join-Path $PSScriptRoot 'fast-down-alert-windows.ps1')
  Import-Module (Join-Path $PSHome 'Modules\ScheduledTasks\ScheduledTasks.psd1')
  $null = Get-FastDownNode
  $repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  $root = Get-FastDownRoot
  if (Test-Path -LiteralPath $root) { Assert-FastDownPrivateRoot $root }

  $stage = 'developer-config'
  $dev = Read-FastDownDeveloperConfig
  $telegramSource = 'developer-monitoring'
  if (-not $dev) {
    $telegramSource = 'dedicated'
    $previousPath = Join-Path $root 'targets.json'
    if (Test-Path -LiteralPath $previousPath -PathType Leaf) {
      $previous = Get-Content -LiteralPath $previousPath -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($previous.telegramSource -ceq 'dedicated') {
        $previousEnv = Read-FastDownChildEnvironment $root
        try { $dev = @{ Token = $previousEnv.DEV_TELEGRAM_BOT_TOKEN; ChatId = $previousEnv.DEV_TELEGRAM_CHAT_ID } }
        finally { $previousEnv.Clear() }
      }
    }
    if (-not $dev) {
      $dev = @{
        Token = Read-FastDownHidden 'Dedicated DEVELOPER Telegram bot token (not shop owner)'
        ChatId = (Read-FastDownHidden 'Private DEVELOPER Telegram chat ID').Trim()
      }
    }
    Assert-FastDownTelegram $dev.Token $dev.ChatId
  }
  if ((Read-Host 'Confirm the bot and private chat belong only to the developer. Type DEVELOPER') -cne 'DEVELOPER') {
    throw 'FAST_DOWN_DEVELOPER_CONFIRMATION_REQUIRED'
  }

  $stage = 'targets'
  Write-Host 'Storefront: https://alnawasreh.com | Admin: https://admin.alnawasreh.com'
  $database = (Read-Host 'Supabase HTTPS origin used by the currently served public builds').Trim()
  $anonKey = (Read-FastDownHidden 'Publishable / anon key for that same project').Trim()
  Assert-FastDownDatabase $database $anonKey
  $target = [ordered]@{
    formatVersion = 1
    protectionScope = 'LocalMachine'
    telegramSource = $telegramSource
    stateId = [Guid]::NewGuid().ToString('N')
    storefrontOrigin = Protect-FastDownValue 'https://alnawasreh.com'
    adminOrigin = Protect-FastDownValue 'https://admin.alnawasreh.com'
    supabaseOrigin = Protect-FastDownValue $database
    anonKey = Protect-FastDownValue $anonKey
  }
  if ($telegramSource -eq 'dedicated') {
    $target.telegramBotToken = Protect-FastDownValue $dev.Token
    $target.telegramChatId = Protect-FastDownValue $dev.ChatId
  }

  $stage = 'installation'
  Initialize-FastDownPrivateRoot $root
  # Stage under the restricted root. SYSTEM never runs a mutable checkout.
  $installed = Join-Path $root ('release-{0}' -f $target.stateId)
  $files = @(
    'scripts\monitoring\fast-down-alert-windows.ps1',
    'scripts\monitoring\run-fast-down-alert.ps1',
    'scripts\monitoring\fast-down-alert.mjs',
    'scripts\monitoring\developer-alert-core.mjs',
    'scripts\agent\atomic-file.mjs'
  )
  foreach ($relative in $files) {
    $destination = Join-Path $installed $relative
    $null = [IO.Directory]::CreateDirectory((Split-Path -Parent $destination))
    Copy-Item -LiteralPath (Join-Path $repo $relative) -Destination $destination
  }
  $configFile = Join-Path $root 'targets.json'
  $tempConfig = Join-Path $root ('targets-{0}.tmp' -f $target.stateId)
  try {
    [IO.File]::WriteAllText($tempConfig, ($target | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    if (Test-Path -LiteralPath $configFile) {
      $oldConfig = Join-Path $root ('targets-{0}.prior' -f $target.stateId)
      [IO.File]::Replace($tempConfig, $configFile, $oldConfig)
      Remove-Item -LiteralPath $oldConfig
    } else { [IO.File]::Move($tempConfig, $configFile) }
  } finally {
    if (Test-Path -LiteralPath $tempConfig) { Remove-Item -LiteralPath $tempConfig }
  }
  $validated = Read-FastDownChildEnvironment $root
  $validated.Clear()

  $stage = 'registration'
  $runner = Join-Path $installed 'scripts\monitoring\run-fast-down-alert.ps1'
  $taskName = 'Nawasrah Fast Down Alert'
  $argument = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}"' -f $runner
  $action = New-ScheduledTaskAction -Execute $powershell -Argument $argument -WorkingDirectory $root
  $interval = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
  $startup = New-ScheduledTaskTrigger -AtStartup
  $limits = @{
    StartWhenAvailable = $true
    MultipleInstances = 'IgnoreNew'
    AllowStartIfOnBatteries = $true
    DontStopIfGoingOnBatteries = $true
    ExecutionTimeLimit = New-TimeSpan -Seconds 35
  }
  $settings = New-ScheduledTaskSettingsSet @limits
  $taskPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $task = @{
    TaskName = $taskName
    Action = $action
    Trigger = @($interval, $startup)
    Settings = $settings
    Principal = $taskPrincipal
    Description = 'Developer-only Nawasrah public availability.'
    Force = $true
  }
  Register-ScheduledTask @task | Out-Null
  $registered = Get-ScheduledTask -TaskName $taskName
  if ($registered.Principal.UserId -notin @('SYSTEM','NT AUTHORITY\SYSTEM','S-1-5-18') -or
      $registered.Settings.MultipleInstances -ne 'IgnoreNew' -or $registered.Triggers.Count -ne 2) {
    throw 'FAST_DOWN_TASK_VERIFICATION_FAILED'
  }
  Write-Host 'FAST_DOWN_REGISTERED: SYSTEM, one minute, and startup.'
} catch {
  Write-Host ('FAST_DOWN_REGISTER_FAILED stage={0}' -f $stage)
  exit 1
} finally {
  $anonKey = $null
  if ($dev) { $dev.Clear() }
}
