// Feasibility proof only: existing215 sale/payment primitives, one local SQL
// transaction. This is NOT a delivered216 RPC or a UI atomicity claim.
import assert from 'node:assert/strict';import{execFile}from'node:child_process';import{promisify}from'node:util';import{mkdtemp,writeFile}from'node:fs/promises';import{tmpdir}from'node:os';import path from'node:path';import{randomUUID}from'node:crypto';
import{aftercare215Context}from'./aftercare215-context.mjs';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..'),output=await mkdtemp(path.join(tmpdir(),'nawasrah-partial216-primitives-')),project='nawasrah-tb215-test',cli=path.join(root,'node_modules/supabase/dist/supabase.js');let local;
const report={scope:'Existing215 primitive composition in one transaction;new216RPC still required',hostedAccess:false,output,cases:[],ok:false};
try{
 const boot=await exec(process.execPath,['scripts/testing/bootstrap-isolated-supabase.mjs'],{cwd:root,windowsHide:true,maxBuffer:32*1024**2,env:{...process.env,NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'215',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});local=JSON.parse(boot.stdout).isolatedProjectRoot;
 const c=aftercare215Context('supabase_db_'+project);await c.initialize();
 for(const method of ['cash','cliq']){
  const pid=randomUUID(),key=c.key();await c.sql(`INSERT INTO products(id,sku,name_ar,category_id,unit_id,purchase_unit_id,sale_unit_id,units_per_purchase_unit,units_per_sale_unit,sale_price_in_minor_units,default_sale_price_in_minor_units,cost_price_in_minor_units,wac_cost_in_minor_units_exact,is_active,is_flavor_master,parcel_only)SELECT ${c.q(pid)},${c.q('TC216-'+pid)},'صنف اختبار دفعة جزئية',category_id,unit_id,purchase_unit_id,sale_unit_id,10,10,100000,900000,0,0,true,false,false FROM products WHERE id=${c.q(c.id(103))};`);await c.receive(pid,10,500);
  const before=await c.facts(),balance=Number(await c.sql(`SELECT public.phase42_customer_receivable_total_internal(${c.q(c.id(401))});`));
  await c.sql(c.auth(`DO $test$ DECLARE s JSONB;p JSONB;BEGIN
   s:=public.create_pos_sale_v2(${c.q(c.warehouse)},${c.q(c.branch)},${c.q(c.id(401))},'عميل اختبار','debt',${c.j([{commercial_line_kind:'base_unit',product_id:pid,base_quantity:1,price_authority:'server_catalog',line_discount_in_minor_units:0}])},0,0,${c.q(key)});
   p:=public.record_customer_order_payment_once((s->>'orderId')::UUID,60000,${c.q(method)},'LOCAL216',NULL,${c.q('initial216-'+randomUUID())});
   IF (p->>'remaining_in_minor_units')::BIGINT<>40000 THEN RAISE EXCEPTION 'PARTIAL216_PRIMITIVE_DUE_MISMATCH';END IF;
  END $test$;`));
  const order=await c.json(`SELECT jsonb_build_object('id',id,'total',total_in_minor_units,'paid',amount_paid_in_minor_units,'status',payment_status) FROM orders WHERE idempotency_key=${c.q(key)};`);assert.equal(order.total,100000);assert.equal(order.paid,60000);assert.equal(order.status,'partially_paid');assert.equal(Number(await c.sql(`SELECT public.phase42_customer_receivable_total_internal(${c.q(c.id(401))});`))-balance,40000);assert.equal((await c.stock(pid)).quantity,9);
  const payment=await c.json(`SELECT jsonb_build_object('count',count(*),'sum',sum(amount_in_minor_units),'method',min(payment_method),'shift',bool_and(cash_shift_id IS NOT NULL))FROM customer_payments WHERE order_id=${c.q(order.id)};`);assert.equal(payment.count,1);assert.equal(payment.sum,60000);assert.equal(payment.method,method);assert.equal(payment.shift,true);
  report.cases.push({method,total:order.total,paid:order.paid,due:40000,stock:9,oneVoucher:true,shiftBound:true,financialFactsBefore:before,financialFactsAfter:await c.facts()});
 }
 report.ok=true;
}finally{if(local)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true,maxBuffer:8*1024**2});await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,output,methods:report.cases.map(x=>x.method),hostedAccess:false}));}
