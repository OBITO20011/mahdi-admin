param(
 [Parameter(Mandatory=$true)][string]$Archive,
 [Parameter(Mandatory=$true)][string]$BackupReport,
 [Parameter(Mandatory=$true)][string]$StockAlerts,
 [Parameter(Mandatory=$true)][string]$Output,
 [string]$ConfigFile='C:\ProgramData\NawasrahFrankfurtBackup\config.json'
)
$ErrorActionPreference='Stop'
$settings=Get-Content -LiteralPath $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
if($settings.projectRef -ne 'kzevmysfydaslxcerogt' -or $settings.protectionScope -ne 'LocalMachine'){throw 'STAGE_A_BACKUP_CONFIGURATION_REFUSED'}
Add-Type -AssemblyName System.Security
$plain=$null
$priorPassphrase=$env:NAWASRAH_BACKUP_PASSPHRASE
try{
 $plain=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String([string]$settings.archivePassphrase),$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
 $env:NAWASRAH_BACKUP_PASSPHRASE=[Text.Encoding]::UTF8.GetString($plain)
 & node (Join-Path $PSScriptRoot 'two-stage225-cli.mjs') --mode prepare-archive --archive $Archive --backup-report $BackupReport --stock-alerts $StockAlerts --output $Output
 if($LASTEXITCODE -ne 0){throw 'STAGE_A_BASELINE_PREPARATION_FAILED'}
}finally{
 if($null -eq $priorPassphrase){Remove-Item Env:NAWASRAH_BACKUP_PASSPHRASE -ErrorAction SilentlyContinue}else{$env:NAWASRAH_BACKUP_PASSPHRASE=$priorPassphrase}
 if($plain){[Array]::Clear($plain,0,$plain.Length)}
 $settings=$null
 $priorPassphrase=$null
}
