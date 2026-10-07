import assert from 'node:assert/strict';
import {execFile, spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {assertPackageDDbLint} from './package-d-db-lint-policy.mjs';

const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname,'../..');
const cli = path.join(root,'node_modules/supabase/dist/supabase.js');
const owner='92600000-0000-4000-8000-000000000001',branch='92600000-0000-4000-8000-000000000200';
const warehouse='92600000-0000-4000-8000-000000000201';
const q = value => value === null ? 'NULL' : `'${String(value).replaceAll("'","''")}'`;
const j = value => `${q(JSON.stringify(value))}::jsonb`;
const asOwner = text => `BEGIN;SELECT set_config('request.jwt.claims',
  ${q(JSON.stringify({sub:owner,role:'authenticated',aal:'aal2'}))},true);SET LOCAL ROLE authenticated;${text} COMMIT;`;
const modes=[];
const selectedModes=process.argv.includes('--after-only')?['after']:
  process.argv.includes('--before-only')?['before']:['before','after'];
let workdir,container,label='bootstrap';
const sql = text => new Promise((resolve,reject) => {
  const child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-q','-At','-v','ON_ERROR_STOP=1'],
    {cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',chunk=>{out+=chunk;});child.stderr.on('data',chunk=>{err+=chunk;});
  child.on('error',reject);child.on('close',code=>code===0?resolve(out.trim()):reject(Error(`${label}: ${err}`)));
  child.stdin.end(`SET statement_timeout='60s';SET lock_timeout='30s';\n${text}`);
});
const json=async text=>JSON.parse((await sql(text)).split(/\r?\n/u).filter(Boolean).at(-1));
const rpc=command=>json(asOwner(`SELECT public.${command};`));
const fingerprint=()=>json(`SELECT jsonb_build_object(${['suppliers','supplier_payments','supplier_payment_reversals','supplier_receipts',
  'purchase_orders','purchase_order_items','purchase_receipts','purchase_receipt_items','business_operations','products','inventory_balances',
  'inventory_movements','phase2_receipt_wac_snapshots','audit_logs','cash_shifts','cash_shift_reversals','cash_shift_reversal_operations'].map(table=>`${q(table)},
    (SELECT md5(COALESCE(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)::text),'')) FROM public.${table} t)`).join(',')});`);
const line=(product,quantity,poItem=null)=>({client_line_id:randomUUID(),purchase_order_item_id:poItem,line_kind:'base_unit',
  commercial_quantity:quantity,base_unit_name:'باكيت',gross_amount_in_minor_units:quantity*6000,line_discount_in_minor_units:0,
  components:[{product_id:product,base_quantity:quantity}]});

async function fixture(name,quantity=10) {
  label=name;const supplier=randomUUID(),product=randomUUID();
  await sql(`INSERT INTO suppliers(id,company_name,is_active) VALUES(${q(supplier)},${q(name)},true);
    INSERT INTO products(id,sku,name_ar,category_id,unit_id,purchase_unit_id,sale_unit_id,units_per_purchase_unit,units_per_sale_unit,
      default_purchase_price_in_minor_units,default_sale_price_in_minor_units,cost_price_in_minor_units,sale_price_in_minor_units,
      wholesale_price_in_minor_units,min_stock_level,is_active,is_flavor_master,wac_cost_in_minor_units_exact)
    SELECT ${q(product)},${q(`E133-${product}`)},${q(name)},category_id,unit_id,purchase_unit_id,sale_unit_id,1,1,
      0,10000,0,10000,10000,0,true,false,0 FROM products WHERE id='92600000-0000-4000-8000-000000000103';`);
  const po=await rpc(`create_purchase_order_v2(p_supplier_id:=${q(supplier)},p_branch_id:=${q(branch)},p_warehouse_id:=${q(warehouse)},
    p_idempotency_key:=${q(`e133-po-${randomUUID()}`)},p_lines:=${j([line(product,quantity)])})`);
  await rpc(`update_purchase_order_status(${q(po.purchase_order_id)},'sent')`);
  await rpc(`update_purchase_order_status(${q(po.purchase_order_id)},'approved')`);
  const item=await json(`SELECT to_jsonb(id) FROM purchase_order_items WHERE purchase_order_id=${q(po.purchase_order_id)};`);
  return {supplier,product,po:po.purchase_order_id,item};
}

