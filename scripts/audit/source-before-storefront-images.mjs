import{sourceBeforeCartFlight,restoreCartFlightHashes,pathsBeforeCartFlight,projectGuest220QueryLocations,historicalGuest220RpcSite}from'./source-before-cart-flight.mjs';
// Frozen history only. Current runtime diagnostics never project these sources.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const {baseline,entries}=JSON.parse(readFileSync(new URL('./storefront-images-source-pins.json',import.meta.url),'utf8'));
const hash=text=>createHash('sha256').update(text.replaceAll('\r\n','\n')).digest('hex');
const old=new Map();
export function sourceBeforeStorefrontImages(file,text){
 text=sourceBeforeCartFlight(file,text);
 if(text===null)return null;const pin=entries[file];if(!pin||hash(text)!==pin.after)return text;
 if(pin.before===null)return null;
 if(!old.has(file)){const before=execFileSync('git',['show',baseline+':'+file],{encoding:'utf8',windowsHide:true,maxBuffer:32*1024**2});assert.equal(hash(before),pin.before,'STOREFRONT_IMAGES_BASELINE_DRIFT');old.set(file,before);}
 return old.get(file);
}
export function restoreStorefrontImagesHashes(rows){return restoreCartFlightHashes(rows).flatMap(row=>{
 const pin=entries[row.file];return !pin||pin.after!==row.sha256?[row]:pin.before===null?[]:[{...row,sha256:pin.before}];
});}
export function pathsBeforeStorefrontImages(files,reference){return pathsBeforeCartFlight(files,reference).filter(file=>{
 if(!entries[file])return true;
 const before=sourceBeforeStorefrontImages(file,readFileSync(new URL('../../'+file,import.meta.url),'utf8'));if(before===null)return false;if(!reference)return true;
 try{return hash(execFileSync('git',['show',reference+':'+file],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:32*1024**2}))!==hash(before);}catch{return true;}
});}

// The single unchanged table read moved from line142 to155. Validate the real
// source and supplied arguments before restoring locations for frozen history.
export function projectStorefrontImageQueries(source,parseSource){
 source=projectGuest220QueryLocations(source,parseSource);
 const result=[];
 for(const file of new Set(source.entries.map(entry=>entry.file))){
  const supplied=source.entries.filter(entry=>entry.file===file),pin=entries[file],saved=source.sources.find(entry=>entry.file===file);
  if(!pin||saved?.sha256!==pin.after){result.push(...supplied);continue;}
  const raw=readFileSync(new URL('../../'+file,import.meta.url),'utf8').replaceAll('\r\n','\n');assert.equal(hash(raw),pin.after,'IMAGE_QUERY_SOURCE_CHANGED');
  const actual=parseSource(file,raw).entries,keys=Object.keys(actual[0]??{});
  assert.deepEqual(supplied.map(entry=>Object.fromEntries(keys.map(key=>[key,entry[key]]))),actual,'IMAGE_QUERY_ARGUMENT_CHANGED');
  const previous=sourceBeforeStorefrontImages(file,raw);
  if(previous===null){assert.deepEqual(actual,[],'IMAGE_NEW_TABLE_QUERY_FORBIDDEN');continue;}
  const before=parseSource(file,previous).entries,semantic=entry=>({...entry,id:null,line:null,extensions:entry.extensions.map(extension=>({...extension,line:null}))});
  assert.deepEqual(before.map(semantic),actual.map(semantic),'IMAGE_EXISTING_TABLE_QUERY_CHANGED');
  result.push(...supplied.map((entry,index)=>({...entry,...before[index]})));
 }
 return{...source,entries:result,sources:restoreStorefrontImagesHashes(source.sources)};
}

// Current role proof remains raw; only historical comparison restores exact RPC locations.
export function historicalStorefrontImagesRpcSite(site,parseServices){
 site=historicalGuest220RpcSite(site,parseServices);
 const file=site.slice(0,site.lastIndexOf(':')),pin=entries[file];if(file!=='src/services/supabase/product-images.service.ts'||!pin)return site;
 const raw=readFileSync(new URL('../../'+file,import.meta.url),'utf8');assert.equal(hash(raw),pin.after,'IMAGE_RPC_SOURCE_CHANGED');
 const current=parseServices(file,raw).rpc,prior=parseServices(file,sourceBeforeStorefrontImages(file,raw)).rpc;
 const semantic=rows=>rows.map(({id:_id,line:_line,...entry})=>entry);assert.deepEqual(semantic(current),semantic(prior),'IMAGE_RPC_CONTENT_CHANGED');
 const index=current.findIndex(entry=>entry.id===site);assert.ok(index>=0,'IMAGE_RPC_SITE_UNKNOWN');return prior[index].id;
}
