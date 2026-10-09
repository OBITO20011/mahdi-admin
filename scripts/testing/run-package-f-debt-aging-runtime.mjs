import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {promisify} from 'node:util';
import path from 'node:path';
import {fullScale,timingSummary,expectedCounts} from './package-e-scale-contract.mjs';
import {assertPackageDDbLint} from './package-d-db-lint-policy.mjs';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline/promises';

const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..');
const scale=process.argv.includes('--scale'),inspect=process.argv.includes('--inspect'),projectId='nawasrah-package-f-aging-test';
if(inspect&&!process.stdin.isTTY)throw new Error('Inspection requires an interactive terminal;refuse before creating a DB');
const container=`supabase_db_${projectId}`,cli=path.join(root,'node_modules/supabase/dist/supabase.js');
const reportDirectory=path.join(root,'test-results','package-f-aging-runtime');
const id=n=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const sid=(kind,n)=>`929${String(kind).padStart(5,'0')}-0000-4000-8000-${String(n).padStart(12,'0')}`;
const q=v=>`'${String(v).replaceAll("'","''")}'`,j=v=>q(JSON.stringify(v))+'::jsonb';
const owner=scale?sid(1,1):id(1),customer=id(401),branch=id(200),warehouse=id(201),product=id(101);
let workdir,stage='fresh001-135';
const sql=(text,{variables={},seed=false,diagnostic=false}={})=>new Promise((resolve,reject)=>{
  const child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-q','-At','-v','ON_ERROR_STOP=1',
    ...Object.entries(variables).flatMap(([key,value])=>['-v',`${key}=${value}`])],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let out='',err='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>{err+=chunk;
    for(const match of chunk.matchAll(/E2_PROGRESS modern_operations=(\d+)/gu))console.log(JSON.stringify({stage:'scale seed',modern:Number(match[1])}));});
  child.on('error',reject);child.on('close',code=>{
    if(diagnostic)console.log(JSON.stringify({stage:'nested EXPLAIN ANALYZE BUFFERS',plans:err}));
    if(code===0)resolve(out.trim());else reject(Error(`${stage}:SQL exit${code}: ${err.slice(-6000)}`));
  });
  child.stdin.end(`SET statement_timeout=${q(seed?'0':'60s')};SET lock_timeout='30s';\n${text}`);
});
const json=async(text,options)=>JSON.parse(await sql(text,options));
const auth=(text,{actor=owner,role='authenticated',write=false}={})=>`BEGIN${write?'':' READ ONLY'};
  DO $$BEGIN PERFORM set_config('request.jwt.claims',${q(JSON.stringify({sub:actor,role,aal:'aal2'}))},true);END$$;
  SET LOCAL ROLE ${role};${text}${write?'COMMIT':'ROLLBACK'};`;
const rpc=(command,options={})=>json(auth(`SELECT public.${command};`,options));
const aging=c=>`get_customer_debt_aging(${c?q(c):'NULL'})`;
const fields=['days_0_7_in_minor_units','days_8_30_in_minor_units','days_over_30_in_minor_units','age_unavailable_in_minor_units'];
function buckets(value,expected){assert.equal(value.total_in_minor_units,expected.reduce((a,b)=>a+b,0));assert.deepEqual(fields.map(k=>value[k]),expected);}
const fingerprint=()=>json(`SELECT jsonb_build_object(${['orders','customer_payments','sales_return_events','business_operations',
  'customers','inventory_balances','inventory_movements','audit_logs','order_status_history'].map(t=>`${q(t)},
  (SELECT md5(COALESCE(string_agg(to_jsonb(r)::text,'|' ORDER BY to_jsonb(r)::text),'')) FROM public.${t} r)`).join(',')});`);
const meta=()=>json(`SELECT jsonb_agg(jsonb_build_object('name',p.proname,'owner',pg_get_userbyid(p.proowner),
  'acl',(SELECT jsonb_agg(jsonb_build_object('grantee',a.grantee,'privilege',a.privilege_type,'grantable',a.is_grantable)
    ORDER BY a.grantee,a.privilege_type) FROM aclexplode(p.proacl) a),'config',p.proconfig,'definer',p.prosecdef,'volatility',p.provolatile))
  FROM pg_proc p WHERE p.oid IN('public.get_customer_debt_aging(uuid)'::regprocedure,
    'public.get_customer_outstanding_orders_page(integer,integer,text)'::regprocedure);`);

