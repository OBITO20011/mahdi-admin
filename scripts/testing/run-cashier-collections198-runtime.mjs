// Real authenticated roles, original writers, isolated DB only.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';
import {schemaCatalogSql,catalogDifference} from './schema-catalog.mjs';
import {assertPackageDDbLint} from './package-d-db-lint-policy.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile),project='nawasrah-cashier198-test';
const cli=path.join(root,'node_modules/supabase/dist/supabase.js'),executor=executorFor(['--container','supabase_db_'+project]);
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-cashier198-'));
const report={startedAt:new Date().toISOString(),output,managedAccess:false,cases:[]};let local,stage='bootstrap197',counter=0;
const id=n=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`,owner=id(1),cashier=id(2),stranger=id(3),branch=id(200),customer=id(401);
const q=v=>"'"+String(v).replaceAll("'","''")+"'",j=v=>q(JSON.stringify(v))+'::jsonb',key=()=>`cashier198-runtime-${String(++counter).padStart(8,'0')}`;
const sql=async input=>{const r=await executeInput(executor,input);assert.equal(r.code,0,r.stderr);return r.stdout.trim();};
const json=async input=>JSON.parse((await sql(input)).split('\n').at(-1));
const auth=(body,actor=owner,role='authenticated')=>`BEGIN;SELECT set_config('request.jwt.claims',${q(JSON.stringify({sub:actor,role,aal:'aal2'}))},true);SET LOCAL ROLE ${role};${body}COMMIT;`;
const rpc=(call,actor=owner)=>json(auth(`SELECT public.${call};`,actor));
const record=(name,details={})=>{const value={name,passed:true,...details};report.cases.push(value);console.log(JSON.stringify(value));};
const denied=async(call,actor=cashier,pattern=/صلاحية|صلاحيات|غير مصرح|ليس لديك|permission denied|مصرح/u,role='authenticated',collectionNumberConsumed=0)=>{
 const before=await readApplicationFingerprint(executor),r=await executeInput(executor,auth(`SELECT public.${call};`,actor,role));
 assert.notEqual(r.code,0,'UNEXPECTED_AUTHORIZATION:'+call);assert.match(r.stderr,pattern);
 const after=await readApplicationFingerprint(executor);
 // PostgreSQL nextval is nontransactional: the unchanged191 writer allocates
 // its number before rejecting a closed shift. Assert that ONE known gap,
 // not a blanket sequence exclusion; all rows and every other sequence exact.
 if(collectionNumberConsumed)before.sequences.customer_collection_operation_number_seq+=collectionNumberConsumed;
 assert.deepEqual(after,before,'failed operation changes no business rows or unexpected sequence');
};
const collect=(amount,method,k=key(),actor=cashier)=>rpc(`collect_customer_balance_v1(${q(customer)},${amount},${q(method)},${q(branch)},'REF-198',NULL,${q(k)})`,actor);
try{
 const boot=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:{...process.env,
  NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'197',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
  NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 local=JSON.parse(boot.stdout).isolatedProjectRoot;stage='fixture and pre198 denial';
 await sql('ALTER TABLE public.orders DISABLE TRIGGER trg_notify_new_website_order_push;SELECT cron.alter_job(jobid,active:=false) FROM cron.job;');
 await sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
 for(const [actor,code]of [[cashier,'cashier'],[stranger,null]]){
  await sql(`INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) VALUES(${q(actor)},'authenticated','authenticated',${q(actor+'@example.test')},NOW(),'{}','{}');
   INSERT INTO profiles(id,full_name,is_active) VALUES(${q(actor)},'اختبار الدور الحقيقي',true);`);
  if(code){await sql(`INSERT INTO roles(code,name_ar) VALUES(${q(code)},'كاشير الفحص') ON CONFLICT(code) DO NOTHING;
   INSERT INTO user_roles(user_id,role_id) SELECT ${q(actor)},id FROM roles WHERE code=${q(code)};`);
   assert.equal(await json(`SELECT COUNT(*) FROM user_roles u JOIN roles r ON r.id=u.role_id WHERE u.user_id=${q(actor)} AND r.code=${q(code)};`),1,'GENUINE_CASHIER_ROLE_REQUIRED');}
 }
 await rpc(`set_go_live_main_branch_v1(${q(branch)})`);
 await rpc(`create_direct_supplier_receipt_v2(p_supplier_id:=${q(id(301))},p_branch_id:=${q(branch)},p_warehouse_id:=${q(id(201))},p_idempotency_key:=${q(key())},
  p_payment_method:='deferred',p_lines:=${j([{client_line_id:id(901),line_kind:'base_unit',commercial_quantity:1000,base_unit_name:'باكيت',gross_amount_in_minor_units:200000,line_discount_in_minor_units:0,components:[{product_id:id(101),base_quantity:1000}]}])})`);
 await rpc(`open_cash_shift(${q(branch)},100000)`);
 const shift=await json(`SELECT to_jsonb(id) FROM cash_shifts WHERE branch_id=${q(branch)} AND status='open';`);
 assert.ok(shift,'OPEN_SHIFT_ID');
 const sale=await rpc(`create_pos_sale_v2(${q(id(201))},${q(branch)},${q(customer)},'تحصيل الكاشير','debt',${j([
  {commercial_line_kind:'base_unit',product_id:id(101),base_quantity:30,price_authority:'server_catalog',line_discount_in_minor_units:0}])},0,0,${q(key())})`);
 const order=sale.orderId;
 await rpc(`record_customer_opening_balances_v1(${q(key())},${j([{customer_id:customer,amount_in_minor_units:'5000',original_debt_date:'2020-01-01'}])})`);
 const reads=[`preview_customer_collection_v1(${q(customer)},8000)`,`get_customer_collections_v1(${q(customer)})`,'get_customer_outstanding_orders_page(1,25,NULL)'];
 for(const call of reads)await denied(call);
 const beforeReads=await Promise.all(reads.map(call=>rpc(call)));
 const beforeCatalog=await json(schemaCatalogSql),beforeData=await readApplicationFingerprint(executor);
 stage='apply198 and exact catalog comparison';
 const migration=await readFile(path.join(root,'supabase/migrations/198_cashier_customer_collection_access.sql'),'utf8');await sql(migration);
 assert.deepEqual(await readApplicationFingerprint(executor),beforeData);
 const differences=catalogDifference(beforeCatalog,await json(schemaCatalogSql));
 assert.equal(differences.length,5);assert.ok(differences.every(d=>d.section==='functions'));
 assert.deepEqual(differences.map(d=>d.before.identity.split('(')[0]).sort(),['cheque_assert_customer_payment_role_internal','collect_customer_balance_v1','get_customer_collections_v1','get_customer_outstanding_orders_page','preview_customer_collection_v1']);
 for(const d of differences){const a={...d.before},b={...d.after};delete a.definition;delete b.definition;assert.deepEqual(b,a,'all ACL,owner,security,path and nondefinition fields exact');}
 const onceCatalog=await json(schemaCatalogSql);await sql(migration);assert.deepEqual(await json(schemaCatalogSql),onceCatalog,'idempotent explicit definitions');
 for(let i=0;i<reads.length;i++){assert.deepEqual(await rpc(reads[i]),beforeReads[i]);assert.deepEqual(await rpc(reads[i],cashier),beforeReads[i]);}
 for(const page of [1,2])for(const search of [null,'تحصيل','NO-MATCH-198']){
  const call=`get_customer_outstanding_orders_page(${page},1,${search===null?'NULL':q(search)})`;assert.deepEqual(await rpc(call,cashier),await rpc(call));
 }
 record('only five role-guard definitions changed;all ACL/data exact;three reader payloads and paging exact for owner/cashier');
 stage='cashier cash oldest-first collection and replay';
 const k=key(),operation=await collect(8000,'cash',k);
 assert.deepEqual([operation.openingAmountInMinorUnits,operation.ordersAmountInMinorUnits],[5000,3000]);
 const summary=()=>rpc(`get_cash_shift_summary(${q(shift)})`);
 assert.equal((await summary()).expectedCashInMinorUnits,108000);assert.equal((await summary()).cashReceiptsInMinorUnits,8000);
 const fingerprint=await readApplicationFingerprint(executor);assert.equal((await collect(8000,'cash',k)).idempotentReplay,true);assert.deepEqual(await readApplicationFingerprint(executor),fingerprint);
 assert.equal((await rpc(`get_customer_collections_v1(${q(customer)})`,cashier)).operations[0].operationId,operation.operationId);
 await denied(`reverse_customer_collection_v1(${q(operation.operationId)},'عكس غير مسموح للكاشير')`);
 const onceKey=key(),onceCall=`record_customer_order_payment_once(${q(order)},1000,'cash',NULL,NULL,${q(onceKey)})`;
 const payment=await rpc(onceCall,cashier);assert.equal((await rpc(onceCall,cashier)).idempotent,true);
 await denied(`reverse_customer_order_payment(${q(payment.payment_id)},'عكس غير مسموح للكاشير')`);
 await rpc(`record_customer_order_payment(${q(order)},500,'cash',NULL,NULL)`,cashier);
 assert.equal((await summary()).expectedCashInMinorUnits,109500);
 record('cashier unified8000=opening5000+order3000 exactly once;legacy1000+500;drawer109500;both reversals denied',{expectedCashInMinorUnits:109500});
 stage='cashier CliQ transfer and registered cheque';
 await collect(1000,'cliq');await rpc(`record_customer_order_payment_once(${q(order)},1000,'cliq','CLI198',NULL,${q(key())})`,cashier);
 await collect(1000,'bank_transfer');await rpc(`record_customer_order_payment_once(${q(order)},1000,'bank_transfer','BANK198',NULL,${q(key())})`,cashier);
 assert.equal((await summary()).expectedCashInMinorUnits,109500);
 await denied(`record_customer_order_payment_once(${q(order)},1000,'card',NULL,NULL,${q(key())})`);
 await denied(`record_customer_order_payment_once(${q(order)},1000,'cheque',NULL,NULL,${q(key())})`,cashier,/CHEQUE_REQUIRES_UNIFIED_COLLECTION/u);
 const cheque=await rpc(`receive_customer_cheque_v1(${q(customer)},${q(branch)},'بنك الاختبار','CASHIER198',CURRENT_DATE+2,1000,NULL,${q(key())})`,cashier);
 assert.equal(cheque.cheque.status,'pending');assert.equal((await summary()).expectedCashInMinorUnits,109500);
 await denied(`cancel_deferred_cheque_v1(${q(cheque.cheque.id)},1,'إلغاء غير مسموح',${q(key())})`);
 await denied(`clear_deferred_cheque_v1(${q(cheque.cheque.id)},1,${q(key())})`);
 record('cashier CliQ/bank transfer/registered cheque allowed;drawer unchanged;card/unregistered cheque/cancel/clear denied');
 stage='closed shift and unauthorized callers';
 await rpc(`close_cash_shift(${q(shift)},109500,NULL)`);
 const closed=await json(`SELECT to_jsonb(s) FROM cash_shifts s WHERE id=${q(shift)};`);assert.equal(closed.expected_cash_in_minor_units,109500);
 for(const method of ['cash','cliq'])await denied(`collect_customer_balance_v1(${q(customer)},100,${q(method)},${q(branch)},'REF198',NULL,${q(key())})`,cashier,/وردية|SHIFT/iu,'authenticated',1);
 await collect(100,'bank_transfer');
 await rpc(`receive_customer_cheque_v1(${q(customer)},${q(branch)},'بنك الاختبار','CASHIER198-CLOSED',CURRENT_DATE+2,100,NULL,${q(key())})`,cashier);
 for(const call of reads){await denied(call,stranger);await denied(call,stranger,/permission denied/u,'anon');}
 await denied(`collect_customer_balance_v1(${q(customer)},100,'bank_transfer',NULL,NULL,NULL,${q(key())})`,stranger);
 record('cash/CliQ still require open shift;transfer/cheque do not;closed report109500;no-role/anon denied');
 stage='database lint';
 const {stdout:lint}=await exec(process.execPath,[cli,'db','lint','--local','--level','warning','--workdir',local],{cwd:root,windowsHide:true,timeout:120000,maxBuffer:1024*1024});
 assertPackageDDbLint(lint);record('unchanged database lint policy');report.ok=true;
}catch(error){report.ok=false;report.stage=stage;report.error=error.message;process.exitCode=1;}
finally{
 if(local)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true,maxBuffer:1024**2});
 report.endedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}
