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
 assert.equal(added.length,17);
 assert.deepEqual(added.map(f=>f.identity.slice(0,f.identity.indexOf('('))).sort(),[
  'create_product_family_with_flavors_v4','create_product_with_opening_stock_v7',
  'get_pos_parcel_options225','get_product_pricing_context225','get_public_parcel_options225','get_receipt_pricing_warnings225','price225_assert_context_internal','price225_assert_prices_internal','price225_create_loss_confirmation_internal',
  'price225_filter_parcel_options_internal','price225_guard_new_parcel_internal','price225_loss_confirmation_internal','price225_record_state_internal',
  'public_storefront_catalog_page225','public_storefront_merchandising225','search_pos_products225','update_product_master_v7']);
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
 const edit=(single,parcel,enabled='NULL',ack='NULL',restore='NULL',target=product,version='p.updated_at')=>`
  SELECT * INTO p FROM public.products WHERE id='${target}';
  result:=public.update_product_master_v7(p.id,${version},p.sku,p.barcode,p.name_ar,p.description,
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
 for(const [label,newPrice,original] of [
  ['manual equal restore clears single original',1000,null],
  ['manual raise below original preserves first snapshot',800,1000],
  ['manual raise above original clears single snapshot',1200,null],
 ]){
  await check(label,`${authenticated}
 DO $proof$ DECLARE p public.products;result JSONB;ack JSONB;BEGIN
  ${edit(1000,11000,'true')}
  ack:=public.get_product_pricing_context225('${product}',500,11000,12,false,false)->'belowCostConfirmation';
  ${edit(500,11000,'false','ack')}
  IF result->>'originalUnitPrice' IS DISTINCT FROM '1000' THEN RAISE EXCEPTION 'FIRST_ORIGINAL_MISSING';END IF;
  ${edit(newPrice,11000,'false')}
  IF result->'originalUnitPrice' IS DISTINCT FROM '${JSON.stringify(original)}'::JSONB THEN RAISE EXCEPTION 'MANUAL_RECOVERY_SNAPSHOT_INCORRECT';END IF;
  IF (result->'originalUnitPriceAt'='null'::JSONB) IS DISTINCT FROM ${original===null}
    OR (result->'originalUnitPriceBy'='null'::JSONB) IS DISTINCT FROM ${original===null} THEN
    RAISE EXCEPTION 'ORIGINAL_METADATA_CLEAR_MISMATCH';END IF;
 END $proof$;
 RESET ROLE;
 DO $proof$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.audit_logs WHERE entity_id='${product}' AND user_id='${id(1)}'
    AND action='SET_PRODUCT_ON_PRICES225' AND created_at IS NOT NULL
    AND details->>'singlePrice'='${newPrice}'
    AND details->'beforeOriginals'->>'original_unit_price'='1000'
    AND details->'afterOriginals'->'original_unit_price'='${JSON.stringify(original)}'::JSONB
    AND details->'clearedOriginalUnits'->>'single'='${original===null}') THEN
    RAISE EXCEPTION 'MANUAL_RECOVERY_AUDIT_MISSING';END IF;
 END $proof$;`);
 }
 await check('manual recovery keeps single and parcel snapshots independent',`${authenticated}
 DO $proof$ DECLARE p public.products;result JSONB;ack JSONB;BEGIN
  ack:=public.get_product_pricing_context225('${product}',500,6000,12,false,false)->'belowCostConfirmation';
  ${edit(500,6000,'false','ack')}
  IF result->>'originalUnitPrice' IS DISTINCT FROM '1000' OR result->>'originalParcelPrice' IS DISTINCT FROM '11000' THEN
    RAISE EXCEPTION 'BOTH_FIRST_ORIGINALS_REQUIRED';END IF;
  ${edit(1000,9000,'false')}
  IF result->'originalUnitPrice' IS DISTINCT FROM 'null'::JSONB OR result->>'originalParcelPrice' IS DISTINCT FROM '11000' THEN
    RAISE EXCEPTION 'SINGLE_RECOVERY_CHANGED_PARCEL_ORIGINAL';END IF;
  ${edit(800,11000,'false')}
  IF result->>'originalUnitPrice' IS DISTINCT FROM '1000' OR result->'originalParcelPrice' IS DISTINCT FROM 'null'::JSONB THEN
    RAISE EXCEPTION 'PARCEL_RECOVERY_CHANGED_SINGLE_ORIGINAL';END IF;
  IF result->'originalParcelPriceAt' IS DISTINCT FROM 'null'::JSONB
    OR result->'originalParcelPriceBy' IS DISTINCT FROM 'null'::JSONB THEN
    RAISE EXCEPTION 'PARCEL_ORIGINAL_METADATA_NOT_CLEARED';END IF;
 END $proof$;
 RESET ROLE;
 DO $proof$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.audit_logs WHERE entity_id='${product}' AND user_id='${id(1)}'
    AND action='SET_PRODUCT_ON_PRICES225' AND details->>'singlePrice'='800' AND details->>'parcelPrice'='11000'
    AND details->'beforeOriginals'->>'original_parcel_price'='11000'
    AND details->'afterOriginals'->'original_parcel_price'='null'::JSONB
    AND details->'afterOriginals'->>'original_unit_price'='1000') THEN
    RAISE EXCEPTION 'INDEPENDENT_RECOVERY_AUDIT_MISSING';END IF;
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
 await check('ON writer refuses a stale optimistic version before changing prices or remembered originals',`${authenticated}
 DO $proof$ DECLARE p public.products;result JSONB;BEGIN
  BEGIN ${edit(1000,11000,'true','NULL','NULL',product,"p.updated_at-interval '1 second'")}
   RAISE EXCEPTION 'STALE_PRICE_VERSION_ACCEPTED';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'PRODUCT_EDIT_CONFLICT:%' THEN RAISE;END IF;END;
 END $proof$;`);
 const newProduct=(sku,single,parcel,confirmation='NULL')=>`public.create_product_with_opening_stock_v7(p_sku=>'${sku}',p_name_ar=>'صنف225 وهمي',p_category_id=>'${id(11)}',p_unit_id=>'${id(10)}',p_purchase_unit_id=>'${id(225)}',p_units_per_purchase_unit=>12,p_default_purchase_price_in_minor_units=>9600,p_sale_unit_id=>'${id(225)}',p_units_per_sale_unit=>12,p_default_sale_price_in_minor_units=>${parcel},p_cost_price_in_minor_units=>800,p_warehouse_id=>'${id(201)}',p_opening_quantity=>0,p_parcel_only=>false,p_sale_price_in_minor_units=>${single},p_below_cost_confirmation=>${confirmation})`;
 await check('cashier cannot use ON price writers or read private pricing decisions',`
 INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 VALUES('${id(901)}','authenticated','authenticated','on225-cashier@example.test',NOW(),'{}','{}');
 INSERT INTO profiles(id,full_name,is_active) VALUES('${id(901)}','كاشير الاختبار',true);
 INSERT INTO roles(code,name_ar) VALUES('cashier','كاشير') ON CONFLICT(code) DO NOTHING;
 INSERT INTO user_roles(user_id,role_id) SELECT '${id(901)}',id FROM roles WHERE code='cashier';
 SELECT set_config('request.jwt.claims',${quote(JSON.stringify({sub:id(901),role:'authenticated',aal:'aal2'}))},true);
 SET LOCAL ROLE authenticated;
 DO $proof$ BEGIN
  BEGIN PERFORM ${newProduct('ON225-CASHIER-DENIED',1000,11000)};RAISE EXCEPTION 'CASHIER_PRICE_WRITE_ACCEPTED';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'ليس لديك صلاحية%' THEN RAISE;END IF;END;
  BEGIN PERFORM public.get_receipt_pricing_warnings225(ARRAY['${product}']::UUID[]);RAISE EXCEPTION 'CASHIER_PRIVATE_PRICING_READ_ACCEPTED';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'ليس لديك صلاحية%' THEN RAISE;END IF;END;
 END $proof$;`);
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
 const branch=id(200),warehouse=id(201);
 const preparePausedSale=`${authenticated}
 SELECT public.set_go_live_main_branch_v1('${branch}');
 SELECT public.apply_inventory_opening_setup('${warehouse}',${quote(JSON.stringify([{productId:product,packageCount:4,looseUnits:0}]))}::JSONB,'ON225 fixture','on225-open-item-stock');
 SELECT public.open_cash_shift('${branch}',0);
 DO $proof$ DECLARE p public.products;result JSONB;ack JSONB;BEGIN
  ack:=public.get_product_pricing_context225('${product}',700,11000,12,false,false)->'belowCostConfirmation';
  ${edit(700,11000,'false','ack')}
 END $proof$;`;
 const parcelLine={commercial_line_kind:'legacy_single_sku_parcel',product_id:product,parcel_quantity:1,units_per_parcel:12};
 const singleLine={commercial_line_kind:'base_unit',product_id:product,base_quantity:1};
 const pos=(line,amount,request)=>`public.create_pos_sale_v2('${warehouse}','${branch}',NULL,'ON225 test','cash',${quote(JSON.stringify([{...line,price_authority:'server_catalog',line_discount_in_minor_units:0}]))}::JSONB,0,${amount},'${request}')`;
 await check('existing POS RPC rejects a paused parcel but retains the independent single sale price',`${preparePausedSale}
 ${reject('PERFORM '+pos(parcelLine,11000,'on225-paused-pos-parcel')+';','PRICES225_PARCEL_PAUSED')}
 SELECT ${pos(singleLine,700,'on225-paused-pos-single')};
 RESET ROLE;
 DO $proof$ BEGIN
  IF (SELECT count(*) FROM public.order_items WHERE product_id='${product}' AND commercial_line_kind='base_unit'
    AND line_total_in_minor_units=700 AND unit_cost_snapshot_in_minor_units_exact=800)<>1 THEN
   RAISE EXCEPTION 'POS_SINGLE_SNAPSHOT_CHANGED';
  END IF;
 END $proof$;`);
 const phone='0799000225',phoneHash=createHash('sha256').update(phone).digest('hex');
 const guest=(line,amount,request)=>`public.submit_guest_customer_order_v2('${request}',repeat('c',64),'${phoneHash}',
  'ON225 guest','${phone}','إربد','الرمثا','اختبار','اختبار',NULL,NULL,NULL,NULL,NULL,NULL,
  ${quote(JSON.stringify([{...line,expected_unit_price_in_minor_units:amount}]))}::JSONB,NULL,'cash_on_delivery','inside_ramtha',
  ${amount},0,1000,${amount+1000})`;
 await check('existing guest RPC rejects a paused parcel and accepts a unit without changing saved price',`${preparePausedSale}
 RESET ROLE;
 SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);SET LOCAL ROLE service_role;
 ${reject('PERFORM '+guest(parcelLine,11000,id(503))+';','PRICES225_PARCEL_PAUSED')}
 SELECT ${guest(singleLine,700,id(504))};
 RESET ROLE;
 DO $proof$ BEGIN
  IF (SELECT count(*) FROM public.order_items WHERE product_id='${product}' AND commercial_line_kind='base_unit'
    AND line_total_in_minor_units=700)<>1 THEN RAISE EXCEPTION 'GUEST_SINGLE_SNAPSHOT_CHANGED';END IF;
 END $proof$;`);
 await check('ON catalog filters and pages by available single units even when no complete parcel fits',`${authenticated}
 SELECT public.set_go_live_main_branch_v1('${branch}');
 SELECT public.apply_inventory_opening_setup('${warehouse}',${quote(JSON.stringify([{productId:product,packageCount:0,looseUnits:3}]))}::JSONB,'ON225 fixture','on225-catalog-opening-stock');
 RESET ROLE;SET LOCAL ROLE anon;
 DO $proof$ DECLARE page JSONB;row JSONB; BEGIN
  page:=public.public_storefront_catalog_page225(p_limit=>1,p_availability=>'available',p_product_ids=>ARRAY['${product}'::UUID]);
  row:=page->'items'->0;
  IF page->>'total' IS DISTINCT FROM '1' OR row->>'isAvailable' IS DISTINCT FROM 'true'
     OR row->>'availableSalePackages' IS DISTINCT FROM '0' OR row->>'availableQuantity' IS DISTINCT FROM '3'
     OR row->>'salePriceInMinorUnits' IS DISTINCT FROM '1000' OR row->>'salePackagePriceInMinorUnits' IS DISTINCT FROM '11000' THEN
   RAISE EXCEPTION 'LOOSE_CATALOG_AVAILABILITY_WRONG';
  END IF;
  IF row ? 'wac' OR row ? 'costPriceInMinorUnits' THEN RAISE EXCEPTION 'PRIVATE_COST_EXPOSED';END IF;
 END $proof$;`);
 await check('ON public catalog marks paused parcels unavailable while retaining the product price',`${preparePausedSale}
 RESET ROLE;SET LOCAL ROLE anon;
 DO $proof$ DECLARE page JSONB;row JSONB;BEGIN
  page:=public.public_storefront_catalog_page225(p_limit=>1,p_availability=>'available',p_product_ids=>ARRAY['${product}'::UUID]);
  row:=page->'items'->0;
  IF page->>'total' IS DISTINCT FROM '1' OR row->>'parcelSaleEnabled' IS DISTINCT FROM 'false'
     OR row->>'availableSalePackages' IS DISTINCT FROM '0' OR row->>'availableQuantity' IS DISTINCT FROM '48'
     OR row->>'salePriceInMinorUnits' IS DISTINCT FROM '700' OR row->>'isAvailable' IS DISTINCT FROM 'true' THEN
   RAISE EXCEPTION 'PAUSED_CATALOG_AVAILABILITY_WRONG';
  END IF;
  SELECT item INTO row FROM jsonb_array_elements(public.public_storefront_merchandising225()->'newest') item
  WHERE item->>'id'='${product}';
  IF row->>'parcelSaleEnabled' IS DISTINCT FROM 'false' OR row->>'availableSalePackages' IS DISTINCT FROM '0'
     OR row->>'salePriceInMinorUnits' IS DISTINCT FROM '700' OR row->>'isAvailable' IS DISTINCT FROM 'true' THEN
   RAISE EXCEPTION 'PAUSED_HOME_RAIL_AVAILABILITY_WRONG';
  END IF;
 END $proof$;`);
 await check('sellable POS reader retains exact prices and exposes the temporary parcel pause',`${preparePausedSale}
 DO $proof$ DECLARE row JSONB;BEGIN
  row:=public.search_pos_products225(NULL,1,NULL,'${product}')->0;
  IF row->>'id' IS DISTINCT FROM '${product}' OR row->>'parcel_sale_enabled' IS DISTINCT FROM 'false'
     OR row->>'sale_price_in_minor_units' IS DISTINCT FROM '700' OR row->>'default_sale_price_in_minor_units' IS DISTINCT FROM '11000' THEN
   RAISE EXCEPTION 'POS225_PRICE_OR_PAUSE_WRONG';
  END IF;
 END $proof$;`);
 const family=id(100),a=id(101),b=id(102);
 await check('existing family updates keep both explicit prices on every flavor without changing costs',`
 UPDATE public.products SET purchase_unit_id='${id(225)}',sale_unit_id='${id(225)}',
  units_per_purchase_unit=12,units_per_sale_unit=12,default_sale_price_in_minor_units=11000,sale_price_in_minor_units=1000
 WHERE id='${family}';
 ${authenticated}
 DO $proof$ DECLARE p public.products;result JSONB;BEGIN
  ${edit(1500,17000,'true','NULL','NULL',family)}
  IF (SELECT count(*) FROM public.products WHERE (id='${family}' OR flavor_master_product_id='${family}')
    AND sale_price_in_minor_units=1500 AND default_sale_price_in_minor_units=17000 AND units_per_sale_unit=12)<>3 THEN
   RAISE EXCEPTION 'UPDATED_FAMILY_EXPLICIT_PRICES_NOT_INHERITED';
  END IF;
  IF EXISTS(SELECT 1 FROM public.products WHERE flavor_master_product_id='${family}'
    AND (wac_cost_in_minor_units_exact<>0 OR cost_price_in_minor_units<>0)) THEN RAISE EXCEPTION 'FAMILY_PRICE_EDIT_CHANGED_WAC';END IF;
  BEGIN ${edit(1500,17000,'true','NULL','NULL',a)} RAISE EXCEPTION 'CHILD_PRICE_OVERRIDE_ACCEPTED';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'PRICES225_EDIT_FAMILY_REQUIRED:%' THEN RAISE;END IF;END;
 END $proof$;`);
 await check('a reserved website parcel created before the pause still settles at its saved price',`${preparePausedSale}
 DO $proof$ DECLARE p public.products;result JSONB;BEGIN ${edit(1000,11000,'true')} END $proof$;
 RESET ROLE;SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);SET LOCAL ROLE service_role;
 SELECT set_config('on225.pending_order_id',(${guest(parcelLine,11000,id(509))}->>'order_id'),true);
 RESET ROLE;${authenticated}
 DO $proof$ DECLARE p public.products;result JSONB;BEGIN ${edit(1000,11000,'false')} END $proof$;
 SELECT public.accept_order_for_preparation(current_setting('on225.pending_order_id')::UUID,'قبل الإيقاف');
 SELECT public.update_order_status(current_setting('on225.pending_order_id')::UUID,'ready','قبل الإيقاف');
 DO $proof$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.orders WHERE id=current_setting('on225.pending_order_id')::UUID
    AND total_in_minor_units=12000 AND delivery_fee_in_minor_units=1000) THEN RAISE EXCEPTION 'PAUSE_CHANGED_SAVED_ORDER_TOTAL';END IF;
 END $proof$;
 SELECT public.complete_website_order_with_settlement_v2(current_setting('on225.pending_order_id')::UUID,'${id(510)}','cash',12000,NULL,NULL,'ON225 pending');
 RESET ROLE;
 DO $proof$ BEGIN
  IF (SELECT count(*) FROM public.order_items WHERE order_id=current_setting('on225.pending_order_id')::UUID
    AND product_id='${product}' AND quantity=12 AND line_total_in_minor_units=11000 AND cogs_in_minor_units=9600)<>1 THEN
   RAISE EXCEPTION 'PAUSE_CHANGED_PRIOR_RESERVED_ORDER_SNAPSHOT';
  END IF;
 END $proof$;`);
 await check('public and POS mixed parcel readers retain eligible options and omit the paused family',`${authenticated}
 SELECT public.set_go_live_main_branch_v1('${branch}');
 RESET ROLE;
 UPDATE public.products SET cost_price_in_minor_units=800,wac_cost_in_minor_units_exact=800 WHERE id IN('${a}','${b}');
 SET LOCAL ROLE authenticated;
 SELECT public.apply_inventory_opening_setup('${warehouse}',${quote(JSON.stringify([{productId:a,packageCount:1,looseUnits:0},{productId:b,packageCount:1,looseUnits:0}]))}::JSONB,'ON225 fixture','on225-mixed-parcel-opening-stock');
 SELECT public.save_product_parcel_configuration_v1('${family}','configurable_mix',true,5,ARRAY['${a}','${b}']::UUID[]);
 SELECT public.set_configurable_parcel_feature_state_v1('ENABLED');
 DO $proof$ BEGIN
  IF jsonb_array_length(public.get_pos_parcel_options225('${warehouse}')->'options')<1
    OR public.get_pos_parcel_options225('${warehouse}') IS DISTINCT FROM public.get_pos_configurable_parcel_options_v1('${warehouse}') THEN
   RAISE EXCEPTION 'ENABLED_POS_MIX_OPTION_CHANGED';
  END IF;
 END $proof$;
 RESET ROLE;SET LOCAL ROLE anon;
 DO $proof$ BEGIN
  IF jsonb_array_length(public.get_public_parcel_options225(ARRAY['${family}']::UUID[])->'options')<>1
    OR public.get_public_parcel_options225(ARRAY['${family}']::UUID[]) IS DISTINCT FROM public.get_public_configurable_parcel_options(ARRAY['${family}']::UUID[]) THEN
   RAISE EXCEPTION 'ENABLED_PUBLIC_MIX_OPTION_CHANGED';
  END IF;
 END $proof$;
 RESET ROLE;
 INSERT INTO public.product_sale_pricing_state225(product_id,parcel_enabled,changed_by) VALUES('${family}',false,'${id(1)}');
 SET LOCAL ROLE anon;
 DO $proof$ BEGIN
  IF public.get_public_parcel_options225(ARRAY['${family}']::UUID[])->'options' IS DISTINCT FROM '[]'::JSONB THEN
   RAISE EXCEPTION 'PAUSED_PUBLIC_MIX_OPTION_PRESENT';
  END IF;
 END $proof$;
 RESET ROLE;SET LOCAL ROLE authenticated;
 DO $proof$ BEGIN
  IF public.get_pos_parcel_options225('${warehouse}')->'options' IS DISTINCT FROM '[]'::JSONB THEN
   RAISE EXCEPTION 'PAUSED_POS_MIX_OPTION_PRESENT';
  END IF;
 END $proof$;`);
 await check('ON225 capability is read-only and the workbook can finish identifiers without changing either price',`${authenticated}
 DO $proof$ DECLARE result JSONB;parent public.products;child public.products;BEGIN
  IF public.get_product_pricing_context225(NULL) IS DISTINCT FROM '{"contractVersion":"on-independent-prices225-v1","mode":"full"}'::JSONB THEN RAISE EXCEPTION 'ON225_CAPABILITY_WRONG';END IF;
  result:=public.create_product_family_with_flavors_v4(p_sku=>'ON225-TEMP',p_name_ar=>'عائلة استيراد وهمية',p_category_id=>'${id(11)}',p_unit_id=>'${id(10)}',p_purchase_unit_id=>'${id(225)}',p_units_per_purchase_unit=>12,p_default_purchase_price_in_minor_units=>9600,p_sale_unit_id=>'${id(225)}',p_units_per_sale_unit=>12,p_default_sale_price_in_minor_units=>11000,p_cost_price_in_minor_units=>800,p_warehouse_id=>'${id(201)}',p_flavors=>'[{"nameAr":"أ"}]'::JSONB,p_parcel_only=>false,p_sale_price_in_minor_units=>1000);
  SELECT * INTO STRICT parent FROM public.products WHERE id=(result->>'productId')::UUID;
  result:=public.update_product_master_v7(parent.id,parent.updated_at,'ON225-FINAL',NULL,parent.name_ar,parent.description,
   parent.category_id,parent.brand_id,parent.unit_id,parent.purchase_unit_id,parent.units_per_purchase_unit,parent.default_purchase_price_in_minor_units,
   parent.sale_unit_id,parent.units_per_sale_unit,parent.default_sale_price_in_minor_units,parent.cost_price_in_minor_units,parent.min_stock_level,parent.max_stock_level,
   parent.is_active,NULL,parent.sale_price_in_minor_units,parent.parcel_only);
  IF result->'originalUnitPrice'<>'null'::JSONB OR result->'originalParcelPrice'<>'null'::JSONB THEN RAISE EXCEPTION 'ON225_IMPORT_INITIAL_ORIGINALS';END IF;
  SELECT * INTO STRICT child FROM public.products WHERE flavor_master_product_id=parent.id;
  PERFORM public.update_product_master_v5(child.id,child.updated_at,'ON225-FINAL-A','000123',child.name_ar,child.description,
   child.category_id,child.brand_id,child.unit_id,child.purchase_unit_id,child.units_per_purchase_unit,child.default_purchase_price_in_minor_units,
   child.sale_unit_id,child.units_per_sale_unit,child.default_sale_price_in_minor_units,child.cost_price_in_minor_units,child.min_stock_level,child.max_stock_level,child.is_active,NULL,NULL);
  IF (SELECT count(*) FROM public.products WHERE (id=parent.id OR flavor_master_product_id=parent.id)
   AND sale_price_in_minor_units=1000 AND default_sale_price_in_minor_units=11000)<>2 OR
   (SELECT barcode FROM public.products WHERE id=child.id) IS DISTINCT FROM '000123' THEN RAISE EXCEPTION 'ON225_IMPORT_FINISH_PRICE_OR_BARCODE_CHANGED';END IF;
 END $proof$;`);
 const receiptLine=[{client_line_id:id(702),purchase_order_item_id:null,line_kind:'base_unit',commercial_quantity:2,
  base_unit_name:'باكيت',gross_amount_in_minor_units:2000,line_discount_in_minor_units:0,components:[{product_id:product,base_quantity:2}]}];
 await check('receipt warning uses the committed WAC and reading it leaves the remembered prices intact',`${preparePausedSale}
 DO $proof$ DECLARE received JSONB;quote JSONB;before_prices JSONB;BEGIN
  received:=public.create_direct_supplier_receipt_v2(p_supplier_id=>'${id(301)}',p_warehouse_id=>'${warehouse}',
   p_branch_id=>'${branch}',p_supplier_invoice_number=>'ON225-PRICE-WARNING-1',
   p_amount_paid_at_receipt_in_minor_units=>0,p_payment_method=>'deferred',p_idempotency_key=>'on225-receipt-pricing-warning-1',
   p_lines=>${quote(JSON.stringify(receiptLine))}::JSONB);
  IF received->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'ON225_RECEIPT_NOT_COMMITTED';END IF;
  before_prices:=public.get_product_pricing_context225('${product}');
  quote:=public.get_receipt_pricing_warnings225(ARRAY['${product}']::UUID[])->0;
  IF quote->>'unitPrice' IS DISTINCT FROM '700' OR quote->>'parcelPrice' IS DISTINCT FROM '11000'
   OR quote->>'originalUnitPrice' IS DISTINCT FROM '1000' OR (quote->>'wacInMinorUnitsExact')::NUMERIC IS DISTINCT FROM 808::NUMERIC
   OR quote->>'unitBelowCost' IS DISTINCT FROM 'true' OR quote->>'parcelEnabled' IS DISTINCT FROM 'false'
   OR quote->>'parcelBelowCost' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'ON225_RECEIPT_QUOTE_WRONG';END IF;
  IF public.get_product_pricing_context225('${product}') IS DISTINCT FROM before_prices THEN RAISE EXCEPTION 'ON225_READ_WROTE_PRICES';END IF;
  IF has_function_privilege('anon','public.get_receipt_pricing_warnings225(uuid[])','EXECUTE') THEN RAISE EXCEPTION 'ON225_PUBLIC_COST_LEAK';END IF;
 END $proof$;`);
 report.ok=true;
}catch(error){report.stage=stage;report.error=error.message.split('\n')[0];process.exitCode=1;}
finally{await local?.stop();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,stage,output,cases:report.cases.length}));}
