import {spawn} from 'node:child_process';
import {auth,sql,json,q,save,container,root,assertLocal212} from './context.mjs';
const owner='92900001-0000-4000-8000-000000000001',branch='92900010-0000-4000-8000-000000000002';
const report={kind:'long-period212',startedAt:new Date().toISOString(),managedAccess:false,results:[]};
const damageOnly=process.argv.includes('--damage-only'),evidenceName=damageOnly?'damage-range':'long-period';
await assertLocal212();
const shift=await json(`SELECT to_jsonb(id) FROM cash_shifts WHERE branch_id=${q(branch)} AND status='open';`);
for(const [name,call]of [
 ['annual-report',`get_operational_business_report(${q(branch)},CURRENT_DATE-364,CURRENT_DATE)`],
 ['cash-sale-details',`get_cash_shift_movement_page(${q(shift)},'sales','cash',1,25)`],
 ['cash-collection-details',`get_cash_shift_movement_page(${q(shift)},'receipts','cash',1,25)`],
 ['damage-history-range',"get_damage_history_page_v1('range',CURRENT_DATE-364,CURRENT_DATE,'all',1,25)"]].filter(([name])=>!damageOnly||name==='damage-history-range')){
 const item={name,call,samples:[]};
 try{for(let n=0;n<3;n++){const text=await sql(auth(`EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) SELECT public.${call};`,owner));const plan=JSON.parse(text.slice(text.search(/^\s*\[/m)))[0];item.samples.push({ms:plan['Execution Time'],plan});}item.ok=true;}
 catch(e){item.ok=false;item.error=e.message;}
 if(item.samples.some(s=>s.ms>2000)||!item.ok){
  // Capture nested PostgreSQL plans, not just the outer RPC Result node.
  item.nested=await new Promise((resolve,reject)=>{const p=spawn('docker',['exec','-i',container,'psql','-U','supabase_admin','-d','postgres','-X','-q','-At','-v','ON_ERROR_STOP=1'],{cwd:root,windowsHide:true,stdio:['pipe','ignore','pipe']});let err='';p.stderr.on('data',s=>err+=s);p.on('error',reject);p.on('close',code=>resolve({code,plansAndDiagnostics:err}));p.stdin.end("SET statement_timeout='60s';LOAD 'auto_explain';SET auto_explain.log_min_duration='100ms';SET auto_explain.log_analyze=on;SET auto_explain.log_buffers=on;SET auto_explain.log_nested_statements=on;SET auto_explain.log_format=json;SET client_min_messages=log;"+auth(`SELECT public.${call};`,owner));});
 }
 report.results.push(item);await save(evidenceName,report);console.log(JSON.stringify({name,ms:item.samples.map(s=>s.ms),error:item.error}));
}
report.endedAt=new Date().toISOString();await save(evidenceName,report);
