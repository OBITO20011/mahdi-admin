import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {sales204Pins,sourceBeforeSales204,inventoryBeforeSales204} from '../scripts/audit/source-before-sales-history204.mjs';
import {verifyProbeCoverage} from '../scripts/audit/table-access-probes.mjs';
import {assert204History} from '../scripts/operations/frankfurt-owner-upgrade204.mjs';
const read=(f:string)=>readFileSync(f,'utf8').replaceAll('\r\n','\n');
test('204 historical projection restores complete accepted203 files before parsing query IDs/arguments/callers',async()=>{
  const historical=await inventoryBeforeSales204(),proof=JSON.parse(read('docs/operations/TABLE_ACCESS_AFTER_203.json'));
  assert.deepEqual(historical.sources,proof.sourceHashes);assert.deepEqual(verifyProbeCoverage(historical,proof.results),proof.coverage);
  for(const [file,p]of Object.entries(sales204Pins) as Array<[string,{added?:boolean;before?:string;after:string}]>){
    const current=read(file),restored=sourceBeforeSales204(file,current);
    assert.throws(()=>sourceBeforeSales204(file,current+'\n// unrelated change\n'),/(?:SALES204|NAVIGATION206|CORRECTIONS207)_ENTIRE_CURRENT_FILE_CHANGED/u);
    if(p.added)assert.equal(restored,null);else assert.equal(createHash('sha256').update(restored!).digest('hex'),p.before);
  }
});
test('204 upgrade accepts complete199..204 prefixes only;200 security and all intervening versions stay required',()=>{
 const manifest=JSON.parse(read('docs/operations/TABLE_ACCESS_AFTER_203.json')).manifest as string[],base=manifest.filter(f=>Number(f.slice(0,3))<=199).map(f=>f.slice(0,3)),versions=[...base,'200','201','202','203','204'],reference={prefixes:{'199':{appliedVersions:base}},appliedVersions:versions};
 for(let n=161;n<=166;n++)assert.deepEqual(assert204History(versions.slice(0,n),reference),versions.slice(n));
 for(const invalid of [base.slice(1),[...base,'201'],[...base,'200','201','202','204'],[...versions,'205'],[...base,'152']])assert.throws(()=>assert204History(invalid,reference));
});
test('204 freezes203 definitions,retains historical reset strictness and pins its own new migration',()=>{
 const state=JSON.parse(read('docs/agent/project-state.json'));assert.equal(state.migrationCeiling,212);
 assert.equal(state.migration204CanonicalLfSha256,createHash('sha256').update(read('supabase/migrations/204_sales_history_read_model.sql')).digest('hex').toUpperCase());
 assert.match(read('scripts/operations/frankfurt-owner-build.mjs'),/f944d6efa506070206553723e6754672c17a95139d6c135c80f6bbd2197833a5/u);
 assert.match(read('scripts/testing/historical-reset-source.mjs'),/203:165/u);
 assert.match(read('scripts/testing/run-sales-history204-gates.mjs'),/--current204/u);
});
