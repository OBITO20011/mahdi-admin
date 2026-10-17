import assert from 'node:assert/strict';

// Uses the real authenticated RPCs and privileged fixture-only DELETE probes.
// Does not grant DELETE to a browser role or bypass historical FK retention.
export async function verifyChequePartyDeletion({sql,rpc,refused,sale,receive,balance,supplierBalance,q,j,key,id,branch,record}) {
  const rejectedDelete=async(table,party,pattern)=>{
    await sql(`DO $guard$ BEGIN BEGIN DELETE FROM public.${table} WHERE id=${q(party)};
      RAISE EXCEPTION 'EXPECTED_DELETE_REFUSAL';EXCEPTION WHEN OTHERS THEN
      IF SQLERRM !~ ${q(pattern)} THEN RAISE;END IF;END;END $guard$;`);
  };
  await sale(id(412));const pending=await receive(id(412),100000);
  assert.equal(await balance(id(412)),0);
  await refused(`set_customer_status(${q(id(412))},'delete')`,/لا يمكن حذف العميل.*الشيك رقم/u);
  await rejectedDelete('customers',id(412),'لا يمكن حذف العميل.*الشيك رقم');
  await rpc(`set_customer_status(${q(id(412))},'block')`);
  const all=await rpc(`get_crm_customer_page(1,100,NULL,'all','latest')`);
  assert.ok(all.customers.some(c=>c.id===id(412)),'blocked customer remains in all CRM');
  const listed=await rpc(`get_deferred_cheques_page()`);
  assert.ok(listed.items.some(c=>c.id===pending.cheque.id),'blocked customer cheque remains visible');
  await rpc(`set_customer_status(${q(id(412))},'unblock')`);
  await rpc(`clear_deferred_cheque_v1(${q(pending.cheque.id)},1,${q(key())})`);
  assert.equal((await rpc(`set_customer_status(${q(id(412))},'delete')`)).success,true);
  assert.equal(await sql(`SELECT is_deleted FROM customers WHERE id=${q(id(412))};`),'t');
  record('customer cheque pays debt to0:RPC and direct deletion refused while pending;block visible;cleared zero allows soft delete');

  await rpc(`record_customer_opening_balances_v1(${q(key())},${j([{customer_id:id(414),amount_in_minor_units:5000,original_debt_date:'2020-01-01'}])})`);
  await refused(`set_customer_status(${q(id(414))},'delete')`,/دين 5\.000/u);
  await rpc(`set_customer_status(${q(id(414))},'block')`);
  const debtPage=await rpc(`get_crm_customer_page(1,100,NULL,'has_debt','latest')`);
  assert.ok(debtPage.customers.some(c=>c.id===id(414)),'blocked positive opening debt remains in debt filter');
  await refused(`set_customer_status(${q(id(405))},'delete')`,/دين 70\.000/u);
  record('canonical opening5000 and compensation70000 prevent deletion;blocked debt stays visible');

  const guardSupplier=id(331);
  await sql(`INSERT INTO suppliers(id,company_name) VALUES(${q(guardSupplier)},'مورد حارس الحذف فقط');`);
  await rpc(`record_supplier_opening_balances_v1(${q(key())},${j([{supplier_id:guardSupplier,direction:'payable',amount_in_minor_units:100000,original_balance_date:'2020-01-01'}])})`);
  const outgoing=await rpc(`issue_supplier_cheque_v1(${q(guardSupplier)},${q(branch)},'بنك حارس الحذف','GUARD-OUT',CURRENT_DATE+2,100000,NULL,${q(key())})`);
  assert.equal((await supplierBalance(guardSupplier)).evidence,0);
  await rejectedDelete('suppliers',guardSupplier,'لا يمكن حذف المورد.*الشيك رقم');
  await rpc(`set_supplier_active(${q(guardSupplier)},false)`);
  const outgoingPage=await rpc(`get_deferred_cheques_page()`);
  assert.ok(outgoingPage.items.some(c=>c.id===outgoing.cheque.id),'inactive supplier cheque stays visible');
  await rpc(`set_supplier_active(${q(guardSupplier)},true)`);
  await rpc(`clear_deferred_cheque_v1(${q(outgoing.cheque.id)},1,${q(key())})`);
  // A paid supplier still has immutable documents: historical FK retention
  // remains. A genuinely empty zero-balance supplier can be physically deleted.
  await rejectedDelete('suppliers',guardSupplier,'violates foreign key constraint');
  await sql(`INSERT INTO suppliers(id,company_name) VALUES(${q(id(328))},'مورد فارغ'),(${q(id(329))},'مورد دائن'),(${q(id(330))},'مورد تجيير');`);
  await sql(`DELETE FROM suppliers WHERE id=${q(id(328))};`);
  await rpc(`record_supplier_opening_balances_v1(${q(key())},${j([{supplier_id:id(329),direction:'advance',amount_in_minor_units:5000,original_balance_date:'2020-01-01'},
    {supplier_id:id(330),direction:'payable',amount_in_minor_units:100000,original_balance_date:'2020-01-01'}])})`);
  await rejectedDelete('suppliers',id(329),'لا يمكن حذف المورد.*-5.000');
  await rejectedDelete('suppliers',id(330),'لا يمكن حذف المورد.*100.000');
  record('supplier zero pending outgoing blocks delete;cleared keeps historicalFKs;empty supplier removable;positive and negative opening balances protected');

  await sale(id(413));const endorsed=await receive(id(413),100000);
  await rpc(`endorse_customer_cheque_v1(${q(endorsed.cheque.id)},${q(id(330))},1,${q(key())})`);
  assert.equal(await balance(id(413)),0);assert.equal((await supplierBalance(id(330))).evidence,0);
  await refused(`set_customer_status(${q(id(413))},'delete')`,/الشيك رقم.*مُجيّر/u);
  await rejectedDelete('suppliers',id(330),'الشيك رقم.*مُجيّر');
  // Independent sessions: deletion and return share the customer gate; supplier
  // row locks precede cheque locks. Whichever gets there first, deletion fails.
  const raced=await Promise.allSettled([
    rpc(`set_customer_status(${q(id(413))},'delete')`),
    rpc(`return_deferred_cheque_v1(${q(endorsed.cheque.id)},2,'رجوع متزامن مع محاولة الحذف',${q(key())})`),
  ]);
  assert.equal(raced[0].status,'rejected');assert.equal(raced[1].status,'fulfilled');
  assert.equal(await balance(id(413)),100000);assert.equal((await supplierBalance(id(330))).evidence,100000);
  assert.equal(await sql(`SELECT is_deleted FROM customers WHERE id=${q(id(413))};`),'f');
  await rejectedDelete('suppliers',id(330),'لا يمكن حذف المورد.*100.000');
  record('endorsed zero balances protect both parties;concurrent customer delete/return refuses delete and atomically restores both100000');
}
