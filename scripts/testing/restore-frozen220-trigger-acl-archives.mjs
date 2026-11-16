// Synthetic archive oracle only, scoped to the disposable dual-backup proof.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,stat,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {verifyBackupArchive} from '../backup/verify-backup.mjs';
import {encryptFile} from '../backup/backup-crypto.mjs';
import {restoreCompleteBackup} from '../backup/complete-backup.mjs';
import {frankfurt220TriggerAcl,frozen220TriggerAclProfile} from '../operations/frozen220-trigger-acl.mjs';
const exec=promisify(execFile);
export async function proveFrozen220TriggerAclArchives({archivePath,passphrase,output}){
 assert.ok(path.basename(output).startsWith('nawasrah-dual-backup-proof-'));
 assert.ok(path.resolve(archivePath).startsWith(path.resolve(output)+path.sep));
 const work=await mkdtemp(path.join(tmpdir(),'nawasrah-frozen220-acl-'));
 const cases=[];
 try{
  for(const kind of ['local','frankfurt','partial','foreign']){
   const content=path.join(work,kind);
   await verifyBackupArchive({archivePath,passphrase,extractTo:content});
   const file=path.join(content,'database/source-evidence.json');
   const captured=JSON.parse(await readFile(file,'utf8'));
   assert.equal(frozen220TriggerAclProfile(captured.catalog.functions),'local');
   const rows=frankfurt220TriggerAcl.signatures.map(identity=>captured.catalog.functions.find(row=>row.schema==='public'&&row.identity===identity));
   if(kind==='frankfurt')for(const row of rows)row.acl=[...frankfurt220TriggerAcl.grants];
   if(kind==='partial')rows[0].acl=[...frankfurt220TriggerAcl.grants];
   if(kind==='foreign')rows[0].acl=['postgres=X/postgres','anon=X/postgres'];
   await writeFile(file,JSON.stringify(captured)+'\n');
   const manifestFile=path.join(content,'manifest.json'),manifest=JSON.parse(await readFile(manifestFile,'utf8'));
   const entry=manifest.files.find(row=>row.path==='database/source-evidence.json');
   entry.size=(await stat(file)).size;entry.sha256=createHash('sha256').update(await readFile(file)).digest('hex');
   await writeFile(manifestFile,JSON.stringify(manifest)+'\n');
   const tar=path.join(work,kind+'.tar'),archive=path.join(work,kind+'.nwb');
   await exec(process.platform==='win32'?'tar.exe':'tar',['-cf',tar,'-C',content,'.'],{windowsHide:true});
   await encryptFile(tar,archive,passphrase);
   const reportPath=path.join(output,'frozen220-acl-'+kind+'.json');
   if(kind==='local'||kind==='frankfurt'){
    const restored=await restoreCompleteBackup({archivePath:archive,passphrase,reportPath});
    assert.equal(restored.ok,true);
    assert.deepEqual(restored.frozen220TriggerAcl,{profile:kind,checked:4,exactRawAcl:true,exceptionsApplied:[]});
    for(const key of ['allRowsAndHashesMatch','allSequencesMatch','rolesAndMembershipsMatch','catalogAclOwnerSettingsMatch','historyMatch','storageMetadataMatch'])assert.equal(restored[key],true,key);
    assert.deepEqual(restored.exceptionsApplied,[]);
    cases.push({kind,rawProfile:kind,strictRestore:true});
   }else{
    await assert.rejects(restoreCompleteBackup({archivePath:archive,passphrase,reportPath}),
     error=>error.diagnostic?.category==='RESTORE_FROZEN220_TRIGGER_ACL_UNSUPPORTED');
    const rejected=JSON.parse(await readFile(reportPath,'utf8'));
    assert.equal(rejected.stage,'restore-frozen220-trigger-acl');
    assert.equal(rejected.ok,false);
    cases.push({kind,rejectedBeforeClusterStart:true});
   }
  }
  return {ok:true,cases};
 }finally{await rm(work,{recursive:true,force:true});}
}
