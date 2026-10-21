// C8 recovery inverse over delivered207: preserve every accepted older pin.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const correctionRecoveryC8Pins=JSON.parse(readFileSync(new URL('./correction-recovery-c8-hunks.json',import.meta.url),'utf8')).entries;
const hash=text=>createHash('sha256').update(text).digest('hex');
const olderBeforePins=new Map();
for(const name of ['document-corrections207','storefront-c6','navigation-cash206','product-receiving205','sales-history204','collections202','home-damage201','warehouse-management','unit-terminology']){
 const entries=JSON.parse(readFileSync(new URL('./'+name+'-hunks.json',import.meta.url),'utf8')).entries;
 for(const[file,pin]of Object.entries(entries)){if(!pin.before)continue;const known=olderBeforePins.get(file)??new Set();known.add(pin.before);olderBeforePins.set(file,known);}
}
export function sourceBeforeCorrectionRecoveryC8(file,text){
 const source=text.replaceAll('\r\n','\n'),pin=correctionRecoveryC8Pins[file];if(!pin)return source;
 if((pin.before&&hash(source)===pin.before)||olderBeforePins.get(file)?.has(hash(source)))return source;
 // Retain the correction family's fail-closed error identity for old callers.
 assert.equal(hash(source),pin.after,'CORRECTIONS207_ENTIRE_CURRENT_FILE_CHANGED:C8_RECOVERY:'+file);if(pin.added)return null;
 const lines=source.split('\n');for(const h of [...pin.hunks].reverse()){const at=h.after.length?h.at-1:h.at;assert.deepEqual(lines.slice(at,at+h.after.length),h.after,'CORRECTIONS207_EXACT_HUNK:C8_RECOVERY:'+file);lines.splice(at,h.after.length,...h.before);}
 const restored=lines.join('\n');assert.equal(hash(restored),pin.before,'CORRECTIONS207_ENTIRE_RESTORED_FILE_CHANGED:C8_RECOVERY:'+file);return restored;
}
export function restoreCorrectionRecoveryC8SourceHashes(sources){return sources.flatMap(s=>{const pin=correctionRecoveryC8Pins[s.file];if(!pin||s.sha256===pin.before||olderBeforePins.get(s.file)?.has(s.sha256))return [s];assert.equal(s.sha256,pin.after,'CORRECTIONS207_SOURCE_HASH:C8_RECOVERY:'+s.file);const text=sourceBeforeCorrectionRecoveryC8(s.file,readFileSync(new URL('../../'+s.file,import.meta.url),'utf8'));return text===null?[]:[{...s,sha256:hash(text)}];});}
export async function inventoryBeforeCorrectionRecoveryC8(){const {inventory}=await import('./table-access-inventory.mjs');return inventory({projectSource:sourceBeforeCorrectionRecoveryC8});}
