import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {promisify} from 'node:util';
import path from 'node:path';
import {fullScale,timingSummary,expectedCounts} from './package-e-scale-contract.mjs';
import {assertPackageDDbLint} from './package-d-db-lint-policy.mjs';

const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..');
const scale=process.argv.includes('--scale'),projectId='nawasrah-customer-statement-test';
const container='supabase_db_'+projectId,cli=path.join(root,'node_modules/supabase/dist/supabase.js');
const id=n=>'92600000-0000-4000-8000-'+String(n).padStart(12,'0');
const sid=(kind,n)=>'929'+String(kind).padStart(5,'0')+'-0000-4000-8000-'+String(n).padStart(12,'0');
const owner=scale?sid(1,1):id(1),customer=id(401),product=id(101),branch=id(200),warehouse=id(201);
const q=v=>"'"+String(v).replaceAll("'","''")+"'",j=v=>q(JSON.stringify(v))+'::jsonb';
let workdir,stage='fresh001-138';
const sql=(text,{variables={},seed=false}={})=>new Promise((resolve,reject)=>{
  const child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-q','-At','-v','ON_ERROR_STOP=1',
    ...Object.entries(variables).flatMap(([k,v])=>['-v',k+'='+v])],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let out='',err='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>{err+=chunk;
    for(const match of chunk.matchAll(/E2_PROGRESS modern_operations=(\d+)/gu))console.log(JSON.stringify({stage,modern:Number(match[1])}));});
  child.on('error',reject);child.on('close',code=>code===0?resolve(out.trim()):reject(Error(`${stage}:SQL${code}: ${err.slice(-5000)}`)));
  child.stdin.end(`SET statement_timeout=${q(seed?'0':'60s')};SET lock_timeout='30s';\n${text}`);
});
const json=async(text,options)=>JSON.parse(await sql(text,options));
const auth=(text,{actor=owner,role='authenticated',write=false}={})=>`BEGIN${write?'':' READ ONLY'};
  DO $$BEGIN PERFORM set_config('request.jwt.claims',${q(JSON.stringify({sub:actor,role,aal:'aal2'}))},true);END$$;
  SET LOCAL ROLE ${role};${text}${write?'COMMIT':'ROLLBACK'};`;
const rpc=(command,options)=>json(auth(`SELECT public.${command};`,options));
const statement=(c=customer,page=1,size=25)=>`get_customer_statement(${q(c)},${page},${size})`;
const fingerprint=()=>json(`SELECT jsonb_build_object(${['orders','customer_payments','sales_return_events','pos_sale_reversals',
  'business_operations','customers','inventory_balances','inventory_movements','audit_logs','order_status_history'].map(t=>`${q(t)},
  (SELECT md5(COALESCE(string_agg(to_jsonb(r)::text,'|' ORDER BY to_jsonb(r)::text),'')) FROM public.${t} r)`).join(',')});`);

function verifyTimeline(result){
  const rows=[...result.movements].reverse();let balance=result.page_opening_balance_in_minor_units;
  for(const row of rows){
    assert.ok(row.debit_in_minor_units>=0&&row.credit_in_minor_units>=0);
    balance+=row.debit_in_minor_units-row.credit_in_minor_units;
    assert.equal(row.balance_in_minor_units,balance);
    assert.equal(row.date_label,row.occurred_at===null?'تاريخ غير متاح':null);
  }
  assert.equal(balance,result.page_closing_balance_in_minor_units);
}
async function measure(c){
  const call=()=>json(auth(`EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) SELECT public.${statement(c)};`)).then(p=>p[0]['Execution Time']);
  for(let n=0;n<3;n++)await call();const values=[];for(let n=0;n<20;n++)values.push(await call());
  const timing={stage:'customer-page performance',...timingSummary(values),limitMs:1000};
  console.log(JSON.stringify(timing));assert.ok(timing.p95<1000,'Statement page p95 must be <1000ms');
}

