// Disposable local PostgreSQL only. New sales use real public writers;
// explicitly labelled historical fixtures exercise old lifecycle/date evidence.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
import {schemaCatalogSql,catalogDifference} from './schema-catalog.mjs';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';
import {assertPackageDDbLint} from './package-d-db-lint-policy.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile),project='nawasrah-sales-history204-test';
const cli=path.join(root,'node_modules/supabase/dist/supabase.js'),executor=executorFor(['--container','supabase_db_'+project]);
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-sales-history204-')),report={output,startedAt:new Date().toISOString(),managedAccess:false,cases:[]};
const id=n=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`,owner=id(1),branch=id(200),warehouse=id(201),customer=id(401);
const q=v=>"'"+String(v).replaceAll("'","''")+"'",j=v=>q(JSON.stringify(v))+'::jsonb';let local,stage='bootstrap203',counter=0;
const sql=async input=>{const r=await executeInput(executor,input);assert.equal(r.code,0,r.stderr);return r.stdout.trim();};
const json=async input=>JSON.parse((await sql(input)).split('\n').at(-1));
const auth=(body,uid=owner,role='authenticated')=>`BEGIN;SELECT set_config('request.jwt.claims',${q(JSON.stringify({sub:uid,role,aal:'aal2'}))},true);SET LOCAL ROLE ${role};${body}COMMIT;`;
const rpc=(call,uid=owner)=>json(auth('SELECT public.'+call+';',uid));
const key=()=>`sales204-runtime-${String(++counter).padStart(8,'0')}`,record=(name,details={})=>{const p={name,passed:true,...details};report.cases.push(p);console.log(JSON.stringify(p));};
const historyCall=(overrides={})=>{const p={page:1,size:100,period:'day',from:null,to:null,method:'all',source:'all',customer:null,number:null,salesOnly:false,...overrides};return `get_sales_history_page(${p.page},${p.size},${q(p.period)},${p.from?q(p.from):'NULL'},${p.to?q(p.to):'NULL'},${q(p.method)},${q(p.source)},${p.customer?q(p.customer):'NULL'},${p.number?q(p.number):'NULL'},${p.salesOnly})`;};
const history=p=>rpc(historyCall(p));
const day="date_trunc('day',NOW() AT TIME ZONE 'Asia/Amman') AT TIME ZONE 'Asia/Amman'";
try {
  const boot=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:{...process.env,
    NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'203',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
    NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
  local=JSON.parse(boot.stdout).isolatedProjectRoot;
  await sql("ALTER TABLE orders DISABLE TRIGGER trg_notify_new_website_order_push;SELECT cron.alter_job(jobid,active:=false) FROM cron.job;");
  await sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
  await rpc(`set_go_live_main_branch_v1(${q(branch)})`);await rpc(`open_cash_shift(${q(branch)},100000)`);
  for(const [n,price,name] of [[110,12050,'مياه الاختبار'],[111,14500,'عصير الاختبار'],[112,29500,'قهوة الاختبار']])await sql(`INSERT INTO products(id,sku,name_ar,category_id,unit_id,purchase_unit_id,sale_unit_id,units_per_purchase_unit,units_per_sale_unit,default_sale_price_in_minor_units,sale_price_in_minor_units,wholesale_price_in_minor_units,cost_price_in_minor_units,wac_cost_in_minor_units_exact,is_active) VALUES(${q(id(n))},${q('HISTORY204-'+n)},${q(name)},${q(id(11))},${q(id(10))},${q(id(10))},${q(id(10))},1,1,${price},${price},${price},0,0,true);`);
  const lines=[110,111,112].map(n=>({client_line_id:id(900+n),line_kind:'base_unit',commercial_quantity:10,base_unit_name:'باكيت',gross_amount_in_minor_units:10000,line_discount_in_minor_units:0,components:[{product_id:id(n),base_quantity:10}]}));
  assert.equal((await rpc(`create_direct_supplier_receipt_v2(p_supplier_id:=${q(id(301))},p_branch_id:=${q(branch)},p_warehouse_id:=${q(warehouse)},p_idempotency_key:=${q(key())},p_payment_method:='deferred',p_lines:=${j(lines)})`)).success,true);
  const sales=[];
  for(const [n,method] of [[110,'cash'],[111,'debt'],[112,'debt']]){
    const result=await rpc(`create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(customer)},'عميل سجل المبيعات',${q(method)},${j([{commercial_line_kind:'base_unit',product_id:id(n),base_quantity:1,price_authority:'server_catalog',line_discount_in_minor_units:0}])},0,0,${q(key())})`);
    assert.equal(result.success,true);sales.push(result.orderId);
  }
  stage='apply readonly204';const beforeCatalog=await json(schemaCatalogSql),beforeData=await readApplicationFingerprint(executor),beforeHome=await rpc('get_home_dashboard()');
  assert.equal(beforeHome.financialFactsStatus,'available');assert.equal(beforeHome.summary.todaySalesInMinorUnits,56050);assert.equal(beforeHome.summary.todayCompletedOrders,3);
  const migration=await readFile(path.join(root,'supabase/migrations/204_sales_history_read_model.sql'),'utf8');await sql(migration);
  assert.deepEqual(await readApplicationFingerprint(executor),beforeData);assert.deepEqual((await rpc('get_home_dashboard()')).summary,beforeHome.summary);
  const catalog=await json(schemaCatalogSql),diff=catalogDifference(beforeCatalog,catalog);assert.equal(diff.length,1);assert.equal(diff[0].section,'functions');assert.equal(diff[0].before,null);assert.ok(diff[0].after.identity.startsWith('get_sales_history_page('));
  const f=diff[0].after,old=catalog.functions.find(f=>f.identity.startsWith('get_operational_orders_page('));assert.deepEqual(f.acl,old.acl);assert.deepEqual(f.configuration,old.configuration);assert.equal(f.owner,old.owner);assert.match(f.definition,/STABLE/u);assert.match(f.definition,/SECURITY DEFINER/u);
  let page=await history();assert.equal(page.totalCount,3);assert.equal(page.summary.salesInMinorUnits,56050);assert.equal(page.summary.salesCount,3);assert.deepEqual(page.rows.map(r=>r.totalInMinorUnits).sort((a,b)=>a-b),[12050,14500,29500]);assert.ok(page.rows.every(r=>r.source==='pos'&&r.countsAsSale));
  assert.equal((await rpc("get_operational_orders_page(1,25,'all',NULL,'newest')")).total_count,0);
  record('realPOS cash12.050+debt14.500+debt29.500=56.050/3;Home parity,old075 still excludesPOS;one readonly function only');
  const cliq=await rpc(`create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(customer)},'عميل CliQ','cliq',${j([{commercial_line_kind:'base_unit',product_id:id(110),base_quantity:1,price_authority:'server_catalog',line_discount_in_minor_units:0}])},0,0,${q(key())})`);assert.equal(cliq.success,true);
  stage='labelled legacy evidence fixtures';
  // Historical fixtures only,not claims of current public-writer lifecycle events.
  const fixtures=[
    [801,'WEB-OLD-CREATED','website','completed',7000,`${day}-INTERVAL '10 days'`,`${day}+INTERVAL '1 hour'`,'عميل موقع'],
    [802,'RETURNED-204','pos','returned',9000,`${day}`,`${day}+INTERVAL '2 hours'`,'عميل مرتجع'],
    [803,'CANCELLED-204','website','cancelled',8000,`${day}`,`${day}+INTERVAL '3 hours'`,'عميل ملغي'],
    [804,'LEGACY_204-X',null,'completed',3333,`${day}-INTERVAL '30 days'`,null,'عميل قديم'],
    [805,'UNDATED-TODAY',null,'completed',4444,`${day}`,null,'عميل % خاص'],
    [806,'YESTERDAY-204','website','completed',1111,`${day}-INTERVAL '2 days'`,`${day}-INTERVAL '1 day'`,'عميل أمس'],
    [807,'BEFORE-MIDNIGHT','website','completed',50,`${day}-INTERVAL '2 days'`,`${day}-INTERVAL '1 microsecond'`,'حد أمس'],
    [808,'AT-MIDNIGHT','website','completed',60,`${day}-INTERVAL '2 days'`,`${day}`,'حد اليوم'],
    [809,'NEW-204','website','new',2200,`${day}`,null,'عميل جديد'],
  ];
  for(const [n,number,source,status,total,created,completed,name] of fixtures){
    await sql(`INSERT INTO orders(id,order_number,customer_id,customer_name_snapshot,branch_id,status,source,payment_method,total_in_minor_units,amount_paid_in_minor_units,created_at) VALUES(${q(id(n))},${q(number)},${q(customer)},${q(name)},${q(branch)},${q(status)},${source?q(source):'NULL'},'debt',${total},0,${created});`);
    if(completed)await sql(`INSERT INTO order_status_history(order_id,old_status,new_status,changed_by,created_at) VALUES(${q(id(n))},'new','completed',${q(owner)},${completed});`);
  }
  page=await history();const home=await rpc('get_home_dashboard()');assert.equal(home.financialFactsStatus,'available');assert.equal(page.summary.salesInMinorUnits,84160);assert.equal(page.summary.salesCount,7);assert.equal(page.summary.salesInMinorUnits,home.summary.todaySalesInMinorUnits);assert.equal(page.summary.salesCount,home.summary.todayCompletedOrders);
  assert.ok(page.rows.some(r=>r.id===id(801)&&r.dateBasis==='completion'));assert.ok(!page.rows.some(r=>[id(804),id(806),id(807)].includes(r.id)));assert.ok(page.rows.some(r=>r.id===id(808)));
  assert.equal(page.rows.find(r=>r.id===id(805)).countsAsSale,false);assert.equal(page.rows.find(r=>r.id===id(805)).dateBasis,'creation');assert.equal(page.rows.find(r=>r.id===id(803)).countsAsSale,false);assert.equal(page.summary.undatedInvoiceCount,1);
  record('websitecreatedold/completedtoday,returned/cancelled/new/undated and exactAmmanmidnight;canonical84160/7 equalsHome,never synthesize completion');
  assert.equal((await history({method:'cash'})).totalCount,1);assert.equal((await history({method:'cliq'})).totalCount,1);assert.equal((await history({source:'pos'})).totalCount,5);assert.equal((await history({source:'unknown'})).totalCount,1);
  assert.equal((await history({customer:'%'})).totalCount,1);assert.equal((await history({customer:'0796600401'})).totalCount,page.totalCount);assert.equal((await history({period:'all',number:'LEGACY_204'})).totalCount,1);
  const all=await history({period:'all'});assert.equal(all.totalCount,13);assert.equal(all.summary.undatedInvoiceCount,2);assert.ok((await history({period:'week'})).rows.some(r=>r.id===id(806)));assert.ok((await history({period:'month'})).rows.some(r=>r.id===id(808)));
  const today=await sql("SELECT (NOW() AT TIME ZONE 'Asia/Amman')::date;");assert.deepEqual((await history({period:'range',from:today,to:today})).rows,page.rows);
  const empty=await history({number:'DOES-NOT-EXIST'});assert.equal(empty.totalCount,0);assert.equal(empty.summary.salesInMinorUnits,0);assert.deepEqual(empty.rows,[]);
  record('allmethods/sources/customer-name-or-phone/literalpercent/invoicenumber/dateperiod filters;oldinvoices reachable and successfulempty explicitzero');
  const ids=[];for(let n=1;n<=Math.ceil(all.totalCount/2);n++)ids.push(...(await history({period:'all',page:n,size:2})).rows.map(r=>r.id));assert.deepEqual(ids,all.rows.map(r=>r.id));assert.equal(new Set(ids).size,all.totalCount);
  const latest=await history({salesOnly:true,size:5});assert.equal(latest.rows.length,5);assert.equal(latest.totalCount,7);assert.ok(latest.rows.every(r=>r.countsAsSale));assert.deepEqual(latest.rows,page.rows.filter(r=>r.countsAsSale).slice(0,5));assert.equal(latest.summary.salesInMinorUnits,home.summary.todaySalesInMinorUnits);
  record('stable serverpages no duplicate/missing IDs;Home last5 is same canonical getter,not operationalqueue or loadedstore');
  stage='role boundary';const roles=['owner','admin','manager','accountant','cashier','sales','orders','delivery_driver','warehouse_keeper'];
  for(let i=0;i<roles.length+1;i++){
    const uid=id(20+i);await sql(`INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) VALUES(${q(uid)},'authenticated','authenticated',${q('history204-'+i+'@example.test')},NOW(),'{}','{}');INSERT INTO profiles(id,full_name,is_active) VALUES(${q(uid)},'قارئ الاختبار',true);`);
    if(i<roles.length)await sql(`INSERT INTO roles(code,name_ar) VALUES(${q(roles[i])},${q(roles[i])}) ON CONFLICT(code) DO NOTHING;INSERT INTO user_roles(user_id,role_id) SELECT ${q(uid)},id FROM roles WHERE code=${q(roles[i])};`);
  }
  for(let i=0;i<8;i++)assert.equal((await rpc(historyCall(),id(20+i))).summary.salesInMinorUnits,84160);
  for(const uid of [id(28),id(29)]){const denied=await executeInput(executor,'\\set VERBOSITY verbose\n'+auth('SELECT public.'+historyCall()+';',uid));assert.notEqual(denied.code,0);assert.match(denied.stderr,/P0001/u);assert.match(denied.stderr,/صلاحية/u);}
  for(const role of ['anon','service_role']){const denied=await executeInput(executor,'\\set VERBOSITY verbose\n'+auth('SELECT public.'+historyCall()+';',owner,role));assert.notEqual(denied.code,0);assert.match(denied.stderr,/42501/u);}
  await sql(`INSERT INTO user_roles(user_id,role_id) SELECT ${q(id(28))},id FROM roles WHERE code='sales';`);assert.equal((await rpc(historyCall(),id(28))).summary.salesCount,7);
  record('same8ERP reader roles allowed;warehouse-only/norole P0001 fromunchangedguard,anon/service42501;warehouse+sales allowed');
  stage='read-only validation/replay';const fingerprint=await readApplicationFingerprint(executor),finalCatalog=await json(schemaCatalogSql);
  for(const p of [{page:0},{size:101},{period:'bad'},{method:'bad'},{source:'bad'},{period:'range'},{period:'day',from:today},{period:'range',from:'infinity',to:'infinity'},{period:'range',from:'2026-02-02',to:'2026-01-01'},{customer:'x'.repeat(101)}]){
    const invalid=await executeInput(executor,auth('SELECT public.'+historyCall(p)+';'));assert.notEqual(invalid.code,0);
  }
  for(let i=0;i<3;i++)assert.deepEqual((await history()).rows,page.rows);
  assert.deepEqual(await readApplicationFingerprint(executor),fingerprint);await sql(migration);assert.deepEqual(await json(schemaCatalogSql),finalCatalog);assert.deepEqual(await readApplicationFingerprint(executor),fingerprint);
  const detail=await json(`SELECT jsonb_build_object('number',o.order_number,'name',i.product_name_snapshot,'quantity',i.quantity,'method',o.payment_method) FROM orders o JOIN order_items i ON i.order_id=o.id WHERE o.id=${q(sales[0])};`);assert.equal(detail.name,'مياه الاختبار');assert.equal(detail.method,'cash');
  const {stdout:lint}=await exec(process.execPath,[cli,'db','lint','--local','--level','warning','--workdir',local],{cwd:root,windowsHide:true,timeout:120000,maxBuffer:1024**2});assertPackageDDbLint(lint);
  record('invalidarguments fail,noappdata/sequence writes;SQLreplay zerodelta;real invoice historical name retained;unchanged DBlint');report.ok=true;
}catch(error){report.ok=false;report.stage=stage;report.error=error.message;process.exitCode=1;}
finally{if(local)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true,maxBuffer:1024**2});report.endedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
