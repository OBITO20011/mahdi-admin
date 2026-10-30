import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {verifyBrowserDeliveryJobs} from '../scripts/agent/verify-delivery-ci.mjs';
import {packageFShardCount,packageFShards,isPackageFSpec,packageFSpecPattern,notPackageFSpecPattern} from '../scripts/testing/package-f-ci-shards.mjs';
import {summarizeTimings,timingRecord} from '../scripts/testing/ci-browser-timing-reporter.mjs';
import {balanceBrowserCases} from '../scripts/testing/ci-browser-discovery.mjs';

test('206/207 interface suites share existing F shards with exact historical filenames on both path styles',()=>{
  for(const file of ['package-f-future.spec.ts','admin-navigation-cash206.spec.ts','document-corrections207.spec.ts']){
    for(const prefix of ['e2e/','C:\\repo\\e2e\\']){
      assert.equal(isPackageFSpec(prefix+file),true);
      assert.equal(packageFSpecPattern.test(prefix+file),true);
      assert.equal(notPackageFSpecPattern.test(prefix+file),false);
    }
  }
  for(const file of ['regular.spec.ts','document-corrections207.spec.ts.extra','other-document-corrections207.spec.ts']){
    assert.equal(isPackageFSpec('e2e/'+file),false);
    assert.equal(notPackageFSpecPattern.test('/repo/e2e/'+file),true);
  }
});

test('discovery rejects absent, duplicate, misrouted and substituted shard identities',()=>{
  assert.match(execFileSync(process.execPath,
    ['scripts/testing/verify-browser-ci-partition.mjs','--self-test'],{encoding:'utf8'}),/Partition rejects/);
});

test('delivery requires both core engines and exactly all ten successful Package F shards',()=>{
  const jobs=['Lint, test, build and browser QA','Core WebKit browser QA',
    ...packageFShards.map(shard=>`Package F browser QA (${shard}/${packageFShardCount})`)]
    .map(name=>({name,conclusion:'success'}));
  verifyBrowserDeliveryJobs(jobs);
  for(const conclusion of ['failure','cancelled','skipped',null]){
    for(const target of jobs){
      assert.throws(()=>verifyBrowserDeliveryJobs(jobs.map(j=>j.name===target.name?{...j,conclusion}:j)));
    }
  }
  assert.throws(()=>verifyBrowserDeliveryJobs(jobs.slice(0,-1)));
  assert.throws(()=>verifyBrowserDeliveryJobs([...jobs,jobs[1]]));
  assert.throws(()=>verifyBrowserDeliveryJobs([...jobs,{name:'Package F browser QA (6/5)',conclusion:'success'}]));
});

test('CI shards retain isolation, full matrix success, image and timeout contracts',()=>{
  const workflow=readFileSync('.github/workflows/quality.yml','utf8');
  const block=workflow.split('  package-f-browser:\n')[1]?.split('  quality-delivery:')[0]
    ??workflow.split('  package-f-browser:\r\n')[1]?.split('  quality-delivery:')[0];
  assert.ok(block);
  assert.ok(block.includes('name: Package F browser QA (${{ matrix.shard }}/${{ needs.scope.outputs.shard_count }})'));
  assert.match(block,/timeout-minutes: 20/);
  assert.match(block,/fail-fast: false/);
  assert.match(block,/shard: \$\{\{ fromJSON\(needs.scope.outputs.shards\) \}\}/);
  assert.match(readFileSync('scripts/testing/plan-private-ci.mjs','utf8'),/shards = \[\.\.\.packageFShards\]/);
  assert.ok(block.includes('run-quality-ci.mjs package-f --shard=${{ matrix.shard }}/${{ needs.scope.outputs.shard_count }}'));
  assert.ok(workflow.includes('shard_count: ${{ steps.plan.outputs.shard_count }}'));
  assert.match(readFileSync('scripts/testing/plan-private-ci.mjs','utf8'),/shard_count:String\(packageFShardCount\)/u);
  assert.match(block,/name: playwright-report-package-f-\$\{\{ matrix.shard \}\}/);
  assert.match(block,/container:\s+image: mcr\.microsoft\.com\/playwright:v1\.62\.1-noble@sha256:[a-f0-9]{64}/);
  assert.match(workflow,/needs: \[scope, quality, core-webkit-browser, package-f-browser, database-runtime, current-database-runtime, pwa-release-update\]/);
  assert.match(workflow,/verify-private-ci-gate\.mjs/);
  assert.match(execFileSync(process.execPath,['scripts/testing/verify-ci-playwright-image.mjs'],{encoding:'utf8'}),/20m limit/);
});

test('runner rejects missing, extra or invalid shards before executing any gate',()=>{
  for(const args of [['package-f'],['package-f','--shard=11/10'],['package-f','--shard=1/2'],
    ['package-f','--shard=1/10','--retries=3'],['core','--shard=1/10']]){
    assert.throws(()=>execFileSync(process.execPath,['scripts/testing/run-quality-ci.mjs',...args],{stdio:'pipe'}));
  }
});

test('case-level sharding is restricted to Package F CI and timing contains no payloads',()=>{
  const config=readFileSync('playwright.ci.config.ts','utf8');
  assert.match(config,/fullyParallel: Boolean\(process.env.CI\) && group==='package-f' \? true : base.fullyParallel/u);
  assert.equal(packageFShardCount,10);
  assert.deepEqual(packageFShards,Array.from({length:10},(_,i)=>i+1));
  const records=Array.from({length:12},(_,index)=>timingRecord({project:'webkit',file:`e2e/package-f-${index%2}.spec.ts`,title:`case${index}`,id:`id${index}`},
    {duration:index*100,retry:index===11?1:0,status:'passed'}));
  const summary=summarizeTimings(records);
  assert.equal(summary.topFiles.length,2);assert.equal(summary.topCases.length,10);
  assert.equal(summary.totalTestDurationMs,6600);assert.equal(summary.attempts,12);
  assert.equal(summary.topCases[0].durationMs,1100);assert.equal(summary.topCases[0].retry,1);
  assert.equal(summary.topFiles[0].durationMs,3600);
  assert.deepEqual(Object.keys(records[0]).sort(),['durationMs','file','id','project','retry','status','title']);
});

test('each future file and engine is interleaved without lost or duplicated identities',()=>{
  const cases=Array.from({length:14},(_,i)=>({file:'e2e/package-f-heavy.spec.ts',project:'webkit',key:`w${i}`}));
  cases.push(...Array.from({length:8},(_,i)=>({file:'e2e/package-f-future.spec.ts',project:'chromium',key:`c${i}`})));
  const bins=balanceBrowserCases(cases);
  assert.deepEqual(bins.flat().map(r=>r.key).sort(),cases.map(r=>r.key).sort());
  assert.equal(new Set(bins.flat().map(r=>r.key)).size,cases.length);
  for(const project of ['webkit','chromium']){
    const counts=bins.map(bin=>bin.filter(row=>row.project===project).length);
    assert.ok(Math.max(...counts)-Math.min(...counts)<=1);
  }
});
