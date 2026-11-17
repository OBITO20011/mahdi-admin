import {sourceBeforeReset224Ddl,restoreReset224DdlHashes,pathsBeforeReset224Ddl} from './source-before-reset224-ddl.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';

const indexFile='scripts/audit/restore-private220-source-pins.json';
const indexText=canonicalLf(readFileSync(new URL('./restore-private220-source-pins.json',import.meta.url),'utf8'));
const pins=JSON.parse(indexText);
assert.equal(pins.format,1);
assert.equal(pins.baseline,'98470d376894623247b7079426a9c29d1bf43f51');
/** @type {Record<string,{before:string|null,after:string,beforeText:string|null}>} */
export const restorePrivate220Pins=pins.entries;
for(const [file,pin] of Object.entries(restorePrivate220Pins)){
 assert.ok(!file.includes('..')&&!file.startsWith('/')&&!file.startsWith('.env'));
 assert.match(pin.after,/^[a-f0-9]{64}$/u);
 assert.equal(pin.beforeText===null?null:sha256(pin.beforeText),pin.before,'RESTORE_PRIVATE220_HISTORY_PIN_CORRUPT:'+file);
}
export function sourceBeforeRestorePrivate220(file,text){
 text=sourceBeforeReset224Ddl(file,text);
 if(text===null)return null;
 const raw=canonicalLf(text);
 if(file===indexFile&&raw===indexText)return null;
 const pin=restorePrivate220Pins[file];
 return pin&&sha256(raw)===pin.after?pin.beforeText:text;
}
const current=file=>canonicalLf(readFileSync(new URL('../../'+file,import.meta.url),'utf8'));
export function restoreRestorePrivate220Hashes(rows){
 return restoreReset224DdlHashes(rows).flatMap(row=>{
  const pin=restorePrivate220Pins[row.file];
  if(!pin||row.sha256!==pin.after)return[row];
  assert.equal(sha256(sourceBeforeReset224Ddl(row.file,current(row.file))),pin.after,'RESTORE_PRIVATE220_HISTORY_SOURCE_CHANGED:'+row.file);
  return pin.before===null?[]:[{...row,sha256:pin.before}];
 });
}
/** @param {string[]} files */
export function pathsBeforeRestorePrivate220(files){
 return pathsBeforeReset224Ddl(files).filter(file=>{
  if(file===indexFile)return sourceBeforeReset224Ddl(file,current(file))!==indexText;
  const pin=restorePrivate220Pins[file];
  return !pin||pin.before!==null||sha256(sourceBeforeReset224Ddl(file,current(file)))!==pin.after;
 });
}
