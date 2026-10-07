import assert from 'node:assert/strict';

const actor='92400000-0000-0000-0000-000000000001';
const warehouse='92400000-0000-0000-0000-000000000201';
const branch='92400000-0000-0000-0000-000000000200';
const sku='92400000-0000-0000-0000-000000000103';
const literal=value=>`'${String(value).replaceAll("'","''")}'`;
const claims=`SELECT set_config('request.jwt.claims','{"sub":"${actor}","role":"authenticated","aal":"aal2"}',false); SET ROLE authenticated;`;
const sale=(key,kind='base_unit',quantity=1,method='cash')=>`SELECT create_pos_sale_v2('${warehouse}','${branch}',NULL,'D correction',${literal(method)},
  ${literal(JSON.stringify([{commercial_line_kind:kind,product_id:sku,
    ...(kind==='base_unit'?{base_quantity:quantity}:{parcel_quantity:quantity,units_per_parcel:5})}]))}::jsonb,0,20000,${literal(key)});`;
const tables=['orders','order_items','business_operations','inventory_balances','inventory_movements','cash_shifts',
  'customer_payments','sales_return_events','sales_return_items','sales_replacement_events','sales_replacement_items',
  'sales_aftercare_consumptions','phase42_return_inventory_effects','phase43_replacement_inventory_effects',
  'phase42_return_settlement_evidence','phase43_replacement_settlement_evidence'];
const fingerprintQuery=names=>`SELECT jsonb_build_object(${names.map(name=>`${literal(name)},
  (SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public.${name} t)`).join(',')});`;

function cartonDamageQuery(orderId,item,key,damage,sellable=0) {
  const quantity=5;
  return `SELECT settle_admin_sales_return_v1('${orderId}',${literal(key)},
    '${JSON.stringify([{return_scope:'base_unit',order_item_id:item,quantity,
      stock_disposition:sellable?'restock':'damaged',...(damage?{customer_damage_quantity:damage}:{})}])}'::jsonb,
    '${JSON.stringify([{root_source_kind:'base_order_item',root_source_id:item,source_kind:'base_order_item',
      source_id:item,product_id:sku,quantity,sellable_restock_quantity:sellable,
      defect_non_sellable_quantity:quantity-damage-sellable,customer_damage_quantity:damage}])}'::jsonb,
    'D historical carton damage',${damage===quantity?'NULL':"'cash'"},NULL,NULL);`;
}

