import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {bridgeSql,assertFrozenFunctions} from './sales-only-phase1-bridges.mjs';
import {functionCatalogSql} from './sales-only-phase1-runtime.mjs';
import {commercialSql} from './sales-only-phase2-commercial.mjs';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';

export async function verifyGuestLifecycle(c,report){
 const {sql,json,rpc,id,q,j,executor}=c,branch=id(200),warehouse=id(201),pid=id(103);
 const lines=[{commercial_line_kind:'base_unit',product_id:pid,base_quantity:3,expected_unit_price_in_minor_units:1000}];
 const cases=[{method:'cash',paid:4000},{method:'cliq',paid:4000},{method:'debt',paid:0},{method:'cash',paid:500}];
 const projection=r=>Object.fromEntries(['status','payment_method','payment_status','total_in_minor_units','amount_paid_in_minor_units','remaining_in_minor_units'].map(k=>[k,r[k]]));
 await rpc(`create_direct_supplier_receipt_v2(p_supplier_id:=${q(id(301))},p_branch_id:=${q(branch)},p_warehouse_id:=${q(warehouse)},p_idempotency_key:=${q(randomUUID())},p_payment_method:='deferred',p_lines:=${j([{client_line_id:randomUUID(),line_kind:'base_unit',commercial_quantity:100,base_unit_name:'باكيت',gross_amount_in_minor_units:50000,line_discount_in_minor_units:0,components:[{product_id:pid,base_quantity:100}]}])})`);
 const fullShift=(await rpc(`open_cash_shift(${q(branch)},0)`)).id,fullResults=[];
 for(let i=0;i<cases.length;i++){
  const test=cases[i],phone='079660'+String(7000+i);
  const order=await rpc(`submit_guest_customer_order_v2(${q(randomUUID())},repeat('c',64),repeat('d',64),'كامل وهمي',${q(phone)},'إربد','الرمثا','حي وهمي','شارع وهمي',NULL,NULL,NULL,NULL,NULL,NULL,${j(lines)},NULL,'cash_on_delivery','inside_ramtha',3000,0,1000,4000)`,null,'service_role');
  await rpc(`accept_order_for_preparation(${q(order.order_id)},'مقارنة')`);await rpc(`update_order_status(${q(order.order_id)},'ready','مقارنة')`);
  const result=await rpc(`complete_website_order_with_settlement_v2(${q(order.order_id)},${q(randomUUID())},${q(test.method)},${test.paid},1000,${q(test.method==='cliq'?'FIXTURE-CLIQ':null)},'مقارنة')`);
  fullResults.push(projection(result));
 }
 const fullSummary=await rpc(`get_cash_shift_summary(${q(fullShift)})`);await rpc(`close_cash_shift(${q(fullShift)},${fullSummary.expectedCashInMinorUnits},NULL)`);
 const fullSnapshot=await rpc(`get_cash_shift_closing_report(${q(fullShift)})`),before=await json(functionCatalogSql),read=n=>readFile(new URL('../../docs/design/sales-only-phase'+n,import.meta.url),'utf8');
 await sql(`BEGIN;SELECT set_config('nawasrah.sales_lite1_test','OWNED_LOCAL_DB219',true);SELECT set_config('nawasrah.sales_lite2_test','OWNED_LOCAL_DB219',true);${await read('1/prototype.sql')}\n${bridgeSql(before)}\n${commercialSql(before)}\n${await read('2/pos-writer.sql')}\n${await read('2/guest-writer.sql')}\n${await read('2/operating-mode.sql')}\n${await read('2/guest-lifecycle.sql')}COMMIT;`);
 assertFrozenFunctions(before,await json(functionCatalogSql));
 assert.deepEqual(await rpc(`get_cash_shift_closing_report(${q(fullShift)})`),fullSnapshot);
 await rpc('lite1_set_mode2(false)');
 const inventory=()=>json(`SELECT jsonb_build_object('movements',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.inventory_movements x),'reservations',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.order_inventory_reservations x),'balances',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.inventory_balances x),'costs',(SELECT jsonb_agg(jsonb_build_array(id,cost_price_in_minor_units,wac_cost_in_minor_units_exact) ORDER BY id) FROM public.products));`);
 const stock=await inventory();const liteShift=(await rpc(`open_cash_shift(${q(branch)},0)`)).id;
 let sequence=0;
 const create=async()=>{
  const request={phoneHash:'c'.repeat(64),sessionHash:'d'.repeat(64),recipient:{fullName:'مبسّط وهمي',phone:'079660'+String(8000+ ++sequence),governorate:'إربد',city:'الرمثا',area:'حي وهمي',street:'شارع وهمي'},lines,promotionCode:null,paymentMethod:'cash_on_delivery',deliveryZone:'inside_ramtha',expectedQuote:{subtotalInMinorUnits:3000,discountInMinorUnits:0,deliveryFeeInMinorUnits:1000,totalInMinorUnits:4000}};
  return rpc(`lite1_guest2(${j(request)},${q(randomUUID())})`,null,'service_role');
 };
 const fail=async(call,re)=>{let error;try{await rpc(call);}catch(e){error=e;}assert.ok(error,'EXPECTED_LIFECYCLE_REFUSAL');assert.match(error.message,re);};
 const ready=async order=>{
  await rpc(`lite1_transition2(${q(order.order_id)},'preparing',${q(randomUUID())},'بدء التجهيز')`);
  const call=`lite1_transition2(${q(order.order_id)},'ready',${q(randomUUID())},'جاهز')`,result=await rpc(call);assert.deepEqual(await rpc(call),result);
 };
 for(let i=0;i<cases.length;i++){
  const test=cases[i],order=await create();await ready(order);
  const call=`lite1_complete2(${q(order.order_id)},${q(randomUUID())},${q(test.method)},${test.paid},1000,${q(test.method==='cliq'?'FIXTURE-CLIQ':null)},'تسليم')`;
  const result=await rpc(call);assert.deepEqual(projection(result),fullResults[i],'FULL_AND_LITE_COMPLETION_MONETARY_JSON_EQUAL');
  const fp=await readApplicationFingerprint(executor);assert.deepEqual(await rpc(call),result);assert.deepEqual(await readApplicationFingerprint(executor),fp);
  assert.equal(Number(await sql(`SELECT outstanding_total_in_minor_units FROM public.phase42_order_financial_position_internal(${q(order.order_id)});`)),4000-test.paid);
  assert.deepEqual(await inventory(),stock);
 }
 const liteSummary=await rpc(`get_cash_shift_summary(${q(liteShift)})`);
 for(const key of ['expectedCashInMinorUnits','cashSalesInMinorUnits','cliqSalesInMinorUnits','cashReceiptsInMinorUnits','cliqReceiptsInMinorUnits'])assert.equal(liteSummary[key],fullSummary[key],key);
 report.cases.push({name:'actual full vs litecash/CliQ/debt/partial delivery monetaryJSON anddrawer fields equal;unchanged historicfull close;replay zero writes',passed:true,comparisons:4});
 const cancelled=await create(),cancelCall=`lite1_cancel_guest2(${q(cancelled.order_id)},${q(randomUUID())},'إلغاء طلب وهمي')`;
 const cancel=await rpc(cancelCall);assert.equal(cancel.status,'cancelled');assert.deepEqual(await rpc(cancelCall),cancel);
 await fail(`lite1_transition2(${q(cancelled.order_id)},'preparing',${q(randomUUID())})`,/PHASE3_CUSTOMER_LIFECYCLE_INVALID/);
 const invalid=await create();await fail(`lite1_complete2(${q(invalid.order_id)},${q(randomUUID())},'cash',4000)`,/PHASE3_CUSTOMER_LIFECYCLE_INVALID/);
 await ready(invalid);await fail(`lite1_complete2(${q(invalid.order_id)},${q(randomUUID())},'cliq',4000)`,/PHASE3_CUSTOMER_SETTLEMENT_REFERENCE_REQUIRED/);
 await fail(`lite1_complete2(${q(invalid.order_id)},${q(randomUUID())},'cash',4001)`,/PHASE3_CUSTOMER_SETTLEMENT_INVALID/);
 const raceKey=randomUUID(),raceCall=`lite1_complete2(${q(invalid.order_id)},${q(raceKey)},'cash',4000)`;
 const pair=await Promise.all([rpc(raceCall),rpc(raceCall)]);assert.deepEqual(pair[0],pair[1]);
 assert.equal(Number(await sql(`SELECT count(*) FROM sales_lite1.completions WHERE order_id=${q(invalid.order_id)};`)),1);
 await fail(`lite1_cancel_guest2(${q(invalid.order_id)},${q(randomUUID())},'إلغاء متأخر')`,/PHASE3_CUSTOMER_LIFECYCLE_INVALID/);
 assert.deepEqual(await inventory(),stock);
 const monitor=await json('SELECT public.run_advanced_monitoring_checks();');assert.equal(monitor.integrityIssueCount,0,JSON.stringify(monitor));
 assertFrozenFunctions(before,await json(functionCatalogSql));
 report.cases.push({name:'cancel/replay+invalidstate/overcollection/CliQreference guards+completionrace oneproof;integrity0 andzero inventorycost',passed:true});
}
