import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,symlink,unlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {assertRehearsalTarget,allowedRehearsalRequest,rehearsal219Executor,installRehearsalNetworkGuard,removeRehearsalPrivateSnapshots} from '../scripts/testing/rehearsal219-local.mjs';
import {assertActiveRehearsal219} from '../scripts/backup/complete-backup.mjs';
import {sourceBeforeRehearsal219,rehearsal219LegacyPins} from '../scripts/testing/rehearsal219-legacy-view.mjs';
const root=process.cwd();
test('owner219 CLI/build/core and complete transitive source closure remain byte-identical',()=>{
 const pins=JSON.parse(readFileSync(path.join(root,'scripts/testing/rehearsal219-owner-source-pins.json'),'utf8'));
 pins.files=Object.fromEntries(pins.files);
 const seen=new Set<string>();
 function visit(file:string){
  if(seen.has(file))return;seen.add(file);
  const bytes=readFileSync(path.join(root,file)),text=bytes.toString('utf8');
  assert.equal(createHash('sha256').update(bytes).digest('hex'),pins.files[file],file);
  for(const m of text.matchAll(/(?:from\s*|import\s*\()['"]([.][^'"\n]+)['"]/gu)){
   const next=path.posix.normalize(path.posix.join(path.posix.dirname(file),m[1]));
   if(existsSync(path.join(root,next)))visit(next);
  }
 }
 pins.roots.forEach(visit);assert.deepEqual([...seen].sort(),Object.keys(pins.files).sort());assert.ok(seen.size>100);
});
test('test-only legacy view binds exact current and baseline Git bytes;unknown edits remain visible',()=>{
 const pins=rehearsal219LegacyPins;
 assert.deepEqual(Object.keys(pins.files).sort(),['docs/agent/project-state.json','scripts/backup/complete-backup.mjs','scripts/testing/run-dual-backup-runtime.mjs',
  'tests/aftercare-cleanup.test.ts','tests/aftercare215-source-compat.test.ts','tests/handover214.test.ts','tests/home219-evidence.test.ts','tests/partial216-source-history.test.ts','tests/preflight120-source-history.test.ts']);
 for(const [file,pin] of Object.entries(pins.files) as [string,{beforeText:string;before:string;after:string}][]){
  const current=readFileSync(file,'utf8').replaceAll('\r\n','\n');
  assert.equal(createHash('sha256').update(current).digest('hex'),pin.after);
  assert.equal(pin.beforeText,execFileSync('git',['show',pins.baseline+':'+file],{encoding:'utf8',maxBuffer:8*1024**2}));
  assert.equal(createHash('sha256').update(pin.beforeText).digest('hex'),pin.before);
  assert.equal(sourceBeforeRehearsal219(file,current),pin.beforeText);
  const changed=current+'\n// unexpected\n';assert.equal(sourceBeforeRehearsal219(file,changed),changed);
 }
});
test('local transport refuses forged/expired context before spawning any child',async()=>{
 assert.throws(()=>assertActiveRehearsal219({}),/REHEARSAL_VERIFIED_CONTEXT_REQUIRED/u);
 await assert.rejects(()=>rehearsal219Executor({}),/REHEARSAL_VERIFIED_CONTEXT_REQUIRED/u);
});
test('container ID, name, archive SHA, network, volumes, ceiling and history are mandatory',()=>{
 const c={containerId:'a'.repeat(64),containerName:'nawasrah-full-restore-test',archiveSha256:'b'.repeat(64),projectRef:'kzevmysfydaslxcerogt',ceiling:219,files:180};
 const o={Id:c.containerId,Name:'/'+c.containerName,HostConfig:{NetworkMode:'none'},Mounts:[],State:{Running:true}};
 assertRehearsalTarget(c,o);
 for(const changed of [{Id:'c'.repeat(64)},{Name:'/another'},{HostConfig:{NetworkMode:'bridge'}},{Mounts:[{Source:'/live'}]},{State:{Running:false}}])assert.throws(()=>assertRehearsalTarget(c,{...o,...changed}));
 for(const changed of [{ceiling:217},{files:179},{projectRef:'another'},{archiveSha256:'invalid'},{containerId:'name-not-id'}])assert.throws(()=>assertRehearsalTarget({...c,...changed},o));
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
