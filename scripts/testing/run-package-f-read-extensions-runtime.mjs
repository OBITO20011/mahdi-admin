import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {promisify} from 'node:util';
import path from 'node:path';
import {fullScale,timingSummary,expectedCounts} from './package-e-scale-contract.mjs';
import {assertPackageDDbLint} from './package-d-db-lint-policy.mjs';

const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..');
const projectId='nawasrah-package-f-reads-test',container=`supabase_db_${projectId}`;
const scale=process.argv.includes('--scale'),cli=path.join(root,'node_modules/supabase/dist/supabase.js');
const id=n=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),customer=id(401),branch=id(200),warehouse=id(201),product=id(101);
const scaleId=(kind,n)=>`929${String(kind).padStart(5,'0')}-0000-4000-8000-${String(n).padStart(12,'0')}`;
const q=v=>`'${String(v).replaceAll("'","''")}'`,j=v=>q(JSON.stringify(v))+'::jsonb';
let workdir,stage='fresh001-134 bootstrap';
const sql=(text,{variables={},seed=false}={})=>new Promise((resolve,reject)=>{
  const child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-q','-At','-v','ON_ERROR_STOP=1',
    ...Object.entries(variables).flatMap(([key,value])=>['-v',`${key}=${value}`])],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let out='',err='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>{err+=chunk;
    for(const match of chunk.matchAll(/E2_PROGRESS modern_operations=(\d+)/gu))console.log(JSON.stringify({stage:'full scale seed',modern:Number(match[1])}));});
  child.on('error',reject);child.on('close',code=>code===0?resolve(out.trim()):reject(Error(`${stage}:SQL exit${code}: ${err.slice(-6000)}`)));
  child.stdin.end(`SET statement_timeout=${q(seed?'0':'60s')};SET lock_timeout='30s';\n${text}`);
});
const json=async(text,options)=>JSON.parse(await sql(text,options));
const auth=(text,{actor=scale?scaleId(1,1):owner,role='authenticated',write=false}={})=>`BEGIN${write?'':' READ ONLY'};
  DO $$BEGIN PERFORM set_config('request.jwt.claims',${q(JSON.stringify({sub:actor,role,aal:'aal2'}))},true);END$$;
  SET LOCAL ROLE ${role};${text}${write?'COMMIT':'ROLLBACK'};`;
const rpc=(command,options={})=>json(auth(`SELECT public.${command};`,options));
const inventory=(status='all',page=1,extra='NULL,NULL,NULL')=>`get_admin_inventory_product_page(${page},24,NULL,${extra},${q(status)})`;
const pos=(search=null,page=1)=>`get_pos_customer_page(${page},25,${search===null?'NULL':q(search)})`;
const acl=()=>json(`SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),
  'acl',p.proacl,'config',p.proconfig,'securityDefiner',p.prosecdef,'volatility',p.provolatile) ORDER BY p.oid)
  FROM pg_proc p WHERE p.oid IN('public.get_pos_customer_page(integer,integer,text)'::regprocedure,
    'public.get_admin_inventory_product_page(integer,integer,text,uuid,uuid,uuid,text)'::regprocedure);`);
const snapshots=async()=>Promise.all([pos(),pos(customer),pos(null,2),inventory(),inventory('low_stock'),inventory('out_of_stock'),
  inventory('stagnant'),inventory('all',2),inventory('all',1,`${q(branch)},${q(warehouse)},NULL`)].map(command=>rpc(command)));
function oldShape(value){
  if(Array.isArray(value.customers))return {...value,customers:value.customers.map(row=>{
    const {current_balance_in_minor_units,credit_limit_in_minor_units,...old}=row;
    assert.equal(typeof current_balance_in_minor_units,'number');assert.equal(typeof credit_limit_in_minor_units,'number');return old;})};
  const {active_items,available_stock,...old}=value.metrics;
  assert.equal(typeof active_items,'number');assert.equal(typeof available_stock,'number');return {...value,metrics:old};
}
const parity=async before=>{
  const after=await snapshots();assert.equal(after.length,before.length);
  after.forEach((value,index)=>assert.equal(JSON.stringify(oldShape(value)),JSON.stringify(before[index]),`Literal JSON parity${index}`));
};
async function rejects(command,options){await assert.rejects(()=>rpc(command,options),/permission denied|غير مصرح|صلاحية|صلاحيات|تسجيل الدخول|غير نشط|ليس لديك/u);}

