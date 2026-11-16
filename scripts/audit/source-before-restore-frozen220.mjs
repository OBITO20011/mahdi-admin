import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';

const indexFile='scripts/audit/restore-frozen220-source-pins.json';
const indexText=canonicalLf(readFileSync(new URL('./restore-frozen220-source-pins.json',import.meta.url),'utf8'));
const pins=JSON.parse(indexText);
assert.equal(pins.format,1);
assert.equal(pins.baseline,'43fe6a6f1cd2bd0ff1c9c8f1b0017794d3aa2e57');
/** @type {Record<string,{before:string|null,after:string,beforeText:string|null}>} */
export const restoreFrozen220Pins=pins.entries;
for(const [file,pin] of Object.entries(restoreFrozen220Pins)){
 assert.ok(!file.includes('..')&&!file.startsWith('/')&&!file.startsWith('.env'));
 assert.match(pin.after,/^[a-f0-9]{64}$/u);
 assert.equal(pin.beforeText===null?null:sha256(pin.beforeText),pin.before,'RESTORE_FROZEN220_HISTORY_PIN_CORRUPT:'+file);
}
export function sourceBeforeRestoreFrozen220(file,text){
 if(text===null)return null;
 const raw=canonicalLf(text);
 if(file===indexFile&&raw===indexText)return null;
 const pin=restoreFrozen220Pins[file];
 return pin&&sha256(raw)===pin.after?pin.beforeText:text;
}
const current=file=>canonicalLf(readFileSync(new URL('../../'+file,import.meta.url),'utf8'));
export function restoreFrozen220Hashes(rows){
 return rows.flatMap(row=>{
  const pin=restoreFrozen220Pins[row.file];
  if(!pin||row.sha256!==pin.after)return [row];
  assert.equal(sha256(current(row.file)),pin.after,'RESTORE_FROZEN220_HISTORY_SOURCE_CHANGED:'+row.file);
  return pin.before===null?[]:[{...row,sha256:pin.before}];
 });
}
/** @param {string[]} files */
export function pathsBeforeRestoreFrozen220(files){
 return files.filter(file=>{
  if(file===indexFile)return current(file)!==indexText;
  const pin=restoreFrozen220Pins[file];
  return !pin||pin.before!==null||sha256(current(file))!==pin.after;
 });
}
