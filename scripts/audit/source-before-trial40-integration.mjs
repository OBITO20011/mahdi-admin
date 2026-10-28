// Exact merge bridge. Approved feature proofs retain their own original bytes;
// current unprojected SDK evidence covers the actual combined application.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const trial40IntegrationPins=JSON.parse(readFileSync(new URL('./trial40-integration-source-pins.json',import.meta.url),'utf8')).entries;
const hash=text=>createHash('sha256').update(text).digest('hex');
export function projectTrial40Source(file,text,target){
  assert.ok(['identity','bulk','baseline'].includes(target),'TRIAL40_TARGET_INVALID');
  if(text===null)return null;
  const source=text.replaceAll('\r\n','\n'),pin=trial40IntegrationPins[file];
  // An unknown edit stays visible to the existing full-source guards.
  if(!pin||hash(source)!==pin.after)return source;
  const snapshot=pin.targets[target];
  if(snapshot===null)return null;
  assert.equal(hash(snapshot.text),snapshot.sha256,'TRIAL40_SNAPSHOT_CORRUPT:'+file);
  return snapshot.text;
}
export function projectTrial40Hashes(sources,targetFor){
  return sources.flatMap(entry=>{
    const pin=trial40IntegrationPins[entry.file];
    if(!pin||entry.sha256!==pin.after)return [entry];
    const raw=readFileSync(new URL('../../'+entry.file,import.meta.url),'utf8').replaceAll('\r\n','\n');
    assert.equal(hash(raw),pin.after,'TRIAL40_CURRENT_SOURCE_CHANGED:'+entry.file);
    const source=projectTrial40Source(entry.file,raw,targetFor(entry.file));
    return source===null?[]:[{...entry,sha256:hash(source)}];
  });
}
