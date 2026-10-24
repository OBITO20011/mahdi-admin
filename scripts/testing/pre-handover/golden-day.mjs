// New end-to-end audit scenario on the frozen212 database. Expected amounts are
// fixed before execution and never derived from the application's read models.
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {root,id,branch,warehouse,supplier,customer,product,q,j,key,sql,json,rpc,auth,fingerprint,save,assertLocal212,frozenSources,calls} from './context.mjs';
assert.equal(process.argv.length,2);
const report={kind:'golden-day212',startedAt:new Date().toISOString(),managedAccess:false,steps:[],checks:[],calls};
const a=id(101),b=id(102),family=id(100),only=id(110);let stage='baseline',shift;
const check=(name,expected,actual)=>report.checks.push({name,expected,actual,passed:isDeepStrictEqual(expected,actual)});
const step=(name,result)=>{report.steps.push({name,result});console.log(JSON.stringify({step:name}));};
const command=(action,payload,k=key(action))=>`execute_supplier_replacement_v1(${q(action)},${j(payload)},${q(k)})`;
const receive=(pid,quantity,cost)=>rpc(`create_direct_supplier_receipt_v2(p_supplier_id:=${q(supplier)},p_branch_id:=${q(branch)},p_warehouse_id:=${q(warehouse)},p_idempotency_key:=${q(key('receipt'))},p_payment_method:='deferred',p_lines:=${j([{client_line_id:id(901),line_kind:'base_unit',commercial_quantity:quantity,base_unit_name:'باكيت',gross_amount_in_minor_units:quantity*cost,line_discount_in_minor_units:0,components:[{product_id:pid,base_quantity:quantity}]}])})`);
const sale=(lines,method,paid)=>rpc(`create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(customer)},'عميل اليوم الذهبي',${q(method)},${j(lines.map(l=>({...l,price_authority:'server_catalog',line_discount_in_minor_units:0})))},0,${paid},${q(key('sale'))})`);
const base=(pid,n)=>({commercial_line_kind:'base_unit',product_id:pid,base_quantity:n});
const parcel=(pid,n,size)=>({commercial_line_kind:'legacy_single_sku_parcel',product_id:pid,parcel_quantity:n,units_per_parcel:size});
const item=order=>json(`SELECT to_jsonb(id) FROM order_items WHERE order_id=${q(order)};`);
const shop=(quantity)=>({supplierId:supplier,productId:product,warehouseId:warehouse,unit:'base',quantity,reason:'اليوم الذهبي للمورد'});
try{
 report.database=await assertLocal212();report.source=await frozenSources();
 assert.equal(await sql('SELECT count(*) FROM auth.users;'),'0','REQUIRES_FRESH_EMPTY_DATABASE');
 report.cronBefore=await json('SELECT coalesce(jsonb_agg(jsonb_build_object(\'name\',jobname,\'schedule\',schedule,\'active\',active)),\'[]\') FROM cron.job;');
 await sql('ALTER TABLE orders DISABLE TRIGGER trg_notify_new_website_order_push;SELECT cron.alter_job(jobid,active:=false) FROM cron.job;');
 await sql((await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8')).replaceAll('صنف الكرتونة','صنف الطرد'));
 await sql(`INSERT INTO products(id,sku,name_ar,category_id,unit_id,purchase_unit_id,sale_unit_id,units_per_purchase_unit,units_per_sale_unit,sale_price_in_minor_units,default_sale_price_in_minor_units,wholesale_price_in_minor_units,cost_price_in_minor_units,wac_cost_in_minor_units_exact,is_active,is_flavor_master,parcel_only)
 SELECT ${q(only)},'AUDIT-ONLY','شيبس طرد فقط',category_id,unit_id,purchase_unit_id,sale_unit_id,10,10,1500,15000,15000,0,0,true,false,true FROM products WHERE id=${q(product)};`);
 await rpc(`set_go_live_main_branch_v1(${q(branch)})`);
 await rpc(`record_customer_opening_balances_v1(${q(key('opening'))},${j([{customer_id:customer,amount_in_minor_units:'10000',original_debt_date:'2020-01-01'},{customer_id:id(402),amount_in_minor_units:'5000',original_debt_date:'2020-01-01'}])})`);
 stage='open';step(stage,await rpc(`open_cash_shift(${q(branch)},1000000)`));shift=await json(`SELECT to_jsonb(id) FROM cash_shifts WHERE branch_id=${q(branch)} AND status='open';`);
 stage='receipts';
 // The UI contract converts20 purchase parcels x5 to100 base units, gross50000.
 step('receive20parcels5units-at2500',await receive(product,100,500));
 step('receive100units-at1500-price-change',await receive(product,100,1500));
 for(const [pid,n,cost]of [[a,40,200],[b,40,200],[only,30,700]])step('receive-'+pid,await receive(pid,n,cost));
 check('receipt WAC1000 after equal quantities500/1500',1000,await json(`SELECT to_jsonb(wac_cost_in_minor_units_exact) FROM products WHERE id=${q(product)};`));
 const config=await rpc(`save_product_parcel_configuration_v1(${q(family)},'configurable_mix',true,5,ARRAY[${q(a)},${q(b)}]::uuid[])`);await rpc("set_configurable_parcel_feature_state_v1('ENABLED')");
 stage='sales';const cash=await sale([parcel(product,1,5)],'cash',4500);step('cash-parcel4500',cash);
 step('cliq-two-units2000',await sale([base(product,2)],'cliq',2000));
 const debt=await sale([base(product,3)],'debt',0);step('debt-three-units3000',debt);
 const mixed=await sale([{commercial_line_kind:'configurable_parcel',family_product_id:family,parcel_configuration_id:config.configuration.id,configuration_revision:config.configuration.configuration_revision,parcel_instances:[{components:[{product_id:a,base_quantity:2},{product_id:b,base_quantity:3}]}]}],'cash',5000);step('mixed-twoA-threeB5000',mixed);
 const onlySale=await sale([parcel(only,1,10)],'cash',15000);step('parcel-only15000',onlySale);
 stage='collections';step('unified-opening10000-order1000-cash',await rpc(`collect_customer_balance_v1(${q(customer)},11000,'cash',${q(branch)},'AUDIT-GOLD',NULL,${q(key('collection'))})`));
 step('order-payment500-cliq',await rpc(`record_customer_order_payment_once(${q(debt.orderId)},500,'cliq',NULL,NULL,${q(key('payment'))})`));
 const cheque=await rpc(`receive_customer_cheque_v1(${q(id(402))},${q(branch)},'بنك الاختبار','AUDIT-GOLD',CURRENT_DATE+2,5000,NULL,${q(key('cheque'))})`);step('cheque5000',cheque);
 step('bounced-cheque',await rpc(`return_deferred_cheque_v1(${q(cheque.cheque.id)},1,'شيك راجع للاختبار',${q(key('bounce'))})`));
 step('compensation2000cash',await rpc(`collect_customer_balance_v1(${q(id(402))},2000,'cash',${q(branch)},NULL,NULL,${q(key('compensation'))})`));
 stage='withdrawal-expense';const withdrawal=await rpc(`create_owner_cash_withdrawal_v1(${q(shift)},10000,'سحب مالك للاختبار',${q(key('withdraw'))})`);step('withdraw10000',withdrawal);
 step('return10000',await rpc(`reverse_owner_cash_withdrawal_v1(${q(withdrawal.withdrawalId)},'إرجاع سحب المالك',${q(key('return-withdrawal'))})`));
 step('expense3000',await rpc(`create_operational_expense(${q(branch)},'تشغيل','مصروف اليوم الذهبي',3000,'cash',NULL)`));
 stage='supplier-lifecycle';step('damage2-at1000',await rpc(command('shop_damage',{productId:product,warehouseId:warehouse,unit:'base',quantity:2,reasonCode:'shop_breakage',reason:'تلف اليوم الذهبي'})));
 step('immediate2-no-loss',await rpc(command('shop_immediate',shop(2))));
 const pending=await rpc(command('shop_pending',shop(4)));step('pending4',pending);
 step('partial-receive2',await rpc(command('receive',{caseId:pending.cases[0].id,quantity:2,reason:'وصل البديل من المورد'})));
 step('supplier-refuses1',await rpc(command('writeoff',{caseId:pending.cases[0].id,quantity:1,reason:'رفض المورد حبة واحدة'})));
 stage='whole-parcel-return-supplier';const onlyItem=await item(onlySale.orderId);
 step(stage,await rpc(command('customer_return',{orderId:onlySale.orderId,items:[{return_scope:'base_unit',order_item_id:onlyItem,quantity:10,stock_disposition:'damaged'}],physicalSources:[{root_source_kind:'base_order_item',root_source_id:onlyItem,source_kind:'base_order_item',source_id:onlyItem,product_id:only,quantity:10,sellable_restock_quantity:0,defect_non_sellable_quantity:10,customer_damage_quantity:0}],reason:'إرجاع الطرد كاملاً للمورد',refundMethod:'cash',supplierAssignments:[{sourceKind:'base_order_item',sourceId:onlyItem,supplierId:supplier}]})));
 stage='defective-unit-supplier';const cashItem=await item(cash.orderId),exchange={orderId:cash.orderId,items:[{sourceKind:'base_order_item',sourceId:cashItem,quantity:1}],reason:'حبة معيبة للمورد',supplierId:supplier};
 step(stage,await rpc(`execute_aftercare_supplier_v1('replacement_supplier',${q(key('exchange'))},${j(exchange)})`));
 stage='reclassify-final-damage';const final=await rpc(`settle_sales_replacement_v1(${q(cash.orderId)},${q(key('replace-final'))},${j(exchange.items)},'تالف نهائي مسجل',NULL)`);step('final-replacement',final);
 const sourceId=await json(`SELECT to_jsonb(id) FROM sales_replacement_items WHERE operation_id=${q(final.operationId)};`);
 const preview=await rpc(`preview_aftercare_supplier_v1('replacement',${q(sourceId)},${q(supplier)})`);
 step(stage,await rpc(`execute_aftercare_supplier_v1('reclassify_replacement',${q(key('reclassify'))},${j({sourceId,supplierId:supplier,reason:'تحويل التالف للمورد بمعاينة',previewFingerprint:preview.previewFingerprint})})`));
 stage='document-correction';const correctionSale=await sale([base(product,1)],'cash',1000);const correction=await rpc(`get_document_correction_preview('pos_sale',${q(correctionSale.orderId)})`);step('correction-preview',correction);
 step(stage,await rpc(`execute_document_correction_once(${q(correction.action)},${q(correction.recordId)},'تصحيح بيع مسجل بالخطأ',${q(key('correction'))},${q(correction.fingerprint)})`));
 stage='reconciliation';
 const finance=await rpc(`get_operational_business_report(${q(branch)},CURRENT_DATE,CURRENT_DATE)`),home=await rpc('get_home_dashboard()'),drawer=await rpc(`get_cash_shift_summary(${q(shift)})`);
 report.final={finance,home,drawer,inventory:await json(`SELECT jsonb_agg(jsonb_build_object('product',p.id,'quantity',b.on_hand_quantity,'wac',p.wac_cost_in_minor_units_exact) ORDER BY p.id) FROM products p JOIN inventory_balances b ON b.product_id=p.id WHERE b.warehouse_id=${q(warehouse)};`),customerA:await rpc(`get_customer_debt_aging(${q(customer)})`),customerB:await rpc(`get_customer_debt_aging(${q(id(402))})`),supplierDue:await json(`SELECT to_jsonb(current_balance_in_minor_units) FROM suppliers WHERE id=${q(supplier)};`),pending:await rpc('get_supplier_replacements_page_v1()')};
 report.expected={drawer:1019500,cliqReceived:2500,supplierDue:237000,customerADue:1500,customerBDue:3000,netProfit:-2500,stock:{[product]:184,[a]:38,[b]:37,[only]:20},pendingValue:10000,collections:{cashInMinorUnits:37500,cliqInMinorUnits:2500,bankTransferInMinorUnits:0,chequeInMinorUnits:5000,otherInMinorUnits:0,totalInMinorUnits:45000}};
 check('drawer',report.expected.drawer,drawer.expectedCashInMinorUnits);check('supplier debt',237000,report.final.supplierDue);check('net profit',-2500,finance.sales.netProfitInMinorUnits);check('today all receipts exactly once',report.expected.collections,home.summary.todayCollections);
 for(const [pid,qty]of Object.entries(report.expected.stock))check('inventory '+pid,qty,report.final.inventory.find(x=>x.product===pid)?.quantity);
 check('customer A legal debt',1500,report.final.customerA.total_in_minor_units);check('customer B bounced cheque debt',3000,report.final.customerB.total_in_minor_units);check('supplier pending historical value',10000,Number(report.final.pending.pendingValueInMinorUnitsExact));
 stage='close';step(stage,await rpc(`close_cash_shift(${q(shift)},1019500,NULL)`));
 stage='receipt-reprint';report.receipts=[];
 for(const saleId of [cash.orderId,mixed.orderId,onlySale.orderId]){
  const tokenResult=await rpc(`get_or_create_pos_receipt_token(${q(saleId)})`),token=tokenResult.receiptToken??tokenResult.receipt_token??tokenResult.token,before=await fingerprint();
  const first=await json(auth(`SET TRANSACTION READ ONLY;SELECT public.get_public_pos_receipt(${q(token)});`,null,'anon'));
  const second=await json(auth(`SET TRANSACTION READ ONLY;SELECT public.get_public_pos_receipt(${q(token)});`,null,'anon'));
  check('reprint stable '+saleId,first,second);check('reprint zero writes '+saleId,before,await fingerprint());report.receipts.push(first);
 }
 report.frozenAfter=await frozenSources();assert.equal(report.frozenAfter.sha256,report.source.sha256);report.completed=true;report.ok=report.checks.every(c=>c.passed);
}catch(error){report.completed=false;report.ok=false;report.failedStage=stage;report.error=error.message;process.exitCode=1;}
finally{report.endedAt=new Date().toISOString();await save('golden-day',report);console.log(JSON.stringify({completed:report.completed,ok:report.ok,failedStage:report.failedStage,error:report.error,steps:report.steps.length,checks:report.checks.length,mismatches:report.checks.filter(c=>!c.passed).map(c=>({name:c.name,expected:c.expected,actual:c.actual}))}));}
