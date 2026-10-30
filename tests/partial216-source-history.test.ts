import {sourceBeforePreflight120} from '../scripts/audit/source-before-preflight120.mjs';
import {sourceBeforeAftercareCleanup} from '../scripts/audit/source-before-aftercare-cleanup.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {partial216SourcePins,sourceBeforePartial216,restorePartial216SourceHashes} from '../scripts/audit/source-before-partial216.mjs';
import {inventory} from '../scripts/audit/table-access-inventory.mjs';import {serviceInventory} from '../scripts/audit/service-access-inventory.mjs';import {futureMigrationViolations} from '../scripts/testing/maintenance-db-contract.mjs';
const baseline='9f94ec8a4be0b23973f1591867fe977bc8689b26';
const lf=(s:string)=>s.replaceAll('\r\n','\n'),hash=(s:string)=>createHash('sha256').update(s).digest('hex');
test('216 exact historical inverse is grounded in approved main bytes; an unknown edit is never erased',()=>{
 assert.equal(partial216SourcePins.baseline,baseline);const paths=Object.keys(partial216SourcePins.entries);
 const existing=new Set(execFileSync('git',['-c','core.quotepath=false','ls-tree','-r','--name-only',baseline,'--',...paths],{encoding:'utf8',maxBuffer:32*1024**2}).trim().split('\n'));
 for(const file of paths){const pin=partial216SourcePins.entries[file],current=sourceBeforeAftercareCleanup(file,sourceBeforePreflight120(file,lf(readFileSync(file,'utf8'))))!;assert.equal(hash(current),pin.after,file);
  const before=existing.has(file)?lf(execFileSync('git',['show',baseline+':'+file],{encoding:'utf8',maxBuffer:32*1024**2})):null;
  assert.equal(pin.beforeText,before,file);assert.equal(sourceBeforePartial216(file,current),before,file);assert.equal(pin.before,before===null?null:hash(before));
  const unknown=current+'\n// unreviewed216 mutation\n';assert.equal(sourceBeforePartial216(file,unknown),unknown,file);
 }
 const oldPins='scripts/audit/aftercare215-source-pins.json';assert.equal(hash(lf(readFileSync(oldPins,'utf8'))),hash(lf(execFileSync('git',['show',baseline+':'+oldPins],{encoding:'utf8',maxBuffer:32*1024**2}))),'215_PROOF_PINS_NEVER_RELEARNED');
});
test('current216 SDK is unprojected and includes the atomic payment RPC; only historical215 sees its original source hashes',async()=>{
 const current=await inventory(),old=await inventory({projectSource:sourceBeforePartial216}),saved=JSON.parse(readFileSync('docs/operations/TABLE_ACCESS_AFTER_215.json','utf8'));
 assert.deepEqual(old.sources,saved.sourceHashes);assert.deepEqual(restorePartial216SourceHashes(current.sources),old.sources);assert.notDeepEqual(current.sources,old.sources);
 const currentRpc=await serviceInventory(),oldRpc=await serviceInventory({projectSource:sourceBeforePartial216});
 assert.deepEqual(currentRpc.functionNames.filter((name:string)=>!oldRpc.functionNames.includes(name)),['claim_owner_telegram_deliveries_v1','complete_owner_telegram_delivery_v1','create_pos_sale_with_initial_payment_v1','owner_telegram_dispatch_lease_valid_v1','release_owner_telegram_dispatch_v1']);
 const bad=current.sources.map((s:{file:string;sha256:string})=>s.file==='src/features/pos/PosView.tsx'?{...s,sha256:'0'.repeat(64)}:s);assert.notDeepEqual(restorePartial216SourceHashes(bad),old.sources);
});
test('216 closes the existing literal closing reader only; the whole-file allowance rejects even an appended mutation',()=>{
 const sql=readFileSync('supabase/migrations/216_pos_partial_payments.sql','utf8');assert.deepEqual(futureMigrationViolations(sql),[]);assert.ok(futureMigrationViolations(sql+'\n-- unreviewed\n').includes('NEW_BEFORE_FUNCTION'));
});
