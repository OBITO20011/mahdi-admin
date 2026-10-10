import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {verifyBrowserDeliveryJobs} from '../scripts/agent/verify-delivery-ci.mjs';

test('discovery rejects absent, duplicate, misrouted and substituted shard identities',()=>{
  assert.match(execFileSync(process.execPath,
    ['scripts/testing/verify-browser-ci-partition.mjs','--self-test'],{encoding:'utf8'}),/Partition rejects/);
});

test('delivery requires exactly all three successful Package F shards',()=>{
  const jobs=['Lint, test, build and browser QA',
    ...[1,2,3].map(shard=>`Package F browser QA (${shard}/3)`)]
    .map(name=>({name,conclusion:'success'}));
  verifyBrowserDeliveryJobs(jobs);
  for(const conclusion of ['failure','cancelled','skipped',null]){
    for(let shard=1;shard<=3;shard++){
      assert.throws(()=>verifyBrowserDeliveryJobs(jobs.map((j,i)=>i===shard?{...j,conclusion}:j)));
    }
  }
  assert.throws(()=>verifyBrowserDeliveryJobs(jobs.slice(0,-1)));
  assert.throws(()=>verifyBrowserDeliveryJobs([...jobs,jobs[1]]));
  assert.throws(()=>verifyBrowserDeliveryJobs([...jobs,{name:'Package F browser QA (4/3)',conclusion:'success'}]));
});

test('CI shards retain isolation, full matrix success, image and timeout contracts',()=>{
  const workflow=readFileSync('.github/workflows/quality.yml','utf8');
  const block=workflow.split('  package-f-browser:\n')[1]?.split('  quality-delivery:')[0]
    ??workflow.split('  package-f-browser:\r\n')[1]?.split('  quality-delivery:')[0];
  assert.ok(block);
  assert.match(block,/name: Package F browser QA \(\$\{\{ matrix.shard \}\}\/3\)/);
  assert.match(block,/timeout-minutes: 20/);
  assert.match(block,/fail-fast: false/);
  assert.match(block,/shard: \[1, 2, 3\]/);
  assert.match(block,/run-quality-ci\.mjs package-f --shard=\$\{\{ matrix.shard \}\}\/3/);
  assert.match(block,/name: playwright-report-package-f-\$\{\{ matrix.shard \}\}/);
  assert.match(block,/container:\s+image: mcr\.microsoft\.com\/playwright:v1\.62\.1-noble@sha256:[a-f0-9]{64}/);
  assert.match(workflow,/needs: \[quality, package-f-browser, database-runtime, current-database-runtime\]/);
  assert.match(workflow,/jobs\[name\]\?\.result!=="success"/);
  assert.match(execFileSync(process.execPath,['scripts/testing/verify-ci-playwright-image.mjs'],{encoding:'utf8'}),/20m limit/);
});

test('runner rejects missing, extra or invalid shards before executing any gate',()=>{
  for(const args of [['package-f'],['package-f','--shard=4/3'],['package-f','--shard=1/2'],
    ['package-f','--shard=1/3','--retries=3'],['core','--shard=1/3']]){
    assert.throws(()=>execFileSync(process.execPath,['scripts/testing/run-quality-ci.mjs',...args],{stdio:'pipe'}));
  }
});
