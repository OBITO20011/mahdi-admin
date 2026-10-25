param([Parameter(Mandatory=$true)][string]$Root)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../operations/frankfurt-owner-safety.ps1')
function Require($Condition,[string]$Name){if(!$Condition){throw "PROBE_FAILED:$Name"}}
$file=Join-Path $Root 'backup-offsite.lock'
$secret='SYNTHETIC-password-and-archive-passphrase-only'
$dpapiSafe=$false
$dpapiRoundtrip=$false
if($env:OS -eq 'Windows_NT'){
  Add-Type -AssemblyName System.Security
  $plain=[Text.Encoding]::UTF8.GetBytes($secret)
  try {
    $cipher=[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($plain,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine))
    $decoded=Unprotect-OwnerValue $cipher 'NAWASRAH_FF_PASSPHRASE'
    Require ($decoded -ceq $secret) 'SYNTHETIC_DPAPI_ROUNDTRIP'
    $dpapiRoundtrip=$true;$decoded=$null;$cipher=$null
  }finally{[Array]::Clear($plain,0,$plain.Length)}
}
try {Unprotect-OwnerValue 'AQID' 'NAWASRAH_FF_PASSPHRASE' {param($bytes) throw 'SYNTHETIC-password-and-archive-passphrase-only'}|Out-Null;throw 'EXPECTED_FAILURE'}
catch {
  $json=Write-OwnerFailure -Mode Backup -Root $Root -Failure $_
  $report=$json|ConvertFrom-Json
  Require ($report.diagnostic.category -eq 'DPAPI_UNPROTECT_FAILED') 'DPAPI_CATEGORY'
  Require ($report.diagnostic.variable -eq 'NAWASRAH_FF_PASSPHRASE') 'DPAPI_VARIABLE'
  Require (!$json.Contains($secret)) 'DPAPI_PRIVACY'
  $dpapiSafe=$true
}
$missing=Remove-OwnerOrphanLock $Root
Require (!$missing.removed) 'MISSING_NOOP'
@{pid=$PID;startedAt=[DateTimeOffset]::UtcNow.ToString('o');mode='Backup'}|ConvertTo-Json -Compress|Set-Content -LiteralPath $file -Encoding UTF8
$original=[IO.File]::ReadAllBytes($file)
try {Remove-OwnerOrphanLock $Root|Out-Null;throw 'EXPECTED_ACTIVE_REFUSAL'}
catch {Require ($_.Exception.Data['OwnerCategory'] -eq 'LOCKED') 'LIVE_PID_REFUSED'}
Require ([Convert]::ToBase64String([IO.File]::ReadAllBytes($file)) -ceq [Convert]::ToBase64String($original)) 'LIVE_UNCHANGED'
'{"pid":"malformed"}'|Set-Content -LiteralPath $file -Encoding UTF8
try {Remove-OwnerOrphanLock $Root|Out-Null;throw 'EXPECTED_INVALID_REFUSAL'}
catch {Require ($_.Exception.Data['OwnerCategory'] -eq 'LOCK_FILE_INVALID') 'INVALID_REFUSED'}
Require ([IO.File]::Exists($file)) 'INVALID_UNCHANGED'
$start=[Diagnostics.ProcessStartInfo]::new()
$start.FileName=if($env:OS -eq 'Windows_NT'){Join-Path $PSHOME 'powershell.exe'}else{Join-Path $PSHOME 'pwsh'}
$start.Arguments='-NoProfile -NonInteractive -Command exit'
$start.UseShellExecute=$false;$start.CreateNoWindow=$true
$child=[Diagnostics.Process]::Start($start)
try {$deadPid=$child.Id;Require ($child.WaitForExit(10000)) 'CHILD_EXIT'}finally{$child.Dispose()}
@{pid=$deadPid;startedAt=[DateTimeOffset]::UtcNow.ToString('o');mode='Backup'}|ConvertTo-Json -Compress|Set-Content -LiteralPath $file -Encoding UTF8
$atomic=$false
if($env:OS -eq 'Windows_NT'){
  $held=[IO.FileStream]::new($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Delete)
  try {
    try {Remove-OwnerOrphanLock $Root|Out-Null;throw 'EXPECTED_EXCLUSIVE_REFUSAL'}
    catch {Require ($_.Exception.Data['OwnerCategory'] -eq 'LOCKED') 'EXCLUSIVE_HANDLE_REFUSED'}
    Require ([IO.File]::Exists($file)) 'EXCLUSIVE_UNCHANGED'
    $atomic=$true
  }finally{$held.Dispose()}
}
$removed=Remove-OwnerOrphanLock $Root
Require ($removed.removed -and ![IO.File]::Exists($file)) 'DEAD_PID_REMOVED'
@{ok=$true;dpapiFailureSafe=$dpapiSafe;activePidPreserved=$true;orphanRemoved=$true;malformedPreserved=$true;windowsExclusiveHandleProved=$atomic;windowsDpapiRoundtrip=$dpapiRoundtrip;hostedConnectionsMade=$false}|ConvertTo-Json -Compress
