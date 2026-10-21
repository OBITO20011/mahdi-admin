// Diagnostic, not a grant repair: fresh local001-138, real JWT/PostgREST roles.
// Expected permission denials are findings, not a passing application-readiness gate.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdtemp,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {inventory} from './table-access-inventory.mjs';
import {replay,scopes,fixtureId as id,verifyProbeCoverage} from './table-access-probes.mjs';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..');
const option=n=>process.argv.includes(n)?process.argv[process.argv.indexOf(n)+1]:null;
const ceiling=Number(option('--migration-ceiling')||(process.argv.includes('--require-access')?199:138));
assert.ok([138,150,164,171,182,195,196,197,198,199,200,201,202,203,204,205,206,207].includes(ceiling),'ONLY_APPROVED_AUDIT_CEILINGS');
const manifest=(await readdir(path.join(root,'supabase/migrations'))).filter(n=>/^\d{3}_.+\.sql$/u.test(n)&&Number(n.slice(0,3))<=ceiling).sort();
const project=option('--local-project')||'nawasrah-table-audit-'+randomBytes(4).toString('hex')+'-test';
assert.match(project,/^nawasrah-table-audit(?:-[a-f0-9]+)?-test$/u);
const container='supabase_db_'+project,rest='nawasrah-table-access-rest-'+randomBytes(4).toString('hex');
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-table-access-'));
const executor=executorFor(['--container',container]);
const q=v=>"'"+String(v).replaceAll("'","''")+"'",j=v=>q(JSON.stringify(v))+'::jsonb';
const sql=async text=>{const r=await executeInput(executor,text);assert.equal(r.code,0,r.stderr);return r.stdout.trim();};
const json=async text=>JSON.parse(await sql(text));
const ownerRpc=command=>json(`BEGIN;SET LOCAL ROLE authenticated;DO $$BEGIN PERFORM set_config('request.jwt.claims',${q(JSON.stringify({sub:id(1),role:'authenticated',aal:'aal2'}))},true);END$$;
 SELECT public.${command};COMMIT;`);
