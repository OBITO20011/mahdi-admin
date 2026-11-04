// Historical tests only: exact known build-tool changes, never owner/runtime code.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
export const privateMapPins=JSON.parse(readFileSync(new URL('./private-maps-source-pins.json',import.meta.url),'utf8')).entries;
export function sourceBeforePrivateMaps(file,text){
 if(text===null)return null;const raw=text.replaceAll('\r\n','\n'),pin=privateMapPins[file];
 if(!pin||createHash('sha256').update(raw).digest('hex')!==pin.after)return raw;
 assert.equal(createHash('sha256').update(pin.beforeText).digest('hex'),pin.before,'PRIVATE_MAPS_INVERSE_CORRUPT');return pin.beforeText;
}
