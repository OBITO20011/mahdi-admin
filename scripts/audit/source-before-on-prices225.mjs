import assert from 'node:assert/strict';
import {sourceBeforeOnCutover225,restoreOnCutover225Hashes,pathsBeforeOnCutover225} from './source-before-on-cutover225.mjs';
import {readFileSync} from 'node:fs';
import {canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';

const indexFile='scripts/audit/on-prices225-source-pins.json';
const indexText=canonicalLf(readFileSync(new URL('./on-prices225-source-pins.json',import.meta.url),'utf8'));
const pins=JSON.parse(indexText);
assert.equal(pins.format,1);
assert.equal(pins.baseline,'78f47ccdd7698cf95ee69dc1ae05ba2fd53da301');
/** @type {Record<string,{before:string|null,after:string,beforeText:string|null}>} */
export const onPrices225Pins=pins.entries;
for(const [file,pin] of Object.entries(onPrices225Pins)){
 assert.ok(!file.includes('..')&&!file.startsWith('/')&&!file.startsWith('.env'));
 assert.match(pin.after,/^[a-f0-9]{64}$/u);
 assert.equal(pin.beforeText===null?null:sha256(pin.beforeText),pin.before,'ON_PRICES225_HISTORY_PIN_CORRUPT:'+file);
}
export function sourceBeforeOnPrices225(file,text){
 text=sourceBeforeOnCutover225(file,text);
 if(text===null)return null;
 const raw=canonicalLf(text);
 if(file===indexFile&&raw===indexText)return null;
 const pin=onPrices225Pins[file];
 return pin&&sha256(raw)===pin.after?pin.beforeText:text;
}
const current=file=>canonicalLf(readFileSync(new URL('../../'+file,import.meta.url),'utf8'));
export function restoreOnPrices225Hashes(rows){
 return restoreOnCutover225Hashes(rows).flatMap(row=>{
  const pin=onPrices225Pins[row.file];
  if(!pin||row.sha256!==pin.after)return[row];
  assert.equal(sha256(sourceBeforeOnCutover225(row.file,current(row.file))),pin.after,'ON_PRICES225_HISTORY_SOURCE_CHANGED:'+row.file);
  return pin.before===null?[]:[{...row,sha256:pin.before}];
 });
}
/** @param {string[]} files */
export function pathsBeforeOnPrices225(files){
 return pathsBeforeOnCutover225(files).filter(file=>{
  if(file===indexFile)return current(file)!==indexText;
  const pin=onPrices225Pins[file];
  return !pin||pin.before!==null||sha256(sourceBeforeOnCutover225(file,current(file)))!==pin.after;
 });
}
