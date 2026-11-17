import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {golden225AccountingOracle} from './on225-golden-oracle.mjs';
import {startInventory224Local} from './inventory224-local.mjs';
import {schemaCatalogSql} from './schema-catalog.mjs';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';
import {directReceiptV2Lines} from '../../src/utils/receivingV2.ts';
import {price225Migration,readPrice225CandidatePins} from '../operations/on-prices225-catalog.mjs';

assert.equal(process.argv.length,2,'ON225_GOLDEN_NO_TARGET_ARGUMENTS');
const root=path.resolve(import.meta.dirname,'../..');
const output=path.join(root,'test-results/on225-accounting-golden');
await mkdir(output,{recursive:true});
const id=n=>'92600000-0000-4000-8000-'+String(n).padStart(12,'0');
const quote=v=>v===null?'NULL':"'"+String(v).replaceAll("'","''")+"'";
const json=v=>quote(JSON.stringify(v))+'::JSONB';
const product=id(103),branch=id(200),warehouse=id(201),supplier=id(301),customer=id(402);
const expected=golden225AccountingOracle();
assert.deepEqual([expected.revenue,expected.cogs,expected.profit,expected.inventoryValue],[12500,11258,1242,10042]);
const report={ok:false,isolated:true,activeMigration:225,mainOrHostedAccess:false,expected,stages:[]};
const ownerClaims="SELECT set_config('request.jwt.claims',"+quote(JSON.stringify({role:'authenticated',sub:id(1),aal:'aal2'}))+",true);SET LOCAL ROLE authenticated;";
const serviceClaims="SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);SET LOCAL ROLE service_role;";
let stage='fresh224',local;
const check=(label,value,expectation)=>assert.deepEqual(value,expectation,stage+': '+label);
const record=(value)=>{report.stages.push({stage,proof:value});console.log(JSON.stringify({stage,proof:value}));};
try{
 local=await startInventory224Local(224,'reference');
 const {sql,executor}=local;
 const rows=async command=>JSON.parse((await sql(command)).trim().split(/\r?\n/u).at(-1));
 const rpc=(call,claims=ownerClaims)=>rows('BEGIN;SET LOCAL statement_timeout=\'8s\';'+claims+'SELECT public.'+call+';COMMIT;');
 const catalog=async()=>JSON.parse(await sql(schemaCatalogSql));
 check('source',await rows("SELECT jsonb_build_object('ceiling',MAX(version),'count',COUNT(*),'on',(SELECT full_accounting FROM sales_lite1.mode)) FROM supabase_migrations.schema_migrations;"),{ceiling:'224',count:184,on:true});
 const before=await catalog();
 stage='apply exact active225 on fresh local224 only';
 const candidate=await readFile(path.join(root,'supabase/migrations',price225Migration),'utf8');
 report.candidateSha256=createHash('sha256').update(candidate).digest('hex');
 assert.equal(report.candidateSha256,readPrice225CandidatePins().migrationSha256);
 await sql(candidate);
 // Disposable fixture history only; owner registration is proved separately
 // through the protected official225 apply/resume pipeline.
 await sql("INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('225','on_independent_prices','{}');");
 check('registered225',await rows("SELECT jsonb_build_object('ceiling',MAX(version),'count',COUNT(*),'on',(SELECT full_accounting FROM sales_lite1.mode)) FROM supabase_migrations.schema_migrations;"),{ceiling:'225',count:185,on:true});
 const after=await catalog();
 for(const old of before.functions)check('frozen '+old.identity,after.functions.find(f=>f.schema===old.schema&&f.identity===old.identity),old);
 report.previousFunctionsAllIdentical=true;
 await sql("SELECT cron.alter_job(jobid,active:=false) FROM cron.job;ALTER TABLE public.orders DISABLE TRIGGER trg_notify_new_website_order_push;");
 await sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
 await sql("INSERT INTO public.units(id,code,name_ar) VALUES("+quote(id(225))+",'ON225-GOLDEN-BOX','صندوق');"+
   "UPDATE public.products SET purchase_unit_id="+quote(id(225))+",sale_unit_id="+quote(id(225))+",units_per_purchase_unit=12,units_per_sale_unit=12,"+
   "default_purchase_price_in_minor_units=9600,default_sale_price_in_minor_units=11000,sale_price_in_minor_units=1000,wholesale_price_in_minor_units=1000,"+
   "cost_price_in_minor_units=800,wac_cost_in_minor_units_exact=800 WHERE id="+quote(product)+";");
 const settings=()=>rows('SELECT to_jsonb(p) FROM public.products p WHERE id='+quote(product)+';');
 const priceContext=(single,parcel,enabled)=>rpc('get_product_pricing_context225('+[quote(product),single,parcel,12,enabled,false].join(',')+')');
 const edit=async(single,parcel,enabled,proof=null,restore=null)=>{
  const p=await settings();
  return rpc('update_product_master_v7('+[quote(product),quote(p.updated_at),quote(p.sku),quote(p.barcode),quote(p.name_ar),quote(p.description),
   quote(p.category_id),quote(p.brand_id),quote(p.unit_id),quote(p.purchase_unit_id),p.units_per_purchase_unit,p.default_purchase_price_in_minor_units,
   quote(p.sale_unit_id),12,parcel,p.cost_price_in_minor_units,p.min_stock_level,p.max_stock_level??'NULL',p.is_active,'NULL',single,false,enabled,
   proof===null?'NULL':json(proof),quote(restore)].join(',')+')');
 };
 const rec=(lines,number)=>rpc('create_direct_supplier_receipt_v2(p_supplier_id=>'+quote(supplier)+',p_warehouse_id=>'+quote(warehouse)+
  ',p_branch_id=>'+quote(branch)+',p_supplier_invoice_number=>'+quote(number)+',p_amount_paid_at_receipt_in_minor_units=>0,p_payment_method=>\'deferred\''+
  ',p_idempotency_key=>'+quote(randomUUID())+',p_lines=>'+json(directReceiptV2Lines(lines.map(line=>({...line,clientLineId:randomUUID(),
    productId:product,baseUnitName:'باكيت',discountInMinorUnits:0}))))+')');
 const pos=(kind,quantity,total)=>{
  const line={commercial_line_kind:kind,product_id:product,price_authority:'server_catalog',line_discount_in_minor_units:0,
   ...(kind==='base_unit'?{base_quantity:quantity}:{parcel_quantity:quantity,units_per_parcel:12})};
  return rpc('create_pos_sale_v2('+[quote(warehouse),quote(branch),quote(customer),quote('ON225 golden'),quote('cash'),json([line]),0,total,quote(randomUUID())].join(',')+')');
 };
 const getItem=order=>rows('SELECT to_jsonb(i) FROM public.order_items i WHERE order_id='+quote(order)+';');
 stage='opening ten at 0.800 and mixed receipt';
 await rpc('set_go_live_main_branch_v1('+quote(branch)+')');
 await rpc('apply_inventory_opening_setup('+quote(warehouse)+','+json([{productId:product,packageCount:0,looseUnits:10}])+','+quote('ON225 opening')+','+quote(randomUUID())+')');
 const opened=await rpc('open_cash_shift('+quote(branch)+',0)');
 const shift=opened.shiftId??opened.shift_id??opened.id;
 assert.ok(shift,'Shift ID required');
 check('supplier receipt1',(await rec([
  {purchaseUnitName:'صندوق',packageQuantity:1,unitsPerPackage:12,packagePriceInMinorUnits:9600},
  {purchaseUnitName:'باكيت',packageQuantity:2,unitsPerPackage:1,packagePriceInMinorUnits:850},
 ],'ON225-GOLDEN-1')).success,true);
 check('stored WAC',(await settings()).wac_cost_in_minor_units_exact,Number(expected.firstWacMicro)/1e6);
 const discounted=await edit(1000,11000,true);
 check('single and parcel prices',[discounted.singlePrice,discounted.parcelPrice],[1000,11000]);
 record({wacInFils:(await settings()).wac_cost_in_minor_units_exact,single:1000,parcel:11000});
 stage='two singles and one discounted parcel';
 const original=await pos('base_unit',2,2000),parcel=await pos('legacy_single_sku_parcel',1,11000);
 assert.ok(original.success&&parcel.success);
 const originalItem=await getItem(original.orderId),parcelItem=await getItem(parcel.orderId);
 check('original sale',[originalItem.quantity,originalItem.line_total_in_minor_units,originalItem.cogs_in_minor_units],[2,2000,expected.saleCogs[0]]);
 check('parcel sale',[parcelItem.quantity,parcelItem.line_total_in_minor_units,parcelItem.cogs_in_minor_units],[12,11000,9650]);
 check('parcel immutable exact WAC',parcelItem.unit_cost_snapshot_in_minor_units_exact,Number(expected.firstWacMicro)/1e6);
 record({parcelPrice:11000,parcelCogs:9650,fullUnitCost:parcelItem.unit_cost_snapshot_in_minor_units_exact});
 stage='pause before sell-through, confirm real loss and refuse reactivation';
 const confirmation=(await priceContext(500,11000,false)).belowCostConfirmation;
 assert.ok(confirmation);
 const paused=await edit(500,11000,false,confirmation);
 check('first price saved and parcel paused',[paused.originalUnitPrice,paused.parcelEnabled],[1000,false]);
 const lost=await pos('base_unit',1,500);assert.ok(lost.success);
 const lossItem=await getItem(lost.orderId);
 check('true loss',[lossItem.line_total_in_minor_units,lossItem.cogs_in_minor_units,lossItem.profit_in_minor_units],[500,expected.saleCogs[2],expected.loss]);
 await assert.rejects(edit(500,11000,true),/PRICES225_PARCEL_PRICE_TOO_HIGH/u);
 const cutAgain=(await priceContext(450,11000,false)).belowCostConfirmation;
 check('first price through second cut',(await edit(450,11000,false,cutAgain)).originalUnitPrice,1000);
 const lowerParcel=(await priceContext(500,6000,true)).belowCostConfirmation;
 const reactivated=await edit(500,6000,true,lowerParcel);
 check('corrected parcel enabled',[reactivated.parcelEnabled,reactivated.originalParcelPrice],[true,11000]);
 await assert.rejects(edit(500,6000,true,null,'parcel'),/PRICES225_PARCEL_PRICE_TOO_HIGH/u);
 // Stop carton sales again without altering either price. Next receipt raises WAC.
 const pausedAgain=(await priceContext(500,6000,false)).belowCostConfirmation;
 await edit(500,6000,false,pausedAgain);
 record({loss:expected.loss,firstSingle:1000,firstParcel:11000,oversizedReactivationRefused:true});
 stage='receipt warning after two more units at 1.000';
 check('supplier receipt2',(await rec([{purchaseUnitName:'باكيت',packageQuantity:2,unitsPerPackage:1,packagePriceInMinorUnits:1000}],'ON225-GOLDEN-2')).success,true);
 const fp=await readApplicationFingerprint(executor);
 const warnings=await rpc('get_receipt_pricing_warnings225(ARRAY['+quote(product)+']::uuid[])');
 check('warning real cost',[warnings[0].unitPrice,warnings[0].originalUnitPrice,warnings[0].originalParcelPrice,Number(warnings[0].wacInMinorUnitsExact)],[500,1000,11000,Number(expected.costAtReturnMicro)/1e6]);
 check('warning reader leaves exact rows',(await readApplicationFingerprint(executor)).tables,fp.tables);
 const restored=await edit(500,6000,false,null,'single');
 check('explicit restore keeps pause',[restored.singlePrice,restored.parcelEnabled,restored.originalUnitPrice],[1000,false,null]);
 await edit(1200,6000,false);
 record({wac:warnings[0].wacInMinorUnitsExact,ordinaryReadDidNotWrite:true,restoreKeptPaused:true});
 stage='partial return at original sale price and original WAC';
 const logical=[{return_scope:'base_unit',order_item_id:originalItem.id,quantity:1,stock_disposition:'restock'}];
 const physical=[{root_source_kind:'base_order_item',root_source_id:originalItem.id,source_kind:'base_order_item',
  source_id:originalItem.id,product_id:product,quantity:1,sellable_restock_quantity:1,defect_non_sellable_quantity:0,customer_damage_quantity:0}];
 const returned=await rpc('settle_admin_sales_return_v1('+[quote(original.orderId),quote(randomUUID()),json(logical),json(physical),quote('ON225 golden return'),quote('cash'),'NULL','NULL'].join(',')+')');
 check('refund and entitlement',[returned.success,returned.moneyRefundInMinorUnits,returned.merchandiseEntitlementInMinorUnits],[true,expected.refund,expected.refund]);
 check('original item price and WAC after return',await getItem(original.orderId),originalItem);
 const balances=await rows('SELECT jsonb_build_object(\'quantity\',b.on_hand_quantity,\'value\',round(b.on_hand_quantity*p.wac_cost_in_minor_units_exact),\'wac\',p.wac_cost_in_minor_units_exact) FROM public.inventory_balances b JOIN public.products p ON p.id=b.product_id WHERE b.product_id='+quote(product)+' AND warehouse_id='+quote(warehouse)+';');
 check('inventory',[balances.quantity,balances.value,balances.wac],[expected.quantity,expected.inventoryValue,Number(expected.finalWacMicro)/1e6]);
 record({refund:expected.refund,inventory:balances});
 stage='day, period, and immutable closing figures';
 const day="(NOW() AT TIME ZONE 'Asia/Amman')::date";
 const end=await rpc('get_operational_business_report('+quote(branch)+','+day+','+day+')');
 const dayReport=await rpc("build_business_summary('daily',"+day+','+day+',NOW())',serviceClaims);
 for(const [label,sales] of [['period',end.sales],['day',dayReport.sales]]){
  check(label+' sales and costs',[
   sales.netSalesInMinorUnits,sales.cogsInMinorUnits,sales.restockRecoveryInMinorUnits,
   sales.cogsInMinorUnits-sales.restockRecoveryInMinorUnits,sales.netProfitInMinorUnits,
  ],[expected.revenue,expected.saleCogs.reduce((sum,cost)=>sum+cost,0),expected.returnCogs,expected.cogs,expected.profit]);
 }
 check('supplier payable',end.balances.supplierDueInMinorUnits,expected.supplierPayable);
 await rpc('close_cash_shift('+quote(shift)+','+expected.cash+',NULL)');
 const closed=await rpc('get_cash_shift_closing_report('+quote(shift)+')');
 check('closing',[closed.reconciliation.expectedCashInMinorUnits,closed.reconciliation.actualCashInMinorUnits,closed.reconciliation.cashDiscrepancyInMinorUnits],[expected.cash,expected.cash,0]);
 check('closing remains exact',await rpc('get_cash_shift_closing_report('+quote(shift)+')'),closed);
 record({sales:end.sales,inventory:balances,drawer:closed.reconciliation});
 report.ok=true;
}catch(error){
 report.error=error.message.split('\n')[0];report.failedStage=stage; if(error.code==='ERR_ASSERTION')report.assertion={actual:error.actual,expected:error.expected};process.exitCode=1;
}finally{
 await local?.stop();
 await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({ok:report.ok,stage,output,stages:report.stages.length}));
}
