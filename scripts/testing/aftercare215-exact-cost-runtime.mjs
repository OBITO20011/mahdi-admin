import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {returnPayload215} from './aftercare215-return-cases.mjs';

export async function verifyExactCost215(c,pass){
 const {q,j,sql,json,rpc,key}=c;
 for(const [cost,gross]of [['1000.600000','10006000'],['1000.400000','10004000']])for(const kind of ['base_unit','legacy_single_sku_parcel']){
  const pid=randomUUID();
  await sql(`INSERT INTO products(id,sku,name_ar,category_id,unit_id,purchase_unit_id,sale_unit_id,units_per_purchase_unit,units_per_sale_unit,sale_price_in_minor_units,default_sale_price_in_minor_units,cost_price_in_minor_units,wac_cost_in_minor_units_exact,is_active,is_flavor_master)
   SELECT ${q(pid)},${q('EXACT215-'+pid)},'اختبار عشرة آلاف باكيت',category_id,unit_id,purchase_unit_id,sale_unit_id,1,10000,1000,10000000,0,0,true,false FROM products WHERE id=${q(c.id(103))};`);
  await rpc(`create_direct_supplier_receipt_v2(p_supplier_id:=${q(c.supplier)},p_branch_id:=${q(c.branch)},p_warehouse_id:=${q(c.warehouse)},p_idempotency_key:=${q(key())},p_payment_method:='deferred',p_lines:=jsonb_build_array(jsonb_build_object('client_line_id',${q(randomUUID())},'line_kind','base_unit','commercial_quantity',10000,'base_unit_name','باكيت','gross_amount_in_minor_units',${gross}::BIGINT,'line_discount_in_minor_units',0,'components',jsonb_build_array(jsonb_build_object('product_id',${q(pid)},'base_quantity',10000)))))`);
  assert.deepEqual(await c.stock(pid),{quantity:10000,wac:cost,reserved:0});
  const line={commercial_line_kind:kind,product_id:pid,price_authority:'server_catalog',line_discount_in_minor_units:0,...(kind==='base_unit'?{base_quantity:10000}:{parcel_quantity:1,units_per_parcel:10000})};
  const before=await c.facts(),sale=await rpc(`create_pos_sale_v2(${q(c.warehouse)},${q(c.branch)},${q(c.id(401))},'اختبار دقة التكلفة','cash',${j([line])},0,10000000,${q(key())})`);
  const item=await json(`SELECT jsonb_build_object('id',id,'cost',unit_cost_snapshot_in_minor_units_exact::TEXT,'cogs',exact_cogs_snapshot_in_minor_units::TEXT) FROM order_items WHERE order_id=${q(sale.orderId)};`);
  assert.equal(item.cost,cost);assert.equal(item.cogs,gross+'.000000');assert.equal((await c.facts()).sales.cogsInMinorUnits-before.sales.cogsInMinorUnits,Number(gross));
  assert.equal((await c.stock(pid)).quantity,0);
  const payload=returnPayload215({pid,sale,item:item.id},{quantity:10000,good:10000}),preview=await rpc(`preview_admin_sales_return_v2(${j(payload)})`);
  assert.equal(preview.goodRestockValueExact,gross+'.000000');assert.equal(preview.entitlementInMinorUnits,'10000000');
  const call=`settle_admin_sales_return_v2(${j(payload)},${q(key())},${q(preview.previewFingerprint)})`;
  await rpc(call);assert.deepEqual(await c.stock(pid),{quantity:10000,wac:cost,reserved:0});
  assert.equal(await sql(`SELECT(on_hand_quantity::NUMERIC*wac_cost_in_minor_units_exact)::NUMERIC(30,6)::TEXT FROM inventory_balances b JOIN products p ON p.id=b.product_id WHERE p.id=${q(pid)} AND warehouse_id=${q(c.warehouse)};`),gross+'.000000');
  const after=await c.facts();
  // The established report keeps gross COGS and exact restock recovery as
  // separate signed facts; their net effect must return to the prior value.
  assert.equal(after.sales.cogsInMinorUnits-before.sales.cogsInMinorUnits,Number(gross));
  assert.equal(after.sales.restockRecoveryInMinorUnits-before.sales.restockRecoveryInMinorUnits,Number(gross));
  assert.equal(after.sales.netProfitInMinorUnits,before.sales.netProfitInMinorUnits);
  const stable=await c.fingerprint();await rpc(call);assert.deepEqual(await c.fingerprint(),stable);
  pass(`${kind}:10000 packets at exactWAC${cost}:COGS${gross},full215 return restores exact${gross},zero residual COGS and zero-write replay`);
 }
}
