// Original full two-year fixture;never a reduced-size performance acceptance.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
import {schemaCatalogSql,catalogDifference} from './schema-catalog.mjs';
import {fullScale,assertCounts,timingSummary} from './package-e-scale-contract.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile),project='nawasrah-product-receiving205-scale-test';
const cli=path.join(root,'node_modules/supabase/dist/supabase.js'),executor=executorFor(['--container','supabase_db_'+project]);
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-product-receiving205-scale-'));
const report={startedAt:new Date().toISOString(),output,profile:'FULL',managedAccess:false,parameters:fullScale};let local,stage='bootstrap204';
const id=(k,n)=>`929${String(k).padStart(5,'0')}-0000-4000-8000-${String(n).padStart(12,'0')}`,owner=id(1,1);
const q=v=>"'"+String(v).replaceAll("'","''")+"'";
const auth=body=>`BEGIN;DO $$BEGIN PERFORM set_config('request.jwt.claims',${q(JSON.stringify({sub:owner,role:'authenticated',aal:'aal2'}))},true);END$$;SET LOCAL ROLE authenticated;${body}COMMIT;`;
const sql=async(text,variables={})=>{const r=await executeInput({...executor,args:[...executor.args,...Object.entries(variables).flatMap(([k,v])=>['-v',k+'='+v])]},text);assert.equal(r.code,0,r.stderr.slice(-6000));return r.stdout.trim();};
const json=async text=>JSON.parse(await sql(text));
const explain=query=>`SET LOCAL statement_timeout='60s';EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) ${query}`;
try{
 const boot=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:{...process.env,
  NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'204',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
  NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 local=JSON.parse(boot.stdout).isolatedProjectRoot;
 await exec('docker',['update','--cpus','4','supabase_db_'+project],{windowsHide:true});
 await sql('ALTER TABLE public.orders DISABLE TRIGGER trg_notify_new_website_order_push;SELECT cron.alter_job(jobid,active:=false) FROM cron.job;');
 stage='full two-year fixture';console.log(JSON.stringify({stage,parameters:fullScale}));
 const fixture=await readFile(path.join(root,'scripts/testing/package-e-scale-fixture.sql'),'utf8');
 const [setup,rest]=fixture.split('-- E2_BATCH_BEGIN'),[batch,finish]=rest.split('-- E2_BATCH_END');assert.ok(setup&&batch&&finish);
 const batches=[];for(let from=1;from<=fullScale.modern;from+=100)batches.push(auth(batch.replaceAll('__E2_FROM__',String(from)).replaceAll('__E2_TO__',String(Math.min(from+99,fullScale.modern)))));
 await sql(setup+batches.join('\n')+finish,fullScale);
 const counts=await json(`SELECT jsonb_build_object('skus',(SELECT COUNT(*) FROM products WHERE NOT is_flavor_master),'families',(SELECT COUNT(*) FROM products WHERE is_flavor_master),
  'customers',(SELECT COUNT(*) FROM customers),'suppliers',(SELECT COUNT(*) FROM suppliers),'orders',(SELECT COUNT(*) FROM orders),'items',(SELECT COUNT(*) FROM order_items),
  'receipts',(SELECT COUNT(*) FROM supplier_receipts)+(SELECT COUNT(*) FROM purchase_receipts),'payments',(SELECT COUNT(*) FROM customer_payments),
  'returns',(SELECT COUNT(*) FROM sales_returns)+(SELECT COUNT(*) FROM sales_return_events),'replacements',(SELECT COUNT(*) FROM sales_replacement_events WHERE issuance_status='issued'),
  'shifts',(SELECT COUNT(*) FROM cash_shifts),'movements',(SELECT COUNT(*) FROM inventory_movements));`);
 assertCounts(counts,fullScale);report.counts=counts;console.log(JSON.stringify({stage:'exact full counts',counts}));


 stage='apply205 on full204 fixture';const beforeCatalog=await json(schemaCatalogSql),home=await json(auth('SELECT public.get_home_dashboard();'));
 assert.equal(home.financialFactsStatus,'available');await sql(await readFile(path.join(root,'supabase/migrations/205_product_receiving_display_read_models.sql'),'utf8'));
 const delta=catalogDifference(beforeCatalog,await json(schemaCatalogSql));assert.equal(delta.length,2);assert.ok(delta.every(d=>d.section==='functions'&&d.before===null));
 const productIds=await json("SELECT jsonb_agg(product_id ORDER BY product_id) FROM (SELECT DISTINCT product_id FROM supplier_receipt_items ORDER BY product_id LIMIT100) ids;".replace('LIMIT100','LIMIT 100'));assert.equal(productIds.length,100);
 const callFor=ids=>'get_receiving_purchase_context(ARRAY['+ids.map(q).join(',')+']::uuid[])';const all=await json(auth('SELECT public.'+callFor(productIds)+';'));assert.equal(all.products.length,100);assert.ok(all.products.every(p=>p.lastPurchase&&p.lastPurchase.grossInMinorUnits/p.lastPurchase.baseQuantity===500));
 const receiptId=await sql('SELECT id FROM supplier_receipts ORDER BY received_at DESC,id DESC LIMIT 1;');const display=await json(auth('SELECT public.get_supplier_receipt_display_context('+q(receiptId)+');'));assert.equal(display.lines.length,3);assert.ok(display.lines.every(l=>l.kind==='base_unit'&&l.baseQuantity===100&&l.grossInMinorUnits===50000));
 report.canonical={products:100,quotedUnitPriceInMinorUnits:500,receiptLines:3,grossPerLine:50000,physicalPerLine:100,homeUnchanged:true};report.timings=[];
 const benches=[['last-purchase1',callFor(productIds.slice(0,1))],['last-purchase100',callFor(productIds)],['receipt-display','get_supplier_receipt_display_context('+q(receiptId)+')']];
 for(const[name,call]of benches){stage='FULL205 p95 '+name;const query=auth(explain('SELECT public.'+call+';')).replace('BEGIN;','BEGIN READ ONLY;');for(let n=0;n<3;n++)await json(query);const samples=[];let plan;for(let n=0;n<20;n++){plan=await json(query);samples.push(plan[0]['Execution Time']);}const summary=timingSummary(samples);report.timings.push({name,limitMs:3000,...summary,lastPlan:plan});console.log(JSON.stringify({stage,...summary}));assert.ok(summary.p95<3000,'FULL205_READER_P95_EXCEEDS_EXISTING_3_SECOND_READ_GATE:'+name);}
 assert.deepEqual((await json(auth('SELECT public.get_home_dashboard();'))).summary,home.summary);
 report.ok=true;
}catch(error){report.ok=false;report.stage=stage;report.error=error.message;process.exitCode=1;}
finally{if(local)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true,maxBuffer:1024**2});report.endedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+String.fromCharCode(10));console.log(JSON.stringify({ok:report.ok,output,error:report.error,counts:report.counts,timings:report.timings?.map(({name,p95})=>({name,p95}))}));}
