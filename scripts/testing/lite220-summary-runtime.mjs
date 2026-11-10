// Actual SQL/role/enqueue checks. Called only by the owned networkless220 runner.
import assert from'node:assert/strict';
import{randomUUID}from'node:crypto';
import{tsImport}from'tsx/esm/api';
export async function verifyLite220Summary(c,report){
 const{sql,json,q,j}=c,formatter=await tsImport('../../supabase/functions/_shared/owner-telegram-format.ts',import.meta.url);
 const day=await sql("SELECT(now() AT TIME ZONE 'Asia/Amman')::DATE;"),generated=await sql('SELECT now();');
 const branch=randomUUID(),warehouse=randomUUID();
 await sql(`INSERT INTO public.branches(id,code,name_ar)VALUES(${q(branch)},'SUMMARY-SECOND','فرع وهمي ثانٍ');INSERT INTO public.warehouses(id,branch_id,code,name_ar)VALUES(${q(warehouse)},${q(branch)},'SUMMARY-SECOND-WH','مستودع وهمي ثانٍ');`);
 const secondBranchSale=async()=>{const shift=(await c.rpc(`open_cash_shift(${q(branch)},0)`)).id;
  const sale=await c.rpc(`lite1_pos2(${j({branchId:branch,warehouseId:warehouse,customerId:c.customer,paymentMethod:'cash',lines:[{commercial_line_kind:'base_unit',product_id:c.pid,base_quantity:1}],discountInMinorUnits:0,amountReceivedInMinorUnits:1000})},${q(randomUUID())})`);
  assert.equal(sale.totalInMinorUnits,1000);const closing=await c.rpc(`get_cash_shift_summary(${q(shift)})`);await c.rpc(`close_cash_shift(${q(shift)},${closing.expectedCashInMinorUnits},NULL)`);return sale;
 };
 await secondBranchSale();
 const service=call=>json(`BEGIN;SELECT set_config('request.jwt.claims',${j({role:'service_role'})}::text,true);SET LOCAL ROLE service_role;SELECT public.${call};COMMIT;`);
 for(const type of['daily','weekly']){
  const from=type==='daily'?day:await sql(`SELECT(${q(day)}::DATE-6)::TEXT;`),call=`build_business_summary(${q(type)},${q(from)},${q(day)},${q(generated)})`,value=await service(call);
  const facts=await json(`SELECT public.tb215_exchange_financial_adjustment_internal(sales_lite2.simple_facts(NULL,${q(from)}::DATE::TIMESTAMP AT TIME ZONE 'Asia/Amman',(${q(day)}::DATE+1)::TIMESTAMP AT TIME ZONE 'Asia/Amman','Asia/Amman',true),NULL,${q(from)}::DATE::TIMESTAMP AT TIME ZONE 'Asia/Amman',(${q(day)}::DATE+1)::TIMESTAMP AT TIME ZONE 'Asia/Amman','Asia/Amman',true);`);
  for(const key of['sales','cashFlow','expenses','dailyBreakdown','balances'])assert.deepEqual(value[key],facts[key],'LITE220_SUMMARY_EXACT_MONETARY_FACTS:'+key);
  assert.equal(value.accountingTracked,false);
  assert.equal(new Date(value.generatedAt).getTime(),new Date(generated).getTime());
  assert.doesNotMatch(formatter.formatOwnerMessage({eventType:'business_'+type+'_summary',payload:value}),/صافي الربح|المخزون|للموردين/u);
 }
 // Direct calls to both internal helpers remain denied even to service_role.
 for(const role of['anon','authenticated','service_role'])for(const target of[`sales_lite2.business_summary('daily',${q(day)},${q(day)},now())`,`sales_lite2.summary_uses_lite(${q(day)},${q(day)})`]){
  await assert.rejects(()=>sql(`BEGIN;SET LOCAL ROLE ${role};SELECT ${target};ROLLBACK;`),/permission denied/u);const allowed=await sql(`SELECT has_function_privilege(${q(role)},${q(target.startsWith('sales_lite2.business_summary')?'sales_lite2.business_summary(text,date,date,timestamp with time zone)':'sales_lite2.summary_uses_lite(date,date)')},'EXECUTE');`);assert.equal(allowed,'f');
 }
 // The summary public RPC itself is still service-only,not a new anon read.
 for(const role of['anon','authenticated'])assert.equal(await sql(`SELECT has_function_privilege(${q(role)},'public.build_business_summary(text,date,date,timestamp with time zone)','EXECUTE');`),'f');
 // Use a seven-day window covering tomorrow as well,so midnight cannot make
 // the real later sale fall outside this immutability proof.
 const to=await sql(`SELECT(${q(day)}::DATE+1)::TEXT;`),from=await sql(`SELECT(${q(to)}::DATE-6)::TEXT;`);
 const first=await service(`enqueue_business_summary('weekly',${q(from)},${q(to)},${q(generated)},${q(generated)})`),snapshot=await json(`SELECT payload FROM public.automation_events WHERE id=${q(first.eventId)};`);
 await secondBranchSale();const newer=await service(`build_business_summary('weekly',${q(from)},${q(to)},${q(generated)})`);assert.equal(newer.sales.grossSalesInMinorUnits,snapshot.sales.grossSalesInMinorUnits+1000);
 const replay=await service(`enqueue_business_summary('weekly',${q(from)},${q(to)},${q(generated)},${q(generated)}::TIMESTAMPTZ+interval '1 hour')`);assert.equal(replay.created,false);assert.equal(replay.eventId,first.eventId);assert.deepEqual(await json(`SELECT payload FROM public.automation_events WHERE id=${q(first.eventId)};`),snapshot);
 for(const call of[`build_business_summary('daily',${q(day)},${q(to)},now())`,`build_business_summary('weekly',${q(day)},${q(to)},now())`,`build_business_summary('invalid',${q(day)},${q(day)},now())`])await assert.rejects(()=>service(call),/Invalid Business summary period/u);
 // Actual configured-zone half-open boundaries,including the UTC/Amman date
 // difference;the production clock and immutable transaction dates stay intact.
 assert.deepEqual(await json("SELECT jsonb_build_array(('2026-11-01T20:59:59Z'::TIMESTAMPTZ AT TIME ZONE 'Asia/Amman')::DATE,('2026-11-01T21:00:00Z'::TIMESTAMPTZ AT TIME ZONE 'Asia/Amman')::DATE);"),['2026-11-01','2026-11-02']);
 report.cases.push({name:'summary daily/weekly exact all-branch money/returns/expenses;private role denials;real later sale changes facts but not enqueued snapshot;period/Amman boundaries',passed:true});
}

