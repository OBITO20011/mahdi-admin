import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {bridgeSql,assertFrozenFunctions} from './sales-only-phase1-bridges.mjs';
import {functionCatalogSql} from './sales-only-phase1-runtime.mjs';
import {commercialSql} from './sales-only-phase2-commercial.mjs';
import {returnSql} from './sales-only-phase2-returns.mjs';
import {statementSql} from './sales-only-phase2-statement.mjs';
import {returnPayload215} from './aftercare215-return-cases.mjs';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';

export async function verifyLiteReturns(c,report){
 const {sql,json,rpc,id,q,j,executor}=c,branch=id(200),warehouse=id(201),pid=id(103),key=()=>randomUUID();
 const projections=p=>Object.fromEntries(['entitlementInMinorUnits','debtReductionInMinorUnits','moneyRefundInMinorUnits','customerDamageDeductionInMinorUnits','goodQuantity','badQuantity','customerDamageQuantity','refundMethod'].map(k=>[k,p[k]]));
 const itemId=oid=>json(`SELECT to_jsonb(id) FROM public.order_items WHERE order_id=${q(oid)};`);
 for(const stocked of [pid,id(101),id(102)])await rpc(`create_direct_supplier_receipt_v2(p_supplier_id:=${q(id(301))},p_branch_id:=${q(branch)},p_warehouse_id:=${q(warehouse)},p_idempotency_key:=${q(key())},p_payment_method:='deferred',p_lines:=${j([{client_line_id:key(),line_kind:'base_unit',commercial_quantity:1000,base_unit_name:'باكيت',gross_amount_in_minor_units:500000,line_discount_in_minor_units:0,components:[{product_id:stocked,base_quantity:1000}]}])})`);
 const configuration=(await rpc(`save_product_parcel_configuration_v1(${q(id(100))},'configurable_mix',true,5,ARRAY[${q(id(101))},${q(id(102))}]::UUID[])`)).configuration;
 await rpc("set_configurable_parcel_feature_state_v1('ENABLED')");
 const mixed={commercial_line_kind:'configurable_parcel',family_product_id:id(100),parcel_configuration_id:configuration.id,configuration_revision:configuration.configuration_revision,parcel_instances:[{components:[{product_id:id(101),base_quantity:2},{product_id:id(102),base_quantity:3}]},{components:[{product_id:id(101),base_quantity:1},{product_id:id(102),base_quantity:4}]}]};
 const payloadFor=async(sale,part)=>{
  const item=await itemId(sale.orderId);
  if(!part.mixed)return returnPayload215({sale,item,pid},part);
  const instance=await json(`SELECT to_jsonb(id) FROM public.order_parcel_instances WHERE order_id=${q(sale.orderId)} ORDER BY instance_sequence OFFSET ${part.instance} LIMIT 1;`);
  const components=await json(`SELECT jsonb_agg(to_jsonb(c) ORDER BY product_id) FROM public.order_parcel_components c WHERE parcel_instance_id=${q(instance)};`);
  const damage=c=>c.product_id===id(101)?part.damage:0;
  return {orderId:sale.orderId,reason:'مرتجع طرد مشكل معزول',refundMethod:'cash',referenceNumber:null,notes:null,supplierAssignments:[],
   items:[{return_scope:'parcel_instance',order_item_id:item,parcel_instance_id:instance,components:components.map(c=>({parcel_component_id:c.id,accepted_quantity:c.base_quantity-damage(c),rejected_quantity:damage(c),accepted_condition:c.base_quantity>damage(c)?'sellable':null,accepted_stock_disposition:c.base_quantity>damage(c)?'restock':null,rejection_reason:damage(c)?'customer_damage':null,rejected_stock_disposition:damage(c)?'returned_to_customer':null}))}],
   physicalSources:components.map(c=>({root_source_kind:'parcel_component',root_source_id:c.id,source_kind:'parcel_component',source_id:c.id,product_id:c.product_id,quantity:c.base_quantity,sellable_restock_quantity:c.base_quantity-damage(c),defect_non_sellable_quantity:0,customer_damage_quantity:damage(c)}))};
 };
 const fullShift=(await rpc(`open_cash_shift(${q(branch)},0)`)).id;
 const base={commercial_line_kind:'base_unit',product_id:pid,base_quantity:3},carton={commercial_line_kind:'legacy_single_sku_parcel',product_id:pid,parcel_quantity:2,units_per_parcel:5};
 const fullCase=async(lines,discount,partial,parts)=>{
  const sale=await rpc(partial?`create_pos_sale_with_initial_payment_v1(${q(warehouse)},${q(branch)},${q(id(401))},'وهمي',${j(lines)},${discount},4000,'cash',NULL,${q(key())})`:`create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(id(401))},'وهمي','cash',${j(lines)},${discount},0,${q(key())})`);
  const results=[];
  for(const part of parts){
   const payload=await payloadFor(sale,part),preview=await rpc(`preview_admin_sales_return_v2(${j(payload)})`);
   assert.equal(preview.canConfirm,true);await rpc(`settle_admin_sales_return_v2(${j(payload)},${q(key())},${q(preview.previewFingerprint)})`);results.push(projections(preview));
  }
  const token=(await rpc(`get_or_create_pos_receipt_token(${q(sale.orderId)})`)).receiptToken;
  return {lines,discount,partial,parts,results,token,receipt:await rpc(`get_public_pos_receipt(${q(token)})`,id(1),'anon')};
 };
 const fullCases=[];
 fullCases.push(await fullCase([base],101,false,[{quantity:1,good:1,method:'cash'},{quantity:1,good:1,method:'cash'},{quantity:1,good:1,method:'cash'}]));
 fullCases.push(await fullCase([carton],101,false,[{quantity:5,good:4,damage:1,method:'cash'},{quantity:5,good:5,method:'cash'}]));
 fullCases.push(await fullCase([{...base,base_quantity:10}],101,true,[{quantity:8,good:8,method:'cash'}]));
 fullCases.push(await fullCase([mixed],101,false,[{mixed:true,instance:0,damage:1},{mixed:true,instance:1,damage:0}]));
 const fullSummary=await rpc(`get_cash_shift_summary(${q(fullShift)})`);await rpc(`close_cash_shift(${q(fullShift)},${fullSummary.expectedCashInMinorUnits},NULL)`);
 const fullStatements=await Promise.all([[1,1],[2,2],[1,100]].map(([page,size])=>rpc(`get_customer_statement(${q(id(401))},${page},${size})`)));
 const before=await json(functionCatalogSql),read=n=>readFile(new URL('../../docs/design/sales-only-phase'+n,import.meta.url),'utf8');
 await sql(`BEGIN;SELECT set_config('nawasrah.sales_lite1_test','OWNED_LOCAL_DB219',true);SELECT set_config('nawasrah.sales_lite2_test','OWNED_LOCAL_DB219',true);${await read('1/prototype.sql')}\n${bridgeSql(before)}\n${commercialSql(before)}\n${await read('2/pos-writer.sql')}\n${await read('2/operating-mode.sql')}\n${returnSql(before)}\n${statementSql(before)}\n${await read('2/ledger-readers.sql')}COMMIT;`);
 const parallelStatements=await Promise.all([[1,1],[2,2],[1,100]].map(([page,size])=>rpc(`lite1_customer_statement2(${q(id(401))},${page},${size})`)));
 assert.deepEqual(parallelStatements,fullStatements,'FULL_STATEMENT_ALL_JSON_AND_PAGES_IDENTICAL');
 const dispatchStatements=await Promise.all([[1,1],[2,2],[1,100]].map(([page,size])=>rpc(`lite1_statement_dispatch2(${q(id(401))},${page},${size})`)));
 assert.deepEqual(dispatchStatements,fullStatements,'DISPATCH_FULL_ALL_JSON_IDENTICAL');
 for(const f of fullCases)assert.deepEqual(await rpc(`lite1_public_pos_receipt2(${q(f.token)})`,id(1),'anon'),f.receipt,'FULL_RECEIPT_TOKEN_AND_LINES_UNCHANGED');
 const invalid=key();assert.deepEqual(await rpc(`lite1_public_pos_receipt2(${q(invalid)})`,id(1),'anon'),await rpc(`get_public_pos_receipt(${q(invalid)})`,id(1),'anon'));
 assert.deepEqual(await rpc('lite1_public_pos_receipt2(NULL)',id(1),'anon'),await rpc('get_public_pos_receipt(NULL)',id(1),'anon'));
 assertFrozenFunctions(before,await json(functionCatalogSql));await rpc('lite1_set_mode2(false)');
 const stock=()=>json(`SELECT jsonb_build_object('moves',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.inventory_movements x),'reservations',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.order_inventory_reservations x),'balances',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.inventory_balances x),'costs',(SELECT jsonb_agg(jsonb_build_array(id,cost_price_in_minor_units,wac_cost_in_minor_units_exact) ORDER BY id) FROM public.products));`);
 const stockBefore=await stock();
 await rpc(`open_cash_shift(${q(branch)},100000)`);
 const create=async(f,customer=id(401))=>rpc(`lite1_pos2(${j({branchId:branch,warehouseId:warehouse,customerId:customer,paymentMethod:f.partial?'debt':'cash',lines:f.lines,discountInMinorUnits:f.discount,amountReceivedInMinorUnits:0,...(f.partial?{initialPayment:{amountInMinorUnits:4000,method:'cash'}}:{})})},${q(key())})`);
 const fail=async(call,pattern)=>{let error;try{await rpc(call);}catch(e){error=e;}assert.ok(error,'EXPECTED_REFUSAL');assert.match(error.message,pattern);};
 let comparisons=0;
 for(const fixture of fullCases){
  const sale=await create(fixture);
  const token=(await rpc(`get_or_create_pos_receipt_token(${q(sale.orderId)})`)).receiptToken;
  const readReceipt=()=>rpc(`lite1_public_pos_receipt2(${q(token)})`,id(1),'anon');
  const beforeReceipt=await readApplicationFingerprint(executor),receipt=await readReceipt();
  assert.equal(receipt.amountPaidInMinorUnits,sale.amountPaidInMinorUnits);assert.equal(receipt.remainingInMinorUnits,sale.remainingInMinorUnits);
  assert.equal(receipt.initialPaymentMethod,fixture.partial?'cash':undefined);assert.doesNotMatch(JSON.stringify(receipt),/cogs|profit|wac|cost|customerPhone|customerAddress/i);
  assert.deepEqual(await readApplicationFingerprint(executor),beforeReceipt,'PUBLIC_LITE_RECEIPT_READ_ONLY');
  for(let i=0;i<fixture.parts.length;i++){
   const payload=await payloadFor(sale,fixture.parts[i]);
   const fp=await readApplicationFingerprint(executor),preview=await rpc(`lite1_preview_return2(${j(payload)})`);
   assert.equal(preview.canConfirm,true);assert.deepEqual(await readApplicationFingerprint(executor),fp,'PREVIEW_WRITES_NOTHING');
   assert.deepEqual(projections(preview),fixture.results[i],'FULL_LITE_RETURN_MONEY_DAMAGE_AND_QUANTITY_IDENTICAL');
   assert.doesNotMatch(JSON.stringify(preview),/profit|cogs|wac|RestockValue|badLoss|supplierHeld/i);
   const call=`lite1_settle_return2(${j(payload)},${q(key())},${q(preview.previewFingerprint)})`,result=await rpc(call),after=await readApplicationFingerprint(executor);
   assert.deepEqual(await rpc(call),result);assert.deepEqual(await readApplicationFingerprint(executor),after,'SETTLE_REPLAY_ZERO_WRITES');
   const paidReceipt=await readReceipt();assert.equal(paidReceipt.remainingInMinorUnits,Number(await sql(`SELECT outstanding_total_in_minor_units FROM public.phase42_order_financial_position_internal(${q(sale.orderId)});`)));
   assert.deepEqual(await stock(),stockBefore);comparisons++;
  }
 }
 report.cases.push({name:'full vs lite returns exact cumulativefils/cartondamage/mixeddamage/partialdebtfirst;previewzero writes/replay,nostockcost',passed:true,comparisons});
 const zeroSale=await create({lines:[{...base,base_quantity:1}],discount:1000,partial:false}),zeroItem=await itemId(zeroSale.orderId);
 const zeroPayload=returnPayload215({sale:zeroSale,item:zeroItem,pid},{quantity:1,good:1,method:'cash'}),zeroPreview=await rpc(`lite1_preview_return2(${j(zeroPayload)})`);
 assert.equal(zeroPreview.entitlementInMinorUnits,'0');await rpc(`lite1_settle_return2(${j(zeroPayload)},${q(key())},${q(zeroPreview.previewFingerprint)})`);
 await fail(`lite1_preview_return2(${j(zeroPayload)})`,/PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED/);
 const raceSale=await create({lines:[{...base,base_quantity:1}],discount:0,partial:false}),raceItem=await itemId(raceSale.orderId);
 const racePayload=returnPayload215({sale:raceSale,item:raceItem,pid},{quantity:1,good:1,method:'cash'}),racePreview=await rpc(`lite1_preview_return2(${j(racePayload)})`);
 const pair=await Promise.allSettled([1,2].map(()=>rpc(`lite1_settle_return2(${j(racePayload)},${q(key())},${q(racePreview.previewFingerprint)})`)));
 assert.equal(pair.filter(x=>x.status==='fulfilled').length,1);assert.match(pair.find(x=>x.status==='rejected').reason.message,/PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED|AFTERCARE215_PREVIEW_CHANGED/);
 report.cases.push({name:'zeroentitlement return consumescapacity;two competingreturns onlyone succeeds',passed:true});
 // The existing cheque collection/lifecycle is reused without any new writer.
 await sql(`INSERT INTO public.customers(id,full_name,phone,credit_limit_in_minor_units) VALUES(${q(id(499))},'عميل شيك وهمي','0796600499',1000000);`);
 const chequeSale=await rpc(`lite1_pos2(${j({branchId:branch,warehouseId:warehouse,customerId:id(499),paymentMethod:'debt',lines:[{...base,base_quantity:1}],discountInMinorUnits:0,amountReceivedInMinorUnits:0})},${q(key())})`);
 const chequeKey=key(),chequeCall=`receive_customer_cheque_v1(${q(id(499))},${q(branch)},'بنك وهمي','FIXTURE-001',current_date+7,1000,'شيك اختبار معزول',${q(chequeKey)})`;
 const cheque=await rpc(chequeCall);assert.equal(cheque.success,true);
 assert.equal(Number(await sql(`SELECT outstanding_total_in_minor_units FROM public.phase42_order_financial_position_internal(${q(chequeSale.orderId)});`)),0);
 const chequeReplay=await rpc(chequeCall);assert.equal(chequeReplay.cheque.id,cheque.cheque.id);
 assert.ok(Number.isInteger(cheque.cheque.version),'CHEQUE_CURRENT_VERSION_REQUIRED');
 await rpc(`return_deferred_cheque_v1(${q(cheque.cheque.id)},${cheque.cheque.version},'رجوع اختبار وهمي',${q(key())})`);
 assert.equal(Number(await sql(`SELECT outstanding_total_in_minor_units FROM public.phase42_order_financial_position_internal(${q(chequeSale.orderId)});`)),0,'BOUNCE_DOES_NOT_REWRITE_ORIGINAL_INVOICE');
 assert.equal((await rpc(`get_customer_statement(${q(id(499))},1,100)`)).closing_balance_in_minor_units,1000,'UNCHANGED_CHEQUE_WRITER_CREATES_INDEPENDENT_CLAIM');
 const bounced=await readApplicationFingerprint(executor);await rpc(`return_deferred_cheque_v1(${q(cheque.cheque.id)},${cheque.cheque.version},'رجوع اختبار وهمي',${q(key())})`).then(()=>assert.fail('STALE_VERSION_ACCEPTED'),()=>{});assert.deepEqual(await readApplicationFingerprint(executor),bounced);
 report.cases.push({name:'existing incomingcheque collection/replay/bounce preservesoriginalpaidinvoice andcreates1000independentclaim;no clonedchequewriter',passed:true});
 const debtSale=await rpc(`lite1_pos2(${j({branchId:branch,warehouseId:warehouse,customerId:id(499),paymentMethod:'debt',lines:[{...base,base_quantity:1}],discountInMinorUnits:0,amountReceivedInMinorUnits:0})},${q(key())})`);
 const closing=await json(`SELECT to_jsonb(id) FROM public.cash_shifts WHERE branch_id=${q(branch)} AND status='open';`);
 const closingSummary=await rpc(`get_cash_shift_summary(${q(closing)})`);await rpc(`close_cash_shift(${q(closing)},${closingSummary.expectedCashInMinorUnits},NULL)`);
 await sql('UPDATE sales_lite1.mode SET full_accounting=true;');
 const afterEpochItem=await itemId(debtSale.orderId),payload=returnPayload215({sale:debtSale,item:afterEpochItem,pid},{quantity:1,good:1,method:'cash'});
 const preview=await rpc(`lite1_preview_return2(${j(payload)})`);assert.equal(preview.debtReductionInMinorUnits,'1000');await rpc(`lite1_settle_return2(${j(payload)},${q(key())},${q(preview.previewFingerprint)})`);
 await fail(`get_customer_statement(${q(id(499))},1,100)`,/CUSTOMER_STATEMENT_EVIDENCE_MISMATCH/);
 const statement=await rpc(`lite1_customer_statement2(${q(id(499))},1,100)`);
 assert.equal(statement.closing_balance_in_minor_units,1000,'INDEPENDENT_CHEQUE_CLAIM_REMAINS');
 assert.equal(statement.movements.filter(m=>m.movement_id.startsWith('lite_return:')).length,1);
 assert.deepEqual(await rpc(`lite1_statement_dispatch2(${q(id(499))},1,100)`),statement,'POST_EPOCH_READS_IMMUTABLE_LITE_PROVENANCE');
 assert.equal(await sql("SELECT has_function_privilege('anon','public.lite1_statement_dispatch2(uuid,integer,integer)','EXECUTE');"),'f');
 report.cases.push({name:'publictokenreceipt fullJSONunchanged;litecurrentpaid/debt/returns,no cost/PII,readonly;statementdispatch full3pagesexact andpostepochlite evidence;anonstatementdenied',passed:true});
 assert.deepEqual(await stock(),stockBefore,'OLD_LITE_RETURN_AFTER_ACTIVATION_STILL_ZERO_STOCK');
 const monitor=await json('SELECT public.run_advanced_monitoring_checks();');assert.equal(monitor.integrityIssueCount,0,JSON.stringify(monitor));assertFrozenFunctions(before,await json(functionCatalogSql));
 report.cases.push({name:'debt-only oldlitereturn afterfutureepoch needsnoopenshift;parallelstatement includesrealreturnmovement notadjustment;full3pagesJSONidentical;nostock/debtintact;integrity0 and636guard',passed:true});
}
