import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sql,json,rpc,q,j,fingerprint,save,assertLocal212} from './context.mjs';
const owner='92900001-0000-4000-8000-000000000001',branch='92900010-0000-4000-8000-000000000002',warehouse='92900011-0000-4000-8000-000000000002',supplier='92900012-0000-4000-8000-000000000001',product='92700000-0000-4000-8000-000000000001';
const report={kind:'independent-cost-difference211-on212',managedAccess:false,startedAt:new Date().toISOString(),checks:[]};
const call=c=>rpc(c,owner),record=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);report.checks.push({name,actual,expected,passed:true});};
const profit=async()=> (await call(`get_operational_business_report(${q(branch)},CURRENT_DATE,CURRENT_DATE)`)).sales.netProfitInMinorUnits;
const money=()=>json(`SELECT jsonb_build_object('customerDue',(SELECT sum(total_in_minor_units-amount_paid_in_minor_units) FROM orders),'supplierDue',(SELECT sum(current_balance_in_minor_units) FROM suppliers),'drawer',(SELECT sum(expected_cash_in_minor_units) FROM cash_shifts));`);
const receive=(quantity,cost)=>call(`create_direct_supplier_receipt_v2(p_supplier_id:=${q(supplier)},p_branch_id:=${q(branch)},p_warehouse_id:=${q(warehouse)},p_idempotency_key:=${q(randomUUID())},p_payment_method:='deferred',p_lines:=${j([{client_line_id:randomUUID(),line_kind:'base_unit',commercial_quantity:quantity,base_unit_name:'باكيت',gross_amount_in_minor_units:quantity*cost,line_discount_in_minor_units:0,components:[{product_id:product,base_quantity:quantity}]}])})`);
try{
 await assertLocal212();
 await sql(`INSERT INTO products(id,sku,name_ar,category_id,unit_id,purchase_unit_id,sale_unit_id,units_per_purchase_unit,units_per_sale_unit,default_purchase_price_in_minor_units,default_sale_price_in_minor_units,cost_price_in_minor_units,sale_price_in_minor_units,wholesale_price_in_minor_units,min_stock_level,is_active,wac_cost_in_minor_units_exact) VALUES(${q(product)},'AUDIT-DIFF-211','فرق تكلفة البديل','92900003-0000-4000-8000-000000000001','92900002-0000-4000-8000-000000000001','92900002-0000-4000-8000-000000000001','92900002-0000-4000-8000-000000000001',1,1,0,2000,0,2000,2000,0,true,0);`);
 await receive(2,1000);
 const sale=await call(`create_pos_sale_v2(${q(warehouse)},${q(branch)},NULL,'فرق تكلفة','cash',${j([{commercial_line_kind:'base_unit',product_id:product,base_quantity:1,price_authority:'server_catalog',line_discount_in_minor_units:0}])},0,2000,${q(randomUUID())})`);
 await receive(1,2000);record('new WAC',await json(`SELECT to_jsonb(wac_cost_in_minor_units_exact) FROM products WHERE id=${q(product)};`),1500);
 const item=await json(`SELECT to_jsonb(id) FROM order_items WHERE order_id=${q(sale.orderId)};`),before=await profit(),beforeMoney=await money();
 const command=`execute_aftercare_supplier_v1('replacement_supplier',${q(randomUUID())},${j({orderId:sale.orderId,items:[{sourceKind:'base_order_item',sourceId:item,quantity:1}],reason:'فرق التكلفة المعتمد للمالك',supplierId:supplier})})`;
 const result=await call(command),held=result.cases[0];record('held historical cost',Number(held.unitCostInMinorUnitsExact),1000);record('only replacement cost difference hits profit while pending',before-await profit(),500);record('pending does not change drawer or debts',await money(),beforeMoney);
 const committed=await fingerprint();await call(command);record('pending replay all tables and sequences',await fingerprint(),committed);
 const pendingProfit=await profit(),reject=`execute_supplier_replacement_v1('writeoff',${j({caseId:held.id,quantity:1,reason:'رفض المورد البديل تاريخي التكلفة'})},${q(randomUUID())})`;
 await call(reject);record('refusal recognizes historical cost once',pendingProfit-await profit(),1000);record('total replacement loss',before-await profit(),1500);record('refusal does not change drawer or debts',await money(),beforeMoney);
 const refusedState=await fingerprint();await call(reject);record('refusal replay all tables and sequences',await fingerprint(),refusedState);report.ok=true;
}catch(e){report.ok=false;report.error=e.message;process.exitCode=1;}
finally{report.endedAt=new Date().toISOString();await save('cost-difference',report);console.log(JSON.stringify({ok:report.ok,error:report.error,checks:report.checks.length}));}