function receiving(f,quantity=10,paid=0) {
  return `receive_purchase_order_v2(p_purchase_order_id:=${q(f.po)},p_warehouse_id:=${q(warehouse)},
    p_idempotency_key:=${q(`e133-receive-${randomUUID()}`)},p_amount_paid_at_receipt_in_minor_units:=${paid},
    p_payment_method:=${q(paid?'cash':'deferred')},p_lines:=${j([line(f.product,quantity,f.item)])})`;
}
function payment(f,amount) {
  return `record_supplier_payment(p_supplier_id:=${q(f.supplier)},p_purchase_order_id:=${q(f.po)},
    p_amount_in_minor_units:=${amount},p_payment_method:='cash',p_idempotency_key:=${q(`e133-pay-${randomUUID()}`)})`;
}
const balance=f=>json(`SELECT to_jsonb(current_balance_in_minor_units) FROM suppliers WHERE id=${q(f.supplier)};`);
const poPaid=f=>json(`SELECT to_jsonb(amount_paid_in_minor_units) FROM purchase_orders WHERE id=${q(f.po)};`);
const productCommercialFields=f=>json(`SELECT to_jsonb(p)-ARRAY['cost_price_in_minor_units','wac_cost_in_minor_units_exact','updated_at']
  FROM products p WHERE id=${q(f.product)};`);
const reverse=id=>`reverse_supplier_payment(${q(id)},'عكس دفعة الاختبار',${q(`e133-reverse-${randomUUID()}`)})`;
async function zeroWriteReplay(command) {
  const before=await fingerprint();const result=await rpc(command);assert.equal(result.success,true);
  assert.deepEqual(await fingerprint(),before,'Replay must preserve all durable content and audit timestamps');return result;
}
async function rejectedZeroWrite(command,pattern) {
  const before=await fingerprint();await assert.rejects(rpc(command),pattern);
  assert.deepEqual(await fingerprint(),before,'Rejected call must leave zero partial financial/inventory effects');
}

