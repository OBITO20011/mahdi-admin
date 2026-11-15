import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonicalLf,sha256} from '../testing/maintenance-db-contract.mjs';
const indexFile='scripts/audit/latin-digits-source-pins.json';
const indexText=canonicalLf(readFileSync(new URL('./latin-digits-source-pins.json',import.meta.url),'utf8'));
const pins=JSON.parse(indexText);
assert.deepEqual(Object.keys(pins).sort(),['baseline','entries','format']);
assert.equal(pins.format,1);
export const latinDigitsSourceBase='99eb18465d828b404764a18f1ff212f793e3fcc3';
assert.equal(pins.baseline,latinDigitsSourceBase);
export const latinDigitsSourcePins=pins.entries;
for(const [file,pin] of Object.entries(pins.entries)){
 assert.ok(!file.includes('..')&&!file.startsWith('/')&&!file.startsWith('.env'));
 assert.match(pin.after,/^[a-f0-9]{64}$/u);
 assert.equal(pin.beforeText===null?null:sha256(pin.beforeText),pin.before,'LATIN_BEFORE_CORRUPT:'+file);
}

export function sourceBeforeLatinDigits(file,text){
 if(text===null)return null;
 // The index is metadata for this exact added layer,not historical source.
 if(file===indexFile&&canonicalLf(text)===indexText)return null;
 const pin=pins.entries[file];
 if(!pin||pin.binary||sha256(canonicalLf(text))!==pin.after)return text;
 return pin.beforeText;
}

export function restoreLatinDigitsHashes(rows){
 return rows.flatMap(row=>{
  const pin=pins.entries[row.file];if(!pin||row.sha256!==pin.after)return[row];
  const bytes=readFileSync(new URL('../../'+row.file,import.meta.url));
  assert.equal(sha256(pin.binary?bytes:canonicalLf(bytes.toString('utf8'))),pin.after,'LATIN_CURRENT_SOURCE_CHANGED:'+row.file);
  return pin.before===null?[]:[{...row,sha256:pin.before}];
 });
}

export function pathsBeforeLatinDigits(files){
 return files.filter(file=>{
  if(file===indexFile)return canonicalLf(readFileSync(new URL('../../'+file,import.meta.url),'utf8'))!==indexText;
  const pin=pins.entries[file];if(!pin||pin.before!==null)return true;
  const bytes=readFileSync(new URL('../../'+file,import.meta.url));
  return sha256(pin.binary?bytes:canonicalLf(bytes.toString('utf8')))!==pin.after;
 });
}
