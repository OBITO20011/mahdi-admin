// Disposable current-head view with ONLY the approved #58 flag transition.
// Never edits #58,owner checkout,env files,or invokes an upload command.
import assert from'node:assert/strict';
import{execFile}from'node:child_process';import{promisify}from'node:util';
import{mkdtemp,readFile,writeFile,symlink,lstat,unlink,readdir,realpath,rm}from'node:fs/promises';
import path from'node:path';import{tmpdir}from'node:os';import{randomUUID,createHash}from'node:crypto';
import{buildRehearsal220Apps}from'./rehearsal220-builds.mjs';
const exec=promisify(execFile),prefix='nawasrah-lite220-closed-',markerName='.closed-trial220.json';
const noLinks=async dir=>{for(const e of await readdir(dir,{withFileTypes:true})){const s=await lstat(path.join(dir,e.name));assert.equal(s.isSymbolicLink(),false,'CLOSED_VIEW_UNEXPECTED_LINK');if(s.isDirectory())await noLinks(path.join(dir,e.name));}};
export async function proveClosedTrial220(c){
 const root=path.resolve(c.root),parent=await realpath(tmpdir()),temp=await mkdtemp(path.join(parent,prefix)),nonce=randomUUID(),git=(args,cwd=root)=>exec('git',args,{cwd,windowsHide:true,maxBuffer:16*1024**2});let result;
 const head=(await git(['rev-parse','HEAD'])).stdout.trim();
 try{
  // clone into a child:the outer marker survives any failed Git operation.
  await writeFile(path.join(temp,markerName),JSON.stringify({root,temp,head,nonce}));const view=path.join(temp,'source');
  await git(['clone','--shared','--no-checkout',root,view]);await git(['config','core.autocrlf','false'],view);await git(['read-tree',head],view);await git(['checkout-index','--all'],view);
  assert.equal((await git(['rev-parse','HEAD'],view)).stdout.trim(),head);
  const flag='scripts/environments/prelaunch-trial-control.mjs',before=await readFile(path.join(view,flag),'utf8');assert.equal(before.split('PRELAUNCH_TRIAL_OPEN=true').length,2,'CLOSED_VIEW_EXACT_SOURCE');
  await writeFile(path.join(view,flag),before.replace('PRELAUNCH_TRIAL_OPEN=true','PRELAUNCH_TRIAL_OPEN=false'));
  for(const p of['node_modules','customer-web/node_modules'])await symlink(path.join(root,p),path.join(view,p),process.platform==='win32'?'junction':'dir');
  const refused=[];
  for(const app of['admin','customer'])for(const[gate,args]of[
   ['build',['scripts/environments/run-context.mjs','prelaunch-trial',app]],
   ['verify',['scripts/environments/verify-dist.mjs',app,'prelaunch-trial',app==='admin'?'dist':'customer-web/dist']],
   ['deploy-check',['scripts/deployment/deploy-prelaunch-trial.mjs',app,'--check']]
  ]){await assert.rejects(()=>exec(process.execPath,args,{cwd:view,windowsHide:true,maxBuffer:2*1024**2}),e=>{assert.notEqual(e.code,0);assert.match(e.stderr,/PRELAUNCH_TRIAL_CLOSED/u);return true;});refused.push(app+':'+gate);}
  const production=await buildRehearsal220Apps({...c,root:view,empty:true,admin:true});
  const changed=(await git(['diff','--name-only'],view)).stdout.trim().replaceAll('\\','/');assert.equal(changed,flag,'CLOSED_VIEW_ONLY_FLAG_CHANGED');
  result={closedTrial:true,flagSourceSha256:createHash('sha256').update(before).digest('hex'),sameHead:head,refused,production,localOnly:true,deployment:false,pr58Modified:false};
 }finally{
  assert.equal(path.dirname(path.resolve(temp)),parent);assert.ok(path.basename(temp).startsWith(prefix));assert.equal(await realpath(temp),temp);const m=JSON.parse(await readFile(path.join(temp,markerName),'utf8'));assert.equal(m.root,root);assert.equal(m.temp,temp);assert.equal(m.nonce,nonce);assert.equal(m.head,head);
  for(const p of['node_modules','customer-web/node_modules']){const target=path.join(temp,'source',p),s=await lstat(target).catch(e=>e.code==='ENOENT'?null:Promise.reject(e));if(s){assert.equal(s.isSymbolicLink(),true,'CLOSED_VIEW_DEPENDENCY_LINK_REQUIRED');await unlink(target);}}
  await noLinks(temp);await rm(temp,{recursive:true,force:true});
 }
 return{...result,temporaryViewCleaned:true};
}
