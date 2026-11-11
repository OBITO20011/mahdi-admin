// Records the known220 limit. Reverse the expectation only with approved221.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {executeInput} from '../operations/build-empty-supabase.mjs';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';
import {readEpochLockSnapshot} from './epoch220-fixture-maintenance.mjs';

async function privateFingerprint(executor){
 const result=await executeInput(executor,`BEGIN READ ONLY;
 DO $d$ DECLARE r record;h text;tables jsonb='{}';BEGIN
 FOR r IN SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN('sales_lite1','sales_lite2') ORDER BY schemaname,tablename LOOP
  EXECUTE format('SELECT md5(COALESCE(string_agg(to_jsonb(t)::text,E''\\n'' ORDER BY to_jsonb(t)::text COLLATE "C"),'''')) FROM %I.%I t',r.schemaname,r.tablename) INTO h;
  tables:=tables||jsonb_build_object(r.schemaname||'.'||r.tablename,h);
 END LOOP;RAISE NOTICE 'EPOCH_PRIVATE_FINGERPRINT:%',tables;END $d$;ROLLBACK;`);
 assert.equal(result.code,0,result.stderr);
 const match=result.stderr.match(/EPOCH_PRIVATE_FINGERPRINT:(\{[^\r\n]+\})/u);
 assert.ok(match);return JSON.parse(match[1]);
}

function vacuumSession(executor){
 const child=spawn(executor.command,executor.args,{windowsHide:true,stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='',readyResolve,readyReject,doneResolve,doneReject;
 const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 const done=new Promise((resolve,reject)=>{doneResolve=resolve;doneReject=reject;});
 done.catch(()=>{}); // The original promise is still awaited during cleanup.
 child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
 child.stdout.on('data',text=>{
  stdout+=text;
  if(stdout.includes('EPOCH_VACUUM_READY'))readyResolve();
  if(stdout.includes('EPOCH_VACUUM_DONE'))doneResolve();
 });
 child.stderr.on('data',text=>stderr+=text);
 const closed=new Promise(resolve=>{
  child.on('error',error=>{readyReject(error);doneReject(error);});
  child.on('close',code=>{
   if(!stdout.includes('EPOCH_VACUUM_READY'))readyReject(Error('EPOCH_VACUUM_START_FAILED'));
   if(!stdout.includes('EPOCH_VACUUM_DONE'))doneReject(Error('EPOCH_VACUUM_FAILED'));
   resolve({code,stderr});
  });
 });
 // Session settings only, to hold a real VACUUM long enough for two sessions.
 child.stdin.write("SET application_name='lite220-known-vacuum';SET vacuum_cost_delay='20ms';SET vacuum_cost_limit=1;SET vacuum_cost_page_hit=10;SELECT 'EPOCH_VACUUM_READY';VACUUM (ANALYZE) public.products;SELECT 'EPOCH_VACUUM_DONE';\n");
 return {ready,close:async()=>{try{await done;}finally{child.stdin.end('\\q\n');}const result=await closed;assert.equal(result.code,0,result.stderr);}};
}

export async function verifyKnownEpochVacuumBusy220(c,report,call,key){
 const target={executor:c.executor,containerId:c.ownedContainerId};
 await c.assertOwned();
 await readEpochLockSnapshot(target); // Confirms the owned,network-none target.
 const executor={command:'docker',args:[...c.executor.args]};
 executor.args[2]=c.ownedContainerId;
 const before=await readApplicationFingerprint(executor),beforePrivate=await privateFingerprint(executor);
 const vacuum=vacuumSession(executor);
 let snapshot;
 try{
  await vacuum.ready;
  const deadline=performance.now()+10000;
  do{
   snapshot=await readEpochLockSnapshot(target);
   const worker=snapshot.activity.find(row=>row.application==='lite220-known-vacuum');
   if(worker&&snapshot.locks.some(row=>row.pid===worker.pid&&row.mode==='ShareUpdateExclusiveLock'&&row.granted&&['products','public.products'].includes(row.relation)))break;
   await delay(25);
  }while(performance.now()<deadline);
  const worker=snapshot.activity.find(row=>row.application==='lite220-known-vacuum');
  assert.ok(worker,'EPOCH_REAL_VACUUM_SESSION_REQUIRED');
  assert.ok(snapshot.locks.some(row=>row.pid===worker.pid&&row.mode==='ShareUpdateExclusiveLock'&&row.granted&&['products','public.products'].includes(row.relation)),'EPOCH_REAL_VACUUM_LOCK_REQUIRED');
  await assert.rejects(c.rpc(call),/LITE2_EPOCH_BUSY/u);
 }finally{
  await vacuum.close();
 }
 assert.deepEqual(await readApplicationFingerprint(executor),before,'KNOWN_VACUUM_BUSY_NO_PUBLIC_WRITES_OR_SEQUENCE_USE');
 assert.deepEqual(await privateFingerprint(executor),beforePrivate,'KNOWN_VACUUM_BUSY_NO_PRIVATE_WRITES');
 assert.equal(await c.sql('SELECT count(*) FROM sales_lite1.requests WHERE key='+c.q(key)+';'),'0');
 const claims={sub:c.id(1),role:'authenticated',aal:'aal2'};
 const retry=await executeInput(executor,`BEGIN;
 SELECT set_config('request.jwt.claims',${c.j(claims)}::text,true);
 SET LOCAL ROLE authenticated;SET LOCAL statement_timeout='8s';
 SELECT public.${call};
 RESET ROLE;SELECT jsonb_build_object('requests',(SELECT count(*) FROM sales_lite1.requests WHERE key=${c.q(key)}),'fullAccounting',(SELECT full_accounting FROM sales_lite1.mode WHERE id));
 ROLLBACK;`);
 assert.equal(retry.code,0,retry.stderr);
 assert.deepEqual(JSON.parse(retry.stdout.trim().split('\n').at(-1)),{requests:1,fullAccounting:true});
 assert.deepEqual((await readApplicationFingerprint(executor)).tables,before.tables);
 assert.deepEqual(await privateFingerprint(executor),beforePrivate);
 report.cases.push({
  name:'known220 real VACUUM produces safe BUSY;zero writes/unconsumed key;same-key success in rollback;deferred221',
  passed:true,publicRowsAndSequencesUnchanged:true,privateRowsUnchanged:true,keyUnconsumed:true,
  sameKeyRetryInsideRollback:true,vacuumSessionOnly:{delay:'20ms',limit:1,pageHit:10},
  lockSnapshot:snapshot
 });
}
