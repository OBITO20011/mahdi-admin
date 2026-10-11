import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {directReceiptV2Lines,purchaseReceiptV2Lines} from '../../src/utils/receivingV2.ts';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..');
const project='nawasrah-receiving-unit-test',container=`supabase_db_${project}`;
const owner='92600000-0000-4000-8000-000000000001',branch='92600000-0000-4000-8000-000000000200',warehouse='92600000-0000-4000-8000-000000000201';
const q=value=>`'${String(value).replaceAll("'","''")}'`,j=value=>`${q(JSON.stringify(value))}::jsonb`;
let workdir,stage='bootstrap';
const sql=text=>new Promise((resolve,reject)=>{
 const child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-q','-At','-v','ON_ERROR_STOP=1'],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
 let out='',err='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
 child.stdout.on('data',chunk=>{out+=chunk;});child.stderr.on('data',chunk=>{err+=chunk;});
 child.on('error',reject);child.on('close',code=>code===0?resolve(out.trim()):reject(Error(`${stage}: ${err}`)));
 child.stdin.end(`SET statement_timeout='60s';SET lock_timeout='30s';\n${text}`);
});
const json=async text=>JSON.parse((await sql(text)).split(/\r?\n/u).filter(Boolean).at(-1));
const rpc=command=>json(`BEGIN;SELECT set_config('request.jwt.claims',${q(JSON.stringify({sub:owner,role:'authenticated',aal:'aal2'}))},true);SET LOCAL ROLE authenticated;SELECT public.${command};COMMIT;`);
async function identities(name){
 const supplier=randomUUID(),product=randomUUID();
 await sql(`INSERT INTO suppliers(id,company_name,is_active) VALUES(${q(supplier)},${q(name)},true);
 INSERT INTO products(id,sku,name_ar,category_id,unit_id,purchase_unit_id,sale_unit_id,units_per_purchase_unit,units_per_sale_unit,
 default_purchase_price_in_minor_units,default_sale_price_in_minor_units,cost_price_in_minor_units,sale_price_in_minor_units,
 wholesale_price_in_minor_units,min_stock_level,is_active,is_flavor_master,wac_cost_in_minor_units_exact)
 SELECT ${q(product)},${q(`UNITS-${product}`)},${q(name)},category_id,unit_id,purchase_unit_id,sale_unit_id,24,24,1000,2000,0,100,2000,0,true,false,0
 FROM products WHERE id='92600000-0000-4000-8000-000000000103';`);
 return {supplier,product};
}
async function inspect(f,table,receiptId,expectedQuantity,expectedPayable){
 const row=await json(`SELECT jsonb_build_object('balance',s.current_balance_in_minor_units,
 'payable',r.supplier_invoice_payable_total_snapshot_in_minor_units,
 'wac',p.wac_cost_in_minor_units_exact,'quantity',(SELECT SUM(on_hand_quantity) FROM inventory_balances WHERE product_id=p.id),
 'wacMatches',p.wac_cost_in_minor_units_exact=round(${expectedPayable}::numeric/${expectedQuantity},6),
 'defaults',jsonb_build_array(p.units_per_purchase_unit,p.default_purchase_price_in_minor_units,p.sale_price_in_minor_units,p.default_sale_price_in_minor_units))
 FROM suppliers s CROSS JOIN products p CROSS JOIN ${table} r
 WHERE s.id=${q(f.supplier)} AND p.id=${q(f.product)} AND r.id=${q(receiptId)};`);
 assert.equal(row.balance,expectedPayable);assert.equal(row.payable,expectedPayable);
 assert.equal(row.quantity,expectedQuantity);assert.equal(row.wacMatches,true);
 assert.deepEqual(row.defaults,[24,1000,100,2000]);return row;
}
const matrix=[
 {name:'one package 1.000/24',quotes:[[1,24,1000,0]],partial:false},
 {name:'100 packages 100.000/2400',quotes:[[100,24,1000,0]],partial:false},
 {name:'indivisible 1.000/7',quotes:[[1,7,1000,0]],partial:false},
 {name:'line discount 1.000-0.123',quotes:[[1,7,1000,123]],partial:false},
 {name:'same SKU package plus two individual units',quotes:[[1,24,1000,0],[2,1,50,0]],partial:false},
 {name:'partial PO one of two packages',quotes:[[1,24,1000,0]],partial:true},
];
try{
 const {stdout}=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,timeout:600000,maxBuffer:8*1024*1024,env:{...process.env,NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'137',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 const built=JSON.parse(stdout);assert.equal(built.ok,true);workdir=built.isolatedProjectRoot;
 console.info(JSON.stringify({stage:'isolated 001-137 ready',dbPortGuard:built.dbPortGuard}));
 await sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
 const results=[];
 for(const c of matrix){
  stage=c.name;
  const quantity=c.quotes.reduce((n,[count,units])=>n+count*units,0),payable=c.quotes.reduce((n,[count,,price,discount])=>n+count*price-discount,0);
  const outputs={};
  for(const mode of ['po','direct']){
   const f=await identities(`${c.name} ${mode}`);
   const directInputs=c.quotes.map(([count,units,price,discount])=>({clientLineId:randomUUID(),productId:f.product,purchaseUnitName:units===1?'باكيت':'كرتونة',baseUnitName:'باكيت',packageQuantity:count,unitsPerPackage:units,packagePriceInMinorUnits:price,discountInMinorUnits:discount}));
   let receipt;
   if(mode==='direct'){
    receipt=await rpc(`create_direct_supplier_receipt_v2(p_supplier_id:=${q(f.supplier)},p_warehouse_id:=${q(warehouse)},p_branch_id:=${q(branch)},p_supplier_invoice_number:=${q(randomUUID())},p_idempotency_key:=${q(randomUUID())},p_lines:=${j(directReceiptV2Lines(directInputs))})`);
   }else{
    const planned=directReceiptV2Lines(directInputs).map(line=>({...line,commercial_quantity:line.commercial_quantity*(c.partial?2:1),gross_amount_in_minor_units:line.gross_amount_in_minor_units*(c.partial?2:1),components:line.components.map(component=>({...component,base_quantity:component.base_quantity*(c.partial?2:1)}))}));
    const po=await rpc(`create_purchase_order_v2(p_supplier_id:=${q(f.supplier)},p_branch_id:=${q(branch)},p_warehouse_id:=${q(warehouse)},p_idempotency_key:=${q(randomUUID())},p_lines:=${j(planned)})`);
    assert.equal(po.success,true);
    await rpc(`update_purchase_order_status(${q(po.purchase_order_id)},'sent')`);await rpc(`update_purchase_order_status(${q(po.purchase_order_id)},'approved')`);
    const items=await json(`SELECT jsonb_agg(jsonb_build_object('id',id,'line',client_line_id)) FROM purchase_order_items WHERE purchase_order_id=${q(po.purchase_order_id)};`);
    const inputs=directInputs.map(input=>({purchaseOrderItemId:items.find(item=>item.line===input.clientLineId).id,productId:f.product,receivedQuantity:input.packageQuantity*input.unitsPerPackage,unitCost:0,baseUnitName:input.baseUnitName,packagePricing:{packageQuantity:input.packageQuantity,unitsPerPackage:input.unitsPerPackage,packagePriceInMinorUnits:input.packagePriceInMinorUnits,discountInMinorUnits:input.discountInMinorUnits}}));
    receipt=await rpc(`receive_purchase_order_v2(p_purchase_order_id:=${q(po.purchase_order_id)},p_warehouse_id:=${q(warehouse)},p_idempotency_key:=${q(randomUUID())},p_lines:=${j(purchaseReceiptV2Lines(inputs))})`);
    const state=await json(`SELECT jsonb_build_object('received',(SELECT SUM(received_quantity) FROM purchase_order_items WHERE purchase_order_id=${q(po.purchase_order_id)}),'status',status) FROM purchase_orders WHERE id=${q(po.purchase_order_id)};`);
    assert.equal(state.received,quantity);assert.equal(state.status,c.partial?'partially_received':'received');
   }
   assert.equal(receipt.success,true);
   outputs[mode]=await inspect(f,mode==='po'?'purchase_receipts':'supplier_receipts',receipt.receipt_id,quantity,payable);
  }
  assert.deepEqual(outputs.po,outputs.direct,'PO and direct exact money/WAC must agree');
  results.push({name:c.name,...outputs.po});console.info(JSON.stringify({passed:true,...results.at(-1)}));
 }
 console.info(JSON.stringify({ok:true,ceiling:137,results,productionAccess:0,totalIsDebtAuthority:true,databaseDerivesWac:true}));
}catch(error){console.error(JSON.stringify({ok:false,stage,message:error.message}));process.exitCode=1;}
finally{if(workdir)await exec(process.execPath,[path.join(root,'node_modules/supabase/dist/supabase.js'),'stop','--no-backup','--workdir',workdir],{cwd:root,windowsHide:true,timeout:120000,maxBuffer:1024*1024});}
