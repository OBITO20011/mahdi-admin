// Approved208 only. Prior SQL/owner-reference gates remain strict and independent.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..');
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-replacement208-gate-')),reference=path.join(output,'local-reference-through208-ready.json');
for(const args of [['scripts/testing/run-supplier-replacement208-runtime.mjs'],['scripts/operations/build-acl-reference208.mjs','--output',reference],['scripts/testing/run-supplier-replacement-upgrade208-runtime.mjs',reference],['scripts/testing/run-trial-reset-runtime.mjs',reference,'--current208']]){
 const result=await exec(process.execPath,args,{cwd:root,windowsHide:true,maxBuffer:16*1024**2});process.stdout.write(result.stdout);process.stderr.write(result.stderr);
}