async function proveCartonDamage({sql,json,oldDamageOrderId}) {
  console.error('[Package D] historical carton damage before/after proof');
  const snapshot=()=>json(fingerprintQuery(tables));
  await sql(`UPDATE products SET sale_price_in_minor_units=1200,wholesale_price_in_minor_units=4500,
    units_per_sale_unit=5,wac_cost_in_minor_units_exact=100,cost_price_in_minor_units=100 WHERE id='${sku}';`);
  const created=await json(claims+sale('package-d-new-damage-cartons','legacy_single_sku_parcel',3));
  const item=await sql(`SELECT id FROM order_items WHERE order_id='${created.orderId}';`);
  const original=await json(`SELECT to_jsonb(t) FROM order_items t WHERE id='${item}';`);
  assert.equal(original.effective_standalone_unit_sale_price_snapshot_in_minor_units,1200);
  const before=await snapshot();
  await assert.rejects(sql(`UPDATE order_items SET effective_standalone_unit_sale_price_snapshot_in_minor_units=9999 WHERE id='${item}';`),
    /PACKAGE_D_CARTON_PRICE_IMMUTABLE/u);
  assert.deepEqual(await snapshot(),before);
  await sql(`UPDATE products SET sale_price_in_minor_units=9000,wac_cost_in_minor_units_exact=900,
    cost_price_in_minor_units=900 WHERE id='${sku}';`);
  const mixedQuery=cartonDamageQuery(created.orderId,item,'package-d-new-mixed-carton',2,2);
  const mixed=await json(claims+mixedQuery); assert.equal(mixed.success,true);
  console.error('[Package D] mixed-carton settlement committed; checking evidence/replay');
  const facts=await json(`SELECT jsonb_build_object('net',i.refund_amount_snapshot_in_minor_units,
    'raw',i.raw_customer_damage_deduction_in_minor_units,'applied',i.applied_customer_damage_deduction_in_minor_units,
    'accepted',i.accepted_base_quantity,'rejected',i.rejected_base_quantity,'stock',e.sellable_quantity,
    'cost',e.historical_restock_value_in_minor_units_exact) FROM sales_return_items i
    JOIN phase42_return_inventory_effects e ON e.operation_id=i.operation_id WHERE i.operation_id='${mixed.operationId}';`);
  assert.deepEqual(facts,{net:2100,raw:2400,applied:2400,accepted:3,rejected:2,stock:2,cost:200});
  const committed=await snapshot();
  const replay=await json(claims+mixedQuery);
  assert.equal(replay.operationId,mixed.operationId); assert.deepEqual(await snapshot(),committed);
  // Two cartons cannot share one damage cap; no cross-carton entitlement leak.
  const grouped=cartonDamageQuery(created.orderId,item,'package-d-grouped-damage-rejected',2,2)
    .replaceAll('"quantity":5','"quantity":10').replaceAll('"defect_non_sellable_quantity":1','"defect_non_sellable_quantity":6');
  await assert.rejects(sql(claims+grouped),/PACKAGE_D_CARTON_DAMAGE_INSPECT_ONE/u);
  assert.deepEqual(await snapshot(),committed);
  const capped=await json(claims+cartonDamageQuery(created.orderId,item,'package-d-new-capped-carton',5));
  assert.equal(capped.merchandiseEntitlementInMinorUnits,0);
  assert.equal(await sql(`SELECT raw_customer_damage_deduction_in_minor_units||','||
    applied_customer_damage_deduction_in_minor_units FROM sales_return_items WHERE operation_id='${capped.operationId}';`),'6000,4500');
  assert.equal(await sql(`SELECT count(*) FROM phase42_return_inventory_effects WHERE operation_id='${capped.operationId}';`),'0');
  const last=await json(claims+cartonDamageQuery(created.orderId,item,'package-d-new-final-carton',0,5));
  assert.equal(last.merchandiseEntitlementInMinorUnits,4500);
  assert.deepEqual(await json(`SELECT to_jsonb(t) FROM order_items t WHERE id='${item}';`),original);
  let oldEvidence='covered-in-before-mode';
  if(oldDamageOrderId) {
    const oldItem=await sql(`SELECT id FROM order_items WHERE order_id='${oldDamageOrderId}';`);
    assert.equal(await sql(`SELECT effective_standalone_unit_sale_price_snapshot_in_minor_units IS NULL FROM order_items WHERE id='${oldItem}';`),'t');
    const oldSnapshot=await snapshot();
    await assert.rejects(sql(`UPDATE order_items SET effective_standalone_unit_sale_price_snapshot_in_minor_units=900
      WHERE id='${oldItem}';`),/PACKAGE_D_CARTON_PRICE_IMMUTABLE/u);
    assert.deepEqual(await snapshot(),oldSnapshot);
    await assert.rejects(sql(claims+cartonDamageQuery(oldDamageOrderId,oldItem,'package-d-old-damage-rejected',1)),
      /PACKAGE_D_CARTON_DAMAGE_PRICE_MISSING/u);
    assert.deepEqual(await snapshot(),oldSnapshot);
    for(const [key,sellable] of [['sound',5],['defect',0]]) {
      const result=await json(claims+cartonDamageQuery(oldDamageOrderId,oldItem,`package-d-old-${key}-valid`,0,sellable));
      assert.equal(result.success,true);assert.equal(result.merchandiseEntitlementInMinorUnits,4500);
    }
    oldEvidence='NULL preserved; damage rejected zero-write; sound and defect succeed';
  }
  return {snapshot:1200,mixed:{raw:2400,net:2100,stock:2,cost:200},clamped:{raw:6000,applied:4500,net:0},
    currentPriceIgnored:9000,originalCogsUnchanged:true,replayZeroWrite:true,oldEvidence};
}

