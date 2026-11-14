// Historical assertions see only the exact approved CSS inverse. Unknown bytes stay visible.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const pin=JSON.parse(readFileSync(new URL('./price-visibility-source-pin.json',import.meta.url),'utf8'));
const hash=text=>createHash('sha256').update(text.replaceAll('\r\n','\n')).digest('hex');
const rawHash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function sourceBeforePriceVisibility(file,text){
 if(text===null)return null;
 const artifact=pin.files?.[file];
 if(artifact&&hash(text)===artifact.after){
  if(artifact.before===null)return null;
  let before=text.replaceAll('\r\n','\n');
  for(const hunk of [...artifact.hunks].reverse()){
   assert.equal(before.slice(hunk.offset,hunk.offset+hunk.after.length),hunk.after,'PRICE_ARTIFACT_HUNK_CHANGED:'+file);
   before=before.slice(0,hunk.offset)+hunk.before+before.slice(hunk.offset+hunk.after.length);
  }
  assert.equal(hash(before),artifact.before,'PRICE_ARTIFACT_INVERSE_CHANGED:'+file);return before;
 }
 if(file!==pin.file||hash(text)!==pin.after)return text;
 let before=text.replaceAll('\r\n','\n');
 for(const hunk of pin.hunks){assert.equal(before.split(hunk.after).length,2,'PRICE_VISIBILITY_HUNK_CHANGED');before=before.replace(hunk.after,hunk.before);}
 assert.equal(hash(before),pin.before,'PRICE_VISIBILITY_INVERSE_CHANGED');return before;
}
export function restorePriceVisibilityHashes(rows){return rows.flatMap(row=>{
 const artifact=pin.files?.[row.file];
 if(row.sha256!==artifact?.after&&(row.file!==pin.file||row.sha256!==pin.after))return[row];
 const raw=readFileSync(new URL('../../'+row.file,import.meta.url),'utf8');
 assert.ok(hash(raw)===artifact?.after||row.file===pin.file&&hash(raw)===pin.after,'PRICE_VISIBILITY_SOURCE_CHANGED:'+row.file);
 const before=sourceBeforePriceVisibility(row.file,raw);
 return before===null?[]:[{...row,sha256:hash(before)}];
});}
// Added review screenshots/harnesses never existed in older schema views.
// Only their complete committed bytes may be omitted;unknown edits stay visible.
export function pathsBeforePriceVisibility(files){return files.filter(file=>{
 if(file==='scripts/audit/price-visibility-source-pin.json')return false;
 const artifact=pin.files?.[file];if(!artifact||artifact.before!==null)return true;
 const raw=readFileSync(new URL('../../'+file,import.meta.url));
 const current=artifact.binary?rawHash(raw):hash(raw.toString('utf8'));
 return current!==artifact.after;
});}
