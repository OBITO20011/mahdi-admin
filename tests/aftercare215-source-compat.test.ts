import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {aftercare215SourcePins,sourceBeforeAftercare215,restoreAftercare215SourceHashes,pathsBeforeAftercare215} from '../scripts/audit/source-before-aftercare215.mjs';
import {inventory} from '../scripts/audit/table-access-inventory.mjs';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex'),read=(f:string)=>readFileSync(f,'utf8').replaceAll('\r\n','\n');
test('215 historical bridge binds complete actual and original Git bytes;unknown mutations are never erased',()=>{
 assert.equal(aftercare215SourcePins.baseline,'dba6c184ad9901151bbdd8c7a8cf6c40847ba311');
 for(const[file,pin]of Object.entries(aftercare215SourcePins.entries)as[string,{after:string;before:string|null;beforeText:string|null}][]){
  const current=read(file),raw=sourceBeforePartial216(file,current)!;assert.equal(hash(raw),pin.after,file);assert.equal(sourceBeforeAftercare215(file,raw),pin.beforeText,file);
  if(pin.beforeText!==null){assert.equal(hash(pin.beforeText),pin.before,file);assert.equal(pin.beforeText,execFileSync('git',['show',aftercare215SourcePins.baseline+':'+file],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:32*1024**2}).replaceAll('\r\n','\n'),file);}
  const changed=current+'\nvoid unapproved;\n';assert.equal(sourceBeforeAftercare215(file,changed),changed,file);
 }
 assert.equal(sourceBeforeAftercare215('supabase/unapproved.sql','unknown'),'unknown');assert.deepEqual(pathsBeforeAftercare215(['supabase/unapproved.sql']),['supabase/unapproved.sql']);
});
test('215 current SDK inventory remains unprojected;historical source hashes resolve exactly to approved main',async()=>{
 const current=await inventory(),historical=restoreAftercare215SourceHashes(current.sources);
 const saved=JSON.parse(read('docs/operations/TABLE_ACCESS_AFTER_214_TRIAL_INTEGRATED.json'));
 assert.equal(current.migrationCeiling,216);assert.notDeepEqual(current.sources,historical);assert.deepEqual(historical,saved.sourceHashes);
 assert.ok(current.sources.some((s:{file:string})=>s.file==='src/services/supabase/aftercare215.service.ts'));
 assert.ok(!historical.some((s:{file:string})=>s.file==='src/services/supabase/aftercare215.service.ts'));
});

import {sourceBeforePartial216} from '../scripts/audit/source-before-partial216.mjs';
