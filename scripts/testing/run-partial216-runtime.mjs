import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {readFile,writeFile,mkdtemp,copyFile} from 'node:fs/promises';import path from 'node:path';import {tmpdir} from 'node:os';import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {readVerificationSourceFreeze,assertVerificationSourceFreeze} from './verification-source-freeze.mjs';
import {sha256,canonicalLf,futureMigrationViolations} from './maintenance-db-contract.mjs';
import {schemaCatalogSql} from './schema-catalog.mjs';
import {assertReady216Catalog} from '../operations/frankfurt-reference216.mjs';
import {raceAftercare215} from './aftercare215-race.mjs';
import {assertPackageDDbLint} from './package-d-db-lint-policy.mjs';
const root=path.resolve(import.meta.dirname,'../..');
const {aftercare215Context}=await import(pathToFileURL(path.join(root,'scripts/testing/aftercare215-context.mjs')));
const {executeInput}=await import(pathToFileURL(path.join(root,'scripts/operations/build-empty-supabase.mjs')));
const exec=promisify(execFile),project='nawasrah-tb215-test',cli=path.join(root,'node_modules/supabase/dist/supabase.js');
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-partial216-coordinator-'));let local,stage='bootstrap';
 const report={ok:false,output,hostedAccess:false,cases:[]};
