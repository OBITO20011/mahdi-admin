// Opt-in disposable219 preview only. All candidate DDL and fixtures roll back.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {quantityExpression220} from './draft220-quantity-inline.mjs';
export const draft220Path='docs/design/migration220/220_posthandover_read_performance.sql';
const q=v=>"'"+String(v).replaceAll("'","''")+"'";
export async function proveDraft220({root,session,owner,branch,id,record,measure=true,focus='all',annualPeriod=null}) {
 const s=await session(),report={kind:'quarantined220-on219',hostedAccess:false,parity:[],performance:[]};
 const query=async sql=>(await s.query(sql.trimEnd().endsWith(';')?sql:sql+';')).trim(),json=async sql=>JSON.parse(await query(sql));
 const today="(NOW() AT TIME ZONE 'Asia/Amman')::date";
 const annualFrom=annualPeriod?q(annualPeriod.from)+'::date':today+'-364',annualTo=annualPeriod?q(annualPeriod.to)+'::date':today;
 const annual=`SELECT public.get_operational_business_report('${branch}',${annualFrom},${annualTo})`;
 report.annualPeriod=annualPeriod??{from:'today-364',to:'today'};
 const role=(uid=owner,dbRole='authenticated')=>`RESET ROLE;SELECT set_config('request.jwt.claims',${q(JSON.stringify({sub:uid,role:dbRole,aal:'aal2'}))},true);SET LOCAL ROLE ${dbRole};`;
 const outcome=call=>json('SELECT pg_temp.outcome('+q(call)+');');
 const explain=async call=>{const start=performance.now(),p=JSON.parse(await query('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) '+call+';'))[0];return {executionMs:p['Execution Time'],wallMs:performance.now()-start,tempRead:p.Plan['Temp Read Blocks'],tempWritten:p.Plan['Temp Written Blocks'],plan:p.Plan};};
 const signatures=['phase6_financial_facts_before208_internal(uuid,timestamptz,timestamptz,text,boolean)','_get_operational_business_report_before_phase6(uuid,date,date)','_get_operational_business_report_v1(uuid,date,date)','get_supplier_replacements_page_v1(uuid,uuid,text,integer,integer)'];
 const definitionsSql=`SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'acl',p.proacl,'owner',p.proowner) ORDER BY p.oid) FROM pg_proc p WHERE p.oid IN(${signatures.map(n=>q('public.'+n)+'::regprocedure').join(',')}) OR (p.pronamespace='public'::regnamespace AND p.proname IN('submit_guest_customer_order_v2','create_customer_order_base_units_legacy','package_d_create_customer_order_before_source_guard_internal'));`;
 let before;
 try {
  await query('BEGIN;SET LOCAL statement_timeout=\'120s\';');
  before=await json(definitionsSql);
  assert.equal(before.length,7,'EXACT_FOUR_READERS_AND_THREE_GUEST_WRITERS_REQUIRED');
  // Errors remain errors. Preserve SQLSTATE and fixed business code as an oracle.
  await query(`CREATE FUNCTION pg_temp.outcome(command text) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE result jsonb;BEGIN EXECUTE command INTO result;RETURN jsonb_build_object('ok',true,'result',result);EXCEPTION WHEN query_canceled THEN RETURN jsonb_build_object('ok',false,'sqlstate',SQLSTATE,'message',SQLERRM);WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'sqlstate',SQLSTATE,'message',SQLERRM);END $$;`);
  if(focus!=='supplier'){
  // Scale fixture's100 modern sales are base units. Add real mixed-parcel
  // snapshots before BOTH oracles; never let the quantity test pass vacuously.
  await query(role());
  await json(`SELECT public.open_cash_shift('${branch}',10000);`);
  const config=await json(`SELECT public.save_product_parcel_configuration_v1('${id(14,1)}','configurable_mix',true,5,ARRAY[${Array.from({length:25},(_,n)=>q(id(15,n+1))).join(',')}]::uuid[]);`);
  assert.ok(config.configuration.id);
  const line={commercial_line_kind:'configurable_parcel',family_product_id:id(14,1),parcel_configuration_id:config.configuration.id,configuration_revision:config.configuration.configuration_revision,price_authority:'server_catalog',line_discount_in_minor_units:0,parcel_instances:[{components:[{product_id:id(15,1),base_quantity:2},{product_id:id(15,2),base_quantity:3}]}]};
  // Last sale has two parcels:55000 total avoids an unspecified Top Products
  // revenue tie at50000, so the whole JSON oracle remains literal,unsorted.
  for(let n=1;n<=10;n++){const mixed={...line,parcel_instances:n===10?[...line.parcel_instances,...line.parcel_instances]:line.parcel_instances};const sale=await json(`SELECT public.create_pos_sale_v2('${id(11,2)}','${branch}','${id(13,1)}','اختبار220','cash',${q(JSON.stringify([mixed]))}::jsonb,0,${n===10?10000:5000},'draft220-mixed-${n}');`);assert.equal(sale.success,true);}
  // Diverse real sales make Top Products unambiguous. We retain the strict
  // whole-JSON oracle instead of sorting/dropping selected SKUs or money fields.
  for(let n=1;n<=10;n++){const quantity=20*(n+1),base={commercial_line_kind:'base_unit',product_id:id(15,n),base_quantity:quantity,price_authority:'server_catalog',line_discount_in_minor_units:0};const sale=await json(`SELECT public.create_pos_sale_v2('${id(11,2)}','${branch}','${id(13,1)}','اختبار220','cash',${q(JSON.stringify([base]))}::jsonb,0,${quantity*1000},'draft220-base-case-${n}');`);assert.equal(sale.success,true);}
  report.mixedSalesFixture=10;report.diverseBaseSalesFixture=10;await query('RESET ROLE;');
  const periods=[['annual',annualFrom,annualTo],['today',today,today],['month',`date_trunc('month',${today})::date`,today],['first6',`date_trunc('month',${today})::date`,`date_trunc('month',${today})::date+5`],['empty',"'2001-01-01'::date","'2001-01-03'::date"],['other-branch',`${today}-7`,today]];
  const calls=periods.map(([name,from,to])=>({name,call:`SELECT public.get_operational_business_report('${name==='other-branch'?id(10,1):branch}',${from},${to})`}));
  // Every supported/denied role exercises the unchanged current role gate.
  const roleUsers=[];
  for(const [n,code]of ['admin','manager','accountant','sales','warehouse_keeper','delivery_driver','none'].entries()){
   const uid=id(95,n+1);await query(`INSERT INTO auth.users(id,aud,role,email) VALUES('${uid}','authenticated','authenticated','draft220-${code}@example.test');INSERT INTO public.profiles(id,full_name,is_active) VALUES('${uid}','اختبار220',true);${code==='none'?'':`INSERT INTO public.user_roles(user_id,role_id)SELECT '${uid}',id FROM public.roles WHERE code='${code}';`}`);roleUsers.push({uid,code});
  }
  const original=[];await query(role());
  for(const c of calls){original.push(await outcome(c.call));assert.equal(original.at(-1).ok,true,c.name);report.stage='baseline:'+c.name;await record(report);}
  const errorCalls=[`SELECT public.get_operational_business_report('${branch}',${today},${today}-1)`,`SELECT public.get_operational_business_report('${branch}',${today}-400,${today})`,`SELECT public.get_operational_business_report('${branch}',NULL,${today})`,`SELECT public.get_operational_business_report('${id(90,1)}',${today},${today})`];
  const errorsBefore=[];for(const call of errorCalls){const result=await outcome(call);assert.equal(result.ok,false);errorsBefore.push(result);}
  const roleBefore=[];
  for(const u of roleUsers){await query(role(u.uid));roleBefore.push(await outcome(calls[1].call));}
  await query(role());
  report.rlsBefore=[];
  for(const table of ['supplier_receipts','supplier_receipt_items'])report.rlsBefore.push({table,...await explain('SELECT count(*) FROM public.'+table)});
  const receiptRead="SELECT r.id,(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.supplier_receipt_items i WHERE i.supplier_receipt_id=r.id) AS items FROM public.supplier_receipts r ORDER BY r.received_at DESC,r.id DESC LIMIT 25";
  const receiptValues=await json('SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM ('+receiptRead+') t;');
  report.receiptBefore=[];for(let n=0;n<3;n++)report.receiptBefore.push(await explain(receiptRead));
  if(measure){
   report.originalAnnual=await explain(annual);
   await query("SET LOCAL statement_timeout='8s';");const slow=await outcome(annual);assert.equal(slow.ok,false);assert.equal(slow.sqlstate,'57014','ORIGINAL_MUST_FAIL_REAL_8S');report.original8sRejected=true;
   await query("SET LOCAL statement_timeout='120s';");
  }
  await query('RESET ROLE;');
  const source119=await readFile(path.join(root,'supabase/migrations/119_exact_wac_and_commercial_quantity_reporting.sql'),'utf8');
  const pkg=quantityExpression220(source119,'phase35_report_package_count_internal'),base=quantityExpression220(source119,'phase35_report_base_unit_count_internal');
  const vectors=await json(`WITH ids AS((SELECT id FROM public.order_items WHERE commercial_line_kind='configurable_parcel' LIMIT 10) UNION ALL SELECT '${id(90,5)}'::uuid), vectors AS(SELECT ids.id,k AS commercial_line_kind,n AS sale_package_quantity,n AS quantity,u AS units_per_sale_package FROM ids CROSS JOIN unnest(ARRAY[NULL::text,'base_unit','configurable_parcel','legacy_single_sku_parcel','other']) k CROSS JOIN unnest(ARRAY[NULL::integer,0,1,12]) n CROSS JOIN unnest(ARRAY[NULL::integer,0,-1,1,12]) u) SELECT jsonb_build_object('count',count(*),'exact',bool_and(public.phase35_report_package_count_internal(oi.id,oi.commercial_line_kind,oi.sale_package_quantity,oi.units_per_sale_package) IS NOT DISTINCT FROM ${pkg} AND public.phase35_report_base_unit_count_internal(oi.id,oi.commercial_line_kind,oi.quantity) IS NOT DISTINCT FROM ${base})) FROM vectors oi;`);
  assert.equal(vectors.exact,true);assert.ok(vectors.count>=1000);report.quantityVectors=vectors;
  // Full facts JSON across UTC/Amman, partial boundaries and verification mode.
  const factsCalls=[];
  for(const tz of ['Asia/Amman','UTC'])for(const verify of [true,false])for(const empty of [false,true])factsCalls.push(`SELECT public.phase6_financial_facts_internal('${branch}',${empty?"'2001-01-01'::timestamptz":"date_trunc('month',NOW())+interval '3 hours'"},${empty?"'2001-01-03'::timestamptz":"NOW()-interval '2 hours'"},'${tz}',${verify})`);
  const factsBefore=[];for(const call of factsCalls)factsBefore.push(await outcome(call));
  const aclBefore=await json("SELECT jsonb_agg(jsonb_build_array(p.oid::text,p.proacl,p.proowner,p.prosecdef,p.provolatile) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public';");
  await query(await readFile(path.join(root,draft220Path),'utf8'));
  assert.deepEqual(await json("SELECT jsonb_agg(jsonb_build_array(p.oid::text,p.proacl,p.proowner,p.prosecdef,p.provolatile) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public';"),aclBefore,'ALL_FUNCTION_ACL_OWNER_SECURITY_VOLATILITY_EXACT');
  for(let i=0;i<factsCalls.length;i++)assert.deepEqual(await outcome(factsCalls[i]),factsBefore[i],'FACTS_FULL_JSON_'+i);
  await query(role());
  assert.deepEqual(await json('SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM ('+receiptRead+') t;'),receiptValues,'RECEIPT_DETAILS_EXACT');
  report.receiptAfter=[];for(let n=0;n<3;n++)report.receiptAfter.push(await explain(receiptRead));
  assert.ok(JSON.stringify(report.receiptAfter[0].plan).includes('idx_supplier_receipt_items_receipt220'),'MEASURED_FK_INDEX_MUST_BE_USED');
  for(let i=0;i<calls.length;i++){assert.deepEqual(await outcome(calls[i].call),original[i],'FULL_JSON_'+calls[i].name);report.parity.push(calls[i].name);}
  for(let i=0;i<errorCalls.length;i++)assert.deepEqual(await outcome(errorCalls[i]),errorsBefore[i],'VALIDATION_SQLSTATE_CODE_'+i);
  report.errorParity=errorCalls.length;
  for(let i=0;i<roleUsers.length;i++){await query(role(roleUsers[i].uid));assert.deepEqual(await outcome(calls[1].call),roleBefore[i],'ROLE_RESULT_ERROR_'+roleUsers[i].code);report.parity.push('role:'+roleUsers[i].code);}
  await query(role());
  report.rlsAfter=[];
  for(let i=0;i<2;i++){const table=report.rlsBefore[i].table,after=await explain('SELECT count(*) FROM public.'+table);const count=p=>(p.Plans??[]).filter(child=>child['Parent Relationship']==='InitPlan').length;assert.equal(count(after.plan),count(report.rlsBefore[i].plan)+1,'AUTH_UID_MUST_ADD_ITS_OWN_INITPLAN');report.rlsAfter.push({table,...after});}
  const rlsDenied=[];
  for(const uid of [id(95,7),owner]){await query(role(uid));rlsDenied.push(await outcome("SELECT to_jsonb(count(*)) FROM public.supplier_receipt_items"));}
  assert.equal(rlsDenied[0].result,0,'UNASSIGNED_USER_MUST_NOT_GAIN_ROWS');assert.ok(rlsDenied[1].result>0);report.rlsAccessUnchanged=true;
  if(measure){
   await query(role()+"SET LOCAL statement_timeout='8s';");
   assert.equal(await query('SHOW statement_timeout;'),'8s');
   report.measurementContext=await json("SELECT jsonb_build_object('role',current_user,'timeout',current_setting('statement_timeout'),'callerWorkMem',current_setting('work_mem'));");
   assert.equal(report.measurementContext.role,'authenticated');assert.equal(report.measurementContext.callerWorkMem,'4MB');
   for(let i=-3;i<20;i++){const sample=await explain(annual);assert.ok(sample.executionMs<8000,'HARD_AUTHENTICATED_8S');delete sample.plan;if(i>=0)report.performance.push(sample);await record(report);}
   const sorted=report.performance.map(x=>x.executionMs).sort((a,b)=>a-b);report.summary={samples:20,warmups:3,p50:sorted[9],p95:sorted[18],max:sorted[19]};
   assert.ok(report.summary.p95<=7000,'M01_REQUIRES_ONE_SECOND_MARGIN');
  }
  assert.equal(await query('SHOW work_mem;'),'4MB','NO_CALLER_MEMORY_LEAK');
  // Real regression control: remove the candidate FK index in a savepoint.
  await query('RESET ROLE;SAVEPOINT missing_index;DROP INDEX public.idx_supplier_receipt_items_receipt220;'+role());
  const noIndex=await explain(receiptRead);assert.ok(JSON.stringify(noIndex.plan).includes('Seq Scan'));assert.ok(!JSON.stringify(noIndex.plan).includes('idx_supplier_receipt_items_receipt220'));report.indexNegativeDetected=true;
  await query('RESET ROLE;ROLLBACK TO SAVEPOINT missing_index;');
  }else await query(await readFile(path.join(root,draft220Path),'utf8'));
  await query('RESET ROLE;SET LOCAL statement_timeout=\'120s\';');
  // Real public coordinators create evidence; never fabricate case/event rows.
  for(let n=1;n<=60;n++){await query(role()+`SELECT public.execute_supplier_replacement_v1('shop_pending',${q(JSON.stringify({supplierId:id(12,1),productId:id(15,1),warehouseId:id(11,2),unit:'base',quantity:1,reason:'اختبار مسودة220'}))}::jsonb,'draft220-supplier-${n}');RESET ROLE;`);}
  const pageCall=(status,page,size=25)=>`SELECT public.get_supplier_replacements_page_v1('${id(12,1)}','${branch}','${status}',${page},${size})`;
  await query(role());const pages=[];for(let p=1;p<=3;p++)pages.push(await json(pageCall('pending',p)));
  assert.equal(pages[0].totalCount,60);const cases=pages.flatMap(p=>p.cases),keys=cases.map(c=>c.occurredAt+'|'+c.id);assert.equal(new Set(keys).size,60);assert.deepEqual(keys,[...keys].sort().reverse(),'DESC_ACROSS_PAGES_AND_ID_TIES');
  report.supplier={cases:cases.length,pages:3,deterministicDesc:true,descMeasurements:[],ascMeasurements:[]};
  for(let n=0;n<3;n++)report.supplier.descMeasurements.push(await explain(pageCall('pending',1)));
  const desc=await outcome(pageCall('pending',1,100));await query('RESET ROLE;');
  // Restore original reader temporarily: complete DTO multiset/totals identical.
  await query(before.find(x=>x.signature.startsWith('get_supplier_replacements_page_v1')).definition+';');await query(role());
  const asc=await outcome(pageCall('pending',1,100));assert.equal(asc.ok,true);const byId=a=>[...a].sort((a,b)=>a.id.localeCompare(b.id));assert.deepEqual({...desc.result,cases:byId(desc.result.cases)},{...asc.result,cases:byId(asc.result.cases)},'SUPPLIER_VALUES_AND_EVENTS_EXACT');
  for(let n=0;n<3;n++)report.supplier.ascMeasurements.push(await explain(pageCall('pending',1)));
  report.ok=true;return report;
 } finally {
  await s.close();const check=await session();try{assert.deepEqual(JSON.parse((await check.query(definitionsSql)).trim()),before,'ROLLBACK_RESTORES_ALL_READER_DEFINITIONS_CONFIG_ACL');report.rollbackExact=true;await record(report);}finally{await check.close();}
 }
}
