// Explicit quarantined candidate on a newly created,owned LOCAL219 database.
import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
assert.deepEqual(process.argv.slice(2),['--isolated-draft220'],'EXPLICIT_LOCAL_QUARANTINED_ONLY');
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile),project='nawasrah-guest220-test',container='supabase_db_'+project;
const out=await mkdtemp(path.join(process.env.RUNNER_TEMP??tmpdir(),'nawasrah-guest220-'));
const report={out,hostedAccess:false,activeCeiling:219,cases:[],races:[]},executor=executorFor(['--container',container]);
const id=n=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`,owner=id(1),branch=id(200),warehouse=id(201),product=id(103);
const q=x=>x===null?'NULL':"'"+String(x).replaceAll("'","''")+"'",j=x=>q(JSON.stringify(x))+'::jsonb';
let local,containerId;
const inspect=async()=>JSON.parse((await exec('docker',['inspect',container],{windowsHide:true})).stdout)[0];
async function own(){assert.ok(containerId);assert.equal((await inspect()).Id,containerId,'OWN_CREATED_GUEST220_CONTAINER_ONLY');}
async function sql(text){await own();const r=await executeInput(executor,text);assert.equal(r.code,0,r.stderr.slice(-2500));return r.stdout.trim();}
const json=async text=>JSON.parse((await sql(text)).split('\n').at(-1));
const claims=(role='service_role')=>`SELECT set_config('request.jwt.claims',${q(JSON.stringify({sub:owner,role,aal:'aal2'}))},true);SET LOCAL ROLE ${role};`;
const tx=(text,role='service_role')=>`BEGIN;SET LOCAL statement_timeout='8s';${claims(role)}${text}COMMIT;`;
const rpc=(call,role='service_role')=>json(tx('SELECT public.'+call+';',role));
const guest=(key,phone,name='مستلم الطلب',v1=false)=>v1
 ? `submit_guest_customer_order(${q(key)},${q(name)},${q(phone)},'إربد','الرمثا','حي الطلب','شارع الطلب',NULL,NULL,NULL,NULL,NULL,NULL,${j([{product_id:product,quantity:1}])},NULL,'cash_on_delivery','inside_ramtha')`
 : `submit_guest_customer_order_v2(${q(key)},repeat('a',64),repeat('b',64),${q(name)},${q(phone)},'إربد','الرمثا','حي الطلب','شارع الطلب',NULL,NULL,NULL,NULL,NULL,NULL,${j([{commercial_line_kind:'base_unit',product_id:product,base_quantity:1,expected_unit_price_in_minor_units:1000}])},NULL,'cash_on_delivery','inside_ramtha',1000,0,1000,2000)`;
const card=cid=>json(`SELECT jsonb_build_object('customer',(SELECT to_jsonb(c) FROM customers c WHERE id=${q(cid)}),'defaults',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM customer_addresses a WHERE customer_id=${q(cid)} AND is_default));`);
const money=async()=>{const p=await readApplicationFingerprint(executor);return Object.fromEntries(Object.entries(p.tables).filter(([name])=>/payment|ledger|cheque|settlement|cash_entr|expense|opening_balance/.test(name)));};
const pass=name=>{report.cases.push(name);console.log(name);};
const rawState=()=>readApplicationFingerprint(executor);
const order=oid=>json(`SELECT jsonb_build_object('order',to_jsonb(o),'address',to_jsonb(a),'items',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM order_items i WHERE order_id=o.id),'reservations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM order_inventory_reservations r WHERE order_id=o.id)) FROM orders o JOIN customer_addresses a ON a.id=o.customer_address_id WHERE o.id=${q(oid)};`);
async function blocked(){for(let n=0;n<100;n++){if(Number(await sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='guest220-waiter' AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0;"))>0)return;await new Promise(r=>setTimeout(r,40));}assert.fail('REAL_POSTGRES_BLOCKING_REQUIRED');}
async function hold(statement){
 await own();const p=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-q','-At','-v','ON_ERROR_STOP=1'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let output='',err='';
 const done=new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',c=>c===0?resolve(output):reject(Error(err)));});void done.catch(()=>undefined);
 const ready=new Promise((resolve,reject)=>{p.stdout.on('data',b=>{output+=b;if(output.includes('GUEST220_HELD'))resolve();});p.stderr.on('data',b=>err+=b);p.on('close',()=>reject(Error('GUEST220_HOLDER_CLOSED')));});
 p.stdin.write(`BEGIN;${statement};SELECT 'GUEST220_HELD';\n`);await ready;return async()=>{p.stdin.end('COMMIT;');await done;};
}
try{
 assert.equal((await exec('docker',['ps','-aq','--filter','name=^/'+container+'$'],{windowsHide:true})).stdout.trim(),'','DO_NOT_REUSE_OTHER_DATABASE');
 const boot=await exec(process.execPath,['scripts/testing/bootstrap-isolated-supabase.mjs'],{cwd:root,windowsHide:true,maxBuffer:16*1024**2,env:{...process.env,NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'219',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 local=JSON.parse(boot.stdout).isolatedProjectRoot;containerId=(await inspect()).Id;
 await sql("SELECT cron.alter_job(jobid,active:=false) FROM cron.job;ALTER TABLE public.orders DISABLE TRIGGER trg_notify_new_website_order_push;ALTER ROLE authenticated SET statement_timeout='8s';ALTER ROLE anon SET statement_timeout='3s';");
 await sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
 await rpc(`set_go_live_main_branch_v1(${q(branch)})`,'authenticated');
 await rpc(`open_cash_shift(${q(branch)},500000)`,'authenticated');
 await rpc(`create_direct_supplier_receipt_v2(p_supplier_id:=${q(id(301))},p_branch_id:=${q(branch)},p_warehouse_id:=${q(warehouse)},p_idempotency_key:='guest220-receipt',p_payment_method:='deferred',p_lines:=${j([{client_line_id:id(990),line_kind:'base_unit',commercial_quantity:100,base_unit_name:'باكيت',gross_amount_in_minor_units:20000,line_discount_in_minor_units:0,components:[{product_id:product,base_quantity:100}]}])})`,'authenticated');
 await rpc(`create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(id(401))},'عميل الدين','debt',${j([{commercial_line_kind:'base_unit',product_id:product,base_quantity:1,price_authority:'server_catalog',line_discount_in_minor_units:0}])},0,0,'guest220-existing-debt')`,'authenticated');
 await sql(`UPDATE customers SET governorate=NULL WHERE id IN(${q(id(401))},${q(id(402))});INSERT INTO customer_addresses(customer_id,governorate,city,area,is_default) VALUES(${q(id(401))},'إربد','الرمثا','العنوان المعتمد',true),(${q(id(403))},'إربد','الرمثا','عنوان قديم',true);`);
 const aclSql="SELECT jsonb_agg(jsonb_build_array(p.oid::text,p.proacl,p.proowner,p.prosecdef,p.provolatile,p.proconfig) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE '%guest%' OR p.proname LIKE '%create_customer_order%');";
 const acl=await json(aclSql),before=await rawState();await sql('BEGIN;'+await readFile(path.join(root,'docs/design/migration220/220_posthandover_read_performance.sql'),'utf8')+'COMMIT;');
 assert.deepEqual(await rawState(),before,'MIGRATION_MUST_NOT_REWRITE_ANY_EXISTING_ROW_OR_SEQUENCE');assert.deepEqual(await json(aclSql),acl,'EXISTING_GUEST_OWNER_ACL_PATH_VOLATILITY_EXACT');pass('candidate applies without rewriting219 rows/sequences or guest ACL');
 const moneyBefore=await money(),oldOrders=await json('SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM orders o;');
 for(const[n,v1]of [[401,false],[402,false],[403,true]]){
  const phone='0796600'+n,cid=id(n),beforeCard=await card(cid),key=randomUUID(),result=await rpc(guest(key,phone,'مستلم مستقل '+n,v1));assert.equal(result.success,true);
  const saved=await order(result.order_id);assert.equal(saved.order.customer_id,cid);assert.equal(saved.order.customer_name_snapshot,'مستلم مستقل '+n);assert.equal(saved.address.area,'حي الطلب');assert.equal(saved.address.is_default,false);assert.deepEqual(await card(cid),beforeCard,'EXISTING_CARD_AND_DEFAULT_EXACT');
  const afterFirst=await rawState();assert.equal((await rpc(guest(key,phone,'مستلم مستقل '+n,v1))).order_id,result.order_id);assert.deepEqual(await rawState(),afterFirst,'LOST_RESPONSE_REPLAY_HAS_ZERO_WRITES');
  assert.equal((await rpc(guest(key,phone,'اسم مختلف عند الاستئناف',v1))).order_id,result.order_id);assert.deepEqual(await rawState(),afterFirst,'REPLAY_CANNOT_CHANGE_RECIPIENT_SNAPSHOT_OR_CARD');
  pass(v1?'V1 compatibility existing master/type/default unchanged and replay stable':n===402?'missing existing governorate/default stays missing;delivery snapshot retained':'existing debtor master/default exact;order recipient snapshot independent');
 }
 const newPhone='0796600902',newKey=randomUUID(),releaseNew=await hold(claims()+'SELECT public.'+guest(newKey,newPhone,'مستلم أول'));
 const newPending=executeInput(executor,`SET application_name='guest220-waiter';`+tx('SELECT public.'+guest(randomUUID(),newPhone,'مستلم ثان')+';'));
 try{await blocked();}finally{await releaseNew();}assert.equal((await newPending).code,0);
 const concurrentNew=await json(`SELECT jsonb_build_object('customers',count(*),'name',min(full_name),'id',min(id::text)) FROM customers WHERE phone=${q(newPhone)};`);assert.equal(concurrentNew.customers,1);assert.equal(concurrentNew.name,'مستلم أول');
 assert.equal((await card(concurrentNew.id)).defaults.length,1);assert.equal(Number(await sql(`SELECT count(*) FROM orders WHERE customer_id=${q(concurrentNew.id)};`)),2);report.races.push({kind:'new-customer',postgresBlocking:true});
 const newOrder=await rpc(guest(randomUUID(),'0796600900','زبون جديد'));const newCard=await card(newOrder.customer_id);assert.equal(newCard.customer.full_name,'زبون جديد');assert.equal(newCard.defaults.length,1);assert.equal(newCard.defaults[0].id,newOrder.customer_address_id);pass('new customer still has original creation/default semantics');
 // A fault after creating the customer/address must roll back before resume.
 const interrupted=randomUUID();await sql(`CREATE FUNCTION public.guest220_fault() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $f$ BEGIN IF NEW.idempotency_key=${q(interrupted)} THEN RAISE EXCEPTION 'GUEST220_TEST_INTERRUPTION'; END IF;RETURN NEW;END $f$;CREATE TRIGGER guest220_fault AFTER INSERT ON orders FOR EACH ROW EXECUTE FUNCTION public.guest220_fault();`);
 const interruptedBefore=await rawState(),failed=await executeInput(executor,tx('SELECT public.'+guest(interrupted,'0796600901')+';'));assert.notEqual(failed.code,0);assert.match(failed.stderr,/GUEST220_TEST_INTERRUPTION/u);assert.deepEqual(await rawState(),interruptedBefore,'INTERRUPTED_CREATION_FULL_ROLLBACK');await sql('DROP TRIGGER guest220_fault ON orders;DROP FUNCTION public.guest220_fault();');
 const resumed=await rpc(guest(interrupted,'0796600901'));assert.equal(resumed.success,true);const resumedState=await rawState();assert.equal((await rpc(guest(interrupted,'0796600901'))).order_id,resumed.order_id);assert.deepEqual(await rawState(),resumedState);pass('mid-creation failure and same-key resume preserve atomicity and do not duplicate');
 for(const n of [504,505,506])await sql(`INSERT INTO customers(id,full_name,phone) VALUES(${q(id(n))},'بطاقة ثابتة',${q('0796600'+n)});INSERT INTO customer_addresses(customer_id,governorate,city,area,is_default) VALUES(${q(id(n))},'إربد','الرمثا','المعتمد',true);`);
 for(const[n,sameKey]of [[504,false],[505,true]]){
  const cid=id(n),beforeCard=await card(cid),key=randomUUID(),call1=guest(key,'0796600'+n,'مستلم أ'),call2=guest(sameKey?key:randomUUID(),'0796600'+n,sameKey?'مستلم أ':'مستلم ب');
  const release=await hold(claims()+'SELECT public.'+call1),pending=executeInput(executor,`SET application_name='guest220-waiter';`+tx('SELECT public.'+call2+';'));
  try{await blocked();}finally{await release();}const r=await pending;assert.equal(r.code,0,r.stderr);assert.deepEqual(await card(cid),beforeCard);assert.equal(Number(await sql(`SELECT count(*) FROM orders WHERE customer_id=${q(cid)};`)),sameKey?1:2);report.races.push({kind:sameKey?'same-key':'same-customer',postgresBlocking:true});
 }
 const editCid=id(506),release=await hold(`UPDATE customers SET full_name='اسم اعتمده المالك' WHERE id=${q(editCid)}`),pending=executeInput(executor,`SET application_name='guest220-waiter';`+tx('SELECT public.'+guest(randomUUID(),'0796600506')+';'));
 try{await blocked();}finally{await release();}assert.equal((await pending).code,0);assert.equal((await card(editCid)).customer.full_name,'اسم اعتمده المالك');report.races.push({kind:'owner-edit',postgresBlocking:true});pass('real blocked concurrent distinct orders,same-key replay,and owner edit preserve identity');
 assert.deepEqual(await money(),moneyBefore,'ALL_DEBT_LEDGER_PAYMENT_CHEQUE_CASH_ROWS_EXACT');const oldIds=oldOrders.map(x=>q(x.id)).join(',');assert.deepEqual(await json(`SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM orders o WHERE id IN(${oldIds});`),oldOrders,'EXISTING_ORDER_FINANCIAL_SNAPSHOTS_EXACT');
 const stock=await json(`SELECT to_jsonb(b) FROM inventory_balances b WHERE product_id=${q(product)} AND warehouse_id=${q(warehouse)};`);assert.equal(stock.on_hand_quantity,99);assert.equal(stock.reserved_quantity,15);pass('on-hand99 unchanged by guests,reservations15 exact;existing debt/ledger/snapshots unchanged');
 assert.equal(await sql('SELECT max(version) FROM supabase_migrations.schema_migrations;'),'219');assert.equal(await sql('SELECT count(*) FROM supabase_migrations.schema_migrations;'),'180');report.ok=true;
}catch(error){report.ok=false;report.error=error.message;process.exitCode=1;console.error(error.message);}
finally{if(local){await own();await exec(process.execPath,['node_modules/supabase/dist/supabase.js','stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true,maxBuffer:4*1024**2});report.databaseStopped=true;}await writeFile(path.join(out,'guest-identity220.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,out,cases:report.cases.length,races:report.races.length,databaseStopped:report.databaseStopped}));}
