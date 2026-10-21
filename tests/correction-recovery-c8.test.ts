import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {sourceBeforeCorrectionRecoveryC8,correctionRecoveryC8Pins,inventoryBeforeCorrectionRecoveryC8} from '../scripts/audit/source-before-correction-recovery-c8.mjs';
import {inventoryBeforeSupplierReplacement208 as inventory} from '../scripts/audit/source-before-supplier-replacement208.mjs';
import {verifyProbeCoverage} from '../scripts/audit/table-access-probes.mjs';
import {assertReady207Catalog} from '../scripts/operations/frankfurt-reference207.mjs';

test('C8 restores delivered207 exact source and query coverage without replacing any historical pin',async()=>{
 const old=JSON.parse(readFileSync('docs/operations/TABLE_ACCESS_AFTER_207.json','utf8'));
 const historical=await inventoryBeforeCorrectionRecoveryC8();
 assert.deepEqual(historical.sources,old.sourceHashes);
 assert.deepEqual(verifyProbeCoverage(historical,old.results),old.coverage);
 for(const file of ['scripts/audit/document-corrections207-hunks.json','docs/operations/TABLE_ACCESS_AFTER_207.json']){
  assert.equal(readFileSync(file,'utf8').replaceAll('\r\n','\n'),execFileSync('git',['show',`badea0458967eacaefc09aa0cae0ea4ffefe32d0:${file}`],{encoding:'utf8',maxBuffer:32*1024**2}).replaceAll('\r\n','\n'));
 }
 for(const file of Object.keys(correctionRecoveryC8Pins)){
  const current=readFileSync(file,'utf8');
  assert.throws(()=>sourceBeforeCorrectionRecoveryC8(file,current+'\nvoid 208;\n'),/CORRECTIONS207_ENTIRE_CURRENT_FILE_CHANGED:C8_RECOVERY/u);
 }
});

test('C8 current real SDK evidence binds the repaired source and complete142 query probes',async()=>{
 const evidence=JSON.parse(readFileSync('docs/operations/TABLE_ACCESS_AFTER_C8_RECOVERY.json','utf8'));
 const current=await inventory();assert.equal(evidence.managedAccess,false);assert.equal(evidence.migrationCeiling,207);
 assert.equal(evidence.infrastructureOk,true);assert.equal(evidence.applicationReady,true);
 assert.deepEqual(evidence.sourceHashes,current.sources);
 assert.deepEqual(verifyProbeCoverage(current,evidence.results),evidence.coverage);
 assert.equal(evidence.results.length,142);assert.ok(evidence.results.every((r:{sqlstate:string|null})=>r.sqlstate===null));
 assertReady207Catalog(evidence.catalog);
});