// Run after the actual opening epoch,with both full sales and old-lite returns.
export async function verifyLite220SummaryAfterEpoch(c,report){const{sql,json,q,j}=c,day=await sql("SELECT(now() AT TIME ZONE 'Asia/Amman')::DATE;");assert.equal(await sql('SELECT sales_lite1.enabled();'),'f');
 assert.equal(await sql(`SELECT sales_lite2.summary_uses_lite(${q(day)},${q(day)});`),'t');
 const result=await json(`BEGIN;SELECT set_config('request.jwt.claims',${j({role:'service_role'})}::TEXT,true);SET LOCAL ROLE service_role;SELECT public.build_business_summary('daily',${q(day)},${q(day)},now());COMMIT;`);
 const facts=await c.rpc(`lite1_business_report2(${q(c.id(200))},${q(day)},${q(day)})`);for(const key of['sales','cashFlow','expenses'])assert.deepEqual(result[key],facts[key],'MIXED_SUMMARY_AFTER_EPOCH:'+key);
 assert.equal(result.accountingTracked,false);assert.ok(result.sales.returnEntitlementInMinorUnits>0);assert.doesNotMatch(JSON.stringify(result),/Profit|cogs|supplierDue|inventory/u);
 report.cases.push({name:'actual accounting activation:old-lite returns and full sales retain a cost-free exact summary',passed:true});
}
