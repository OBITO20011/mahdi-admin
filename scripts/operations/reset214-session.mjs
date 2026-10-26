import assert from 'node:assert/strict';
import {readFile,mkdir,access} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {executeResetInput as executeInput} from './reset214-io.mjs';
import {privateResetDirectory,writePrivateResetJson,readPrivateResetJson,assertResetSnapshot} from './reset214-private-state.mjs';
import {publicFingerprint,guardCreateSql,attachGuardSql,assertNoForeignWrites,withoutResetGuard,writerExecutor,removeGuardSql} from './reset214-write-guard.mjs';
import {preservedStateSql,sqlLiteral as q,uuid} from './trial-reset-core.mjs';
import {schemaCatalogSql,catalogDifference} from '../testing/schema-catalog.mjs';
import {readNotificationSnapshot} from './frankfurt-notification-hold.mjs';
import {sha256} from '../testing/maintenance-db-contract.mjs';
export const reset214Marker='RESET214_IN_PROGRESS.json';
const within=(root,relative)=>{assert.equal(path.isAbsolute(relative),false,'RESET214_STATE_PATH_INVALID');const p=path.resolve(root,relative),r=path.relative(root,p);assert.ok(r&&!r.startsWith('..')&&!path.isAbsolute(r),'RESET214_STATE_PATH_INVALID');return p;};
async function readSql(executor,input){const r=await executeInput(executor,input);assert.equal(r.code,0,'RESET214_SESSION_SQL_FAILED');return r.stdout.trim();}
// Sign-in timestamps may advance while the operator investigates. Identity,
// password/MFA material and Vault must remain identical;only hashes are saved.
const stableIdentitySql=ownerId=>`SELECT jsonb_build_object(
 'auth',(SELECT md5((to_jsonb(u)-'last_sign_in_at'-'updated_at')::text) FROM auth.users u WHERE id=${q(uuid(ownerId))}::uuid),
 'identities',(SELECT md5(COALESCE(jsonb_agg(to_jsonb(i)-'last_sign_in_at'-'updated_at' ORDER BY id)::text,'')) FROM auth.identities i WHERE user_id=${q(ownerId)}::uuid));`;
