import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

export const ORIGINAL_034_SHA256 = '33f2b940719ab24ccc69eeb2737be407a254197029f1be6ce12b0f0a7dc02414';
export const FKS_034 = Object.freeze([
  ['supplier_returns', 'supplier_returns_supplier_id_fkey'],
  ['supplier_returns', 'supplier_returns_supplier_receipt_id_fkey'],
  ['supplier_return_items', 'supplier_return_items_product_id_fkey'],
  ['stock_count_items', 'stock_count_items_product_id_fkey'],
]);
export const EMPTY_034_TABLES = Object.freeze([
  'promotion_redemptions','promotion_codes','customer_payments','order_items',
  'order_status_history','orders','customer_addresses','customers','product_images',
  'supplier_payments','supplier_receipt_items','supplier_receipts',
  'purchase_receipt_items','purchase_receipts','purchase_order_items','purchase_orders',
  'inventory_movements','inventory_balances','stock_alert_reads','stock_alerts',
  'products','suppliers','push_dispatches','audit_logs',
  'supplier_return_items','supplier_returns','stock_count_items','stock_counts',
]);
// Exact rows inserted by008:206-212,with008 defaults and011's zero balance.
// Generated identity/timestamps are not used to label a business row a seed.
export const SEED_SUPPLIERS_008 = Object.freeze([
 {company_name:'شركة الأردن التجارية المحدودة',contact_person:'أحمد محمود',phone:'0791234567',
  whatsapp:null,email:'info@jordan-trade.jo',address:'عمان - شارع مكة',tax_number:'102938475',
  notes:null,is_active:true,current_balance_in_minor_units:0},
 {company_name:'مجموعة البركة للتوريدات العمومية',contact_person:'خالد النجار',phone:'0788765432',
  whatsapp:null,email:'sales@albaraka.jo',address:'الزرقاء - المنطقة الحرة',tax_number:'987654321',
  notes:null,is_active:true,current_balance_in_minor_units:0},
]);
const literal = value => "'" + value.replaceAll("'", "''") + "'";
const ident = value => '"' + value.replaceAll('"', '""') + '"';
const exec = promisify(execFile);
// Captured from the canonical CLI bootstrap catalog,not a business schema.
// repair manages schema_migrations;it cannot register a seed that never ran.
export const seedHistoryStructureSql = `CREATE TABLE IF NOT EXISTS supabase_migrations.seed_files (
 path text NOT NULL PRIMARY KEY,hash text NOT NULL);ALTER TABLE supabase_migrations.seed_files OWNER TO postgres;`;
export const migrationHistoryStructureSql = `CREATE SCHEMA IF NOT EXISTS supabase_migrations AUTHORIZATION postgres;
 CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(version text NOT NULL PRIMARY KEY,statements text[],name text);
 ALTER TABLE supabase_migrations.schema_migrations OWNER TO postgres;`;
const values = FKS_034.map(([table,name]) => `(${literal(table)},${literal(name)})`).join(',');
export const constraintSnapshotSql = `SELECT COALESCE(jsonb_agg(row ORDER BY row->>'table',row->>'name'),'[]'::jsonb) FROM (
 SELECT jsonb_build_object('schema',n.nspname,'table',t.relname,'name',c.conname,
 'definition',pg_get_constraintdef(c.oid,false),'type',c.contype,
 'onUpdate',c.confupdtype,'onDelete',c.confdeltype,'match',c.confmatchtype,
 'deferrable',c.condeferrable,'initiallyDeferred',c.condeferred,'validated',c.convalidated,
 'columns',c.conkey,'referencedColumns',c.confkey,'referencedTable',c.confrelid::regclass::text,
 'local',c.conislocal,'inheritanceCount',c.coninhcount,'noInherit',c.connoinherit) row
 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
 JOIN (VALUES ${values}) expected(tbl,name) ON t.relname=expected.tbl AND c.conname=expected.name
 WHERE n.nspname='public' AND c.contype='f') snapshot`;
