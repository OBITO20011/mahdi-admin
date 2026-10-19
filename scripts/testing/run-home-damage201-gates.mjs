// Independent package2 gate; existing frozen200 gates retain their own probes.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..');
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-home-damage201-gate-'));
const reference=path.join(output,'local-reference-through201-ready.json');
for(const args of [
 ['scripts/testing/run-home-damage201-runtime.mjs'],
 ['scripts/testing/run-home-damage201-scale.mjs'],
 ['scripts/operations/build-acl-reference201.mjs','--output',reference],
 ['scripts/testing/run-home-damage-upgrade201-runtime.mjs',reference],
 ['scripts/testing/run-trial-reset-runtime.mjs',reference,'--current201'],
]){
 const result=await exec(process.execPath,args,{cwd:root,windowsHide:true,maxBuffer:16*1024**2});
 process.stdout.write(result.stdout);process.stderr.write(result.stderr);
}
