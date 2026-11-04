param(
 [Parameter(Mandatory=$true)][string]$Folder,
 [string]$Reference,
 [string]$Images,
 [string]$Output,
 [switch]$NoOpeningCheques
)
$ErrorActionPreference = 'Stop'
$checkerRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$checkerArgs = @('--import','tsx',(Join-Path $PSScriptRoot 'go-live-files/cli.ts'),'--folder',$Folder)
if ($Reference) { $checkerArgs += @('--reference',$Reference) }
if ($Images) { $checkerArgs += @('--images',$Images) }
if ($Output) { $checkerArgs += @('--output',$Output) }
if ($NoOpeningCheques) { $checkerArgs += @('--no-opening-cheques','true') }
Push-Location $checkerRoot
try { & node @checkerArgs; $checkerExit = $LASTEXITCODE } finally { Pop-Location }
exit $checkerExit
