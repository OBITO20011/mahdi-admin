import {sourceBeforeUsability,restoreUsabilityHashes,pathsBeforeUsability} from './source-before-pre-delivery-usability.mjs';
import {sourceBeforeHome219,restoreHome219SourceHashes,pathsBeforeHome219} from './source-before-home-performance219.mjs';
import {sourceBeforeStoreScroll,restoreStoreScrollHashes,pathsBeforeStoreScroll} from './source-before-store-scroll.mjs';
import {sourceBeforeDevelopmentFs,restoreDevelopmentFsHashes} from './source-before-development-fs.mjs';
// Exact test-only inverse. Current inventory and runtime probes never use this view.
import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
const pins=JSON.parse(readFileSync(new URL('./sentry-source-pins.json',import.meta.url),'utf8')).entries;
const hash=s=>createHash('sha256').update(s).digest('hex');
export function sourceBeforeSentry(file,text){text=sourceBeforeHome219(file,sourceBeforeUsability(file,sourceBeforeStoreScroll(file,sourceBeforeDevelopmentFs(file,text))));if(text===null)return null;const raw=text.replaceAll('\r\n','\n'),pin=pins[file];if(!pin||hash(raw)!==pin.after)return raw;if(pin.beforeText===null)return null;assert.equal(hash(pin.beforeText),pin.before,'SENTRY_INVERSE_CORRUPT');return pin.beforeText;}
export function restoreSentrySourceHashes(sources){return restoreHome219SourceHashes(restoreUsabilityHashes(restoreStoreScrollHashes(restoreDevelopmentFsHashes(sources)))).flatMap(entry=>{const pin=pins[entry.file];if(!pin||entry.sha256!==pin.after)return[entry];return pin.beforeText===null?[]:[{...entry,sha256:pin.before}];});}

export function pathsBeforeSentry(files,reference){return pathsBeforeHome219(pathsBeforeUsability(pathsBeforeStoreScroll(files,reference),reference)).filter(file=>{const pin=pins[file];if(!pin)return true;const actual=sourceBeforeStoreScroll(file,readFileSync(new URL('../../'+file,import.meta.url),'utf8').replaceAll('\r\n','\n'));return actual===null||hash(actual)!==pin.after;});}
