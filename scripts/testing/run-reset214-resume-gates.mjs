import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..');
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-reset214b-gate-')),reference=path.join(output,'local-reference-through214-ready.json');
for(const args of [['scripts/operations/build-acl-reference214.mjs','--output',reference],['scripts/testing/run-reset214-resume-runtime.mjs',reference]]){
 const r=await exec(process.execPath,args,{cwd:root,windowsHide:true,maxBuffer:16*1024**2});process.stdout.write(r.stdout);process.stderr.write(r.stderr);
}
