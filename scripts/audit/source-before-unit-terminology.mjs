// Exact reversible owner-approved presentation hunks. No excluded files or
// blanket string normalization: pin the whole current AND restored file.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {sourceBeforeWarehouseManagement,restoreWarehouseSourceHashes} from './source-before-warehouse-management.mjs';
const pins=JSON.parse(readFileSync(new URL('./unit-terminology-hunks.json',import.meta.url),'utf8')).entries;
const hash=value=>createHash('sha256').update(value).digest('hex');
export function sourceBeforeUnitTerminology(file,text){
 const canonical=text.replaceAll('\r\n','\n'),known=pins[file];
 // Older parity layers compose this projection. Only the EXACT already-restored
 // full-file pin may bypass the newer warehouse projection, never arbitrary code.
 if(known?.before&&hash(canonical)===known.before)return canonical;
 const source=sourceBeforeWarehouseManagement(file,text);if(source===null)return null;
 const pin=pins[file];if(!pin)return source;
 if(pin.before&&hash(source)===pin.before)return source;
 assert.equal(hash(source),pin.after,'TERMINOLOGY_ENTIRE_CURRENT_FILE_CHANGED:'+file);
 if(pin.added)return null;
 const lines=source.split('\n');
 for(const h of [...pin.hunks].reverse()){
  const at=h.after.length?h.at-1:h.at;
  assert.deepEqual(lines.slice(at,at+h.after.length),h.after,'TERMINOLOGY_EXACT_HUNK:'+file);
  lines.splice(at,h.after.length,...h.before);
 }
 const restored=lines.join('\n');assert.equal(hash(restored),pin.before,'TERMINOLOGY_ENTIRE_RESTORED_FILE_CHANGED:'+file);return restored;
}
export function restoreUnitSourceHashes(sources){
 return restoreWarehouseSourceHashes(sources).flatMap(s=>{const pin=pins[s.file];if(!pin)return [s];
  const restored=sourceBeforeUnitTerminology(s.file,readFileSync(new URL('../../'+s.file,import.meta.url),'utf8'));
  assert.equal(s.sha256,pin.after,'TERMINOLOGY_CURRENT_SOURCE_HASH:'+s.file);
  return restored===null?[]:[{...s,sha256:hash(restored)}];});
}
