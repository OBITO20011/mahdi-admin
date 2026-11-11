import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {bridgeSql,assertFrozenFunctions} from './sales-only-phase1-bridges.mjs';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';
import {returnPayload215} from './aftercare215-return-cases.mjs';
import {verifyModeTransition} from './sales-only-phase1-mode-race.mjs';

export const functionCatalogSql=`SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'name',p.proname,'source',p.prosrc,'definition',pg_get_functiondef(p.oid),'owner',p.proowner::regrole::text,'config',p.proconfig,'acl',p.proacl::text) ORDER BY p.oid::regprocedure::text) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public';`;
export async function verifyPhase1(c,report) {
 const {id,q,j,rpc,json,sql,fail}=c;let keyCounter=0;
 const key=()=>`lite1-proof-${String(++keyCounter).padStart(5,'0')}`;
 const pass=name=>{report.cases.push({name,passed:true});console.log(JSON.stringify({passed:name}));};
 const rows=await json(functionCatalogSql);
 assert.equal(Number(await sql('SELECT count(*) FROM supabase_migrations.schema_migrations;')),180);
 const branch=id(200),warehouse=id(201),product=id(103),customer=id(401);
 const fullCall=(method,k)=>`create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(customer)},'عميل اختبار',${q(method)},${j([{commercial_line_kind:'base_unit',product_id:product,base_quantity:10,price_authority:'server_catalog',line_discount_in_minor_units:0}])},0,10000,${q(k)})`;
 const receive=`create_direct_supplier_receipt_v2(p_supplier_id:=${q(id(301))},p_branch_id:=${q(branch)},p_warehouse_id:=${q(warehouse)},p_idempotency_key:=${q(key())},p_payment_method:='deferred',p_lines:=${j([{client_line_id:id(999),line_kind:'base_unit',commercial_quantity:1000,base_unit_name:'باكيت',gross_amount_in_minor_units:500000,line_discount_in_minor_units:0,components:[{product_id:product,base_quantity:1000}]}])})`;
 await rpc(receive);await rpc(`open_cash_shift(${q(branch)},500000)`);
 const full=[];
 for(const method of ['cash','cliq','debt']){const call=fullCall(method,key());full.push({call,result:await rpc(call)});}
 const partialCall=`create_pos_sale_with_initial_payment_v1(${q(warehouse)},${q(branch)},${q(customer)},'عميل اختبار',${j([{commercial_line_kind:'base_unit',product_id:product,base_quantity:10,price_authority:'server_catalog',line_discount_in_minor_units:0}])},0,4000,'cash',NULL,${q(key())})`;
 full.push({call:partialCall,result:await rpc(partialCall)});
 const fullItem=await json(`SELECT to_jsonb(id) FROM public.order_items WHERE order_id=${q(full[0].result.orderId)};`);
 const payload=returnPayload215({sale:full[0].result,item:fullItem,pid:product},{quantity:2,good:2,method:'cash'});
 const preview=await rpc(`preview_admin_sales_return_v2(${j(payload)})`);
 const retCall=`settle_admin_sales_return_v2(${j(payload)},${q(key())},${q(preview.previewFingerprint)})`;
 full.push({call:retCall,result:await rpc(retCall)});
 // Preserve the ACTUAL per-writer replay contract, including its existing flag:
 // plain POS replays its stored false flag; partial/return envelopes differ.
 // No assumed flag normalization or ignored JSON field is allowed.
 for(const f of full)f.replay=await rpc(f.call);
 const fullShift=await json(`SELECT to_jsonb(id) FROM public.cash_shifts WHERE status='open';`);
 await rpc(`create_operational_expense(${q(branch)},'كهرباء','مصروف اصطناعي',1000,'cash',NULL)`);
 const snap=`jsonb_build_object('facts',public.phase6_financial_facts_internal(${q(branch)},date_trunc('day',now())-interval '1 day',date_trunc('day',now())+interval '1 day','Asia/Amman',true),'summary',public.get_cash_shift_summary(${q(fullShift)}),'report',public._get_cash_shift_closing_report_before_snapshot(${q(fullShift)}),'debt',public.phase42_customer_receivable_total_internal(${q(customer)}),'positions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY o.id) FROM public.orders o CROSS JOIN LATERAL public.phase42_order_financial_position_internal(o.id) p))`;
 const before=await readApplicationFingerprint(c.executor);
 const core=await readFile(new URL('../../docs/design/sales-only-phase1/prototype.sql',import.meta.url),'utf8');
 await sql(`BEGIN;SELECT set_config('request.jwt.claims',${j({sub:id(1),role:'authenticated',aal:'aal2'})}::text,true);CREATE TEMP TABLE full_before_bridge AS SELECT ${snap} AS value;SELECT set_config('nawasrah.sales_lite1_test','OWNED_LOCAL_DB219',true);${core}\n${bridgeSql(rows)}\nDO $proof$BEGIN IF (SELECT value FROM full_before_bridge) IS DISTINCT FROM (${snap}) THEN RAISE EXCEPTION 'FULL_JSON_PARITY_FAILED';END IF;END $proof$;COMMIT;`);
 assert.deepEqual(await readApplicationFingerprint(c.executor),before,'ALL_EXISTING_TABLES_AND_SEQUENCES_IDENTICAL_AFTER_INSTALL');
 assertFrozenFunctions(rows,await json(functionCatalogSql));
 const negative=await json(functionCatalogSql),frozenWriter=negative.find(r=>r.name==='create_pos_sale_v2');frozenWriter.source+=' -- invalid';
 assert.throws(()=>assertFrozenFunctions(rows,negative),/FROZEN_SOURCE_CHANGED:create_pos_sale_v2/);
 const declarationNegative=await json(functionCatalogSql);declarationNegative.find(r=>r.name==='create_pos_sale_v2').definition=declarationNegative.find(r=>r.name==='create_pos_sale_v2').definition.replace('SECURITY DEFINER','SECURITY INVOKER');
 assert.throws(()=>assertFrozenFunctions(rows,declarationNegative),/FROZEN_DEFINITION_CHANGED:create_pos_sale_v2/);
 for(const f of full){const replay=await rpc(f.call);assert.deepEqual(replay,f.replay);}
 assert.deepEqual(await readApplicationFingerprint(c.executor),before,'FULL_REPLAY_AFTER_BRIDGES_WRITES_NOTHING');
 pass('full cash/CliQ/debt/partial/return: exact reader JSON and every existing row/sequence unchanged; writer replay and frozen function bytes/ACL/config/owner equal');
 // A NEW full-mode write traverses the new triggers without altering old money,
 // quantity or 500-fils WAC. UUIDs/document counters are new identities, not
 // misrepresented as byte-identical newly generated result JSON.
 const stockBefore=await json(`SELECT to_jsonb(b) FROM public.inventory_balances b WHERE product_id=${q(product)} AND warehouse_id=${q(warehouse)};`);
 const newFull=await rpc(fullCall('cash',key()));
 assert.equal(newFull.totalInMinorUnits,10000);
 const fullCost=await json(`SELECT jsonb_build_array(quantity,cogs_in_minor_units,unit_cost_in_minor_units,profit_in_minor_units) FROM public.order_items WHERE order_id=${q(newFull.orderId)};`);
 assert.deepEqual(fullCost,[10,5000,500,5000]);
 assert.equal(Number(await sql(`SELECT on_hand_quantity FROM public.inventory_balances WHERE product_id=${q(product)} AND warehouse_id=${q(warehouse)};`)),stockBefore.on_hand_quantity-10);
 const fullSummary=await rpc(`get_cash_shift_summary(${q(fullShift)})`);
 await rpc(`close_cash_shift(${q(fullShift)},${fullSummary.expectedCashInMinorUnits},NULL)`);
 const frozenReport=await rpc(`get_cash_shift_closing_report(${q(fullShift)})`);
 pass('new full write preserves 10000 sales/5000 COGS/5000 profit, -10 quantity and existing real close/snapshot');
 await verifyModeTransition(c,branch);
 pass('mode transition refuses NOWAIT during an in-flight full writer and refuses OFF after its open shift commits');
 await rpc('lite1_set_mode(false)');
 // This prototype intentionally implements pickup/zero-fee checkout only.
 // Reject a configured paid-delivery policy instead of silently waiving it.
 const narrowGuest={branchId:branch,warehouseId:warehouse,recipient:{name:'طلب تحقق معزول',phone:'0796600401',address:'عنوان وهمي'},lines:[{productId:product,quantity:1}]};
 await fail(`lite1_guest(${j(narrowGuest)},${q(key())})`,/LITE1_PAID_DELIVERY_REQUIRES_PHASE2/,null,'service_role');
 await sql('UPDATE public.storefront_settings SET inside_ramtha_delivery_fee_in_minor_units=0,outside_ramtha_delivery_fee_in_minor_units=0,minimum_order_in_minor_units=2000;');
 await fail(`lite1_guest(${j(narrowGuest)},${q(key())})`,/LITE1_MINIMUM_ORDER/,null,'service_role');
 await sql('UPDATE public.storefront_settings SET minimum_order_in_minor_units=0;');
 await sql("SELECT sales_lite1.assert_return_window('2026-11-01T00:00:00Z','2026-11-03T00:00:00Z');");
 await c.rejectSql("SELECT sales_lite1.assert_return_window('2026-11-01T00:00:00Z','2026-11-03T00:00:00.000001Z');",/PHASE4_RETURN_WINDOW_EXPIRED/);
 await c.rejectSql("SELECT sales_lite1.assert_return_window(NULL,clock_timestamp());",/PHASE4_RETURN_WINDOW_EXPIRED/);
 const inventorySnapshot=()=>json(`SELECT jsonb_build_object('movements',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.inventory_movements x),'reservations',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.order_inventory_reservations x),'balances',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.inventory_balances x),'costs',(SELECT jsonb_agg(jsonb_build_array(id,cost_price_in_minor_units,wac_cost_in_minor_units_exact) ORDER BY id) FROM public.products));`);
 const inventoryBefore=await inventorySnapshot();
 await rpc(`open_cash_shift(${q(branch)},10000)`);
 const liteShift=await json(`SELECT to_jsonb(id) FROM public.cash_shifts WHERE status='open';`);
 const sale=(method,quantity=10,extra={})=>({branchId:branch,warehouseId:warehouse,customerId:customer,method,lines:[{productId:product,quantity}],...extra});
 const create=async request=>{const k=key(),call=`lite1_pos(${j(request)},${q(k)})`,result=await rpc(call),fp=await readApplicationFingerprint(c.executor);assert.deepEqual(await rpc(call),result);assert.deepEqual(await readApplicationFingerprint(c.executor),fp);return result;};
 const cash=await create(sale('cash')),cliq=await create(sale('cliq')),debt=await create(sale('debt')),partial=await create(sale('partial',10,{paid:4000,initialMethod:'cash'}));
 assert.equal(cliq.amountPaidInMinorUnits,10000);
 assert.equal(partial.amountPaidInMinorUnits,4000);
 assert.equal(Number(await sql(`SELECT outstanding_total_in_minor_units FROM public.phase42_order_financial_position_internal(${q(partial.orderId)});`)),6000);
 pass('lite cash/CliQ/debt/partial share real orders/customer_payments; exact 10000/4000/6000 and zero-write replay');
 await rpc(`lite1_set_available(${q(product)},false,0)`);
 await fail(`lite1_pos(${j(sale('cash'))},${q(key())})`,/LITE1_UNAVAILABLE_CONFIRM_REQUIRED/);
 const override=await create(sale('cash',1,{unavailableConfirmed:[product]}));assert.deepEqual(override.unavailableConfirmed,[product]);
 assert.deepEqual(await json(`SELECT to_jsonb(unavailable_confirmed) FROM sales_lite1.orders WHERE order_id=${q(override.orderId)};`),[product]);
 await fail(`lite1_set_available(${q(product)},true,0)`,/LITE1_AVAILABILITY_STALE/);
 const guest={branchId:branch,warehouseId:warehouse,recipient:{name:'مستلم اصطناعي','phone':'0796600401',address:'عنوان الطلب فقط'},lines:[{productId:product,quantity:2}]};
 await fail(`lite1_guest(${j(guest)},${q(key())})`,/LITE1_UNAVAILABLE_CONFIRM_REQUIRED/,null,'service_role');
 await rpc(`lite1_set_available(${q(product)},true,1)`);
 const customerBefore=await json(`SELECT to_jsonb(c) FROM public.customers c WHERE id=${q(customer)};`);
 const guestKey=key(),guestCall=`lite1_guest(${j(guest)},${q(guestKey)})`,order=await rpc(guestCall,null,'service_role');
 assert.deepEqual(await rpc(guestCall,null,'service_role'),order);
 assert.deepEqual(await json(`SELECT to_jsonb(c) FROM public.customers c WHERE id=${q(customer)};`),customerBefore);
 await rpc(`lite1_complete(${q(order.orderId)},${q(key())})`);
 const guestItem=await json(`SELECT to_jsonb(id) FROM public.order_items WHERE order_id=${q(order.orderId)};`);
 // Refused by quantity before changing any money; also checks a guest's real
 // completion proof is present rather than its request creation timestamp.
 await fail(`lite1_return(${q(guestItem)},3,'cash',${q(key())})`,/LITE1_RETURN_EXCESS/);
 await sql('UPDATE public.storefront_settings SET orders_enabled=false;');
 await fail(`lite1_guest(${j(guest)},${q(key())})`,/LITE1_STORE_CLOSED/,null,'service_role');
 await sql('UPDATE public.storefront_settings SET orders_enabled=true;');
 await rpc(`lite1_set_available(${q(id(101))},false,0)`);
 await sql(`UPDATE public.products SET default_sale_price_in_minor_units=default_sale_price_in_minor_units+1 WHERE id=${q(id(100))};UPDATE public.products SET default_sale_price_in_minor_units=default_sale_price_in_minor_units-1 WHERE id=${q(id(100))};`);
 assert.equal(await json(`SELECT to_jsonb(available) FROM sales_lite1.availability WHERE product_id=${q(id(101))};`),false,'PARENT_PRICE_UPDATE_MUST_NOT_REACTIVATE_FLAVOR');
 await fail(`lite1_pos(${j({...sale('cash'),lines:[{productId:id(101),quantity:1}]})},${q(key())})`,/LITE1_UNAVAILABLE_CONFIRM_REQUIRED/);
 await rpc(`lite1_set_available(${q(id(101))},true,1)`);
 const flavor=await create({...sale('cash'),lines:[{productId:id(101),quantity:1}]});assert.equal(flavor.totalInMinorUnits,1000);
 await rpc(`lite1_set_available(${q(id(100))},false,0)`);
 await fail(`lite1_pos(${j({...sale('cash'),lines:[{productId:id(101),quantity:1}]})},${q(key())})`,/LITE1_UNAVAILABLE_CONFIRM_REQUIRED/);
 await rpc(`lite1_set_available(${q(id(100))},true,1)`);
 pass('availability product/flavor/parent independent, CAS stale refused; logged POS override, guest refuses, store switch enforced, existing customer card untouched');
 const item=async orderId=>json(`SELECT to_jsonb(id) FROM public.order_items WHERE order_id=${q(orderId)};`);
 const returnPartial=await rpc(`lite1_return(${q(await item(partial.orderId))},8,'cash',${q(key())})`);
 assert.deepEqual([returnPartial.entitlement,returnPartial.debtReduction,returnPartial.refund],[8000,6000,2000]);
 assert.equal(Number(await sql(`SELECT outstanding_total_in_minor_units FROM public.phase42_order_financial_position_internal(${q(partial.orderId)});`)),0);
 const debtItem=await item(debt.orderId),returnKey=key(),returnCall=`lite1_return(${q(debtItem)},2,'cash',${q(returnKey)})`;
 const ret=await rpc(returnCall);assert.equal(ret.debtReduction,2000);assert.equal(ret.refund,0);assert.deepEqual(await rpc(returnCall),ret);
 await fail(`lite1_return(${q(debtItem)},9,'cash',${q(key())})`,/LITE1_RETURN_EXCESS/);
 await rpc(`record_customer_order_payment_once(${q(debt.orderId)},8000,'cash',NULL,'تحصيل التجربة',${q(key())})`);
 await fail(`record_customer_order_payment_once(${q(debt.orderId)},1,'cash',NULL,NULL,${q(key())})`,/EXCEEDS_EFFECTIVE_OUTSTANDING/);
 const cashRet=await rpc(`lite1_return(${q(await item(cash.orderId))},1,'cliq',${q(key())})`);assert.equal(cashRet.refund,1000);
 pass('partial return 8000=6000 debt+2000 cash; debt return + existing protected collection exact, over-return/over-collection refused, CliQ refund');
 const expenseKey=key(),expense=`lite1_expense(${q(branch)},1500,'كهرباء','مصروف نقدي اصطناعي',${q(expenseKey)})`;
 const expenseResult=await rpc(expense);assert.deepEqual(await rpc(expense),expenseResult);
 const summary=await rpc(`get_cash_shift_summary(${q(liteShift)})`);
 // Opening10000 + cash sales(10000+1000+2000+1000) + partial4000 + collection8000 - cash refund2000 - expense1500.
 assert.equal(summary.expectedCashInMinorUnits,32500);assert.equal(summary.cashExpensesInMinorUnits,1500);assert.equal(summary.ownerWithdrawalsInMinorUnits,0);assert.equal(summary.cashRefundsInMinorUnits,2000);assert.equal(summary.cliqRefundsInMinorUnits,1000);
 await rpc(`close_cash_shift(${q(liteShift)},32500,NULL)`);
 const closed=await rpc(`get_cash_shift_closing_report(${q(liteShift)})`);
 assert.equal(closed.accountingTracked,false);assert.equal(closed.cashExpensesInMinorUnits,1500);assert.doesNotMatch(JSON.stringify(closed),/profit|cogs|wac|unitCost/iu);
 assert.equal(closed.reconciliation.netMovementInMinorUnits,31500);
 assert.deepEqual(await rpc(`get_cash_shift_closing_report(${q(fullShift)})`),frozenReport,'HISTORIC_FULL_SNAPSHOT_IDENTICAL');
 assert.deepEqual(await inventorySnapshot(),inventoryBefore,'ZERO_MOVEMENT_RESERVATION_BALANCE_OR_COST_CHANGE');
 assert.equal(Number(await sql('SELECT sales_lite1.integrity_count();')),0);
 const monitoring=await json('SELECT public.run_advanced_monitoring_checks();');
 assert.equal(monitoring.integrityIssueCount,0,JSON.stringify(monitoring));
 pass('expense separate from owner withdrawal, expected cash32500, zero discrepancy and cost-free immutable close; original full snapshot unchanged; all existing integrity checks zero');
 // Separate second shift: real independent sessions and injected late failure.
 await rpc(`open_cash_shift(${q(branch)},0)`);
 const raceShift=await json("SELECT to_jsonb(id) FROM public.cash_shifts WHERE status='open';");
 const raceKey=key(),raceCall=`lite1_pos(${j(sale('cash',1))},${q(raceKey)})`;
 const pair=await Promise.all([rpc(raceCall),rpc(raceCall)]);assert.deepEqual(pair[0],pair[1]);
 assert.equal(Number(await sql(`SELECT count(*) FROM sales_lite1.requests WHERE key=${q(raceKey)};`)),1);
 const raceItem=await item(pair[0].orderId);
 const refunds=await Promise.allSettled([rpc(`lite1_return(${q(raceItem)},1,'cash',${q(key())})`),rpc(`lite1_return(${q(raceItem)},1,'cash',${q(key())})`)]);
 assert.equal(refunds.filter(r=>r.status==='fulfilled').length,1);assert.match(refunds.find(r=>r.status==='rejected').reason.message,/LITE1_RETURN_EXCESS/);
 const concurrentDebt=await create(sale('debt',1)),concurrentItem=await item(concurrentDebt.orderId);
 const moneyRace=await Promise.allSettled([rpc(`lite1_return(${q(concurrentItem)},1,'cash',${q(key())})`),rpc(`record_customer_order_payment_once(${q(concurrentDebt.orderId)},1000,'cash',NULL,'تحصيل متزامن',${q(key())})`)]);
 assert.equal(moneyRace[0].status,'fulfilled');if(moneyRace[1].status==='rejected')assert.match(moneyRace[1].reason.message,/EXCEEDS_EFFECTIVE_OUTSTANDING/);
 assert.equal(Number(await sql(`SELECT outstanding_total_in_minor_units FROM public.phase42_order_financial_position_internal(${q(concurrentDebt.orderId)});`)),0);
 const refusalBefore=await c.fingerprint();
 await fail(`lite1_pos(${j(sale('cash',2))},${q(raceKey)})`,/LITE1_IDEMPOTENCY_CONFLICT/);
 await fail(`lite1_pos(${j({...sale('cash'),lines:[{productId:product,quantity:null}]})},${q(key())})`,/LITE1_LINE_INVALID/);
 await fail(`lite1_pos(${j({...sale('cash'),lines:[{productId:product,quantity:1,price:1}]})},${q(key())})`,/LITE1_LINE_INVALID/);
 await fail(fullCall('cash',key()),/LITE1_FROZEN_WRITER_DISABLED|LITE1_INVENTORY_DISABLED/);
 await c.rejectSql(`UPDATE public.inventory_balances SET on_hand_quantity=on_hand_quantity+1 WHERE product_id=${q(product)};`,/LITE1_INVENTORY_DISABLED/);
 await c.rejectSql(`UPDATE public.products SET cost_price_in_minor_units=1 WHERE id=${q(product)};`,/LITE1_COST_DISABLED/);
 await c.rejectSql('TRUNCATE sales_lite1.returns;',/LITE1_IMMUTABLE_EVIDENCE/);
 await c.rejectSql('UPDATE sales_lite1.completions SET completed_at=completed_at;',/LITE1_IMMUTABLE_EVIDENCE/);
 await c.rejectSql(`UPDATE sales_lite1.requests SET result='{}' WHERE key=${q(raceKey)};`,/LITE1_IMMUTABLE_EVIDENCE/);
 const refusalAfter=await c.fingerprint();assert.deepEqual(refusalAfter.private,refusalBefore.private);assert.deepEqual(refusalAfter.public.tables,refusalBefore.public.tables);
 // The legacy full POS may allocate an existing document number before its
 // admission trigger rejects. Its transaction leaves no financial/stock rows.
 await sql(`CREATE FUNCTION sales_lite1.test_abort_payment() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'LITE1_TEST_LATE_FAILURE';END$$;CREATE TRIGGER lite1_test_late_failure BEFORE INSERT ON public.customer_payments FOR EACH ROW EXECUTE FUNCTION sales_lite1.test_abort_payment();`);
 const rollbackBefore=await c.fingerprint();
 await fail(`lite1_pos(${j(sale('partial',2,{paid:500,initialMethod:'cash'}))},${q(key())})`,/LITE1_TEST_LATE_FAILURE/);
 const rollbackAfter=await c.fingerprint();assert.deepEqual(rollbackAfter.private,rollbackBefore.private);assert.deepEqual(rollbackAfter.public,{...rollbackBefore.public,sequences:{...rollbackBefore.public.sequences,customer_payment_number_seq:rollbackBefore.public.sequences.customer_payment_number_seq+1}},'EXACT_EXISTING_RECEIPT_NUMBER_GAP_ONLY');
 await sql('DROP TRIGGER lite1_test_late_failure ON public.customer_payments;DROP FUNCTION sales_lite1.test_abort_payment();');
 const newGuest={...guest,recipient:{name:'زبون اصطناعي جديد',phone:'0799999901',address:'عنوان وهمي'}};
 const newOrder=await rpc(`lite1_guest(${j(newGuest)},${q(key())})`,null,'service_role');await rpc(`lite1_complete(${q(newOrder.orderId)},${q(key())})`);
 assert.equal(Number(await sql("SELECT count(*) FROM public.customers WHERE phone='0799999901';")),1);
 await fail(`lite1_guest(${j({...newGuest,recipient:{...newGuest.recipient,address:''}})},${q(key())})`,/LITE1_RECIPIENT_INVALID/,null,'service_role');
 const raceSummary=await rpc(`get_cash_shift_summary(${q(raceShift)})`);assert.equal(raceSummary.expectedCashInMinorUnits,2000);
 await rpc(`create_owner_cash_withdrawal_v1(${q(raceShift)},500,'سحب مالك اصطناعي',${q(key())})`);
 const afterWithdrawal=await rpc(`get_cash_shift_summary(${q(raceShift)})`);assert.equal(afterWithdrawal.expectedCashInMinorUnits,1500);assert.equal(afterWithdrawal.cashExpensesInMinorUnits,0);assert.equal(afterWithdrawal.ownerWithdrawalsInMinorUnits,500);
 await rpc(`close_cash_shift(${q(raceShift)},1500,NULL)`);
 const withdrawalReport=await rpc(`get_cash_shift_closing_report(${q(raceShift)})`);assert.equal(withdrawalReport.reconciliation.netMovementInMinorUnits,2000);assert.equal(withdrawalReport.ownerWithdrawals.netMovementAfterWithdrawalsInMinorUnits,1500);
 assert.deepEqual(await inventorySnapshot(),inventoryBefore);
 pass('independent sessions: one same-key sale and one competing refund; late failure rolls back all rows/private evidence (one existing receipt sequence gap only); new customer and immutable history/stock/writer guards');
 await fail(`lite1_guest(${j(guest)},${q(key())})`,/permission denied/,null,'anon');
 await fail(`lite1_pos(${j(sale('cash'))},${q(key())})`,/permission denied/,null,'anon');
 await fail('lite1_set_mode(true)',/LITE1_ACTIVATION_REQUIRES_PHASE2/);
 assertFrozenFunctions(rows,await json(functionCatalogSql));
 assert.equal((await json('SELECT public.run_advanced_monitoring_checks();')).integrityIssueCount,0);
 report.fullFunctions=rows.length;report.approvedBridgeFunctions=8;report.inventoryChanged=false;report.liteClosingCash=summary.expectedCashInMinorUnits;
 pass('anon ACL closed, no prototype activation shortcut, frozen636 functions differ only by8 exact bridge bodies with unchanged ACL/owner/search_path');
 return report;
}
