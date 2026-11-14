import{readFile}from'node:fs/promises';import{prepareWorkbookRuntimeView,cleanupWorkbookRuntimeView}from'./product-workbook-runtime-view.mjs';
// Independent current219 evidence. Each child finishes before any source/proof
// is written or next bootstrap starts;no hosted targets or owner configuration.
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {mkdtemp,copyFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {inventory,writeInventory} from '../audit/table-access-inventory.mjs';import {serviceInventory,saveServices} from '../audit/service-access-inventory.mjs';import {enrichService217Evidence} from '../audit/enrich-service217-evidence.mjs';
import {home219ServiceProbeArgs} from './home219-service-probe.mjs';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..');
if([220,222].includes(JSON.parse(await readFile(path.join(root,'docs/agent/project-state.json'),'utf8')).migrationCeiling)){const view=await prepareWorkbookRuntimeView({schemaOnly:true});try{const result=await exec(process.execPath,['scripts/testing/run-home219-operations-gates.mjs',...process.argv.slice(2)],{cwd:view.root,windowsHide:true,maxBuffer:32*1024**2});process.stdout.write(result.stdout);process.stderr.write(result.stderr);}finally{await cleanupWorkbookRuntimeView(view.root);}process.exit(0);}
const serviceProbe=home219ServiceProbeArgs(process.argv.slice(2));
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-home219-operations-')),reference=path.join(output,'local-reference-through219-ready.json');
for(const args of[
 ['scripts/audit/run-table-access-diagnostic.mjs','--migration-ceiling','219','--require-access'],
 serviceProbe,
 ['scripts/testing/generate-db-functions.mjs','--check'],
 ['scripts/operations/build-acl-reference219.mjs','--output',reference],
 ['scripts/testing/run-owner-upgrade219-runtime.mjs',reference],
 ['scripts/testing/run-reset219-resume-runtime.mjs',reference],
 ['scripts/testing/run-reset219-cli-contract.mjs',reference],
]){
 const r=await exec(process.execPath,args,{cwd:root,windowsHide:true,maxBuffer:32*1024**2});process.stdout.write(r.stdout);process.stderr.write(r.stderr);
 if(args[0]==='scripts/audit/run-table-access-diagnostic.mjs'){const summary=JSON.parse(r.stdout.trim().split('\n').at(-1));await copyFile(path.join(summary.output,'diagnostic.json'),path.join(root,'docs/operations/TABLE_ACCESS_AFTER_219.json'));await writeInventory(await inventory());}
 if(args[0]==='scripts/audit/run-service-access-diagnostic.mjs'){const summary=JSON.parse(r.stdout.trim().split('\n').at(-1));await enrichService217Evidence(path.join(summary.output,'diagnostic.json'),{ceiling:219});await saveServices(await serviceInventory());}
}
console.log(JSON.stringify({ok:true,output,reference,managedAccess:false,ceiling:219,migrations:180}));
