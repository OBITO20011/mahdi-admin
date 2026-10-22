// Exact additive inverse over delivered main4795e70; older evidence stays immutable.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const trialOwnerAPins=JSON.parse(readFileSync(new URL('./trial-owner-a-hunks.json',import.meta.url),'utf8')).entries;
const hash=s=>createHash('sha256').update(s).digest('hex'),olderHashes=new Map();
for(const name of ['pretrial-p1','supplier-replacement208','correction-recovery-c8','document-corrections207','storefront-c6','navigation-cash206','product-receiving205','sales-history204','collections202','home-damage201','warehouse-management','unit-terminology']){
 for(const [file,pin]of Object.entries(JSON.parse(readFileSync(new URL('./'+name+'-hunks.json',import.meta.url),'utf8')).entries)){
  const hashes=olderHashes.get(file)??new Set();if(pin.before)hashes.add(pin.before);hashes.add(pin.after);olderHashes.set(file,hashes);
 }
}
export function sourceBeforeTrialOwnerA(file,text){
 const source=text.replaceAll('\r\n','\n'),pin=trialOwnerAPins[file];if(!pin)return source;
 const digest=hash(source);if(digest===pin.before||olderHashes.get(file)?.has(digest))return source;
 assert.equal(digest,pin.after,(pin.errorPrefix??'TRIAL_A_ENTIRE_CURRENT_FILE_CHANGED:')+file);
 if(pin.added)return null;
 const lines=source.split('\n');for(const h of [...pin.hunks].reverse()){
  const at=h.after.length?h.at-1:h.at;assert.deepEqual(lines.slice(at,at+h.after.length),h.after,'TRIAL_A_EXACT_HUNK:'+file);
  lines.splice(at,h.after.length,...h.before);
 }
 const restored=lines.join('\n');assert.equal(hash(restored),pin.before,'TRIAL_A_ENTIRE_RESTORED_FILE_CHANGED:'+file);return restored;
}
export function restoreTrialOwnerASourceHashes(sources){return sources.flatMap(s=>{
 const pin=trialOwnerAPins[s.file];if(!pin||s.sha256===pin.before||olderHashes.get(s.file)?.has(s.sha256))return [s];
 assert.equal(s.sha256,pin.after,'TRIAL_A_SOURCE_HASH:'+s.file);
 const text=sourceBeforeTrialOwnerA(s.file,readFileSync(new URL('../../'+s.file,import.meta.url),'utf8'));
 return text===null?[]:[{...s,sha256:hash(text)}];
});}
// Historical proofs exclude only the exactly pinned added A query site. The
// current SDK gate still verifies every real site and every role/variant.
export function projectTrialOwnerAQuerySites(source,parseSource){
 assert.equal(typeof parseSource,'function','TRIAL_A_SOURCE_PARSER_REQUIRED');
 const entries=[];
 for(const file of new Set(source.entries.map(e=>e.file))){
  const supplied=source.entries.filter(e=>e.file===file),pin=trialOwnerAPins[file];
  if(!pin){entries.push(...supplied);continue;}
  const raw=readFileSync(new URL('../../'+file,import.meta.url),'utf8').replaceAll('\r\n','\n');
  const before=sourceBeforeTrialOwnerA(file,raw),entry=source.sources.find(s=>s.file===file);
  assert.ok(entry,'HISTORICAL_QUERY_SOURCE_REQUIRED:TRIAL_A:'+file);
  if(entry.sha256!==hash(raw)){
   assert.ok((before!==null&&entry.sha256===hash(before))||olderHashes.get(file)?.has(entry.sha256),'HISTORICAL_QUERY_SOURCE_HASH:TRIAL_A:'+file);
   entries.push(...supplied);continue;
  }
  const current=parseSource(file,raw).entries,keys=Object.keys(current[0]??{});
  const pick=e=>Object.fromEntries(keys.map(k=>[k,e[k]]));
  assert.deepEqual(supplied.map(pick),current,'HISTORICAL_QUERY_INVENTORY_DRIFT:TRIAL_A:'+file);
  if(before===null){assert.equal(pin.added,true);continue;}
  const restored=parseSource(file,before).entries;assert.equal(restored.length,current.length,'HISTORICAL_QUERY_COUNT_CHANGED:TRIAL_A:'+file);
  entries.push(...supplied.map((e,index)=>({...e,...restored[index]})));
 }
 return {...source,entries,sources:restoreTrialOwnerASourceHashes(source.sources)};
}
export async function inventoryBeforeTrialOwnerA(){const {inventory}=await import('./table-access-inventory.mjs');return inventory({projectSource:sourceBeforeTrialOwnerA});}
