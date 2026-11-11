import{sourceBeforeSalesOnlyPhase3,restoreSalesOnlyPhase3Hashes,pathsBeforeSalesOnlyPhase3}from'./source-before-sales-only-phase3.mjs';
// Exact test-only view of phase1 task metadata. Never a runtime admission rule.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
export const salesOnlyPhase2Pins=JSON.parse(readFileSync(new URL('./sales-only-phase2-source-pins.json',import.meta.url),'utf8'));
const hash=s=>createHash('sha256').update(s.replaceAll('\r\n','\n')).digest('hex');
export function sourceBeforeSalesOnlyPhase2(file,text){
 text=sourceBeforeSalesOnlyPhase3(file,text);if(text===null)return null;
 const p=salesOnlyPhase2Pins.entries[file];if(!p||hash(text)!==p.after)return text;
 if(p.beforeText===null){assert.equal(p.before,null,'PHASE2_NEW_FILE_HISTORY_CORRUPT');return null;}
 assert.equal(hash(p.beforeText),p.before,'PHASE2_HISTORY_CORRUPT');return p.beforeText;
}
/** Frozen evidence only. Restored hashes bind complete current source bytes;
 * unknown hashes/files are retained, never exempted. */
export function restoreSalesOnlyPhase2Hashes(rows){return restoreSalesOnlyPhase3Hashes(rows).flatMap(row=>{
 const pin=salesOnlyPhase2Pins.entries[row.file];if(!pin||row.sha256!==pin.after)return[row];
 const current=readFileSync(new URL('../../'+row.file,import.meta.url),'utf8');
 const phase2=sourceBeforeSalesOnlyPhase3(row.file,current);
 assert.ok(phase2!==null,'PHASE2_CURRENT_HASH_SOURCE_CHANGED:'+row.file);
 assert.equal(hash(phase2),pin.after,'PHASE2_CURRENT_HASH_SOURCE_CHANGED:'+row.file);
 const before=sourceBeforeSalesOnlyPhase2(row.file,phase2);
 return before===null?[]:[{...row,sha256:hash(before)}];
});}
// Historical path inventories must apply the same exact-byte view as contents.
// New/changed unknown bytes remain visible;there is no directory exemption.
export function pathsBeforeSalesOnlyPhase2(files,reference){return pathsBeforeSalesOnlyPhase3(files,reference).filter(file=>{
 if(!salesOnlyPhase2Pins.entries[file])return true;
 const raw=readFileSync(new URL('../../'+file,import.meta.url),'utf8'),before=sourceBeforeSalesOnlyPhase2(file,raw);
 if(before===null)return false;if(before===raw||!reference)return true;
 try{return hash(execFileSync('git',['show',reference+':'+file],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:32*1024**2}))!==hash(before);}catch{return true;}
});}
