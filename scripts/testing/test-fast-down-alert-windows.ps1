[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$monitoring = Join-Path $PSScriptRoot '..\monitoring'
foreach ($file in @('fast-down-alert-windows.ps1','run-fast-down-alert.ps1','register-fast-down-alert.ps1')) {
  $tokens = $errors = $null
  $null = [Management.Automation.Language.Parser]::ParseFile((Join-Path $monitoring $file), [ref]$tokens, [ref]$errors)
  if ($errors.Count) { throw 'FIXTURE_PARSE_FAILED' }
}
. (Join-Path $monitoring 'fast-down-alert-windows.ps1')

function Assert-Rejected([scriptblock]$Check, [string]$Code) {
  try { & $Check } catch {
    if ($_.Exception.Message -ceq $Code) { return }
    throw ('FIXTURE_WRONG_DIAGNOSTIC expected={0} actual={1}' -f $Code, $_.FullyQualifiedErrorId)
  }
  throw 'FIXTURE_EXPECTED_REJECTION'
}

$root = Join-Path ([IO.Path]::GetTempPath()) ('nawasrah-fast-alert-test-'+[Guid]::NewGuid().ToString('N'))
$null = [IO.Directory]::CreateDirectory($root)
$oldOwnerToken = $env:OWNER_TELEGRAM_BOT_TOKEN
try {
  $db = 'https://abcdefghijklmnopqrst.supabase.co'
  $key = 'sb_publishable_' + 'fixture_not_a_credential'
  $developerToken = ('100001', 'fixture_developer_only_value') -join ':'
  $developerChat = '411111'
  $env:OWNER_TELEGRAM_BOT_TOKEN = 'SYNTHETIC_OWNER_TOKEN'
  $target = [ordered]@{
    formatVersion = 1
    protectionScope = 'LocalMachine'
    telegramSource = 'developer-monitoring'
    stateId = '0123456789abcdef0123456789abcdef'
    storefrontOrigin = Protect-FastDownValue 'https://alnawasreh.com'
    adminOrigin = Protect-FastDownValue 'https://admin.alnawasreh.com'
    supabaseOrigin = Protect-FastDownValue $db
    anonKey = Protect-FastDownValue $key
  }
  $targetPath = Join-Path $root 'targets.json'
  $target | ConvertTo-Json | Set-Content -LiteralPath $targetPath -Encoding UTF8
  $dev = { @{Token = $developerToken; ChatId = $developerChat} }
  $envForChild = Read-FastDownChildEnvironment $root $dev
  if ($envForChild.DEV_TELEGRAM_BOT_TOKEN -cne $developerToken -or
      $envForChild.DEV_FAST_DOWN_ANON_KEY -cne $key -or
      $envForChild.DEV_FAST_DOWN_STATE_FILE -ne (Join-Path $root ('state-' + $target.stateId + '.json'))) {
    throw 'FIXTURE_CONFIG_ROUNDTRIP_FAILED'
  }
  if ($target.anonKey.Contains($key) -or $target.supabaseOrigin.Contains($db)) {
    throw 'FIXTURE_CONFIG_PLAINTEXT'
  }
  Assert-Rejected { Read-FastDownChildEnvironment $root { } } 'FAST_DOWN_DEVELOPER_CONFIG_REQUIRED'
  Assert-Rejected { Assert-FastDownDatabase $db ('sb_secret_' + 'synthetic_fixture') } 'FAST_DOWN_PUBLIC_KEY_REQUIRED'
  Assert-Rejected { Assert-FastDownDatabase 'https://unapproved.example.test' $key } 'FAST_DOWN_DATABASE_ORIGIN_INVALID'
  Assert-Rejected { Assert-FastDownPrivateRoot $root } 'FAST_DOWN_PRIVATE_ROOT_ACL_INVALID'

  $fixture = Join-Path $root 'child.cjs'
  @'
const ok = Boolean(process.env.DEV_TELEGRAM_BOT_TOKEN) &&
  process.env.DEV_TELEGRAM_CHAT_ID === '411111' &&
  process.env.OWNER_TELEGRAM_BOT_TOKEN === undefined &&
  process.env.NODE_OPTIONS === undefined;
process.stdout.write(ok ? 'OK' : 'FAILED');
process.exitCode = ok ? 0 : 1;
'@ | Set-Content -LiteralPath $fixture -Encoding ASCII
  $info = New-FastDownStartInfo (Get-Command node.exe).Source $fixture $root $envForChild
  $child = [Diagnostics.Process]::Start($info)
  try {
    if (-not $child.WaitForExit(5000) -or $child.ExitCode -ne 0 -or $child.StandardOutput.ReadToEnd() -cne 'OK') {
      throw 'FIXTURE_PROCESS_ENV_FAILED'
    }
  } finally {
    if (-not $child.HasExited) { $child.Kill() }
    $child.Dispose()
    $info.EnvironmentVariables.Clear()
    $envForChild.Clear()
  }
  if ($env:OWNER_TELEGRAM_BOT_TOKEN -cne 'SYNTHETIC_OWNER_TOKEN' -or
      $env:DEV_TELEGRAM_BOT_TOKEN -ceq $developerToken) {
    throw 'FIXTURE_PARENT_ENV_CHANGED'
  }

  $target.telegramSource = 'dedicated'
  $target.telegramBotToken = Protect-FastDownValue $developerToken
  $target.telegramChatId = Protect-FastDownValue $developerChat
  $target | ConvertTo-Json | Set-Content -LiteralPath $targetPath -Encoding UTF8
  $dedicated = Read-FastDownChildEnvironment $root { throw 'FIXTURE_READ_UNEXPECTED' }
  if ($dedicated.DEV_TELEGRAM_CHAT_ID -cne $developerChat) { throw 'FIXTURE_DEDICATED_CONFIG_FAILED' }
  $dedicated.Clear()
  $target.protectionScope = 'CurrentUser'
  $target | ConvertTo-Json | Set-Content -LiteralPath $targetPath -Encoding UTF8
  Assert-Rejected { Read-FastDownChildEnvironment $root $dev } 'FAST_DOWN_TARGETS_INVALID'

  # Local CIM definitions only. Do not register or start a task.
  Import-Module (Join-Path $PSHome 'Modules\ScheduledTasks\ScheduledTasks.psd1')
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
  if ($trigger.Repetition.Interval -ne 'PT1M' -or $trigger.Repetition.Duration) {
    throw 'FIXTURE_TASK_REPETITION_INVALID'
  }
  Write-Output 'FAST_DOWN_WINDOWS_FIXTURES_OK'
} finally {
  $env:OWNER_TELEGRAM_BOT_TOKEN = $oldOwnerToken
  $temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
  $resolved = (Get-Item -LiteralPath $root).FullName
  if ((Split-Path -Parent $resolved) -ne $temp -or
      (Split-Path -Leaf $resolved) -notmatch '^nawasrah-fast-alert-test-[a-f0-9]{32}$') {
    throw 'FIXTURE_CLEANUP_PATH_INVALID'
  }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}
