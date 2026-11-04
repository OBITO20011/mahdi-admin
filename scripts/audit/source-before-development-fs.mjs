// Exact test-only projection. Current builds and access probes use real sources.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
export const developmentFsPins=JSON.parse(readFileSync(new URL('./development-fs-source-pins.json',import.meta.url),'utf8')).entries;
const hash=text=>createHash('sha256').update(text).digest('hex');
export function sourceBeforeDevelopmentFs(file,text){
 if(text===null)return null;const raw=text.replaceAll('\r\n','\n'),pin=developmentFsPins[file];
 if(!pin||hash(raw)!==pin.after)return raw;
 assert.equal(hash(pin.beforeText),pin.before,'DEVELOPMENT_FS_INVERSE_CORRUPT');return pin.beforeText;
}
export function restoreDevelopmentFsHashes(sources){return sources.map(entry=>{
 const pin=developmentFsPins[entry.file];if(!pin||entry.sha256!==pin.after)return entry;
 return {...entry,sha256:pin.before};
});}
