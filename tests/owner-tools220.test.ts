import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {buildOwner220Migration,owner220MigrationName} from '../scripts/testing/build-owner220-migration.mjs';
import {assert220Notifications,bind220CatalogTrigger} from '../scripts/operations/upgrade220-runtime-state.mjs';
import {upgrade220Arguments,assert220History,run220} from '../scripts/operations/frankfurt-owner-upgrade220.mjs';
import {reset220Arguments} from '../scripts/operations/frankfurt-owner-reset220.mjs';
import {reset220CronStatements,guardedReset220CronUnits,assertReset220CronIdentity} from '../scripts/operations/reset220-pg-cron-guard.mjs';
import {migrationManifest} from '../scripts/testing/maintenance-db-contract.mjs';
import {ownerTools220Pins,sourceBeforeOwnerTools220,restoreOwnerTools220Hashes,pathsBeforeOwnerTools220} from '../scripts/audit/source-before-owner-tools220.mjs';
const read=(f:string)=>readFileSync(f,'utf8').replaceAll('\r\n','\n');
const digest=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const base='7bf949b3bfe88bcacbc527184930ed6f9291481c';
const git=(f:string)=>execFileSync('git',['show',base+':'+f],{windowsHide:true,maxBuffer:16*1024**2});

test('220 historical adapter binds every reviewed byte to Git79 and exposes all unknown mutations',()=>{
 assert.equal(ownerTools220Pins.baseline,base);
 for(const[file,pin]of Object.entries(ownerTools220Pins.entries)as[string,{before:string|null;after:string}][]){
  const raw=read(file);assert.equal(digest(raw),pin.after,file);
  const old=pin.before===null?null:git(file).toString('utf8').replaceAll('\r\n','\n');
  assert.equal(old===null?null:digest(old),pin.before,file);
  assert.equal(sourceBeforeOwnerTools220(file,raw),old,file);
  const changed=raw+'\nUNREVIEWED_220_MUTATION';assert.equal(sourceBeforeOwnerTools220(file,changed),changed,file);
  assert.deepEqual(restoreOwnerTools220Hashes([{file,sha256:pin.after}]),old===null?[]:[{file,sha256:pin.before}]);
  assert.deepEqual(restoreOwnerTools220Hashes([{file,sha256:'unreviewed'}]),[{file,sha256:'unreviewed'}]);
 }
 assert.equal(sourceBeforeOwnerTools220('unreviewed/file','raw'),'raw');
 assert.deepEqual(pathsBeforeOwnerTools220(['supabase/unreviewed.sql']),['supabase/unreviewed.sql']);
 assert.deepEqual(pathsBeforeOwnerTools220(['supabase/migrations/'+owner220MigrationName]),[]);
});

