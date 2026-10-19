// Actual PostgreSQL roles and two sessions; no mocked warehouse state.
import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
import {schemaCatalogSql} from './schema-catalog.mjs';
import {bindFirstOwnerAndWarehouseSql} from '../operations/first-owner-warehouse-core.mjs';
import {assertPackageDDbLint} from './package-d-db-lint-policy.mjs';
import {readRowCounts} from '../operations/trial-reset-core.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile);
const project='nawasrah-owner-warehouses-test',container='supabase_db_'+project;
const cli=path.join(root,'node_modules/supabase/dist/supabase.js'),executor=executorFor(['--container',container]);
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-owner-warehouses-'));
const report={output,managedAccess:false,startedAt:new Date().toISOString(),proofs:[]};let local,stage='bootstrap';
const id=n=>'92600000-0000-4000-8000-'+String(n).padStart(12,'0');
const owner=id(1),cashier=id(2),wh=id(501),second=id(502),branch=id(200),otherBranch=id(503);
const q=v=>"'"+String(v).replaceAll("'","''")+"'";
const claims=actor=>`SET LOCAL ROLE authenticated;SELECT set_config('request.jwt.claims',${q(JSON.stringify({sub:actor,role:'authenticated',aal:'aal2'}))},true);`;
const sql=async text=>{const r=await executeInput(executor,text);assert.equal(r.code,0,r.stderr);return r.stdout.trim();};
const last=text=>text.split(/\r?\n/u).filter(Boolean).at(-1);
const run=async(actor,body)=>JSON.parse(last(await sql(`BEGIN;${claims(actor)}SELECT ${body};COMMIT;`)));
const version=async target=>last(await sql(`SELECT updated_at::text FROM warehouses WHERE id=${q(target)};`));
const save=(target,name,active=true,b=branch,stamp=null,code='WH-TEST')=>
  `public.save_owner_warehouse_v1(${q(target)},${q(code)},${q(name)},${q(b)},${active},${stamp===null?'NULL':q(stamp)}::timestamptz)`;
const refused=async(actor,body,pattern)=>{const r=await executeInput(executor,`BEGIN;${claims(actor)}SELECT ${body};COMMIT;`);assert.notEqual(r.code,0);assert.match(r.stderr,pattern);};
const hold=async(body,tag)=>{
  const child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-q','-At','-v','ON_ERROR_STOP=1'],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let out='',err='',resolveReady,rejectReady;
  const ready=new Promise((r,j)=>{resolveReady=r;rejectReady=j;});
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',chunk=>{out+=chunk;if(out.split(/\r?\n/u).includes(tag))resolveReady();});
  child.stderr.on('data',chunk=>err+=chunk);
  const done=new Promise((resolve,reject)=>{child.on('error',error=>{rejectReady(error);reject(error);});child.on('close',code=>{rejectReady(Error(err));resolve({code,out,err});});});
  child.stdin.write(`SET statement_timeout='60s';SET lock_timeout='30s';SET application_name=${q(tag)};BEGIN;${claims(owner)}${body}SELECT ${q(tag)};\n`);
  await ready;return {release:()=>child.stdin.end('COMMIT;\n'),done};
};
const receipt=target=>`public.create_direct_supplier_receipt_v2(p_supplier_id:=${q(id(301))},p_warehouse_id:=${q(target)},p_branch_id:=${q(branch)},
  p_supplier_invoice_number:=${q(randomUUID())},p_amount_paid_at_receipt_in_minor_units:=0,p_payment_method:='deferred',
  p_idempotency_key:=${q(randomUUID())},p_lines:=${q(JSON.stringify([{client_line_id:randomUUID(),purchase_order_item_id:null,line_kind:'base_unit',commercial_quantity:1,base_unit_name:'باكيت',gross_amount_in_minor_units:1000,line_discount_in_minor_units:0,components:[{product_id:id(103),base_quantity:1}]}]))}::jsonb)`;
const zeroProduct=target=>`public.create_product_with_opening_stock_v4(p_sku:=${q('ZERO-'+randomUUID())},p_name_ar:='صنف بلا كمية',
  p_category_id:=${q(id(11))},p_unit_id:=${q(id(10))},p_purchase_unit_id:=${q(id(10))},p_units_per_purchase_unit:=1,
  p_default_purchase_price_in_minor_units:=1000,p_sale_unit_id:=${q(id(10))},p_units_per_sale_unit:=1,
  p_default_sale_price_in_minor_units:=1000,p_cost_price_in_minor_units:=1000,p_warehouse_id:=${q(target)},p_opening_quantity:=0)`;
