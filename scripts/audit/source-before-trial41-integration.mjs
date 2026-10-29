// Exact approved merge projection;unknown edits remain visible,never erased.
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {sourceBeforeAftercare215,restoreAftercare215SourceHashes} from './source-before-aftercare215.mjs';
export const trial41Integration=JSON.parse(readFileSync(new URL('./trial41-integration-source-pins.json',import.meta.url),'utf8'));
export const trial41IntegrationPins=trial41Integration.entries;
const hash=t=>createHash('sha256').update(t).digest('hex');
export function projectTrial41Source(file,text,target){
 assert.ok(['previousMain','trialTA','baseline'].includes(target),'TRIAL41_TARGET_INVALID');text=sourceBeforeAftercare215(file,text);if(text===null)return null;
 const source=text.replaceAll('\r\n','\n'),pin=trial41IntegrationPins[file];if(!pin||hash(source)!==pin.after)return source;
 const snapshot=pin.targets[target];if(snapshot===null)return null;assert.equal(hash(snapshot.text),snapshot.sha256,'TRIAL41_SNAPSHOT_CORRUPT:'+file);return snapshot.text;
}
export function projectTrial41Hashes(sources,targetFor){return restoreAftercare215SourceHashes(sources).flatMap(entry=>{
 const pin=trial41IntegrationPins[entry.file];if(!pin||entry.sha256!==pin.after)return [entry];
 const raw=sourceBeforeAftercare215(entry.file,readFileSync(new URL('../../'+entry.file,import.meta.url),'utf8'));assert.equal(hash(raw),pin.after,'TRIAL41_CURRENT_SOURCE_CHANGED:'+entry.file);
 const before=projectTrial41Source(entry.file,raw,targetFor(entry.file));return before===null?[]:[{...entry,sha256:hash(before)}];
});}
