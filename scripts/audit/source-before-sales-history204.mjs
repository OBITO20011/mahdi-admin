// Exact204 inverse for immutable historical evidence;current diagnostics stay unprojected.
import {sourceBeforeProductReceiving205,restoreProductReceiving205SourceHashes} from './source-before-product-receiving205.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const sales204Pins=JSON.parse(readFileSync(new URL('./sales-history204-hunks.json',import.meta.url),'utf8')).entries;
const hash=s=>createHash('sha256').update(s).digest('hex');
export function sourceBeforeSales204(file,text){
 const canonical=text.replaceAll('\r\n','\n'),pin=sales204Pins[file];
 if(pin?.before&&hash(canonical)===pin.before)return canonical;
 const source=sourceBeforeProductReceiving205(file,canonical);if(source===null)return null;if(!pin)return source;
 if(pin.before&&hash(source)===pin.before)return source;
 assert.equal(hash(source),pin.after,'SALES204_ENTIRE_CURRENT_FILE_CHANGED:'+file);if(pin.added)return null;
 const lines=source.split('\n');for(const h of [...pin.hunks].reverse()){const at=h.after.length?h.at-1:h.at;assert.deepEqual(lines.slice(at,at+h.after.length),h.after,'SALES204_EXACT_HUNK:'+file);lines.splice(at,h.after.length,...h.before);}
 const restored=lines.join('\n');assert.equal(hash(restored),pin.before,'SALES204_ENTIRE_RESTORED_FILE_CHANGED:'+file);return restored;
}
export function restoreSales204SourceHashes(sources){return restoreProductReceiving205SourceHashes(sources).flatMap(s=>{const pin=sales204Pins[s.file];if(!pin||s.sha256===pin.before)return [s];assert.equal(s.sha256,pin.after,'SALES204_SOURCE_HASH:'+s.file);const text=sourceBeforeSales204(s.file,readFileSync(new URL('../../'+s.file,import.meta.url),'utf8'));return text===null?[]:[{...s,sha256:hash(text)}];});}
export async function inventoryBeforeSales204(){const {inventory}=await import('./table-access-inventory.mjs');return inventory({projectSource:sourceBeforeSales204});}
