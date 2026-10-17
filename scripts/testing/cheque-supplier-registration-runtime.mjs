import assert from 'node:assert/strict';

// Real roles/transactions, no client-writable context or mocked payment writer.
export async function verifySupplierChequeRegistration({sql,rpc,refused,supplierBalance,q,j,key,id,branch,owner,manager,admin,record}) {
  const supplier=id(350),po=id(351),accountant=id(352);
  await sql(`INSERT INTO suppliers(id,company_name) VALUES(${q(supplier)},'مورد توحيد مسار الشيك');
    INSERT INTO auth.users(id,aud,role,email) VALUES(${q(accountant)},'authenticated','authenticated','supplier-check-accountant@example.test');
    INSERT INTO profiles(id,full_name,is_active) VALUES(${q(accountant)},'محاسب الفحص',true);
    INSERT INTO roles(code,name_ar) VALUES('accountant','محاسب') ON CONFLICT(code) DO NOTHING;
    INSERT INTO user_roles(user_id,role_id) SELECT ${q(accountant)},id FROM roles WHERE code='accountant';
    INSERT INTO purchase_orders(id,purchase_order_number,supplier_id,branch_id,status,total_in_minor_units)
      VALUES(${q(po)},'PO-CHEQUE-GATE',${q(supplier)},${q(branch)},'approved',30000);`);
  await rpc(`record_supplier_opening_balances_v1(${q(key())},${j([{supplier_id:supplier,direction:'payable',amount_in_minor_units:100000,original_balance_date:'2020-01-01'}])})`);
  const snapshot=()=>sql(`SELECT jsonb_build_object('supplier',(SELECT to_jsonb(s) FROM suppliers s WHERE id=${q(supplier)}),
    'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM supplier_payments p WHERE supplier_id=${q(supplier)}),
    'cheques',(SELECT COUNT(*) FROM deferred_cheques),'events',(SELECT COUNT(*) FROM deferred_cheque_events),
    'allocations',(SELECT COUNT(*) FROM deferred_cheque_allocations),'audit',(SELECT COUNT(*) FROM audit_logs));`);
  const before=await snapshot();
  for(const actor of [owner,manager,admin,accountant])for(const method of ['check','cheque']){
    await refused(`record_supplier_payment(${q(supplier)},NULL,1000,${q(method)},'UNREGISTERED',CURRENT_TIMESTAMP,NULL,${q(key())})`,
      /CHEQUE_REGISTRATION_REQUIRED|صلاحية|صلاحيات|غير مصرح|ليس لديك|مالك/u,actor);
    assert.equal(await snapshot(),before,'refused direct cheque writes nothing');
  }
  const issue=(amount,k,claim='NULL',target=q(po))=>`issue_supplier_cheque_v1(${q(supplier)},${q(branch)},'بنك التوحيد',${q(k)},CURRENT_DATE+2,${amount},NULL,${q(k)},${claim},${target})`;
  for(const actor of [admin,accountant])await refused(issue(1000,key()),/صلاحية|صلاحيات|غير مصرح|ليس لديك|مالك/u,actor);
  await refused(`preview_supplier_cheque_v1(${q(supplier)},30001,NULL,${q(po)})`,/SUPPLIER_PO_PAYMENT_EXCEEDS_PAYABLE/u);
  await refused(issue(30001,key()),/SUPPLIER_PO_PAYMENT_EXCEEDS_PAYABLE/u);
  assert.equal(await snapshot(),before);
  const k=key(),issued=await rpc(issue(10000,k),manager);
  const payment=JSON.parse(await sql(`SELECT to_jsonb(p) FROM supplier_payments p WHERE id=${q(issued.cheque.supplier_payment_id)};`));
  assert.equal(payment.purchase_order_id,po);assert.equal(payment.payment_method,'cheque');assert.equal(payment.amount_in_minor_units,10000);
  assert.equal(await sql(`SELECT amount_paid_in_minor_units FROM purchase_orders WHERE id=${q(po)};`),'10000');
  assert.deepEqual(await supplierBalance(supplier),{stored:90000,evidence:90000});
  assert.equal(await sql(`SELECT COUNT(*) FROM deferred_cheque_allocations WHERE cheque_id=${q(issued.cheque.id)} AND party_kind='supplier' AND origin_id=${q(po)} AND original_debt_at IS NULL;`),'1');
  await sql(`DO $probe$ BEGIN BEGIN
    UPDATE supplier_payments SET purchase_order_id=NULL WHERE id=${q(payment.id)};
    PERFORM public.cheque_assert_integrity_internal(${q(issued.cheque.id)});
    RAISE EXCEPTION 'EXPECTED_PO_EVIDENCE_REFUSAL';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM !~ 'CHEQUE_EVIDENCE_MISMATCH' THEN RAISE;END IF;END;END $probe$;`);
  const after=await snapshot();assert.equal((await rpc(issue(10000,k),manager)).idempotentReplay,true);assert.equal(await snapshot(),after);
  await refused(`record_supplier_payment(${q(supplier)},${q(po)},10000,'cheque',${q(k)},CURRENT_TIMESTAMP,NULL,${q('cheque-supplier-'+issued.cheque.id)})`,/CHEQUE_REGISTRATION_REQUIRED/u,manager);
  assert.equal(await snapshot(),after,'previous registration cannot be reused in a later transaction');
  record('check/cheque direct denied for owner/manager/admin/accountant;registered PO issue keeps133 cap/target and replay0',{amount:10000,poRemaining:20000});

  // Old non-cheque methods retain their exact133 roles and payload semantics.
  await rpc(`open_cash_shift(${q(branch)},5000)`);
  const shift=JSON.parse(await sql(`SELECT to_jsonb(id) FROM cash_shifts WHERE branch_id=${q(branch)} AND status='open';`));
  for(const [actor,method] of [[owner,'cash'],[manager,'bank_transfer'],[admin,'card'],[accountant,'bank_transfer']]){
    const result=await rpc(`record_supplier_payment(${q(supplier)},${q(po)},1000,${q(method)},'NON-CHEQUE',CURRENT_TIMESTAMP,NULL,${q(key())})`,actor);
    assert.ok(result.payment_id);
  }
  assert.deepEqual(await supplierBalance(supplier),{stored:86000,evidence:86000});
  assert.equal((await rpc(`get_cash_shift_summary(${q(shift)})`)).expectedCashInMinorUnits,4000);
  await rpc(`close_cash_shift(${q(shift)},4000,NULL)`);
  record('non-cheque supplier methods preserve owner/manager/admin/accountant roles and single133 balance effect',{balance:86000});

  const openingSupplier=id(353);
  await sql(`INSERT INTO suppliers(id,company_name) VALUES(${q(openingSupplier)},'مورد رصيد سابق وشراء جديد');`);
  await rpc(`record_supplier_opening_balances_v1(${q(key())},${j([{supplier_id:openingSupplier,direction:'payable',amount_in_minor_units:100000,original_balance_date:'2020-01-01'}])})`);
  await rpc(`create_direct_supplier_receipt_v2(p_supplier_id:=${q(openingSupplier)},p_branch_id:=${q(branch)},p_warehouse_id:=${q(id(201))},
    p_idempotency_key:=${q(key())},p_payment_method:='deferred',p_lines:=${j([{client_line_id:id(354),line_kind:'base_unit',commercial_quantity:1,
      base_unit_name:'باكيت',gross_amount_in_minor_units:100000,line_discount_in_minor_units:0,components:[{product_id:id(101),base_quantity:1}]}])})`);
  assert.deepEqual(await supplierBalance(openingSupplier),{stored:200000,evidence:200000});
  const openingSnapshot=()=>sql(`SELECT jsonb_build_object('supplier',(SELECT to_jsonb(s) FROM suppliers s WHERE id=${q(openingSupplier)}),
    'payments',(SELECT COUNT(*) FROM supplier_payments),'openingPayments',(SELECT COUNT(*) FROM supplier_opening_payments),
    'cheques',(SELECT COUNT(*) FROM deferred_cheques),'audit',(SELECT COUNT(*) FROM audit_logs));`);
  const beforeOpening=await openingSnapshot();
  for(const actor of [owner,manager,admin,accountant])await refused(
    `pay_supplier_opening_balance_v1(${q(openingSupplier)},NULL,1000,'cheque','OLD-OPENING',NULL,${q(key())})`,
    /CHEQUE_REGISTRATION_REQUIRED|صلاحية|صلاحيات|غير مصرح|ليس لديك|مالك/u,actor);
  assert.equal(await openingSnapshot(),beforeOpening,'legacy163 direct cheque path rolls back completely');
  await refused(`preview_supplier_cheque_v1(${q(openingSupplier)},100001,NULL,NULL,true)`,/GO_LIVE_SUPPLIER_PAYMENT_EXCEEDS_OPENING/u);
  const openingKey=key();const openingCall=`issue_supplier_cheque_v1(${q(openingSupplier)},${q(branch)},'بنك الرصيد السابق','OPENING-REGISTERED',CURRENT_DATE+2,20000,NULL,${q(openingKey)},NULL,NULL,true)`;
  const openingCheque=await rpc(openingCall);
  assert.deepEqual(await supplierBalance(openingSupplier),{stored:180000,evidence:180000});
  const openingPayable=await rpc(`get_supplier_opening_payable_v1(${q(openingSupplier)})`);
  assert.equal(openingPayable.remainingOpeningPayableInMinorUnits,80000);
  const allocations=JSON.parse(await sql(`SELECT jsonb_agg(jsonb_build_object('kind',origin_kind,'amount',amount_in_minor_units,
    'date',(original_debt_at AT TIME ZONE 'Asia/Amman')::DATE)) FROM deferred_cheque_allocations WHERE cheque_id=${q(openingCheque.cheque.id)};`));
  assert.deepEqual(allocations,[{kind:'opening',amount:20000,date:'2020-01-01'}]);
  const afterOpening=await openingSnapshot();assert.equal((await rpc(openingCall)).idempotentReplay,true);assert.equal(await openingSnapshot(),afterOpening);
  await rpc(`cancel_deferred_cheque_v1(${q(openingCheque.cheque.id)},1,'إلغاء اختبار الرصيد السابق',${q(key())})`);
  assert.deepEqual(await supplierBalance(openingSupplier),{stored:200000,evidence:200000});
  assert.equal((await rpc(`get_supplier_opening_payable_v1(${q(openingSupplier)})`)).remainingOpeningPayableInMinorUnits,80000,
    'cancellation restores independent claim,not the settled original opening');
  const openingClaim=JSON.parse(await sql(`SELECT to_jsonb(id) FROM cheque_compensation_claims WHERE cheque_id=${q(openingCheque.cheque.id)};`));
  await rpc(`pay_supplier_cheque_claim_v1(${q(openingClaim)},NULL,20000,'bank_transfer','CLAIM-OPENING',NULL,${q(key())})`);
  assert.deepEqual(await supplierBalance(openingSupplier),{stored:180000,evidence:180000});
  assert.equal((await rpc(`get_supplier_opening_payable_v1(${q(openingSupplier)})`)).remainingOpeningPayableInMinorUnits,80000);
  record('163 direct cheque closed;registered opening-only cheque preserves dates/cap and remaining80.000 with mixed debt;cancel creates independent claim',{total:180000,opening:80000});
}
