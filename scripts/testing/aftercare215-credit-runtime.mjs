import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {executeInput} from '../operations/build-empty-supabase.mjs';
import {raceAftercare215} from './aftercare215-race.mjs';

export async function verifySupplierCredit215(c, pass) {
  const {q, j, key, sql, json, rpc, fail, stock, money, facts, fingerprint} = c;
  const prepare = (action, payload, uid) => rpc(`preview_supplier_replacement_credit_v1(${q(action)},${j(payload)})`, uid, undefined, undefined, true);
  const command = (action, payload, p, identity = key()) => `settle_supplier_replacement_credit_v1(${q(action)},${j(payload)},${q(identity)},${q(p.previewFingerprint)})`;
  const caseWriter = (action, payload, identity = key()) => `execute_supplier_replacement_v1(${q(action)},${j(payload)},${q(identity)})`;
  const balance = sid => json(`SELECT to_jsonb(current_balance_in_minor_units::TEXT) FROM public.suppliers WHERE id=${q(sid)};`);
  const setup = async ({cost = 500, held = 2} = {}) => {
    const sid = randomUUID(), pid = randomUUID();
    await sql(`INSERT INTO public.suppliers(id,company_name,is_active) VALUES(${q(sid)},'مورد تجربة الخصم',true);
      INSERT INTO public.products(id,sku,name_ar,category_id,unit_id,purchase_unit_id,sale_unit_id,units_per_purchase_unit,units_per_sale_unit,sale_price_in_minor_units,default_sale_price_in_minor_units,cost_price_in_minor_units,wac_cost_in_minor_units_exact,is_active,is_flavor_master)
      SELECT ${q(pid)},${q('CREDIT215-' + pid)},'صنف تجربة الخصم',category_id,unit_id,purchase_unit_id,sale_unit_id,12,12,1000,9000,0,0,true,false FROM public.products WHERE id=${q(c.id(103))};`);
    await c.receive(pid, 100, cost, sid);
    const pending = await rpc(caseWriter('shop_pending', {supplierId: sid, productId: pid, warehouseId: c.warehouse, quantity: held, unit: 'base', reason: 'باكيتات معلّقة عند المورد'}));
    return {sid, pid, caseId: pending.cases[0].id};
  };
  const s = await setup(), payload = {caseId: s.caseId, quantity: 2, reason: 'خصم الباكيتين من حساب المورد'}, before = await facts(), beforeMoney = await money(), beforeStock = await stock(s.pid);
  assert.equal(await balance(s.sid), '50000');
  const stable = await fingerprint(), p = await prepare('credit', payload);
  assert.deepEqual(await fingerprint(), stable);
  assert.equal(p.amountDeltaInMinorUnits, '1000'); assert.equal(p.balanceBeforeInMinorUnits, '50000'); assert.equal(p.balanceAfterInMinorUnits, '49000');
  const call = command('credit', payload, p), result = await rpc(call);
  assert.equal(result.credit.amount_delta_in_minor_units, '1000'); assert.equal(await balance(s.sid), '49000');
  assert.equal(await json(`SELECT to_jsonb(balance::TEXT) FROM public.phase133_supplier_balance_evidence_internal() WHERE supplier_id=${q(s.sid)};`), '49000');
  assert.deepEqual(await stock(s.pid), beforeStock); assert.equal((await facts()).sales.netProfitInMinorUnits, before.sales.netProfitInMinorUnits);
  const afterMoney = await money();
  assert.deepEqual(afterMoney, {...beforeMoney, suppliers: beforeMoney.suppliers.map(([id, amount]) => [id, id === s.sid ? amount - 1000 : amount])});
  const page = await rpc(`get_supplier_replacement_credits_v1(${q(s.sid)},1,25)`);
  assert.equal(page.totalCount, 1); assert.equal(page.rows[0].amount_delta_in_minor_units, '1000');
  const saved = await fingerprint(); assert.deepEqual(await rpc(call), {...result, idempotentReplay: true}); assert.deepEqual(await fingerprint(), saved);
  await fail(caseWriter('receive', {caseId: s.caseId, quantity: 1, reason: 'استلام بعد خصم كامل'}), /EXCEEDS_PENDING/);
  await fail(caseWriter('writeoff', {caseId: s.caseId, quantity: 1, reason: 'رفض بعد خصم كامل'}), /EXCEEDS_PENDING/);
  await fail(caseWriter('reverse', {eventId: result.credit.event_id, reason: 'عكس قديم لا يجوز فصل الذمة'}), /USE_CREDIT_REVERSAL/);
  pass('held1000 becomes actual supplier payable50000 to49000; no stock/cash/payment/profit change; explicit statement; replay and receive/refusal/old-inverse guards');

  const reversePayload = {eventId: result.credit.event_id, reason: 'عكس خصم المورد بمساره المؤيد'}, rp = await prepare('reverse_credit', reversePayload);
  const reverseCall = command('reverse_credit', reversePayload, rp), reversed = await rpc(reverseCall);
  assert.equal(reversed.credit.amount_delta_in_minor_units, '-1000'); assert.equal(await balance(s.sid), '50000');
  assert.equal(await sql(`SELECT sum(held_delta) FROM public.supplier_replacement_events WHERE case_id=${q(s.caseId)};`), '2');
  assert.deepEqual(await stock(s.pid), beforeStock); assert.equal((await facts()).sales.netProfitInMinorUnits, before.sales.netProfitInMinorUnits);
  const reversedState = await fingerprint(); await rpc(reverseCall); assert.deepEqual(await fingerprint(), reversedState);
  await fail(`preview_supplier_replacement_credit_v1('reverse_credit',${j(reversePayload)})`, /ALREADY_REVERSED/);
  pass('paired owner credit inverse restores payable and pending asset together once, without stock/cash/profit; repeated inverse denied/replay immutable');

  const insufficient = await setup();
  await rpc(`record_supplier_payment(p_supplier_id:=${q(insufficient.sid)},p_amount_in_minor_units:=50000,p_payment_method:='bank_transfer',p_reference_number:='TB215-local-test',p_idempotency_key:=${q(key())})`);
  await fail(`preview_supplier_replacement_credit_v1('credit',${j({caseId: insufficient.caseId, quantity: 2, reason: 'لا ذمة مؤيدة كافية'})})`, /EXCEEDS_PAYABLE/);
  pass('supplier credit cannot exceed actual evidenced payable; no fabricated opening balance/payment/expense');

  const partial = await setup(), partialPayload = {caseId: partial.caseId, quantity: 1, reason: 'خصم جزء واحد بالقيمة التاريخية'}, pp = await prepare('credit', partialPayload);
  const pr = await rpc(command('credit', partialPayload, pp)); assert.equal(await balance(partial.sid), '49500');
  await rpc(caseWriter('receive', {caseId: partial.caseId, quantity: 1, reason: 'وصل بديل الباكيت الثاني'}));
  assert.equal((await stock(partial.pid)).quantity, 99); assert.equal(await balance(partial.sid), '49500');
  await fail(`preview_supplier_replacement_credit_v1('reverse_credit',${j({eventId: pr.credit.event_id, reason: 'لا عكس خلف قرار مورد لاحق'})})`, /LATER_DEPENDENCY/);
  pass('partial credit and partial in-kind receipt remain separate; later case decision blocks inverse with no side effect');

  const dependency = await setup(), dp = {caseId: dependency.caseId, quantity: 2, reason: 'خصم مؤيد قبل دفع لاحق'}, dpreview = await prepare('credit', dp);
  const dr = await rpc(command('credit', dp, dpreview));
  await rpc(`record_supplier_payment(p_supplier_id:=${q(dependency.sid)},p_amount_in_minor_units:=1,p_payment_method:='bank_transfer',p_reference_number:='TB215-later-payment',p_idempotency_key:=${q(key())})`);
  await fail(`preview_supplier_replacement_credit_v1('reverse_credit',${j({eventId: dr.credit.event_id, reason: 'لا عكس بعد دفع المورد'})})`, /LATER_DEPENDENCY/);
  pass('later supplier financial membership/payment blocks credit inverse; cached-balance coincidence cannot erase dependency');

  const precise = await setup({cost: 1000.6, held: 3});
  for (const amount of ['1001', '1000', '1001']) {
    const payload = {caseId: precise.caseId, quantity: 1, reason: 'خصم بالقيمة التاريخية الدقيقة'};
    const p = await prepare('credit', payload); assert.equal(p.amountDeltaInMinorUnits, amount);
    await rpc(command('credit', payload, p));
  }
  assert.equal(await balance(precise.sid), '97058');
  assert.equal(await sql(`SELECT sum(amount_delta_in_minor_units) FROM public.supplier215_credits WHERE supplier_id=${q(precise.sid)};`), '3002');
  pass('1000.6 exact historical cost across three partial credits rounds cumulatively1001+1000+1001=3002, not3003');

  const race = raceAftercare215(c);
  for (const other of ['receive', 'writeoff']) for (const creditFirst of [true, false]) {
    const s = await setup(), payload = {caseId: s.caseId, quantity: 2, reason: 'قرار خصم متزامن'}, p = await prepare('credit', payload);
    const creditCall = command('credit', payload, p), otherCall = caseWriter(other, {caseId: s.caseId, quantity: 2, reason: 'قرار مورد متزامن'});
    const loser = await race(creditFirst ? creditCall : otherCall, creditFirst ? otherCall : creditCall);
    assert.notEqual(loser.code, 0); assert.match(loser.stderr, /EXCEEDS_PENDING/);
    assert.equal(await balance(s.sid), creditFirst ? '49000' : '50000');
    assert.equal((await stock(s.pid)).quantity, !creditFirst && other === 'receive' ? 100 : 98);
    assert.equal(await sql(`SELECT count(*) FROM public.supplier215_credits WHERE case_id=${q(s.caseId)};`), creditFirst ? '1' : '0');
    assert.equal(await sql(`SELECT sum(held_delta) FROM public.supplier_replacement_events WHERE case_id=${q(s.caseId)};`), '0');
  }
  pass('two independent sessions credit vs receipt/refusal in both lock orders: one decision wins, loser waits then zero effect, no duplicate liability/stock/loss');

  const rollback = await setup(), rollbackPayload = {caseId: rollback.caseId, quantity: 2, reason: 'فشل محقون بعد قيد الخصم'}, rollbackPreview = await prepare('credit', rollbackPayload);
  await sql(`CREATE FUNCTION public.tb215_credit_failure() RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public,pg_temp AS $$ BEGIN IF NEW.id=${q(rollback.sid)}::UUID THEN RAISE EXCEPTION 'TB215_CREDIT_INJECTED_FAILURE'; END IF; RETURN NEW; END $$;CREATE TRIGGER tb215_credit_failure BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.tb215_credit_failure();`);
  try { await fail(command('credit', rollbackPayload, rollbackPreview), /TB215_CREDIT_INJECTED_FAILURE/); }
  finally { await sql('DROP TRIGGER tb215_credit_failure ON public.suppliers;DROP FUNCTION public.tb215_credit_failure();'); }
  assert.equal(await balance(rollback.sid), '50000');
  pass('failure between held-asset ledger and supplier balance rolls every table and every sequence back; no half credit');

  const protectedState = await fingerprint(), tamper = await executeInput(c.executor, `BEGIN;ALTER TABLE public.supplier215_credits DISABLE TRIGGER supplier215_credits_immutable;UPDATE public.supplier215_credits SET financial_membership_sha256=repeat('0',64),amount_delta_in_minor_units=1001,balance_after_in_minor_units=48999 WHERE event_id=${q(result.credit.event_id)};SELECT public.sr208_assert_operation_internal(${q(result.operationId)});ROLLBACK;`);
  assert.notEqual(tamper.code, 0); assert.match(tamper.stderr, /CREDIT_EVIDENCE_INVALID/);
  assert.deepEqual(await fingerprint(), protectedState);
  pass('forged one-fils credit fails independent immutable historical-cost/event proof; transaction leaves all original evidence intact');

  const roles = await setup(), rolePayload = {caseId: roles.caseId, quantity: 2, reason: 'فحص صلاحية خصم المورد'}, rolesPreview = await prepare('credit', rolePayload);
  for (const n of [0, 1, 2, 3, 4, 5]) {
    const uid = c.id(215100 + n);
    await fail(`preview_supplier_replacement_credit_v1('credit',${j(rolePayload)})`, /OWNER_ONLY/, uid);
    await fail(command('credit', rolePayload, rolesPreview), /OWNER_ONLY/, uid);
    await fail(`get_supplier_replacement_credits_v1(${q(roles.sid)},1,25)`, /OWNER_ONLY/, uid);
  }
  await fail(command('credit', rolePayload, rolesPreview), /OWNER_ONLY/, c.owner, 'authenticated', 'aal1');
  for (const role of ['anon', 'service_role']) await fail(command('credit', rolePayload, rolesPreview), /permission denied/, c.owner, role);
  await fail(`tb215_credit_plan_internal('credit',${j(rolePayload)})`, /permission denied/);
  pass('credit preview/write/ledger owner-only before replay; enrolled AAL1, staff, no-role, anon/service role/private helper all denied without writes');
}
