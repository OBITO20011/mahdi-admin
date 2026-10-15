import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {persistCatalogComparison,readOnlyPsqlSessionArgs} from '../scripts/operations/frankfurt-catalog-verification.mjs';
import {assertHeldCatalog,heldTrigger} from '../scripts/operations/frankfurt-notification-hold.mjs';
import {run} from '../scripts/operations/frankfurt-owner-build.mjs';

test('all literal/normalized differences survive a failed strict hold assertion with local/remote values',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'nawasrah-verify-detail-'));
 try{
  const local={triggers:[{schema:'public',table:'orders',name:heldTrigger,enabled:'O',definition:'original'}],
   functions:[{schema:'public',identity:'probe()',owner:'postgres',definition:'SELECT 1'}]};
  const remote=structuredClone(local);remote.triggers[0].enabled='D';remote.functions[0].definition='SELECT 2';
  const report={};
  const result=await persistCatalogComparison(dir,local,remote,{beforeBuildDate:'2026-10-15',afterBuildDate:'2026-10-15'},report);
  assert.throws(()=>assertHeldCatalog(local,remote),/HOLD_CATALOG_EXPECTS_EXACTLY_ONE_DELTA/u);
  const saved=JSON.parse(await readFile(path.join(dir,'catalog-differences.json'),'utf8'));
  assert.deepEqual(saved,result);assert.equal(saved.rawDifferences.length,2);assert.equal(saved.differences.length,2);
  const fn=saved.differences.find((d:{type:string})=>d.type==='functions');
  assert.ok(fn);
  assert.ok(fn.local&&fn.remote);
  assert.equal(fn.schema,'public');assert.equal(fn.object,'probe()');assert.equal(fn.expected,false);
  assert.equal(fn.local.definition,'SELECT 1');assert.equal(fn.remote.definition,'SELECT 2');
  assert.equal(saved.differences.filter((d:{expected:boolean})=>d.expected).length,1);
  assert.deepEqual(JSON.parse(await readFile(path.join(dir,'catalog-observed.json'),'utf8')),remote);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('literal evidence survives normalization errors too;no schema is silently dropped',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'nawasrah-verify-normalization-'));
 try{
  await assert.rejects(()=>persistCatalogComparison(dir,{tables:[]},{tables:[{schema:'auth',name:'extra'}]},
   {beforeBuildDate:'invalid',afterBuildDate:'2026-10-15'},{}),/CATALOG_NORMALIZATION_FAILED/u);
  const saved=JSON.parse(await readFile(path.join(dir,'catalog-differences.json'),'utf8'));
  assert.equal(saved.rawDifferences.length,1);assert.equal(saved.rawDifferences[0].schema,'auth');
  assert.equal(saved.normalizationError,'CATALOG_NORMALIZATION_FAILED');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('verify-only flags are exclusive;verification returns before every mutable build stage',async()=>{
 for(const args of [['--verify-only','--apply'],['--verify-only','--apply-139'],['--verify-only','--dry-run'],['--verify-only','--local-reference']])
  await assert.rejects(()=>run(args));
 const source=await readFile('scripts/operations/frankfurt-owner-build.mjs','utf8');
 assert.match(source,/if\(mode==='verify-only'\)\{[\s\S]*?return report;\s*\}\s*if\(mode==='apply-139'\)/u);
 assert.ok(source.indexOf("report.ok=true;return report;")<source.indexOf("stage='empty-target-guard'"));
 assert.match(source,/else if\(mode!=='apply-139'\)\{stage='external-link';await cliCall/u);
 assert.match(source,/mode==='verify-only'\?readOnlyPsqlSessionArgs:\[\]/u);
 assert.deepEqual(readOnlyPsqlSessionArgs,['-c','SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;','-f','-']);
 assert.match(source,/READ_ONLY_SESSION_REQUIRED/u);
 assert.match(source,/mode==='verify-only'\?'last-verify-report.json':mode==='apply-139'\?'last-139-report.json':'last-report.json'/u);
 const worker=await readFile('scripts/operations/frankfurt-catalog-verification.mjs','utf8');
 assert.doesNotMatch(worker,/transitionNotifications\(|cliCall\(|holdBuildGuard\(|ALTER TABLE|cron.alter_job|migration.*repair/u);
 assert.ok(worker.indexOf('await persistCatalogComparison')<worker.indexOf('report.catalogExpectedHold=assertHeldCatalog'));
});
