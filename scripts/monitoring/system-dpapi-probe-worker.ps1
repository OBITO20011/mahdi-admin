[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$ResultPath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security -ErrorAction Stop

try {
  $input = Get-Content -LiteralPath $InputPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $protectedBytes = [Convert]::FromBase64String([string]$input.protectedValue)
  $plainBytes = [Security.Cryptography.ProtectedData]::Unprotect(
    $protectedBytes,
    $null,
    [Security.Cryptography.DataProtectionScope]::LocalMachine
  )
  try {
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try { $hashBytes = $sha256.ComputeHash($plainBytes) }
    finally { $sha256.Dispose() }
    $actualHash = -join ($hashBytes | ForEach-Object { $_.ToString('x2') })
    $matched = [string]::Equals($actualHash, [string]$input.expectedHash, [StringComparison]::Ordinal)
    [ordered]@{
      ok = $matched
      identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
      protectionScope = 'LocalMachine'
      decryptedLength = $plainBytes.Length
      completedAt = (Get-Date).ToUniversalTime().ToString('o')
    } | ConvertTo-Json | Set-Content -LiteralPath $ResultPath -Encoding UTF8
    if (-not $matched) { exit 2 }
  }
  finally {
    if ($plainBytes) { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
  }
}
catch {
  [ordered]@{
    ok = $false
    identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    protectionScope = 'LocalMachine'
    error = 'DPAPI LocalMachine decryption verification failed.'
    completedAt = (Get-Date).ToUniversalTime().ToString('o')
  } | ConvertTo-Json | Set-Content -LiteralPath $ResultPath -Encoding UTF8
  exit 1
}
