// Exact test-only view. Current D1/RESET readiness and access probes never import it.
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
const root=new URL('../../',import.meta.url),hash=s=>createHash('sha256').update(s.replaceAll('\r\n','\n')).digest('hex');
export const d1Pins=JSON.parse(readFileSync(new URL('./d1-reference-kit-source-pins.json',import.meta.url),'utf8'));
assert.equal(d1Pins.baseline,'16ef354cb5ecab7e8689975b6d1c7ba3fadbed24');const cache=new Map();
export function sourceBeforeD1Kit(file,text){if(text===null)return null;const p=d1Pins.entries[file];if(!p||hash(text)!==p.after)return text;if(p.before===null)return null;if(!cache.has(file)){const old=execFileSync('git',['show',d1Pins.baseline+':'+file],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:32*1024**2}).replaceAll('\r\n','\n');assert.equal(hash(old),p.before,'D1_HISTORICAL_BASELINE_CHANGED');cache.set(file,old);}return cache.get(file);}
export function restoreD1Hashes(rows){return rows.flatMap(row=>{const p=d1Pins.entries[row.file];return !p||p.after!==row.sha256?[row]:p.before===null?[]:[{...row,sha256:p.before}];});}
