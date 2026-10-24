// Exact inverse of the owner-authorized verifier repair over delivered9a09c9b.
// Existing historical pins remain immutable; arbitrary mutations still fail.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {sourceBeforeHandover213} from './source-before-handover213.mjs';
export const ownerAcl212Inverse=JSON.parse(readFileSync(new URL('./owner-acl212-inverse.json',import.meta.url),'utf8'));
const hash=s=>createHash('sha256').update(s).digest('hex'),older=new Map();
for(const file of readdirSync(import.meta.dirname).filter(f=>f.endsWith('-hunks.json'))){
 const entries=JSON.parse(readFileSync(new URL('./'+file,import.meta.url),'utf8')).entries;
 for(const [name,pin]of Object.entries(entries)){
  if(!ownerAcl212Inverse.entries[name])continue;
  const known=older.get(name)??new Set();if(pin.before)known.add(pin.before);known.add(pin.after);
  for(const s of pin.approvedHistoricalSnapshots??[])known.add(s.sha256);older.set(name,known);
 }
}
export function sourceBeforeOwnerAcl212(file,text){
 const source=sourceBeforeHandover213(file,text),entry=ownerAcl212Inverse.entries[file];if(!entry)return source;
 const digest=hash(source);if(digest===entry.before||older.get(file)?.has(digest))return source;
 assert.equal(digest,entry.after,'OWNER_ACL212_UNREVIEWED_SOURCE:'+file);
 assert.equal(hash(entry.beforeText),entry.before,'OWNER_ACL212_INVERSE_CORRUPT:'+file);
 return entry.beforeText;
}
