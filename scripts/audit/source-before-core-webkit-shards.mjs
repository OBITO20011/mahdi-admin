// Exact CI-only inverse for historical contracts. Unknown bytes stay unknown.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';
const indexFile='scripts/audit/core-webkit-shards-source-pins.json';
const indexText=canonicalLf(readFileSync(new URL('./core-webkit-shards-source-pins.json',import.meta.url),'utf8'));
const pins=JSON.parse(indexText);
assert.deepEqual(Object.keys(pins).sort(),['baseline','entries','format']);
assert.equal(pins.format,1);
export const coreWebkitSourceBase='f108e72bbce2ac11b89bdc18b2ece8fb2c6493ae';
assert.equal(pins.baseline,coreWebkitSourceBase);
/** @type {Record<string,{before:string|null,after:string,beforeText:string|null}>} */
export const coreWebkitSourcePins=pins.entries;
for(const[file,pin]of Object.entries(pins.entries)){
 assert.ok(!file.includes('..')&&!file.startsWith('/')&&!file.startsWith('.env'));
 assert.match(pin.after,/^[a-f0-9]{64}$/u);
 assert.equal(pin.beforeText===null?null:sha256(pin.beforeText),pin.before,'CORE_WEBKIT_BEFORE_CORRUPT:'+file);
}
export function sourceBeforeCoreWebkitShards(file,text){
 if(text===null)return null;
 if(file===indexFile&&canonicalLf(text)===indexText)return null;
 const pin=pins.entries[file];
 if(!pin||sha256(canonicalLf(text))!==pin.after)return text;
 return pin.beforeText;
}
export function restoreCoreWebkitShardHashes(rows){
 return rows.flatMap(row=>{
  const pin=pins.entries[row.file];if(!pin||row.sha256!==pin.after)return[row];
  const raw=canonicalLf(readFileSync(new URL('../../'+row.file,import.meta.url),'utf8'));
  assert.equal(sha256(raw),pin.after,'CORE_WEBKIT_CURRENT_SOURCE_CHANGED:'+row.file);
  return pin.before===null?[]:[{...row,sha256:pin.before}];
 });
}
export function pathsBeforeCoreWebkitShards(files){
 return files.filter(file=>{
  const raw=()=>canonicalLf(readFileSync(new URL('../../'+file,import.meta.url),'utf8'));
  if(file===indexFile)return raw()!==indexText;
  const pin=pins.entries[file];if(!pin||pin.before!==null)return true;
  return sha256(raw())!==pin.after;
 });
}
