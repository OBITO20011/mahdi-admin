// Test-only transport. No URL, project link, credential, owner CLI or reset-core edits.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {lstat,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {Rehearsal219Session} from './rehearsal219-session.mjs';
import {assertActiveRehearsal219} from '../backup/complete-backup.mjs';
import {sqlLiteral as q} from '../operations/trial-reset-core.mjs';
const exec=promisify(execFile);
export function rehearsalSqlFailureCode(stderr){
 return /ERROR:\s+must be owner of table objects(?:\r?\n|$)/u.test(stderr)?'STORAGE_OBJECTS_OWNERSHIP_REQUIRED':'LOCAL_SQL_REJECTED';
}
export function assertRehearsalTarget(context,observed){
  assert.match(context.containerId,/^[a-f0-9]{64}$/u,'REHEARSAL_CONTAINER_ID_REQUIRED');
  assert.match(context.archiveSha256,/^[a-f0-9]{64}$/u,'REHEARSAL_ARCHIVE_HASH_REQUIRED');
  assert.equal(context.projectRef,'kzevmysfydaslxcerogt');assert.equal(context.ceiling,219);assert.equal(context.files,180);
  assert.equal(context.databasePort,5432,'REHEARSAL_SUPABASE_INTERNAL_PORT_REQUIRED');
  assert.equal(observed.Id,context.containerId,'REHEARSAL_CONTAINER_CHANGED');
  assert.equal(observed.Name,'/'+context.containerName,'REHEARSAL_CONTAINER_NAME_CHANGED');
  assert.equal(observed.HostConfig.NetworkMode,'none','REHEARSAL_NETWORK_MUST_BE_NONE');
  assert.deepEqual(observed.Mounts,[],'REHEARSAL_LIVE_VOLUMES_FORBIDDEN');
  assert.equal(observed.State.Running,true,'REHEARSAL_CONTAINER_NOT_RUNNING');
}
export async function rehearsal219Executor(context){
  assertActiveRehearsal219(context);
  const inspected=JSON.parse((await exec('docker',['inspect',context.containerId],{windowsHide:true})).stdout)[0];
  assertRehearsalTarget(context,inspected);
  const args=Object.freeze(['exec','-i',context.containerId,'psql','-h','/tmp/socket','-p','5432','-U','postgres','-d','postgres','-X','-q','-At','-w','-v','ON_ERROR_STOP=1']);
  const sessions=new Map();
  const sessionFor=token=>{let s=sessions.get(token);if(!s||s.closed){s=new Rehearsal219Session(args);sessions.set(token,s);}return s;};
  const base={command:'docker',args,localOnly:true,
    localExecute:async(input,token='')=>{
      assertActiveRehearsal219(context);
      try{return await sessionFor(token).query(`ROLLBACK;RESET ROLE;RESET ALL;SET reset214.writer=${q(token)};\n${input}`);}
      catch{return {code:1,stdout:'',stderr:'REHEARSAL_LOCAL_SQL_FAILED'};}
    },
    closeLocal:async()=>{for(const s of sessions.values())await s.close();sessions.clear();},
  };
  return Object.freeze(base);
}
export const allowedRehearsalRequest=url=>{
  const u=new URL(url);
  return ['http:','https:'].includes(u.protocol)&&['127.0.0.1','localhost','[::1]'].includes(u.hostname);
};
export function installRehearsalNetworkGuard(){
  const original=globalThis.fetch;let blocked=0,allowed=0;
  globalThis.fetch=(input,options)=>{
    const url=typeof input==='string'||input instanceof URL?String(input):input.url;
    assert.ok(allowedRehearsalRequest(url)||(blocked++,false),'REHEARSAL_EXTERNAL_REQUEST_BLOCKED');allowed++;
    return original(input,{...options,redirect:'error'});
  };
  return {counts:()=>({allowed,blocked}),close:()=>{globalThis.fetch=original;}};
}
export async function removeRehearsalPrivateSnapshots(output){
  const target=path.join(path.resolve(output),'reset214-private');
  const inspect=async dir=>{
    assert.equal((await lstat(dir)).isSymbolicLink(),false,'REHEARSAL_PRIVATE_CLEANUP_LINK_FORBIDDEN');
    for(const entry of await readdir(dir,{withFileTypes:true})){
      assert.equal(entry.isSymbolicLink(),false,'REHEARSAL_PRIVATE_CLEANUP_LINK_FORBIDDEN');
      if(entry.isDirectory())await inspect(path.join(dir,entry.name));
    }
  };
  await inspect(target);await rm(target,{recursive:true});
  await rm(path.join(output,'RESET219_IN_PROGRESS.json'),{force:true});
}
