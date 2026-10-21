// ExactC7 inverse: every changed current file and every restored byte pinned.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const corrections207Pins=JSON.parse(readFileSync(new URL('./document-corrections207-hunks.json',import.meta.url),'utf8')).entries;
const hash=text=>createHash('sha256').update(text).digest('hex');
// Composition may revisit an already-restored older layer. Admit only its
// immutable entire-file BEFORE pin,never an arbitrary non-current hash.
const olderBeforePins=new Map();
for(const name of ['storefront-c6','navigation-cash206','product-receiving205','sales-history204','collections202','home-damage201','warehouse-management','unit-terminology']){
 const entries=JSON.parse(readFileSync(new URL('./'+name+'-hunks.json',import.meta.url),'utf8')).entries;
 for(const[file,pin]of Object.entries(entries)){if(!pin.before)continue;const known=olderBeforePins.get(file)??new Set();known.add(pin.before);olderBeforePins.set(file,known);}
}
export function sourceBeforeCorrections207(file,text){
 const source=text.replaceAll('\r\n','\n'),pin=corrections207Pins[file];if(!pin)return source;
 if((pin.before&&hash(source)===pin.before)||olderBeforePins.get(file)?.has(hash(source)))return source;
 assert.equal(hash(source),pin.after,'CORRECTIONS207_ENTIRE_CURRENT_FILE_CHANGED:'+file);if(pin.added)return null;
 const lines=source.split('\n');for(const h of [...pin.hunks].reverse()){const at=h.after.length?h.at-1:h.at;assert.deepEqual(lines.slice(at,at+h.after.length),h.after,'CORRECTIONS207_EXACT_HUNK:'+file);lines.splice(at,h.after.length,...h.before);}
 const restored=lines.join('\n');assert.equal(hash(restored),pin.before,'CORRECTIONS207_ENTIRE_RESTORED_FILE_CHANGED:'+file);return restored;
}
export function restoreCorrections207SourceHashes(sources){return sources.flatMap(s=>{const pin=corrections207Pins[s.file];if(!pin||s.sha256===pin.before||olderBeforePins.get(s.file)?.has(s.sha256))return [s];assert.equal(s.sha256,pin.after,'CORRECTIONS207_SOURCE_HASH:'+s.file);const text=sourceBeforeCorrections207(s.file,readFileSync(new URL('../../'+s.file,import.meta.url),'utf8'));return text===null?[]:[{...s,sha256:hash(text)}];});}
export async function inventoryBeforeCorrections207(){const {inventory}=await import('./table-access-inventory.mjs');return inventory({projectSource:sourceBeforeCorrections207});}
