// Owner212 read-only metadata/history,actual roles/zero writes,restore and owner rehearsal.
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {mkdtemp,copyFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..'),output=await mkdtemp(path.join(tmpdir(),'nawasrah-trial212-gate-')),reference=path.join(output,'local-reference-through212-ready.json');
for(const args of [['scripts/audit/run-table-access-diagnostic.mjs','--migration-ceiling','212','--require-access'],['scripts/testing/run-trial212-runtime.mjs'],['scripts/operations/build-acl-reference212.mjs','--output',reference],['scripts/testing/run-trial-upgrade212-runtime.mjs',reference],['scripts/testing/run-trial-reset-runtime.mjs',reference,'--current212']]){
 const result=await exec(process.execPath,args,{cwd:root,windowsHide:true,maxBuffer:16*1024**2});process.stdout.write(result.stdout);process.stderr.write(result.stderr);
 if(args[0]==='scripts/audit/run-table-access-diagnostic.mjs'){const summary=JSON.parse(result.stdout.trim().split('\n').at(-1));await copyFile(path.join(summary.output,'diagnostic.json'),path.join(root,'docs/operations/TABLE_ACCESS_AFTER_212.json'));}
}
