// Presentation-only T-A layer. Frozen proofs see their original sources;
// unprojected current SDK proof still covers the complete actual application.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const trialTAPins=JSON.parse(readFileSync(new URL('./trial-ta-source-pins.json',import.meta.url),'utf8')).entries;
const hash=text=>createHash('sha256').update(text).digest('hex');
export function sourceBeforeTrialTA(file,text){
 if(text===null)return null;const source=text.replaceAll('\r\n','\n'),pin=trialTAPins[file];if(!pin)return source;
 if(hash(source)===pin.after){if(pin.added)return null;assert.equal(hash(pin.beforeText),pin.before,'TRIAL_TA_INVERSE_CORRUPT:'+file);return pin.beforeText;}
 // Keep unknown earlier bytes visible to the original entire-file guards.
 if(!pin.added)return source;
 assert.fail('HANDOVER214_UNREVIEWED_SOURCE:TRIAL_TA:'+file);
}
export function restoreTrialTASourceHashes(sources){return sources.flatMap(entry=>{
 const pin=trialTAPins[entry.file];if(!pin||entry.sha256!==pin.after)return [entry];
 const raw=readFileSync(new URL('../../'+entry.file,import.meta.url),'utf8').replaceAll('\r\n','\n');assert.equal(hash(raw),pin.after,'TRIAL_TA_CURRENT_SOURCE_CHANGED:'+entry.file);
 const before=sourceBeforeTrialTA(entry.file,raw);return before===null?[]:[{...entry,sha256:hash(before)}];
});}
