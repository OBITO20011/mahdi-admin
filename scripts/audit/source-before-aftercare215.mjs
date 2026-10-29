// Historical evidence alone sees exact pre215 bytes. Current SDK diagnostics
// always use inventory() without a projection and cover every new call/role.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
export const aftercare215SourcePins=JSON.parse(readFileSync(new URL('./aftercare215-source-pins.json',import.meta.url),'utf8'));
const hash=text=>createHash('sha256').update(text).digest('hex');
export function sourceBeforeAftercare215(file,text){
 if(text===null)return null;const raw=text.replaceAll('\r\n','\n'),pin=aftercare215SourcePins.entries[file];
 if(!pin||hash(raw)!==pin.after)return raw; // Unknown bytes reach old guards.
 if(pin.beforeText===null)return null;
 assert.equal(hash(pin.beforeText),pin.before,'AFTERCARE215_INVERSE_CORRUPT:'+file);return pin.beforeText;
}
export function restoreAftercare215SourceHashes(sources){return sources.flatMap(entry=>{
 const pin=aftercare215SourcePins.entries[entry.file];if(!pin||entry.sha256!==pin.after)return[entry];
 const actual=readFileSync(new URL('../../'+entry.file,import.meta.url),'utf8').replaceAll('\r\n','\n');assert.equal(hash(actual),pin.after,'AFTERCARE215_CURRENT_SOURCE_CHANGED:'+entry.file);
 const before=sourceBeforeAftercare215(entry.file,actual);return before===null?[]:[{...entry,sha256:hash(before)}];
});}
/** @param {string[]} files @param {string|undefined} [reference] */
export function pathsBeforeAftercare215(files,reference){return files.filter(file=>{
 const pin=aftercare215SourcePins.entries[file];if(!pin)return true;
 const raw=readFileSync(new URL('../../'+file,import.meta.url),'utf8').replaceAll('\r\n','\n');assert.equal(hash(raw),pin.after,'AFTERCARE215_UNREVIEWED_PATH:'+file);
 if(!reference||pin.beforeText===null)return false;
 let historical=null;try{historical=execFileSync('git',['show',reference+':'+file],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:32*1024**2}).replaceAll('\r\n','\n');}catch{/* Missing at that exact Git reference. */}
 return historical!==pin.beforeText;
});}
export function projectAftercare215QuerySites(source,parseSource){
 const entries=[];
 for(const file of new Set(source.entries.map(e=>e.file))){
  const supplied=source.entries.filter(e=>e.file===file),pin=aftercare215SourcePins.entries[file];
  if(!pin||source.sources.find(s=>s.file===file)?.sha256!==pin.after){entries.push(...supplied);continue;}
  const raw=readFileSync(new URL('../../'+file,import.meta.url),'utf8').replaceAll('\r\n','\n'),actual=parseSource(file,raw).entries,keys=Object.keys(actual[0]??{});
  assert.deepEqual(supplied.map(e=>Object.fromEntries(keys.map(k=>[k,e[k]]))),actual,'AFTERCARE215_QUERY_INVENTORY_DRIFT:'+file);
  const before=sourceBeforeAftercare215(file,raw),previous=before===null?[]:parseSource(file,before).entries;
  assert.equal(previous.length,actual.length,'215_NO_NEW_DIRECT_TABLE_QUERY:'+file);
  entries.push(...supplied.map((entry,index)=>({...entry,...previous[index]})));
 }
 return{...source,entries,sources:restoreAftercare215SourceHashes(source.sources)};
}
