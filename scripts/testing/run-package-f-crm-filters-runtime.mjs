import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {promisify} from 'node:util';
import path from 'node:path';
import {createInterface} from 'node:readline/promises';
import {fullScale,timingSummary,expectedCounts} from './package-e-scale-contract.mjs';
import {assertPackageDDbLint} from './package-d-db-lint-policy.mjs';

const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..');
const scale=process.argv.includes('--scale'),projectId='nawasrah-package-f-crm-filters-test';
const inspect=process.argv.includes('--inspect');
if(inspect&&(!scale||!process.stdin.isTTY))throw Error('Scale inspection requires an interactive terminal before creating a DB');
const container='supabase_db_'+projectId,cli=path.join(root,'node_modules/supabase/dist/supabase.js');
const id=n=>'92600000-0000-4000-8000-'+String(n).padStart(12,'0');
const sid=(kind,n)=>'929'+String(kind).padStart(5,'0')+'-0000-4000-8000-'+String(n).padStart(12,'0');
const owner=scale?sid(1,1):id(1),customer=id(401),branch=id(200),warehouse=id(201),product=id(101);
const q=v=>"'"+String(v).replaceAll("'","''")+"'",j=v=>q(JSON.stringify(v))+'::jsonb';
let workdir,stage='bootstrap001-136';
const reportDirectory=path.join(root,'test-results/package-f-crm-filters');
const sql=(text,{variables={},seed=false}={})=>new Promise((resolve,reject)=>{
  const child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-q','-At','-v','ON_ERROR_STOP=1',
    ...Object.entries(variables).flatMap(([k,v])=>['-v',k+'='+v])],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let out='',err='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>{
    err+=chunk;
    for(const match of chunk.matchAll(/E2_PROGRESS modern_operations=(\d+)/gu))
      console.log(JSON.stringify({stage:'scale fixture progress',modernOperations:Number(match[1])}));
  });
  child.on('error',reject);child.on('close',code=>code===0?resolve(out.trim()):reject(Error(stage+':SQL exit'+code+':'+err.slice(-6000))));
  child.stdin.end("SET statement_timeout="+q(seed?'0':'60s')+";SET lock_timeout='30s';\n"+text);
});
const json=async(text,options)=>JSON.parse(await sql(text,options));
const auth=(text,{actor=owner,role='authenticated',write=false}={})=>"BEGIN"+(write?'':' READ ONLY')+";"+
  "DO $$BEGIN PERFORM set_config('request.jwt.claims',"+q(JSON.stringify({sub:actor,role,aal:'aal2'}))+",true);END$$;"+
  "SET LOCAL ROLE "+role+";"+text+(write?'COMMIT;':'ROLLBACK;');
const rpc=(command,options)=>json(auth('SELECT public.'+command+';',options));
const crm=(status='all',page=1,sort='latest',search=null,size=8)=>'get_crm_customer_page('+page+','+size+','+(search===null?'NULL':q(search))+','+q(status)+','+q(sort)+')';
const aging=c=>'get_customer_debt_aging('+(c?q(c):'NULL')+')';
const meta=()=>json("SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'acl',proacl,'config',proconfig,'definer',prosecdef,'volatility',provolatile) FROM pg_proc WHERE oid='public.get_crm_customer_page(integer,integer,text,text,text)'::regprocedure;");
const fingerprint=()=>json("SELECT jsonb_build_object("+['orders','customers','customer_payments','sales_return_events','business_operations',
  'inventory_balances','inventory_movements','audit_logs','order_status_history'].map(t=>q(t)+",(SELECT md5(COALESCE(string_agg(to_jsonb(r)::text,'|' ORDER BY to_jsonb(r)::text),'')) FROM public."+t+" r)").join(',')+");");
const existingCases=[];
for(const status of ['all','active','vip','inactive','blocked'])for(const sort of ['latest','highest_spending','most_orders'])
  for(const page of [1,2])existingCases.push(crm(status,page,sort,null,2));
existingCases.push(crm('all',1,'latest','079'),crm('all',1,'latest','لا يوجد'),crm('all',100,'latest'));
const snapshots=()=>Promise.all(existingCases.map(command=>rpc(command)));
async function literalParity(before){const after=await snapshots();after.forEach((row,n)=>assert.equal(JSON.stringify(row),JSON.stringify(before[n]),existingCases[n]));}

