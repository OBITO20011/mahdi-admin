// Exact test-only view of phase1 task metadata. Never a runtime admission rule.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
export const salesOnlyPhase2Pins=JSON.parse(readFileSync(new URL('./sales-only-phase2-source-pins.json',import.meta.url),'utf8'));
const hash=s=>createHash('sha256').update(s.replaceAll('\r\n','\n')).digest('hex');
export function sourceBeforeSalesOnlyPhase2(file,text){
 if(text===null)return null;
 const p=salesOnlyPhase2Pins.entries[file];if(!p||hash(text)!==p.after)return text;
 if(p.beforeText===null){assert.equal(p.before,null,'PHASE2_NEW_FILE_HISTORY_CORRUPT');return null;}
 assert.equal(hash(p.beforeText),p.before,'PHASE2_HISTORY_CORRUPT');return p.beforeText;
}
// Historical path inventories must apply the same exact-byte view as contents.
// New/changed unknown bytes remain visible;there is no directory exemption.
export function pathsBeforeSalesOnlyPhase2(files,reference){return files.filter(file=>{
 if(!salesOnlyPhase2Pins.entries[file])return true;
 const raw=readFileSync(new URL('../../'+file,import.meta.url),'utf8'),before=sourceBeforeSalesOnlyPhase2(file,raw);
 if(before===null)return false;if(before===raw||!reference)return true;
 try{return hash(execFileSync('git',['show',reference+':'+file],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:32*1024**2}))!==hash(before);}catch{return true;}
});}
