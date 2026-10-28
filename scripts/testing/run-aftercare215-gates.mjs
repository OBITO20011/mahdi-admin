// Every gate is local-only and sequential: no shared bootstrap races and no
// source writes while a verifier is running. Persist outputs after it exits.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {inventory,writeInventory} from '../audit/table-access-inventory.mjs';
import {serviceInventory,saveServices} from '../audit/service-access-inventory.mjs';
import {enrichService215Evidence} from '../audit/enrich-service215-evidence.mjs';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..');
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-aftercare215-gate-'));
const reference=path.join(output,'local-reference-through215-ready.json');
for(const args of [
 ['scripts/testing/run-aftercare215-runtime.mjs'],
 ['scripts/testing/run-aftercare215-fullstack.mjs'],
 ['scripts/audit/run-table-access-diagnostic.mjs','--migration-ceiling','215','--require-access'],
 ['scripts/audit/run-service-access-diagnostic.mjs','--migration-ceiling','215'],
 ['scripts/testing/generate-db-functions.mjs','--check'],
 ['scripts/operations/build-acl-reference215.mjs','--output',reference],
 ['scripts/testing/run-aftercare-upgrade215-runtime.mjs',reference],
]){
 const result=await exec(process.execPath,args,{cwd:root,windowsHide:true,maxBuffer:32*1024**2});
 process.stdout.write(result.stdout);process.stderr.write(result.stderr);
 if(args[0]==='scripts/audit/run-table-access-diagnostic.mjs'){
  const summary=JSON.parse(result.stdout.trim().split('\n').at(-1));
  await copyFile(path.join(summary.output,'diagnostic.json'),path.join(root,'docs/operations/TABLE_ACCESS_AFTER_215.json'));
  await writeInventory(await inventory());
 }
 if(args[0]==='scripts/audit/run-service-access-diagnostic.mjs'){
  const summary=JSON.parse(result.stdout.trim().split('\n').at(-1));
  await enrichService215Evidence(path.join(summary.output,'diagnostic.json'));await saveServices(await serviceInventory());
 }
}