try{
 const boot=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,
  env:{...process.env,NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'199',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
  NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 local=JSON.parse(boot.stdout).isolatedProjectRoot;
 await sql('ALTER TABLE orders DISABLE TRIGGER trg_notify_new_website_order_push;SELECT cron.alter_job(jobid,active:=false) FROM cron.job;');
 report.initialCounts=await readRowCounts(executor);
 stage='atomic-first-owner-and-warehouse';
 const ownerInput={ownerId:owner,email:'future-owner@example.test',name:'المالك',branchCode:'BR-MAIN',branchName:'الفرع الرئيسي'};
 const composed=bindFirstOwnerAndWarehouseSql(ownerInput).replace(/^BEGIN ISOLATION LEVEL SERIALIZABLE;/u,'').replace(/COMMIT;$/u,'');
 const automatic=await sql(`BEGIN;DELETE FROM warehouses;DELETE FROM branches;
   INSERT INTO auth.users(id,aud,role,email,email_confirmed_at) VALUES(${q(owner)},'authenticated','authenticated','future-owner@example.test',NOW());
   ${composed}${composed}SELECT jsonb_build_object('warehouses',(SELECT count(*) FROM warehouses),'audits',(SELECT count(*) FROM audit_logs WHERE action='MAIN_WAREHOUSE_BOOTSTRAP'));ROLLBACK;`);
 assert.deepEqual(JSON.parse(last(automatic)),{warehouses:1,audits:1});
 const atomicDenied=await executeInput(executor,`BEGIN;DELETE FROM warehouses;DELETE FROM branches;
   INSERT INTO branches(id,code,name_ar) VALUES(${q(branch)},'BR-MAIN','الفرع الرئيسي');
   INSERT INTO warehouses(code,name_ar,branch_id) VALUES('DIFFERENT','مستودع مختلف',${q(branch)});
   INSERT INTO auth.users(id,aud,role,email,email_confirmed_at) VALUES(${q(owner)},'authenticated','authenticated','future-owner@example.test',NOW());
   ${composed}COMMIT;`);
 assert.notEqual(atomicDenied.code,0);assert.match(atomicDenied.stderr,/MAIN_WAREHOUSE_DIFFERENT_WAREHOUSE/u);
 assert.equal(last(await sql(`SELECT count(*) FROM profiles WHERE id=${q(owner)};`)),'0','WAREHOUSE_CONFLICT_MUST_ROLL_BACK_OWNER_BINDING');
 report.proofs.push('first-owner creates main warehouse atomically','first-owner warehouse replay is exact','warehouse conflict rolls back owner/profile/role/branch');
 await sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
 await sql(`INSERT INTO auth.users(id,aud,role,email) VALUES(${q(cashier)},'authenticated','authenticated','warehouse-cashier@example.test');
  INSERT INTO profiles(id,full_name,is_active) VALUES(${q(cashier)},'كاشير',true);
  INSERT INTO roles(code,name_ar) VALUES('cashier','كاشير') ON CONFLICT(code) DO NOTHING;
  INSERT INTO user_roles(user_id,role_id) SELECT ${q(cashier)},id FROM roles WHERE code='cashier';
  INSERT INTO branches(id,code,name_ar) VALUES(${q(otherBranch)},'WH-OTHER-BRANCH','فرع آخر');`);
 assert.equal(last(await sql(`SELECT count(*) FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=${q(cashier)} AND r.code='cashier';`)),'1','CASHIER_MUST_HAVE_REAL_ROLE');
 stage='ACL';
 for(const signature of ['get_owner_warehouses_v1()','save_owner_warehouse_v1(uuid,text,text,uuid,boolean,timestamptz)']){
  const acl=JSON.parse(last(await sql(`SELECT jsonb_build_object('anon',has_function_privilege('anon','public.${signature}','EXECUTE'),
    'auth',has_function_privilege('authenticated','public.${signature}','EXECUTE'),'owner',pg_get_userbyid(proowner),'definer',prosecdef,'path',proconfig)
    FROM pg_proc WHERE oid='public.${signature}'::regprocedure;`)));
  assert.deepEqual(acl,{anon:false,auth:true,owner:'postgres',definer:true,path:['search_path=public, pg_temp']});
 }
 const denied=await executeInput(executor,'SET ROLE anon;SELECT public.get_owner_warehouses_v1();');assert.notEqual(denied.code,0);assert.match(denied.stderr,/permission denied/u);
 await refused(cashier,'public.get_owner_warehouses_v1()',/ليس لديك صلاحية/u);
 await refused(cashier,save(wh,'مستودع الاختبار'),/ليس لديك صلاحية/u);
 const catalog=JSON.parse(last(await sql(schemaCatalogSql)));
 stage='create-replay-edit';
 const created=await run(owner,save(wh,'مستودع الاختبار'));assert.equal(created.idempotentReplay,false);
 const exact=await sql(`SELECT row_to_json(w) FROM warehouses w WHERE id=${q(wh)};`);
 assert.equal((await run(owner,save(wh,'مستودع الاختبار'))).idempotentReplay,true);
 assert.equal(await sql(`SELECT row_to_json(w) FROM warehouses w WHERE id=${q(wh)};`),exact);
 assert.equal(last(await sql(`SELECT count(*) FROM audit_logs WHERE entity_id=${q(wh)};`)),'1');
 await refused(owner,save(wh,'تعديل قديم',true,branch,'2000-01-01'),/WAREHOUSE_EDIT_CONFLICT/u);
 await run(owner,save(wh,'اسم جديد',true,branch,await version(wh)));
 await run(owner,save(wh,'اسم جديد',false,branch,await version(wh)));
 assert.equal((await run(owner,'public.get_owner_warehouses_v1()')).warehouses.find(w=>w.id===wh).isActive,false,'MANAGEMENT_MUST_INCLUDE_INACTIVE');
 await run(owner,save(wh,'اسم جديد',true,branch,await version(wh)));
 report.proofs.push('owner only and anon denied','idempotent create and single audit','stale edit rejected','rename/deactivate/reactivate empty','inactive visible in owner reader');
 stage='zero-product-no-movement';
 const assigned=id(505);await run(owner,save(assigned,'مستودع صنف صفري',true,branch,null,'WH-ZERO'));
 const zero=await run(owner,zeroProduct(assigned));assert.equal(zero.success,true);
 assert.deepEqual(JSON.parse(last(await sql(`SELECT jsonb_build_object('rows',count(*),'onHand',sum(on_hand_quantity),'reserved',sum(reserved_quantity)) FROM inventory_balances WHERE warehouse_id=${q(assigned)};`))),{rows:1,onHand:0,reserved:0});
 assert.equal(last(await sql(`SELECT count(*) FROM inventory_movements WHERE warehouse_id=${q(assigned)};`)),'0');
 const zeroStamp=await version(assigned);
 const assignment=(await run(owner,'public.get_owner_warehouses_v1()')).warehouses.find(w=>w.id===assigned);
 assert.equal(assignment.hasProductAssociations,true);assert.equal(assignment.hasMovements,false);assert.equal(assignment.hasStockOrReservations,false);
 await refused(owner,save(assigned,'مستودع صنف صفري',false,branch,zeroStamp,'WH-ZERO'),/WAREHOUSE_HAS_PRODUCTS/u);
 assert.equal(await version(assigned),zeroStamp,'REFUSED_ZERO_ASSIGNMENT_DISABLE_MUST_NOT_WRITE');
 await run(owner,save(assigned,'اسم صنف صفري جديد',true,branch,zeroStamp,'WH-ZERO'));
 const adjusted=await run(owner,`public.adjust_inventory_stock(${q(assigned)},${q(zero.product_id)},1,'إثبات الجرد دون تعديل منطقه','stock_count')`);
 assert.equal(adjusted.success,true);assert.equal(adjusted.actualQuantity,1);
 assert.equal(last(await sql(`SELECT is_active FROM warehouses WHERE id=${q(assigned)};`)),'t');
 report.proofs.push('real zero-opening product creates assignment without movement;deactivation refused without writes','zero-assigned warehouse rename allowed','unchanged stock-count RPC succeeds on still-active assigned warehouse');
 stage='stock-reservation-history';
 await run(owner,receipt(wh));
 await refused(owner,save(wh,'اسم جديد',false,branch,await version(wh)),/WAREHOUSE_HAS_STOCK/u);
 await sql(`UPDATE inventory_balances SET reserved_quantity=on_hand_quantity WHERE warehouse_id=${q(wh)};`);
 await refused(owner,save(wh,'اسم جديد',false,branch,await version(wh)),/WAREHOUSE_HAS_STOCK/u);
 await refused(owner,save(wh,'اسم جديد',true,otherBranch,await version(wh)),/WAREHOUSE_HAS_MOVEMENTS/u);
 await run(owner,save(wh,'الاسم بعد حركة',true,branch,await version(wh)));
 report.proofs.push('actual receipt blocks deactivation','reservation blocks deactivation','actual movement blocks branch change','rename after movement allowed');
 stage='zero-balance-movement-history-and-return';
 const historical=id(201),product=id(103),j=value=>q(JSON.stringify(value))+'::jsonb';
 await run(owner,receipt(historical));
 await run(owner,`public.open_cash_shift(${q(branch)},0)`);
 const sale=await run(owner,`public.create_pos_sale_v2(${q(historical)},${q(branch)},${q(id(401))},'عميل الاختبار','debt',
   ${j([{commercial_line_kind:'base_unit',product_id:product,base_quantity:1,price_authority:'server_catalog',line_discount_in_minor_units:0}])},0,0,${q(randomUUID())})`);
 assert.equal(sale.success,true);
 assert.deepEqual(JSON.parse(last(await sql(`SELECT jsonb_build_object('onHand',on_hand_quantity,'reserved',reserved_quantity) FROM inventory_balances WHERE warehouse_id=${q(historical)} AND product_id=${q(product)};`))),{onHand:0,reserved:0});
 const historicalVersion=await version(historical);
 await refused(owner,save(historical,'مستودع اليوم',false,branch,historicalVersion,'E-GOLDEN'),/WAREHOUSE_HAS_MOVEMENTS/u);
 assert.equal(await version(historical),historicalVersion,'REFUSED_DISABLE_MUST_NOT_WRITE');
 await run(owner,save(historical,'الاسم بعد البيع',true,branch,historicalVersion,'E-GOLDEN'));
 const item=last(await sql(`SELECT id FROM order_items WHERE order_id=${q(sale.orderId)};`));
 const returned=await run(owner,`public.settle_admin_sales_return_v1(${q(sale.orderId)},${q(randomUUID())},
   ${j([{return_scope:'base_unit',order_item_id:item,quantity:1,stock_disposition:'restock'}])},
   ${j([{root_source_kind:'base_order_item',root_source_id:item,source_kind:'base_order_item',source_id:item,product_id:product,quantity:1,sellable_restock_quantity:1,defect_non_sellable_quantity:0,customer_damage_quantity:0}])},
   'إثبات المرتجع بعد منع تعطيل المستودع',NULL,NULL,NULL)`);
 assert.equal(returned.success,true);assert.equal(returned.debtReductionInMinorUnits,1000);assert.equal(returned.moneyRefundInMinorUnits,0);
 assert.deepEqual(JSON.parse(last(await sql(`SELECT jsonb_build_object('active',w.is_active,'onHand',ib.on_hand_quantity,'reserved',ib.reserved_quantity) FROM warehouses w JOIN inventory_balances ib ON ib.warehouse_id=w.id WHERE w.id=${q(historical)} AND ib.product_id=${q(product)};`))),{active:true,onHand:1,reserved:0});
 report.proofs.push('zero stock and reservation after real sale:movement history blocks deactivation without writes','rename after sale permitted','unchanged return restocks active selectable warehouse and reduces debt1000 without cash refund');
 stage='receiving-first-concurrency';
 await run(owner,save(second,'مستودع التزامن',true,branch,null,'WH-RACE'));
 const a=await hold(`SELECT ${receipt(second)};`,'WH_RECEIVING_HELD');
 const waiting=executeInput(executor,`BEGIN;SET application_name='WH_DISABLE_WAIT';${claims(owner)}SELECT ${save(second,'مستودع التزامن',false,branch,await version(second),'WH-RACE')};COMMIT;`);
 const deadline=Date.now()+10000;let blocked=false;
 while(Date.now()<deadline&&!blocked){blocked=last(await sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='WH_DISABLE_WAIT' AND cardinality(pg_blocking_pids(pid))>0);"))==='t';if(!blocked)await new Promise(r=>setTimeout(r,20));}
 a.release();assert.equal((await a.done).code,0);const wait=await waiting;assert.ok(blocked,'MUST_OBSERVE_REAL_BLOCK');assert.notEqual(wait.code,0);assert.match(wait.stderr,/WAREHOUSE_HAS_STOCK/u);
 report.proofs.push('real concurrent receipt completes before warehouse guard;disable refused');
 stage='deactivation-first-concurrency';
 const third=id(504);await run(owner,save(third,'مستودع قبل الاستلام',true,branch,null,'WH-RACE-SECOND'));
 const stamp=await version(third);
 const disabled=await hold(`SELECT ${save(third,'مستودع قبل الاستلام',false,branch,stamp,'WH-RACE-SECOND')};`,'WH_DISABLE_HELD');
 const receiptWait=executeInput(executor,`BEGIN;SET application_name='WH_RECEIPT_WAIT';${claims(owner)}SELECT ${receipt(third)};COMMIT;`);
 const receiptDeadline=Date.now()+10000;blocked=false;
 while(Date.now()<receiptDeadline&&!blocked){blocked=last(await sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='WH_RECEIPT_WAIT' AND cardinality(pg_blocking_pids(pid))>0);"))==='t';if(!blocked)await new Promise(r=>setTimeout(r,20));}
 disabled.release();assert.equal((await disabled.done).code,0);const stoppedReceipt=await receiptWait;
 assert.ok(blocked,'MUST_OBSERVE_RECEIPT_BLOCK');assert.notEqual(stoppedReceipt.code,0);assert.match(stoppedReceipt.stderr,/PHASE2_WAREHOUSE_INVALID/u);
 assert.equal(last(await sql(`SELECT count(*) FROM inventory_balances WHERE warehouse_id=${q(third)};`)),'0');
 report.proofs.push('deactivation-first blocks new receipt;receipt rechecks inactive warehouse without stock writes');
 stage='zero-product-first-concurrency';
 const productRace=id(506);await run(owner,save(productRace,'مستودع صنف متزامن',true,branch,null,'WH-PRODUCT-RACE'));
 const productHeld=await hold(`SELECT ${zeroProduct(productRace)};`,'WH_PRODUCT_HELD');
 const productDisable=executeInput(executor,`BEGIN;SET application_name='WH_PRODUCT_DISABLE_WAIT';${claims(owner)}SELECT ${save(productRace,'مستودع صنف متزامن',false,branch,await version(productRace),'WH-PRODUCT-RACE')};COMMIT;`);
 const productDeadline=Date.now()+10000;blocked=false;
 while(Date.now()<productDeadline&&!blocked){blocked=last(await sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='WH_PRODUCT_DISABLE_WAIT' AND cardinality(pg_blocking_pids(pid))>0);"))==='t';if(!blocked)await new Promise(r=>setTimeout(r,20));}
 productHeld.release();assert.equal((await productHeld.done).code,0);const productBlocked=await productDisable;
 assert.ok(blocked,'MUST_OBSERVE_PRODUCT_CREATION_BLOCK');assert.notEqual(productBlocked.code,0);assert.match(productBlocked.stderr,/WAREHOUSE_HAS_PRODUCTS/u);
 stage='deactivation-first-product-concurrency';
 const beforeProduct=id(507);await run(owner,save(beforeProduct,'مستودع قبل الصنف',true,branch,null,'WH-BEFORE-PRODUCT'));
 const noProduct=await hold(`SELECT ${save(beforeProduct,'مستودع قبل الصنف',false,branch,await version(beforeProduct),'WH-BEFORE-PRODUCT')};`,'WH_PRODUCT_DISABLE_HELD');
 const createWait=executeInput(executor,`BEGIN;SET application_name='WH_CREATE_PRODUCT_WAIT';${claims(owner)}SELECT ${zeroProduct(beforeProduct)};COMMIT;`);
 const createDeadline=Date.now()+10000;blocked=false;
 while(Date.now()<createDeadline&&!blocked){blocked=last(await sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='WH_CREATE_PRODUCT_WAIT' AND cardinality(pg_blocking_pids(pid))>0);"))==='t';if(!blocked)await new Promise(r=>setTimeout(r,20));}
 noProduct.release();assert.equal((await noProduct.done).code,0);const stoppedProduct=await createWait;
 assert.ok(blocked,'MUST_OBSERVE_ZERO_PRODUCT_BLOCK');assert.notEqual(stoppedProduct.code,0);assert.match(stoppedProduct.stderr,/المستودع.*(?:نشط|موجود)|WAREHOUSE/iu);
 assert.equal(last(await sql(`SELECT count(*) FROM inventory_balances WHERE warehouse_id=${q(beforeProduct)};`)),'0');
 report.proofs.push('zero-product-first drains creation then refuses disable for assignment','disable-first makes unchanged product RPC reject inactive warehouse with zero assignment writes');
 assert.deepEqual(JSON.parse(last(await sql(schemaCatalogSql))),catalog,'DATA_ONLY_RPC_DOES_NOT_MUTATE_CATALOG_OR_GRANTS');
 stage='db-lint';
 const lint=await exec(process.execPath,[cli,'db','lint','--local','--level','warning','--workdir',local],{cwd:root,windowsHide:true,maxBuffer:2*1024**2});
 report.dbLint=assertPackageDDbLint(lint.stdout);
 report.ok=true;
}catch(error){report.ok=false;report.stage=stage;report.error=error.message;process.exitCode=1;}
finally{if(local)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true});report.endedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
