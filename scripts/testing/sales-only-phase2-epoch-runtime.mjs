import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {setTimeout} from 'node:timers/promises';
import {executeInput} from '../operations/build-empty-supabase.mjs';
import {bridgeSql,assertFrozenFunctions} from './sales-only-phase1-bridges.mjs';
import {functionCatalogSql} from './sales-only-phase1-runtime.mjs';
import {commercialSql} from './sales-only-phase2-commercial.mjs';
import {returnSql} from './sales-only-phase2-returns.mjs';
import {statementSql} from './sales-only-phase2-statement.mjs';
import {returnPayload215} from './aftercare215-return-cases.mjs';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';

export async function verifyOpeningEpoch(c,report){
 const {sql,json,rpc,id,q,j,executor}=c,key=()=>randomUUID(),branch=id(200),warehouse=id(201),pid=id(103);
 const before=await json(functionCatalogSql),read=n=>readFile(new URL('../../docs/design/sales-only-phase'+n,import.meta.url),'utf8');
 await sql(`BEGIN;SELECT set_config('nawasrah.sales_lite1_test','OWNED_LOCAL_DB219',true);SELECT set_config('nawasrah.sales_lite2_test','OWNED_LOCAL_DB219',true);${await read('1/prototype.sql')}\n${bridgeSql(before)}\n${commercialSql(before)}\n${await read('2/pos-writer.sql')}\n${await read('2/guest-writer.sql')}\n${await read('2/guest-lifecycle.sql')}\n${await read('2/operating-mode.sql')}\n${returnSql(before)}\n${statementSql(before)}\n${await read('2/opening-epoch.sql')}\n${await read('2/entrypoints.sql')}COMMIT;`);
 assertFrozenFunctions(before,await json(functionCatalogSql));
 const fail=async(call,pattern)=>{let error;try{await rpc(call);}catch(e){error=e;}assert.ok(error,'EXPECTED_EPOCH_REFUSAL');assert.match(error.message,pattern);};
 const ownState=()=>json(`SELECT jsonb_build_object('mode',(SELECT to_jsonb(m) FROM sales_lite1.mode m),
  'requests',(SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY key),'[]') FROM sales_lite1.requests r),
  'epochs',(SELECT count(*) FROM sales_lite2.opening_epochs),'items',(SELECT count(*) FROM sales_lite2.opening_epoch_items));`);
 const ledger=()=>json(`SELECT jsonb_build_object('goLive',(SELECT to_jsonb(s) FROM public.go_live_setup_state s),
  'customers',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.customers x),'orders',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.orders x),
  'items',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.order_items x),'payments',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.customer_payments x),
  'openings',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.customer_opening_balances x),'shifts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cash_shifts x));`);
 await fail('lite1_set_mode(false)',/permission denied/);
 await rpc('lite1_set_mode2(false)');
 const rows=await json(`SELECT jsonb_agg(jsonb_build_object('productId',p.id,'warehouseId',w.id,'actualQuantity',20,'unitCostInMinorUnits',500) ORDER BY p.id,w.id)
 FROM public.products p CROSS JOIN public.warehouses w JOIN public.branches b ON b.id=w.branch_id WHERE p.is_active AND NOT p.is_flavor_master AND w.is_active AND b.is_active;`);
 const notes='جرد تفعيل بعد فترة تشغيل مبسطة - بيانات وهمية';
 const previewCall=(r=rows,n=notes)=>`lite1_preview_epoch2(${j(r)},${q(n)})`;
 const apply=(preview,identity=key(),r=rows,n=notes)=>`lite1_activate_epoch2(${j(r)},${q(n)},${q(identity)},${q(preview.previewFingerprint)},'تفعيل المحاسبة بالجرد المعتمد')`;
 const private0=await ownState(),fp0=await readApplicationFingerprint(executor);
 await fail(previewCall(),/LITE2_EPOCH_GO_LIVE_NOT_FINISHED/);
 assert.deepEqual(await ownState(),private0);assert.deepEqual(await readApplicationFingerprint(executor),fp0);
 await rpc("finish_go_live_setup_v1('إنهاء بداية التشغيل')");
 const shift=(await rpc(`open_cash_shift(${q(branch)},10000)`)).id;
 const line={commercial_line_kind:'base_unit',product_id:pid,base_quantity:3};
 const sale=await rpc(`lite1_pos2(${j({branchId:branch,warehouseId:warehouse,customerId:id(401),paymentMethod:'debt',lines:[line],discountInMinorUnits:0,amountReceivedInMinorUnits:0})},${q(key())})`);
 await rpc(`record_customer_order_payment_once(${q(sale.orderId)},500,'cash',NULL,'تحصيل على فاتورة مبسطة',${q(key())})`);
 await fail(previewCall(),/LITE1_MODE_REQUIRES_QUIESCENCE/);
 const summary=await rpc(`get_cash_shift_summary(${q(shift)})`);await rpc(`close_cash_shift(${q(shift)},${summary.expectedCashInMinorUnits},NULL)`);
 const history=await ledger(),canonical=await rpc(`lite1_customer_statement2(${q(id(401))},1,100)`);
 assert.equal(canonical.closing_balance_in_minor_units,2500);
 await fail(`apply_inventory_opening_setup(${q(warehouse)},${j([{productId:pid,packageCount:1,looseUnits:0}])},'جرد محمي قديم',${q(key())})`,/GO_LIVE_SETUP_FINISHED/);
 const readOnly=await readApplicationFingerprint(executor);let preview=await rpc(previewCall());
 assert.equal(preview.itemCount,rows.length);assert.equal(preview.totalValueExact,String(rows.length*20*500));
 assert.deepEqual(await readApplicationFingerprint(executor),readOnly,'EPOCH_PREVIEW_ZERO_WRITES');
 const assertDenied=async(r,pattern)=>{const fp=await readApplicationFingerprint(executor),state=await ownState();await fail(previewCall(r),pattern);assert.deepEqual(await readApplicationFingerprint(executor),fp);assert.deepEqual(await ownState(),state);};
 await assertDenied(rows.slice(1),/LITE2_EPOCH_COMPLETE_COUNT_REQUIRED/);
 await assertDenied([...rows,rows[0]],/LITE2_EPOCH_DUPLICATE_OR_COST_CONFLICT/);
 await assertDenied(rows.map((r,i)=>i? r:{...r,unitCostInMinorUnits:0}),/LITE2_EPOCH_COST_QUANTITY_INVALID/);
 await assertDenied(rows.map((r,i)=>i? r:{...r,actualQuantity:-1}),/LITE2_EPOCH_ROW_INVALID/);
 const weakClaims={sub:id(1),role:'authenticated',aal:'aal1'};
 let aalError;try{await json(`BEGIN;SELECT set_config('request.jwt.claims',${j(weakClaims)}::TEXT,true);SET LOCAL ROLE authenticated;SELECT public.${previewCall()};COMMIT;`);}catch(e){aalError=e;}
 assert.ok(aalError);assert.match(aalError.message,/LITE2_OWNER_AAL2_REQUIRED/);
 await fail(apply({...preview,previewFingerprint:'0'.repeat(64)}),/LITE2_EPOCH_PREVIEW_CHANGED/);
 await sql(`UPDATE public.products SET updated_at=clock_timestamp() WHERE id=${q(pid)};`);
 await fail(apply(preview),/LITE2_EPOCH_PREVIEW_CHANGED/);preview=await rpc(previewCall());
 const holder=executeInput(executor,"SET application_name='lite2-epoch-blocker';BEGIN;SELECT 1 FROM sales_lite1.mode WHERE id FOR SHARE;SELECT pg_sleep(4);ROLLBACK;");
 let ready=false;for(let i=0;i<12;i++){ready=(await sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='lite2-epoch-blocker' AND query LIKE '%pg_sleep(4)%' AND state='active');"))==='t';if(ready)break;await setTimeout(50);}
 try{assert.equal(ready,true,'MODE_HOLDER_READY');await fail(apply(preview),/LITE2_EPOCH_BUSY/);}finally{const held=await holder;assert.equal(held.code,0,held.stderr);}
 report.cases.push({name:'AAL2/GoLivefinished/completecount/cost/quantity/duplicate/seal guards;old047stilllocked;previewreadonly;oldprototypeentrypoint revoked',passed:true,itemCount:rows.length});
 // A deliberate failure after mode/cost/balance/movement writes must roll back
 // every table. PostgreSQL nextval gaps are real and are checked separately.
 await sql(`CREATE FUNCTION sales_lite2.inject_epoch_failure() RETURNS TRIGGER LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'LITE2_EPOCH_INJECTED_FAILURE';END$$;
 CREATE TRIGGER lite2_test_failure BEFORE INSERT ON sales_lite2.opening_epoch_items FOR EACH ROW EXECUTE FUNCTION sales_lite2.inject_epoch_failure();`);
 const beforeFailure=await readApplicationFingerprint(executor),privateFailure=await ownState();
 await fail(apply(preview),/LITE2_EPOCH_INJECTED_FAILURE/);
 const afterFailure=await readApplicationFingerprint(executor);assert.deepEqual(afterFailure.tables,beforeFailure.tables,'ALL_PUBLIC_ROWS_ROLL_BACK');assert.deepEqual(await ownState(),privateFailure);
 for(const name of Object.keys(afterFailure.sequences))if(name!=='inventory_movement_mutation_seq')assert.equal(afterFailure.sequences[name],beforeFailure.sequences[name],name);
 assert.ok(Number(afterFailure.sequences.inventory_movement_mutation_seq)>Number(beforeFailure.sequences.inventory_movement_mutation_seq),'POSTGRES_NONTRANSACTIONAL_SEQUENCE_GAP_RECORDED');
 await sql('DROP TRIGGER lite2_test_failure ON sales_lite2.opening_epoch_items;DROP FUNCTION sales_lite2.inject_epoch_failure();');
 const activationKey=key(),call=apply(preview,activationKey),start=performance.now();
 const pair=await Promise.all([rpc(call),rpc(call)]),elapsed=performance.now()-start;
 assert.deepEqual(pair[0],pair[1]);assert.equal(pair[0].fullAccounting,true);
 assert.equal((await ownState()).epochs,1);assert.equal((await ownState()).items,rows.length);
 const done=await readApplicationFingerprint(executor),donePrivate=await ownState();assert.deepEqual(await rpc(call),pair[0]);
 assert.deepEqual(await readApplicationFingerprint(executor),done,'ACTIVATION_REPLAY_ZERO_WRITES');assert.deepEqual(await ownState(),donePrivate);
 await fail(apply(preview,activationKey,rows,notes+' مختلف'),/LITE1_IDEMPOTENCY_CONFLICT/);
 assert.deepEqual(await ledger(),history,'GO_LIVE_AND_ALL_FINANCIAL_ROWS_AND_IDENTITIES_UNTOUCHED');
 assert.deepEqual(await rpc(`lite1_customer_statement2(${q(id(401))},1,100)`),canonical);
 const actual=await json(`SELECT jsonb_agg(jsonb_build_object('productId',i.product_id,'warehouseId',i.warehouse_id,'actualQuantity',b.on_hand_quantity,'unitCostInMinorUnits',p.cost_price_in_minor_units) ORDER BY i.product_id,i.warehouse_id)
 FROM sales_lite2.opening_epoch_items i JOIN public.inventory_balances b ON b.product_id=i.product_id AND b.warehouse_id=i.warehouse_id JOIN public.products p ON p.id=i.product_id WHERE i.epoch_id=${q(pair[0].epochId)};`);
 assert.deepEqual(actual,rows);
 assert.equal(Number(await sql(`SELECT count(*) FROM sales_lite2.opening_epoch_items i JOIN public.products p ON p.id=i.product_id WHERE p.wac_cost_in_minor_units_exact IS DISTINCT FROM i.unit_cost::NUMERIC;`)),0);
 assert.equal(Number(await sql(`SELECT count(*) FROM public.inventory_movements WHERE reference_type='sales_lite2_opening_epoch' AND reference_id=${q(pair[0].epochId)};`)),rows.length);
 report.cases.push({name:'atomicrollback allrows/mode/evidence;2concurrentidenticalrequests oneepoch;replayreadonly;counts/WAC exact andGoLive/ledger/IDs preserved',passed:true,activationWithReplayMs:elapsed});
 const stock=()=>json(`SELECT jsonb_build_object('moves',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.inventory_movements x),'balances',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.inventory_balances x),'costs',(SELECT jsonb_agg(jsonb_build_array(id,cost_price_in_minor_units,wac_cost_in_minor_units_exact) ORDER BY id) FROM public.products));`);
 const stockAtEpoch=await stock(),item=await json(`SELECT to_jsonb(id) FROM public.order_items WHERE order_id=${q(sale.orderId)};`);
 const payload=returnPayload215({sale,item,pid},{quantity:1,good:1,method:'cash'}),returnPreview=await rpc(`lite1_preview_return2(${j(payload)})`);
 assert.equal(returnPreview.debtReductionInMinorUnits,'1000');await rpc(`lite1_settle_return2(${j(payload)},${q(key())},${q(returnPreview.previewFingerprint)})`);
 assert.deepEqual(await stock(),stockAtEpoch,'OLD_LITE_RETURN_AFTER_REAL_ACTIVATION_IS_NON_STOCK');
 assert.equal((await rpc(`lite1_customer_statement2(${q(id(401))},1,100)`)).closing_balance_in_minor_units,1500);
 // Pure48h rule also rejects a synthetic90-day-old completion, independent
 // of mode; no production clock or immutable historical evidence is changed.
 await assert.rejects(sql("SELECT sales_lite1.assert_return_window(clock_timestamp()-interval '90 days',clock_timestamp());"),/PHASE4_RETURN_WINDOW_EXPIRED/);
 const fullShift=(await rpc(`open_cash_shift(${q(branch)},0)`)).id;
 const full=await rpc(`create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(id(401))},'بعد التفعيل','cash',${j([{...line,base_quantity:1}])},0,1000,${q(key())})`);
 assert.equal(full.totalInMinorUnits,1000);assert.equal(full.items[0].cogsInMinorUnits,500);
 assert.equal(Number(await sql(`SELECT on_hand_quantity FROM public.inventory_balances WHERE product_id=${q(pid)} AND warehouse_id=${q(warehouse)};`)),19);
 const fullSummary=await rpc(`get_cash_shift_summary(${q(fullShift)})`);await rpc(`close_cash_shift(${q(fullShift)},${fullSummary.expectedCashInMinorUnits},NULL)`);
 const monitor=await json('SELECT public.run_advanced_monitoring_checks();');assert.equal(monitor.integrityIssueCount,0,JSON.stringify(monitor));
 assertFrozenFunctions(before,await json(functionCatalogSql));
 report.cases.push({name:'realactivation thenoldlitereturn nostock/debtcorrect;90daywindowclosed;unchangedfullPOS resumesrealstock/cost;integrity0 and628/636 guard',passed:true});
}
