import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {tsImport} from 'tsx/esm/api';
import {returnPayload215} from './aftercare215-return-cases.mjs';
import {liteShiftReason} from './lite220-fable-additions.mjs';

export async function proveAgedLiteOrder(c, orderId) {
 const {sql,json,q}=c;
 const failures=()=>sql("SELECT count(*) FROM audit_logs WHERE action='EXPIRE_STALE_WEBSITE_ORDER_FAILED';");
 const before=await failures();
 await sql(`UPDATE public.orders SET created_at=now()-interval '6 hours',
  reservation_expires_at=now()-interval '1 hour' WHERE id=${q(orderId)};`);
 assert.equal(await sql(`SELECT created_at < now()-interval '5 hours' FROM public.orders WHERE id=${q(orderId)};`),'t');
 const scan=await json('SELECT public.expire_stale_new_website_orders(100);');
 assert.equal(scan.success,true);
 assert.equal(scan.failed_count,0);
 assert.equal(await failures(),before);
 assert.equal(await sql(`SELECT status FROM public.orders WHERE id=${q(orderId)};`),'new');
 return {overFiveHours:true,status:'new',expirySucceeded:true,newFailureRows:0};
}

async function proveShiftBlock(c,shiftId) {
 const {rpc,q}=c;
 const preview=await rpc(`lite1_preview_shift_reversal2(${q(shiftId)})`);
 assert.equal(preview.canExecute,false);
 assert.equal(preview.liteShiftBlocked,true);
 assert.ok(preview.operations.some(row=>row.operationType==='lite_shift'&&row.reason===liteShiftReason));
}

async function closeByCount(c,shiftId) {
 const {rpc,q}=c;
 const summary=await rpc(`get_cash_shift_summary(${q(shiftId)})`);
 await rpc(`close_cash_shift(${q(shiftId)},${summary.expectedCashInMinorUnits},NULL)`);
 const closing=await rpc(`lite1_shift_closing2(${q(shiftId)})`);
 assert.equal(closing.reconciliation.cashDiscrepancyInMinorUnits,0);
 assert.equal(await c.sql(`SELECT status FROM public.cash_shifts WHERE id=${q(shiftId)};`),'closed');
}

export async function rehearseReview220(c,day) {
 const {sql,json,rpc,q,j}=c;
 const {branch,warehouse,customer,products}=day;
 const product=products.find(row=>row.sku==='L220-0074');
 assert.ok(product);
 const {knownBusinessErrorMessage}=await tsImport('../../src/utils/businessError.ts',import.meta.url);
 const emptyShift=(await rpc(`open_cash_shift(${q(branch)},0)`)).id;
 await proveShiftBlock(c,emptyShift);
 await assert.rejects(rpc(`cancel_empty_cash_shift(${q(emptyShift)},'وردية بروفة فُتحت بالخطأ')`),
  error=>error.message.includes(liteShiftReason));
 await closeByCount(c,emptyShift);

 const shift=(await rpc(`open_cash_shift(${q(branch)},100000)`)).id;
 const balance=async()=>Number((await rpc(`lite1_statement_dispatch2(${q(customer)},1,100)`)).closing_balance_in_minor_units);
 const beforeDebt=await balance();
 const sellDebt=async()=> {
  const sale=await rpc(`lite1_pos2(${j({branchId:branch,warehouseId:warehouse,customerId:customer,paymentMethod:'debt',
   lines:[{commercial_line_kind:'base_unit',product_id:product.id,base_quantity:10}],
   discountInMinorUnits:0,amountReceivedInMinorUnits:0})},${q(randomUUID())})`);
  assert.equal(sale.totalInMinorUnits,10000);
  return sale;
 };
 const settle=async(sale,quantity)=>{
  const item=await json(`SELECT to_jsonb(id) FROM public.order_items WHERE order_id=${q(sale.orderId)};`);
  const payload=returnPayload215({sale,item,pid:product.id},{quantity,good:quantity,method:'cash'});
  const preview=await rpc(`lite1_preview_return2(${j(payload)})`);
  const result=await rpc(`lite1_settle_return2(${j(payload)},${q(randomUUID())},${q(preview.previewFingerprint)})`);
  assert.equal(result.success,true);
  return preview;
 };
 const collect=(sale,amount)=>rpc(`record_customer_order_payment_once(${q(sale.orderId)},${amount},'cash',NULL,'تحصيل بروفة',${q(randomUUID())})`);
 const debt=await sellDebt();
 assert.equal(await balance(),beforeDebt+10000);
 const reduced=await settle(debt,4);
 assert.equal(Number(reduced.moneyRefundInMinorUnits),0);
 assert.equal(await balance(),beforeDebt+6000);
 await collect(debt,6000);
 assert.equal(await balance(),beforeDebt);
 const overall=await rpc('lite1_debt_aging2(NULL)');
 const customers=await json("SELECT coalesce(jsonb_agg(id),'[]') FROM public.customers;");
 let statements=0;
 for(const id of customers)statements+=Number((await rpc(`lite1_statement_dispatch2(${q(id)},1,100)`)).closing_balance_in_minor_units);
 assert.equal(Number(overall.total_in_minor_units),statements);

 const paid=await sellDebt();
 const {payment_id:paymentId}=await collect(paid,10000);
 assert.ok(paymentId);
 const refunded=await settle(paid,10);
 assert.equal(Number(refunded.moneyRefundInMinorUnits),10000);
 const reversalError='LITE3_COLLECTION_REVERSAL_HAS_LITE_REFUND';
 await assert.rejects(rpc(`reverse_customer_order_payment(${q(paymentId)},'عكس قبض بعد رد نقدي في البروفة')`),
  error=>error.message.includes(reversalError)&&error.message.includes(knownBusinessErrorMessage(reversalError)));
 assert.equal(await sql(`SELECT is_reversed FROM public.customer_payments WHERE id=${q(paymentId)};`),'f');
 assert.equal(await balance(),beforeDebt);
 await proveShiftBlock(c,shift);
 await assert.rejects(rpc(`reverse_cash_shift_with_operations(${q(shift)},'محاولة عكس وردية بيع مبسطة',${q(randomUUID())})`),
  /ERROR:/u);
 assert.equal(await sql(`SELECT status FROM public.cash_shifts WHERE id=${q(shift)};`),'open');
 assert.equal(await sql(`SELECT count(*) FROM public.pos_sale_reversals WHERE order_id IN(${q(debt.orderId)},${q(paid.orderId)});`),'0');
 await closeByCount(c,shift);
 return {shift,aging:statements,statements,orderDebtDelta:0,customerDebt:beforeDebt,
  cashRefund:10000,collectionReversalRejected:true,arabicMessage:knownBusinessErrorMessage(reversalError),
  emptyShiftCancellationRejected:true,saleShiftReversalRejected:true,countedClosings:2};
}

