import assert from 'node:assert/strict';
import {executeInput} from '../operations/build-empty-supabase.mjs';

export async function verifyExchangeReaders215(c,pass) {
 const {q,rpc,sql,json,fingerprint}=c;
 const shift=await json("SELECT to_jsonb(id) FROM cash_shifts WHERE status='open';");
 for(const method of ['cash','cliq']) for(const kind of ['sales','refunds']) {
  const p=await rpc(`get_cash_shift_movement_page(${q(shift)},${q(kind)},${q(method)},1,100)`);
  assert.equal(p.evidenceStatus,'matched');assert.equal(p.totalAmountInMinorUnits,p.canonicalAmountInMinorUnits);
  for(const row of p.rows.filter(x=>x.note?.includes('تبديل'))) {assert.ok(row.amountInMinorUnits>0);assert.equal(row.document.type,'order');}
 }
 const closing=await rpc(`get_cash_shift_closing_report(${q(shift)})`);
 assert.equal(closing.success,true);assert.equal(closing.salesDetailStatus,'available');
 assert.ok(closing.sales.internalExchangeCreditInMinorUnits>0);
 assert.ok(closing.returnBreakdown.every(x=>x.refundMethod!=='exchange_credit'));
 pass('cash/CliQ movement pages reconcile actual exchange money; closing sales evidence includes explicit noncash credit and refund breakdown has actual money only');
 const rows=await json(`SELECT jsonb_agg(jsonb_build_object('order',o.id,'token',o.public_receipt_token,'credit',x.prepared_plan->'internalCreditInMinorUnits','paid',x.prepared_plan->'moneyReceivedInMinorUnits','refund',x.prepared_plan->'moneyRefundInMinorUnits')) FROM aftercare215_exchanges x JOIN aftercare215_exchange_results r ON r.operation_id=x.operation_id JOIN orders o ON o.id=r.new_order_id;`);
 for(const row of rows) {
  if(!row.token) {row.token=await json(`SELECT to_jsonb(gen_random_uuid());`);await sql(`UPDATE orders SET public_receipt_token=${q(row.token)} WHERE id=${q(row.order)};`);}
  const fp=await fingerprint(),p=await rpc(`get_public_pos_receipt(${q(row.token)})`,null,'anon',undefined,true);
  assert.equal(p.success,true);assert.equal(p.exchange.internalCreditInMinorUnits,row.credit);
  assert.equal(p.exchange.moneyReceivedInMinorUnits,row.paid);assert.equal(p.exchange.moneyRefundInMinorUnits,row.refund);
  assert.deepEqual(await fingerprint(),fp);assert.doesNotMatch(JSON.stringify(p),/wac|unitCost|Cogs|profit|supplierHeld/);
 }
 pass('token-gated public receipts expose credit and actual paid/refunded difference only; READONLY/zero writes/no cost or profit fields');
 for(const [type,field,value,proof] of [['aftercare215_inspection','restockedQuantity',999,'tb215_assert_inspection_internal'],['aftercare215_return','moneyRefundInMinorUnits','999999','tb215_assert_return_internal'],['aftercare215_exchange','moneyReceivedInMinorUnits','999999','tb215_assert_exchange_internal']]) {
  const operation=await json(`SELECT to_jsonb(id) FROM business_operations WHERE operation_type=${q(type)} ORDER BY completed_at LIMIT 1;`);
  assert.ok(operation);
  const before=await fingerprint(),r=await executeInput(c.executor,`BEGIN;ALTER TABLE business_operations DISABLE TRIGGER USER;UPDATE business_operations SET result_snapshot=jsonb_set(result_snapshot,ARRAY[${q(field)}],${q(JSON.stringify(value))}::jsonb) WHERE id=${q(operation)};SELECT public.${proof}(${q(operation)});ROLLBACK;`);
  assert.notEqual(r.code,0);assert.match(r.stderr,/EVIDENCE_INVALID/);assert.deepEqual(await fingerprint(),before);
 }
 pass('tampering only returned quantity/refund/difference while retaining every manifest commitment fails independent result proof for all three new coordinators');
 const summary=await rpc(`get_cash_shift_summary(${q(shift)})`);
 await rpc(`close_cash_shift(${q(shift)},${summary.expectedCashInMinorUnits},NULL)`);
 const after=await rpc(`get_cash_shift_summary(${q(shift)})`);
 assert.equal(after.expectedCashInMinorUnits,summary.expectedCashInMinorUnits);assert.equal(after.cashRefundsInMinorUnits,summary.cashRefundsInMinorUnits);
 const frozen=await rpc(`get_cash_shift_closing_report(${q(shift)})`);assert.equal(frozen.salesDetailStatus,'available');assert.equal(frozen.snapshotStatus,'immutable');
 assert.ok(frozen.returnBreakdown.every(x=>x.refundMethod!=='exchange_credit'));
 await rpc(`open_cash_shift(${q(c.branch)},${summary.expectedCashInMinorUnits})`);
 pass('closing freezes exact actual exchange drawer totals once; closed summary and immutable closing report agree without double counting');
}
