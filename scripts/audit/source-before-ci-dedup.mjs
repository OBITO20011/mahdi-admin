// Test-only source view for approved CI scheduling changes; never used by
// production code, operational tools, or the current SDK/role inventory.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const ciDedupPins=JSON.parse(readFileSync(new URL('./ci-dedup-source-pins.json',import.meta.url),'utf8'));
const hash=text=>createHash('sha256').update(text).digest('hex');
export function sourceBeforeCiDedup(file,text){
 if(text===null)return null;
 const raw=text.replaceAll('\r\n','\n'),pin=ciDedupPins.entries[file];
 if(!pin||hash(raw)!==pin.after)return raw;
 assert.equal(hash(pin.beforeText),pin.before,'CI_DEDUP_INVERSE_CORRUPT:'+file);
 return pin.beforeText;
}
