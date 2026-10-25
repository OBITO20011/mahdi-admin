import {enrichService213Evidence} from '../audit/enrich-service213-evidence.mjs';
// Complete local acceptance; serial database identities, no hosted endpoint.
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {mkdtemp,copyFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..'),output=await mkdtemp(path.join(tmpdir(),'nawasrah-handover213-gate-')),reference=path.join(output,'local-reference-through213-ready.json');
for(const args of [['scripts/testing/verify-edge-locks213.mjs'],['scripts/audit/run-table-access-diagnostic.mjs','--migration-ceiling','213','--require-access'],['scripts/audit/run-service-access-diagnostic.mjs','--migration-ceiling','213'],['scripts/testing/run-handover213-runtime.mjs'],['scripts/operations/build-acl-reference213.mjs','--output',reference],['scripts/testing/run-handover-upgrade213-runtime.mjs',reference],['scripts/testing/run-trial-reset-runtime.mjs',reference,'--current213']]){
 const result=await exec(process.execPath,args,{cwd:root,windowsHide:true,maxBuffer:16*1024**2});process.stdout.write(result.stdout);process.stderr.write(result.stderr);
 if(args[0]==='scripts/audit/run-service-access-diagnostic.mjs'){const summary=JSON.parse(result.stdout.trim().split('\n').at(-1));await enrichService213Evidence(path.join(summary.output,'diagnostic.json'));}
 if(args[0]==='scripts/audit/run-table-access-diagnostic.mjs'){const summary=JSON.parse(result.stdout.trim().split('\n').at(-1));await copyFile(path.join(summary.output,'diagnostic.json'),path.join(root,'docs/operations/TABLE_ACCESS_AFTER_213.json'));}
}
