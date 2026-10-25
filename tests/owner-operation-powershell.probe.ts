// The Playwright quality container intentionally has no PowerShell runtime.
// This unchanged operational proof is mandatory in backup-recovery on the host.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const secret='SYNTHETIC-password-and-archive-passphrase-only';
async function fixture(run:(root:string)=>Promise<void>){const root=await mkdtemp(path.join(tmpdir(),'owner-powershell-'));try{await run(root);}finally{await rm(root,{recursive:true,force:true});}}

test('PowerShell synthetic DPAPI failure and explicit orphan cleanup are safe offline',async()=>fixture(async root=>{
  const {stdout}=await promisify(execFile)(process.platform==='win32'?'powershell.exe':'pwsh',['-NoProfile','-NonInteractive','-File','scripts/testing/owner-operation-safety-probe.ps1','-Root',root],{windowsHide:true,timeout:30000});
  const report=JSON.parse(stdout.trim());assert.equal(report.ok,true);assert.equal(report.dpapiFailureSafe,true);assert.equal(report.activePidPreserved,true);assert.equal(report.orphanRemoved,true);assert.equal(report.malformedPreserved,true);assert.ok(!stdout.includes(secret));
  if(process.platform==='win32'){assert.equal(report.windowsDpapiRoundtrip,true);assert.equal(report.windowsExclusiveHandleProved,true);}
}));
