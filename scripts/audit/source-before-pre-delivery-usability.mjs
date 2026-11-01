// Historical evidence projection only; unknown source bytes are never projected.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const {entries}=JSON.parse(readFileSync(new URL('./pre-delivery-usability-source-pins.json',import.meta.url),'utf8'));
const hash=text=>createHash('sha256').update(text).digest('hex');
export function sourceBeforeUsability(file,text){
  if(text===null)return null;
  const raw=text.replaceAll('\r\n','\n'),pin=entries[file];
  if(!pin||hash(raw)!==pin.after)return raw;
  if(pin.beforeText===null)return null;
  assert.equal(hash(pin.beforeText),pin.before,'USABILITY_INVERSE_CORRUPT');
  return pin.beforeText;
}
export function restoreUsabilityHashes(sources){return sources.flatMap(entry=>{
  const pin=entries[entry.file];
  if(!pin||entry.sha256!==pin.after)return[entry];
  return pin.beforeText===null?[]:[{...entry,sha256:pin.before}];
});}
export function pathsBeforeUsability(files,reference){return files.filter(file=>{
  const pin=entries[file];
  if(!pin||hash(readFileSync(new URL('../../'+file,import.meta.url),'utf8').replaceAll('\r\n','\n'))!==pin.after)return true;
  if(pin.beforeText===null)return false;
  if(!reference)return true;
  let historical=null;
  try{historical=execFileSync('git',['show',reference+':'+file],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:32*1024**2}).replaceAll('\r\n','\n');}catch{/* Missing at this exact historical Git reference. */}
  return historical!==pin.beforeText;
});}
export function projectUsabilityQuerySites(source,parseSource){
  const projected=[];
  for(const file of new Set(source.entries.map(entry=>entry.file))){
    const supplied=source.entries.filter(entry=>entry.file===file),pin=entries[file];
    if(!pin||source.sources.find(entry=>entry.file===file)?.sha256!==pin.after){projected.push(...supplied);continue;}
    const raw=readFileSync(new URL('../../'+file,import.meta.url),'utf8').replaceAll('\r\n','\n');
    assert.equal(hash(raw),pin.after,'USABILITY_CURRENT_SOURCE_DRIFT');
    const actual=parseSource(file,raw).entries,previous=pin.beforeText===null?[]:parseSource(file,pin.beforeText).entries;
    const keys=Object.keys(actual[0]??{});
    assert.deepEqual(supplied.map(entry=>Object.fromEntries(keys.map(key=>[key,entry[key]]))),actual,'HISTORICAL_QUERY_INVENTORY_DRIFT:USABILITY');
    const identity=entry=>Object.fromEntries(Object.entries(entry).filter(([key])=>!['id','line'].includes(key)));
    assert.deepEqual(actual.map(identity),previous.map(identity),'USABILITY_QUERY_CONTENT_CHANGED');
    projected.push(...supplied.map((entry,index)=>({...entry,...previous[index]})));
  }
  return{...source,entries:projected,sources:restoreUsabilityHashes(source.sources)};
}
