// Test-only inverse of exact phase1 documentation/task-scope bytes. Never
// imported by owner tools, current SDK probes or the prototype SQL installer.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {sourceBeforeSalesOnlyPhase2} from './source-before-sales-only-phase2.mjs';
export const salesOnlyPhase1Pins=JSON.parse(readFileSync(new URL('./sales-only-phase1-source-pins.json',import.meta.url),'utf8'));
const hash=s=>createHash('sha256').update(s.replaceAll('\r\n','\n')).digest('hex');
assert.equal(salesOnlyPhase1Pins.baseline,'4f3d6409e284da89cc33972b3fac36e135bebd35');
export function sourceBeforeSalesOnlyPhase1(file,text){
 text=sourceBeforeSalesOnlyPhase2(file,text);
 if(text===null)return null;
 const p=salesOnlyPhase1Pins.entries[file];if(!p||hash(text)!==p.after)return text;
 assert.equal(hash(p.beforeText),p.before,'SALES_ONLY_HISTORY_CORRUPT');return p.beforeText;
}