export async function proveBeforeCorrection({sql,json}) {
  const card=await json(claims+sale('package-d-correction-historical-card','base_unit',1,'card'));
  assert.equal(card.success,true); assert.equal(card.paymentMethod,'card');
  const carton=await json(claims+sale('package-d-correction-before-carton','legacy_single_sku_parcel'));
  assert.equal(carton.success,true);
  const oldDamageSale=await json(claims+sale('package-d-before-damage-cartons','legacy_single_sku_parcel',3));
  const item=await sql(`SELECT id FROM order_items WHERE order_id='${carton.orderId}';`);
  const before=await json(fingerprintQuery(tables));
  await assert.rejects(sql(claims+`SELECT settle_sales_replacement_v1('${carton.orderId}','package-d-before-carton-replace',
    '${JSON.stringify([{sourceKind:'base_order_item',sourceId:item,quantity:5}])}'::jsonb,'D before proof',NULL);`),
  /PHASE43_REPLACEMENT_SOURCE_INVALID|PHASE4_SOURCE|PHASE43_BASE/u);
  assert.deepEqual(await json(fingerprintQuery(tables)),before);
  assert.equal(await sql(`SELECT has_function_privilege('service_role',p.oid,'EXECUTE')
    FROM pg_proc p WHERE p.proname='create_customer_order_base_units_legacy' AND p.pronamespace='public'::regnamespace;`),'f');
  const leafCapacity=await proveLeafCapacity({sql,json,mode:'before'});
  const returnRace=await proveConcurrentReturns({sql,json,mode:'before'});
  const oldDamageItem=await sql(`SELECT id FROM order_items WHERE order_id='${oldDamageSale.orderId}';`);
  await assert.rejects(sql(claims+cartonDamageQuery(oldDamageSale.orderId,oldDamageItem,'package-d-before-damage',1)),
    /PHASE42_BASE_RETURN_ITEM_INVALID/u);
  return {cardAccepted:true,cardResult:card,oldDamageOrderId:oldDamageSale.orderId,
    singleSkuModernReplacementUnsupported:true,legacyServiceAuthority:'ALREADY_DENIED_IN_131',leafCapacity,returnRace};
}

async function proveLeafCapacity({sql,json,mode}) {
  const created=await json(claims+sale(`package-d-${mode}-per-leaf-sale`,'base_unit',2));
  const item=await sql(`SELECT id FROM order_items WHERE order_id='${created.orderId}';`);
  const issued=await json(claims+`SELECT settle_sales_replacement_v1('${created.orderId}','package-d-${mode}-leaf-replacement',
    '${JSON.stringify([{sourceKind:'base_order_item',sourceId:item,quantity:1}])}'::jsonb,'Leaf capacity fixture',NULL);`);
  assert.equal(issued.success,true);
  const allocation=JSON.stringify([{root_source_kind:'base_order_item',root_source_id:item,source_kind:'base_order_item',
    source_id:item,product_id:sku,quantity:2,sellable_restock_quantity:0,defect_non_sellable_quantity:2,customer_damage_quantity:0}]);
  const query=`SELECT settle_admin_sales_return_v1('${created.orderId}','package-d-${mode}-one-leaf-overrun',
    '${JSON.stringify([{return_scope:'base_unit',order_item_id:item,quantity:2,stock_disposition:'damaged'}])}'::jsonb,
    '${allocation}'::jsonb,'Correct total but stale original leaf','cash',NULL,NULL);`;
  const previous=await json(fingerprintQuery(tables));
  let observed;
  try {
    observed=await json(claims+query);assert.equal(observed.success,true);
    assert.equal(mode,'before','Current132 must reject a per-leaf overrun despite correct aggregate quantity');
  } catch(error) {
    // A pre-existing earlier guard is valid evidence too; never manufacture a
    // false before failure if131 already rejects through another boundary.
    assert.match(String(error),/PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED|PHASE43_RETURN_PHYSICAL_SOURCE_INVALID|PHASE43_RETURN_ALLOCATION_MISMATCH/u);
    assert.deepEqual(await json(fingerprintQuery(tables)),previous);
    return {logicalRemaining:2,originalPhysicalRemaining:1,requestedOriginalPhysical:2,accepted:false,zeroWrites:true};
  }
  return {logicalRemaining:2,originalPhysicalRemaining:1,requestedOriginalPhysical:2,accepted:true,operationId:observed.operationId};
}