// Create historical evidence through the real V1 entrypoints while132 still
// permits them, then apply133 to prove the migration-time repair, not a mock.
async function historicalPoPolicy() {
  const cases=[];
  for(const [name,quantity,cost,payable,review] of [
    ['full matching discount and freight',10,1000,7500,false],
    ['partial discount and freight',5,1000,5000,true],
    ['full changed receipt price',10,1200,12000,true],
  ]){
    label=name;
    const supplier=randomUUID(),product='92600000-0000-4000-8000-000000000103';
    await sql(`INSERT INTO suppliers(id,company_name,is_active) VALUES(${q(supplier)},${q(name)},true);`);
    const created=await rpc(`create_purchase_order(p_supplier_id:=${q(supplier)},p_branch_id:=${q(branch)},
      p_warehouse_id:=${q(warehouse)},p_delivery_fee_in_minor_units:=500,p_discount_in_minor_units:=2000,
      p_items:=${j([{product_id:product,ordered_quantity:10,purchase_price_in_minor_units:1000,discount_in_minor_units:1000}])})`);
    const po=created.purchase_order_id;
    assert.equal(created.total_in_minor_units,7500,'Independent line/header discount + freight acceptance arithmetic');
    await rpc(`update_purchase_order_status(${q(po)},'sent')`);
    await rpc(`update_purchase_order_status(${q(po)},'approved')`);
    const item=await json(`SELECT to_jsonb(id) FROM purchase_order_items WHERE purchase_order_id=${q(po)};`);
    await rpc(`receive_purchase_order(${q(po)},${q(warehouse)},NULL,'سند تاريخي مثبت',
      ${j([{purchase_order_item_id:item,product_id:product,received_quantity:quantity,unit_cost_in_minor_units:cost}])})`);
    assert.equal(await balance({supplier}),0,'132 legacy receipt does not update supplier debt');
    const recorded=await json(`SELECT to_jsonb(SUM(i.received_quantity*i.unit_cost_in_minor_units)::bigint)
      FROM purchase_receipt_items i JOIN purchase_receipts r ON r.id=i.purchase_receipt_id WHERE r.purchase_order_id=${q(po)};`);
    assert.equal(recorded,quantity*cost);
    cases.push({name,supplier,po,payable,review,recorded});
  }
  const history=()=>json(`SELECT jsonb_build_object(${['purchase_orders','purchase_order_items','purchase_receipts','purchase_receipt_items',
    'supplier_payments','products','inventory_balances','inventory_movements'].map(table=>`${q(table)},
    (SELECT md5(COALESCE(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)::text),'')) FROM ${table} t)`).join(',')});`);
  const before=await history();
  label='apply133 to actual historical evidence';
  await sql(await readFile(path.join(root,'supabase/migrations/133_package_e_supplier_po_financial_consistency.sql'),'utf8'));
  assert.deepEqual(await history(),before,'Recalculation never rewrites historical receipts, prices, inventory or payments');
  for(const c of cases){
    assert.equal(await balance(c),c.payable,c.name);
    const evidence=await json(`SELECT to_jsonb(e) FROM phase133_legacy_po_payables_internal() e WHERE purchase_order_id=${q(c.po)};`);
    assert.equal(evidence.payable,c.payable);assert.equal(evidence.needs_manual_review,c.review);
    assert.equal(evidence.uses_final_po_total,!c.review);
    assert.equal(evidence.recorded_cost,c.recorded);assert.equal(evidence.potential_difference,7500-c.recorded);
    const audit=await json(`SELECT details FROM audit_logs WHERE action='RECALCULATE_SUPPLIER_BALANCE_133' AND entity_id=${q(c.supplier)};`);
    assert.equal(audit.old_balance_in_minor_units,0);assert.equal(audit.new_balance_in_minor_units,c.payable);
    assert.equal(audit.legacy_po_manual_review.length,c.review?1:0);
    if(c.review){assert.equal(audit.legacy_po_review_status,'يحتاج مراجعة يدوية');
      assert.equal(audit.legacy_po_manual_review[0].potential_difference_in_minor_units,7500-c.recorded);}
  }
  const query=await readFile(path.join(root,'scripts/sql/package-e-legacy-po-review.sql'),'utf8');
  const queryBefore=await fingerprint();
  const reviewOutput=await sql(query);assert.match(reviewOutput,/^2\|2\|-2000$/mu);
  assert.deepEqual(await fingerprint(),queryBefore,'Rehearsal inventory is read-only');
  const matching=cases[0];
  const duplicateBefore=await fingerprint();
  const duplicate=await json(`BEGIN;
    INSERT INTO purchase_receipt_items(id,purchase_receipt_id,purchase_order_item_id,product_id,received_quantity,unit_cost_in_minor_units)
    SELECT gen_random_uuid(),i.purchase_receipt_id,i.purchase_order_item_id,i.product_id,i.received_quantity,i.unit_cost_in_minor_units
      FROM purchase_receipt_items i JOIN purchase_receipts r ON r.id=i.purchase_receipt_id WHERE r.purchase_order_id=${q(matching.po)};
    SELECT to_jsonb(e) FROM phase133_legacy_po_payables_internal() e WHERE purchase_order_id=${q(matching.po)};ROLLBACK;`);
  assert.equal(duplicate.uses_final_po_total,false,'Extra duplicate receipt line cannot prove full matching PO');
  assert.equal(duplicate.needs_manual_review,true);assert.equal(duplicate.payable,20000);
  assert.deepEqual(await fingerprint(),duplicateBefore,'Rollback-only duplicate probe leaves all durable history unchanged');
  return cases.map(({name,payable,review})=>({name,payable,manualReview:review,passed:true}));
}

