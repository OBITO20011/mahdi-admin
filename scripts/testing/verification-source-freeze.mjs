import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,lstat,readlink} from 'node:fs/promises';
import path from 'node:path';

/** Hash source bytes, not only Git path/status. Does not read ignored env files. */
export async function readVerificationSourceFreeze(root) {
 const bytes=execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root,windowsHide:true,maxBuffer:16*1024**2});
 const paths=[...new Set(bytes.toString('utf8').split('\0').filter(Boolean))].sort();
 const rows=[];
 for(const relative of paths){
  const absolute=path.resolve(root,relative),within=path.relative(path.resolve(root),absolute);
  assert.ok(within&&!within.startsWith('..'+path.sep)&&!path.isAbsolute(within),'VERIFICATION_SOURCE_OUTSIDE_ROOT');
  let stat;try{stat=await lstat(absolute);}catch(e){if(e.code==='ENOENT'){rows.push([relative,'DELETED']);continue;}throw e;}
  // Source-control metadata is sufficient for env examples; never read values.
  if(path.basename(relative).startsWith('.env')){rows.push([relative,'ENV_VALUES_UNREAD',stat.size,stat.mtimeMs]);continue;}
  const content=stat.isSymbolicLink()?Buffer.from(await readlink(absolute)):stat.isFile()?await readFile(absolute):Buffer.from('DIRECTORY');
  rows.push([relative,createHash('sha256').update(content).digest('hex')]);
 }
 return {sha256:createHash('sha256').update(JSON.stringify(rows)).digest('hex'),fileCount:rows.length,rows};
}
export function assertVerificationSourceFreeze(before,after){
 assert.equal(after.fileCount,before.fileCount,'REPOSITORY_CHANGED_DURING_VERIFICATION');
 assert.equal(after.sha256,before.sha256,'REPOSITORY_CHANGED_DURING_VERIFICATION');
}