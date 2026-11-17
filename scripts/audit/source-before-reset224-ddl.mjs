import {sourceBeforeRestoreRawAcl,restoreRawAclHashes,pathsBeforeRestoreRawAcl} from './source-before-restore-raw-acl.mjs';
import {sourceBeforeMigrationLf,restoreMigrationLfHashes,pathsBeforeMigrationLf} from './source-before-migration-lf.mjs';
import {sourceBeforeOnUnitDisplay225,restoreOnUnitDisplay225Hashes,pathsBeforeOnUnitDisplay225} from './source-before-on-unit-display225.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';

const indexFile='scripts/audit/reset224-ddl-source-pins.json';
const indexText=canonicalLf(readFileSync(new URL('./reset224-ddl-source-pins.json',import.meta.url),'utf8'));
const pins=JSON.parse(indexText);
assert.equal(pins.format,1);
assert.equal(pins.baseline,'2508a9e5eff2762ab42933394a8243bb6c1af4a4');
/** @type {Record<string,{before:string|null,after:string,beforeText:string|null}>} */
export const reset224DdlPins=pins.entries;
for(const [file,pin] of Object.entries(reset224DdlPins)){
 assert.ok(!file.includes('..')&&!file.startsWith('/')&&!file.startsWith('.env'));
 assert.match(pin.after,/^[a-f0-9]{64}$/u);
 assert.equal(pin.beforeText===null?null:sha256(pin.beforeText),pin.before,'RESET224_DDL_HISTORY_PIN_CORRUPT:'+file);
}
const beforeOperationalLayers=(file,text)=>sourceBeforeMigrationLf(file,sourceBeforeRestoreRawAcl(file,sourceBeforeOnUnitDisplay225(file,text)));
export function sourceBeforeReset224Ddl(file,text){
 text=beforeOperationalLayers(file,text);
 if(text===null)return null;
 const raw=canonicalLf(text);
 if(file===indexFile&&raw===indexText)return null;
 const pin=reset224DdlPins[file];
 return pin&&sha256(raw)===pin.after?pin.beforeText:text;
}
const current=file=>canonicalLf(readFileSync(new URL('../../'+file,import.meta.url),'utf8'));
const beforeDisplay=file=>sourceBeforeOnUnitDisplay225(file,current(file));
const beforeRestore=file=>sourceBeforeRestoreRawAcl(file,beforeDisplay(file));
export function restoreReset224DdlHashes(rows){
 return restoreMigrationLfHashes(restoreRawAclHashes(restoreOnUnitDisplay225Hashes(rows),beforeDisplay),beforeRestore).flatMap(row=>{
  const pin=reset224DdlPins[row.file];
  if(!pin||row.sha256!==pin.after)return[row];
  assert.equal(sha256(beforeOperationalLayers(row.file,current(row.file))),pin.after,'RESET224_DDL_HISTORY_SOURCE_CHANGED:'+row.file);
  return pin.before===null?[]:[{...row,sha256:pin.before}];
 });
}
/** @param {string[]} files */
export function pathsBeforeReset224Ddl(files){
 return pathsBeforeMigrationLf(pathsBeforeRestoreRawAcl(pathsBeforeOnUnitDisplay225(files),beforeDisplay),beforeRestore).filter(file=>{
  if(file===indexFile)return beforeOperationalLayers(file,current(file))!==indexText;
  const pin=reset224DdlPins[file];
  return !pin||pin.before!==null||sha256(beforeOperationalLayers(file,current(file)))!==pin.after;
 });
}
