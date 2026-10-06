import assert from 'node:assert/strict';
import {execFile, spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {promisify} from 'node:util';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';

const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, '../..');
const before = process.env.NAWASRAH_PHASE6_MODE === 'before';
const ceiling = before ? 130 : 131;
const projectId = 'nawasrah-phase6-package-a-test';
const container = `supabase_db_${projectId}`;
const cli = path.join(root,'node_modules/supabase/dist/supabase.js');
const owner = '92400000-0000-0000-0000-000000000001';
const product = '92400000-0000-0000-0000-000000000101';
const claims = `SELECT set_config('request.jwt.claims','{"sub":"${owner}","role":"authenticated","aal":"aal2"}',false);`;
const quote = (v) => `'${String(v).replaceAll("'","''")}'`;
let workdir;
let appliedHash;
const sql = (text) => new Promise((resolve,reject) => {
  const child = spawn('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-q','-At','-v','ON_ERROR_STOP=1'],
    {cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let out='',err='';
  child.stdout.on('data',(s)=>{out+=s;}); child.stderr.on('data',(s)=>{err+=s;});
  child.on('error',reject); child.on('close',(code)=>code===0?resolve(out.trim()):reject(Error(`${code}: ${err}`)));
  child.stdin.end(`SET statement_timeout='60s'; SET lock_timeout='30s';\n${text}`);
});
const json = async (text) => JSON.parse((await sql(text)).split(/\r?\n/u).at(-1));
const report = (branch) => json(`${claims} SET ROLE authenticated;
  SELECT public.get_operational_business_report(${quote(branch)},CURRENT_DATE,CURRENT_DATE);`);
const setCost = (cost) => sql(`UPDATE public.products SET wac_cost_in_minor_units_exact=${cost},
  cost_price_in_minor_units=ROUND(${cost}) WHERE id=${quote(product)};`);
const makePos = async (location,lines,amount,discount=0) => {
  const result=await json(`${claims} SET ROLE authenticated; SELECT public.create_pos_sale_v2(
    ${quote(location.warehouse)},${quote(location.branch)},NULL,'Phase6 report POS','cash',
    ${quote(JSON.stringify(lines))}::jsonb,${discount},${amount},${quote(randomUUID())});`);
  assert.equal(result.success,true);
  return json(`SELECT jsonb_build_object('id',o.id,'item',i.id,'branch',o.branch_id,'warehouse',o.warehouse_id)
    FROM public.orders o JOIN public.order_items i ON i.order_id=o.id WHERE o.id=${quote(result.orderId)};`);
};
const baseLines = qty => [{commercial_line_kind:'base_unit',product_id:product,base_quantity:qty,
  price_authority:'server_catalog',line_discount_in_minor_units:0}];
const returnSql = (sale,qty,disposition='restock') => {
  const items=[{return_scope:'base_unit',order_item_id:sale.item,quantity:qty,stock_disposition:disposition}];
  const sources=[{root_source_kind:'base_order_item',root_source_id:sale.item,
    source_kind:'base_order_item',source_id:sale.item,product_id:product,quantity:qty,
    sellable_restock_quantity:disposition==='restock'?qty:0,
    defect_non_sellable_quantity:disposition==='damaged'?qty:0,customer_damage_quantity:0}];
  return `${claims} SET ROLE authenticated; SELECT public.settle_admin_sales_return_v1(${quote(sale.id)},
    ${quote(randomUUID())},${quote(JSON.stringify(items))}::jsonb,${quote(JSON.stringify(sources))}::jsonb,
    'Phase6 report fixture','cash',NULL,NULL);`;
};
const fingerprint = () => json(`SELECT jsonb_build_object('value',md5(concat_ws('|',
  (SELECT string_agg(to_jsonb(r)::text,',' ORDER BY id) FROM public.orders r),
  (SELECT string_agg(to_jsonb(r)::text,',' ORDER BY id) FROM public.customer_payments r),
  (SELECT string_agg(to_jsonb(r)::text,',' ORDER BY id) FROM public.sales_return_events r),
  (SELECT string_agg(to_jsonb(r)::text,',' ORDER BY id) FROM public.business_operations r),
  (SELECT string_agg(to_jsonb(r)::text,',' ORDER BY id) FROM public.inventory_movements r),
  (SELECT string_agg(to_jsonb(r)::text,',' ORDER BY id) FROM public.cash_shifts r))));`);
try {
  const {stdout} = await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],
    {cwd:root,windowsHide:true,timeout:600000,maxBuffer:8*1024*1024,env:{...process.env,
      NAWASRAH_ISOLATED_PROJECT_ID:projectId,NAWASRAH_MAX_MIGRATION:String(ceiling),
      NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',NAWASRAH_SUPABASE_EXCLUDE:
      'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
  const built=JSON.parse(stdout); assert.equal(built.ok,true); workdir=built.isolatedProjectRoot;
  if(!before){
    const migrated=await readFile(path.join(workdir,'supabase/migrations/131_phase6_operational_report_readers.sql'),'utf8');
    appliedHash=createHash('sha256').update(migrated.replace(/\r\n?/gu,'\n')).digest('hex').toUpperCase();
    const state=JSON.parse(await readFile(path.join(root,'docs/agent/project-state.json'),'utf8'));
    assert.equal(appliedHash,state.migration131CanonicalLfSha256,'Runtime must test the exact current approved Migration131');
  }
  assert.equal((await json(await readFile(path.join(root,'scripts/testing/phase3-configurable-parcel-contracts-runtime.sql'),'utf8'))).ok,true);
  await sql(`SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='run-advanced-monitoring';
    UPDATE public.storefront_settings SET orders_enabled=true,minimum_order_in_minor_units=0,
      inside_ramtha_delivery_fee_in_minor_units=1000,outside_ramtha_delivery_fee_in_minor_units=1000;
    INSERT INTO public.inventory_balances(warehouse_id,product_id,on_hand_quantity,reserved_quantity)
    SELECT id,${quote(product)},100,0 FROM public.warehouses WHERE is_active
    ON CONFLICT(warehouse_id,product_id) DO UPDATE SET on_hand_quantity=public.inventory_balances.on_hand_quantity+100;`);
  const lines=[{commercial_line_kind:'base_unit',product_id:product,base_quantity:10,expected_unit_price_in_minor_units:1000}];
  const submission = await json(`SELECT set_config('request.jwt.claim.role','service_role',false);
    SELECT public.submit_guest_customer_order_v2(${quote(randomUUID())},repeat('a',64),repeat('b',64),
    'Phase6 acceptance','0796610001','إربد','الرمثا','حي الاختبار','شارع الاختبار',NULL,NULL,NULL,NULL,NULL,NULL,
    ${quote(JSON.stringify(lines))}::jsonb,NULL,'cliq','inside_ramtha',10000,0,1000,11000);`);
  assert.ok(submission.order_id);
  const sale = await json(`SELECT jsonb_build_object('id',o.id,'item',i.id,'branch',o.branch_id,'warehouse',o.warehouse_id)
    FROM public.orders o JOIN public.order_items i ON i.order_id=o.id WHERE o.id=${quote(submission.order_id)};`);
  await sql(`${claims} INSERT INTO public.cash_shifts(shift_number,branch_id,opened_by,opening_cash_in_minor_units)
    SELECT 'P6-ACCEPTANCE',${quote(sale.branch)},${quote(owner)},50000
    WHERE NOT EXISTS(SELECT 1 FROM public.cash_shifts WHERE branch_id=${quote(sale.branch)} AND status='open');
    UPDATE public.orders SET status='ready' WHERE id=${quote(sale.id)};`);
  const beforeCompletion=await report(sale.branch);
  const completion = await json(`${claims} SET ROLE authenticated; SELECT public.complete_website_order_with_settlement_v2(
    ${quote(sale.id)},${quote(randomUUID())},'cliq',6000,1000,'P6-CLIQ','Phase6 acceptance completion');`);
  assert.equal(completion.success,true);
  const baseline=await report(sale.branch);
  for(const payload of [beforeCompletion,baseline]){
    for(const field of ['discountInMinorUnits','subtotalInMinorUnits','posOrderCount','websiteOrderCount'])
      assert.ok(Number.isSafeInteger(payload.sales[field]),`Historical sales.${field} must not disappear`);
    assert.ok(Array.isArray(payload.expenses.categories),'Historical expense categories remain present');
    assert.ok(Number.isSafeInteger(payload.balances.supplierDueInMinorUnits),'Supplier balance remains present');
  }
  if(!before){
    assert.equal(baseline.sales.grossSalesInMinorUnits-beforeCompletion.sales.grossSalesInMinorUnits,11000);
    assert.equal(baseline.sales.outstandingInMinorUnits-beforeCompletion.sales.outstandingInMinorUnits,5000);
    assert.equal(baseline.cashFlow.cliqCollectedInMinorUnits-beforeCompletion.cashFlow.cliqCollectedInMinorUnits,6000,
      'Completion-linked receipt must count once, not completion + receipt');
  }
  const returned=await json(returnSql(sale,5)); assert.equal(returned.success,true);
  const afterReturn=await report(sale.branch);
  const difference=(a,b,key)=>a.sales[key]-b.sales[key];
  if(before){
    assert.equal(difference(afterReturn,baseline,'netSalesInMinorUnits'),0,'001-130 misses modern Return entitlement');
    assert.equal(afterReturn.sales.outstandingInMinorUnits,baseline.sales.outstandingInMinorUnits,'001-130 ignores debt reduction');
  } else {
    assert.equal(difference(afterReturn,baseline,'netSalesInMinorUnits'),-5000);
    assert.equal(difference(afterReturn,baseline,'refundsInMinorUnits'),1000);
    assert.equal(difference(afterReturn,baseline,'debtReductionInMinorUnits'),4000);
    assert.equal(difference(afterReturn,baseline,'outstandingInMinorUnits'),-4000);
    assert.equal(afterReturn.cashFlow.cashNetFlowInMinorUnits-baseline.cashFlow.cashNetFlowInMinorUnits,-1000);
    assert.equal(afterReturn.cashFlow.cliqNetFlowInMinorUnits,baseline.cashFlow.cliqNetFlowInMinorUnits);
    assert.equal(difference(afterReturn,beforeCompletion,'netSalesInMinorUnits'),6000);
    assert.equal(difference(afterReturn,beforeCompletion,'outstandingInMinorUnits'),1000);
    assert.equal(afterReturn.cashFlow.cliqNetFlowInMinorUnits-beforeCompletion.cashFlow.cliqNetFlowInMinorUnits,6000);
    assert.equal(afterReturn.cashFlow.cashNetFlowInMinorUnits-beforeCompletion.cashFlow.cashNetFlowInMinorUnits,-1000);
  }
  // Real historical Website V1 lifecycle, then real Legacy Return in same period.
  await sql('UPDATE public.storefront_settings SET inside_ramtha_delivery_fee_in_minor_units=0;');
  const legacy=await json(`SELECT set_config('request.jwt.claim.role','service_role',false);
    SELECT public.submit_guest_customer_order(${quote(randomUUID())},'Phase6 Legacy','0796610002','إربد','الرمثا',
    'حي الاختبار','شارع الاختبار',NULL,NULL,NULL,NULL,NULL,NULL,
    ${quote(JSON.stringify([{product_id:product,quantity:1}]))}::jsonb,NULL,'cash_on_delivery','inside_ramtha');`);
  assert.ok(legacy.order_id);
  await json(`${claims} SELECT public.accept_order_for_preparation(${quote(legacy.order_id)},'Phase6 Legacy');`);
  await json(`${claims} SELECT public.update_order_status(${quote(legacy.order_id)},'ready','Phase6 Legacy');`);
  const legacyTotal=await json(`SELECT to_jsonb(total_in_minor_units) FROM public.orders WHERE id=${quote(legacy.order_id)};`);
  await json(`${claims} SELECT public.complete_website_order_with_settlement(${quote(legacy.order_id)},'cash',${legacyTotal},0,NULL,'Phase6 Legacy');`);
  const preLegacyReturn=await report(sale.branch);
  await json(`${claims} SELECT public.return_completed_website_order(${quote(legacy.order_id)},'Phase6 Legacy Return','restock','cash',NULL,NULL);`);
  const mixed=await report(sale.branch);
  assert.equal(difference(mixed,preLegacyReturn,'refundsInMinorUnits'),legacyTotal);
  if(!before){
    assert.equal(difference(mixed,baseline,'returnCount'),2);
    assert.equal(difference(mixed,baseline,'returnEntitlementInMinorUnits'),5000+legacyTotal);
  }
  const stateBefore=await fingerprint();
  const summary=await json(`SELECT public.build_business_summary('daily',CURRENT_DATE,CURRENT_DATE,NOW());`);
  const home=await json(`${claims} SET ROLE authenticated; SELECT public.get_home_dashboard();`);
  const shiftId=await json(`SELECT to_jsonb(cash_shift_id) FROM public.orders WHERE id=${quote(sale.id)};`);
  const closing=await json(`${claims} SET ROLE authenticated; SELECT public.get_cash_shift_closing_report(${quote(shiftId)});`);
  await report(sale.branch);
  assert.deepEqual(await fingerprint(),stateBefore,'All report reads must be content-sensitive zero-write');
  if(!before){
    for(const field of ['discountInMinorUnits','cashSalesInMinorUnits','cliqSalesInMinorUnits'])
      assert.ok(Number.isSafeInteger(summary.sales[field]),`Summary ${field} remains present`);
    assert.ok(Number.isSafeInteger(summary.balances.supplierDueInMinorUnits));
    assert.ok(summary.sales.returnEntitlementInMinorUnits>=5000+legacyTotal);
    assert.ok(home.summary.todayNetSalesInMinorUnits!==undefined);
    assert.ok(closing.returnQuantityBreakdown.some(r=>r.sellableQuantity===5));
  }
  const untouched=await json(`SELECT jsonb_build_object('surface',md5(string_agg(
    p.oid::regprocedure::text||replace(pg_get_functiondef(p.oid),chr(13),'')||COALESCE(p.proacl::text,''),'' ORDER BY p.oid::regprocedure::text)))
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f'
      AND p.proname NOT IN('get_operational_business_report','build_business_summary','get_home_dashboard','_get_cash_shift_closing_report_before_snapshot');`);
  assert.equal(untouched.surface,'7a84e3ebe04ea5858c6b00b86fc4345d','Writers/other functions/ACL must remain identical to 001-130');
  let extended='before-mode-not-applicable',lint='before-mode-not-applicable';
  if(!before){
    // Independent known costs: sale 10, replacement 111.111111, current WAC 999.
    await setCost(10);
    const pos=await makePos(sale,baseLines(1),1000);
    const original=await json(`SELECT to_jsonb(cogs_in_minor_units) FROM public.order_items WHERE id=${quote(pos.item)};`);
    assert.equal(original,10);
    const prior=await report(pos.branch);
    await setCost(111.111111);
    const replacement=await json(`${claims} SET ROLE authenticated; SELECT public.settle_sales_replacement_v1(
      ${quote(pos.id)},${quote(randomUUID())},${quote(JSON.stringify([{sourceKind:'base_order_item',sourceId:pos.item,quantity:1}]))}::jsonb,
      'Phase6 replacement valuation',NULL);`);
    assert.equal(replacement.success,true);
    const replacementItem=await json(`SELECT to_jsonb(id) FROM public.sales_replacement_items WHERE operation_id=${quote(replacement.operationId)};`);
    const replaced=await report(pos.branch);
    assert.equal(difference(replaced,prior,'replacementCostInMinorUnits'),111);
    await setCost(999);
    await sql(`UPDATE public.products SET sale_price_in_minor_units=7777,default_sale_price_in_minor_units=7777,
      wholesale_price_in_minor_units=7777 WHERE id=${quote(product)};`);
    const items=[{return_scope:'base_unit',order_item_id:pos.item,quantity:1,stock_disposition:'restock'}];
    const sources=[{root_source_kind:'base_order_item',root_source_id:pos.item,source_kind:'replacement_item',
      source_id:replacementItem,product_id:product,quantity:1,sellable_restock_quantity:1,
      defect_non_sellable_quantity:0,customer_damage_quantity:0}];
    const returnedReplacement=await json(`${claims} SET ROLE authenticated; SELECT public.settle_admin_sales_return_v1(
      ${quote(pos.id)},${quote(randomUUID())},${quote(JSON.stringify(items))}::jsonb,
      ${quote(JSON.stringify(sources))}::jsonb,'Phase6 replaced return','cash',NULL,NULL);`);
    assert.equal(returnedReplacement.success,true);
    const returnedReport=await report(pos.branch);
    assert.equal(difference(returnedReport,replaced,'returnEntitlementInMinorUnits'),1000);
    assert.equal(difference(returnedReport,replaced,'restockRecoveryInMinorUnits'),111);
    assert.equal(difference(returnedReport,replaced,'cogsInMinorUnits'),0);
    assert.equal(await json(`SELECT to_jsonb(cogs_in_minor_units) FROM public.order_items WHERE id=${quote(pos.item)};`),original);
    // A return in this period against an earlier sale produces negative daily
    // revenue, while today's cash movement remains in today's period.
    const priorDay=await json(`BEGIN; SET LOCAL session_replication_role=replica;
      UPDATE public.order_status_history SET created_at=created_at-INTERVAL '1 day'
        WHERE order_id=${quote(pos.id)} AND new_status='completed';
      ${claims} SET LOCAL ROLE authenticated;
      SELECT public.get_operational_business_report(${quote(pos.branch)},CURRENT_DATE,CURRENT_DATE);
      ROLLBACK;`);
    assert.equal(difference(priorDay,returnedReport,'grossSalesInMinorUnits'),-1000);
    assert.equal(priorDay.sales.returnEntitlementInMinorUnits,returnedReport.sales.returnEntitlementInMinorUnits);
    assert.deepEqual(priorDay.cashFlow,returnedReport.cashFlow);
    await sql(`UPDATE public.products SET sale_price_in_minor_units=1000,default_sale_price_in_minor_units=1000,
      wholesale_price_in_minor_units=1000 WHERE id=${quote(product)};`);
    const damaged=await makePos(sale,baseLines(1),1000);
    const preDamage=await report(sale.branch);
    assert.equal((await json(returnSql(damaged,1,'damaged'))).success,true);
    const postDamage=await report(sale.branch);
    assert.equal(difference(postDamage,preDamage,'restockRecoveryInMinorUnits'),0);
    assert.equal(difference(postDamage,preDamage,'returnEntitlementInMinorUnits'),1000);
    const beforeDiscount=await report(sale.branch);
    await makePos(sale,baseLines(1),999,1);
    const afterDiscount=await report(sale.branch);
    assert.equal(difference(afterDiscount,beforeDiscount,'discountInMinorUnits'),1,
      'Preserve the Phase3 discount reader contract; never replace missing discount with zero');
    // Mixed sellable/defect/damage inside one root. Its inspection disposition
    // alone is intentionally insufficient to infer the physical buckets.
    const productB='92400000-0000-0000-0000-000000000102';
    await sql(`INSERT INTO public.inventory_balances(warehouse_id,product_id,on_hand_quantity,reserved_quantity)
      VALUES(${quote(sale.warehouse)},${quote(productB)},100,0)
      ON CONFLICT(warehouse_id,product_id) DO UPDATE SET on_hand_quantity=public.inventory_balances.on_hand_quantity+100;`);
    const parcel=await makePos(sale,[{commercial_line_kind:'configurable_parcel',
      family_product_id:'92400000-0000-0000-0000-000000000100',
      parcel_configuration_id:'92400000-0000-0000-0000-000000000300',configuration_revision:1,
      price_authority:'server_catalog',line_discount_in_minor_units:0,
      parcel_instances:[{components:[{product_id:product,base_quantity:2},{product_id:productB,base_quantity:3}]}]}],5000);
    const context=await json(`${claims} SET ROLE authenticated; SELECT public.get_admin_sales_aftercare_context_v1(${quote(parcel.id)});`);
    const p=context.parcelInstances[0];
    const physical=p.components.flatMap(c=>c.physicalRepresentatives.map(s=>({
      root_source_kind:'parcel_component',root_source_id:c.parcelComponentId,source_kind:s.sourceKind,
      source_id:s.sourceId,product_id:s.productId,quantity:s.remainingQuantity,
      sellable_restock_quantity:1,defect_non_sellable_quantity:1,
      customer_damage_quantity:c.productId===productB?1:0})));
    const parcelItems=[{return_scope:'parcel_instance',order_item_id:p.orderItemId,parcel_instance_id:p.parcelInstanceId,
      components:p.components.map(c=>({parcel_component_id:c.parcelComponentId,accepted_quantity:2,
        rejected_quantity:c.productId===productB?1:0,accepted_condition:'sellable',accepted_stock_disposition:'restock',
        rejection_reason:c.productId===productB?'customer_damage':null,
        rejected_stock_disposition:c.productId===productB?'returned_to_customer':null}))}];
    const mixedReturn=await json(`${claims} SET ROLE authenticated; SELECT public.settle_admin_sales_return_v1(
      ${quote(parcel.id)},${quote(randomUUID())},${quote(JSON.stringify(parcelItems))}::jsonb,
      ${quote(JSON.stringify(physical))}::jsonb,'Phase6 mixed buckets','cash',NULL,NULL);`);
    assert.equal(mixedReturn.success,true);
    const mixedClosing=await json(`${claims} SET ROLE authenticated; SELECT public.get_cash_shift_closing_report(${quote(shiftId)});`);
    assert.ok(mixedReturn.returnId);
    const details=mixedClosing.returnQuantityBreakdown.filter(r=>r.eventId===mixedReturn.returnId);
    assert.equal(details.length,2);
    assert.deepEqual(details.map(r=>[r.sellableQuantity,r.defectQuantity,r.customerDamageQuantity]).sort(),[[1,1,0],[1,1,1]]);
    // Existing snapshot writer freezes the new detail. Later reads still return
    // its exact stored bytes; Migration131 does not modify that writer.
    const shiftSummary=await json(`${claims} SET ROLE authenticated; SELECT public.get_cash_shift_summary(${quote(shiftId)});`);
    assert.equal((await json(`${claims} SET ROLE authenticated; SELECT public.close_cash_shift(${quote(shiftId)},${shiftSummary.expectedCashInMinorUnits},NULL);`)).success,true);
    const snap=await json(`SELECT closing_report_snapshot FROM public.cash_shifts WHERE id=${quote(shiftId)};`);
    assert.deepEqual(await json(`${claims} SET ROLE authenticated; SELECT public.get_cash_shift_closing_report(${quote(shiftId)});`),snap);
    // ACL on the four altered readers is independently equal to its historical
    // contract: no public/anon access; only the existing privileged boundaries.
    const acl=await json(`SELECT jsonb_build_object('reportAnon',has_function_privilege('anon','public.get_operational_business_report(uuid,date,date)','EXECUTE'),
      'reportAuthenticated',has_function_privilege('authenticated','public.get_operational_business_report(uuid,date,date)','EXECUTE'),
      'summaryAuthenticated',has_function_privilege('authenticated','public.build_business_summary(text,date,date,timestamptz)','EXECUTE'));
    `);
    assert.deepEqual(acl,{reportAnon:false,reportAuthenticated:true,summaryAuthenticated:false});
    const {stdout:lintOutput}=await exec(process.execPath,[cli,'db','lint','--local','--level','warning','--workdir',workdir],
      {cwd:root,windowsHide:true,timeout:180000,maxBuffer:8*1024*1024});
    if(/ERROR:|"level"\s*:\s*"error"/u.test(lintOutput)) throw Error(lintOutput);
    lint='PASS';
    extended={replacementHistoricalCost:true,currentPriceWacIsolation:true,periodSeparation:true,
      nonSellableZeroRecovery:true,threeBucketClosingDetail:true,immutableSnapshot:true,readerAcl:true};
  }
  console.log(JSON.stringify({ok:true,mode:before?'before':'after',freshRebuild:`001-${ceiling}`,
    acceptance:{netSalesDelta:difference(afterReturn,baseline,'netSalesInMinorUnits'),
      refundDelta:difference(afterReturn,baseline,'refundsInMinorUnits'),
      dueDelta:difference(afterReturn,baseline,'outstandingInMinorUnits')},
    mixedLegacyAndModern:true,reportReadsZeroWrite:true,untouchedSurface:untouched.surface,extended,lint,migration131Hash:appliedHash},null,2));
} finally {
  if(workdir) await exec(process.execPath,[cli,'stop','--no-backup','--workdir',workdir],
    {cwd:root,windowsHide:true,timeout:120000,maxBuffer:1024*1024});
}
