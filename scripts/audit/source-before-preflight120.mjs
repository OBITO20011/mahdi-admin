// Test-only exact source view for the owner-approved native preflight fix.
// Current operational behavior and SDK/role diagnostics never use this view.
import assert from 'node:assert/strict';
import {sourceBeforeCiDedup} from './source-before-ci-dedup.mjs';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const preflight120Pins=JSON.parse(readFileSync(new URL('./preflight120-source-pins.json',import.meta.url),'utf8'));
const hash=text=>createHash('sha256').update(text).digest('hex');
export function sourceBeforePreflight120(file,text){
 text=sourceBeforeCiDedup(file,text);
 const raw=text.replaceAll('\r\n','\n'),pin=preflight120Pins.entries[file];
 if(!pin||hash(raw)!==pin.after)return raw;
 assert.equal(hash(pin.beforeText),pin.before,'PREFLIGHT120_INVERSE_CORRUPT:'+file);
 return pin.beforeText;
}