try{
  const {stdout}=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{
    cwd:root,windowsHide:true,timeout:600000,maxBuffer:8*1024*1024,env:{...process.env,
      NAWASRAH_ISOLATED_PROJECT_ID:projectId,NAWASRAH_MAX_MIGRATION:'134',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
      NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
  const boot=JSON.parse(stdout);assert.equal(boot.ok,true);workdir=boot.isolatedProjectRoot;
  const permissions=await acl();let goldenBefore;
  if(!scale){
  stage='real sale/payment/Return fixture';
  await sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
  await sql(`UPDATE customers SET credit_limit_in_minor_units=40000 WHERE id=${q(customer)};
    UPDATE products SET sale_price_in_minor_units=20000,default_sale_price_in_minor_units=100000 WHERE id=${q(id(100))};`);
  const line={client_line_id:id(900),line_kind:'base_unit',commercial_quantity:100,base_unit_name:'باكيت',gross_amount_in_minor_units:50000,
    line_discount_in_minor_units:0,components:[{product_id:product,base_quantity:100}]};
  const shift=await rpc(`open_cash_shift(${q(branch)},1000000)`,{write:true});assert.ok(shift.id);
  const receipt=await rpc(`create_direct_supplier_receipt_v2(p_supplier_id:=${q(id(301))},p_branch_id:=${q(branch)},p_warehouse_id:=${q(warehouse)},
    p_idempotency_key:='package-f135-receipt-0000000000000001',p_payment_method:='deferred',p_lines:=${j([line])})`,{write:true});assert.equal(receipt.success,true);
  const sale=await rpc(`create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(customer)},'عميل الدين','debt',
    ${j([{commercial_line_kind:'base_unit',product_id:product,base_quantity:5,price_authority:'server_catalog',line_discount_in_minor_units:0}])},0,0,'package-f135-sale-0000000000000001')`,{write:true});
  assert.equal(sale.success,true);assert.equal(sale.totalInMinorUnits,100000);
  await rpc(`record_customer_order_payment_once(${q(sale.orderId)},20000,'cash',NULL,'دفعة جزئية1','package-f135-payment1-0000000000000001')`,{write:true});
  await rpc(`record_customer_order_payment_once(${q(sale.orderId)},15000,'cash',NULL,'دفعة جزئية2','package-f135-payment2-0000000000000001')`,{write:true});
  const item=sale.items[0].id;
  const returned=await rpc(`settle_admin_sales_return_v1(${q(sale.orderId)},'package-f135-return-0000000000000001',
    ${j([{return_scope:'base_unit',order_item_id:item,quantity:1,stock_disposition:'restock'}])},
    ${j([{root_source_kind:'base_order_item',root_source_id:item,source_kind:'base_order_item',source_id:item,
      product_id:product,quantity:1,sellable_restock_quantity:1,defect_non_sellable_quantity:0,customer_damage_quantity:0}])},
    'قارئ الدين',NULL,NULL,NULL)`,{write:true});
  assert.equal(returned.success,true);assert.equal(returned.debtReductionInMinorUnits,20000);
  await rpc(`close_cash_shift(${q(shift.id)},1035000,NULL)`,{write:true});
  // Inactive stock and a second warehouse challenge active/count/scope semantics.
  await sql(`UPDATE products SET is_active=false WHERE id=${q(id(103))};
    INSERT INTO warehouses(id,branch_id,code,name_ar,is_active) VALUES(${q(id(202))},${q(branch)},'F135-SECOND','مستودع ثان',true);
    INSERT INTO inventory_balances(warehouse_id,product_id,on_hand_quantity,reserved_quantity) VALUES(${q(id(202))},${q(id(103))},10,10);`);
  goldenBefore=await snapshots();
  }
  if(scale){
    stage='canonical full volume seed';await exec('docker',['update','--cpus','4',container],{windowsHide:true});
    const fixture=await readFile(path.join(root,'scripts/testing/package-e-scale-fixture.sql'),'utf8');
    const [setup,rest]=fixture.split('-- E2_BATCH_BEGIN'),[batch,finish]=rest.split('-- E2_BATCH_END');assert.ok(setup&&batch&&finish);
    const batches=[];for(let from=1;from<=fullScale.modern;from+=100)batches.push(auth(
      batch.replaceAll('__E2_FROM__',String(from)).replaceAll('__E2_TO__',String(Math.min(from+99,fullScale.modern))),
      {actor:scaleId(1,1),write:true}));
    console.log(JSON.stringify({stage,targets:fullScale}));
    await sql(setup+batches.join('\n')+finish,{variables:fullScale,seed:true});
    const expected=expectedCounts(fullScale);
    for(const [table,key,column] of [['products','skus','id'],['customers','customers','id'],['orders','orders','customer_id'],
      ['customer_payments','payments','customer_id'],['inventory_movements','movements','product_id']]){
      const count=await json(`SELECT to_jsonb(COUNT(*)) FROM public.${table} WHERE ${column}::text LIKE '929%'${table==='products'?' AND NOT is_flavor_master':''};`);
      assert.equal(count,expected[key],`Full scale ${table}`);
    }
  }
  const before=scale?await snapshots():goldenBefore;
  stage='apply explicit135 and literal JSON/ACL proof';
  await sql(await readFile(path.join(root,'supabase/migrations/135_package_f_pos_customer_inventory_reads.sql'),'utf8'));
  await parity(before);assert.deepEqual(await acl(),permissions,'Owner,ACL,search_path and signatures unchanged');
  if(scale){
    const available=await rpc(inventory('available'));
    const expected=await json(`SELECT jsonb_build_object('available',(SELECT COUNT(*) FROM products p
      WHERE NOT p.is_flavor_master AND (SELECT COALESCE(SUM(available_quantity),0)
        FROM inventory_balances b WHERE b.product_id=p.id)>0),
      'active',(SELECT COUNT(*) FROM products WHERE NOT is_flavor_master AND is_active));`);
    assert.equal(available.total_count,expected.available);assert.equal(available.metrics.available_stock,expected.available);
    assert.equal(available.metrics.active_items,expected.active);
    assert.ok(available.total_count>available.products.length,'Server-wide count must exceed the bounded visible page');
    assert.ok(available.products.every(p=>p.available_quantity>0));
    console.log(JSON.stringify({stage:'full-scale literal JSON/ACL parity',passed:true,...expected,visible:available.products.length}));
  }
  if(!scale){
  const debt=(await rpc(pos(customer))).customers[0];
  const crm=(await rpc("get_crm_customer_page(1,10,'0796600401','all','latest')")).customers[0];
  assert.equal(crm.id,customer,'CRM lookup must resolve the same authoritative customer');
  assert.equal(debt.current_balance_in_minor_units,45000);assert.equal(debt.current_balance_in_minor_units,crm.current_balance_in_minor_units);
  assert.equal(debt.credit_limit_in_minor_units,40000);
  assert.equal((await rpc(pos(id(402)))).customers[0].current_balance_in_minor_units,0);
  const data=await rpc(inventory('available'));
  const count=await json(`SELECT to_jsonb(COUNT(*)) FROM products p WHERE NOT p.is_flavor_master AND
    (SELECT COALESCE(SUM(available_quantity),0) FROM inventory_balances b WHERE b.product_id=p.id)>0;`);
  assert.equal(data.total_count,count);assert.equal(data.metrics.available_stock,count);
  assert.ok(data.products.every(p=>p.available_quantity>0));
  assert.equal(data.metrics.active_items,await json('SELECT to_jsonb(COUNT(*)) FROM products WHERE NOT is_flavor_master AND is_active;'));
  const scoped=await rpc(inventory('available',1,`${q(branch)},${q(id(202))},NULL`));assert.equal(scoped.total_count,0,'Reserved stock is not available');
  for(const command of [pos(),inventory()]){
    await rejects(command,{role:'anon'});await rejects(command,{actor:id(402)});
  }
  await sql(`BEGIN;DELETE FROM user_roles WHERE user_id=${q(owner)};
    INSERT INTO user_roles(user_id,role_id) SELECT ${q(owner)},id FROM roles WHERE code='accountant';
    ${auth(`SELECT public.${inventory()};`).replace(/^BEGIN READ ONLY;/u,'').replace(/ROLLBACK;$/u,'')}
    DO $$BEGIN BEGIN PERFORM public.${pos()};RAISE EXCEPTION 'F135_UNAUTHORIZED_ACCEPTED';
      EXCEPTION WHEN OTHERS THEN IF SQLERRM !~ 'صلاحية|صلاحيات|غير مصرح|ليس لديك' THEN RAISE;END IF;END;END$$;ROLLBACK;`);
  console.log(JSON.stringify({stage:'focused runtime',passed:true,debt:45000,crmExact:true,zeroDebt:true,aclIdentical:true,
    literalJsonParity:true,readOnlyTransactions:true,availableCount:count,activeCount:data.metrics.active_items,productionAccess:0}));
  }
  if(scale){
    stage='full-scale reader timings';const results=[];
    for(const command of [pos(),pos('عميل الحجم 1'),inventory(),inventory('available'),inventory('all',Math.ceil(fullScale.skus/24))]){
      const measured=()=>json(auth(`EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) SELECT public.${command};`)).then(plan=>plan[0]['Execution Time']);
      for(let i=0;i<3;i++)await measured();const times=[];for(let i=0;i<20;i++)times.push(await measured());
      const stats=timingSummary(times);const result={command,...stats,limitMs:1000,passed:stats.p95<1000};results.push(result);console.log(JSON.stringify(result));
    }
    assert.ok(results.every(row=>row.passed),'Full-scale reader p95 must stay below1s;no timeout relaxation');
  }
  if(!scale){
    stage='database lint';
    const {stdout:lint}=await exec(process.execPath,[cli,'db','lint','--local','--level','warning','--workdir',workdir],
      {cwd:root,windowsHide:true,timeout:120000,maxBuffer:1024*1024});
    console.log(JSON.stringify({stage,passed:true,result:assertPackageDDbLint(lint)}));
  }
  console.log(JSON.stringify({ok:true,mode:scale?'FULL_SCALE_JSON_ACL_PERFORMANCE':'FOCUSED_RUNTIME',historicalMigrationsChanged:false,productionAccess:0}));
}catch(error){console.error(JSON.stringify({ok:false,stage,message:error.message,productionAccess:0}));process.exitCode=1;}
finally{if(workdir)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',workdir],{cwd:root,windowsHide:true,timeout:120000,maxBuffer:1024*1024});}
