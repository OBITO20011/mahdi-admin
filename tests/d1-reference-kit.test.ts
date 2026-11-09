import{sourceBeforeSalesOnlyPhase1}from'../scripts/audit/source-before-sales-only-phase1.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm,symlink,lstat} from 'node:fs/promises';
import path from 'node:path';import {tmpdir} from 'node:os';import {execFileSync} from 'node:child_process';
import {prepareD1,installD1,d1ErrorCode,d1Main} from '../scripts/operations/d1-reference-kit.mjs';
import {repositoryState,sha256,externalPath} from '../scripts/operations/d1-reference-state.mjs';
import {verifyD1Ci} from '../scripts/operations/d1-reference-ci.mjs';
import {d1Pins,sourceBeforeD1Kit,restoreD1Hashes,pathsBeforeD1Kit} from '../scripts/audit/source-before-d1-reference-kit.mjs';
const name='local-reference-through219-ready.json';
const git=(root:string,args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
async function fixture(){
 const dir=await mkdtemp(path.join(tmpdir(),'nawasrah-d1-kit-test-')),root=path.join(dir,'repo'),workdir=path.join(dir,'owner');await mkdir(path.join(root,'docs/agent'),{recursive:true});await mkdir(workdir);
 git(root,['init','-b','main']);git(root,['config','user.email','local@example.test']);git(root,['config','user.name','Local']);git(root,['remote','add','origin','https://github.com/OBITO20011/mahdi-admin.git']);
 await writeFile(path.join(root,'docs/agent/project-state.json'),JSON.stringify({migrationCeiling:219}));git(root,['add','.']);git(root,['commit','-m','fixture']);const head=git(root,['rev-parse','HEAD']);git(root,['update-ref','refs/remotes/origin/main',head]);
 const target=path.join(workdir,name),before=Buffer.from('old-owner-reference-byte-proof');await writeFile(target,before);
 const ref={migrationCeiling:219,manifest:Array.from({length:180},(_,i)=>i),functions:636,realtimePublication:{tables:Array.from({length:13},(_,i)=>i)},freshIncrementalDifferenceCount:0,readiness:{queries:181}};
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
test('wrong/short hash,active RESET,test-only candidate and stale main all refuse installation without modifying current reference',async()=>{
 const f=await fixture();try{const r=await prepareD1({root:f.root,outputRoot:path.join(f.dir,'out')},f.deps);const args={root:f.root,candidate:r.candidate,approvedSha256:r.candidateSha256,workdir:f.workdir};
 for(const hash of ['a'.repeat(8),'b'.repeat(64)]){await assert.rejects(()=>installD1({...args,approvedSha256:hash},f.deps));assert.deepEqual(await readFile(f.target),f.before);}
 const marker=path.join(f.workdir,'RESET219_IN_PROGRESS.json');await writeFile(marker,'{"immutable":"attempt"}');await assert.rejects(()=>installD1(args,f.deps),/D1_RESET_IN_PROGRESS/u);assert.equal(await readFile(marker,'utf8'),'{"immutable":"attempt"}');await rm(marker);
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
test('current docs replace obsolete A915 instructions with separate commands;all historical bytes remain exact and unknown edits visible',async()=>{
 const read=async(f:string)=>sourceBeforeSalesOnlyPhase1(f,(await readFile(f,'utf8')).replaceAll('\r\n','\n'))!;
 const guide=await read('docs/operations/RESET219_REFERENCE_D1_AR.md'),kit=await read('docs/operations/D1_REFERENCE_KIT_AR.md');
 assert.match(guide,/A915B64D[\s\S]*لم يعد صالحاً/u);assert.ok(guide.includes('157فحص وصول قديم مقابل181'));
 assert.doesNotMatch(guide,/\$referenceExpectedSha|Copy-Item|Move-Item/u);
 for(const text of ['d1-reference-kit.ps1','d1-reference-install.ps1','ApprovedSha256','RESET219_IN_PROGRESS.json','التوقيع'])assert.ok((kit+guide).includes(text),text);
 for(const ext of ['md','html']){const card=await read('docs/handover/ورقة-يوم-التشغيل.'+ext);assert.ok(card.includes('d1-reference-kit.ps1'));assert.ok(card.includes('d1-reference-install.ps1'));assert.ok(card.includes('D1_REFERENCE_KIT_AR.md'));assert.ok(card.includes('03:00'));}
 const baseline='16ef354cb5ecab7e8689975b6d1c7ba3fadbed24';assert.equal(d1Pins.baseline,baseline);
 for(const[file,pin]of Object.entries(d1Pins.entries)as[string,{before:string|null;after:string}][]){const raw=await read(file);assert.equal(sha256(raw),pin.after,file);const expected=pin.before===null?null:git(process.cwd(),['show',baseline+':'+file])+'\n';assert.equal(sourceBeforeD1Kit(file,raw)?.trimEnd()??null,expected?.trimEnd()??null,file);const unknown=raw+'\nUNKNOWN_D1_MUTATION';assert.equal(sourceBeforeD1Kit(file,unknown),unknown,file);assert.deepEqual(restoreD1Hashes([{file,sha256:'unknown'}]),[{file,sha256:'unknown'}]);}
 const protectedFiles=JSON.parse(await read('scripts/testing/rehearsal219-owner-source-pins.json')).files.map((r:[string,string])=>r[0]);
 for(const file of protectedFiles)assert.equal((await read(file)).trimEnd(),git(process.cwd(),['show',baseline+':'+file]).replaceAll('\r\n','\n').trimEnd(),file);
 assert.deepEqual(pathsBeforeD1Kit(git(process.cwd(),['diff','--name-only',baseline,'--','supabase']).split('\n').filter(Boolean),baseline),[]);
 assert.deepEqual(pathsBeforeD1Kit(['scripts/operations/unreviewed.mjs']),['scripts/operations/unreviewed.mjs']);
 assert.deepEqual(pathsBeforeD1Kit(['scripts/operations/d1-known-owner-files.json']),[]);
 for(const f of ['scripts/operations/d1-reference-kit.ps1','scripts/operations/d1-reference-install.ps1']){const ps=await read(f);assert.doesNotMatch(ps,/RunAs|Administrator|Start-Process|ConvertTo-SecureString|PGPASSWORD|Invoke-WebRequest|Invoke-RestMethod/u);}
});
test('output inside repo or owner workdir and linked folders are refused;no command-line CI bypass',async()=>{
 const f=await fixture();try{await assert.rejects(()=>prepareD1({root:f.root,outputRoot:path.join(f.root,'out')},f.deps),/D1_OUTPUT_INSIDE_REPOSITORY/u);await assert.rejects(()=>prepareD1({root:f.root,outputRoot:path.join(f.dir,'nawasrah-fra-001-138')},f.deps),/D1_OWNER_WORKDIR_REFUSED/u);
 const link=path.join(f.dir,'link');await symlink(f.workdir,link,process.platform==='win32'?'junction':'dir');assert.equal((await lstat(link)).isSymbolicLink(),true);await assert.rejects(()=>externalPath(f.root,path.join(link,'new'),{missing:true}),/D1_LINK_PATH_REFUSED/u);await rm(link);await assert.rejects(()=>d1Main(['prepare','--skip-ci']),/D1_ARGUMENTS_INVALID/u);assert.equal(d1ErrorCode(new Error('token=never-echo-me')),'D1_LOCAL_VALIDATION_FAILED');
 }finally{await f.close();}
});
test('GitHub verification binds remote head/every job/full matrix and never accepts red,skipped,wrong SHA or stale green runs',async()=>{
 const head='a'.repeat(40),names=['Nawasrah code quality','Nawasrah secret scanning','Nawasrah complete backup recovery'],runs=names.map((name,i)=>({id:i+1,name,head_sha:head,head_branch:'main',event:'push',status:'completed',conclusion:'success'}));
 const job={head_sha:head,status:'completed',conclusion:'success'};let bad:any=null;
 const get=async(route:string)=>route==='git/ref/heads/main'?{object:{sha:bad==='remote'?'b'.repeat(40):head}}:route.startsWith('actions/runs?')?{workflow_runs:bad==='new-red'?[...runs,{...runs[0],id:99,conclusion:'failure'}]:runs}:{jobs:[{...job,...(bad==='wrong-sha'?{head_sha:'b'.repeat(40)}:bad==='skip'?{conclusion:'skipped'}:{})}]};
 let verified=0;assert.equal((await verifyD1Ci('',head,{get,verifyJobs:()=>{verified++;}})).head,head);assert.equal(verified,1);
 for(bad of ['remote','new-red','wrong-sha','skip'])await assert.rejects(()=>verifyD1Ci('',head,{get,verifyJobs:()=>{}}));bad=null;await assert.rejects(()=>verifyD1Ci('',head,{get,verifyJobs:()=>{throw new Error('MISSING_FULL_MATRIX');}}),/D1_CI_NOT_FULL_GREEN/u);
});
