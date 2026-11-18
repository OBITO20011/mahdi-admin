import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';

const indexFile='scripts/audit/on-cutover225-source-pins.json';
const indexText=canonicalLf(readFileSync(new URL('./on-cutover225-source-pins.json',import.meta.url),'utf8'));
const index=JSON.parse(indexText);
assert.equal(index.format,1);
assert.equal(index.baseline,'7482f86d5d62140c5605a6e6c3fb3c3e68a46aed');

/** @type {Record<string,{before:string|null,after:string,beforeText:string|null}>} */
export const onCutover225Pins=index.entries;
for(const [file,pin] of Object.entries(onCutover225Pins)){
 assert.ok(!file.includes('..')&&!file.startsWith('/')&&!file.startsWith('.env'));
 assert.match(pin.after,/^[a-f0-9]{64}$/u);
 assert.equal(pin.beforeText===null?null:sha256(pin.beforeText),pin.before,'ON_CUTOVER225_HISTORY_PIN_CORRUPT:'+file);
}

export function sourceBeforeOnCutover225(file,text){
 if(text===null)return null;
 const raw=canonicalLf(text);
 if(file===indexFile&&raw===indexText)return null;
 const pin=onCutover225Pins[file];
 return pin&&sha256(raw)===pin.after?pin.beforeText:text;
}

const current=file=>canonicalLf(readFileSync(new URL('../../'+file,import.meta.url),'utf8'));
export function restoreOnCutover225Hashes(rows){
 return rows.flatMap(row=>{
  const pin=onCutover225Pins[row.file];
  if(!pin||row.sha256!==pin.after)return[row];
  assert.equal(sha256(current(row.file)),pin.after,'ON_CUTOVER225_HISTORY_SOURCE_CHANGED:'+row.file);
  return pin.before===null?[]:[{...row,sha256:pin.before}];
 });
}

/** @param {string[]} files */
export function pathsBeforeOnCutover225(files){
 return files.filter(file=>{
  if(file===indexFile)return current(file)!==indexText;
  const pin=onCutover225Pins[file];
  return !pin||pin.before!==null||sha256(current(file))!==pin.after;
 });
}