async function matrix(after) {
  const results=[];
  const check=(name,actual,beforeExpected,afterExpected)=>{assert.equal(actual,after?afterExpected:beforeExpected,name);
    results.push({name,actual,expected:after?afterExpected:beforeExpected});};

  const post=await fixture('post-receipt payment');
  const postProductBefore=await productCommercialFields(post);
  const postReceive=receiving(post);await rpc(postReceive);
  assert.deepEqual(await productCommercialFields(post),postProductBefore,'PO V2 cannot change selling prices or any product-default field');
  assert.equal(await json(`SELECT to_jsonb(wac_cost_in_minor_units_exact) FROM products WHERE id=${q(post.product)};`),6000);
  results.push({name:'PO V2 real receipt updates WAC only; all commercial/default fields unchanged',passed:true});
  check('PO receipt gross added once',await balance(post),60000,60000);
  const postPayment=payment(post,5000);const paid=await rpc(postPayment);
  check('PO payment reduces balance',await balance(post),60000,55000);
  await zeroWriteReplay(postPayment);await zeroWriteReplay(postReceive);
  const rev=reverse(paid.payment_id);const reversed=await rpc(rev);
  check('PO reversal returns balance',await balance(post),60000,60000);
  check('PO reversal durable restored amount',reversed.actual_effect.supplier_balance_restored_in_minor_units,0,5000);
  await zeroWriteReplay(rev);

  const advance=await fixture('advance and partial receiving');
  const advanceCommand=payment(advance,20000);const advancePayment=await rpc(advanceCommand);
  check('advance supplier credit',await balance(advance),0,-20000);await zeroWriteReplay(advanceCommand);
  const first=receiving(advance,4);
  if(after){await rpc(first);check('first partial receiving consumes advance once',await balance(advance),null,4000);
    await zeroWriteReplay(first);await rpc(receiving(advance,6));
    check('second partial receiving does not subtract advance again',await balance(advance),null,40000);
  }else await rejectedZeroWrite(first,/AMBIGUOUS_PREPAID_PO/u);
  const advanceReversal=reverse(advancePayment.payment_id);await rpc(advanceReversal);
  check('advance reversal restores only actual payment',await balance(advance),0,60000);await zeroWriteReplay(advanceReversal);

  const fullyPrepaid=await fixture('full advance');
  await rpc(payment(fullyPrepaid,60000));check('full advance credit',await balance(fullyPrepaid),0,-60000);
  if(after){await rpc(receiving(fullyPrepaid,5));check('full advance first receipt',await balance(fullyPrepaid),null,-30000);
    await rpc(receiving(fullyPrepaid,5));check('full advance second receipt',await balance(fullyPrepaid),null,0);
  }else await rejectedZeroWrite(receiving(fullyPrepaid,5),/AMBIGUOUS_PREPAID_PO/u);

  const partial=await fixture('partial receipt then payment');
  await rpc(receiving(partial,4));await rpc(payment(partial,5000));
  check('partial receipt payment',await balance(partial),24000,19000);
  if(after){await rpc(receiving(partial,6));check('later partial receiving with committed payment',await balance(partial),null,55000);}
  else await rejectedZeroWrite(receiving(partial,6),/AMBIGUOUS_PREPAID_PO/u);

  const atReceipt=await fixture('payment at receiving');
  const atCommand=receiving(atReceipt,10,5000);const atResult=await rpc(atCommand);
  check('receiving-time payment not counted twice',await balance(atReceipt),55000,55000);
  check('receiving-time payment reflected in PO paid projection',await poPaid(atReceipt),0,5000);
  await zeroWriteReplay(atCommand);
  const atPayment=await json(`SELECT to_jsonb(id) FROM supplier_payments WHERE purchase_receipt_id=${q(atResult.receipt_id)};`);
  const atReverse=reverse(atPayment);
  if(after){await rpc(atReverse);check('receiving-time payment reversal balance',await balance(atReceipt),null,60000);
    check('receiving-time payment reversal PO paid',await poPaid(atReceipt),null,0);await zeroWriteReplay(atReverse);
    const cancelAfterReverse=`cancel_purchase_receipt_v2(${q(atResult.receipt_id)},'إلغاء بعد عكس الدفعة')`;
    await rpc(cancelAfterReverse);check('cancel after reversal removes full payable',await balance(atReceipt),null,0);
    await zeroWriteReplay(cancelAfterReverse);
  }else await rejectedZeroWrite(atReverse,/رصيد دفعات أمر الشراء/u);

  const cancelPaid=await fixture('cancel receipt with attached immediate payment');
  const cancelResult=await rpc(receiving(cancelPaid,10,5000));
  const cancelCommand=`cancel_purchase_receipt_v2(${q(cancelResult.receipt_id)},'إلغاء استلام مدفوع')`;
  await rpc(cancelCommand);check('cancel removes receipt and restores owned payment once',await balance(cancelPaid),0,0);
  check('cancel restores PO paid projection',await poPaid(cancelPaid),0,0);
  check('cancel marks immediate payment reversed',await json(`SELECT to_jsonb(is_reversed) FROM supplier_payments WHERE purchase_receipt_id=${q(cancelResult.receipt_id)};`),true,true);
  if(after)await zeroWriteReplay(cancelCommand);
  else await rejectedZeroWrite(cancelCommand,/ملغى أو معكوس/u);

  const cancelUnallocated=await fixture('cancel with PO-wide payment');
  const unallocatedReceipt=await rpc(receiving(cancelUnallocated));await rpc(payment(cancelUnallocated,5000));
  const unallocatedCancel=`cancel_purchase_receipt_v2(${q(unallocatedReceipt.receipt_id)},'إلغاء مع مقدم باق')`;
  await rpc(unallocatedCancel);check('PO-wide payment remains supplier advance after cancellation',await balance(cancelUnallocated),0,-5000);
  check('PO-wide payment remains active evidence',await json(`SELECT to_jsonb(COALESCE(SUM(amount_in_minor_units),0)::bigint) FROM supplier_payments
    WHERE supplier_id=${q(cancelUnallocated.supplier)} AND NOT is_reversed;`),5000,5000);
  if(after)await zeroWriteReplay(unallocatedCancel);

  const mixed=await fixture('direct and PO with supplier advance');
  await rpc(payment(mixed,60000));
  const directProductBefore=await productCommercialFields(mixed);
  const direct=await rpc(`create_direct_supplier_receipt_v2(p_supplier_id:=${q(mixed.supplier)},p_branch_id:=${q(branch)},
    p_warehouse_id:=${q(warehouse)},p_idempotency_key:=${q(`e133-direct-${randomUUID()}`)},p_lines:=${j([line(mixed.product,2)])})`);
  assert.deepEqual(await productCommercialFields(mixed),directProductBefore,'Direct V2 cannot change selling prices or any product-default field');
  assert.equal(await json(`SELECT to_jsonb(wac_cost_in_minor_units_exact) FROM products WHERE id=${q(mixed.product)};`),6000);
  results.push({name:'Direct V2 real receipt updates WAC only; all commercial/default fields unchanged',passed:true});
  check('direct receipt and PO advance coexist',await balance(mixed),12000,-48000);
  const directPaymentCommand=`record_supplier_receipt_payment(${q(direct.receipt_id)},5000,'cash',NULL,'دفعة مختلطة',${q(`e133-directpay-${randomUUID()}`)})`;
  await rpc(directPaymentCommand);check('direct payment preserves PO advance without clamping',await balance(mixed),7000,-53000);
  await zeroWriteReplay(directPaymentCommand);
  const directPayment=await json(`SELECT to_jsonb(id) FROM supplier_payments WHERE supplier_receipt_id=${q(direct.receipt_id)};`);
  const directReverse=reverse(directPayment);await rpc(directReverse);
  check('direct reversal preserves combined signed supplier balance',await balance(mixed),12000,-48000);
  await zeroWriteReplay(directReverse);
  if(after){
    await rpc(`record_supplier_receipt_payment(${q(direct.receipt_id)},2000,'cash',NULL,'دفعة لاحقة',${q(randomUUID())})`);
    const directCancel=`cancel_supplier_receipt(${q(direct.receipt_id)},'إلغاء سند برصيد مورد مقدّم')`;
    const cancelled=await rpc(directCancel);
    assert.equal(cancelled.payments_marked_reversed_in_minor_units,2000,'Do not restore already reversed5000 twice');
    check('Direct cancel removes full payable, restores only active payment, preserves PO advance',await balance(mixed),null,-60000);
    await zeroWriteReplay(directCancel);
    await rejectedZeroWrite(payment(mixed,1),/SUPPLIER_PO_PAYMENT_EXCEEDS_PAYABLE/u);
    const capped=await fixture('advance plus receiving payment cap');
    await rpc(payment(capped,59000));
    await rejectedZeroWrite(receiving(capped,10,2000),/SUPPLIER_PO_PAYMENT_EXCEEDS_PAYABLE/u);
    check('receiving cap rejection preserves supplier advance',await balance(capped),null,-59000);
  }

  const legacy=await fixture('explicit legacy receipt evidence');
  const legacyCommand=`receive_purchase_order(${q(legacy.po)},${q(warehouse)},NULL,'استلام فعلي',
    ${j([{purchase_order_item_id:legacy.item,product_id:legacy.product,received_quantity:10,unit_cost_in_minor_units:6000}])})`;
  if(after){await rejectedZeroWrite(legacyCommand,/RECEIVING_V1_READ_ONLY/u);
    check('legacy PO creation blocked before every write',await balance(legacy),null,0);
  }else{await rpc(legacyCommand);check('historical legacy PO receipt baseline',await balance(legacy),0,null);}

  if(after){
    label='concurrent same-key payment';
    const concurrent=await fixture(label);await rpc(receiving(concurrent));
    const deadlocksBefore=await json("SELECT to_jsonb(deadlocks) FROM pg_stat_database WHERE datname='postgres';");
    const sameKey=payment(concurrent,5000);
    const same=await Promise.all([rpc(sameKey),rpc(sameKey)]);
    assert.equal(same[0].payment_id,same[1].payment_id);
    check('concurrent same-key one payment',await balance(concurrent),null,55000);
    check('concurrent same-key one row',await json(`SELECT to_jsonb(COUNT(*)::int) FROM supplier_payments WHERE supplier_id=${q(concurrent.supplier)};`),null,1);
    await Promise.all([rpc(payment(concurrent,5000)),rpc(payment(concurrent,6000))]);
    check('concurrent different-key independent payments',await balance(concurrent),null,44000);
    const deadlocksAfter=await json("SELECT to_jsonb(deadlocks) FROM pg_stat_database WHERE datname='postgres';");
    check('payment concurrency deadlockDelta',deadlocksAfter-deadlocksBefore,null,0);

    label='reversal/cancellation race';
    const racing=await fixture(label);const raceReceipt=await rpc(receiving(racing,10,5000));
    const racePayment=await json(`SELECT to_jsonb(id) FROM supplier_payments WHERE purchase_receipt_id=${q(raceReceipt.receipt_id)};`);
    const race=await Promise.allSettled([rpc(reverse(racePayment)),
      rpc(`cancel_purchase_receipt_v2(${q(raceReceipt.receipt_id)},'إلغاء في سباق مع العكس')`)]);
    assert.equal(race[1].status,'fulfilled','Receipt cancellation is valid before/after payment reversal');
    if(race[0].status==='rejected')assert.match(String(race[0].reason),/لم تعد قابلة للعكس/u);
    check('race balance no duplicated restore',await balance(racing),null,0);
    check('race PO paid projection',await poPaid(racing),null,0);

    label='fault after payment debit';
    const fault=await fixture(label);await rpc(receiving(fault));
    const faultCommand=payment(fault,5000);const faultBefore=await fingerprint();
    await assert.rejects(sql(`BEGIN;
      CREATE FUNCTION public.e133_runtime_abort() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'E133_INJECTED_AFTER_DEBIT'; END; $$;
      CREATE TRIGGER e133_runtime_abort AFTER UPDATE OF idempotency_key ON supplier_payments
        FOR EACH ROW EXECUTE FUNCTION public.e133_runtime_abort();
      SELECT set_config('request.jwt.claims',${q(JSON.stringify({sub:owner,role:'authenticated',aal:'aal2'}))},true);
      SET LOCAL ROLE authenticated; SELECT public.${faultCommand};ROLLBACK;`),/E133_INJECTED_AFTER_DEBIT/u);
    assert.deepEqual(await fingerprint(),faultBefore,'Payment, supplier debit, PO projection, audit and trigger creation all roll back');
    assert.equal(await sql("SELECT to_regprocedure('public.e133_runtime_abort()') IS NULL;"),'t');
    results.push({name:'after-debit rollback restores all durable content',passed:true});

    label='full shift PO payment preview and actual effect';
    const openId=await json(`SELECT to_jsonb(id) FROM cash_shifts WHERE branch_id=${q(branch)} AND status='open';`);
    const summary=await rpc(`get_cash_shift_summary(${q(openId)})`);
    await rpc(`close_cash_shift(${q(openId)},${summary.expectedCashInMinorUnits},NULL)`);
    const fullShift=(await rpc(`open_cash_shift(${q(branch)},100000)`)).id;
    const full=await fixture('PO payment full reversal');
    const fullPayment=await rpc(payment(full,5000));
    const preview=await rpc(`preview_cash_shift_full_reversal(${q(fullShift)})`);
    assert.equal(preview.canExecute,true,'Full reversal uses the supported open-shift lifecycle');
    const effect=preview.operations.find(op=>op.originalRecordId===fullPayment.payment_id);
    assert.ok(effect);assert.equal(effect.expectedEffect.supplier_balance_in_minor_units,5000);
    assert.equal(preview.summary.supplier_balance_in_minor_units,5000);
    const fullCommand=`reverse_cash_shift_with_operations(${q(fullShift)},'عكس وردية دفعة PO',${q(`e133-full-${randomUUID()}`)})`;
    const fullResult=await rpc(fullCommand);assert.equal(fullResult.success,true);
    check('full shift restores PO supplier balance once',await balance(full),null,0);
    assert.equal(await json(`SELECT to_jsonb((actual_effect->>'supplier_balance_restored_in_minor_units')::bigint)
      FROM supplier_payment_reversals WHERE supplier_payment_id=${q(fullPayment.payment_id)};`),5000);
    await zeroWriteReplay(fullCommand);
    results.push({name:'full shift PO preview agrees with actual primitive supplier effect',passed:true});

    label='monitoring full evidence';await json('SELECT public.run_advanced_monitoring_checks(NOW());');
    const monitored=await json("SELECT jsonb_build_object('issues',issue_count,'status',status) FROM advanced_monitoring_checks WHERE check_key='integrity:accounting:supplier-balances';");
    assert.deepEqual(monitored,{issues:0,status:'healthy'});results.push({name:'monitoring direct+PO-minus-payments',...monitored});
    const acl=await json(`SELECT jsonb_build_object('anonPayment',has_function_privilege('anon','public.record_supplier_payment(uuid,uuid,bigint,text,text,timestamptz,text,text)','EXECUTE'),
      'authPayment',has_function_privilege('authenticated','public.record_supplier_payment(uuid,uuid,bigint,text,text,timestamptz,text,text)','EXECUTE'),
      'directHelper',has_function_privilege('authenticated','public._record_supplier_receipt_payment_impl(uuid,bigint,text,text,text)','EXECUTE'));`);
    assert.deepEqual(acl,{anonPayment:false,authPayment:true,directHelper:false});
  }
  return results;
}

