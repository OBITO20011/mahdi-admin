// Exact additive inverse over delivered main6a7d99e. All old pins are immutable.
import assert from 'node:assert/strict';
import {sourceBeforeTrialW,restoreTrialWSourceHashes,projectTrialWQuerySites} from './source-before-trial-owner-w.mjs';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const trialHPins=JSON.parse(readFileSync(new URL('./trial-brand-hunks.json',import.meta.url),'utf8')).entries;
const hash=s=>createHash('sha256').update(s).digest('hex'),olderHashes=new Map();
for(const name of ['trial-aftercare','trial-sale-receipts','parcel209','trial-owner-a','pretrial-p1','supplier-replacement208','correction-recovery-c8','document-corrections207','storefront-c6','navigation-cash206','product-receiving205','sales-history204','collections202','home-damage201','warehouse-management','unit-terminology']){
 for(const [file,pin]of Object.entries(JSON.parse(readFileSync(new URL('./'+name+'-hunks.json',import.meta.url),'utf8')).entries)){
  const hashes=olderHashes.get(file)??new Set();if(pin.before)hashes.add(pin.before);hashes.add(pin.after);olderHashes.set(file,hashes);
 }
}
export function sourceBeforeTrialH(file,text){
 const source=sourceBeforeTrialW(file,text);if(source===null)return null;const pin=trialHPins[file];if(!pin)return source;
 const digest=hash(source);if(digest===pin.before||olderHashes.get(file)?.has(digest))return source;
 assert.equal(digest,pin.after,(pin.errorPrefix??'TRIAL_H_ENTIRE_CURRENT_FILE_CHANGED:')+file);
 if(pin.added)return null;
 const lines=source.split('\n');for(const h of [...pin.hunks].reverse()){
  const at=h.after.length?h.at-1:h.at;assert.deepEqual(lines.slice(at,at+h.after.length),h.after,'TRIAL_H_EXACT_HUNK:'+file);
  lines.splice(at,h.after.length,...h.before);
 }
 const restored=lines.join('\n');assert.equal(hash(restored),pin.before,'TRIAL_H_ENTIRE_RESTORED_FILE_CHANGED:'+file);return restored;
}
export function restoreTrialHSourceHashes(sources){return restoreTrialWSourceHashes(sources).flatMap(s=>{
 const pin=trialHPins[s.file];if(!pin||s.sha256===pin.before||olderHashes.get(s.file)?.has(s.sha256))return [s];
 assert.equal(s.sha256,pin.after,'TRIAL_H_SOURCE_HASH:'+s.file);
 const text=sourceBeforeTrialH(s.file,readFileSync(new URL('../../'+s.file,import.meta.url),'utf8'));
 return text===null?[]:[{...s,sha256:hash(text)}];
});}
export function projectTrialHQuerySites(source,parseSource){
 assert.equal(typeof parseSource,'function','TRIAL_H_SOURCE_PARSER_REQUIRED');source=projectTrialWQuerySites(source,parseSource);const entries=[];
 for(const file of new Set(source.entries.map(e=>e.file))){
  const supplied=source.entries.filter(e=>e.file===file),pin=trialHPins[file];if(!pin){entries.push(...supplied);continue;}
  const raw=sourceBeforeTrialW(file,readFileSync(new URL('../../'+file,import.meta.url),'utf8'));assert.notEqual(raw,null,'TRIAL_H_QUERY_FILE_REQUIRED');const before=sourceBeforeTrialH(file,raw),entry=source.sources.find(s=>s.file===file);
  assert.ok(entry,'HISTORICAL_QUERY_SOURCE_REQUIRED:TRIAL_H:'+file);
  if(entry.sha256!==hash(raw)){assert.ok((before!==null&&entry.sha256===hash(before))||olderHashes.get(file)?.has(entry.sha256),'HISTORICAL_QUERY_SOURCE_HASH:TRIAL_H:'+file);entries.push(...supplied);continue;}
  const current=parseSource(file,raw).entries,keys=Object.keys(current[0]??{}),pick=e=>Object.fromEntries(keys.map(k=>[k,e[k]]));
  assert.deepEqual(supplied.map(pick),current,'HISTORICAL_QUERY_INVENTORY_DRIFT:TRIAL_H:'+file);
  if(before===null){assert.equal(pin.added,true);continue;}
  const restored=parseSource(file,before).entries;assert.equal(restored.length,current.length,'HISTORICAL_QUERY_COUNT_CHANGED:TRIAL_H:'+file);
  entries.push(...supplied.map((e,index)=>({...e,...restored[index]})));
 }
 return {...source,entries,sources:restoreTrialHSourceHashes(source.sources)};
}
