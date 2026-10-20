// Current206 only;the accepted001-205 runtime gates remain independent.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..'),output=await mkdtemp(path.join(tmpdir(),'nawasrah-navigation-cash206-gate-')),reference=path.join(output,'local-reference-through206-ready.json');
for(const args of [['scripts/testing/run-navigation-cash206-runtime.mjs'],['scripts/testing/run-navigation-cash206-scale.mjs'],['scripts/operations/build-acl-reference206.mjs','--output',reference],['scripts/testing/run-navigation-cash-upgrade206-runtime.mjs',reference],['scripts/testing/run-trial-reset-runtime.mjs',reference,'--current206']]){
 const result=await exec(process.execPath,args,{cwd:root,windowsHide:true,maxBuffer:16*1024**2});process.stdout.write(result.stdout);process.stderr.write(result.stderr);
}
