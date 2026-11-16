import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';
const indexFile='scripts/audit/supported-upgrades224-source-pins.json';
const indexText=canonicalLf(readFileSync(new URL('./supported-upgrades224-source-pins.json',import.meta.url),'utf8'));
const pins=JSON.parse(indexText);
assert.equal(pins.format,1);
assert.equal(pins.baseline,'ff102b4019355987321a09a492d02c323f58d4b9');
/** @type {Record<string,{before:string|null,after:string,beforeText:string|null}>} */
export const supportedUpgrades224Pins=pins.entries;
for(const[file,pin]of Object.entries(supportedUpgrades224Pins)){
 assert.ok(!file.includes('..')&&!file.startsWith('/')&&!file.startsWith('.env'));
 assert.match(pin.after,/^[a-f0-9]{64}$/u);
 assert.equal(pin.beforeText===null?null:sha256(pin.beforeText),pin.before,'SUPPORTED_UPGRADE_HISTORY_PIN_CORRUPT:'+file);
}
export function sourceBeforeSupportedUpgrades224(file,text){
 if(text===null)return null;
 const raw=canonicalLf(text);
 if(file===indexFile&&raw===indexText)return null;
 const pin=supportedUpgrades224Pins[file];
 return pin&&sha256(raw)===pin.after?pin.beforeText:text;
}
const current=file=>canonicalLf(readFileSync(new URL('../../'+file,import.meta.url),'utf8'));
export function restoreSupportedUpgrades224Hashes(rows){
 return rows.flatMap(row=>{
  const pin=supportedUpgrades224Pins[row.file];
  if(!pin||row.sha256!==pin.after)return[row];
  assert.equal(sha256(current(row.file)),pin.after,'SUPPORTED_UPGRADE_HISTORY_SOURCE_CHANGED:'+row.file);
  return pin.before===null?[]:[{...row,sha256:pin.before}];
 });
}
/** @param {string[]} files */
export function pathsBeforeSupportedUpgrades224(files){
 return files.filter(file=>{
  if(file===indexFile)return current(file)!==indexText;
  const pin=supportedUpgrades224Pins[file];
  return !pin||pin.before!==null||sha256(current(file))!==pin.after;
 });
}
