// Actual219->220 promotion and whole full-mode parity. Own container only,
// never a URL/workdir/hosted target;temporary resources are identity-fenced.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';
import {functionCatalogSql} from './sales-only-phase1-runtime.mjs';
import {assertFrozenFunctions,replaceDefinitionSource} from './sales-only220-bridges.mjs';
import {buildSalesOnly220,salesOnly220Name} from './sales-only220-compiler.mjs';
import {verifyLite220Summary} from './lite220-summary-runtime.mjs';
import {returnPayload215} from './aftercare215-return-cases.mjs';
import {readVerificationSourceFreeze,assertVerificationSourceFreeze} from './verification-source-freeze.mjs';
assert.equal(process.argv.length,2,'NO_TARGET_OR_RESUME_ARGUMENTS');
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile),project='nawasrah-sales-lite3-migration-test',container='supabase_db_'+project,output=path.join(root,'test-results/sales-only220-migration');
await mkdir(output,{recursive:true});const report={ok:false,hostedAccess:false,phase:'literal220-promotion',cases:[],timings:{}};let local,ownedId;
const docker=(...a)=>exec('docker',a,{cwd:root,windowsHide:true,maxBuffer:32*1024**2});
try{
 const frozen=await readVerificationSourceFreeze(root);
 const boot=await exec(process.execPath,['scripts/testing/bootstrap-isolated-supabase.mjs'],{cwd:root,windowsHide:true,maxBuffer:32*1024**2,env:{...process.env,NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'219',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 local=JSON.parse(boot.stdout).isolatedProjectRoot;const initial=JSON.parse((await docker('inspect',container)).stdout)[0];ownedId=initial.Id;
 assert.equal(path.resolve(initial.Config.Labels['com.supabase.cli.workdir']).toLowerCase(),path.resolve(local).toLowerCase());
 for(const name of Object.keys(initial.NetworkSettings.Networks))await docker('network','disconnect',name,container);
 const executor=executorFor(['--container',container]),owned=async()=>{const a=JSON.parse((await docker('inspect',container)).stdout)[0];assert.equal(a.Id,ownedId);assert.equal(a.Config.Labels['com.supabase.cli.project'],project);assert.deepEqual(Object.keys(a.NetworkSettings.Networks),[]);};
 const sql=async input=>{await owned();const r=await executeInput(executor,input);assert.equal(r.code,0,r.stderr);return r.stdout.trim();};
 const json=async input=>JSON.parse((await sql(input)).split('\n').at(-1));
 const q=v=>v==null?'NULL':"'"+String(v).replaceAll("'","''")+"'",j=v=>q(JSON.stringify(v))+'::jsonb',id=n=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const rpc=call=>json(`BEGIN;SELECT set_config('request.jwt.claims',${j({sub:id(1),role:'authenticated',aal:'aal2'})}::text,true);SET LOCAL ROLE authenticated;SET LOCAL statement_timeout='8s';SELECT public.${call};COMMIT;`);
 const beforeFunctions=await json(functionCatalogSql),artifact=await readFile(path.join(root,'supabase/migrations',salesOnly220Name),'utf8');assert.equal(buildSalesOnly220(beforeFunctions),artifact,'EXACT_REAL219_REGENERATION');
 await writeFile(path.join(output,'original219-functions.json'),JSON.stringify(beforeFunctions));
 const begin=artifact.indexOf('\nBEGIN;\n');assert.ok(begin>0);assert.equal(artifact.split('\nBEGIN;\n').length,2);assert.ok(artifact.endsWith('\nCOMMIT;\n'));const body=artifact.slice(begin+'\nBEGIN;\n'.length,-'\nCOMMIT;\n'.length);
 const negative=async(input,pattern)=>{await owned();const before=await readApplicationFingerprint(executor),r=await executeInput(executor,input);assert.notEqual(r.code,0);assert.match(r.stderr,pattern);assert.deepEqual(await readApplicationFingerprint(executor),before);};
 const writer=beforeFunctions.find(r=>r.name==='create_pos_sale_v2');await negative('BEGIN;'+replaceDefinitionSource(writer.definition,writer.source,writer.source+'\n--UNKNOWN_BYTE')+';'+body+'COMMIT;',/LITE220_FROZEN_BEFORE_MISMATCH/);
 await negative('BEGIN;DELETE FROM supabase_migrations.schema_migrations WHERE version=\'219\';'+body+'COMMIT;',/LITE220_EXACT219_HISTORY_REQUIRED/);
 report.cases.push('unknown frozen writer byte and wrong history refused atomically');
 await sql('SELECT cron.alter_job(jobid,active:=false) FROM cron.job;ALTER TABLE public.orders DISABLE TRIGGER trg_notify_new_website_order_push;');
 await sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));await rpc(`set_go_live_main_branch_v1(${q(id(200))})`);
 const branch=id(200),warehouse=id(201),pid=id(103),customer=id(401),full=[];
 await rpc(`create_direct_supplier_receipt_v2(p_supplier_id:=${q(id(301))},p_branch_id:=${q(branch)},p_warehouse_id:=${q(warehouse)},p_idempotency_key:='lite220-full-receive',p_payment_method:='deferred',p_lines:=${j([{client_line_id:id(999),line_kind:'base_unit',commercial_quantity:1000,base_unit_name:'باكيت',gross_amount_in_minor_units:500000,line_discount_in_minor_units:0,components:[{product_id:pid,base_quantity:1000}]}])})`);
 const shift=(await rpc(`open_cash_shift(${q(branch)},500000)`)).id;
 const lines=[{commercial_line_kind:'base_unit',product_id:pid,base_quantity:10,price_authority:'server_catalog',line_discount_in_minor_units:0}];
 for(const method of ['cash','cliq','debt']){const call=`create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(customer)},'عميل اختبار',${q(method)},${j(lines)},0,10000,${q('lite220-full-'+method)})`;full.push({call,result:await rpc(call)});}
 const partial=`create_pos_sale_with_initial_payment_v1(${q(warehouse)},${q(branch)},${q(customer)},'عميل اختبار',${j(lines)},0,4000,'cash',NULL,'lite220-full-partial')`;full.push({call:partial,result:await rpc(partial)});
 const item=await json(`SELECT to_jsonb(id) FROM public.order_items WHERE order_id=${q(full[0].result.orderId)};`),request=returnPayload215({sale:full[0].result,item,pid},{quantity:2,good:2,method:'cash'}),preview=await rpc(`preview_admin_sales_return_v2(${j(request)})`),call=`settle_admin_sales_return_v2(${j(request)},'lite220-full-return',${q(preview.previewFingerprint)})`;full.push({call,result:await rpc(call)});
 for(const f of full)f.replay=await rpc(f.call);
 await rpc(`create_operational_expense(${q(branch)},'كهرباء','مصروف اصطناعي',1000,'cash',NULL)`);
 const snap=`jsonb_build_object('telegramDaily',public.build_business_summary('daily',(now() AT TIME ZONE 'Asia/Amman')::DATE,(now() AT TIME ZONE 'Asia/Amman')::DATE,now()),'telegramWeekly',public.build_business_summary('weekly',(now() AT TIME ZONE 'Asia/Amman')::DATE-6,(now() AT TIME ZONE 'Asia/Amman')::DATE,now()),'facts',public.phase6_financial_facts_internal(${q(branch)},date_trunc('day',now())-interval '1 day',date_trunc('day',now())+interval '1 day','Asia/Amman',true),'summary',public.get_cash_shift_summary(${q(shift)}),'report',public._get_cash_shift_closing_report_before_snapshot(${q(shift)}),'debt',public.phase42_customer_receivable_total_internal(${q(customer)}),'positions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY o.id) FROM public.orders o CROSS JOIN LATERAL public.phase42_order_financial_position_internal(o.id) p))`;
 const existingData=await readApplicationFingerprint(executor),t=performance.now();
 await sql(`BEGIN;SELECT set_config('request.jwt.claims',${j({sub:id(1),role:'authenticated',aal:'aal2'})}::text,true);CREATE TEMP TABLE full_before220 AS SELECT ${snap} value;${body}DO $parity$ BEGIN IF (SELECT value FROM full_before220) IS DISTINCT FROM (${snap}) THEN RAISE EXCEPTION 'FULL_JSON_PARITY_FAILED';END IF;END $parity$;COMMIT;`);
 report.timings.applyMs=performance.now()-t;assert.deepEqual(await readApplicationFingerprint(executor),existingData,'ALL_EXISTING_ROWS_SEQUENCES_UNCHANGED');
 assertFrozenFunctions(beforeFunctions,await json(functionCatalogSql));for(const f of full)assert.deepEqual(await rpc(f.call),f.replay);assert.deepEqual(await readApplicationFingerprint(executor),existingData,'FULL_REPLAY_NO_WRITES');
 report.cases.push('literal220:cash/CliQ/debt/partial/return/expense whole JSON exact;all original rows/sequences unchanged;full writer replays exact;627bodies/ninebridges exact');
 await negative(artifact,/LITE220_CLEAN219_REQUIRED/);report.cases.push('second application refused without writes');
 await rpc(`close_cash_shift(${q(shift)},${(await rpc(`get_cash_shift_summary(${q(shift)})`)).expectedCashInMinorUnits},NULL)`);await rpc('lite1_set_mode2(false)');
 const stock=()=>json("SELECT jsonb_build_object('moves',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.inventory_movements x),'reservations',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.order_inventory_reservations x),'balances',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.inventory_balances x),'costs',(SELECT jsonb_agg(jsonb_build_array(id,cost_price_in_minor_units,wac_cost_in_minor_units_exact) ORDER BY id) FROM public.products));"),stockBefore=await stock();
 const liteShift=(await rpc(`open_cash_shift(${q(branch)},100000)`)).id;
 for(const method of ['cash','cliq','debt']){const req={warehouseId:warehouse,branchId:branch,customerId:customer,customerName:'عميل اختبار',paymentMethod:method,lines,discountInMinorUnits:0,amountReceivedInMinorUnits:method==='cash'?10000:0};const x=await rpc(`lite1_pos2(${j(req)},${q('lite220-'+method)})`);assert.equal(x.accountingTracked,false);assert.equal(x.totalInMinorUnits,10000);assert.deepEqual(await rpc(`lite1_pos2(${j(req)},${q('lite220-'+method)})`),x);}
 await rpc(`create_operational_expense(${q(branch)},'كهرباء','مصروف lite220',1000,'cash',NULL)`);
 const summary=await rpc(`get_cash_shift_summary(${q(liteShift)})`);assert.equal(summary.cashExpensesInMinorUnits,1000);await rpc(`close_cash_shift(${q(liteShift)},${summary.expectedCashInMinorUnits},NULL)`);
 assert.equal((await rpc(`get_cash_shift_closing_report(${q(liteShift)})`)).accountingTracked,false);assert.deepEqual(await stock(),stockBefore);assert.equal((await json('SELECT public.run_advanced_monitoring_checks();')).integrityIssueCount,0);assertFrozenFunctions(beforeFunctions,await json(functionCatalogSql));
 await verifyLite220Summary({sql,json,q,j,rpc,branch,warehouse,pid,customer},report);
 report.cases.push('compiled220 OFF:cash/CliQ/debt replay,expense/close/integrity0;zero stock/reservation/WAC changes');
 await sql("INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('220','sales_only_operating_mode','{}');");
 report.migrations=await json('SELECT jsonb_build_object(\'ceiling\',max(version::integer),\'files\',count(*)) FROM supabase_migrations.schema_migrations;');assert.deepEqual(report.migrations,{ceiling:220,files:181});
 report.publicFunctions=(await json(functionCatalogSql)).length;report.frozenBodies=627;report.bridges=9;report.pr79Included=false;report.networkAttachments=0;report.ok=true;assertVerificationSourceFreeze(frozen,await readVerificationSourceFreeze(root));
}catch(e){report.error=String(e.message).slice(0,6000);console.error(report.error);process.exitCode=1;}
finally{if(local&&ownedId){try{const a=JSON.parse((await docker('inspect',container)).stdout)[0];assert.equal(a.Id,ownedId);await exec(process.execPath,[path.join(root,'node_modules/supabase/dist/supabase.js'),'stop','--workdir',local,'--no-backup'],{cwd:root,windowsHide:true,maxBuffer:8*1024**2});report.cleanup=true;}catch{report.cleanup=false;process.exitCode=1;}}await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
