// Historical assertions see only the exact approved CSS inverse. Unknown bytes stay visible.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const pin=JSON.parse(readFileSync(new URL('./price-visibility-source-pin.json',import.meta.url),'utf8'));
const hash=text=>createHash('sha256').update(text.replaceAll('\r\n','\n')).digest('hex');
export function sourceBeforePriceVisibility(file,text){
 if(text===null||file!==pin.file||hash(text)!==pin.after)return text;
 let before=text.replaceAll('\r\n','\n');
 for(const hunk of pin.hunks){assert.equal(before.split(hunk.after).length,2,'PRICE_VISIBILITY_HUNK_CHANGED');before=before.replace(hunk.after,hunk.before);}
 assert.equal(hash(before),pin.before,'PRICE_VISIBILITY_INVERSE_CHANGED');return before;
}
export function restorePriceVisibilityHashes(rows){return rows.map(row=>{
 if(row.file!==pin.file||row.sha256!==pin.after)return row;
 const raw=readFileSync(new URL('../../'+pin.file,import.meta.url),'utf8');assert.equal(hash(raw),pin.after,'PRICE_VISIBILITY_SOURCE_CHANGED');
 return{...row,sha256:hash(sourceBeforePriceVisibility(pin.file,raw))};
});}
