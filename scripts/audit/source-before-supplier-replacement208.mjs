// C9 exact inverse over delivered main7e325a0. Earlier evidence/pins stay immutable.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {sourceBeforePretrialP1,restorePretrialP1SourceHashes} from './source-before-pretrial-p1.mjs';
export const supplier208Pins=JSON.parse(readFileSync(new URL('./supplier-replacement208-hunks.json',import.meta.url),'utf8')).entries;
const hash=text=>createHash('sha256').update(text).digest('hex'),olderBeforePins=new Map();
for(const name of ['correction-recovery-c8','document-corrections207','storefront-c6','navigation-cash206','product-receiving205','sales-history204','collections202','home-damage201','warehouse-management','unit-terminology']){
  for(const [file,pin]of Object.entries(JSON.parse(readFileSync(new URL('./'+name+'-hunks.json',import.meta.url),'utf8')).entries)){
    if(!pin.before)continue;const known=olderBeforePins.get(file)??new Set();known.add(pin.before);olderBeforePins.set(file,known);
  }
}
export function sourceBeforeSupplierReplacement208(file,text){
  const source=sourceBeforePretrialP1(file,text),pin=supplier208Pins[file];if(source===null)return null;if(!pin)return source;
  if((pin.before&&hash(source)===pin.before)||olderBeforePins.get(file)?.has(hash(source)))return source;
  // Retain the prior family's public rejection identity for callers exercising
  // its immutable mutation tests; C9 adds full-file protection before it.
  assert.equal(hash(source),pin.after,(pin.errorPrefix??'SUPPLIER_REPLACEMENT208_ENTIRE_CURRENT_FILE_CHANGED:')+'C9:'+file);
  if(pin.added)return null;
  const lines=source.split('\n');for(const h of [...pin.hunks].reverse()){
    const at=h.after.length?h.at-1:h.at;assert.deepEqual(lines.slice(at,at+h.after.length),h.after,'SUPPLIER_REPLACEMENT208_EXACT_HUNK:'+file);lines.splice(at,h.after.length,...h.before);
  }
  const restored=lines.join('\n');assert.equal(hash(restored),pin.before,'SUPPLIER_REPLACEMENT208_ENTIRE_RESTORED_FILE_CHANGED:'+file);return restored;
}
export function restoreSupplier208SourceHashes(sources){return restorePretrialP1SourceHashes(sources).flatMap(s=>{
  const pin=supplier208Pins[s.file];if(!pin||s.sha256===pin.before||olderBeforePins.get(s.file)?.has(s.sha256))return [s];
  assert.equal(s.sha256,pin.after,'SUPPLIER_REPLACEMENT208_SOURCE_HASH:'+s.file);
  const text=sourceBeforeSupplierReplacement208(s.file,readFileSync(new URL('../../'+s.file,import.meta.url),'utf8'));
  return text===null?[]:[{...s,sha256:hash(text)}];
});}
export async function inventoryBeforeSupplierReplacement208(){const {inventory}=await import('./table-access-inventory.mjs');return inventory({projectSource:sourceBeforeSupplierReplacement208});}
