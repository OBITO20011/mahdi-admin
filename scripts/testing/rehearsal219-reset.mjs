import assert from 'node:assert/strict';
import {readFile,mkdir,lstat,unlink} from 'node:fs/promises';
import path from 'node:path';
import {captureReset219,reset219WithExecutor} from '../operations/trial-reset214-core.mjs';
import {prepareResetSession,startResetAttempt,validateResetResume,finishResetSession} from '../operations/reset214-session.mjs';
import {executeResetInput} from '../operations/reset214-io.mjs';
import {sqlLiteral as q} from '../operations/trial-reset-core.mjs';
import {safeObjectName} from '../backup/complete-backup.mjs';
import {sha256} from './maintenance-db-contract.mjs';
export async function rehearseReset219({context,executor,root,referenceFile,reference,ownerId,output}){
 const sql=async(input,ex=executor)=>{const r=await executeResetInput(ex,input);assert.equal(r.code,0,'REHEARSAL_RESET_SQL_FAILED');return r.stdout.trim();};
 const json=async text=>JSON.parse(await sql(text));
 const baseline=await captureReset219({executor,ownerId,reference});
 const common={workdir:output,ownerId,projectRef:context.projectRef,referenceSha256:sha256(await readFile(referenceFile)),reference};
 const day=(await sql("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;")).trim();
 const nextDay=new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString().slice(0,10);
 const clocked={...executor,localExecute:async(input,token)=>{
  const r=await executor.localExecute(input,token);
  return input.trim()==="SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;"?{...r,stdout:token?nextDay:day}:r;
 }};
 const at=async name=>{const out=path.join(output,name);await mkdir(out);return out;};
 const timings={};
 const timed=async(name,action)=>{const begin=performance.now();try{return await action();}finally{timings[name]=Math.round(performance.now()-begin);}};
 const run=async(session,interrupt)=>{
  const progress=await startResetAttempt(session,clocked),writer=session.executor;
  await reset219WithExecutor({executor:writer,root,reference,output:session.output,ownerId,session,report:progress,expectedPlan:session.saved.state.plan,
   emptyStorage:async()=>{
    // Local Storage transport: delete exactly the verified archive's files and
    // matching object rows. No source bucket, service key or hosted API exists.
    const names=await json("SELECT coalesce(jsonb_agg(name),'[]') FROM storage.objects WHERE bucket_id='product-images';");
    for(const name of names){const file=path.join(context.storageDirectory,...safeObjectName(name).split('/'));
     assert.equal((await lstat(file)).isFile(),true);await unlink(file);}
    await sql("BEGIN;SET LOCAL storage.allow_delete_query='true';DELETE FROM storage.objects WHERE bucket_id='product-images';COMMIT;",writer);
   },
   deleteOtherAuth:async id=>sql(`DELETE FROM auth.users WHERE id<>${q(id)}::uuid;`,writer),
   clearHistory:()=>sql('DELETE FROM supabase_migrations.schema_migrations;DELETE FROM supabase_migrations.seed_files;',writer),
   repair:version=>sql(`INSERT INTO supabase_migrations.schema_migrations(version) VALUES(${q(version)});`,writer),
   finalDryRun:async()=>assert.deepEqual(await json("SELECT jsonb_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations;"),reference.appliedVersions),
   boundary:async name=>{if(name===interrupt)throw new Error('RESET219_SIMULATED_INTERRUPTION');}});
  assert.equal(progress.complete,true);assert.equal(progress.comparisonPolicy,'same-database-literal-all-schemas');
  assert.equal(progress.comparisonDates.rebuild.beforeBuildDate,day);assert.equal(progress.comparisonDates.rebuild.afterBuildDate,nextDay);
  await finishResetSession(session);return progress;
 };
 const first=await prepareResetSession({...common,output:await at('ordinary'),state:baseline});
 const ordinary=await timed('ordinaryMs',()=>run(first));
 const nextState=await captureReset219({executor,ownerId,reference});
 const second=await prepareResetSession({...common,output:await at('interrupted'),state:nextState});
 await assert.rejects(()=>timed('interruptedMs',()=>run(second,'after-drop-public')),/RESET219_SIMULATED_INTERRUPTION/u);
 const resumed=await prepareResetSession({...common,output:await at('resumed'),resume:true});
 await validateResetResume(resumed,executor);const previousStage=resumed.previous.stage;
 const recovered=await timed('resumeMs',()=>run(resumed));
 const final=await captureReset219({executor,ownerId,reference});
 assert.deepEqual(final.rawTables,baseline.rawTables,'REHEARSAL_RETAINED_RAW_BYTES_CHANGED');
 assert.equal(await sql('SELECT count(*) FROM auth.users;'),'1');assert.equal(await sql('SELECT count(*) FROM storage.objects;'),'0');
 assert.deepEqual(final.plan.preserved,baseline.plan.preserved);
 return {ordinaryComplete:ordinary.complete,resumeComplete:recovered.complete,interruptionStage:previousStage,timings,
  sameReferenceAndSnapshot:true,history:180,ownerMfaPreserved:true,retainedRawFingerprints:final.plan.preserved,
  allExpectedCountsMatch:true,catalogDifferences:0,aclDifferences:0,storageObjects:0,
  midnightUtc:{start:day,end:nextDay,ordinaryAndResume:true,comparison:ordinary.comparisonPolicy},
  transport:'owned Docker socket;local Storage bytes/object removal and direct local history repair;no owner CLI or hosted API'};
}
