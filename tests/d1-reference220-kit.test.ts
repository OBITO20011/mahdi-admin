import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm,symlink,lstat} from 'node:fs/promises';
import path from 'node:path';import {tmpdir} from 'node:os';import {execFileSync} from 'node:child_process';
import {prepareD1,installD1,d1ErrorCode,d1Main} from '../scripts/operations/d1-reference220-kit.mjs';
import {repositoryState,sha256,externalPath} from '../scripts/operations/d1-reference220-state.mjs';
import {verifyD1Ci,predecessor220Jobs,verify220PredecessorJobs,owner220DeliveryJobs} from '../scripts/operations/d1-reference220-ci.mjs';
const name='local-reference-through220-ready.json';
const git=(root:string,args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
async function fixture(){
 const dir=await mkdtemp(path.join(tmpdir(),'nawasrah-d1-kit-test-')),root=path.join(dir,'repo'),workdir=path.join(dir,'owner');await mkdir(path.join(root,'docs/agent'),{recursive:true});await mkdir(workdir);
 git(root,['init','-b','main']);git(root,['config','user.email','local@example.test']);git(root,['config','user.name','Local']);git(root,['remote','add','origin','https://github.com/OBITO20011/mahdi-admin.git']);
 await writeFile(path.join(root,'docs/agent/project-state.json'),JSON.stringify({migrationCeiling:220}));git(root,['add','.']);git(root,['commit','-m','fixture']);const head=git(root,['rev-parse','HEAD']);git(root,['update-ref','refs/remotes/origin/main',head]);
 const target=path.join(workdir,name),before=Buffer.from('old-owner-reference-byte-proof');await writeFile(target,before);
 const ref={migrationCeiling:220,manifest:Array.from({length:181},(_,i)=>i),functions:680,realtimePublication:{tables:Array.from({length:13},(_,i)=>i)},freshIncrementalDifferenceCount:0,readiness:{queries:181}};
 const hashes={'script':'a'.repeat(64)},ci={head,runs:{quality:{id:1,url:'https://github.com/OBITO20011/mahdi-admin/actions/runs/1'}}};
 const deps={state:async(r:string)=>repositoryState(r,{files:[]}),ci:async()=>ci,hashes:async()=>hashes,ready:async(_r:string,f:string)=>{const v=JSON.parse(await readFile(f,'utf8'));assert.deepEqual(v,ref);return v;},build:async(_r:string,c:string,folder:string)=>{await writeFile(c,JSON.stringify(ref));await writeFile(path.join(folder,'fresh-incremental-differences.json'),'[]');return {ok:true,repositoryStayedFrozen:true};}};
 return {dir,root,workdir,target,before,ref,deps,head,close:()=>rm(dir,{recursive:true,force:true})};
}
test('prepare builds a separate candidate/Arabic approval and never writes owner target;explicit installation keeps verified previous bytes',async()=>{
 const f=await fixture();try{const r=await prepareD1({root:f.root,outputRoot:path.join(f.dir,'candidates')},f.deps);assert.equal(r.installed,false);assert.deepEqual(await readFile(f.target),f.before);assert.equal(r.source.mainSha,f.head);assert.equal(r.accessQueries,181);assert.equal(r.freshIncrementalDifferences,0);assert.ok((await readFile(path.join(r.folder,'اعتماد-مرجع-D1.md'),'utf8')).includes('التوقيع:'));
 const installed=await installD1({root:f.root,candidate:r.candidate,approvedSha256:r.candidateSha256,workdir:f.workdir},f.deps);assert.equal(installed.readiness,true);assert.deepEqual(await readFile(installed.previousCopy!),f.before);assert.equal(sha256(await readFile(f.target)),r.candidateSha256);assert.ok(!(await readdir(f.workdir)).some(s=>s.includes('.incoming-')||s==='.D1_REFERENCE_INSTALL.lock'));
 }finally{await f.close();}
});
test('dirty/known-owner mutation/different HEAD/branch fail before builder and leave owner target intact',async()=>{
 const f=await fixture();try{await writeFile(path.join(f.root,'unknown.txt'),'x');await assert.rejects(()=>repositoryState(f.root,{files:[]}),/D1_DIRTY_TREE_REFUSED/u);await repositoryState(f.root,{files:[{file:'unknown.txt',sha256:sha256('x')}]});await writeFile(path.join(f.root,'unknown.txt'),'y');await assert.rejects(()=>repositoryState(f.root,{files:[{file:'unknown.txt',sha256:sha256('x')}]}),/D1_OWNER_FILE_CHANGED/u);await rm(path.join(f.root,'unknown.txt'));
 git(f.root,['update-ref','refs/remotes/origin/main','0'.repeat(40)]);await assert.rejects(()=>prepareD1({root:f.root,outputRoot:path.join(f.dir,'out')},f.deps));git(f.root,['update-ref','refs/remotes/origin/main',f.head]);git(f.root,['switch','-c','codex/other']);await assert.rejects(()=>prepareD1({root:f.root},f.deps),/D1_MAIN_REQUIRED/u);assert.deepEqual(await readFile(f.target),f.before);
 }finally{await f.close();}
});
test('CI unavailable/red or changed source/catalog refuses candidate approval and never touches owner files',async()=>{
 const f=await fixture();try{for(const code of ['D1_CI_UNVERIFIED_MANUAL_REVIEW_REQUIRED','D1_CI_NOT_FULL_GREEN']){await assert.rejects(()=>prepareD1({root:f.root,outputRoot:path.join(f.dir,'out')},{...f.deps,ci:async()=>{throw new Error(code);}}),new RegExp(code));}
 await assert.rejects(()=>prepareD1({root:f.root,outputRoot:path.join(f.dir,'out')},{...f.deps,build:async(r:string,c:string,o:string)=>{const b=await f.deps.build(r,c,o);await writeFile(path.join(o,'fresh-incremental-differences.json'),'[{"schema":"public","name":"real_difference"}]');return b;}}),/D1_CATALOG_DIFFERENCE/u);
 assert.deepEqual(await readFile(f.target),f.before);const dirs=await readdir(path.join(f.dir,'out'));assert.equal(dirs.length,1);assert.ok(!(await readdir(path.join(f.dir,'out',dirs[0]))).includes('approval.json'));
 }finally{await f.close();}
});

test('220 preparation refuses the superseded 678-function catalog and preserves the owner reference',async()=>{
 const f=await fixture();try{
  await assert.rejects(()=>prepareD1({root:f.root,outputRoot:path.join(f.dir,'out')},
   {...f.deps,ready:async()=>({...f.ref,functions:678})}),/D1_REFERENCE_NOT_READY/u);
  assert.deepEqual(await readFile(f.target),f.before);
 }finally{await f.close();}
});
test('wrong/short hash,active RESET,test-only candidate and stale main all refuse installation without modifying current reference',async()=>{
 const f=await fixture();try{const r=await prepareD1({root:f.root,outputRoot:path.join(f.dir,'out')},f.deps);const args={root:f.root,candidate:r.candidate,approvedSha256:r.candidateSha256,workdir:f.workdir};
 for(const hash of ['a'.repeat(8),'b'.repeat(64)]){await assert.rejects(()=>installD1({...args,approvedSha256:hash},f.deps));assert.deepEqual(await readFile(f.target),f.before);}
 const oldMarker=path.join(f.workdir,'RESET219_IN_PROGRESS.json');await writeFile(oldMarker,'{}');await assert.rejects(()=>installD1(args,f.deps),/D1_RESET_IN_PROGRESS/u);await rm(oldMarker);const marker=path.join(f.workdir,'RESET220_IN_PROGRESS.json');await writeFile(marker,'{"immutable":"attempt"}');await assert.rejects(()=>installD1(args,f.deps),/D1_RESET_IN_PROGRESS/u);assert.equal(await readFile(marker,'utf8'),'{"immutable":"attempt"}');await rm(marker);
 const p=path.join(r.folder,'approval.json'),proof=JSON.parse(await readFile(p,'utf8'));await writeFile(p,JSON.stringify({...proof,testCandidateOnly:true}));await assert.rejects(()=>installD1(args,f.deps),/D1_CANDIDATE_NOT_APPROVABLE/u);await writeFile(p,JSON.stringify({...proof,source:{...proof.source,mainSha:'b'.repeat(40)}}));await assert.rejects(()=>installD1(args,f.deps),/D1_APPROVED_HEAD_CHANGED/u);assert.deepEqual(await readFile(f.target),f.before);assert.deepEqual(await readdir(f.workdir),[name]);
 }finally{await f.close();}
});
test('failure after atomic replacement rolls back byte-for-byte;incoming corruption refuses before replacement',async()=>{
 const f=await fixture();try{const r=await prepareD1({root:f.root,outputRoot:path.join(f.dir,'out')},f.deps),args={root:f.root,candidate:r.candidate,approvedSha256:r.candidateSha256,workdir:f.workdir};
 await assert.rejects(()=>installD1(args,{...f.deps,ready:async(root:string,file:string)=>{if(file===f.target)throw new Error('D1_TEST_TARGET_READINESS_REJECTED');return f.deps.ready(root,file);}}),/D1_TEST_TARGET_READINESS_REJECTED/u);assert.deepEqual(await readFile(f.target),f.before);
 await assert.rejects(()=>installD1(args,{...f.deps,ready:async(root:string,file:string)=>{if(file.includes('.incoming-'))throw new Error('D1_TEST_INCOMING_REJECTED');return f.deps.ready(root,file);}}),/D1_TEST_INCOMING_REJECTED/u);assert.deepEqual(await readFile(f.target),f.before);assert.ok(!(await readdir(f.workdir)).some(x=>x.includes('.incoming-')||x==='.D1_REFERENCE_INSTALL.lock'));
 await assert.rejects(()=>installD1(args,{...f.deps,ready:async(root:string,file:string)=>{const result=await f.deps.ready(root,file);if(file.includes('.incoming-'))await writeFile(file,'tampered-after-readiness');return result;}}),/D1_INCOMING_HASH_MISMATCH/u);assert.deepEqual(await readFile(f.target),f.before);
 }finally{await f.close();}
});
test('output inside repo or owner workdir and linked folders are refused;no command-line CI bypass',async()=>{
 const f=await fixture();try{await assert.rejects(()=>prepareD1({root:f.root,outputRoot:path.join(f.root,'out')},f.deps),/D1_OUTPUT_INSIDE_REPOSITORY/u);await assert.rejects(()=>prepareD1({root:f.root,outputRoot:path.join(f.dir,'nawasrah-fra-001-138')},f.deps),/D1_OWNER_WORKDIR_REFUSED/u);
 const link=path.join(f.dir,'link');await symlink(f.workdir,link,process.platform==='win32'?'junction':'dir');assert.equal((await lstat(link)).isSymbolicLink(),true);await assert.rejects(()=>externalPath(f.root,path.join(link,'new'),{missing:true}),/D1_LINK_PATH_REFUSED/u);await rm(link);await assert.rejects(()=>d1Main(['prepare','--skip-ci']),/D1_ARGUMENTS_INVALID/u);assert.equal(d1ErrorCode(new Error('token=never-echo-me')),'D1_LOCAL_VALIDATION_FAILED');
 }finally{await f.close();}
});
test('GitHub verification binds remote head/every job/full matrix and never accepts red,skipped,wrong SHA or stale green runs',async()=>{
 const head='a'.repeat(40),names=['Nawasrah code quality','Nawasrah secret scanning','Nawasrah complete backup recovery','Nawasrah lite220 owner tools','Quarantined sales-only phase1'],runs=names.map((name,i)=>({id:i+1,name,head_sha:head,head_branch:'main',event:'push',status:'completed',conclusion:'success'}));
 const job={head_sha:head,status:'completed',conclusion:'success'};let bad:any=null;
 const get=async(route:string)=>route==='git/ref/heads/main'?{object:{sha:bad==='remote'?'b'.repeat(40):head}}:route.startsWith('actions/runs?')?{workflow_runs:bad==='new-red'?[...runs,{...runs[0],id:99,conclusion:'failure'}]:runs}:{jobs:(route.startsWith('actions/runs/4/')?['Literal220 migration and full parity','RESET220 interruption and private fence','Upgrade220 encrypted protection chain','Lite220 owner-size go-live and later activation']:route.startsWith('actions/runs/5/')?predecessor220Jobs:[undefined]).map(name=>({name,...job,...(bad==='wrong-sha'?{head_sha:'b'.repeat(40)}:bad==='skip'?{conclusion:'skipped'}:{})}))};
 let verified=0;assert.equal((await verifyD1Ci('',head,{get,verifyJobs:()=>{verified++;}})).head,head);assert.equal(verified,1);
 for(bad of ['remote','new-red','wrong-sha','skip'])await assert.rejects(()=>verifyD1Ci('',head,{get,verifyJobs:()=>{}}));bad=null;await assert.rejects(()=>verifyD1Ci('',head,{get,verifyJobs:()=>{throw new Error('MISSING_FULL_MATRIX');}}),/D1_CI_NOT_FULL_GREEN/u);
});

test('220 owner state permits only reviewed five-field overlay over HEAD;ceiling or any sixth field drift refuses',async()=>{
 const f=await fixture();try{const filename=path.join(f.root,'docs/agent/project-state.json'),base={migrationCeiling:220,branch:'codex/final-reviewed',retainedGuard:true};await writeFile(filename,JSON.stringify(base));git(f.root,['add','.']);git(f.root,['commit','-m','known220 state']);const head=git(f.root,['rev-parse','HEAD']);git(f.root,['update-ref','refs/remotes/origin/main',head]);
 const fields={ownerAcl212Delivered:true,ownerAcl212DeliveryBaseline:'reviewed',ownerAcl212DeliveryCiRuns:[1,2],ownerAcl212DeliveryEvidence:'local-proof'},known={files:[],ownerStateFieldsSha256:Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,sha256(JSON.stringify(v))]))};
 const actual={...base,branch:'main',...fields};await writeFile(filename,JSON.stringify(actual));assert.equal((await repositoryState(f.root,known)).ownerFiles.length,1);
 for(const value of [{...actual,migrationCeiling:219},{...actual,retainedGuard:false},{...actual,ownerAcl212Delivered:false},{...actual,unapprovedSixthField:true}]){await writeFile(filename,JSON.stringify(value));await assert.rejects(()=>repositoryState(f.root,known),/D1_OWNER_FILE_CHANGED/);}
 assert.deepEqual(await readFile(f.target),f.before);
 }finally{await f.close();}
});