async function membership(expected,search=null){
  const all=(await rpc(crm('all',1,'latest',search,100))).customers;
  for(const [filter,ids] of Object.entries(expected)){
    const result=await rpc(crm(filter,1,'latest',search,100));
    assert.equal(result.total_count,ids.length,filter);
    assert.deepEqual(result.customers.map(c=>c.id),all.filter(c=>ids.includes(c.id)).map(c=>c.id),filter+' exact identities/order');
    const pages=[];
    for(let page=1;page<=Math.max(1,Math.ceil(ids.length/2));page++){
      const value=await rpc(crm(filter,page,'latest',search,2));assert.equal(value.total_count,ids.length);pages.push(...value.customers);
    }
    assert.deepEqual(pages,result.customers,filter+' complete paging without duplicates/gaps');
    for(const row of result.customers){
      const canonical=await json('SELECT to_jsonb(public.phase42_customer_receivable_total_internal('+q(row.id)+'));');
      assert.equal(row.current_balance_in_minor_units,canonical);
      if(filter==='overdue')assert.ok((await rpc(aging(row.id))).days_over_30_in_minor_units>0);
    }
  }
}

async function manualFixture(){
  // Independently specified identities/amounts; no136 result builds these
  // expected sets. Historic rows are synthetic,real payments/Return use RPC.
  for(const n of [420,421,422,423,424,425])await sql('INSERT INTO customers(id,full_name,phone,is_active,customer_type,credit_limit_in_minor_units) VALUES('+
    q(id(n))+','+q('MANUAL137-'+n)+','+q('0788800'+n)+','+(n!==421)+','+q(n===423?'wholesale':'retail')+','+(n===424?20000:n===425?1000:0)+');');
  async function debt(orderNumber,customerNumber,amount,age){
    await sql('INSERT INTO orders(id,order_number,customer_id,branch_id,warehouse_id,status,source,payment_method,total_in_minor_units,amount_paid_in_minor_units) VALUES('+
      q(id(orderNumber))+','+q('MANUAL137-O-'+orderNumber)+','+q(id(customerNumber))+','+q(branch)+','+q(warehouse)+",'completed','website','debt',"+amount+',0);');
    if(age!==null)await sql('INSERT INTO order_status_history(order_id,new_status,created_at) VALUES('+q(id(orderNumber))+
      ",'completed',((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Amman')::DATE-"+age+")::TIMESTAMP AT TIME ZONE 'Asia/Amman');");
  }
  await debt(1520,420,1000,31);
  await rpc('record_customer_order_payment_once('+q(id(1520))+",500,'cash',NULL,'manual31partial','package-f137-manual420-payment000001')",{write:true});
  await debt(1521,421,1000,30);await debt(1522,422,1500,null);
  await debt(1523,423,1000,45);
  await rpc('record_customer_order_payment_once('+q(id(1523))+",1000,'cash',NULL,'manual-old-full','package-f137-manual423-payment000001')",{write:true});
  await debt(1623,423,2000,2);await debt(1525,425,1000,5);
  const sale=await rpc('create_pos_sale_v2('+q(warehouse)+','+q(branch)+','+q(id(424))+",'MANUAL137-424','debt',"+
    j([{commercial_line_kind:'base_unit',product_id:product,base_quantity:2,price_authority:'server_catalog',line_discount_in_minor_units:0}])+
    ",0,0,'package-f137-manual424-sale00000001')",{write:true});assert.equal(sale.totalInMinorUnits,40000);
  const item=sale.items[0].id;
  const returned=await rpc('settle_admin_sales_return_v1('+q(sale.orderId)+",'package-f137-manual424-return000001',"+
    j([{return_scope:'base_unit',order_item_id:item,quantity:1,stock_disposition:'restock'}])+','+
    j([{root_source_kind:'base_order_item',root_source_id:item,source_kind:'base_order_item',source_id:item,product_id:product,
      quantity:1,sellable_restock_quantity:1,defect_non_sellable_quantity:0,customer_damage_quantity:0}])+
    ",'manual return debt',NULL,NULL,NULL)",{write:true});assert.equal(returned.debtReductionInMinorUnits,20000);
}

