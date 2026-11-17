// Actual224 regression proof: the proposed9650vs9648 defect does not reproduce.
// No new migration or frozen writer changes; fixed disposable Docker target.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {startInventory224Local} from './inventory224-local.mjs';
import {directReceiptV2Lines} from '../../src/utils/receivingV2.ts';
import {schemaCatalogSql} from './schema-catalog.mjs';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';

assert.equal(process.argv.length,2,'COGS224_PROOF_NO_TARGET_ARGUMENTS');
const root=path.resolve(import.meta.dirname,'../..'),output=path.join(root,'test-results/on225-cogs224-proof');
await mkdir(output,{recursive:true});
const id=n=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const product=id(103),branch=id(200),warehouse=id(201),customer=id(401);
const q=value=>value===null?'NULL':"'"+String(value).replaceAll("'","''")+"'",j=value=>q(JSON.stringify(value))+'::jsonb';
const claims=role=>`SELECT set_config('request.jwt.claims',${j(role==='service_role'?{role}:{sub:id(1),role,aal:'aal2'})}::text,true);SET LOCAL ROLE ${role};`;
// Independent integer-rational oracle,not product legacy cost or an ERP helper.
const openingQuantity=10n,openingUnitCost=800n,receivedParcelQuantity=12n,receivedParcelCost=9600n,receivedLooseQuantity=2n,receivedLooseUnitCost=850n;
const totalQuantity=openingQuantity+receivedParcelQuantity+receivedLooseQuantity;
const totalValue=openingQuantity*openingUnitCost+receivedParcelCost+receivedLooseQuantity*receivedLooseUnitCost;
const soldQuantity=12n,roundRatio=(numerator,denominator)=>(numerator*2n+denominator)/(denominator*2n);
const expectedCogs=Number(roundRatio(totalValue*soldQuantity,totalQuantity));
assert.equal(expectedCogs,9650);assert.equal(Number(totalValue),19300);assert.equal(Number(totalQuantity),24);
const report={ok:false,baselineCeiling:224,hostedAccess:false,ownerDemoAccess:false,frozenBodyModified:false,
 oracle:{openingQuantity:Number(openingQuantity),openingUnitCost:Number(openingUnitCost),receivedParcelQuantity:Number(receivedParcelQuantity),receivedParcelCost:Number(receivedParcelCost),receivedLooseQuantity:Number(receivedLooseQuantity),receivedLooseUnitCost:Number(receivedLooseUnitCost),totalQuantity:Number(totalQuantity),totalValue:Number(totalValue),soldQuantity:Number(soldQuantity),expectedCogs},cases:[]};
