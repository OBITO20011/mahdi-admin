// One local-only sequence;no overlapping bootstraps or source writes while
// a child verifier runs. Current216 evidence is independent of frozen215.
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {mkdtemp,copyFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {inventory,writeInventory} from '../audit/table-access-inventory.mjs';
import {serviceInventory,saveServices} from '../audit/service-access-inventory.mjs';
import {enrichService216Evidence} from '../audit/enrich-service216-evidence.mjs';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..');
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-partial216-gate-')),reference=path.join(output,'local-reference-through216-ready.json');
for(const args of[
 ['scripts/testing/run-partial216-runtime.mjs'],
 ['scripts/testing/run-partial216-fullstack.mjs'],
 ['scripts/audit/run-table-access-diagnostic.mjs','--migration-ceiling','216','--require-access'],
 ['scripts/audit/run-service-access-diagnostic.mjs','--migration-ceiling','216'],
 ['scripts/testing/generate-db-functions.mjs','--check'],
 ['scripts/operations/build-acl-reference216.mjs','--output',reference],
 ['scripts/testing/run-partial-upgrade216-runtime.mjs',reference],
 ['scripts/testing/run-reset216-resume-runtime.mjs',reference],
 ['scripts/testing/run-reset216-cli-contract.mjs',reference],
]){
 const result=await exec(process.execPath,args,{cwd:root,windowsHide:true,maxBuffer:32*1024**2});process.stdout.write(result.stdout);process.stderr.write(result.stderr);
 if(args[0]==='scripts/audit/run-table-access-diagnostic.mjs'){
  const summary=JSON.parse(result.stdout.trim().split('\n').at(-1));await copyFile(path.join(summary.output,'diagnostic.json'),path.join(root,'docs/operations/TABLE_ACCESS_AFTER_216.json'));await writeInventory(await inventory());
 }
 if(args[0]==='scripts/audit/run-service-access-diagnostic.mjs'){
  const summary=JSON.parse(result.stdout.trim().split('\n').at(-1));await enrichService216Evidence(path.join(summary.output,'diagnostic.json'));await saveServices(await serviceInventory());
 }
}
console.log(JSON.stringify({ok:true,output,reference,managedAccess:false,ceiling:216,migrations:178}));
