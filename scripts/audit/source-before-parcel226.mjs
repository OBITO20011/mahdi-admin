import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';

const indexFile='scripts/audit/parcel226-source-pins.json';
const indexText=canonicalLf(readFileSync(new URL('./parcel226-source-pins.json',import.meta.url),'utf8'));
const index=JSON.parse(indexText);
export const parcel226Baseline='14c8fff9dbc37896be138ce288990595c03e237a';
assert.equal(index.format,1);
assert.equal(index.baseline,parcel226Baseline);
export const parcel226Pins=index.entries;
for(const [file,pin] of Object.entries(parcel226Pins)){
 assert.ok(!file.includes('..')&&!file.startsWith('/')&&!file.startsWith('.env'));
 assert.match(pin.after,/^[a-f0-9]{64}$/u);
 assert.equal(pin.beforeText===null?null:sha256(pin.beforeText),pin.before,'PARCEL226_HISTORY_PIN_CORRUPT:'+file);
}
const current=file=>canonicalLf(readFileSync(new URL('../../'+file,import.meta.url),'utf8'));
export function sourceBeforeParcel226(file,text){
 if(text===null)return null;
 const raw=canonicalLf(text);
 if(file===indexFile&&raw===indexText)return null;
 const pin=parcel226Pins[file];
 return pin&&sha256(raw)===pin.after?pin.beforeText:text;
}
export function restoreParcel226Hashes(rows){
 return rows.flatMap(row=>{
  const pin=parcel226Pins[row.file];
  if(!pin||row.sha256!==pin.after)return [row];
  assert.equal(sha256(current(row.file)),pin.after,'PARCEL226_HISTORY_SOURCE_CHANGED:'+row.file);
  return pin.before===null?[]:[{...row,sha256:pin.before}];
 });
}
export function pathsBeforeParcel226(files){
 return files.filter(file=>{
  if(file===indexFile)return current(file)!==indexText;
  const pin=parcel226Pins[file];
  return !pin||pin.before!==null||sha256(current(file))!==pin.after;
 });
}
