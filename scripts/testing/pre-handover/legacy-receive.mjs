import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {root,id,owner,branch,warehouse,supplier,product,q,j,sql,json,rpc,refused,save,assertLocal212} from './context.mjs';
const report={kind:'legacy-receive212',managedAccess:false,startedAt:new Date().toISOString(),cases:[]};
const facts=()=>json(`SELECT jsonb_build_object('quantity',(SELECT on_hand_quantity FROM inventory_balances WHERE product_id=${q(product)} AND warehouse_id=${q(warehouse)}),'wac',(SELECT wac_cost_in_minor_units_exact FROM products WHERE id=${q(product)}),'supplierDue',(SELECT current_balance_in_minor_units FROM suppliers WHERE id=${q(supplier)}),'receipts',(SELECT count(*) FROM supplier_receipts),'movements',(SELECT count(*) FROM inventory_movements),'operations',(SELECT count(*) FROM business_operations));`);
try{
 report.database=await assertLocal212();assert.equal(await sql('SELECT count(*) FROM auth.users;'),'0');
 await sql('ALTER TABLE orders DISABLE TRIGGER trg_notify_new_website_order_push;SELECT cron.alter_job(jobid,active:=false) FROM cron.job;');
 await sql((await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8')).replaceAll('صنف الكرتونة','صنف الطرد'));
 await rpc(`create_direct_supplier_receipt_v2(p_supplier_id:=${q(supplier)},p_branch_id:=${q(branch)},p_warehouse_id:=${q(warehouse)},p_idempotency_key:='audit-legacy-baseline-212',p_payment_method:='deferred',p_lines:=${j([{client_line_id:id(901),line_kind:'base_unit',commercial_quantity:10,base_unit_name:'باكيت',gross_amount_in_minor_units:10000,line_discount_in_minor_units:0,components:[{product_id:product,base_quantity:10}]}])})`);
 report.baseline=await facts();assert.equal(report.baseline.quantity,10);assert.equal(report.baseline.wac,1000);assert.equal(report.baseline.supplierDue,10000);
 report.call=`receive_inventory(${q(warehouse)},${q(product)},5,'purchase_order',${q(id(999))},'فحص مسار قديم بلا سند')`;
 assert.equal(await sql(`SELECT count(*) FROM purchase_orders WHERE id=${q(id(999))};`),'0');
 for(const [n,role]of ['owner','admin','manager','warehouse_keeper','cashier','accountant','viewer','none'].entries()){
  const uid=n===0?owner:id(800+n);if(n!==0)await sql(`INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) VALUES(${q(uid)},'authenticated','authenticated',${q(role+'@legacy-audit.example.test')},'{}','{}');INSERT INTO profiles(id,full_name,is_active) VALUES(${q(uid)},${q(role)},true);${role==='none'?'':`INSERT INTO roles(code,name_ar) VALUES(${q(role)},${q(role)}) ON CONFLICT(code) DO NOTHING;INSERT INTO user_roles(user_id,role_id) SELECT ${q(uid)},id FROM roles WHERE code=${q(role)};`}`);
  if(['owner','admin','manager','warehouse_keeper'].includes(role)){
   const before=await facts(),first=await rpc(report.call,uid),middle=await facts(),repeat=await rpc(report.call,uid),after=await facts();
   assert.equal(first.success,true);assert.equal(repeat.success,true);assert.equal(middle.quantity-before.quantity,5);assert.equal(after.quantity-before.quantity,10);assert.equal(after.supplierDue,before.supplierDue);assert.equal(after.receipts,before.receipts);assert.equal(after.operations,before.operations);assert.equal(after.wac,before.wac);assert.equal(after.movements-before.movements,2);
   report.cases.push({role,accepted:true,before,middle,after,referenceExists:false,repeatAddsAgain:true});
  }else report.cases.push({role,denial:await refused(report.call,/صلاحية|ROLE|42501|غير/,uid)});
 }
 for(const role of ['anon','service_role'])report.cases.push({role,denial:await refused(report.call,/permission denied/,owner,role)});
 report.confirmedFinding=true;report.ok=true;
}catch(e){report.ok=false;report.error=e.message;process.exitCode=1;}
finally{report.endedAt=new Date().toISOString();await save('legacy-receive',report);console.log(JSON.stringify({ok:report.ok,finding:report.confirmedFinding,error:report.error,cases:report.cases.length}));}
