[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('AccessKeyId', 'SecretAccessKey')][string]$Field,
  [string]$EnvelopePath = (Join-Path $env:LOCALAPPDATA 'NawasrahOffsiteBackup\credential-envelope.json')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security -ErrorAction Stop
$value = Get-Clipboard -Raw
try {
  if ([string]::IsNullOrWhiteSpace($value) -or $value.Length -lt 16 -or $value.Length -gt 256) {
    throw 'Clipboard does not contain a plausible R2 credential value.'
  }
  $bytes = [Text.Encoding]::UTF8.GetBytes($value.Trim())
  try {
    $protected = [Security.Cryptography.ProtectedData]::Protect(
      $bytes, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine
    )
    $encrypted = [Convert]::ToBase64String($protected)
  }
  finally { [Array]::Clear($bytes, 0, $bytes.Length) }
  $directory = Split-Path -Parent $EnvelopePath
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  $envelope = if (Test-Path -LiteralPath $EnvelopePath) {
    Get-Content -LiteralPath $EnvelopePath -Raw -Encoding UTF8 | ConvertFrom-Json
  } else { [pscustomobject]@{ formatVersion = 1; protectionScope = 'LocalMachine' } }
  $property = if ($Field -eq 'AccessKeyId') { 'accessKeyId' } else { 'secretAccessKey' }
  $envelope | Add-Member -NotePropertyName $property -NotePropertyValue $encrypted -Force
  $temporary = "$EnvelopePath.tmp"
  $envelope | ConvertTo-Json | Set-Content -LiteralPath $temporary -Encoding UTF8
  Move-Item -LiteralPath $temporary -Destination $EnvelopePath -Force
  $acl = Get-Acl -LiteralPath $EnvelopePath
  $acl.SetAccessRuleProtection($true, $false)
  $acl.Access | ForEach-Object { [void]$acl.RemoveAccessRule($_) }
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
    [Security.Principal.WindowsIdentity]::GetCurrent().User,
    [Security.AccessControl.FileSystemRights]::FullControl,
    [Security.AccessControl.AccessControlType]::Allow
  ))
  Set-Acl -LiteralPath $EnvelopePath -AclObject $acl
  Write-Host "$Field captured and protected with DPAPI LocalMachine." -ForegroundColor Green
}
finally {
  Set-Clipboard -Value ' '
  $value = $null
}
