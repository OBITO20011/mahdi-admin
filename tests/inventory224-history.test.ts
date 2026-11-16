import assert from 'node:assert/strict';import test from 'node:test';
import {readFileSync} from 'node:fs';import {execFileSync}from'node:child_process';
import {sourceBeforeInventory224,restoreInventory224Hashes,pathsBeforeInventory224,inventory224SourcePins,inventory224SourceBase}from'../scripts/audit/source-before-inventory224.mjs';
import {canonicalLf,sha256}from'../scripts/testing/maintenance-db-contract.mjs';
import {sourceBeforeCoreWebkitShards}from'../scripts/audit/source-before-core-webkit-shards.mjs';
test('inventory224 history is literal main bytes; unknown bytes cannot project',()=>{
 const entries=Object.entries(inventory224SourcePins) as [string,{before:string|null;after:string;beforeText:string|null}][];
 for(const[file,pin]of entries){
  const physical=canonicalLf(readFileSync(file,'utf8')),raw=sourceBeforeCoreWebkitShards(file,physical);assert.ok(raw!==null,file);assert.equal(sha256(raw),pin.after,file);
  let original=null;try{original=canonicalLf(execFileSync('git',['show',inventory224SourceBase+':'+file],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:128*1024**2}));}catch{assert.equal(pin.before,null,file);}
  assert.equal(pin.beforeText,original,file);assert.equal(sourceBeforeInventory224(file,raw),original,file);
  const unknown=physical+'\nUNKNOWN_BYTE';assert.equal(sourceBeforeInventory224(file,unknown),unknown,file);
  assert.deepEqual(restoreInventory224Hashes([{file,sha256:pin.after}]),pin.before===null?[]:[{file,sha256:pin.before}],file);
  if(pin.before===null)assert.deepEqual(pathsBeforeInventory224([file]),[]);
 }
 assert.equal(sourceBeforeInventory224('unknown','raw'),'raw');assert.equal(sourceBeforeInventory224('unknown',null),null);
});
