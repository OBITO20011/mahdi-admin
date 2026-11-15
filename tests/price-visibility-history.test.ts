import {sourceBeforeLatinDigits} from '../scripts/audit/source-before-latin-digits.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {sourceBeforePriceVisibility,restorePriceVisibilityHashes,pathsBeforePriceVisibility} from '../scripts/audit/source-before-price-visibility.mjs';
const file='customer-web/src/components/ProductCard.tsx';
const hash=(s:string)=>createHash('sha256').update(s.replaceAll('\r\n','\n')).digest('hex');
test('price layout inverse binds the OFF redesign and preserves the original exact three CSS inverse and every unknown byte',()=>{
 const current=readFileSync(file,'utf8'),raw=sourceBeforeLatinDigits(file,current);assert.ok(raw!==null);const before=execFileSync('git',['show','0bd3b5b0fd149c9e92d802c6dabb55b236c127cc:'+file],{encoding:'utf8',maxBuffer:1024**2}).replaceAll('\r\n','\n');
 assert.equal(sourceBeforePriceVisibility(file,current),before);
 assert.equal(sourceBeforePriceVisibility(file,current+'\n// unknown byte'),current+'\n// unknown byte');
 assert.equal(sourceBeforePriceVisibility(file,null),null);assert.equal(sourceBeforePriceVisibility('unknown',raw),raw);
 assert.deepEqual(restorePriceVisibilityHashes([{file,sha256:hash(raw)}]),[{file,sha256:hash(before)}]);
 assert.deepEqual(restorePriceVisibilityHashes([{file,sha256:hash(raw+'x')}]),[{file,sha256:hash(raw+'x')}]);
 const pin=JSON.parse(readFileSync('scripts/audit/price-visibility-source-pin.json','utf8'));
 const prior=execFileSync('git',['show','5b5e07bfe259cb04048dc9baef789aeee7a054c2:'+file],{encoding:'utf8',maxBuffer:1024**2}).replaceAll('\r\n','\n');
 assert.equal(pin.hunks.length,3);assert.equal(pin.before,hash(before));assert.equal(pin.after,hash(prior));
 assert.equal(sourceBeforePriceVisibility(file,prior),before);
 assert.equal(pin.files[file].before,hash(before));assert.equal(pin.files[file].after,hash(raw));
});

test('price evidence projection restores exact prior Git bytes;new artifacts are hash-bound and unknown text remains visible',()=>{
 const pin=JSON.parse(readFileSync('scripts/audit/price-visibility-source-pin.json','utf8'));
 assert.equal(pin.baseline,'0bd3b5b0fd149c9e92d802c6dabb55b236c127cc');
 for(const [path,entry] of Object.entries(pin.files) as [string,{before:string|null;after:string;binary?:boolean}][]){
  const bytes=readFileSync(path),current=bytes.toString('utf8'),raw=sourceBeforeLatinDigits(path,current);assert.ok(raw!==null);
  assert.equal(entry.binary?createHash('sha256').update(bytes).digest('hex'):hash(raw),entry.after,path);
  if(entry.binary){assert.equal(entry.before,null);assert.deepEqual(pathsBeforePriceVisibility([path]),[]);continue;}
  let before=null;try{before=execFileSync('git',['show',pin.baseline+':'+path],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:32*1024**2}).replaceAll('\r\n','\n');}catch{assert.equal(entry.before,null,path);}
  assert.equal(sourceBeforePriceVisibility(path,current),before,path);
  assert.equal(sourceBeforePriceVisibility(path,current+'\nUNKNOWN_BYTE'),current+'\nUNKNOWN_BYTE',path);
  if(entry.before===null)assert.deepEqual(pathsBeforePriceVisibility([path]),[]);
 }
});
