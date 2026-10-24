// Full requested volume on a fresh disposable212 database. Historical rows
// are synthetic; 100 current sales/replacements/returns use real coordinators.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {root,container,assertLocal212,json,sql,auth,save,frozenSources} from './context.mjs';
const params={skus:3000,families:120,customers:500,suppliers:30,orders:50000,modern:100,receipts:4000,payments:20000,legacy_returns:1000,shifts:730,movements:200000,days:365};
const owner='92900001-0000-4000-8000-000000000001';
const report={kind:'scale212-seed',params,managedAccess:false,startedAt:new Date().toISOString()};
try{
 report.state=await assertLocal212();report.source=await frozenSources();
 assert.equal(await json('SELECT to_jsonb(count(*)) FROM orders;'),0,'FRESH_DATABASE_REQUIRED');
 // No outbound order pushes or cron execution in local performance fixtures.
 await sql("DO $$ DECLARE r record;BEGIN FOR r IN SELECT jobid FROM cron.job LOOP PERFORM cron.unschedule(r.jobid);END LOOP;END $$;ALTER TABLE orders DISABLE TRIGGER trg_notify_new_website_order_push;");
 const fixture=await readFile(path.join(root,'scripts/testing/package-e-scale-fixture.sql'),'utf8');
 const [setup,rest]=fixture.split('-- E2_BATCH_BEGIN'),[batch,finish]=rest.split('-- E2_BATCH_END');
 const body=setup+auth(batch.replaceAll('__E2_FROM__','1').replaceAll('__E2_TO__','100'),owner)+finish;
 await new Promise((resolve,reject)=>{const p=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-q','-At','-v','ON_ERROR_STOP=1',...Object.entries(params).flatMap(([k,v])=>['-v',`${k}=${v}`])],{cwd:root,windowsHide:true,stdio:['pipe','ignore','pipe']});let err='';p.stderr.on('data',s=>err+=s);p.on('error',reject);p.on('close',code=>code===0?resolve():reject(Error(err)));p.stdin.end(body);});
 report.counts=await json("SELECT jsonb_build_object('products',(SELECT count(*) FROM products),'sellableSkus',(SELECT count(*) FROM products WHERE NOT is_flavor_master),'customers',(SELECT count(*) FROM customers),'orders',(SELECT count(*) FROM orders),'movements',(SELECT count(*) FROM inventory_movements));");
 assert.deepEqual(report.counts,{products:3120,sellableSkus:3000,customers:500,orders:50000,movements:200000});
 report.consistency=await json("SELECT jsonb_build_object('orderTotals',(SELECT count(*) FROM orders o WHERE total_in_minor_units<>(SELECT sum(line_total_in_minor_units) FROM order_items WHERE order_id=o.id)),'movementArithmetic',(SELECT count(*) FROM inventory_movements WHERE balance_after<>balance_before+quantity),'stockTotals',(SELECT count(*) FROM inventory_balances b WHERE on_hand_quantity<>(SELECT sum(quantity) FROM inventory_movements WHERE product_id=b.product_id AND warehouse_id=b.warehouse_id)));");
 assert.ok(Object.values(report.consistency).every(n=>n===0));report.ok=true;
}catch(e){report.ok=false;report.error=e.message;process.exitCode=1;}
finally{report.endedAt=new Date().toISOString();await save('scale-seed',report);console.log(JSON.stringify({ok:report.ok,counts:report.counts,error:report.error}));}

