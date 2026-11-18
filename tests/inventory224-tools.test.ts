import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {test} from 'node:test';
import {assert224SourceRowsPreserved} from '../scripts/operations/upgrade224-data.mjs';
import {assert224History} from '../scripts/operations/frankfurt-owner-upgrade224.mjs';
import {sourceBeforeOnPrices225} from '../scripts/audit/source-before-on-prices225.mjs';
import {canonicalLf,sha256} from '../scripts/testing/maintenance-db-contract.mjs';
import {sourceBeforeSupportedUpgrades224} from '../scripts/audit/source-before-supported-upgrades224.mjs';
const read=(file:string)=>canonicalLf(readFileSync(file,'utf8'));

test('224 adapters are exact generated copies of committed223 templates, retaining literal hashes',()=>{
 const pins=JSON.parse(read('docs/design/inventory224/tool223-source-pins.json')) as Record<string,string>;
 for(const[file,digest]of Object.entries(pins)){
  const original=sourceBeforeSupportedUpgrades224('scripts/operations/'+file,read('scripts/operations/'+file));
  assert.ok(original!==null);
  assert.equal(sha256(original),digest);
  const generated=read('scripts/operations/'+file.replaceAll('223','224'));
  for(const hash of original.match(/\b[a-f0-9]{64}\b/gu)??[])assert.ok(generated.includes(hash),file+': hash is immutable');
 }
 execFileSync(process.execPath,['scripts/testing/build-inventory224-tools.mjs','--check']);
});

test('224 upgrade admits exactly183→184 without221, preserves every existing counter/event/request',()=>{
 const file='docs/agent/project-state.json',prior=sourceBeforeOnPrices225(file,read(file));
 assert.ok(prior!==null);const state=JSON.parse(prior);
 assert.equal(state.migrationCeiling,224);
 const names=readFileSync('docs/generated/DB_FUNCTIONS.md','utf8');assert.ok(names.includes('lite3_counters224'));
 const versions=readFileSync('supabase/migrations/224_optional_quantity_inventory_reader.sql','utf8');assert.ok(!versions.includes('CREATE TABLE'));
 const base=Array.from({length:183},(_v,i)=>String(i));
 const reference={prefixes:{223:{appliedVersions:base}},appliedVersions:[...base,'224']};
 assert.deepEqual(assert224History(base,reference),['224']);
 assert.deepEqual(assert224History(reference.appliedVersions,reference),[]);
 assert.throws(()=>assert224History([...base.slice(0,-1),'221'],reference));
 const before={tables:{'sales_lite3.quantity_counters':{rows:2,hash:'literal-counter'},'sales_lite3.quantity_events':{rows:3,hash:'literal-events'},'sales_lite3.quantity_requests':{rows:4,hash:'literal-requests'},'supabase_migrations.schema_migrations':{rows:183}}};
 const after=structuredClone(before);after.tables['supabase_migrations.schema_migrations'].rows=184;
 assert224SourceRowsPreserved(before,after);
 for(const key of ['sales_lite3.quantity_counters','sales_lite3.quantity_events','sales_lite3.quantity_requests']){
  const changed=structuredClone(after);changed.tables[key as keyof typeof changed.tables]={rows:0,hash:'lost'} as never;
  assert.throws(()=>assert224SourceRowsPreserved(before,changed),/EXISTING_APPLICATION_ROWS_CHANGED/);
 }
});

test('224 D1 composes every223 CI requirement and refuses partial reset/ACL preservation policies',()=>{
 const ci=read('scripts/operations/d1-reference224-ci.mjs');
 assert.ok(ci.includes("from './d1-reference223-ci.mjs'"));
 assert.ok(ci.includes('Inventory224 reader and full-mode preservation'));
 const reset=read('scripts/operations/function-reference224.mjs');
 for(const required of ['matchesReference||hasFrankfurt220TriggerAcl(preserved)','isDeepStrictEqual(row.acl,preserved.acl)','frozen220TriggerAclProfile(restoredFunctions),frozen220TriggerAclProfile(preservedFunctions)','functions.length,688'])assert.ok(reset.includes(required));
 const session=read('scripts/operations/reset224-session.mjs');
 for(const ceiling of [214,215,216,217,219,220,222,223,224])assert.ok(session.includes('RESET'+ceiling+'_IN_PROGRESS.json'));
 const kit=read('scripts/operations/d1-reference224-kit.mjs');
 assert.ok(kit.includes('ref.manifest.length===184&&ref.functions===688'));
 assert.ok(kit.includes('testCandidateOnly'));
});

test('the cutover instructions install the ready224 reference before the upgrade dry run',()=>{
 const guide=read('docs/operations/UPGRADE224_AR.md');
 const installed=guide.indexOf('واعتمده وثبّته في مجلّد العمل نفسه قبل فحص الترقية');
 const dryRun=guide.indexOf('frankfurt-owner-upgrade224.mjs --dry-run');
 assert.ok(installed>=0&&dryRun>installed);
 assert.match(read('docs/handover/ورقة-يوم-التشغيل.html'),
  /اعتماد وتثبيت مرجع224 ← Backup223\/Restore ← dry-run224 ثم apply224/u);
});