async function manualProof(){
  const expected={has_debt:[420,421,422,423,424,425].map(id),overdue:[420].map(id),over_limit:[],wholesale:[423].map(id)};
  await membership(expected,'MANUAL137-');
  const rows=(await rpc(crm('all',1,'latest','MANUAL137-',100))).customers;
  assert.deepEqual(Object.fromEntries(rows.map(row=>[row.id,row.current_balance_in_minor_units])),
    Object.fromEntries([[420,500],[421,1000],[422,1500],[423,2000],[424,20000],[425,1000]].map(([n,balance])=>[id(n),balance])));
  assert.equal(rows.find(row=>row.id===id(425)).credit_limit_in_minor_units,1000);
  console.log(JSON.stringify({stage:'independent manual fixture',cases:6,passed:true,expectedIds:expected,oldestFirstPaidThenNew:true}));
}

async function completeFilterIds(filter){
  const ids=[];let expectedCount;
  for(let page=1;;page++){
    const result=await rpc(crm(filter,page,'latest',null,100));
    expectedCount??=result.total_count;
    assert.equal(result.total_count,expectedCount,filter+' count stable across pages');
    assert.equal(result.customers.length,Math.min(100,Math.max(expectedCount-ids.length,0)),filter+' page size');
    ids.push(...result.customers.map(row=>row.id));
    if(ids.length===expectedCount)break;
    assert.ok(page<=Math.ceil(fullScale.customers/100),'Unexpected paging cannot loop forever');
  }
  assert.equal(new Set(ids).size,ids.length,filter+' no duplicate identities');
  return ids.sort();
}

async function fullScaleOracle(){
  const rows=await json('SELECT jsonb_agg(jsonb_build_object(\'id\',id,\'limit\',credit_limit_in_minor_units,\'type\',customer_type) ORDER BY id) FROM customers WHERE NOT is_deleted;');
  assert.equal(rows.length,fullScale.customers);
  const expected={overdue:[],has_debt:[],over_limit:[],wholesale:[]};
  const snapshots=[];
  // Individual calls to immutable136,not its bounded top_overdue summary and
  // never a copy of137's CTEs. Batches limit SQL transport,not customer coverage.
  for(let from=0;from<rows.length;from+=100){
    const batch=rows.slice(from,from+100);
    const age=await json(auth('SELECT jsonb_agg(jsonb_build_object(\'id\',c.id,\'aging\',public.get_customer_debt_aging(c.id)) ORDER BY c.id) FROM (VALUES '+
      batch.map(row=>'('+q(row.id)+'::uuid)').join(',')+') c(id);'));
    const balances=await json('SELECT jsonb_agg(jsonb_build_object(\'id\',c.id,\'balance\',public.phase42_customer_receivable_total_internal(c.id)) ORDER BY c.id) FROM (VALUES '+
      batch.map(row=>'('+q(row.id)+'::uuid)').join(',')+') c(id);');
    assert.equal(age.length,batch.length);assert.equal(balances.length,batch.length);
    for(let n=0;n<batch.length;n++){
      const row=batch[n];assert.equal(age[n].id,row.id);assert.equal(balances[n].id,row.id);
      const balance=balances[n].balance;
      assert.equal(age[n].aging.total_in_minor_units,balance,'136/phase42 exact per-customer oracle');
      if(age[n].aging.days_over_30_in_minor_units>0)expected.overdue.push(row.id);
      if(balance>0)expected.has_debt.push(row.id);
      if(row.limit>0&&balance>row.limit)expected.over_limit.push(row.id);
      if(row.type==='wholesale')expected.wholesale.push(row.id);
      snapshots.push({id:row.id,balance,aging:age[n].aging});
    }
    if(from%1000===0)console.log(JSON.stringify({stage:'independent136/phase42 oracle',customersProven:snapshots.length}));
  }
  await mkdir(reportDirectory,{recursive:true});
  await writeFile(path.join(reportDirectory,'independent-oracle.json'),JSON.stringify({expected,snapshots},null,2));
  return expected;
}

async function fullSetParity(expected){
  for(const filter of ['has_debt','overdue','over_limit','wholesale']){
    const actual=await completeFilterIds(filter);
    assert.deepEqual(actual,[...expected[filter]].sort(),filter+' exact full-size oracle set across every page');
    console.log(JSON.stringify({stage:'exact full-size filter sets',filter,identities:actual.length,passed:true}));
  }
}

async function measurements(label){
  const results=[];
  for(const command of [crm(),crm('has_debt'),crm('overdue'),crm('over_limit'),crm('wholesale'),crm('has_debt',1000)]){
    const measured=()=>json(auth('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) SELECT public.'+command+';')).then(p=>p[0]['Execution Time']);
    for(let n=0;n<3;n++)await measured();const values=[];for(let n=0;n<20;n++)values.push(await measured());
    const result={label,command,...timingSummary(values),limitMs:1000};results.push(result);console.log(JSON.stringify(result));
  }
  await mkdir(reportDirectory,{recursive:true});
  await writeFile(path.join(reportDirectory,label.toLowerCase()+'-timings.json'),JSON.stringify(results,null,2));
  return results;
}

