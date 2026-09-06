[CmdletBinding()]
param(
  [switch]$Elevated,
  [string]$TaskName = 'Nawasrah Developer Monitoring DPAPI Probe',
  [string]$ResultPath = 'C:\ProgramData\NawasrahDeveloperMonitoring\dpapi-system-probe-result.json'
)

$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$isAdministrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$stage = 'startup'

trap {
  if ($Elevated) {
    try {
      $resultRoot = Split-Path -Parent $ResultPath
      New-Item -ItemType Directory -Path $resultRoot -Force | Out-Null
      [ordered]@{
        ok = $false
        identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
        protectionScope = 'LocalMachine'
        stage = $stage
        errorType = $_.Exception.GetType().Name
        error = $_.Exception.Message
        completedAt = (Get-Date).ToUniversalTime().ToString('o')
      } | ConvertTo-Json | Set-Content -LiteralPath $ResultPath -Encoding UTF8
    }
    catch { }
  }
  else {
    Write-Error $_.Exception.Message
  }
  exit 1
}

if (-not $isAdministrator) {
  Write-Host 'Windows will request Administrator approval for a one-time SYSTEM DPAPI probe.' -ForegroundColor Cyan
  $arguments = @(
    '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', "`"$($MyInvocation.MyCommand.Path)`"", '-Elevated',
    '-TaskName', "`"$TaskName`"", '-ResultPath', "`"$ResultPath`""
  )
  $process = Start-Process powershell.exe -ArgumentList $arguments -Verb RunAs -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    if (Test-Path -LiteralPath $ResultPath -PathType Leaf) {
      $failedResult = Get-Content -LiteralPath $ResultPath -Raw -Encoding UTF8 | ConvertFrom-Json
      Write-Error "SYSTEM DPAPI probe failed at stage '$($failedResult.stage)': $($failedResult.error)"
      exit $process.ExitCode
    }
    Write-Error "SYSTEM DPAPI probe exited with code $($process.ExitCode) without a diagnostic result."
    exit $process.ExitCode
  }
  $result = Get-Content -LiteralPath $ResultPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $result | ConvertTo-Json -Depth 4
  exit 0
}

if (-not $Elevated) { throw 'The elevated DPAPI probe must be launched through the non-elevated entry point.' }

Add-Type -AssemblyName System.Security -ErrorAction Stop
$stage = 'prepare-directories'
$monitorRoot = Split-Path -Parent $ResultPath
$probeRoot = Join-Path $monitorRoot 'dpapi-probe'
$expectedProbeRoot = 'C:\ProgramData\NawasrahDeveloperMonitoring\dpapi-probe'
if (-not [string]::Equals($probeRoot, $expectedProbeRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Refusing to use an unexpected DPAPI probe directory.'
}

function Set-RestrictedDirectoryAcl {
  param([Parameter(Mandatory = $true)][string]$Path)
  $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
  $administrators = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
  $acl = [Security.AccessControl.DirectorySecurity]::new()
  $acl.SetOwner($currentUser)
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($allowedIdentity in @($currentUser, $system, $administrators)) {
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
      $allowedIdentity,
      [Security.AccessControl.FileSystemRights]::FullControl,
      [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit',
      [Security.AccessControl.PropagationFlags]::None,
      [Security.AccessControl.AccessControlType]::Allow
    ))
  }
  Set-Acl -LiteralPath $Path -AclObject $acl
}

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
if (Test-Path -LiteralPath $probeRoot) {
  Remove-Item -LiteralPath $probeRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $probeRoot -Force | Out-Null
New-Item -ItemType Directory -Path $monitorRoot -Force | Out-Null
Set-RestrictedDirectoryAcl -Path $probeRoot

$stage = 'protect-disposable-value'
$inputPath = Join-Path $probeRoot 'input.json'
$workerResultPath = Join-Path $probeRoot 'result.json'
$secretBytes = [byte[]]::new(32)
$randomNumberGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $randomNumberGenerator.GetBytes($secretBytes) }
finally { $randomNumberGenerator.Dispose() }
try {
  $protectedBytes = [Security.Cryptography.ProtectedData]::Protect(
    $secretBytes,
    $null,
    [Security.Cryptography.DataProtectionScope]::LocalMachine
  )
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try { $expectedHashBytes = $sha256.ComputeHash($secretBytes) }
  finally { $sha256.Dispose() }
  $expectedHash = -join ($expectedHashBytes | ForEach-Object { $_.ToString('x2') })
  [ordered]@{
    protectedValue = [Convert]::ToBase64String($protectedBytes)
    expectedHash = $expectedHash
  } | ConvertTo-Json | Set-Content -LiteralPath $inputPath -Encoding UTF8
}
finally {
  [Array]::Clear($secretBytes, 0, $secretBytes.Length)
}

$workerPath = Join-Path $PSScriptRoot 'system-dpapi-probe-worker.ps1'
$taskArguments = "-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$workerPath`" -InputPath `"$inputPath`" -ResultPath `"$workerResultPath`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $taskArguments
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5)
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew
$taskPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

try {
  $stage = 'register-system-task'
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $taskPrincipal -Description 'One-time machine-scope DPAPI interoperability probe.' | Out-Null
  $stage = 'run-system-task'
  Start-ScheduledTask -TaskName $TaskName
  $deadline = (Get-Date).AddSeconds(60)
  while (-not (Test-Path -LiteralPath $workerResultPath -PathType Leaf) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 250
  }
  if (-not (Test-Path -LiteralPath $workerResultPath -PathType Leaf)) {
    $timedOutTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    $timedOutInfo = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
    throw "SYSTEM DPAPI probe did not complete within 60 seconds (state=$($timedOutTask.State), lastTaskResult=$($timedOutInfo.LastTaskResult))."
  }
  $stage = 'verify-system-result'
  $workerResult = Get-Content -LiteralPath $workerResultPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $taskInfo = Get-ScheduledTaskInfo -TaskName $TaskName
  $finalResult = [ordered]@{
    ok = $workerResult.ok -eq $true -and $workerResult.identity -eq 'NT AUTHORITY\SYSTEM' -and $taskInfo.LastTaskResult -eq 0
    identity = [string]$workerResult.identity
    protectionScope = [string]$workerResult.protectionScope
    taskResult = $taskInfo.LastTaskResult
    completedAt = [string]$workerResult.completedAt
  }
  $finalResult | ConvertTo-Json | Set-Content -LiteralPath $ResultPath -Encoding UTF8
  if (-not $finalResult.ok) { throw 'SYSTEM DPAPI interoperability verification failed.' }
}
finally {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $probeRoot) {
    Remove-Item -LiteralPath $probeRoot -Recurse -Force
  }
}