async function measurements(label,enforce){
  const results=[];
  for(const [command,limitMs] of [[aging(sid(13,1)),1000],[aging(),3000]]){
    stage=`${label} full-scale p95`;const measure=()=>json(auth(`EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) SELECT public.${command};`)).then(p=>p[0]['Execution Time']);
    for(let n=0;n<3;n++)await measure();const values=[];for(let n=0;n<20;n++)values.push(await measure());
    const result={label,command,...timingSummary(values),limitMs};results.push(result);console.log(JSON.stringify(result));
  }
  if(enforce)assert.ok(results.every(r=>r.p95<r.limitMs),'Debt aging p95 exceeds authorized targets');
  await mkdir(reportDirectory,{recursive:true});
  await writeFile(path.join(reportDirectory,`${label.toLowerCase()}-timings.json`),JSON.stringify(results,null,2));
  return results;
}

async function eachCustomerSnapshot(){
  const ids=await json("SELECT jsonb_agg(id ORDER BY id) FROM customers;");assert.equal(ids.length,fullScale.customers);
  const rows=[];
  for(let from=0;from<ids.length;from+=100){
    const batch=ids.slice(from,from+100);
    const result=await json(auth(`SELECT jsonb_agg(jsonb_build_object('id',c.id,'aging',public.get_customer_debt_aging(c.id)) ORDER BY c.id)
      FROM (VALUES ${batch.map(value=>`(${q(value)}::UUID)`).join(',')}) c(id);`));
    // Canonical oracle runs as postgres; private helper stays revoked from public.
    const expected=await json(`SELECT jsonb_agg(jsonb_build_object('id',c.id,'total',public.phase42_customer_receivable_total_internal(c.id)) ORDER BY c.id)
      FROM customers c WHERE c.id IN(${batch.map(q).join(',')});`);
    assert.equal(result.length,batch.length);assert.equal(expected.length,batch.length);
    for(let n=0;n<result.length;n++){
      assert.equal(result[n].id,expected[n].id);assert.equal(result[n].aging.total_in_minor_units,expected[n].total);
      assert.equal(fields.reduce((sum,k)=>sum+result[n].aging[k],0),expected[n].total);
    }
    rows.push(...result);
    if(rows.length%1000===0)console.log(JSON.stringify({stage,customersProven:rows.length}));
  }
  return rows;
}

