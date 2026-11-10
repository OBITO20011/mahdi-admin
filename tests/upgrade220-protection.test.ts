import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {read220BackupEvidence,assert220ProtectionComplete} from '../scripts/operations/upgrade220-protection.mjs';

test('220 protection binds exact project/history/archive bytes and age;ambiguous old evidence fails closed',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'nawasrah-owner220-evidence-'));
 try{
  const now=Date.parse('2026-11-07T12:00:00Z'),bytes=Buffer.from('synthetic-metadata-unit-test-not-an-archive'),name='nawasrah-backup-2026-11-07T11-59-59Z.nwb',archivePath=path.join(root,name),filename=path.join(root,'backup.json');await writeFile(archivePath,bytes);
  const good={ok:true,projectRef:'kzevmysfydaslxcerogt',formatVersion:2,historyCeiling:219,historyFiles:180,sha256:createHash('sha256').update(bytes).digest('hex'),sourceEvidenceSha256:'a'.repeat(64),finishedAt:new Date(now-1000).toISOString(),archivePath,archiveName:name,archiveBytes:bytes.length};
  const check=async(value:any)=>{await writeFile(filename,JSON.stringify(value));return read220BackupEvidence(filename,219,{now});};assert.deepEqual(await check(good),good);
  for(const change of [{ok:false},{projectRef:'other'},{historyCeiling:217},{historyFiles:179},{formatVersion:1},{sha256:'b'.repeat(64)},{sourceEvidenceSha256:undefined},{archiveBytes:bytes.length+1},{finishedAt:new Date(now-26*3600_000-1).toISOString()},{finishedAt:new Date(now+1).toISOString()}])await assert.rejects(()=>check({...good,...change}));
  await writeFile(archivePath,Buffer.from('tampered'));await assert.rejects(()=>check(good));
 }finally{await rm(root,{recursive:true,force:true});}
});

test('verify completion requires the matching220 isolated strict Restore,all checks and raw pg_net state;no exception or unbound report',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'nawasrah-owner220-completion-'));
 try{
  const now=Date.parse('2026-11-07T12:00:00Z'),bytes=Buffer.from('metadata-unit-only'),name='nawasrah-backup-2026-11-07T11-59-59Z.nwb',archivePath=path.join(root,name);await writeFile(archivePath,bytes);
  const sha256=createHash('sha256').update(bytes).digest('hex'),sourceEvidenceSha256='a'.repeat(64),projectRef='kzevmysfydaslxcerogt';
  const backup={ok:true,projectRef,formatVersion:2,historyCeiling:220,historyFiles:181,sha256,sourceEvidenceSha256,finishedAt:new Date(now-1000).toISOString(),archivePath,archiveName:name,archiveBytes:bytes.length};
  const upgrade={ok:true,projectRef,targetCeiling:220,protectionPending:true,catalogUnexpectedDifferenceCount:0,recorded:['220'],endedAt:new Date(now-2000).toISOString(),beforeBackup:{sha256:'b'.repeat(64),sourceEvidenceSha256:'c'.repeat(64)}};
  const restore={ok:true,projectRef,mode:'isolated-complete-restore',historyCeiling:220,historyFiles:181,archiveSha256:sha256,sourceEvidenceSha256,network:'none',hostedConnectionsMade:false,liveVolumesModified:false,allRowsAndHashesMatch:true,allSequencesMatch:true,rolesAndMembershipsMatch:true,catalogAclOwnerSettingsMatch:true,historyMatch:true,storageMetadataMatch:true,exceptionsApplied:[],pgNetSequenceState:{exactRawState:true,exceptionsApplied:[]},integrityChecks:Array.from({length:17},(_,i)=>({key:'integrity:'+i,status:'healthy',issueCount:0})),completedAt:new Date(now-500).toISOString()};
  const backupFile=path.join(root,'backup.json'),restoreFile=path.join(root,'restore.json'),upgradeFile=path.join(root,'apply.json');await writeFile(backupFile,JSON.stringify(backup));await writeFile(upgradeFile,JSON.stringify(upgrade));
  const check=async(value:any)=>{await writeFile(restoreFile,JSON.stringify(value));return assert220ProtectionComplete({backupFile,restoreFile,upgradeFile,now});};assert.equal((await check(restore)).complete,true);
  for(const change of [{ok:false},{archiveSha256:'d'.repeat(64)},{sourceEvidenceSha256:'d'.repeat(64)},{historyCeiling:219},{network:'bridge'},{hostedConnectionsMade:true},{liveVolumesModified:true},{allRowsAndHashesMatch:false},{catalogAclOwnerSettingsMatch:false},{allSequencesMatch:false},{exceptionsApplied:['ignored']},{pgNetSequenceState:{exactRawState:false,exceptionsApplied:[]}},{integrityChecks:[]},{completedAt:new Date(now-1500).toISOString()}])await assert.rejects(()=>check({...restore,...change}));
  await writeFile(upgradeFile,JSON.stringify({...upgrade,recorded:[]}));await assert.rejects(()=>check(restore));
 }finally{await rm(root,{recursive:true,force:true});}
});
