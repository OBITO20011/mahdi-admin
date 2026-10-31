// Exact test-only inverse. Current inventory and runtime probes never use this view.
import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
const pins=JSON.parse(readFileSync(new URL('./sentry-source-pins.json',import.meta.url),'utf8')).entries;
const hash=s=>createHash('sha256').update(s).digest('hex');
export function sourceBeforeSentry(file,text){if(text===null)return null;const raw=text.replaceAll('\r\n','\n'),pin=pins[file];if(!pin||hash(raw)!==pin.after)return raw;if(pin.beforeText===null)return null;assert.equal(hash(pin.beforeText),pin.before,'SENTRY_INVERSE_CORRUPT');return pin.beforeText;}
export function restoreSentrySourceHashes(sources){return sources.flatMap(entry=>{const pin=pins[entry.file];if(!pin||entry.sha256!==pin.after)return[entry];return pin.beforeText===null?[]:[{...entry,sha256:pin.before}];});}

export function pathsBeforeSentry(files){return files.filter(file=>{const pin=pins[file];if(!pin)return true;const actual=readFileSync(new URL('../../'+file,import.meta.url),'utf8').replaceAll('\r\n','\n');return hash(actual)!==pin.after;});}