let local,stage='bootstrap224';
try{
 local=await startInventory224Local(224,'reference');const sql=local.sql;
 const json=async text=>JSON.parse((await sql(text)).trim().split(/\r?\n/u).at(-1));
 assert.deepEqual(await json("SELECT jsonb_build_object('max',max(version),'files',count(*),'full',(SELECT full_accounting FROM sales_lite1.mode)) FROM supabase_migrations.schema_migrations;"),{max:'224',files:184,full:true});
 const catalogHash=async()=>createHash('sha256').update(JSON.stringify(JSON.parse(await sql(schemaCatalogSql)).functions)).digest('hex');
 const frozenBefore=await catalogHash();
 const live=JSON.parse(await sql(schemaCatalogSql)).functions.find(f=>f.schema==='public'&&f.identity.startsWith('parcel209_pos_sale_internal('));assert.ok(live);report.posWriterDefinitionSha256=createHash('sha256').update(live.definition).digest('hex');
 stage='catalog-identities-only';
 await sql('SELECT cron.alter_job(jobid,active:=false) FROM cron.job;ALTER TABLE public.orders DISABLE TRIGGER trg_notify_new_website_order_push;');
 const fixture=await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8');await sql(fixture);
 await sql(`INSERT INTO public.units(id,code,name_ar) VALUES('${id(225)}','COGS225-PARCEL','طرد');
 UPDATE public.products SET unit_id='${id(10)}',purchase_unit_id='${id(225)}',sale_unit_id='${id(225)}',units_per_purchase_unit=12,units_per_sale_unit=12,default_purchase_price_in_minor_units=9600,default_sale_price_in_minor_units=12000,sale_price_in_minor_units=1000,wholesale_price_in_minor_units=12000,cost_price_in_minor_units=800,wac_cost_in_minor_units_exact=800 WHERE id='${product}';
 UPDATE public.storefront_settings SET inside_ramtha_delivery_fee_in_minor_units=0,outside_ramtha_delivery_fee_in_minor_units=0,orders_enabled=true;`);
 const owner=call=>json(`BEGIN;${claims('authenticated')}SELECT public.${call};COMMIT;`);
 await owner(`set_go_live_main_branch_v1('${branch}')`);
 stage='official-opening10-at800';
 await owner(`apply_inventory_opening_setup('${warehouse}',${j([{productId:product,packageCount:0,looseUnits:10}])},'COGS225opening',${q(randomUUID())})`);
 await owner(`open_cash_shift('${branch}',0)`);
 stage='actual-mixed-receipt12plus2';
 const lines=directReceiptV2Lines([
  {clientLineId:randomUUID(),productId:product,purchaseUnitName:'طرد',baseUnitName:'باكيت',packageQuantity:1,unitsPerPackage:12,packagePriceInMinorUnits:9600,discountInMinorUnits:0},
  {clientLineId:randomUUID(),productId:product,purchaseUnitName:'باكيت',baseUnitName:'باكيت',packageQuantity:2,unitsPerPackage:1,packagePriceInMinorUnits:850,discountInMinorUnits:0},
 ]);
 await owner(`create_direct_supplier_receipt_v2(p_supplier_id:='${id(301)}',p_branch_id:='${branch}',p_warehouse_id:='${warehouse}',p_idempotency_key:=${q(randomUUID())},p_payment_method:='deferred',p_lines:=${j(lines)})`);
 report.stock=await json(`SELECT jsonb_build_object('wac',p.wac_cost_in_minor_units_exact,'legacyCost',p.cost_price_in_minor_units,'quantity',b.on_hand_quantity,'reserved',b.reserved_quantity) FROM public.products p JOIN public.inventory_balances b ON b.product_id=p.id AND b.warehouse_id='${warehouse}' WHERE p.id='${product}';`);
 assert.equal(report.stock.quantity,24);assert.equal(report.stock.reserved,0);assert.equal(report.stock.wac,804.166667);
 const cart=[{commercial_line_kind:'legacy_single_sku_parcel',product_id:product,parcel_quantity:1,units_per_parcel:12,price_authority:'server_catalog',line_discount_in_minor_units:0}];
 const capture=call=>`SELECT set_config('nawasrah.red_result',public.${call}::text,true);`;
 const cash=capture(`create_pos_sale_v2('${warehouse}','${branch}',NULL,'COGS cash','cash',${j(cart)},0,12000,${q(randomUUID())})`);
 const partial=capture(`create_pos_sale_with_initial_payment_v1('${warehouse}','${branch}','${customer}','COGS partial',${j(cart)},0,4000,'cash',NULL,${q(randomUUID())})`);
 const phone='0799000225',hash=createHash('sha256').update(phone).digest('hex');
 const webCart=[{commercial_line_kind:'legacy_single_sku_parcel',product_id:product,parcel_quantity:1,units_per_parcel:12,expected_unit_price_in_minor_units:12000}];
 const website=`RESET ROLE;${claims('service_role')}${capture(`submit_guest_customer_order_v2(${q(randomUUID())},repeat('c',64),${q(hash)},'COGS guest',${q(phone)},'إربد','الرمثا','اختبار','اختبار',NULL,NULL,NULL,NULL,NULL,NULL,${j(webCart)},NULL,'cash_on_delivery','inside_ramtha',12000,0,0,12000)`)}
 RESET ROLE;${claims('authenticated')}
 SELECT public.accept_order_for_preparation((current_setting('nawasrah.red_result')::jsonb->>'order_id')::uuid,'COGS');
 SELECT public.update_order_status((current_setting('nawasrah.red_result')::jsonb->>'order_id')::uuid,'ready','COGS');
 ${capture(`complete_website_order_with_settlement_v2((current_setting('nawasrah.red_result')::jsonb->>'order_id')::uuid,${q(randomUUID())},'cash',12000,0,NULL,'COGS')`)}`;
 for(const [name,body]of[['pos-cash',cash],['pos-partial',partial],['website-completion',website]]){
  stage=name;const before=await readApplicationFingerprint(local.executor);
  const observed=await json(`BEGIN;SET LOCAL statement_timeout='8s';${claims('authenticated')}${body}RESET ROLE;
   SELECT jsonb_build_object('result',current_setting('nawasrah.red_result')::jsonb,'items',(SELECT jsonb_agg((SELECT jsonb_object_agg(key,value) FROM jsonb_each(to_jsonb(i)) WHERE key LIKE '%cost%' OR key LIKE '%cogs%' OR key LIKE '%profit%' OR key IN('quantity','line_total_in_minor_units','commercial_line_kind','sale_package_quantity','units_per_sale_package'))) FROM public.order_items i WHERE product_id='${product}'),'cache',(SELECT result_snapshot FROM public.business_operations WHERE id=(SELECT operation_id FROM public.orders WHERE id=(SELECT order_id FROM public.order_items WHERE product_id='${product}' LIMIT 1))));ROLLBACK;`);
  assert.equal(observed.items.length,1);const actual=Number(observed.items[0].cogs_in_minor_units);
  assert.equal(actual,expectedCogs,name+': stored COGS');
  assert.equal(observed.items[0].profit_in_minor_units,12000-expectedCogs,name+': actual profit');
  assert.equal(observed.items[0].unit_cost_snapshot_in_minor_units_exact,804.166667);
  assert.equal(observed.items[0].exact_cogs_snapshot_in_minor_units,9650.000004);
  const published=[];const walk=(value,path)=>{if(value===null||typeof value!=='object')return;for(const[key,entry]of Object.entries(value)){if(key==='cogsInMinorUnits'||key==='cogs_in_minor_units')published.push({path:path+'.'+key,value:entry});if(entry&&typeof entry==='object')walk(entry,path+'.'+key);}};
  walk(observed.result,'result');walk(observed.cache,'cache');
  for(const field of published)assert.equal(field.value,expectedCogs,name+': '+field.path);
  if(name!=='website-completion')assert.equal(published.length,2,'Both RPC and cached POS COGS must be checked');
  const after=await readApplicationFingerprint(local.executor);assert.deepEqual(after.tables,before.tables,'ROLLBACK_ALL_PUBLIC_ROWS');
  report.cases.push({name,businessExpectationPassed:true,RED:false,expectedCogs,actualCogs:actual,publishedCogs:published,observed,rollbackRowsIdentical:true,sequencesMayAdvance:true});
  console.log(JSON.stringify({stage:name,expectation:'GREEN',actualCogs:actual,expectedCogs,rpcAndCacheCompared:published.length,rollback:true}));
 }
 assert.equal(await catalogHash(),frozenBefore,'ALL_FUNCTIONS_UNCHANGED');
 Object.assign(report,{ok:true,knownGapCases:[],premise:'Not reproduced on224;214 already uses exact WAC',allFunctionDefinitionsUnchanged:true,frozenFunctionsSha256:frozenBefore});
}catch(error){Object.assign(report,{ok:false,stage,error:error.message.split('\n')[0]});process.exitCode=1;}
finally{await local?.stop();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,stage,output,knownGapCases:report.knownGapCases}));}
