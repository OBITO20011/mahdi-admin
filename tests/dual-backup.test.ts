import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {assertApprovedBackupProject,assertBackupDatabaseProject} from '../scripts/backup/backup-public-config.mjs';
import {safeObjectName,nativeSource} from '../scripts/backup/complete-backup.mjs';
import {ownerPlan,runOwnerMode,validateOwnerConfig,PREFIX} from '../scripts/operations/frankfurt-backup-runtime.mjs';
const ref='kzevmysfydaslxcerogt';
const config=(root:string)=>({formatVersion:1,projectRef:ref,connection:`postgresql://postgres@db.${ref}.supabase.co:5432/postgres`,protectionScope:'LocalMachine',businessAlertsEnabled:false,backupRoot:root,stateRoot:root,retentionCount:30,publishableKey:'local-fixture-only'});

test('backup allowlist rejects arbitrary, cross-project, transaction-pool and deceptive targets before IO',()=>{
  for(const id of [ref,'acjtabdqqnpwhdvbvnyw']){
    assert.equal(assertApprovedBackupProject(id),id);
    assert.doesNotThrow(()=>assertBackupDatabaseProject(`postgresql://postgres@db.${id}.supabase.co/postgres`,id));
    assert.doesNotThrow(()=>assertBackupDatabaseProject(`postgresql://postgres.${id}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`,id));
  }
  for(const url of [`postgresql://postgres@db.acjtabdqqnpwhdvbvnyw.supabase.co/postgres`,`postgresql://postgres.${ref}@evil.pooler.supabase.com:5432/postgres`,`postgresql://postgres.${ref}@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`,`postgresql://postgres:secret@db.${ref}.supabase.co/postgres`,`postgresql://postgres@db.${ref}.supabase.co/postgres?sslmode=disable`,`postgresql://postgres@db.${ref}.supabase.co/other`])assert.throws(()=>assertBackupDatabaseProject(url,ref));
  assert.throws(()=>assertApprovedBackupProject('other'));
  assert.throws(()=>nativeSource({projectRef:'other',connection:'postgresql://localhost/postgres'}));
});
test('Storage names cannot escape the isolated extraction or use Windows alternate streams',()=>{
  assert.equal(safeObjectName('folder/photo.webp'),'folder/photo.webp');
  for(const name of ['../photo','/photo','a/../b','a\\b','C:/photo','a:b','a//b','a\u0000b'])assert.throws(()=>safeObjectName(name));
});
test('offline owner plan has no runtime IO and never activates business recipients',async()=>{
  assert.deepEqual(await runOwnerMode({mode:'Plan',config:null}),ownerPlan());
  assert.equal(ownerPlan().networkAttempted,false);assert.equal(ownerPlan().legacyUnchanged,true);assert.equal(ownerPlan().businessAlertsEnabled,false);
  assert.ok(PREFIX.startsWith('erp/frankfurt-'));assert.throws(()=>validateOwnerConfig({...config(tmpdir()),businessAlertsEnabled:true}));
});
test('owner test sends at most once even when Telegram delivery is uncertain',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'ff-test-alert-'));let calls=0;
  try{
    const send=async({maxAttempts,message}:{maxAttempts:number;message:string})=>{calls++;assert.equal(maxAttempts,1);assert.ok(!message.includes('زبون نقدي'));return false;};
    for(let n=0;n<2;n++)await assert.rejects(runOwnerMode({mode:'TestAlert',config:config(root),env:{},dependencies:{send}}));
    assert.equal(calls,1);const saved=JSON.parse(await readFile(path.join(root,'test-alert.json'),'utf8'));assert.equal(saved.attempts,1);assert.equal(saved.recipient,'developer');
  }finally{await rm(root,{recursive:true,force:true});}
});
test('Frankfurt watchdog reports backup failures/400MB through the developer sender and caches daily sampling',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'ff-watchdog-'));let sizes=0,keepalives=0,sends=0;
  try{
    const source={session:()=>({query:async(sql:string)=>{
      if(sql.includes('pg_database_size')){sizes++;return '400000000';}
      if(sql.includes('get_advanced_monitoring_status'))return JSON.stringify({checkedAt:new Date().toISOString(),scanErrorCode:null,checks:[]});return '';
    },close:async()=>{}})};
    const dependencies={source,fetchImpl:async()=>{keepalives++;return new Response(JSON.stringify({ordersEnabled:false,storeNameAr:'محل الاختبار'}),{status:200});},send:async()=>{sends++;return true;}};
    const result=await runOwnerMode({mode:'Watchdog',config:config(root),env:{},dependencies});
    assert.equal(result.recipient,'developer');assert.equal(result.businessAlertsEnabled,false);
    assert.ok(result.checks.some((c:{key:string;healthy:boolean})=>c.key.endsWith('daily-size')&&!c.healthy));
    assert.ok(sends>0);await runOwnerMode({mode:'Watchdog',config:config(root),env:{},dependencies});assert.equal(sizes,1);assert.equal(keepalives,1);
    await writeFile(path.join(root,'monitor.lock'),'operator-owned');await assert.rejects(runOwnerMode({mode:'Watchdog',config:config(root),env:{},dependencies}),/LOCKED/);
  }finally{await rm(root,{recursive:true,force:true});}
});
