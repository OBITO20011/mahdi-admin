import {sourceBeforeIndependentPrices222,restoreIndependentPrices222Hashes,pathsBeforeIndependentPrices222} from './source-before-independent-prices222.mjs';
// Exact test-only view of phase1 task metadata. Never a runtime admission rule.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
export const salesOnlyPhase3Pins=JSON.parse(readFileSync(new URL('./sales-only-phase3-source-pins.json',import.meta.url),'utf8'));
const hash=s=>createHash('sha256').update(s.replaceAll('\r\n','\n')).digest('hex');
export function sourceBeforeSalesOnlyPhase3(file,text){
 text=sourceBeforeIndependentPrices222(file,text);if(text===null)return null;
 const p=salesOnlyPhase3Pins.entries[file];if(!p||hash(text)!==p.after)return text;
 if(p.beforeText===null){assert.equal(p.before,null,'PHASE3_NEW_FILE_HISTORY_CORRUPT');return null;}
 assert.equal(hash(p.beforeText),p.before,'PHASE3_HISTORY_CORRUPT');return p.beforeText;
}
/** Frozen evidence only. Restored hashes bind complete current source bytes;
 * unknown hashes/files are retained, never exempted. */
export function restoreSalesOnlyPhase3Hashes(rows){return restoreIndependentPrices222Hashes(rows).flatMap(row=>{
 const pin=salesOnlyPhase3Pins.entries[row.file];if(!pin||row.sha256!==pin.after)return[row];
 const raw=sourceBeforeIndependentPrices222(row.file,readFileSync(new URL('../../'+row.file,import.meta.url),'utf8'));
 assert.ok(raw!==null,'PRICES222_PHASE3_EXISTING_SOURCE_REQUIRED');
 assert.equal(hash(raw),pin.after,'PHASE3_CURRENT_HASH_SOURCE_CHANGED:'+row.file);
 const before=sourceBeforeSalesOnlyPhase3(row.file,raw);
 return before===null?[]:[{...row,sha256:hash(before)}];
});}
// Historical path inventories must apply the same exact-byte view as contents.
// New/changed unknown bytes remain visible;there is no directory exemption.
export function pathsBeforeSalesOnlyPhase3(files,reference){return pathsBeforeIndependentPrices222(files,reference).filter(file=>{
 if(!salesOnlyPhase3Pins.entries[file])return true;
 const raw=sourceBeforeIndependentPrices222(file,readFileSync(new URL('../../'+file,import.meta.url),'utf8'));if(raw===null)return false;const before=sourceBeforeSalesOnlyPhase3(file,raw);
 if(before===null)return false;if(before===raw||!reference)return true;
 try{return hash(execFileSync('git',['show',reference+':'+file],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:32*1024**2}))!==hash(before);}catch{return true;}
});}
