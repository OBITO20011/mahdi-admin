import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {sha256} from './sales-only-phase1-bridges.mjs';
import {sourceBeforeSalesOnlyPhase2} from '../audit/source-before-sales-only-phase2.mjs';
export const root=path.resolve(import.meta.dirname,'../..');
export const frozenSource=JSON.parse(readFileSync(new URL('../../docs/design/sales-only-phase1/frozen-source.json',import.meta.url),'utf8'));
export function assertFrozenSource(read=p=>readFileSync(path.join(root,p),'utf8')){
 for(const [p,pin]of Object.entries(frozenSource.files))assert.equal(sha256(sourceBeforeSalesOnlyPhase2(p,read(p)).replaceAll('\r\n','\n')),pin.sha256,`FROZEN_FILE_CHANGED:${p}`);
}
