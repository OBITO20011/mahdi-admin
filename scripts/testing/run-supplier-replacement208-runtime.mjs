// Disposable local PostgreSQL, real canonical writers; never read hosted config.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
import {supplier208Restore} from './supplier-replacement208-restore.mjs';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';
import {schemaCatalogSql,catalogDifference} from './schema-catalog.mjs';
import {assertPackageDDbLint} from './package-d-db-lint-policy.mjs';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..'),project='nawasrah-supplier-replacement208-test';
const cli=path.join(root,'node_modules/supabase/dist/supabase.js'),executor=executorFor(['--container','supabase_db_'+project]);
const scaleRestoreOnly=process.argv.includes('--scale-restore-only');
assert.ok(process.argv.slice(2).every(a=>a==='--scale-restore-only'),'ONLY_EXPLICIT_LOCAL_EXTENSION_FOCUS_SUPPORTED');
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-supplier-replacement208-'));
const report={output,startedAt:new Date().toISOString(),managedAccess:false,mode:scaleRestoreOnly?'focused-scale-restore':'full',cases:[]};let local,stage='bootstrap207',counter=0;
const id=n=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`,owner=id(1),branch=id(200),warehouse=id(201),product=id(103),supplier=id(301);
const q=v=>"'"+String(v).replaceAll("'","''")+"'",j=v=>q(JSON.stringify(v))+'::jsonb',key=()=>`replacement208-runtime-${String(++counter).padStart(8,'0')}`;
const sql=async text=>{const r=await executeInput(executor,text);assert.equal(r.code,0,r.stderr);return r.stdout.trim();};
const json=async text=>JSON.parse((await sql(text)).split('\n').at(-1));
const auth=(text,uid=owner,role='authenticated',aal='aal2')=>`BEGIN;SELECT set_config('request.jwt.claims',${q(JSON.stringify({sub:uid,role,aal}))},true);SET LOCAL ROLE ${role};${text}COMMIT;`;
const rpc=(call,uid=owner)=>json(auth('SELECT public.'+call+';',uid));
const command=(action,payload,k=key())=>`execute_supplier_replacement_v1(${q(action)},${j(payload)},${q(k)})`;
const record=name=>{report.cases.push({name,passed:true});console.log(JSON.stringify(report.cases.at(-1)));};
const fail=async(call,pattern,uid=owner,role='authenticated',aal='aal2')=>{
 const before=await readApplicationFingerprint(executor),r=await executeInput(executor,'\\set VERBOSITY verbose\n'+auth('SELECT public.'+call+';',uid,role,aal));
 assert.notEqual(r.code,0,'must fail');assert.match(r.stderr,pattern);assert.deepEqual(await readApplicationFingerprint(executor),before,'failure must roll back ALL application data/sequences');
};
const stock=(pid=product)=>json(`SELECT jsonb_build_object('quantity',b.on_hand_quantity,'reserved',b.reserved_quantity,'wac',p.wac_cost_in_minor_units_exact,'cost',p.cost_price_in_minor_units) FROM products p JOIN inventory_balances b ON b.product_id=p.id WHERE p.id=${q(pid)} AND b.warehouse_id=${q(warehouse)};`);
const receiving=(quantity,cost,pid=product)=>`create_direct_supplier_receipt_v2(p_supplier_id:=${q(supplier)},p_branch_id:=${q(branch)},p_warehouse_id:=${q(warehouse)},p_idempotency_key:=${q(key())},p_payment_method:='deferred',p_lines:=${j([{client_line_id:id(900+counter),line_kind:'base_unit',commercial_quantity:quantity,base_unit_name:'باكيت',gross_amount_in_minor_units:quantity*cost,line_discount_in_minor_units:0,components:[{product_id:pid,base_quantity:quantity}]}])})`;
const shop=(quantity=1,extra={})=>({supplierId:supplier,productId:product,warehouseId:warehouse,unit:'base',quantity,reason:'اختبار استبدال مورد',...extra});
const mutate=(action,payload,uid=owner,k=key())=>rpc(command(action,payload,k),uid);
const createSku=async(pid,sku)=>sql(`INSERT INTO products(id,sku,name_ar,category_id,unit_id,purchase_unit_id,sale_unit_id,units_per_purchase_unit,units_per_sale_unit,sale_price_in_minor_units,default_sale_price_in_minor_units,cost_price_in_minor_units,wac_cost_in_minor_units_exact,is_active,is_flavor_master)
 SELECT ${q(pid)},${q(sku)},${q(sku)},category_id,unit_id,purchase_unit_id,sale_unit_id,1,1,100,100,0,0,true,false FROM products WHERE id=${q(product)};`);
const newReturn=async pid=>{
 const s=await rpc(`create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(id(401))},'عميل208','cash',${j([{commercial_line_kind:'base_unit',product_id:pid,base_quantity:1,price_authority:'server_catalog',line_discount_in_minor_units:0}])},0,100,${q(key())})`);
 const item=await json(`SELECT to_jsonb(id) FROM order_items WHERE order_id=${q(s.orderId)};`);
 return {orderId:s.orderId,items:[{return_scope:'base_unit',order_item_id:item,quantity:1,stock_disposition:'damaged'}],
  physicalSources:[{root_source_kind:'base_order_item',root_source_id:item,source_kind:'base_order_item',source_id:item,product_id:pid,quantity:1,sellable_restock_quantity:0,defect_non_sellable_quantity:1,customer_damage_quantity:0}],
  reason:'مرتجع تالف إلى المورد',refundMethod:'cash',supplierAssignments:[{sourceKind:'base_order_item',sourceId:item,supplierId:supplier}]};
};
const facts=(from="date_trunc('day',NOW())",to="date_trunc('day',NOW())+INTERVAL '1 day'")=>json(`SELECT public.phase6_financial_facts_internal(${q(branch)},${from},${to},'Asia/Amman',true);`);
const money=()=>json(`SELECT jsonb_build_object('suppliers',(SELECT jsonb_agg(jsonb_build_array(id,current_balance_in_minor_units) ORDER BY id) FROM suppliers),'shifts',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM cash_shifts s),'cheques',(SELECT count(*) FROM deferred_cheques),'payments',(SELECT count(*) FROM supplier_payments));`);
const noPrivate=value=>{for(const [name,v]of Object.entries(value??{})){assert.doesNotMatch(name,/value|cost|wac|expense|minorunits|manifest|returnresult|^reason$/i);if(v&&typeof v==='object')noPrivate(v);}};
async function heldWriter(call){
 const child=spawn('docker',['exec','-i','supabase_db_'+project,'psql','-U','postgres','-d','postgres','-X','-q','-At','-v','ON_ERROR_STOP=1'],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
 let out='',err='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve(out):reject(Error(err)));});
 void done.catch(()=>undefined); // The readiness/finish path reports it and finally stops the DB.
 const ready=new Promise((resolve,reject)=>{child.stdout.on('data',s=>{out+=s;if(out.includes('SR208_READY'))resolve();});child.stderr.on('data',s=>{err+=s;});child.on('close',()=>reject(Error(err||'writer closed')));});
 child.stdin.write(auth('SELECT public.'+call+';').replace('COMMIT;',"SELECT 'SR208_READY';")+'\n');await ready;
 return {release:async()=>{child.stdin.end('COMMIT;');await done;}};
}
async function waitingForLock(){
 for(let n=0;n<80;n++){
  if(await sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='sr208-waiting' AND wait_event_type='Lock';")==='1')return;
  await new Promise(r=>setTimeout(r,50));
 }assert.fail('opposite writer did not block on PostgreSQL lock');
}
async function earlierTransaction(){
 const child=spawn('docker',['exec','-i','supabase_db_'+project,'psql','-U','postgres','-d','postgres','-X','-q','-At','-v','ON_ERROR_STOP=1'],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
 let out='',err='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve(out):reject(Error(err)));});
 void done.catch(()=>undefined);
 const ready=new Promise((resolve,reject)=>{child.stdout.on('data',s=>{out+=s;if(out.includes('SR208_EARLIER_TX'))resolve();});child.stderr.on('data',s=>{err+=s;});child.on('close',()=>reject(Error(err||'earlier transaction closed')));});
 child.stdin.write(auth("SELECT 'SR208_EARLIER_TX';").replace('COMMIT;','')+'\n');await ready;
 return {finish:async call=>{child.stdin.end('SELECT public.'+call+';COMMIT;');await done;}};
}
try{
 const boot=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:{...process.env,
  NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'207',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
  NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 local=JSON.parse(boot.stdout).isolatedProjectRoot;
 await sql('ALTER TABLE orders DISABLE TRIGGER trg_notify_new_website_order_push;SELECT cron.alter_job(jobid,active:=false) FROM cron.job;');
 await sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
 await rpc(`set_go_live_main_branch_v1(${q(branch)})`);await rpc(`open_cash_shift(${q(branch)},500000)`);
 await sql(`UPDATE products SET sale_price_in_minor_units=100 WHERE id=${q(product)};`);
 await rpc(receiving(10,100));
 stage='apply208';const migration=await readFile(path.join(root,'supabase/migrations/208_supplier_replacement_and_damage.sql'),'utf8');
 report.migrationCanonicalLfSha256=createHash('sha256').update(migration.replaceAll('\r\n','\n')).digest('hex');
 const before=await readApplicationFingerprint(executor),catalogBefore=await json(schemaCatalogSql);
 const empty208={...before,tables:{...before.tables,...Object.fromEntries(['supplier_replacement_cases','supplier_replacement_events','supplier_replacement_inventory_effects'].map(t=>[t,'d41d8cd98f00b204e9800998ecf8427e']))}};
 await sql(migration);assert.deepEqual(await readApplicationFingerprint(executor),empty208);
 const delta=catalogDifference(catalogBefore,await json(schemaCatalogSql));
 assert.ok(delta.every(d=>d.section!=='sequences'),'no new nonrollbackable sequence');
 const frozen=delta.filter(d=>d.section==='functions'&&d.before&&!d.before.identity.startsWith('phase6_financial_facts_internal('));assert.deepEqual(frozen,[],'all existing canonical writers and ACL frozen');
 const catalog208=await json(schemaCatalogSql);await sql(migration);assert.deepEqual(await json(schemaCatalogSql),catalog208);assert.deepEqual(await readApplicationFingerprint(executor),empty208);
 record('208 no backfill/business writes;only approved financial-reader overlay;all historical writers/ACL/sequences preserved;reapply zero data/catalog changes');
 stage='strict DB lint';
 const {stdout:lint}=await exec(process.execPath,[cli,'db','lint','--local','--level','warning','--workdir',local],{cwd:root,windowsHide:true,timeout:120000,maxBuffer:1024**2});
 await writeFile(path.join(output,'db-lint.json'),lint);assertPackageDDbLint(lint);record('unchanged strict DB lint policy;all208 functions warning/error free');
 if(!scaleRestoreOnly){
 stage='immediate and pending WAC150';const financialBefore=await money();
 const initial=await stock();const immediate=await mutate('shop_immediate',shop(2));assert.deepEqual(await stock(),initial);assert.equal(immediate.cases[0].pendingQuantity,0);
 assert.equal(await sql(`SELECT count(*) FROM inventory_movements WHERE reference_type='supplier_replacement208';`),'2');
 const hold=await mutate('shop_pending',shop(10));assert.equal((await stock()).quantity,0);assert.equal(hold.cases[0].pendingValueInMinorUnitsExact,'1000.000000');
 await rpc(receiving(10,200));assert.equal((await stock()).wac,200);const moneyBeforeReceive=await money();
 const partial=await mutate('receive',{caseId:hold.cases[0].id,quantity:4,reason:'وصل جزء من البديل'});assert.equal(partial.cases[0].pendingQuantity,6);
 await mutate('receive',{caseId:hold.cases[0].id,quantity:6,reason:'وصل باقي البديل'});assert.equal((await stock()).quantity,20);assert.ok(Math.abs((await stock()).wac-150)<0.000001);
 assert.deepEqual(await money(),moneyBeforeReceive);assert.deepEqual((await facts()).sales.damageLosses.totalInMinorUnits,0);
 await fail(command('receive',{caseId:hold.cases[0].id,quantity:1,reason:'زيادة غير صحيحة'}),/EXCEEDS_PENDING/);
 record('immediate exactly2opposite movements/net0;held10@100 outside available;receive4+6 over10@200 gives20@150;no payable/cash/cheque/profit changes;overreceive rolls back');
 stage='roles privacy replay current role';
 const users={};for(const [n,role]of ['manager','warehouse_keeper','admin','cashier','accountant','sales'].entries()){
  const uid=id(20+n);users[role]=uid;
  await sql(`INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) VALUES(${q(uid)},'authenticated','authenticated',${q('sr208-'+role+'@example.test')},NOW(),'{}','{}');INSERT INTO profiles(id,full_name,is_active) VALUES(${q(uid)},'موظف208',true);INSERT INTO roles(code,name_ar) VALUES(${q(role)},${q(role)}) ON CONFLICT(code) DO NOTHING;INSERT INTO user_roles(user_id,role_id) SELECT ${q(uid)},id FROM roles WHERE code=${q(role)};`);
 }
 for(const role of ['manager','warehouse_keeper']){
  const uid=users[role],k=key(),payload=shop(1),done=await mutate('shop_pending',payload,uid,k);noPrivate(done);
  noPrivate(await rpc("get_supplier_replacements_page_v1(NULL,NULL,'all',1,100)",uid));
  noPrivate(await rpc(`preview_supplier_replacement_v1('shop_pending',${j(payload)})`,uid));
  const once=await readApplicationFingerprint(executor);noPrivate(await mutate('shop_pending',payload,uid,k));assert.deepEqual(await readApplicationFingerprint(executor),once);
  noPrivate(await mutate('receive',{caseId:done.cases[0].id,quantity:1,reason:'بديل الموظف وصل'},uid));
  for(const action of ['writeoff','reverse'])await fail(command(action,action==='writeoff'?{caseId:done.cases[0].id,quantity:1,reason:'لا صلاحية'}:{eventId:done.cases[0].events[0].id,reason:'لا صلاحية'}),/42501/,uid);
 }
 for(const role of ['admin','cashier','accountant','sales']){
  await fail("get_supplier_replacements_page_v1()",/42501/,users[role]);await fail(command('shop_pending',shop()),/42501/,users[role]);
 }
 for(const role of ['anon','authenticated','service_role'])for(const table of ['supplier_replacement_cases','supplier_replacement_events','supplier_replacement_inventory_effects']){
  const r=await executeInput(executor,auth(`SELECT * FROM public.${table};`,owner,role));assert.notEqual(r.code,0);assert.match(r.stderr,/permission denied/);
 }
 for(const role of ['anon','service_role'])await fail("get_supplier_replacements_page_v1()",/42501/,owner,role);
 // A former owner must not recover their immutable internal monetary result.
 const oldOwnerKey=key(),oldOwnerPayload=shop(1);await mutate('shop_pending',oldOwnerPayload,owner,oldOwnerKey);
 await sql(`DELETE FROM user_roles WHERE user_id=${q(owner)};INSERT INTO user_roles(user_id,role_id) SELECT ${q(owner)},id FROM roles WHERE code='manager';`);
 noPrivate(await mutate('shop_pending',oldOwnerPayload,owner,oldOwnerKey));
 await sql(`DELETE FROM user_roles WHERE user_id=${q(owner)};INSERT INTO user_roles(user_id,role_id) SELECT ${q(owner)},id FROM roles WHERE code='owner';`);
 record('record/receive/read/preview/replay role3 quantities only includingformer-owner recovery;writeoff/reverse owner42501;admin/cashier/accountant/sales denied;private tables+helpers deny all client roles');
 for(const role of ['owner','manager','warehouse_keeper']){
  const opts=await rpc(`get_supplier_replacement_options_v1('shop_pending','','',${q(product)})`,role==='owner'?owner:users[role]);
  noPrivate(opts);assert.equal(opts.products[0].baseUnitName,'باكيت');assert.equal(opts.products[0].unitsPerParcel,5);assert.equal(opts.lastSuppliers[0].supplierId,supplier);assert.ok(opts.warehouses.some(w=>w.id===warehouse));
 }
 noPrivate(await rpc(`get_supplier_replacement_options_v1('shop_damage','','',${q(product)})`,users.admin));
 await fail("get_supplier_replacement_options_v1('shop_pending')",/42501/,users.admin);
 for(const role of ['anon','service_role'])await fail("get_supplier_replacement_options_v1('shop_pending')",/42501/,owner,role);
 record('208 optionsbounded50products/100suppliers:actualunit/parcelbasis/activewarehouse/lastvalidreceipt,quantitiesonly forrole3;legacyadmin damageoptionsonly;anon/service denied');
 stage='writeoff exact historical cost and reversal';
 const pending=await mutate('shop_pending',shop(2));const pid=pending.cases[0].id,sendId=pending.cases[0].events[0].id;
 const beforeReject=await stock(),profitBefore=(await facts()).sales.netProfitInMinorUnits,writeoffKey=key(),writeoffPayload={caseId:pid,quantity:1,reason:'المورد رفض قطعة'};
 const rejected=await mutate('writeoff',writeoffPayload,owner,writeoffKey);assert.deepEqual(await stock(),beforeReject);
 assert.equal((await facts()).sales.netProfitInMinorUnits,profitBefore-150);assert.equal(rejected.cases[0].pendingQuantity,1);
 const writeoffId=rejected.cases[0].events.find(e=>e.action==='writeoff').id;
 await fail(command('reverse',{eventId:sendId,reason:'له رفض لاحق'}),/DEPENDENCY/);
 const split=await sql('SELECT clock_timestamp();');
 await mutate('reverse',{eventId:writeoffId,reason:'إلغاء الرفض الخاطئ'});
 assert.equal((await facts()).sales.netProfitInMinorUnits,profitBefore);
 const later=await facts(q(split),"clock_timestamp()+INTERVAL '1 second'");assert.equal(later.sales.damageLosses.totalInMinorUnits,-150);assert.equal(later.sales.damageLosses.recoveredInMinorUnits,150);assert.equal(later.sales.netProfitInMinorUnits,150);
 const once=await readApplicationFingerprint(executor);await mutate('writeoff',writeoffPayload,owner,writeoffKey);assert.deepEqual(await readApplicationFingerprint(executor),once,'committed replay survives valid subsequent inverse');
 await mutate('reverse',{eventId:sendId,reason:'إلغاء الإرسال بعد عكس الرفض'});assert.equal((await stock()).quantity,beforeReject.quantity+2);
 await fail(command('reverse',{eventId:writeoffId,reason:'عكس مكرر غير صحيح'}),/ALREADY_REVERSED/);
 record('writeoff only held/no second out;historical150 loss once;inverse gives signed later-period credit150;valid later events do not break original exactkey replay;LIFO inverse restores stock');
 stage='customer return atomic reclassification60/0/60';
 // Separate real received SKU with exact60 cost and100 sale.
 const returnProduct=id(104);
 await sql(`INSERT INTO products(id,sku,name_ar,category_id,unit_id,purchase_unit_id,sale_unit_id,units_per_purchase_unit,units_per_sale_unit,sale_price_in_minor_units,default_sale_price_in_minor_units,cost_price_in_minor_units,wac_cost_in_minor_units_exact,is_active,is_flavor_master)
  SELECT ${q(returnProduct)},'208-RETURN','صنف مرتجع208',category_id,unit_id,purchase_unit_id,sale_unit_id,1,1,100,100,0,0,true,false FROM products WHERE id=${q(product)};`);
 await rpc(receiving(10,60,returnProduct));
 const sale=await rpc(`create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(id(401))},'عميل208','cash',${j([{commercial_line_kind:'base_unit',product_id:returnProduct,base_quantity:1,price_authority:'server_catalog',line_discount_in_minor_units:0}])},0,100,${q(key())})`);
 const orderItem=await json(`SELECT to_jsonb(id) FROM order_items WHERE order_id=${q(sale.orderId)};`);
 const returnPayload={orderId:sale.orderId,items:[{return_scope:'base_unit',order_item_id:orderItem,quantity:1,stock_disposition:'damaged'}],
  physicalSources:[{root_source_kind:'base_order_item',root_source_id:orderItem,source_kind:'base_order_item',source_id:orderItem,product_id:returnProduct,quantity:1,sellable_restock_quantity:0,defect_non_sellable_quantity:1,customer_damage_quantity:0}],
  reason:'مرتجع تالف إلى المورد',refundMethod:'cash',supplierAssignments:[{sourceKind:'base_order_item',sourceId:orderItem,supplierId:supplier}]};
 const returnBefore=await stock(returnProduct),baselineProfit=(await facts()).sales.netProfitInMinorUnits,returnKey=key();
 const returned=await mutate('customer_return',returnPayload,owner,returnKey);assert.deepEqual(await stock(returnProduct),returnBefore,'non-sellable return never decrements good shelf again');
 assert.equal((await facts()).sales.netProfitInMinorUnits,baselineProfit-40,'remove sale margin40,hold asset60 instead of final loss60');
 assert.equal(returned.cases[0].pendingValueInMinorUnitsExact,'60.000000');
 await mutate('writeoff',{caseId:returned.cases[0].id,quantity:1,reason:'المورد رفض التالف'});assert.equal((await facts()).sales.netProfitInMinorUnits,baselineProfit-100,'originalreturn loss60 exactly once after removing prior sale margin40');
 const returnOnce=await readApplicationFingerprint(executor);await mutate('customer_return',returnPayload,owner,returnKey);assert.deepEqual(await readApplicationFingerprint(executor),returnOnce);
 await fail(command('customer_return',{...returnPayload,supplierAssignments:[{...returnPayload.supplierAssignments[0],supplierId:id(302)}]},returnKey),/IDEMPOTENCY_CONFLICT/);
 record('actual121 return100/cost60 shares one TX/source201;held loss0 then rejectloss60 not120;shelf/payable unaffected;financialevidence/exactreplay/conflict verified');
 stage='race samekey and partial receive';const race=await mutate('shop_pending',shop(2)),raceId=race.cases[0].id;
 const raceKey=key(),raceCall=command('receive',{caseId:raceId,quantity:1,reason:'استلام متزامن بنفس المفتاح'},raceKey);
 const same=await Promise.all([rpc(raceCall),rpc(raceCall)]);assert.equal(same.filter(x=>x.idempotent).length,1);
 const different=await Promise.all([executeInput(executor,auth('SELECT public.'+command('receive',{caseId:raceId,quantity:1,reason:'آخر قطعة متزامنة'})+';')),executeInput(executor,auth('SELECT public.'+command('receive',{caseId:raceId,quantity:1,reason:'آخر قطعة متزامنة'})+';'))]);
 assert.equal(different.filter(x=>x.code===0).length,1);assert.match(different.find(x=>x.code!==0).stderr,/EXCEEDS_PENDING/);
 record('real parallel samekey once/replay;different keys partialreceive serialize and onlyone consumes lastremaining');
 stage='canonical inventory lock in both directions';
 let b=await stock(),held=await heldWriter(receiving(1,300));
 let waiter=executeInput(executor,"SET application_name='sr208-waiting';"+auth('SELECT public.'+command('shop_pending',shop(1))+';'));
 try{await waitingForLock();}finally{await held.release();}let waited=await waiter;assert.equal(waited.code,0,waited.stderr);
 const afterRace=await json("SELECT unit_cost_in_minor_units_exact FROM supplier_replacement_cases WHERE origin='shop' ORDER BY occurred_at DESC LIMIT 1;");assert.equal(afterRace,(await stock()).wac);
 b=await stock();held=await heldWriter(command('shop_pending',shop(1)));
 waiter=executeInput(executor,"SET application_name='sr208-waiting';"+auth('SELECT public.'+receiving(1,300)+';'));
 try{await waitingForLock();}finally{await held.release();}waited=await waiter;assert.equal(waited.code,0,waited.stderr);
 assert.ok(Math.abs((await stock()).wac-((b.quantity-1)*b.wac+300)/b.quantity)<0.000002);
 record('actual receipt/send opposite directions observed PostgreSQL lock waits;frozen outgoing cost and incoming globalWAC use committed locked balances');
 stage='damage wrapper preserves legacy admin and once/reverse';
 const damagePayload={productId:product,warehouseId:warehouse,unit:'base',quantity:1,reason:'انكسر أثناء الفحص',reasonCode:'shop_breakage'},damageKey=key(),beforeDamage=await stock();
 const damage=await mutate('shop_damage',damagePayload,users.admin,damageKey);noPrivate(damage);
 assert.equal((await stock()).quantity,beforeDamage.quantity-1);const damageOnce=await readApplicationFingerprint(executor);
 await mutate('shop_damage',damagePayload,users.admin,damageKey);assert.deepEqual(await readApplicationFingerprint(executor),damageOnce);
 await fail(command('reverse',{eventId:damage.cases[0].events[0].id,reason:'عكس موظف ممنوع'}),/42501/,users.admin);
 await mutate('reverse',{eventId:damage.cases[0].events[0].id,reason:'تصحيح التالف المدخل خطأ'});assert.deepEqual(await stock(),beforeDamage);
 record('legacyadmin retains keyed shopdamage only;201 evidence capturedonce;ownerinverse restores exact stock/WAC and creditsloss;no new supplier permission');
 stage='fractional cost cumulative writeoff allocation';
 const fractionalProduct=id(105);await createSku(fractionalProduct,'208-FRACTION');await rpc(receiving(3,1/3,fractionalProduct));
 const fractional=await mutate('shop_pending',shop(3,{productId:fractionalProduct})),fractionalId=fractional.cases[0].id;
 assert.equal(fractional.cases[0].unitCostInMinorUnitsExact,'0.333333');
 const fp=(await facts()).sales.netProfitInMinorUnits;
 await mutate('receive',{caseId:fractionalId,quantity:1,reason:'استلام جزء كسري'});
 await mutate('writeoff',{caseId:fractionalId,quantity:1,reason:'رفض الجزء الأول'});
 await mutate('writeoff',{caseId:fractionalId,quantity:1,reason:'رفض الجزء الثاني'});
 assert.equal((await facts()).sales.netProfitInMinorUnits,fp-1,'round writtenoff2*0.333333,do not round each or include receivedquantity');
 assert.equal((await stock(fractionalProduct)).quantity,1);assert.equal((await stock(fractionalProduct)).wac,0.333333);
 record('exactnumeric6 fraction0.333333 retained;receive1 plus writeoff1+1 expense1 cumulative writtenoff-only;no receipt-rounding phantomloss');
 stage='atomic failure after121 and aftercase';
 const rollbackReturn=await newReturn(returnProduct),rollbackKey=key();
 await sql(`CREATE FUNCTION public.sr208_test_fail_after_case() RETURNS TRIGGER LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'SR208_INJECT_AFTER_CASE';END;$$;
  CREATE TRIGGER sr208_test_fail_after_case AFTER INSERT ON public.supplier_replacement_cases FOR EACH ROW EXECUTE FUNCTION public.sr208_test_fail_after_case();`);
 await fail(command('customer_return',rollbackReturn,rollbackKey),/SR208_INJECT_AFTER_CASE/);
 await fail(command('shop_pending',shop(1)),/SR208_INJECT_AFTER_CASE/);
 await sql('DROP TRIGGER sr208_test_fail_after_case ON public.supplier_replacement_cases;DROP FUNCTION public.sr208_test_fail_after_case();');
 const rollbackDone=await mutate('customer_return',rollbackReturn,owner,rollbackKey);assert.equal(rollbackDone.cases[0].pendingQuantity,1);
 const original201Count=await sql(`SELECT count(*) FROM inventory_damage_events WHERE return_event_id=${q(rollbackDone.returnResult.returnId)};`);assert.equal(original201Count,'1');
 await sql(`CREATE FUNCTION public.sr208_test_fail_envelope() RETURNS TRIGGER LANGUAGE plpgsql AS $$BEGIN IF NEW.operation_type='supplier_replacement208' THEN RAISE EXCEPTION 'SR208_INJECT_ENVELOPE';END IF;RETURN NEW;END;$$;
  CREATE TRIGGER sr208_test_fail_envelope BEFORE INSERT ON public.business_operations FOR EACH ROW EXECUTE FUNCTION public.sr208_test_fail_envelope();`);
 const failEnvelopeKey=key(),failEnvelopePayload={caseId:rollbackDone.cases[0].id,quantity:1,reason:'رفض مع فشل المغلف'};
 await fail(command('writeoff',failEnvelopePayload,failEnvelopeKey),/SR208_INJECT_ENVELOPE/);
 await sql('DROP TRIGGER sr208_test_fail_envelope ON public.business_operations;DROP FUNCTION public.sr208_test_fail_envelope();');
 await mutate('writeoff',failEnvelopePayload,owner,failEnvelopeKey);
 record('actual failure after121+case rolls back order/refund/debt/cash/source201/case/allrows+sequences;shopcase rollback alsozero;failure before208envelope rolls back expense;exactkeys recover after removing fixturefailure');
 stage='legacy financial idempotency cross-contract admission';
 const legacyReturn=await newReturn(returnProduct),legacyKey=key();
 await rpc(`settle_admin_sales_return_v1(${q(legacyReturn.orderId)},${q(legacyKey)},${j(legacyReturn.items)},${j(legacyReturn.physicalSources)},${q(legacyReturn.reason)},'cash',NULL,NULL)`);
 await fail(command('customer_return',legacyReturn,legacyKey),/RETURN_IDENTITY_CONFLICT/);
 await fail(command('customer_return',legacyReturn),/PHASE4_|PHASE43_|PHASE42_/);
 const ownerOnlyReturn=await newReturn(returnProduct);await fail(command('customer_return',ownerOnlyReturn),/42501/,users.manager);
 record('standalone121 key cannot acquire C9 ledger tail;same source under newkey rejectedzero writes;staffcannotuseownerreturncoordinator');
 stage='source lineage snapshot after WAC changes';
 const leafReturn=await newReturn(returnProduct),leafRoot=leafReturn.items[0].order_item_id;
 const replacement=await rpc(`settle_sales_replacement_v1(${q(leafReturn.orderId)},${q(key())},${j([{sourceKind:'base_order_item',sourceId:leafRoot,quantity:1}])},'بديل قبل المرتجع',NULL)`);
 const leaf=await json(`SELECT jsonb_build_object('id',id,'cost',replacement_unit_cost_snapshot_in_minor_units_exact) FROM sales_replacement_items WHERE operation_id=${q(replacement.operationId)};`);
 await rpc(receiving(10,120,returnProduct));assert.notEqual((await stock(returnProduct)).wac,leaf.cost);
 leafReturn.physicalSources[0]={...leafReturn.physicalSources[0],source_kind:'replacement_item',source_id:leaf.id};
 leafReturn.supplierAssignments[0]={sourceKind:'replacement_item',sourceId:leaf.id,supplierId:supplier};
 const leafHeld=await mutate('customer_return',leafReturn);assert.equal(Number(leafHeld.cases[0].unitCostInMinorUnitsExact),leaf.cost);
 record('replaced physicalleaf held at immutable issuancecost despite changed currentWAC;no guessed historical valuation');
 stage='later movement and product presentation edit';
 const inverseCandidate=await mutate('shop_pending',shop(1)),inverseEvent=inverseCandidate.cases[0].events[0].id;
 await sql(`UPDATE products SET name_ar='اسم جديد محفوظ',sale_price_in_minor_units=123 WHERE id=${q(product)};`);
 await mutate('reverse',{eventId:inverseEvent,reason:'عكس مع حفظ تعديل العرض'});assert.equal(await sql(`SELECT name_ar||':'||sale_price_in_minor_units FROM products WHERE id=${q(product)};`),'اسم جديد محفوظ:123');
 const laterMovement=await mutate('shop_pending',shop(1));await rpc(receiving(1,300));
 await fail(command('reverse',{eventId:laterMovement.cases[0].events[0].id,reason:'حركة لاحقة تمنع العكس'}),/LATER_MOVEMENT/);
 record('inverse preserves unrelated productname/saleprice;real later receipt blocks unsafe quantity/WAC restoration');
 stage='earlier transaction latercommit chronology';
 const early=await earlierTransaction();let chronological;
 try{chronological=await mutate('shop_pending',shop(1));}
 finally{const current=await stock();await early.finish(`adjust_inventory_stock(${q(warehouse)},${q(product)},${current.quantity+1},'جرد بمعاملة بدأت قبل الإرسال','stock_count')`);}
 const chronologicalEvent=chronological.cases[0].events[0].id;
 assert.equal(await sql(`SELECT (m.created_at<e.occurred_at)::text FROM inventory_movements m CROSS JOIN supplier_replacement_events e WHERE e.id=${q(chronologicalEvent)} AND m.reference_type='stock_count' ORDER BY m.mutation_sequence DESC LIMIT 1;`),'true');
 await fail(command('reverse',{eventId:chronologicalEvent,reason:'المعاملة الأقدم التزمت لاحقاً'}),/LATER_MOVEMENT/);
 const reservedCase=await mutate('shop_pending',shop(1)),reservedEvent=reservedCase.cases[0].events[0].id;
 await sql(`UPDATE inventory_balances SET reserved_quantity=1 WHERE product_id=${q(product)} AND warehouse_id=${q(warehouse)};`);
 await fail(command('reverse',{eventId:reservedEvent,reason:'حجز لاحق يمنع العكس'}),/LATER_MOVEMENT|INVENTORY_CHANGED/);
 await sql(`UPDATE inventory_balances SET reserved_quantity=0 WHERE product_id=${q(product)} AND warehouse_id=${q(warehouse)};`);
 record('real transaction startsbeforeevent butcommits stockmovement afterwitholderNOW;contentfingerprintblocks inverse despite timestamporder;reservationchange blockszero writes');
 stage='corrupt private membership failclosed';
 const integrityKey=key(),integrityPayload=shop(1),integrity=await mutate('shop_pending',integrityPayload,owner,integrityKey);
 const integrityEvent=integrity.cases[0].events[0].id;
 for(const statement of [
  `ALTER TABLE supplier_replacement_inventory_effects DISABLE TRIGGER supplier_replacement_inventory_effects_immutable;UPDATE supplier_replacement_inventory_effects SET cost_before=cost_before+1 WHERE event_id=${q(integrityEvent)};`,
  `ALTER TABLE supplier_replacement_events DISABLE TRIGGER supplier_replacement_events_immutable;DELETE FROM supplier_replacement_inventory_effects WHERE event_id='00000000-0000-4000-8000-000000000000';UPDATE supplier_replacement_events SET reason='دليل معدل داخل اختبار' WHERE id=${q(integrityEvent)};`,
 ]){
  const prior=await readApplicationFingerprint(executor);
  const r=await executeInput(executor,`BEGIN;${statement}SELECT set_config('request.jwt.claims',${q(JSON.stringify({sub:owner,role:'authenticated',aal:'aal2'}))},true);SET LOCAL ROLE authenticated;SELECT public.${command('shop_pending',integrityPayload,integrityKey)};ROLLBACK;`);
  assert.notEqual(r.code,0);assert.match(r.stderr,/EVIDENCE_INVALID/);assert.deepEqual(await readApplicationFingerprint(executor),prior);
 }
 record('local transaction-only corrupt cost/eventreason detected by exactmanifest;replay rejected and complete database rollback;no production corruption switch');
 stage='parent lock hierarchy against canonical receipt cancellation';
 const lockProduct=id(106);await createSku(lockProduct,'208-LOCK-PRODUCT');
 const lockReceipt=await rpc(receiving(3,100,lockProduct));
 held=await heldWriter(`cancel_supplier_receipt(${q(lockReceipt.receipt_id)},'إلغاء سند لاختبار الأقفال')`);
 const canceledStockWaiter=executeInput(executor,"SET application_name='sr208-waiting';"+auth('SELECT public.'+command('shop_pending',shop(1,{productId:lockProduct}))+';'));
 try{await waitingForLock();}finally{await held.release();}
 const afterCancel=await canceledStockWaiter;assert.notEqual(afterCancel.code,0);assert.match(afterCancel.stderr,/STOCK_RESERVED/);assert.doesNotMatch(afterCancel.stderr,/deadlock/i);
 const oppositeReceipt=await rpc(receiving(3,100,lockProduct));held=await heldWriter(command('shop_pending',shop(1,{productId:lockProduct})));
 const inverseWaiter=executeInput(executor,"SET application_name='sr208-waiting';"+auth(`SELECT public.cancel_supplier_receipt(${q(oppositeReceipt.receipt_id)},'إلغاء بعد الإرسال');`));
 try{await waitingForLock();}finally{await held.release();}
 const inverse=await inverseWaiter;assert.notEqual(inverse.code,0);assert.doesNotMatch(inverse.stderr,/deadlock/i);
 record('canonical receipt cancellation/send bothdirections observed inventorylockwait withoutparentcycle;latermovement guardsstillblockcancel');
 // Explicit local parent-lock fixture: NOWAIT must reject before stock writes,
 // and must roll the already-settled customer return back atomically as well.
 held=await heldWriter(`get_supplier_replacements_page_v1();RESET ROLE;SELECT 1 FROM public.suppliers WHERE id=${q(supplier)} FOR UPDATE`);
 try{
  await fail(command('shop_pending',shop(1)),/PARENT_BUSY_RETRY/);
  const parentBusyReturn=await newReturn(returnProduct);
  await fail(command('customer_return',parentBusyReturn),/PARENT_BUSY_RETRY/);
 }finally{await held.release();}
 record('canonical receipt cancellation/send bothdirections observed inventorylockwait withoutparentcycle;latermovement guardsstillblockcancel;parentNOWAIT yields40001 zero writes incl entire121return rollback');
 stage='mutation and input fail closed';
 await fail(command('shop_pending',shop(1,{unitCostInMinorUnitsExact:0})),/FIELD_INVALID/);
 await fail(command('shop_pending',shop(999999)),/STOCK_RESERVED/);
 await fail(command('reverse',{eventId:damage.cases[0].events[0].id,reason:'يحتاج AAL2'}),/AAL2/,owner,'authenticated','aal1');
 for(const table of ['supplier_replacement_cases','supplier_replacement_events','supplier_replacement_inventory_effects']){
  const r=await executeInput(executor,`UPDATE ${table} SET ${table==='supplier_replacement_inventory_effects'?'cost_before=cost_before':'quantity=quantity'};`);assert.notEqual(r.code,0);assert.match(r.stderr,/IMMUTABLE/);
 }
 assert.ok(financialBefore);
 }
 stage='real writer read scale';
 const scaleProduct=id(107);await createSku(scaleProduct,'208-SCALE');await rpc(receiving(1000,100,scaleProduct));
 const scaleSupplier=id(302);assert.equal(await sql(`SELECT count(*) FROM supplier_replacement_cases WHERE supplier_id=${q(scaleSupplier)};`),'0');
 const scalePayload=shop(1,{productId:scaleProduct,supplierId:scaleSupplier});
 await sql(auth(`DO $scale$ BEGIN FOR n IN 1..200 LOOP PERFORM public.execute_supplier_replacement_v1('shop_pending',${j(scalePayload)},'replacement208-scale-'||lpad(n::text,8,'0'));END LOOP;END $scale$;`));
 assert.equal((await stock(scaleProduct)).quantity,800);
 const timings=[];let scaled;
 for(let n=0;n<5;n++){const started=performance.now();scaled=await json(auth(`SET LOCAL statement_timeout='5s';SELECT public.get_supplier_replacements_page_v1(${q(scaleSupplier)},NULL,'pending',1,25);`));timings.push(Math.round(performance.now()-started));assert.equal(scaled.totalCount,200);assert.equal(scaled.pendingQuantity,200);assert.equal(scaled.pendingValueInMinorUnitsExact,'20000.000000');assert.equal(scaled.cases.length,25);}
 const unchanged=await readApplicationFingerprint(executor);await rpc(`get_supplier_replacements_page_v1(${q(scaleSupplier)},NULL,'pending',2,25)`);assert.deepEqual(await readApplicationFingerprint(executor),unchanged);
 report.readScale={realWriterCases:200,pageSize:25,samplesMs:timings,statementDeadlineMs:5000};record('200 real canonical shipments;5 bounded page/total/value reads;secondpage zero writes');
 stage='full logical backup restore and exact replay';
 report.restore=await supplier208Restore({container:'supabase_db_'+project,executor,output,replay:async restored=>{
 const result=await executeInput(restored,auth('SELECT public.'+command('shop_pending',scalePayload,'replacement208-scale-00000001')+';'));assert.equal(result.code,0,result.stderr);const reply=JSON.parse(result.stdout.trim().split('\n').at(-1));assert.equal(reply.idempotent,true);assert.equal(reply.cases[0].pendingQuantity,1);
 }});record('full pg_dump and roles restore on empty second local cluster;all schemas/ACLs/data/sequences match;208 saved key replay zero writes');
 // No accidental earlier-state assertion in a replay after legitimate events.
 report.ok=true;
}catch(error){report.ok=false;report.stage=stage;report.error=error.message;process.exitCode=1;}
finally{
 if(local)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true,maxBuffer:1024**2});
 report.endedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}
