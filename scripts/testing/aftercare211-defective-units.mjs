// Owner23Oct defective-piece exception. Actual supported writers in a disposable DB.
import assert from 'node:assert/strict';
export async function verifyDefectiveParcelUnits({sql,json,rpc,fail,pass,q,j,key,id,branch,warehouse,supplier,receive,stock,money,facts,command,oldCommand,raceWriter,fingerprint}){
 let n=850;
 const pos=(pid,line,k=key())=>`create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(id(401))},'عميل الطرد','cash',${j([{...line,product_id:pid,price_authority:'server_catalog',line_discount_in_minor_units:0}])},0,15000,${q(k)})`;
 const setup=async only=>{
  const pid=id(++n);await sql(`INSERT INTO products(id,sku,name_ar,category_id,unit_id,purchase_unit_id,sale_unit_id,units_per_purchase_unit,units_per_sale_unit,sale_price_in_minor_units,default_sale_price_in_minor_units,cost_price_in_minor_units,wac_cost_in_minor_units_exact,is_active,is_flavor_master,parcel_only)
   SELECT ${q(pid)},${q('DEFECT211-'+n)},'طرد تجربة العيب',category_id,unit_id,purchase_unit_id,sale_unit_id,10,10,1500,15000,0,0,true,false,${only} FROM products WHERE id=${q(id(103))};`);
  await receive(pid,10,1000);const sale=await rpc(pos(pid,{commercial_line_kind:'legacy_single_sku_parcel',parcel_quantity:1,units_per_parcel:10}));
  const item=await json(`SELECT to_jsonb(id) FROM order_items WHERE order_id=${q(sale.orderId)};`);await receive(pid,10,1500);
  return{pid,sale,item};
 };
 const replace=(s,items=[{sourceKind:'base_order_item',sourceId:s.item,quantity:1}],k=key())=>`settle_sales_replacement_v1(${q(s.sale.orderId)},${q(k)},${j(items)},'حبة معيبة تبديل فقط',NULL)`;
 const source=(s,kind,sourceId,quantity)=>({root_source_kind:'base_order_item',root_source_id:s.item,source_kind:kind,source_id:sourceId,product_id:s.pid,quantity,sellable_restock_quantity:quantity,defect_non_sellable_quantity:0,customer_damage_quantity:0});
 const ret=(s,qty,physical,k=key())=>`settle_admin_sales_return_v1(${q(s.sale.orderId)},${q(k)},${j([{return_scope:'base_unit',order_item_id:s.item,quantity:qty,stock_disposition:'restock'}])},${j(physical)},'إرجاع الطرد كاملاً','cash',NULL,NULL)`;
 for(const only of [false,true]){
  const s=await setup(only),before=await stock(s.pid),beforeMoney=await money(),k=key(),call=replace(s,undefined,k),issued=await rpc(call);
  assert.equal(issued.issuedQuantity,1);assert.equal(issued.moneyRefundInMinorUnits,0);assert.equal(issued.debtReductionInMinorUnits,0);
  assert.equal((await stock(s.pid)).quantity,before.quantity-1);assert.deepEqual(await money(),beforeMoney);
  const leaf=await json(`SELECT to_jsonb(id) FROM sales_replacement_items WHERE operation_id=${q(issued.operationId)};`);
  const context=await rpc(`get_admin_sales_aftercare_context_v1(${q(s.sale.orderId)})`);assert.equal(context.supported,true);
  const leaves=context.baseItems[0].physicalRepresentatives;assert.equal(leaves.reduce((a,b)=>a+b.remainingQuantity,0),10);assert.ok(leaves.some(x=>x.sourceId===s.item&&x.remainingQuantity===9));assert.ok(leaves.some(x=>x.sourceId===leaf&&x.remainingQuantity===1));
  await fail(ret(s,1,[source(s,'replacement_item',leaf,1)]),/WHOLE_SINGLE_SKU_PARCEL_REQUIRED/);
  await fail(ret(s,9,[source(s,'base_order_item',s.item,9)]),/WHOLE_SINGLE_SKU_PARCEL_REQUIRED/);
  if(only)await fail(pos(s.pid,{commercial_line_kind:'base_unit',base_quantity:1}),/PARCEL209_UNIT_SALE_FORBIDDEN/);
  const full=ret(s,10,[source(s,'base_order_item',s.item,9),source(s,'replacement_item',leaf,1)]),returned=await rpc(full);
  assert.equal(returned.success,true);assert.equal((await stock(s.pid)).quantity,before.quantity-1+10);
  const costs=await json(`SELECT jsonb_agg(jsonb_build_array(x->>'source_kind',(x->>'quantity')::INTEGER,(x->>'historical_value_exact')::NUMERIC/(x->>'quantity')::INTEGER) ORDER BY x->>'source_kind') FROM phase42_return_inventory_effects e CROSS JOIN LATERAL jsonb_array_elements(e.source_evidence) x WHERE e.operation_id=${q(returned.operationId)};`);
  assert.deepEqual(costs,[['base_order_item',9,1000],['replacement_item',1,1500]]);
  // Completed replacement replay remains valid after the issued leaf was returned.
  const committed=await fingerprint();assert.deepEqual(await rpc(call),issued);assert.deepEqual(await rpc(full),returned);assert.deepEqual(await fingerprint(),committed);
  await fail(replace(s,[{sourceKind:'replacement_item',sourceId:leaf,quantity:1}]),/CONSUMED|remaining|capacity/i);
  pass(`ordinary parcel_only=${only}:defective1 exchanges with no money;partial1/9 refund denied;whole10 refund consumes original9@1000+replacement1@1500;historical replay unchanged`);
 }
 const s=await setup(true),before=await stock(s.pid),priorMoney=await money(),financialBefore=await facts();
 const payload={orderId:s.sale.orderId,items:[{sourceKind:'base_order_item',sourceId:s.item,quantity:1}],reason:'حبة معيبة للمورد',supplierId:supplier};
 const held=(await rpc(command('replacement_supplier',payload))).cases[0];assert.equal(held.pendingQuantity,1);assert.equal(Number(held.unitCostInMinorUnitsExact),1000);
 assert.equal(financialBefore.sales.netProfitInMinorUnits-(await facts()).sales.netProfitInMinorUnits,500);assert.deepEqual(await money(),priorMoney);
 const original=await json(`SELECT to_jsonb(id) FROM sales_replacement_items WHERE root_order_item_id=${q(s.item)};`);
 const second=await rpc(replace(s,[{sourceKind:'replacement_item',sourceId:original,quantity:1}]));assert.equal(second.issuedQuantity,1);
 assert.equal((await stock(s.pid)).quantity,before.quantity-2);await rpc(oldCommand('receive',{caseId:held.id,quantity:1,reason:'استلام حبة المورد'}));
 assert.equal((await stock(s.pid)).quantity,before.quantity-1);pass('parcel_only defective unit atomic supplier hold1000 leaves500;replacement-of-replacement1 and historical receipt remain exact');
 const bulk=await setup(true),first=await rpc(replace(bulk)),leaf=await json(`SELECT to_jsonb(id) FROM sales_replacement_items WHERE operation_id=${q(first.operationId)};`);
 await receive(bulk.pid,1,1500);assert.equal((await rpc(replace(bulk,[{sourceKind:'base_order_item',sourceId:bulk.item,quantity:9},{sourceKind:'replacement_item',sourceId:leaf,quantity:1}]))).issuedQuantity,10);
 pass('full ordinary parcel replacement after unit exchange accepts original9+current replacement1 under same capacity and canonical locks');
 for(const wholeFirst of [true,false]){
  const race=await setup(true),raceStock=await stock(race.pid),whole=replace(race,[{sourceKind:'base_order_item',sourceId:race.item,quantity:10}]),unit=replace(race,[{sourceKind:'base_order_item',sourceId:race.item,quantity:1}]);
  const loser=await raceWriter(wholeFirst?whole:unit,wholeFirst?unit:whole);assert.notEqual(loser.code,0);assert.match(loser.stderr,/CONSUMED|remaining/i);assert.equal((await stock(race.pid)).quantity,raceStock.quantity-(wholeFirst?10:1));
  pass('real concurrent whole-parcel vs defective-unit order/source locks;wholeFirst='+wholeFirst+';only remaining capacity wins,no extra issue');
 }
 const reversible=await setup(true),reversalStock=await stock(reversible.pid),reversalFacts=await facts();
 const reverseCase=(await rpc(command('replacement_supplier',{orderId:reversible.sale.orderId,items:[{sourceKind:'base_order_item',sourceId:reversible.item,quantity:1}],reason:'حبة للمورد تجربة العكس',supplierId:supplier}))).cases[0];
 const reverseCall=oldCommand('reverse',{eventId:reverseCase.events[0].id,reason:'عكس تعليق الحبة للمورد'});await rpc(reverseCall);const reversed=await fingerprint();await rpc(reverseCall);assert.deepEqual(await fingerprint(),reversed);
 assert.equal((await stock(reversible.pid)).quantity,reversalStock.quantity-1);assert.equal(reversalFacts.sales.netProfitInMinorUnits-(await facts()).sales.netProfitInMinorUnits,1500);
 pass('defective parcel-unit supplier hold reversal/replay:historical1000 offset once;issued1500 loss retained;one stock out unchanged');
 const admin=await setup(true),adminId=id(600);assert.equal((await rpc(replace(admin),adminId)).issuedQuantity,1);
 for(const uid of [id(601),id(602),id(603),id(604),id(605)])await fail(replace(admin),/ROLE|صلاحية|FORBIDDEN/,uid);
 for(const role of ['anon','service_role'])await fail(replace(admin),/permission denied/,id(1),role);
 for(const role of ['anon','authenticated','service_role'])await fail(`aftercare211_assert_replacement_root_internal(${q(admin.item)},1)`,/permission denied/,id(1),role);
 pass('ordinary defective-unit issuer keeps owner/admin only;all other roles deny writes;private root helper never callable by clients');
 // A parcel-only family still forbids unit sales,while defective saved components
 // may be exchanged. Root guard follows immutable lineage rather than UI flags.
 const family=id(100),a=id(101),b=id(102);await sql(`UPDATE products SET parcel_only=true,units_per_sale_unit=5 WHERE id=${q(family)};`);
 await receive(a,10,1000);await receive(b,10,1000);
 const conf=await rpc(`save_product_parcel_configuration_v1(${q(family)},'configurable_mix',true,5,ARRAY[${q(a)},${q(b)}]::uuid[])`);await rpc("set_configurable_parcel_feature_state_v1('ENABLED')");
 const mixed=await rpc(`create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(id(401))},'عميل المشكّل','cash',${j([{commercial_line_kind:'configurable_parcel',family_product_id:family,parcel_configuration_id:conf.configuration.id,configuration_revision:conf.configuration.configuration_revision,parcel_instances:[{components:[{product_id:a,base_quantity:2},{product_id:b,base_quantity:3}]}],price_authority:'server_catalog',line_discount_in_minor_units:0}])},0,5000,${q(key())})`);
 const component=await json(`SELECT to_jsonb(c.id) FROM order_parcel_components c JOIN order_parcel_instances i ON i.id=c.parcel_instance_id WHERE i.order_id=${q(mixed.orderId)} AND c.product_id=${q(a)};`);
 const mixedIssued=await rpc(`settle_sales_replacement_v1(${q(mixed.orderId)},${q(key())},${j([{sourceKind:'parcel_component',sourceId:component,quantity:1}])},'حبة معيبة من المشكّل',NULL)`);assert.equal(mixedIssued.issuedQuantity,1);
 await fail(`create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(id(401))},'ممنوع','cash',${j([{commercial_line_kind:'base_unit',product_id:a,base_quantity:1,price_authority:'server_catalog',line_discount_in_minor_units:0}])},0,1000,${q(key())})`,/PARCEL209_UNIT_SALE_FORBIDDEN/);
 pass('parcel_only mixed family:one defective component exchanges;flavor inherits parcel-only and single-unit sale still refuses');
}
