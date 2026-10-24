// Disposable Docker fixture only. Never invokes the owner CLI or a hosted link.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {isDeepStrictEqual as same} from 'node:util';
import {mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
import {readOwnerAcl212Bundle} from '../operations/owner-acl212-bundle.mjs';
import {applyAcl212WithExecutor} from '../operations/frankfurt-owner-acl212.mjs';
import {holdUpgradeGuard} from '../operations/frankfurt-owner-upgrade.mjs';
import {readNotificationSnapshot,transitionNotifications} from '../operations/frankfurt-notification-hold.mjs';
import {schemaCatalogSql,catalogDifference} from './schema-catalog.mjs';
import {compareApplicationAcl} from '../operations/application-acl-verification.mjs';
import {assertReady212Catalog} from '../operations/frankfurt-reference212.mjs';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';
import {ownerSequenceMetadata} from '../operations/owner-acl212-sequences.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile),project='nawasrah-owner-acl212-test';
assert.equal(process.argv.length,2,'LOCAL_ONLY_NO_ARGUMENTS');
const executor=executorFor(['--container','supabase_db_'+project]),output=await mkdtemp(path.join(tmpdir(),'nawasrah-owner-acl212-runtime-'));
const report={mode:'owner-acl212-isolated',output,managedAccess:false,cases:[],startedAt:new Date().toISOString()};let local,stage='bootstrap212';
const pass=name=>report.cases.push({name,passed:true});
const sql=async input=>{const r=await executeInput(executor,input);assert.equal(r.code,0,r.stderr);return r.stdout.trim();};
const catalog=async()=>JSON.parse(await sql(schemaCatalogSql));
try{
 const boot=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,
  env:{...process.env,NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'212',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
   NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 local=JSON.parse(boot.stdout).isolatedProjectRoot;
 const original=await readNotificationSnapshot(executor);await transitionNotifications(executor,original);
 const bundle=await readOwnerAcl212Bundle(root),clean=await catalog();assertReady212Catalog(clean);
 report.fixtureMetadataDifferences=[];
 for(const section of Object.keys(bundle.manifest.related)){
  const actual=(clean[section]??[]).filter(r=>(section==='schemas'?r.name:r.schema)==='public').map(r=>section==='sequences'?ownerSequenceMetadata(r):r);
  for(const d of catalogDifference({[section]:bundle.manifest.related[section]},{[section]:actual}))
   report.fixtureMetadataDifferences.push({section,before:d.before,after:d.after});
  if(!same(actual,bundle.manifest.related[section]))report.fixtureMetadataDifferences.push({section,orderOrRepresentationMismatch:true});
 }
 assert.deepEqual(report.fixtureMetadataDifferences,[],'OWNER_ACL212_ISOLATED_REFERENCE_METADATA');
 assert.equal(await sql('SELECT count(*) FROM supabase_migrations.schema_migrations;'),'174');
 const dataBefore=await readApplicationFingerprint(executor);pass('Complete212 disposable fixture and business data/sequence snapshot');
 stage='inject-reviewed-legacy-acl';
 const grants=bundle.manifest.objects.filter(o=>o.allowedExtra.length).map(o=>{
  const r=clean[o.section].find(r=>r.schema==='public'&&(r.identity??r.name)===o.identity);
  return `GRANT ${[...new Set(o.allowedExtra.map(a=>a.privilege))].sort().join(', ')} ON ${o.section==='functions'?'FUNCTION':r.kind==='S'?'SEQUENCE':'TABLE'} ${o.signature} TO service_role;`;
 });
 await sql(grants.join('\n'));const dirty=await catalog();assert.equal(compareApplicationAcl(clean,dirty).differenceCount,264);
 pass('Actual reviewed432 legacy ACL privileges on264objects injected only in test fixture');
 stage='concurrency';const guard=await holdUpgradeGuard(executor);
 try{await assert.rejects(()=>applyAcl212WithExecutor(executor,bundle,{}),/OWNER_ACL212_UPGRADE_RUNNING/);}
 finally{await guard.close();}
 assert.deepEqual(await catalog(),dirty);pass('Shared owner upgrade lock rejects concurrent apply with zero ACL mutation');
 stage='unknown-grant-option';
 await sql('GRANT EXECUTE ON FUNCTION public.get_public_pos_receipt(uuid) TO service_role WITH GRANT OPTION;');const unexpected=await catalog();
 await assert.rejects(()=>applyAcl212WithExecutor(executor,bundle,{}),/OWNER_ACL212_UNEXPECTED_ACL/);assert.deepEqual(await catalog(),unexpected);
 await sql('REVOKE GRANT OPTION FOR EXECUTE ON FUNCTION public.get_public_pos_receipt(uuid) FROM service_role RESTRICT;');
 assert.deepEqual(await catalog(),dirty);pass('Unknown grant option rejects before first REVOKE and preserves every ACL');
 stage='wrong-structure';await sql('ALTER TABLE public.products ADD COLUMN acl212_runtime_probe integer;');const wrongShape=await catalog();
 await assert.rejects(()=>applyAcl212WithExecutor(executor,bundle,{}),/OWNER_ACL212_OWNER_CONFIG_OR_STRUCTURE_MISMATCH/);
 assert.deepEqual(await catalog(),wrongShape);await sql('ALTER TABLE public.products DROP COLUMN acl212_runtime_probe;');
 assert.deepEqual(await catalog(),dirty);pass('Unapproved structure rejects with zero privilege mutation');
 stage='exact-sequence-bound';
 await sql('ALTER SEQUENCE public.cash_shift_number_seq MAXVALUE 9223372036854775806;');
 const bound=await catalog();await assert.rejects(()=>applyAcl212WithExecutor(executor,bundle,{}),/OWNER_ACL212_RELATED_METADATA_MISMATCH:sequences/);
 assert.deepEqual(await catalog(),bound);assert.equal(await sql("SELECT seqmax::text FROM pg_sequence WHERE seqrelid='public.cash_shift_number_seq'::regclass;"),'9223372036854775806');
 await sql('ALTER SEQUENCE public.cash_shift_number_seq MAXVALUE 9223372036854775807;');
 assert.deepEqual(await catalog(),dirty);pass('Exact bigint sequence max differs by1:precheck rejects without any ACL writes');
 stage='late-rollback';
 const marker='\n  END IF;\n END LOOP;';assert.equal(bundle.executionSql.split(marker).length,2);
 const fail=await executeInput(executor,bundle.executionSql.replace(marker,"\n   RAISE EXCEPTION 'OWNER_ACL212_TEST_LATE_FAILURE';"+marker));
 assert.notEqual(fail.code,0);assert.match(fail.stderr,/OWNER_ACL212_TEST_LATE_FAILURE/);assert.deepEqual(await catalog(),dirty);
 assert.deepEqual(await readApplicationFingerprint(executor),dataBefore);pass('Failure after all264 REVOKEs rolls back all432 privileges atomically');
 stage='actual-apply';const applied={};await applyAcl212WithExecutor(executor,bundle,applied);
 assert.equal(applied.rows,675);assert.equal(applied.matches_reference_true,675);assert.equal(applied.matches_reference_false,0);
 assert.equal(applied.removed_privileges,432);assert.equal(applied.commitConfirmed,true);
 const repaired=await catalog();assert.equal(compareApplicationAcl(clean,repaired).differenceCount,0);assertReady212Catalog(repaired);
 const replay={};await applyAcl212WithExecutor(executor,bundle,replay);assert.equal(replay.rows,675);assert.equal(replay.removed_privileges,0);assert.equal(replay.commitConfirmed,true);
 pass('Real owner execution worker commits675true/0false;repeat commits safely with zero reduction');
 stage='preservation';
 assert.equal(await sql("SELECT has_table_privilege('service_role','public.orders','SELECT');"),'t');
 for(const name of ['push_dispatches','push_subscriptions'])assert.deepEqual(repaired.tables.find(t=>t.schema==='public'&&t.name===name),clean.tables.find(t=>t.schema==='public'&&t.name===name));
 assert.deepEqual(await readApplicationFingerprint(executor),dataBefore);pass('orders SELECT,push tables,all business data/sequences and174migration history preserved');
 Object.assign(report,{ok:true,actualSqlTransaction:true,rows:675,matches_reference_true:675,matches_reference_false:0,removedPrivileges:432,
  replayRemovedPrivileges:0,atomicRollback:true,concurrencyRejected:true,allApplicationDataAndSequencesUnchanged:true,ordersSelectAndPushGrantsPreserved:true});
}catch(error){report.ok=false;report.stage=stage;report.error=error.message;process.exitCode=1;}
finally{
 if(local)await exec(process.execPath,[path.join(root,'node_modules/supabase/dist/supabase.js'),'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true,maxBuffer:1024**2});
 report.endedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}
