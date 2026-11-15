import {sourceBeforeInventory224} from '../scripts/audit/source-before-inventory224.mjs';
import assert from 'node:assert/strict';import test from 'node:test';
import {readFileSync} from 'node:fs';import {execFileSync}from'node:child_process';
import {sourceBeforeFinalCatalog,restoreFinalCatalogHashes,pathsBeforeFinalCatalog,finalCatalogSourcePins,finalCatalogSourceBase}from'../scripts/audit/source-before-final-catalog.mjs';
import {canonicalLf,sha256}from'../scripts/testing/maintenance-db-contract.mjs';
test('final catalog history is literal main bytes; unknown bytes cannot project',()=>{
 for(const[file,pin]of Object.entries(finalCatalogSourcePins)){
  const raw=sourceBeforeInventory224(file,canonicalLf(readFileSync(file,'utf8')));assert.ok(raw!==null,file);assert.equal(sha256(raw),pin.after,file);
  let original=null;try{original=canonicalLf(execFileSync('git',['show',finalCatalogSourceBase+':'+file],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:128*1024**2}));}catch{assert.equal(pin.before,null,file);}
  assert.equal(pin.beforeText,original,file);assert.equal(sourceBeforeFinalCatalog(file,raw),original,file);
  const unknown=raw+'\nUNKNOWN_BYTE';assert.equal(sourceBeforeFinalCatalog(file,unknown),unknown,file);
  assert.deepEqual(restoreFinalCatalogHashes([{file,sha256:pin.after}]),pin.before===null?[]:[{file,sha256:pin.before}],file);
  if(pin.before===null)assert.deepEqual(pathsBeforeFinalCatalog([file]),[]);
 }
 assert.equal(sourceBeforeFinalCatalog('unknown','raw'),'raw');assert.equal(sourceBeforeFinalCatalog('unknown',null),null);
});