try{
  const {stdout}=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{
    cwd:root,windowsHide:true,timeout:600000,maxBuffer:8*1024*1024,env:{...process.env,
      NAWASRAH_ISOLATED_PROJECT_ID:projectId,NAWASRAH_MAX_MIGRATION:'135',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
      NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
  const boot=JSON.parse(stdout);assert.equal(boot.ok,true);workdir=boot.isolatedProjectRoot;
  const baseline=await readFile(path.join(root,'scripts/testing/fixtures/package-f-debt-aging-136-baseline.sql'),'utf8');
  assert.equal(createHash('sha256').update(baseline.replaceAll('\r\n','\n')).digest('hex').toUpperCase(),
    '7DF9954B678154D66231174AC5A79864E8B051D705D3D0A1E3A4B9E19A6A8083');
  await sql(inspect?baseline:await readFile(path.join(root,'supabase/migrations/136_package_f_customer_debt_aging.sql'),'utf8'));
  if(scale){
    stage='pre-seed authenticated RPC snapshot transport';
    const smoke=await json(`BEGIN;
      INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
        VALUES(${q(owner)},'authenticated','authenticated','aging-smoke@example.test',NOW(),'{}','{}');
      INSERT INTO profiles(id,full_name,is_active) VALUES(${q(owner)},'مالك الفحص',true);
      INSERT INTO roles(code,name_ar) VALUES('owner','مالك النظام') ON CONFLICT(code) DO NOTHING;
      INSERT INTO user_roles(user_id,role_id) SELECT ${q(owner)},id FROM roles WHERE code='owner';
      DO $$BEGIN PERFORM set_config('request.jwt.claims',${q(JSON.stringify({sub:owner,role:'authenticated',aal:'aal2'}))},true);END$$;
      SET LOCAL ROLE authenticated;
      SELECT jsonb_agg(jsonb_build_object('id',c.id,'aging',public.get_customer_debt_aging(c.id)) ORDER BY c.id)
        FROM (VALUES (${q(sid(13,1))}::UUID)) c(id);ROLLBACK;`);
    assert.equal(smoke.length,1);assert.equal(smoke[0].aging,null);
    console.log(JSON.stringify({stage,passed:true,directTableGrantAdded:false}));
    stage='full two-year fixture';await exec('docker',['update','--cpus','4',container],{windowsHide:true});
    const fixture=await readFile(path.join(root,'scripts/testing/package-e-scale-fixture.sql'),'utf8');
    const [setup,rest]=fixture.split('-- E2_BATCH_BEGIN'),[batch,finish]=rest.split('-- E2_BATCH_END');assert.ok(setup&&batch&&finish);
    const batches=[];for(let from=1;from<=fullScale.modern;from+=100)batches.push(auth(
      batch.replaceAll('__E2_FROM__',String(from)).replaceAll('__E2_TO__',String(Math.min(from+99,fullScale.modern))),{write:true}));
    console.log(JSON.stringify({stage,targets:fullScale}));
    await sql(setup+batches.join('\n')+finish,{variables:fullScale,seed:true});
    const counts=expectedCounts(fullScale);
    for(const [table,key,column] of [['orders','orders','customer_id'],['customers','customers','id'],
      ['customer_payments','payments','customer_id'],['inventory_movements','movements','product_id']]){
      assert.equal(await json(`SELECT to_jsonb(COUNT(*)) FROM public.${table} WHERE ${column}::text LIKE '929%';`),counts[key]);
    }
    stage='full-scale canonical totals';const global=await rpc(aging());
    assert.equal(global.total_in_minor_units,50000000);assert.equal(fields.reduce((sum,k)=>sum+global[k],0),50000000);
    assert.ok(global.top_overdue.length<=50);assert.equal(global.top_overdue_limit,50);
    // Full source equality, independently of the new reader's allocation.
    const canonical=await json(`SELECT to_jsonb(SUM(public.phase42_customer_receivable_total_internal(id))) FROM customers;`);
    assert.equal(global.total_in_minor_units,canonical);
    const single=await rpc(aging(sid(13,1)));assert.equal(single.total_in_minor_units,5000,'Measured customer must have five genuine outstanding debts');
    assert.equal(single.total_in_minor_units,
      await json(`SELECT to_jsonb(public.phase42_customer_receivable_total_internal(${q(sid(13,1))}));`));
    if(inspect){
      stage='before optimization EXPLAIN';
      const plan=await json(auth(`EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) SELECT public.${aging()};`));
      // Lift the exact pinned SELECT out of PL/pgSQL's INTO assignment for
      // read-only operator diagnostics; no function definition is patched.
      const select=baseline.match(/(WITH eligible[\s\S]+?END) INTO v_result FROM customers c;/u);
      assert.ok(select,'Pinned baseline SELECT boundary must be exact');
      const bodyPlan=await json(`BEGIN READ ONLY; EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)
        SELECT a.payload FROM (SELECT NULL::UUID AS p_customer_id) input
        CROSS JOIN LATERAL (${select[1]} FROM customers c) a(payload);ROLLBACK;`);
      await mkdir(reportDirectory,{recursive:true});
      await writeFile(path.join(reportDirectory,'before-explain.json'),JSON.stringify({rpc:plan,body:bodyPlan},null,2));
      const nodes=[];function walk(p){nodes.push({type:p['Node Type'],cte:p['CTE Name'],relation:p['Relation Name'],function:p['Function Name'],
        ms:p['Actual Total Time'],loops:p['Actual Loops'],rows:p['Actual Rows'],hits:p['Shared Hit Blocks'],reads:p['Shared Read Blocks'],
        tempRead:p['Temp Read Blocks'],tempWritten:p['Temp Written Blocks']});for(const child of p.Plans||[])walk(child);}
      walk(bodyPlan[0].Plan);console.log(JSON.stringify({stage,rpcMs:plan[0]['Execution Time'],bodyMs:bodyPlan[0]['Execution Time'],
        nodes:nodes.sort((a,b)=>b.ms*b.loops-a.ms*a.loops).slice(0,25)}));
      const beforeTimings=await measurements('BEFORE',false),day=await sql("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Amman')::DATE;");
      stage='baseline per-customer equality';const before=await eachCustomerSnapshot();const beforeMeta=await meta();
      await writeFile(path.join(reportDirectory,'before-customers.json'),JSON.stringify(before));
      console.log(JSON.stringify({stage:'BASELINE_READY',customers:before.length,beforeTimings,
        next:'Inspect plan,edit136 only then send APPLY on stdin;DB is kept isolated until this runner finishes'}));
      const input=createInterface({input:process.stdin,output:process.stdout});
      const answer=await input.question('APPLY optimized136 or STOP: ');input.close();assert.equal(answer.trim(),'APPLY');
      stage='install optimized136 in disposable DB';
      await sql('DROP FUNCTION public.get_customer_debt_aging(UUID);');
      await sql(await readFile(path.join(root,'supabase/migrations/136_package_f_customer_debt_aging.sql'),'utf8'));
      assert.deepEqual(await meta(),beforeMeta,'Exact owner/ACL/config/volatility preserved');
      stage='optimized per-customer equality';const after=await eachCustomerSnapshot();
      await writeFile(path.join(reportDirectory,'after-customers.json'),JSON.stringify(after));
      assert.equal(await sql("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Amman')::DATE;"),day,'Do not compare age across an Amman midnight');
      assert.deepEqual(after,before,'Every customer full JSON,all buckets,dates/limits/contact facts remain identical');
      assert.deepEqual(await rpc(aging()),global,'Global summary and bounded top-overdue JSON remain identical');
      console.log(JSON.stringify({stage:'all-customer parity',passed:true,customers:after.length}));
      await measurements('AFTER',true);
    }else{
      await measurements('CURRENT',true);
    }
  }else{
    stage='real sale/payments/Return';await sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
    await sql(`UPDATE products SET sale_price_in_minor_units=20000,default_sale_price_in_minor_units=100000 WHERE id=${q(id(100))};`);
    const shift=await rpc(`open_cash_shift(${q(branch)},1000000)`,{write:true});assert.ok(shift.id);
    const line={client_line_id:id(900),line_kind:'base_unit',commercial_quantity:100,base_unit_name:'باكيت',gross_amount_in_minor_units:50000,
      line_discount_in_minor_units:0,components:[{product_id:product,base_quantity:100}]};
    const receipt=await rpc(`create_direct_supplier_receipt_v2(p_supplier_id:=${q(id(301))},p_branch_id:=${q(branch)},p_warehouse_id:=${q(warehouse)},
      p_idempotency_key:='package-f136-receipt-0000000000000001',p_payment_method:='deferred',p_lines:=${j([line])})`,{write:true});assert.equal(receipt.success,true);
    const sales=[];for(const age of [45,15,2]){
      const sale=await rpc(`create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(customer)},'عميل العمر','debt',
        ${j([{commercial_line_kind:'base_unit',product_id:product,base_quantity:5,price_authority:'server_catalog',line_discount_in_minor_units:0}])},
        0,0,${q(`package-f136-sale-${age}-0000000000000001`)})`,{write:true});assert.equal(sale.totalInMinorUnits,100000);sales.push(sale);
    }
    await rpc(`record_customer_order_payment_once(${q(sales[2].orderId)},20000,'cash',NULL,'دفعة1','package-f136-payment1-0000000000000001')`,{write:true});
    await rpc(`record_customer_order_payment_once(${q(sales[1].orderId)},15000,'cash',NULL,'دفعة2','package-f136-payment2-0000000000000001')`,{write:true});
    const item=sales[2].items[0].id;
    const returned=await rpc(`settle_admin_sales_return_v1(${q(sales[2].orderId)},'package-f136-return-0000000000000001',
      ${j([{return_scope:'base_unit',order_item_id:item,quantity:1,stock_disposition:'restock'}])},
      ${j([{root_source_kind:'base_order_item',root_source_id:item,source_kind:'base_order_item',source_id:item,product_id:product,
        quantity:1,sellable_restock_quantity:1,defect_non_sellable_quantity:0,customer_damage_quantity:0}])},'عمر الدين',NULL,NULL,NULL)`,{write:true});
    assert.equal(returned.debtReductionInMinorUnits,20000);
    // Backdate only disposable completion evidence after legitimate writes.
    for(let n=0;n<sales.length;n++)await sql(`UPDATE order_status_history SET created_at=
      ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Amman')::DATE-${[45,15,2][n]})::TIMESTAMP AT TIME ZONE 'Asia/Amman'
      WHERE order_id=${q(sales[n].orderId)} AND new_status='completed';`);
    const before=await fingerprint(),result=await rpc(aging(customer));buckets(result,[100000,100000,45000,0]);
    assert.equal(result.oldest_debt_age_days,45);assert.ok(result.last_payment_at);
    const crm=(await rpc("get_crm_customer_page(1,10,'0796600401','all','latest')")).customers[0];
    assert.equal(result.total_in_minor_units,crm.current_balance_in_minor_units);
    assert.equal(result.total_in_minor_units,await json(`SELECT to_jsonb(public.phase42_customer_receivable_total_internal(${q(customer)}));`));
    buckets(await rpc(aging(id(402))),[0,0,0,0]);assert.deepEqual(await fingerprint(),before,'All reads preserve full durable content');
    stage='undated first/no fabricated date';
    await sql(`INSERT INTO orders(id,order_number,customer_id,status,source,payment_method,total_in_minor_units,amount_paid_in_minor_units,created_at)
      VALUES(${q(id(910))},'F136-UNKNOWN',${q(customer)},'completed','website','debt',10000,0,'1900-01-01');`);
    const unknown=await rpc(aging(customer));buckets(unknown,[100000,100000,55000,0]);
    // The 55k coverage consumes the undated10k first, then45k of the oldest100k.
    assert.equal(unknown.undated_debt_count,0);
    await sql(`INSERT INTO orders(id,order_number,customer_id,status,source,payment_method,total_in_minor_units,amount_paid_in_minor_units,created_at)
      VALUES(${q(id(911))},'F136-UNKNOWN-REMAINING',${q(id(403))},'completed','website','debt',50000,0,'1900-01-01');`);
    const isolatedUnknown=await rpc(aging(id(403)));buckets(isolatedUnknown,[0,0,0,50000]);
    assert.equal(isolatedUnknown.oldest_debt_at,null);assert.equal(isolatedUnknown.oldest_debt_age_days,null);
    assert.equal(isolatedUnknown.undated_debt_count,1);
    const all=await rpc(aging());assert.equal(all.overdue_customer_count,1);assert.ok(all.top_overdue.every(c=>c.customer_id!==id(403)));
    stage='Amman midnight7/8 and30/31';
    const cases=[[7,'00:00:00',0],[8,'00:00:00',1],[30,'00:00:00',1],[31,'00:00:00',2],[8,'23:59:59',1],[31,'23:59:59',2]];
    for(let n=0;n<cases.length;n++){
      const [days,time,bucket]=cases[n],c=id(920+n),o=id(940+n);
      await sql(`INSERT INTO customers(id,full_name,phone) VALUES(${q(c)},'حد العمر${n}',${q(`07999000${n}`)});
        INSERT INTO orders(id,order_number,customer_id,status,source,payment_method,total_in_minor_units,amount_paid_in_minor_units)
        VALUES(${q(o)},${q(`F136-BOUNDARY-${n}`)},${q(c)},'completed','website','debt',1000,0);
        INSERT INTO order_status_history(order_id,new_status,created_at) VALUES(${q(o)},'completed',
          (((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Amman')::DATE-${days})+${q(time)}::TIME) AT TIME ZONE 'Asia/Amman');`);
      const expected=[0,0,0,0];expected[bucket]=1000;buckets(await rpc(aging(c)),expected);
    }
    stage='canonical excess collection floors at zero';
    await sql(`INSERT INTO orders(id,order_number,customer_id,status,source,payment_method,total_in_minor_units,amount_paid_in_minor_units)
      VALUES(${q(id(950))},'F136-CREDIT',${q(id(402))},'completed','website','debt',1000,1500);`);
    buckets(await rpc(aging(id(402))),[0,0,0,0]);
    assert.equal(await json(`SELECT to_jsonb(public.phase42_customer_receivable_total_internal(${q(id(402))}));`),0);
    // Normal projection clamps overpayment. Independently challenge the reader
    // with excess historical evidence only inside a rollback-only transaction.
    const beforeExcess=await fingerprint();
    const excess=await json(`BEGIN;ALTER TABLE public.orders DISABLE TRIGGER trg_sync_order_payment_state;
      UPDATE public.orders SET amount_paid_in_minor_units=1500 WHERE id=${q(id(950))};
      ALTER TABLE public.orders ENABLE TRIGGER trg_sync_order_payment_state;
      DO $$BEGIN PERFORM set_config('request.jwt.claims',${q(JSON.stringify({sub:owner,role:'authenticated',aal:'aal2'}))},true);END$$;
      SELECT jsonb_build_object('paid',(SELECT amount_paid_in_minor_units FROM orders WHERE id=${q(id(950))}),
        'canonical',public.phase42_customer_receivable_total_internal(${q(id(402))}),
        'aging',public.${aging(id(402))});ROLLBACK;`);
    assert.equal(excess.paid,1500);assert.equal(excess.canonical,0);buckets(excess.aging,[0,0,0,0]);
    assert.deepEqual(await fingerprint(),beforeExcess,'Excess fault injection must restore durable content');
    stage='exact role and ACL parity';const metadata=await meta();
    const fresh=metadata.find(p=>p.name==='get_customer_debt_aging'),existing=metadata.find(p=>p.name==='get_customer_outstanding_orders_page');
    assert.deepEqual(fresh.acl,existing.acl);assert.equal(fresh.owner,'postgres');assert.equal(fresh.definer,true);
    assert.equal(fresh.volatility,'s');assert.deepEqual(fresh.config,['search_path=public, pg_temp']);
    for(const options of [{role:'anon'},{actor:id(402)}])await assert.rejects(()=>rpc(aging(customer),options),/permission denied|صلاحية|صلاحيات|غير مصرح|تسجيل الدخول|ليس لديك/u);
    const roles=await json("SELECT jsonb_agg(code ORDER BY code) FROM roles;");
    const allowed=['owner','admin','manager','accountant','sales'];
    for(const role of roles){
      const setup=`BEGIN;DELETE FROM user_roles WHERE user_id=${q(owner)};INSERT INTO user_roles(user_id,role_id)
        SELECT ${q(owner)},id FROM roles WHERE code=${q(role)};`;
      const call=auth(`SELECT public.${aging(customer)};`).replace(/^BEGIN READ ONLY;/u,'');
      if(allowed.includes(role)){const value=await json(setup+call);assert.equal(value.total_in_minor_units,255000);}
      else await assert.rejects(()=>sql(setup+call),/صلاحية|صلاحيات|غير مصرح|ليس لديك/u);
    }
    stage='final read-only fingerprint';const frozen=await fingerprint();await rpc(aging());await rpc(aging(customer));assert.deepEqual(await fingerprint(),frozen);
    console.log(JSON.stringify({stage:'focused proofs',passed:true,canonical:255000,fifo:true,unknownAgeSeparate:true,
      undatedRemainingCount:1,midnightBoundaries:cases.length,roles,aclIdentical:true,zeroWrites:true}));
    stage='DB lint';const {stdout:lint}=await exec(process.execPath,[cli,'db','lint','--local','--level','warning','--workdir',workdir],
      {cwd:root,windowsHide:true,timeout:120000,maxBuffer:1024*1024});assertPackageDDbLint(lint);
  }
  console.log(JSON.stringify({ok:true,mode:scale?'FULL_SCALE':'FOCUSED_RUNTIME',productionAccess:0}));
}catch(error){console.error(JSON.stringify({ok:false,stage,message:error.message,productionAccess:0}));process.exitCode=1;}
finally{if(workdir)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',workdir],{cwd:root,windowsHide:true,timeout:120000,maxBuffer:1024*1024});}
