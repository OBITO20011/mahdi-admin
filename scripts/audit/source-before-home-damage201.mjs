// Exact owner-approved package2 inverse for historical evidence only.
// Current runtime/read mapping has separate201 proofs; no broad hash repinning.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const homeDamage201Pins=JSON.parse(readFileSync(new URL('./home-damage201-hunks.json',import.meta.url),'utf8')).entries;
const hash=value=>createHash('sha256').update(value).digest('hex');
export function sourceBeforeHomeDamage201(file,text){
 const source=text.replaceAll('\r\n','\n'),pin=homeDamage201Pins[file];if(!pin)return source;
 if(pin.before&&hash(source)===pin.before)return source;
 assert.equal(hash(source),pin.after,'HOME_DAMAGE201_ENTIRE_CURRENT_FILE_CHANGED:'+file);
 if(pin.added)return null;
 const lines=source.split('\n');
 for(const h of [...pin.hunks].reverse()){
  const at=h.after.length?h.at-1:h.at;
  assert.deepEqual(lines.slice(at,at+h.after.length),h.after,'HOME_DAMAGE201_EXACT_HUNK:'+file);
  lines.splice(at,h.after.length,...h.before);
 }
 const restored=lines.join('\n');assert.equal(hash(restored),pin.before,'HOME_DAMAGE201_ENTIRE_RESTORED_FILE_CHANGED:'+file);return restored;
}
export function restoreHomeDamage201SourceHashes(sources){
 return sources.flatMap(s=>{const pin=homeDamage201Pins[s.file];if(!pin)return [s];
  assert.equal(s.sha256,pin.after,'HOME_DAMAGE201_CURRENT_SOURCE_HASH:'+s.file);
  const restored=sourceBeforeHomeDamage201(s.file,readFileSync(new URL('../../'+s.file,import.meta.url),'utf8'));
  return restored===null?[]:[{...s,sha256:hash(restored)}];
 });
}

export async function inventoryBeforeHomeDamage201(){const {inventory}=await import('./table-access-inventory.mjs');const source=await inventory();return {...source,sources:restoreHomeDamage201SourceHashes(source.sources)};}
