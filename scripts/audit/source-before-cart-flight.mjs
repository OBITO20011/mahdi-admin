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

// Draft220 adds one delivery-display property,shifting three table reads and
// eleven RPC locations. Restore locations ONLY after full AST argument/role
// equality;current219 runtime evidence always remains raw and unprojected.
const guest220OrdersFile='src/services/supabase/orders.service.ts';
export function projectGuest220QueryLocations(source,parseSource){
 const pin=entries[guest220OrdersFile],saved=source.sources.find(row=>row.file===guest220OrdersFile);
 if(!pin||saved?.sha256!==pin.after)return source;
 const raw=readFileSync(new URL('../../'+guest220OrdersFile,import.meta.url),'utf8');assert.equal(hash(raw),pin.after,'GUEST220_QUERY_SOURCE_CHANGED');
 const actual=parseSource(guest220OrdersFile,raw).entries,supplied=source.entries.filter(row=>row.file===guest220OrdersFile),keys=Object.keys(actual[0]??{});
 assert.deepEqual(supplied.map(row=>Object.fromEntries(keys.map(key=>[key,row[key]]))),actual,'GUEST220_QUERY_ARGUMENT_CHANGED');
 const before=parseSource(guest220OrdersFile,sourceBeforeCartFlight(guest220OrdersFile,raw)).entries;
 const semantic=row=>({...row,id:null,line:null,extensions:row.extensions.map(extension=>({...extension,line:null}))});assert.deepEqual(actual.map(semantic),before.map(semantic),'GUEST220_EXISTING_TABLE_QUERY_CHANGED');
 let index=0;return{...source,entries:source.entries.map(row=>row.file===guest220OrdersFile?{...row,...before[index++]}:row)};
}
export function historicalGuest220RpcSite(site,parseServices){
 const file=site.slice(0,site.lastIndexOf(':')),pin=entries[file];if(file!==guest220OrdersFile||!pin)return site;
 const raw=readFileSync(new URL('../../'+file,import.meta.url),'utf8');assert.equal(hash(raw),pin.after,'GUEST220_RPC_SOURCE_CHANGED');
 const current=parseServices(file,raw).rpc,before=parseServices(file,sourceBeforeCartFlight(file,raw)).rpc;
 const semantic=rows=>rows.map(({id:_id,line:_line,...row})=>row);assert.deepEqual(semantic(current),semantic(before),'GUEST220_RPC_ARGUMENT_CHANGED');
 const index=current.findIndex(row=>row.id===site);assert.ok(index>=0,'GUEST220_RPC_SITE_UNKNOWN');return before[index].id;
}
export function restoreCartFlightHashes(rows){return restoreEmptyStorageSourceHashes(rows).flatMap(row=>{
 const pin=entries[row.file];return !pin||pin.after!==row.sha256?[row]:pin.before===null?[]:[{...row,sha256:pin.before}];
});}
export function pathsBeforeCartFlight(files,reference){return pathsBeforeEmptyStorageRestore(files,reference).filter(file=>{
 if(!entries[file])return true;
 const before=sourceBeforeCartFlight(file,readFileSync(new URL('../../'+file,import.meta.url),'utf8'));if(before===null)return false;if(!reference)return true;
 try{return hash(execFileSync('git',['show',reference+':'+file],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:32*1024**2}))!==hash(before);}catch{return true;}
});}
