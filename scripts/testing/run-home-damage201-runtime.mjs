// Owner19Oct package2. Real local writers only; no hosted configuration.
import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
import {schemaCatalogSql,catalogDifference} from './schema-catalog.mjs';
import {assertPackageDDbLint} from './package-d-db-lint-policy.mjs';

const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile),project='nawasrah-home-damage201-test';
const cli=path.join(root,'node_modules/supabase/dist/supabase.js'),executor=executorFor(['--container','supabase_db_'+project]);
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-home-damage201-'));
const report={output,startedAt:new Date().toISOString(),managedAccess:false,cases:[]};let local,stage='bootstrap200',counter=0;
const id=n=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`,owner=id(1),branch=id(200),warehouse=id(201),product=id(103);
const q=v=>"'"+String(v).replaceAll("'","''")+"'",j=v=>q(JSON.stringify(v))+'::jsonb',key=()=>`home201-runtime-${String(++counter).padStart(8,'0')}`;
const sql=async input=>{const r=await executeInput(executor,input);assert.equal(r.code,0,r.stderr);return r.stdout.trim();};
const json=async input=>JSON.parse((await sql(input)).split('\n').at(-1));
const auth=(body,role='authenticated',actor=owner)=>`BEGIN;SELECT set_config('request.jwt.claims',${q(JSON.stringify({sub:actor,role,aal:'aal2'}))},true);SET LOCAL ROLE ${role};${body}COMMIT;`;
const rpc=call=>json(auth(`SELECT public.${call};`));
const record=(name,details={})=>{const v={name,passed:true,...details};report.cases.push(v);console.log(JSON.stringify(v));};
const receive=(n,cost)=>`create_direct_supplier_receipt_v2(p_supplier_id:=${q(id(301))},p_branch_id:=${q(branch)},p_warehouse_id:=${q(warehouse)},p_idempotency_key:=${q(key())},p_payment_method:='deferred',p_lines:=${j([{client_line_id:id(900+counter),line_kind:'base_unit',commercial_quantity:n,base_unit_name:'باكيت',gross_amount_in_minor_units:n*cost,line_discount_in_minor_units:0,components:[{product_id:product,base_quantity:n}]}])})`;
const sale=async(n=1,method='cash')=>{
 const r=await rpc(`create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(id(401))},'تلف اختبار',${q(method)},${j([{commercial_line_kind:'base_unit',product_id:product,base_quantity:n,price_authority:'server_catalog',line_discount_in_minor_units:0}])},0,${method==='debt'?0:n*100000},${q(key())})`);
 assert.equal(r.success,true);return json(`SELECT jsonb_build_object('order',order_id,'item',id) FROM order_items WHERE order_id=${q(r.orderId)};`);
};
const returnCall=(s,physical=true)=>{
 const items=[{return_scope:'base_unit',order_item_id:s.item,quantity:1,stock_disposition:'damaged'}];
 if(!physical)return `settle_sales_return_v1(${q(s.order)},${q(key())},${j(items)},'تالف نهائي','cash',NULL,NULL)`;
 return `settle_admin_sales_return_v1(${q(s.order)},${q(key())},${j(items)},${j([{root_source_kind:'base_order_item',root_source_id:s.item,source_kind:'base_order_item',source_id:s.item,product_id:product,quantity:1,sellable_restock_quantity:0,defect_non_sellable_quantity:1,customer_damage_quantity:0}])},'تالف نهائي','cash',NULL,NULL)`;
};
const adjust=n=>`adjust_inventory_stock(${q(warehouse)},${q(product)},${n},'انكسر بالمحل (اختبار)','damage')`;
const stock=()=>json(`SELECT jsonb_build_object('quantity',b.on_hand_quantity,'reserved',b.reserved_quantity,'cost',p.wac_cost_in_minor_units_exact) FROM products p JOIN inventory_balances b ON b.product_id=p.id WHERE p.id=${q(product)} AND b.warehouse_id=${q(warehouse)};`);
const snapshot=()=>sql("SELECT md5(COALESCE(string_agg(to_jsonb(t)::text,'|' ORDER BY id),'')) FROM inventory_damage_events t;");
// Hold the actual first writer uncommitted; release only after observing the
// opposite writer blocked on PostgreSQL's shared lock, never a timing guess.
async function heldWriter(call){
 const child=spawn('docker',['exec','-i','supabase_db_'+project,'psql','-U','postgres','-d','postgres','-X','-q','-At','-v','ON_ERROR_STOP=1'],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
 let out='',err='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve(out):reject(Error(err)));});
 const ready=new Promise((resolve,reject)=>{child.stdout.on('data',chunk=>{out+=chunk;if(out.includes('HOME201_LOCK_READY'))resolve();});child.stderr.on('data',chunk=>{err+=chunk;});child.on('close',()=>reject(Error(err||'writer closed before ready')));});
 child.stdin.write(auth('SELECT public.'+call+';').replace('COMMIT;',"SELECT 'HOME201_LOCK_READY';")+"\n");
 await ready;return {release:async()=>{child.stdin.end('COMMIT;');await done;}};
}
async function assertWaiting(){
 for(let n=0;n<80;n++){
  if(await sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='home201-waiting' AND wait_event_type='Lock';")==='1')return;
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 assert.fail('opposite writer never blocked on shared product/balance lock');
}
const facts=(b='NULL')=>json(`SELECT public.phase6_financial_facts_internal(${b},date_trunc('day',NOW() AT TIME ZONE 'Asia/Amman') AT TIME ZONE 'Asia/Amman',(date_trunc('day',NOW() AT TIME ZONE 'Asia/Amman')+INTERVAL '1 day') AT TIME ZONE 'Asia/Amman','Asia/Amman',true);`);
try{
 const boot=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:{...process.env,
  NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'200',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
  NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 local=JSON.parse(boot.stdout).isolatedProjectRoot;stage='fixture200';
 await sql('ALTER TABLE orders DISABLE TRIGGER trg_notify_new_website_order_push;SELECT cron.alter_job(jobid,active:=false) FROM cron.job;');
 await sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
 await sql(`UPDATE products SET sale_price_in_minor_units=100000 WHERE id=${q(product)};`);
 await rpc(`open_cash_shift(${q(branch)},1000000)`);await rpc(receive(20,60000));
 const old=await sale();await rpc(returnCall(old));const before=await facts();assert.equal(before.sales.netProfitInMinorUnits,-60000);
 const catalogBefore=await json(schemaCatalogSql),migration=await readFile(path.join(root,'supabase/migrations/201_home_collections_and_damage_losses.sql'),'utf8');
 stage='apply201';await sql(migration);
 assert.equal(await sql('SELECT count(*) FROM inventory_damage_events;'),'0','no historical backfill');
 const delta=catalogDifference(catalogBefore,await json(schemaCatalogSql));
 for(const d of delta.filter(d=>d.section==='functions'&&d.before)){
  assert.ok(['adjust_inventory_stock','phase6_financial_facts_internal','_get_home_dashboard_before133'].some(n=>d.before.identity.startsWith(n+'(')));
  const a={...d.before},b={...d.after};delete a.definition;delete b.definition;assert.deepEqual(a,b,'existing function ACL/owner/config/volatility unchanged');
 }
 const after=await facts();assert.equal(after.sales.netProfitInMinorUnits,-60000);assert.deepEqual(after.sales.damageLosses,{totalInMinorUnits:0,additionalInMinorUnits:0,alreadyIncludedInMinorUnits:0,reasons:[]});
 record('201 adds no historical loss or client grant;old return60 stays loss60',{catalogDifferences:delta.length});
 stage='new return immutable historical cost';
 const s=await sale(),call=returnCall(s);await rpc(call);
 let f=await facts();assert.equal(f.sales.netProfitInMinorUnits,-120000);assert.equal(f.sales.damageLosses.alreadyIncludedInMinorUnits,60000);assert.equal(f.sales.damageLosses.additionalInMinorUnits,0);
 const firstSnapshot=await snapshot();await rpc(call);assert.equal(await snapshot(),firstSnapshot,'idempotent return does not duplicate damage evidence');
 record('new full return100/cost60 contributes loss60 once,not120;replay zero new evidence');
 stage='legacy supported return request fallback';const s2=await sale();await rpc(returnCall(s2,false));f=await facts();assert.equal(f.sales.damageLosses.alreadyIncludedInMinorUnits,120000);assert.equal(f.sales.netProfitInMinorUnits,-180000);
 record('existing direct return RPC fallback captures historical cost once');
 stage='shop damage and exact WAC';
 let b=await stock();await rpc(adjust(b.quantity-2));f=await facts();assert.equal(f.sales.damageLosses.additionalInMinorUnits,120000);assert.equal(f.sales.netProfitInMinorUnits,-300000);
 assert.equal((await stock()).cost,60000);const frozen=await snapshot();await rpc(receive(10,120000));assert.equal(await snapshot(),frozen);assert.notEqual((await stock()).cost,60000);
 assert.equal((await facts()).sales.netProfitInMinorUnits,-300000);assert.equal((await facts(q(id(999)))).sales.damageLosses.totalInMinorUnits,0);
 b=await stock();const cost=b.cost;await rpc(adjust(b.quantity-3));f=await facts();assert.equal(f.sales.damageLosses.additionalInMinorUnits,120000+Math.round(3*cost));
 record('shop loss atomic/movement-time exactWAC,round quantity*cost once,never repriced by receiving',{secondWac:cost,additional:f.sales.damageLosses.additionalInMinorUnits});
 stage='collection/home/report/shift parity';await sale(2,'cliq');
 const debt=await sale(2,'debt');await rpc(`record_customer_order_payment_once(${q(debt.order)},25000,'cash',NULL,NULL,${q(key())})`);
 f=await facts();const h=await rpc('get_home_dashboard()');
 assert.equal(h.summary.todayCashCollectedInMinorUnits,f.cashFlow.cashCollectedInMinorUnits);assert.equal(h.summary.todayCliqCollectedInMinorUnits,f.cashFlow.cliqCollectedInMinorUnits);
 assert.equal(f.cashFlow.cashCollectedInMinorUnits,325000);assert.equal(f.cashFlow.cliqCollectedInMinorUnits,200000);assert.equal(f.cashFlow.cashRefundedInMinorUnits,300000);
 const day=f.dailyBreakdown.at(-1);assert.equal(day.cashCollectedInMinorUnits,325000);assert.equal(day.cliqCollectedInMinorUnits,200000);
 const r=await rpc(`get_operational_business_report(${q(branch)},(NOW() AT TIME ZONE 'Asia/Amman')::DATE,(NOW() AT TIME ZONE 'Asia/Amman')::DATE)`);
 assert.equal(r.sales.netProfitInMinorUnits,f.sales.netProfitInMinorUnits);assert.deepEqual(r.sales.damageLosses,f.sales.damageLosses);assert.equal(h.summary.monthProfitInMinorUnits,f.sales.netProfitInMinorUnits);
 record('home/day/report canonical cash325+CliQ200 before refunds300,profit matches',{cash:325000,cliq:200000,refund:300000});
 stage='collection reversal keeps refund distinct';
 const payment=await rpc(`record_customer_order_payment_once(${q(debt.order)},7000,'cash',NULL,NULL,${q(key())})`);
 await rpc(`reverse_customer_order_payment(${q(payment.payment_id)},'دفعة خاطئة للاختبار')`);
 f=await facts();assert.equal(f.cashFlow.cashCollectedInMinorUnits,325000);assert.equal(f.cashFlow.cashRefundedInMinorUnits,300000);
 assert.equal((await rpc('get_home_dashboard()')).summary.todayCashCollectedInMinorUnits,325000);
 record('customer payment reversal cancels collection once;refunds remain a separate flow');
 stage='rollback and immutable evidence';b=await stock();const unchanged=await snapshot();
 await sql(auth(`SELECT public.${adjust(b.quantity)};`));assert.equal(await snapshot(),unchanged,'zero delta produces no new loss');
 await sql(`BEGIN;${auth(`SELECT public.${adjust(b.quantity-1)};`).replace('BEGIN;','').replace('COMMIT;','')}ROLLBACK;`);assert.equal(await snapshot(),unchanged);assert.deepEqual(await stock(),b);
 for(const mutation of ['UPDATE inventory_damage_events SET reason=reason','DELETE FROM inventory_damage_events','TRUNCATE inventory_damage_events']){
  const denied=await executeInput(executor,mutation+';');assert.notEqual(denied.code,0);assert.match(denied.stderr,/DAMAGE_EVIDENCE_IMMUTABLE/);
 }
 for(const role of ['anon','authenticated','service_role'])for(const call of ["inventory_damage_period_totals_internal(NULL,NOW(),NOW())",'capture_final_return_damage_internal()','inventory_damage_reject_mutation_internal()']){
  const denied=await executeInput(executor,auth(`SELECT public.${call};`,role));assert.notEqual(denied.code,0);assert.match(denied.stderr,/permission denied/);
 }
 for(const role of ['anon','authenticated'])for(const statement of ['SELECT * FROM inventory_damage_events','DELETE FROM inventory_damage_events','INSERT INTO inventory_damage_events DEFAULT VALUES']){
  const denied=await executeInput(executor,auth(statement+';',role));assert.notEqual(denied.code,0);assert.match(denied.stderr,/permission denied/);
 }
 record('loss evidence RPC-only,private helpers denied,immutable even postgres;zero/rollback produces no evidence');
 stage='actual receive/damage concurrency both directions';
 // Receipt60000 first: the blocked adjustment must see committed updated WAC.
 b=await stock();let held=await heldWriter(receive(10,60000));
 let waiting=executeInput(executor,"SET application_name='home201-waiting';"+auth('SELECT public.'+adjust(b.quantity+10-1)+';'));
 try{await assertWaiting();}finally{await held.release();}
 let result=await waiting;assert.equal(result.code,0,result.stderr);
 let latest=await json("SELECT jsonb_build_object('cost',unit_cost_in_minor_units_exact,'quantity',quantity) FROM inventory_damage_events WHERE origin='shop' ORDER BY recorded_at DESC LIMIT 1;");
 assert.equal(latest.cost,(await stock()).cost);assert.equal(latest.quantity,1);
 // Damage first: later receipt must weight the post-damage balance; the loss
 // remains at the old cost even after the waiting receipt changes that cost.
 b=await stock();held=await heldWriter(adjust(b.quantity-1));
 waiting=executeInput(executor,"SET application_name='home201-waiting';"+auth('SELECT public.'+receive(10,120000)+';'));
 try{await assertWaiting();}finally{await held.release();}
 result=await waiting;assert.equal(result.code,0,result.stderr);
 latest=await json("SELECT jsonb_build_object('cost',unit_cost_in_minor_units_exact,'quantity',quantity) FROM inventory_damage_events WHERE origin='shop' ORDER BY recorded_at DESC LIMIT 1;");
 assert.equal(latest.cost,b.cost);assert.equal(latest.quantity,1);
 assert.ok(Math.abs((await stock()).cost-((b.quantity-1)*b.cost+1200000)/(b.quantity-1+10))<0.000002);
 record('actual receipt/damage serialize in both directions,observed lock wait,no deadlock,correct WAC and frozen loss');
 stage='replacement physical loss uses issuance cost';
 const replacementSale=await sale(),replacement=await rpc(`settle_sales_replacement_v1(${q(replacementSale.order)},${q(key())},${j([{sourceKind:'base_order_item',sourceId:replacementSale.item,quantity:1}])},'تبديل اختبار',NULL)`);
 assert.equal(replacement.success,true);
 const leaf=await json(`SELECT jsonb_build_object('id',id,'cost',replacement_unit_cost_snapshot_in_minor_units_exact) FROM sales_replacement_items WHERE operation_id=${q(replacement.operationId)};`);
 await rpc(receive(5,150000));
 const replacementReturn=`settle_admin_sales_return_v1(${q(replacementSale.order)},${q(key())},${j([{return_scope:'base_unit',order_item_id:replacementSale.item,quantity:1,stock_disposition:'damaged'}])},${j([{root_source_kind:'base_order_item',root_source_id:replacementSale.item,source_kind:'replacement_item',source_id:leaf.id,product_id:product,quantity:1,sellable_restock_quantity:0,defect_non_sellable_quantity:1,customer_damage_quantity:0}])},'تلف البديل','cash',NULL,NULL)`;
 await rpc(replacementReturn);
 assert.equal(await sql(`SELECT unit_cost_in_minor_units_exact FROM inventory_damage_events WHERE source_kind='replacement_item' AND source_id=${q(leaf.id)};`),Number(leaf.cost).toFixed(6));
 record('replacement final damage stores physical leaf issuance cost,never current WAC');
 stage='parcel historical damage and sellable recovery';
 for(const [pid,cost] of [[id(101),1000],[id(102),2000]])await rpc(`create_direct_supplier_receipt_v2(p_supplier_id:=${q(id(301))},p_branch_id:=${q(branch)},p_warehouse_id:=${q(warehouse)},p_idempotency_key:=${q(key())},p_payment_method:='deferred',p_lines:=${j([{client_line_id:id(800+counter),line_kind:'base_unit',commercial_quantity:10,base_unit_name:'باكيت',gross_amount_in_minor_units:10*cost,line_discount_in_minor_units:0,components:[{product_id:pid,base_quantity:10}]}])})`);
 const config=await rpc(`save_product_parcel_configuration_v1(${q(id(100))},'configurable_mix',true,5,ARRAY[${q(id(101))},${q(id(102))}]::uuid[])`);await rpc("set_configurable_parcel_feature_state_v1('ENABLED')");
 const profitBefore=(await facts()).sales.netProfitInMinorUnits;
 const parcelSale=await rpc(`create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(id(401))},'طرد تلف','cash',${j([{commercial_line_kind:'configurable_parcel',family_product_id:id(100),parcel_configuration_id:config.configuration.id,configuration_revision:config.configuration.configuration_revision,price_authority:'server_catalog',line_discount_in_minor_units:0,parcel_instances:[{components:[{product_id:id(101),base_quantity:2},{product_id:id(102),base_quantity:3}]}]}])},0,5000,${q(key())})`);assert.equal(parcelSale.success,true);
 const parcel=await json(`SELECT jsonb_build_object('item',i.id,'id',p.id,'components',(SELECT jsonb_agg(jsonb_build_object('id',c.id,'product',c.product_id,'quantity',c.base_quantity)) FROM order_parcel_components c WHERE c.parcel_instance_id=p.id)) FROM order_items i JOIN order_parcel_instances p ON p.order_item_id=i.id WHERE i.order_id=${q(parcelSale.orderId)};`);
 const items=[{return_scope:'parcel_instance',order_item_id:parcel.item,parcel_instance_id:parcel.id,components:parcel.components.map(c=>({parcel_component_id:c.id,accepted_quantity:c.quantity,rejected_quantity:0,accepted_condition:c.product===id(101)?'supplier_defect':'sellable',accepted_stock_disposition:c.product===id(101)?'non_sellable':'restock',rejection_reason:null,rejected_stock_disposition:null}))}];
 const physical=parcel.components.map(c=>({root_source_kind:'parcel_component',root_source_id:c.id,source_kind:'parcel_component',source_id:c.id,product_id:c.product,quantity:c.quantity,sellable_restock_quantity:c.product===id(101)?0:c.quantity,defect_non_sellable_quantity:c.product===id(101)?c.quantity:0,customer_damage_quantity:0}));
 const parcelReturn=await rpc(`settle_admin_sales_return_v1(${q(parcelSale.orderId)},${q(key())},${j(items)},${j(physical)},'تلف جزء الطرد','cash',NULL,NULL)`);assert.equal(parcelReturn.success,true);
 assert.equal(await sql(`SELECT SUM(loss_in_minor_units) FROM inventory_damage_events WHERE return_event_id=${q(parcelReturn.returnId)};`),'2000');
 assert.equal((await facts()).sales.netProfitInMinorUnits,profitBefore-2000);
 record('parcel damaged2*1000 loss2000 once;other3*2000 recover6000 and create no damage loss');
 const completeEvidence=await snapshot();
 stage='replay and lint';const catalog=await json(schemaCatalogSql);await sql(migration);assert.deepEqual(await json(schemaCatalogSql),catalog);assert.equal(await snapshot(),completeEvidence);
 const {stdout:lint}=await exec(process.execPath,[cli,'db','lint','--local','--level','warning','--workdir',local],{cwd:root,windowsHide:true,timeout:120000,maxBuffer:1024**2});assertPackageDDbLint(lint);
 record('201 replay catalog/evidence unchanged;DB-lint existing policy retained');report.ok=true;
}catch(error){report.ok=false;report.stage=stage;report.error=error.message;process.exitCode=1;}
finally{
 if(local)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true,maxBuffer:1024**2});
 report.endedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}
