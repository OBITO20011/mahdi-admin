import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {coreWebkitShardCount,coreWebkitShards,coreWebkitJobNames,isCoreWebkitShardArgument,verifyCoreWebkitShardPartition} from '../scripts/testing/core-webkit-ci-shards.mjs';
import {verifyBrowserDeliveryJobs} from '../scripts/agent/verify-delivery-ci.mjs';
import {packageFShards,packageFShardCount} from '../scripts/testing/package-f-ci-shards.mjs';
import {listBrowserTests} from '../scripts/testing/ci-browser-discovery.mjs';
import {canonicalLf,sha256} from '../scripts/testing/maintenance-db-contract.mjs';
import {coreWebkitSourcePins,sourceBeforeCoreWebkitShards,restoreCoreWebkitShardHashes,pathsBeforeCoreWebkitShards} from '../scripts/audit/source-before-core-webkit-shards.mjs';
import {sourceBeforeOnPrices225} from '../scripts/audit/source-before-on-prices225.mjs';
import {sourceBeforeUpgradeRegistration} from '../scripts/audit/source-before-upgrade-registration.mjs';

const rows=Array.from({length:6},(_,i)=>({project:'mobile-webkit',key:`file-and-title-${i}`}));
test('native WebKit partition proves exact original identities and rejects missing,duplicate,substituted and foreign cases',()=>{
 assert.equal(coreWebkitShardCount,2);assert.deepEqual(coreWebkitShards,[1,2]);
 assert.deepEqual(verifyCoreWebkitShardPartition(rows,[rows.slice(0,3),rows.slice(3)]),[3,3]);
 for(const parts of [[rows],[[],rows],[rows.slice(0,3),rows.slice(4)],
  [rows.slice(0,3),[...rows.slice(3),rows[0]]],
  [rows.slice(0,3),rows.slice(3).map((r,i)=>i===0?{...r,key:'substituted-title'}:r)],
  [rows.slice(0,3),rows.slice(3).map((r,i)=>i===0?{...r,project:'desktop-chromium'}:r)]])assert.throws(()=>verifyCoreWebkitShardPartition(rows,parts));
 assert.throws(()=>verifyCoreWebkitShardPartition([], [[],[]]));
});

test('both exact WebKit jobs are mandatory; failure,cancellation,skip,missing,old monolith and extra shard cannot satisfy delivery',()=>{
 const jobs=['Lint, test, build and browser QA',...coreWebkitJobNames,...packageFShards.map(n=>`Package F browser QA (${n}/${packageFShardCount})`)].map(name=>({name,conclusion:'success'}));
 verifyBrowserDeliveryJobs(jobs);
 for(const name of coreWebkitJobNames){
  assert.throws(()=>verifyBrowserDeliveryJobs(jobs.filter(j=>j.name!==name)));
  for(const conclusion of ['failure','cancelled','skipped',null])assert.throws(()=>verifyBrowserDeliveryJobs(jobs.map(j=>j.name===name?{...j,conclusion}:j)));
 }
 for(const name of ['Core WebKit browser QA','Core WebKit browser QA (3/2)',coreWebkitJobNames[0]])assert.throws(()=>verifyBrowserDeliveryJobs([...jobs,{name,conclusion:'success'}]));
});

test('only native1/2 and2/2 selectors reach the original runner; no other flag can override case limits',()=>{
 for(const value of ['--shard=1/2','--shard=2/2'])assert.equal(isCoreWebkitShardArgument(value),true);
 for(const value of ['','--shard=0/2','--shard=3/2','--shard=1/3','--shard=01/2','--shard=1/2 --retries=0'])assert.equal(isCoreWebkitShardArgument(value),false);
 for(const args of [[],['--shard=3/2'],['--shard=1/3'],['--shard=1/2','--timeout=1']])assert.throws(()=>execFileSync(process.execPath,['scripts/testing/run-core-webkit-ci.mjs',...args],{stdio:'pipe'}));
 assert.throws(()=>listBrowserTests('package-f',{coreShard:1}));
 assert.throws(()=>listBrowserTests('core',{coreGroup:'chromium',coreShard:1}));
 assert.throws(()=>listBrowserTests('core',{coreGroup:'webkit',coreShard:3}));
});

