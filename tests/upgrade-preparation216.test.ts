import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {assertUpgradeAdministrator,registeredBackupPreflight,requiredBackupModes,backupPreflightTimeoutMs} from '../scripts/operations/backup-task-preflight.mjs';
import {upgradePreparationCode,upgradePreparationFailure} from '../scripts/operations/upgrade-preparation-errors.mjs';
import {run215} from '../scripts/operations/frankfurt-owner-upgrade215.mjs';
import {run216} from '../scripts/operations/frankfurt-owner-upgrade216.mjs';
import {run217} from '../scripts/operations/frankfurt-owner-upgrade217.mjs';

const repository=path.resolve('local-test-checkout');
const tasks=()=>requiredBackupModes.map((mode:string)=>({name:'Nawasrah Frankfurt '+mode,enabled:true,actions:[{
 execute:path.resolve('Windows/System32/WindowsPowerShell/v1.0/powershell.exe'),workingDirectory:repository,
 arguments:`-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${path.join(repository,'scripts/operations/frankfurt-backup-owner.ps1')}" -Mode ${mode} -ConfigPath "${path.resolve('ProgramData/NawasrahFrankfurtBackup/config.json')}" -Apply`,
}]}));
const output=(stdout:string)=>({stdout,stderr:''});
const elevated=(rows=tasks())=>output(JSON.stringify({elevated:true,tasks:rows}));

test('non-elevated token stops before manifest and task enumeration; no automatic elevation',async()=>{
 const commands:string[]=[];let manifestReads=0;
 await assert.rejects(registeredBackupPreflight(repository,{platform:'win32',manifest:async()=>{manifestReads++;},execute:async(command:string,args:string[],options:any)=>{
  assert.equal(command,'powershell.exe');assert.equal(options.windowsHide,true);commands.push(args.at(-1)!);return output('NAWASRAH_NOT_ELEVATED\r\n');
 }}),{code:'UPGRADE_BACKUP_TASKS_NOT_VISIBLE_RUN_AS_ADMINISTRATOR'});
 assert.equal(manifestReads,0);assert.equal(commands.length,1);
 assert.ok(commands[0].includes('WindowsBuiltInRole]::Administrator'));assert.ok(!commands[0].includes('RunAs'));
 assert.ok(commands[0].indexOf("'NAWASRAH_NOT_ELEVATED';exit")<commands[0].indexOf('Get-ScheduledTask'));
});

test('elevated preflight accepts the same five exact registered tasks and preserves rejection of wrong task paths',async()=>{
 const events:string[]=[];let calls=0;
 const execute=async(_command:string,args:string[])=>{calls++;events.push('combined-powershell');const code=args.at(-1)!;
  assert.ok(code.includes('WindowsPrincipal'));assert.ok(code.includes("Get-ScheduledTask -TaskPath '\\'"));
  assert.equal(code.match(/\bGet-ScheduledTask\b/gu)?.length,1);return elevated();};
 assert.equal((await registeredBackupPreflight(repository,{platform:'win32',execute,manifest:async()=>{events.push('manifest');}})).tasks,5);
 assert.equal(calls,1);assert.deepEqual(events,['combined-powershell','manifest']);
 const bad=tasks();bad[0].actions[0].workingDirectory=path.resolve('wrong-checkout');
 await assert.rejects(registeredBackupPreflight(repository,{platform:'win32',manifest:async()=>{},execute:async()=>elevated(bad)}),error=>upgradePreparationCode(error)==='UPGRADE_BACKUP_TASK_OLD_CHECKOUT:Backup');
});

test('native task failures, invalid responses, missing PowerShell and timeouts expose only reviewed fixed codes',async()=>{
 const secret='SYNTHETIC_PRIVATE_VALUE_NOT_FOR_DIAGNOSTICS';
 for(const [failure,code] of [
  [Object.assign(new Error(secret),{code:1,stderr:secret}),'UPGRADE_BACKUP_TASKS_READ_FAILED'],
  [Object.assign(new Error(secret),{code:'ENOENT'}),'UPGRADE_POWERSHELL_NOT_FOUND'],
  [Object.assign(new Error(secret),{killed:true,signal:'SIGTERM'}),'UPGRADE_PREPARATION_TIMEOUT'],
 ] as const){
  await assert.rejects(registeredBackupPreflight(repository,{platform:'win32',manifest:async()=>{},execute:async()=>{throw failure;}}),error=>{
   assert.equal(upgradePreparationCode(error),code);assert.ok(!JSON.stringify(error).includes(secret));return true;
  });
 }
 for(const response of ['not json',JSON.stringify({unexpected:true}),JSON.stringify([{name:'x',actions:[{}]}]),JSON.stringify({elevated:false,tasks:tasks()}),JSON.stringify({elevated:true,tasks:[{name:'x',actions:[{}]}]})]){
  await assert.rejects(registeredBackupPreflight(repository,{platform:'win32',manifest:async()=>{},execute:async()=>output(response)}),{code:'UPGRADE_BACKUP_TASKS_INVALID_RESPONSE'});
 }
 for(const [sentinel,code]of[['NAWASRAH_ADMIN_CHECK_FAILED','UPGRADE_ADMINISTRATOR_CHECK_FAILED'],['NAWASRAH_TASKS_READ_FAILED','UPGRADE_BACKUP_TASKS_READ_FAILED']]as const)
  await assert.rejects(registeredBackupPreflight(repository,{platform:'win32',manifest:async()=>{assert.fail('no manifest after failed probe');},execute:async()=>output(sentinel)}),{code});
 await assert.rejects(assertUpgradeAdministrator({platform:'win32',execute:async()=>{throw new Error(secret);}}),{code:'UPGRADE_ADMINISTRATOR_CHECK_FAILED'});
 await assert.rejects(assertUpgradeAdministrator({platform:'win32',execute:async()=>output('unexpected')}),{code:'UPGRADE_ADMINISTRATOR_CHECK_FAILED'});
});

