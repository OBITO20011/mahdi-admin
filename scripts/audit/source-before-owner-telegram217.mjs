import {restoreSentrySourceHashes,sourceBeforeSentry,pathsBeforeSentry} from './source-before-sentry.mjs';
// Exact inverse for frozen historical proofs only. Actual217 SDK inventory,
// role execution and Edge runtime always inspect the current source directly.
import {sourceBeforeCiDedup} from './source-before-ci-dedup.mjs';
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
export const ownerTelegram217Pins=JSON.parse(readFileSync(new URL('./owner-telegram217-source-pins.json',import.meta.url),'utf8'));
const hash=s=>createHash('sha256').update(s).digest('hex');
export function sourceBeforeOwnerTelegram217(file,text){
 text=sourceBeforeCiDedup(file,text);
 if(text===null)return null;const raw=text.replaceAll('\r\n','\n'),pin=ownerTelegram217Pins.entries[file];
 if(!pin||hash(raw)!==pin.after)return raw;
 if(pin.beforeText===null)return null;assert.equal(hash(pin.beforeText),pin.before,'OWNER217_INVERSE_CORRUPT:'+file);return pin.beforeText;
}
export function restoreOwnerTelegram217SourceHashes(sources){return restoreSentrySourceHashes(sources).flatMap(entry=>{
 const pin=ownerTelegram217Pins.entries[entry.file];if(!pin||entry.sha256!==pin.after)return[entry];
 const actual=sourceBeforeSentry(entry.file,readFileSync(new URL('../../'+entry.file,import.meta.url),'utf8').replaceAll('\r\n','\n'));assert.equal(hash(actual),pin.after,'OWNER217_CURRENT_SOURCE_CHANGED:'+entry.file);
 const before=sourceBeforeOwnerTelegram217(entry.file,actual);return before===null?[]:[{...entry,sha256:hash(before)}];
});}
export function pathsBeforeOwnerTelegram217(files,reference){return pathsBeforeSentry(files).filter(file=>{
 const pin=ownerTelegram217Pins.entries[file];if(!pin)return true;
 const raw=readFileSync(new URL('../../'+file,import.meta.url),'utf8').replaceAll('\r\n','\n');assert.equal(hash(raw),pin.after,'OWNER217_UNREVIEWED_PATH:'+file);
 if(!reference||pin.beforeText===null)return false;
 let historical=null;try{historical=execFileSync('git',['show',reference+':'+file],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:32*1024**2}).replaceAll('\r\n','\n');}catch{/* Absent at that exact historical Git reference. */}
 return historical!==pin.beforeText;
});}
