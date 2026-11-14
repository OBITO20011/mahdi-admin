import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {sourceBeforePriceVisibility,restorePriceVisibilityHashes} from '../scripts/audit/source-before-price-visibility.mjs';
const file='customer-web/src/components/ProductCard.tsx';
const hash=(s:string)=>createHash('sha256').update(s.replaceAll('\r\n','\n')).digest('hex');
test('price layout inverse admits only the reviewed three CSS edits and preserves unknown bytes',()=>{
 const raw=readFileSync(file,'utf8'),before=execFileSync('git',['show','0bd3b5b0fd149c9e92d802c6dabb55b236c127cc:'+file],{encoding:'utf8',maxBuffer:1024**2}).replaceAll('\r\n','\n');
 assert.equal(sourceBeforePriceVisibility(file,raw),before);
 assert.equal(sourceBeforePriceVisibility(file,raw+'\n// unknown byte'),raw+'\n// unknown byte');
 assert.equal(sourceBeforePriceVisibility(file,null),null);assert.equal(sourceBeforePriceVisibility('unknown',raw),raw);
 assert.deepEqual(restorePriceVisibilityHashes([{file,sha256:hash(raw)}]),[{file,sha256:hash(before)}]);
 assert.deepEqual(restorePriceVisibilityHashes([{file,sha256:hash(raw+'x')}]),[{file,sha256:hash(raw+'x')}]);
 const pin=JSON.parse(readFileSync('scripts/audit/price-visibility-source-pin.json','utf8'));
 assert.equal(pin.hunks.length,3);assert.equal(pin.before,hash(before));assert.equal(pin.after,hash(raw));
});