export async function rehearseReviewEpoch220(c,review) {
 const {sql,json,rpc,q,j}=c;
 const ledger=()=>json(`SELECT jsonb_build_object(
  'orders',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.orders o),
  'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.customer_payments p),
  'shifts',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.cash_shifts s),
  'openings',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.customer_opening_balances o));`);
 const before=await ledger();
 const rows=await json(`SELECT jsonb_agg(jsonb_build_object(
  'productId',p.id,'warehouseId',w.id,'actualQuantity',20,'unitCostInMinorUnits',500) ORDER BY p.id,w.id)
  FROM public.products p CROSS JOIN public.warehouses w JOIN public.branches b ON b.id=w.branch_id
  WHERE p.is_active AND NOT p.is_flavor_master AND w.is_active AND b.is_active;`);
 assert.ok(rows.length>=1093,'OWNER_SIZE_EPOCH_REQUIRES_EVERY_SELLABLE_SKU');
 const notes='جرد تفعيل المحاسبة بعد يوم البروفة';
 const previewStarted=performance.now();
 const preview=await rpc(`lite1_preview_epoch2(${j(rows)},${q(notes)})`);
 const previewMs=Math.round(performance.now()-previewStarted);
 const key=randomUUID();
 const activate=`lite1_activate_epoch2(${j(rows)},${q(notes)},${q(key)},${q(preview.previewFingerprint)},'تفعيل المحاسبة بالجرد المعتمد')`;
 const activationStarted=performance.now();
 const result=await rpc(activate);
 const activationMs=Math.round(performance.now()-activationStarted);
 assert.equal(result.fullAccounting,true);
 assert.equal((await rpc('lite1_operating_mode()')).fullAccounting,true);
 assert.deepEqual(await rpc(activate),result);
 const balances=await json(`SELECT jsonb_agg(jsonb_build_object(
  'productId',i.product_id,'warehouseId',i.warehouse_id,'actualQuantity',b.on_hand_quantity,
  'unitCostInMinorUnits',p.cost_price_in_minor_units) ORDER BY i.product_id,i.warehouse_id)
  FROM sales_lite2.opening_epoch_items i JOIN public.inventory_balances b
  ON b.product_id=i.product_id AND b.warehouse_id=i.warehouse_id JOIN public.products p ON p.id=i.product_id
  WHERE i.epoch_id=${q(result.epochId)};`);
 assert.deepEqual(balances,rows);
 await proveShiftBlock(c,review.shift);
 await assert.rejects(rpc(`reverse_cash_shift_with_operations(${q(review.shift)},'محاولة عكس وردية lite بعد التفعيل',${q(randomUUID())})`),/ERROR:/u);
 assert.deepEqual(await ledger(),before);
 assert.equal(Number((await rpc('lite1_debt_aging2(NULL)')).total_in_minor_units),review.aging);
 assert.equal((await json('SELECT public.run_advanced_monitoring_checks();')).integrityIssueCount,0);
 assert.equal(await sql('SELECT count(*) FROM sales_lite2.opening_epochs;'),'1');
 return {realOpeningEpoch:true,rows:rows.length,previewMs,activationMs,exactBalances:true,
  ledgerUnchanged:true,oldLiteShiftStillBlocked:true,debt:review.aging};
}
