// Exact test-only inverse for the owner-approved219 performance and UTC tools.
// Current SDK/runtime/operational verification always reads the actual sources.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
export const home219Pins=JSON.parse(readFileSync(new URL('./home-performance219-source-pins.json',import.meta.url),'utf8'));
const hash=s=>createHash('sha256').update(s).digest('hex');
export function sourceBeforeHome219(file,text){
 if(text===null)return null;const raw=text.replaceAll('\r\n','\n'),pin=home219Pins.entries[file];
 if(!pin||hash(raw)!==pin.after)return raw;
 if(pin.beforeText===null)return null;
 assert.equal(hash(pin.beforeText),pin.before,'HOME219_INVERSE_CORRUPT:'+file);return pin.beforeText;
}
export function restoreHome219SourceHashes(sources){return sources.flatMap(entry=>{
 const pin=home219Pins.entries[entry.file];if(!pin||entry.sha256!==pin.after)return[entry];
 return pin.beforeText===null?[]:[{...entry,sha256:pin.before}];
});}
export function pathsBeforeHome219(files){return files.filter(file=>{
 const pin=home219Pins.entries[file];if(!pin||pin.beforeText!==null)return true;
 const raw=readFileSync(new URL('../../'+file,import.meta.url),'utf8').replaceAll('\r\n','\n');return hash(raw)!==pin.after;
});}
