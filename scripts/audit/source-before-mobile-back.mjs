import{sourceBeforeSalesOnlyPhase2}from'./source-before-sales-only-phase2.mjs';
// Exact navigation-only historical view. Unprojected current probes stay real.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
export const mobileBackPins=JSON.parse(readFileSync(new URL('./mobile-back-source-pins.json',import.meta.url),'utf8')).entries;
const hash=text=>createHash('sha256').update(text).digest('hex');
export function mobileBackBeforeText(file,pin=mobileBackPins[file]){
 if(pin.beforeFromGit){
  assert.match(pin.beforeFromGit,/^[a-f0-9]{40}$/u,'MOBILE_BACK_BASELINE_INVALID');
  const raw=execFileSync('git',['show',pin.beforeFromGit+':'+file],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:32*1024**2});
  assert.equal(hash(raw.replaceAll('\r\n','\n')),pin.before,'MOBILE_BACK_GIT_BASELINE_CHANGED');return raw;
 }
 return pin.beforeRawText??pin.beforeText;
}
export function sourceBeforeMobileBack(file,text){
 if(text===null)return null;const raw=text.replaceAll('\r\n','\n'),pin=mobileBackPins[file];
 if(!pin||hash(raw)!==pin.after)return text;
 if(pin.before===null)return null;
 const before=mobileBackBeforeText(file,pin);assert.equal(hash(before.replaceAll('\r\n','\n')),pin.before,'MOBILE_BACK_INVERSE_CORRUPT');return before;
}
export function restoreMobileBackHashes(sources){return sources.flatMap(entry=>{
 const pin=mobileBackPins[entry.file];if(!pin||entry.sha256!==pin.after)return[entry];
 return pin.before===null?[]:[{...entry,sha256:pin.before}];
});}
export function pathsBeforeMobileBack(files,reference){return files.filter(file=>{
 const pin=mobileBackPins[file];if(!pin)return true;
 const actual=readFileSync(new URL('../../'+file,import.meta.url),'utf8').replaceAll('\r\n','\n');if(hash(actual)!==pin.after)return true;
 if(pin.before===null)return false;if(!reference)return true;
 try{return execFileSync('git',['show',reference+':'+file],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:32*1024**2}).replaceAll('\r\n','\n')!==mobileBackBeforeText(file,pin).replaceAll('\r\n','\n');}catch{return true;}
});}
export function projectMobileBackQuerySites(source,parseSource){
 const entries=[];
 for(const file of new Set(source.entries.map(entry=>entry.file))){
  const supplied=source.entries.filter(entry=>entry.file===file),pin=mobileBackPins[file];
  if(!pin||source.sources.find(entry=>entry.file===file)?.sha256!==pin.after){entries.push(...supplied);continue;}
  const raw=readFileSync(new URL('../../'+file,import.meta.url),'utf8').replaceAll('\r\n','\n');assert.equal(hash(raw),pin.after,'MOBILE_BACK_CURRENT_SOURCE_DRIFT');
  const current=parseSource(file,raw).entries,before=pin.beforeText===null?[]:parseSource(file,pin.beforeText).entries,keys=Object.keys(current[0]??{});
  assert.deepEqual(supplied.map(entry=>Object.fromEntries(keys.map(key=>[key,entry[key]]))),current,'HISTORICAL_QUERY_INVENTORY_DRIFT:MOBILE_BACK');
  const content=rows=>rows.map(({id:_id,line:_line,...entry})=>({...entry,extensions:entry.extensions.map(({line:_extensionLine,...rest})=>rest)}));
  assert.deepEqual(content(current),content(before),'MOBILE_BACK_QUERY_CONTENT_CHANGED');
  entries.push(...supplied.map((entry,index)=>({...entry,...before[index]})));
 }
 return {...source,entries,sources:restoreMobileBackHashes(source.sources)};
}
export function historicalMobileBackRpcSite(site,parseServices){
 const file=site.slice(0,site.lastIndexOf(':')),pin=mobileBackPins[file];if(!pin)return site;
 const raw=sourceBeforeSalesOnlyPhase2(file,readFileSync(new URL('../../'+file,import.meta.url),'utf8')).replaceAll('\r\n','\n');
 assert.equal(hash(raw),pin.after,'MOBILE_BACK_RPC_CURRENT_SOURCE_CHANGED');
 const current=parseServices(file,raw).rpc,before=parseServices(file,mobileBackBeforeText(file,pin)).rpc;
 const content=rows=>rows.map(({id:_id,line:_line,...entry})=>entry);
 assert.deepEqual(content(current),content(before),'MOBILE_BACK_RPC_CONTENT_CHANGED');
 const index=current.findIndex(entry=>entry.id===site);assert.ok(index>=0,'MOBILE_BACK_RPC_SITE_UNKNOWN');return before[index].id;
}
