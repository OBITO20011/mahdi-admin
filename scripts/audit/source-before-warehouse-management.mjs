// Full-file pinned reversal of the owner-approved warehouse presentation layer.
// Historical financial evidence is not regenerated or relaxed.
import assert from 'node:assert/strict';
import {sourceBeforeHomeDamage201,restoreHomeDamage201SourceHashes} from './source-before-home-damage201.mjs';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const pins=JSON.parse(readFileSync(new URL('./warehouse-management-hunks.json',import.meta.url),'utf8')).entries;
const hash=value=>createHash('sha256').update(value).digest('hex');
export function sourceBeforeWarehouseManagement(file,text){
  const canonical=text.replaceAll('\r\n','\n'),pin=pins[file];
  if(pin?.before&&hash(canonical)===pin.before)return canonical;
  const source=sourceBeforeHomeDamage201(file,canonical);if(source===null)return null;
  if(!pin)return source;
  if(pin.before&&hash(source)===pin.before)return source;
  assert.equal(hash(source),pin.after,'WAREHOUSE_ENTIRE_CURRENT_FILE_CHANGED:'+file);
  if(pin.added)return null;
  const lines=source.split('\n');
  for(const h of [...pin.hunks].reverse()){
    const at=h.after.length?h.at-1:h.at;
    assert.deepEqual(lines.slice(at,at+h.after.length),h.after,'WAREHOUSE_EXACT_HUNK:'+file);
    lines.splice(at,h.after.length,...h.before);
  }
  const restored=lines.join('\n');assert.equal(hash(restored),pin.before,'WAREHOUSE_ENTIRE_RESTORED_FILE_CHANGED:'+file);return restored;
}
export function restoreWarehouseSourceHashes(sources){
  return restoreHomeDamage201SourceHashes(sources).flatMap(s=>{const pin=pins[s.file];if(!pin)return [s];
    assert.equal(s.sha256,pin.after,'WAREHOUSE_CURRENT_SOURCE_HASH:'+s.file);
    const restored=sourceBeforeWarehouseManagement(s.file,readFileSync(new URL('../../'+s.file,import.meta.url),'utf8'));
    return restored===null?[]:[{...s,sha256:hash(restored)}];
  });
}
