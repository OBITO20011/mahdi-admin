import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {auth,json,sql,rpc,q,j,save,output,assertLocal212,frozenSources} from './context.mjs';
const id=(kind,n)=>`929${String(kind).padStart(5,'0')}-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1,1),branch=id(10,2),warehouse=id(11,2),customer=id(13,1),product=id(15,1);
const report={kind:'performance212',startedAt:new Date().toISOString(),managedAccess:false,results:[]};
const call=(c)=>rpc(c,owner);
const sale=(method='cash')=>`create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(customer)},'فحص أداء',${q(method)},${j([{commercial_line_kind:'base_unit',product_id:product,base_quantity:1,price_authority:'server_catalog',line_discount_in_minor_units:0}])},0,${method==='cash'?1000:0},${q(randomUUID())})`;
async function bench(name,command,write=false){
 const result={name,write,samples:[],plans:[]};
 try{
  if(!write){const value=await call(command());assert.ok(value&&value.success!==false,'ERROR_RESPONSE_IS_NOT_A_TIMING_PASS');result.responseKeys=Object.keys(value);}
  for(let n=-3;n<20;n++){
   const c=command(),start=performance.now();
   const planText=await sql(auth(`EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) SELECT public.${c};`,owner)); const plan=JSON.parse(planText.slice(planText.search(/^\s*\[/m)));
   const wallMs=performance.now()-start,serverMs=plan[0]['Execution Time'];assert.ok(Number.isFinite(serverMs));
   if(n>=0){result.samples.push({serverMs,wallMs});if(n===0||serverMs>2000)result.plans.push({call:c,plan:plan[0]});}
  }
  const sorted=result.samples.map(s=>s.serverMs).sort((a,b)=>a-b);result.summary={p50:sorted[9],p95:sorted[18],max:sorted[19],overTwoSeconds:sorted.filter(n=>n>2000).length};result.ok=true;
 }catch(e){result.ok=false;result.error=e.message;}
 report.results.push(result);await save('performance',report);console.log(JSON.stringify({name,summary:result.summary,error:result.error}));
}
try{
 report.state=await assertLocal212();report.source=await frozenSources();report.seed=JSON.parse(await readFile(path.join(output,'scale-seed.json'),'utf8'));assert.equal(report.seed.ok,true);
 const shift=await json(`SELECT to_jsonb(id) FROM cash_shifts WHERE branch_id=${q(branch)} AND status='closed' ORDER BY closed_at DESC LIMIT 1;`);
 for(const [name,c]of [
 ['home','get_home_dashboard()'],['sales-history-today','get_sales_history_page()'],['sales-history-all',"get_sales_history_page(1,25,'all')"],
 ['inventory','get_admin_inventory_product_page()'],['daily-report',`get_operational_business_report(${q(branch)},CURRENT_DATE,CURRENT_DATE)`],
 ['monthly-report',`get_operational_business_report(${q(branch)},date_trunc('month',CURRENT_DATE)::date,CURRENT_DATE)`],
 ['cash-summary',`get_cash_shift_summary(${q(shift)})`],['damage-history',"get_damage_history_page_v1('month',NULL,NULL,'all',1,25)"]])await bench(name,()=>c);
 const existingShift=await json(`SELECT (SELECT to_jsonb(id) FROM cash_shifts WHERE branch_id=${q(branch)} AND opened_by=${q(owner)} AND status='open' LIMIT 1);`);
 report.openShift=existingShift??(await call(`open_cash_shift(${q(branch)},10000000)`)).id;
 await bench('write-sale',()=>sale(),true);
 await bench('write-receiving',()=>`create_direct_supplier_receipt_v2(p_supplier_id:=${q(id(12,1))},p_branch_id:=${q(branch)},p_warehouse_id:=${q(warehouse)},p_idempotency_key:=${q(randomUUID())},p_payment_method:='deferred',p_lines:=${j([{client_line_id:randomUUID(),line_kind:'base_unit',commercial_quantity:1,base_unit_name:'باكيت',gross_amount_in_minor_units:500,line_discount_in_minor_units:0,components:[{product_id:product,base_quantity:1}]}])})`,true);
 // A known new debt is larger than the complete measured collection series.
 for(let n=0;n<3;n++)await call(sale('debt'));
 await bench('write-collection',()=>`collect_customer_balance_v1(${q(customer)},10,'cash',${q(branch)},NULL,NULL,${q(randomUUID())})`,true);
 report.finalCounts=await json("SELECT jsonb_build_object('orders',(SELECT count(*) FROM orders),'movements',(SELECT count(*) FROM inventory_movements));");
 report.ok=report.results.every(r=>r.ok);report.sourceAfter=await frozenSources();assert.equal(report.source.sha256,report.sourceAfter.sha256);
}catch(e){report.ok=false;report.error=e.message;process.exitCode=1;}
finally{report.endedAt=new Date().toISOString();await save('performance',report);console.log(JSON.stringify({ok:report.ok,error:report.error}));}

