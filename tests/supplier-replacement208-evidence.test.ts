import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {inventoryBeforePretrialP1 as inventory} from '../scripts/audit/source-before-pretrial-p1.mjs';
import {serviceInventory} from '../scripts/audit/service-access-inventory.mjs';
import {verifyProbeCoverage} from '../scripts/audit/table-access-probes.mjs';
import {assertReady208Catalog} from '../scripts/operations/frankfurt-reference208.mjs';
import {assert208History} from '../scripts/operations/frankfurt-owner-upgrade208.mjs';
import {migrationManifest,futureMigrationViolations} from '../scripts/testing/maintenance-db-contract.mjs';
import {supplier208Pins,sourceBeforeSupplierReplacement208} from '../scripts/audit/source-before-supplier-replacement208.mjs';
const read=(f:string)=>readFileSync(f,'utf8'),json=(f:string)=>JSON.parse(read(f));

test('208 immutable SDK evidence binds every accepted208 source restored before P1 and all142 real probes',async()=>{
 const current=await inventory(),proof=json('docs/operations/TABLE_ACCESS_AFTER_208.json'),state=json('docs/agent/project-state.json');
 assert.equal(state.currentTableReadinessEvidence,'docs/operations/TABLE_ACCESS_AFTER_215.json');assert.equal(state.migrationCeiling,215);
 assert.equal(proof.migrationCeiling,208);assert.equal(proof.managedAccess,false);assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);
 assert.deepEqual(proof.sourceHashes,current.sources);assert.deepEqual(verifyProbeCoverage(current,proof.results),proof.coverage);assert.equal(proof.results.length,142);assert.ok(proof.results.every((r:{sqlstate:string|null})=>r.sqlstate===null));assertReady208Catalog(proof.catalog);
});

test('208 all current RPC dispatches bind source;only exact new supplier reader denies admin/cashier',async()=>{
 const current=await serviceInventory(),proof=json('docs/operations/SERVICE_ACCESS_DIAGNOSTIC.json');assert.equal(proof.ok,true);assert.equal(proof.migrationCeiling,215);assert.equal(proof.managedAccess,false);assert.deepEqual(proof.sourceHashes,current.sourceHashes);
 const denied=proof.results.filter((r:{sqlstate:string|null})=>r.sqlstate==='42501');assert.deepEqual(denied.map((r:{name:string;appRole:string})=>[r.name,r.appRole]).sort(),['get_supplier_replacements_page_v1','execute_aftercare_supplier_v1','preview_aftercare_supplier_v1','get_aftercare_damage_candidates_v1','get_damage_history_page_v1','get_damage_ledger_page_v2','preview_supplier_replacement_credit_v1','get_supplier_replacement_credits_v1','settle_supplier_replacement_credit_v1'].flatMap(name=>['admin','cashier'].map(role=>[name,role])).sort());
 assert.ok(denied.every((r:{site:string;name:string})=>r.site.startsWith(r.name==='get_damage_history_page_v1'?'src/services/supabase/damageHistory.service.ts:':r.name==='get_damage_ledger_page_v2'?'src/services/supabase/damageLedger215.service.ts:':['preview_supplier_replacement_credit_v1','get_supplier_replacement_credits_v1'].includes(r.name)?'src/services/supabase/supplierCredit215.service.ts:':'src/services/supabase/supplierReplacement.service.ts:')));
 for(const name of ['execute_supplier_replacement_v1','preview_supplier_replacement_v1','get_supplier_replacements_page_v1','get_supplier_replacement_options_v1'])assert.ok(current.functionNames.includes(name));
});

test('208 owner admission accepts complete199..208 prefixes and rejects gaps,duplicates,future history',async()=>{
 const history=(await migrationManifest(process.cwd())).filter((m:{name:string})=>Number(m.name.slice(0,3))<=208).map((m:{name:string})=>m.name.slice(0,3));assert.equal(history.length,170);const reference={appliedVersions:history,prefixes:{199:{appliedVersions:history.slice(0,161)}}};
 for(let n=161;n<=170;n++)assert.deepEqual(assert208History(history.slice(0,n),reference),history.slice(n));
 for(const changed of [history.slice(1),[...history,'209'],[...history.slice(0,164),...history.slice(165)],history.map((v:string,i:number)=>i===168?'206':v)])assert.throws(()=>assert208History(changed,reference));
});

test('208 source inverse exactly restores delivered C8 main;every candidate byte is protected',()=>{
 for(const [file,pin]of Object.entries(supplier208Pins) as [string,{added?:boolean}][]){const source=read(file);const restored=sourceBeforeSupplierReplacement208(file,source);if(pin.added)assert.equal(restored,null);else assert.equal(restored,execFileSync('git',['show',`7e325a00bbeea7711ae1f2e650848fe61ec99f93:${file}`],{encoding:'utf8',maxBuffer:16*1024**2}).replaceAll('\r\n','\n'));assert.throws(()=>sourceBeforeSupplierReplacement208(file,source+'\nvoid 209;\n'));}
});

test('208 grants are explicit and strict gate includes real writers,read scale,full restore,upgrade/reset',()=>{
 const sql=read('supabase/migrations/208_supplier_replacement_and_damage.sql');assert.deepEqual(futureMigrationViolations(sql),[]);assert.doesNotMatch(sql,/EXECUTE format\('ALTER FUNCTION/u);
 const runtime=read('scripts/testing/run-supplier-replacement208-runtime.mjs');for(const text of ['supplier208Restore','realWriterCases:200','PARENT_BUSY_RETRY','assertPackageDDbLint'])assert.ok(runtime.includes(text));
 const gates=read('scripts/testing/run-supplier-replacement208-gates.mjs');assert.doesNotMatch(gates,/--scale-restore-only/u,'CI always executes every208 case');for(const text of ['run-supplier-replacement208-runtime.mjs','build-acl-reference208.mjs','run-supplier-replacement-upgrade208-runtime.mjs','--current208'])assert.ok(gates.includes(text));
 assert.match(read('.github/workflows/quality.yml'),/Supplier replacement208 contracts/u);
});
