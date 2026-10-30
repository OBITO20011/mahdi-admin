import test from 'node:test';
import {sourceBeforeBrowserBalance} from '../scripts/audit/source-before-browser-balance.mjs';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {ciDedupPins,sourceBeforeCiDedup} from '../scripts/audit/source-before-ci-dedup.mjs';

const baseline='b1789e1e973b7ca42dcea850f69d28a5b63cc3db';
const lf=(s:string)=>s.replaceAll('\r\n','\n');
const read=(f:string)=>sourceBeforeBrowserBalance(f,lf(readFileSync(f,'utf8')))!;
const gitRead=(f:string)=>lf(execFileSync('git',['show',baseline+':'+f],{encoding:'utf8',windowsHide:true,maxBuffer:4*1024**2}));
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');

test('CI deduplication preserves every job byte including matrices, timeouts, assertions and full gates',()=>{
 for(const file of ['.github/workflows/quality.yml','.github/workflows/backup-recovery.yml']){
  const current=read(file),before=gitRead(file);
  assert.equal(current.slice(current.indexOf('\njobs:')),before.slice(before.indexOf('\njobs:')));
  const header=current.slice(0,current.indexOf('\njobs:'));
  assert.match(header,/pull_request:/u);assert.match(header,/workflow_dispatch:/u);
  assert.match(header,/main/u);assert.doesNotMatch(header,/codex\/\*\*/u);
  assert.match(header,/group: (?:quality|complete-backup-recovery)-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}/u);
  assert.match(header,/cancel-in-progress: true/u);
 }
 for(const file of ['.github/workflows/secrets.yml','.github/workflows/public-uptime.yml','.github/workflows/private-weekly-ci.yml','scripts/agent/verify-delivery-ci.mjs'])assert.equal(read(file),gitRead(file),file);
});

test('historical CI view maps only four exact reviewed files to actual accepted main and exposes unknown mutations',()=>{
 assert.equal(ciDedupPins.baseline,baseline);
 assert.deepEqual(Object.keys(ciDedupPins.entries).sort(),['.github/workflows/backup-recovery.yml','.github/workflows/quality.yml','scripts/audit/source-before-owner-telegram217.mjs','scripts/audit/source-before-preflight120.mjs']);
 for(const[file,pin]of Object.entries(ciDedupPins.entries)as Array<[string,{before:string,after:string,beforeText:string}]>){
  const current=read(file),old=gitRead(file);
  assert.equal(hash(current),pin.after,file);assert.equal(pin.beforeText,old,file);assert.equal(hash(old),pin.before,file);
  assert.equal(sourceBeforeCiDedup(file,current),old,file);
  const unknown=current+'\n// unreviewed scheduling mutation\n';assert.equal(sourceBeforeCiDedup(file,unknown),unknown,file);
 }
 assert.equal(sourceBeforeCiDedup('unknown.ts','unreviewed'),'unreviewed');
 assert.equal(sourceBeforeCiDedup('missing.ts',null),null);
 for(const file of ['scripts/audit/partial216-source-pins.json','scripts/audit/owner-telegram217-source-pins.json','scripts/audit/preflight120-source-pins.json'])assert.equal(read(file),gitRead(file),file);
});

test('cloud backup and218 stay deferred with no runner, diagnostic workflow, new migration or operational change',()=>{
 const evidence=JSON.parse(read('docs/operations/FRANKFURT_GHA_BACKUP_PREFLIGHT.json'));
 assert.equal(evidence.status,'OWNER_DEFERRED_CLOUD_BACKUP_AND_218');assert.equal(evidence.currentCeiling,217);
 for(const key of ['cloudBackupImplemented','privateRunnerTemplateCreated','migration218Created','secretsConfigured','windowsTasksChanged','dbChanged'])assert.equal(evidence[key],false,key);
 assert.equal(evidence.followupLocalProbe.productionRoleAccepted,false);
 for(const f of ['ops/private-backup-runner','.github/workflows/gha-backup-role-feasibility.yml','scripts/testing/run-gha-backup-read-feasibility.mjs','scripts/testing/run-gha-backup-custom-role-feasibility.mjs'])assert.equal(existsSync(f),false,f);
 assert.equal(readdirSync('supabase/migrations').some(f=>/^218_/u.test(f)),false);
 const changed=execFileSync('git',['diff',baseline,'--name-only','--','src','customer-web','supabase','scripts/backup','scripts/operations','package.json','package-lock.json','docs/agent/project-state.json'],{encoding:'utf8',windowsHide:true}).trim();
 assert.equal(changed,'','No product,DB,ceiling,dependency or operational code changes');
});