export async function proveAfterCorrection({sql,json,beforeMode,cardResult,oldDamageOrderId}) {
  const snapshot=()=>json(fingerprintQuery([...tables,'pos_uncommitted_attempt_cancellations']));
  const reject=async(query,code)=>{const previous=await snapshot();
    await assert.rejects(sql(claims+query),new RegExp(code,'u')); assert.deepEqual(await snapshot(),previous);};
  await reject(sale('package-d-new-card-rejected','base_unit',1,'card'),'PHASE3_POS_PAYMENT_METHOD_INVALID');
  if(beforeMode) {
    const previous=await snapshot();
    const replay=await json(claims+sale('package-d-correction-historical-card','base_unit',1,'card'));
    assert.deepEqual(replay,cardResult);assert.equal(replay.paymentMethod,'card');
    assert.deepEqual(await snapshot(),previous);
  }
  const key='package-d-No-Commit-MixedCase'; const fp='a'.repeat(64);
  const read=`SELECT get_pos_sale_attempt_state_v1('${key}','${fp}');`;
  const cancel=`SELECT cancel_uncommitted_pos_sale_attempt_v1('${key}','${fp}',true);`;
  const previous=await snapshot(); const absent=await json(claims+read);
  assert.deepEqual(absent,{state:'ABSENT',actorId:actor,idempotencyKey:key,requestFingerprint:fp,cancellationId:null});
  assert.deepEqual(await snapshot(),previous);
  await reject(`SELECT cancel_uncommitted_pos_sale_attempt_v1('${key}','${fp}',false);`,'PACKAGE_D_POS_CANCEL_CONFIRMATION_REQUIRED');
  const cancelled=await json(claims+cancel);assert.equal(cancelled.state,'CANCELLED_UNCOMMITTED');
  assert.equal(cancelled.idempotencyKey,key);assert.equal(cancelled.actorId,actor);assert.equal(cancelled.requestFingerprint,fp);
  const cancelledState=await snapshot();assert.deepEqual(await json(claims+cancel),cancelled);
  assert.deepEqual(await snapshot(),cancelledState);
  await reject(sale(key),'PACKAGE_D_POS_ATTEMPT_CANCELLED');
  await reject(`SELECT get_pos_sale_attempt_state_v1('${key}','${'b'.repeat(64)}');`,'PHASE3_IDEMPOTENCY_CONFLICT');
  const committed=await json(claims+sale('package-d-correction-committed'));
  const committedState=await snapshot();
  const exists=await json(claims+`SELECT get_pos_sale_attempt_state_v1('package-d-correction-committed','${fp}');`);
  assert.equal(exists.state,'EXISTS');assert.deepEqual(await snapshot(),committedState);
  await reject(`SELECT cancel_uncommitted_pos_sale_attempt_v1('package-d-correction-committed','${fp}',true);`,'PACKAGE_D_POS_ATTEMPT_COMMITTED');
  assert.equal(committed.success,true);
  // All quantities/costs below are independently fixed fixture values. Current
  // product price/package size and WAC are deliberately changed after freeze.
  await sql(`UPDATE products SET wac_cost_in_minor_units_exact=100, cost_price_in_minor_units=100,
    wholesale_price_in_minor_units=4500,units_per_sale_unit=5 WHERE id='${sku}';`);
  const carton=await json(claims+sale('package-d-correction-cartons','legacy_single_sku_parcel',3));
  const item=await sql(`SELECT id FROM order_items WHERE order_id='${carton.orderId}';`);
  assert.equal(carton.items[0].baseQuantity,15); assert.equal(carton.items[0].cogsInMinorUnits,1500);
  const original=await json(`SELECT to_jsonb(t) FROM order_items t WHERE id='${item}';`);
  assert.equal(original.sale_package_quantity,3);assert.equal(original.units_per_sale_package,5);
  const context=await json(claims+`SELECT get_admin_sales_aftercare_context_v1('${carton.orderId}');`);
  assert.equal(context.baseItems[0].commercialLineKind,'legacy_single_sku_parcel');
  assert.equal(context.baseItems[0].unitsPerParcel,5);
  const replace=(sourceKind,sourceId,quantity,key)=>`SELECT settle_sales_replacement_v1('${carton.orderId}',${literal(key)},
    '${JSON.stringify([{sourceKind,sourceId,quantity}])}'::jsonb,'D cartons',NULL);`;
  await reject(replace('base_order_item',item,1,'package-d-partial-carton-replace'),'PACKAGE_D_WHOLE_SINGLE_SKU_PARCEL_REQUIRED');
  await sql(`UPDATE products SET wac_cost_in_minor_units_exact=300,cost_price_in_minor_units=300 WHERE id='${sku}';`);
  const replacementQuery=replace('base_order_item',item,5,'package-d-carton-replacement');
  const replacement=await json(claims+replacementQuery);assert.equal(replacement.success,true);
  const leaf=await sql(`SELECT id FROM sales_replacement_items WHERE operation_id='${replacement.operationId}';`);
  const replacementCost=await json(`SELECT jsonb_build_object('quantity',quantity,'unitCost',replacement_unit_cost_snapshot_in_minor_units_exact,
    'cost',replacement_cogs_snapshot_in_minor_units) FROM sales_replacement_items WHERE id='${leaf}';`);
  assert.deepEqual(replacementCost,{quantity:5,unitCost:300,cost:1500});
  const afterReplacement=await snapshot();const replay=await json(claims+replacementQuery);
  assert.equal(replay.operationId,replacement.operationId);assert.deepEqual(await snapshot(),afterReplacement);
  await sql(`UPDATE products SET wac_cost_in_minor_units_exact=900,cost_price_in_minor_units=900,
    sale_price_in_minor_units=9000,wholesale_price_in_minor_units=45000,units_per_sale_unit=9 WHERE id='${sku}';`);
  const returnQuery=(sourceKind,sourceId,quantity,key,disposition='restock')=>`SELECT settle_admin_sales_return_v1('${carton.orderId}',${literal(key)},
    '${JSON.stringify([{return_scope:'base_unit',order_item_id:item,quantity,stock_disposition:disposition}])}'::jsonb,
    '${JSON.stringify([{root_source_kind:'base_order_item',root_source_id:item,source_kind:sourceKind,source_id:sourceId,
      product_id:sku,quantity,sellable_restock_quantity:disposition==='restock'?quantity:0,
      defect_non_sellable_quantity:disposition==='damaged'?quantity:0,customer_damage_quantity:0}])}'::jsonb,
    'D frozen valuation','cash',NULL,NULL);`;
  await reject(returnQuery('replacement_item',leaf,1,'package-d-partial-carton-return'),'PACKAGE_D_WHOLE_SINGLE_SKU_PARCEL_REQUIRED');
  const returned=await json(claims+returnQuery('replacement_item',leaf,5,'package-d-carton-return'));
  assert.equal(returned.success,true);
  const effect=await json(`SELECT jsonb_build_object('quantity',sellable_quantity,'cost',historical_restock_value_in_minor_units_exact)
    FROM phase42_return_inventory_effects WHERE operation_id='${returned.operationId}';`);
  assert.deepEqual(effect,{quantity:5,cost:1500});
  const financial=await json(`SELECT jsonb_build_object('refund',money_refund_amount_in_minor_units,'entitlement',merchandise_refund_amount_in_minor_units,
    'debt',debt_reduction_amount_in_minor_units) FROM sales_return_events WHERE operation_id='${returned.operationId}';`);
  assert.deepEqual(financial,{refund:4500,entitlement:4500,debt:0});
  assert.deepEqual(await json(`SELECT to_jsonb(t) FROM order_items t WHERE id='${item}';`),original);
  const afterReturn=await snapshot();const returnReplay=await json(claims+returnQuery('replacement_item',leaf,5,'package-d-carton-return'));
  assert.equal(returnReplay.operationId,returned.operationId);assert.deepEqual(await snapshot(),afterReturn);
  const nonSellable=await json(claims+returnQuery('base_order_item',item,5,'package-d-carton-non-sellable','damaged'));
  assert.equal(nonSellable.success,true);
  assert.equal(await sql(`SELECT count(*) FROM phase42_return_inventory_effects WHERE operation_id='${nonSellable.operationId}';`),'0');
  assert.equal(await sql(`SELECT count(*) FROM inventory_movements WHERE operation_id='${nonSellable.operationId}';`),'0');
  assert.equal(await sql(`SELECT has_function_privilege('service_role',p.oid,'EXECUTE')
    FROM pg_proc p WHERE p.proname='create_customer_order_base_units_legacy' AND p.pronamespace='public'::regnamespace;`),'f');
  await assert.rejects(sql(claims+'INSERT INTO pos_uncommitted_attempt_cancellations(actor_id,idempotency_key,request_fingerprint)'
    +` VALUES('${actor}','public-cannot-inject','${fp}');`),/permission denied|row-level security/u);
  const leafCapacity=await proveLeafCapacity({sql,json,mode:'after'});
  const returnRace=await proveConcurrentReturns({sql,json,mode:'after'});
  const debtFirstCarton=await proveDebtFirstCarton({sql,json});
  const flavorPolicy=await proveFlavorPolicy({sql,json});
  const cartonDamage=await proveCartonDamage({sql,json,oldDamageOrderId});
  return {newCardRejected:true,historicalCardReplay:beforeMode?'PASS':'covered-in-before-mode',leafCapacity,returnRace,flavorPolicy,debtFirstCarton,
    serverAbsenceZeroWrite:true,cancellationImmutable:true,lateSaleRejected:true,committedRecoveryOnly:true,
    cartonDamage,singleSkuCartons:{baseQuantity:15,originalCogs:1500,replacementCost:1500,returnCost:1500,refund:4500},
    partialCartonRejected:true,nonSellableZeroRestock:true,currentPriceWacSizeIgnored:true,replayZeroWrite:true,legacyServiceRevoked:true};
}

