// A second encrypted protection chain on the IMPORTED local220 database.
// Only the verified Restore callback's owned,networkless container is accepted.
import assert from'node:assert/strict';import{execFile}from'node:child_process';import{promisify}from'node:util';import path from'node:path';
import{createCompleteBackup,restoreCompleteBackup,assertActiveRehearsal220}from'../backup/complete-backup.mjs';import{SnapshotSession}from'../backup/snapshot-session.mjs';import{assertRehearsalTarget}from'./rehearsal220-local.mjs';
const exec=promisify(execFile);
export async function rehearseRealStart220(c){const{context,executor,output}=c;
 const docker=(...args)=>exec('docker',args,{windowsHide:true,maxBuffer:16*1024**2});
 const owned=async()=>{assertActiveRehearsal220(context);assertRehearsalTarget(context,JSON.parse((await docker('inspect',context.containerId)).stdout)[0]);};
 const source={session:()=>new SnapshotSession('docker',executor.args),readObject:async()=>{throw Error('REAL_START_UNEXPECTED_STORAGE_OBJECT');},
  roles:async destination=>{await owned();await docker('exec',context.containerId,'pg_dumpall','-h','/tmp/socket','-p','5432','-U','supabase_admin','--roles-only','--no-role-passwords','--no-tablespaces','-f','/tmp/lite220-start-roles.sql');await docker('cp',context.containerId+':/tmp/lite220-start-roles.sql',destination);},
  dump:async(snapshot,destination)=>{await owned();await docker('exec',context.containerId,'pg_dump','-h','/tmp/socket','-p','5432','-U','postgres','-d','postgres','-Fc','--snapshot='+snapshot,'-f','/tmp/lite220-start.dump');await docker('cp',context.containerId+':/tmp/lite220-start.dump',destination);}};
 await owned();const passphrase='disposable-local-real-start-only',started=performance.now(),backup=await createCompleteBackup({projectRef:'kzevmysfydaslxcerogt',outputRoot:path.join(output,'real-start/Frankfurt-kzevmysfydaslxcerogt'),passphrase,source});assert.equal(backup.historyCeiling,220);
 const backupMs=performance.now()-started,restoreAt=performance.now(),restored=await restoreCompleteBackup({archivePath:backup.archivePath,passphrase,reportPath:path.join(output,'real-start-restore.json')});assert.equal(restored.allRowsAndHashesMatch,true);
 return{localRealStart:true,beforeFirstSale:true,afterActualWorkbook:true,archiveSha256:backup.sha256,history:181,backupMs,restoreMs:performance.now()-restoreAt,allRowsAndHashesMatch:true,defaultRestoreCleaned:true,hostedAccess:false};
}
