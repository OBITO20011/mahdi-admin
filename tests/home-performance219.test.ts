import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {originalHomeFactsDefinition,narrowHome219Definition,home219Projection} from '../scripts/testing/home-projection219.mjs';
import {futureMigrationViolations,canonicalLf} from '../scripts/testing/maintenance-db-contract.mjs';
import {measureHome219,assertHome219SamplesRejected,finishHome219Report} from '../scripts/testing/home-performance219-benchmark.mjs';
import {assert219History,run219} from '../scripts/operations/frankfurt-owner-upgrade219.mjs';
import {assertReady219Catalog,home219Body} from '../scripts/operations/frankfurt-reference219.mjs';
const root=new URL('../',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u,'$1');
const read=(name:string)=>readFile(new URL('../'+name,import.meta.url),'utf8');
test('219 literally changes only one existing private facts projection,no grant/equation/filter/backfill',async()=>{
  const original=await originalHomeFactsDefinition(decodeURIComponent(root),203,{privateName:true});
  const sql=canonicalLf(await read('supabase/migrations/219_home_financial_facts_narrow_projection.sql'));
  const start=sql.indexOf('CREATE OR REPLACE FUNCTION'),end=sql.lastIndexOf('\nCOMMIT;');
  assert.equal(sql.slice(start,end).trim(),narrowHome219Definition(original).trim());
  assert.equal(sql.split('CREATE OR REPLACE FUNCTION').length,2);
  assert.doesNotMatch(sql,/^\s*(?:GRANT|REVOKE|INSERT|UPDATE|DELETE|ALTER TABLE|CREATE INDEX|DROP|DO \$)/mu);
  assert.deepEqual(futureMigrationViolations(sql),[]);
  assert.ok(futureMigrationViolations(sql+'\n-- unreviewed\n').includes('NEW_BEFORE_FUNCTION'));
  for(const version of [195,197,201,202,203]){
    const body=await originalHomeFactsDefinition(decodeURIComponent(root),version);
    const narrowed=narrowHome219Definition(body);
    assert.equal(narrowed.replace(home219Projection,'SELECT o.*, fc.at AS completion_at'),body);
  }
});
test('benchmark preserves20samples/3warmups and original server metric plus wall time;slow round cannot hide behind median',async()=>{
  let calls=0;
  const json=async()=>{calls++;return [{'Execution Time':calls<=23?100:3100}];};
  const proof=await measureHome219({name:'synthetic',query:'SELECT fixture',json,rounds:5});
  assert.equal(calls,5*23);assert.equal(proof.rounds.length,5);
  assert.equal(proof.rounds[0].p95,100);assert.equal(proof.medianP95,3100);
  assert.equal(proof.withinLimit,false);assertHome219SamplesRejected(proof);
  assert.ok(proof.rounds.every(r=>r.serverSamples.length===20&&r.wallSamples.length===20));
  await assert.rejects(()=>measureHome219({name:'reject',query:'fixture',json:async()=>[{'Execution Time':3100}],assertLimit:true}),/HOME219_P95/u);
  await assert.rejects(()=>measureHome219({name:'threshold',query:'fixture',json,limitMs:4000}),/ORIGINAL_3_SECOND/u);
  let singleSlow=0;
  const lone=await measureHome219({name:'one-slow-round',query:'fixture',rounds:5,json:async()=>[{'Execution Time':++singleSlow<=23?3100:100}]});
  assert.equal(lone.medianP95,100);assert.equal(lone.withinLimit,false);assertHome219SamplesRejected(lone);
});

