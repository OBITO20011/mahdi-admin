import {sourceBefore198Presentation} from '../scripts/audit/source-before198-presentation.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {assert164History,allUpgrade164Versions,inputs164} from '../scripts/operations/frankfurt-owner-upgrade164.mjs';
import {assertStartupTableAcl,assertReference164,startupTables} from '../scripts/operations/frankfurt-reference164.mjs';
import {inventory} from '../scripts/audit/table-access-inventory.mjs';
import {verifyHistoricalWarehouseCoverage as verifyProbeCoverage} from '../scripts/audit/historical-warehouse-query-sites.mjs';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
test('164 accepts ONLY001-138 followed by the exact approved ordered prefix;no backfill or duplicate',()=>{
 const base=Array.from({length:138},(_,i)=>String(i+1).padStart(3,'0'));
 for(let n=0;n<=allUpgrade164Versions.length;n++)assert.deepEqual(assert164History([...base,...allUpgrade164Versions.slice(0,n)]),allUpgrade164Versions.slice(n));
 for(const h of [[...base,'160'],[...base,'139','150','151','152'],[...base,...allUpgrade164Versions,'165'],[...base,'139','139']])assert.throws(()=>assert164History(h));
});
test('startup RPC-only admission rejects ANY client/PUBLIC table or column grant and disabled RLS',()=>{
 const catalog={tables:startupTables.map(name=>({schema:'public',name,owner:'postgres',rls:true,acl:['postgres=arwdDxtm/postgres'],columns:[{name:'id',acl:[] as string[]}]}))};
 assert.doesNotThrow(()=>assertStartupTableAcl(catalog));
 for(const grant of ['anon=r/postgres','authenticated=r/postgres','authenticated=D/postgres','=r/postgres']){
  const changed=structuredClone(catalog);changed.tables[0]!.acl.push(grant);assert.throws(()=>assertStartupTableAcl(changed));
  const column=structuredClone(catalog);column.tables[0]!.columns[0]!.acl.push(grant);assert.throws(()=>assertStartupTableAcl(column));
 }
 const changed=structuredClone(catalog);changed.tables[0]!.rls=false;assert.throws(()=>assertStartupTableAcl(changed));
});
test('current164 real access evidence is complete and error-free,not a renamed historical audit',async()=>{
 const source=await inventory(),proof=JSON.parse(await readFile('docs/operations/TABLE_ACCESS_AFTER_164.json','utf8'));
 assert.equal(source.migrationCeiling,214);assert.equal(proof.migrationCeiling,164);assert.equal(proof.managedAccess,false);
 assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);assert.deepEqual(proof.sourceHashes,await sourceBefore198Presentation(source.sources));
 assert.deepEqual(verifyProbeCoverage(source,proof.results),proof.coverage);assert.ok(proof.results.every((r:{sqlstate:string|null})=>r.sqlstate===null));
 assert.deepEqual(proof.manifest.slice(-5).map((n:string)=>n.slice(0,3)),['160','161','162','163','164']);
});
test('owner164 preparation rejects old reference BEFORE any host/password and rejects missing migration pins',async()=>{
 assert.throws(()=>assertReference164({format:4,migrationCeiling:151},[],null,null,null),/READY164_REFERENCE_REQUIRED/u);
 await assert.rejects(()=>inputs164({manifest:[]}),/UPGRADE_MANIFEST_MISSING/u);
 const source=await readFile('scripts/operations/frankfurt-owner-upgrade164.mjs','utf8');
 assert.match(source,/generateAclPlan\(prefix.catalog,before\)/u);assert.match(source,/repair\(unit.version\)/u);
 assert.doesNotMatch(source,/--include-all|functions','deploy|vault\.create_secret|\['link'/u);
 const workflow=await readFile('.github/workflows/quality.yml','utf8');
 assert.match(workflow,/run-go-live-integration164-runtime.mjs/u);assert.match(workflow,/run-frankfurt-upgrade164-runtime.mjs/u);
 const preview=await readFile('scripts/operations/frankfurt-align-acl.mjs','utf8');
 assert.match(preview,/if\(!historical151\)return[\s\S]*?frankfurt-owner-upgrade182/u);
 assert.ok(source.indexOf("'catalog-comparison-before.json'")<source.indexOf('const plan=offline164Plan(reference,observed)'));
});

test('public ACL preview CLI completes module evaluation and fails closed on missing offline input,not a cyclic await',async()=>{
 const output=await mkdtemp(path.join(tmpdir(),'nw-acl-cli164-'));
 const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 try{
  const result=spawnSync(process.execPath,['scripts/operations/frankfurt-align-acl.mjs','--dry-run','--workdir',output],{encoding:'utf8',windowsHide:true});
  assert.equal(result.error,undefined);assert.equal(result.status,1);
  assert.match(result.stderr,/ACL_PREPARATION_FAILED/u);
  assert.doesNotMatch(result.stderr,/unsettled top-level await/u);
  assert.equal(result.stdout,'');
  assert.equal(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),head);
 }finally{await rm(output,{recursive:true,force:true});}
});
