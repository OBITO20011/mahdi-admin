// Exact test-only view of phase1 task metadata. Never a runtime admission rule.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const salesOnlyPhase2Pins=JSON.parse(readFileSync(new URL('./sales-only-phase2-source-pins.json',import.meta.url),'utf8'));
const hash=s=>createHash('sha256').update(s.replaceAll('\r\n','\n')).digest('hex');
export function sourceBeforeSalesOnlyPhase2(file,text){
 if(text===null)return null;
 const p=salesOnlyPhase2Pins.entries[file];if(!p||hash(text)!==p.after)return text;
 assert.equal(hash(p.beforeText),p.before,'PHASE2_HISTORY_CORRUPT');return p.beforeText;
}
