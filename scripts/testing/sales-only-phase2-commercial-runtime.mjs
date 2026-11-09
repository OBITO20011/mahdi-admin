import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {commercialSql} from './sales-only-phase2-commercial.mjs';
import {functionCatalogSql} from './sales-only-phase1-runtime.mjs';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';

export async function verifyCommercial(c,report){
 const {sql,json,rpc,id,q,j,executor}=c,branch=id(200),warehouse=id(201);
 const original=await json(functionCatalogSql);
 await sql(`BEGIN;SELECT set_config('nawasrah.sales_lite2_test','OWNED_LOCAL_DB219',true);${commercialSql(original)}COMMIT;`);
 assert.deepEqual(await json(functionCatalogSql),original,'COMMERCIAL_ADDITION_CHANGES_NO_PUBLIC_FUNCTION');
 for(const pid of [id(101),id(102),id(103)])await rpc(`create_direct_supplier_receipt_v2(p_supplier_id:=${q(id(301))},p_branch_id:=${q(branch)},p_warehouse_id:=${q(warehouse)},p_idempotency_key:=${q(randomUUID())},p_payment_method:='deferred',p_lines:=${j([{client_line_id:randomUUID(),line_kind:'base_unit',commercial_quantity:1000,base_unit_name:'باكيت',gross_amount_in_minor_units:500000,line_discount_in_minor_units:0,components:[{product_id:pid,base_quantity:1000}]}])})`);
 const configuration=(await rpc(`save_product_parcel_configuration_v1(${q(id(100))},'configurable_mix',true,5,ARRAY[${q(id(101))},${q(id(102))}]::UUID[])`)).configuration;
 await rpc("set_configurable_parcel_feature_state_v1('ENABLED')");
 const shift=(await rpc(`open_cash_shift(${q(branch)},0)`)).id;
 const base={commercial_line_kind:'base_unit',product_id:id(103),base_quantity:3};
 const parcel={commercial_line_kind:'legacy_single_sku_parcel',product_id:id(103),parcel_quantity:2,units_per_parcel:5};
 const mixed={commercial_line_kind:'configurable_parcel',family_product_id:id(100),parcel_configuration_id:configuration.id,configuration_revision:configuration.configuration_revision,parcel_instances:[{components:[{product_id:id(101),base_quantity:2},{product_id:id(102),base_quantity:3}]},{components:[{product_id:id(101),base_quantity:1},{product_id:id(102),base_quantity:4}]}]};
 let comparisons=0;
 const expectFailure=async(text,pattern)=>{let e;try{await sql(text);}catch(error){e=error;}assert.ok(e,'EXPECTED_REJECTION');assert.match(String(e.message),pattern);};
 const posProjection=(items)=>items.map(i=>({productId:i.productId,kind:i.commercialLineKind,quantity:i.quantity,baseQuantity:i.baseQuantity,size:i.unitsPerSalePackage,price:i.unitPriceInMinorUnits,gross:i.lineTotalInMinorUnits,discount:i.allocatedDiscountInMinorUnits,net:i.netRefundableAmountInMinorUnits,parcels:i.parcelInstances.map(p=>({sequence:p.instance_sequence,gross:p.gross_amount_in_minor_units,discount:p.allocated_discount_in_minor_units,net:p.net_refundable_amount_in_minor_units}))}));
 for(const lines of [[base],[parcel],[mixed],[base,parcel,mixed]]){
  for(const discount of [0,101,1001]){
   const fp=await readApplicationFingerprint(executor);
   const plan=await json(`SELECT sales_lite2.plan(${j(lines)},'admin_pos',${discount});`);
   assert.deepEqual(await readApplicationFingerprint(executor),fp,'PLANNER_ZERO_PUBLIC_WRITES');
   const full=await rpc(`create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(id(401))},'مقارنة وهمية','cash',${j(lines)},${discount},${plan.totalInMinorUnits},${q(randomUUID())})`);
   for(const field of ['subtotalInMinorUnits','discountInMinorUnits','totalInMinorUnits'])assert.equal(plan[field],full[field],field);
   const projected=plan.lines.map(l=>({productId:l.product_id,kind:l.commercial_line_kind,quantity:l.commercial_quantity,baseQuantity:l.base_quantity,size:l.units_per_parcel,price:l.unit_price_in_minor_units,gross:l.gross_amount_in_minor_units,discount:l.allocated_discount_in_minor_units,net:l.net_refundable_amount_in_minor_units,parcels:l.parcel_instances.map(p=>({sequence:p.instance_sequence,gross:p.gross_amount_in_minor_units,discount:p.allocated_discount_in_minor_units,net:p.net_refundable_amount_in_minor_units}))}));
   assert.deepEqual(projected,posProjection(full.items),'ALL_LINE_AND_PARCEL_FILS_IDENTICAL');comparisons++;
  }
 }
 const summary=await rpc(`get_cash_shift_summary(${q(shift)})`);await rpc(`close_cash_shift(${q(shift)},${summary.expectedCashInMinorUnits},NULL)`);
 report.cases.push({name:'real full POS vs untracked plan:base/carton/mixed/combined and3discounts;every line/parcel fils equal;planner zero writes',passed:true,comparisons});
 await rpc("upsert_promotion_code('LITE2_FIXED','fixed',101)");await rpc("upsert_promotion_code('LITE2_PERCENT','percentage',1250)");
 const guestLines=[{...base,expected_unit_price_in_minor_units:1000},{...parcel,expected_unit_price_in_minor_units:4500},{...mixed,expected_unit_price_in_minor_units:5000}];
 for(const promotion of [null,'LITE2_FIXED','LITE2_PERCENT'])for(const zone of ['inside_ramtha','outside_ramtha']){
  // Cancellation does not restore promotion quota. Each independent scenario
  // has a distinct synthetic identity; never relax the real redemption policy.
  const phone='079660'+String(5000+comparisons);
  const fullPreview=await rpc(`preview_guest_promotion_v2(${j(guestLines)},${q(promotion)},${q(phone)})`,null,'anon');
  const preview=await json(`SELECT sales_lite2.preview(${j(guestLines)},${q(promotion)},${q(phone)});`);assert.deepEqual(preview,fullPreview,'WHOLE_PREVIEW_JSON_EQUAL');
  const plan=await json(`SELECT sales_lite2.plan(${j(guestLines)},'customer_v2',0,${q(promotion)},${q(phone)},${q(zone)});`);
  const full=await rpc(`submit_guest_customer_order_v2(${q(randomUUID())},repeat('c',64),repeat('d',64),'طلب مقارنة وهمي',${q(phone)},'إربد','الرمثا','حي وهمي','شارع وهمي',NULL,NULL,NULL,NULL,NULL,NULL,${j(guestLines)},${q(promotion)},'cash_on_delivery',${q(zone)},${plan.subtotalInMinorUnits},${plan.discountInMinorUnits},${plan.deliveryFeeInMinorUnits},${plan.totalInMinorUnits})`,null,'service_role');
  const actual=await json(`SELECT jsonb_build_array(subtotal_in_minor_units,discount_in_minor_units,delivery_fee_in_minor_units,total_in_minor_units) FROM public.orders WHERE id=${q(full.order_id)};`);
  assert.deepEqual(actual,[plan.subtotalInMinorUnits,plan.discountInMinorUnits,plan.deliveryFeeInMinorUnits,plan.totalInMinorUnits]);
  await rpc(`cancel_customer_order_v2(${q(full.order_id)},${q(randomUUID())},'انتهاء المقارنة')`);comparisons++;
 }
 report.cases.push({name:'guest full writer and whole promotion preview JSON equal:null/fixed/percentage andboth delivery zones',passed:true,comparisons:6});
 const noWac=await json(`BEGIN;UPDATE public.products SET wac_cost_in_minor_units_exact=NULL WHERE id IN(${q(id(101))},${q(id(102))});SELECT sales_lite2.preview(${j([{...mixed,expected_unit_price_in_minor_units:5000}])},NULL,NULL);ROLLBACK;`);
 assert.equal(noWac.merchandiseSubtotalInMinorUnits,10000);
 await expectFailure(`BEGIN;UPDATE public.products SET wac_cost_in_minor_units_exact=NULL WHERE id=${q(id(101))};SELECT public.preview_guest_promotion_v2(${j([{...mixed,expected_unit_price_in_minor_units:5000}])},NULL,NULL);ROLLBACK;`,/PHASE3_EXACT_WAC_UNAVAILABLE/);
 await expectFailure(`SELECT sales_lite2.plan(${j([{...guestLines[0],expected_unit_price_in_minor_units:1}])},'customer_v2',0,NULL,'0796600403','inside_ramtha');`,/PHASE3_CUSTOMER_QUOTE_STALE/);
 await expectFailure(`SELECT sales_lite2.plan(${j([{...mixed,parcel_instances:[{components:[{product_id:id(101),base_quantity:4}]}]}])},'admin_pos');`,/PARCEL_CAPACITY_MISMATCH/);
 const acl=await json("SELECT jsonb_agg(jsonb_build_array(r.rolname,has_function_privilege(r.oid,p.oid,'EXECUTE')) ORDER BY r.rolname,p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN pg_roles r WHERE n.nspname='sales_lite2' AND r.rolname IN('anon','authenticated','service_role');");
 assert.ok(acl.length===6&&acl.every(x=>x[1]===false));
 report.cases.push({name:'cost-free mixed planner withoutWAC;original still rejects;stalequote/capacity/ACL negatives preserved',passed:true});
 assert.deepEqual(await json(functionCatalogSql),original,'ALL636_PUBLIC_FUNCTIONS_STILL_IDENTICAL');
 report.commercialComparisons=comparisons;
}
