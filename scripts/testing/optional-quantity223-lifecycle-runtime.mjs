import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';

// Actual existing order/POS/cancel writers. No direct insertion of invoices,
// quantities, reservations or cost;all fixture counter edits use the new API.
export async function verifyOptionalQuantity223Lifecycle(c,report){
 const {sql,json,rpc,id,transaction,root,catalog}=c;
 const q=s=>"'"+String(s).replaceAll("'","''")+"'",j=value=>q(JSON.stringify(value))+'::JSONB';
 const counter=pid=>rpc(`lite3_counter_context223('${pid}')`);
 const set=async(pid,qty,enabled=true)=>{const row=(await counter(pid)).products[0];return rpc(`lite3_set_counter223('${pid}',${enabled},${qty},2,${row.revision},'${randomUUID()}','${row.unitId}')`);};
 const base=(quantity=1,pid=id(103))=>({commercial_line_kind:'base_unit',product_id:pid,base_quantity:quantity});
 const request=(lines,confirmed)=>({branchId:id(200),warehouseId:id(201),customerId:id(401),paymentMethod:'cash',lines,discountInMinorUnits:0,amountReceivedInMinorUnits:100000,...(confirmed?{unavailableConfirmed:confirmed}:{})});
 const pos=(r,key=randomUUID())=>rpc(`lite1_pos2(${j(r)},${q(key)})`);
 // Core proof ended with this existing leaf disabled. Never-tracked flavors
 // have no counter row at all. Both must remain inert in the new hooks.
 await rpc(`set_go_live_main_branch_v1('${id(200)}')`);
 await rpc("finish_go_live_setup_v1('إنهاء بداية التشغيل')");
 await rpc(`open_cash_shift('${id(200)}',100000)`);
 const fingerprint=await readApplicationFingerprint(c.executor);
 const baseline=await json(transaction(`lite1_pos2(${j(request([base()]))},'quantity223-untracked-parity-key')`).replace('COMMIT;','ROLLBACK;'));
 const oldCatalog=await catalog();
 await sql(await readFile(new URL('../../docs/design/off-quantity-counter223/lifecycle223.sql',import.meta.url),'utf8'));
 await sql(await readFile(new URL('../../docs/design/off-quantity-counter223/private-writers223.sql',import.meta.url),'utf8'));
 const afterCatalog=await catalog(),oldNames=new Set(oldCatalog.map(f=>f.identity));
 assert.equal(afterCatalog.length,oldCatalog.length+1,'LIFECYCLE223_UNEXPECTED_PUBLIC_FUNCTION');
 assert.deepEqual(afterCatalog.filter(f=>!oldNames.has(f.identity)).map(f=>f.name),['lite3_pos_quantity_check223']);
 const modified=afterCatalog.filter(f=>oldNames.has(f.identity)&&JSON.stringify(f)!==JSON.stringify(oldCatalog.find(o=>o.identity===f.identity)));
 assert.deepEqual(modified.map(f=>f.name).sort(),['catalog_page','parcel_options','pos']);
 assert.ok(modified.every(f=>f.schema==='sales_lite2'));
 assert.deepEqual(afterCatalog.filter(f=>oldNames.has(f.identity)&&!modified.some(m=>m.identity===f.identity)),oldCatalog.filter(f=>!modified.some(m=>m.identity===f.identity)),'LIFECYCLE223_UNAPPROVED_OLD_FUNCTION_DELTA');
 assert.equal(oldNames.size+1,afterCatalog.length);
 const afterUntracked=await json(transaction(`lite1_pos2(${j(request([base()]))},'quantity223-untracked-parity-key')`).replace('COMMIT;','ROLLBACK;'));
 const normalize=value=>JSON.parse(JSON.stringify(value).replace(/\b(?!92600000)[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/giu,'generated-id'));
 assert.deepEqual(normalize(afterUntracked),normalize(baseline),'LIFECYCLE223_UNTRACKED_POS_BEHAVIOR_CHANGED');
 assert.deepEqual((await readApplicationFingerprint(c.executor)).tables,fingerprint.tables,'UNTRACKED_PARITY_ROLLBACK');
 report.cases.push({name:'only3 allowed OFF-private leaves change;all public/other private exact;untracked actual POS JSON parity and rollback',passed:true});
 const legacySale=await pos(request([base(1,id(101))]));
 const legacyItem=await sql(`SELECT id FROM public.order_items WHERE order_id='${legacySale.orderId}';`);
 await set(id(101),4);
 const beforeLegacyReturn=(await counter(id(101))).products[0];
 const legacyReturn={orderId:legacySale.orderId,reason:'مرتجع بيع قبل تفعيل العدّاد',refundMethod:'cash',supplierAssignments:[],
  items:[{return_scope:'base_unit',order_item_id:legacyItem,quantity:1,stock_disposition:'restock'}],
  physicalSources:[{root_source_kind:'base_order_item',root_source_id:legacyItem,source_kind:'base_order_item',source_id:legacyItem,
   product_id:id(101),quantity:1,sellable_restock_quantity:1,defect_non_sellable_quantity:0,customer_damage_quantity:0}]};
 const legacyPreview=await rpc(`lite1_preview_return2(${j(legacyReturn)})`);
 const legacyResult=await rpc(`lite1_settle_return2(${j(legacyReturn)},${q(randomUUID())},${q(legacyPreview.previewFingerprint)})`);
 assert.equal(legacyResult.goodQuantity,1);
 assert.equal(await sql(`SELECT count(*) FROM sales_lite1.returns WHERE id='${legacyResult.returnId}';`),'1');
 assert.deepEqual((await counter(id(101))).products[0],beforeLegacyReturn,'PRE_COUNTER_RETURN_REQUIRES_MANUAL_COUNT');
 assert.equal(await sql(`SELECT count(*) FROM sales_lite3.quantity_events WHERE order_id='${legacySale.orderId}';`),'0');
 report.cases.push({name:'sale before tracking:financial return commits;quantity remains untouched for manual review',passed:true});
 await set(id(103),3);
 const beforePrecheck=await privateSnapshotForPrecheck();
 const shortage=await rpc(`lite3_pos_quantity_check223(${j([base(4)])})`);
 assert.deepEqual(shortage.shortages.map(row=>({productId:row.productId,quantity:row.quantity,required:row.required,unitName:row.unitName})),[{productId:id(103),quantity:3,required:4,unitName:'باكيت'}]);
 assert.deepEqual(await privateSnapshotForPrecheck(),beforePrecheck,'POS_QUANTITY_READ_WROTE_ROWS');
 async function privateSnapshotForPrecheck(){return json("SELECT jsonb_build_object('counter',(SELECT jsonb_agg(to_jsonb(c) ORDER BY product_id) FROM sales_lite3.quantity_counters c),'events',(SELECT count(*) FROM sales_lite3.quantity_events),'keys',(SELECT count(*) FROM sales_lite3.quantity_requests));");}
 report.cases.push({name:'actual owner POS shortage precheck reports required4/remaining3 in real units and writes no rows',passed:true});
 const trackedBefore=await readApplicationFingerprint(c.executor);
 const privateSnapshot=()=>json("SELECT jsonb_build_object('counters',(SELECT jsonb_agg(to_jsonb(c) ORDER BY product_id) FROM sales_lite3.quantity_counters c),'events',(SELECT count(*) FROM sales_lite3.quantity_events),'counterRequests',(SELECT count(*) FROM sales_lite3.quantity_requests),'saleRequests',(SELECT count(*) FROM sales_lite1.requests));");
 const privateBefore=await privateSnapshot();
 await sql(transaction(`lite1_pos2(${j(request([base()]))},'quantity223-tracked-sale-rollback')`).replace('COMMIT;','ROLLBACK;'));
 assert.deepEqual((await readApplicationFingerprint(c.executor)).tables,trackedBefore.tables,'TRACKED_POS_ROLLBACK_APPLICATION_ROWS');
 assert.deepEqual(await privateSnapshot(),privateBefore,'TRACKED_POS_ROLLBACK_COUNTER_AUDIT_REQUESTS');
 report.cases.push({name:'actual tracked POS rollback restores quantity/audit/outbox/financial rows and leaves no consumed request key',passed:true});
 const firstRequest=request([base()]),key=randomUUID(),first=await pos(firstRequest,key);
 assert.equal((await counter(id(103))).products[0].quantity,2);
 assert.equal((await pos(firstRequest,key)).orderId,first.orderId);
 assert.equal((await counter(id(103))).products[0].quantity,2,'POS_REPLAY_DEBITED_TWICE');
 const shortageCheck=await rpc(`lite3_pos_quantity_check223(${j([base(3)])})`);
 assert.equal(shortageCheck.shortages.length,1);assert.equal(shortageCheck.shortages[0].quantity,2);assert.equal(shortageCheck.shortages[0].required,3);
 await assert.rejects(pos(request([base(3)])),/LITE1_UNAVAILABLE_CONFIRM_REQUIRED: QUANTITY223_SHORTAGE/u);
 assert.equal((await counter(id(103))).products[0].quantity,2,'UNCONFIRMED_POS_DEBITED');
 const short=await pos(request([base(3)],[id(103)]));
 assert.equal((await counter(id(103))).products[0].quantity,0);
 const shortEvidence=await json(`SELECT jsonb_build_object('requested',requested_quantity,'applied',applied_quantity,'shortage',shortage_quantity) FROM sales_lite3.quantity_events WHERE kind='sale' AND order_id='${short.orderId}';`);
 assert.deepEqual(shortEvidence,{requested:3,applied:2,shortage:1});
 assert.equal(await sql(`SELECT count(*) FROM public.audit_logs WHERE entity_id='${short.orderId}' AND action='OPTIONAL_QUANTITY_SHORTAGE';`),'1');
 report.cases.push({name:'POS subtracts base units once;unconfirmed shortage refuses;explicit confirmation clamps0 and audits exact shortfall',passed:true});
 await set(id(103),10);
 const parcel={commercial_line_kind:'legacy_single_sku_parcel',product_id:id(103),parcel_quantity:1,units_per_parcel:5};
 const parcelSale=await pos(request([parcel]));assert.equal(parcelSale.totalInMinorUnits,4500);
 assert.equal((await counter(id(103))).products[0].quantity,5,'PARCEL_NOT_BASE_UNITS');
 await assert.rejects(pos(request([base(3),base(3)])),/commercial identities must be unique/u);
 const aggregate=request([base(1),parcel]);
 await assert.rejects(pos(aggregate),/LITE1_UNAVAILABLE_CONFIRM_REQUIRED: QUANTITY223_SHORTAGE/u);
 assert.equal((await counter(id(103))).products[0].quantity,5,'AGGREGATE_REFUSAL_CHANGED_COUNTER');
 await pos({...aggregate,unavailableConfirmed:[id(103)]});
 assert.equal((await counter(id(103))).products[0].quantity,0);
 report.cases.push({name:'parcel converts5 base units at stored4500;repeated product lines require aggregate confirmation',passed:true});
 // Use the existing v6 writer to give the family a genuine outer unit before
 // the existing configurable-parcel UI writer defines its allowed flavors.
 await rpc(`save_product_unit('صندوق اختبار العدّاد','Q223-BOX',1,NULL)`);
 await sql(transaction(`lite3_counter_context223('${id(100)}')`).replace("SELECT public.lite3_counter_context223('"+id(100)+"')",`DO $family$ DECLARE p public.products;box UUID;BEGIN SELECT * INTO STRICT p FROM public.products WHERE id='${id(100)}';SELECT id INTO STRICT box FROM public.units WHERE code='Q223-BOX';PERFORM public.update_product_master_v6(p.id,p.updated_at,p.sku,p.barcode,p.name_ar,p.description,p.category_id,p.brand_id,p.unit_id,p.purchase_unit_id,p.units_per_purchase_unit,p.default_purchase_price_in_minor_units,box,5,5000,p.cost_price_in_minor_units,p.min_stock_level,p.max_stock_level,p.is_active,NULL,1000,false);END $family$`));
 const configuration=(await rpc(`save_product_parcel_configuration_v1('${id(100)}','configurable_mix',true,5,ARRAY['${id(101)}','${id(102)}']::UUID[])`)).configuration;
 await rpc("set_configurable_parcel_feature_state_v1('ENABLED')");
 await set(id(101),5);await set(id(102),5);
 const mixed={commercial_line_kind:'configurable_parcel',family_product_id:id(100),parcel_configuration_id:configuration.id,configuration_revision:configuration.configuration_revision,parcel_instances:[{components:[{product_id:id(101),base_quantity:2},{product_id:id(102),base_quantity:3}]}]};
 const mixedSale=await pos(request([mixed]));
 assert.equal((await counter(id(101))).products[0].quantity,3);assert.equal((await counter(id(102))).products[0].quantity,2);
 assert.equal(await sql(`SELECT count(*) FROM sales_lite3.quantity_counters WHERE product_id='${id(100)}';`),'0');
 report.cases.push({name:'real mixed parcel consumes2/3 per flavor;non-sellable parent never has a counter',passed:true});
 const returnedParcel=await json(`SELECT jsonb_build_object('item',i.id,'id',p.id,'components',(SELECT jsonb_agg(jsonb_build_object('id',c.id,'product',c.product_id,'quantity',c.base_quantity) ORDER BY c.product_id) FROM public.order_parcel_components c WHERE c.parcel_instance_id=p.id)) FROM public.order_items i JOIN public.order_parcel_instances p ON p.order_item_id=i.id WHERE i.order_id='${mixedSale.orderId}';`);
 const mixedReturnPayload={orderId:mixedSale.orderId,reason:'مرتجع طرد مشكل صالح وتالف للعداد',refundMethod:'cash',supplierAssignments:[],
  items:[{return_scope:'parcel_instance',order_item_id:returnedParcel.item,parcel_instance_id:returnedParcel.id,components:returnedParcel.components.map(component=>({parcel_component_id:component.id,accepted_quantity:component.quantity,rejected_quantity:0,accepted_condition:component.product===id(101)?'supplier_defect':'sellable',accepted_stock_disposition:component.product===id(101)?'non_sellable':'restock',rejection_reason:null,rejected_stock_disposition:null}))}],
  physicalSources:returnedParcel.components.map(component=>({root_source_kind:'parcel_component',root_source_id:component.id,source_kind:'parcel_component',source_id:component.id,product_id:component.product,quantity:component.quantity,sellable_restock_quantity:component.product===id(101)?0:component.quantity,defect_non_sellable_quantity:component.product===id(101)?component.quantity:0,customer_damage_quantity:0}))};
 const mixedPreview=await rpc(`lite1_preview_return2(${j(mixedReturnPayload)})`),mixedReturnKey=randomUUID();
 const mixedReturnCommand=`lite1_settle_return2(${j(mixedReturnPayload)},${q(mixedReturnKey)},${q(mixedPreview.previewFingerprint)})`;
 const mixedReturned=await rpc(mixedReturnCommand);assert.equal(mixedReturned.goodQuantity,3);assert.equal(mixedReturned.badQuantity,2);
 assert.equal((await counter(id(101))).products[0].quantity,3);assert.equal((await counter(id(102))).products[0].quantity,5);
 assert.deepEqual(await rpc(mixedReturnCommand),mixedReturned);assert.equal((await counter(id(102))).products[0].quantity,5);
 report.cases.push({name:'real mixed-parcel return credits only the3 resellable units of their own flavor;2 defective units do not return;replay once',passed:true});
 // Real guest handler RPC with its authoritative quote and sealed idempotency.
 const guestRequest=async()=>{
  const lines=[{...base(),expected_unit_price_in_minor_units:1000}],plan=await json(`BEGIN;SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);SELECT sales_lite2.plan(${j(lines)},'customer_v2',0,NULL,'0796600401','inside_ramtha');COMMIT;`);
  return {phoneHash:'c'.repeat(64),sessionHash:'d'.repeat(64),recipient:{fullName:'مستلم عدّاد وهمي',phone:'0796600401',governorate:'إربد',city:'الرمثا',area:'حي الاختبار',street:'شارع الاختبار'},lines,promotionCode:null,paymentMethod:'cash_on_delivery',deliveryZone:'inside_ramtha',expectedQuote:Object.fromEntries(Object.entries(plan).filter(([k])=>k!=='lines'))};
 };
 const guest=(r,key)=>rpc(`lite1_guest2(${j(r)},${q(key)})`,{role:'service_role'},'service_role');
 await set(id(103),1);
 const guestBody=await guestRequest(),guestKey=randomUUID(),created=await guest(guestBody,guestKey);
 assert.equal((await counter(id(103))).products[0].quantity,0);
 assert.deepEqual(await guest(guestBody,guestKey),created);assert.equal((await counter(id(103))).products[0].quantity,0);
 await assert.rejects(guest(guestBody,randomUUID()),/QUANTITY223_INSUFFICIENT/u);
 const cancelKey=randomUUID(),cancel=`lite1_cancel_guest2('${created.order_id}','${cancelKey}','اختبار إعادة كمية طلب الملغى')`;
 await rpc(cancel);assert.equal((await counter(id(103))).products[0].quantity,1);
 await rpc(cancel);assert.equal((await counter(id(103))).products[0].quantity,1,'CANCEL_REPLAY_CREDITED_TWICE');
 report.cases.push({name:'real guest creation debits once;zero refuses;idempotent cancellation restores once',passed:true});
 // Two independent keys race for the actual last base unit. Existing product
 // locks serialize them;exactly one order commits,one fails with no writes.
 const race=await Promise.allSettled([guest(guestBody,randomUUID()),guest(guestBody,randomUUID())]);
 assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.match(race.find(r=>r.status==='rejected').reason.message,/QUANTITY223_INSUFFICIENT/u);
 assert.equal((await counter(id(103))).products[0].quantity,0);
 report.cases.push({name:'actual two-guest last-unit race:one committed order,one refusal,never negative',passed:true});
 const alerts=()=>json(`SELECT COALESCE(jsonb_agg(jsonb_build_object('type',event_type,'payload',payload) ORDER BY created_at,id),'[]') FROM public.automation_events WHERE entity_id='${id(102)}' AND payload->>'quantitySource'='sales_only_counter';`);
 await set(id(102),3);
 await pos(request([base(2,id(102))]));
 assert.equal((await alerts()).filter(e=>e.type==='low_stock').length,1);
 await pos(request([base(1,id(102))]));
 assert.equal((await alerts()).filter(e=>e.type==='out_of_stock').length,1);
 await pos(request([base(1,id(102))],[id(102)]));assert.equal((await alerts()).length,2,'ZERO_ALERT_REPEATED');
 await set(id(102),3);await pos(request([base(2,id(102))]));
 const eventRows=await alerts();assert.equal(eventRows.filter(e=>e.type==='low_stock').length,2);assert.equal(eventRows.length,3);
 assert.ok(eventRows.every(e=>e.payload.audience==='owner'&&e.payload.unitName==='باكيت'&&e.payload.accountingTracked===false));
 report.cases.push({name:'existing217 outbox types:one low crossing,one zero crossing,no per-sale repetition,rearm on replenishment,owner payload',passed:true});
 await set(id(103),10);
 const returnSale=await pos(request([base(4)]));
 const itemId=await sql(`SELECT id FROM public.order_items WHERE order_id='${returnSale.orderId}';`);
 const returnPayload=(quantity,good)=>({orderId:returnSale.orderId,reason:'اختبار إعادة الصالح فقط للعدّاد',notes:null,refundMethod:'cash',referenceNumber:null,
  items:[{return_scope:'base_unit',order_item_id:itemId,quantity,stock_disposition:good?'restock':'damaged'}],
  physicalSources:[{root_source_kind:'base_order_item',root_source_id:itemId,source_kind:'base_order_item',source_id:itemId,product_id:id(103),quantity,sellable_restock_quantity:good,defect_non_sellable_quantity:quantity-good,customer_damage_quantity:0}],supplierAssignments:[]});
 const settle=async(payload,key,rollback=false)=>{
  const preview=await rpc(`lite1_preview_return2(${j(payload)})`);
  const command=transaction(`lite1_settle_return2(${j(payload)},${q(key)},${q(preview.previewFingerprint)})`);
  return json(rollback?command.replace('COMMIT;','ROLLBACK;'):command);
 };
 const returnBefore=await readApplicationFingerprint(c.executor),counterBeforeReturn=await privateSnapshot();
 await settle(returnPayload(2,1),randomUUID(),true);
 assert.deepEqual((await readApplicationFingerprint(c.executor)).tables,returnBefore.tables,'RETURN_ROLLBACK_APPLICATION_ROWS');
 assert.deepEqual(await privateSnapshot(),counterBeforeReturn,'RETURN_ROLLBACK_COUNTER_ROWS');
 const partialPayload=returnPayload(2,1),partialKey=randomUUID(),partial=await settle(partialPayload,partialKey);
 assert.equal(partial.goodQuantity,1);assert.equal(partial.badQuantity,1);
 assert.equal((await counter(id(103))).products[0].quantity,7);
 // The exact committed request/fingerprint is replayed,not a fresh preview
 // after its entitlement has already been consumed.
 const replayRow=await json(`SELECT result FROM sales_lite1.requests WHERE key=${q(partialKey)};`);
 const replayPreview=await sql(`SELECT details->>'preview' FROM public.audit_logs WHERE action='LITE2_RETURN' AND details->>'returnId'='${partial.returnId}';`);
 assert.deepEqual(await rpc(`lite1_settle_return2(${j(partialPayload)},${q(partialKey)},${q(replayPreview)})`),replayRow);
 assert.equal((await counter(id(103))).products[0].quantity,7);
 await settle(returnPayload(1,0),randomUUID());assert.equal((await counter(id(103))).products[0].quantity,7);
 await settle(returnPayload(1,1),randomUUID());assert.equal((await counter(id(103))).products[0].quantity,8);
 assert.equal(await sql(`SELECT count(*) FROM sales_lite3.quantity_events WHERE order_id='${returnSale.orderId}' AND kind='return';`),'2');
 report.cases.push({name:'real partial good/bad returns credit resellable quantity only;bad return inert;exact replay and rollback preserve counters/financial rows',passed:true});

 // Exercise the approved writer,not a direct unit update. A disabled counter
 // still freezes its original base unit;never-tracked products remain free.
 await rpc("save_product_unit('وحدة بديلة اختبار العدّاد','Q223-UNIT',1,NULL)");
 const editUnit=(pid,target)=>transaction(`lite3_counter_context223('${pid}')`).replace(`SELECT public.lite3_counter_context223('${pid}')`,
  `DO $unit$ DECLARE p public.products;target UUID;BEGIN SELECT * INTO STRICT p FROM public.products WHERE id='${pid}';SELECT id INTO STRICT target FROM public.units WHERE code='${target}';PERFORM public.update_product_master_v6(p.id,p.updated_at,p.sku,p.barcode,p.name_ar,p.description,p.category_id,p.brand_id,target,p.purchase_unit_id,p.units_per_purchase_unit,p.default_purchase_price_in_minor_units,p.sale_unit_id,p.units_per_sale_unit,p.default_sale_price_in_minor_units,p.cost_price_in_minor_units,p.min_stock_level,p.max_stock_level,p.is_active,NULL,p.sale_price_in_minor_units,p.parcel_only);END $unit$`);
 const beforeFreeze=await readApplicationFingerprint(c.executor);
 await assert.rejects(sql(editUnit(id(103),'Q223-UNIT')),/QUANTITY223_BASE_UNIT_FROZEN/u);
 assert.deepEqual((await readApplicationFingerprint(c.executor)).tables,beforeFreeze.tables,'FROZEN_UNIT_REFUSAL_CHANGED_APPLICATION_ROWS');
 await set(id(103),8,false);
 const disabledFreeze=await readApplicationFingerprint(c.executor);
 await assert.rejects(sql(editUnit(id(103),'Q223-UNIT')),/QUANTITY223_BASE_UNIT_FROZEN/u);
 await assert.rejects(sql(editUnit(id(100),'Q223-UNIT')),/QUANTITY223_BASE_UNIT_FROZEN/u);
 assert.deepEqual((await readApplicationFingerprint(c.executor)).tables,disabledFreeze.tables,'DISABLED_FROZEN_UNIT_REFUSAL_CHANGED_APPLICATION_ROWS');
 const untrackedCommand=transaction(`lite3_counter_context223('${id(103)}')`).replace(`SELECT public.lite3_counter_context223('${id(103)}')`,
  `SELECT public.create_product_with_opening_stock_v6(p_sku:='Q223-NEVER-TRACKED',p_name_ar:='صنف لم يفعل عداده',p_category_id:='${id(11)}',p_unit_id:='${id(10)}',p_purchase_unit_id:='${id(10)}',p_units_per_purchase_unit:=1,p_default_purchase_price_in_minor_units:=0,p_sale_unit_id:='${id(10)}',p_units_per_sale_unit:=1,p_default_sale_price_in_minor_units:=1000,p_sale_price_in_minor_units:=1000,p_cost_price_in_minor_units:=0,p_min_stock_level:=0,p_max_stock_level:=NULL,p_warehouse_id:='${id(201)}',p_opening_quantity:=0,p_parcel_only:=false)`);
 await sql(untrackedCommand.replace('COMMIT;',`DO $never$ DECLARE p public.products;target UUID;BEGIN SELECT * INTO STRICT p FROM public.products WHERE sku='Q223-NEVER-TRACKED';SELECT id INTO STRICT target FROM public.units WHERE code='Q223-UNIT';PERFORM public.update_product_master_v6(p.id,p.updated_at,p.sku,p.barcode,p.name_ar,p.description,p.category_id,p.brand_id,target,p.purchase_unit_id,p.units_per_purchase_unit,p.default_purchase_price_in_minor_units,p.sale_unit_id,p.units_per_sale_unit,p.default_sale_price_in_minor_units,p.cost_price_in_minor_units,p.min_stock_level,p.max_stock_level,p.is_active,NULL,p.sale_price_in_minor_units,p.parcel_only);END $never$;ROLLBACK;`));
 const counterBeforeParcel=await privateSnapshot(),financialBeforeParcel=await readApplicationFingerprint(c.executor);
 await sql(transaction(`lite3_counter_context223('${id(103)}')`).replace(`SELECT public.lite3_counter_context223('${id(103)}')`,
  `DO $outer$ DECLARE p public.products;box UUID;BEGIN SELECT * INTO STRICT p FROM public.products WHERE id='${id(103)}';SELECT id INTO STRICT box FROM public.units WHERE code='Q223-BOX';PERFORM public.update_product_master_v6(p.id,p.updated_at,p.sku,p.barcode,p.name_ar,p.description,p.category_id,p.brand_id,p.unit_id,p.purchase_unit_id,p.units_per_purchase_unit,p.default_purchase_price_in_minor_units,box,6,5500,p.cost_price_in_minor_units,p.min_stock_level,p.max_stock_level,p.is_active,NULL,1000,false);IF NOT EXISTS(SELECT 1 FROM public.products WHERE id=p.id AND unit_id=p.unit_id AND sale_unit_id=box AND units_per_sale_unit=6 AND sale_price_in_minor_units=1000 AND default_sale_price_in_minor_units=5500) THEN RAISE EXCEPTION 'COUNTER_BLOCKED_OUTER_PARCEL_EDIT';END IF;END $outer$`).replace('COMMIT;','ROLLBACK;'));
 assert.deepEqual(await privateSnapshot(),counterBeforeParcel,'OUTER_PARCEL_EDIT_CHANGED_COUNTER');
 assert.deepEqual((await readApplicationFingerprint(c.executor)).tables,financialBeforeParcel.tables,'OUTER_PARCEL_EDIT_ROLLBACK_CHANGED_FINANCIAL_ROWS');
 await set(id(103),8);
 report.cases.push({name:'actual v6 base-unit changes refused after first counter activation,even disabled/family;never-tracked writer remains usable',passed:true});
 await set(id(103),3);
 const drift=await json(`BEGIN;UPDATE sales_lite3.quantity_counters SET unit_id=gen_random_uuid() WHERE product_id='${id(103)}';
 SELECT set_config('request.jwt.claims',${j({sub:id(1),role:'authenticated',aal:'aal2'})}::TEXT,true);SET LOCAL ROLE authenticated;
 DO $drift$ BEGIN
  BEGIN PERFORM public.lite3_counter_context223('${id(103)}');RAISE EXCEPTION 'DRIFT_READ_WAS_NOT_REFUSED';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'QUANTITY223_UNIT_REVIEW_REQUIRED' THEN RAISE;END IF;END;
  BEGIN PERFORM public.lite1_pos2(${j(request([base()]))},'quantity223-unit-drift-refusal');RAISE EXCEPTION 'DRIFT_SALE_WAS_NOT_REFUSED';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'QUANTITY223_UNIT_REVIEW_REQUIRED' THEN RAISE;END IF;END;
 END $drift$;RESET ROLE;
 SELECT jsonb_build_object('available',sales_lite3.effective_available223('${id(103)}'),'quantity',(SELECT quantity FROM sales_lite3.quantity_counters WHERE product_id='${id(103)}'),'keys',(SELECT count(*) FROM sales_lite1.requests WHERE key='quantity223-unit-drift-refusal'));ROLLBACK;`);
 assert.deepEqual(drift,{available:false,quantity:3,keys:0});assert.equal((await counter(id(103))).products[0].quantity,3);
 report.cases.push({name:'injected unit drift fails closed in owner read,store availability and sale;zero write/key effect;rollback restores original unit',passed:true});
 // The fixture intentionally leaves sales for later return/alert assertions.
 assert.equal(typeof root,'string');
}
