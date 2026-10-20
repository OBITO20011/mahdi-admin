import {sourceBeforeStorefrontC6,restoreStorefrontC6SourceHashes} from './source-before-storefront-c6.mjs';
// Exact206 inverse: every changed current file and every restored byte pinned.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const navigation206Pins=JSON.parse(readFileSync(new URL('./navigation-cash206-hunks.json',import.meta.url),'utf8')).entries;
const hash=text=>createHash('sha256').update(text).digest('hex');
// Composition may revisit an already-restored older layer. Admit only its
// immutable entire-file BEFORE pin,never an arbitrary non-current hash.
const olderBeforePins=new Map();
for(const name of ['product-receiving205','sales-history204','collections202','home-damage201','warehouse-management','unit-terminology']){
 const entries=JSON.parse(readFileSync(new URL('./'+name+'-hunks.json',import.meta.url),'utf8')).entries;
 for(const[file,pin]of Object.entries(entries)){if(!pin.before)continue;const known=olderBeforePins.get(file)??new Set();known.add(pin.before);olderBeforePins.set(file,known);}
}
export function sourceBeforeNavigation206(file,text){
 const source=sourceBeforeStorefrontC6(file,text),pin=navigation206Pins[file];if(source===null)return null;if(!pin)return source;
 if((pin.before&&hash(source)===pin.before)||olderBeforePins.get(file)?.has(hash(source)))return source;
 assert.equal(hash(source),pin.after,'NAVIGATION206_ENTIRE_CURRENT_FILE_CHANGED:'+file);if(pin.added)return null;
 const lines=source.split('\n');for(const h of [...pin.hunks].reverse()){const at=h.after.length?h.at-1:h.at;assert.deepEqual(lines.slice(at,at+h.after.length),h.after,'NAVIGATION206_EXACT_HUNK:'+file);lines.splice(at,h.after.length,...h.before);}
 const restored=lines.join('\n');assert.equal(hash(restored),pin.before,'NAVIGATION206_ENTIRE_RESTORED_FILE_CHANGED:'+file);return restored;
}
export function restoreNavigation206SourceHashes(sources){return restoreStorefrontC6SourceHashes(sources).flatMap(s=>{const pin=navigation206Pins[s.file];if(!pin||s.sha256===pin.before||olderBeforePins.get(s.file)?.has(s.sha256))return [s];assert.equal(s.sha256,pin.after,'NAVIGATION206_SOURCE_HASH:'+s.file);const text=sourceBeforeNavigation206(s.file,readFileSync(new URL('../../'+s.file,import.meta.url),'utf8'));return text===null?[]:[{...s,sha256:hash(text)}];});}
export async function inventoryBeforeNavigation206(){const {inventory}=await import('./table-access-inventory.mjs');return inventory({projectSource:sourceBeforeNavigation206});}
