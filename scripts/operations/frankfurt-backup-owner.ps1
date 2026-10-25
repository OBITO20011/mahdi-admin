[CmdletBinding()]
param(
  [ValidateSet('Plan','Setup','Register','Backup','Upload','VerifyRemote','Restore','RestoreRemote','Watchdog','TestAlert','Status')][string]$Mode='Plan',
  [string]$ConfigPath='C:\ProgramData\NawasrahFrankfurtBackup\config.json',
  [switch]$Apply,
  [switch]$Force
)
$ErrorActionPreference='Stop'
$projectRef='kzevmysfydaslxcerogt'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$runtime=Join-Path $PSScriptRoot 'frankfurt-backup-runtime.mjs'
$node=(Get-Command node.exe -ErrorAction Stop).Source
if($Mode -eq 'Plan') { & $node $runtime Plan; exit $LASTEXITCODE }
if($Mode -notin @('Status') -and !$Apply) { throw 'Explicit -Apply is required. Default Plan is local and offline.' }
Add-Type -AssemblyName System.Security
function Require-Admin {
  $principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
  if(!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Run PowerShell as Administrator for Setup/Register.'}
}
function Read-Json([string]$File) { Get-Content -LiteralPath $File -Raw -Encoding UTF8|ConvertFrom-Json }
function Unprotect([string]$Value) {
  $bytes=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($Value),$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
  try { [Text.Encoding]::UTF8.GetString($bytes) } finally {[Array]::Clear($bytes,0,$bytes.Length)}
}
function Protect-Secure([Security.SecureString]$Value) {
  $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try {
    $plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $bytes=[Text.Encoding]::UTF8.GetBytes($plain)
    try { [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)) }
    finally {[Array]::Clear($bytes,0,$bytes.Length);$plain=$null}
  } finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)}
}
if($Mode -eq 'Setup') {
  Require-Admin
  if((Read-Host 'Type approved Frankfurt project reference') -cne $projectRef){throw 'PROJECT_CONFIRMATION_FAILED'}
  $legacyConfig=Join-Path $env:LOCALAPPDATA 'NawasrahBackup\config-machine.json'
  $legacy=Read-Json $legacyConfig
  if($legacy.protectionScope -ne 'LocalMachine'){throw 'Expected existing machine-protected legacy configuration.'}
  $root=Split-Path -Parent ([IO.Path]::GetFullPath($ConfigPath))
  if($root -eq [IO.Path]::GetFullPath((Split-Path -Parent $legacyConfig))){throw 'Refusing to overwrite legacy configuration.'}
  if(Test-Path -LiteralPath $ConfigPath){throw 'Frankfurt configuration already exists. Back it up and review before replacing; legacy is never changed.'}
  foreach($name in @('psql.exe','pg_dump.exe','pg_dumpall.exe')){if(!(Test-Path -LiteralPath (Join-Path $legacy.pgBinPath $name))){throw 'Native PostgreSQL 17 tools required.'}}
  $connection=Read-Host "Password-free connection URL (session pooler port 5432, or enter for direct db.$projectRef.supabase.co)"
  if(!$connection){$connection="postgresql://postgres@db.$projectRef.supabase.co:5432/postgres"}
  $uri=[uri]$connection
  $direct=$uri.Host -ceq "db.$projectRef.supabase.co" -and $uri.UserInfo -ceq 'postgres'
  $pooler=$uri.Host -cmatch '^aws-[0-9]+-[a-z]+-[a-z]+-[0-9]+\.pooler\.supabase\.com$' -and $uri.UserInfo -ceq "postgres.$projectRef"
  if($uri.Scheme -cne 'postgresql' -or !($direct -or $pooler) -or $uri.AbsolutePath -cne '/postgres' -or $uri.Query -or $uri.Fragment -or $uri.Port -notin @(-1,5432)){throw 'DATABASE_PROJECT_MISMATCH_OR_UNSAFE_URL'}
  $password=Read-Host 'Frankfurt database password (hidden, DPAPI-protected locally)' -AsSecureString
  if($password.Length -lt 8){throw 'Database password too short.'}
  New-Item -ItemType Directory -Path $root -Force|Out-Null
  $current=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  & icacls.exe $root '/inheritance:r' '/grant:r' "*$($current):(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F'|Out-Null
  if($LASTEXITCODE -ne 0){throw 'CONFIGURATION_ACL_FAILED'}
  $config=[ordered]@{formatVersion=1;projectRef=$projectRef;protectionScope='LocalMachine';connection=$connection;pgBinPath=$legacy.pgBinPath;backupRoot=(Join-Path $legacy.backupRoot "Frankfurt-$projectRef");stateRoot=$root;retentionCount=30;databasePassword=(Protect-Secure $password);archivePassphrase=$legacy.archivePassphrase;offsiteConfigPath='C:\ProgramData\NawasrahOffsiteBackup\config.json';developerConfigPath='C:\ProgramData\NawasrahDeveloperMonitoring\config.json';publishableKey='sb_publishable_d4TElxRQFkC-AZko3_ASeg_YotqxGjV';businessAlertsEnabled=$false;createdAt=[DateTimeOffset]::UtcNow.ToString('o')}
  $config|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $ConfigPath -Encoding UTF8
  @{projectRef=$projectRef;technicalRecipient='existing-developer-telegram';businessRecipient='shop-owner-at-go-live-only';businessAlertsEnabled=$false;storeOrderPushEnabled=$false;requiresSeparateOwnerActivation=$true}|ConvertTo-Json|Set-Content (Join-Path $root 'routing-plan.json') -Encoding UTF8
  $password.Dispose()
  Write-Host "Configured Frankfurt only. Save the EXISTING archive passphrase offline for emergency recovery; DPAPI cannot move to another PC. No connection or schedule started. Config: $ConfigPath"
  exit 0
}
$config=Read-Json $ConfigPath
if($config.projectRef -cne $projectRef -or $config.protectionScope -ne 'LocalMachine' -or $config.businessAlertsEnabled -ne $false){throw 'FRANKFURT_CONFIG_REJECTED'}
if($Mode -eq 'Register') {
  Require-Admin
  if($ConfigPath.Contains('"') -or $runtime.Contains('"')){throw 'Invalid task path.'}
  $runner=Join-Path $PSScriptRoot 'frankfurt-backup-owner.ps1'
  $principal=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 10)
  $jobs=@(@{mode='Backup';time='23:50'},@{mode='Upload';time='02:35'},@{mode='VerifyRemote';time='03:10'},@{mode='RestoreRemote';time='03:50'},@{mode='Watchdog';time='00:03'})
  foreach($job in $jobs){
    $taskName="Nawasrah Frankfurt $($job.mode)"
    $action=New-ScheduledTaskAction -Execute (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe') -Argument "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$runner`" -Mode $($job.mode) -ConfigPath `"$ConfigPath`" -Apply" -WorkingDirectory $repo
    $trigger=if($job.mode -eq 'VerifyRemote'){New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At $job.time}else{New-ScheduledTaskTrigger -Daily -At $job.time}
    if($job.mode -eq 'Watchdog'){
      $trigger=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes 5)
    }
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Frankfurt $projectRef $($job.mode); developer technical routing; legacy tasks untouched." -Force|Out-Null
    $registered=Get-ScheduledTask -TaskName $taskName
    if($registered.Principal.UserId -notin @('SYSTEM','S-1-5-18')){throw 'TASK_PRINCIPAL_MISMATCH'}
  }
  $jobs|ForEach-Object {Get-ScheduledTask -TaskName "Nawasrah Frankfurt $($_.mode)"}|Select-Object TaskName,State
  Write-Host 'Only the five Frankfurt tasks registered. Legacy tasks unchanged. First backup/restore/test alert are manual owner steps.'
  exit 0
}
$names=@('NAWASRAH_FF_CONFIG','NAWASRAH_FF_DB_PASSWORD','NAWASRAH_FF_PASSPHRASE','NAWASRAH_R2_ACCOUNT_ID','NAWASRAH_R2_ACCESS_KEY_ID','NAWASRAH_R2_SECRET_ACCESS_KEY','NAWASRAH_DEV_TELEGRAM_BOT_TOKEN','NAWASRAH_DEV_TELEGRAM_CHAT_ID')
try {
  $env:NAWASRAH_FF_CONFIG=$ConfigPath
  if($Mode -in @('Backup','Watchdog')){$env:NAWASRAH_FF_DB_PASSWORD=Unprotect $config.databasePassword}
  if($Mode -in @('Backup','Upload','VerifyRemote','Restore','RestoreRemote')){$env:NAWASRAH_FF_PASSPHRASE=Unprotect $config.archivePassphrase}
  if($Mode -in @('Upload','VerifyRemote','RestoreRemote')){
    $r2=Read-Json $config.offsiteConfigPath
    if($r2.protectionScope -ne 'LocalMachine' -or $r2.bucket -ne 'nawasrah-offsite-backups' -or $r2.jurisdiction -ne 'eu'){throw 'R2_CONFIG_REJECTED'}
    $env:NAWASRAH_R2_ACCOUNT_ID=$r2.accountId
    $env:NAWASRAH_R2_ACCESS_KEY_ID=Unprotect $r2.accessKeyId
    $env:NAWASRAH_R2_SECRET_ACCESS_KEY=Unprotect $r2.secretAccessKey
  }
  if($Mode -in @('Watchdog','TestAlert')){
    $dev=Read-Json $config.developerConfigPath
    if($dev.protectionScope -ne 'LocalMachine'){throw 'DEVELOPER_CONFIG_REJECTED'}
    $env:NAWASRAH_DEV_TELEGRAM_BOT_TOKEN=Unprotect $dev.telegramBotToken
    $env:NAWASRAH_DEV_TELEGRAM_CHAT_ID=$dev.telegramChatId
  }
  $extra=@();if($Force){$extra+='--force'}
  & $node $runtime $Mode @extra
  if($LASTEXITCODE -ne 0){throw "Frankfurt $Mode failed. See protected local status reports; credentials are never printed."}
} finally {foreach($name in $names){Remove-Item "Env:$name" -ErrorAction SilentlyContinue};$config=$null;$r2=$null;$dev=$null}
