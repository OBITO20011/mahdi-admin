import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {access} from 'node:fs/promises';
import {restoreCompleteBackup,withRestoredRehearsal219,assertActiveRehearsal219} from '../backup/complete-backup.mjs';
import {rehearsal219Executor} from './rehearsal219-local.mjs';
import {publicFingerprint} from '../operations/reset214-write-guard.mjs';
import {proveReset219DependencyGuard} from './reset219-dependency-probe.mjs';
import {configureRehearsalSupautils219} from './rehearsal219-supautils.mjs';
import {matchRehearsalSequenceOwnerAcl219} from './rehearsal219-sequence-acl.mjs';
import path from 'node:path';
const exec=promisify(execFile);
export async function proveRehearsal219Lifecycle(options){
 const ownIds=async()=>(await exec('docker',['ps','-aq','--filter','name=nawasrah-full-restore-'+process.pid+'-'],{windowsHide:true})).stdout.trim();
 assert.equal(await ownIds(),'');
 const normal=await restoreCompleteBackup(options);assert.equal(normal.ok,true);
 assert.equal(await ownIds(),'','DEFAULT_RESTORE_MUST_DELETE_CONTAINER');
 let context,closed=0,dependencyGuard,supautils,sequenceOwnerAcl;
 const success=await withRestoredRehearsal219(options,async ctx=>{
  context=ctx;let executor=await rehearsal219Executor(ctx);
  try{
   const r=await executor.localExecute("SELECT current_database(),current_user,current_setting('cron.launch_active_jobs');");
   assert.equal(r.code,0);assert.equal(r.stdout.trim(),'postgres|postgres|off');
   const fingerprint=await publicFingerprint(executor);assert.ok(Object.keys(fingerprint).length>100,'REAL_POSTGRES_NOTICE_MUST_BE_PRESERVED');
   dependencyGuard=await proveReset219DependencyGuard(executor);
   // Retain the original guard-fixture conditions and all five assertions.
   // Supautils creates hstore under its designated extension superuser;the
   // artificial ALTER EXTENSION ADD VIEW fixture is unrelated to reset policy
   // authority and cannot be constructed by postgres after that hook is loaded.
   await executor.closeLocal();
   supautils=await configureRehearsalSupautils219({context:ctx,evidenceFile:new URL('./fixtures/rehearsal219-supautils.json',import.meta.url),output:path.dirname(ctx.storageDirectory)});
   sequenceOwnerAcl=await matchRehearsalSequenceOwnerAcl219(ctx);
   assert.deepEqual((await matchRehearsalSequenceOwnerAcl219(ctx)).changedRepresentations,[],'SEQUENCE_ACL_REPLAY_MUST_BE_NOOP');
   executor=await rehearsal219Executor(ctx);
   const ports=await executor.localExecute("BEGIN;DO $$BEGIN PERFORM cron.schedule('rehearsal-port-probe','* * * * *','SELECT 1;');END $$;SELECT jsonb_build_object('port',current_setting('port')::integer,'jobPorts',(SELECT jsonb_agg(DISTINCT nodeport) FROM cron.job));ROLLBACK;");
   assert.equal(ports.code,0);assert.deepEqual(JSON.parse(ports.stdout),{port:5432,jobPorts:[5432]},'REBUILT_CRON_PORT_MUST_MATCH_SOURCE');
   await access(ctx.storageDirectory);
  }finally{await executor.closeLocal();closed++;}
 });
 assert.equal(success.rehearsalCompleted,true);assert.equal(closed,1);
 assert.equal(await ownIds(),'','SUCCESS_MUST_DELETE_CONTAINER');
 assert.throws(()=>assertActiveRehearsal219(context));await assert.rejects(()=>access(context.storageDirectory));
 await assert.rejects(()=>withRestoredRehearsal219(options,async ctx=>{context=ctx;throw new Error('REHEARSAL_SIMULATED_FAILURE');}));
 assert.equal(await ownIds(),'','FAILURE_MUST_DELETE_CONTAINER');
 assert.throws(()=>assertActiveRehearsal219(context));await assert.rejects(()=>access(context.storageDirectory));
 return {defaultRestoreDeletes:true,successDeletes:true,failureDeletes:true,expiredContextRejected:true,extractedStorageDeleted:true,postgresFingerprintNoticePreserved:true,rehearsalCronPort:5432,defaultRestorePort:25435,network:'none',dependencyGuard,supautils,sequenceOwnerAcl};
}
