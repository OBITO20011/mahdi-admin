import {verifyShiftReversalGuard} from './sales-only-phase2-shift-guard-runtime.mjs';
import {verifyLiteWorkbookImport} from './sales-only-phase2-workbook-runtime.mjs';
import {verifyLiteProductDefinitions} from './sales-only-phase2-product-definitions.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {setTimeout} from 'node:timers/promises';
import {executeInput} from '../operations/build-empty-supabase.mjs';
import {assertLiteral220FunctionRows} from './sales-only220-runtime-functions.mjs';
import {functionCatalogSql} from './sales-only-phase1-runtime.mjs';
import {tsImport} from 'tsx/esm/api';
import {returnPayload215} from './aftercare215-return-cases.mjs';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';

export async function verifyOpeningEpoch220(c,report){
 const {sql,json,rpc,id,q,j,executor}=c,key=()=>randomUUID(),branch=id(200),warehouse=id(201),pid=id(103);
 const before=await json(functionCatalogSql);
 assertLiteral220FunctionRows(before);assert.equal(await sql('SELECT max(version) FROM supabase_migrations.schema_migrations;'),'220');
 const movementModule=await tsImport('../../src/services/supabase/cashShiftMovements.service.ts',import.meta.url);
 const proveMovements=async(sid,kind,method,expectedTotal,expectedSource)=>{
  const beforeRead=await readApplicationFingerprint(executor),first=await rpc(`lite1_shift_movements2(${q(sid)},${q(kind)},${q(method)},1,1)`),parsed=movementModule.parseCashShiftMovementPage(first);
  assert.equal(parsed.evidenceStatus,'matched');assert.equal(parsed.canonicalAmountInMinorUnits,expectedTotal);assert.equal(parsed.totalAmountInMinorUnits,expectedTotal);
  if(expectedSource)assert.ok(parsed.rows.some(r=>r.source===expectedSource));
  const ids=[];for(let page=1;page<=parsed.totalPages;page++){const value=movementModule.parseCashShiftMovementPage(await rpc(`lite1_shift_movements2(${q(sid)},${q(kind)},${q(method)},${page},1)`));assert.equal(value.totalAmountInMinorUnits,expectedTotal);ids.push(...value.rows.map(r=>r.source+':'+r.id));}
  assert.equal(ids.length,parsed.totalCount);assert.equal(new Set(ids).size,ids.length);assert.deepEqual((await readApplicationFingerprint(executor)).tables,beforeRead.tables,'DRAWER_PAGE_READONLY');return first;
 };
 const fail=async(call,pattern)=>{let error;try{await rpc(call);}catch(e){error=e;}assert.ok(error,'EXPECTED_EPOCH_REFUSAL');assert.match(error.message,pattern);};
 const ownState=()=>json(`SELECT jsonb_build_object('mode',(SELECT to_jsonb(m) FROM sales_lite1.mode m),
  'requests',(SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY key),'[]') FROM sales_lite1.requests r),
  'epochs',(SELECT count(*) FROM sales_lite2.opening_epochs),'items',(SELECT count(*) FROM sales_lite2.opening_epoch_items));`);
 const ledger=()=>json(`SELECT jsonb_build_object('goLive',(SELECT to_jsonb(s) FROM public.go_live_setup_state s),
  'customers',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.customers x),'orders',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.orders x),
  'items',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.order_items x),'payments',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.customer_payments x),
  'openings',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.customer_opening_balances x),'shifts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cash_shifts x));`);
 await fail('lite1_set_mode(false)',/permission denied/);
 await rpc(`save_product_parcel_configuration_v1(${q(id(100))},'configurable_mix',true,5,ARRAY[${q(id(101))},${q(id(102))}]::UUID[])`);
 await rpc("set_configurable_parcel_feature_state_v1('ENABLED')");
 await sql(`UPDATE public.products SET wac_cost_in_minor_units_exact=NULL WHERE id IN(${q(id(101))},${q(id(102))});`);
 assert.deepEqual((await rpc(`get_pos_configurable_parcel_options_v1(${q(warehouse)})`)).options,[],'FULL_READER_STILL_REQUIRES_WAC_AND_STOCK');
 await rpc('lite1_set_mode2(false)');
 await verifyLiteProductDefinitions(c,report);
 await verifyLiteWorkbookImport(c,report);
 // Synthetic catalog only:72 parent families,345 new flavors,820 leaf SKUs.
 const currentLeaves=Number(await sql('SELECT count(*) FROM public.products WHERE is_active AND NOT is_flavor_master;'));
 const newLeaves=820-currentLeaves;assert.ok(newLeaves>=345);
 const seeded=[...Array.from({length:72},(_,i)=>({id:id(20000+i),sku:'EPOCH-FAMILY-'+i,name:'عائلة جرد وهمية '+i,master:true,parent:null,flavor:null})),...Array.from({length:newLeaves},(_,i)=>({id:id(10000+i),sku:'000-EPOCH-'+String(i).padStart(5,'0'),name:'صنف جرد وهمي '+i,master:false,parent:i<345?id(20000+i%72):null,flavor:i<345?'نكهة '+i:null}))];
 await sql(`INSERT INTO public.products(id,sku,name_ar,category_id,unit_id,purchase_unit_id,sale_unit_id,units_per_purchase_unit,units_per_sale_unit,default_purchase_price_in_minor_units,default_sale_price_in_minor_units,cost_price_in_minor_units,sale_price_in_minor_units,wholesale_price_in_minor_units,min_stock_level,is_active,is_flavor_master,flavor_master_product_id,flavor_name_ar,wac_cost_in_minor_units_exact)
 SELECT(x->>'id')::UUID,x->>'sku',x->>'name',p.category_id,p.unit_id,p.purchase_unit_id,p.sale_unit_id,p.units_per_purchase_unit,p.units_per_sale_unit,0,p.default_sale_price_in_minor_units,0,p.sale_price_in_minor_units,p.wholesale_price_in_minor_units,0,true,(x->>'master')::BOOLEAN,(x->>'parent')::UUID,x->>'flavor',NULL
 FROM jsonb_array_elements(${j(seeded)}) x CROSS JOIN public.products p WHERE p.id=${q(pid)} ORDER BY (x->>'master')::BOOLEAN DESC,x->>'id';`);
 const warehouseCount=Number(await sql('SELECT count(*) FROM public.warehouses w JOIN public.branches b ON b.id=w.branch_id WHERE w.is_active AND b.is_active;'));assert.ok(warehouseCount<=2);
 if(warehouseCount<2)await sql(`INSERT INTO public.warehouses(id,branch_id,code,name_ar,is_active) VALUES(${q(id(202))},${q(branch)},'EPOCH-SECOND','مستودع الجرد الثاني',true);`);
 const epochModel=await tsImport('../../src/features/operatingMode/openingEpoch.ts',import.meta.url),epochService=await tsImport('../../src/services/supabase/openingEpoch.service.ts',import.meta.url);
 const epochClient={auth:{getUser:async()=>({data:{user:{id:id(1)}},error:null}),mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:'aal2'},error:null})}},rpc:async(name,args={})=>{
  assert.ok(['lite1_epoch_catalog2','lite1_preview_epoch2','lite1_activate_epoch2'].includes(name),'EXPECTED_EPOCH_RPC_ONLY');const argumentsSql=Object.entries(args).map(([name,value])=>name+':='+(typeof value==='object'&&value!==null?j(value):q(value))).join(',');return {data:await rpc(name+'('+argumentsSql+')'),error:null};}};
 const catalogBefore=await readApplicationFingerprint(executor),epochCatalog=await epochService.readEpochCatalogWithClient(epochClient,id(1));assert.equal(epochCatalog.length,1640);assert.deepEqual(await readApplicationFingerprint(executor),catalogBefore,'EPOCH_CATALOG_READONLY');
 report.cases.push({name:'realTS activationmanifest ownerAAL2→1640rows/820leafSKUs/72newfamilies+345flavors/2warehouses;readonly',passed:true});
 const optionsBefore=await readApplicationFingerprint(executor),options=await rpc(`lite1_pos_options2(${q(warehouse)})`);
 assert.equal(options.options.length,1);assert.equal(options.options[0].quantityTracked,false);assert.equal(options.options[0].components.length,2);
 assert.ok(options.options[0].components.every(p=>p.manualAvailable===true&&!('availableQuantity' in p)));
 assert.deepEqual(await readApplicationFingerprint(executor),optionsBefore,'LITE_OPTIONS_READONLY');
 assert.equal(await sql("SELECT has_function_privilege('anon','public.lite1_pos_options2(uuid)','EXECUTE');"),'f');
 report.cases.push({name:'parallel POS mixed options with no WAC;no synthetic stock;read-only/anon denied;full reader unchanged',passed:true});
 const availability=await tsImport('../../src/services/supabase/manualAvailability.service.ts',import.meta.url);
 const availabilityRpc=async(name,args)=>({data:await rpc(name==='lite1_product_availability2'
  ?`lite1_product_availability2(p_product_ids:=ARRAY[${args.p_product_ids.map(q).join(',')}]::UUID[])`
  :`lite1_set_available2(p_product:=${q(args.p_product)},p_available:=${args.p_available},p_revision:=${args.p_revision})`),error:null});
 let manual=await availability.readManualAvailabilityWithRpc([id(100),id(101),pid],availabilityRpc);
 assert.ok(manual.products.every(p=>p.available&&p.effectiveAvailable&&p.revision===0));
 await availability.setManualAvailabilityWithRpc(id(100),false,0,availabilityRpc);
 manual=await availability.readManualAvailabilityWithRpc([id(100),id(101)],availabilityRpc);
 assert.equal(manual.products.find(p=>p.productId===id(101)).effectiveAvailable,false,'PARENT_MANUAL_FLAG_IS_INHERITED');
 assert.equal(manual.products.find(p=>p.productId===id(101)).available,true);
 await fail(`lite1_set_available2(${q(id(100))},true,0)`,/LITE1_AVAILABILITY_STALE/);
 assert.ok((await rpc(`lite1_pos_options2(${q(warehouse)})`)).options[0].components.every(p=>p.manualAvailable===false),'MIXED_PARENT_AVAILABILITY_IS_INHERITED');
 await availability.setManualAvailabilityWithRpc(id(100),true,1,availabilityRpc);
 await fail(`lite1_set_available(${q(pid)},false,0)`,/permission denied/);
 const acl=await json(`SELECT jsonb_build_object('anon',has_function_privilege('anon','public.lite1_product_availability2(uuid[])','EXECUTE'),
  'service',has_function_privilege('service_role','public.lite1_set_available2(uuid,boolean,integer)','EXECUTE'));`);
 assert.deepEqual(acl,{anon:false,service:false});
 report.cases.push({name:'actualavailability client→PG;manualfamily/leaf inheritance+revisionCAS;oldprototype/anon/service entrypoints denied;no synthetic quantity',passed:true});
 const rows=await json(`SELECT jsonb_agg(jsonb_build_object('productId',p.id,'warehouseId',w.id,'actualQuantity',CASE WHEN p.id IN(${q(pid)}::UUID,(SELECT first.id FROM public.products first WHERE first.is_active AND NOT first.is_flavor_master ORDER BY first.id LIMIT 1)) OR hashtext(p.id::TEXT)%2<>0 THEN 20 ELSE 0 END,'unitCostInMinorUnits',500) ORDER BY p.id,w.id)
 FROM public.products p CROSS JOIN public.warehouses w JOIN public.branches b ON b.id=w.branch_id WHERE p.is_active AND NOT p.is_flavor_master AND w.is_active AND b.is_active;`);
 const notes='جرد تفعيل بعد فترة تشغيل مبسطة - بيانات وهمية';
 const previewCall=(r=rows,n=notes)=>`lite1_preview_epoch2(${j(r)},${q(n)})`;
 const apply=(preview,identity=key(),r=rows,n=notes)=>`lite1_activate_epoch2(${j(r)},${q(n)},${q(identity)},${q(preview.previewFingerprint)},'تفعيل المحاسبة بالجرد المعتمد')`;
 const private0=await ownState(),fp0=await readApplicationFingerprint(executor);
 await fail(previewCall(),/LITE2_EPOCH_GO_LIVE_NOT_FINISHED/);
 assert.deepEqual(await ownState(),private0);assert.deepEqual(await readApplicationFingerprint(executor),fp0);
 await rpc("finish_go_live_setup_v1('إنهاء بداية التشغيل')");
 const shift=(await rpc(`open_cash_shift(${q(branch)},10000)`)).id;
 const line={commercial_line_kind:'base_unit',product_id:pid,base_quantity:3};
 const sale=await rpc(`lite1_pos2(${j({branchId:branch,warehouseId:warehouse,customerId:id(401),paymentMethod:'debt',lines:[line],discountInMinorUnits:0,amountReceivedInMinorUnits:0})},${q(key())})`);
 const paidLiteSale=await rpc(`lite1_pos2(${j({branchId:branch,warehouseId:warehouse,customerId:id(401),paymentMethod:'cash',lines:[{...line,base_quantity:1}],discountInMinorUnits:0,amountReceivedInMinorUnits:1000})},${q(key())})`);
 const oldCliQSale=await rpc(`lite1_pos2(${j({branchId:branch,warehouseId:warehouse,customerId:id(401),paymentMethod:'cliq',lines:[{...line,base_quantity:3}],discountInMinorUnits:0,amountReceivedInMinorUnits:3000})},${q(key())})`);
 await rpc(`record_customer_order_payment_once(${q(sale.orderId)},500,'cash',NULL,'تحصيل على فاتورة مبسطة',${q(key())})`);
 await fail(previewCall(),/LITE1_MODE_REQUIRES_QUIESCENCE/);
 await proveMovements(shift,'sales','cash',1000,'order');await proveMovements(shift,'sales','cliq',3000,'order');await proveMovements(shift,'receipts','cash',500,'customer_payment');
 const summary=await rpc(`get_cash_shift_summary(${q(shift)})`);await rpc(`close_cash_shift(${q(shift)},${summary.expectedCashInMinorUnits},NULL)`);
 const history=await ledger(),canonical=await rpc(`lite1_customer_statement2(${q(id(401))},1,100)`);
 assert.equal(canonical.closing_balance_in_minor_units,2500);
 await fail(`apply_inventory_opening_setup(${q(warehouse)},${j([{productId:pid,packageCount:1,looseUnits:0}])},'جرد محمي قديم',${q(key())})`,/GO_LIVE_SETUP_FINISHED/);
 const readOnly=await readApplicationFingerprint(executor),previewStart=performance.now();
 const clientPreview=await epochService.previewOpeningEpochWithClient(epochClient,id(1),rows,notes),previewReadMs=performance.now()-previewStart;
 assert.ok(previewReadMs<8000,'EPOCH_PREVIEW_8S');let preview=await rpc(previewCall());
 assert.deepEqual(epochModel.parseEpochPreview(preview,rows),clientPreview);
 assert.equal(preview.itemCount,rows.length);assert.equal(preview.totalValueExact,epochModel.epochTotals(rows).totalValueExact);
 assert.deepEqual(await readApplicationFingerprint(executor),readOnly,'EPOCH_PREVIEW_ZERO_WRITES');
 const assertDenied=async(r,pattern)=>{const fp=await readApplicationFingerprint(executor),state=await ownState();await fail(previewCall(r),pattern);assert.deepEqual(await readApplicationFingerprint(executor),fp);assert.deepEqual(await ownState(),state);};
 await assertDenied(rows.slice(1),/LITE2_EPOCH_COMPLETE_COUNT_REQUIRED/);
 await assertDenied([...rows,rows[0]],/LITE2_EPOCH_DUPLICATE_OR_COST_CONFLICT/);
 await assertDenied(rows.map((r,i)=>i? r:{...r,unitCostInMinorUnits:0}),/LITE2_EPOCH_COST_QUANTITY_INVALID/);
 await assertDenied(rows.map((r,i)=>i? r:{...r,actualQuantity:-1}),/LITE2_EPOCH_ROW_INVALID/);
 const weakClaims={sub:id(1),role:'authenticated',aal:'aal1'};
 let aalError;try{await json(`BEGIN;SELECT set_config('request.jwt.claims',${j(weakClaims)}::TEXT,true);SET LOCAL ROLE authenticated;SELECT public.${previewCall()};COMMIT;`);}catch(e){aalError=e;}
 assert.ok(aalError);assert.match(aalError.message,/LITE2_OWNER_AAL2_REQUIRED/);
 await fail(apply({...preview,previewFingerprint:'0'.repeat(64)}),/LITE2_EPOCH_PREVIEW_CHANGED/);
 await sql(`UPDATE public.products SET updated_at=clock_timestamp() WHERE id=${q(pid)};`);
 await fail(apply(preview),/LITE2_EPOCH_PREVIEW_CHANGED/);preview=await rpc(previewCall());
 const holder=executeInput(executor,"SET application_name='lite2-epoch-blocker';BEGIN;SELECT 1 FROM sales_lite1.mode WHERE id FOR SHARE;SELECT pg_sleep(4);ROLLBACK;");
 let ready=false;for(let i=0;i<12;i++){ready=(await sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='lite2-epoch-blocker' AND query LIKE '%pg_sleep(4)%' AND state='active');"))==='t';if(ready)break;await setTimeout(50);}
 try{assert.equal(ready,true,'MODE_HOLDER_READY');await fail(apply(preview),/LITE2_EPOCH_BUSY/);}finally{const held=await holder;assert.equal(held.code,0,held.stderr);}
 report.cases.push({name:'AAL2/GoLivefinished/completecount/cost/quantity/duplicate/seal guards;old047stilllocked;previewreadonly;oldprototypeentrypoint revoked',passed:true,itemCount:rows.length});
 // A deliberate failure after mode/cost/balance/movement writes must roll back
 // every table. PostgreSQL nextval gaps are real and are checked separately.
 await sql(`CREATE FUNCTION sales_lite2.inject_epoch_failure() RETURNS TRIGGER LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'LITE2_EPOCH_INJECTED_FAILURE';END$$;
 CREATE TRIGGER lite2_test_failure BEFORE INSERT ON sales_lite2.opening_epoch_items FOR EACH ROW EXECUTE FUNCTION sales_lite2.inject_epoch_failure();`);
 const beforeFailure=await readApplicationFingerprint(executor),privateFailure=await ownState();
 await fail(apply(preview),/LITE2_EPOCH_INJECTED_FAILURE/);
 const afterFailure=await readApplicationFingerprint(executor);assert.deepEqual(afterFailure.tables,beforeFailure.tables,'ALL_PUBLIC_ROWS_ROLL_BACK');assert.deepEqual(await ownState(),privateFailure);
 for(const name of Object.keys(afterFailure.sequences))if(name!=='inventory_movement_mutation_seq')assert.equal(afterFailure.sequences[name],beforeFailure.sequences[name],name);
 assert.ok(Number(afterFailure.sequences.inventory_movement_mutation_seq)>Number(beforeFailure.sequences.inventory_movement_mutation_seq),'POSTGRES_NONTRANSACTIONAL_SEQUENCE_GAP_RECORDED');
 await sql('DROP TRIGGER lite2_test_failure ON sales_lite2.opening_epoch_items;DROP FUNCTION sales_lite2.inject_epoch_failure();');
 const journal=new Map(),disk={getItem:key=>journal.get(key)??null,setItem:(key,value)=>journal.set(key,value)};
 const prepared=epochService.prepareOpeningEpochAttempt(id(1),epochModel.parseEpochPreview(preview,rows),notes,disk);
 // Process-crash fixture:journal persisted before two deliberately concurrent
 // same-key requests;neither response reached this client before its restart.
 disk.setItem(epochService.openingEpochJournalKey(id(1)),JSON.stringify({...prepared,status:'IN_FLIGHT'}));
 const canonicalRequest=await json(`SELECT sales_lite2.epoch_request(${j(rows)},${q(notes)});`);assert.deepEqual(canonicalRequest,{notes:notes.trim(),rows:[...rows].sort((a,b)=>a.productId.localeCompare(b.productId)||a.warehouseId.localeCompare(b.warehouseId))},'CANONICAL_MANIFEST_UNCHANGED_AFTER_AGGREGATION');
 const activationKey=prepared.key,call=apply(preview,activationKey),start=performance.now();
 const pair=await Promise.all([rpc(call),rpc(call)]),elapsed=performance.now()-start;
 assert.deepEqual(pair[0],pair[1]);assert.equal(pair[0].fullAccounting,true);
 report.activationWithReplayMs=elapsed;assert.ok(elapsed<8000,'EPOCH_ACTIVATION_8S:'+elapsed.toFixed(3));
 assert.deepEqual(await epochService.runOpeningEpochAttemptWithClient(epochClient,id(1),disk),pair[0]);
 assert.equal(epochService.readOpeningEpochAttempt(id(1),disk).key,activationKey);
 assert.equal(epochService.readOpeningEpochAttempt(id(1),disk).status,'SUCCEEDED');
 await fail(`lite1_pos_options2(${q(warehouse)})`,/LITE1_MODE_DISABLED/);
 await fail(`lite1_set_available2(${q(pid)},false,0)`,/LITE1_MODE_DISABLED/);
 assert.equal((await ownState()).epochs,1);assert.equal((await ownState()).items,rows.length);
 const done=await readApplicationFingerprint(executor),donePrivate=await ownState();assert.deepEqual(await rpc(call),pair[0]);
 assert.deepEqual(await readApplicationFingerprint(executor),done,'ACTIVATION_REPLAY_ZERO_WRITES');assert.deepEqual(await ownState(),donePrivate);
 await fail(apply(preview,activationKey,rows,notes+' مختلف'),/LITE1_IDEMPOTENCY_CONFLICT/);
 assert.deepEqual(await ledger(),history,'GO_LIVE_AND_ALL_FINANCIAL_ROWS_AND_IDENTITIES_UNTOUCHED');
 assert.deepEqual(await rpc(`lite1_customer_statement2(${q(id(401))},1,100)`),canonical);
 const actual=await json(`SELECT jsonb_agg(jsonb_build_object('productId',i.product_id,'warehouseId',i.warehouse_id,'actualQuantity',b.on_hand_quantity,'unitCostInMinorUnits',p.cost_price_in_minor_units) ORDER BY i.product_id,i.warehouse_id)
 FROM sales_lite2.opening_epoch_items i JOIN public.inventory_balances b ON b.product_id=i.product_id AND b.warehouse_id=i.warehouse_id JOIN public.products p ON p.id=i.product_id WHERE i.epoch_id=${q(pair[0].epochId)};`);
 assert.deepEqual(actual,rows);
 assert.equal(Number(await sql(`SELECT count(*) FROM sales_lite2.opening_epoch_items i JOIN public.products p ON p.id=i.product_id WHERE p.wac_cost_in_minor_units_exact IS DISTINCT FROM i.unit_cost::NUMERIC;`)),0);
 assert.equal(Number(await sql(`SELECT count(*) FROM public.inventory_movements WHERE reference_type='sales_lite2_opening_epoch' AND reference_id=${q(pair[0].epochId)};`)),rows.filter(row=>row.actualQuantity!==0).length);
 report.cases.push({name:'atomicrollback allrows/mode/evidence;2concurrentidenticalrequests oneepoch;actualTS crashjournal recovery;replayreadonly;counts/WAC exact andGoLive/ledger/IDs preserved',passed:true,activationWithReplayMs:elapsed,previewReadMs,itemCount:rows.length});
 const stock=()=>json(`SELECT jsonb_build_object('moves',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.inventory_movements x),'balances',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.inventory_balances x),'costs',(SELECT jsonb_agg(jsonb_build_array(id,cost_price_in_minor_units,wac_cost_in_minor_units_exact) ORDER BY id) FROM public.products));`);
 const stockAtEpoch=await stock(),item=await json(`SELECT to_jsonb(id) FROM public.order_items WHERE order_id=${q(sale.orderId)};`);
 const payload=returnPayload215({sale,item,pid},{quantity:1,good:1,method:'cash'}),returnPreview=await rpc(`lite1_preview_return2(${j(payload)})`);
 assert.equal(returnPreview.debtReductionInMinorUnits,'1000');await rpc(`lite1_settle_return2(${j(payload)},${q(key())},${q(returnPreview.previewFingerprint)})`);
 assert.deepEqual(await stock(),stockAtEpoch,'OLD_LITE_RETURN_AFTER_REAL_ACTIVATION_IS_NON_STOCK');
 assert.equal((await rpc(`lite1_customer_statement2(${q(id(401))},1,100)`)).closing_balance_in_minor_units,1500);
 // Pure48h rule also rejects a synthetic90-day-old completion, independent
 // of mode; no production clock or immutable historical evidence is changed.
 await assert.rejects(sql("SELECT sales_lite1.assert_return_window(clock_timestamp()-interval '90 days',clock_timestamp());"),/PHASE4_RETURN_WINDOW_EXPIRED/);
 const fullShift=(await rpc(`open_cash_shift(${q(branch)},0)`)).id;
 const full=await rpc(`create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(id(401))},'بعد التفعيل','cash',${j([{...line,base_quantity:1}])},0,1000,${q(key())})`);
 const fullPair=await json(`BEGIN;SELECT set_config('request.jwt.claims',${j({sub:id(1),role:'authenticated',aal:'aal2'})}::TEXT,true);SET LOCAL ROLE authenticated;SELECT jsonb_build_object('current',public.lite1_shift_closing2(${q(fullShift)}),'original',public.get_cash_shift_closing_report(${q(fullShift)}));COMMIT;`);assert.deepEqual(fullPair.current,fullPair.original,'FULL_SHIFT_WITHOUT_LITE_REFUND_EXACT_JSON');
 assert.equal(full.totalInMinorUnits,1000);assert.equal(full.items[0].cogsInMinorUnits,500);
 assert.equal(Number(await sql(`SELECT on_hand_quantity FROM public.inventory_balances WHERE product_id=${q(pid)} AND warehouse_id=${q(warehouse)};`)),19);
 const paidLiteItem=await json(`SELECT to_jsonb(id) FROM public.order_items WHERE order_id=${q(paidLiteSale.orderId)};`);
 const cashReturnPayload=returnPayload215({sale:paidLiteSale,item:paidLiteItem,pid},{quantity:1,good:1,method:'cash'}),cashReturnPreview=await rpc(`lite1_preview_return2(${j(cashReturnPayload)})`);
 assert.equal(cashReturnPreview.moneyRefundInMinorUnits,'1000');
 const stockBeforeOldCash=await stock();await rpc(`lite1_settle_return2(${j(cashReturnPayload)},${q(key())},${q(cashReturnPreview.previewFingerprint)})`);assert.deepEqual(await stock(),stockBeforeOldCash);
 const fullSummary=await rpc(`get_cash_shift_summary(${q(fullShift)})`);
 await proveMovements(fullShift,'refunds','cash',1000,'lite_return');
 assert.equal(fullSummary.cashRefundsInMinorUnits,1000);assert.equal(fullSummary.expectedCashInMinorUnits,0);
 for(const [kind,method]of [['sales','cash'],['sales','cliq'],['receipts','cash'],['expenses','cash'],['withdrawals','cash']]){const pair=await json(`BEGIN;SELECT set_config('request.jwt.claims',${j({sub:id(1),role:'authenticated',aal:'aal2'})}::TEXT,true);SET LOCAL ROLE authenticated;SELECT jsonb_build_object('current',public.lite1_shift_movements2(${q(fullShift)},${q(kind)},${q(method)},1,25),'original',public.get_cash_shift_movement_page(${q(fullShift)},${q(kind)},${q(method)},1,25));COMMIT;`);assert.deepEqual(pair.current,pair.original,'UNRELATED_FULL_DRAWER_WHOLE_JSON_EXACT');}
 const exceptionalPreview=await rpc(`lite1_preview_shift_reversal2(${q(fullShift)})`);assert.equal(exceptionalPreview.canExecute,false);assert.equal(exceptionalPreview.liteMonetaryRefundBlocked,true);
 const beforeRejected=await readApplicationFingerprint(executor);await fail(`reverse_cash_shift_with_operations(${q(fullShift)},'حارس رد مبلغ قديم',${q(key())})`,/LITE2_SHIFT_REVERSAL_HAS_LITE_REFUND/);assert.deepEqual((await readApplicationFingerprint(executor)).tables,beforeRejected.tables,'APPROVED_GUARD_ROLLS_BACK_ALL_PRIMITIVES');
 report.mixedReversal={preview:exceptionalPreview,directRejected:true,allPublicRowsIdentical:true};
 await rpc(`close_cash_shift(${q(fullShift)},${fullSummary.expectedCashInMinorUnits},NULL)`);
 const mixedClosing=await rpc(`get_cash_shift_closing_report(${q(fullShift)})`);
 report.mixedClosing={shift:mixedClosing.shift,reconciliation:mixedClosing.reconciliation,outflows:mixedClosing.outflows};
 assert.equal(mixedClosing.shift.cashRefundsInMinorUnits,1000,'MIXED_FULL_SHIFT_SUMMARY_OLD_LITE_REFUND');
 assert.equal(mixedClosing.outflows.cashRefundsInMinorUnits,1000,'MIXED_FULL_SHIFT_SNAPSHOT_OLD_LITE_REFUND');
 const closingReader=await tsImport('../../src/services/supabase/expenses-shifts.service.ts',import.meta.url),closedRows=await json(`SELECT to_jsonb(s) FROM public.cash_shifts s WHERE id=${q(fullShift)};`);
 const mixedRead=await rpc(`lite1_shift_closing2(${q(fullShift)})`),mappedMixed=closingReader.parseCashShiftClosingReport(mixedRead,fullShift);
 assert.equal(mixedRead.historyWithoutCost,true);assert.equal(mixedRead.returnCount,1);assert.equal(mixedRead.orderCount,1);assert.equal(mixedRead.returnMoneyInMinorUnits,1000);assert.equal(mappedMixed.returnCount,1);assert.equal(mappedMixed.shift.expectedCash,0);assert.equal(mappedMixed.shift.cashRefunds,1);
 assert.doesNotMatch(JSON.stringify(mixedRead),/grossProfit|cogs|unitCost|profitIn|costIn/i);assert.deepEqual(await json(`SELECT to_jsonb(s) FROM public.cash_shifts s WHERE id=${q(fullShift)};`),closedRows,'MIXED_READ_CANNOT_REWRITE_SNAPSHOT');
 assert.equal(await sql("SELECT has_function_privilege('anon','public.lite1_shift_closing2(uuid)','EXECUTE');"),'f');
 const period=await json(`SELECT jsonb_build_object('from',(now() AT TIME ZONE 'Asia/Amman')::DATE,'to',(now() AT TIME ZONE 'Asia/Amman')::DATE);`);
 const rawMixedReport=await rpc(`lite1_reporting_report2(${q(branch)},${q(period.from)},${q(period.to)})`),rawMixedHome=await rpc(`lite1_reporting_home2(${q(branch)})`);
 const reporting=await tsImport('../../src/services/supabase/reportingDispatch.service.ts',import.meta.url);
 assert.equal(reporting.parseAccountingReport(rawMixedReport,branch,period.from,period.to).kind,'mixed');
 assert.equal(reporting.parseAccountingHome(rawMixedHome,branch).historyWithoutCost,true);
 assert.equal(rawMixedReport.sales.grossSalesInMinorUnits,8000);assert.equal(rawMixedReport.sales.returnEntitlementInMinorUnits,2000);assert.equal(rawMixedReport.sales.netSalesInMinorUnits,6000);
 await proveMovements(fullShift,'refunds','cash',1000,'lite_return');
 report.cases.push({name:'actualTS drawerdecoder true litecash/CliQ/collections/refunds;boundedpages/noduplicates/canonicalequality/read-only/full-onlywholeJSONexact',passed:true});
 await verifyShiftReversalGuard(c,report,oldCliQSale);
 const monitor=await json('SELECT public.run_advanced_monitoring_checks();');assert.equal(monitor.integrityIssueCount,0,JSON.stringify(monitor));
 assertLiteral220FunctionRows(await json(functionCatalogSql));
 report.cases.push({name:'realactivation thenoldlitereturn nostock/debtcorrect;90daywindowclosed;unchangedfullPOS resumesrealstock/cost;mixedclosingreadonly/counts;integrity0 and628/636 guard',passed:true});

}
