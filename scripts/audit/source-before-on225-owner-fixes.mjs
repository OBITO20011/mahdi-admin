// Owner 2026-11-20 ON225 trial fixes: exact test-only historical view; unknown bytes stay visible.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';

const indexFile='scripts/audit/on225-owner-fixes-source-pins.json';
const indexText=canonicalLf(readFileSync(new URL('./on225-owner-fixes-source-pins.json',import.meta.url),'utf8'));
const index=JSON.parse(indexText);
assert.equal(index.format,1);
assert.equal(index.baseline,'db1f1a13784d35632c1f2b33a91567392ef64271');

/** @type {Record<string,{before:string|null,after:string,beforeText:string|null}>} */
export const on225OwnerFixesPins=index.entries;
for(const [file,pin] of Object.entries(on225OwnerFixesPins)){
 assert.ok(!file.includes('..')&&!file.startsWith('/')&&!file.startsWith('.env'));
 assert.match(pin.after,/^[a-f0-9]{64}$/u);
 assert.equal(pin.beforeText===null?null:sha256(pin.beforeText),pin.before,'ON225_OWNER_FIXES_HISTORY_PIN_CORRUPT:'+file);
}

export function sourceBeforeOn225OwnerFixes(file,text){
 if(text===null)return null;
 const raw=canonicalLf(text);
 if(file===indexFile&&raw===indexText)return null;
 const pin=on225OwnerFixesPins[file];
 return pin&&sha256(raw)===pin.after?pin.beforeText:text;
}

const current=file=>canonicalLf(readFileSync(new URL('../../'+file,import.meta.url),'utf8'));
export function restoreOn225OwnerFixesHashes(rows){
 return rows.flatMap(row=>{
  const pin=on225OwnerFixesPins[row.file];
  if(!pin||row.sha256!==pin.after)return[row];
  assert.equal(sha256(current(row.file)),pin.after,'ON225_OWNER_FIXES_HISTORY_SOURCE_CHANGED:'+row.file);
  return pin.before===null?[]:[{...row,sha256:pin.before}];
 });
}

/** @param {string[]} files */
export function pathsBeforeOn225OwnerFixes(files){
 return files.filter(file=>{
  if(file===indexFile)return current(file)!==indexText;
  const pin=on225OwnerFixesPins[file];
  return !pin||pin.before!==null||sha256(current(file))!==pin.after;
 });
}