const report={schemaVersion:1,startedAt:new Date().toISOString(),managedAccess:false,migrationCeiling:ceiling,manifest,output,stage:'bootstrap',results:[]};
let workdir=option('--workdir'),restStarted=false;
try{
 if(!workdir){const boot=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:{...process.env,
  NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:String(ceiling),NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
  NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
  workdir=JSON.parse(boot.stdout).isolatedProjectRoot;}
 assert.deepEqual(await json('SELECT jsonb_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations;'),manifest.map(n=>n.slice(0,3)),'EXACT_APPROVED_HISTORY_REQUIRED');
 const catalog=JSON.parse(await sql(schemaCatalogSql));report.catalog=catalog;
 const source=await inventory();report.sourceTotals=source.totals;report.sourceHashes=source.sources;
 report.stage='fixture';
 // Explicit LOCAL notification isolation;never inspect Vault or call an Edge URL.
 await sql(`ALTER TABLE public.orders DISABLE TRIGGER trg_notify_new_website_order_push;
 SELECT cron.alter_job(jobid,active:=false) FROM cron.job;`);
 await sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
 for(const [n,role] of [[2,'admin'],[3,'cashier'],[4,null]])await sql(`
 INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) VALUES(${q(id(n))},'authenticated','authenticated',${q(role||'no-role')}||'@audit.example.test','{}','{}');
 INSERT INTO profiles(id,full_name,is_active,branch_id) VALUES(${q(id(n))},${q(role||'no-role')},true,${q(id(200))});
 ${role?`INSERT INTO roles(code,name_ar) VALUES(${q(role)},${q(role)}) ON CONFLICT(code) DO NOTHING;
 INSERT INTO user_roles(user_id,role_id) SELECT ${q(id(n))},r.id FROM roles r WHERE code=${q(role)};`:''}`);
 const purchaseLine=(product,quantity,poItem=null)=>({client_line_id:id(product+900),line_kind:'base_unit',commercial_quantity:quantity,base_unit_name:'باكيت',
  gross_amount_in_minor_units:quantity*200,line_discount_in_minor_units:0,components:[{product_id:id(product),base_quantity:quantity}],...(poItem?{purchase_order_item_id:poItem}:{})});
 const received=await ownerRpc(`create_direct_supplier_receipt_v2(p_supplier_id:=${q(id(301))},p_branch_id:=${q(id(200))},p_warehouse_id:=${q(id(201))},
  p_idempotency_key:='table-access-audit-direct-receipt-00001',p_payment_method:='deferred',p_lines:=${j([purchaseLine(101,100),purchaseLine(102,100)])})`);
 assert.equal(received.success,true);
 await ownerRpc(`open_cash_shift(${q(id(200))},100000)`);
 const configured=await ownerRpc(`save_product_parcel_configuration_v1(${q(id(100))},'configurable_mix',true,5,ARRAY[${q(id(101))},${q(id(102))}]::uuid[])`);
 await ownerRpc("set_configurable_parcel_feature_state_v1('ENABLED')");
 const sale=await ownerRpc(`create_pos_sale_v2(${q(id(201))},${q(id(200))},${q(id(401))},'عميل فحص','cash',${j([
  {commercial_line_kind:'base_unit',product_id:id(101),base_quantity:1,price_authority:'server_catalog',line_discount_in_minor_units:0},
  {commercial_line_kind:'configurable_parcel',family_product_id:id(100),parcel_configuration_id:configured.configuration.id,
   configuration_revision:configured.configuration.configuration_revision,price_authority:'server_catalog',line_discount_in_minor_units:0,
   parcel_instances:[{components:[{product_id:id(101),base_quantity:2},{product_id:id(102),base_quantity:3}]}]}])},0,6000,'table-access-audit-pos-000000000001')`);
 assert.equal(sale.success,true);
 const po=await ownerRpc(`create_purchase_order_v2(p_supplier_id:=${q(id(301))},p_branch_id:=${q(id(200))},p_warehouse_id:=${q(id(201))},
 p_idempotency_key:='table-access-audit-po-000000000001',p_lines:=${j([purchaseLine(101,10)])})`);assert.equal(po.success,true);
 await ownerRpc(`update_purchase_order_status(${q(po.purchase_order_id)},'sent')`);
 await ownerRpc(`update_purchase_order_status(${q(po.purchase_order_id)},'approved')`);
 const poItem=await json(`SELECT to_jsonb(id) FROM purchase_order_items WHERE purchase_order_id=${q(po.purchase_order_id)};`);
 await ownerRpc(`receive_purchase_order_v2(p_purchase_order_id:=${q(po.purchase_order_id)},p_warehouse_id:=${q(id(201))},
 p_idempotency_key:='table-access-audit-po-receive-00001',p_payment_method:='deferred',p_lines:=${j([purchaseLine(101,5,poItem)])})`);
 await sql(`INSERT INTO customer_addresses(id,customer_id,city) VALUES(${q(id(700))},${q(id(401))},'الرمثا');
 UPDATE orders SET source='website',customer_address_id=${q(id(700))} WHERE id=${q(sale.orderId)};
 INSERT INTO push_subscriptions(id,user_id,endpoint,p256dh,auth_key) VALUES(${q(id(701))},${q(id(1))},'https://audit.example.invalid/push',repeat('a',32),repeat('a',16));`);
 const instances=await json(`SELECT jsonb_agg(id ORDER BY id) FROM order_parcel_instances WHERE order_id=${q(sale.orderId)};`);assert.ok(instances.length);
 const ids={orderId:sale.orderId,operationId:sale.operationId,receiptId:received.receipt_id,poId:po.purchase_order_id,subscriptionId:id(701),instances};
 report.fixture=ids;
 report.stage='local-postgrest';
 // Fixed public TEST signing material;not a managed credential. Tokens stay in RAM.
 const secret='isolated-table-access-audit-signing-material-only';
 await exec('docker',['run','-d','--name',rest,'--network','supabase_network_'+project,'-p','127.0.0.1:25421:3000',
  '-e','PGRST_DB_URI=postgresql://authenticator:postgres@db:5432/postgres','-e','PGRST_DB_SCHEMAS=public',
  '-e','PGRST_DB_ANON_ROLE=anon','-e','PGRST_JWT_SECRET='+secret,'ghcr.io/supabase/postgrest:v16.1@sha256:5922bde07147b82b1c9d8f749e48c1e5b99ebb233f3888bb7ab65f07cf4ac82d'],{windowsHide:true});restStarted=true;
 const deadline=Date.now()+15000;while(true){try{const r=await fetch('http://127.0.0.1:25421/');if(r.status===200)break;}catch{/* readiness only */}
  if(Date.now()>deadline)throw Error('LOCAL_POSTGREST_NOT_READY');await new Promise(resolve=>setTimeout(resolve,100));}
 report.stage='actual-original-queries';console.log(JSON.stringify({stage:report.stage,queries:source.entries.length}));
 for(const entry of source.entries){const actors=entry.role==='service_role'?[[1,'service_role']]:[[1,'owner'],[2,'admin'],[3,'cashier']];
  for(const [n,appRole] of actors)for(const extra of entry.extensions.length?[false,true]:[false]){
   const r=await replay(entry,{url:'http://127.0.0.1:25421',role:entry.role,actor:id(n),secret,scope:scopes(ids,id(n)),extra});r.appRole=appRole;report.results.push(r);
  }
 }
 // Per-table exact privilege/policy evidence including all embedded dependencies
 // and Realtime SELECT prerequisites;no synthetic grants are made.
 report.stage='rls-and-acl';console.log(JSON.stringify({stage:report.stage,originalQueriesCompleted:report.results.length}));
 const tables=[...new Set([...source.totals.tableNames,...source.subscriptions.map(s=>s.table)])].sort();
 report.access=[];
 for(const table of tables){const info=catalog.tables.find(t=>t.schema==='public'&&t.name===table);assert.ok(info,'UNKNOWN_TABLE:'+table);
  const count=await json(`SELECT to_jsonb(count(*)) FROM public."${table}";`);
  for(const role of ['authenticated','anon','service_role']){
   const privileges=await json(`SELECT jsonb_object_agg(p,has_table_privilege(${q(role)},${q('public.'+table)},p)) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p;`);
   const policies=catalog.policies.filter(p=>p.schema==='public'&&p.table===table);
   const actors=role==='authenticated'?[[1,'owner'],[2,'admin'],[3,'cashier'],[4,'no-erp-role']]:[[1,role]];
   const visible=[];
   for(const [n,appRole] of actors){const r=await executeInput(executor,`BEGIN READ ONLY;SET LOCAL ROLE ${role};
    DO $$BEGIN PERFORM set_config('request.jwt.claims',${q(JSON.stringify({sub:role==='anon'?null:id(n),role,aal:'aal2'}))},true);END$$;
    SELECT count(*) FROM public."${table}";ROLLBACK;`);
    visible.push({appRole,sqlstate:r.code===0?null:/42501|permission denied/u.test(r.stderr)?'42501':'other_error',rows:r.code===0?Number(r.stdout.trim()):null,
     outcome:r.code===0?count>0&&Number(r.stdout.trim())===0?'rls_zero_rows':count===0?'fixture_empty':'success':/42501|permission denied/u.test(r.stderr)?'permission_denied':'other_error'});
   }
   const selectableColumns=await json(`SELECT COALESCE(jsonb_agg(a.attname ORDER BY a.attnum),'[]'::jsonb)
    FROM pg_attribute a WHERE a.attrelid=${q('public.'+table)}::regclass AND a.attnum>0 AND NOT a.attisdropped
    AND has_column_privilege(${q(role)},a.attrelid,a.attnum,'SELECT');`);
   report.access.push({table,role,rls:info.rls,forceRls:info.forceRls,privileges,selectableColumns,policies,fixtureRows:count,visible});
  }
 }
 // Source files may not drift while this evidence is collected.
 assert.deepEqual((await inventory()).sources,source.sources,'SOURCE_CHANGED_DURING_DIAGNOSTIC');
 report.coverage=verifyProbeCoverage(source,report.results);
 report.infrastructureOk=true;report.applicationReady=report.results.every(r=>!['permission_denied','other_error'].includes(r.outcome));
 report.counts=Object.fromEntries(['success','permission_denied','zero_rows','other_error'].map(k=>[k,report.results.filter(r=>r.outcome===k).length]));
 if(process.argv.includes('--require-access')&&!report.applicationReady){process.exitCode=1;report.accessGate='FAILED_DIRECT_TABLE_ACCESS';}
}catch(error){report.infrastructureOk=false;report.error=error.message;process.exitCode=1;}
finally{
 // Cleanup must never hide the original failure or discard completed evidence.
 const cleanupErrors=[];
 if(restStarted)try{await exec('docker',['rm','-f',rest],{windowsHide:true});}catch(error){cleanupErrors.push({step:'postgrest',code:error.code??null,message:error.message});}
 if(workdir)try{await exec(process.execPath,[path.join(root,'node_modules/supabase/dist/supabase.js'),'stop','--no-backup','--workdir',workdir],{cwd:root,windowsHide:true});}catch(error){cleanupErrors.push({step:'supabase',code:error.code??null,message:error.message});}
 if(cleanupErrors.length){report.cleanupErrors=cleanupErrors;report.infrastructureOk=false;process.exitCode=1;}
 report.endedAt=new Date().toISOString();await writeFile(path.join(output,'diagnostic.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({infrastructureOk:report.infrastructureOk,applicationReady:report.applicationReady,stage:report.stage,error:report.error,counts:report.counts,output}));
}
