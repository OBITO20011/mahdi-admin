// Exact205 inverse for immutable historical evidence;current diagnostics stay unprojected.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const receiving205Pins=JSON.parse(readFileSync(new URL('./product-receiving205-hunks.json',import.meta.url),'utf8')).entries;
const hash=s=>createHash('sha256').update(s).digest('hex');
export function sourceBeforeProductReceiving205(file,text){
 const source=text.replaceAll('\r\n','\n'),pin=receiving205Pins[file];if(!pin)return source;
 if(pin.before&&hash(source)===pin.before)return source;
 assert.equal(hash(source),pin.after,'RECEIVING205_ENTIRE_CURRENT_FILE_CHANGED:'+file);if(pin.added)return null;
 const lines=source.split('\n');for(const h of [...pin.hunks].reverse()){const at=h.after.length?h.at-1:h.at;assert.deepEqual(lines.slice(at,at+h.after.length),h.after,'RECEIVING205_EXACT_HUNK:'+file);lines.splice(at,h.after.length,...h.before);}
 const restored=lines.join('\n');assert.equal(hash(restored),pin.before,'RECEIVING205_ENTIRE_RESTORED_FILE_CHANGED:'+file);return restored;
}
export function restoreProductReceiving205SourceHashes(sources){return sources.flatMap(s=>{const pin=receiving205Pins[s.file];if(!pin||s.sha256===pin.before)return [s];assert.equal(s.sha256,pin.after,'RECEIVING205_SOURCE_HASH:'+s.file);const text=sourceBeforeProductReceiving205(s.file,readFileSync(new URL('../../'+s.file,import.meta.url),'utf8'));return text===null?[]:[{...s,sha256:hash(text)}];});}
export async function inventoryBeforeProductReceiving205(){const {inventory}=await import('./table-access-inventory.mjs');return inventory({projectSource:sourceBeforeProductReceiving205});}
