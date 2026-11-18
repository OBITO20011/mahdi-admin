import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {legacy224HeldDdlFixture} from '../scripts/testing/legacy224-owner-tools.mjs';

const hold=' await hold217Notifications(executor,await readNotificationSnapshot(executor));';

test('225 DDL no-write proof starts only after the fixture monitoring hold',()=>{
 const source=readFileSync('scripts/testing/run-reset225-runtime.mjs','utf8');
 const proof=' report.ddlCapability=await proveReset225DdlCapability(local,output);';
 assert.equal(source.split(hold).length,2);
 assert.ok(source.indexOf(hold)<source.indexOf(proof));
 const capability=readFileSync('scripts/testing/reset225-ddl-capability-proof.mjs','utf8');
 for(const invariant of ['DDL_PROOF_DENIAL_CHANGED_SOURCE','DDL_PROOF_POSITIVE_CHANGED_SOURCE','DDL_PROOF_POSITIVE_POLICY_CREATE_DROP']) assert.ok(capability.includes(invariant),invariant);
});

test('224 compatibility moves only the exact historical fixture hold and rejects unknown bytes',()=>{
 const original=execFileSync('git',['show','78f47ccdd7698cf95ee69dc1ae05ba2fd53da301:scripts/testing/run-reset224-runtime.mjs'],{encoding:'utf8',windowsHide:true});
 const result=legacy224HeldDdlFixture(original);
 const proof=' report.ddlCapability=await proveReset224DdlCapability(local,output);';
 assert.equal(result.split(hold).length,2);
 assert.ok(result.indexOf(hold)<result.indexOf(proof));
 const sqlLine=original.split('\n').find(line=>line.startsWith(' const sql=async(text,ex=executor)=>'))!;
 assert.equal(result.replace(hold+'\n','').replace(sqlLine,sqlLine+'\n'+hold),original);
 assert.throws(()=>legacy224HeldDdlFixture(original+'\nUNKNOWN_BYTE'),/LEGACY224_DDL_FIXTURE_SOURCE_CHANGED/u);
 assert.throws(()=>legacy224HeldDdlFixture(result),/LEGACY224_DDL_FIXTURE_SOURCE_CHANGED/u);
 const dispatcher=readFileSync('scripts/testing/run-reset224-runtime.mjs','utf8');
 assert.ok(dispatcher.includes("await writeFile(runner,legacy224HeldDdlFixture(await readFile(runner,'utf8')))"));
});
