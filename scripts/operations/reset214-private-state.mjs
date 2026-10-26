// Local owner-only state. No Auth/MFA rows,keys or passwords are serialized.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,open,readFile,rename,lstat,chmod} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {sha256} from '../testing/maintenance-db-contract.mjs';
const exec=promisify(execFile);
export async function protectResetPath(target,directory=false){
 const st=await lstat(target);assert.equal(st.isSymbolicLink(),false,'RESET214_PRIVATE_PATH_LINK');
 if(process.platform==='win32'){
  // A fresh ACL replaces inherited AND explicit entries. Locale-independent SIDs.
  const code=`$ErrorActionPreference='Stop';$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;$acl=New-Object Security.AccessControl.${directory?'DirectorySecurity':'FileSecurity'};$acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false);foreach($id in @($sid,(New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')))){$rule=New-Object Security.AccessControl.FileSystemAccessRule($id,'FullControl',${directory?"'ContainerInherit,ObjectInherit','None',":""}'Allow');$acl.AddAccessRule($rule)};[IO.${directory?'Directory':'File'}]::SetAccessControl($env:RESET214_PRIVATE_PATH,$acl);$a=[IO.${directory?'Directory':'File'}]::GetAccessControl($env:RESET214_PRIVATE_PATH);if(-not $a.AreAccessRulesProtected){throw 'ACL_NOT_PROTECTED'};foreach($r in $a.Access){$s=$r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value;if($s -notin @($sid.Value,'S-1-5-32-544') -or $r.AccessControlType -ne 'Allow'){throw 'ACL_UNEXPECTED'}}`;
  await exec('powershell.exe',['-NoProfile','-Command',code],{windowsHide:true,env:{...process.env,RESET214_PRIVATE_PATH:target}});
 }else await chmod(target,directory?0o700:0o600);
}
export async function privateResetDirectory(workdir){
 const folder=path.join(workdir,'reset214-private');await mkdir(folder,{recursive:true,mode:0o700});await protectResetPath(folder,true);return folder;
}
export async function writePrivateResetJson(file,value){
 const text=JSON.stringify(value,null,2)+'\n',temporary=file+'.'+randomUUID()+'.tmp';
 // Parent is already private;no readable interval before file ACL replacement.
 const handle=await open(temporary,'wx',0o600);try{await handle.writeFile(text,'utf8');await handle.sync();}finally{await handle.close();}
 await protectResetPath(temporary);await rename(temporary,file);
 assert.equal(await readFile(file,'utf8'),text,'RESET214_PRIVATE_READBACK_FAILED');return sha256(text);
}
export async function readPrivateResetJson(file,expectedHash){
 assert.equal((await lstat(path.dirname(file))).isSymbolicLink(),false,'RESET214_PRIVATE_PATH_LINK');await protectResetPath(file);
 const text=await readFile(file,'utf8');if(expectedHash)assert.equal(sha256(text),expectedHash,'RESET214_RETENTION_HASH_MISMATCH');
 return JSON.parse(text);
}
export const resetSnapshotName='retention.json';
export function assertResetSnapshot(snapshot,{ownerId,projectRef,referenceSha256}){
 assert.equal(snapshot.format,1,'RESET214_SNAPSHOT_FORMAT');assert.equal(snapshot.ownerId,ownerId,'RESET214_RESUME_OWNER_MISMATCH');
 assert.equal(snapshot.projectRef,projectRef,'RESET214_RESUME_PROJECT_MISMATCH');assert.equal(snapshot.referenceSha256,referenceSha256,'RESET214_RESUME_REFERENCE_CHANGED');
 assert.equal(snapshot.referenceCeiling,214);assert.equal(snapshot.state.plan.ownerId,ownerId);
 assert.deepEqual(Object.keys(snapshot.state.rawTables).sort(),['branches','warehouses','roles','profiles','user_roles','units','categories','storefront_settings'].sort(),'RESET214_RETENTION_TABLES');
 // Actual secret-bearing platform rows are forbidden even in this private file.
 assert.ok(!/"(?:encrypted_password|secret|refresh_token|access_token|recovery_token)"\s*:/u.test(JSON.stringify(snapshot)),'RESET214_PLATFORM_SECRET_FORBIDDEN');
 return snapshot;
}