test('220 safe summaries use the exact CI artifact root and remain mandatory,without raw backup or snapshot uploads',()=>{
 const workflow=read('.github/workflows/quality.yml');
 const block=workflow.slice(workflow.indexOf('- name: Retain allowlisted owner220 synthetic summaries'));
 assert.ok(block.startsWith('- name: Retain allowlisted owner220 synthetic summaries'));
 const artifact=block.split('\n      - name:')[0];
 for(const[runner,prefix,summary]of [
  ['run-owner-upgrade220-runtime.mjs','nawasrah-owner-upgrade220-','summary.json'],
  ['run-reset220-resume-runtime.mjs','nawasrah-reset220-resume-','summary220.json'],
 ]){
  const source=read('scripts/testing/'+runner);
  assert.ok(source.includes("await mkdtemp(path.join(process.env.RUNNER_TEMP??tmpdir(),'"+prefix+"'))"));
  assert.ok(artifact.includes('${{ runner.temp }}/'+prefix+'*/'+summary));
 }
 assert.match(artifact,/if-no-files-found: error/u);assert.match(artifact,/retention-days: 7/u);
 assert.doesNotMatch(artifact,/report\.json|\.nwb|snapshot|\.dump|\*\*\//u);
});

test('owner219 entrypoints/connection guards/cron guard stay byte-identical;001–219 remain immutable and218 reserved',async()=>{
 for(const [file,hash]of Object.entries({
  'scripts/operations/frankfurt-owner-reset219.mjs':'9591b9735f0d7b8155e51e090ff602baf447905e550940da9991c7865e0f512e',
  'scripts/operations/frankfurt-owner-build.mjs':'ccd2927eec6a04f6efa7a75f0e074457d0adf512f175a476ad934b4f033a6513',
  'scripts/operations/reset219-pg-cron-guard.mjs':'c73cad315e2fbca9bd6fe0b69652191fcc5a7fc10d3049ed1e10e2b092388f1f',
 })){assert.equal(digest(readFileSync(file)),hash);assert.deepEqual(readFileSync(file),git(file));}
 const manifest=await migrationManifest(process.cwd());assert.equal(manifest.length,181);assert.ok(!manifest.some(m=>m.name.startsWith('218_')));
 for(const m of manifest.filter(m=>Number(m.name.slice(0,3))<=219))assert.equal(digest(read('supabase/migrations/'+m.name)),digest(git('supabase/migrations/'+m.name).toString('utf8').replaceAll('\r\n','\n')));
 assert.equal(read('supabase/migrations/'+owner220MigrationName),await buildOwner220Migration(process.cwd()));
 assert.equal(read('scripts/backup/restore-comparison.mjs'),git('scripts/backup/restore-comparison.mjs').toString('utf8').replaceAll('\r\n','\n'));
});

test('220 parser fails before password/network when mandatory protection is missing;fixed target inherited',async()=>{
 assert.throws(()=>upgrade220Arguments(['--apply']),/BACKUP_REQUIRED/u);
 assert.throws(()=>upgrade220Arguments(['--verify-only']),/BACKUP_RESTORE_APPLY_REPORT_REQUIRED/u);
 assert.throws(()=>upgrade220Arguments(['--dry-run','--backup-evidence','x']),/OFFLINE_HAS_NO_PROTECTION_INPUT/u);
 assert.throws(()=>upgrade220Arguments(['--apply','--backup-evidence','a','--backup-evidence','b']));
 let connections=0;await assert.rejects(()=>run220(['--apply'],{preflight:async()=>({ok:true,tasks:5,supportedCeiling:220,repositoryMatches:true}),manifest:async()=>{},runOwner:async()=>{connections++;}}));assert.equal(connections,0);
 const ref={prefixes:{219:{appliedVersions:Array.from({length:180},(_,i)=>String(i))}},appliedVersions:[...Array.from({length:180},(_,i)=>String(i)),'220']};
 assert.deepEqual(assert220History(ref.prefixes[219].appliedVersions,ref),['220']);assert.deepEqual(assert220History(ref.appliedVersions,ref),[]);assert.throws(()=>assert220History(ref.appliedVersions.slice(1),ref));
 assert.equal(reset220Arguments([]).reference.split(/[\\/]/u).at(-1),'local-reference-through220-ready.json');
 for(const args of [['--target','other'],['--apply'],['--resume'],['--reference','local-reference-through219-ready.json']])assert.throws(()=>reset220Arguments(args));
 const cli=read('scripts/operations/frankfurt-owner-reset220.mjs');assert.match(cli,/connectionFromLink/u);assert.match(cli,/PGSSLMODE:'verify-full'/u);assert.match(cli,/await assertUpgradeAdministrator\(\)/u);
});

test('post-launch220 preserves actual notification identity,while explicit maintenance holds every cron',()=>{
 const trigger={schema:'public',table:'orders',name:'trg_notify_new_website_order_push',definition:'reviewed trigger',enabled:'D'};
 const template={trigger,jobs:Array.from({length:6},(_,i)=>({id:i+1,name:'job'+i,schedule:'* * * * *',command:'SELECT '+i+';',host:'localhost',port:25432,database:'postgres',username:'postgres',active:false}))};
 const live={trigger:{...trigger,enabled:'O'},jobs:template.jobs.map(j=>({...j,id:j.id+100,port:5432}))},serverBinding={user:'postgres',database:'postgres',port:5432,host:'localhost'};
 assert.equal(assert220Notifications(live,template,{requireHeld:true,serverBinding}),live);
 for(const mutate of [(s:any)=>s.jobs.pop(),(s:any)=>s.jobs.push(s.jobs[0]),(s:any)=>{s.jobs[0].command='different';},(s:any)=>{s.jobs[0].active=true;},(s:any)=>{s.jobs[0].port=9999;},(s:any)=>{s.jobs[0].host='other';},(s:any)=>{s.trigger.definition='different';}]){const bad=structuredClone(live);mutate(bad);assert.throws(()=>assert220Notifications(bad,template,{requireHeld:true,serverBinding}));}
 const catalog={triggers:[trigger,{schema:'public',table:'other',name:'other',enabled:'O',definition:'other'}]},bound=bind220CatalogTrigger(catalog,{notifications:live});assert.equal(bound.triggers[0].enabled,'O');assert.deepEqual(bound.triggers[1],catalog.triggers[1]);assert.equal(catalog.triggers[0].enabled,'D');
 assert.throws(()=>bind220CatalogTrigger({...catalog,triggers:[{...trigger,definition:'unknown'}]},{notifications:live}));
});

test('RESET220 reuses strict resume/UTC core and replaces only the same three reviewed cron lines',async()=>{
 const manifest=await migrationManifest(process.cwd()),identity={name:'pg_cron',version:'1.6.4',schema:'pg_catalog',owner:'supabase_admin'},reference={migrationCeiling:220,manifest,catalog:{extensions:[identity]}};
 const units=reset220CronStatements.map(s=>({name:s.name,input:readFileSync('supabase/migrations/'+s.name)}));
 const other={name:'033_order_web_push_notifications.sql',input:readFileSync('supabase/migrations/033_order_web_push_notifications.sql')};
 const result=guardedReset220CronUnits([...units,other],reference);assert.equal(result.replaced.length,3);assert.equal(result.units.at(-1),other);
 for(const v of [[],[{...identity,owner:'postgres'}],[{...identity,version:'0.0'}],[{...identity,schema:'public'}]])assert.throws(()=>assertReset220CronIdentity(v,identity));
 assert.throws(()=>guardedReset220CronUnits(units.slice(1),reference));assert.throws(()=>guardedReset220CronUnits(units.map((u:any,i:number)=>i?u:{...u,input:Buffer.from(u.input+'\n')}),reference));
 const shared=read('scripts/operations/trial-reset214-core.mjs');assert.match(shared,/writeResetCatalogEvidence\(output,before,after/u);assert.match(shared,/assertNoForeignWrites/u);
 assert.match(read('scripts/operations/trial-reset220-core.mjs'),/runRetainedReset\(options,policy\)/u);
 assert.match(read('scripts/testing/run-reset220-resume-runtime.mjs'),/nextBuildDay/u);assert.match(read('scripts/testing/run-reset220-resume-runtime.mjs'),/realCommittedWritesRejected=true/u);
});