try {
  for(const mode of selectedModes){
    const projectId=`nawasrah-package-e-supplier-${mode}-test`;container=`supabase_db_${projectId}`;label=`${mode} bootstrap`;
    const {stdout}=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{
      cwd:root,windowsHide:true,timeout:600000,maxBuffer:8*1024*1024,env:{...process.env,
        NAWASRAH_ISOLATED_PROJECT_ID:projectId,NAWASRAH_MAX_MIGRATION:'132',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
        NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
    const built=JSON.parse(stdout);assert.equal(built.ok,true);workdir=built.isolatedProjectRoot;
    await sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
    await rpc(`open_cash_shift(${q(branch)},1000000)`);
    const historicalPolicy=mode==='after'?await historicalPoPolicy():[];
    const cases=await matrix(mode==='after');
    let lint;
    if(mode==='after'){
      const {stdout:raw}=await exec(process.execPath,[cli,'db','lint','--local','--level','warning','--workdir',workdir],
        {cwd:root,windowsHide:true,timeout:180000,maxBuffer:8*1024*1024});
      const warnings=assertPackageDDbLint(raw);lint={result:'PASS',documentedCompatibilityWarnings:warnings.length};
      const current=await readFile(path.join(root,'supabase/migrations/133_package_e_supplier_po_financial_consistency.sql'),'utf8');
      const hash=createHash('sha256').update(current.replace(/\r\n?/gu,'\n')).digest('hex').toUpperCase();
      assert.equal(hash,JSON.parse(await readFile(path.join(root,'docs/agent/project-state.json'),'utf8')).migration133CanonicalLfSha256);
    }
    modes.push({mode,rebuild:mode==='before'?'001-132':'001-133',historicalPolicy,cases,lint});
    await exec(process.execPath,[cli,'stop','--no-backup','--workdir',workdir],{cwd:root,windowsHide:true,timeout:120000,maxBuffer:1024*1024});
    workdir=null;
    console.log(JSON.stringify({ok:true,completedMode:mode,cases:cases.length},null,2));
  }
  console.log(JSON.stringify({ok:true,ownerPolicy:'active direct+PO receipts minus active payments',modes,productionAccess:0,
    auditedBalanceRecalculation:true,historicalInvoiceAndInventoryUnchanged:true},null,2));
}catch(error){console.error(JSON.stringify({ok:false,label,message:error.message,modes},null,2));process.exitCode=1;}
finally {if(workdir)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',workdir],
  {cwd:root,windowsHide:true,timeout:120000,maxBuffer:1024*1024});}
