// Actual SQL/role/enqueue checks. Called only by the owned networkless220 runner.
import assert from'node:assert/strict';
import{tsImport}from'tsx/esm/api';
export async function verifyLite220Summary(c,report){
 const{sql,json,q,j}=c,formatter=await tsImport('../../supabase/functions/_shared/owner-telegram-format.ts',import.meta.url);
 const day=await sql("SELECT(now() AT TIME ZONE 'Asia/Amman')::DATE;"),generated=await sql('SELECT now();');
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
 // Replay keeps the first generated timestamp and payload;no second event.
 const first=await service(`enqueue_business_summary('daily',${q(day)},${q(day)},${q(generated)},${q(generated)})`),snapshot=await json(`SELECT payload FROM public.automation_events WHERE id=${q(first.eventId)};`);
 const replay=await service(`enqueue_business_summary('daily',${q(day)},${q(day)},${q(generated)},${q(generated)}::TIMESTAMPTZ+interval '1 hour')`);assert.equal(replay.created,false);assert.equal(replay.eventId,first.eventId);assert.deepEqual(await json(`SELECT payload FROM public.automation_events WHERE id=${q(first.eventId)};`),snapshot);
 // Mode-independent provenance remains true for another branch's historical lite.
 assert.equal(await sql(`SELECT sales_lite2.summary_uses_lite(${q(day)},${q(day)});`),'t');
 report.cases.push({name:'summary daily/weekly same all-branch money/returns/expenses;no profit;private role denials;enqueue replay immutable',passed:true});
}