const pass=name=>{report.cases.push({name,passed:true});console.log(JSON.stringify({passed:name}));};
try{
 const frozen=await readVerificationSourceFreeze(root);
 const boot=await exec(process.execPath,['scripts/testing/bootstrap-isolated-supabase.mjs'],{cwd:root,windowsHide:true,maxBuffer:32*1024**2,env:{...process.env,NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'215',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});local=JSON.parse(boot.stdout).isolatedProjectRoot;
 const c=aftercare215Context('supabase_db_'+project);await c.initialize();stage='apply216';
 const migration=await readFile(path.join(root,'supabase/migrations/216_pos_partial_payments.sql'),'utf8');
 report.migrationCanonicalLfSha256=sha256(canonicalLf(migration));assert.deepEqual(futureMigrationViolations(migration),[]);
 const old=await c.fingerprint();await c.sql(migration);const migrated=await c.fingerprint();
 for(const [table,hash]of Object.entries(old.tables))assert.equal(migrated.tables[table],hash,'NO_BACKFILL:'+table);assert.deepEqual(migrated.sequences,old.sequences);
 await copyFile(path.join(root,'supabase/migrations/216_pos_partial_payments.sql'),path.join(local,'supabase/migrations/216_pos_partial_payments.sql'));
 await exec(process.execPath,[cli,'migration','repair','--status','applied','216','--local','--workdir',local,'--agent','no'],{cwd:root,windowsHide:true,maxBuffer:8*1024**2});
 assertReady216Catalog(await c.json(schemaCatalogSql));report.strictCatalog216=true;report.noBackfill=true;
 stage='strict-db-lint';const lint=await exec(process.execPath,[cli,'db','lint','--local','--level','warning','--workdir',local],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,timeout:120000});await writeFile(path.join(output,'db-lint.json'),lint.stdout);report.acceptedHistoricalLintWarnings=assertPackageDDbLint(lint.stdout).length;
 pass('literal216 installs with official178 history, exact private/public ACL and no historical row/sequence rewrite; no new SQL lint warning');
 const make=async()=>{const pid=randomUUID();await c.sql(`INSERT INTO products(id,sku,name_ar,category_id,unit_id,purchase_unit_id,sale_unit_id,units_per_purchase_unit,units_per_sale_unit,sale_price_in_minor_units,default_sale_price_in_minor_units,cost_price_in_minor_units,wac_cost_in_minor_units_exact,is_active,is_flavor_master,parcel_only)SELECT ${c.q(pid)},${c.q('TC216-'+pid)},'صنف اختبار دفعة جزئية',category_id,unit_id,purchase_unit_id,sale_unit_id,10,10,100000,900000,0,0,true,false,false FROM products WHERE id=${c.q(c.id(103))};`);await c.receive(pid,20,500);return pid;};
 const line=pid=>[{commercial_line_kind:'base_unit',product_id:pid,base_quantity:1,price_authority:'server_catalog',line_discount_in_minor_units:0}];
 const call=(pid,key,{paid=60000,method='cash',discount=0,reference='LOCAL216',customer=c.id(401)}={})=>`create_pos_sale_with_initial_payment_v1(${c.q(c.warehouse)},${c.q(c.branch)},${c.q(customer)},'عميل اختبار',${c.j(line(pid))},${discount},${paid===null?'NULL':paid},${c.q(method)},${c.q(reference)},${c.q(key)})`;
 const legacy=(pid,key)=>`create_pos_sale_v2(${c.q(c.warehouse)},${c.q(c.branch)},${c.q(c.id(401))},'عميل اختبار','debt',${c.j(line(pid))},0,0,${c.q(key)})`;
 const firstSales=[];
 for(const method of ['cash','cliq']){
  stage=method;const pid=await make(),key=c.key(),before=await c.facts(),balance=Number(await c.sql(`SELECT public.phase42_customer_receivable_total_internal(${c.q(c.id(401))});`));
  const sale=await c.rpc(call(pid,key,{method}));assert.equal(sale.amountPaidInMinorUnits,60000);assert.equal(sale.remainingInMinorUnits,40000);assert.equal(sale.paymentMethod,'debt');assert.equal(sale.paymentStatus,'partially_paid');assert.equal(sale.initialPaymentMethod,method);assert.equal((await c.stock(pid)).quantity,19);
  const order=await c.json(`SELECT jsonb_build_object('total',total_in_minor_units,'paid',amount_paid_in_minor_units,'status',payment_status)FROM orders WHERE id=${c.q(sale.orderId)};`);assert.deepEqual(order,{total:100000,paid:60000,status:'partially_paid'});assert.equal(Number(await c.sql(`SELECT public.phase42_customer_receivable_total_internal(${c.q(c.id(401))});`))-balance,40000);
  const payment=await c.json(`SELECT jsonb_build_object('count',count(*),'sum',sum(amount_in_minor_units),'method',min(payment_method),'shift',bool_and(cash_shift_id IS NOT NULL))FROM customer_payments WHERE order_id=${c.q(sale.orderId)};`);assert.deepEqual(payment,{count:1,sum:60000,method,shift:true});
  const creation=await c.json(`SELECT result_snapshot FROM business_operations WHERE id=${c.q(sale.operationId)};`);assert.equal(creation.amountPaidInMinorUnits,0);assert.equal(creation.paymentMethod,'debt');
  const frozen=await c.fingerprint();const replay=await c.rpc(call(pid,key,{method}));assert.deepEqual(replay,{...sale,idempotentReplay:true});assert.deepEqual(await c.fingerprint(),frozen);
  for(const changed of [{paid:60001,method},{method:method==='cash'?'cliq':'cash'},{method,reference:'DIFFERENT216'}])await c.fail(call(pid,key,changed),/PHASE3_IDEMPOTENCY_CONFLICT/);
  await c.fail(legacy(pid,key),/PHASE3_IDEMPOTENCY_CONFLICT/);
  report.cases.push({method,paid:60000,due:40000,stock:19,oneVoucher:true,originalSnapshotUnchanged:true,replayZeroWrites:true,financialFactsBefore:before,financialFactsAfter:await c.facts()});
  firstSales.push({method,pid,sale,key});
  const token=await c.rpc(`get_or_create_pos_receipt_token(${c.q(sale.orderId)})`),receipt=await c.rpc(`get_public_pos_receipt(${c.q(token.receiptToken)})`,null,'anon','aal1',true);
  assert.equal(receipt.amountPaidInMinorUnits,60000);assert.equal(receipt.remainingInMinorUnits,40000);assert.equal(receipt.initialPaymentMethod,method);assert.doesNotMatch(JSON.stringify(receipt),/cost|wac|profit|cogs|referenceNumber/iu);
 }
 pass('cash and CliQ100000/60000/40000: one bound receipt, immutable original debt snapshot, public safe amounts and zero-write exact replay/conflicts');
 stage='bounds';const pid=await make();
 for(const options of [{paid:0},{paid:-1},{paid:100000},{paid:100001},{paid:null},{method:'cheque'},{method:null},{customer:null},{discount:100000}])await c.fail(call(pid,c.key(),options),/POS216_INITIAL_PAYMENT_INVALID|PHASE3_POS_DEBT_CUSTOMER_REQUIRED/);
 const oldKey=c.key();await c.rpc(legacy(pid,oldKey));await c.fail(call(pid,oldKey),/PHASE3_IDEMPOTENCY_CONFLICT/);
 stage='roles';
 for(const [index,role] of ['admin','manager','sales','cashier','accountant','warehouse_keeper','viewer','none','inactive'].entries()){
  stage='role-'+role;
  const uid=c.id(700+index),roleCode=role==='inactive'?'owner':role;await c.sql(`INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) VALUES(${c.q(uid)},'authenticated','authenticated',${c.q('role216-'+index+'@example.test')},'{}','{}');INSERT INTO profiles(id,full_name,is_active)VALUES(${c.q(uid)},'اختبار الدور',${role!=='inactive'});${role==='none'?'':`INSERT INTO roles(code,name_ar)VALUES(${c.q(roleCode)},${c.q(roleCode)})ON CONFLICT(code)DO NOTHING;INSERT INTO user_roles(user_id,role_id)SELECT ${c.q(uid)},id FROM roles WHERE code=${c.q(roleCode)};`}`);
  const quick=`save_customer('زبون سريع اصطناعي',${c.q('999000216'+String(index).padStart(3,'0'))},NULL,NULL,NULL,NULL,NULL,'wholesale')`;
  if(['admin','manager','sales'].includes(role)){const sale=await c.rpc(call(pid,c.key()),uid);assert.equal(sale.amountPaidInMinorUnits,60000);assert.ok((await c.rpc(quick,uid)).customer_id);}
  else{await c.fail(call(pid,c.key()),/permission|صلاحية|دور|مفع|نشط|مصادق|غير|يملك|مسموح|موظف|ERP|ROLE|AUTH|ACTIVE/iu,uid);await c.fail(quick,/permission|صلاحية/iu,uid);}
 }
 stage='enrolled-owner-aal1';await c.sql(`INSERT INTO auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at,secret)VALUES(${c.q(c.id(799))},${c.q(c.owner)},'Local216 enrollment','totp','verified',NOW(),NOW(),'local216-test-factor');`);
 await c.fail(call(pid,c.key()),/MFA|AAL|تحقق|خطوتين|مستوى|مصادقة/iu,c.owner,'authenticated','aal1');
 await c.fail(call(firstSales[0].pid,firstSales[0].key),/المصادقة الثنائية/u,c.owner,'authenticated','aal1');
 await c.fail(call(firstSales[0].pid,firstSales[0].key),/PHASE3_IDEMPOTENCY_CONFLICT/u,c.id(700));
 for(const role of ['anon','service_role'])await c.fail(call(pid,c.key()),/permission denied/iu,c.owner,role);
 stage='private-evidence-and-immutability';
 for(const role of ['authenticated','anon','service_role']){
  const before=await c.fingerprint(),r=await executeInput(c.executor,c.auth('SELECT count(*) FROM public.pos216_initial_payments;',c.owner,role));assert.notEqual(r.code,0);assert.match(r.stderr,/permission denied/iu);assert.deepEqual(await c.fingerprint(),before);
 }
 await c.fail(legacy(pid,c.key()).replace('create_pos_sale_v2','tc216_create_pos_sale_v2_internal'),/permission denied/iu);
 await c.fail(legacy(pid,c.key()).replace('create_pos_sale_v2','create_pos_sale'),/PACKAGE_D_POS_V2_REQUIRED|permission denied/iu);
 for(const statement of ['UPDATE public.pos216_initial_payments SET amount_in_minor_units=amount_in_minor_units;','TRUNCATE public.pos216_initial_payments;']){
  const before=await c.fingerprint(),r=await executeInput(c.executor,'BEGIN;'+statement+'COMMIT;');assert.notEqual(r.code,0);assert.match(r.stderr,/POS216_INITIAL_PAYMENT_IMMUTABLE/);assert.deepEqual(await c.fingerprint(),before);
 }
 pass('existing customer creation role parity; no-role/inactive/enrolled AAL1/cross-actor/anon/service/private evidence and legacy V1 refused, immutable table updates/truncate blocked');
 stage='atomic-rollback';
 await c.sql(`CREATE FUNCTION public.tc216_test_reject_receipt()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'TC216_TEST_RECEIPT_REFUSAL';END$$;CREATE TRIGGER tc216_test_receipt_refusal BEFORE INSERT ON customer_payments FOR EACH ROW EXECUTE FUNCTION public.tc216_test_reject_receipt();`);
 const beforeRollback=await c.fingerprint();const rejected=await executeInput(c.executor,c.auth('SELECT public.'+call(pid,c.key())+';'));assert.notEqual(rejected.code,0);assert.match(rejected.stderr,/TC216_TEST_RECEIPT_REFUSAL/);
 const afterRollback=await c.fingerprint();assert.deepEqual(afterRollback,{...beforeRollback,sequences:{...beforeRollback.sequences,pos_sale_number_seq:beforeRollback.sequences.pos_sale_number_seq+1,customer_payment_number_seq:beforeRollback.sequences.customer_payment_number_seq+1,inventory_movement_mutation_seq:beforeRollback.sequences.inventory_movement_mutation_seq+1}},'EVERY_TABLE_AND_ALL_OTHER_SEQUENCES_ROLLBACK_ONLY_EXACT_THREE_EXISTING_SEQUENCE_ALLOCATIONS');
 await c.sql('DROP TRIGGER tc216_test_receipt_refusal ON customer_payments;DROP FUNCTION public.tc216_test_reject_receipt();');
 pass('injected receipt failure rolls back every public row and every sequence except exactly one POS number, receipt number and existing technical mutation stamp');
 stage='same-key-concurrency';const racePid=await make(),raceKey=c.key(),request=call(racePid,raceKey),runRace=raceAftercare215(c);const replayRace=await runRace(request,request);assert.equal(replayRace.code,0,replayRace.stderr);const replayResult=JSON.parse(replayRace.stdout.trim().split('\n').at(-1));assert.equal(replayResult.idempotentReplay,true);assert.equal((await c.stock(racePid)).quantity,19);assert.equal(Number(await c.sql(`SELECT count(*) FROM customer_payments WHERE order_id=${c.q(replayResult.orderId)};`)),1);
 stage='different-key-concurrency';const pairPid=await make(),differentRace=await runRace(call(pairPid,c.key()),call(pairPid,c.key()));assert.equal(differentRace.code,0,differentRace.stderr);assert.equal(JSON.parse(differentRace.stdout.trim().split('\n').at(-1)).idempotentReplay,false);assert.equal((await c.stock(pairPid)).quantity,18);
 pass('two real independent sessions prove PostgreSQL blocking: one same-key sale/payment and two different-key sales without lock-upgrade deadlock');
 stage='discount';for(const method of ['cash','cliq']){const discountPid=await make(),sale=await c.rpc(call(discountPid,c.key(),{discount:10000,method}));assert.equal(sale.totalInMinorUnits,90000);assert.equal(sale.amountPaidInMinorUnits,60000);assert.equal(sale.remainingInMinorUnits,30000);}
 stage='formed-parcel';await c.receive(c.id(101),20,500);await c.receive(c.id(102),20,600);
 const configured=await c.rpc(`save_product_parcel_configuration_v1(${c.q(c.id(100))},'configurable_mix',true,5,ARRAY[${c.q(c.id(101))},${c.q(c.id(102))}]::uuid[])`);await c.rpc("set_configurable_parcel_feature_state_v1('ENABLED')");
 const formedLine={commercial_line_kind:'configurable_parcel',family_product_id:c.id(100),parcel_configuration_id:configured.configuration.id,configuration_revision:configured.configuration.configuration_revision,parcel_instances:[{components:[{product_id:c.id(101),base_quantity:2},{product_id:c.id(102),base_quantity:3}]}],price_authority:'server_catalog',line_discount_in_minor_units:0};
 const formed=await c.rpc(`create_pos_sale_with_initial_payment_v1(${c.q(c.warehouse)},${c.q(c.branch)},${c.q(c.id(401))},'اختبار مشكّل',${c.j([formedLine])},0,2000,'cash',NULL,${c.q(c.key())})`);assert.equal(formed.totalInMinorUnits,5000);assert.equal(formed.amountPaidInMinorUnits,2000);assert.equal(formed.remainingInMinorUnits,3000);assert.equal((await c.stock(c.id(101))).quantity,18);assert.equal((await c.stock(c.id(102))).quantity,17);
 stage='closing-anchors';const shift=await c.sql(`SELECT id FROM cash_shifts WHERE branch_id=${c.q(c.branch)} AND status='open';`),closing=await c.rpc(`get_cash_shift_closing_report(${c.q(shift)})`);assert.equal(closing.salesDetailStatus,'available');assert.equal(closing.sales.grossSalesInMinorUnits,1085000);assert.equal(closing.sales.creditSalesInMinorUnits,483000);assert.equal(closing.sales.initialReceiptPaymentsInMinorUnits,602000);assert.equal(closing.sales.initialReceiptCashInMinorUnits,482000);assert.equal(closing.sales.initialReceiptCliqInMinorUnits,120000);assert.equal(closing.reconciliation.expectedCashInMinorUnits,982000);
 stage='returns-after-partial';const {returnPayload215}=await import(pathToFileURL(path.join(root,'scripts/testing/aftercare215-return-cases.mjs')));
 for(const s of firstSales){const item=await c.json(`SELECT to_jsonb(id) FROM order_items WHERE order_id=${c.q(s.sale.orderId)};`),payload=returnPayload215({...s,item},{quantity:1,good:1,method:s.method,reference:s.method==='cliq'?'LOCAL216-REFUND':null}),preview=await c.rpc(`preview_admin_sales_return_v2(${c.j(payload)})`);assert.equal(preview.canConfirm,true);assert.equal(preview.debtReductionInMinorUnits,'40000');assert.equal(preview.moneyRefundInMinorUnits,'60000');const before=await c.facts();const refunded=await c.rpc(`settle_admin_sales_return_v2(${c.j(payload)},${c.q(c.key())},${c.q(preview.previewFingerprint)})`);assert.equal(refunded.debtReductionInMinorUnits,'40000');assert.equal(refunded.moneyRefundInMinorUnits,'60000');assert.equal((await c.stock(s.pid)).quantity,20);assert.equal(Number((await c.stock(s.pid)).wac),500);assert.equal((await c.facts()).sales.netProfitInMinorUnits-before.sales.netProfitInMinorUnits,-99500);
  const token=await c.rpc(`get_or_create_pos_receipt_token(${c.q(s.sale.orderId)})`),receipt=await c.rpc(`get_public_pos_receipt(${c.q(token.receiptToken)})`,null,'anon','aal1',true);assert.equal(receipt.remainingInMinorUnits,0);
 }
 stage='close-and-reprint';const finalReport=await c.rpc(`get_cash_shift_closing_report(${c.q(shift)})`);assert.equal(finalReport.reconciliation.expectedCashInMinorUnits,922000);assert.equal(finalReport.sales.netSalesInMinorUnits,885000);assert.equal(finalReport.sales.debtReductionInMinorUnits,80000);await c.rpc(`close_cash_shift(${c.q(shift)},922000,NULL)`);const closed=await c.rpc(`get_cash_shift_closing_report(${c.q(shift)})`);assert.equal(closed.reconciliation.cashDiscrepancyInMinorUnits,0);const closedStable=await c.fingerprint();await c.rpc(`get_cash_shift_closing_report(${c.q(shift)})`);assert.deepEqual(await c.fingerprint(),closedStable);
 pass('discount and formed parcel priced by server; cash/CliQ full Return reduces40000debt/refunds60000/restocks at exact500WAC; closing922000/zero difference and zero-write reprint');
 stage='partial-parcel-and-legacy-races';const nextShift=await c.rpc(`open_cash_shift(${c.q(c.branch)},922000)`),parcelPid=await make();
 const parcelLine={commercial_line_kind:'legacy_single_sku_parcel',product_id:parcelPid,parcel_quantity:1,units_per_parcel:10,price_authority:'server_catalog',line_discount_in_minor_units:0};
 const parcelSale=await c.rpc(`create_pos_sale_with_initial_payment_v1(${c.q(c.warehouse)},${c.q(c.branch)},${c.q(c.id(401))},'اختبار طرد',${c.j([parcelLine])},0,600000,'cash',NULL,${c.q(c.key())})`);
 assert.equal(parcelSale.totalInMinorUnits,900000);assert.equal(parcelSale.amountPaidInMinorUnits,600000);assert.equal(parcelSale.remainingInMinorUnits,300000);assert.equal((await c.stock(parcelPid)).quantity,10);assert.equal(parcelSale.items[0].cogsInMinorUnits,5000);
 for(const first of ['legacy','partial']){const conflictPid=await make(),conflictKey=c.key(),a=first==='legacy'?legacy(conflictPid,conflictKey):call(conflictPid,conflictKey),b=first==='legacy'?call(conflictPid,conflictKey):legacy(conflictPid,conflictKey),loser=await runRace(a,b);assert.notEqual(loser.code,0);assert.match(loser.stderr,/PHASE3_IDEMPOTENCY_CONFLICT/);assert.equal((await c.stock(conflictPid)).quantity,19);assert.equal(Number(await c.sql(`SELECT count(*) FROM orders WHERE idempotency_key=${c.q(conflictKey)};`)),1);assert.equal(Number(await c.sql(`SELECT count(*) FROM customer_payments p JOIN orders o ON o.id=p.order_id WHERE o.idempotency_key=${c.q(conflictKey)};`)),first==='legacy'?0:1);}
 assert.deepEqual(await c.rpc(`get_cash_shift_closing_report(${c.q(shift)})`),closed,'EARLIER_CLOSED_SNAPSHOT_UNCHANGED');await c.rpc(`close_cash_shift(${c.q(nextShift.id)},1582000,NULL)`);const closedNext=await c.rpc(`get_cash_shift_closing_report(${c.q(nextShift.id)})`);assert.equal(closedNext.reconciliation.expectedCashInMinorUnits,1582000);assert.equal(closedNext.reconciliation.cashDiscrepancyInMinorUnits,0);
 pass('ordinary partial parcel consumes10units/5000COGS; legacy-v2/partial raw-key race fails closed in BOTH orders; prior closed snapshot unchanged');
 stage='integrity';const {verifyIntegrity215}=await import(pathToFileURL(path.join(root,'scripts/testing/aftercare215-restore-runtime.mjs')));report.integrity=await verifyIntegrity215(c,name=>report.cases.push({name,passed:true}),output);
 stage='strict-local-restore-replay';const {aftercare211Restore}=await import(pathToFileURL(path.join(root,'scripts/testing/aftercare211-restore.mjs')));
 report.restore=await aftercare211Restore({container:'supabase_db_'+project,executor:c.executor,output,replay:async executor=>{
  for(const saved of firstSales){const r=await executeInput(executor,c.auth('SELECT public.'+call(saved.pid,saved.key,{method:saved.method})+';'));assert.equal(r.code,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout.trim().split('\n').at(-1)),{...saved.sale,idempotentReplay:true});}
 }});report.quickCustomerExistingRoleParity=true;report.privateEvidenceDenied=true;report.immutableEvidence=true;
 report.boundsZeroWrites=true;report.roles=true;report.atomicRollbackAllTables=true;report.rollbackSequenceAllocation={pos_sale_number_seq:1,customer_payment_number_seq:1,inventory_movement_mutation_seq:1,allOtherSequences:0};report.sameKeyRaceOneSaleOnePayment=true;report.differentKeyRaceTwoSalesNoDeadlock=true;report.actualBlockingProved=true;report.discount=true;report.formedParcel=true;report.returnsCashAndCliq={debtReductionEach:40000,moneyRefundEach:60000};report.closing={expectedCash:922000,difference:0};report.history=Number(await c.sql('SELECT count(*) FROM supabase_migrations.schema_migrations;'));assert.equal(report.history,178);
 assert.equal(sha256(canonicalLf(await readFile(path.join(root,'supabase/migrations/216_pos_partial_payments.sql'),'utf8'))),report.migrationCanonicalLfSha256);assertVerificationSourceFreeze(frozen,await readVerificationSourceFreeze(root));report.repositoryStayedFrozen=true;report.ok=true;
}catch(error){report.error=error.message;report.stage=stage;process.exitCode=1;}
finally{if(local)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true,maxBuffer:8*1024**2});await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,output,stage:report.stage,error:report.error,hostedAccess:false}));}