test('D1 refuses missing,duplicated,failed or extra predecessor gate;all8 must bind the reviewed phase2 behavior',()=>{const jobs=predecessor220Jobs.map(name=>({name,conclusion:'success'}));verify220PredecessorJobs(jobs);for(const bad of [jobs.slice(1),[...jobs,jobs[0]],jobs.map((j,i)=>i===0?{...j,conclusion:'failure'}:j),[...jobs.slice(1),{name:'UNKNOWN',conclusion:'success'}]])assert.throws(()=>verify220PredecessorJobs(bad),/D1_CI_NOT_FULL_GREEN/);});

test('D1 reads the latest quality jobs in 50-item pages and rejects a bad or missing second page',async()=>{
 const head='a'.repeat(40);
 const names=['Nawasrah code quality','Nawasrah secret scanning','Nawasrah complete backup recovery','Nawasrah lite220 owner tools','Quarantined sales-only phase1'];
 const runs=names.map((name,i)=>({id:i+1,name,head_sha:head,head_branch:'main',event:'push',status:'completed',conclusion:'success'}));
 const job={head_sha:head,status:'completed',conclusion:'success'};
 const matrix=Array.from({length:61},(_,i)=>({id:i+1,name:'quality-'+i,...job}));
 const qualityPages:string[]=[];
 let lastPage:'good'|'missing'|'failed'|'wrong-sha'='good';
 const get=async(route:string)=>{
  if(route==='git/ref/heads/main')return{object:{sha:head}};
  if(route.startsWith('actions/runs?'))return{workflow_runs:runs};
  const url=new URL(route,'https://api.github.com/');
  assert.equal(url.searchParams.get('filter'),'latest');
  assert.equal(url.searchParams.get('per_page'),'50');
  if(route.startsWith('actions/runs/1/')){
   const page=url.searchParams.get('page');assert.ok(page==='1'||page==='2');
   qualityPages.push(page);
   if(page==='1')return{jobs:matrix.slice(0,50)};
   if(lastPage==='missing')return{jobs:[]};
   return{jobs:matrix.slice(50).map((row,i)=>i!==0||lastPage==='good'?row:
    lastPage==='failed'?{...row,conclusion:'failure'}:{...row,head_sha:'b'.repeat(40)})};
  }
  const gateNames=route.startsWith('actions/runs/4/')?owner220DeliveryJobs:
   route.startsWith('actions/runs/5/')?predecessor220Jobs:['successful gate'];
  return{jobs:gateNames.map(name=>({name,...job}))};
 };
 const verifyJobs=(jobs:typeof matrix)=>assert.deepEqual(jobs,matrix);
 const result=await verifyD1Ci('',head,{get,verifyJobs});
 assert.deepEqual(qualityPages,['1','2']);
 assert.equal(result.runs['Nawasrah code quality'].jobs,61);
 for(const bad of ['missing','failed','wrong-sha'] as const){
  lastPage=bad;
  await assert.rejects(()=>verifyD1Ci('',head,{get,verifyJobs}),/D1_CI_NOT_FULL_GREEN/u);
 }
});
