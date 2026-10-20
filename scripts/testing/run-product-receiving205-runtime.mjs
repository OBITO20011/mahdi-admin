// Disposable local database; real receiving/payment/cancellation writers only.
// The explicitly labelled pre-v2 receipt fixture is read evidence,not a current writer.
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
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile),project='nawasrah-product-receiving205-test';
const cli=path.join(root,'node_modules/supabase/dist/supabase.js'),executor=executorFor(['--container','supabase_db_'+project]);
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-product-receiving205-')),report={output,startedAt:new Date().toISOString(),managedAccess:false,cases:[]};
const id=n=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`,owner=id(1),branch=id(200),warehouse=id(201),water=id(110),juice=id(111);
const q=v=>"'"+String(v).replaceAll("'","''")+"'",j=v=>q(JSON.stringify(v))+'::jsonb';let local,stage='bootstrap204',counter=0;
const sql=async input=>{const r=await executeInput(executor,input);assert.equal(r.code,0,r.stderr);return r.stdout.trim();};
const json=async input=>JSON.parse((await sql(input)).split('\n').at(-1));
const auth=(body,uid=owner,role='authenticated')=>`BEGIN;SELECT set_config('request.jwt.claims',${q(JSON.stringify({sub:uid,role,aal:'aal2'}))},true);SET LOCAL ROLE ${role};${body}COMMIT;`;
const rpc=(call,uid=owner)=>json(auth('SELECT public.'+call+';',uid));
const key=()=>`receiving205-runtime-${String(++counter).padStart(8,'0')}`;
const record=(name,details={})=>{const entry={name,passed:true,...details};report.cases.push(entry);console.log(JSON.stringify(entry));};
const contextCall=ids=>`get_receiving_purchase_context(ARRAY[${ids.map(q).join(',')}]::uuid[])`;
const contexts=ids=>rpc(contextCall(ids));
const detail=receipt=>rpc(`get_supplier_receipt_display_context(${q(receipt)})`);
try{
  const boot=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:{...process.env,
    NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'204',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
    NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
  local=JSON.parse(boot.stdout).isolatedProjectRoot;
  await sql("ALTER TABLE orders DISABLE TRIGGER trg_notify_new_website_order_push;SELECT cron.alter_job(jobid,active:=false) FROM cron.job;");
  await sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
  await rpc(`set_go_live_main_branch_v1(${q(branch)})`);await rpc(`open_cash_shift(${q(branch)},100000)`);
  for(const [n,name]of [[110,'مياه205'],[111,'عصير205'],[112,'بلا شراء205']])await sql(`INSERT INTO products(id,sku,name_ar,category_id,unit_id,purchase_unit_id,sale_unit_id,units_per_purchase_unit,units_per_sale_unit,default_purchase_price_in_minor_units,default_sale_price_in_minor_units,sale_price_in_minor_units,wholesale_price_in_minor_units,cost_price_in_minor_units,wac_cost_in_minor_units_exact,is_active) VALUES(${q(id(n))},${q('RECEIVING205-'+n)},${q(name)},${q(id(11))},${q(id(10))},${q(id(10))},${q(id(10))},10,10,3000,6000,600,600,0,0,true);`);
  const lines=[[110,200,100000],[111,50,20000]].map(([n,quantity,gross])=>({client_line_id:id(900+n),line_kind:'base_unit',commercial_quantity:quantity,base_unit_name:'باكيت',gross_amount_in_minor_units:gross,line_discount_in_minor_units:0,components:[{product_id:id(n),base_quantity:quantity}]}));
  const receipt=await rpc(`create_direct_supplier_receipt_v2(p_supplier_id:=${q(id(301))},p_branch_id:=${q(branch)},p_warehouse_id:=${q(warehouse)},p_idempotency_key:=${q(key())},p_payment_method:='deferred',p_lines:=${j(lines)})`);assert.equal(receipt.success,true);
  stage='apply readonly205';const beforeCatalog=await json(schemaCatalogSql),beforeData=await readApplicationFingerprint(executor);
  const migration=await readFile(path.join(root,'supabase/migrations/205_product_receiving_display_read_models.sql'),'utf8');await sql(migration);
  assert.deepEqual(await readApplicationFingerprint(executor),beforeData);
  const catalog=await json(schemaCatalogSql),diff=catalogDifference(beforeCatalog,catalog);
  assert.equal(diff.length,2);assert.ok(diff.every(d=>d.section==='functions'&&d.before===null));
  const expected=['get_receiving_purchase_context','get_supplier_receipt_display_context'];
  assert.deepEqual(diff.map(d=>d.after.identity.split('(')[0]).sort(),expected);
  const old=catalog.functions.find(f=>f.identity.startsWith('get_supplier_receipts_page('));
  for(const d of diff){assert.deepEqual(d.after.acl,old.acl);assert.equal(d.after.owner,'postgres');assert.deepEqual(d.after.configuration,['search_path=public, pg_temp']);assert.match(d.after.definition,/STABLE/u);assert.match(d.after.definition,/SECURITY DEFINER/u);}
  const initial=await contexts([water,juice,id(112)]),byId=Object.fromEntries(initial.products.map(p=>[p.productId,p.lastPurchase]));
  assert.deepEqual([byId[water].grossInMinorUnits,byId[water].baseQuantity],[100000,200]);assert.deepEqual([byId[juice].grossInMinorUnits,byId[juice].baseQuantity],[20000,50]);assert.equal(byId[id(112)],null);
  const display=await detail(receipt.receipt_id);assert.equal(display.lines.length,2);
  assert.deepEqual(display.lines.map(l=>[l.kind,l.commercialQuantity,l.unitsPerParcel,l.baseQuantity,l.grossInMinorUnits,l.components[0].currentSaleUnitPriceInMinorUnits]),[['base_unit',200,1,200,100000,600],['base_unit',50,1,50,20000,600]]);
  const state=await json(`SELECT jsonb_build_object('debt',(SELECT amount_due_in_minor_units FROM supplier_receipts WHERE id=${q(receipt.receipt_id)}),'paid',(SELECT amount_paid_in_minor_units FROM supplier_receipts WHERE id=${q(receipt.receipt_id)}),'prices',(SELECT jsonb_agg(jsonb_build_array(cost_price_in_minor_units,default_purchase_price_in_minor_units,sale_price_in_minor_units) ORDER BY id) FROM products WHERE id IN (${q(water)},${q(juice)})))`);
  assert.equal(state.debt,120000);assert.equal(state.paid,0);assert.deepEqual(state.prices,[[500,3000,600],[400,3000,600]]);
  record('actual water20x10 gross100000 and juice5x10 gross20000;physical200/50 and WAC500/400;defaults3000/sale600 unchanged;two readonly functions only',{receipt:receipt.receipt_id});
  stage='last PO and cancellation';
  const poLines=[{client_line_id:id(1900),line_kind:'base_unit',commercial_quantity:20,base_unit_name:'باكيت',gross_amount_in_minor_units:12000,line_discount_in_minor_units:1000,components:[{product_id:water,base_quantity:20}]}];
  const po=await rpc(`create_purchase_order_v2(p_supplier_id:=${q(id(302))},p_branch_id:=${q(branch)},p_warehouse_id:=${q(warehouse)},p_idempotency_key:=${q(key())},p_lines:=${j(poLines)})`);assert.equal(po.success,true);
  await rpc(`update_purchase_order_status(${q(po.purchase_order_id)},'sent')`);await rpc(`update_purchase_order_status(${q(po.purchase_order_id)},'approved')`);
  const poItem=await json(`SELECT jsonb_build_object('id',id) FROM purchase_order_items WHERE purchase_order_id=${q(po.purchase_order_id)} LIMIT 1;`);
  const received=await rpc(`receive_purchase_order_v2(p_purchase_order_id:=${q(po.purchase_order_id)},p_warehouse_id:=${q(warehouse)},p_idempotency_key:=${q(key())},p_lines:=${j([{...poLines[0],purchase_order_item_id:poItem.id}])})`);assert.equal(received.success,true);
  let last=(await contexts([water])).products[0].lastPurchase;assert.equal(last.source,'purchase_order');assert.equal(last.receiptId,received.receipt_id);assert.equal(last.grossInMinorUnits,12000);assert.equal(last.baseQuantity,20);
  const cancelled=await rpc(`cancel_purchase_receipt_v2(${q(received.receipt_id)},'اختبار205 إلغاء الاستلام')`);assert.equal(cancelled.success,true);
  last=(await contexts([water])).products[0].lastPurchase;assert.equal(last.receiptId,receipt.receipt_id);
  await sql(auth(`SELECT public.archive_supplier_receipt(${q(receipt.receipt_id)},true);`));assert.equal((await contexts([water])).products[0].lastPurchase.receiptId,receipt.receipt_id);
  record('last direct/PO evidence is ordered by actual receipt;gross beforediscount not WAC;cancelled PO excluded,archived completed direct retained');
  stage='explicit legacy display fixture';
  const legacy=id(2000),legacyItem=id(2001);
  // Historic document fixture only:no claim that direct table INSERT is a supported receiving writer.
  await sql(`INSERT INTO supplier_receipts(id,receipt_number,supplier_id,warehouse_id,branch_id,received_by,subtotal_in_minor_units,total_in_minor_units,amount_paid_in_minor_units,amount_due_in_minor_units,payment_status,payment_method,status,received_at) VALUES(${q(legacy)},'LEGACY205-20x10',${q(id(301))},${q(warehouse)},${q(branch)},${q(owner)},100000,100000,0,100000,'unpaid','deferred','completed',NOW()-INTERVAL '1 year');INSERT INTO supplier_receipt_items(id,supplier_receipt_id,product_id,purchase_unit_name,base_unit_name,package_quantity,units_per_package,total_base_units,package_price_in_minor_units,base_unit_cost_in_minor_units,line_total_in_minor_units) VALUES(${q(legacyItem)},${q(legacy)},${q(water)},'باكيت','باكيت',20,10,200,5000,500,100000);UPDATE products SET units_per_purchase_unit=24 WHERE id=${q(water)};`);
  const legacyDisplay=(await detail(legacy)).lines[0];assert.equal(legacyDisplay.kind,'legacy_single_sku_parcel');assert.deepEqual([legacyDisplay.commercialQuantity,legacyDisplay.unitsPerParcel,legacyDisplay.baseQuantity,legacyDisplay.grossInMinorUnits],[20,10,200,100000]);assert.equal((await detail(receipt.receipt_id)).lines[0].unitsPerParcel,1);
  record('labelled legacy20/N10 preserved after current productN24;canonical original20x10 not invented from product definition');
  stage='reader roles';const roles=['owner','admin','manager','accountant','warehouse_keeper','cashier','sales'];
  for(let i=0;i<roles.length+1;i++){
    const uid=id(20+i);await sql(`INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) VALUES(${q(uid)},'authenticated','authenticated',${q('receiving205-'+i+'@example.test')},NOW(),'{}','{}');INSERT INTO profiles(id,full_name,is_active) VALUES(${q(uid)},'قارئ205',true);`);
    if(i<roles.length)await sql(`INSERT INTO roles(code,name_ar) VALUES(${q(roles[i])},${q(roles[i])}) ON CONFLICT(code) DO NOTHING;INSERT INTO user_roles(user_id,role_id) SELECT ${q(uid)},id FROM roles WHERE code=${q(roles[i])};`);
  }
  const calls=[contextCall([water]),`get_supplier_receipt_display_context(${q(receipt.receipt_id)})`];
  for(let i=0;i<5;i++)for(const call of calls)await rpc(call,id(20+i));
  for(const uid of [id(25),id(26),id(27)])for(const call of calls){const denied=await executeInput(executor,'\\set VERBOSITY verbose\n'+auth('SELECT public.'+call+';',uid));assert.notEqual(denied.code,0);assert.match(denied.stderr,/P0001/u);assert.match(denied.stderr,/صلاحية/u);}
  for(const role of ['anon','service_role'])for(const call of calls){const denied=await executeInput(executor,'\\set VERBOSITY verbose\n'+auth('SELECT public.'+call+';',owner,role));assert.notEqual(denied.code,0);assert.match(denied.stderr,/42501/u);}
  record('same five receipt-reader roles;cashier/sales/norole rejected by existing guard;anon/service42501;no table grant changes');
  stage='validation/read-only/replay';
  const fingerprint=await readApplicationFingerprint(executor),finalCatalog=await json(schemaCatalogSql);
  for(const call of ["get_receiving_purchase_context(NULL)","get_receiving_purchase_context('{}'::uuid[])",`get_receiving_purchase_context(array_fill(${q(water)}::uuid,ARRAY[101]))`,`get_receiving_purchase_context(ARRAY[${q(water)}::uuid,NULL])`,'get_supplier_receipt_display_context(NULL)',`get_supplier_receipt_display_context(${q(id(9999))})`]){const bad=await executeInput(executor,auth('SELECT public.'+call+';'));assert.notEqual(bad.code,0);}
  assert.equal((await contexts([water,water])).products.length,1);
  for(let i=0;i<3;i++){await contexts([water,juice,id(112)]);await detail(receipt.receipt_id);}
  assert.deepEqual(await readApplicationFingerprint(executor),fingerprint);await sql(migration);assert.deepEqual(await json(schemaCatalogSql),finalCatalog);assert.deepEqual(await readApplicationFingerprint(executor),fingerprint);
  const {stdout:lint}=await exec(process.execPath,[cli,'db','lint','--local','--level','warning','--workdir',local],{cwd:root,windowsHide:true,timeout:120000,maxBuffer:1024**2});assertPackageDDbLint(lint);
  record('null/empty/oversize/nonexistent arguments rejected;duplicateIDs dedup;repeated reads andSQLreplay no appdata/sequence/catalog writes;existingDBlint');report.ok=true;
}catch(error){report.ok=false;report.stage=stage;report.error=error.message;process.exitCode=1;}
finally{if(local)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true,maxBuffer:1024**2});report.endedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
