import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {adminUnitTestBatches,runAdminUnitTests} from '../scripts/testing/run-admin-unit-tests.mjs';

test('actual unit files form two disjoint batches with complete coverage and Git63 alone first',async()=>{
 const names=await readdir('tests'),expected=names.filter(name=>name.endsWith('.test.ts')).sort().map(name=>'tests/'+name);
 const batches=adminUnitTestBatches(names);
 assert.deepEqual(batches[0],['tests/product-workbook-history.test.ts']);
 assert.deepEqual(batches.flat().sort(),expected);
 assert.equal(new Set(batches.flat()).size,expected.length);
 assert.deepEqual(adminUnitTestBatches(['product-workbook-history.test.ts']),[['tests/product-workbook-history.test.ts']]);
 const pkg=JSON.parse(await readFile('package.json','utf8'));
 assert.equal(pkg.scripts.test,'node scripts/testing/run-admin-unit-tests.mjs');
});

test('second batch starts only after the historical batch completes; no flags skip or retry cases',async()=>{
 const names=['b.test.ts','product-workbook-history.test.ts','a.test.ts','README.md'];
 const calls:string[][]=[];let release:()=>void=()=>{};
 const first=new Promise<void>(resolve=>{release=resolve;});
 const running=runAdminUnitTests({names,run:async(files:string[])=>{calls.push(files);if(calls.length===1)await first;return{status:0};}});
 await Promise.resolve();
 assert.deepEqual(calls,[['tests/product-workbook-history.test.ts']]);
 release();assert.equal(await running,0);
 assert.deepEqual(calls,[['tests/product-workbook-history.test.ts'],['tests/a.test.ts','tests/b.test.ts']]);
});

test('a failed or killed proof fails closed without rerun; invalid collections are rejected',async()=>{
 const names=['product-workbook-history.test.ts','a.test.ts'];let calls=0;
 assert.equal(await runAdminUnitTests({names,run:()=>{calls++;return{status:7};}}),7);assert.equal(calls,1);
 await assert.rejects(()=>runAdminUnitTests({names,run:()=>({status:null,signal:'SIGTERM'})}),/UNIT_TEST_PROCESS_SIGNAL/u);
 await assert.rejects(()=>runAdminUnitTests({names,run:()=>({error:Error('spawn failed')})}),/spawn failed/u);
 assert.throws(()=>adminUnitTestBatches(['a.test.ts']),/UNIT_HISTORY_TEST_MISSING/u);
 assert.throws(()=>adminUnitTestBatches([...names,'a.test.ts']),/UNIT_TEST_FILE_DUPLICATE/u);
 assert.throws(()=>adminUnitTestBatches([...names,'../other.test.ts']),/UNIT_TEST_PATH_INVALID/u);
});
