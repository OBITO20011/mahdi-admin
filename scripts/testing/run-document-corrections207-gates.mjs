// Current207 only. Prior runtime gates remain independent and unchanged.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..'),output=await mkdtemp(path.join(tmpdir(),'nawasrah-corrections207-gate-')),reference=path.join(output,'local-reference-through207-ready.json');
for(const args of [['scripts/testing/run-document-corrections207-runtime.mjs'],['scripts/operations/build-acl-reference207.mjs','--output',reference],['scripts/testing/run-document-corrections-upgrade207-runtime.mjs',reference],['scripts/testing/run-trial-reset-runtime.mjs',reference,'--current207']]){
 const result=await exec(process.execPath,args,{cwd:root,windowsHide:true,maxBuffer:16*1024**2});process.stdout.write(result.stdout);process.stderr.write(result.stderr);
}
