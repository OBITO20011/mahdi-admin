# No import side effects. Synthetic tests inject a decryptor;the owner entrypoint
# always uses LocalMachine DPAPI and never exposes its input/output in errors.
function Throw-OwnerFailure([string]$Category,[string]$Variable='') {
  $errorObject=[InvalidOperationException]::new($Category)
  $errorObject.Data['OwnerCategory']=$Category
  $errorObject.Data['OwnerVariable']=$Variable
  throw $errorObject
}
function Unprotect-OwnerValue([string]$Value,[string]$Variable,[scriptblock]$Decryptor={param($bytes) [Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)}) {
  $bytes=$null;$plain=$null
  try {
    $bytes=[Convert]::FromBase64String($Value)
    $plain=& $Decryptor $bytes
    [Text.Encoding]::UTF8.GetString($plain)
  } catch { Throw-OwnerFailure 'DPAPI_UNPROTECT_FAILED' $Variable }
  finally {if($bytes){[Array]::Clear($bytes,0,$bytes.Length)};if($plain){[Array]::Clear($plain,0,$plain.Length)}}
}
function Remove-OwnerOrphanLock([string]$Root,[ValidateSet('backup-offsite.lock','monitor.lock')][string]$Name='backup-offsite.lock') {
  $file=Join-Path ([IO.Path]::GetFullPath($Root)) $Name
  $stream=$null
  try {
    # Share Delete permits our unlink while excluding every other reader/writer.
    # On Windows the name remains delete-pending until this handle closes:
    # another operation cannot acquire a replacement during PID-check/delete.
    try {$stream=[IO.FileStream]::new($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Delete)}
    catch [IO.FileNotFoundException] {return @{ok=$true;mode='CleanupLock';removed=$false;reason='LOCK_NOT_PRESENT'}}
    catch {Throw-OwnerFailure 'LOCKED'}
    if($stream.Length -lt 2 -or $stream.Length -gt 4096){Throw-OwnerFailure 'LOCK_FILE_INVALID'}
    $bytes=[byte[]]::new([int]$stream.Length)
    if($stream.Read($bytes,0,$bytes.Length) -ne $bytes.Length){Throw-OwnerFailure 'LOCK_FILE_INVALID'}
    try {$metadata=[Text.Encoding]::UTF8.GetString($bytes).TrimStart([char]0xFEFF)|ConvertFrom-Json -ErrorAction Stop}
    catch {Throw-OwnerFailure 'LOCK_FILE_INVALID'}
    $ownerPid=0
    if(![int]::TryParse([string]$metadata.pid,[ref]$ownerPid) -or $ownerPid -le 0 -or !$metadata.startedAt -or $metadata.mode -notin @('Backup','Upload','VerifyRemote','Restore','RestoreRemote','Watchdog','TestAlert')){Throw-OwnerFailure 'LOCK_FILE_INVALID'}
    $running=$null
    try {$running=[Diagnostics.Process]::GetProcessById($ownerPid)}
    catch [ArgumentException] { } # Only a proven missing PID authorizes removal.
    catch {Throw-OwnerFailure 'LOCK_PROCESS_CHECK_FAILED'}
    if($running){$running.Dispose();Throw-OwnerFailure 'LOCKED'}
    # No wildcard expansion,no recursive deletion,no process termination.
    try {[IO.File]::Delete($file)}catch{Throw-OwnerFailure 'LOCK_CLEANUP_FAILED'}
    return @{ok=$true;mode='CleanupLock';removed=$true;reason='ORPHAN_PID_ABSENT'}
  } finally {if($stream){$stream.Dispose()}}
}
function Write-OwnerFailure([string]$Mode,[string]$Root,$Failure) {
  $categories=@('LOCKED','LOCK_FILE_INVALID','LOCK_PROCESS_CHECK_FAILED','LOCK_CLEANUP_FAILED','MISSING_ENV','DPAPI_UNPROTECT_FAILED','PG_BIN_NOT_FOUND','TOOL_NOT_FOUND','CONFIG_INVALID','CONFIG_READ_FAILED','ARCHIVE_PASSPHRASE_INVALID','FILE_IO_FAILED','REPORT_WRITE_FAILED','MODE_INVALID','APPLY_REQUIRED','ADMIN_REQUIRED','OPERATION_FAILED')
  $category=[string]$Failure.Exception.Data['OwnerCategory']
  if($category -notin $categories){$category='OPERATION_FAILED'}
  $variable=[string]$Failure.Exception.Data['OwnerVariable']
  $allowed=@('NAWASRAH_FF_CONFIG','NAWASRAH_FF_DB_PASSWORD','NAWASRAH_FF_PASSPHRASE','NAWASRAH_R2_ACCOUNT_ID','NAWASRAH_R2_ACCESS_KEY_ID','NAWASRAH_R2_SECRET_ACCESS_KEY','NAWASRAH_DEV_TELEGRAM_BOT_TOKEN','NAWASRAH_DEV_TELEGRAM_CHAT_ID')
  $stage=if($category -eq 'DPAPI_UNPROTECT_FAILED'){'owner-env'}elseif($category -like 'LOCK*'){'operation-lock'}elseif($category -like 'CONFIG*'){'config-load'}else{'operation-preflight'}
  $diagnostic=[ordered]@{formatVersion=1;stage=$stage;tool='powershell';category=$category;sqlstate=$null;libpqMessage='Owner preflight failed; raw exception and credential contents withheld.';exitCode=$null;signal=$null;messagePolicy='canonical-classification-no-raw-output'}
  if($variable -in $allowed){$diagnostic['variable']=$variable}
  $report=[ordered]@{ok=$false;mode=$Mode;at=[DateTimeOffset]::UtcNow.ToString('o');code='FRANKFURT_OWNER_OPERATION_FAILED_NO_CREDENTIALS_LOGGED';diagnostic=$diagnostic}
  $temp=$null
  try {
    if($Mode -notin @('Backup','Upload','VerifyRemote','Restore','RestoreRemote','Watchdog','TestAlert','Status','CleanupLock','Setup','Register')){throw 'UNSUPPORTED_MODE'}
    $target=Join-Path $Root "operation-$Mode.json"
    $temp="$target.$([guid]::NewGuid().ToString('N')).tmp"
    $report|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $temp -Encoding UTF8
    Move-Item -LiteralPath $temp -Destination $target -Force
  } catch {$report['reportWriteFailed']=$true}
  finally {if($temp -and [IO.File]::Exists($temp)){[IO.File]::Delete($temp)}}
  $report|ConvertTo-Json -Depth 6 -Compress
}