test('cleanup failure preserves every measured value and original rejection in both reports and remains a failure',async()=>{
  const output=await mkdtemp(path.join(tmpdir(),'nawasrah-home-report-unit-'));
  const report={ok:false,error:'FULL219_HOME_P95_EXCEEDS_EXISTING_3_SECOND_GATE',originalTimings:[{p95:4100}],optimizedTimings:[{p95:3200}]};
  const secret='SYNTHETIC_PRIVATE_CLEANUP_DETAIL';
  try{
    const ok=await finishHome219Report({report,output,stop:async()=>{throw new Error(secret);}});
    assert.equal(ok,false);
    for(const file of ['performance-report.json','report.json']){
      const text=await readFile(path.join(output,file),'utf8'),saved=JSON.parse(text);
      assert.ok(!text.includes(secret));assert.equal(saved.ok,false);
      assert.equal(saved.cleanupError,'LOCAL_TEST_DATABASE_STOP_FAILED');assert.equal(saved.error,report.error);
      assert.deepEqual(saved.originalTimings,report.originalTimings);assert.deepEqual(saved.optimizedTimings,report.optimizedTimings);
    }
  }finally{await rm(output,{recursive:true,force:true});}
});
test('219 admits exact217 or219 history only and never backfills218 or skips a prefix',()=>{
  const base=Array.from({length:179},(_,i)=>String(i));
  const ref={prefixes:{217:{appliedVersions:base}},appliedVersions:[...base,'219']};
  assert.deepEqual(assert219History(base,ref),['219']);assert.deepEqual(assert219History(ref.appliedVersions,ref),[]);
  assert.throws(()=>assert219History([...base,'218'],ref));assert.throws(()=>assert219History(base.slice(1),ref));
});

test('219 apply rejects invisible backup tasks before manifest,password,or any owner connection',async()=>{
  const steps:string[]=[];
  await assert.rejects(()=>run219(['--apply'],{
    preflight:async()=>{steps.push('preflight');throw Object.assign(new Error('fixed-code'),{code:'UPGRADE_BACKUP_TASKS_NOT_VISIBLE_RUN_AS_ADMINISTRATOR'});},
    manifest:async()=>{steps.push('manifest');},
    runOwner:async()=>{steps.push('owner-password-or-connection');},
  }),{code:'UPGRADE_BACKUP_TASKS_NOT_VISIBLE_RUN_AS_ADMINISTRATOR'});
  assert.deepEqual(steps,['preflight']);
});
test('actual219 SDK catalog and SQL dollar boundary agree byte-for-byte;extra body bytes rejected',async()=>{
  const catalog=JSON.parse(await read('docs/operations/TABLE_ACCESS_AFTER_219.json')).catalog;
  assertReady219Catalog(catalog);
  const sql=canonicalLf(await read('supabase/migrations/219_home_financial_facts_narrow_projection.sql'));
  assert.equal(home219Body,sql.match(/AS \$\$([\s\S]*?)\$\$;/u)?.[1]);
  const bad=structuredClone(catalog),f=bad.functions.find((f:{schema:string;identity:string})=>f.schema==='public'&&f.identity.startsWith('phase6_financial_facts_before208_internal('));
  assert.ok(f);f.definition=f.definition.replace('RETURN v_facts;','RETURN v_facts; -- extra unreviewed byte');
  assert.throws(()=>assertReady219Catalog(bad),/HOME219_EXACT_REVIEWED_BODY/u);
});
test('historical3 plusCURRENT219 keepfullfixture and strict3000ms,report original beside optimized and restore oldbody',async()=>{
  for(const name of ['run-canonical-receivables197-scale.mjs','run-home-damage201-scale.mjs','run-all-collections202-scale.mjs','run-home219-scale.mjs']){
    const source=await read('scripts/testing/'+name);
    assert.match(source,/assertCounts\(counts,fullScale\)/u);assert.match(source,/originalTimings/u);
    assert.match(source,/optimizedTimings/u);assert.match(source,/measureHome219/u);
    assert.match(source,/deepEqual\([^;]+(?:[Pp]arity|PARITY)/u);
    assert.match(source,/EXPLAIN\(ANALYZE,BUFFERS,FORMAT JSON\)/u);
    assert.match(source,/finishHome219Report/u);assert.match(source,/if\(!ok\)process\.exitCode=1/u);
    assert.doesNotMatch(source,/smokeScale|retry|waitForTimeout/u);
  }
  const workflow=await read('.github/workflows/quality.yml');
  assert.match(workflow,/home-performance219/u);assert.match(workflow,/collect-safe-db-diagnostics/u);
  assert.match(workflow,/run-home219-scale\.mjs/u);
});