export async function prepareResetSession({workdir,output,ownerId,projectRef,referenceSha256,state,reference,resume=false}){
 const folder=await privateResetDirectory(workdir),markerPath=path.join(workdir,reset214Marker);
 if(resume){
  let marker;try{marker=await readPrivateResetJson(markerPath);}catch(error){throw new Error('RESET214_RESUME_MARKER_REQUIRED',{cause:error});}
  assert.equal(marker.projectRef,projectRef,'RESET214_RESUME_PROJECT_MISMATCH');assert.equal(marker.ownerId,ownerId,'RESET214_RESUME_OWNER_MISMATCH');assert.equal(marker.referenceSha256,referenceSha256,'RESET214_RESUME_REFERENCE_CHANGED');
  assert.equal(typeof marker.snapshotSha256,'string');assert.match(marker.snapshotSha256,/^[a-f0-9]{64}$/u);
  const file=within(workdir,marker.snapshotPath);assert.ok(file.startsWith(folder+path.sep),'RESET214_PRIVATE_SNAPSHOT_LOCATION');
  let saved;try{saved=await readPrivateResetJson(file,marker.snapshotSha256);}catch(error){throw new Error(error.message.startsWith('RESET214_RETENTION_HASH_MISMATCH')?'RESET214_RETENTION_HASH_MISMATCH':'RESET214_RETENTION_SNAPSHOT_REQUIRED',{cause:error});}
  assertResetSnapshot(saved,{ownerId,projectRef,referenceSha256});
  assert.equal(saved.attemptId,marker.originalAttemptId,'RESET214_ATTEMPT_ID_MISMATCH');
  const previousOutput=within(workdir,marker.currentOutput),progress=JSON.parse(await readFile(path.join(previousOutput,'reset214-progress.json'),'utf8'));
  assert.equal(progress.originalAttemptId,saved.attemptId,'RESET214_PROGRESS_LINK_MISMATCH');
  // Core verification can finish before CLI final checks/report/marker cleanup.
  // The root marker is the authority that the owner operation is unfinished.
  return {saved,marker,markerPath,file,previousOutput,previous:{stage:progress.failureStage??progress.stage,applied:progress.applied??[],recorded:progress.recorded??[]},output,reference,workdir,resume:true};
 }
 try{await access(markerPath);throw new Error('RESET214_PRIOR_INCOMPLETE_ATTEMPT_USE_RESUME');}catch(error){if(error.code!=='ENOENT')throw error;}
 assert.ok(state,'RESET214_RETENTION_STATE_REQUIRED');
 const attemptId=randomUUID(),privateFolder=path.join(folder,attemptId);await mkdir(privateFolder,{mode:0o700});
 const file=path.join(privateFolder,'retention.json');
  return {saved:{format:1,attemptId,ownerId:uuid(ownerId),projectRef,referenceCeiling:214,referenceSha256,writerToken:randomUUID(),createdAt:new Date().toISOString(),initialFingerprint:state.initialFingerprint,state:{rawTables:state.rawTables,plan:state.plan,expected:state.expected}},markerPath,file,output,reference,workdir,resume:false};
}
export async function persistResetSession(session,executor){
 const {saved}=session;
 assert.deepEqual(await publicFingerprint(executor),saved.initialFingerprint,'RESET214_PREVIEW_CHANGED');
 saved.catalog=JSON.parse(await readSql(executor,schemaCatalogSql));saved.buildDay=await readSql(executor,"SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date;");
 saved.notifications=await readNotificationSnapshot(executor);
 // Only non-reversible fingerprints of Auth/MFA/Vault,never their rows.
 saved.preserved=JSON.parse(await readSql(executor,preservedStateSql(saved.ownerId)));
 saved.stableIdentity=JSON.parse(await readSql(executor,stableIdentitySql(saved.ownerId)));
 const textState={...saved.state,snapshot:Object.fromEntries(Object.entries(saved.state.rawTables).map(([k,v])=>[k,JSON.parse(v)]))};
 assert.equal(textState.snapshot.storefront_settings[0].orders_enabled,false,'RESET214_STORE_ORDERS_MUST_BE_DISABLED');
 assertResetSnapshot(saved,saved);
 const snapshotSha256=await writePrivateResetJson(session.file,saved);
 assertResetSnapshot(await readPrivateResetJson(session.file,snapshotSha256),saved);
 await writePrivateResetJson(path.join(session.output,'reset214-progress.json'),{ok:false,complete:false,originalAttemptId:saved.attemptId,stage:'snapshot-verified',applied:[],recorded:[],destructiveStarted:false});
 session.marker={format:1,projectRef:saved.projectRef,ownerId:saved.ownerId,referenceSha256:saved.referenceSha256,originalAttemptId:saved.attemptId,
  snapshotPath:path.relative(session.workdir,session.file),snapshotSha256,currentOutput:path.relative(session.workdir,session.output),startedAt:saved.createdAt};
 await writePrivateResetJson(session.markerPath,session.marker);
 return session;
}
export async function validateResetResume(session,executor){
 const {saved}=session;
 assert.equal(await readSql(executor,`SELECT count(*) FROM auth.users WHERE id=${q(saved.ownerId)}::uuid;`),'1','RESET214_OWNER_AUTH_MISSING');
 assert.equal(await readSql(executor,`SELECT EXISTS(SELECT 1 FROM auth.mfa_factors WHERE user_id=${q(saved.ownerId)}::uuid AND status='verified');`),'t','RESET214_OWNER_MFA_MISSING');
 const current=JSON.parse(await readSql(executor,preservedStateSql(saved.ownerId)));
 assert.deepEqual(JSON.parse(await readSql(executor,stableIdentitySql(saved.ownerId))),saved.stableIdentity,'RESET214_OWNER_IDENTITY_CHANGED');
 for(const key of ['ownerMfa','vault','buckets'])assert.deepEqual(current[key],saved.preserved[key],'RESET214_RETAINED_PLATFORM_CHANGED');
 session.platformBaseline=current;
 const present=await readSql(executor,"SELECT to_regclass('reset214_guard.state') IS NOT NULL;");
 session.guardPresent=present==='t';
 if(!session.guardPresent){
  // A crash before guard creation,or after final guard removal,has no witness.
  // Permit only exact original trial rows or a fully verified clean result.
  const actual=await publicFingerprint(executor);
  if(JSON.stringify(actual)!==JSON.stringify(saved.initialFingerprint)){
   const proofFile=path.join(path.dirname(session.file),'guard-removal-proof.json');
   const proof=await readPrivateResetJson(proofFile,session.marker.guardRemovalProofSha256);
   assert.equal(typeof session.marker.guardRemovalProofSha256,'string','RESET214_RESUME_GUARD_MISSING');
   assert.deepEqual(actual,proof.fingerprint,'RESET214_REAL_WRITES_DETECTED');
  }
  const catalog=JSON.parse(await readSql(executor,schemaCatalogSql));assert.deepEqual(catalogDifference(saved.catalog,catalog),[],'RESET214_RESUME_GUARD_MISSING');
 }
 session.writeCheck=await assertNoForeignWrites(executor,saved,{guardRequired:session.guardPresent});
 // Reject missing,out-of-order,unknown or future recorded files. Any literal
 // migration may have committed before history repair;restart never skips it.
 const history=JSON.parse(await readSql(executor,'SELECT COALESCE(jsonb_agg(version ORDER BY version),\'[]\') FROM supabase_migrations.schema_migrations;'));
 assert.deepEqual(history,session.reference.appliedVersions.slice(0,history.length),'RESET214_RESUME_HISTORY_INVALID');
 return session.writeCheck;
}
export async function startResetAttempt(session,executor){
 if(!session.resume)await persistResetSession(session,executor);else await validateResetResume(session,executor);
 const originalAttemptId=session.saved.attemptId;
 const progress={ok:false,complete:false,originalAttemptId,attemptId:randomUUID(),resumedFrom:session.resume?session.previousOutput:null,stage:'snapshot-verified',applied:[],recorded:[],destructiveStarted:false};
 await writePrivateResetJson(path.join(session.output,'reset214-progress.json'),progress);
 session.marker={...session.marker,currentOutput:path.relative(session.workdir,session.output),previousOutput:session.resume?path.relative(session.workdir,session.previousOutput):null};
 await writePrivateResetJson(session.markerPath,session.marker);
 const writer=writerExecutor(executor,session.saved.writerToken);
 if(!session.guardPresent)await readSql(writer,guardCreateSql(session.saved.writerToken,originalAttemptId));
 await readSql(writer,attachGuardSql);session.guardPresent=true;session.executor=writer;
 return progress;
}
export function retainedSessionState(session){const state=session.saved.state;return {...state,snapshot:Object.fromEntries(Object.entries(state.rawTables).map(([k,v])=>[k,JSON.parse(v)]))};}
export async function finishResetSession(session){
 // Keep the private snapshot as an explicitly completed archive. Never remove
 // it on a failed final function/history/report check.
 const marker={...session.marker,completedAt:new Date().toISOString(),complete:true};
 await writePrivateResetJson(path.join(path.dirname(session.file),'completed.json'),marker);
 const {unlink}=await import('node:fs/promises');await unlink(session.markerPath);
}
export async function saveGuardRemovalProof(session,executor){
 const file=path.join(path.dirname(session.file),'guard-removal-proof.json');
 const hash=await writePrivateResetJson(file,{fingerprint:await publicFingerprint(executor)});
 session.marker={...session.marker,guardRemovalProofSha256:hash};await writePrivateResetJson(session.markerPath,session.marker);
}
export {writerExecutor,attachGuardSql,removeGuardSql,assertNoForeignWrites,withoutResetGuard,sha256};
