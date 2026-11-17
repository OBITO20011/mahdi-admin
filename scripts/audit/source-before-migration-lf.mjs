import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';

const indexFile='scripts/audit/migration-lf-source-pins.json';
const indexText=canonicalLf(readFileSync(new URL('./migration-lf-source-pins.json',import.meta.url),'utf8'));
const pins=JSON.parse(indexText);
assert.equal(pins.format,1);
assert.equal(pins.baseline,'a74070de584367f49cd1095ed8db5e5c2e5b8fba');
/** @type {Record<string,{before:string|null,after:string,beforeText:string|null}>} */
export const migrationLfPins=pins.entries;
for(const [file,pin] of Object.entries(migrationLfPins)){
 assert.ok(!file.includes('..')&&!file.startsWith('/')&&!file.startsWith('.env'));
 assert.match(pin.after,/^[a-f0-9]{64}$/u);
 assert.equal(pin.beforeText===null?null:sha256(pin.beforeText),pin.before,'MIGRATION_LF_HISTORY_PIN_CORRUPT:'+file);
}
export function sourceBeforeMigrationLf(file,text){
 if(text===null)return null;
 const raw=canonicalLf(text);
 if(file===indexFile&&raw===indexText)return null;
 const pin=migrationLfPins[file];
 return pin&&sha256(raw)===pin.after?pin.beforeText:text;
}
const current=file=>canonicalLf(readFileSync(new URL('../../'+file,import.meta.url),'utf8'));
export function restoreMigrationLfHashes(rows,readCurrent=current){
 return rows.flatMap(row=>{
  const pin=migrationLfPins[row.file];
  if(!pin||row.sha256!==pin.after)return[row];
  assert.equal(sha256(readCurrent(row.file)),pin.after,'MIGRATION_LF_HISTORY_SOURCE_CHANGED:'+row.file);
  return pin.before===null?[]:[{...row,sha256:pin.before}];
 });
}
/** @param {string[]} files */
export function pathsBeforeMigrationLf(files,readCurrent=current){
 return files.filter(file=>{
  if(file===indexFile)return readCurrent(file)!==indexText;
  const pin=migrationLfPins[file];
  return !pin||pin.before!==null||sha256(readCurrent(file))!==pin.after;
 });
}