export const prepare034Sql = `BEGIN;
 SET LOCAL search_path=public,pg_temp;
 DO $env034$ DECLARE tbl text;counted bigint;BEGIN
  FOREACH tbl IN ARRAY ARRAY[${EMPTY_034_TABLES.map(literal).join(',')}] LOOP
   EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE',tbl);
  END LOOP;
  FOREACH tbl IN ARRAY ARRAY[${EMPTY_034_TABLES.map(literal).join(',')}] LOOP
   EXECUTE format('SELECT count(*) FROM public.%I',tbl) INTO counted;
   IF tbl='suppliers' THEN
    IF counted<>2 OR EXISTS(SELECT 1 FROM public.suppliers s WHERE
     NOT (to_jsonb(s)-ARRAY['id','created_at','updated_at']) IN
     (SELECT value FROM jsonb_array_elements(${literal(JSON.stringify(SEED_SUPPLIERS_008))}::jsonb))) OR
     (SELECT count(DISTINCT company_name) FROM public.suppliers)<>2
    THEN RAISE EXCEPTION 'ENV034_SEED_MISMATCH:%',tbl;END IF;
   ELSIF counted<>0 THEN RAISE EXCEPTION 'ENV034_NOT_EMPTY:%',tbl;END IF;
  END LOOP;
 END $env034$;
 CREATE TEMP TABLE env034_expected_audit ON COMMIT PRESERVE ROWS AS
 SELECT jsonb_build_object(
  'orders',(SELECT count(*) FROM public.orders),
  'customers',(SELECT count(*) FROM public.customers),
  'products',(SELECT count(*) FROM public.products),
  'suppliers',(SELECT count(*) FROM public.suppliers),
  'supplier_receipts',(SELECT count(*) FROM public.supplier_receipts),
  'purchase_orders',(SELECT count(*) FROM public.purchase_orders),
  'purchase_receipts',(SELECT count(*) FROM public.purchase_receipts),
  'inventory_movements',(SELECT count(*) FROM public.inventory_movements),
  'push_dispatches',(SELECT count(*) FROM public.push_dispatches),
  'previous_audit_logs',(SELECT count(*) FROM public.audit_logs),
  'preserved_push_subscriptions',(SELECT count(*) FROM public.push_subscriptions WHERE is_active=true),
  'cleaned_at',now()) AS details,now() AS captured_at;
 CREATE TEMP TABLE env034_saved ON COMMIT PRESERVE ROWS AS ${constraintSnapshotSql};
 ALTER TABLE env034_saved RENAME COLUMN coalesce TO snapshot;
 DO $env034$ BEGIN
  IF (SELECT jsonb_array_length(snapshot) FROM env034_saved)<>4 OR
   EXISTS(SELECT 1 FROM env034_saved,jsonb_array_elements(snapshot) v WHERE NOT (v->>'validated')::boolean)
  THEN RAISE EXCEPTION 'ENV034_INVALID_CONSTRAINT_SNAPSHOT';END IF;
 END $env034$;
 SELECT 'ENV034_SNAPSHOT:'||(SELECT snapshot::text FROM env034_saved);
 ${FKS_034.map(([t,n])=>`ALTER TABLE public.${ident(t)} DROP CONSTRAINT ${ident(n)};`).join('\n')}
`;
// 034's own BEGIN is nested (PostgreSQL warning only); its immutable COMMIT
// commits the preceding empty guard/drops together with the original cleanup.
export const restore034Sql = `BEGIN;
 SET LOCAL search_path=public,pg_temp;
 DO $env034$ DECLARE tbl text;counted bigint;BEGIN
  FOREACH tbl IN ARRAY ARRAY[${EMPTY_034_TABLES.filter(t=>t!=='audit_logs').map(literal).join(',')}] LOOP
   EXECUTE format('SELECT count(*) FROM public.%I',tbl) INTO counted;
   IF counted<>0 THEN RAISE EXCEPTION 'ENV034_POST_NOT_EMPTY:%',tbl;END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.audit_logs)<>1 OR EXISTS(
   SELECT 1 FROM public.audit_logs a,env034_expected_audit expected WHERE
    (to_jsonb(a)-ARRAY['id','created_at']) IS DISTINCT FROM jsonb_build_object(
     'user_id',NULL,'action','PRELAUNCH_TEST_DATA_CLEANUP','entity_name','system',
     'entity_id',NULL,'details',expected.details,'ip_address',NULL)
    OR a.created_at IS DISTINCT FROM expected.captured_at)
  THEN RAISE EXCEPTION 'ENV034_CLEANUP_AUDIT_MISMATCH:audit_logs';END IF;
 END $env034$;
 DO $env034$ DECLARE v jsonb;BEGIN
  FOR v IN SELECT value FROM env034_saved,jsonb_array_elements(snapshot) LOOP
   EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I %s',v->>'schema',v->>'table',v->>'name',v->>'definition');
  END LOOP;
 END $env034$;
 DO $env034$ DECLARE actual jsonb;BEGIN
  SELECT * INTO actual FROM (${constraintSnapshotSql}) current_snapshot;
  IF actual IS DISTINCT FROM (SELECT snapshot FROM env034_saved) OR
   EXISTS(SELECT 1 FROM jsonb_array_elements(actual) v WHERE NOT (v->>'validated')::boolean)
  THEN RAISE EXCEPTION 'ENV034_CONSTRAINT_CATALOG_MISMATCH';END IF;
 END $env034$;
 COMMIT;
 SELECT 'ENV034_RESTORED:'||(SELECT snapshot::text FROM env034_saved);
 SELECT 'ENV034_CLEANUP_AUDIT:'||(SELECT details::text FROM env034_expected_audit);
 DROP TABLE env034_saved;
 DROP TABLE env034_expected_audit;
`;

