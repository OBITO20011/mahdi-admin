import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {git,root} from './lib.mjs';
import {packageFShardCount,packageFShards} from '../testing/package-f-ci-shards.mjs';

export function verifyBrowserDeliveryJobs(jobs){
  for(const name of ['Lint, test, build and browser QA',
    ...packageFShards.map(shard=>`Package F browser QA (${shard}/${packageFShardCount})`)]){
    const matches=jobs.filter(j=>j.name===name);
    assert.equal(matches.length,1,`Required CI job missing/duplicated: ${name}`);
    assert.equal(matches[0].conclusion,'success',`Required CI job not green: ${name}`);
  }
  assert.equal(jobs.filter(j=>j.name.startsWith('Package F browser QA')).length,packageFShardCount,
    'Exactly all approved Package F shards required');
}

export function verifyFullDeliveryJobs(jobs){
  verifyBrowserDeliveryJobs(jobs);
  const suites=readFileSync(path.join(root,'.github/workflows/quality.yml'),'utf8')
    .match(/suite: \[([^\]]+)\]/u)?.[1].split(',').map(name=>name.trim());
  assert.ok(suites?.length,'Full DB matrix discovery required');
  for(const name of ['CI full or affected scope','Complete quality delivery gate','Isolated database runtime regression',
    ...suites.map(suite=>`Isolated current contracts (${suite})`)]){
    const matches=jobs.filter(job=>job.name===name);
    assert.equal(matches.length,1,`Full release job missing/duplicated:${name}`);
    assert.equal(matches[0].conclusion,'success',`Full release job not green:${name}`);
  }
  assert.ok(jobs.every(job=>job.conclusion==='success'),'All FULL quality jobs must pass,not skip');
}

export async function verifyDeliveryCi(){
  // Credentials stay in memory; never persist/print them or GitHub log bodies.
  const credential=execFileSync('git',['credential','fill'],{cwd:root,input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',stdio:['pipe','pipe','pipe']});
  const token=credential.split(/\r?\n/u).find(line=>line.startsWith('password='))?.slice(9);
  assert.ok(token,'GitHub credentials required for exact-SHA delivery verification');
  const remote=git(['remote','get-url','origin']);
  const repo=remote.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/u)?.[1];
  assert.ok(repo,'Expected GitHub origin');
  const sha=git(['rev-parse','HEAD']);
  assert.equal(git(['ls-remote','origin','refs/heads/main']).split(/\s/u)[0],sha,'Remote main differs from HEAD');
  async function get(route){
    const response=await fetch(`https://api.github.com/repos/${repo}/${route}`,{headers:{Authorization:`Bearer ${token}`,'User-Agent':'nawasrah-delivery',Accept:'application/vnd.github+json'}});
    assert.ok(response.ok,`GitHub status ${response.status}`);return response.json();
  }
  const {workflow_runs:runs}=await get(`actions/runs?head_sha=${sha}&per_page=100`);
  const successful=runs.filter(r=>r.head_sha===sha&&r.head_branch==='main'&&r.status==='completed'&&r.conclusion==='success');
  const secrets=successful.find(r=>r.name==='Nawasrah secret scanning');
  assert.ok(secrets,'Exact-SHA completed secret scanning required');
  // An affected push is not release evidence. Accept a real full dispatch or
  // scheduled run on the EXACT same SHA,never a previous commit or skipped DB.
  for(const quality of successful.filter(r=>r.name==='Nawasrah code quality')){
    const jobs=[];
    for(let page=1;;page++){
      const result=await get(`actions/runs/${quality.id}/jobs?filter=latest&per_page=100&page=${page}`);
      jobs.push(...result.jobs);if(result.jobs.length<100)break;
    }
    try{
      verifyFullDeliveryJobs(jobs);
    }catch{continue;}
    return {sha,qualityRun:quality.id,qualityEvent:quality.event,secretsRun:secrets.id,jobs:jobs.length,deliveryReady:true};
  }
  throw new Error('No exact-SHA successful FULL quality run;dispatch full before release (affected push is insufficient)');
}
