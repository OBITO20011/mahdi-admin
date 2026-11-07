import {sourceBeforeEmptyStorageRestore,restoreEmptyStorageSourceHashes,pathsBeforeEmptyStorageRestore} from './source-before-empty-storage-restore.mjs';
// Frozen history only. Current runtime diagnostics never project these sources.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const {baseline,entries}=JSON.parse(readFileSync(new URL('./cart-flight-source-pins.json',import.meta.url),'utf8'));
assert.equal(baseline,'f098f0afaa7b54b052b18d8266f3789d67e8de76','CART_FLIGHT_BASELINE_UNAPPROVED');
const hash=text=>createHash('sha256').update(text.replaceAll('\r\n','\n')).digest('hex');
const old=new Map();
export function sourceBeforeCartFlight(file,text){
 text=sourceBeforeEmptyStorageRestore(file,text);
 if(text===null)return null;const pin=entries[file];if(!pin||hash(text)!==pin.after)return text;
 if(pin.before===null)return null;
 if(!old.has(file)){const before=execFileSync('git',['show',baseline+':'+file],{encoding:'utf8',windowsHide:true,maxBuffer:32*1024**2});assert.equal(hash(before),pin.before,'CART_FLIGHT_BASELINE_DRIFT');old.set(file,before);}
 return old.get(file);
}
export function restoreCartFlightHashes(rows){return restoreEmptyStorageSourceHashes(rows).flatMap(row=>{
 const pin=entries[row.file];return !pin||pin.after!==row.sha256?[row]:pin.before===null?[]:[{...row,sha256:pin.before}];
});}
export function pathsBeforeCartFlight(files,reference){return pathsBeforeEmptyStorageRestore(files,reference).filter(file=>{
 if(!entries[file])return true;
 const before=sourceBeforeCartFlight(file,readFileSync(new URL('../../'+file,import.meta.url),'utf8'));if(before===null)return false;if(!reference)return true;
 try{return hash(execFileSync('git',['show',reference+':'+file],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:32*1024**2}))!==hash(before);}catch{return true;}
});}
