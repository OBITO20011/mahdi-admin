// Local evidence is owner-controlled,not a remote attestation. Never opens a DB.
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {sha256 as fileSha256} from '../offsite-backup/offsite-core.mjs';
import {TARGET,assertOutsideRepository} from './frankfurt-owner-build.mjs';
const hash=/^[a-f0-9]{64}$/u;
export async function read222BackupEvidence(filename,ceiling,{now=Date.now(),notBefore=0}={}){
 assert.ok([220,222].includes(ceiling),'UPGRADE222_EXACT_HISTORY_REQUIRED');
 assertOutsideRepository(path.resolve(filename));
 const evidence=JSON.parse(await readFile(filename,'utf8'));
 assert.equal(evidence.ok,true,'UPGRADE222_SUCCESSFUL_BACKUP_REQUIRED');assert.equal(evidence.projectRef,TARGET.id,'UPGRADE222_BACKUP_PROJECT_MISMATCH');
 assert.equal(evidence.formatVersion,2);assert.equal(evidence.historyCeiling,ceiling);assert.equal(evidence.historyFiles,ceiling===220?181:182);
 assert.match(evidence.sha256,hash);assert.match(evidence.sourceEvidenceSha256,hash,'UPGRADE222_BACKUP_SOURCE_COMMITMENT_REQUIRED');
 const finished=Date.parse(evidence.finishedAt);assert.ok(Number.isFinite(finished)&&finished>=notBefore&&finished<=now&&now-finished<=26*3600_000,'UPGRADE222_BACKUP_NOT_CURRENT');
 const archive=path.resolve(evidence.archivePath);assertOutsideRepository(archive);assert.equal(path.basename(archive),evidence.archiveName);assert.match(evidence.archiveName,/^nawasrah-backup-[0-9TZ-]+\.nwb$/u);
 assert.equal((await stat(archive)).size,evidence.archiveBytes,'UPGRADE222_BACKUP_BYTES_CHANGED');assert.equal(await fileSha256(archive),evidence.sha256,'UPGRADE222_BACKUP_HASH_CHANGED');
 return evidence;
}
export async function assert222ProtectionComplete({backupFile,restoreFile,upgradeFile,now=Date.now()}){
 for(const file of [backupFile,restoreFile,upgradeFile])assertOutsideRepository(path.resolve(file));
 const upgrade=JSON.parse(await readFile(upgradeFile,'utf8'));
 assert.equal(upgrade.ok,true);assert.equal(upgrade.projectRef,TARGET.id);assert.equal(upgrade.targetCeiling,222);assert.equal(upgrade.protectionPending,true);assert.equal(upgrade.catalogUnexpectedDifferenceCount,0);assert.deepEqual(upgrade.recorded,['222']);
 assert.match(upgrade.beforeBackup?.sha256,hash);assert.match(upgrade.beforeBackup?.sourceEvidenceSha256,hash);
 const applied=Date.parse(upgrade.endedAt);assert.ok(Number.isFinite(applied)&&applied<=now,'UPGRADE222_APPLY_REPORT_REQUIRED');
 const backup=await read222BackupEvidence(backupFile,222,{now,notBefore:applied});
 const restore=JSON.parse(await readFile(restoreFile,'utf8'));
 assert.equal(restore.ok,true,'UPGRADE222_SUCCESSFUL_RESTORE_REQUIRED');assert.equal(restore.projectRef,TARGET.id);assert.equal(restore.mode,'isolated-complete-restore');
 assert.equal(restore.historyCeiling,222);assert.equal(restore.historyFiles,182);assert.equal(restore.archiveSha256,backup.sha256);assert.equal(restore.sourceEvidenceSha256,backup.sourceEvidenceSha256);
 assert.equal(restore.network,'none');assert.equal(restore.hostedConnectionsMade,false);assert.equal(restore.liveVolumesModified,false);
 for(const key of ['allRowsAndHashesMatch','allSequencesMatch','rolesAndMembershipsMatch','catalogAclOwnerSettingsMatch','historyMatch','storageMetadataMatch'])assert.equal(restore[key],true,'UPGRADE222_STRICT_RESTORE_PROOF_REQUIRED:'+key);
 assert.deepEqual(restore.exceptionsApplied,[]);assert.equal(restore.pgNetSequenceState?.exactRawState,true);assert.deepEqual(restore.pgNetSequenceState?.exceptionsApplied,[]);
 assert.ok(restore.integrityChecks?.length>5&&restore.integrityChecks.every(c=>c.status==='healthy'&&Number(c.issueCount)===0));
 const restored=Date.parse(restore.completedAt);assert.ok(Number.isFinite(restored)&&restored>=Date.parse(backup.finishedAt)&&restored<=now);
 return {beforeArchiveSha256:upgrade.beforeBackup.sha256,afterArchiveSha256:backup.sha256,afterSourceEvidenceSha256:backup.sourceEvidenceSha256,strictIsolatedRestore:true,complete:true};
}
