// Historical223 owner contract, byte-for-byte at its last approved main.
// Current224 Backup/Restore of actual223 is proved separately by the224 job.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,symlink,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {readVerificationSourceFreeze,assertVerificationSourceFreeze} from './verification-source-freeze.mjs';
const baseline='3b35a263f7c20212c537bb61b2d20af778b7613d';
const ceiling=process.argv.length===2?223:process.argv.length===4&&process.argv[2]==='--ceiling'&&process.argv[3]==='222'?222:null;
assert.ok(ceiling!==null,'LEGACY223_NO_TARGET_ARGUMENTS');
const root=path.resolve(import.meta.dirname,'../..'),output=await mkdtemp(path.join(tmpdir(),'nawasrah-inventory224-legacy'+ceiling+'-')),copy=path.join(output,'source');
const exec=promisify(execFile),report={ok:false,baseline,ceiling,output,hostedAccess:false,ownerDemoAccess:false,commands:[]};
try{
 const freeze=await readVerificationSourceFreeze(root);
 await exec('git',['clone','--shared','--no-checkout',root,copy],{windowsHide:true,maxBuffer:8*1024**2});
 // A standalone Windows clone otherwise inherits system autocrlf=true while
 // the approved source repository explicitly uses false. Raw SQL bodies must
 // be the literal Git bytes, not CRLF definitions accepted by a clean index.
 await exec('git',['config','--local','core.autocrlf','false'],{cwd:copy,windowsHide:true});
 await exec('git',['config','--local','core.eol','lf'],{cwd:copy,windowsHide:true});
 await exec('git',['checkout','--detach',baseline],{cwd:copy,windowsHide:true,maxBuffer:8*1024**2});
 assert.equal((await exec('git',['rev-parse','HEAD'],{cwd:copy,windowsHide:true})).stdout.trim(),baseline);
 assert.equal((await exec('git',['status','--porcelain'],{cwd:copy,windowsHide:true})).stdout,'');
 const sqlFile='supabase/migrations/223_optional_sales_quantity.sql';
 assert.equal(await readFile(path.join(copy,sqlFile),'utf8'),(await exec('git',['show',baseline+':'+sqlFile],{cwd:copy,windowsHide:true,maxBuffer:16*1024**2})).stdout,'LEGACY223_LITERAL_SQL_BYTES_REQUIRED');
 await symlink(path.join(root,'node_modules'),path.join(copy,'node_modules'),process.platform==='win32'?'junction':'dir');
 const evidence=path.join(output,'evidence');await mkdir(evidence);
 const reference=path.join(evidence,'local-reference-through'+ceiling+'-ready.json');
 const commands=[['scripts/operations/build-acl-reference'+ceiling+'.mjs','--output',reference],['scripts/testing/run-owner-upgrade'+ceiling+'-runtime.mjs',reference],['scripts/testing/run-reset'+ceiling+'-runtime.mjs',reference]];
 for(const args of commands){
  const began=performance.now();
  const result=await exec(process.execPath,args,{cwd:copy,windowsHide:true,maxBuffer:32*1024**2});
  await writeFile(path.join(output,path.basename(args[0])+'.log'),result.stdout+'\n'+result.stderr);
  const final=JSON.parse(result.stdout.trim().split(/\r?\n/u).at(-1));assert.equal(final.ok,true,'HISTORICAL223_GATE_FAILED:'+args[0]);
  report.commands.push({script:args[0],ok:true,elapsedMs:Math.round(performance.now()-began)});
 }
 const upgrade=JSON.parse(await readFile(path.join(copy,'test-results/owner-upgrade'+ceiling+'/report.json'),'utf8'));
 const reset=JSON.parse(await readFile(path.join(copy,'test-results/reset'+ceiling+'/report.json'),'utf8'));
 assert.equal(upgrade.ok,true);assert.equal(reset.ok,true);assert.equal(reset.files,ceiling===223?183:182);assert.equal(reset.cases.length,ceiling===223?12:6);
 assertVerificationSourceFreeze(freeze,await readVerificationSourceFreeze(root));
 Object.assign(report,{ok:true,allHistoricalAssertionsUnchanged:true,currentSourceUnchanged:true,upgrade,reset});
}catch(error){report.error=String(error.message).slice(0,1500);process.exitCode=1;}
const mirror=path.join(root,'test-results/inventory224-legacy'+ceiling);await mkdir(mirror,{recursive:true});
await writeFile(path.join(mirror,'report.json'),JSON.stringify(report,null,2)+'\n');
await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({ok:report.ok,baseline,output,error:report.error,commands:report.commands}));
