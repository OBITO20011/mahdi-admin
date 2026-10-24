// Local evidence composition only. Keep the seven-object15Oct saved-catalog
// review historical; derive EVERY effective local grant from the new214 probe.
import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {readFile,writeFile} from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {oldReferences} from './service-access-report.mjs';import {serviceInventory} from './service-access-inventory.mjs';
const root=path.resolve(import.meta.dirname,'../..'),baseline='703fc51abb6b65ce2df2edcf14c6ecb235b74ddf';
export async function enrichService214Evidence(file){
 const evidence=JSON.parse(await readFile(file,'utf8')),source=await serviceInventory();assert.equal(evidence.ok,true);assert.equal(evidence.migrationCeiling,214);assert.deepEqual(evidence.sourceHashes,source.sourceHashes);
 const historic=JSON.parse(execFileSync('git',['show',baseline+':docs/operations/SERVICE_ACCESS_DIAGNOSTIC.json'],{cwd:root,encoding:'utf8',maxBuffer:8*1024**2}));assert.equal(historic.sevenFunctions.length,7);
 evidence.savedCatalogAssessment=historic.savedCatalogAssessment;
 evidence.sevenFunctions=historic.sevenFunctions.map(f=>({...f,effectiveLocal:evidence.execute.filter(e=>e.identity===f.identity),invocationResults:evidence.results.filter(r=>r.name===f.identity.split('(')[0]).map(r=>({site:r.site,role:r.role,appRole:r.appRole,sqlstate:r.sqlstate,outcome:r.outcome}))}));
 evidence.savedCatalogProvenance={baseline,scope:'Historical15Oct saved-catalog review only;effectiveLocal and invocationResults measured anew on214;no hosted read'};
 evidence.oldReferences=await oldReferences();
 await writeFile(path.join(root,'docs/operations/SERVICE_ACCESS_DIAGNOSTIC.json'),JSON.stringify(evidence,null,2)+'\n');return {ok:true,probes:evidence.results.length,historicalReviewObjects:7,hostedRead:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)console.log(JSON.stringify(await enrichService214Evidence(process.argv[2])));
