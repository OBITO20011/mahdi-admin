// Serial DB gate:never overlap isolated DB stacks or browser workers.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..');
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-warehouse-gate-'));
const reference=path.join(output,'local-reference-through199-ready.json');
for(const args of [
 ['scripts/testing/run-owner-warehouse-runtime.mjs'],
 ['scripts/operations/build-acl-reference199.mjs','--output',reference],
 ['scripts/testing/run-warehouse-upgrade199-runtime.mjs',reference],
 ['scripts/testing/run-trial-reset-runtime.mjs',reference,'--current199'],
]){
 const result=await exec(process.execPath,args,{cwd:root,windowsHide:true,maxBuffer:16*1024**2});
 process.stdout.write(result.stdout);process.stderr.write(result.stderr);
}
