import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {bridgeSql,assertFrozenFunctions} from './sales-only-phase1-bridges.mjs';
import {functionCatalogSql} from './sales-only-phase1-runtime.mjs';

// The caller binds every executor call to its own ID-checked, networkless219 DB.
export async function verifyPendingGuestBridge(c,report){
 const {sql,json,rpc,id,q,j}=c,product=id(103),branch=id(200),warehouse=id(201);
 const pass=(name,evidence)=>report.cases.push({name,passed:true,evidence});
 const observation="'2026-11-09T12:00:00Z'::timestamptz";
 const checksSql="SELECT COALESCE(jsonb_agg(jsonb_build_object('key',check_key,'status',status,'count',issue_count,'details',details) ORDER BY check_key),'[]') FROM public.advanced_monitoring_checks WHERE check_key LIKE 'integrity:%'";
 const snapshot=async()=>{const monitoring=await json(`SELECT public.run_advanced_monitoring_checks(${observation});`);return {monitoring,checks:await json(checksSql+';')};};
 const state=()=>json(`SELECT jsonb_build_object('orders',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.orders x),'items',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.order_items x),'reservations',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.order_inventory_reservations x),'balances',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.inventory_balances x),'movements',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.inventory_movements x),'customers',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.customers x));`);
 // Produce a real full pending reservation using the unchanged supported writer.
 await rpc(`create_direct_supplier_receipt_v2(p_supplier_id:=${q(id(301))},p_branch_id:=${q(branch)},p_warehouse_id:=${q(warehouse)},p_idempotency_key:='pending-full-receipt',p_payment_method:='deferred',p_lines:=${j([{client_line_id:id(999),line_kind:'base_unit',commercial_quantity:100,base_unit_name:'باكيت',gross_amount_in_minor_units:50000,line_discount_in_minor_units:0,components:[{product_id:product,base_quantity:100}]}])})`);
 const full=await rpc(`submit_guest_customer_order_v2('92600000-0000-4000-8000-000000009991',repeat('c',64),repeat('d',64),'طلب كامل وهمي','0796600403','إربد','الرمثا','حي وهمي','شارع وهمي',NULL,NULL,NULL,NULL,NULL,NULL,${j([{commercial_line_kind:'base_unit',product_id:product,base_quantity:2,expected_unit_price_in_minor_units:1000}])},NULL,'cash_on_delivery','inside_ramtha',2000,0,1000,3000)`,null,'service_role');
 assert.ok(full.order_id);
 const fullBefore=await state(),monitorBefore=await snapshot(),before=await json(functionCatalogSql);
 assert.equal(monitorBefore.monitoring.integrityIssueCount,0,JSON.stringify(monitorBefore));
 await sql(`BEGIN;SELECT set_config('nawasrah.sales_lite1_test','OWNED_LOCAL_DB219',true);${await readFile(new URL('../../docs/design/sales-only-phase1/prototype.sql',import.meta.url),'utf8')}\n${bridgeSql(before)}\nCOMMIT;`);
 assert.deepEqual(await state(),fullBefore,'FULL_PENDING_ALL_ROWS_IDENTICAL');
 const after=await snapshot();
 assert.deepEqual(after.checks.filter(x=>x.key!=='integrity:lite1:evidence'),monitorBefore.checks,'FULL_PENDING_MONITORING_JSON_IDENTICAL');
 assert.equal(after.monitoring.integrityIssueCount,0);
 assert.ok((fullBefore.reservations??[]).length>0,'REAL_FULL_RESERVATIONS_REQUIRED');
 pass('full pending: original amounts/rows/reservations and complete existing integrity JSON unchanged', {reservations:fullBefore.reservations.length,integrity:0});

 // Deliberate corruption is transaction-scoped to this owned, networkless DB.
 // Replica bypass is solely fixture injection, never a product execution path.
 for(const fakeLiteType of [false,true]){
  const result=await json(`BEGIN;SET LOCAL session_replication_role=replica;UPDATE public.inventory_balances SET reserved_quantity=reserved_quantity+1 WHERE warehouse_id=${q(warehouse)} AND product_id=${q(product)};UPDATE sales_lite1.mode SET full_accounting=false;${fakeLiteType?`UPDATE public.business_operations SET operation_type='lite1_guest' WHERE id=(SELECT operation_id FROM public.orders WHERE id=${q(full.order_id)});`:''}SET LOCAL session_replication_role=origin;SELECT public.run_advanced_monitoring_checks(${observation});SELECT jsonb_build_object('provenLite',sales_lite1.is_order(${q(full.order_id)}),'check',(SELECT jsonb_build_object('status',status,'count',issue_count) FROM public.advanced_monitoring_checks WHERE check_key='integrity:orders:reservations'));ROLLBACK;`);
  assert.equal(result.provenLite,false);assert.equal(result.check.status,'critical');assert.ok(result.check.count>0);
 }
 pass('full injected reservation defect remains critical while OFF, including forged lite operation without private context',{variants:2});
 await rpc(`cancel_customer_order_v2(${q(full.order_id)},'92600000-0000-4000-8000-000000009992','إلغاء fixture الكامل')`);
 await rpc('lite1_set_mode(false)');
 await sql('UPDATE public.storefront_settings SET inside_ramtha_delivery_fee_in_minor_units=0,outside_ramtha_delivery_fee_in_minor_units=0,minimum_order_in_minor_units=0;');
 const order=await rpc(`lite1_guest(${j({branchId:branch,warehouseId:warehouse,recipient:{name:'طلب وهمي معزول',phone:'0796600401',address:'عنوان وهمي'},lines:[{productId:product,quantity:2}]})},'approved-pending-lite')`,null,'service_role');
 const liteState=()=>json(`SELECT jsonb_build_object('status',o.status,'source',o.source,'released',o.reservation_released_at,'reservations',(SELECT count(*) FROM public.order_inventory_reservations WHERE order_id=o.id),'movements',(SELECT count(*) FROM public.inventory_movements WHERE reference_id=o.id),'costErrors',(SELECT count(*) FROM public.order_items i WHERE i.order_id=o.id AND(i.unit_cost_in_minor_units<>0 OR i.cogs_in_minor_units<>0 OR i.profit_in_minor_units<>0 OR i.cost_finalized_at IS NOT NULL OR i.exact_cogs_snapshot_in_minor_units IS NOT NULL OR i.unit_cost_snapshot_in_minor_units_exact IS NOT NULL))) FROM public.orders o WHERE o.id=${q(order.orderId)};`);
 const stages=[];
 const pending=await liteState();assert.equal(pending.status,'new');assert.equal(pending.source,'website');assert.equal(pending.released,null);
 for(const field of ['reservations','movements','costErrors'])assert.equal(pending[field],0);
 assert.equal((await snapshot()).monitoring.integrityIssueCount,0);stages.push(pending);
 // Exercise preparing inside a rolled-back fixture transaction. The phase1
 // completion writer intentionally accepts new only; do not alter it to test
 // this approved monitoring predicate. Phase2 lifecycle is a separate build.
 const preparing=await json(`BEGIN;UPDATE public.orders SET status='preparing' WHERE id=${q(order.orderId)};SELECT public.run_advanced_monitoring_checks(${observation});SELECT jsonb_build_object('status',(SELECT status FROM public.orders WHERE id=${q(order.orderId)}),'issues',(SELECT count(*) FROM public.advanced_monitoring_checks WHERE check_key LIKE 'integrity:%' AND status<>'healthy'));ROLLBACK;`);
 assert.equal(preparing.status,'preparing');assert.equal(preparing.issues,0);stages.push(preparing);
 const corrupt=await json(`BEGIN;SET LOCAL session_replication_role=replica;INSERT INTO public.order_inventory_reservations(operation_id,order_id,order_item_id,warehouse_id,product_id,reserved_quantity) SELECT o.operation_id,o.id,i.id,o.warehouse_id,i.product_id,1 FROM public.orders o JOIN public.order_items i ON i.order_id=o.id WHERE o.id=${q(order.orderId)};SET LOCAL session_replication_role=origin;SELECT public.run_advanced_monitoring_checks(${observation});SELECT jsonb_build_object('privateCount',sales_lite1.integrity_count(),'checks',(SELECT jsonb_object_agg(check_key,status) FROM public.advanced_monitoring_checks WHERE check_key IN('integrity:orders:reservations','integrity:lite1:evidence')));ROLLBACK;`);
 assert.ok(corrupt.privateCount>0);assert.equal(corrupt.checks['integrity:orders:reservations'],'critical');assert.equal(corrupt.checks['integrity:lite1:evidence'],'critical');
 pass('explicit illegal lite reservation is detected by both unchanged balance comparison and private evidence',corrupt);
 await rpc(`open_cash_shift(${q(branch)},0)`);await rpc(`lite1_complete(${q(order.orderId)},'approved-pending-complete')`);
 const completed=await liteState();assert.equal(completed.status,'completed');for(const f of ['reservations','movements','costErrors'])assert.equal(completed[f],0);
 assert.equal((await snapshot()).monitoring.integrityIssueCount,0);
 pass('lite new/preparing/completed all integrity0, no fabricated release timestamp, movement/reservation/cost',{stages:[...stages,completed]});
 const final=await json(functionCatalogSql);assertFrozenFunctions(before,final);
 const negative=structuredClone(final);negative.find(r=>r.name==='create_pos_sale_v2').source+=' ';
 assert.throws(()=>assertFrozenFunctions(before,negative),/FROZEN_SOURCE_CHANGED/);
 const bridgeNegative=structuredClone(final);bridgeNegative.find(r=>r.name==='run_advanced_monitoring_checks').source+=' ';
 assert.throws(()=>assertFrozenFunctions(before,bridgeNegative),/FROZEN_SOURCE_CHANGED/);
 pass('628 original bodies and636 declarations/ACL/config/owners pinned; exactly8 patches; unknown byte rejected in frozen writer and bridge',{originalFunctions:before.length,frozen:628,bridges:8});
}
