import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {lstat,symlink,unlink,rmdir,readdir} from 'node:fs/promises';
import path from 'node:path';
const exec=promisify(execFile),closedSha='e1e35a5f5eb362c074e62872c3a88d70ba2c6a89';
export async function createClosedRehearsalTree({root,output,target}){
 assert.equal(path.resolve(target),path.join(path.resolve(output),'closed-tree'),'REHEARSAL_TEMP_TREE_LOCATION_REQUIRED');
 await assert.rejects(()=>lstat(target),{code:'ENOENT'},'REHEARSAL_TEMP_TREE_MUST_BE_NEW');
 await exec('git',['worktree','add','--detach',target,closedSha],{cwd:root,windowsHide:true});
 const links=[];
 const remove=async()=>{
  assert.equal((await exec('git',['rev-parse','HEAD'],{cwd:target,windowsHide:true})).stdout.trim(),closedSha);
  for(const link of links){assert.equal((await lstat(link)).isSymbolicLink(),true,'REHEARSAL_DEPENDENCY_LINK_CHANGED');
   try{await unlink(link);}catch(e){if(!['EPERM','EISDIR'].includes(e.code))throw e;assert.equal((await lstat(link)).isSymbolicLink(),true);await rmdir(link);}}
  const noLinks=async dir=>{for(const e of await readdir(dir,{withFileTypes:true})){assert.equal(e.isSymbolicLink(),false,'REHEARSAL_UNEXPECTED_LINK_DO_NOT_RECURSIVELY_DELETE');if(e.isDirectory()&&e.name!=='.git')await noLinks(path.join(dir,e.name));}};
  await noLinks(target);
  await exec('git',['worktree','remove','--force',target],{cwd:root,windowsHide:true});
 };
 try{
  for(const rel of ['node_modules','customer-web/node_modules']){const link=path.join(target,rel);await symlink(path.join(root,rel),link,process.platform==='win32'?'junction':'dir');links.push(link);}
  return {remove};
 }catch(error){await remove();throw error;}
}
