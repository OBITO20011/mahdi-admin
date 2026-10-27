// Exact presentation-only layer over f95ff045. Never repin historical evidence.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const storeIdentityPins=JSON.parse(readFileSync(new URL('./store-sharing-identity-source-pins.json',import.meta.url),'utf8')).entries;
const hash=s=>createHash('sha256').update(s).digest('hex'),historical=new Map();
for(const name of readdirSync(import.meta.dirname).filter(n=>n.endsWith('.json')&&n!=='store-sharing-identity-source-pins.json')){
 for(const [file,pin] of Object.entries(JSON.parse(readFileSync(new URL('./'+name,import.meta.url),'utf8')).entries??{})){
  const hashes=historical.get(file)??new Set();for(const value of [pin.before,pin.after,...(pin.approvedHistoricalSnapshots??[]).map(p=>p.sha256)].filter(Boolean))hashes.add(value);historical.set(file,hashes);
 }
}
export function sourceBeforeStoreIdentity(file,text){
 if(text===null)return null;const source=text.replaceAll('\r\n','\n'),pin=storeIdentityPins[file];if(!pin)return source;
 const digest=hash(source);if(digest===pin.after){assert.equal(hash(pin.beforeText),pin.before,'STORE_IDENTITY_INVERSE_CORRUPT:'+file);return pin.beforeText;}
 if(digest===pin.before||historical.get(file)?.has(digest))return source;
 // Unknown historical test/infrastructure bytes remain intact for their own
 // existing full-file guards; no unknown content is ever erased.
 if(file.startsWith('tests/')||file.startsWith('scripts/operations/'))return source;
 assert.fail('HANDOVER214_UNREVIEWED_SOURCE:STORE_IDENTITY:'+file);
}
export function restoreStoreIdentitySourceHashes(sources){return sources.map(s=>{
 const pin=storeIdentityPins[s.file];if(!pin||s.sha256!==pin.after)return s;
 const current=readFileSync(new URL('../../'+s.file,import.meta.url),'utf8').replaceAll('\r\n','\n');assert.equal(hash(current),pin.after,'STORE_IDENTITY_CURRENT_SOURCE_CHANGED');
 return {...s,sha256:hash(sourceBeforeStoreIdentity(s.file,current))};
});}
