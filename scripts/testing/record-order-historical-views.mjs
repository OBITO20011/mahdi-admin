// Test-entry compatibility only. Owner/RESET dependencies remain literal.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {inventory} from '../audit/table-access-inventory.mjs';
import {verifyProbeCoverage} from '../audit/table-access-probes.mjs';
import {historicalProductWorkbookSource,historicalProductWorkbookHashes,historicalProductWorkbookInventory,restoreProductWorkbookHashes} from '../audit/source-before-product-workbook.mjs';
import {inventoryBeforeTrialR} from '../audit/source-before-trial-owner-r.mjs';
const frozen=JSON.parse(readFileSync(new URL('./product-workbook-history.json',import.meta.url),'utf8'));
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const digest=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
export function historicalRecordOrderHashes(project,rows){
 assert.equal(project.name,'restorePartial216SourceHashes','RECORD_HISTORY_FIXED_HASH_OPERATION');
 const before=restoreProductWorkbookHashes(rows);
 // Unknown complete input stays unknown: never call an old reader against
 // unrelated current files, and never turn the altered hash into an expected one.
 if(digest(before)!==frozen.currentHashSignature)return before;
 return historicalProductWorkbookHashes(project,before);
}
export function pathsBeforeRecordOrderHistory(project,files,reference){
 assert.equal(project.name,'sourceBeforeAftercare215','RECORD_HISTORY_FIXED_SOURCE_OPERATION');
 return files.filter(file=>{
  const current=readFileSync(new URL('../../'+file,import.meta.url),'utf8');
  const prior=historicalProductWorkbookSource(project,file,current);if(prior===null)return false;
  if(!reference)return prior.replaceAll('\r\n','\n')===current.replaceAll('\r\n','\n');
  let old;try{old=execFileSync('git',['show',reference+':'+file],{encoding:'utf8',windowsHide:true,maxBuffer:64*1024**2,stdio:['ignore','pipe','pipe']});}catch{return true;}
  return prior.replaceAll('\r\n','\n')!==old.replaceAll('\r\n','\n');
 });
}
export async function verifiedRecordOrderInventoryBeforeTrialR(){
 const current=await inventory(),state=JSON.parse(readFileSync(new URL('../../docs/agent/project-state.json',import.meta.url),'utf8'));
 assert.match(state.currentTableReadinessEvidence,/^docs\/operations\/TABLE_ACCESS_AFTER_[A-Z0-9_]+\.json$/u);
 const proof=JSON.parse(readFileSync(new URL('../../'+state.currentTableReadinessEvidence,import.meta.url),'utf8'));
 assert.equal(proof.migrationCeiling,state.migrationCeiling);assert.equal(proof.managedAccess,false);assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);assert.deepEqual(proof.sourceHashes,current.sources);
 assert.deepEqual(proof.coverage,verifyProbeCoverage(current,proof.results));assert.ok(proof.results.every(r=>r.sqlstate===null));
 return historicalProductWorkbookInventory(inventoryBeforeTrialR);
}
