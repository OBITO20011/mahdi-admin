import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {git,root} from './lib.mjs';

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
  const {workflow_runs:runs}=await get(`actions/runs?head_sha=${sha}&event=push&per_page=100`);
  const find=name=>runs.find(r=>r.name===name&&r.head_branch==='main');
  const quality=find('Nawasrah code quality'),secrets=find('Nawasrah secret scanning');
  for(const run of [quality,secrets])assert.ok(run?.head_sha===sha&&run.status==='completed'&&run.conclusion==='success','Exact-SHA completed quality and secret scanning are required');
  const jobs=[];
  for(let page=1;;page++){
    const result=await get(`actions/runs/${quality.id}/jobs?filter=latest&per_page=100&page=${page}`);
    jobs.push(...result.jobs);if(result.jobs.length<100)break;
  }
  for(const name of ['Lint, test, build and browser QA','Package F browser QA']){
    const matches=jobs.filter(j=>j.name===name);
    assert.equal(matches.length,1,`Required CI job missing/duplicated: ${name}`);
    assert.equal(matches[0].conclusion,'success',`Required CI job not green: ${name}`);
  }
  assert.ok(jobs.every(j=>j.conclusion==='success'),'All quality jobs must pass, not skip');
  return {sha,qualityRun:quality.id,secretsRun:secrets.id,jobs:jobs.length,deliveryReady:true};
}
