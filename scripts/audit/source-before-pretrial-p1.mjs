// Presentation/PWA exact inverse over accepted main208. Older pins stay immutable.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {sourceBeforeTrialOwnerA,restoreTrialOwnerASourceHashes} from './source-before-trial-owner-a.mjs';
export const pretrialP1Pins=JSON.parse(readFileSync(new URL('./pretrial-p1-hunks.json',import.meta.url),'utf8')).entries;
const hash=s=>createHash('sha256').update(s).digest('hex'),olderHashes=new Map();
for(const name of ['supplier-replacement208','correction-recovery-c8','document-corrections207','storefront-c6','navigation-cash206','product-receiving205','sales-history204','collections202','home-damage201','warehouse-management','unit-terminology']){
  for(const[file,pin]of Object.entries(JSON.parse(readFileSync(new URL('./'+name+'-hunks.json',import.meta.url),'utf8')).entries)){
    const hashes=olderHashes.get(file)??new Set();if(pin.before)hashes.add(pin.before);hashes.add(pin.after);olderHashes.set(file,hashes);
  }
}
export function sourceBeforePretrialP1(file,text){
  const source=sourceBeforeTrialOwnerA(file,text),pin=pretrialP1Pins[file];if(source===null)return null;if(!pin)return source;
  const digest=hash(source);if(digest===pin.before||olderHashes.get(file)?.has(digest))return source;
  assert.equal(digest,pin.after,(pin.errorPrefix??'PRETRIAL_P1_ENTIRE_CURRENT_FILE_CHANGED:')+file);
  if(pin.added)return null;
  const lines=source.split('\n');for(const h of [...pin.hunks].reverse()){
    const at=h.after.length?h.at-1:h.at;assert.deepEqual(lines.slice(at,at+h.after.length),h.after,'PRETRIAL_P1_EXACT_HUNK:'+file);lines.splice(at,h.after.length,...h.before);
  }
  const restored=lines.join('\n');assert.equal(hash(restored),pin.before,'PRETRIAL_P1_ENTIRE_RESTORED_FILE_CHANGED:'+file);return restored;
}
export function restorePretrialP1SourceHashes(sources){return restoreTrialOwnerASourceHashes(sources).flatMap(s=>{
  const pin=pretrialP1Pins[s.file];if(!pin||s.sha256===pin.before||olderHashes.get(s.file)?.has(s.sha256))return [s];
  assert.equal(s.sha256,pin.after,'PRETRIAL_P1_SOURCE_HASH:'+s.file);
  const text=sourceBeforePretrialP1(s.file,readFileSync(new URL('../../'+s.file,import.meta.url),'utf8'));
  return text===null?[]:[{...s,sha256:hash(text)}];
});}
export async function inventoryBeforePretrialP1(){const {inventory}=await import('./table-access-inventory.mjs');return inventory({projectSource:sourceBeforePretrialP1});}
