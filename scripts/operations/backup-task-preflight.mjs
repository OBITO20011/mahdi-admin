// Local Windows task metadata only. No configuration/DPAPI/database/network IO.
import assert from 'node:assert/strict';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {operationalManifest,operationalSchema} from './operational-schema.mjs';
import {upgradePreparationFailure} from './upgrade-preparation-errors.mjs';
const exec=promisify(execFile);
export const requiredBackupModes=Object.freeze(['Backup','Upload','VerifyRemote','RestoreRemote','Watchdog']);
const same=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
export function assertRegisteredBackupTasks(tasks,repository){
 const script=path.join(repository,'scripts/operations/frankfurt-backup-owner.ps1');
 for(const mode of requiredBackupModes){
  const found=tasks.filter(t=>t.name==='Nawasrah Frankfurt '+mode);
  assert.equal(found.length,1,'UPGRADE_BACKUP_TASK_REQUIRED:'+mode);
  const task=found[0];assert.equal(task.enabled,true,'UPGRADE_BACKUP_TASK_DISABLED:'+mode);
  assert.equal(task.actions.length,1,'UPGRADE_BACKUP_TASK_ACTION_AMBIGUOUS:'+mode);
  const action=task.actions[0];assert.ok(same(action.workingDirectory,repository),'UPGRADE_BACKUP_TASK_OLD_CHECKOUT:'+mode);
  assert.equal(path.basename(action.execute).toLowerCase(),'powershell.exe','UPGRADE_BACKUP_TASK_EXECUTABLE:'+mode);
  const match=/^-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "([^"]+)" -Mode ([A-Za-z]+) -ConfigPath "([^"]+)" -Apply$/u.exec(action.arguments);
  assert.ok(match,'UPGRADE_BACKUP_TASK_ARGUMENTS_UNREVIEWED:'+mode);assert.equal(match[2],mode);
  assert.ok(same(match[1],script),'UPGRADE_BACKUP_TASK_OLD_SCRIPT:'+mode);
  assert.ok(path.isAbsolute(match[3]),'UPGRADE_BACKUP_TASK_CONFIG_PATH:'+mode);
 }
 return {ok:true,tasks:requiredBackupModes.length,supportedCeiling:operationalSchema.ceiling,repositoryMatches:true};
}
async function powershell(execute,code,failure){
 try{return await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],{windowsHide:true,maxBuffer:65536,timeout:15000});}
 catch(error){
  const code=error?.code==='ENOENT'?'UPGRADE_POWERSHELL_NOT_FOUND':error?.killed===true||error?.code==='ETIMEDOUT'?'UPGRADE_PREPARATION_TIMEOUT':failure;
  throw upgradePreparationFailure(code);
 }
}
export async function assertUpgradeAdministrator({execute=exec,platform=process.platform}={}){
 assert.equal(platform,'win32','UPGRADE_BACKUP_WINDOWS_TASK_PREFLIGHT_REQUIRED');
 const code="$ErrorActionPreference='Stop';$p=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent());if($p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){'NAWASRAH_ELEVATED'}else{'NAWASRAH_NOT_ELEVATED'}";
 const r=await powershell(execute,code,'UPGRADE_ADMINISTRATOR_CHECK_FAILED');
 const result=r.stdout.replace(/^\uFEFF/u,'').trim();
 if(result==='NAWASRAH_NOT_ELEVATED')throw upgradePreparationFailure('UPGRADE_BACKUP_TASKS_NOT_VISIBLE_RUN_AS_ADMINISTRATOR');
 if(result!=='NAWASRAH_ELEVATED')throw upgradePreparationFailure('UPGRADE_ADMINISTRATOR_CHECK_FAILED');
}
export async function registeredBackupPreflight(repository,{execute=exec,platform=process.platform,manifest=operationalManifest}={}){
 // Token elevation, not mere membership in the Administrators group. This is
 // before manifest/config reads, task enumeration, password prompts and DB IO.
 await assertUpgradeAdministrator({execute,platform});await manifest();
 const code="$ErrorActionPreference='Stop';$m=@('Backup','Upload','VerifyRemote','RestoreRemote','Watchdog');$r=@(foreach($n in $m){$t=Get-ScheduledTask -TaskName ('Nawasrah Frankfurt '+$n) -ErrorAction Stop;[ordered]@{name=$t.TaskName;enabled=($t.State -ne 'Disabled');actions=@($t.Actions|ForEach-Object{[ordered]@{execute=$_.Execute;arguments=$_.Arguments;workingDirectory=$_.WorkingDirectory}})}});ConvertTo-Json -InputObject $r -Depth 5 -Compress";
 const r=await powershell(execute,code,'UPGRADE_BACKUP_TASKS_READ_FAILED');
 let tasks;try{tasks=JSON.parse(r.stdout.replace(/^\uFEFF/u,''));}catch{throw upgradePreparationFailure('UPGRADE_BACKUP_TASKS_INVALID_RESPONSE');}
 if(!Array.isArray(tasks)||tasks.some(t=>!t||typeof t.name!=='string'||!Array.isArray(t.actions)||t.actions.some(a=>!a||['execute','arguments','workingDirectory'].some(k=>typeof a[k]!=='string'))))throw upgradePreparationFailure('UPGRADE_BACKUP_TASKS_INVALID_RESPONSE');
 return assertRegisteredBackupTasks(tasks,repository);
}
