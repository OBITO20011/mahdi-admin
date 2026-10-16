import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {futureMigrationViolations} from '../scripts/testing/maintenance-db-contract.mjs';
import {readCustomerStatement} from '../src/utils/customerStatement';
import {readCustomerDebtAging} from '../src/utils/customerDebtAging';
import {isNavigationItemVisible,ADMIN_NAVIGATION_GROUPS} from '../src/features/more/adminNavigation.config';
const read=(file:string)=>readFileSync(file,'utf8').replaceAll('\r\n','\n');
const files=readdirSync('supabase/migrations').filter(f=>/^19[0-5]_/u.test(f));
const lifecycle=read('supabase/migrations/193_deferred_cheque_lifecycle.sql');

test('supplier claim reversal is narrow, owner-only,5..500, durable and does not broaden133',()=>{
  const body=lifecycle.split('CREATE FUNCTION public.reverse_supplier_cheque_claim_payment_v1(')[1]!.split('ALTER FUNCTION')[0]!;
  assert.match(body,/assert_reversal_owner/u);
  assert.match(body,/char_length\(v_reason\) NOT BETWEEN 5 AND 500/u);
  assert.match(body,/supplier_cheque_claim_reversals WHERE requested_by=v_actor AND idempotency_key=v_key/u);
  assert.match(body,/v_existing.reason IS DISTINCT FROM v_reason/u);
  assert.match(body,/v_shift.status<>'open'/u);
  assert.match(body,/v_payment.supplier_receipt_id IS NOT NULL OR v_payment.purchase_order_id IS NOT NULL/u);
  assert.match(body,/EXISTS\(SELECT 1 FROM public.deferred_cheques WHERE supplier_payment_id=p_supplier_payment_id\)/u);
  assert.match(body,/UPDATE public.suppliers SET current_balance_in_minor_units=current_balance_in_minor_units\+v_payment.amount_in_minor_units/u);
  assert.doesNotMatch(body,/reverse_supplier_payment\(|UPDATE public\.(?:orders|sales_return_events|purchase_orders|supplier_receipts)/u);
  assert.doesNotMatch(lifecycle,/CREATE OR REPLACE FUNCTION public\.(?:_reverse_supplier_payment_before_phase4_lock|reverse_supplier_payment)\(/u);
  assert.match(lifecycle,/CHEQUE_CLAIM_REVERSAL_EVIDENCE_MISMATCH/u);
  const foundation=read('supabase/migrations/190_deferred_cheques_evidence.sql');
  assert.match(foundation,/ALTER TABLE public.supplier_cheque_claim_reversals ENABLE ROW LEVEL SECURITY/u);
  assert.match(foundation,/trg_supplier_cheque_claim_reversals_immutable/u);
});

test('supplier check/cheque require private same-transaction registration; every other133 writer byte is unchanged',()=>{
  const definition=(source:string)=>source.split('CREATE OR REPLACE FUNCTION public.record_supplier_payment(')[1]!.split('$$;')[0]!+'$$;';
  const old=definition(read('supabase/migrations/133_package_e_supplier_po_financial_consistency.sql'));
  const current=definition(lifecycle);
  const start=current.indexOf("  IF p_payment_method IN ('check','cheque') THEN");
  const end=current.indexOf('  -- Serialize equal retries',start);
  assert.ok(start>0&&end>start);
  const guard=current.slice(start,end);
  assert.match(guard,/ARRAY\['owner','manager'\]/u);
  assert.match(guard,/k\.registered_by=v_user_id AND k\.registration_txid=txid_current\(\)/u);
  assert.match(guard,/c\.status='pending' AND c\.supplier_payment_id IS NULL/u);
  assert.match(guard,/c\.amount_in_minor_units=p_amount_in_minor_units/u);
  assert.match(guard,/v_key='cheque-supplier-'\|\|c\.id::TEXT/u);
  assert.match(guard,/CHEQUE_REGISTRATION_REQUIRED/u);
  assert.doesNotMatch(guard,/current_setting|set_config/u);
  assert.equal(current.slice(0,start)+current.slice(end),old);
  const keys=read('supabase/migrations/190_deferred_cheques_evidence.sql');
  assert.match(keys,/registered_by UUID NOT NULL DEFAULT auth\.uid\(\)/u);
  assert.match(keys,/registration_txid BIGINT NOT NULL DEFAULT txid_current\(\)/u);
  assert.match(lifecycle,/record_supplier_payment\(p_supplier_id,p_purchase_order_id,v_c\.amount_in_minor_units/u);
  assert.match(lifecycle,/cheque_supplier_plan_internal\(p_supplier_id,p_amount_in_minor_units,p_claim_id,p_purchase_order_id,p_opening_only\)/u);
  assert.match(lifecycle,/p\.purchase_order_id IS NOT DISTINCT FROM\(SELECT \(e\.request_identity->>'purchaseOrder'\)::UUID/u);
  assert.match(lifecycle,/e\.kind='issued' AND e\.version=1/u);
  assert.match(lifecycle,/CREATE TRIGGER trg_cheque_supplier_payment_registration BEFORE INSERT ON public\.supplier_payments/u);
  assert.match(lifecycle,/FROM principals p WHERE NOT p_opening_only OR p\.kind='opening'/u);
  assert.match(lifecycle,/a\.origin_kind='opening'/u);
});
test('cheques190195 contain explicit definitions only and no historical function patching',()=>{
  assert.equal(files.length,6);
  for(const name of files)assert.deepEqual(futureMigrationViolations(read('supabase/migrations/'+name)),[],name);
  for(const name of ['190_deferred_cheques_evidence.sql','193_deferred_cheque_lifecycle.sql']){
    const source=read('supabase/migrations/'+name);assert.match(source,/OWNER TO postgres/u);assert.match(source,/search_path=public,pg_temp/u);
  }
});
test('party deletion is guarded in DB by canonical balances and open cheques without changing inactive visibility or ACL',()=>{
  const source=read('supabase/migrations/195_deferred_cheque_readers_and_alerts.sql');
  assert.match(source,/CREATE TRIGGER trg_cheque_guard_customer_deletion BEFORE DELETE OR UPDATE OF is_deleted/u);
  assert.match(source,/v_balance:=public\.phase42_customer_receivable_total_internal\(OLD\.id\)/u);
  assert.match(source,/IF v_balance>0 THEN/u);
  assert.match(source,/status IN \('pending','endorsed'\)/u);
  assert.match(source,/CREATE TRIGGER trg_cheque_guard_supplier_deletion BEFORE DELETE ON public\.suppliers/u);
  assert.match(source,/phase133_supplier_balance_evidence_internal\(\) WHERE supplier_id=OLD\.id/u);
  assert.match(source,/IF v_balance<>0 THEN/u);
  assert.match(source,/endorsed_supplier_id=OLD\.id AND status='endorsed'/u);
  const status=source.split('CREATE OR REPLACE FUNCTION public.set_customer_status(')[1]!;
  assert.match(status,/ARRAY\['owner','admin','manager','sales'\]/u);
  assert.match(status,/go-live-collection-customer:/u);
  assert.doesNotMatch(status,/GRANT/u);
});
test('return and erroneous cancellation both create immutable independent claims, never reverse original money/stock',()=>{
  const body=lifecycle.split('CREATE FUNCTION public.cheque_compensate_internal(')[1]!.split('ALTER FUNCTION public.cheque_compensate_internal(')[0]!;
  assert.match(body,/INSERT INTO public\.cheque_compensation_claims/u);
  assert.match(body,/a\.amount_in_minor_units,a\.original_debt_at,a\.origin_kind/u);
  assert.match(body,/p_kind='cancelled'.*ARRAY\['owner'\]/u);
  assert.match(body,/p_kind='returned'.*ARRAY\['owner','manager'\]/u);
  assert.match(body,/p_kind='cancelled' AND v_c\.status<>'pending'/u);
  assert.match(body,/CASE WHEN p_kind='cancelled' THEN 'إلغاء تسجيل شيك رقم ' ELSE 'شيك راجع رقم '/u);
  assert.doesNotMatch(body,/(?:UPDATE|DELETE FROM|INSERT INTO) public\.(?:orders|order_items|customer_payments|supplier_payments|sales_return_events|inventory_balances|inventory_movements|deferred_cheque_allocations)/u);
  assert.doesNotMatch(body,/reverse_customer|reverse_supplier|set_config/u);
  const alerts=read('supabase/migrations/195_deferred_cheque_readers_and_alerts.sql');
  assert.match(alerts,/IF NEW\.kind='returned' THEN/u);
  assert.match(alerts,/'cheque-returned:'\|\|v_c\.id::TEXT/u);
});
test('incoming still uses163 single coordinator and payment path, cashier only in registered cheque context',()=>{
  assert.match(lifecycle,/v_result:=public\.collect_customer_balance_v1\(p_customer_id,p_amount_in_minor_units,'cheque'/u);
  const c=read('supabase/migrations/191_cheque_unified_customer_collection.sql');
  assert.match(c,/registration_txid=txid_current\(\)/u);
  assert.match(c,/v_payment:=public\.record_customer_order_payment_once/u);
  assert.match(c,/CHEQUE_REQUIRES_UNIFIED_COLLECTION/u);
  assert.match(c,/compensation_amount_in_minor_units',v_comp/u);
  assert.match(c,/cheque_customer_claim_lane_internal\(c\.id\)/u);
});
test('statement accepts explicit null order identity for opening/cheque movements without weakening amount/chronology validation',()=>{
  const page={customer_id:'customer',page:1,page_size:25,total_count:1,has_more:false,
    closing_balance_in_minor_units:100000,page_opening_balance_in_minor_units:0,page_closing_balance_in_minor_units:100000,
    outstanding_cheques_in_minor_units:50000,has_returned_cheque:false,movements:[{
      movement_id:'cheque_claim:1',movement_type:'cheque_cancellation_compensation',type_label:'إلغاء تسجيل شيك',order_id:null,
      reference:'إلغاء تسجيل شيك رقم 001',occurred_at:'2026-10-16T12:00:00Z',date_label:null,
      debit_in_minor_units:100000,credit_in_minor_units:0,balance_in_minor_units:100000,sequence:1,
      original_debt_at:null,reason:'تسجيل خاطئ',
    }]};
  assert.deepEqual(readCustomerStatement(page),page);
  for(const patch of [{order_id:1},{order_id:undefined},{balance_in_minor_units:999},{reason:1},{original_debt_at:'invalid'},
    {debit_in_minor_units:'100000'},{sequence:0}])assert.equal(readCustomerStatement({...page,movements:[{...page.movements[0],...patch}]}),null);
  for(const patch of [{outstanding_cheques_in_minor_units:-1},{outstanding_cheques_in_minor_units:'50000'},{has_returned_cheque:'false'}])
    assert.equal(readCustomerStatement({...page,...patch}),null);
  const age={total_in_minor_units:100000,days_0_7_in_minor_units:0,days_8_30_in_minor_units:0,days_over_30_in_minor_units:0,age_unavailable_in_minor_units:100000,
    outstanding_cheques_in_minor_units:0,has_returned_cheque:false};
  assert.deepEqual(readCustomerDebtAging(age),age);
  assert.equal(readCustomerDebtAging({...age,has_returned_cheque:'false'}),null);
});
test('cheque page and supplier issue restricted to owner/manager; incoming explicitly includes cashier/sales',()=>{
  const item=ADMIN_NAVIGATION_GROUPS.flatMap(g=>g.items).find(i=>i.id==='finance-cheques');assert.ok(item);
  for(const role of ['owner','manager'])assert.equal(isNavigationItemVisible(item,role),true);
  for(const role of ['admin','cashier','sales','accountant',null])assert.equal(isNavigationItemVisible(item,role),false);
  assert.match(lifecycle,/ARRAY\['owner','admin','manager','accountant','cashier','sales'\]/u);
  assert.match(lifecycle,/ARRAY\['owner','manager'\],'إصدار شيك مورد'/u);
  assert.match(lifecycle,/p_amount>v_balance/u);
});
test('standalone supplier claim and cash summary account evidence once; old opening-specific fields preserve meaning',()=>{
  assert.match(lifecycle,/VALUES\(v_claim\.party_id,NULL,p_amount_in_minor_units/u);
  assert.match(lifecycle,/p_amount_in_minor_units>v_outstanding/u);
  const s=read('supabase/migrations/194_cheque_shift_and_integrity.sql');
  assert.match(s,/SUM\(amount\) FILTER\(WHERE kind='supplier_payment' AND payment_method='cash'\)/u);
  assert.match(s,/'openingDebtCashReceiptsInMinorUnits', v_cash_opening_receipts-\(v_comp->>'cashReceiptsInMinorUnits'\)/u);
  assert.match(s,/chequeCompensationSettlements/u);assert.match(s,/integrity:accounting:deferred-cheques/u);
  assert.match(s,/v_snapshot:=v_snapshot\|\|jsonb_build_object\('chequeCompensationSettlements'/u);
});

test('existing alert templates render cheque reminders/bounce explicitly, never low-stock fallback',()=>{
  const workflows: {nodes:{id:string;parameters:Record<string,unknown>}[]}[]=JSON.parse(read('automation/n8n/workflows/nawasrah-alerts.json'));
  let checked=0;
  for(const workflow of workflows)for(const node of workflow.nodes)for(const value of Object.values(node.parameters)){
    if(typeof value!=='string'||!value.includes("const money ="))continue;
    checked++;const expression=value.slice(3,-2);
    const render=(eventType:string,payload:Record<string,unknown>)=>String(runInNewContext(expression,{$json:{eventType,payload,entityId:'cheque-id'}},{timeout:1000}));
    for(const direction of ['incoming','outgoing']){
      const text=render('cheque_due',{direction,trackingNumber:'CHQ-001',dueDate:'2026-10-18',amountInMinorUnits:1001});
      assert.match(text,/CHQ-001/u);assert.match(text,/1\.001/u);assert.match(text,/2026-10-18/u);
      assert.match(text,direction==='incoming'?/إيداع/u:/كفاية الرصيد/u);assert.doesNotMatch(text,/مخزون/u);
    }
    const bounced=render('cheque_returned',{endorsed:true,trackingNumber:'CHQ-002',amountInMinorUnits:100000});
    assert.match(bounced,/للمالك/u);assert.match(bounced,/دين العميل وذمة المورد معاً/u);assert.match(bounced,/100\.000/u);
    assert.doesNotMatch(bounced,/مخزون/u);assert.match(render('low_stock',{productName:'صنف الاختبار'}),/مخزون منخفض/u);
  }
  assert.equal(checked,2,'both existing channel templates remain valid');
});
