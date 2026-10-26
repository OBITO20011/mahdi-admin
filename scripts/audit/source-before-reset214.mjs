import {sourceBeforeReset214B} from './source-before-reset214b.mjs';
// Two exact operational additions; historical financial/source pins stay intact.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const reset214Pins=JSON.parse(readFileSync(new URL('./reset214-inverse.json',import.meta.url),'utf8')).entries;
const hash=text=>createHash('sha256').update(text).digest('hex'),older=new Map();
for(const file of readdirSync(import.meta.dirname).filter(f=>f.endsWith('-hunks.json')||['handover214-inverse.json','handover213-inverse.json','owner-acl212-inverse.json'].includes(f))){
 const entries=JSON.parse(readFileSync(new URL('./'+file,import.meta.url),'utf8')).entries;
 for(const [name,pin] of Object.entries(entries)){
  const hashes=older.get(name)??new Set();
  for(const digest of [pin.before,pin.after,...(pin.approvedHistoricalSnapshots??[]).map(p=>p.sha256)].filter(Boolean))hashes.add(digest);
  older.set(name,hashes);
 }
}
export function sourceBeforeReset214(file,text){
 if(text===null)return null;
 const source=sourceBeforeReset214B(file,text),pin=reset214Pins[file];if(!pin)return source;
 const digest=hash(source);
 if(digest===pin.after){assert.equal(hash(pin.beforeText),pin.before,'RESET214_CORRUPT_INVERSE:'+file);return pin.beforeText;}
 if(digest===pin.before||older.get(file)?.has(digest))return source;
 // Preserve the historical outer entrypoint's rejection contract as well.
 assert.fail('HANDOVER214_UNREVIEWED_SOURCE:'+file);
}
