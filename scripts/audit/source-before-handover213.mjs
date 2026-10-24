// Additive exact inverse over the merged audit baseline. Existing historical
// layers retain their own complete-file pins and reject unknown mutations.
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
export const handover213Pins=JSON.parse(readFileSync(new URL('./handover213-inverse.json',import.meta.url),'utf8')).entries;
const hash=s=>createHash('sha256').update(s).digest('hex');
export function sourceBeforeHandover213(file,text){
 const source=text.replaceAll('\r\n','\n'),pin=handover213Pins[file];if(!pin||hash(source)!==pin.after)return source;
 assert.equal(hash(pin.beforeText),pin.before,'HANDOVER213_INVERSE_CORRUPT:'+file);return pin.beforeText;
}
/** @param {string[]} files @returns {string[]} */
export function pathsBeforeHandover213(files){
 return files.filter(file=>{const pin=handover213Pins[file];if(!pin?.added)return true;assert.equal(hash(readFileSync(new URL('../../'+file,import.meta.url),'utf8').replaceAll('\r\n','\n')),pin.after,'HANDOVER213_UNREVIEWED_ADDITION:'+file);return false;});
}
