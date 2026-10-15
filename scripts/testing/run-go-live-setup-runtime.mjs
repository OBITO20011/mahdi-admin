import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {promisify} from 'node:util';
import path from 'node:path';
import {assertPackageDDbLint} from './package-d-db-lint-policy.mjs';

// Go-live setup (160-162) on an isolated DB built from every migration:
// permissions, idempotency, atomic batches, reversal, the one-way DB lock,
// receivable parity (aging=phase42=statement), unchanged sales/profit/shift,
// opening stock packages/loose units/flavors and exact WAC after receiving,
// and supplier stored balance = 133 evidence. No Production or live service.
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..');
const projectId='nawasrah-golive-setup-test',container='supabase_db_'+projectId;
const cli=path.join(root,'node_modules/supabase/dist/supabase.js');
const id=n=>'92600000-0000-4000-8000-'+String(n).padStart(12,'0');
const owner=id(1),admin=id(5),stranger=id(6),customer=id(401),customer2=id(402),branch=id(200),warehouse=id(201);
const q=v=>"'"+String(v).replaceAll("'","''")+"'",j=v=>q(JSON.stringify(v))+'::jsonb';
let workdir,stage='bootstrap001-max',shift,newSupplierEntry;
const sql=text=>new Promise((resolve,reject)=>{
  const child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-q','-At','-v','ON_ERROR_STOP=1'],
    {cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let out='',err='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);
  child.on('error',reject);child.on('close',code=>code===0?resolve(out.trim()):reject(Error(`${stage}:SQL${code}: ${err.slice(-4000)}`)));
  child.stdin.end(`SET statement_timeout='60s';SET lock_timeout='30s';\n${text}`);
});
const json=async text=>JSON.parse(await sql(text));
const auth=(text,{actor=owner,role='authenticated',write=false}={})=>`BEGIN${write?'':' READ ONLY'};
  DO $$BEGIN PERFORM set_config('request.jwt.claims',${q(JSON.stringify({sub:actor,role,aal:'aal2'}))},true);END$$;
  SET LOCAL ROLE ${role};${text}${write?'COMMIT':'ROLLBACK'};`;
const rpc=(command,options)=>json(auth(`SELECT to_jsonb(public.${command});`,options));
const write=(command,options={})=>rpc(command,{...options,write:true});
const scalar=text=>json(`SELECT to_jsonb((${text}));`);
const denied=/permission denied|ليس لديك صلاحية|يجب تسجيل الدخول/u;
const finished=/GO_LIVE_SETUP_FINISHED/u;
const today=new Date(Date.now()+3*3600e3).toISOString().slice(0,10);
const daysAgo=n=>new Date(Date.now()+3*3600e3-n*86400e3).toISOString().slice(0,10);
const key=label=>('golive-'+label).padEnd(24,'0');
const balance=c=>scalar(`public.phase42_customer_receivable_total_internal(${q(c)})`);
const aging=c=>rpc(`get_customer_debt_aging(${q(c)})`);
const statement=(c,page=1,size=100)=>rpc(`get_customer_statement(${q(c)},${page},${size})`);
const directory=status=>rpc(`get_crm_customer_page(1,100,NULL,${q(status)},'latest')`)
  .then(r=>r.customers.map(c=>c.id).sort());
const fingerprint=tables=>json(`SELECT jsonb_build_object(${tables.map(t=>`${q(t)},
  (SELECT md5(COALESCE(string_agg(to_jsonb(r)::text,'|' ORDER BY to_jsonb(r)::text),'')) FROM public.${t} r)`).join(',')});`);
const salesTables=['orders','order_items','customer_payments','cash_shifts','sales_return_events','pos_sale_reversals',
  'business_operations','inventory_balances','inventory_movements','supplier_payments','supplier_receipts','operational_expenses'];

async function assertParity(customers){
  for(const c of customers){
    const canonical=await balance(c),age=await aging(c),st=await statement(c);
    assert.equal(age.total_in_minor_units,canonical,'aging total = phase42 '+c);
    assert.equal(age.days_0_7_in_minor_units+age.days_8_30_in_minor_units+age.days_over_30_in_minor_units
      +age.age_unavailable_in_minor_units,canonical,'aging buckets = phase42 '+c);
    assert.equal(st.closing_balance_in_minor_units,canonical,'statement closing = phase42 '+c);
    let running=0;for(const m of [...st.movements].reverse()){running+=m.debit_in_minor_units-m.credit_in_minor_units;
      assert.equal(m.balance_in_minor_units,running);}
  }
}

try{
  const {stdout}=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{
    cwd:root,windowsHide:true,timeout:900000,maxBuffer:8*1024*1024,env:{...process.env,
      NAWASRAH_ISOLATED_PROJECT_ID:projectId,NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
      NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
  const boot=JSON.parse(stdout);assert.equal(boot.ok,true);workdir=boot.isolatedProjectRoot;
  assert.equal(await sql(`SELECT max(version) FROM supabase_migrations.schema_migrations;`)>='164',true);

  stage='fixture';
  await sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
  await sql(`INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
    VALUES(${q(admin)},'authenticated','authenticated','golive-admin@example.test',NOW(),'{}','{}');
    INSERT INTO profiles(id,full_name,is_active) VALUES(${q(admin)},'مدير الاختبار',true);
    INSERT INTO user_roles(user_id,role_id) SELECT ${q(admin)},id FROM roles WHERE code='admin';
    INSERT INTO units(id,code,name_ar) VALUES(${q(id(12))},'E-CARTON-U','كرتونة اختبار');
    -- Real flavors (070/071) start with NULL exact WAC; the fixture pins 0. Mirror creation,
    -- with a real cost. Children inherit the 5-packet pack from the fixture master.
    UPDATE products SET cost_price_in_minor_units=200,wac_cost_in_minor_units_exact=NULL WHERE id IN(${q(id(100))},${q(id(101))},${q(id(102))});`);
  await write(`open_cash_shift(${q(branch)},1000000)`);

  stage='ACL and stored function metadata';
  const publicFns=['import_go_live_products_v1(text,jsonb,boolean)','finish_go_live_setup_v1(text)',
    'get_go_live_setup_status_v1()','record_customer_opening_balances_v1(text,jsonb,boolean,boolean)',
    'reverse_customer_opening_balance_v1(uuid,text)','get_go_live_customer_openings_v1(integer,integer)',
    'record_supplier_opening_balances_v1(text,jsonb,boolean,boolean)','reverse_supplier_opening_balance_v1(uuid,text)',
    'get_go_live_supplier_openings_v1(integer,integer)','set_go_live_main_branch_v1(uuid)',
    'preview_customer_collection_v1(uuid,bigint)','collect_customer_balance_v1(uuid,bigint,text,uuid,text,text,text)',
    'reverse_customer_collection_v1(uuid,text)','get_customer_collections_v1(uuid)','get_supplier_opening_payable_v1(uuid)',
    'pay_supplier_opening_balance_v1(uuid,uuid,bigint,text,text,text,text)','get_cash_shift_summary(uuid)',
    'cancel_empty_cash_shift(uuid,text)','reverse_cash_shift_with_operations(uuid,text,text)'];
  const internalFns=['go_live_assert_setup_open_internal()','go_live_begin_batch_internal(text,text,jsonb)',
    'go_live_setup_counts_internal()','go_live_resolve_unit_internal(text)','phase42_customer_receivable_total_internal(uuid)',
    'phase133_supplier_balance_evidence_internal()','go_live_reject_opening_write_after_finish()',
    'go_live_seed_exact_wac_from_opening()','go_live_guard_customer_opening_balance()',
    'go_live_guard_supplier_opening_balance()','go_live_guard_setup_state()','go_live_reject_truncate()',
    'go_live_reject_batch_mutation()','go_live_main_branch_internal()','go_live_normalize_name_internal(text)',
    'go_live_customer_opening_positions_internal(uuid)','go_live_plan_customer_collection_internal(uuid,bigint)',
    'go_live_collection_result_internal(uuid)','go_live_guard_collection_payment_reversal()',
    'go_live_guard_collection_operation()','go_live_reject_collection_mutation()',
    'go_live_supplier_opening_payable_internal(uuid)',
    'phase6_financial_facts_internal(uuid,timestamp with time zone,timestamp with time zone,text,boolean)'];
  for(const fn of [...publicFns,...internalFns]){
    const meta=await json(`SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'config',proconfig,
      'anon',has_function_privilege('anon',oid,'EXECUTE'),'auth',has_function_privilege('authenticated',oid,'EXECUTE'),
      'public',has_function_privilege('public',oid,'EXECUTE'))
      FROM pg_proc WHERE oid='public.${fn}'::regprocedure;`);
    assert.equal(meta.owner,'postgres',fn);assert.equal(meta.definer,true,fn);
    assert.equal(meta.config.some(v=>/^search_path=public, ?pg_temp$/u.test(v)),true,fn);
    assert.equal(meta.anon,false,fn);
    assert.equal(meta.auth,publicFns.includes(fn),fn);
  }
  for(const table of ['go_live_setup_state','go_live_import_batches','customer_opening_balances','supplier_opening_balances',
    'customer_collection_operations','customer_collection_opening_allocations','customer_collection_order_payments',
    'supplier_opening_payments'])
    assert.deepEqual(await json(`SELECT jsonb_build_array(has_table_privilege('anon','public.${table}','SELECT'),
      has_table_privilege('authenticated','public.${table}','SELECT'),has_table_privilege('authenticated','public.${table}','INSERT'))`),
      [false,false,false],table);

  stage='role boundaries: owner only';
  const calls=[`get_go_live_setup_status_v1()`,`get_go_live_customer_openings_v1(1,25)`,`get_go_live_supplier_openings_v1(1,25)`,
    `import_go_live_products_v1(${q(key('deny-p'))},${j([{sku:'X'}])},true)`,
    `record_customer_opening_balances_v1(${q(key('deny-c'))},${j([{customer_id:customer,amount_in_minor_units:1,original_debt_date:today}])})`,
    `record_supplier_opening_balances_v1(${q(key('deny-s'))},${j([{supplier_id:id(301),direction:'payable',amount_in_minor_units:1,original_balance_date:today}])})`,
    `finish_go_live_setup_v1('إنهاء بداية التشغيل')`,`reverse_customer_opening_balance_v1(${q(id(999))},'سبب كافٍ للعكس')`,
    `reverse_supplier_opening_balance_v1(${q(id(999))},'سبب كافٍ للعكس')`,`set_go_live_main_branch_v1(${q(branch)})`];
  for(const call of calls){
    await assert.rejects(()=>write(call,{role:'anon'}),denied,call);
    await assert.rejects(()=>write(call,{actor:stranger}),denied,call);
    await assert.rejects(()=>write(call,{actor:admin}),denied,call);
  }
  // Collection paths keep the existing customer-payment roles: no anon/role-less caller.
  for(const call of [`preview_customer_collection_v1(${q(customer)},1)`,
    `collect_customer_balance_v1(${q(customer)},1,'cash',${q(branch)},NULL,NULL,${q(key('deny-col'))})`,
    `reverse_customer_collection_v1(${q(id(999))},'سبب كافٍ للعكس')`,
    `pay_supplier_opening_balance_v1(${q(id(301))},${q(branch)},1,'cash',NULL,NULL,${q(key('deny-spay'))})`]){
    await assert.rejects(()=>write(call,{role:'anon'}),denied,call);
    await assert.rejects(()=>write(call,{actor:stranger}),denied,call);
  }
  const initial=await rpc('get_go_live_setup_status_v1()');
  assert.equal(initial.finished,false);assert.equal(initial.customers.activeTotalInMinorUnits,0);

  stage='products import: dry run, atomic rejection, idempotent save';
  const product=(sku,extra={})=>({sku,barcode:'62'+sku.replace(/\D/gu,'').padStart(11,'0'),name_ar:'منتج '+sku,
    category_name:'اختبار اليوم',base_unit_name:'pkt',purchase_unit_name:'كرتونة اختبار',units_per_purchase_unit:'24',
    sale_unit_name:'كرتونة اختبار',units_per_sale_unit:'24',sale_package_price_in_minor_units:'2400',
    purchase_package_price_in_minor_units:'1200',cost_per_base_unit_in_minor_units:'50',min_stock_level:'2',...extra});
  const goodProducts=[product('GL-1001'),product('GL-1002',{cost_per_base_unit_in_minor_units:'80'})];
  const badProducts=[...goodProducts,product('GL-1003',{category_name:'قسم غير موجود'}),product('GL-1001'),
    product('GL-1004',{sale_package_price_in_minor_units:'0'}),product('E-CARTON',{barcode:''})];
  const dry=await write(`import_go_live_products_v1(${q(key('products-dry'))},${j(badProducts)},true)`);
  assert.equal(dry.dryRun,true);assert.equal(dry.rowCount,6);
  assert.deepEqual(dry.errors.map(e=>e.row),[1,3,4,5,6],JSON.stringify(dry.errors));
  assert.match(dry.errors.find(e=>e.row===3).message,/القسم غير موجود/u);
  assert.match(dry.errors.find(e=>e.row===4).message,/مكرر داخل الملف/u);
  assert.match(dry.errors.find(e=>e.row===5).message,/سعر بيع الطرد/u);
  assert.match(dry.errors.find(e=>e.row===6).message,/مستخدم لمنتج موجود/u);
  const productCount=()=>scalar(`SELECT COUNT(*) FROM products`);const before=await productCount();
  await assert.rejects(()=>write(`import_go_live_products_v1(${q(key('products-bad'))},${j(badProducts)})`),/GO_LIVE_BATCH_INVALID/u);
  assert.equal(await productCount(),before,'invalid batch writes nothing');
  const saved=await write(`import_go_live_products_v1(${q(key('products-ok'))},${j(goodProducts)})`);
  assert.equal(saved.idempotentReplay,false);assert.equal(saved.created.length,2);
  const replay=await write(`import_go_live_products_v1(${q(key('products-ok'))},${j(goodProducts)})`);
  assert.equal(replay.idempotentReplay,true);assert.deepEqual(replay.created,saved.created);
  assert.equal(await productCount(),before+2,'replay creates nothing');
  await assert.rejects(()=>write(`import_go_live_products_v1(${q(key('products-ok'))},${j([product('GL-1009')])})`),
    /GO_LIVE_BATCH_KEY_CONFLICT/u);
  const p1=saved.created[0].productId,p2=saved.created[1].productId;
  assert.deepEqual(await json(`SELECT jsonb_build_object('units',units_per_purchase_unit,'sale',units_per_sale_unit,
    'cost',cost_price_in_minor_units,'exact',wac_cost_in_minor_units_exact,'stock',(SELECT COUNT(*) FROM inventory_balances b
    WHERE b.product_id=p.id AND b.on_hand_quantity<>0)) FROM products p WHERE id=${q(p1)}`),
    {units:24,sale:24,cost:50,exact:null,stock:0});
  assert.equal(await scalar(`SELECT COUNT(*) FROM audit_logs WHERE action='GO_LIVE_IMPORT_PRODUCTS'`),1);

  stage='opening stock: packages+loose units, flavors, exact WAC, idempotency';
  const setup=await rpc(`get_inventory_opening_setup(${q(warehouse)})`);
  assert.equal(setup.products.some(p=>p.productId===id(100)),false,'flavor master is not stockable');
  const flavor=setup.products.find(p=>p.productId===id(101));assert.ok(flavor);
  const rows=[{productId:p1,packageCount:3,looseUnits:5},{productId:id(101),packageCount:2,looseUnits:0}];
  const opened=await write(`apply_inventory_opening_setup(${q(warehouse)},${j(rows)},'بداية التشغيل - استيراد Excel',${q(key('stock-1'))})`);
  assert.equal(opened.totalActualQuantity,77+10,'3x24+5 and 2x5 flavor packets');
  const again=await write(`apply_inventory_opening_setup(${q(warehouse)},${j(rows)},'بداية التشغيل - استيراد Excel',${q(key('stock-1'))})`);
  assert.equal(again.idempotentReplay,true);
  await assert.rejects(()=>write(`apply_inventory_opening_setup(${q(warehouse)},${j([{productId:id(100),packageCount:1,looseUnits:0}])},
    'نكهة أساسية مرفوضة',${q(key('stock-master'))})`),/المنتج الأساسي للنكهات مخصص للتجميع/u);
  await assert.rejects(()=>write(`apply_inventory_opening_setup(${q(warehouse)},${j([{productId:p2,packageCount:0,looseUnits:24}])},
    'حبات أكثر من الطرد',${q(key('stock-loose'))})`),/أقل من محتوى الطرد/u);
  assert.deepEqual(await json(`SELECT jsonb_object_agg(product_id,jsonb_build_array(on_hand_quantity,
    (SELECT wac_cost_in_minor_units_exact FROM products p WHERE p.id=b.product_id)))
    FROM inventory_balances b WHERE warehouse_id=${q(warehouse)} AND product_id IN(${q(p1)},${q(id(101))})`),
    {[p1]:[77,50],[id(101)]:[10,200]});
  const receive=(productId,quantity,gross,label)=>write(`create_direct_supplier_receipt_v2(p_supplier_id:=${q(id(301))},
    p_branch_id:=${q(branch)},p_warehouse_id:=${q(warehouse)},p_idempotency_key:=${q(key(label))},p_payment_method:='deferred',
    p_lines:=${j([{client_line_id:id(900+quantity),line_kind:'base_unit',commercial_quantity:quantity,base_unit_name:'باكيت',
      gross_amount_in_minor_units:gross,line_discount_in_minor_units:0,components:[{product_id:productId,base_quantity:quantity}]}])})`);
  assert.equal((await receive(p1,48,4800,'recv-p1')).success,true);
  assert.equal((await receive(id(101),10,3000,'recv-flavor')).success,true);
  // (77*50+4800)/125=69.2 and (10*200+3000)/20=250: opening units carry their opening cost.
  assert.deepEqual(await json(`SELECT jsonb_object_agg(id,jsonb_build_array(wac_cost_in_minor_units_exact::TEXT,cost_price_in_minor_units))
    FROM products WHERE id IN(${q(p1)},${q(id(101))})`),{[p1]:['69.200000',69],[id(101)]:['250.000000',250]});

  stage='customer opening debts: validation, atomicity, idempotency';
  const sale=await write(`create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(customer)},'عميل الدين','debt',
    ${j([{commercial_line_kind:'base_unit',product_id:p1,base_quantity:30,price_authority:'server_catalog',line_discount_in_minor_units:0}])},
    0,0,${q(key('sale-1'))})`);
  await write(`record_customer_order_payment_once(${q(sale.orderId)},1000,'cash',NULL,'دفعة جزئية',${q(key('pay-1'))})`);
  const saleDebt=sale.totalInMinorUnits-1000;assert.equal(await balance(customer),saleDebt);
  await sql(`UPDATE customers SET credit_limit_in_minor_units=2000 WHERE id=${q(customer2)};`);
  const reportCall=`get_operational_business_report(${q(branch)},${q(daysAgo(30))}::DATE,${q(today)}::DATE)`;
  const reportBefore=await rpc(reportCall),salesBefore=await fingerprint(salesTables);
  const shiftBefore=await json(`SELECT to_jsonb(s) FROM cash_shifts s WHERE status='open'`);
  const openingRows=[
    {customer_phone:'0796600401',amount_in_minor_units:'7000',original_debt_date:daysAgo(400),notes:'دفتر قديم 2024'},
    {customer_id:customer,amount_in_minor_units:'3000',original_debt_date:daysAgo(10)},
    {customer_phone:'079-660-0402',amount_in_minor_units:'2500',original_debt_date:daysAgo(500)}];
  const badOpening=[...openingRows,{customer_phone:'0790000000',amount_in_minor_units:'100',original_debt_date:today},
    {customer_id:customer,amount_in_minor_units:'100',original_debt_date:daysAgo(-2)},
    {customer_id:customer,amount_in_minor_units:'100',original_debt_date:'2025-02-30'},
    {customer_id:customer,amount_in_minor_units:'0',original_debt_date:today},
    {customer_id:customer,amount_in_minor_units:'7000',original_debt_date:daysAgo(400)}];
  const dryOpening=await write(`record_customer_opening_balances_v1(${q(key('cust-dry'))},${j(badOpening)},true)`);
  assert.deepEqual(dryOpening.errors.map(e=>e.row),[4,5,6,7,8]);
  assert.match(dryOpening.errors[0].message,/اسم العميل مطلوب لإضافته/u);
  assert.match(dryOpening.errors[1].message,/المستقبل/u);assert.match(dryOpening.errors[2].message,/غير صحيح/u);
  assert.match(dryOpening.errors[3].message,/أكبر من صفر/u);assert.match(dryOpening.errors[4].message,/سطر مكرر/u);
  assert.equal(dryOpening.validTotalInMinorUnits,12500);assert.equal(dryOpening.customerCount,2);
  await assert.rejects(()=>write(`record_customer_opening_balances_v1(${q(key('cust-bad'))},${j(badOpening)})`),/GO_LIVE_BATCH_INVALID/u);
  assert.equal(await scalar(`SELECT COUNT(*) FROM customer_opening_balances`),0,'invalid batch writes nothing');
  const recorded=await write(`record_customer_opening_balances_v1(${q(key('cust-ok'))},${j(openingRows)})`);
  assert.equal(recorded.totalInMinorUnits,12500);assert.equal(recorded.created.length,3);
  assert.equal((await write(`record_customer_opening_balances_v1(${q(key('cust-ok'))},${j(openingRows)})`)).idempotentReplay,true);
  assert.equal(await scalar(`SELECT COUNT(*) FROM customer_opening_balances`),3,'replay writes nothing');
  await assert.rejects(()=>write(`record_customer_opening_balances_v1(${q(key('cust-ok'))},${j(openingRows.slice(0,1))})`),
    /GO_LIVE_BATCH_KEY_CONFLICT/u);

  stage='decision 7: phone first, exact name, doubtful warnings, confirmed new customers';
  const partyRows=[{customer_phone:'0791234567',customer_name:'زبون جديد',amount_in_minor_units:'1500',original_debt_date:daysAgo(60)},
    {customer_phone:'0799999999',customer_name:'عميل الدين',amount_in_minor_units:'10',original_debt_date:daysAgo(60)},
    {customer_name:'عميل الخصم',amount_in_minor_units:'400',original_debt_date:daysAgo(60)},
    {customer_name:'عميـل  المدفوع',amount_in_minor_units:'10',original_debt_date:daysAgo(60)}];
  const dryParty=await write(`record_customer_opening_balances_v1(${q(key('party-dry'))},${j(partyRows)},true)`);
  assert.deepEqual(dryParty.errors.map(e=>[e.row,e.kind]),[[2,'warning'],[4,'warning']],JSON.stringify(dryParty.errors));
  assert.match(dryParty.errors[0].message,/عميل الدين — 0796600401/u);
  assert.deepEqual(dryParty.newCustomers.map(c=>[c.name,c.phone]),[['زبون جديد','0791234567']]);
  const goodParty=[partyRows[0],partyRows[2]];
  await assert.rejects(()=>write(`record_customer_opening_balances_v1(${q(key('party-ok'))},${j(goodParty)})`),
    /GO_LIVE_NEW_PARTIES_CONFIRMATION_REQUIRED/u);
  assert.equal(await scalar(`SELECT COUNT(*) FROM customers WHERE phone='0791234567'`),0,'no silent creation');
  const party=await write(`record_customer_opening_balances_v1(${q(key('party-ok'))},${j(goodParty)},false,true)`);
  assert.equal(party.createdCustomers.length,1);const newCustomer=party.createdCustomers[0].customerId;
  assert.equal(party.created.find(c=>c.amountInMinorUnits===400).customerId,id(403),'exact name matched');
  assert.equal(await balance(newCustomer),1500);

  stage='opening debt does not touch sales, profit, stock or shift; reports include it (decision 4)';
  const nonCustomerTables=salesTables;
  assert.deepEqual(await fingerprint(nonCustomerTables),salesBefore);
  const reportAfter=await rpc(reportCall);
  for(const section of ['sales','cashFlow','expenses'])assert.deepEqual(reportAfter[section],reportBefore[section],section);
  assert.deepEqual(await json(`SELECT to_jsonb(s) FROM cash_shifts s WHERE status='open'`),shiftBefore);
  const activeBranches=await scalar(`SELECT COUNT(*) FROM branches WHERE is_active`);
  if(activeBranches>1){
    assert.equal(reportAfter.balances.customerDueInMinorUnits,reportBefore.balances.customerDueInMinorUnits,
      'no main branch chosen yet: branch report unchanged');
    await write(`set_go_live_main_branch_v1(${q(branch)})`);
  }
  assert.equal((await rpc('get_go_live_setup_status_v1()')).mainBranchId,branch);
  const dueVsCanonical=async label=>{
    const report=await rpc(reportCall),canonical=await scalar(`SELECT SUM(public.phase42_customer_receivable_total_internal(id)) FROM customers`);
    assert.equal(report.balances.customerDueInMinorUnits,canonical,label+': report customer due = Σ phase42');
    return report;};
  const withOpening=await dueVsCanonical('after opening');
  assert.equal(withOpening.balances.customerDueInMinorUnits,reportBefore.balances.customerDueInMinorUnits+12500+1900);

  stage='receivable parity with original dates (136=121=138, 137 filters)';
  assert.equal(await balance(customer),saleDebt+10000);assert.equal(await balance(customer2),2500);
  await assertParity([customer,customer2,id(403),newCustomer]);
  const age=await aging(customer);
  // FIFO presentation: the 1000 voucher covers the oldest (opening) principal first.
  assert.deepEqual([age.days_over_30_in_minor_units,age.days_8_30_in_minor_units,age.days_0_7_in_minor_units],
    [6000,3000,sale.totalInMinorUnits]);
  assert.equal(age.oldest_debt_age_days,400);
  const st=await statement(customer),oldest=st.movements.at(-1);
  assert.equal(oldest.movement_type,'opening_balance');assert.equal(oldest.type_label,'رصيد سابق قبل النظام');
  assert.equal(oldest.occurred_at_amman,daysAgo(400)+'T00:00:00.000000');assert.equal(oldest.debit_in_minor_units,7000);
  assert.equal(st.movements.filter(m=>m.movement_type==='opening_balance').length,2);
  const global=await rpc('get_customer_debt_aging(NULL)');
  assert.equal(global.total_in_minor_units,await scalar(`SELECT SUM(public.phase42_customer_receivable_total_internal(id)) FROM customers`));
  assert.deepEqual(await directory('has_debt'),[customer,customer2,id(403),newCustomer].sort());
  assert.deepEqual(await directory('overdue'),[customer,customer2,id(403),newCustomer].sort());
  assert.deepEqual(await directory('over_limit'),[customer2]);

  stage='correction only by reversal; immutable rows';
  const small=recorded.created.find(c=>c.amountInMinorUnits===3000);
  await assert.rejects(()=>write(`reverse_customer_opening_balance_v1(${q(small.entryId)},'قصير')`),/سبب العكس/u);
  const reversed=await write(`reverse_customer_opening_balance_v1(${q(small.entryId)},'إدخال مكرر من الدفتر')`);
  assert.equal(reversed.idempotentReplay,false);
  assert.equal((await write(`reverse_customer_opening_balance_v1(${q(small.entryId)},'إدخال مكرر من الدفتر')`)).idempotentReplay,true);
  assert.equal(await balance(customer),saleDebt+7000);await assertParity([customer]);
  const reversalRow=(await statement(customer)).movements.find(m=>m.movement_type==='opening_balance_reversal');
  assert.equal(reversalRow.credit_in_minor_units,3000);assert.equal(reversalRow.type_label,'عكس رصيد سابق');
  await assert.rejects(()=>sql(`UPDATE customer_opening_balances SET amount_in_minor_units=1 WHERE id=${q(recorded.created[0].entryId)}`),
    /GO_LIVE_OPENING_IMMUTABLE/u);
  await assert.rejects(()=>sql(`DELETE FROM customer_opening_balances`),/GO_LIVE_OPENING_IMMUTABLE/u);
  await assert.rejects(()=>sql(`TRUNCATE customer_opening_balances CASCADE`),/GO_LIVE_STATE_IMMUTABLE/u);
  await assert.rejects(()=>sql(`UPDATE customer_opening_balances SET is_reversed=false,reversed_at=NULL,reversed_by=NULL,
    reversal_reason=NULL WHERE id=${q(small.entryId)}`),/GO_LIVE_OPENING_IMMUTABLE/u);
  await assert.rejects(()=>sql(`DELETE FROM go_live_import_batches`),/GO_LIVE_BATCH_IMMUTABLE/u);
  assert.deepEqual(await json(`SELECT jsonb_object_agg(action,n) FROM (SELECT action,COUNT(*) n FROM audit_logs
    WHERE action LIKE 'GO_LIVE_CUSTOMER%' GROUP BY action) a`),
    {GO_LIVE_CUSTOMER_OPENING_BALANCES:2,GO_LIVE_CUSTOMER_OPENING_REVERSED:1});
  const list=await rpc('get_go_live_customer_openings_v1(1,25)');
  assert.equal(list.totalCount,5);assert.equal(list.activeTotalInMinorUnits,11400);

  stage='supplier opening balances both directions = 133 evidence';
  const supplierBalance=s=>scalar(`SELECT current_balance_in_minor_units FROM suppliers WHERE id=${q(s)}`);
  const evidenceMatches=()=>scalar(`SELECT COUNT(*) FROM suppliers s JOIN public.phase133_supplier_balance_evidence_internal() e
    ON e.supplier_id=s.id WHERE s.current_balance_in_minor_units IS DISTINCT FROM e.balance`);
  const received=await supplierBalance(id(301));assert.equal(received,7800);assert.equal(await evidenceMatches(),0);
  const supplierRows=[{supplier_name:'مورد الاستلام المباشر',direction:'payable',amount_in_minor_units:'10000',original_balance_date:daysAgo(90)},
    {supplier_id:id(302),direction:'advance',amount_in_minor_units:'2500',original_balance_date:daysAgo(30),notes:'دفعة مقدمة'}];
  const drySupplier=await write(`record_supplier_opening_balances_v1(${q(key('sup-dry'))},${j([...supplierRows,
    {supplier_name:'مورد غير موجود',direction:'payable',amount_in_minor_units:'5',original_balance_date:today},
    {supplier_id:id(301),direction:'له',amount_in_minor_units:'5',original_balance_date:today},
    {supplier_id:id(301),direction:'advance',amount_in_minor_units:'5',original_balance_date:today}])},true)`);
  assert.deepEqual(drySupplier.errors.map(e=>e.row),[4,5]);
  assert.deepEqual(drySupplier.newSuppliers.map(s=>s.name),['مورد غير موجود'],'unknown supplier is proposed, never created in a dry run');
  assert.equal(drySupplier.payableTotalInMinorUnits,10005);assert.equal(drySupplier.advanceTotalInMinorUnits,2500);
  const savedSuppliers=await write(`record_supplier_opening_balances_v1(${q(key('sup-ok'))},${j(supplierRows)})`);
  assert.equal((await write(`record_supplier_opening_balances_v1(${q(key('sup-ok'))},${j(supplierRows)})`)).idempotentReplay,true);
  assert.equal(await supplierBalance(id(301)),received+10000);assert.equal(await supplierBalance(id(302)),-2500);
  assert.equal(await evidenceMatches(),0,'stored supplier balances equal 133 evidence');
  await write(`record_supplier_payment(${q(id(301))},NULL,3000,'bank_transfer','TRX-1',NOW(),'سداد رصيد سابق بتحويل',${q(key('sup-pay'))})`);
  assert.equal(await supplierBalance(id(301)),received+7000);assert.equal(await evidenceMatches(),0);
  // Decision 2: cash from the chosen branch's open shift, a shift cash outflow.
  shift=await scalar(`SELECT id FROM cash_shifts WHERE branch_id=${q(branch)} AND status='open'`);
  const shiftBeforePay=await rpc(`get_cash_shift_summary(${q(shift)})`);
  await assert.rejects(()=>write(`pay_supplier_opening_balance_v1(${q(id(301))},NULL,2000,'cash',NULL,NULL,${q(key('spay-nobranch'))})`),
    /PHASE2_PAYMENT_BRANCH_REQUIRED/u);
  const paid=await write(`pay_supplier_opening_balance_v1(${q(id(301))},${q(branch)},2000,'cash',NULL,'دفعة من الدرج',${q(key('spay-1'))})`);
  assert.equal(paid.cashShiftId,shift);assert.equal(paid.remainingOpeningPayableInMinorUnits,8000);
  assert.equal((await write(`pay_supplier_opening_balance_v1(${q(id(301))},${q(branch)},2000,'cash',NULL,'دفعة من الدرج',${q(key('spay-1'))})`)).idempotentReplay,true);
  await assert.rejects(()=>write(`pay_supplier_opening_balance_v1(${q(id(301))},${q(branch)},8001,'cash',NULL,NULL,${q(key('spay-big'))})`),
    /GO_LIVE_SUPPLIER_PAYMENT_EXCEEDS_OPENING/u);
  await write(`pay_supplier_opening_balance_v1(${q(id(301))},NULL,1000,'bank_transfer','TRX-2',NULL,${q(key('spay-bank'))})`);
  assert.equal(await supplierBalance(id(301)),received+4000);assert.equal(await evidenceMatches(),0);
  const shiftAfterPay=await rpc(`get_cash_shift_summary(${q(shift)})`);
  assert.equal(shiftAfterPay.cashSupplierPaymentsInMinorUnits-shiftBeforePay.cashSupplierPaymentsInMinorUnits,2000);
  assert.equal(shiftAfterPay.expectedCashInMinorUnits-shiftBeforePay.expectedCashInMinorUnits,-2000);
  assert.equal(shiftAfterPay.openingSupplierCashPaymentsInMinorUnits,2000);
  // Decision 7 for suppliers: doubtful name is a warning; a new supplier needs confirmation.
  const dryNewSupplier=await write(`record_supplier_opening_balances_v1(${q(key('sup-new-dry'))},${j([
    {supplier_name:'مورد جديد',supplier_phone:'0780000001',direction:'payable',amount_in_minor_units:'700',original_balance_date:daysAgo(5)},
    {supplier_name:'مورد  PO',supplier_phone:'0780000009',direction:'payable',amount_in_minor_units:'5',original_balance_date:daysAgo(5)}])},true)`);
  assert.deepEqual(dryNewSupplier.errors.map(e=>[e.row,e.kind]),[[2,'warning']]);
  assert.deepEqual(dryNewSupplier.newSuppliers.map(s=>s.name),['مورد جديد']);
  const newSupplierRows=[{supplier_name:'مورد جديد',supplier_phone:'0780000001',direction:'payable',amount_in_minor_units:'700',original_balance_date:daysAgo(5)}];
  await assert.rejects(()=>write(`record_supplier_opening_balances_v1(${q(key('sup-new'))},${j(newSupplierRows)})`),
    /GO_LIVE_NEW_PARTIES_CONFIRMATION_REQUIRED/u);
  const newSupplierResult=await write(`record_supplier_opening_balances_v1(${q(key('sup-new'))},${j(newSupplierRows)},false,true)`);
  const newSupplier=newSupplierResult.createdSuppliers[0].supplierId;newSupplierEntry=()=>newSupplierResult.created[0].entryId;
  assert.equal(await supplierBalance(newSupplier),700);assert.equal(await evidenceMatches(),0);
  const advance=savedSuppliers.created.find(c=>c.direction==='advance');
  await write(`reverse_supplier_opening_balance_v1(${q(advance.entryId)},'الدفعة المقدمة سُوّيت قبل النظام')`);
  assert.equal(await supplierBalance(id(302)),0);assert.equal(await evidenceMatches(),0);
  const monitoring=await json(`SELECT public.run_advanced_monitoring_checks(NOW())`);
  assert.equal(await scalar(`SELECT status FROM advanced_monitoring_checks WHERE check_key='integrity:accounting:supplier-balances'`),
    'healthy',JSON.stringify(monitoring).slice(0,300));

  stage='unified collection: oldest-first, existing order payments, atomic, idempotent, whole reversal';
  // 401 now: opening 7000 (400 days) + order debt saleDebt; the 3000 entry is reversed.
  const total401=await balance(customer);assert.equal(total401,7000+saleDebt);
  const preview=await rpc(`preview_customer_collection_v1(${q(customer)},8000)`);
  assert.deepEqual(preview.parts.map(p=>[p.kind,p.allocateInMinorUnits]),[['opening',7000],['order',1000]]);
  assert.equal(preview.totalOutstandingInMinorUnits,total401);assert.equal(preview.exceedsBalance,false);
  const shiftBeforeCollect=await rpc(`get_cash_shift_summary(${q(shift)})`),salesBeforeCollect=await rpc(reportCall);
  const opA=await write(`collect_customer_balance_v1(${q(customer)},8000,'cash',${q(branch)},NULL,'تحصيل',${q(key('col-a'))})`,{actor:admin});
  assert.deepEqual([opA.openingAmountInMinorUnits,opA.ordersAmountInMinorUnits],[7000,1000]);
  assert.equal(await balance(customer),total401-8000);await assertParity([customer]);
  const stA=await statement(customer);
  assert.equal(stA.movements.find(m=>m.movement_type==='opening_collection').credit_in_minor_units,7000);
  assert.equal(stA.movements.filter(m=>m.movement_type==='payment').map(m=>m.credit_in_minor_units).sort((a,b)=>a-b).join(),'1000,1000');
  const ageA=await aging(customer);assert.equal(ageA.total_in_minor_units,total401-8000);
  const shiftA=await rpc(`get_cash_shift_summary(${q(shift)})`);
  assert.equal(shiftA.cashReceiptsInMinorUnits-shiftBeforeCollect.cashReceiptsInMinorUnits,8000,'opening + order parts in drawer');
  assert.equal(shiftA.expectedCashInMinorUnits-shiftBeforeCollect.expectedCashInMinorUnits,8000);
  const salesAfterCollect=await rpc(reportCall);
  // A collection is not a sale: only the cohort's collected/outstanding move,
  // exactly as for any ordinary order payment.
  const salesOnly=x=>{const {collectedInMinorUnits:_c,outstandingInMinorUnits:_o,...rest}=x.sales;return rest;};
  assert.deepEqual(salesOnly(salesAfterCollect),salesOnly(salesBeforeCollect),'collection is not a sale');
  assert.equal(salesAfterCollect.sales.collectedInMinorUnits-salesBeforeCollect.sales.collectedInMinorUnits,1000,'only the order part');
  await dueVsCanonical('after collection');
  assert.equal((await write(`collect_customer_balance_v1(${q(customer)},8000,'cash',${q(branch)},NULL,'تحصيل',${q(key('col-a'))})`)).idempotentReplay,true);
  await assert.rejects(()=>write(`collect_customer_balance_v1(${q(customer)},10,'cash',${q(branch)},NULL,NULL,${q(key('col-a'))})`),
    /GO_LIVE_COLLECTION_KEY_CONFLICT/u);
  await assert.rejects(()=>write(`collect_customer_balance_v1(${q(customer)},${total401-8000+1},'cash',${q(branch)},NULL,NULL,${q(key('col-big'))})`),
    /GO_LIVE_COLLECTION_EXCEEDS_BALANCE/u);
  assert.equal(await balance(customer),total401-8000,'refused collection writes nothing');
  const orderPart=opA.parts.find(p=>p.kind==='order');
  await assert.rejects(()=>write(`reverse_customer_order_payment(${q(orderPart.paymentId)},'عكس جزء منفرد')`),/GO_LIVE_COLLECTION_PART_REVERSAL/u);
  const opening7000=recorded.created.find(c=>c.amountInMinorUnits===7000).entryId;
  await assert.rejects(()=>write(`reverse_customer_opening_balance_v1(${q(opening7000)},'عكس دين محصل')`),/GO_LIVE_OPENING_HAS_COLLECTIONS/u);
  await assert.rejects(()=>write(`reverse_customer_collection_v1(${q(opA.operationId)},'خطأ في المبلغ')`,{actor:stranger}),denied);
  const revA=await write(`reverse_customer_collection_v1(${q(opA.operationId)},'خطأ في المبلغ')`,{actor:admin});
  assert.equal(revA.isReversed,true);
  assert.equal((await write(`reverse_customer_collection_v1(${q(opA.operationId)},'خطأ في المبلغ')`)).idempotentReplay,true);
  assert.equal(await balance(customer),total401);await assertParity([customer]);
  const shiftRev=await rpc(`get_cash_shift_summary(${q(shift)})`);
  assert.equal(shiftRev.expectedCashInMinorUnits,shiftBeforeCollect.expectedCashInMinorUnits,'reversal returns the drawer');
  assert.equal((await statement(customer)).movements.find(m=>m.movement_type==='opening_collection_reversal').debit_in_minor_units,7000);
  const opB=await write(`collect_customer_balance_v1(${q(customer)},500,'bank_transfer',NULL,'TRX-9',NULL,${q(key('col-b'))})`);
  assert.equal(opB.openingAmountInMinorUnits,500);
  const opC=await write(`collect_customer_balance_v1(${q(customer)},300,'cash',${q(branch)},NULL,NULL,${q(key('col-c'))})`);
  assert.equal(await balance(customer),total401-800);await assertParity([customer,customer2,id(403),newCustomer]);

  stage='shift close: frozen columns, snapshot and integrity monitors include both opening paths';
  const beforeClose=await rpc(`get_cash_shift_summary(${q(shift)})`);
  await assert.rejects(()=>write(`cancel_empty_cash_shift(${q(shift)},'إلغاء خاطئ للوردية')`),/تحتوي حركة مالية/u);
  await write(`close_cash_shift(${q(shift)},${beforeClose.expectedCashInMinorUnits},NULL)`);
  const closed=await json(`SELECT to_jsonb(s) FROM cash_shifts s WHERE id=${q(shift)}`);
  assert.equal(closed.cash_receipts_in_minor_units,beforeClose.cashReceiptsInMinorUnits);
  assert.equal(closed.cash_supplier_payments_in_minor_units,beforeClose.cashSupplierPaymentsInMinorUnits);
  assert.equal(closed.expected_cash_in_minor_units,beforeClose.expectedCashInMinorUnits);
  assert.ok(closed.closing_report_snapshot,'immutable closing snapshot captured');
  await json(`SELECT public.run_advanced_monitoring_checks(NOW())`);
  assert.deepEqual(await json(`SELECT COALESCE(jsonb_agg(check_key||'='||status ORDER BY check_key),'[]') FROM advanced_monitoring_checks
    WHERE check_key LIKE 'integrity:%' AND status<>'healthy'`),[],'integrity monitors stay healthy');
  await assert.rejects(()=>write(`reverse_customer_collection_v1(${q(opC.operationId)},'بعد إغلاق الوردية')`),/وردية مغلقة/u);
  await assert.rejects(()=>write(`reverse_cash_shift_with_operations(${q(shift)},'عكس الوردية كاملة',${q(key('shift-rev'))})`),
    /GO_LIVE_SHIFT_HAS_UNIFIED_OPERATIONS/u);
  await write(`open_cash_shift(${q(branch)},0)`);
  await dueVsCanonical('after shift close');

  stage='status counters';
  const status=await rpc('get_go_live_setup_status_v1()');
  assert.equal(status.products.importedCount,2);assert.equal(status.stock.countedProductCount,2);
  assert.equal(status.customers.withOpeningCount,4);assert.equal(status.customers.activeTotalInMinorUnits,11400);
  assert.equal(status.suppliers.payableTotalInMinorUnits,10700);assert.equal(status.suppliers.advanceTotalInMinorUnits,0);

  stage='one-way database lock';
  await assert.rejects(()=>write(`finish_go_live_setup_v1('نعم')`),/GO_LIVE_CONFIRMATION_REQUIRED/u);
  const done=await write(`finish_go_live_setup_v1('إنهاء بداية التشغيل')`);assert.equal(done.idempotentReplay,false);
  assert.equal((await write(`finish_go_live_setup_v1('أي نص')`)).idempotentReplay,true);
  assert.equal((await rpc('get_go_live_setup_status_v1()')).finished,true);
  for(const call of [`import_go_live_products_v1(${q(key('late-p'))},${j([product('GL-2001')])})`,
    `import_go_live_products_v1(${q(key('late-pd'))},${j([product('GL-2001')])},true)`,
    `record_customer_opening_balances_v1(${q(key('late-c'))},${j(openingRows.slice(2))})`,
    `record_customer_opening_balances_v1(${q(key('cust-ok'))},${j(openingRows)})`,
    `record_supplier_opening_balances_v1(${q(key('late-s'))},${j(supplierRows.slice(0,1))})`,
    `set_go_live_main_branch_v1(${q(branch)})`,
    `apply_inventory_opening_setup(${q(warehouse)},${j([{productId:p2,packageCount:1,looseUnits:0}])},'مخزون بعد الإنهاء',${q(key('late-stock'))})`])
    await assert.rejects(()=>write(call),finished,call);
  await assert.rejects(()=>write(`apply_inventory_opening_setup(${q(warehouse)},${j([{productId:p2,packageCount:1,looseUnits:0}])},
    'مخزون بعد الإنهاء',${q(key('late-stock-admin'))})`,{actor:admin}),finished);
  // Even a privileged direct write is refused by the table triggers.
  await assert.rejects(()=>sql(`INSERT INTO customer_opening_balances(entry_number,customer_id,amount_in_minor_units,original_debt_date,
    occurred_at,batch_id,created_by) SELECT 'COB-X',${q(customer)},1,CURRENT_DATE,CURRENT_DATE::TIMESTAMP AT TIME ZONE 'Asia/Amman',
    id,${q(owner)} FROM go_live_import_batches LIMIT 1`),finished);
  await assert.rejects(()=>sql(`UPDATE go_live_setup_state SET finished_at=NULL,finished_by=NULL`),finished);
  await assert.rejects(()=>sql(`DELETE FROM go_live_setup_state`),/GO_LIVE_STATE_IMMUTABLE/u);
  // Decision 3: owner reversal with reason stays possible after finish; others may not.
  const entry402=recorded.created.find(c=>c.amountInMinorUnits===2500).entryId;
  await assert.rejects(()=>write(`reverse_customer_opening_balance_v1(${q(entry402)},'تصحيح بعد التشغيل')`,{actor:admin}),denied);
  await write(`reverse_customer_opening_balance_v1(${q(entry402)},'تصحيح بعد التشغيل')`);
  assert.equal(await balance(customer2),0);
  await write(`reverse_supplier_opening_balance_v1(${q(newSupplierEntry())},'مورد أُدخل خطأ')`);
  assert.equal(await evidenceMatches(),0);
  await dueVsCanonical('after post-finish reversal');
  await assertParity([customer,customer2,id(403),newCustomer]);
  assert.equal(await scalar(`SELECT COUNT(*) FROM audit_logs WHERE action='GO_LIVE_SETUP_FINISHED'`),1);
  console.log(JSON.stringify({stage:'focused proofs',passed:true,parity:true,lock:true,wac:['69.2','250'],
    salesUnchanged:true,supplierEvidence:true,unifiedCollection:true,shiftClose:true,reportsMatchPhase42:true}));

  stage='DB lint';const {stdout:lint}=await exec(process.execPath,[cli,'db','lint','--local','--level','warning','--workdir',workdir],
    {cwd:root,windowsHide:true,timeout:120000,maxBuffer:1024*1024});assertPackageDDbLint(lint);
  console.log(JSON.stringify({ok:true,mode:'GO_LIVE_SETUP_RUNTIME',productionAccess:0}));
}catch(error){console.error(JSON.stringify({ok:false,stage,message:error.message,productionAccess:0}));process.exitCode=1;}
finally{if(workdir&&process.env.NAWASRAH_KEEP_STACK!=='true')await exec(process.execPath,[cli,'stop','--no-backup','--workdir',workdir],
  {cwd:root,windowsHide:true,timeout:120000,maxBuffer:1024*1024});}
