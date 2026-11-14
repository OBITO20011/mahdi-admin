import{sourceBeforeIndependentPrices222}from'../scripts/audit/source-before-independent-prices222.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{execFileSync}from'node:child_process';import{sourceBeforeSalesOnlyPhase3,salesOnlyPhase3Pins,restoreSalesOnlyPhase3Hashes,pathsBeforeSalesOnlyPhase3}from'../scripts/audit/source-before-sales-only-phase3.mjs';import{createHash}from'node:crypto';
const hash=(s:string)=>createHash('sha256').update(s.replaceAll('\r\n','\n')).digest('hex');
test('phase3 historical view restores exact Git bfc bytes only;unknown source/hash/SQL remain visible',()=>{
 assert.equal(salesOnlyPhase3Pins.baseline,'bfc669408b3e31e0fc661b06c9779ffedd1c0a9c');
 for(const[file,pin]of Object.entries(salesOnlyPhase3Pins.entries)as[string,{before:string|null;after:string;beforeText:string|null}][]){const actual=readFileSync(file,'utf8');
 // Live checkpoints are mutable authority checked by agent-continuity, not frozen application bytes.
 // Their old round-trip still binds literal Git bd4 and all unknown bytes remain visible.
 const checkpoint=['docs/agent/ACTIVE_TASK.json','docs/agent/ACTIVE_TASK_FILES.json'].includes(file);
 const raw=checkpoint?execFileSync('git',['show','bd4d696af6eef074bfd523ee54906059a0bb668c:'+file],{encoding:'utf8',maxBuffer:64*1024**2}):actual;
 if(checkpoint&&hash(actual)!==pin.after)assert.equal(sourceBeforeSalesOnlyPhase3(file,actual),actual,'LIVE_CHECKPOINT_NOT_A_SOURCE_EXEMPTION');
 assert.equal(hash(sourceBeforeIndependentPrices222(file,raw)!),pin.after,file);let old=null;try{old=execFileSync('git',['show',salesOnlyPhase3Pins.baseline+':'+file],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:64*1024**2}).replaceAll('\r\n','\n');}catch{assert.equal(pin.before,null,file);}assert.equal(sourceBeforeSalesOnlyPhase3(file,raw),old,file);const unknown=raw+'\nUNKNOWN_BYTE';assert.equal(sourceBeforeSalesOnlyPhase3(file,unknown),unknown,file);assert.deepEqual(restoreSalesOnlyPhase3Hashes([{file,sha256:'unknown'}]),[{file,sha256:'unknown'}]);}
 const migration='supabase/migrations/220_sales_only_operating_mode.sql';assert.equal(sourceBeforeSalesOnlyPhase3(migration,readFileSync(migration,'utf8')),null);assert.deepEqual(pathsBeforeSalesOnlyPhase3([migration,'supabase/migrations/221_unknown.sql']),['supabase/migrations/221_unknown.sql']);
});
