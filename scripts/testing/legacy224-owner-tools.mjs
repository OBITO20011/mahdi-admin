// Test-only checkout for retired owner command admission. No linked project.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,lstat,readFile,realpath,rm,symlink,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {sha256} from './maintenance-db-contract.mjs';

const exec=promisify(execFile);
const baseline='78f47ccdd7698cf95ee69dc1ae05ba2fd53da301';
const prefix='nawasrah-legacy224-owner-tools-';

// Test fixture only: preserve every historical guard/assertion while holding
// scheduled monitoring before its read-only DDL no-write fingerprint proof.
export function legacy224HeldDdlFixture(text){
 assert.equal(sha256(text),'de500c179cf4dc6ad40bce56246034aa256b0dbf95291ad7a962bacc781cea74','LEGACY224_DDL_FIXTURE_SOURCE_CHANGED');
 const hold=' await hold217Notifications(executor,await readNotificationSnapshot(executor));';
 const proof=' report.ddlCapability=await proveReset224DdlCapability(local,output);';
 assert.equal(text.split(hold).length,2);
 assert.equal(text.split(proof).length,2);
 return text.replace(hold+'\n','').replace(proof,hold+'\n'+proof);
}

export async function withLegacy224OwnerTools(root,run){
 const temporary=await realpath(tmpdir());
 const checkout=await mkdtemp(path.join(temporary,prefix));
 const dependencies=path.join(checkout,'node_modules');
 let linked=false;
 try{
  await exec('git',['merge-base','--is-ancestor',baseline,'HEAD'],{cwd:root,windowsHide:true});
  await exec('git',['clone','--shared','--no-checkout',root,checkout],{windowsHide:true});
  const runGit=args=>exec('git',args,{cwd:checkout,windowsHide:true});
  await runGit(['config','--local','core.autocrlf','false']);
  await runGit(['config','--local','core.eol','lf']);
  await runGit(['checkout','--detach',baseline]);
  assert.equal((await runGit(['rev-parse','HEAD'])).stdout.trim(),baseline);
  assert.equal((await runGit(['status','--porcelain'])).stdout,'');
  for(const adapter of ['frankfurt-owner-upgrade220','frankfurt-owner-reset220','frankfurt-owner-reset224']){
   const file='scripts/operations/'+adapter+'.mjs';
   assert.deepEqual(await readFile(path.join(root,file)),await readFile(path.join(checkout,file)),'LEGACY224_OWNER_ADAPTER_CHANGED:'+adapter);
  }
  await symlink(path.join(root,'node_modules'),dependencies,process.platform==='win32'?'junction':'dir');
  linked=true;
  return await run(checkout);
 }finally{
  assert.equal(path.dirname(await realpath(checkout)),temporary);
  assert.ok(path.basename(checkout).startsWith(prefix));
  assert.ok(!(await lstat(checkout)).isSymbolicLink());
  if(linked){assert.ok((await lstat(dependencies)).isSymbolicLink());await unlink(dependencies);}
  await rm(checkout,{recursive:true,force:true});
 }
}
