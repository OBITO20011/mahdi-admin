[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Candidate,[Parameter(Mandatory=$true)][ValidatePattern('^[A-Fa-f0-9]{64}$')][string]$ApprovedSha256,[string]$RepositoryRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,[string]$Workdir=(Join-Path $env:USERPROFILE 'NawasrahFrankfurt\nawasrah-fra-001-138'))
$ErrorActionPreference='Stop'
$OutputEncoding=[System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=$OutputEncoding
& node (Join-Path $PSScriptRoot 'd1-reference220-kit.mjs') install --root $RepositoryRoot --candidate $Candidate --approved-sha256 $ApprovedSha256 --workdir $Workdir
if($LASTEXITCODE -ne 0){throw 'D1_INSTALLATION_STOPPED: See the Arabic diagnostic above.'}
