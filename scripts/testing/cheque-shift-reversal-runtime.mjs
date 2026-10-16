import assert from 'node:assert/strict';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';

export async function verifyChequeShiftReversals({executor,sql,rpc,refused,key,q,j,id,branch,balance,supplierBalance,supplier,claim,manager,record}) {
  const shiftId=async()=>JSON.parse(await sql(`SELECT to_jsonb(id) FROM cash_shifts WHERE branch_id=${q(branch)} AND status='open';`));
  const cash=async shift=>(await rpc(`get_cash_shift_summary(${q(shift)})`)).expectedCashInMinorUnits;
  const blocked=async shift=>{
    const preview=await rpc(`preview_cash_shift_full_reversal(${q(shift)})`);
    assert.equal(preview.canExecute,false);assert.equal(preview.chequeCompensationBlocked,true);
    const before=await readApplicationFingerprint(executor);
    await refused(`reverse_cash_shift_with_operations(${q(shift)},'فحص منع عكس قيد شيك قبل عكسه منفرداً',${q(key())})`,/GO_LIVE_SHIFT_HAS_UNIFIED_OPERATIONS/u);
    assert.deepEqual(await readApplicationFingerprint(executor),before,'blocked full reversal changes no public row or sequence');
  };
  const beforeCustomer=await balance(id(405));await rpc(`open_cash_shift(${q(branch)},0)`);const customerShift=await shiftId();
  const op=await rpc(`collect_customer_balance_v1(${q(id(405))},1000,'cash',${q(branch)},NULL,'فحص عكس تحصيل القيد',${q(key())})`);
  assert.equal(await balance(id(405)),beforeCustomer-1000);assert.equal(await cash(customerShift),1000);await blocked(customerShift);
  await rpc(`reverse_customer_collection_v1(${q(op.operationId)},'عكس تحصيل قيد الشيك للاختبار')`);
  assert.equal(await balance(id(405)),beforeCustomer);assert.equal(await cash(customerShift),0);
  const beforeClose=await rpc(`get_cash_shift_closing_report(${q(customerShift)})`);
  await rpc(`close_cash_shift(${q(customerShift)},0,NULL)`);assert.equal(await cash(customerShift),0);
  assert.deepEqual((await rpc(`get_cash_shift_closing_report(${q(customerShift)})`)).chequeCompensationSettlements,beforeClose.chequeCompensationSettlements);
  record('compensation collection blocks full reversal with0publicrow/sequence changes;existing163 reverse restores debt/drawer;closed snapshot exact0');

  const beforeSupplier=await supplierBalance(supplier);await rpc(`open_cash_shift(${q(branch)},5000)`);const supplierShift=await shiftId();
  const paid=await rpc(`pay_supplier_cheque_claim_v1(${q(claim)},${q(branch)},1000,'cash',NULL,'فحص عكس سداد القيد',${q(key())})`);
  assert.equal((await supplierBalance(supplier)).evidence,beforeSupplier.evidence-1000);assert.equal(await cash(supplierShift),4000);await blocked(supplierShift);
  const reversalKey=key(),reverse=`reverse_supplier_cheque_claim_payment_v1(${q(paid.paymentId)},'عكس سداد قيد الشيك للاختبار',${q(reversalKey)})`;
  const unchanged=async(call,pattern,actor)=>{const before=await readApplicationFingerprint(executor);await refused(call,pattern,actor);
    assert.deepEqual(await readApplicationFingerprint(executor),before,'refused reversal must change no public row or sequence');};
  await unchanged(reverse,/مالك|صلاحية|صلاحيات|غير مصرح/u,manager);
  for(const reason of ['قصير','x'.repeat(501)])await unchanged(`reverse_supplier_cheque_claim_payment_v1(${q(paid.paymentId)},${q(reason)},${q(key())})`,/5.*500/u);
  await rpc(reverse);
  assert.deepEqual(await supplierBalance(supplier),beforeSupplier);assert.equal(await cash(supplierShift),5000);
  const replayBefore=await readApplicationFingerprint(executor);assert.equal((await rpc(reverse)).idempotentReplay,true);
  assert.deepEqual(await readApplicationFingerprint(executor),replayBefore);
  await unchanged(`reverse_supplier_cheque_claim_payment_v1(${q(paid.paymentId)},'سبب مختلف بنفس المفتاح',${q(reversalKey)})`,/CHEQUE_IDEMPOTENCY_CONFLICT/u);
  const supplierReport=await rpc(`get_cash_shift_closing_report(${q(supplierShift)})`);
  await rpc(`close_cash_shift(${q(supplierShift)},5000,NULL)`);assert.equal(await cash(supplierShift),5000);
  assert.deepEqual((await rpc(`get_cash_shift_closing_report(${q(supplierShift)})`)).chequeCompensationSettlements,supplierReport.chequeCompensationSettlements);
  assert.equal((await rpc(reverse)).idempotentReplay,true,'committed replay remains read-only after shift closure');
  record('supplier claim dedicated owner reversal restores133/drawer;role/reason/replay exact;original133 guard unchanged;closed snapshot5000');

  // Literal owner acceptance case, an independent supplier with exactly500.000.
  const party=id(360);await sql(`INSERT INTO suppliers(id,company_name,phone) VALUES(${q(party)},'مورد سيناريو شيك500','0796600360');`);
  await rpc(`create_direct_supplier_receipt_v2(p_supplier_id:=${q(party)},p_branch_id:=${q(branch)},p_warehouse_id:=${q(id(201))},
    p_idempotency_key:=${q(key())},p_payment_method:='deferred',p_lines:=${j([{client_line_id:id(361),line_kind:'base_unit',commercial_quantity:1,
      base_unit_name:'باكيت',gross_amount_in_minor_units:500000,line_discount_in_minor_units:0,components:[{product_id:id(101),base_quantity:1}]}])})`);
  const issued=await rpc(`issue_supplier_cheque_v1(${q(party)},${q(branch)},'بنك اختبار500','REV-500',CURRENT_DATE+2,500000,NULL,${q(key())})`);
  assert.deepEqual(await supplierBalance(party),{stored:0,evidence:0});
  const originalPayment=await sql(`SELECT to_jsonb(p) FROM supplier_payments p WHERE id=${q(issued.cheque.supplier_payment_id)};`);
  const returned=await rpc(`return_deferred_cheque_v1(${q(issued.cheque.id)},1,'شيك صادر500 راجع',${q(key())})`);
  const claim500=returned.claims.find(c=>c.party_kind==='supplier').id;
  assert.deepEqual(await supplierBalance(party),{stored:500000,evidence:500000});
  await rpc(`open_cash_shift(${q(branch)},600000)`);const shift500=await shiftId();
  const settlement=await rpc(`pay_supplier_cheque_claim_v1(${q(claim500)},${q(branch)},500000,'cash',NULL,NULL,${q(key())})`);
  assert.deepEqual(await supplierBalance(party),{stored:0,evidence:0});assert.equal(await cash(shift500),100000);
  const reverse500=`reverse_supplier_cheque_claim_payment_v1(${q(settlement.paymentId)},'تصحيح سداد500 من وردية مفتوحة',${q(key())})`;
  const concurrent=await Promise.all([rpc(reverse500),rpc(reverse500)]);
  assert.deepEqual(concurrent.map(r=>r.idempotentReplay).sort(),[false,true],'concurrent replay has one and only one financial effect');
  assert.deepEqual(await supplierBalance(party),{stored:500000,evidence:500000});assert.equal(await cash(shift500),600000);
  const detail=await rpc(`get_deferred_cheque_detail(${q(issued.cheque.id)})`);
  const reversed=detail.supplierClaimPayments.find(p=>p.id===settlement.paymentId);
  assert.equal(reversed.is_reversed,true);assert.equal(reversed.can_reverse,false);assert.equal(reversed.amount_in_minor_units,500000);
  for(const method of ['cliq','bank_transfer']){
    const p=await rpc(`pay_supplier_cheque_claim_v1(${q(claim500)},${method==='cliq'?q(branch):'NULL'},1000,${q(method)},NULL,NULL,${q(key())})`);
    assert.equal(await cash(shift500),600000);
    await rpc(`reverse_supplier_cheque_claim_payment_v1(${q(p.paymentId)},'عكس سداد غير نقدي للقيد',${q(key())})`);
    assert.equal(await cash(shift500),600000);assert.deepEqual(await supplierBalance(party),{stored:500000,evidence:500000});
  }
  const closed=await rpc(`pay_supplier_cheque_claim_v1(${q(claim500)},${q(branch)},1000,'cash',NULL,NULL,${q(key())})`);
  await rpc(`close_cash_shift(${q(shift500)},599000,NULL)`);
  await unchanged(`reverse_supplier_cheque_claim_payment_v1(${q(closed.paymentId)},'محاولة عكس وردية مغلقة',${q(key())})`,/وردية غير مفتوحة/u);
  await unchanged(`reverse_supplier_cheque_claim_payment_v1(${q(issued.cheque.supplier_payment_id)},'دفعة الشيك الأصلية محمية',${q(key())})`,/CHEQUE_CLAIM_REVERSAL_NOT_ALLOWED/u);
  assert.equal(await sql(`SELECT to_jsonb(p) FROM supplier_payments p WHERE id=${q(issued.cheque.supplier_payment_id)};`),originalPayment);
  await sql('SELECT public.run_advanced_monitoring_checks(CURRENT_TIMESTAMP);');
  assert.equal(await sql(`SELECT status FROM advanced_monitoring_checks WHERE check_key='integrity:accounting:deferred-cheques';`),'healthy');
  record('outgoing500->returned->cash500->owner reverse:debt500/drawer600 exact;CliQ/transfer no cash;closed shift refused;original cheque unchanged;monitor healthy');
}
