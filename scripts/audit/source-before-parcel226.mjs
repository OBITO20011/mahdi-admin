import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';

const indexFile='scripts/audit/parcel226-source-pins.json';
const indexText=canonicalLf(readFileSync(new URL('./parcel226-source-pins.json',import.meta.url),'utf8'));
const index=JSON.parse(indexText);
export const parcel226Baseline='851d61d418f90bc9c103d2d0ba2b9954be06fe7e';
assert.equal(index.format,1);
assert.equal(index.baseline,parcel226Baseline);
export const parcel226Pins=index.entries;
for(const [file,pin] of Object.entries(parcel226Pins)){
 assert.ok(!file.includes('..')&&!file.startsWith('/')&&!file.startsWith('.env'));
 assert.match(pin.after,/^[a-f0-9]{64}$/u);
 assert.equal(pin.beforeText===null?null:sha256(pin.beforeText),pin.before,'PARCEL226_HISTORY_PIN_CORRUPT:'+file);
}
const current=file=>canonicalLf(readFileSync(new URL('../../'+file,import.meta.url),'utf8'));
export function sourceBeforeParcel226(file,text){
 if(text===null)return null;
 const raw=canonicalLf(text);
 if(file===indexFile&&raw===indexText)return null;
 const pin=parcel226Pins[file];
 return pin&&sha256(raw)===pin.after?pin.beforeText:text;
}
export function restoreParcel226Hashes(rows){
 return rows.flatMap(row=>{
  const pin=parcel226Pins[row.file];
  if(!pin||row.sha256!==pin.after)return [row];
  assert.equal(sha256(current(row.file)),pin.after,'PARCEL226_HISTORY_SOURCE_CHANGED:'+row.file);
  return pin.before===null?[]:[{...row,sha256:pin.before}];
 });
}
export function pathsBeforeParcel226(files,reference){
 return files.filter(file=>{
  if(file===indexFile)return current(file)!==indexText;
  const pin=parcel226Pins[file];
  if(!pin||sha256(current(file))!==pin.after)return true;
  if(pin.before===null)return false;
  if(!reference)return true;
  try{
   const before=execFileSync('git',['show',reference+':'+file],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:32*1024**2});
   return sha256(canonicalLf(before))!==pin.before;
  }catch{return true;}
 });
}
