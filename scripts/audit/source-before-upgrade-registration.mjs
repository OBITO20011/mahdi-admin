import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';

const indexFile='scripts/audit/upgrade-registration-source-pins.json';
const indexText=canonicalLf(readFileSync(new URL('./upgrade-registration-source-pins.json',import.meta.url),'utf8'));
const pins=JSON.parse(indexText);
assert.equal(pins.format,1);
assert.equal(pins.baseline,'d451b1a9aa726f2c576402289c412ee458ee76a1');
/** @type {Record<string,{before:string|null,after:string,beforeText:string|null}>} */
export const upgradeRegistrationPins=pins.entries;
for(const [file,pin] of Object.entries(upgradeRegistrationPins)){
 assert.ok(!file.includes('..')&&!file.startsWith('/')&&!file.startsWith('.env'));
 assert.match(pin.after,/^[a-f0-9]{64}$/u);
 assert.equal(pin.beforeText===null?null:sha256(pin.beforeText),pin.before,'REGISTRATION_HISTORY_PIN_CORRUPT:'+file);
}
export function sourceBeforeUpgradeRegistration(file,text){
 if(text===null)return null;
 const raw=canonicalLf(text);
 if(file===indexFile&&raw===indexText)return null;
 const pin=upgradeRegistrationPins[file];
 return pin&&sha256(raw)===pin.after?pin.beforeText:text;
}
const current=file=>canonicalLf(readFileSync(new URL('../../'+file,import.meta.url),'utf8'));
export function restoreUpgradeRegistrationHashes(rows){
 return rows.flatMap(row=>{
  const pin=upgradeRegistrationPins[row.file];
  if(!pin||row.sha256!==pin.after)return [row];
  assert.equal(sha256(current(row.file)),pin.after,'REGISTRATION_HISTORY_SOURCE_CHANGED:'+row.file);
  return pin.before===null?[]:[{...row,sha256:pin.before}];
 });
}
export function pathsBeforeUpgradeRegistration(files){
 return files.filter(file=>{
  if(file===indexFile)return current(file)!==indexText;
  const pin=upgradeRegistrationPins[file];
  return !pin||pin.before!==null||sha256(current(file))!==pin.after;
 });
}
