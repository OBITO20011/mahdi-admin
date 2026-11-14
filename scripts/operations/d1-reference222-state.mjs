import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,lstat,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export const git=(root,args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:32*1024**2}).trim();
export function requireD1(condition,code){assert.ok(condition,code);}
export async function ordinaryPath(filename,{missing=false}={}){
 const absolute=path.resolve(filename);let cursor=absolute;
 for(;;){let st;try{st=await lstat(cursor);}catch(e){if(e.code==='ENOENT'&&missing){cursor=path.dirname(cursor);continue;}throw e;}
  requireD1(!st.isSymbolicLink(),'D1_LINK_PATH_REFUSED');const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;
 }return absolute;
}
export async function externalPath(root,filename,{missing=false}={}){
 const absolute=await ordinaryPath(filename,{missing});const actualRoot=await realpath(root),relative=path.relative(actualRoot,absolute);
 requireD1(relative&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative)?false:true,'D1_OUTPUT_INSIDE_REPOSITORY');
 requireD1(absolute!==actualRoot,'D1_OUTPUT_INSIDE_REPOSITORY');return absolute;
}
export async function repositoryState(root,known){
 root=await realpath(root);requireD1(git(root,['rev-parse','--show-toplevel']).replaceAll('\\','/').toLowerCase()===root.replaceAll('\\','/').toLowerCase(),'D1_REPOSITORY_ROOT_REQUIRED');
 requireD1(git(root,['branch','--show-current'])==='main','D1_MAIN_REQUIRED');
 const head=git(root,['rev-parse','HEAD']);requireD1(head===git(root,['rev-parse','origin/main']),'D1_ORIGIN_MAIN_MISMATCH');
 requireD1(git(root,['remote','get-url','origin'])==='https://github.com/OBITO20011/mahdi-admin.git','D1_ORIGIN_NOT_APPROVED');
 const rows=execFileSync('git',['-c','core.quotepath=false','status','--porcelain=v1','-z','--untracked-files=all'],{cwd:root,encoding:'utf8',windowsHide:true}).split('\0').filter(Boolean);
 const approved=new Map(known.files.map(p=>[p.file,p.sha256])),ownerFiles=[];
 for(const row of rows){requireD1([' M','??'].includes(row.slice(0,2)),'D1_DIRTY_TREE_REFUSED');const file=row.slice(3);if(file==='docs/agent/project-state.json'){await ordinaryPath(path.join(root,file));const actual=JSON.parse(await readFile(path.join(root,file),'utf8')),base=JSON.parse(git(root,['show','HEAD:'+file])),overlay=known.ownerStateFieldsSha256;requireD1(overlay&&Object.keys(overlay).length===4&&Object.keys(overlay).every(k=>k.startsWith('ownerAcl212')),'D1_OWNER_POLICY_REQUIRED');requireD1(actual.branch==='main','D1_OWNER_FILE_CHANGED');for(const[key,valueHash]of Object.entries(overlay)){requireD1(sha256(JSON.stringify(actual[key]))===valueHash,'D1_OWNER_FILE_CHANGED');delete actual[key];delete base[key];}actual.branch=base.branch;requireD1(JSON.stringify(actual)===JSON.stringify(base),'D1_OWNER_FILE_CHANGED');ownerFiles.push({file,sha256:sha256(await readFile(path.join(root,file)))});continue;}requireD1(approved.has(file),'D1_DIRTY_TREE_REFUSED');
  await ordinaryPath(path.join(root,file));const bytes=await readFile(path.join(root,file));const digest=sha256(bytes);requireD1(digest===approved.get(file),'D1_OWNER_FILE_CHANGED');ownerFiles.push({file,sha256:digest});}
 const state=JSON.parse(await readFile(path.join(root,'docs/agent/project-state.json'),'utf8'));requireD1(state.migrationCeiling===222,'D1_CEILING222_REQUIRED');
 return {root,head,ownerFiles:ownerFiles.sort((a,b)=>a.file.localeCompare(b.file))};
}
