// Partial225 kernel only, not the final golden day or a deployable migration.
// Fixed fresh224 Docker fixture; no caller-supplied target or hosted credentials.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {startInventory224Local} from './inventory224-local.mjs';
import {schemaCatalogSql} from './schema-catalog.mjs';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';
assert.equal(process.argv.length,2,'ON225_KERNEL_NO_TARGET_ARGUMENTS');
const root=path.resolve(import.meta.dirname,'../..'),output=path.join(root,'test-results/on225-candidate-core');
await mkdir(output,{recursive:true});
const report={ok:false,candidateOnly:true,historyCeiling:224,hostedAccess:false,demoAccess:false,cases:[]};
const id=n=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const quote=text=>"'"+String(text).replaceAll("'","''")+"'";
let local,stage='bootstrap224';
try{
 local=await startInventory224Local(224,'reference');
 const sql=local.sql,json=async text=>JSON.parse((await sql(text)).trim().split(/\r?\n/u).at(-1));
 await sql('SELECT cron.alter_job(jobid,active:=false) FROM cron.job;ALTER TABLE public.orders DISABLE TRIGGER trg_notify_new_website_order_push;');
 const catalog=()=>json(schemaCatalogSql),before=await catalog();
 stage='apply-new-candidate-kernel';
 const candidate=await readFile(path.join(root,'docs/design/on-independent-prices225/225_on_independent_prices.candidate.sql'),'utf8');
 await sql(candidate);const after=await catalog();
 for(const old of before.functions){
  const current=after.functions.find(f=>f.schema===old.schema&&f.identity===old.identity);
  assert.deepEqual(current,old,'EXISTING_FUNCTION_MUST_REMAIN_BYTE_IDENTICAL:'+old.identity);
 }
 const added=after.functions.filter(f=>!before.functions.some(old=>old.schema===f.schema&&old.identity===f.identity));
 assert.equal(added.length,9);
 assert.deepEqual(added.map(f=>f.identity.slice(0,f.identity.indexOf('('))).sort(),[
  'create_product_family_with_flavors_v4','create_product_with_opening_stock_v7',
  'get_product_pricing_context225','price225_assert_context_internal','price225_assert_prices_internal','price225_create_loss_confirmation_internal',
  'price225_loss_confirmation_internal','price225_record_state_internal','update_product_master_v7']);
 report.existingFunctionObjectsUnchanged=true;
 report.candidateSha256=createHash('sha256').update(candidate).digest('hex');
 const check=async(name,body)=>{
  stage=name;const baseline=await readApplicationFingerprint(local.executor);
  await sql('BEGIN;'+body+'ROLLBACK;');
  assert.deepEqual((await readApplicationFingerprint(local.executor)).tables,baseline.tables,'KERNEL_ROLLBACK_ROWS:'+name);
  report.cases.push({name,ok:true,rollback:true});console.log(JSON.stringify({stage:name,ok:true}));
 };
 const invoke=(single,parcel,enabled=true,units=12,same=false)=>`PERFORM public.price225_assert_prices_internal('${id(10)}','${same?id(10):id(11)}',${units},${single},${parcel},${enabled},false);`;
 const reject=(body,code)=>`DO $proof$ BEGIN BEGIN ${body} RAISE EXCEPTION 'EXPECTED_REFUSAL_MISSING';EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE ${quote(code+':%')} THEN RAISE;END IF;END;END $proof$;`;
 await check('discount accepted; pause permits the reduced single price',`DO $proof$ BEGIN ${invoke(1000,11000)}${invoke(500,11000,false)} END $proof$;`);
 await check('active or reactivated overpriced parcel refused',reject(invoke(500,11000),'PRICES225_PARCEL_PRICE_TOO_HIGH'));
 await check('N units for one unit price refused',reject(invoke(1000,1000),'PRICES225_UNSAFE_PARCEL_PRICE'));
 await check('same base and parcel unit refused',reject(invoke(1000,11000,true,12,true),'PRICES225_DISTINCT_PARCEL_UNIT_REQUIRED'));
 await check('nonpositive prices refused',reject(invoke(0,11000),'PRICES225_POSITIVE_PRICE_REQUIRED'));
 await check('one physical unit retains a single price',reject(invoke(1000,1100,false,1),'PRICES225_SINGLE_PRICE_MISMATCH'));
 stage='deny direct private helpers and state table';
 const rights=await json(`SELECT jsonb_build_object('helperGranted',EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN(VALUES('anon'),('authenticated'),('service_role')) r(role) WHERE n.nspname='public' AND p.proname LIKE 'price225_%' AND has_function_privilege(r.role,p.oid,'EXECUTE')),'tableGranted',EXISTS(SELECT 1 FROM(VALUES('anon'),('authenticated'),('service_role')) r(role) WHERE has_table_privilege(r.role,'public.product_sale_pricing_state225','SELECT') OR has_table_privilege(r.role,'public.product_sale_pricing_state225','UPDATE')),'rls',(SELECT relrowsecurity FROM pg_class WHERE oid='public.product_sale_pricing_state225'::regclass));`);
 assert.deepEqual(rights,{helperGranted:false,tableGranted:false,rls:true});report.privatePermissions=rights;
 await sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
 const product=id(103);
 await check('loss confirmation is bound to exact prices and current WAC',`DO $proof$ DECLARE expected JSONB;BEGIN
  UPDATE public.products SET cost_price_in_minor_units=800,wac_cost_in_minor_units_exact=804.166667 WHERE id='${product}';
  BEGIN PERFORM public.price225_loss_confirmation_internal('${product}',500,6000,12,true,false,NULL);RAISE EXCEPTION 'EXPECTED_LOSS_CONFIRMATION';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'PRICES225_BELOW_WAC_CONFIRMATION_REQUIRED:%' THEN RAISE;END IF;GET STACKED DIAGNOSTICS expected=PG_EXCEPTION_DETAIL;END;
  IF NOT(expected->>'acknowledged')::BOOLEAN OR expected->'risks'->0->>'wacInMinorUnitsExact'<>'804.166667' THEN RAISE EXCEPTION 'EXACT_LOSS_CONTEXT_REQUIRED';END IF;
  PERFORM public.price225_loss_confirmation_internal('${product}',500,6000,12,true,false,expected);
  UPDATE public.products SET wac_cost_in_minor_units_exact=850 WHERE id='${product}';
  BEGIN PERFORM public.price225_loss_confirmation_internal('${product}',500,6000,12,true,false,expected);RAISE EXCEPTION 'STALE_LOSS_CONFIRMATION_ACCEPTED';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'PRICES225_BELOW_WAC_CONFIRMATION_REQUIRED:%' THEN RAISE;END IF;END;
 END $proof$;`);
 stage='prepare independent ON product writer fixture';
 await sql(`INSERT INTO public.units(id,code,name_ar) VALUES('${id(225)}','ON225-PARCEL','صندوق');
 UPDATE public.products SET purchase_unit_id='${id(225)}',sale_unit_id='${id(225)}',
  units_per_purchase_unit=12,units_per_sale_unit=12,default_sale_price_in_minor_units=11000,
  sale_price_in_minor_units=1000,wholesale_price_in_minor_units=1000,cost_price_in_minor_units=800,wac_cost_in_minor_units_exact=800
 WHERE id='${product}';`);
 const authenticated=`SELECT set_config('request.jwt.claims',${quote(JSON.stringify({sub:id(1),role:'authenticated',aal:'aal2'}))},true);SET LOCAL ROLE authenticated;`;
 const edit=(single,parcel,enabled='NULL',ack='NULL',restore='NULL')=>`
  SELECT * INTO p FROM public.products WHERE id='${product}';
  result:=public.update_product_master_v7(p.id,p.updated_at,p.sku,p.barcode,p.name_ar,p.description,
   p.category_id,p.brand_id,p.unit_id,p.purchase_unit_id,p.units_per_purchase_unit,p.default_purchase_price_in_minor_units,
   p.sale_unit_id,p.units_per_sale_unit,${parcel},p.cost_price_in_minor_units,p.min_stock_level,p.max_stock_level,
   p.is_active,NULL::TEXT,${single},p.parcel_only,${enabled},${ack},${restore});`;
 await check('ON writer retains explicit prices and saves only the first original through cuts and raises',`${authenticated}
 DO $proof$ DECLARE p public.products;result JSONB;ack JSONB;BEGIN
  ${edit(1000,11000,'true')}
  IF result->>'singlePrice'<>'1000' OR result->>'parcelPrice'<>'11000' OR result->'originalUnitPrice'<>'null'::jsonb THEN RAISE EXCEPTION 'INITIAL_PRICES_CHANGED';END IF;
  ack:=public.get_product_pricing_context225('${product}',600,11000,12,false,false)->'belowCostConfirmation';
  ${edit(600,11000,'false','ack')}
  ack:=public.get_product_pricing_context225('${product}',500,11000,12,false,false)->'belowCostConfirmation';
  ${edit(500,11000,'NULL','ack')}
  IF result->>'singlePrice'<>'500' OR result->>'originalUnitPrice'<>'1000' OR (result->>'parcelEnabled')::BOOLEAN THEN RAISE EXCEPTION 'FIRST_ORIGINAL_OR_PAUSE_CHANGED';END IF;
  ack:=public.get_product_pricing_context225('${product}',700,11000,12,false,false)->'belowCostConfirmation';
  ${edit(700,11000,'NULL','ack')}
  IF result->>'originalUnitPrice'<>'1000' OR (result->>'parcelEnabled')::BOOLEAN THEN RAISE EXCEPTION 'RAISE_CLEARED_ORIGINAL_OR_ENABLED_PARCEL';END IF;
  SELECT * INTO p FROM public.products WHERE id='${product}';
  IF p.wac_cost_in_minor_units_exact<>800 OR p.cost_price_in_minor_units<>800 THEN RAISE EXCEPTION 'PRICE_WRITER_CHANGED_WAC';END IF;
 END $proof$;`);
 await check('restore reuses strict guards, clears only successful snapshots and never enables a paused parcel',`${authenticated}
 DO $proof$ DECLARE p public.products;result JSONB;ack JSONB;BEGIN
  ack:=public.get_product_pricing_context225('${product}',700,11000,12,false,false)->'belowCostConfirmation';
  ${edit(700,11000,'false','ack')}
  ack:=public.get_product_pricing_context225('${product}',700,6000,12,true,false)->'belowCostConfirmation';
  ${edit(700,6000,'true','ack')}
  IF result->>'originalParcelPrice'<>'11000' THEN RAISE EXCEPTION 'PARCEL_ORIGINAL_MISSING';END IF;
  BEGIN ${edit(700,6000,'NULL','NULL',"'parcel'")} RAISE EXCEPTION 'RESTORE_OVERPRICED_PARCEL_ACCEPTED';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'PRICES225_PARCEL_PRICE_TOO_HIGH:%' THEN RAISE;END IF;END;
  SELECT * INTO p FROM public.products WHERE id='${product}';
  IF public.get_product_pricing_context225('${product}')->>'originalParcelPrice'<>'11000' THEN RAISE EXCEPTION 'REFUSAL_CLEARED_ORIGINAL';END IF;
  ack:=public.get_product_pricing_context225('${product}',1000,6000,12,true,false)->'belowCostConfirmation';
  ${edit(700,6000,'NULL','ack',"'single'")}
  ${edit(1000,6000,'NULL','NULL',"'parcel'")}
  IF result->'originalUnitPrice'<>'null'::jsonb OR result->'originalParcelPrice'<>'null'::jsonb OR result->>'singlePrice'<>'1000' OR result->>'parcelPrice'<>'11000' THEN RAISE EXCEPTION 'RESTORE_PRICES_OR_CLEAR_FAILED';END IF;
  ack:=public.get_product_pricing_context225('${product}',500,11000,12,false,false)->'belowCostConfirmation';
  ${edit(500,11000,'false','ack')}
  ${edit(500,11000,'NULL','NULL',"'single'")}
  IF (result->>'parcelEnabled')::BOOLEAN THEN RAISE EXCEPTION 'RESTORE_AUTO_ENABLED_PARCEL';END IF;
 END $proof$;`);
 await check('ON writer refuses an unconfirmed loss and preserves every row on refusal',`${authenticated}
 DO $proof$ DECLARE p public.products;result JSONB;before_row JSONB;BEGIN
  SELECT to_jsonb(t) INTO before_row FROM public.products t WHERE id='${product}';
  BEGIN ${edit(500,11000,'false')} RAISE EXCEPTION 'LOSS_WITHOUT_ACK_ACCEPTED';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'PRICES225_BELOW_WAC_CONFIRMATION_REQUIRED:%' THEN RAISE;END IF;END;
  IF (SELECT to_jsonb(t) FROM public.products t WHERE id='${product}')<>before_row THEN RAISE EXCEPTION 'LOSS_REFUSAL_WROTE_PRODUCT';END IF;
 END $proof$;
 RESET ROLE;DO $state$ BEGIN
  IF EXISTS(SELECT 1 FROM public.product_sale_pricing_state225 WHERE product_id='${product}') THEN RAISE EXCEPTION 'LOSS_REFUSAL_WROTE_STATE';END IF;
 END $state$;`);
 const newProduct=(sku,single,parcel,confirmation='NULL')=>`public.create_product_with_opening_stock_v7(p_sku=>'${sku}',p_name_ar=>'صنف225 وهمي',p_category_id=>'${id(11)}',p_unit_id=>'${id(10)}',p_purchase_unit_id=>'${id(225)}',p_units_per_purchase_unit=>12,p_default_purchase_price_in_minor_units=>9600,p_sale_unit_id=>'${id(225)}',p_units_per_sale_unit=>12,p_default_sale_price_in_minor_units=>${parcel},p_cost_price_in_minor_units=>800,p_warehouse_id=>'${id(201)}',p_opening_quantity=>0,p_parcel_only=>false,p_sale_price_in_minor_units=>${single},p_below_cost_confirmation=>${confirmation})`;
 await check('new ON product keeps explicit prices and has no remembered original price',`${authenticated}
 DO $proof$ DECLARE result JSONB;BEGIN
  result:=${newProduct('ON225-CREATE',1000,11000)};
  IF result->>'singlePrice'<>'1000' OR result->>'parcelPrice'<>'11000' OR result->'originalUnitPrice'<>'null'::JSONB OR result->'originalParcelPrice'<>'null'::JSONB THEN RAISE EXCEPTION 'CREATE_INDEPENDENT_PRICES_OR_ORIGINALS_CHANGED';END IF;
 END $proof$;`);
 await check('creation below cost requires stable SKU confirmation and rolls back the unconfirmed product',`${authenticated}
 DO $proof$ DECLARE result JSONB;ack JSONB;BEGIN
  BEGIN result:=${newProduct('ON225-LOSS',500,6000)};RAISE EXCEPTION 'CREATE_LOSS_ACCEPTED';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'PRICES225_BELOW_WAC_CONFIRMATION_REQUIRED:%' THEN RAISE;END IF;GET STACKED DIAGNOSTICS ack=PG_EXCEPTION_DETAIL;END;
  IF EXISTS(SELECT 1 FROM public.products WHERE sku='ON225-LOSS') THEN RAISE EXCEPTION 'CREATE_LOSS_REFUSAL_WROTE_PRODUCT';END IF;
  IF ack->>'productSku'<>'ON225-LOSS' OR ack->>'contractVersion'<>'on-prices225-create-confirmation-v1' OR ack->'risks'->0 ? 'productId' THEN RAISE EXCEPTION 'STABLE_CREATE_CONFIRMATION_REQUIRED';END IF;
  result:=${newProduct('ON225-LOSS',500,6000,'ack')};
  IF result->>'singlePrice'<>'500' OR result->>'parcelPrice'<>'6000' THEN RAISE EXCEPTION 'CREATE_LOSS_CONFIRMATION_NOT_APPLIED';END IF;
 END $proof$;`);
 await check('family creation shares both explicit prices with its flavors and keeps first-import originals empty',`${authenticated}
 DO $proof$ DECLARE result JSONB;master UUID;BEGIN
  result:=public.create_product_family_with_flavors_v4(p_sku=>'ON225-FAMILY',p_name_ar=>'عائلة225 وهمية',p_category_id=>'${id(11)}',p_unit_id=>'${id(10)}',p_purchase_unit_id=>'${id(225)}',p_units_per_purchase_unit=>12,p_default_purchase_price_in_minor_units=>9600,p_sale_unit_id=>'${id(225)}',p_units_per_sale_unit=>12,p_default_sale_price_in_minor_units=>11000,p_cost_price_in_minor_units=>800,p_warehouse_id=>'${id(201)}',p_flavors=>'[{"nameAr":"أ"},{"nameAr":"ب"}]'::JSONB,p_parcel_only=>false,p_sale_price_in_minor_units=>1000);
  master:=(result->>'productId')::UUID;
  IF master IS NULL OR (SELECT count(*) FROM public.products WHERE flavor_master_product_id=master)<>2 OR EXISTS(SELECT 1 FROM public.products WHERE flavor_master_product_id=master AND (sale_price_in_minor_units<>1000 OR default_sale_price_in_minor_units<>11000)) THEN RAISE EXCEPTION 'FAMILY_PRICE_INHERITANCE_FAILED';END IF;
  IF result->'originalUnitPrice'<>'null'::JSONB OR result->'originalParcelPrice'<>'null'::JSONB THEN RAISE EXCEPTION 'FAMILY_FIRST_IMPORT_REMEMBERED_PRICE';END IF;
 END $proof$;`);
 report.ok=true;
}catch(error){report.stage=stage;report.error=error.message.split('\n')[0];process.exitCode=1;}
finally{await local?.stop();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,stage,output,cases:report.cases.length}));}
