// Test-only capability boundary. Never imported by owner operations or RESET.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {executeInput} from '../operations/build-empty-supabase.mjs';
import {assertActiveRehearsal220} from '../backup/complete-backup.mjs';
import {assertRehearsalTarget} from './rehearsal220-local.mjs';

const exec=promisify(execFile);
const epochContainer='supabase_db_nawasrah-sales-lite3-epoch-test';
export const epochMaintenanceTables=Object.freeze(['products','warehouses','branches','inventory_balances']);
const tableNames=epochMaintenanceTables.map(name=>"'"+name+"'").join(',');
const relations=epochMaintenanceTables.map(name=>"'public."+name+"'::regclass").concat("'sales_lite1.mode'::regclass").join(',');

/** @param {{executor:{command:string,args:readonly string[]},containerId:string,context?:object}} target
 * @param {object} observed */
export function assertEpochFixtureTarget(target,observed){
 assert.match(target.containerId,/^[a-f0-9]{64}$/u,'EPOCH_FIXTURE_CONTAINER_ID_REQUIRED');
 assert.equal(target.executor.command,'docker','EPOCH_FIXTURE_DOCKER_ONLY');
 assert.deepEqual(target.executor.args.slice(0,2),['exec','-i']);
 assert.equal(observed.Id,target.containerId,'EPOCH_FIXTURE_CONTAINER_CHANGED');
 assert.equal(observed.State.Running,true,'EPOCH_FIXTURE_NOT_RUNNING');
 assert.deepEqual(Object.keys(observed.NetworkSettings.Networks),[],'EPOCH_FIXTURE_NETWORK_FORBIDDEN');
 if(target.context){
  assertActiveRehearsal220(target.context);
  assertRehearsalTarget(target.context,observed);
  assert.equal(target.executor.args[2],target.context.containerId);
 }else{
  assert.equal(target.executor.args[2],epochContainer,'EPOCH_FIXTURE_PROJECT_REQUIRED');
  assert.equal(observed.Name,'/'+epochContainer);
  assert.equal(observed.Config.Labels['com.supabase.cli.project'],'nawasrah-sales-lite3-epoch-test');
 }
}

async function boundExecutor(target){
 const {stdout}=await exec('docker',['inspect',target.containerId],{windowsHide:true,maxBuffer:1024*1024});
 assertEpochFixtureTarget(target,JSON.parse(stdout)[0]);
 const args=[...target.executor.args];args[2]=target.containerId;
 return {command:'docker',args};
}

const maintenanceSql=epochMaintenanceTables.map(name=>'ALTER TABLE public."'+name+'" SET (autovacuum_enabled=false);').join('\n');

export async function holdEpochFixtureMaintenance(target){
 const executor=await boundExecutor(target);
 const result=await executeInput(executor,maintenanceSql);
 assert.equal(result.code,0,'EPOCH_FIXTURE_MAINTENANCE_HOLD_FAILED');
 const state=await executeInput(executor,"SELECT jsonb_agg(jsonb_build_object('table',relname,'options',reloptions) ORDER BY relname) FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN("+tableNames+");");
 assert.equal(state.code,0,'EPOCH_FIXTURE_MAINTENANCE_READ_FAILED');
 const tables=JSON.parse(state.stdout.trim());
 assert.deepEqual(tables.map(row=>row.table),[...epochMaintenanceTables].sort());
 assert.ok(tables.every(row=>row.options?.includes('autovacuum_enabled=false')),'EPOCH_FIXTURE_ALL_FOUR_REQUIRED');
 return {testOnly:true,containerId:target.containerId,tables};
}

export const epochLockSnapshotSql=`SELECT jsonb_build_object(
 'capturedAt',clock_timestamp(),'observerPid',pg_backend_pid(),
 'activity',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'pid',pid,'role',usename,'backendType',backend_type,'state',state,
  'waitType',wait_event_type,'waitEvent',wait_event,'xactStart',xact_start,'queryStart',query_start,
  'application',CASE WHEN application_name IN('psql','lite2-epoch-blocker','lite220-known-vacuum') THEN application_name ELSE 'other' END,
  'statementKind',CASE WHEN backend_type='autovacuum worker' THEN 'autovacuum'
   WHEN query LIKE '%lite1_activate_epoch2%' THEN 'opening_epoch'
   WHEN application_name='lite2-epoch-blocker' THEN 'intentional_mode_blocker'
   WHEN application_name='lite220-known-vacuum' THEN 'known_vacuum' ELSE 'other' END
 ) ORDER BY pid),'[]') FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()),
 'locks',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'pid',pid,'type',locktype,'relation',relation::regclass::text,'mode',mode,'granted',granted,
  'page',page,'tuple',tuple,'transaction',transactionid::text,'virtualTransaction',virtualtransaction
 ) ORDER BY pid,locktype,relation,mode),'[]') FROM pg_locks
  WHERE relation IN(${relations}) OR locktype IN('tuple','transactionid','advisory')),
 'tables',(SELECT jsonb_agg(jsonb_build_object(
  'relation',relid::regclass::text,'lastAutovacuum',last_autovacuum,'lastAutoanalyze',last_autoanalyze,
  'lastVacuum',last_vacuum,'lastAnalyze',last_analyze,'modificationsSinceAnalyze',n_mod_since_analyze,
  'liveRows',n_live_tup,'deadRows',n_dead_tup
 ) ORDER BY relname) FROM pg_stat_user_tables WHERE schemaname='public' AND relname IN(${tableNames})),
 'vacuumProgress',(SELECT COALESCE(jsonb_agg(to_jsonb(p)),'[]') FROM pg_stat_progress_vacuum p),
 'settings',(SELECT jsonb_object_agg(name,setting) FROM pg_settings WHERE name IN('autovacuum','autovacuum_naptime')),
 'relationOptions',(SELECT jsonb_object_agg(oid::regclass::text,reloptions) FROM pg_class WHERE oid IN(${relations}))
);`;

export async function readEpochLockSnapshot(target){
 const executor=await boundExecutor(target);
 const result=await executeInput(executor,epochLockSnapshotSql);
 assert.equal(result.code,0,'EPOCH_LOCK_SNAPSHOT_READ_FAILED');
 return JSON.parse(result.stdout.trim());
}

export async function saveEpochLockSnapshot(target,file){
 const snapshot=await readEpochLockSnapshot(target);
 await mkdir(path.dirname(file),{recursive:true});
 await writeFile(file,JSON.stringify(snapshot,null,2)+'\n');
 return file;
}
