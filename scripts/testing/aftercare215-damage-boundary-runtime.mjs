import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {returnPayload215} from './aftercare215-return-cases.mjs';

export async function verifyDamageBoundaries215(c,pass) {
 const {q,j,rpc,sql,json,key,setup}=c;
 const from=await json("SELECT to_jsonb((clock_timestamp()-INTERVAL '2 days')::TEXT);"),to=await json("SELECT to_jsonb((clock_timestamp()+INTERVAL '2 days')::TEXT);");
 const read=(search,start=from,end=to)=>rpc(`get_damage_ledger_page_v2(${q(start)},${q(end)},'all','all',${q(search)},NULL,1,100)`,undefined,undefined,undefined,true);
 const s=await setup(),payload=returnPayload215(s),p=await rpc(`preview_admin_sales_return_v2(${j(payload)})`);
 const returned=await rpc(`settle_admin_sales_return_v2(${j(payload)},${q(key())},${q(p.previewFingerprint)})`);
 const damage=await json(`SELECT to_jsonb(id) FROM inventory_damage_events WHERE return_event_id=${q(returned.returnId)};`);
 const cut=await json('SELECT to_jsonb(clock_timestamp()::TEXT);');
 const hold=await rpc(`preview_aftercare_supplier_v1('return',${q(damage)},${q(c.supplier)})`);
 await rpc(`execute_aftercare_supplier_v1('reclassify_return',${q(key())},${j({sourceId:damage,supplierId:c.supplier,reason:'تحويل العيب في فترة لاحقة',previewFingerprint:hold.previewFingerprint})})`);
 const earlier=await read('INSPECT215-'+s.pid,from,cut),later=await read('INSPECT215-'+s.pid,cut,to);
 assert.equal(earlier.periodLossInMinorUnits,'500');assert.equal(later.periodLossInMinorUnits,'-500');
 assert.equal(earlier.rows[0].pendingQuantity,1);assert.equal(later.rows[0].pendingQuantity,1);
 assert.equal(earlier.rows[0].id,later.rows[0].id);assert.equal(later.rows[0].movements[0].action,'supplier_send');
 pass('later-period supplier hold records recovery-500 in that period while original period remains loss500; both show current pending1 with no history rewrite');

 const allGood=await setup({kind:'base',soldQuantity:5,cost:1000});await c.receive(allGood.pid,100,2000);
 const inspection={...allGood.payload,items:[{...allGood.payload.items[0],quantity:1,goodQuantity:1}]},ip=await rpc(`preview_inspected_sales_replacement_v2(${j(inspection)})`);
 await rpc(`settle_inspected_sales_replacement_v2(${j(inspection)},${q(key())},${q(ip.previewFingerprint)})`);
 const only=await read('INSPECT215-'+allGood.pid),r=only.rows[0];
 assert.equal(r.quantity,0);assert.equal(r.financialOnly,true);assert.equal(r.states.length,0);assert.equal(r.costDifferenceInMinorUnits,'500');assert.equal(r.periodLossInMinorUnits,'500');
 pass('all-good warranty after WAC change is a separate500 cost difference, quantity0/states empty; no damaged packet invented');

 // LAST: exact money deliberately beyond Number.MAX_SAFE_INTEGER. All RPC
 // amounts and assertions remain PostgreSQL BIGINT or decimal text.
 const product=randomUUID(),supplier=randomUUID(),sku='G5-BIG-'+product;
 await sql(`INSERT INTO suppliers(id,company_name,is_active)VALUES(${q(supplier)},'مورد مبلغ اصطناعي كبير',true);
 INSERT INTO products(id,sku,name_ar,category_id,unit_id,purchase_unit_id,sale_unit_id,units_per_purchase_unit,units_per_sale_unit,sale_price_in_minor_units,default_sale_price_in_minor_units,cost_price_in_minor_units,wac_cost_in_minor_units_exact,is_active,is_flavor_master)
 SELECT ${q(product)},${q(sku)},'صنف اختبار الدقة فقط',category_id,unit_id,purchase_unit_id,sale_unit_id,1,1,1000,1000,0,0,true,false FROM products WHERE id=${q(c.id(103))};`);
 await c.json(c.auth(`SELECT public.create_direct_supplier_receipt_v2(p_supplier_id:=${q(supplier)},p_branch_id:=${q(c.branch)},p_warehouse_id:=${q(c.warehouse)},p_idempotency_key:=${q(key())},p_payment_method:='deferred',p_lines:=jsonb_build_array(jsonb_build_object('client_line_id',${q(randomUUID())},'line_kind','base_unit','commercial_quantity',2,'base_unit_name','باكيت','gross_amount_in_minor_units',18014398509481986::BIGINT,'line_discount_in_minor_units',0,'components',jsonb_build_array(jsonb_build_object('product_id',${q(product)},'base_quantity',2)))));`));
 await rpc(`execute_supplier_replacement_v1('shop_damage',${j({productId:product,warehouseId:c.warehouse,quantity:1,unit:'base',reasonCode:'other',reason:'اختبار دقة أكبر من الحد الآمن'})},${q(key())})`);
 const big=await read(sku);assert.equal(big.totalCount,1);assert.equal(big.periodLossInMinorUnits,'9007199254740993');assert.equal(big.rows[0].periodLossInMinorUnits,'9007199254740993');assert.equal(big.rows[0].unitCostInMinorUnitsExact,'9007199254740993.000000');
 const sale=await rpc(`create_pos_sale_v2(${q(c.warehouse)},${q(c.branch)},${q(c.id(401))},'تجربة لقطة كبيرة','cash',${j([{commercial_line_kind:'base_unit',product_id:product,base_quantity:1,price_authority:'server_catalog',line_discount_in_minor_units:0}])},0,1000,${q(key())})`);
 await c.json(c.auth(`SELECT public.create_direct_supplier_receipt_v2(p_supplier_id:=${q(supplier)},p_branch_id:=${q(c.branch)},p_warehouse_id:=${q(c.warehouse)},p_idempotency_key:=${q(key())},p_payment_method:='deferred',p_lines:=jsonb_build_array(jsonb_build_object('client_line_id',${q(randomUUID())},'line_kind','base_unit','commercial_quantity',1,'base_unit_name','باكيت','gross_amount_in_minor_units',9007199254740993::BIGINT,'line_discount_in_minor_units',0,'components',jsonb_build_array(jsonb_build_object('product_id',${q(product)},'base_quantity',1)))));`));
 const item=await json(`SELECT to_jsonb(id) FROM order_items WHERE order_id=${q(sale.orderId)};`);
 const inspected=await rpc(`preview_inspected_sales_replacement_v2(${j({orderId:sale.orderId,items:[{sourceKind:'base_order_item',sourceId:item,quantity:1,goodQuantity:0,supplierId:null}],reason:'معاينة تكلفة كبيرة دقيقة',notes:null})})`,undefined,undefined,undefined,true);
 assert.equal(inspected.issuedCostInMinorUnits,'9007199254740993');assert.equal(inspected.profitDeltaInMinorUnits,'-9007199254740993');
 pass('exact9007199254740993 loss/unit cost and warranty preview survive official receipt/sale/damage as decimal text; no Number conversion of asserted amounts');
}
