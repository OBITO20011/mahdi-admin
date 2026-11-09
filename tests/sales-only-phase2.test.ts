import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {bridges,sha256} from '../scripts/testing/sales-only-phase1-bridges.mjs';
import {sourceBeforeSalesOnlyPhase2,salesOnlyPhase2Pins} from '../scripts/audit/source-before-sales-only-phase2.mjs';

const root=new URL('../',import.meta.url),read=(file:string)=>readFileSync(new URL(file,root),'utf8').replaceAll('\r\n','\n');
test('only owner-approved monitoring bridge diff changes;other7 byte-identical to85',()=>{
 const pins=JSON.parse(read('docs/design/sales-only-phase2/approved-bridge-pins.json'));
 const split=(s:string)=>Object.fromEntries(s.split('--- DB219/').slice(1).map(x=>[x.split('\n')[0],'--- DB219/'+x]));
 const before=split(execFileSync('git',['show',pins.baseline+':docs/design/sales-only-phase1/bridges.patch'],{cwd:root,encoding:'utf8'}));
 const after=split(read('docs/design/sales-only-phase1/bridges.patch'));
 assert.equal(Object.keys(after).length,8);
 for(const name of Object.keys(after)){
  assert.equal(sha256(before[name]),pins.bridges[name].beforeSha256);
  assert.equal(sha256(after[name]),pins.bridges[name].approvedSha256);
  if(name!=='run_advanced_monitoring_checks')assert.equal(after[name],before[name]);
 }
 const h=bridges.find(b=>b.name==='run_advanced_monitoring_checks')!.hunks[0];
 assert.equal(h.to,h.from.replace('\n      AND NOT EXISTS (','\n      AND NOT sales_lite1.is_order(o.id)\n      AND NOT EXISTS ('));
 assert.equal(h.count??1,1);
 assert.equal(execFileSync('git',['diff',pins.baseline,'--','supabase/migrations','docs/design/sales-only-phase1/frozen-functions.json'],{cwd:root,encoding:'utf8'}),'');
});
test('phase2 metadata inverse is exact;unknown bytes remain visible;runtime state isphase2',()=>{
 assert.deepEqual(Object.keys(salesOnlyPhase2Pins.entries).sort(),['docs/agent/PHASE_STATUS.md','docs/agent/project-state.json']);
 for(const file of Object.keys(salesOnlyPhase2Pins.entries)){
  const current=read(file),old=execFileSync('git',['show',salesOnlyPhase2Pins.baseline+':'+file],{cwd:root,encoding:'utf8'}).replaceAll('\r\n','\n');
  assert.equal(sourceBeforeSalesOnlyPhase2(file,current),old);
  assert.equal(sourceBeforeSalesOnlyPhase2(file,current+'UNKNOWN'),current+'UNKNOWN');
 }
 const state=JSON.parse(read('docs/agent/project-state.json'));assert.equal(state.currentPhase,'SALES_ONLY_PHASE2');assert.equal(state.migrationCeiling,219);assert.equal(state.phaseSALES_ONLY_PHASE2ImplementationAllowed,true);
});
