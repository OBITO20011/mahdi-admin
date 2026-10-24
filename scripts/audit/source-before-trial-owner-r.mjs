// Exact additive inverse over delivered main88c7bd4. All old pins are immutable.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const trialRPins=JSON.parse(readFileSync(new URL('./trial-owner-r-hunks.json',import.meta.url),'utf8')).entries;
const hash=s=>createHash('sha256').update(s).digest('hex'),olderHashes=new Map();
for(const name of ['trial-owner-w','trial-brand','trial-aftercare','trial-sale-receipts','parcel209','trial-owner-a','pretrial-p1','supplier-replacement208','correction-recovery-c8','document-corrections207','storefront-c6','navigation-cash206','product-receiving205','sales-history204','collections202','home-damage201','warehouse-management','unit-terminology']){
 for(const [file,pin]of Object.entries(JSON.parse(readFileSync(new URL('./'+name+'-hunks.json',import.meta.url),'utf8')).entries)){
  const hashes=olderHashes.get(file)??new Set();if(pin.before)hashes.add(pin.before);hashes.add(pin.after);olderHashes.set(file,hashes);
 }
}
for(const [file,pin]of Object.entries(trialRPins)){for(const snapshot of pin.approvedHistoricalSnapshots??[]){const hashes=olderHashes.get(file)??new Set();hashes.add(snapshot.sha256);olderHashes.set(file,hashes);}}
export function sourceBeforeTrialR(file,text){
 const source=text.replaceAll('\r\n','\n'),pin=trialRPins[file];if(!pin)return source;
 const digest=hash(source);if(digest===pin.before||olderHashes.get(file)?.has(digest))return source;
 assert.equal(digest,pin.after,(pin.errorPrefix??'TRIAL_R_ENTIRE_CURRENT_FILE_CHANGED:')+file);
 if(pin.added)return null;
 const lines=source.split('\n');for(const h of [...pin.hunks].reverse()){
  const at=h.after.length?h.at-1:h.at;assert.deepEqual(lines.slice(at,at+h.after.length),h.after,'TRIAL_R_EXACT_HUNK:'+file);
  lines.splice(at,h.after.length,...h.before);
 }
 const restored=lines.join('\n');assert.equal(hash(restored),pin.before,'TRIAL_R_ENTIRE_RESTORED_FILE_CHANGED:'+file);return restored;
}
export function restoreTrialRSourceHashes(sources){return sources.flatMap(s=>{
 const pin=trialRPins[s.file];if(!pin||s.sha256===pin.before||olderHashes.get(s.file)?.has(s.sha256))return [s];
 assert.equal(s.sha256,pin.after,'TRIAL_R_SOURCE_HASH:'+s.file);
 const text=sourceBeforeTrialR(s.file,readFileSync(new URL('../../'+s.file,import.meta.url),'utf8'));
 return text===null?[]:[{...s,sha256:hash(text)}];
});}
export function projectTrialRQuerySites(source,parseSource){
 assert.equal(typeof parseSource,'function','TRIAL_R_SOURCE_PARSER_REQUIRED');const entries=[];
 for(const file of new Set(source.entries.map(e=>e.file))){
  const supplied=source.entries.filter(e=>e.file===file),pin=trialRPins[file];if(!pin){entries.push(...supplied);continue;}
  const raw=readFileSync(new URL('../../'+file,import.meta.url),'utf8').replaceAll('\r\n','\n'),before=sourceBeforeTrialR(file,raw),entry=source.sources.find(s=>s.file===file);
  assert.ok(entry,'HISTORICAL_QUERY_SOURCE_REQUIRED:TRIAL_R:'+file);
  if(entry.sha256!==hash(raw)){assert.ok((before!==null&&entry.sha256===hash(before))||olderHashes.get(file)?.has(entry.sha256),'HISTORICAL_QUERY_SOURCE_HASH:TRIAL_R:'+file);entries.push(...supplied);continue;}
  const current=parseSource(file,raw).entries,keys=Object.keys(current[0]??{}),pick=e=>Object.fromEntries(keys.map(k=>[k,e[k]]));
  assert.deepEqual(supplied.map(pick),current,'HISTORICAL_QUERY_INVENTORY_DRIFT:TRIAL_R:'+file);
  if(before===null){assert.equal(pin.added,true);continue;}
  const restored=parseSource(file,before).entries;assert.equal(restored.length,current.length,'HISTORICAL_QUERY_COUNT_CHANGED:TRIAL_R:'+file);
  entries.push(...supplied.map((e,index)=>({...e,...restored[index]})));
 }
 return {...source,entries,sources:restoreTrialRSourceHashes(source.sources)};
}

export async function inventoryBeforeTrialR(){const {inventory}=await import('./table-access-inventory.mjs');return inventory({projectSource:sourceBeforeTrialR});}
export async function verifiedInventoryBeforeTrialR(){
 const {inventory}=await import('./table-access-inventory.mjs'),{verifyProbeCoverage}=await import('./table-access-probes.mjs');
 const current=await inventory(),state=JSON.parse(readFileSync(new URL('../../docs/agent/project-state.json',import.meta.url),'utf8'));
 assert.match(state.currentTableReadinessEvidence,/^docs\/operations\/TABLE_ACCESS_AFTER_[A-Z0-9_]+\.json$/u);
 const proof=JSON.parse(readFileSync(new URL('../../'+state.currentTableReadinessEvidence,import.meta.url),'utf8'));
 assert.equal(proof.migrationCeiling,state.migrationCeiling);assert.equal(proof.managedAccess,false);assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);assert.deepEqual(proof.sourceHashes,current.sources);
 assert.deepEqual(proof.coverage,verifyProbeCoverage(current,proof.results));assert.ok(proof.results.every(r=>r.sqlstate===null));return inventoryBeforeTrialR();
}