/** @param {string} root */
export async function buildEmptyProjectInput(root) {
 const folder=path.join(root,'supabase/migrations');
 // This is the frozen001-138 rehearsal,not an implicit latest-schema builder.
 const names=(await readdir(folder)).filter(n=>/^\d{3}_.*\.sql$/u.test(n)&&Number(n.slice(0,3))<=138).sort();
 assert.equal(names.length,138,'Expected approved fixed001-138 history');
 assert.ok(names.every((n,i)=>Number(n.slice(0,3))===i+1),'Non-contiguous migration history');
 const chunks=[Buffer.from(`\\set ON_ERROR_STOP on\nSET search_path=public,pg_temp;
 DO $fresh$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public') OR EXISTS(SELECT 1 FROM auth.users)
  THEN RAISE EXCEPTION 'EMPTY_PROJECT_REQUIRED';END IF;
  IF NOT pg_try_advisory_lock(734034138) THEN RAISE EXCEPTION 'EMPTY_BUILD_ALREADY_RUNNING';END IF;
 END $fresh$;\n`)];
 const manifest=[],units=[];
 for(const name of names){
  const bytes=await readFile(path.join(folder,name));
  const sha256=createHash('sha256').update(bytes).digest('hex');
  manifest.push({name,sha256});
  const unit=[];
  if(name.startsWith('034_')){
   assert.equal(sha256,ORIGINAL_034_SHA256,'ORIGINAL034_BYTES_MISMATCH');
   chunks.push(Buffer.from(prepare034Sql));
   unit.push(Buffer.from(prepare034Sql));
  }
  chunks.push(bytes); // Original buffer, never formatted, decoded or text-patched.
  unit.push(bytes);
  if(name.startsWith('034_'))chunks.push(Buffer.from('\n'+restore034Sql));
  if(name.startsWith('034_'))unit.push(Buffer.from('\n'+restore034Sql));
  chunks.push(Buffer.from(`\n\\echo EMPTY_BUILD_APPLIED:${name}\n`));
  unit.push(Buffer.from(`\n\\echo EMPTY_BUILD_APPLIED:${name}\n`));
  units.push({name,input:Buffer.concat(unit)});
 }
 chunks.push(Buffer.from('SELECT pg_advisory_unlock(734034138);\n'));
 return {input:Buffer.concat(chunks),manifest,units,initial:chunks[0]};
}

