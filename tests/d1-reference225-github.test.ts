import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {readD1Github225,d1GithubDiagnostic} from '../scripts/operations/d1-reference225-github.mjs';
import {prepareD1,d1ErrorCode,d1SourceHashes} from '../scripts/operations/d1-reference225-kit.mjs';
import {verifyD1Ci} from '../scripts/operations/d1-reference225-ci.mjs';
import {repositoryState} from '../scripts/operations/d1-reference225-state.mjs';
const route='actions/runs/123/jobs?filter=latest&per_page=50&page=1',marker='NEVER_SAVE_PAYLOAD_OR_CREDENTIAL';
async function httpFailure(status=502){
 try{await readD1Github225(route,{fetch:async()=>new Response(marker,{status})});throw Error('EXPECTED_FAILURE');}
 catch(error){assert.equal(d1ErrorCode(error),'D1_CI_UNVERIFIED_MANUAL_REVIEW_REQUIRED');return error;}
}
test('225 GitHub reader keeps public GET headers, one attempt and exact 30000ms timeout',async t=>{
 const controller=new AbortController();let timeout=0,calls=0;
 t.mock.method(AbortSignal,'timeout',(ms:number)=>{timeout=ms;return controller.signal;});
 const value=await readD1Github225(route,{fetch:async(url,options)=>{
  calls++;assert.equal(url,'https://api.github.com/repos/OBITO20011/mahdi-admin/'+route);
  assert.deepEqual(options?.headers,{Accept:'application/vnd.github+json','User-Agent':'Nawasrah-D1-reference-kit'});
  assert.equal(options?.signal,controller.signal);assert.equal(options?.method,undefined);
  return new Response('{"jobs":[]}');
 }});
 assert.deepEqual(value,{jobs:[]});assert.equal(timeout,30000);assert.equal(calls,1);
});
test('225 HTTP failure keeps only relative route and status; response body is never read',async()=>{
 let calls=0,bodyReads=0;
 await assert.rejects(()=>readD1Github225(route,{fetch:async()=>{
  calls++;const response=new Response(marker,{status:502,headers:{'X-Private':marker}});
  Object.defineProperty(response,'json',{value:async()=>{bodyReads++;throw Error(marker);}});
  return response;
 }}),error=>{
  assert.deepEqual(d1GithubDiagnostic(error),{route,httpStatus:502});
  assert.equal(d1ErrorCode(error),'D1_CI_UNVERIFIED_MANUAL_REVIEW_REQUIRED');assert.ok(!JSON.stringify(error).includes(marker));return true;
 });
 assert.equal(calls,1);assert.equal(bodyReads,0);
});
for(const name of ['TimeoutError','AbortError','TypeError','private='+marker]){
 test('225 network classification is closed and redacted: '+name.split('=')[0],async()=>{
  let calls=0;
  await assert.rejects(()=>readD1Github225('git/ref/heads/main',{fetch:async()=>{calls++;throw Object.assign(new Error(marker),{name,cause:new Error(marker)});}}),error=>{
   assert.deepEqual(d1GithubDiagnostic(error),{route:'git/ref/heads/main',networkErrorClass:name.startsWith('private=')?'NetworkError':name});
   assert.ok(!JSON.stringify(error).includes(marker));return true;
  });assert.equal(calls,1);
 });
}
test('225 malformed HTTP200 JSON fails closed without saving parse payload',async()=>{
 await assert.rejects(()=>readD1Github225(route,{fetch:async()=>new Response(marker,{status:200})}),error=>{
  assert.deepEqual(d1GithubDiagnostic(error),{route,httpStatus:200});assert.ok(!JSON.stringify(error).includes(marker));return true;
 });
});
test('225 unsafe route and forged error metadata never become a logged diagnostic',async()=>{
 let calls=0;
 for(const bad of ['https://example.test/'+marker,route+'&access_token='+marker]){
  await assert.rejects(()=>readD1Github225(bad,{fetch:async()=>{calls++;return new Response('{}');}}),/D1_GITHUB_ROUTE_REFUSED/u);
 }
 assert.equal(calls,0);assert.equal(d1GithubDiagnostic(Object.assign(new Error(marker),{githubRead:{route:marker,httpStatus:502}})),null);
});
async function fixture(){
 const dir=await mkdtemp(path.join(tmpdir(),'nawasrah-d1-ci-diagnostic-')),root=path.join(dir,'repo'),workdir=path.join(dir,'owner');
 await mkdir(path.join(root,'docs/agent'),{recursive:true});await mkdir(workdir);
 const git=(args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
 git(['init','-b','main']);git(['config','user.email','local@example.test']);git(['config','user.name','Local']);git(['remote','add','origin','https://github.com/OBITO20011/mahdi-admin.git']);
 await writeFile(path.join(root,'docs/agent/project-state.json'),'{"migrationCeiling":225}');git(['add','.']);git(['commit','-m','fixture']);
 const head=git(['rev-parse','HEAD']);git(['update-ref','refs/remotes/origin/main',head]);
 const target=path.join(workdir,'local-reference-through225-ready.json'),before=Buffer.from('unchanged-owner-reference');await writeFile(target,before);
 const ref={migrationCeiling:225,manifest:Array.from({length:185},(_,i)=>i),functions:705,realtimePublication:{tables:Array.from({length:13},(_,i)=>i)},freshIncrementalDifferenceCount:0,readiness:{queries:181}};
 const deps={state:async(r:string)=>repositoryState(r,{files:[]}),ci:async()=>({head,runs:{}}),hashes:async()=>({source:'a'.repeat(64)}),ready:async()=>ref,build:async(_r:string,candidate:string,folder:string)=>{await writeFile(candidate,JSON.stringify(ref));await writeFile(path.join(folder,'fresh-incremental-differences.json'),'[]');return{ok:true,repositoryStayedFrozen:true};}};
 return{dir,root,target,before,deps,close:()=>rm(dir,{recursive:true,force:true})};
}
test('225 initial CI failure saves sanitized failure before any builder and never touches owner target',async()=>{
 const f=await fixture();try{
  let builds=0,hashes=0;
  await assert.rejects(()=>prepareD1({root:f.root,outputRoot:path.join(f.dir,'out')},{...f.deps,ci:async()=>{throw await httpFailure();},hashes:async()=>{hashes++;return{};},build:async()=>{builds++;throw Error('BUILDER_MUST_NOT_RUN');}}),/D1_CI_UNVERIFIED_MANUAL_REVIEW_REQUIRED/u);
  const dirs=await readdir(path.join(f.dir,'out'));assert.equal(dirs.length,1);
  const folder=path.join(f.dir,'out',dirs[0]),raw=await readFile(path.join(folder,'failure.json'),'utf8'),saved=JSON.parse(raw);
  assert.deepEqual(saved,{ok:false,stage:'ci',code:'D1_CI_UNVERIFIED_MANUAL_REVIEW_REQUIRED',currentReferenceTouched:false,installed:false,githubRead:{route,httpStatus:502}});
  assert.ok(!raw.includes(marker));assert.deepEqual(await readdir(folder),['failure.json']);assert.equal(builds,0);assert.equal(hashes,0);assert.deepEqual(await readFile(f.target),f.before);
 }finally{await f.close();}
});
test('225 final CI recheck failure keeps candidate unapproved and saves only network class',async()=>{
 const f=await fixture();try{
  let reads=0;
  await assert.rejects(()=>prepareD1({root:f.root,outputRoot:path.join(f.dir,'out')},{...f.deps,ci:async()=>{
   reads++;if(reads===1)return{head:'verified',runs:{}};
   return readD1Github225(route,{fetch:async()=>{throw Object.assign(new Error(marker),{name:'TimeoutError'});}});
  }}),/D1_CI_UNVERIFIED_MANUAL_REVIEW_REQUIRED/u);
  assert.equal(reads,2);
  const dirs=await readdir(path.join(f.dir,'out')),folder=path.join(f.dir,'out',dirs[0]),raw=await readFile(path.join(folder,'failure.json'),'utf8'),saved=JSON.parse(raw);
  assert.equal(saved.stage,'ci-recheck');assert.deepEqual(saved.githubRead,{route,networkErrorClass:'TimeoutError'});assert.ok(!raw.includes(marker));assert.ok(!(await readdir(folder)).includes('approval.json'));assert.deepEqual(await readFile(f.target),f.before);
 }finally{await f.close();}
});
test('225 CI decisions remain byte-identical apart from injected reader and reject missing green runs',async()=>{
 const actual=await readFile('scripts/operations/d1-reference225-ci.mjs','utf8'),previous=actual.replace("import {readD1Github225 as readD1Github} from './d1-reference225-github.mjs';","import {readD1Github} from './d1-reference220-ci.mjs';").replaceAll('\r\n','\n');
 assert.equal(createHash('sha256').update(previous).digest('hex'),'8bca305871cc195239242457707b66ebeace7086cf88a2f80e08561232c6c3f4');
 const head='a'.repeat(40);
 await assert.rejects(()=>verifyD1Ci('.',head,{get:async(name:string)=>name==='git/ref/heads/main'?{object:{sha:head}}:{workflow_runs:[]},verifyJobs:()=>{}}),/D1_CI_NOT_FULL_GREEN/u);
 const hashes=await d1SourceHashes(process.cwd());assert.ok(hashes['scripts/operations/d1-reference225-github.mjs']);
});