try{
  const {stdout}=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{
    cwd:root,windowsHide:true,timeout:600000,maxBuffer:8*1024*1024,env:{...process.env,
      NAWASRAH_ISOLATED_PROJECT_ID:projectId,NAWASRAH_MAX_MIGRATION:'138',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
      NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
  const boot=JSON.parse(stdout);assert.equal(boot.ok,true);workdir=boot.isolatedProjectRoot;
  if(scale){
    stage='full two-year fixture';await exec('docker',['update','--cpus','4',container],{windowsHide:true});
    const fixture=await readFile(path.join(root,'scripts/testing/package-e-scale-fixture.sql'),'utf8');
    const [setup,rest]=fixture.split('-- E2_BATCH_BEGIN'),[batch,finish]=rest.split('-- E2_BATCH_END');
    assert.ok(setup&&batch&&finish);const batches=[];
    for(let from=1;from<=fullScale.modern;from+=100)batches.push(auth(
      batch.replaceAll('__E2_FROM__',String(from)).replaceAll('__E2_TO__',String(Math.min(from+99,fullScale.modern))),{write:true}));
    console.log(JSON.stringify({stage,targets:fullScale}));
    await sql(setup+batches.join('\n')+finish,{variables:fullScale,seed:true});
    const counts=expectedCounts(fullScale);
    for(const [table,key,column] of [['orders','orders','customer_id'],['customers','customers','id'],
      ['customer_payments','payments','customer_id'],['inventory_movements','movements','product_id']])
      assert.equal(await json(`SELECT to_jsonb(COUNT(*)) FROM ${table} WHERE ${column}::text LIKE '929%';`),counts[key]);
    stage='all10000 customer closing balances against phase42';
    const ids=await json('SELECT jsonb_agg(id ORDER BY id) FROM customers;');assert.equal(ids.length,10000);
    let matched=0;
    for(let from=0;from<ids.length;from+=100){
      const values=ids.slice(from,from+100).map(c=>`(${q(c)}::UUID)`).join(',');
      const expected=await json(`SELECT jsonb_agg(jsonb_build_object('id',id,'balance',
        public.phase42_customer_receivable_total_internal(id)) ORDER BY id) FROM (VALUES ${values}) c(id);`);
      const actual=await json(auth(`SELECT jsonb_agg(jsonb_build_object('id',id,'statement',
        public.get_customer_statement(id,1,25)) ORDER BY id) FROM (VALUES ${values}) c(id);`));
      assert.equal(actual.length,expected.length);
      actual.forEach((row,n)=>{assert.equal(row.id,expected[n].id);
        assert.equal(row.statement.closing_balance_in_minor_units,expected[n].balance);verifyTimeline(row.statement);});
      matched+=actual.length;if(matched%1000===0)console.log(JSON.stringify({stage,matched}));
    }
    await measure(sid(13,1));
  }else{
    stage='real receivable writes';await sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
    await rpc(`open_cash_shift(${q(branch)},1000000)`,{write:true});
    const receiving={client_line_id:id(900),line_kind:'base_unit',commercial_quantity:100,base_unit_name:'باكيت',
      gross_amount_in_minor_units:50000,line_discount_in_minor_units:0,components:[{product_id:product,base_quantity:100}]};
    assert.equal((await rpc(`create_direct_supplier_receipt_v2(p_supplier_id:=${q(id(301))},p_branch_id:=${q(branch)},
      p_warehouse_id:=${q(warehouse)},p_idempotency_key:='statement138-receiving-0000000001',p_payment_method:='deferred',
      p_lines:=${j([receiving])})`,{write:true})).success,true);
    const sale=await rpc(`create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(customer)},'عميل الكشف','debt',
      ${j([{commercial_line_kind:'base_unit',product_id:product,base_quantity:5,price_authority:'server_catalog',line_discount_in_minor_units:0}])},
      0,0,'statement138-sale-0000000000000001')`,{write:true});assert.equal(sale.totalInMinorUnits,5000);
    const paid=await rpc(`record_customer_order_payment_once(${q(sale.orderId)},1000,'cash',NULL,'دفعة جزئية',
      'statement138-payment-000000000001')`,{write:true});
    assert.equal((await rpc(statement())).closing_balance_in_minor_units,4000);
    await rpc(`reverse_customer_order_payment(${q(paid.payment_id)},'عكس دفعة الكشف')`,{write:true});
    assert.equal((await rpc(statement())).closing_balance_in_minor_units,5000);
    const item=sale.items[0].id;
    const returned=await rpc(`settle_admin_sales_return_v1(${q(sale.orderId)},'statement138-return-0000000000001',
      ${j([{return_scope:'base_unit',order_item_id:item,quantity:1,stock_disposition:'restock'}])},
      ${j([{root_source_kind:'base_order_item',root_source_id:item,source_kind:'base_order_item',source_id:item,product_id:product,
        quantity:1,sellable_restock_quantity:1,defect_non_sellable_quantity:0,customer_damage_quantity:0}])},
      'مرتجع الكشف',NULL,NULL,NULL)`,{write:true});assert.equal(returned.debtReductionInMinorUnits,1000);
    assert.equal((await rpc(statement())).closing_balance_in_minor_units,4000);
    const guardedPayment=await rpc(`record_customer_order_payment_once(${q(sale.orderId)},500,'cash',NULL,'حارس المرتجع',
      'statement138-guarded-payment-0001')`,{write:true});
    await assert.rejects(()=>rpc(`reverse_customer_order_payment(${q(guardedPayment.payment_id)},'عكس بعد المرتجع')`,{write:true}),
      /PHASE4_AFTERCARE_DEPENDENCY_BLOCKS_REVERSAL/u);
    stage='undated debt,no fabricated date';
    await sql(`INSERT INTO orders(id,order_number,customer_id,status,source,payment_method,total_in_minor_units,amount_paid_in_minor_units,created_at)
      VALUES(${q(id(910))},'STATEMENT-UNDATED',${q(customer)},'completed','website','debt',7000,0,'1900-01-01');`);
    const before=await fingerprint(),all=await rpc(statement(customer,1,100));verifyTimeline(all);
    assert.equal(all.closing_balance_in_minor_units,10500);assert.equal(all.page_opening_balance_in_minor_units,0);
    assert.equal(all.total_count,6);const ascending=[...all.movements].reverse();
    assert.equal(ascending[0].movement_id,'sale:'+id(910));assert.equal(ascending[0].occurred_at,null);
    const byType=type=>all.movements.filter(m=>m.movement_type===type);
    assert.deepEqual(byType('sale_debt').map(m=>m.debit_in_minor_units).sort((a,b)=>a-b),[5000,7000]);
    assert.deepEqual(byType('payment').map(m=>m.credit_in_minor_units).sort((a,b)=>a-b),[500,1000]);
    assert.equal(byType('payment_reversal')[0].debit_in_minor_units,1000);
    assert.equal(byType('return_debt_reduction')[0].credit_in_minor_units,1000);
    assert.equal(all.closing_balance_in_minor_units,await json(`SELECT to_jsonb(public.phase42_customer_receivable_total_internal(${q(customer)}));`));
    stage='newest-first paging and exact page boundaries';
    const pages=[];for(let page=1;page<=3;page++){const value=await rpc(statement(customer,page,2));verifyTimeline(value);pages.push(value);}
    assert.deepEqual(pages.flatMap(p=>p.movements),all.movements);
    assert.equal(pages[0].page_opening_balance_in_minor_units,pages[1].page_closing_balance_in_minor_units);
    assert.equal(pages[1].page_opening_balance_in_minor_units,pages[2].page_closing_balance_in_minor_units);
    assert.equal(pages[2].page_opening_balance_in_minor_units,0);assert.deepEqual(pages.map(p=>p.has_more),[true,true,false]);
    assert.equal((await rpc(statement(customer,1,1000))).page_size,100);
    const empty=await rpc(statement(id(402)));assert.equal(empty.closing_balance_in_minor_units,0);assert.deepEqual(empty.movements,[]);
    assert.deepEqual(await fingerprint(),before,'Statement reads must not change durable content');
    stage='exact ACL and stored role boundaries';
    const metadata=await json(`SELECT jsonb_agg(jsonb_build_object('name',proname,'owner',pg_get_userbyid(proowner),
      'acl',proacl::text,'definer',prosecdef,'config',proconfig,'volatility',provolatile)) FROM pg_proc
      WHERE oid IN('public.get_customer_statement(uuid,integer,integer)'::regprocedure,
        'public.get_customer_debt_aging(uuid)'::regprocedure);`);
    const fresh=metadata.find(p=>p.name==='get_customer_statement'),aging=metadata.find(p=>p.name==='get_customer_debt_aging');
    assert.equal(fresh.acl,aging.acl);assert.equal(fresh.owner,'postgres');assert.equal(fresh.definer,true);
    assert.equal(fresh.volatility,'s');assert.deepEqual(fresh.config,['search_path=public, pg_temp']);
    const denied=/permission denied|صلاحية|صلاحيات|غير مصرح|تسجيل الدخول|ليس لديك/u;
    for(const options of [{role:'anon'},{actor:id(402)}])await assert.rejects(()=>rpc(statement(),options),denied);
    const roles=await json('SELECT jsonb_agg(code ORDER BY code) FROM roles;');
    for(const role of roles){
      const setup=`BEGIN;DELETE FROM user_roles WHERE user_id=${q(owner)};INSERT INTO user_roles(user_id,role_id)
        SELECT ${q(owner)},id FROM roles WHERE code=${q(role)};`;
      const call=auth(`SELECT public.${statement()};`).replace(/^BEGIN READ ONLY;/u,'');
      if(['owner','admin','manager','accountant','sales'].includes(role))assert.equal((await json(setup+call)).closing_balance_in_minor_units,10500);
      else await assert.rejects(()=>sql(setup+call),denied);
    }
    console.log(JSON.stringify({stage:'focused proofs',passed:true,closing:10500,undatedFirst:true,
      partialPayment:4000,reversal:5000,return:4000,aftercareReversalGuard:true,pages:3,aclIdentical:true,roles,zeroWrites:true}));
    stage='DB lint';const {stdout:lint}=await exec(process.execPath,[cli,'db','lint','--local','--level','warning','--workdir',workdir],
      {cwd:root,windowsHide:true,timeout:120000,maxBuffer:1024*1024});assertPackageDDbLint(lint);
  }
  console.log(JSON.stringify({ok:true,mode:scale?'FULL_SCALE':'FOCUSED_RUNTIME',productionAccess:0}));
}catch(error){console.error(JSON.stringify({ok:false,stage,message:error.message,productionAccess:0}));process.exitCode=1;}
finally{if(workdir)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',workdir],
  {cwd:root,windowsHide:true,timeout:120000,maxBuffer:1024*1024});}
