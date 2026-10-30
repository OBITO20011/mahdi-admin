// Local Windows task metadata only. No configuration/DPAPI/database/network IO.
import assert from 'node:assert/strict';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {operationalManifest,operationalSchema} from './operational-schema.mjs';
import {upgradePreparationFailure} from './upgrade-preparation-errors.mjs';
const nativeExec=promisify(execFile);
/**
 * A plain result seam, without exposing ChildProcess handles to callers.
 * @param {string} command
 * @param {string[]} args
 * @param {{windowsHide:boolean,maxBuffer:number,timeout:number}} options
 */
const exec=async(command,args,options)=>{
 const r=await nativeExec(command,args,{...options,encoding:'utf8'});
 return {stdout:r.stdout,stderr:r.stderr};
};
export const requiredBackupModes=Object.freeze(['Backup','Upload','VerifyRemote','RestoreRemote','Watchdog']);
// Owner30Oct:five native task queries took13.56s before PowerShell startup.
export const backupPreflightTimeoutMs=120_000;
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
 try{return await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],{windowsHide:true,maxBuffer:65536,timeout:backupPreflightTimeoutMs});}
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
 // One process and one root query. Token elevation still exits before reading
 // tasks;all local gates finish before any caller can prompt/connect/write.
 assert.equal(platform,'win32','UPGRADE_BACKUP_WINDOWS_TASK_PREFLIGHT_REQUIRED');
 const code="$ErrorActionPreference='Stop';try{$p=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent());$e=$p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)}catch{'NAWASRAH_ADMIN_CHECK_FAILED';exit};if(-not $e){'NAWASRAH_NOT_ELEVATED';exit};try{$m=@('Backup','Upload','VerifyRemote','RestoreRemote','Watchdog');$names=@($m|ForEach-Object{'Nawasrah Frankfurt '+$_});$all=@(Get-ScheduledTask -TaskPath '\\' -ErrorAction Stop);$r=@(foreach($t in $all){if($names -contains $t.TaskName){[ordered]@{name=$t.TaskName;enabled=($t.State -ne 'Disabled');actions=@($t.Actions|ForEach-Object{[ordered]@{execute=$_.Execute;arguments=$_.Arguments;workingDirectory=$_.WorkingDirectory}})}}});ConvertTo-Json -InputObject ([ordered]@{elevated=$true;tasks=$r}) -Depth 6 -Compress}catch{'NAWASRAH_TASKS_READ_FAILED';exit}";
 const r=await powershell(execute,code,'UPGRADE_BACKUP_TASKS_READ_FAILED');
 const result=r.stdout.replace(/^\uFEFF/u,'').trim();
 if(result==='NAWASRAH_NOT_ELEVATED')throw upgradePreparationFailure('UPGRADE_BACKUP_TASKS_NOT_VISIBLE_RUN_AS_ADMINISTRATOR');
 if(result==='NAWASRAH_ADMIN_CHECK_FAILED')throw upgradePreparationFailure('UPGRADE_ADMINISTRATOR_CHECK_FAILED');
 if(result==='NAWASRAH_TASKS_READ_FAILED')throw upgradePreparationFailure('UPGRADE_BACKUP_TASKS_READ_FAILED');
 let response;try{response=JSON.parse(result);}catch{throw upgradePreparationFailure('UPGRADE_BACKUP_TASKS_INVALID_RESPONSE');}
 if(response?.elevated!==true)throw upgradePreparationFailure('UPGRADE_BACKUP_TASKS_INVALID_RESPONSE');
 const tasks=response.tasks;
 if(!Array.isArray(tasks)||tasks.some(t=>!t||typeof t.name!=='string'||!Array.isArray(t.actions)||t.actions.some(a=>!a||['execute','arguments','workingDirectory'].some(k=>typeof a[k]!=='string'))))throw upgradePreparationFailure('UPGRADE_BACKUP_TASKS_INVALID_RESPONSE');
 await manifest();
 return assertRegisteredBackupTasks(tasks,repository);
}
