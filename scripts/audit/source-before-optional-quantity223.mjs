import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';

const pins=JSON.parse(readFileSync(new URL('./optional-quantity223-source-pins.json',import.meta.url),'utf8'));
export const quantity223SourceBase='0bd3b5b0fd149c9e92d802c6dabb55b236c127cc';
assert.equal(pins.format,1);
assert.equal(pins.baseline,quantity223SourceBase);
export const quantity223SourcePins=pins.entries;

export function sourceBeforeOptionalQuantity223(file,text){
 if(text===null)return null;
 const pin=quantity223SourcePins[file];
 if(!pin||sha256(canonicalLf(text))!==pin.after)return text;
 if(pin.beforeText===null){
  assert.equal(pin.before,null,'QUANTITY223_ADDED_SOURCE_PIN_CORRUPT:'+file);
  return null;
 }
 assert.equal(sha256(pin.beforeText),pin.before,'QUANTITY223_BEFORE_SOURCE_PIN_CORRUPT:'+file);
 return pin.beforeText;
}

export function restoreOptionalQuantity223Hashes(rows){
 return rows.flatMap(row=>{
  const pin=quantity223SourcePins[row.file];
  if(!pin||pin.after!==row.sha256)return [row];
  const raw=canonicalLf(readFileSync(new URL('../../'+row.file,import.meta.url),'utf8'));
  assert.equal(sha256(raw),pin.after,'QUANTITY223_CURRENT_SOURCE_CHANGED:'+row.file);
  const previous=sourceBeforeOptionalQuantity223(row.file,raw);
  return previous===null?[]:[{...row,sha256:sha256(previous)}];
 });
}

export function pathsBeforeOptionalQuantity223(files,reference){
 return files.filter(file=>{
  if(!quantity223SourcePins[file])return true;
  const raw=readFileSync(new URL('../../'+file,import.meta.url),'utf8');
  const projected=sourceBeforeOptionalQuantity223(file,raw);
  if(projected===null)return false;
  if(projected===raw||!reference)return true;
  const original=execFileSync('git',['show',reference+':'+file],{
   encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true,maxBuffer:64*1024**2,
  });
  return canonicalLf(original)!==projected;
 });
}
