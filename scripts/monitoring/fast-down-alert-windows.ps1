
Add-Type -AssemblyName System.Security -ErrorAction Stop

function Get-FastDownRoot {
  Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'NawasrahFastDownAlert'
}

function Protect-FastDownValue([string]$Value) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
  try {
    $sealed = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, 'LocalMachine')
    [Convert]::ToBase64String($sealed)
  } finally { [Array]::Clear($bytes, 0, $bytes.Length) }
}

function Unprotect-FastDownValue([string]$Value) {
  $sealed = [Convert]::FromBase64String($Value)
  $bytes = [Security.Cryptography.ProtectedData]::Unprotect($sealed, $null, 'LocalMachine')
  try { [Text.Encoding]::UTF8.GetString($bytes) }
  finally { [Array]::Clear($bytes, 0, $bytes.Length) }
}

function Read-FastDownHidden([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $secure.Dispose()
  }
}

function Assert-FastDownDatabase([string]$Origin, [string]$Key) {
  if ($Origin -cnotmatch '^https://[a-z0-9]{20}\.supabase\.co/?$') {
    throw 'FAST_DOWN_DATABASE_ORIGIN_INVALID'
  }
  if ($Key -cmatch '^sb_publishable_[A-Za-z0-9_-]{16,}$') { return }
  try {
    if ($Key -cmatch '^eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+$') {
      $part = $Key.Split('.')[1].Replace('-', '+').Replace('_', '/')
      $part = $part.PadRight($part.Length + (4 - $part.Length % 4) % 4, '=')
      $claims = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($part)) | ConvertFrom-Json
      if ($claims.role -ceq 'anon') { return }
    }
  } catch { }
  throw 'FAST_DOWN_PUBLIC_KEY_REQUIRED'
}

function Assert-FastDownTelegram([string]$Token, [string]$ChatId) {
  if ($Token -cnotmatch '^\d+:[A-Za-z0-9_-]{20,}$' -or $ChatId -cnotmatch '^[1-9]\d*$') {
    throw 'FAST_DOWN_DEVELOPER_TELEGRAM_INVALID'
  }
}

function Read-FastDownDeveloperConfig {
  $base = [Environment]::GetFolderPath('CommonApplicationData')
  $file = Join-Path $base 'NawasrahDeveloperMonitoring\config.json'
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return }
  $config = Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($config.protectionScope -cne 'LocalMachine' -or $config.formatVersion -ne 1) {
    throw 'FAST_DOWN_DEVELOPER_CONFIG_INVALID'
  }
  if (-not $config.telegramBotToken -and -not $config.telegramChatId) { return }
  $token = Unprotect-FastDownValue $config.telegramBotToken
  $chatId = ([string]$config.telegramChatId).Trim()
  Assert-FastDownTelegram $token $chatId
  @{ Token = $token; ChatId = $chatId }
}

function Initialize-FastDownPrivateRoot([string]$Root) {
  $admin = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
  $system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
  if (-not (Test-Path -LiteralPath $Root)) {
    $desired = [Security.AccessControl.DirectorySecurity]::new()
    $desired.SetOwner($admin)
    $desired.SetAccessRuleProtection($true, $false)
    foreach ($sid in @($admin, $system)) {
      $rule = [Security.AccessControl.FileSystemAccessRule]::new(
        $sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'
      )
      $desired.AddAccessRule($rule)
    }
    $null = [IO.Directory]::CreateDirectory($Root, $desired)
  }
  Assert-FastDownPrivateRoot $Root
}

