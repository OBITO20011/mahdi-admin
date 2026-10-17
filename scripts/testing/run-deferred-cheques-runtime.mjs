// Real local DB, no mock financial truth, no network/managed credentials.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
import {rehearseChequesRestore} from './cheques-restore-rehearsal.mjs';
import {verifyChequePartyDeletion} from './cheque-party-deletion-runtime.mjs';
import {verifySupplierChequeRegistration} from './cheque-supplier-registration-runtime.mjs';
import {verifyChequeShiftReversals} from './cheque-shift-reversal-runtime.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile);
const project='nawasrah-deferred-cheques-test',executor=executorFor(['--container','supabase_db_'+project]);
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-cheques-'));
const report={startedAt:new Date().toISOString(),output,managedAccess:false,cases:[]};
const id=n=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),manager=id(2),cashier=id(3),admin=id(4),sales=id(5),noRole=id(6),branch=id(200),customer=id(401),supplier=id(301);
const q=v=>`'${String(v).replaceAll("'","''")}'`,j=v=>q(JSON.stringify(v))+'::jsonb';
let local,stage='bootstrap001-195',counter=0;
const key=()=>`cheque-runtime-key-${String(++counter).padStart(8,'0')}`;
const sql=async text=>{const r=await executeInput(executor,text);assert.equal(r.code,0,r.stderr);return r.stdout.trim();};
const auth=(actor,body,rollback=false)=>`BEGIN;SELECT set_config('request.jwt.claims',${q(JSON.stringify({sub:actor,role:'authenticated',aal:'aal2'}))},true);SET LOCAL ROLE authenticated;${body}${rollback?'ROLLBACK':'COMMIT'};`;
const rpc=async(call,actor=owner,rollback=false)=>JSON.parse((await sql(auth(actor,`SELECT public.${call};`,rollback))).split('\n').at(-1));
const refused=async(call,pattern,actor=owner)=>{const r=await executeInput(executor,auth(actor,`SELECT public.${call};`));assert.notEqual(r.code,0,call);assert.match(r.stderr,pattern,r.stderr);};
const balance=async c=>Number(await sql(`SELECT public.phase42_customer_receivable_total_internal(${q(c)});`));
const supplierBalance=async s=>JSON.parse(await sql(`SELECT jsonb_build_object('stored',s.current_balance_in_minor_units,'evidence',e.balance) FROM public.suppliers s JOIN public.phase133_supplier_balance_evidence_internal()e ON e.supplier_id=s.id WHERE s.id=${q(s)};`));
const fingerprint=()=>sql(`SELECT jsonb_object_agg(t.name,t.data)::text FROM(${['orders','customer_payments','sales_return_events','phase42_return_settlement_evidence','inventory_balances','inventory_movements','cash_shifts','supplier_payments','deferred_cheque_allocations'].map(name=>`SELECT '${name}' name,(SELECT md5(COALESCE(string_agg(to_jsonb(r)::text,'|' ORDER BY to_jsonb(r)::text),'')) FROM public.${name} r) data`).join(' UNION ALL ')})t;`);
const receive=(c,amount,k=key(),actor=owner,number=k)=>rpc(`receive_customer_cheque_v1(${q(c)},${q(branch)},'بنك الاختبار',${q(number)},CURRENT_DATE+2,${amount},NULL,${q(k)})`,actor);
const sale=async(c,n=100)=>rpc(`create_pos_sale_v2(${q(id(201))},${q(branch)},${q(c)},'عميل اختبار','debt',${j([{commercial_line_kind:'base_unit',product_id:id(101),base_quantity:n,price_authority:'server_catalog',line_discount_in_minor_units:0}])},0,0,${q(key())})`);
const record=(name,details={})=>{report.cases.push({name,passed:true,...details});console.log(JSON.stringify(report.cases.at(-1)));};
try {
  const boot=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,
    env:{...process.env,NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'195',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
      NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
  local=JSON.parse(boot.stdout).isolatedProjectRoot;
  stage='fixture';
  await sql('ALTER TABLE public.orders DISABLE TRIGGER trg_notify_new_website_order_push;SELECT cron.alter_job(jobid,active:=false) FROM cron.job;');
  await sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
  for(const [actor,role] of [[manager,'manager'],[cashier,'cashier'],[admin,'admin'],[sales,'sales'],[noRole,null]]) {
    await sql(`INSERT INTO auth.users(id,aud,role,email) VALUES(${q(actor)},'authenticated','authenticated',${q(actor+'@cheques.example.test')});
      INSERT INTO profiles(id,full_name,is_active) VALUES(${q(actor)},'موظف فحص',true);${role?`INSERT INTO roles(code,name_ar) VALUES(${q(role)},${q(role)}) ON CONFLICT(code) DO NOTHING;
      INSERT INTO user_roles(user_id,role_id) SELECT ${q(actor)},id FROM roles WHERE code=${q(role)};`:''}`);
  }
  for(let n=404;n<=415;n++) await sql(`INSERT INTO customers(id,full_name,phone,credit_limit_in_minor_units) VALUES(${q(id(n))},'عميل شيك ${n}',${q('0796600'+n)},1000000);`);
  await rpc(`create_direct_supplier_receipt_v2(p_supplier_id:=${q(supplier)},p_branch_id:=${q(branch)},p_warehouse_id:=${q(id(201))},
    p_idempotency_key:=${q(key())},p_payment_method:='deferred',p_lines:=${j([{client_line_id:id(901),line_kind:'base_unit',commercial_quantity:2000,base_unit_name:'باكيت',gross_amount_in_minor_units:400000,line_discount_in_minor_units:0,components:[{product_id:id(101),base_quantity:2000}]}])})`);
  await rpc(`open_cash_shift(${q(branch)},100000)`);
  stage='incoming and immutable erroneous cancellation after settled Return';
  const s=await sale(customer),k=key(),received=await receive(customer,100000,k,cashier);
  assert.equal(s.totalInMinorUnits,100000);assert.equal(await balance(customer),0);
  assert.equal(received.cheque.status,'pending');assert.equal(received.cheque.amount_in_minor_units,100000);
  const afterReceive=await fingerprint();
  assert.equal((await receive(customer,100000,k,cashier)).idempotentReplay,true);
  assert.equal(await fingerprint(),afterReceive);
  const item=JSON.parse(await sql(`SELECT to_jsonb(id) FROM public.order_items WHERE order_id=${q(s.orderId)};`));
  const returned=await rpc(`settle_admin_sales_return_v1(${q(s.orderId)},${q(key())},${j([{return_scope:'base_unit',order_item_id:item,quantity:30,stock_disposition:'restock'}])},
    ${j([{root_source_kind:'base_order_item',root_source_id:item,source_kind:'base_order_item',source_id:item,product_id:id(101),quantity:30,sellable_restock_quantity:30,defect_non_sellable_quantity:0,customer_damage_quantity:0}])},'مرتجع مسوّى للاختبار','cash',NULL,NULL)`);
  assert.equal(returned.moneyRefundInMinorUnits,30000);
  const beforeCancel=await fingerprint(),cancelKey=key(),cancelCall=`cancel_deferred_cheque_v1(${q(received.cheque.id)},1,'تسجيل خاطئ مع مرتجع',${q(cancelKey)})`;
  await refused(cancelCall,/صلاحية|صلاحيات|غير مصرح|ليس لديك|مالك/u,manager);
  const cancelled=await rpc(cancelCall);assert.equal(cancelled.cheque.status,'cancelled');assert.equal(await balance(customer),100000);
  assert.equal(await fingerprint(),beforeCancel,'cancel must not mutate original financial, Return, stock, shift or allocation evidence');
  assert.equal((await rpc(cancelCall)).idempotentReplay,true);
  const statement=await rpc(`get_customer_statement(${q(customer)},1,100)`);
  assert.equal(statement.closing_balance_in_minor_units,100000);assert.equal(statement.has_returned_cheque,false);
  assert.equal(statement.movements.filter(m=>m.movement_type==='cheque_cancellation_compensation').reduce((a,m)=>a+m.debit_in_minor_units,0),100000);
  assert.equal((await rpc(`get_customer_debt_aging(${q(customer)})`)).total_in_minor_units,100000);
  assert.equal(await sql(`SELECT COUNT(*) FROM public.automation_events WHERE event_type='cheque_returned';`),'0','cancellation never emits a bounced-cheque alert');
  record('100 cheque + settled30 Return + cancellation adds100; all original evidence byte-identical',{balance:100000,return:30000,badChequeFlag:false});

  stage='cancellation without Return and terminal restrictions';
  await sale(id(404));const plain=await receive(id(404),100000);const beforePlain=await fingerprint();
  await rpc(`cancel_deferred_cheque_v1(${q(plain.cheque.id)},1,'تسجيل خاطئ بلا مرتجع',${q(key())})`);
  assert.equal(await balance(id(404)),100000);assert.equal(await fingerprint(),beforePlain);
  for(const call of [`clear_deferred_cheque_v1(${q(plain.cheque.id)},2,${q(key())})`,
    `return_deferred_cheque_v1(${q(plain.cheque.id)},2,'إجراء بعد الإلغاء',${q(key())})`,
    `cancel_deferred_cheque_v1(${q(plain.cheque.id)},2,'تكرار إلغاء نهائي',${q(key())})`]) await refused(call,/CHEQUE_INVALID_TRANSITION/u);
  record('cancellation without Return adds100, terminal state immutable');

  stage='bank bounce after settled Return';
  const bounceSale=await sale(id(405));const bounced=await receive(id(405),100000);
  const bounceItem=JSON.parse(await sql(`SELECT to_jsonb(id) FROM public.order_items WHERE order_id=${q(bounceSale.orderId)};`));
  const bounceReturn=await rpc(`settle_admin_sales_return_v1(${q(bounceSale.orderId)},${q(key())},${j([{return_scope:'base_unit',order_item_id:bounceItem,quantity:30,stock_disposition:'restock'}])},
    ${j([{root_source_kind:'base_order_item',root_source_id:bounceItem,source_kind:'base_order_item',source_id:bounceItem,product_id:id(101),quantity:30,sellable_restock_quantity:30,defect_non_sellable_quantity:0,customer_damage_quantity:0}])},'مرتجع قبل رجوع الشيك','cash',NULL,NULL)`);
  assert.equal(bounceReturn.moneyRefundInMinorUnits,30000);
  const bounceBefore=await fingerprint();
  await rpc(`return_deferred_cheque_v1(${q(bounced.cheque.id)},1,'شيك راجع من البنك',${q(key())})`,manager);
  assert.equal(await balance(id(405)),100000);assert.equal(await fingerprint(),bounceBefore);
  assert.equal((await rpc(`get_customer_statement(${q(id(405))},1,100)`)).has_returned_cheque,true);
  record('bank bounce after settled30 Return creates independent100 claim; no original reversal');

  stage='unified collection of customer compensation';
  const collection=await rpc(`collect_customer_balance_v1(${q(id(405))},30000,'cash',${q(branch)},NULL,'تحصيل قيد شيك',${q(key())})`);
  assert.equal(collection.compensationAmountInMinorUnits,30000);assert.equal(await balance(id(405)),70000);
  assert.equal((await rpc(`get_customer_statement(${q(id(405))},1,100)`)).closing_balance_in_minor_units,70000);
  record('existing163 collector pays compensation, same138 ending balance',{remaining:70000});

  stage='outgoing and supplier cancellation';
  const initialSupplier=await supplierBalance(supplier);assert.deepEqual(initialSupplier,{stored:400000,evidence:400000});
  const issueKey=key(),issueCall=`issue_supplier_cheque_v1(${q(supplier)},${q(branch)},'بنك الاختبار','OUT-001',CURRENT_DATE+2,100000,NULL,${q(issueKey)})`;
  await refused(issueCall,/صلاحية|صلاحيات|غير مصرح|ليس لديك|مالك/u,admin);
  const issued=await rpc(issueCall,manager);assert.deepEqual(await supplierBalance(supplier),{stored:300000,evidence:300000});
  const originalSupplier=await fingerprint();
  await rpc(`cancel_deferred_cheque_v1(${q(issued.cheque.id)},1,'خطأ تسجيل شيك المورد',${q(key())})`);
  assert.deepEqual(await supplierBalance(supplier),{stored:400000,evidence:400000});assert.equal(await fingerprint(),originalSupplier);
  record('outgoing supplier cancellation compensates133 without original payment mutation');

  stage='standalone supplier compensation payment';
  const claim=JSON.parse(await sql(`SELECT to_jsonb(id) FROM public.cheque_compensation_claims WHERE cheque_id=${q(issued.cheque.id)};`));
  const paid=await rpc(`pay_supplier_cheque_claim_v1(${q(claim)},${q(branch)},20000,'cash',NULL,'سداد مستقل',${q(key())})`);
  assert.ok(paid.paymentId);assert.deepEqual(await supplierBalance(supplier),{stored:380000,evidence:380000});
  assert.equal(await sql(`SELECT purchase_order_id IS NULL FROM public.supplier_payments WHERE id=${q(paid.paymentId)};`),'t');
  record('supplier claim pays standalone, not original PO',{paid:20000});

  stage='endorsement and atomic dual compensation';
  await sale(id(406));const endorsed=await receive(id(406),100000),beforeEndorse=await supplierBalance(supplier);
  const e=await rpc(`endorse_customer_cheque_v1(${q(endorsed.cheque.id)},${q(supplier)},1,${q(key())})`,manager);
  assert.equal(e.cheque.status,'endorsed');assert.equal(await balance(id(406)),0);
  assert.deepEqual(await supplierBalance(supplier),{stored:beforeEndorse.stored-100000,evidence:beforeEndorse.evidence-100000});
  const originalBoth=await fingerprint();
  const atomicSnapshot=await sql(`SELECT jsonb_build_object('cheque',to_jsonb(q),'supplier',s.current_balance_in_minor_units,'claims',
    (SELECT COUNT(*) FROM public.cheque_compensation_claims),'events',(SELECT COUNT(*) FROM public.deferred_cheque_events))
    FROM public.deferred_cheques q CROSS JOIN public.suppliers s WHERE q.id=${q(endorsed.cheque.id)} AND s.id=${q(supplier)};`);
  await sql(`ALTER TABLE public.cheque_compensation_claims ADD CONSTRAINT runtime_injected_supplier_failure CHECK(party_kind<>'supplier') NOT VALID;`);
  await refused(`return_deferred_cheque_v1(${q(endorsed.cheque.id)},2,'اختبار ذرية التعويضين',${q(key())})`,/runtime_injected_supplier_failure/u,manager);
  assert.equal(await sql(`SELECT jsonb_build_object('cheque',to_jsonb(q),'supplier',s.current_balance_in_minor_units,'claims',
    (SELECT COUNT(*) FROM public.cheque_compensation_claims),'events',(SELECT COUNT(*) FROM public.deferred_cheque_events))
    FROM public.deferred_cheques q CROSS JOIN public.suppliers s WHERE q.id=${q(endorsed.cheque.id)} AND s.id=${q(supplier)};`),atomicSnapshot);
  await sql(`ALTER TABLE public.cheque_compensation_claims DROP CONSTRAINT runtime_injected_supplier_failure;`);
  const r=await rpc(`return_deferred_cheque_v1(${q(endorsed.cheque.id)},2,'رجع شيك مجيّر للمورد',${q(key())})`,manager);
  assert.equal(r.claims.filter(c=>c.party_kind==='customer').reduce((a,c)=>a+c.amount_in_minor_units,0),100000);
  assert.equal(r.claims.filter(c=>c.party_kind==='supplier').reduce((a,c)=>a+c.amount_in_minor_units,0),100000);
  assert.equal(await balance(id(406)),100000);assert.deepEqual(await supplierBalance(supplier),beforeEndorse);assert.equal(await fingerprint(),originalBoth);
  record('endorsed bounce compensates customer+supplier atomically; injected second-party failure rolls back both; originals unchanged');

  stage='limits duplicates roles no drawer on clear';
  await refused(`receive_customer_cheque_v1(${q(id(407))},${q(branch)},'بنك','NO-DEBT',CURRENT_DATE+2,1,NULL,${q(key())})`,/EXCEEDS_BALANCE/u);
  await sale(id(407));await refused(`receive_customer_cheque_v1(${q(id(407))},${q(branch)},'بنك','OVER',CURRENT_DATE+2,100001,NULL,${q(key())})`,/EXCEEDS_BALANCE/u);
  const ck=key(),c=await receive(id(407),50000,ck,sales,'UNIQUE-001');
  await refused(`receive_customer_cheque_v1(${q(id(407))},${q(branch)},'بنك الاختبار','UNIQUE-001',CURRENT_DATE+2,1,NULL,${q(key())})`,/duplicate key/u);
  await refused(`receive_customer_cheque_v1(${q(id(407))},${q(branch)},'بنك','DENIED',CURRENT_DATE+2,1,NULL,${q(key())})`,/صلاحية|صلاحيات|غير مصرح|ليس لديك|دور/u,noRole);
  const beforeClear=await fingerprint();await rpc(`clear_deferred_cheque_v1(${q(c.cheque.id)},1,${q(key())})`,manager);assert.equal(await fingerprint(),beforeClear);
  const replayAfterClear=await receive(id(407),50000,ck,sales,'UNIQUE-001');assert.equal(replayAfterClear.cheque.status,'pending');assert.equal(replayAfterClear.idempotentReplay,true);
  record('zero-debt/overpay/duplicate/role refusal; clearing no cash and replay returns original snapshot');

  stage='original proven age and unknown age; CRM/statement/aging exact phase42';
  const datedSale=await sale(id(408));
  await sql(`INSERT INTO order_status_history(order_id,new_status,created_at) VALUES(${q(datedSale.orderId)},'completed',
    (((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Amman')::DATE-90)+TIME '12:00') AT TIME ZONE 'Asia/Amman');`);
  const dated=await receive(id(408),100000);
  await rpc(`return_deferred_cheque_v1(${q(dated.cheque.id)},1,'رفض البنك للشيك المؤرخ',${q(key())})`);
  const datedAge=await rpc(`get_customer_debt_aging(${q(id(408))})`);
  assert.equal(datedAge.days_over_30_in_minor_units,100000);
  assert.equal(await sql(`SELECT bool_and(c.original_debt_at IS NOT DISTINCT FROM a.original_debt_at) FROM public.cheque_compensation_claims c JOIN public.deferred_cheque_allocations a ON a.id=c.source_allocation_id;`),'t');
  const crm=await rpc(`get_crm_customer_page(1,100,NULL,'overdue','latest')`);
  assert.ok(crm.customers.some(c=>c.id===id(408)),'dated compensation must be present in137 overdue filter');
  for(const c of [customer,id(404),id(405),id(406),id(407),id(408)]) {
    const canonical=await balance(c),age=await rpc(`get_customer_debt_aging(${q(c)})`),st=await rpc(`get_customer_statement(${q(c)},1,100)`);
    assert.equal(age.total_in_minor_units,canonical);assert.equal(st.closing_balance_in_minor_units,canonical);
    assert.equal(age.days_0_7_in_minor_units+age.days_8_30_in_minor_units+age.days_over_30_in_minor_units+age.age_unavailable_in_minor_units,canonical);
  }
  record('original90-day debt restored to over30;136/137/138 exact phase42 for every fixture customer');

  stage='unknown original date remains unknown, never overdue';
  await sql(`INSERT INTO orders(id,order_number,customer_id,status,source,payment_method,total_in_minor_units,amount_paid_in_minor_units,branch_id,warehouse_id)
    VALUES(${q(id(991))},'CHEQUE-UNDATED',${q(id(409))},'completed','website','debt',100000,0,${q(branch)},${q(id(201))});`);
  const undated=await receive(id(409),100000);
  await rpc(`cancel_deferred_cheque_v1(${q(undated.cheque.id)},1,'إلغاء أصل غير مؤرخ',${q(key())})`);
  const unknownAge=await rpc(`get_customer_debt_aging(${q(id(409))})`);
  assert.equal(unknownAge.age_unavailable_in_minor_units,100000);assert.equal(unknownAge.days_over_30_in_minor_units,0);
  assert.equal((await rpc(`get_customer_statement(${q(id(409))},1,100)`)).closing_balance_in_minor_units,100000);
  record('unknown original date stays age-unavailable and is not overdue');

  stage='two concurrent state changes cannot double compensation';
  await sale(id(410));const competing=await receive(id(410),100000);
  const attempts=await Promise.allSettled([
    rpc(`return_deferred_cheque_v1(${q(competing.cheque.id)},1,'رجوع متزامن للفحص',${q(key())})`),
    rpc(`cancel_deferred_cheque_v1(${q(competing.cheque.id)},1,'إلغاء متزامن للفحص',${q(key())})`),
  ]);
  assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
  const rejected=attempts.find(r=>r.status==='rejected');assert.ok(rejected&&rejected.status==='rejected');
  assert.match(String(rejected.reason),/CHEQUE_INVALID_TRANSITION/u);
  assert.equal(await balance(id(410)),100000);
  assert.equal(Number(await sql(`SELECT SUM(amount_in_minor_units) FROM cheque_compensation_claims WHERE cheque_id=${q(competing.cheque.id)};`)),100000);
  record('two concurrent return/cancel requests:exactly one wins and one100 claim');

  stage='private evidence ACL; real role checks';
  const tableAcl=JSON.parse(await sql(`SELECT jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,
    'anon',has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
    'authenticated',has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')))
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN
      ('deferred_cheques','cheque_party_keys','deferred_cheque_events','deferred_cheque_allocations','cheque_compensation_claims','customer_collection_cheque_allocations','supplier_cheque_claim_payments','supplier_cheque_claim_reversals');`));
  assert.equal(tableAcl.length,8);for(const t of tableAcl)assert.deepEqual(t,{name:t.name,rls:true,anon:false,authenticated:false});
  await refused(`get_deferred_cheques_page()`,/صلاحية|صلاحيات|غير مصرح|ليس لديك/u,cashier);
  await refused(`get_deferred_cheque_detail(${q(dated.cheque.id)})`,/صلاحية|صلاحيات|غير مصرح|ليس لديك/u,admin);
  const anon=await executeInput(executor,'BEGIN;SET LOCAL ROLE anon;SELECT public.get_deferred_cheques_page();ROLLBACK;');
  assert.notEqual(anon.code,0);assert.match(anon.stderr,/permission denied/u);
  await refused(`record_customer_order_payment_once(${q(datedSale.orderId)},1,'cheque',NULL,NULL,${q(key())})`,/CHEQUE_REQUIRES_UNIFIED_COLLECTION/u);
  record('8 tables RPC-only+RLS;anon denied EXECUTE;cashier/admin denied cheque page;unregistered cheque voucher refused');

  stage='outbox due reminders and returned vs cancelled';
  await sale(id(411));
  // Fixture, scan and oracle share ONE database transaction clock, including
  // across Amman midnight; no random offset or time-dependent expectation.
  const alerts=JSON.parse((await sql(auth(owner,`SELECT public.receive_customer_cheque_v1(${q(id(411))},${q(branch)},'بنك التذكير','IN-DUE',
    ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Amman')::DATE+2),50000,NULL,${q(key())});
    SELECT public.issue_supplier_cheque_v1(${q(supplier)},${q(branch)},'بنك التذكير','OUT-DUE',
    ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Amman')::DATE+2),1000,NULL,${q(key())});
    RESET ROLE;
    SELECT public.scan_core_business_alerts(CURRENT_TIMESTAMP,100);SELECT public.scan_core_business_alerts(CURRENT_TIMESTAMP,100);
    SELECT jsonb_build_object('returned',(SELECT COUNT(*) FROM automation_events WHERE event_type='cheque_returned'),
    'expectedReturned',(SELECT COUNT(*) FROM deferred_cheques WHERE status='returned'),
    'due',(SELECT COUNT(*) FROM automation_events WHERE event_type='cheque_due'),
    'expectedDue',(SELECT COUNT(*) FROM deferred_cheques WHERE status='pending' AND due_date=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Amman')::DATE+2),
    'wrongCancel',(SELECT COUNT(*) FROM automation_events a JOIN deferred_cheques c ON c.id=a.entity_id WHERE c.status='cancelled' AND a.event_type='cheque_returned'),
    'wrongEndorsedDue',(SELECT COUNT(*) FROM automation_events a JOIN deferred_cheques c ON c.id=a.entity_id WHERE c.endorsed_supplier_id IS NOT NULL AND a.event_type='cheque_due'));`))).split('\n').at(-1));
  assert.equal(alerts.returned,alerts.expectedReturned);assert.equal(alerts.due,2);assert.equal(alerts.due,alerts.expectedDue);assert.equal(alerts.wrongCancel,0);assert.equal(alerts.wrongEndorsedDue,0);
  record('existing outbox deduplicates due reminders;cancelled never bounced alert;endorsed not deposit reminder',alerts);

  stage='approved party deletion guards and inactive visibility';
  await verifyChequePartyDeletion({sql,rpc,refused,sale,receive,balance,supplierBalance,q,j,key,id,branch,supplier,record});

  stage='drawer, snapshots, monitor and no-double-count';
  const shift=JSON.parse(await sql(`SELECT to_jsonb(id) FROM cash_shifts WHERE branch_id=${q(branch)} AND status='open';`));
  const shiftSummary=await rpc(`get_cash_shift_summary(${q(shift)})`);
  // Opening100, two settled cash refunds30 each, compensation receipt30,
  // standalone supplier compensation payment20. All cheques themselves zero.
  assert.equal(shiftSummary.expectedCashInMinorUnits,50000);
  assert.equal(shiftSummary.chequeCompensationSettlements.cashReceiptsInMinorUnits,30000);
  assert.equal(shiftSummary.chequeCompensationSettlements.cashSupplierPaymentsInMinorUnits,20000);
  assert.equal(shiftSummary.openingDebtCashReceiptsInMinorUnits,0);
  assert.equal(shiftSummary.openingSupplierCashPaymentsInMinorUnits,0);
  const live=await rpc(`get_cash_shift_closing_report(${q(shift)})`);
  await rpc(`close_cash_shift(${q(shift)},50000,NULL)`);
  const closed=await rpc(`get_cash_shift_closing_report(${q(shift)})`);
  assert.deepEqual(closed.chequeCompensationSettlements,live.chequeCompensationSettlements);
  assert.equal((await rpc(`get_cash_shift_summary(${q(shift)})`)).expectedCashInMinorUnits,50000);
  assert.equal(await sql('SELECT COUNT(*) FROM public.cheque_integrity_issues_internal();'),'0');
  await sql('SELECT public.run_advanced_monitoring_checks(CURRENT_TIMESTAMP);');
  const monitoring=JSON.parse(await sql(`SELECT jsonb_object_agg(check_key,status) FROM advanced_monitoring_checks WHERE check_key IN('integrity:accounting:deferred-cheques','integrity:shifts:closing');`));
  assert.deepEqual(monitoring,{'integrity:accounting:deferred-cheques':'healthy','integrity:shifts:closing':'healthy'});
  const injected=JSON.parse(await sql(`BEGIN;ALTER TABLE public.deferred_cheques DISABLE TRIGGER USER;
    UPDATE public.deferred_cheques SET version=version+1 WHERE id=${q(dated.cheque.id)};
    SELECT public.run_advanced_monitoring_checks(CURRENT_TIMESTAMP);
    SELECT to_jsonb(status) FROM advanced_monitoring_checks WHERE check_key='integrity:accounting:deferred-cheques';ROLLBACK;`).then(s=>s.split('\n').at(-1)));
  assert.equal(injected,'critical');
  record('drawer manual50.000,open/closed same,new monitor healthy and injected mismatch critical',{expected:50000});
  stage='supplier check/cheque registered lifecycle only';
  await verifySupplierChequeRegistration({sql,rpc,refused,supplierBalance,q,j,key,id,branch,owner,manager,admin,record});
  stage='compensation cash reversals';
  await verifyChequeShiftReversals({executor,sql,rpc,refused,key,q,j,id,branch,balance,supplierBalance,supplier,claim,manager,record});
  stage='full logical restore and replay';
  const restored=await rehearseChequesRestore({container:'supabase_db_'+project,output,
    replaySql:auth(owner,`SELECT public.${cancelCall};`),expectedId:received.cheque.id});
  record('full logical restore:all public rows+sequences+catalog;cancel replay zero writes',restored);
  report.ok=true;
} catch(error) {report.ok=false;report.stage=stage;report.error=error.message;process.exitCode=1;}
finally {
  if(local) await exec(process.execPath,[path.join(root,'node_modules/supabase/dist/supabase.js'),'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true,maxBuffer:1024**2});
  report.endedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}
