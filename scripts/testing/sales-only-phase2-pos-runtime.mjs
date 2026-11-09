import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {bridgeSql,assertFrozenFunctions} from './sales-only-phase1-bridges.mjs';
import {functionCatalogSql} from './sales-only-phase1-runtime.mjs';
import {commercialSql} from './sales-only-phase2-commercial.mjs';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';

export async function verifyCommercialPos(c,report){
 const {sql,json,rpc,id,q,j,executor}=c,branch=id(200),warehouse=id(201),product=id(103);
 const before=await json(functionCatalogSql),read=name=>readFile(new URL('../../docs/design/sales-only-phase'+name,import.meta.url),'utf8');
 await sql(`BEGIN;SELECT set_config('nawasrah.sales_lite1_test','OWNED_LOCAL_DB219',true);SELECT set_config('nawasrah.sales_lite2_test','OWNED_LOCAL_DB219',true);${await read('1/prototype.sql')}\n${bridgeSql(before)}\n${commercialSql(before)}\n${await read('2/pos-writer.sql')}COMMIT;`);
 assertFrozenFunctions(before,await json(functionCatalogSql));
 const configuration=(await rpc(`save_product_parcel_configuration_v1(${q(id(100))},'configurable_mix',true,5,ARRAY[${q(id(101))},${q(id(102))}]::UUID[])`)).configuration;
 await rpc("set_configurable_parcel_feature_state_v1('ENABLED')");await rpc('lite1_set_mode(false)');
 const shift=(await rpc(`open_cash_shift(${q(branch)},10000)`)).id;
 const inventory=()=>json(`SELECT jsonb_build_object('movements',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.inventory_movements x),'reservations',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.order_inventory_reservations x),'balances',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.inventory_balances x),'costs',(SELECT jsonb_agg(jsonb_build_array(id,cost_price_in_minor_units,wac_cost_in_minor_units_exact) ORDER BY id) FROM public.products));`);
 const stock=await inventory(),base={commercial_line_kind:'base_unit',product_id:product,base_quantity:3},parcel={commercial_line_kind:'legacy_single_sku_parcel',product_id:product,parcel_quantity:2,units_per_parcel:5};
 const mixed={commercial_line_kind:'configurable_parcel',family_product_id:id(100),parcel_configuration_id:configuration.id,configuration_revision:configuration.configuration_revision,parcel_instances:[{components:[{product_id:id(101),base_quantity:2},{product_id:id(102),base_quantity:3}]},{components:[{product_id:id(101),base_quantity:1},{product_id:id(102),base_quantity:4}]}]};
 let sales=0;
 const fail=async(call,pattern)=>{let e;try{await rpc(call);}catch(error){e=error;}assert.ok(e,'EXPECTED_REFUSAL');assert.match(String(e.message),pattern);};
 for(const lines of [[base],[parcel],[mixed],[base,parcel,mixed]])for(const paymentMethod of ['cash','cliq','debt','partial']){
  const partial=paymentMethod==='partial';
  const request={branchId:branch,warehouseId:warehouse,customerId:id(401),paymentMethod:partial?'debt':paymentMethod,lines,discountInMinorUnits:101,amountReceivedInMinorUnits:0,...(partial?{initialPayment:{amountInMinorUnits:500,method:'cash'}}:{})};
  const key=randomUUID(),call=`lite1_pos2(${j(request)},${q(key)})`,result=await rpc(call);
  assert.equal(result.accountingTracked,false);assert.equal(result.discountInMinorUnits,101);assert.equal(result.totalInMinorUnits,result.subtotalInMinorUnits-101);
  assert.equal(result.amountPaidInMinorUnits,paymentMethod==='debt'?0:partial?500:result.totalInMinorUnits);
  assert.equal(result.remainingInMinorUnits,result.totalInMinorUnits-result.amountPaidInMinorUnits);
  const fp=await readApplicationFingerprint(executor);assert.deepEqual(await rpc(call),result);assert.deepEqual(await readApplicationFingerprint(executor),fp,'REPLAY_ZERO_PUBLIC_WRITES');
  assert.equal(Number(await sql(`SELECT count(*) FROM public.order_items WHERE order_id=${q(result.orderId)} AND(unit_cost_in_minor_units<>0 OR cogs_in_minor_units<>0 OR profit_in_minor_units<>0 OR cost_finalized_at IS NOT NULL OR unit_cost_snapshot_in_minor_units_exact IS NOT NULL OR exact_cogs_snapshot_in_minor_units IS NOT NULL);`)),0);
  assert.equal(Number(await sql(`SELECT count(*) FROM public.order_parcel_instances WHERE order_id=${q(result.orderId)} AND finalized_at IS NULL;`)),0,'REAL_PARCEL_FINALIZER_REUSED');
  assert.equal(Number(await sql(`SELECT outstanding_total_in_minor_units FROM public.phase42_order_financial_position_internal(${q(result.orderId)});`)),result.remainingInMinorUnits);
  assert.deepEqual(await inventory(),stock,'NO_INVENTORY_BALANCE_MOVEMENT_RESERVATION_OR_WAC_EFFECT');sales++;
 }
 report.cases.push({name:'16real lite POS variants:three commercial kinds+combined ×cash/CliQ/debt/partial;real parcels finalized;receivables/replay correct;zero stock/cost',passed:true,sales});
 await rpc(`lite1_set_available(${q(product)},false,0)`);
 const request={branchId:branch,warehouseId:warehouse,customerId:id(401),paymentMethod:'cash',lines:[base],discountInMinorUnits:0};
 await fail(`lite1_pos2(${j(request)},${q(randomUUID())})`,/LITE1_UNAVAILABLE_CONFIRM_REQUIRED/);
 const override=await rpc(`lite1_pos2(${j({...request,unavailableConfirmed:[product]})},${q(randomUUID())})`);
 assert.deepEqual(override.unavailableConfirmed,[product]);
 assert.deepEqual(await json(`SELECT to_jsonb(unavailable_confirmed) FROM sales_lite1.orders WHERE order_id=${q(override.orderId)};`),[product]);
 await rpc(`lite1_set_available(${q(product)},true,1)`);
 const raceKey=randomUUID(),raceCall=`lite1_pos2(${j(request)},${q(raceKey)})`;
 const pair=await Promise.all([rpc(raceCall),rpc(raceCall)]);assert.deepEqual(pair[0],pair[1]);
 assert.equal(Number(await sql(`SELECT count(*) FROM public.orders WHERE idempotency_key=${q(raceKey)};`)),1);
 await fail(`lite1_pos2(${j({...request,discountInMinorUnits:1})},${q(raceKey)})`,/LITE1_IDEMPOTENCY_CONFLICT/);
 await fail(`lite1_pos2(${j({...request,clientPrice:1})},${q(randomUUID())})`,/LITE2_REQUEST_INVALID/);
 report.cases.push({name:'manual unavailable requires logged confirmation;same-key concurrent submit exactlyonce;changedidentity andclientprice refused',passed:true});
 const summary=await rpc(`get_cash_shift_summary(${q(shift)})`);await rpc(`close_cash_shift(${q(shift)},${summary.expectedCashInMinorUnits},NULL)`);
 const closing=await rpc(`get_cash_shift_closing_report(${q(shift)})`);assert.equal(closing.accountingTracked,false);assert.doesNotMatch(JSON.stringify(closing),/profit|cogs|wac|unitCost/iu);
 assert.deepEqual(await inventory(),stock);
 const monitor=await json('SELECT public.run_advanced_monitoring_checks();');assert.equal(monitor.integrityIssueCount,0,JSON.stringify(monitor));
 assertFrozenFunctions(before,await json(functionCatalogSql));
 report.cases.push({name:'existing shift close and shared receivable reader work;integrity0;628bodies/636metadata andother7bridges still exact',passed:true});
}