for(const[label,run]of[['215',run215],['216',run216],['217',run217]]as const)test(`run${label} apply checks privilege before every other preparation seam; dry-run and strict verify do not enumerate tasks`,async()=>{
 const events:string[]=[];
 await assert.rejects(run(['--apply'],{preflight:async()=>{events.push('privilege');throw upgradePreparationFailure('UPGRADE_BACKUP_TASKS_NOT_VISIBLE_RUN_AS_ADMINISTRATOR');},manifest:async()=>{events.push('manifest');},runOwner:async()=>{events.push('password-or-db');}}),{code:'UPGRADE_BACKUP_TASKS_NOT_VISIBLE_RUN_AS_ADMINISTRATOR'});
 assert.deepEqual(events,['privilege']);
 for(const mode of ['--dry-run','--verify-only']){
  const seen:string[]=[];const r=await run([mode],{preflight:async()=>{assert.fail('must not enumerate tasks');},manifest:async()=>{seen.push('manifest');},runOwner:async(args:string[])=>{assert.deepEqual(args,[mode]);seen.push('owner');return {ok:true};}});
  assert.equal(r.ok,true);assert.deepEqual(seen,['manifest','owner']);
 }
});

for(const mode of ['registered-tasks','reset-administrator']as const)test(`slow ${mode} survives the old15-second deadline with the shared120-second limit`,async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let calls=0;
 const execute=async(_command:string,_args:string[],options:any)=>{
  calls++;assert.equal(options.timeout,backupPreflightTimeoutMs);assert.equal(options.timeout,120_000);
  return new Promise<{stdout:string,stderr:string}>((resolve,reject)=>{
   const deadline=setTimeout(()=>reject(Object.assign(new Error('not exposed'),{killed:true})),options.timeout);
   setTimeout(()=>{clearTimeout(deadline);resolve(mode==='registered-tasks'?elevated():output('NAWASRAH_ELEVATED'));},20_000);
  });
 };
 const pending=mode==='registered-tasks'?registeredBackupPreflight(repository,{platform:'win32',execute,manifest:async()=>{}}):assertUpgradeAdministrator({platform:'win32',execute});
 let settled=false;void pending.then(()=>{settled=true;},()=>{settled=true;});
 t.mock.timers.tick(15_001);await Promise.resolve();assert.equal(settled,false);
 t.mock.timers.tick(4_999);await pending;assert.equal(calls,1);
});

test('a process that remains blocked at120seconds still fails closed with the fixed timeout code',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let manifestReads=0;
 const pending=registeredBackupPreflight(repository,{platform:'win32',manifest:async()=>{manifestReads++;},execute:async(_c:string,_a:string[],options:any)=>new Promise<{stdout:string,stderr:string}>((_resolve,reject)=>{
  setTimeout(()=>reject(Object.assign(new Error('SYNTHETIC_PRIVATE_VALUE'),{killed:true,signal:'SIGTERM'})),options.timeout);
 })});
 const rejected=assert.rejects(pending,{code:'UPGRADE_PREPARATION_TIMEOUT'});
 t.mock.timers.tick(120_000);await rejected;assert.equal(manifestReads,0);
});

test('preparation classification never echoes raw native/assertion operands and never accepts an arbitrary error code',()=>{
 for(const [error,expected] of [
  [Object.assign(new Error('private path and values'),{code:'ENOENT'}),'UPGRADE_PREPARATION_FILE_NOT_FOUND'],
  [Object.assign(new Error('private values'),{code:'EACCES'}),'UPGRADE_PREPARATION_ACCESS_DENIED'],
  [new SyntaxError('private JSON values'),'UPGRADE_PREPARATION_INVALID_JSON'],
  [new Error('private unknown error'),'UPGRADE_PREPARATION_UNEXPECTED_FAILURE'],
  [Object.assign(new Error('private CA path'),{diagnostic:{category:'TLS_ROOT_CERT_MISSING',private:'must not print'}}),'TLS_ROOT_CERT_MISSING'],
  [Object.assign(new Error('private CA bytes'),{diagnostic:{category:'TLS_CA_BUNDLE_INVALID'}}),'TLS_CA_BUNDLE_INVALID'],
  [Object.assign(new Error('OPERATIONAL_TOOL_MANIFEST_NOT_REVIEWED\nprivate operands'),{code:'ERR_ASSERTION'}),'OPERATIONAL_TOOL_MANIFEST_NOT_REVIEWED'],
  [Object.assign(new Error('UNKNOWN_OPTION\nprivate operands'),{code:'ERR_ASSERTION'}),'UPGRADE_PREPARATION_INVALID_ARGUMENTS'],
  [Object.assign(new Error('private assertion operands'),{code:'ERR_ASSERTION'}),'UPGRADE_PREPARATION_ASSERTION_FAILED'],
  [Object.assign(new Error('private values'),{code:'UPGRADE_UNREVIEWED_PRIVATE_VALUE'}),'UPGRADE_PREPARATION_UNEXPECTED_FAILURE'],
 ] as const)assert.equal(upgradePreparationCode(error),expected);
});
