import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,open,readdir,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {runOwnerMode,validateOwnerConfig} from '../scripts/operations/frankfurt-backup-runtime.mjs';
import {withOwnerOperation,releaseOwnerLock} from '../scripts/operations/owner-operation.mjs';
import {classifiedError,postgresDiagnostic} from '../scripts/backup/postgres-diagnostic.mjs';
const secret='SYNTHETIC-password-and-archive-passphrase-only';
const config=(root:string)=>({formatVersion:1,projectRef:'kzevmysfydaslxcerogt',connection:'postgresql://postgres@db.kzevmysfydaslxcerogt.supabase.co/postgres',protectionScope:'LocalMachine',businessAlertsEnabled:false,backupRoot:path.join(root,'Frankfurt-kzevmysfydaslxcerogt'),stateRoot:root,retentionCount:30});
const read=async(file:string)=>JSON.parse(await readFile(file,'utf8'));
async function fixture(run:(root:string)=>Promise<void>){const root=await mkdtemp(path.join(tmpdir(),'owner-operation-'));try{await run(root);}finally{await rm(root,{recursive:true,force:true});}}

test('exception immediately after lock creation is reported and releases lock before next operation',async()=>fixture(async root=>{
  const lock=path.join(root,'backup-offsite.lock');let sawOwnedLock=false;
  const env=Object.defineProperty({},'NAWASRAH_FF_PASSPHRASE',{get(){sawOwnedLock=existsSync(lock);throw new Error(secret);}});
  await assert.rejects(runOwnerMode({mode:'Backup',config:config(root),env}));
  assert.equal(sawOwnedLock,true);assert.equal(existsSync(lock),false);
  for(const file of [path.join(root,'operation-Backup.json'),path.join(config(root).backupRoot,'last-backup-status.json')]){
    const report=await read(file);assert.equal(report.ok,false);assert.equal(report.diagnostic.category,'OPERATION_FAILED');assert.equal(report.diagnostic.stage,'operation-preflight');assert.ok(!JSON.stringify(report).includes(secret));
  }
  await assert.rejects(runOwnerMode({mode:'Restore',config:config(root),env:{NAWASRAH_FF_PASSPHRASE:secret}}));
  assert.equal((await read(path.join(root,'operation-Restore.json'))).diagnostic.category,'BACKUP_NOT_AVAILABLE');
  assert.equal(existsSync(lock),false);
}));

test('missing env and PostgreSQL directory have specific safe codes and never reach a database',async()=>fixture(async root=>{
  const cases:Array<[Record<string,string>,string,string|null]>=[
    [{},'MISSING_ENV','NAWASRAH_FF_PASSPHRASE'],
    [{NAWASRAH_FF_PASSPHRASE:secret},'MISSING_ENV','NAWASRAH_FF_DB_PASSWORD'],
    [{NAWASRAH_FF_PASSPHRASE:secret,NAWASRAH_FF_DB_PASSWORD:secret},'PG_BIN_NOT_FOUND',null],
    [{NAWASRAH_FF_PASSPHRASE:'short'},'ARCHIVE_PASSPHRASE_INVALID',null],
  ];
  for(const [env,category,variable]of cases){
    await assert.rejects(runOwnerMode({mode:'Backup',config:{...config(root),pgBinPath:path.join(root,'missing-native-bin')},env}));
    const report=await read(path.join(root,'operation-Backup.json'));
    assert.equal(report.diagnostic.category,category);assert.equal(report.diagnostic.variable??null,variable);assert.ok(!JSON.stringify(report).includes(secret));assert.equal(existsSync(path.join(root,'backup-offsite.lock')),false);
  }
  assert.throws(()=>validateOwnerConfig({...config(root),connection:secret}),/CONFIG_INVALID/);
  const forged=postgresDiagnostic({diagnostic:{category:'MISSING_ENV',variable:secret,libpqMessage:secret,tool:secret,stage:secret}});
  assert.ok(!JSON.stringify(forged).includes(secret));
  assert.equal(postgresDiagnostic(classifiedError('MISSING_ENV',{variable:'NAWASRAH_FF_PASSPHRASE',stage:'owner-env',tool:'powershell'})).variable,'NAWASRAH_FF_PASSPHRASE');
}));

test('existing lock survives rejection unchanged;no env getter or operation body runs',async()=>fixture(async root=>{
  const file=path.join(root,'backup-offsite.lock'),original=JSON.stringify({pid:process.pid,startedAt:new Date().toISOString(),mode:'Backup'});
  await writeFile(file,original);let reads=0;
  const env=Object.defineProperty({},'NAWASRAH_FF_PASSPHRASE',{get(){reads++;throw new Error(secret);}});
  await assert.rejects(runOwnerMode({mode:'Restore',config:config(root),env}));
  assert.equal(reads,0);assert.equal(await readFile(file,'utf8'),original);
  assert.equal((await read(path.join(root,'operation-Restore.json'))).diagnostic.category,'LOCKED');
}));

