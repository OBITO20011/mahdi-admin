[CmdletBinding()]
param(
  [string]$CredentialEnvelopePath = (Join-Path $env:LOCALAPPDATA 'NawasrahOffsiteBackup\credential-envelope.json'),
  [string]$ConfigPath = 'C:\ProgramData\NawasrahOffsiteBackup\config.json',
  [Parameter(Mandatory = $true)][string]$AccountId,
  [string]$Bucket = 'nawasrah-offsite-backups',
  [ValidateSet('eu')][string]$Jurisdiction = 'eu',
  [string]$ErpMachineConfigPath = (Join-Path $env:LOCALAPPDATA 'NawasrahBackup\config-machine.json'),
  [string]$N8nStatusPath = 'C:\ProgramData\NawasrahN8nBackup\last-status.json'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security -ErrorAction Stop
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  $arguments = @('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$($MyInvocation.MyCommand.Path)`"",'-CredentialEnvelopePath',"`"$CredentialEnvelopePath`"",'-ConfigPath',"`"$ConfigPath`"",'-AccountId',$AccountId,'-Bucket',$Bucket,'-Jurisdiction',$Jurisdiction,'-ErpMachineConfigPath',"`"$ErpMachineConfigPath`"",'-N8nStatusPath',"`"$N8nStatusPath`"")
  $elevated = Start-Process powershell.exe -ArgumentList $arguments -Verb RunAs -Wait -PassThru
  exit $elevated.ExitCode
}

function Unprotect-MachineValue([string]$ProtectedValue) {
  $protectedBytes = [Convert]::FromBase64String($ProtectedValue)
  $plainBytes = [Security.Cryptography.ProtectedData]::Unprotect($protectedBytes, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)
  try { return [Text.Encoding]::UTF8.GetString($plainBytes) }
  finally { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
}
function Set-RestrictedAcl([string]$Path, [bool]$Directory = $false) {
  $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
  $administrators = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
  $acl = if ($Directory) { [Security.AccessControl.DirectorySecurity]::new() } else { [Security.AccessControl.FileSecurity]::new() }
  $acl.SetOwner($currentUser)
  $acl.SetAccessRuleProtection($true, $false)
  $inheritance = if ($Directory) { [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
  foreach ($sid in @($currentUser, $system, $administrators)) {
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, [Security.AccessControl.FileSystemRights]::FullControl, $inheritance, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
  }
  Set-Acl -LiteralPath $Path -AclObject $acl
}

if ($AccountId -notmatch '^[a-f0-9]{32}$') { throw 'Cloudflare account id is invalid.' }
if (-not (Test-Path -LiteralPath $CredentialEnvelopePath -PathType Leaf)) { throw 'Protected R2 credential envelope is unavailable.' }
if (-not (Test-Path -LiteralPath $ErpMachineConfigPath -PathType Leaf)) { throw 'ERP machine backup configuration is unavailable.' }
if (-not (Test-Path -LiteralPath $N8nStatusPath -PathType Leaf)) { throw 'n8n backup status is unavailable.' }
$envelope = Get-Content -LiteralPath $CredentialEnvelopePath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($envelope.formatVersion -ne 1 -or $envelope.protectionScope -ne 'LocalMachine' -or -not $envelope.accessKeyId -or -not $envelope.secretAccessKey) {
  throw 'Protected R2 credential envelope is incomplete.'
}
$accessKey = Unprotect-MachineValue ([string]$envelope.accessKeyId)
$secretKey = Unprotect-MachineValue ([string]$envelope.secretAccessKey)
try {
  if ($accessKey.Length -lt 16 -or $secretKey.Length -lt 20) { throw 'R2 credential shape is invalid.' }
  $erpConfig = Get-Content -LiteralPath $ErpMachineConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $erpStatusPath = Join-Path ([string]$erpConfig.backupRoot) 'last-backup-status.json'
  if (-not (Test-Path -LiteralPath $erpStatusPath -PathType Leaf)) { throw 'ERP backup status is unavailable.' }
  $configRoot = Split-Path -Parent $ConfigPath
  New-Item -ItemType Directory -Path $configRoot -Force | Out-Null
  Set-RestrictedAcl $configRoot $true
  [ordered]@{
    formatVersion = 1
    protectionScope = 'LocalMachine'
    accountId = $AccountId
    bucket = $Bucket
    jurisdiction = $Jurisdiction
    accessKeyId = [string]$envelope.accessKeyId
    secretAccessKey = [string]$envelope.secretAccessKey
    erpMachineConfigPath = (Resolve-Path -LiteralPath $ErpMachineConfigPath).Path
    erpStatusPath = (Resolve-Path -LiteralPath $erpStatusPath).Path
    n8nStatusPath = (Resolve-Path -LiteralPath $N8nStatusPath).Path
  } | ConvertTo-Json | Set-Content -LiteralPath "$ConfigPath.tmp" -Encoding UTF8
  Move-Item -LiteralPath "$ConfigPath.tmp" -Destination $ConfigPath -Force
  Set-RestrictedAcl $ConfigPath
  $runScript = (Resolve-Path (Join-Path $PSScriptRoot 'run-offsite-backup.ps1')).Path
  $probeName = 'Nawasrah Offsite Backup DPAPI Probe'
  $probeResult = Join-Path $configRoot 'dpapi-system-probe.json'
  $probeWorker = Join-Path $PSScriptRoot 'system-probe-worker.ps1'
  $actionArgs = "-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$probeWorker`" -RunScript `"$runScript`" -ConfigPath `"$ConfigPath`" -ResultPath `"$probeResult`""
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $actionArgs
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5)
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 3) -MultipleInstances IgnoreNew
  $taskPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  if (Get-ScheduledTask -TaskName $probeName -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $probeName -Confirm:$false }
  Register-ScheduledTask -TaskName $probeName -Action $action -Trigger $trigger -Settings $settings -Principal $taskPrincipal -Force | Out-Null
  Start-ScheduledTask -TaskName $probeName
  $deadline = (Get-Date).AddSeconds(90)
  do { Start-Sleep -Milliseconds 500 } while ((Get-ScheduledTask -TaskName $probeName).State -eq 'Running' -and (Get-Date) -lt $deadline)
  if (-not (Test-Path -LiteralPath $probeResult -PathType Leaf)) { throw 'SYSTEM R2 DPAPI probe did not produce a result.' }
  $result = Get-Content -LiteralPath $probeResult -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($result.ok -ne $true -or $result.identity -ne 'NT AUTHORITY\SYSTEM') { throw 'SYSTEM could not decrypt and validate the R2 credential.' }
  & (Join-Path $PSScriptRoot 'register-offsite-backup-tasks.ps1') -ConfigPath $ConfigPath
  Write-Host 'R2 credential validated, DPAPI/SYSTEM verified, and off-site tasks registered.' -ForegroundColor Green
}
finally {
  $accessKey = $null; $secretKey = $null
  if (Get-ScheduledTask -TaskName 'Nawasrah Offsite Backup DPAPI Probe' -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName 'Nawasrah Offsite Backup DPAPI Probe' -Confirm:$false -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath $CredentialEnvelopePath -Force -ErrorAction SilentlyContinue
}
