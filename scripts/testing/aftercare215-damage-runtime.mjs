import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function verifyDamageLedger215(c,pass) {
 const {q,j,rpc,sql,json,key,setup,stock,fingerprint,fail}=c;
 const from=await json("SELECT to_jsonb((clock_timestamp()-INTERVAL '2 days')::TEXT);"),to=await json("SELECT to_jsonb((clock_timestamp()+INTERVAL '2 days')::TEXT);");
 const call=(state='all',search='',page=1,size=100)=>`get_damage_ledger_page_v2(${q(from)},${q(to)},${q(state)},'all',${q(search)},NULL,${page},${size})`;
 const read=(state='all',search='',page=1,size=100,uid)=>rpc(call(state,search,page,size),uid,undefined,undefined,true);
 const total=await read(),fp=await fingerprint();await read();assert.deepEqual(await fingerprint(),fp);
 assert.equal(total.periodLossInMinorUnits,await sql(`SELECT COALESCE(sum(loss_delta),0) FROM tb215_damage_movements_internal() WHERE occurred_at>=${q(from)} AND occurred_at<${q(to)};`));
 const f=await json(`SELECT public.phase6_financial_facts_internal(NULL,${q(from)},${q(to)},'Asia/Amman',true);`);
 assert.equal(BigInt(total.periodLossInMinorUnits),BigInt(f.sales.damageLosses.totalInMinorUnits));
 const profit=await json(`SELECT jsonb_build_object('before',(public.tb215_financial_facts_before215_internal(NULL,${q(from)},${q(to)},'Asia/Amman',false)->'sales'->>'netProfitInMinorUnits')::NUMERIC,'goodRecovery',(SELECT COALESCE(sum(good_recovery_in_minor_units),0) FROM aftercare215_inspections WHERE created_at>=${q(from)} AND created_at<${q(to)}));`);
 assert.equal(f.sales.netProfitInMinorUnits,profit.before+profit.goodRecovery);
 pass('READONLY ledger period sum equals signed canonical damage facts, including warranty net cost; informational total never subtracts it from profit again');

 const partial=await setup(),pending=await rpc(`execute_supplier_replacement_v1('shop_pending',${j({supplierId:c.supplier,productId:partial.pid,warehouseId:c.warehouse,quantity:3,unit:'base',reason:'ثلاث باكيتات معلقة'})},${q(key())})`);
 const caseId=pending.cases[0].id;
 for(const action of ['receive','writeoff']) await rpc(`execute_supplier_replacement_v1(${q(action)},${j({caseId,quantity:1,reason:'قرار جزئي من المورد'})},${q(key())})`);
 let row=(await read('all','INSPECT215-'+partial.pid)).rows.find(x=>x.id===caseId);
 assert.equal(row.quantity,3);assert.equal(row.pendingQuantity,1);assert.equal(row.finishedSupplierQuantity,1);assert.equal(row.finalOwnerQuantity,1);
 assert.equal(row.periodLossInMinorUnits,'500');assert.equal(row.parcelSizeKnown,false);
 assert.equal(row.states.reduce((sum,x)=>sum+x.quantity,0),3);
 pass('one supplier source3 partitions pending1/received1/refused1; one500 loss, three packets not nine, unknown shop parcel size never guessed');
 const creditPayload={caseId,quantity:1,reason:'خصم آخر باكيت من حساب المورد'},p=await rpc(`preview_supplier_replacement_credit_v1('credit',${j(creditPayload)})`),before=await stock(partial.pid);
 const credit=await rpc(`settle_supplier_replacement_credit_v1('credit',${j(creditPayload)},${q(key())},${q(p.previewFingerprint)})`);
 row=(await read('all','INSPECT215-'+partial.pid)).rows.find(x=>x.id===caseId);
 assert.equal(row.pendingQuantity,0);assert.equal(row.finishedSupplierQuantity,2);assert.equal(row.creditedQuantity,1);assert.equal(row.periodLossInMinorUnits,'500');
 assert.deepEqual(await stock(partial.pid),before);assert.ok(row.movements.some(x=>x.action==='supplier_credited'));
 assert.equal((await read('pending_supplier','INSPECT215-'+partial.pid)).totalCount,0);
 const undo={eventId:credit.credit.event_id,reason:'عكس خصم مؤيد من دون تبعية'},up=await rpc(`preview_supplier_replacement_credit_v1('reverse_credit',${j(undo)})`);
 await rpc(`settle_supplier_replacement_credit_v1('reverse_credit',${j(undo)},${q(key())},${q(up.previewFingerprint)})`);
 row=(await read('pending_supplier','INSPECT215-'+partial.pid)).rows[0];assert.equal(row.pendingQuantity,1);assert.equal(row.finishedSupplierQuantity,1);assert.equal(row.finalOwnerQuantity,1);assert.equal(row.periodLossInMinorUnits,'500');
 pass('supplier credit closes only remaining packet without stock/profit loss; paired inverse restores pending state once and state filter follows current quantities');

 const original=await setup();const result=await rpc(`settle_inspected_sales_replacement_v2(${j(original.payload)},${q(key())},${q((await rpc(`preview_inspected_sales_replacement_v2(${j(original.payload)})`)).previewFingerprint)})`);
 await sql(`UPDATE products SET units_per_sale_unit=10 WHERE id=${q(original.pid)};`);
 const historical=(await read('all','INSPECT215-'+original.pid)).rows.find(x=>x.source==='replacement');
 assert.equal(historical.quantity,1);assert.equal(historical.historicalParcelSize,12);assert.equal(historical.parcelSizeKnown,true);assert.equal(historical.document.number,original.sale.orderNumber);
 assert.equal(historical.document.type,'order');assert.equal(historical.document.id,original.sale.orderId);assert.ok(result.success);
 pass('historical parcel size12 and real invoice link survive current catalogue change to10; only actual bad packet shown');

 const precise=[await setup({kind:'base',soldQuantity:5,cost:0.6}),await setup({kind:'base',soldQuantity:5,cost:0.6})];
 const sale=await rpc(`create_pos_sale_v2(${q(c.warehouse)},${q(c.branch)},${q(c.id(401))},'تجربة التقريب','cash',${j(precise.map(x=>({commercial_line_kind:'base_unit',product_id:x.pid,base_quantity:1,price_authority:'server_catalog',line_discount_in_minor_units:0})))},0,2000,${q(key())})`);
 const items=await json(`SELECT jsonb_agg(jsonb_build_object('sourceKind','base_order_item','sourceId',id,'quantity',1,'goodQuantity',1,'supplierId',NULL) ORDER BY id) FROM order_items WHERE order_id=${q(sale.orderId)};`);
 const inspection={orderId:sale.orderId,items,reason:'فحص السليم مع تكلفة كسر فلس',notes:null},ip=await rpc(`preview_inspected_sales_replacement_v2(${j(inspection)})`);
 assert.equal(ip.goodRecoveryInMinorUnits,1);const ir=await rpc(`settle_inspected_sales_replacement_v2(${j(inspection)},${q(key())},${q(ip.previewFingerprint)})`);
 assert.equal(await sql(`SELECT sum(w.good_recovery) FROM tb215_warranty_damage_facts_internal() w JOIN sales_replacement_events e ON e.operation_id=w.operation_id WHERE e.id=${q(ir.replacementId)};`),'1');
 assert.equal(await sql(`SELECT sum(w.net_cost) FROM tb215_warranty_damage_facts_internal() w JOIN sales_replacement_events e ON e.operation_id=w.operation_id WHERE e.id=${q(ir.replacementId)};`),'1');
 pass('two0.6 historical good recoveries allocate cumulative1+0=1 financial fils, never two; all-good rounding difference has no invented damaged packet');

 const all=await read(),one=await read('all','',1,1),two=await read('all','',2,1);
 assert.equal(one.totalCount,all.totalCount);assert.equal(two.totalCount,all.totalCount);assert.equal(one.periodLossInMinorUnits,all.periodLossInMinorUnits);assert.equal(two.periodLossInMinorUnits,all.periodLossInMinorUnits);
 assert.notEqual(one.rows[0].id,two.rows[0].id);assert.equal(BigInt(all.periodLossInMinorUnits),all.rows.reduce((sum,x)=>sum+BigInt(x.periodLossInMinorUnits),0n));
 pass('pagination reports one whole-period total independent of page; each physical root contributes money once');

 const noPrivate=(value)=>{if(!value||typeof value!=='object')return;for(const[k,v]of Object.entries(value)){assert.doesNotMatch(k,/cost|loss|profit|wac|value|actions/i);noPrivate(v);}};
 for(const role of ['manager','warehouse_keeper','admin','accountant','none']) {
  const uid=randomUUID();await sql(`INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)VALUES(${q(uid)},'authenticated','authenticated',${q('g5-'+uid+'@example.test')},'{}','{}');INSERT INTO profiles(id,full_name,is_active)VALUES(${q(uid)},${q(role)},true);`);
  if(role!=='none')await sql(`INSERT INTO roles(code,name_ar)VALUES(${q(role)},${q(role)})ON CONFLICT(code)DO NOTHING;INSERT INTO user_roles(user_id,role_id)SELECT ${q(uid)},id FROM roles WHERE code=${q(role)};`);
  if(['manager','warehouse_keeper'].includes(role)){const dto=await read('all','',1,100,uid);noPrivate(dto);assert.ok(dto.rows.length>0);}else await fail(call(),/ROLE_DENIED|صلاحية/,uid);
 }
 for(const role of ['anon','service_role']) await fail(call(),/permission denied/,null,role);
 for(const helper of ['tb215_damage_roots_internal','tb215_damage_case_states_internal','tb215_warranty_damage_facts_internal'])await fail(helper+'()',/permission denied/);
 pass('same208 reader roles only: manager/warehouse quantities contain no financial fields/actions; admin/accountant/no-role/anon/service/private helpers denied without writes');
}
