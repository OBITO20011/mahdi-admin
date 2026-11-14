// Exact source view for frozen historical evidence. Unknown bytes remain visible.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const pins=JSON.parse(readFileSync(new URL('./independent-prices222-source-pins.json',import.meta.url),'utf8'));
assert.equal(pins.format,1);assert.equal(pins.baseline,'bd4d696af6eef074bfd523ee54906059a0bb668c');
const hash=text=>createHash('sha256').update(text.replaceAll('\r\n','\n')).digest('hex');
export function sourceBeforeIndependentPrices222(file,text){
 if(text===null)return null;
 const pin=pins.entries[file];if(!pin||hash(text)!==pin.after)return text;
 if(pin.beforeText===null){assert.equal(pin.before,null,'PRICES222_ADDED_SOURCE_PIN_CORRUPT');return null;}
 assert.equal(hash(pin.beforeText),pin.before,'PRICES222_BEFORE_SOURCE_PIN_CORRUPT');
 return pin.beforeText;
}
export function restoreIndependentPrices222Hashes(rows){return rows.flatMap(row=>{
 const pin=pins.entries[row.file];if(!pin||row.sha256!==pin.after)return[row];
 const raw=readFileSync(new URL('../../'+row.file,import.meta.url),'utf8');
 assert.equal(hash(raw),pin.after,'PRICES222_CURRENT_SOURCE_CHANGED:'+row.file);
 const before=sourceBeforeIndependentPrices222(row.file,raw);
 return before===null?[]:[{...row,sha256:hash(before)}];
});}
export function pathsBeforeIndependentPrices222(files,reference){return files.filter(file=>{
 if(!pins.entries[file])return true;
 const raw=readFileSync(new URL('../../'+file,import.meta.url),'utf8'),before=sourceBeforeIndependentPrices222(file,raw);
 if(before===null)return false;if(before===raw||!reference)return true;
 try{return hash(execFileSync('git',['show',reference+':'+file],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:32*1024**2}))!==hash(before);}catch{return true;}
});}
