
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'fast-down-alert-windows.ps1')
$root = Get-FastDownRoot
$process = $null
$start = $null
$values = $null
$result = 'runner-error'
$exitCode = 1
$canLog = $false
try {
  Assert-FastDownPrivateRoot $root
  $canLog = $true
  $values = Read-FastDownChildEnvironment $root
  $start = New-FastDownStartInfo (Get-FastDownNode) (Join-Path $PSScriptRoot 'fast-down-alert.mjs') $root $values
  $process = [Diagnostics.Process]::Start($start)
  # Discard raw output, even if a transport or runtime prints its arguments.
  $stdout = $process.StandardOutput.BaseStream.CopyToAsync([IO.Stream]::Null)
  $stderr = $process.StandardError.BaseStream.CopyToAsync([IO.Stream]::Null)
  if ($process.WaitForExit(26000)) {
    $stdout.GetAwaiter().GetResult()
    $stderr.GetAwaiter().GetResult()
    if ($process.ExitCode -eq 0) { $result = 'ok'; $exitCode = 0 }
    else { $result = 'monitor-error' }
  } else {
    $result = 'timeout'
  }
} catch {
  $result = 'runner-error'
} finally {
  if ($process) {
    try { if (-not $process.HasExited) { $process.Kill(); $null = $process.WaitForExit(1000) } }
    catch { $result = 'runner-error'; $exitCode = 1 }
    $process.Dispose()
  }
  if ($start) { $start.EnvironmentVariables.Clear() }
  if ($values) { $values.Clear() }
  if ($canLog) {
    try {
      $line = '{0:o} {1}' -f [DateTimeOffset]::UtcNow, $result
      Set-Content -LiteralPath (Join-Path $root 'last-run.log') -Value $line -Encoding UTF8
    } catch { $exitCode = 1 }
  }
}
exit $exitCode
