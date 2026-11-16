// Exact outer presentation/documentation layer. Never normalizes unknown bytes.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';
import {sourceBeforeCoreWebkitShards,restoreCoreWebkitShardHashes,pathsBeforeCoreWebkitShards} from './source-before-core-webkit-shards.mjs';
const indexFile='scripts/audit/inventory224-source-pins.json';
const indexText=canonicalLf(readFileSync(new URL('./inventory224-source-pins.json',import.meta.url),'utf8'));
const pins=JSON.parse(indexText);
assert.deepEqual(Object.keys(pins).sort(),['baseline','entries','format']);
assert.equal(pins.format,1);
export const inventory224SourceBase='3b35a263f7c20212c537bb61b2d20af778b7613d';
assert.equal(pins.baseline,inventory224SourceBase);
export const inventory224SourcePins=pins.entries;
for(const[file,pin]of Object.entries(pins.entries)){
 assert.ok(!file.includes('..')&&!file.startsWith('/')&&!file.startsWith('.env'));
 assert.match(pin.after,/^[a-f0-9]{64}$/u);
 assert.equal(pin.beforeText===null?null:sha256(pin.beforeText),pin.before,'INVENTORY224_BEFORE_CORRUPT:'+file);
}
export function sourceBeforeInventory224(file,text){
 text=sourceBeforeCoreWebkitShards(file,text);
 if(text===null)return null;
 if(file===indexFile&&canonicalLf(text)===indexText)return null;
 const pin=pins.entries[file];
 if(!pin||sha256(canonicalLf(text))!==pin.after)return text;
 return pin.beforeText;
}
export function restoreInventory224Hashes(rows){
 return restoreCoreWebkitShardHashes(rows).flatMap(row=>{
  const pin=pins.entries[row.file];if(!pin||row.sha256!==pin.after)return[row];
  const raw=sourceBeforeCoreWebkitShards(row.file,canonicalLf(readFileSync(new URL('../../'+row.file,import.meta.url),'utf8')));
  assert.ok(raw!==null,'INVENTORY224_HISTORICAL_SOURCE_REQUIRED:'+row.file);
  assert.equal(sha256(raw),pin.after,'INVENTORY224_CURRENT_SOURCE_CHANGED:'+row.file);
  return pin.before===null?[]:[{...row,sha256:pin.before}];
 });
}
export function pathsBeforeInventory224(files){
 return pathsBeforeCoreWebkitShards(files).filter(file=>{
  const raw=()=>sourceBeforeCoreWebkitShards(file,canonicalLf(readFileSync(new URL('../../'+file,import.meta.url),'utf8')));
  if(file===indexFile)return raw()!==indexText;
  const pin=pins.entries[file];if(!pin||pin.before!==null)return true;
  return sha256(raw())!==pin.after;
 });
}
