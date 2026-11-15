import test from 'node:test';import assert from 'node:assert/strict';
import {sourceBeforeFinalCatalog} from '../scripts/audit/source-before-final-catalog.mjs';
import {readFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';
import {sourceBeforeLatinDigits,restoreLatinDigitsHashes,pathsBeforeLatinDigits,latinDigitsSourcePins,latinDigitsSourceBase} from '../scripts/audit/source-before-latin-digits.mjs';
import {sha256,canonicalLf} from '../scripts/testing/maintenance-db-contract.mjs';

test('Latin display history binds exact merged main bytes and rejects every unknown source byte',()=>{
 for(const [file,pin] of Object.entries(latinDigitsSourcePins) as [string,{before:string|null;after:string;beforeText:string|null;binary?:boolean}][]){
  const bytes=readFileSync(file),raw=sourceBeforeFinalCatalog(file,canonicalLf(bytes.toString('utf8')));assert.ok(raw!==null);
  assert.equal(sha256(pin.binary?bytes:raw),pin.after,file);
  if(pin.binary){assert.equal(pin.before,null);assert.deepEqual(pathsBeforeLatinDigits([file]),[]);continue;}
  let original=null;try{original=canonicalLf(execFileSync('git',['show',latinDigitsSourceBase+':'+file],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:128*1024**2}));}catch{assert.equal(pin.before,null,file);}
  assert.equal(pin.beforeText,original,file);assert.equal(sourceBeforeLatinDigits(file,raw),original,file);
  const unknown=raw+'\nUNKNOWN_BYTE';assert.equal(sourceBeforeLatinDigits(file,unknown),unknown,file);
  assert.deepEqual(restoreLatinDigitsHashes([{file,sha256:pin.after}]),pin.before===null?[]:[{file,sha256:pin.before}],file);
  if(pin.before===null)assert.deepEqual(pathsBeforeLatinDigits([file]),[]);
 }
 assert.equal(sourceBeforeLatinDigits('unknown','raw'),'raw');assert.equal(sourceBeforeLatinDigits('unknown',null),null);
});