test('report write failure cannot strand a lock and uses a safe alternate report',async()=>fixture(async root=>{
  await assert.rejects(withOwnerOperation({mode:'Backup',root,backupRoot:config(root).backupRoot,run:async()=>({ok:true}),reportWriter:async()=>{assert.equal(existsSync(path.join(root,'backup-offsite.lock')),true,'report must remain serialized under its owned lock');throw new Error(secret);}}),/REPORT_WRITE_FAILED/);
  assert.equal(existsSync(path.join(root,'backup-offsite.lock')),false);
  const fallback=await read(path.join(root,'operation-Backup-fallback.json'));
  assert.equal(fallback.ok,false);assert.equal(fallback.reportDiagnostic.category,'REPORT_WRITE_FAILED');assert.ok(!JSON.stringify(fallback).includes(secret));
  await withOwnerOperation({mode:'Backup',root,backupRoot:config(root).backupRoot,run:async()=>({ok:true})});
  assert.equal((await read(path.join(root,'operation-Backup.json'))).ok,true);
}));

test('close failure still attempts unlink;replaced lock is never removed',async()=>fixture(async root=>{
  const file=path.join(root,'backup-offsite.lock'),handle=await open(file,'wx');await handle.writeFile('owned');
  const close=handle.close.bind(handle);handle.close=async()=>{await close();throw new Error(secret);};
  await assert.rejects(releaseOwnerLock(handle,file,'owned'),/LOCK_CLEANUP_FAILED/);assert.equal(existsSync(file),false);
  const second=await open(file,'wx');await second.writeFile('owned');await writeFile(file,'operator-replaced');
  await assert.rejects(releaseOwnerLock(second,file,'owned'),/LOCK_CLEANUP_FAILED/);assert.equal(await readFile(file,'utf8'),'operator-replaced');
}));

test('a real filesystem report-destination failure leaves no orphan and preserves a fallback',async()=>fixture(async root=>{
  await mkdir(path.join(root,'operation-TestAlert.json'));
  let sends=0;
  await assert.rejects(runOwnerMode({mode:'TestAlert',config:config(root),env:{},dependencies:{send:async()=>{sends++;return true;}}}));
  assert.equal(sends,1);assert.equal(existsSync(path.join(root,'monitor.lock')),false);
  const fallback=await read(path.join(root,'operation-TestAlert-fallback.json'));
  assert.equal(fallback.reportDiagnostic.category,'REPORT_WRITE_FAILED');assert.equal(fallback.ok,false);
}));

test('CLI invalid configuration writes a safe fresh preflight report without acquiring a lock',async()=>fixture(async root=>{
  const file=path.join(root,'config.json');await writeFile(file,'{"private":"'+secret+'"}');
  await assert.rejects(promisify(execFile)(process.execPath,['scripts/operations/frankfurt-backup-runtime.mjs','Backup'],{env:{...process.env,NAWASRAH_FF_CONFIG:file}}),error=>{
    const e=error as Error&{stderr:string};const report=JSON.parse(e.stderr.trim());assert.equal(report.diagnostic.category,'CONFIG_INVALID');assert.ok(!e.stderr.includes(secret));return true;
  });
  assert.equal((await read(path.join(root,'operation-Backup.json'))).diagnostic.category,'CONFIG_INVALID');assert.equal(existsSync(path.join(root,'backup-offsite.lock')),false);
}));

test('two real file-handle contenders keep a single owner and refresh final status without temp collisions',async()=>fixture(async root=>{
  let entered!:()=>void,finish!:()=>void;const ready=new Promise<void>(r=>{entered=r;}),waiting=new Promise<void>(r=>{finish=r;});
  const first=withOwnerOperation({mode:'Backup',root,backupRoot:config(root).backupRoot,run:async()=>{entered();await waiting;return {ok:true};}});
  await ready;
  try{await assert.rejects(withOwnerOperation({mode:'Backup',root,backupRoot:config(root).backupRoot,run:async()=>assert.fail('contender entered')}),/LOCKED/);assert.equal(existsSync(path.join(root,'backup-offsite.lock')),true);}
  finally{finish();await first;}
  assert.equal((await read(path.join(root,'operation-Backup.json'))).ok,true);assert.equal(existsSync(path.join(root,'backup-offsite.lock')),false);assert.ok(!(await readdir(root)).some(f=>f.endsWith('.tmp')));
}));

