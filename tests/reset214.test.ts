import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {reset214Pins,sourceBeforeReset214} from '../scripts/audit/source-before-reset214.mjs';
import {reset214Arguments} from '../scripts/operations/frankfurt-owner-reset214.mjs';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
test('RESET214 operational inverse preserves exact main bytes and rejects every extra byte',()=>{
 assert.deepEqual(Object.keys(reset214Pins).sort(),['package.json','scripts/testing/run-trial-reset-runtime.mjs']);
 for(const [file,pin] of Object.entries(reset214Pins) as [string,{before:string;after:string;beforeText:string}][]){
  const current=readFileSync(file,'utf8').replaceAll('\r\n','\n');
  assert.equal(hash(current),pin.after,file);assert.equal(hash(pin.beforeText),pin.before,file);
  assert.equal(sourceBeforeReset214(file,current),pin.beforeText,file);
  assert.equal(pin.beforeText,execFileSync('git',['show','fb240a5f0479824beeb38ed85ea09dd4a3aa8972:'+file],{encoding:'utf8',maxBuffer:8*1024**2}).replaceAll('\r\n','\n'),file);
  assert.throws(()=>sourceBeforeReset214(file,current+'\n'),/UNREVIEWED_SOURCE/u,file);
  assert.throws(()=>sourceBeforeReset214(file,pin.beforeText+'\n'),/UNREVIEWED_SOURCE/u,file);
 }
});
test('RESET214 separates offline plan from owner read-only preview; no target override or ambiguous modes',()=>{
 const id='00000000-0000-4000-8000-000000000001';
 assert.equal(reset214Arguments([]).mode,'plan');
 assert.equal(reset214Arguments(['--dry-run','--owner-id',id]).mode,'dry-run');
 for(const args of [['--apply'],['--dry-run'],['--apply','--dry-run','--owner-id',id],['--project-ref','other'],['--reference','local-reference-through209-ready.json'],['--owner-id',"';SELECT 1;--"]])assert.throws(()=>reset214Arguments(args));
});
