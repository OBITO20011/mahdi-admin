// Owner-approved 209. Disposable local database only; real writers and locks.
import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';
import {schemaCatalogSql,catalogDifference} from './schema-catalog.mjs';
import {assertPackageDDbLint} from './package-d-db-lint-policy.mjs';
import {parcel209Restore} from './parcel209-restore.mjs';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..'),project='nawasrah-parcel209-test',container='supabase_db_'+project;
assert.equal(process.argv.length,2,'NO_HOSTED_OR_OTHER_ARGUMENTS');
const cli=path.join(root,'node_modules/supabase/dist/supabase.js'),executor=executorFor(['--container',container]);
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-parcel209-runtime-')),report={output,managedAccess:false,cases:[],races:[]};
let local,stage='bootstrap208',counter=0;
const id=n=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`,owner=id(1),product=id(103),family=id(100),branch=id(200),warehouse=id(201);
const q=v=>v===null?'NULL':"'"+String(v).replaceAll("'","''")+"'",j=v=>q(JSON.stringify(v))+'::jsonb',key=()=>`parcel209-runtime-${String(++counter).padStart(10,'0')}`;
const sql=async t=>{const r=await executeInput(executor,t);assert.equal(r.code,0,r.stderr);return r.stdout.trim();},json=async t=>JSON.parse((await sql(t)).split('\n').at(-1));
const auth=(t,uid=owner,role='authenticated',app='parcel209-main')=>`BEGIN;SET LOCAL statement_timeout='20s';SET LOCAL application_name=${q(app)};SELECT set_config('request.jwt.claims',${q(JSON.stringify({sub:uid,role,aal:'aal2'}))},true);SET LOCAL ROLE ${role};${t}COMMIT;`;
const rpc=(call,uid=owner,role='authenticated')=>json(auth('SELECT public.'+call+';',uid,role));
const pass=name=>{report.cases.push({name,passed:true});console.log(JSON.stringify(report.cases.at(-1)));};
const fail=async(call,re,uid=owner,role='authenticated')=>{const before=await readApplicationFingerprint(executor),r=await executeInput(executor,auth('SELECT public.'+call+';',uid,role));assert.notEqual(r.code,0,'expected refusal');assert.match(r.stderr,re);assert.deepEqual(await readApplicationFingerprint(executor),before,'ALL public data and sequences unchanged');};
const pos=(line,amount,k=key())=>`create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(id(401))},'عميل209','cash',${j([{...line,price_authority:'server_catalog',line_discount_in_minor_units:0}])},0,${amount},${q(k)})`;
const base=(n=103,quantity=1)=>({commercial_line_kind:'base_unit',product_id:id(n),base_quantity:quantity});
const parcel=(n=103)=>({commercial_line_kind:'legacy_single_sku_parcel',product_id:id(n),parcel_quantity:1,units_per_parcel:5});
const edit=(n,value,{size='p.units_per_sale_unit',version='p.updated_at',fn='update_product_master_v5'}={})=>`${fn}(p.id,${version},p.sku,p.barcode,p.name_ar,p.description,p.category_id,p.brand_id,p.unit_id,p.purchase_unit_id,p.units_per_purchase_unit,p.default_purchase_price_in_minor_units,p.sale_unit_id,${size},p.default_sale_price_in_minor_units,p.cost_price_in_minor_units,p.min_stock_level,p.max_stock_level,p.is_active,NULL${fn.endsWith('v5')?','+value:''}) FROM products p WHERE p.id=${q(id(n))}`;
const guest=(line,subtotal,k=randomUUID(),phone='0796600888')=>`submit_guest_customer_order_v2(${q(k)},repeat('c',64),repeat('d',64),'عميل209',${q(phone)},'إربد','الرمثا','حي الاختبار','شارع الاختبار',NULL,NULL,NULL,NULL,NULL,NULL,${j([line])},NULL,'cash_on_delivery','inside_ramtha',${subtotal},0,1000,${subtotal+1000})`;
const replacement=(orderId,items,k=key())=>`settle_sales_replacement_v1(${q(orderId)},${q(k)},${j(items)},'بديل209',NULL)`;
const orderItem=orderId=>json(`SELECT to_jsonb(id) FROM order_items WHERE order_id=${q(orderId)};`);
const receipt=(pid=product)=>`create_direct_supplier_receipt_v2(p_supplier_id:=${q(id(301))},p_branch_id:=${q(branch)},p_warehouse_id:=${q(warehouse)},p_idempotency_key:=${q(key())},p_payment_method:='deferred',p_lines:=${j([{client_line_id:id(990),line_kind:'base_unit',commercial_quantity:100,base_unit_name:'باكيت',gross_amount_in_minor_units:20000,line_discount_in_minor_units:0,components:[{product_id:pid,base_quantity:100}]}])})`;
async function held(call,role='authenticated'){
 const child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-q','-At','-v','ON_ERROR_STOP=1'],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
 let out='',err='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve(out):reject(Error(err)));});void done.catch(()=>undefined);
 const ready=new Promise((resolve,reject)=>{child.stdout.on('data',s=>{out+=s;if(out.includes('PARCEL209_HELD'))resolve();});child.stderr.on('data',s=>{err+=s;});child.on('close',()=>reject(Error(err||'holder closed')));});
 child.stdin.write(auth('SELECT public.'+call+';',owner,role,'parcel209-holder').replace('COMMIT;',"SELECT 'PARCEL209_HELD';")+'\n');await ready;
 return {release:async()=>{child.stdin.end('COMMIT;');await done;}};
}
async function blocked(){
 for(let n=0;n<100;n++){
  if(await sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='parcel209-waiter' AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0;")==='1')return;
  await new Promise(r=>setTimeout(r,40));
 }assert.fail('real PostgreSQL blocking relationship not observed');
}
async function race(first,second,{role='authenticated',holderRole='authenticated',reject}={}){
 const holder=await held(first,holderRole),pending=executeInput(executor,auth('SELECT public.'+second+';',owner,role,'parcel209-waiter'));
 let atRelease;
 try{await blocked();}finally{await holder.release();atRelease=await readApplicationFingerprint(executor);}
 const result=await pending;
 if(reject){assert.notEqual(result.code,0);assert.match(result.stderr,reject);assert.deepEqual(await readApplicationFingerprint(executor),atRelease,'blocked refusal zero writes');}
 else assert.equal(result.code,0,result.stderr);
 report.races.push({blockedByPostgres:true,refused:Boolean(reject)});
}
try{
 const boot=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:{...process.env,NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'208',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});local=JSON.parse(boot.stdout).isolatedProjectRoot;
 await sql('ALTER TABLE orders DISABLE TRIGGER trg_notify_new_website_order_push;SELECT cron.alter_job(jobid,active:=false) FROM cron.job;');
 await sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));await rpc(`set_go_live_main_branch_v1(${q(branch)})`);await rpc(`open_cash_shift(${q(branch)},500000)`);
 for(const n of [101,102,103])await rpc(receipt(id(n)));
 const oldPosCall=pos(base(),1000),oldPos=await rpc(oldPosCall),oldItem=await orderItem(oldPos.orderId);
 const oldGuestCall=guest({...base(),expected_unit_price_in_minor_units:1000},1000,randomUUID(),'0796600866'),oldGuest=await rpc(oldGuestCall,owner,'service_role');
 stage='apply/replay209';
 const migration=await readFile(path.join(root,'supabase/migrations/209_product_sale_methods.sql'),'utf8');
 // Same complete oracle, excluding only the genuinely new column for this one pre/post comparison.
 const productData=()=>json("SELECT jsonb_agg(to_jsonb(p)-'parcel_only' ORDER BY id) FROM products p;"),before=await readApplicationFingerprint(executor),oldProducts=await productData(),catalog208=await json(schemaCatalogSql);
 await sql(migration);const after=await readApplicationFingerprint(executor);assert.deepEqual({...after,tables:{...after.tables,products:before.tables.products}},before);assert.deepEqual(await productData(),oldProducts);
 assert.equal(await sql('SELECT count(*) FROM products WHERE parcel_only;'),'0');
 const catalog209=await json(schemaCatalogSql),delta=catalogDifference(catalog208,catalog209);
 assert.ok(delta.every(d=>d.section!=='sequences'),'no sequence changes');
 const updated=new Set(['phase2_lock_inventory_products_internal','enforce_product_flavor_inheritance','sync_product_flavor_commercial_settings','product_edit_assert_version_internal','product_edit_snapshot_internal','create_product_flavor_v1','save_product_parcel_configuration_v1','phase3_validate_configurable_parcel_internal','create_pos_sale_v2','submit_guest_customer_order_v2','create_customer_order','settle_sales_replacement_v1','import_go_live_products_v1','get_admin_product_listing','get_admin_product_page','search_admin_products','get_admin_inventory_product_page','get_public_product_catalog','get_public_storefront_catalog_page','get_admin_sales_aftercare_context_v1']);
 assert.deepEqual(delta.filter(d=>d.section==='functions'&&d.before&&!updated.has(d.before.identity.split('(')[0])),[],'unrelated writers/ACL immutable');
 await sql(migration);assert.deepEqual(await json(schemaCatalogSql),catalog209);assert.deepEqual(await readApplicationFingerprint(executor),after);pass('208 business/history unchanged except false flag;explicit reviewed function delta;209 reapply zero catalog/data/sequence changes');
 stage='DB lint';const lint=await exec(process.execPath,[cli,'db','lint','--local','--level','warning','--workdir',local],{cwd:root,windowsHide:true,maxBuffer:1024**2,timeout:120000});await writeFile(path.join(output,'db-lint.json'),lint.stdout);assertPackageDDbLint(lint.stdout);pass('all209 functions strict local DB lint');
 stage='admission/replay';await rpc(edit(103,'true'));await rpc(edit(100,'true'));
 for(const quantity of [1,5,10])await fail(pos(base(103,quantity),quantity*1000),/PARCEL209_UNIT_SALE_FORBIDDEN/);
 const saved=await readApplicationFingerprint(executor);assert.deepEqual(await rpc(oldPosCall),oldPos);assert.equal((await rpc(oldGuestCall,owner,'service_role')).order_id,oldGuest.order_id);assert.deepEqual(await readApplicationFingerprint(executor),saved);pass('unit1/N/2N all denied without writes;committed208 POS/guest exact replay after activation');
 const ordinary=await rpc(pos(parcel(),4500));assert.equal(ordinary.success,true);
 await fail(`create_customer_order(p_customer_full_name:='قديم',p_customer_phone:='0796600999',p_items:=${j([{product_id:product,quantity:5}])})`,/PARCEL209_LEGACY_PARCEL_EVIDENCE_REQUIRED/);
 await fail(`submit_guest_customer_order(p_idempotency_key:=${q(randomUUID())},p_customer_full_name:='قديم',p_customer_phone:='0796600877',p_governorate:='إربد',p_city:='الرمثا',p_area:='حي الاختبار',p_street:='شارع الاختبار',p_items:=${j([{product_id:product,quantity:10}])})`,/PARCEL209_LEGACY_PARCEL_EVIDENCE_REQUIRED/,owner,'service_role');
 for(const quantity of [1,5,10])await fail(guest({...base(103,quantity),expected_unit_price_in_minor_units:900},900*quantity),/PARCEL209_UNIT_SALE_FORBIDDEN/,owner,'service_role');
 assert.ok((await rpc(guest({...parcel(),expected_unit_price_in_minor_units:4500},4500),owner,'service_role')).order_id);pass('proven POS/store parcel succeeds;legacy customer and service gateway cannot infer parcels;protected guest unit1/N/2N zero writes');
 await rpc(`accept_order_for_preparation(${q(oldGuest.order_id)},'قديم')`);await rpc(`update_order_status(${q(oldGuest.order_id)},'ready','قديم')`);assert.equal((await rpc(`complete_website_order_with_settlement_v2(${q(oldGuest.order_id)},${q(key())},'cash',2000,1000,NULL,'قديم')`)).success,true);pass('reserved208 unit order completes with original price/settlement after activation');
 await fail(replacement(oldPos.orderId,[{sourceKind:'base_order_item',sourceId:oldItem,quantity:1}]),/PARCEL209_REPLACEMENT_WHOLE_PARCEL_REQUIRED/);
 const regularReplacementCall=replacement(ordinary.orderId,[{sourceKind:'base_order_item',sourceId:await orderItem(ordinary.orderId),quantity:5}]),regularReplacement=await rpc(regularReplacementCall);assert.equal(regularReplacement.success,true);pass('old base-unit source replacement denied;actual stored ordinary parcel replacement accepted');
 const returnCall=`settle_admin_sales_return_v1(${q(oldPos.orderId)},${q(key())},${j([{return_scope:'base_unit',order_item_id:oldItem,quantity:1,stock_disposition:'restock'}])},${j([{root_source_kind:'base_order_item',root_source_id:oldItem,source_kind:'base_order_item',source_id:oldItem,product_id:product,quantity:1,sellable_restock_quantity:1,defect_non_sellable_quantity:0,customer_damage_quantity:0}])},'مرتجع بيع سابق','cash',NULL,NULL)`;
 const returned=await rpc(returnCall);assert.equal(returned.success,true);assert.equal(await sql(`SELECT money_refund_amount_in_minor_units FROM sales_return_events WHERE order_id=${q(oldPos.orderId)};`),'1000');
 const returnedOnce=await readApplicationFingerprint(executor);assert.deepEqual(await rpc(returnCall),returned);assert.deepEqual(await readApplicationFingerprint(executor),returnedOnce);pass('old208 unit return/refund retains original1000 after activation and price change;return replay zero writes');
 stage='mixed commercial evidence';
 const config=await rpc(`save_product_parcel_configuration_v1(${q(family)},'configurable_mix',true,5,ARRAY[${q(id(101))},${q(id(102))}]::UUID[])`);await rpc("set_configurable_parcel_feature_state_v1('ENABLED')");
 const mixedLine={commercial_line_kind:'configurable_parcel',family_product_id:family,parcel_configuration_id:config.configuration.id,configuration_revision:config.configuration.configuration_revision,parcel_instances:[{components:[{product_id:id(101),base_quantity:2},{product_id:id(102),base_quantity:3}]}]};
 const mixed=await rpc(pos(mixedLine,5000)),components=await json(`SELECT jsonb_agg(jsonb_build_object('id',c.id,'quantity',c.base_quantity) ORDER BY c.product_id) FROM order_parcel_components c JOIN order_parcel_instances i ON i.id=c.parcel_instance_id WHERE i.order_id=${q(mixed.orderId)};`),items=components.map(c=>({sourceKind:'parcel_component',sourceId:c.id,quantity:c.quantity}));
 await fail(replacement(mixed.orderId,items.slice(0,1)),/PARCEL209_REPLACEMENT_WHOLE_PARCEL_REQUIRED/);
 const mixedCall=replacement(mixed.orderId,items),mixedReplacement=await rpc(mixedCall);assert.equal(mixedReplacement.success,true);const once=await readApplicationFingerprint(executor);assert.deepEqual(await rpc(mixedCall),mixedReplacement);assert.deepEqual(await readApplicationFingerprint(executor),once);
 assert.ok((await rpc(`get_admin_sales_aftercare_context_v1(${q(mixed.orderId)})`)).parcelInstances[0].components.every(c=>c.parcelOnly));pass('mixed sale accepted;incomplete group rejected atomically;whole saved components accepted/replayed;aftercare current capability inherited');
 assert.deepEqual(await json(`SELECT jsonb_agg(parcel_only ORDER BY id) FROM products WHERE id IN (${q(family)},${q(id(101))},${q(id(102))});`),[true,true,true]);
 await fail(pos(base(101,5),5000),/PARCEL209_UNIT_SALE_FORBIDDEN/);
 assert.equal((await rpc(`get_public_storefront_catalog_page(p_product_ids:=ARRAY[${q(product)}]::UUID[])`)).items.find(p=>p.id===product).parcelOnly,true);assert.equal((await rpc(`search_admin_products(p_product_id:=${q(product)})`)).find(p=>p.id===product).parcel_only,true);pass('family leaves inherit flag;admin/barcode/public catalog deliver actual methods');
 stage='product mutation contracts';
 const cost=()=>json(`SELECT jsonb_build_object('cost',cost_price_in_minor_units,'wac',wac_cost_in_minor_units_exact) FROM products WHERE id=${q(product)};`),costBefore=await cost();
 const oldVersion=await json(`SELECT to_jsonb(updated_at) FROM products WHERE id=${q(product)};`);await rpc(edit(103,'NULL'));assert.equal(await sql(`SELECT parcel_only FROM products WHERE id=${q(product)};`),'t');await rpc(edit(103,'NULL',{fn:'update_product_master_v4'}));assert.equal(await sql(`SELECT parcel_only FROM products WHERE id=${q(product)};`),'t');assert.deepEqual(await cost(),costBefore);
 await fail(edit(103,'true',{size:'1'}),/PARCEL209_PARCEL_SIZE_REQUIRED/);await fail(edit(103,'false',{version:q(oldVersion)+'::timestamptz'}),/PRODUCT_EDIT_CONFLICT/);
 await rpc(edit(103,'false',{size:'1'}));assert.equal(await sql(`SELECT parcel_only OR units_per_sale_unit<>1 FROM products WHERE id=${q(product)};`),'f');await rpc(edit(103,'true',{size:'5'}));assert.deepEqual(await cost(),costBefore);pass('v4/v5 omission preserves flag;171 cost/WAC unchanged;CAS rejects stale;N1 invalid atomic;explicit unit-only and parcel-only transitions succeed');
 const create=(sku,flag,size=5)=>`create_product_with_opening_stock_v5(p_sku:=${q(sku)},p_name_ar:='طريقة البيع',p_category_id:=${q(id(11))},p_unit_id:=${q(id(10))},p_purchase_unit_id:=${q(id(10))},p_sale_unit_id:=${q(id(10))},p_units_per_sale_unit:=${size},p_default_sale_price_in_minor_units:=5000,p_parcel_only:=${flag})`;
 await fail(create('209-BAD','true',1),/PARCEL209_PARCEL_SIZE_REQUIRED/);
 for(const [n,role]of ['admin','manager','warehouse_keeper','cashier','accountant','sales','none'].entries()){
  const uid=id(30+n);await sql(`INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) VALUES(${q(uid)},'authenticated','authenticated',${q('parcel209-'+role+'@example.test')},NOW(),'{}','{}');INSERT INTO profiles(id,full_name,is_active) VALUES(${q(uid)},'صلاحية209',true);`);
  if(role!=='none')await sql(`INSERT INTO roles(code,name_ar) VALUES(${q(role)},${q(role)}) ON CONFLICT(code) DO NOTHING;INSERT INTO user_roles(user_id,role_id) SELECT ${q(uid)},id FROM roles WHERE code=${q(role)};`);
  if(['admin','manager','warehouse_keeper'].includes(role)){const created=await rpc(create('209-'+role,'true'),uid);assert.equal(created.parcelOnly,true);}
  else await fail(create('209-'+role,'true'),/صلاحية|FORBIDDEN|ROLE/,uid);
 }
 const acl=await json("SELECT COALESCE(jsonb_agg(jsonb_build_object('name',p.proname,'grantee',grantee::regrole::text) ORDER BY p.proname,grantee),'[]'::jsonb) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE n.nspname='public' AND p.proname LIKE 'parcel209_%' AND grantee<>p.proowner;");assert.deepEqual(acl,[]);pass('same four mutation roles;cashier/accountant/sales/no-role denied without writes;all new private helpers postgres-only');
 const createdFlavor=await rpc(`create_product_flavor_v1(${q(family)},'نكهة209',0,NULL,NULL,NULL)`);assert.ok(createdFlavor.success);assert.equal(await sql(`SELECT parcel_only FROM products WHERE flavor_master_product_id=${q(family)} AND flavor_name_ar='نكهة209';`),'t');pass('new flavor inherits root method under common lock');
 stage='optional import';
 const row=(sku,extra={})=>({sku,name_ar:'استيراد209',category_name:'اختبار اليوم',base_unit_name:'E-PACKET',purchase_unit_name:'E-PACKET',sale_unit_name:'E-PACKET',units_per_purchase_unit:'5',units_per_sale_unit:'5',sale_package_price_in_minor_units:'5000',purchase_package_price_in_minor_units:'1000',cost_per_base_unit_in_minor_units:'200',min_stock_level:'0',...extra});
 for(const extra of [{parcel_only:'نعم'},{parcel_only:null},{parcel_only:true,units_per_sale_unit:'1'}]){const rows=[row('209-INVALID',extra)],fp=await readApplicationFingerprint(executor),dry=await rpc(`import_go_live_products_v1(${q(key())},${j(rows)},true)`);assert.equal(dry.errors.length,1);assert.match(dry.errors[0].message,/PARCEL209_/);assert.deepEqual(await readApplicationFingerprint(executor),fp);await fail(`import_go_live_products_v1(${q(key())},${j(rows)},false)`,/GO_LIVE_BATCH_INVALID/);}
 const rows=[row('209-OMITTED'),row('209-TRUE',{parcel_only:true})],importCall=`import_go_live_products_v1(${q(key())},${j(rows)},false)`,imported=await rpc(importCall);assert.equal(imported.created.length,2);assert.deepEqual(await json("SELECT jsonb_agg(parcel_only ORDER BY sku) FROM products WHERE sku IN ('209-OMITTED','209-TRUE');"),[false,true]);const importedOnce=await readApplicationFingerprint(executor);assert.equal((await rpc(importCall)).idempotentReplay,true);assert.deepEqual(await readApplicationFingerprint(executor),importedOnce);pass('optional import missing false;boolean true;invalid/null/N1 same dry-run/save refusal;batch replay frozen zero writes');
 stage='real two-session activation races';
 // Each direction observes an actual pg_blocking_pids relationship, no timing inference.
 await rpc(edit(103,'false'));await race(edit(103,'true'),pos(base(),900),{reject:/PARCEL209_UNIT_SALE_FORBIDDEN/});
 await rpc(edit(103,'false'));const saleFirst=pos(base(),900);await race(saleFirst,edit(103,'true'));const soldBeforeActivation=await rpc(saleFirst);assert.ok(soldBeforeActivation.orderId);
 await rpc(edit(103,'false'));await race(edit(103,'true'),guest({...base(),expected_unit_price_in_minor_units:900},900,randomUUID(),'0796600777'),{role:'service_role',reject:/PARCEL209_UNIT_SALE_FORBIDDEN/});
 await rpc(edit(103,'false'));await race(guest({...base(),expected_unit_price_in_minor_units:900},900,randomUUID(),'0796600788'),edit(103,'true'),{holderRole:'service_role'});
 // A service transaction must hold the reservation while the owner waits.
 await rpc(edit(103,'false'));const replacementSource=await rpc(pos(base(),900)),sourceItems=[{sourceKind:'base_order_item',sourceId:await orderItem(replacementSource.orderId),quantity:1}];await race(edit(103,'true'),replacement(replacementSource.orderId,sourceItems),{reject:/PARCEL209_REPLACEMENT_WHOLE_PARCEL_REQUIRED/});
 await rpc(edit(103,'false'));await race(replacement(replacementSource.orderId,sourceItems),edit(103,'true'));
 pass('POS/reservation/replacement activation both directions serialized by real locks;activation-first unit admission zero writes;sale-first committed source survives');
 stage='family discovery race';
 const flavorCall=`create_product_flavor_v1(${q(family)},'نكهة سباق209',0,NULL,NULL,NULL)`;
 await race(flavorCall,edit(100,'true'),{reject:/PARCEL209_FAMILY_CHANGED_RETRY/});await rpc(edit(100,'true'));assert.equal(await sql(`SELECT bool_and(parcel_only) FROM products WHERE flavor_master_product_id=${q(family)};`),'t');await rpc(receipt(id(101)));pass('new flavor between discovery and lock causes40001 rather than late lock;fresh retry inherits methods;receiving base units remains allowed');
 stage='backup restore';report.restore=await parcel209Restore({container,executor,output,replay:async restored=>{for(const [call,expected]of [[oldPosCall,oldPos],[mixedCall,mixedReplacement],[regularReplacementCall,regularReplacement]]){const result=await executeInput(restored,auth('SELECT public.'+call+';'));assert.equal(result.code,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout.trim().split('\n').at(-1)),expected);}}});pass('full roles/catalog/all public rows/sequences logical restore;old sale and whole-parcel replacement exact zero-write replay');
 report.ok=true;
}catch(error){report.ok=false;report.stage=stage;report.error=error.message;process.exitCode=1;}
finally{if(local)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true,maxBuffer:1024**2});report.endedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
