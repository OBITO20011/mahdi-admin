// Test-only exact delivery inverse. Current220 runtime evidence is never projected through it.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=new URL('../../',import.meta.url),hash=s=>createHash('sha256').update(s.replaceAll('\r\n','\n')).digest('hex');
export const ownerTools220Pins=JSON.parse(readFileSync(new URL('./owner-tools220-source-pins.json',import.meta.url),'utf8'));
assert.equal(ownerTools220Pins.baseline,'7bf949b3bfe88bcacbc527184930ed6f9291481c');
const beforeCache=new Map();
export function sourceBeforeOwnerTools220(file,text){
 if(text===null)return null;const pin=ownerTools220Pins.entries[file];if(!pin||hash(text)!==pin.after)return text;
 if(pin.before===null)return null;
 if(!beforeCache.has(file)){const old=execFileSync('git',['show',ownerTools220Pins.baseline+':'+file],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:32*1024**2}).replaceAll('\r\n','\n');assert.equal(hash(old),pin.before,'OWNER220_HISTORICAL_BASELINE_CORRUPT');beforeCache.set(file,old);}
 return beforeCache.get(file);
}

export function restoreOwnerTools220Hashes(rows){return rows.flatMap(row=>{const p=ownerTools220Pins.entries[row.file];return !p||p.after!==row.sha256?[row]:p.before===null?[]:[{...row,sha256:p.before}];});}
/** @param {string[]} files @param {string|undefined} [reference] @returns {string[]} */
export function pathsBeforeOwnerTools220(files,reference){return files.filter(file=>{const pin=ownerTools220Pins.entries[file];if(!pin)return true;const raw=readFileSync(new URL('../../'+file,import.meta.url),'utf8'),before=sourceBeforeOwnerTools220(file,raw);if(before===null)return false;if(before===raw||!reference)return true;try{return hash(execFileSync('git',['show',reference+':'+file],{cwd:root,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:32*1024**2}))!==hash(before);}catch{return true;}});}
