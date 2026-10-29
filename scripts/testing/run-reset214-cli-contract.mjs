// Real offline owner entrypoint and fail-closed argument admission.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {reset214Arguments} from '../operations/frankfurt-owner-reset214.mjs';
import {readReady214Reference} from '../operations/frankfurt-reference214.mjs';
import {resetUnits} from '../operations/trial-reset-core.mjs';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..'),id='00000000-0000-4000-8000-000000000001';
assert.equal(reset214Arguments([]).mode,'plan');
for(const args of [
 ['--apply'],['--dry-run'],['--apply','--dry-run','--owner-id',id],['--target','other'],
 ['--owner-id','not-a-uuid'],['--plan','--plan'],['--reference','local-reference-through209-ready.json'],
 ['--reference','renamed214.json'],['--owner-id',id,'--owner-id',id],['--workdir'],
])assert.throws(()=>reset214Arguments(args));
assert.equal(reset214Arguments(['--dry-run','--owner-id',id]).mode,'dry-run');
if(process.argv[2]){
 const workdir=await mkdtemp(path.join(tmpdir(),'nawasrah-reset214-offline-'));
 const ceiling=JSON.parse(await readFile(path.join(root,'docs/agent/project-state.json'),'utf8')).migrationCeiling;
 if(ceiling>214){
  // The live tool MUST reject this checkout;only the DB rehearsal gets a
  // byte-identical214 source view. No owner guard is relaxed for215.
  const reference=await readReady214Reference(root,process.argv[2]);
  await assert.rejects(resetUnits(root,reference),/RESET_MANIFEST_CHANGED/u);
  let rejected;
  try{await exec(process.execPath,['scripts/operations/frankfurt-owner-reset214.mjs','--plan','--reference',process.argv[2],'--workdir',workdir],{cwd:root,windowsHide:true});}
  catch(error){assert.equal(error.code,1);rejected=JSON.parse(error.stdout.trim());}
  assert.ok(rejected);assert.equal(rejected.ok,false);assert.equal(rejected.networkAccess,false);assert.equal(rejected.recoveryRequired,false);
  const report=JSON.parse(await readFile(path.join(rejected.output,'report.json'),'utf8'));
  assert.equal(report.stage,'local-preflight');assert.equal(report.remoteWriteAttempted,false);assert.equal(report.code,'RESET214_PREFLIGHT_OR_OPERATION_FAILED');
  console.log(JSON.stringify({ok:true,tests:14,offline:true,currentCeiling:ceiling,owner214RefusesNewerCheckout:true}));
 }else{
 const r=await exec(process.execPath,['scripts/operations/frankfurt-owner-reset214.mjs','--plan','--reference',process.argv[2],'--workdir',workdir],{cwd:root,windowsHide:true});
 const result=JSON.parse(r.stdout.trim());assert.equal(result.ok,true);assert.equal(result.networkAccess,false);
 const report=JSON.parse(await readFile(path.join(result.output,'report.json'),'utf8'));
 assert.equal(report.migrationCeiling,214);assert.equal(report.migrations,176);assert.equal(report.exactCountsAvailable,false);
 assert.equal(report.reference.name,'local-reference-through214-ready.json');assert.equal(report.remoteWriteAttempted,false);
 assert.ok(!/password|token|secretValue/iu.test(JSON.stringify(report)));
 console.log(JSON.stringify({ok:true,tests:13,offline:true,reference:report.reference.name,migrations:176,output:result.output}));
 }
}else console.log(JSON.stringify({ok:true,tests:12}));