async function proveDebtFirstCarton({sql,json}) {
  const customer='92513200-0000-4000-8000-000000000001';
  await sql(`INSERT INTO customers(id,full_name,phone,credit_limit_in_minor_units)
    VALUES('${customer}','D whole-carton debt fixture','0791320001',1000000);`);
  const created=await json(claims+`SELECT create_pos_sale_v2('${warehouse}','${branch}','${customer}','D carton debt','debt',
    '${JSON.stringify([{commercial_line_kind:'legacy_single_sku_parcel',product_id:sku,parcel_quantity:3,units_per_parcel:5}])}'::jsonb,
    105,0,'package-d-debt-carton-sale');`);
  assert.equal(created.totalInMinorUnits,13395);assert.equal(created.amountPaidInMinorUnits,0);
  await json(claims+`SELECT record_customer_order_payment_once('${created.orderId}',1000,'cash',NULL,'D actual partial collection','package-d-carton-collection-once');`);
  const item=await sql(`SELECT id FROM order_items WHERE order_id='${created.orderId}';`);
  const query=(quantity,key,method)=>`SELECT settle_admin_sales_return_v1('${created.orderId}','${key}',
    '${JSON.stringify([{return_scope:'base_unit',order_item_id:item,quantity,stock_disposition:'damaged'}])}'::jsonb,
    '${JSON.stringify([{root_source_kind:'base_order_item',root_source_id:item,source_kind:'base_order_item',source_id:item,
      product_id:sku,quantity,sellable_restock_quantity:0,defect_non_sellable_quantity:quantity,customer_damage_quantity:0}])}'::jsonb,
    'D debt-first whole cartons',${method},NULL,NULL);`;
  const first=await json(claims+query(5,'package-d-debt-first-carton','NULL'));
  assert.equal(first.debtReductionInMinorUnits,4465);assert.equal(first.moneyRefundInMinorUnits,0);
  const final=await json(claims+query(10,'package-d-debt-final-cartons',"'cash'"));
  assert.equal(final.debtReductionInMinorUnits,7930);assert.equal(final.moneyRefundInMinorUnits,1000);
  const previous=await json(fingerprintQuery(tables));
  assert.deepEqual(await json(claims+query(10,'package-d-debt-final-cartons',"'cash'")),final);
  assert.deepEqual(await json(fingerprintQuery(tables)),previous);
  return {originalEntitlement:13395,firstCartonDebtReduction:4465,finalDebtReduction:7930,finalCashRefund:1000,replayZeroWrite:true};
}

