import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,symlink,unlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {assertRehearsalTarget,allowedRehearsalRequest,rehearsal219Executor,installRehearsalNetworkGuard,removeRehearsalPrivateSnapshots,rehearsalSqlFailureCode} from '../scripts/testing/rehearsal219-local.mjs';
import {assertActiveRehearsal219} from '../scripts/backup/complete-backup.mjs';
import {sourceBeforeRehearsal219,rehearsal219LegacyPins} from '../scripts/testing/rehearsal219-legacy-view.mjs';
import {assertProtectedRehearsalSource219,dependencyRootApproval219,pgCronResetApproval219,sourceBeforeDependencyRoots219} from '../scripts/testing/rehearsal219-protected-sources.mjs';
const root=process.cwd();
test('local SQL diagnostic admits fixed code only and never carries error text or row values',()=>{
 assert.equal(rehearsalSqlFailureCode('ERROR:  must be owner of table objects\nDETAIL: fictional private content'),'STORAGE_OBJECTS_OWNERSHIP_REQUIRED');
 assert.equal(rehearsalSqlFailureCode('ERROR: secret customer,phone,amount,token'),'LOCAL_SQL_REJECTED');
});
test('110 original owner/core sources stay exact;only approved dependency roots and RESET219 cron guard plus pinned helper differ',()=>{
 const pins=JSON.parse(readFileSync(path.join(root,'scripts/testing/rehearsal219-owner-source-pins.json'),'utf8'));
 pins.files=Object.fromEntries(pins.files);
 const seen=new Set<string>();
 function visit(file:string){
  if(seen.has(file))return;seen.add(file);
  const bytes=readFileSync(path.join(root,file)),text=bytes.toString('utf8');
  assertProtectedRehearsalSource219(file,bytes,pins.files[file]);
  for(const m of text.matchAll(/(?:from\s*|import\s*\()['"]([.][^'"\n]+)['"]/gu)){
   const next=path.posix.normalize(path.posix.join(path.posix.dirname(file),m[1]));
   if(existsSync(path.join(root,next)))visit(next);
  }
 }
 pins.roots.forEach(visit);assert.deepEqual([...seen].sort(),[...Object.keys(pins.files),...Object.keys(pgCronResetApproval219.newFiles)].sort());assert.equal(seen.size,113);
});

test('second owner exception reconstructs exact original core and rejects any extra guard edit',()=>{
 const a=pgCronResetApproval219,before=execFileSync('git',['show',a.baseline+':'+a.file],{encoding:'utf8',maxBuffer:8*1024**2}),current=readFileSync(a.file,'utf8');
 assert.equal(createHash('sha256').update(before).digest('hex'),a.beforeSha256);
 let applied=before;for(const p of a.patches){assert.equal(applied.split(p.before).length,2);applied=applied.replace(p.before,p.after);}
 assert.equal(applied,current);assert.equal(sourceBeforeDependencyRoots219(a.file,current),before);
 assert.throws(()=>assertProtectedRehearsalSource219(a.file,Buffer.from(current+'\n'),a.beforeSha256));
 assert.equal(sourceBeforeDependencyRoots219(a.file,current+'\n'),current+'\n');
 for(const [file,hash]of Object.entries(a.newFiles) as [string,string][]){const data=readFileSync(file);assert.equal(createHash('sha256').update(data).digest('hex'),hash);assert.equal(sourceBeforeDependencyRoots219(file,data.toString()),null);assert.throws(()=>assertProtectedRehearsalSource219(file,Buffer.concat([data,Buffer.from('\n')]),undefined));}
});
test('owner exception reconstructs exact Git bytes and rejects every other trial-reset-core edit',()=>{
 const a=dependencyRootApproval219;
 assert.equal(a.file,'scripts/operations/trial-reset-core.mjs');
 assert.equal(a.baseline,'8c47309da706490ddc2afa5e51cc31c829264a8b');
 const before=execFileSync('git',['show',a.baseline+':'+a.file],{encoding:'utf8',maxBuffer:8*1024**2});
 assert.equal(createHash('sha256').update(before).digest('hex'),a.beforeSha256);
 assert.equal(before.split(a.before).length,2);
 const current=readFileSync(a.file,'utf8');assert.equal(before.replace(a.before,a.after),current);
 assert.equal(sourceBeforeDependencyRoots219(a.file,current),before);
 assert.match(a.before,/SELECT 'pg_namespace'/u);assert.doesNotMatch(a.after,/SELECT 'pg_namespace'/u);
 assert.match(a.after,/deptype IN\('i','e'\)/u);
 for(const change of [current+'\n// unexpected\n',current.replace('DROP SEQUENCE','DROP EXTENSION')]){
  assert.throws(()=>assertProtectedRehearsalSource219(a.file,Buffer.from(change),a.beforeSha256));
  assert.equal(sourceBeforeDependencyRoots219(a.file,change),change);
 }
});
test('test-only legacy view binds exact current and baseline Git bytes;unknown edits remain visible',()=>{
 const pins=rehearsal219LegacyPins;
 assert.deepEqual(Object.keys(pins.files).sort(),['docs/agent/project-state.json','scripts/backup/complete-backup.mjs','scripts/testing/run-dual-backup-runtime.mjs','scripts/testing/run-owner-upgrade219-runtime.mjs','scripts/testing/run-reset219-resume-runtime.mjs',
  'tests/aftercare-cleanup.test.ts','tests/aftercare215-source-compat.test.ts','tests/handover213.test.ts','tests/handover214.test.ts','tests/home219-evidence.test.ts','tests/parcel209.test.ts','tests/partial216-source-history.test.ts','tests/preflight120-source-history.test.ts','tests/trial-aftercare-supplier.test.ts','tests/trial-owner-r.test.ts','tests/trial-sale-receipts.test.ts','tests/trial-ta-presentation.test.ts','tests/trial41-integration.test.ts']);
 for(const [file,pin] of Object.entries(pins.files) as [string,{beforeText:string;before:string;after:string}][]){
  const current=readFileSync(file,'utf8').replaceAll('\r\n','\n');
  assert.equal(createHash('sha256').update(current).digest('hex'),pin.after);
  assert.equal(pin.beforeText,execFileSync('git',['show',pins.baseline+':'+file],{encoding:'utf8',maxBuffer:8*1024**2}).replaceAll('\r\n','\n'));
  assert.equal(createHash('sha256').update(pin.beforeText).digest('hex'),pin.before);
  assert.equal(sourceBeforeRehearsal219(file,current),pin.beforeText);
  const changed=current+'\n// unexpected\n';assert.equal(sourceBeforeRehearsal219(file,changed),changed);
 }
});

test('CI reset/upgrade use exact Frankfurt pg_net fixture;all real negative cases and executable rollback probe stay wired',()=>{
 const read=(f:string)=>readFileSync(f,'utf8');
 for(const file of ['scripts/testing/run-owner-upgrade219-runtime.mjs','scripts/testing/run-reset219-resume-runtime.mjs']){
  const text=read(file);assert.match(text,/await frankfurtPgNetFixture\(executor\)/u);assert.match(text,/pgNetPreserved=true/u);
 }
 const fixture=read('scripts/testing/frankfurt-pg-net-fixture.mjs');
 assert.match(fixture,/VERSION '0\.20\.4'/u);assert.match(fixture,/WITH SCHEMA public/u);assert.doesNotMatch(fixture,/CASCADE|ALTER ROLE|GRANT /u);
 const probe=read('scripts/testing/reset219-dependency-probe.mjs');
 for(const name of ['external-view-on-dropped-table','external-function-on-dropped-function','external-extension-member-depends-on-drop-target','plan-targets-public-extension-members-refuses-extension-drop','direct-extension-drop-refused'])assert.ok(probe.includes(name),name);
 assert.match(probe,/net\.http_post/u);assert.match(probe,/127\.0\.0\.1:9/u);assert.match(probe,/ROLLBACK/u);
 assert.match(read('scripts/testing/rehearsal219-lifecycle.mjs'),/await proveReset219DependencyGuard\(executor\)/u);
 assert.match(read('scripts/testing/rehearsal219-reset.mjs'),/PG_NET_CHANGED_AFTER_RESET/u);
});
test('local transport refuses forged/expired context before spawning any child',async()=>{
 assert.throws(()=>assertActiveRehearsal219({}),/REHEARSAL_VERIFIED_CONTEXT_REQUIRED/u);
 await assert.rejects(()=>rehearsal219Executor({}),/REHEARSAL_VERIFIED_CONTEXT_REQUIRED/u);
});
test('container ID, name, archive SHA, network, volumes, ceiling and history are mandatory',()=>{
 const c={containerId:'a'.repeat(64),containerName:'nawasrah-full-restore-test',archiveSha256:'b'.repeat(64),projectRef:'kzevmysfydaslxcerogt',ceiling:219,files:180,databasePort:5432};
 const o={Id:c.containerId,Name:'/'+c.containerName,HostConfig:{NetworkMode:'none'},Mounts:[],State:{Running:true}};
 assertRehearsalTarget(c,o);
 for(const changed of [{Id:'c'.repeat(64)},{Name:'/another'},{HostConfig:{NetworkMode:'bridge'}},{Mounts:[{Source:'/live'}]},{State:{Running:false}}])assert.throws(()=>assertRehearsalTarget(c,{...o,...changed}));
 for(const changed of [{ceiling:217},{files:179},{projectRef:'another'},{archiveSha256:'invalid'},{containerId:'name-not-id'},{databasePort:25435}])assert.throws(()=>assertRehearsalTarget({...c,...changed},o));
});
test('network guard rejects external requests without sending; local fetch forbids redirects',async()=>{
 for(const url of ['https://sentry.io','https://api.telegram.org','https://kzevmysfydaslxcerogt.supabase.co','http://127.0.0.1.evil.test','file:///tmp/x'])assert.equal(allowedRehearsalRequest(url),false);
 for(const url of ['http://127.0.0.1:4567','http://localhost:4567','http://[::1]:4567'])assert.equal(allowedRehearsalRequest(url),true);
 const previous=globalThis.fetch;let calls=0;
 globalThis.fetch=(async(_url,options)=>{calls++;assert.equal(options?.redirect,'error');return new Response('{}');}) as typeof fetch;
 const guard=installRehearsalNetworkGuard();
 try{assert.throws(()=>fetch('https://api.telegram.org'),/REHEARSAL_EXTERNAL_REQUEST_BLOCKED/u);await fetch('http://127.0.0.1:4567');assert.equal(calls,1);assert.deepEqual(guard.counts(),{allowed:1,blocked:1});}
 finally{guard.close();globalThis.fetch=previous;}
});
test('snapshot cleanup refuses a junction and never deletes its target',async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),'nawasrah-rehearsal-cleanup-'));
 const privateDir=path.join(folder,'reset214-private'),other=path.join(folder,'outside'),link=path.join(privateDir,'link');
 await mkdir(privateDir);await mkdir(other);await writeFile(path.join(other,'keep.txt'),'keep');
 await symlink(other,link,process.platform==='win32'?'junction':'dir');
 try{
  await assert.rejects(()=>removeRehearsalPrivateSnapshots(folder),/REHEARSAL_PRIVATE_CLEANUP_LINK_FORBIDDEN/u);
  assert.equal(await readFile(path.join(other,'keep.txt'),'utf8'),'keep');await unlink(link);
  await writeFile(path.join(privateDir,'retention.json'),'synthetic');await removeRehearsalPrivateSnapshots(folder);
  assert.equal(await readFile(path.join(other,'keep.txt'),'utf8'),'keep');
 }finally{
  await unlink(link).catch(error=>assert.equal((error as NodeJS.ErrnoException).code,'ENOENT'));
  await rm(folder,{recursive:true,force:true});
 }
});