/** @param {string[]} args */
export function executorFor(args) {
 if(args.length===2&&args[0]==='--container'){
  assert.match(args[1],/^supabase_db_nawasrah-[a-z0-9-]+-test$/u,'Test container only');
  return {command:'docker',args:['exec','-i',args[1],'psql','-U','postgres','-d','postgres','-X','-q','-At','-v','ON_ERROR_STOP=1']};
 }
 assert.deepEqual(args,['--psql-empty-target','--confirm-empty-project'], 'Explicit empty-target mode required');
 assert.ok(process.env.PGSERVICE,'Use an external PGSERVICE configuration;never a connection string argument');
 return {command:'psql',args:['-X','-q','-At','-v','ON_ERROR_STOP=1']};
}

/** @param {{command:string,args:string[],env?:NodeJS.ProcessEnv}} executor @param {Buffer|string} input */
export async function executeInput(executor,input) {
 return await new Promise((resolve,reject)=>{
  const child=spawn(executor.command,executor.args,{env:executor.env??process.env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',s=>stdout+=s);child.stderr.on('data',s=>stderr+=s);
  child.on('error',reject);
  // ON_ERROR_STOP may close stdin before the entire immutable bundle is sent.
  // Windows reports EOF,Unix EPIPE. Wait for close to retain SQL diagnostics.
  child.stdin.on('error',error=>{if(!['EPIPE','EOF'].includes(error.code))reject(error);});
  child.on('close',code=>resolve({code,stdout,stderr}));child.stdin.end(input);
 });
}
/** @param {Array<Record<string,unknown>>} snapshot */
export function recoverySql(snapshot) {
 assert.equal(snapshot.length,4);
 assert.deepEqual(snapshot.map(v=>[v.table,v.name]).sort(),[...FKS_034].map(v=>[...v]).sort());
 const saved=literal(JSON.stringify(snapshot));
 return `BEGIN;SET LOCAL search_path=public,pg_temp;
 DO $recover$ DECLARE v jsonb;actual jsonb;BEGIN
 FOR v IN SELECT value FROM jsonb_array_elements(${saved}::jsonb) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
   JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname=v->>'table' AND c.conname=v->>'name') THEN
   EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I %s',v->>'schema',v->>'table',v->>'name',v->>'definition');
  END IF;
 END LOOP;
 SELECT * INTO actual FROM (${constraintSnapshotSql}) current_snapshot;
 IF actual IS DISTINCT FROM ${saved}::jsonb THEN RAISE EXCEPTION 'ENV034_RECOVERY_MISMATCH';END IF;
 END $recover$;COMMIT;`;
}
/** @param {string[]} args @param {string} [root] */
export async function runEmptyProjectBuild(args,root=path.resolve(import.meta.dirname,'../..')) {
 const modeArgs=[...args];let cliWorkdir;
 const option=modeArgs.indexOf('--cli-workdir');
 if(option>=0){assert.ok(modeArgs[option+1]);cliWorkdir=path.resolve(modeArgs[option+1]);modeArgs.splice(option,2);}
 const executor=executorFor(modeArgs),{initial,manifest,units}=await buildEmptyProjectInput(root);
 if(modeArgs[0]==='--container')assert.ok(cliWorkdir,'Official local repair requires --cli-workdir');
 if(cliWorkdir){
  assert.equal(modeArgs[0],'--container','No implicit linked/remote repair');
  const config=await readFile(path.join(cliWorkdir,'supabase/config.toml'),'utf8');
  const project=config.match(/^project_id\s*=\s*"([^"]+)"/mu)?.[1];
  assert.equal('supabase_db_'+project,modeArgs[1],'CLI workdir must match the isolated target');
  for(const entry of manifest){const bytes=await readFile(path.join(cliWorkdir,'supabase/migrations',entry.name));
   assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256,'CLI_FILE_BYTES_MISMATCH');}
 }
 let result=await executeInput(executor,initial);
 const recorded=[];let seedHistoryStructureAdded=false;
 for(const unit of units){
  if(result.code!==0)break;
  const execution=await executeInput(executor,Buffer.concat([Buffer.from('SET search_path=public,pg_temp;\n'),unit.input]));
  result={code:execution.code,stdout:result.stdout+execution.stdout,stderr:result.stderr+execution.stderr};
  if(execution.code!==0)break;
  const version=unit.name.slice(0,3);
  try{
   if(cliWorkdir){
    await exec(process.execPath,[path.join(root,'node_modules/supabase/dist/supabase.js'),
     'migration','repair','--local','--workdir',cliWorkdir,'--status','applied',version],
     {cwd:root,windowsHide:true,maxBuffer:1024**2,timeout:60000});
   }else{
    // The explicit future PGSERVICE target is not a CLI link or a --db-url.
    // Keep credentials off argv. Approved fallback uses the captured CLI DDL.
    const name=unit.name.slice(4,-4);
    const repair=await executeInput(executor,`BEGIN;${migrationHistoryStructureSql}
     INSERT INTO supabase_migrations.schema_migrations(version,statements,name)
     VALUES(${literal(version)},NULL,${literal(name)});COMMIT;`);
    assert.equal(repair.code,0,'HISTORY_RECORD_FAILED');
   }
   recorded.push(version);
  }catch{result.code=1;result.stderr+='\nERROR: HISTORY_RECORD_FAILED';break;}
 }
 if(result.code===0){
  const seedExists=await executeInput(executor,"SELECT to_regclass('supabase_migrations.seed_files');");
  if(seedExists.code!==0){result.code=seedExists.code;result.stderr+=seedExists.stderr;}
  else if(!seedExists.stdout.trim()){
   const seedStructure=await executeInput(executor,seedHistoryStructureSql);
   if(seedStructure.code!==0){result.code=seedStructure.code;result.stderr+=seedStructure.stderr;}
   else seedHistoryStructureAdded=true;
  }
 }
 const applied=result.stdout.split(/\r?\n/u).filter(l=>l.startsWith('EMPTY_BUILD_APPLIED:')).map(l=>l.split(':')[1]);
 const saved=result.stdout.split(/\r?\n/u).find(l=>l.startsWith('ENV034_SNAPSHOT:'));
 const restored=result.stdout.split(/\r?\n/u).find(l=>l.startsWith('ENV034_RESTORED:'));
 const audit=result.stdout.split(/\r?\n/u).find(l=>l.startsWith('ENV034_CLEANUP_AUDIT:'));
 if(result.code!==0){
  let recovery='not-needed:no-drops-committed';
  if(saved&&!restored){
   const snapshot=JSON.parse(saved.slice('ENV034_SNAPSHOT:'.length));
   const recovered=await executeInput(executor,recoverySql(snapshot));
   recovery=recovered.code===0?'exact-constraints-restored':'FAILED';
  }
  // SQL diagnostics may contain user-defined text. Expose only safe error names.
  const kind=result.stderr.match(/(?:ENV034_[A-Z_]+|EMPTY_PROJECT_REQUIRED|EMPTY_BUILD_ALREADY_RUNNING)/u)?.[0]||'MIGRATION_SQL_FAILURE';
  return {ok:false,applied,recorded,kind,recovery,exitCode:result.code,manifest,
   sqlError:result.stderr.split(/\r?\n/u).find(line=>/^ERROR:|^FATAL:/u.test(line))??'No SQL diagnostic'};
 }
 assert.equal(applied.length,138);assert.ok(saved&&restored&&audit,'Both snapshot markers and exact audit proof required');
 const before=JSON.parse(saved.slice('ENV034_SNAPSHOT:'.length));
 const after=JSON.parse(restored.slice('ENV034_RESTORED:'.length));
 assert.deepEqual(before,after);assert.ok(after.every(v=>v.validated===true));
 assert.deepEqual(recorded,manifest.map(m=>m.name.slice(0,3)));
 return {ok:true,applied,recorded,trackingMethod:cliWorkdir?'official-local-migration-repair':'PGSERVICE captured CLI structure fallback',seedRegistered:false,seedHistoryStructureAdded,
  manifest,original034Sha256:ORIGINAL_034_SHA256,constraints:after,
  catalogMatch:true,cleanupAudit:JSON.parse(audit.slice('ENV034_CLEANUP_AUDIT:'.length)),
  transactionBoundary:'034 original COMMIT;restoration transaction',sqlFilesModified:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const result=await runEmptyProjectBuild(process.argv.slice(2));console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;}
 catch(error){console.error(JSON.stringify({ok:false,kind:error.code||error.name}));process.exitCode=1;}
}
