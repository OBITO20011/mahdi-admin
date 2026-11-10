[CmdletBinding()]
param([string]$RepositoryRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,[string]$OutputRoot,[switch]$TestCandidateOnly)
$ErrorActionPreference='Stop'
$OutputEncoding=[System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=$OutputEncoding
$arguments=@((Join-Path $PSScriptRoot 'd1-reference220-kit.mjs'),'prepare','--root',$RepositoryRoot)
if($OutputRoot){$arguments+=@('--output-root',$OutputRoot)}
if($TestCandidateOnly){$arguments+='--test-candidate-only'}
& node @arguments
if($LASTEXITCODE -ne 0){throw 'D1_PREPARATION_STOPPED: See the Arabic diagnostic above.'}