function Assert-FastDownPrivateRoot([string]$Root) {
  $item = Get-Item -LiteralPath $Root -Force
  if (-not $item.PSIsContainer -or $item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw 'FAST_DOWN_PRIVATE_ROOT_INVALID'
  }
  $acl = [IO.Directory]::GetAccessControl($Root)
  $approved = @('S-1-5-32-544', 'S-1-5-18')
  $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
  $owners = @($rules | ForEach-Object { $_.IdentityReference.Value } | Sort-Object -Unique)
  if (-not $acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $approved -or
      $owners.Count -ne 2 -or $rules.Count -ne 2 -or
      @($rules | Where-Object {
        $_.IdentityReference.Value -notin $approved -or $_.IsInherited -or $_.AccessControlType -ne 'Allow' -or
        $_.FileSystemRights -ne 'FullControl' -or $_.InheritanceFlags -ne 'ContainerInherit,ObjectInherit' -or
        $_.PropagationFlags -ne 'None'
      }).Count -ne 0) {
    throw 'FAST_DOWN_PRIVATE_ROOT_ACL_INVALID'
  }
}

function Get-FastDownNode {
  $programFiles = [Environment]::GetFolderPath('ProgramFiles')
  $node = Join-Path $programFiles 'nodejs\node.exe'
  if (-not (Test-Path -LiteralPath $node -PathType Leaf)) { throw 'FAST_DOWN_SYSTEM_NODE_REQUIRED' }
  $node
}

function Read-FastDownChildEnvironment([string]$Root, [scriptblock]$ReadDeveloper = { Read-FastDownDeveloperConfig }) {
  $target = Get-Content -LiteralPath (Join-Path $Root 'targets.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($target.protectionScope -cne 'LocalMachine' -or $target.formatVersion -ne 1 -or
      $target.stateId -cnotmatch '^[a-f0-9]{32}$') {
    throw 'FAST_DOWN_TARGETS_INVALID'
  }
  $storefront = Unprotect-FastDownValue $target.storefrontOrigin
  $admin = Unprotect-FastDownValue $target.adminOrigin
  $database = Unprotect-FastDownValue $target.supabaseOrigin
  $key = Unprotect-FastDownValue $target.anonKey
  if ($storefront -cne 'https://alnawasreh.com' -or $admin -cne 'https://admin.alnawasreh.com') {
    throw 'FAST_DOWN_TARGETS_INVALID'
  }
  Assert-FastDownDatabase $database $key
  if ($target.telegramSource -ceq 'developer-monitoring') {
    $dev = & $ReadDeveloper
    if (-not $dev) { throw 'FAST_DOWN_DEVELOPER_CONFIG_REQUIRED' }
  } elseif ($target.telegramSource -ceq 'dedicated') {
    $dev = @{
      Token = Unprotect-FastDownValue $target.telegramBotToken
      ChatId = Unprotect-FastDownValue $target.telegramChatId
    }
  } else { throw 'FAST_DOWN_TARGETS_INVALID' }
  Assert-FastDownTelegram $dev.Token $dev.ChatId
  @{
    DEV_FAST_DOWN_STOREFRONT_ORIGIN = $storefront
    DEV_FAST_DOWN_ADMIN_ORIGIN = $admin
    DEV_FAST_DOWN_SUPABASE_ORIGIN = $database
    DEV_FAST_DOWN_ANON_KEY = $key
    DEV_FAST_DOWN_STATE_FILE = Join-Path $Root ('state-{0}.json' -f $target.stateId)
    DEV_TELEGRAM_BOT_TOKEN = $dev.Token
    DEV_TELEGRAM_CHAT_ID = $dev.ChatId
  }
}

function New-FastDownStartInfo([string]$Node, [string]$Script, [string]$Root, [hashtable]$Values) {
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $Node
  $start.Arguments = '"{0}"' -f $Script
  $start.WorkingDirectory = $Root
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $start.EnvironmentVariables.Clear()
  $start.EnvironmentVariables['SystemRoot'] = [Environment]::GetFolderPath('Windows')
  $start.EnvironmentVariables['TEMP'] = $Root
  $start.EnvironmentVariables['TMP'] = $Root
  foreach ($name in $Values.Keys) { $start.EnvironmentVariables[$name] = $Values[$name] }
  $start
}
