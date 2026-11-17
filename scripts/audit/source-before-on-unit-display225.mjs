import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';

const indexFile='scripts/audit/on-unit-display225-source-pins.json';
const indexText=canonicalLf(readFileSync(new URL('./on-unit-display225-source-pins.json',import.meta.url),'utf8'));
const pins=JSON.parse(indexText);
assert.equal(pins.format,1);
assert.equal(pins.baseline,'191712116e0b204dbebe507e24b1c4cb25f40674');
/** @type {Record<string,{before:string|null,after:string,beforeText:string|null}>} */
export const onUnitDisplay225Pins=pins.entries;
for(const [file,pin] of Object.entries(onUnitDisplay225Pins)){
 assert.ok(!file.includes('..')&&!file.startsWith('/')&&!file.startsWith('.env'));
 assert.match(pin.after,/^[a-f0-9]{64}$/u);
 assert.equal(pin.beforeText===null?null:sha256(pin.beforeText),pin.before,'ON_UNIT_DISPLAY225_HISTORY_PIN_CORRUPT:'+file);
}
export function sourceBeforeOnUnitDisplay225(file,text){
 if(text===null)return null;
 const raw=canonicalLf(text);
 if(file===indexFile&&raw===indexText)return null;
 const pin=onUnitDisplay225Pins[file];
 return pin&&sha256(raw)===pin.after?pin.beforeText:text;
}
const current=file=>canonicalLf(readFileSync(new URL('../../'+file,import.meta.url),'utf8'));
export function restoreOnUnitDisplay225Hashes(rows){
 return rows.flatMap(row=>{
  const pin=onUnitDisplay225Pins[row.file];
  if(!pin||row.sha256!==pin.after)return[row];
  assert.equal(sha256(current(row.file)),pin.after,'ON_UNIT_DISPLAY225_HISTORY_SOURCE_CHANGED:'+row.file);
  return pin.before===null?[]:[{...row,sha256:pin.before}];
 });
}
/** @param {string[]} files */
export function pathsBeforeOnUnitDisplay225(files){
 return files.filter(file=>{
  if(file===indexFile)return current(file)!==indexText;
  const pin=onUnitDisplay225Pins[file];
  return !pin||pin.before!==null||sha256(current(file))!==pin.after;
 });
}
