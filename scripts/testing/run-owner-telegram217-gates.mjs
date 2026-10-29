// Independent current217 evidence. Each child finishes before any source/proof
// is written or next bootstrap starts;no hosted targets or owner configuration.
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {mkdtemp,copyFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {inventory,writeInventory} from '../audit/table-access-inventory.mjs';import {serviceInventory,saveServices} from '../audit/service-access-inventory.mjs';import {enrichService217Evidence} from '../audit/enrich-service217-evidence.mjs';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..');
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-owner-telegram217-gates-')),reference=path.join(output,'local-reference-through217-ready.json');
for(const args of[
 ['scripts/audit/run-table-access-diagnostic.mjs','--migration-ceiling','217','--require-access'],
 ['scripts/audit/run-service-access-diagnostic.mjs','--migration-ceiling','217'],
 ['scripts/testing/generate-db-functions.mjs','--check'],
 ['scripts/operations/build-acl-reference217.mjs','--output',reference],
 ['scripts/testing/run-owner-upgrade217-runtime.mjs',reference],
 ['scripts/testing/run-reset217-resume-runtime.mjs',reference],
 ['scripts/testing/run-reset217-cli-contract.mjs',reference],
]){
 const r=await exec(process.execPath,args,{cwd:root,windowsHide:true,maxBuffer:32*1024**2});process.stdout.write(r.stdout);process.stderr.write(r.stderr);
 if(args[0]==='scripts/audit/run-table-access-diagnostic.mjs'){const summary=JSON.parse(r.stdout.trim().split('\n').at(-1));await copyFile(path.join(summary.output,'diagnostic.json'),path.join(root,'docs/operations/TABLE_ACCESS_AFTER_217.json'));await writeInventory(await inventory());}
 if(args[0]==='scripts/audit/run-service-access-diagnostic.mjs'){const summary=JSON.parse(r.stdout.trim().split('\n').at(-1));await enrichService217Evidence(path.join(summary.output,'diagnostic.json'));await saveServices(await serviceInventory());}
}
console.log(JSON.stringify({ok:true,output,reference,managedAccess:false,ceiling:217,migrations:179}));
