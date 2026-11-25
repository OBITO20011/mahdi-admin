import {sourceBeforeOnCutover225} from '../audit/source-before-on-cutover225.mjs';
// Real current-head commands and original merge builders. Local Docker only.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,mkdtemp,symlink,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {sha256} from './maintenance-db-contract.mjs';
import {readVerificationSourceFreeze,assertVerificationSourceFreeze} from './verification-source-freeze.mjs';
import {upgradeReferenceOrigins} from '../operations/upgrade-versioned-reference.mjs';
import {operationalManifest,operationalSchema} from '../operations/operational-schema.mjs';
import {withLegacy224OwnerTools} from './legacy224-owner-tools.mjs';
import {OLD_REF} from '../operations/frankfurt-owner-build.mjs';
import {cutoverCommandDocuments,documentedCutoverCommands,classifyCutoverCommand} from './cutover-command-contract.mjs';

assert.equal(process.argv.length,3,'SUPPORTED_UPGRADES224_READY_REFERENCE_ARGUMENT_REQUIRED');
const root=path.resolve(import.meta.dirname,'../..'),output=await mkdtemp(path.join(tmpdir(),'nawasrah-supported-upgrades224-'));
const exec=promisify(execFile),workdir=path.join(output,'offline-workdir'),report={ok:false,output,hostedAccess:false,ownerDemoAccess:false,referenceProofs:[],commands:[]};
const save=(name,value)=>writeFile(path.join(output,name),JSON.stringify(value,null,2)+'\n');
const run=async(cwd,args,label,env=process.env)=>{
 const start=performance.now();
 try{const r=await exec(process.execPath,args,{cwd,env,windowsHide:true,maxBuffer:32*1024**2});
  await writeFile(path.join(output,label+'.log'),r.stdout+'\n'+r.stderr);return{...r,elapsedMs:Math.round(performance.now()-start)};
 }catch(error){await writeFile(path.join(output,label+'.log'),String(error.stdout??'')+'\n'+String(error.stderr??''));throw Error('SUPPORTED_UPGRADE_COMMAND_FAILED:'+label,{cause:error});}
};
let createdOldLink=false;
try{
 const freeze=await readVerificationSourceFreeze(root);
 await mkdir(workdir);
 for(const version of [222,223]){
  const pin=upgradeReferenceOrigins[version],original=path.join(output,'original'+version),originalReference=path.join(output,'original-ready'+version),currentReference=path.join(workdir,`local-reference-through${version}-ready.json`);
  await exec('git',['clone','--shared','--no-checkout',root,original],{windowsHide:true,maxBuffer:8*1024**2});
  for(const[key,value]of [['core.autocrlf','false'],['core.eol','lf']])await exec('git',['config','--local',key,value],{cwd:original,windowsHide:true});
  await exec('git',['checkout','--detach',pin.commit],{cwd:original,windowsHide:true,maxBuffer:8*1024**2});
  assert.equal((await exec('git',['status','--porcelain'],{cwd:original,windowsHide:true})).stdout,'');
  assert.equal(sha256(await readFile(path.join(original,'supabase/migrations',pin.migration))),pin.migrationSha256);
  assert.deepEqual(await readFile(path.join(original,'supabase/migrations',pin.migration)),await readFile(path.join(root,'supabase/migrations',pin.migration)));
  await symlink(path.join(root,'node_modules'),path.join(original,'node_modules'),process.platform==='win32'?'junction':'dir');
  await mkdir(originalReference);
  const oldTarget=path.join(originalReference,`local-reference-through${version}-ready.json`),script=`scripts/operations/build-acl-reference${version}.mjs`;
  const before=await run(original,[script,'--output',oldTarget],'original'+version);
  const after=await run(root,[script,'--output',currentReference],'current'+version);
  const originalSha256=sha256(await readFile(oldTarget)),currentSha256=sha256(await readFile(currentReference));
  assert.equal(currentSha256,originalSha256,'SUPPORTED_UPGRADE_ORIGINAL_REFERENCE_SHA_MISMATCH:'+version);
  report.referenceProofs.push({version,originalCommit:pin.commit,migrationSha256:pin.migrationSha256,originalSha256,currentSha256,originalElapsedMs:before.elapsedMs,currentElapsedMs:after.elapsedMs});
 }
 await writeFile(path.join(workdir,'local-reference-through224-ready.json'),await readFile(path.resolve(process.argv[2])),{flag:'wx'});
 const holdRuntime=await run(root,['scripts/testing/run-owner-upgrade222-runtime.mjs',path.join(workdir,'local-reference-through222-ready.json')],'current-owner222-hold');
 const holdProof=JSON.parse(await readFile(path.join(root,'test-results/owner-upgrade222/report.json'),'utf8'));
 assert.equal(holdProof.ok,true,'CURRENT220_HOLD_RUNTIME_REQUIRED');
 assert.deepEqual(holdProof.cutoverHold,{dryRunReadOnly:true,malformedInventoryRejected:true,ordersClosed:true,allSixInactive:true,repeatedNoOp:true});
 report.holdUpgradeProof={...holdProof.cutoverHold,elapsedMs:holdRuntime.elapsedMs,ok:true};
 const documents=Object.fromEntries(await Promise.all(cutoverCommandDocuments.map(async name=>{const file='docs/operations/'+name+'.md';return [name,sourceBeforeOnCutover225(file,await readFile(path.join(root,file),'utf8'))];})));
 const commands=documentedCutoverCommands(documents),classifications=commands.map(row=>({...row,...classifyCutoverCommand(row.command)}));
 const oldLink=path.join(root,'supabase/.temp/project-ref');
 try{assert.equal((await readFile(oldLink,'utf8')).trim(),OLD_REF);}catch(error){if(error.code!=='ENOENT')throw error;await mkdir(path.dirname(oldLink),{recursive:true});await writeFile(oldLink,OLD_REF+'\n',{flag:'wx'});createdOldLink=true;}
 const guard=path.join(output,'offline-network.cjs');
 await writeFile(guard,`const deny=()=>{throw Error('OFFLINE_NETWORK_OR_SUBPROCESS_FORBIDDEN')};global.fetch=deny;for(const n of ['node:http','node:https']){const m=require(n);m.request=deny;m.get=deny;}const net=require('node:net');net.connect=deny;net.createConnection=deny;net.Socket.prototype.connect=deny;const dns=require('node:dns');dns.lookup=deny;dns.resolve=deny;const cp=require('node:child_process');for(const k of ['exec','execFile','execSync','execFileSync','spawn','spawnSync','fork'])cp[k]=deny;require('node:module').syncBuiltinESMExports();\n`);
 const executed=new Map();
 for(const row of classifications){
  if(row.kind==='offline'){
   const key=[row.script,row.mode,row.phase].filter(Boolean).join(':');
   if(!executed.has(key)){
    const runOffline=cwd=>run(cwd,['--require',guard,row.script,...(row.phase?[row.phase]:[]),row.mode,'--workdir',workdir],'offline-'+path.basename(row.script)+(row.phase??''),{...process.env,NODE_OPTIONS:''});
    const historicalReset=[225,226].includes(operationalSchema.ceiling)&&row.script==='scripts/operations/frankfurt-owner-reset224.mjs';
    if(historicalReset){assert.equal(row.mode,'--plan');await operationalManifest();}
    const result=historicalReset?await withLegacy224OwnerTools(root,runOffline):await runOffline(root);
    const final=JSON.parse(result.stdout.trim().split(/\r?\n/u).at(-1));assert.equal(final.ok,true,'CUTOVER_OFFLINE_COMMAND_REJECTED:'+key);
    executed.set(key,{ok:true,elapsedMs:result.elapsedMs});
   }
   report.commands.push({...row,...executed.get(key)});
  }else report.commands.push({...row,executed:false});
 }
 for(const phase of ['upgrade','reset'])assert.ok(executed.has(`scripts/operations/frankfurt-owner-cutover-hold224.mjs:--plan:--hold-${phase}`),'CUTOVER_HOLD_PLAN_NOT_EXECUTED:'+phase);
 for(const version of [222,223,224])assert.ok(executed.has(`scripts/operations/frankfurt-owner-upgrade${version}.mjs:--dry-run`),'CUTOVER_UPGRADE_NOT_EXECUTED:'+version);
 assert.ok(executed.has('scripts/operations/frankfurt-owner-reset224.mjs:--plan'),'CUTOVER_RESET224_NOT_EXECUTED');
 for(const version of [222,223]){
  const file=path.join(workdir,`local-reference-through${version}-ready.json`),original=await readFile(file,'utf8'),bad=JSON.parse(original);
  bad.manifestDigest='0'.repeat(64);
  try{
   await writeFile(file,JSON.stringify(bad));
   await assert.rejects(()=>exec(process.execPath,['--require',guard,`scripts/operations/frankfurt-owner-upgrade${version}.mjs`,'--dry-run','--workdir',workdir],{cwd:root,env:{...process.env,NODE_OPTIONS:''},windowsHide:true,maxBuffer:16*1024**2}),
    error=>error.code===1&&String(error.stderr).trim()==='UPGRADE_PREPARATION_ASSERTION_FAILED','CUTOVER_MODIFIED_REFERENCE_MUST_FAIL:'+version);
   report.commands.push({command:`upgrade${version} with changed reference manifest commitment`,ok:true,expectedRejection:true,networkForbidden:true});
  }finally{await writeFile(file,original);}
 }
 if(createdOldLink){await unlink(oldLink);createdOldLink=false;}
 assertVerificationSourceFreeze(freeze,await readVerificationSourceFreeze(root));
 report.ok=true;
}catch(error){report.error=String(error.message);process.exitCode=1;}
finally{
 if(createdOldLink)await unlink(path.join(root,'supabase/.temp/project-ref'));
 await save('report.json',report);
 const mirror=path.join(root,'test-results/supported-upgrades224');await mkdir(mirror,{recursive:true});
 await writeFile(path.join(mirror,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}
