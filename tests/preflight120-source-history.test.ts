import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {preflight120Pins,sourceBeforePreflight120} from '../scripts/audit/source-before-preflight120.mjs';
const baseline='9070eb9a9e702a0efa5e60c180d760bddf911a9f';
const lf=(s:string)=>s.replaceAll('\r\n','\n'),hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const gitRead=(file:string)=>lf(execFileSync('git',['show',baseline+':'+file],{encoding:'utf8',windowsHide:true,maxBuffer:4*1024**2}));
test('historical preflight view binds only five exact files to actual accepted main bytes;extra edits pass through and fail closed',()=>{
 assert.equal(preflight120Pins.baseline,baseline);
 assert.deepEqual(Object.keys(preflight120Pins.entries).sort(),['scripts/operations/backup-task-preflight.mjs','tests/aftercare-cleanup.test.ts','tests/aftercare215-source-compat.test.ts','tests/partial216-source-history.test.ts','tests/upgrade-preparation216.test.ts']);
 for(const[file,pin]of Object.entries(preflight120Pins.entries)as Array<[string,{before:string,after:string,beforeText:string}]>){
  const current=lf(readFileSync(file,'utf8')),old=gitRead(file);
  assert.equal(hash(current),pin.after,file);assert.equal(pin.beforeText,old,file);assert.equal(hash(old),pin.before,file);
  assert.equal(sourceBeforePreflight120(file,current),old,file);
  const unreviewed=current+'\n// unreviewed preflight mutation\n';assert.equal(sourceBeforePreflight120(file,unreviewed),unreviewed,file);
 }
 assert.equal(sourceBeforePreflight120('unrelated.mjs','untouched'),'untouched');
});
test('original216 and217 evidence pins remain byte-identical;no historical pin is relearned',()=>{
 for(const file of ['scripts/audit/partial216-source-pins.json','scripts/audit/owner-telegram217-source-pins.json'])
  assert.equal(hash(lf(readFileSync(file,'utf8'))),hash(gitRead(file)),file);
});
