[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Archive,[Parameter(Mandatory=$true)][string]$Reference,
 [Parameter(Mandatory=$true)][string]$Output,[Parameter(Mandatory=$true)][string]$ClosedTree,
 [Parameter(Mandatory=$true)][string]$SupautilsEvidence)
$ErrorActionPreference='Stop'
# Local archive credential ONLY. Never decrypt the database/R2/Telegram values.
$config=Get-Content -LiteralPath 'C:\ProgramData\NawasrahFrankfurtBackup\config.json' -Raw|ConvertFrom-Json
Add-Type -AssemblyName System.Security
$bytes=$null
try {
 $bytes=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($config.archivePassphrase),$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
 $env:NAWASRAH_REHEARSAL_ARCHIVE_PASSPHRASE=[Text.Encoding]::UTF8.GetString($bytes)
 & node (Join-Path $PSScriptRoot 'run-connected-rehearsal219.mjs') --archive $Archive --reference $Reference --output $Output --closed-tree $ClosedTree --supautils-evidence $SupautilsEvidence
 $result=$LASTEXITCODE
}catch {Write-Output '{"ok":false,"code":"REHEARSAL_LOCAL_CREDENTIAL_OR_START_FAILED"}';$result=1}
finally {if($bytes){[Array]::Clear($bytes,0,$bytes.Length)};Remove-Item Env:NAWASRAH_REHEARSAL_ARCHIVE_PASSPHRASE -ErrorAction SilentlyContinue;$config=$null}
exit $result
