import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {trial40IntegrationPins,projectTrial40Source} from '../scripts/audit/source-before-trial40-integration.mjs';

const refs={baseline:'f95ff0458f90298edc21e39859d3268c7f7ccac7',identity:'2471fda5dcef5e0119feb0cc77168822a58b9581',bulk:'5ad57e1ca265390ca589d2924cf29092c98d5cf9'};
const read=(file:string)=>readFileSync(file,'utf8').replaceAll('\r\n','\n');
const git=(args:string[])=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:16*1024**2}).replaceAll('\r\n','\n');
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');

test('integration keeps every approved application byte;identity and bulk production edits are disjoint',()=>{
  const changed=(ref:string)=>git(['diff','--name-only',refs.baseline,ref,'--','src','customer-web/src']).trim().split('\n').filter(Boolean);
  const identity=changed(refs.identity),bulk=changed(refs.bulk);
  assert.deepEqual(identity.filter(file=>bulk.includes(file)),[]);
  const expected=[...identity,...bulk].sort();
  assert.deepEqual(git(['diff','--name-only',refs.baseline,'--','src','customer-web/src']).trim().split('\n').filter(Boolean).sort(),expected);
  for(const file of expected)assert.equal(read(file),git(['show',(identity.includes(file)?refs.identity:refs.bulk)+':'+file]),file);
  assert.equal(git(['diff','--name-only',refs.baseline,'--','supabase','scripts/audit/*-hunks.json','scripts/audit/*-inverse.json']).trim(),'');
  for(const [target,file]of [['identity','store-sharing-identity'],['bulk','bulk-product-images']] as const){
    const path='scripts/audit/'+file+'-source-pins.json';assert.equal(read(path),git(['show',refs[target]+':'+path]));
  }
});

test('exact integration projections equal recorded Git branches;unknown edits are never erased',()=>{
  for(const [file,pin]of Object.entries(trial40IntegrationPins) as [string,{after:string;targets:Record<string,{text:string;sha256:string}|null>}][]){
    const raw=read(file);assert.equal(hash(raw),pin.after,file);
    for(const [target,ref]of Object.entries(refs)){
      const snapshot=pin.targets[target];
      if(snapshot===null){assert.throws(()=>git(['cat-file','-e',ref+':'+file]));assert.equal(projectTrial40Source(file,raw,target),null);}
      else{assert.equal(snapshot.text,git(['show',ref+':'+file]));assert.equal(projectTrial40Source(file,raw,target),snapshot.text);}
      const changed=raw+'\nvoid unapproved;\n';assert.equal(projectTrial40Source(file,changed,target),changed);
    }
  }
  assert.throws(()=>projectTrial40Source('src/App.tsx','anything','unknown'),/TARGET_INVALID/u);
});
