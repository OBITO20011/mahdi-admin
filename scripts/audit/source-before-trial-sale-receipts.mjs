// Exact additive inverse over delivered main 581cb97; older evidence stays immutable.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const trialDPins=JSON.parse(readFileSync(new URL('./trial-sale-receipts-hunks.json',import.meta.url),'utf8')).entries;
const hash=s=>createHash('sha256').update(s).digest('hex'),olderHashes=new Map();
for(const name of ['parcel209','trial-owner-a','pretrial-p1','supplier-replacement208','correction-recovery-c8','document-corrections207','storefront-c6','navigation-cash206','product-receiving205','sales-history204','collections202','home-damage201','warehouse-management','unit-terminology']){
 for(const [file,pin]of Object.entries(JSON.parse(readFileSync(new URL('./'+name+'-hunks.json',import.meta.url),'utf8')).entries)){
  const hashes=olderHashes.get(file)??new Set();if(pin.before)hashes.add(pin.before);hashes.add(pin.after);olderHashes.set(file,hashes);
 }
}
export function sourceBeforeTrialD(file,text){
 const source=text.replaceAll('\r\n','\n'),pin=trialDPins[file];if(!pin)return source;
 const digest=hash(source);if(digest===pin.before||olderHashes.get(file)?.has(digest))return source;
 assert.equal(digest,pin.after,(pin.errorPrefix??'TRIAL_D_ENTIRE_CURRENT_FILE_CHANGED:')+file);
 if(pin.added)return null;
 const lines=source.split('\n');for(const h of [...pin.hunks].reverse()){
  const at=h.after.length?h.at-1:h.at;assert.deepEqual(lines.slice(at,at+h.after.length),h.after,'TRIAL_D_EXACT_HUNK:'+file);
  lines.splice(at,h.after.length,...h.before);
 }
 const restored=lines.join('\n');assert.equal(hash(restored),pin.before,'TRIAL_D_ENTIRE_RESTORED_FILE_CHANGED:'+file);return restored;
}
export function restoreTrialDSourceHashes(sources){return sources.flatMap(s=>{
 const pin=trialDPins[s.file];if(!pin||s.sha256===pin.before||olderHashes.get(s.file)?.has(s.sha256))return [s];
 assert.equal(s.sha256,pin.after,'TRIAL_D_SOURCE_HASH:'+s.file);
 const text=sourceBeforeTrialD(s.file,readFileSync(new URL('../../'+s.file,import.meta.url),'utf8'));
 return text===null?[]:[{...s,sha256:hash(text)}];
});}
// D changes only presentation and existing saved-column selections. The
// current SDK gate still verifies every real site and every role/variant.
export function projectTrialDQuerySites(source,parseSource){
 assert.equal(typeof parseSource,'function','TRIAL_D_SOURCE_PARSER_REQUIRED');
 const entries=[];
 for(const file of new Set(source.entries.map(e=>e.file))){
  const supplied=source.entries.filter(e=>e.file===file),pin=trialDPins[file];
  if(!pin){entries.push(...supplied);continue;}
  const raw=readFileSync(new URL('../../'+file,import.meta.url),'utf8').replaceAll('\r\n','\n');
  const before=sourceBeforeTrialD(file,raw),entry=source.sources.find(s=>s.file===file);
  assert.ok(entry,'HISTORICAL_QUERY_SOURCE_REQUIRED:TRIAL_D:'+file);
  if(entry.sha256!==hash(raw)){
   assert.ok((before!==null&&entry.sha256===hash(before))||olderHashes.get(file)?.has(entry.sha256),'HISTORICAL_QUERY_SOURCE_HASH:TRIAL_D:'+file);
   entries.push(...supplied);continue;
  }
  const current=parseSource(file,raw).entries,keys=Object.keys(current[0]??{});
  const pick=e=>Object.fromEntries(keys.map(k=>[k,e[k]]));
  assert.deepEqual(supplied.map(pick),current,'HISTORICAL_QUERY_INVENTORY_DRIFT:TRIAL_D:'+file);
  if(before===null){assert.equal(pin.added,true);continue;}
  const restored=parseSource(file,before).entries;assert.equal(restored.length,current.length,'HISTORICAL_QUERY_COUNT_CHANGED:TRIAL_D:'+file);
  entries.push(...supplied.map((e,index)=>({...e,...restored[index]})));
 }
 return {...source,entries,sources:restoreTrialDSourceHashes(source.sources)};
}
export async function inventoryBeforeTrialD(){const {inventory}=await import('./table-access-inventory.mjs');return inventory({projectSource:sourceBeforeTrialD});}

// Frozen209 compatibility never substitutes for actual current-source readiness.
export async function verifiedInventoryBeforeTrialD(){
 const {inventory}=await import('./table-access-inventory.mjs');
 const {verifyProbeCoverage}=await import('./table-access-probes.mjs');
 const current=await inventory(),state=JSON.parse(readFileSync(new URL('../../docs/agent/project-state.json',import.meta.url),'utf8'));
 assert.match(state.currentTableReadinessEvidence,/^docs\/operations\/TABLE_ACCESS_AFTER_[A-Z0-9_]+\.json$/u);
 const proof=JSON.parse(readFileSync(new URL('../../'+state.currentTableReadinessEvidence,import.meta.url),'utf8'));
 assert.equal(proof.migrationCeiling,state.migrationCeiling);assert.equal(proof.managedAccess,false);
 assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);assert.deepEqual(proof.sourceHashes,current.sources);
 assert.deepEqual(proof.coverage,verifyProbeCoverage(current,proof.results));assert.ok(proof.results.every(r=>r.sqlstate===null));
 return inventoryBeforeTrialD();
}
