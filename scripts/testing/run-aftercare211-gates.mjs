// Owner211 atomic aftercare disposition, real races/restore and independent owner rehearsal.
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {mkdtemp} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..'),output=await mkdtemp(path.join(tmpdir(),'nawasrah-aftercare211-gate-')),reference=path.join(output,'local-reference-through211-ready.json');
for(const args of [['scripts/audit/run-table-access-diagnostic.mjs','--migration-ceiling','211','--require-access'],['scripts/testing/run-aftercare211-runtime.mjs'],['scripts/operations/build-acl-reference211.mjs','--output',reference],['scripts/testing/run-aftercare-upgrade211-runtime.mjs',reference],['scripts/testing/run-trial-reset-runtime.mjs',reference,'--current211']]){
 const result=await exec(process.execPath,args,{cwd:root,windowsHide:true,maxBuffer:16*1024**2});process.stdout.write(result.stdout);process.stderr.write(result.stderr);
}
