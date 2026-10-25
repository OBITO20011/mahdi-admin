import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {postgresDiagnostic} from '../scripts/backup/postgres-diagnostic.mjs';
import {verifiedSupabaseCa,SUPABASE_CA_SHA256} from '../scripts/backup/supabase-ca.mjs';
import {SnapshotSession} from '../scripts/backup/snapshot-session.mjs';
import {createCompleteBackup,nativeSource} from '../scripts/backup/complete-backup.mjs';
import {runOwnerMode} from '../scripts/operations/frankfurt-backup-runtime.mjs';
const secret='Unique-PRIVATE-password-and-passphrase-<&>@%zz';
const connection='postgresql://postgres.some-project:'+secret+'@some-private-host.example:5432/postgres';
const dirty=message=>({message,stderr:`${message}\n${connection}\npassword=${secret}\nSQL: SELECT '${secret}';`,code:2});
test('known libpq/tool failures produce safe canonical categories,SQLSTATE,stage and exit code',()=>{
  for(const [text,category,state]of [
    ['SSL error: certificate verify failed','TLS_CA_UNTRUSTED',null],
    ['server certificate does not match host name','TLS_HOSTNAME_MISMATCH',null],
    ['root certificate file does not exist','TLS_ROOT_CERT_MISSING',null],
    ['FATAL: 28P01: password authentication failed','AUTH_REJECTED','28P01'],
    ['FATAL: Tenant or user not found','POOLER_TENANT_USER_NOT_FOUND',null],
    ['FATAL: unsupported startup parameter: options','POOLER_STARTUP_OPTION_UNSUPPORTED',null],
    ['could not translate host name','DNS_FAILURE',null],
    ['connection timed out','CONNECT_TIMEOUT',null],
    ['connection refused','CONNECT_FAILED',null],
    ['aborting because of server version mismatch','TOOL_SERVER_VERSION_MISMATCH',null],
    ['ERROR: 22023: invalid snapshot identifier','SNAPSHOT_NOT_AVAILABLE','22023'],
    ['ERROR: 25006: cannot execute INSERT in a read-only transaction','SQL_READ_ONLY_VIOLATION','25006'],
    ['ERROR: 42501: permission denied for table','SQL_PERMISSION_DENIED','42501'],
  ]){
    const d=postgresDiagnostic(dirty(text),{tool:'psql',stage:'snapshot'});
    assert.equal(d.category,category);assert.equal(d.sqlstate,state);assert.equal(d.exitCode,2);assert.equal(d.stage,'snapshot');assert.equal(d.tool,'psql');
    const json=JSON.stringify(d);for(const value of [secret,connection,'some-private-host','SELECT'])assert.ok(!json.includes(value));
  }
  const malicious=postgresDiagnostic({diagnostic:{category:'AUTH_REJECTED',libpqMessage:secret,stage:secret,tool:secret,exitCode:secret,sqlstate:secret}});
  assert.ok(!JSON.stringify(malicious).includes(secret));
});
test('private error payloads are not reflected even when no pattern matches',()=>{
  for(const message of [secret,connection,'PANIC: secret-column='+secret,JSON.stringify({nested:secret}),secret.repeat(4000)]){
    const text=JSON.stringify(postgresDiagnostic(dirty(message)));assert.ok(!text.includes(secret));assert.ok(!text.includes('some-private-host'));assert.ok(!text.includes('postgresql:'));
  }
});
test('psql stderr is drained before failure; TLS category and exit survive EPIPE/close',async()=>{
  const code=`process.stdin.resume();process.stdin.once('data',()=>{process.stderr.write('psql: SSL error: certificate verify failed '+process.env.FAKE_SECRET+'\\n',()=>process.exit(2));});`;
  const s=new SnapshotSession(process.execPath,['-e',code],{...process.env,FAKE_SECRET:secret});
  try{await assert.rejects(s.query('BEGIN READ ONLY;'),error=>{
    const e=error as Error&{diagnostic:any};assert.equal(e.diagnostic.category,'TLS_CA_UNTRUSTED');assert.equal(e.diagnostic.exitCode,2);assert.ok(!JSON.stringify(e).includes(secret));return true;
  });}finally{await s.close();}
});
test('safe diagnostic survives backup phase report and owner operation report',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'backup-diagnostic-'));
  const backupRoot=path.join(root,'Frankfurt-kzevmysfydaslxcerogt');
  const source={session:()=>new SnapshotSession(process.execPath,['-e',`process.stdin.once('data',()=>{process.stderr.write('SSL error: certificate verify failed\\n',()=>process.exit(2));});`])};
  const config={formatVersion:1,projectRef:'kzevmysfydaslxcerogt',connection:'postgresql://postgres@db.kzevmysfydaslxcerogt.supabase.co/postgres',protectionScope:'LocalMachine',businessAlertsEnabled:false,backupRoot,stateRoot:root,retentionCount:30};
  try{
    await assert.rejects(runOwnerMode({mode:'Backup',config,env:{NAWASRAH_FF_PASSPHRASE:secret},dependencies:{source}}));
    for(const file of [path.join(backupRoot,'last-backup-status.json'),path.join(root,'operation-Backup.json')]){
      const raw=await readFile(file,'utf8'),report=JSON.parse(raw);assert.equal(report.diagnostic.category,'TLS_CA_UNTRUSTED');assert.equal(report.diagnostic.stage,'snapshot');assert.equal(report.diagnostic.exitCode,2);assert.ok(!raw.includes(secret));
    }
    await assert.rejects(runOwnerMode({mode:'Restore',config,env:{},dependencies:{}}));
    assert.equal(JSON.parse(await readFile(path.join(root,'operation-Restore.json'),'utf8')).diagnostic.category,'BACKUP_NOT_AVAILABLE');
  }finally{await rm(root,{recursive:true,force:true});}
});
test('official public CA is pinned and source keeps verify-full without any weak fallback',async()=>{
  const ca=verifiedSupabaseCa();assert.equal(ca.sha256,SUPABASE_CA_SHA256);assert.ok(path.isAbsolute(ca.path));
  const source=await readFile('scripts/backup/complete-backup.mjs','utf8');assert.match(source,/set\('sslmode','verify-full'\)/);assert.match(source,/set\('sslrootcert',ca.path\)/);assert.doesNotMatch(source,/set\('sslmode','(?:require|disable|prefer)'\)/);
  assert.throws(()=>nativeSource({projectRef:'unapproved',connection,pgBin:'',password:secret}));
  // The real transport is exercised by the separate localhost-only native TLS probe.
  assert.equal(typeof createCompleteBackup,'function');
});
