// Synthetic disposable PostgreSQL only. No hosted credentials or service calls.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createCompleteBackup,restoreCompleteBackup,withRestoredRehearsal219,captureEvidence} from '../backup/complete-backup.mjs';
import {verifyBackupArchive} from '../backup/verify-backup.mjs';
import {encryptFile} from '../backup/backup-crypto.mjs';
import {SnapshotSession} from '../backup/snapshot-session.mjs';
import {restorePgNetSequenceState,pgNetRawStateSql} from '../backup/pg-net-sequence-state.mjs';
import {postgresDiagnostic} from '../backup/postgres-diagnostic.mjs';
const exec=promisify(execFile);
const projectRef='kzevmysfydaslxcerogt';
const queryJson=async(s,sql)=>JSON.parse((await s.query(sql)).trim());

async function rewrittenSyntheticArchive(original,passphrase,edit){
 const work=await mkdtemp(path.join(tmpdir(),'nawasrah-pgnet-synthetic-')),content=path.join(work,'content');
 try{
  await verifyBackupArchive({archivePath:original,passphrase,extractTo:content});
  const file=path.join(content,'database','source-evidence.json'),before=JSON.parse(await readFile(file,'utf8'));
  edit(before);await writeFile(file,JSON.stringify(before)+'\n');
  const manifestPath=path.join(content,'manifest.json'),manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  const entry=manifest.files.find(e=>e.path==='database/source-evidence.json');
  entry.size=(await stat(file)).size;entry.sha256=createHash('sha256').update(await readFile(file)).digest('hex');
  await writeFile(manifestPath,JSON.stringify(manifest)+'\n');
  const tar=path.join(work,'fixture.tar'),archive=path.join(work,'fixture.nwb');
  await exec(process.platform==='win32'?'tar.exe':'tar',['-cf',tar,'-C',content,'.'],{windowsHide:true});
  await encryptFile(tar,archive,passphrase);
  await rm(tar);await rm(content,{recursive:true,force:true});
  return {archive,cleanup:()=>rm(work,{recursive:true,force:true})};
 }catch(e){await rm(work,{recursive:true,force:true});throw e;}
}
export async function provePgNetSequenceStates({source,passphrase,output,container}){
 assert.equal(container,'supabase_db_nawasrah-dual-backup-test','SYNTHETIC_DUAL_BACKUP_SOURCE_ONLY');
 const proof={ok:false,fixtureOnly:true,hostedConnectionsMade:false,cases:[],negative:[]};
 const session=source.session();
 const capture=async()=>{
  await session.query('BEGIN READ ONLY;');try{return await captureEvidence(session);}finally{await session.query('ROLLBACK;');}
 };
 const ownRestoreIds=async()=>(await exec('docker',['ps','-aq','--filter','name=nawasrah-full-restore-'+process.pid+'-'],{windowsHide:true})).stdout.trim();
 const checkStrict=r=>{
  assert.equal(r.ok,true);assert.equal(r.historyCeiling,219);assert.equal(r.historyFiles,180);
  for(const key of ['allRowsAndHashesMatch','allSequencesMatch','rolesAndMembershipsMatch','catalogAclOwnerSettingsMatch','historyMatch','storageMetadataMatch'])assert.equal(r[key],true,key);
  assert.equal(r.pgNetSequenceState.checked,1);assert.equal(r.pgNetSequenceState.exactRawState,true);
  assert.deepEqual(r.exceptionsApplied,[]);assert.deepEqual(r.pgNetSequenceState.exceptionsApplied,[]);
 };
 const unchanged=(before,after)=>{
  for(const key of ['catalog','tables','roles','memberships','history','storage','preload'])assert.deepEqual(after[key],before[key],'NO_OTHER_SOURCE_CHANGE_'+key);
  assert.deepEqual(after.sequences.filter(r=>!(r.schema==='net'&&r.name==='http_request_queue_id_seq')),before.sequences.filter(r=>!(r.schema==='net'&&r.name==='http_request_queue_id_seq')));
 };
 let usedBackup,unusedBackup;
 try{
  assert.equal(await ownRestoreIds(),'');
  const authority=await queryJson(session,"SELECT jsonb_build_object('role',current_user,'superuser',(SELECT rolsuper FROM pg_roles WHERE rolname=current_user),'select',has_sequence_privilege(current_user,'net.http_request_queue_id_seq','SELECT'),'update',has_sequence_privilege(current_user,'net.http_request_queue_id_seq','UPDATE'));");
  assert.deepEqual(authority,{role:'postgres',superuser:false,select:true,update:true});
  const original=await capture();
  for(const [label,fixtureSql,expected]of [
   ['unused-default',"SELECT setval('net.http_request_queue_id_seq',1,false);",{lastValue:'1',isCalled:false}],
   ['unused-nondefault',"SELECT setval('net.http_request_queue_id_seq',17,false);",{lastValue:'17',isCalled:false}],
   ['used',"SELECT setval('net.http_request_queue_id_seq',31,false);SELECT nextval('net.http_request_queue_id_seq');",{lastValue:'31',isCalled:true}],
   ['http-probe-rolled-back',null,{lastValue:'32',isCalled:true}],
  ]){
   const started=performance.now();
   if(fixtureSql)await session.query(fixtureSql);
   else{
    const rows=await queryJson(session,'SELECT count(*) FROM net.http_request_queue;');
    await session.query("BEGIN;SELECT net.http_post(url:='http://127.0.0.1:9/never-committed',body:='{}'::jsonb);ROLLBACK;");
    assert.equal(await queryJson(session,'SELECT count(*) FROM net.http_request_queue;'),rows,'HTTP_QUEUE_ROLLED_BACK');
   }
   const before=await capture();unchanged(original,before);assert.deepEqual(before.pgNetSequenceState.state,expected);
   const backup=await createCompleteBackup({projectRef,outputRoot:path.join(output,'pg-net-'+label,'Frankfurt-'+projectRef),passphrase,source});
   const restored=await restoreCompleteBackup({archivePath:backup.archivePath,passphrase,reportPath:path.join(output,'pg-net-'+label+'.json')});checkStrict(restored);
   if(label==='unused-default')unusedBackup=backup;
   if(label==='used'){
    usedBackup=backup;const repeated=await restoreCompleteBackup({archivePath:backup.archivePath,passphrase,reportPath:path.join(output,'pg-net-used-repeat.json')});checkStrict(repeated);
    proof.repeatedSameArchive=true;
   }
   unchanged(before,await capture());assert.deepEqual((await capture()).pgNetSequenceState,before.pgNetSequenceState,'RESTORE_NEVER_MUTATES_SOURCE_SEQUENCE');
   assert.equal(await ownRestoreIds(),'','DEFAULT_RESTORE_CLEANUP_REQUIRED');
   proof.cases.push({label,rawState:expected,strict:true,milliseconds:Math.round(performance.now()-started)});
  }
  const legacy=await rewrittenSyntheticArchive(usedBackup.archivePath,passphrase,b=>{delete b.pgNetSequenceState;});
  try{
   const r=await restoreCompleteBackup({archivePath:legacy.archive,passphrase,reportPath:path.join(output,'pg-net-legacy-positive.json')});checkStrict(r);
   assert.equal(r.pgNetSequenceState.evidence,'legacy-positive-value');proof.legacyPositive=true;
  }finally{await legacy.cleanup();}
  for(const [label,archivePath,edit]of [
   ['legacy-null',unusedBackup.archivePath,b=>{delete b.pgNetSequenceState;}],
   ['legacy-missing',usedBackup.archivePath,b=>{delete b.pgNetSequenceState;b.sequences=b.sequences.filter(r=>r.schema!=='net'||r.name!=='http_request_queue_id_seq');}],
   ['wrong-owner',usedBackup.archivePath,b=>{b.pgNetSequenceState.identity.owner='postgres';}],
   ['wrong-sequence',usedBackup.archivePath,b=>{b.pgNetSequenceState.identity.name='other';}],
  ]){
   const changed=await rewrittenSyntheticArchive(archivePath,passphrase,edit);
   try{
    let failure;try{await restoreCompleteBackup({archivePath:changed.archive,passphrase,reportPath:path.join(output,'pg-net-negative-'+label+'.json')});}catch(e){failure=e;}
    assert.ok(failure,'UNSUPPORTED_EVIDENCE_MUST_FAIL');
    const diagnostic=postgresDiagnostic(failure);assert.equal(diagnostic.category,'RESTORE_PG_NET_SEQUENCE_STATE_UNSUPPORTED');
    assert.equal(diagnostic.stage,'restore-pg-net-sequence-state');
    assert.equal(await ownRestoreIds(),'','FAIL_CLOSED_BEFORE_CONTAINER');
    proof.negative.push({label,rejected:true,noOwnedContainer:true});
   }finally{await changed.cleanup();}
  }
  for(const [label,mutate]of [
   ['target-membership',"ALTER EXTENSION pg_net DROP SEQUENCE net.http_request_queue_id_seq;"],
   ['target-owner',"ALTER TABLE net.http_request_queue OWNER TO postgres;"],
  ]){
   const r=await withRestoredRehearsal219({archivePath:usedBackup.archivePath,passphrase},async context=>{
    const admin=new SnapshotSession('docker',['exec','-i',context.containerName,'psql','-h','/tmp/socket','-p',String(context.databasePort),'-U','supabase_admin','-d','postgres','-X','-q','-A','-t','-w','-v','ON_ERROR_STOP=1']);
    try{
     const state=await queryJson(admin,pgNetRawStateSql);
     const sourceEvidence=await capture();
     sourceEvidence.pgNetSequenceState.state={lastValue:'31',isCalled:true};
     sourceEvidence.sequences.find(s=>s.schema==='net'&&s.name==='http_request_queue_id_seq').value=31;
     await admin.query(mutate);
     await assert.rejects(restorePgNetSequenceState({container:context.containerName,containerId:context.containerId,port:context.databasePort},sourceEvidence),e=>postgresDiagnostic(e).category==='RESTORE_PG_NET_SEQUENCE_STATE_UNSUPPORTED');
     assert.deepEqual(await queryJson(admin,pgNetRawStateSql),state,'WRONG_TARGET_MUST_NOT_SET_STATE');
     proof.negative.push({label,rejected:true,rawStateUnchanged:true});
    }finally{await admin.close();}
   });
   checkStrict(r);assert.equal(await ownRestoreIds(),'');
  }
  proof.ok=true;proof.authority=authority;proof.businessRolesAclOwnersUnchanged=true;proof.noNewGrants=true;
  await writeFile(path.join(output,'pg-net-sequence-proof.json'),JSON.stringify(proof,null,2)+'\n');
  return proof;
 }finally{await session.close();}
}
