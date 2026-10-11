import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

// Diagnostic SELECT projections ONLY. Bind the sole read-clock expression in
// the exact reviewed CTE prefixes;never redefine or patch an installed function.
export function midnightProjection(source,{directory=false,customer=''}={}){
 assert.match(customer,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
 const start=source.search(directory?/WITH candidates AS/u:/WITH eligible AS/u);
 const end=source.slice(start).match(directory?/\),\s+overdue AS \(/u:/\),\s+buckets AS \(/u);
 assert.ok(start>=0&&end,'Exact reviewed allocation CTE boundary');
 const prefix=source.slice(start,start+end.index+1);
 assert.equal((prefix.match(/\bCURRENT_TIMESTAMP\b/gu)||[]).length,1,'Only one temporal input can be bound');
 return `SELECT projection.result FROM (SELECT proof_clock AS proof_as_of,
 '${customer}'::UUID p_customer_id,'overdue'::TEXT v_status,'AGING-MIDNIGHT-PROOF'::TEXT v_search) input
 CROSS JOIN LATERAL (${prefix.replace('CURRENT_TIMESTAMP','proof_as_of')}
 SELECT jsonb_build_object('ageDays',MAX(age_days),'overdue',
 COALESCE(SUM(remaining) FILTER(WHERE age_days>30),0)) FROM allocated) projection(result)`;
}

export async function proveAgingMidnight({sql,root,owner}){
 const customer='92600000-0000-4000-8000-000000000980',order='92600000-0000-4000-8000-000000000981';
 const source136=await readFile(path.join(root,'supabase/migrations/136_package_f_customer_debt_aging.sql'),'utf8');
 const source137=await readFile(path.join(root,'supabase/migrations/137_package_f_crm_financial_filters.sql'),'utf8');
 const projection136=midnightProjection(source136,{customer}),projection137=midnightProjection(source137,{customer,directory:true});
 const query=projection=>`SELECT jsonb_agg(value ORDER BY proof_clock) FROM
 (VALUES('2026-10-11 23:59:59+03'::TIMESTAMPTZ),('2026-10-12 00:00:00+03'::TIMESTAMPTZ)) clock(proof_clock)
 CROSS JOIN LATERAL (SELECT (${projection}) AS value) payload`;
 const read=(age)=>`UPDATE public.order_status_history SET created_at=
 ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Amman')::DATE-${age})::TIMESTAMP AT TIME ZONE 'Asia/Amman' WHERE order_id='${order}';
 SAVEPOINT midnight_reader;
 SET LOCAL transaction_read_only=on;
 DO $$BEGIN PERFORM set_config('request.jwt.claims','{"sub":"${owner}","role":"authenticated","aal":"aal2"}',true);END$$;
 SET LOCAL ROLE authenticated;
 SELECT jsonb_build_object('age',${age},'aging',public.get_customer_debt_aging('${customer}'),
 'directory',public.get_crm_customer_page(1,10,'AGING-MIDNIGHT-PROOF','overdue','latest'));
 ROLLBACK TO SAVEPOINT midnight_reader;RELEASE SAVEPOINT midnight_reader;`;
 const result=await sql(`BEGIN;
 INSERT INTO public.customers(id,full_name,phone) VALUES('${customer}','AGING-MIDNIGHT-PROOF','0780010980');
 INSERT INTO public.orders(id,order_number,customer_id,status,source,payment_method,total_in_minor_units,amount_paid_in_minor_units)
 VALUES('${order}','AGING-MIDNIGHT-PROOF','${customer}','completed','website','debt',1000,0);
 INSERT INTO public.order_status_history(order_id,new_status,created_at)
 VALUES('${order}','completed','2026-09-11 00:00:00+03');
 SELECT jsonb_build_object('136',(${query(projection136)}),'137',(${query(projection137)}));
 ${read(30)}${read(31)}
 ROLLBACK;`);
 const rows=result.split(/\r?\n/u).map(line=>JSON.parse(line));assert.equal(rows.length,3);
 const expected=[{ageDays:30,overdue:0},{ageDays:31,overdue:1000}];
 assert.deepEqual(rows[0]['136'],expected);assert.deepEqual(rows[0]['137'],expected);
 for(const [index,age] of [[1,30],[2,31]]){
  const row=rows[index];assert.equal(row.age,age);assert.equal(row.aging.oldest_debt_age_days,age);
  assert.equal(row.aging.total_in_minor_units,1000);
  assert.equal(row.aging.days_over_30_in_minor_units,age===30?0:1000);
  assert.equal(row.directory.total_count,age===30?0:1);
  assert.deepEqual(row.directory.customers.map(value=>value.id),age===30?[]:[customer]);
 }
 console.log(JSON.stringify({stage:'deterministic Amman midnight proof',fixtureAt:'2026-10-11T23:59:59+03:00',
  completionAt:'2026-09-11T00:00:00+03:00',readBefore:'2026-10-11T23:59:59+03:00',readAfter:'2026-10-12T00:00:00+03:00',
  exactCte136:rows[0]['136'],exactCte137:rows[0]['137'],realRpcBoundaries:[30,31],installedFunctionsUnchanged:true,passed:true}));
}