async function explainSlowPaths(results){
  const source=await readFile(path.join(root,'supabase/migrations/137_package_f_crm_financial_filters.sql'),'utf8');
  const select=source.match(/RETURN\s*\(([\s\S]+)\);\s*END;/u)?.[1];assert.ok(select,'Exact explicit137 SELECT boundary');
  const plans=[];
  for(const result of results.filter(row=>row.p95>=1000)){
    const rpcPlan=await json(auth('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) SELECT public.'+result.command+';'));
    const filter=result.command.match(/,'([^']+)','latest'\)/u)?.[1];assert.ok(filter);
    const page=result.command.match(/get_crm_customer_page\((\d+),/u)?.[1];assert.ok(page);
    const body=await json('BEGIN READ ONLY;EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) SELECT d.result FROM (SELECT '+page+
      '::integer v_page,8::integer v_page_size,'+q(filter)+"::text v_status,NULL::text v_search,'latest'::text v_sort,"+
      ((Number(page)-1)*8)+'::integer v_offset) input CROSS JOIN LATERAL ('+select+') d(result);ROLLBACK;');
    const nodes=[];function visit(node){nodes.push({type:node['Node Type'],relation:node['Relation Name'],cte:node['CTE Name'],
      ms:node['Actual Total Time'],loops:node['Actual Loops'],rows:node['Actual Rows'],hits:node['Shared Hit Blocks'],
      reads:node['Shared Read Blocks'],tempRead:node['Temp Read Blocks'],tempWritten:node['Temp Written Blocks']});
      for(const child of node.Plans||[])visit(child);}
    visit(body[0].Plan);plans.push({command:result.command,rpc:rpcPlan,body});
    console.log(JSON.stringify({stage:'EXPLAIN ANALYZE BUFFERS',command:result.command,rpcMs:rpcPlan[0]['Execution Time'],
      bodyMs:body[0]['Execution Time'],nodes:nodes.sort((a,b)=>b.ms*b.loops-a.ms*a.loops).slice(0,18)}));
  }
  await writeFile(path.join(reportDirectory,'slow-plans.json'),JSON.stringify(plans,null,2));
}
try{
  const {stdout}=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,
    timeout:600000,maxBuffer:8*1024*1024,env:{...process.env,NAWASRAH_ISOLATED_PROJECT_ID:projectId,NAWASRAH_MAX_MIGRATION:'136',
      NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
      NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
  const boot=JSON.parse(stdout);assert.equal(boot.ok,true);workdir=boot.isolatedProjectRoot;
  console.log(JSON.stringify({stage,dbPortGuard:boot.dbPortGuard,productionAccess:0}));
  if(scale){
    stage='full two-year fixture';await exec('docker',['update','--cpus','4',container],{windowsHide:true});
    const fixture=await readFile(path.join(root,'scripts/testing/package-e-scale-fixture.sql'),'utf8');
    const [setup,rest]=fixture.split('-- E2_BATCH_BEGIN'),[batch,finish]=rest.split('-- E2_BATCH_END');assert.ok(setup&&batch&&finish);
    const batches=[];
    for(let from=1;from<=fullScale.modern;from+=100)batches.push(auth(batch.replaceAll('__E2_FROM__',String(from))
      .replaceAll('__E2_TO__',String(Math.min(from+99,fullScale.modern))),{write:true}));
    console.log(JSON.stringify({stage,targets:fullScale}));
    await sql(setup+batches.join('\n')+finish,{variables:fullScale,seed:true});
    for(const [table,key] of [['orders','orders'],['customers','customers'],['customer_payments','payments']])
      assert.equal(await json('SELECT to_jsonb(COUNT(*)) FROM '+table+';'),expectedCounts(fullScale)[key]);
    await sql("UPDATE customers SET customer_type=CASE WHEN RIGHT(id::text,1) IN('0','2','4','6','8') THEN 'wholesale' ELSE 'retail' END,credit_limit_in_minor_units=4000;");
  }else{
    stage='real POS/debt/payment/Return fixture';
    await sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
    await sql('UPDATE products SET sale_price_in_minor_units=20000,default_sale_price_in_minor_units=100000 WHERE id='+q(id(100))+';');
    await rpc('open_cash_shift('+q(branch)+',1000000)',{write:true});
    const line={client_line_id:id(900),line_kind:'base_unit',commercial_quantity:100,base_unit_name:'باكيت',gross_amount_in_minor_units:50000,
      line_discount_in_minor_units:0,components:[{product_id:product,base_quantity:100}]};
    await rpc('create_direct_supplier_receipt_v2(p_supplier_id:='+q(id(301))+',p_branch_id:='+q(branch)+',p_warehouse_id:='+q(warehouse)+
      ",p_idempotency_key:='package-f137-receipt-0000000000000001',p_payment_method:='deferred',p_lines:="+j([line])+')',{write:true});
    const sales=[];
    for(const age of [45,15,2]){
      const sale=await rpc('create_pos_sale_v2('+q(warehouse)+','+q(branch)+','+q(customer)+",'عميل العمر','debt',"+
        j([{commercial_line_kind:'base_unit',product_id:product,base_quantity:5,price_authority:'server_catalog',line_discount_in_minor_units:0}])+
        ',0,0,'+q('package-f137-sale-'+age+'-0000000000000001')+')',{write:true});assert.equal(sale.totalInMinorUnits,100000);sales.push(sale);
    }
    await rpc('record_customer_order_payment_once('+q(sales[2].orderId)+",20000,'cash',NULL,'دفعة1','package-f137-payment1-0000000000000001')",{write:true});
    await rpc('record_customer_order_payment_once('+q(sales[1].orderId)+",15000,'cash',NULL,'دفعة2','package-f137-payment2-0000000000000001')",{write:true});
    const item=sales[2].items[0].id;
    const returned=await rpc('settle_admin_sales_return_v1('+q(sales[2].orderId)+",'package-f137-return-0000000000000001',"+
      j([{return_scope:'base_unit',order_item_id:item,quantity:1,stock_disposition:'restock'}])+','+
      j([{root_source_kind:'base_order_item',root_source_id:item,source_kind:'base_order_item',source_id:item,product_id:product,
        quantity:1,sellable_restock_quantity:1,defect_non_sellable_quantity:0,customer_damage_quantity:0}])+
      ",'عمر الدين',NULL,NULL,NULL)",{write:true});assert.equal(returned.debtReductionInMinorUnits,20000);
    for(let n=0;n<sales.length;n++)await sql("UPDATE order_status_history SET created_at=((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Amman')::DATE-"+
      [45,15,2][n]+")::TIMESTAMP AT TIME ZONE 'Asia/Amman' WHERE order_id="+q(sales[n].orderId)+" AND new_status='completed';");
    await sql('UPDATE customers SET credit_limit_in_minor_units=240000,is_vip=true,customer_type=\'wholesale\' WHERE id='+q(customer)+';'+
      "INSERT INTO orders(id,order_number,customer_id,status,source,payment_method,total_in_minor_units,amount_paid_in_minor_units,created_at) VALUES("+
      q(id(910))+",'F137-UNKNOWN',"+q(id(403))+",'completed','website','debt',50000,0,'1900-01-01');");
    for(const [n,age] of [[404,30],[405,31],[406,8],[407,45]]){
      await sql('INSERT INTO customers(id,full_name,phone,credit_limit_in_minor_units,is_vip,is_blocked,is_deleted,customer_type) VALUES('+
        q(id(n))+','+q('عميل فلتر'+n)+','+q('0796600'+n)+',0,'+(n===406)+','+(n===406)+','+(n===407)+','+q(n===406?'wholesale':'retail')+');'+
        'INSERT INTO orders(id,order_number,customer_id,status,source,payment_method,total_in_minor_units,amount_paid_in_minor_units) VALUES('+
        q(id(n+1000))+','+q('F137-BOUNDARY-'+n)+','+q(id(n))+",'completed','website','debt',1000,0);"+
        'INSERT INTO order_status_history(order_id,new_status,created_at) VALUES('+q(id(n+1000))+",'completed',"+
        "((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Amman')::DATE-"+age+")::TIMESTAMP AT TIME ZONE 'Asia/Amman');");
    }
    await manualFixture();
  }
  stage='literal old JSON/ACL baseline';const beforeMeta=await meta(),before=await snapshots(),frozen=scale?null:await fingerprint();
  stage='apply137';await sql(await readFile(path.join(root,'supabase/migrations/137_package_f_crm_financial_filters.sql'),'utf8'));
  assert.deepEqual(await meta(),beforeMeta,'Same owner/ACL/search_path/volatility/definer');
  await literalParity(before);
  if(!scale){
    stage='exact whole-directory membership,paging and canonical balances';
    await membership({has_debt:[401,403,404,405,406].map(id),overdue:[401,405].map(id),over_limit:[401].map(id),wholesale:[401,406].map(id)},'0796600');
    await manualProof();
    assert.equal((await rpc(aging(id(403)))).age_unavailable_in_minor_units,50000);
    assert.equal((await rpc(crm('overdue',1,'latest','0796600403'))).total_count,0);
    assert.equal((await rpc(crm('has_debt',1,'latest','0796600403'))).total_count,1);
    const roles=await json("SELECT jsonb_agg(code ORDER BY code) FROM roles;");
    const allowed=['owner','admin','manager','accountant','cashier','sales','warehouse_keeper','orders','delivery_driver','view_only'];
    for(const role of roles){
      const setup='BEGIN;DELETE FROM user_roles WHERE user_id='+q(owner)+';INSERT INTO user_roles(user_id,role_id) SELECT '+q(owner)+',id FROM roles WHERE code='+q(role)+';';
      const command=setup+auth('SELECT public.'+crm('overdue',1,'latest','0796600')+';').replace(/^BEGIN READ ONLY;/u,'');
      if(allowed.includes(role))assert.equal((await json(command)).total_count,2);
      else await assert.rejects(()=>sql(command),/صلاحية|صلاحيات|غير مصرح|ليس لديك/u);
    }
    for(const options of [{role:'anon'},{actor:id(402)}])await assert.rejects(()=>rpc(crm('has_debt'),options),/permission denied|صلاحية|صلاحيات|غير مصرح|تسجيل الدخول|ليس لديك/u);
    for(const command of [crm('invented'),crm('all',0),crm('all',1,'invented'),crm('all',1,'latest','x'.repeat(101)),crm('all',1,'latest',null,101)])
      await assert.rejects(()=>rpc(command),/غير صالح|بين 1 و100|طويلة/u);
    assert.deepEqual(await fingerprint(),frozen,'Every read preserves durable content');
    stage='DB lint';const {stdout:lint}=await exec(process.execPath,[cli,'db','lint','--local','--level','warning','--workdir',workdir],
      {cwd:root,windowsHide:true,timeout:120000,maxBuffer:1024*1024});assertPackageDDbLint(lint);
    console.log(JSON.stringify({stage:'focused proofs',passed:true,literalJsonCases:existingCases.length,aclIdentical:true,
      hasDebt:5,overdue:2,overLimit:1,wholesale:2,unknownAgeNotOverdue:true,allRolesTested:true,zeroWrites:true}));
  }else{
    stage='independent per-customer136 and phase42 sets';
    const oracle=await rpc(aging());assert.equal(oracle.total_in_minor_units,50000000);
    const expected=await fullScaleOracle();
    await fullSetParity(expected);
    stage='all measured paths';
    let results=await measurements('BEFORE');
    if(results.some(row=>row.p95>=1000)){
      await explainSlowPaths(results);
      if(inspect){
        console.log(JSON.stringify({stage:'PERFORMANCE_REVIEW',next:'137-only source optimization allowed;send APPLY or STOP. No DB setting/threshold changes.',results}));
        const input=createInterface({input:process.stdin,output:process.stdout});
        const command=await input.question('137 inspection action: ');input.close();
        assert.equal(command.trim(),'APPLY','Inspection stopped without relaxing the failed performance gate');
        await sql(await readFile(path.join(root,'supabase/migrations/137_package_f_crm_financial_filters.sql'),'utf8'));
        assert.deepEqual(await meta(),beforeMeta);await literalParity(before);await fullSetParity(expected);
        results=await measurements('AFTER');
      }
    }
    assert.ok(results.every(row=>row.p95<1000),'137 p95 must be below1s;STOP for owner review,no threshold relaxation');
  }
  console.log(JSON.stringify({ok:true,mode:scale?'FULL_SCALE':'FOCUSED_RUNTIME',historicalMigrationsChanged:false,productionAccess:0}));
}catch(error){console.error(JSON.stringify({ok:false,stage,message:error.message,productionAccess:0}));process.exitCode=1;}
finally{if(workdir)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',workdir],{cwd:root,windowsHide:true,timeout:120000,maxBuffer:1024*1024});}
