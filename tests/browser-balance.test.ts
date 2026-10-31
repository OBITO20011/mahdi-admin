import {sourceBeforeSentry} from '../scripts/audit/source-before-sentry.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {packageFShardCount,packageFShards,isPackageFShardArgument} from '../scripts/testing/package-f-ci-shards.mjs';
import {browserBalancePins,sourceBeforeBrowserBalance} from '../scripts/audit/source-before-browser-balance.mjs';
const baseline='8f48e49b0107d395e114f81967fc52d3cd2c40d7';
const lf=(s:string)=>s.replaceAll('\r\n','\n'),read=(f:string)=>sourceBeforeSentry(f,lf(readFileSync(f,'utf8')))!;
const old=(f:string)=>lf(execFileSync('git',['show',baseline+':'+f],{encoding:'utf8',windowsHide:true,maxBuffer:4*1024**2}));
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');

test('ten shards share one approved count while every original browser configuration and execution guard remains unchanged',()=>{
 assert.equal(packageFShardCount,10);assert.deepEqual(packageFShards,Array.from({length:10},(_,i)=>i+1));
 for(const n of packageFShards)assert.equal(isPackageFShardArgument('--shard='+n+'/10'),true);
 for(const a of ['--shard=0/10','--shard=11/10','--shard=5/5','--shard=1/10 --retries=3'])assert.equal(isPackageFShardArgument(a),false);
 for(const file of ['playwright.config.ts','playwright.ci.config.ts','scripts/testing/ci-browser-discovery.mjs','scripts/testing/run-quality-ci.mjs','scripts/testing/run-private-ci.mjs','scripts/testing/verify-browser-ci-partition.mjs','scripts/testing/verify-ci-playwright-image.mjs','scripts/agent/verify-delivery-ci.mjs','.github/workflows/secrets.yml'])assert.equal(read(file),old(file),file);
 const workflow=read('.github/workflows/quality.yml');assert.ok(workflow.includes('shard_count: ${{ steps.plan.outputs.shard_count }}'));
 assert.equal((workflow.match(/--shard=\$\{\{ matrix.shard \}\}\/\$\{\{ needs.scope.outputs.shard_count \}\}/gu)??[]).length,2);
 assert.match(workflow,/timeout-minutes: 20/u);assert.match(workflow,/fail-fast: false/u);
});

test('actual YAML concurrency expressions cancel replaced PRs only; main, manual runs and workflows cannot cancel one another',()=>{
 const evaluate=(template:string,event:string,run:number,pr?:number)=>template.replace(/\$\{\{([\s\S]*?)\}\}/gu,(_,expression:string)=>String(runInNewContext(expression,{github:{event_name:event,run_id:run,event:{pull_request:{number:pr}},ref:'refs/heads/main'},format:(s:string,v:number)=>s.replace('{0}',String(v))},{timeout:100})));
 const groups:string[]=[];
 for(const file of ['.github/workflows/quality.yml','.github/workflows/backup-recovery.yml']){
  const section=read(file).match(/^concurrency:\n((?: {2}.+\n)+)/mu)![1];
  const group=section.match(/^ {2}group: (.+)$/mu)![1],cancel=section.match(/^ {2}cancel-in-progress: (.+)$/mu)![1];
  assert.equal(cancel,"${{ github.event_name == 'pull_request' }}");
  assert.notEqual(evaluate(group,'push',101),evaluate(group,'push',102));
  assert.notEqual(evaluate(group,'workflow_dispatch',103),evaluate(group,'push',101));
  for(const event of ['push','workflow_dispatch'])assert.equal(evaluate(cancel,event,101),'false');
  assert.equal(evaluate(group,'pull_request',104,49),evaluate(group,'pull_request',105,49));
  assert.notEqual(evaluate(group,'pull_request',104,49),evaluate(group,'pull_request',106,50));
  assert.equal(evaluate(cancel,'pull_request',104,49),'true');groups.push(evaluate(group,'pull_request',104,49));
 }
 assert.equal(new Set(groups).size,2,'Different workflows never share their PR cancellation group');
});

test('historical proof accepts only eight exact reviewed source changes and exposes unknown edits; previous pins are immutable',()=>{
 assert.equal(browserBalancePins.baseline,baseline);assert.equal(Object.keys(browserBalancePins.entries).length,8);
 for(const[file,pin]of Object.entries(browserBalancePins.entries)as Array<[string,{before:string,after:string,beforeText:string}]>){const current=read(file),before=old(file);assert.equal(hash(current),pin.after,file);assert.equal(hash(before),pin.before,file);assert.equal(pin.beforeText,before,file);assert.equal(sourceBeforeBrowserBalance(file,current),before,file);const unknown=current+'\n// unapproved change\n';assert.equal(sourceBeforeBrowserBalance(file,unknown),unknown,file);}
 for(const file of ['scripts/audit/ci-dedup-source-pins.json','scripts/audit/preflight120-source-pins.json','scripts/audit/owner-telegram217-source-pins.json'])assert.equal(read(file),old(file),file);
 assert.equal(sourceBeforeBrowserBalance('unknown','unknown'),'unknown');assert.equal(sourceBeforeBrowserBalance('unknown',null),null);
});

test('W2 is permanently cancelled in current deferred lists while dated delivery history is retained',()=>{
 for(const file of ['docs/agent/TRIAL_OWNER_W_LOCAL.json','docs/agent/TRIAL_OWNER_R_LOCAL.json']){const j=JSON.parse(read(file));assert.ok(j.deferred.every((s:string)=>!s.includes('W2')));assert.ok(j.historicalDeferredAtDelivery.some((s:string)=>s.includes('W2')));assert.ok(j.cancelledByOwner.some((d:{id:string,status:string})=>d.id==='W2'&&d.status==='permanently_cancelled'));}
 const delivery=JSON.parse(read('docs/agent/TRIAL_OWNER_R_DELIVERY.json'));assert.equal(delivery.W2Deferred,false);assert.equal(delivery.W2Status,'permanently_cancelled');assert.equal(delivery.historicalAtDelivery.W2Deferred,true);
 assert.match(read('docs/agent/OWNER_DECISIONS.md'),/و2 «استلام الكل» ملغى نهائياً، وليس مؤجلاً/u);
});
