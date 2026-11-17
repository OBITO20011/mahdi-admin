// Synthetic archive variants from the owned220 source only; never an owner archive.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdtemp,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {verifyBackupArchive} from '../backup/verify-backup.mjs';
import {encryptFile} from '../backup/backup-crypto.mjs';
import {restoreCompleteBackup,withRestoredRehearsal220} from '../backup/complete-backup.mjs';
import {restoreLite220PrivateAcl} from '../backup/restore-lite220-private-acl.mjs';
import {rehearsal220Executor} from './rehearsal220-local.mjs';
import {executeInput} from '../operations/build-empty-supabase.mjs';
const exec=promisify(execFile);
export async function proveLite220PrivateAclArchives({archivePath,passphrase,output}){
 assert.ok(path.basename(output).startsWith('nawasrah-owner-upgrade222-'));
 assert.ok(path.resolve(archivePath).startsWith(path.resolve(output)+path.sep));
 const work=await mkdtemp(path.join(tmpdir(),'nawasrah-private220-acl-')),cases=[];
 try{
  for(const kind of ['valid','missing','extra','table-grant','schema-grant','null']){
   const content=path.join(work,kind);
   await verifyBackupArchive({archivePath,passphrase,extractTo:content});
   const file=path.join(content,'database/source-evidence.json'),before=JSON.parse(await readFile(file,'utf8'));
   const selected=before.catalog.tables.filter(row=>['sales_lite1','sales_lite2'].includes(row.schema));assert.equal(selected.length,11);
   if(kind==='missing')before.catalog.tables=before.catalog.tables.filter(row=>row!==selected[0]);
   if(kind==='extra')before.catalog.tables.push({...selected[0],name:'unexpected'});
   if(kind==='table-grant')selected[0].acl=['postgres=arwdDxtm/postgres','anon=r/postgres'];
   if(kind==='schema-grant')before.catalog.schemas.find(row=>row.name==='sales_lite1').acl=['postgres=UC/postgres','anon=U/postgres'];
   if(kind==='null')selected[0].acl=null;
   await writeFile(file,JSON.stringify(before)+'\n');
   const manifestFile=path.join(content,'manifest.json'),manifest=JSON.parse(await readFile(manifestFile,'utf8'));
   const entry=manifest.files.find(row=>row.path==='database/source-evidence.json');entry.size=(await stat(file)).size;entry.sha256=createHash('sha256').update(await readFile(file)).digest('hex');
   await writeFile(manifestFile,JSON.stringify(manifest)+'\n');
   const tar=path.join(work,kind+'.tar'),archive=path.join(work,kind+'.nwb');
   await exec(process.platform==='win32'?'tar.exe':'tar',['-cf',tar,'-C',content,'.'],{windowsHide:true});await encryptFile(tar,archive,passphrase);
   const reportPath=path.join(output,'private220-acl-'+kind+'.json');
   if(kind==='valid'){
    const restored=await withRestoredRehearsal220({archivePath:archive,passphrase,reportPath},async context=>{
     const executor=await rehearsal220Executor(context),queries=[];
     try{
      const session={query:async sql=>{queries.push(sql);const result=await executeInput(executor,sql);assert.equal(result.code,0);return result.stdout;}};
      const a=await restoreLite220PrivateAcl(session,before),b=await restoreLite220PrivateAcl(session,before);
      assert.deepEqual(a,b);assert.equal(a.checked,13);assert.equal(queries.length,2); // Only two catalog reads, no GRANT/BEGIN.
     }finally{await executor.closeLocal();}
    });
    assert.equal(restored.ok,true);assert.deepEqual(restored.private220Acl,{applicable:true,checked:13,exactRawAcl:true,exceptionsApplied:[]});
    assert.deepEqual(restored.frozen220TriggerAcl,{profile:'frankfurt',checked:4,exactRawAcl:true,exceptionsApplied:[]});
    assert.equal(restored.catalogAclOwnerSettingsMatch,true);cases.push({kind,raw13:true,idempotent:true,triggerFourUnchanged:true,strictRestore:true});
   }else{
    await assert.rejects(restoreCompleteBackup({archivePath:archive,passphrase,reportPath}),error=>error.diagnostic?.category==='RESTORE_LITE220_PRIVATE_ACL_UNSUPPORTED');
    const failed=JSON.parse(await readFile(reportPath,'utf8'));assert.equal(failed.stage,'restore-lite220-private-acl');assert.equal(failed.ok,false);
    cases.push({kind,rejectedBeforeClusterStart:true});
   }
  }
  return {ok:true,cases};
 }finally{await rm(work,{recursive:true,force:true});}
}