test('two20-minute jobs keep pinned image,one worker,serial groups,isolation and all case limits unchanged',()=>{
 const workflow=readFileSync('.github/workflows/quality.yml','utf8');
 const block=workflow.match(/^ {2}core-webkit-browser:\r?\n([\s\S]*?)(?=^ {2}[\w-]+:)/mu)?.[1];assert.ok(block);
 assert.ok(block.includes('name: Core WebKit browser QA (${{ matrix.shard }}/2)'));
 assert.match(block,/timeout-minutes: 20\r?$/mu);assert.match(block,/fail-fast: false/u);assert.match(block,/shard: \[1, 2\]/u);
 assert.ok(block.includes('run-core-webkit-ci.mjs --shard=${{ matrix.shard }}/2'));
 assert.ok(block.includes('name: playwright-report-core-webkit-${{ matrix.shard }}'));
 assert.match(block,/image: mcr\.microsoft\.com\/playwright:v1\.62\.1-noble@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e/u);
 assert.match(block,/verify-browser-ci-partition\.mjs/u);
 assert.match(workflow,/needs: \[scope, quality, core-webkit-browser, package-f-browser, database-runtime, current-database-runtime, pwa-release-update\]/u);
 const baseline='f108e72bbce2ac11b89bdc18b2ece8fb2c6493ae';
 for(const file of ['playwright.config.ts','playwright.ci.config.ts','scripts/testing/verify-browser-network-isolation.mjs','scripts/testing/playwright-global-setup.mjs','scripts/testing/playwright-global-teardown.mjs'])assert.equal(readFileSync(file,'utf8').replaceAll('\r\n','\n'),execFileSync('git',['show',baseline+':'+file],{encoding:'utf8'}));
 const runner=readFileSync('scripts/testing/run-core-webkit-ci.mjs','utf8');assert.match(runner,/verify-browser-network-isolation\.mjs/u);assert.doesNotMatch(runner,/--retries|--timeout|pass-with-no-tests|test\.skip/u);
});

test('CI inverse preserves literal old sources and old pins; unknown byte,null and extra paths cannot pass as an approved edit',()=>{
 const baseline='f108e72bbce2ac11b89bdc18b2ece8fb2c6493ae';
 for(const[file,pin]of Object.entries(coreWebkitSourcePins)){
  const physical=canonicalLf(readFileSync(file,'utf8'));
  const current=sourceBeforeUpgradeRegistration(file,physical);assert.ok(current!==null,file);assert.equal(sha256(current),pin.after,file);
  assert.equal(sourceBeforeCoreWebkitShards(file,current),pin.beforeText,file);
  assert.equal(sourceBeforeCoreWebkitShards(file,physical+'\n/*unknown byte*/'),physical+'\n/*unknown byte*/',file);
  assert.equal(sourceBeforeCoreWebkitShards(file,null),null);
  if(pin.beforeText!==null)assert.equal(pin.beforeText,canonicalLf(execFileSync('git',['show',baseline+':'+file],{encoding:'utf8'})));
  assert.deepEqual(restoreCoreWebkitShardHashes([{file,sha256:pin.after}]),pin.before===null?[]:[{file,sha256:pin.before}]);
  assert.deepEqual(pathsBeforeCoreWebkitShards([file]),pin.before===null?[]:[file]);
 }
 assert.equal(sourceBeforeCoreWebkitShards('unapproved-file','unknown'),'unknown');
 const index='scripts/audit/core-webkit-shards-source-pins.json',text=canonicalLf(readFileSync(index,'utf8'));
 assert.equal(sourceBeforeCoreWebkitShards(index,text),null);assert.equal(sourceBeforeCoreWebkitShards(index,text+' '),text+' ');
 assert.match(execFileSync(process.execPath,['scripts/testing/build-inventory224-history.mjs','--check'],{encoding:'utf8'}),/"ok":true/u);
 const sql='supabase/migrations/225_on_independent_prices.sql';
 const supabaseChanges=execFileSync('git',['diff','--name-only',baseline,'--','supabase'],{encoding:'utf8'}).trim().split(/\r?\n/u);
 assert.deepEqual(supabaseChanges,[sql]);
 const sqlSource=readFileSync(sql,'utf8');
 assert.equal(sourceBeforeOnPrices225(sql,sqlSource),null);
 assert.equal(sourceBeforeOnPrices225(sql,sqlSource+'\nUNKNOWN_BYTE'),sqlSource+'\nUNKNOWN_BYTE');
 const scope=['src','customer-web/src','e2e'];
 const oldFiles=new Set(execFileSync('git',['ls-tree','-r','--name-only',baseline,'--',...scope],{encoding:'utf8'}).trim().split('\n'));
 const changed=new Set([
  ...execFileSync('git',['diff','--name-only',baseline,'--',...scope],{encoding:'utf8'}).trim().split('\n'),
  ...execFileSync('git',['ls-files','--others','--exclude-standard','--',...scope],{encoding:'utf8'}).trim().split('\n'),
 ].filter(Boolean));
 for(const file of changed){
  const physical=existsSync(file)?canonicalLf(readFileSync(file,'utf8')):null;
  const expected=oldFiles.has(file)?canonicalLf(execFileSync('git',['show',baseline+':'+file],{encoding:'utf8'})):null;
  assert.equal(sourceBeforeUpgradeRegistration(file,physical),expected,file);
 }
});
