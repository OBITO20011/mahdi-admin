// Exact owner-approved 202 read inverse for historical evidence only.
// Current runtime/read mapping has separate201 proofs; no broad hash repinning.
import {sourceBeforeSales204,restoreSales204SourceHashes} from './source-before-sales-history204.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const collections202Pins=JSON.parse(readFileSync(new URL('./collections202-hunks.json',import.meta.url),'utf8')).entries;
const hash=value=>createHash('sha256').update(value).digest('hex');
export function sourceBeforeCollections202(file,text){
 const source=sourceBeforeSales204(file,text);if(source===null)return null;const pin=collections202Pins[file];if(!pin)return source;
 if(pin.before&&hash(source)===pin.before)return source;
 assert.equal(hash(source),pin.after,'COLLECTIONS202_ENTIRE_CURRENT_FILE_CHANGED:'+file);
 if(pin.added)return null;
 const lines=source.split('\n');
 for(const h of [...pin.hunks].reverse()){
  const at=h.after.length?h.at-1:h.at;
  assert.deepEqual(lines.slice(at,at+h.after.length),h.after,'COLLECTIONS202_EXACT_HUNK:'+file);
  lines.splice(at,h.after.length,...h.before);
 }
 const restored=lines.join('\n');assert.equal(hash(restored),pin.before,'COLLECTIONS202_ENTIRE_RESTORED_FILE_CHANGED:'+file);return restored;
}
export function restoreCollections202SourceHashes(sources){
 return restoreSales204SourceHashes(sources).flatMap(s=>{const pin=collections202Pins[s.file];if(!pin)return [s];
  assert.equal(s.sha256,pin.after,'COLLECTIONS202_CURRENT_SOURCE_HASH:'+s.file);
  const restored=sourceBeforeCollections202(s.file,readFileSync(new URL('../../'+s.file,import.meta.url),'utf8'));
  return restored===null?[]:[{...s,sha256:hash(restored)}];
 });
}

export async function inventoryBeforeCollections202(){const {inventoryBeforeSales204}=await import('./source-before-sales-history204.mjs');const source=await inventoryBeforeSales204();return {...source,sources:restoreCollections202SourceHashes(source.sources)};}
