import assert from 'node:assert/strict';
import {sourceBeforeRestorePrivate220,restoreRestorePrivate220Hashes,pathsBeforeRestorePrivate220} from './source-before-restore-private220.mjs';
import {readFileSync} from 'node:fs';
import {canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';

const indexFile='scripts/audit/cutover-hold224-source-pins.json';
const indexText=canonicalLf(readFileSync(new URL('./cutover-hold224-source-pins.json',import.meta.url),'utf8'));
const pins=JSON.parse(indexText);
assert.equal(pins.format,1);
assert.equal(pins.baseline,'e9bb74744f4ecf6ff9eb470f75f64296858a78be');
/** @type {Record<string,{before:string|null,after:string,beforeText:string|null}>} */
export const cutoverHold224Pins=pins.entries;
for(const [file,pin] of Object.entries(cutoverHold224Pins)){
 assert.ok(!file.includes('..')&&!file.startsWith('/')&&!file.startsWith('.env'));
 assert.match(pin.after,/^[a-f0-9]{64}$/u);
 assert.equal(pin.beforeText===null?null:sha256(pin.beforeText),pin.before,'CUTOVER_HOLD_HISTORY_PIN_CORRUPT:'+file);
}
export function sourceBeforeCutoverHold224(file,text){
 text=sourceBeforeRestorePrivate220(file,text);
 if(text===null)return null;
 const raw=canonicalLf(text);
 if(file===indexFile&&raw===indexText)return null;
 const pin=cutoverHold224Pins[file];
 return pin&&sha256(raw)===pin.after?pin.beforeText:text;
}
const current=file=>canonicalLf(readFileSync(new URL('../../'+file,import.meta.url),'utf8'));
export function restoreCutoverHold224Hashes(rows){
 return restoreRestorePrivate220Hashes(rows).flatMap(row=>{
  const pin=cutoverHold224Pins[row.file];
  if(!pin||row.sha256!==pin.after)return[row];
  assert.equal(sha256(sourceBeforeRestorePrivate220(row.file,current(row.file))),pin.after,'CUTOVER_HOLD_HISTORY_SOURCE_CHANGED:'+row.file);
  return pin.before===null?[]:[{...row,sha256:pin.before}];
 });
}
/** @param {string[]} files */
export function pathsBeforeCutoverHold224(files){
 return pathsBeforeRestorePrivate220(files).filter(file=>{
  if(file===indexFile)return sourceBeforeRestorePrivate220(file,current(file))!==indexText;
  const pin=cutoverHold224Pins[file];
  return !pin||pin.before!==null||sha256(sourceBeforeRestorePrivate220(file,current(file)))!==pin.after;
 });
}
