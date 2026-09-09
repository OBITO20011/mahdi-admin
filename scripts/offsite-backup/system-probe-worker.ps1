[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$RunScript,
  [Parameter(Mandatory = $true)][string]$ConfigPath,
  [Parameter(Mandatory = $true)][string]$ResultPath
)
$ErrorActionPreference = 'Stop'
try {
  & $RunScript -Mode Probe -ConfigPath $ConfigPath
  if ($LASTEXITCODE -ne 0) { throw "Probe exited with code $LASTEXITCODE." }
  [pscustomobject]@{ok=$true;identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name;verifiedAt=[DateTimeOffset]::UtcNow.ToString('o')} |
    ConvertTo-Json | Set-Content -LiteralPath $ResultPath -Encoding UTF8
}
catch {
  [pscustomobject]@{ok=$false;identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name;error='SYSTEM R2 probe failed.';verifiedAt=[DateTimeOffset]::UtcNow.ToString('o')} |
    ConvertTo-Json | Set-Content -LiteralPath $ResultPath -Encoding UTF8
  throw
}