async function proveConcurrentReturns({sql,json,mode}) {
  // This race has its own deliberate catalog values; it must not inherit the
  // earlier price-mutation probe's9000 price when its oracle is900.
  await sql(`UPDATE products SET sale_price_in_minor_units=900,wholesale_price_in_minor_units=4500,
    units_per_sale_unit=5,wac_cost_in_minor_units_exact=20,cost_price_in_minor_units=20 WHERE id='${sku}';`);
  const deadlocks=()=>json("SELECT to_jsonb(deadlocks) FROM pg_stat_database WHERE datname=current_database();");
  const before=await deadlocks(); const directions=[];
  for(const direction of ['A-before-B','B-before-A']) {
    const sold=await json(claims+sale(`package-d-${mode}-race-sale-${direction}`,'base_unit',1));
    const item=await sql(`SELECT id FROM order_items WHERE order_id='${sold.orderId}';`);
    const winner=`package-d-${mode}-${direction}-winner`;const loser=`package-d-${mode}-${direction}-loser`;
    const query=key=>`SELECT settle_admin_sales_return_v1('${sold.orderId}','${key}',
      '${JSON.stringify([{return_scope:'base_unit',order_item_id:item,quantity:1,stock_disposition:'damaged'}])}'::jsonb,
      '${JSON.stringify([{root_source_kind:'base_order_item',root_source_id:item,source_kind:'base_order_item',source_id:item,
        product_id:sku,quantity:1,sellable_restock_quantity:0,defect_non_sellable_quantity:1,customer_damage_quantity:0}])}'::jsonb,
      'Synchronized per-leaf Return race','cash',NULL,NULL);`;
    const name=`d-${mode}-${direction}`;
    const first=sql(`SET application_name='${name}'; BEGIN; ${claims}
      SELECT pg_advisory_xact_lock(hashtextextended('phase4-order|${sold.orderId}',0));
      SELECT pg_sleep(2); ${query(winner)} COMMIT;`);
    // Both calls have live, independent PostgreSQL connections. Observe the
    // first holder before admitting the competing public RPC, not sequential simulation.
    let holder=false;
    for(let attempt=0;attempt<100;attempt++) {
      holder=await json(`SELECT to_jsonb(EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}'
        AND wait_event='PgSleep'));`);
      if(holder) break;await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(holder,true,'Race holder was not observed');
    const second=sql(claims+query(loser));
    const settled=await Promise.allSettled([first,second]);
    assert.equal(settled[0].status,'fulfilled');assert.equal(settled[1].status,'rejected');
    assert.match(String(settled[1].reason),/PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED/u);
    const evidence=await json(`SELECT jsonb_build_object(
      'winners',(SELECT count(*) FROM business_operations WHERE idempotency_key='${winner}'),
      'losers',(SELECT count(*) FROM business_operations WHERE idempotency_key='${loser}'),
      'returns',(SELECT count(*) FROM sales_return_events WHERE order_id='${sold.orderId}'),
      'consumptions',(SELECT count(*) FROM sales_aftercare_consumptions WHERE source_id='${item}'),
      'quantity',(SELECT sum(consumed_quantity) FROM sales_aftercare_consumptions WHERE source_id='${item}'),
      'refund',(SELECT sum(money_refund_amount_in_minor_units) FROM sales_return_events WHERE order_id='${sold.orderId}'));
    `);
    assert.deepEqual(evidence,{winners:1,losers:0,returns:1,consumptions:1,quantity:1,refund:900});
    const fingerprint=await json(fingerprintQuery(tables));
    await assert.rejects(sql(claims+query(loser)),/PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED/u);
    assert.deepEqual(await json(fingerprintQuery(tables)),fingerprint);
    const clean=await json(claims+query(winner));assert.equal(clean.success,true);
    assert.deepEqual(await json(fingerprintQuery(tables)),fingerprint);
    directions.push({direction,perIdentityEvidence:evidence,loserRetryZeroWrite:true,winnerReplayZeroWrite:true});
  }
  const delta=(await deadlocks())-before;assert.equal(delta,0);
  return {directions,deadlockDelta:delta,realConcurrentSessions:true};
}

async function proveFlavorPolicy({sql,json}) {
  const family='92400000-0000-0000-0000-000000000100';
  const a='92400000-0000-0000-0000-000000000101';const b='92400000-0000-0000-0000-000000000102';
  const settings=await json(claims+`SELECT save_product_parcel_configuration_v1('${family}','configurable_mix',true,5,
    ARRAY['${a}','${b}']::uuid[]);`);
  await sql(`UPDATE products SET is_active=false WHERE id='${b}';`);
  const context=await json(claims+'SELECT get_admin_parcel_configuration_context_v1();');
  assert.deepEqual(context.products.find(p=>p.familyProductId===family).allowedProductIds,[a]);
  // Persist the active-only list returned to the real owner screen. An inactive
  // former member must not cause an impossible save or silently widen the list.
  const saved=await json(claims+`SELECT save_product_parcel_configuration_v1('${family}','configurable_mix',true,5,ARRAY['${a}']::uuid[]);`);
  assert.deepEqual(saved.allowedProductIds,[a]);
  await sql(`UPDATE products SET is_active=true WHERE id='${b}';`);
  await sql(claims+"SELECT set_configurable_parcel_feature_state_v1('ENABLED');");
  const forbidden=[{commercial_line_kind:'configurable_parcel',family_product_id:family,
    parcel_configuration_id:settings.configuration.id,configuration_revision:saved.configuration.configuration_revision,
    expected_unit_price_in_minor_units:5000,
    parcel_instances:[{components:[{product_id:b,base_quantity:5}]}]}];
  const snapshot=await json(fingerprintQuery([...tables,'promotion_codes']));
  await assert.rejects(sql(`SET ROLE anon; SELECT preview_guest_promotion_v2(${literal(JSON.stringify(forbidden))}::jsonb,NULL,NULL);`),
    /PARCEL_COMPONENT_NOT_ALLOWED/u);
  assert.deepEqual(await json(fingerprintQuery([...tables,'promotion_codes'])),snapshot);
  await json(claims+`SELECT save_product_parcel_configuration_v1('${family}','configurable_mix',true,5,ARRAY['${a}','${b}']::uuid[]);`);
  await sql(`UPDATE products SET flavor_name_ar=CASE id WHEN '${a}' THEN 'ز' ELSE 'أ' END,
    name_ar=CASE id WHEN '${a}' THEN 'ز نكهة' ELSE 'أ نكهة' END WHERE id IN ('${a}','${b}');`);
  const options=await json(`SET ROLE anon; SELECT get_public_configurable_parcel_options(ARRAY['${family}']::uuid[]);`);
  const components=options.options.find(p=>p.familyProductId===family).components;
  assert.deepEqual(components.map(p=>p.productId),[b,a],'Arabic name order must override adversarial product IDs');
  await sql(claims+"SELECT set_configurable_parcel_feature_state_v1('OFF');");
  return {inactiveMemberRemovable:true,previewAllowlistRejected:true,previewZeroWrite:true,nameOrderNotUuidOrder:true};
}
