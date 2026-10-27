import {sourceBeforeOwnerTelegramFormat,restoreOwnerTelegramFormatSourceHashes} from './source-before-owner-telegram-format.mjs';
// Exact additive build-context layer. Historical proof pins stay immutable.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const prelaunchTrialPins=JSON.parse(readFileSync(new URL('./prelaunch-trial-inverse.json',import.meta.url),'utf8')).entries;
const hash=s=>createHash('sha256').update(s).digest('hex'),older=new Map();
for(const file of readdirSync(import.meta.dirname).filter(f=>f.endsWith('-hunks.json')||f.endsWith('-inverse.json')&&f!=='prelaunch-trial-inverse.json')){
 for(const [name,pin] of Object.entries(JSON.parse(readFileSync(new URL('./'+file,import.meta.url),'utf8')).entries??{})){
  const values=older.get(name)??new Set();for(const v of [pin.before,pin.after,...(pin.approvedHistoricalSnapshots??[]).map(p=>p.sha256)].filter(Boolean))values.add(v);older.set(name,values);
 }
}
export function sourceBeforePrelaunchTrial(file,text){
 if(text===null)return null;const restored=sourceBeforeOwnerTelegramFormat(file,text);if(restored===null)return null;const source=restored.replaceAll('\r\n','\n'),pin=prelaunchTrialPins[file];if(!pin)return source;
 const digest=hash(source);if(digest===pin.after){assert.equal(hash(pin.beforeText),pin.before,'PRELAUNCH_TRIAL_INVERSE_CORRUPT');return pin.beforeText;}
 if(digest===pin.before||older.get(file)?.has(digest))return source;
 assert.fail('HANDOVER214_UNREVIEWED_SOURCE:PRELAUNCH_TRIAL:'+file);
}
export function restorePrelaunchTrialSourceHashes(sources){return restoreOwnerTelegramFormatSourceHashes(sources).map(s=>{
 const pin=prelaunchTrialPins[s.file];if(!pin||s.sha256===pin.before||older.get(s.file)?.has(s.sha256))return s;
 assert.equal(s.sha256,pin.after,'PRELAUNCH_TRIAL_SOURCE_HASH:'+s.file);
 const before=sourceBeforePrelaunchTrial(s.file,readFileSync(new URL('../../'+s.file,import.meta.url),'utf8'));
 return {...s,sha256:hash(before)};
});}
