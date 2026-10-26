// One exact additive CI matrix admission;all previous inverse pins stay frozen.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const reset214bPins=JSON.parse(readFileSync(new URL('./reset214b-inverse.json',import.meta.url),'utf8')).entries;
const hash=s=>createHash('sha256').update(s).digest('hex'),older=new Map();
for(const file of readdirSync(import.meta.dirname).filter(f=>f.endsWith('-hunks.json')||['handover214-inverse.json','handover213-inverse.json','owner-acl212-inverse.json','reset214-inverse.json'].includes(f))){
 for(const [name,pin] of Object.entries(JSON.parse(readFileSync(new URL('./'+file,import.meta.url),'utf8')).entries)){
  const hashes=older.get(name)??new Set();for(const v of [pin.before,pin.after,...(pin.approvedHistoricalSnapshots??[]).map(p=>p.sha256)].filter(Boolean))hashes.add(v);older.set(name,hashes);
 }
}
export function sourceBeforeReset214B(file,text){
 if(text===null)return null;const source=text.replaceAll('\r\n','\n'),pin=reset214bPins[file];if(!pin)return source;
 const digest=hash(source);if(digest===pin.after){assert.equal(hash(pin.beforeText),pin.before,'RESET214B_CORRUPT_INVERSE');return pin.beforeText;}
 if(digest===pin.before||older.get(file)?.has(digest))return source;
 assert.fail('HANDOVER214_UNREVIEWED_SOURCE:'+file);
}
