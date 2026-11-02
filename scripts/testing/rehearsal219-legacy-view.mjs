// Test-only exact inverse for the explicit restore hook, its runtime test and
// branch metadata. NOT imported by any owner tool or current access inventory.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
export const rehearsal219LegacyPins=JSON.parse(readFileSync(new URL('./rehearsal219-legacy-view.json',import.meta.url),'utf8'));
const hash=s=>createHash('sha256').update(s).digest('hex');
export function sourceBeforeRehearsal219(file,text){
 if(text===null)return null;const pin=rehearsal219LegacyPins.files[file],raw=text.replaceAll('\r\n','\n');
 if(!pin||hash(raw)!==pin.after)return raw;
 assert.equal(hash(pin.beforeText),pin.before,'REHEARSAL_LEGACY_INVERSE_CORRUPT');return pin.beforeText;
}
