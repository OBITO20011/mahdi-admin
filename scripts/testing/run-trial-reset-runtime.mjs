import {storage213Contract} from './storage213-contract.mjs';
import {readReady213Reference,assertReady213Catalog} from '../operations/frankfurt-reference213.mjs';
import {readReady212Reference,assertReady212Catalog} from '../operations/frankfurt-reference212.mjs';
import {readReady210Reference,assertReady210Catalog} from '../operations/frankfurt-reference210.mjs';
import {readReady211Reference,assertReady211Catalog} from '../operations/frankfurt-reference211.mjs';
import {readReady209Reference,assertReady209Catalog} from '../operations/frankfurt-reference209.mjs';
import {readReady208Reference,assertReady208Catalog} from '../operations/frankfurt-reference208.mjs';
import {readReady207Reference,assertReady207Catalog} from '../operations/frankfurt-reference207.mjs';
import {readReady206Reference} from '../operations/frankfurt-reference206.mjs';
import {readReady205Reference} from '../operations/frankfurt-reference205.mjs';
import {readReady204Reference} from '../operations/frankfurt-reference204.mjs';
import {readReady203Reference} from '../operations/frankfurt-reference203.mjs';
import {readReady202Reference} from '../operations/frankfurt-reference202.mjs';
// Disposable local Auth/Storage/DB only. Same reset executor as the owner CLI.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,copyFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {createClient} from '@supabase/supabase-js';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
import {resetWithExecutor,sqlLiteral as q,readRowCounts} from '../operations/trial-reset-core.mjs';
import {readReference182,readyReference182Name} from '../operations/frankfurt-reference182.mjs';
import {readReady199Reference} from '../operations/frankfurt-reference199.mjs';
import {readReady200Reference,assertReady200Catalog} from '../operations/frankfurt-reference200.mjs';
import {readReady201Reference,assertReady201Catalog} from '../operations/frankfurt-reference201.mjs';
import {schemaCatalogSql} from './schema-catalog.mjs';
import {functionReference} from '../operations/frankfurt-owner-build.mjs';
import {buildReference182} from '../operations/build-acl-reference182.mjs';
import {readNotificationSnapshot,transitionNotifications} from '../operations/frankfurt-notification-hold.mjs';
import {localTotp} from './local-totp.mjs';
import {stageHistoricalResetSource} from './historical-reset-source.mjs';

const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..'),cli=path.join(root,'node_modules/supabase/dist/supabase.js');
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-trial-reset-')),project='nawasrah-trial-reset-test';
let local,stage='bootstrap';const report={startedAt:new Date().toISOString(),output,managedAccess:false};
const executor=executorFor(['--container','supabase_db_'+project]);
const sql=async input=>{const r=await executeInput(executor,input);assert.equal(r.code,0,'LOCAL_RESET_SQL_FAILED:'+r.stderr.slice(0,400));return r.stdout.trim();};
const json=async input=>JSON.parse(await sql(input));
const cliCall=args=>exec(process.execPath,[cli,...args,'--local','--workdir',local,'--agent','no'],{cwd:root,windowsHide:true,maxBuffer:8*1024**2});
try{
 const latest213=process.argv.includes('--current213');
 const latest212=latest213||process.argv.includes('--current212');
 const latest211=latest212||process.argv.includes('--current211');
 const latest210=latest211||process.argv.includes('--current210');
 const latest209=latest210||process.argv.includes('--current209');
 const latest208=process.argv.includes('--current208');
 const latest207=process.argv.includes('--current207');
 const latest206=process.argv.includes('--current206');
 const latest205=process.argv.includes('--current205');
 const latest204=process.argv.includes('--current204');
 const latest203=process.argv.includes('--current203');
 const latest202=process.argv.includes('--current202');
 const latest201=process.argv.includes('--current201'),latest=process.argv.includes('--current200');
 assert.ok([latest209,latest208,latest207,latest206,latest205,latest204,latest203,latest202,latest201,latest,process.argv.includes('--current199')].filter(Boolean).length<=1,'ONE_RESET_CEILING_REQUIRED');
 const current=latest209||latest208||latest207||latest206||latest205||latest204||latest203||latest202||latest201||latest||process.argv.includes('--current199'),explicit=process.argv.slice(2).find(arg=>!['--current199','--current200','--current201','--current202','--current203','--current204','--current205','--current206','--current207','--current208','--current209','--current210','--current211','--current212','--current213'].includes(arg));
 assert.ok(!current||explicit,'CURRENT199_REFERENCE_PATH_REQUIRED');
 const referencePath=explicit??path.join(output,readyReference182Name);
 if(!process.argv[2])await buildReference182(['--output',referencePath]);
 const reference=await (latest213?readReady213Reference:latest212?readReady212Reference:latest211?readReady211Reference:latest210?readReady210Reference:latest209?readReady209Reference:latest208?readReady208Reference:latest207?readReady207Reference:latest206?readReady206Reference:latest205?readReady205Reference:latest204?readReady204Reference:latest203?readReady203Reference:latest202?readReady202Reference:latest201?readReady201Reference:latest?readReady200Reference:current?readReady199Reference:readReference182)(root,referencePath);
 // Exercise the exact182/199 owner pipeline using a byte-identical historical
 // source view, not the newer checkout. The production manifest guard stays strict.
 const checkoutCeiling=JSON.parse(await readFile(path.join(root,'docs/agent/project-state.json'),'utf8')).migrationCeiling;
 const sourceRoot=reference.migrationCeiling===checkoutCeiling?root:await stageHistoricalResetSource(root,reference);
 report.historicalSource={root:sourceRoot,ceiling:reference.migrationCeiling,files:reference.manifest.length};
 const boot=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:{...process.env,
  NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:String(reference.migrationCeiling),NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',TURNSTILE_SECRET:'isolated-reset-captcha-not-invoked',
  NAWASRAH_SUPABASE_EXCLUDE:'realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 local=JSON.parse(boot.stdout).isolatedProjectRoot;
 // Canonical current reference is generated by the mandatory182 rehearsal in
 // CI;optional explicit path lets a developer use its local external output.
 const initialCounts=await readRowCounts(executor);assert.equal(initialCounts.orders,0);assert.equal(initialCounts.products,0);
 const original=await readNotificationSnapshot(executor);await transitionNotifications(executor,original);
 const status=JSON.parse((await exec(process.execPath,[cli,'status','-o','json','--workdir',local],{cwd:root,windowsHide:true})).stdout);
 const api=new URL(status.API_URL);assert.ok(['127.0.0.1','localhost'].includes(api.hostname));assert.equal(api.port,'25431');
 const client=createClient(api.origin,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const ownerResult=await client.auth.admin.createUser({email:'reset-owner@example.test',password:randomUUID()+'aA1!',email_confirm:true});
 assert.equal(ownerResult.error,null,'LOCAL_OWNER_CREATE_FAILED');const ownerId=ownerResult.data.user.id;
 const employee=await client.auth.admin.createUser({email:'reset-staff@example.test',password:randomUUID()+'aA1!',email_confirm:true});
 assert.equal(employee.error,null,'LOCAL_STAFF_CREATE_FAILED');
 const ownerSession=createClient(api.origin,status.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const ownerLink=await client.auth.admin.generateLink({type:'magiclink',email:'reset-owner@example.test'});assert.equal(ownerLink.error,null);
 assert.equal((await ownerSession.auth.verifyOtp({token_hash:ownerLink.data.properties.hashed_token,type:'email'})).error,null);
 const ownerFactor=await ownerSession.auth.mfa.enroll({factorType:'totp',friendlyName:'Reset preservation test',issuer:'Nawasrah local test'});assert.equal(ownerFactor.error,null);
 assert.equal((await ownerSession.auth.mfa.challengeAndVerify({factorId:ownerFactor.data.id,code:localTotp(ownerFactor.data.totp.secret)})).error,null);
 const branch=await sql("SELECT id FROM public.branches WHERE code='BR-AMMAN-01';"),warehouse=await sql("SELECT id FROM public.warehouses WHERE code='WH-MAIN-01';");
 if(current)await sql("UPDATE public.branches SET code='BR-MAIN',name_ar='الفرع الرئيسي' WHERE code='BR-AMMAN-01';UPDATE public.warehouses SET code='WH-MAIN',name_ar='المستودع الرئيسي' WHERE code='WH-MAIN-01';");
 const product=randomUUID(),supplier=randomUUID(),customer=randomUUID();
 await sql(`INSERT INTO public.profiles(id,full_name,is_active,branch_id) VALUES(${q(ownerId)},'مالك التجربة',true,${q(branch)}),(${q(employee.data.user.id)},'موظف التجربة',true,${q(branch)});
 INSERT INTO public.roles(code,name_ar) VALUES('owner','المالك'),('cashier','كاشير') ON CONFLICT(code) DO NOTHING;
 INSERT INTO public.user_roles(user_id,role_id) SELECT ${q(ownerId)},id FROM public.roles WHERE code='owner';
 INSERT INTO public.user_roles(user_id,role_id) SELECT ${q(employee.data.user.id)},id FROM public.roles WHERE code='cashier';
 INSERT INTO public.products(id,sku,name_ar,unit_id,purchase_unit_id,sale_unit_id,units_per_purchase_unit,units_per_sale_unit,default_sale_price_in_minor_units,sale_price_in_minor_units,cost_price_in_minor_units,is_active)
 SELECT ${q(product)},'RESET-TRIAL','بضاعة تجربة',id,id,id,1,1,1000,1000,0,true FROM public.units ORDER BY code LIMIT 1;
 INSERT INTO public.suppliers(id,company_name) VALUES(${q(supplier)},'مورد تجربة');
 INSERT INTO public.customers(id,full_name,phone,credit_limit_in_minor_units) VALUES(${q(customer)},'عميل تجربة','0791234567',100000);`);
 const call=body=>json(`BEGIN;SET LOCAL ROLE authenticated;DO $$BEGIN PERFORM set_config('request.jwt.claims',${q(JSON.stringify({sub:ownerId,role:'authenticated',aal:'aal2'}))},true);END$$;SELECT public.${body};COMMIT;`);
 assert.equal((await call(`create_direct_supplier_receipt_v2(p_supplier_id:=${q(supplier)},p_branch_id:=${q(branch)},p_warehouse_id:=${q(warehouse)},p_idempotency_key:='trial-reset-receipt-000000000001',p_payment_method:='deferred',p_lines:=${q(JSON.stringify([{client_line_id:randomUUID(),line_kind:'base_unit',commercial_quantity:10,base_unit_name:'حبة',gross_amount_in_minor_units:5000,line_discount_in_minor_units:0,components:[{product_id:product,base_quantity:10}]}]))}::jsonb)`)).success,true);
 await call(`open_cash_shift(${q(branch)},10000)`);
 assert.equal((await call(`create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(customer)},'عميل تجربة','debt',${q(JSON.stringify([{commercial_line_kind:'base_unit',product_id:product,base_quantity:2,price_authority:'server_catalog',line_discount_in_minor_units:0}]))}::jsonb,0,0,'trial-reset-sale-00000000000001')`)).success,true);
 if(latest209||latest208||latest207||latest206||latest205||latest204||latest203||latest202||latest201){await call(`adjust_inventory_stock(${q(warehouse)},${q(product)},7,'تلف تخزين (تجربة التصفير)','damage')`);assert.equal(await sql('SELECT count(*) FROM inventory_damage_events;'),'1');report.damageEvidenceBeforeReset=1;}
 if(latest209||latest208){
  const held=await call(`execute_supplier_replacement_v1('shop_pending',${q(JSON.stringify({supplierId:supplier,productId:product,warehouseId:warehouse,unit:'base',quantity:3,reason:'معلق تجربة التصفير'}))}::jsonb,'trial-reset-supplier208-hold001')`);
  const caseId=held.cases[0].id;
  await call(`execute_supplier_replacement_v1('receive',${q(JSON.stringify({caseId,quantity:1,reason:'استلام تجربة التصفير'}))}::jsonb,'trial-reset-supplier208-receive')`);
  await call(`execute_supplier_replacement_v1('writeoff',${q(JSON.stringify({caseId,quantity:1,reason:'رفض تجربة التصفير'}))}::jsonb,'trial-reset-supplier208-writeoff')`);
  assert.equal(await sql('SELECT count(*) FROM supplier_replacement_cases;'),'1');assert.equal(await sql('SELECT count(*) FROM supplier_replacement_events;'),'3');assert.equal(await sql('SELECT count(*) FROM supplier_replacement_inventory_effects;'),'3');report.replacement208BeforeReset={cases:1,events:3,effects:3};
  const actualReport208=await call(`get_operational_business_report(${q(branch)},CURRENT_DATE,CURRENT_DATE)`);assert.equal(actualReport208.sales.damageLosses.contractVersion,208);report.publicReport208=true;
 }
 if(latest211){
  const sold=await json(`SELECT jsonb_build_object('orderId',order_id,'itemId',id) FROM public.order_items WHERE product_id=${q(product)};`);
  const held=await call(`execute_aftercare_supplier_v1('replacement_supplier','trial-reset-aftercare211-00001',${q(JSON.stringify({orderId:sold.orderId,items:[{sourceKind:'base_order_item',sourceId:sold.itemId,quantity:1}],reason:'عيب للمورد تجربة التصفير',supplierId:supplier}))}::jsonb)`);
  assert.equal(held.success,true);assert.equal(held.cases[0].pendingQuantity,1);
  assert.equal(await sql('SELECT count(*) FROM aftercare_supplier_links;'),'1');
  report.aftercare211BeforeReset={links:1,pendingQuantity:1};
 }
 if(latest209||latest208||latest207||latest206||latest205||latest204||latest203){
  const legacy=randomUUID();
  await sql(`INSERT INTO orders(id,order_number,customer_id,customer_name_snapshot,branch_id,status,source,payment_method,total_in_minor_units,amount_paid_in_minor_units) VALUES(${q(legacy)},'RESET-UNDATED-203',${q(customer)},'قديم بلا إكمال',${q(branch)},'completed','website','debt',1000,0);`);
  await call(`record_customer_order_payment_once(${q(legacy)},500,'cash',NULL,NULL,'trial-reset-legacy-203-000001')`);
  assert.equal(await sql(`SELECT count(*) FROM order_status_history WHERE order_id=${q(legacy)};`),'0');report.legacyReceiptBeforeReset=500;
 }
 if(latest209||latest208||latest207||latest206||latest205||latest204||latest203||latest202){
  await call(`record_customer_opening_balances_v1('trial-reset-opening-202-000001',${q(JSON.stringify([{customer_id:customer,amount_in_minor_units:'5000',original_debt_date:'2020-01-01'}]))}::jsonb)`);
  await call(`collect_customer_balance_v1(${q(customer)},3000,'cash',${q(branch)},NULL,NULL,'trial-reset-collect-202-000001')`);
  const home=await call('get_home_dashboard()');assert.equal(home.summary.todayCollections.totalInMinorUnits,latest209||latest208||latest207||latest206||latest205||latest204||latest203?3500:3000);
  assert.equal(await sql('SELECT count(*) FROM customer_collection_opening_allocations;'),'1');report.openingCollectionBeforeReset=3000;
 }
 if(latest209||latest208||latest207||latest206||latest205||latest204){const history=await call('get_sales_history_page()');assert.equal(history.summary.salesInMinorUnits,2000);assert.equal(history.totalCount,2);report.historyBeforeReset={sales:2000,invoices:2};}
 if(latest213){stage='storage213';report.storage213=await storage213Contract({api:api.origin,status,client,ownerSession,ownerId,sql,q});stage='reset';}
 const object=ownerId+'/trial.png',bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC4sAAAAASUVORK5CYII=','base64');
 assert.equal((await client.storage.from('product-images').upload(object,bytes,{contentType:'image/png'})).error,null,'LOCAL_UPLOAD_FAILED');
 const url=client.storage.from('product-images').getPublicUrl(object).data.publicUrl;
 assert.equal((await fetch(url)).status,200,'LOCAL_BYTES_MUST_EXIST_BEFORE_RESET');
 stage='same-reset-pipeline';report.reset={};
 await resetWithExecutor({executor,root:sourceRoot,reference,output,ownerId,report:report.reset,
  emptyStorage:async()=>{
   const deleted=await cliCall(['storage','rm','ss:///product-images/'+object,'--experimental','--yes']);
   report.storageRemoval={stdout:deleted.stdout.trim(),stderr:deleted.stderr.trim(),remainingObjects:await sql('SELECT count(*) FROM storage.objects;')};
   const response=await fetch(url+'?reset-proof='+randomUUID(),{cache:'no-store',headers:{'Cache-Control':'no-cache'}});
   report.storageRemoval.uncachedStatus=response.status;
   const missing=await response.json();report.storageRemoval.body=missing;
   assert.equal(response.ok,false,'STORAGE_BYTES_REMAIN');
   assert.equal(String(missing.statusCode),'404','STORAGE_MUST_REPORT_OBJECT_NOT_FOUND');
   assert.match(missing.message,/not found|does not exist/iu,'STORAGE_MUST_REPORT_OBJECT_NOT_FOUND');
  },
  deleteOtherAuth:async id=>{assert.equal(id,ownerId);await sql(`DELETE FROM auth.users WHERE id<>${q(id)}::uuid;`);},
  clearHistory:async()=>{await cliCall(['migration','repair','--status','reverted',...reference.appliedVersions]);await sql('DELETE FROM supabase_migrations.seed_files;');},
  repair:async version=>{const unit=reference.manifest.find(m=>m.name.startsWith(version+'_'));await copyFile(path.join(sourceRoot,'supabase/migrations',unit.name),path.join(local,'supabase/migrations',unit.name));await cliCall(['migration','repair','--status','applied',version]);},
  finalDryRun:async()=>{const r=await cliCall(['db','push','--dry-run','--skip-vault']);assert.match(r.stdout+r.stderr,/up to date/iu);}});
 report.functions=await functionReference(executor,reference.migrationCeiling);assert.equal(report.functions,latest212?556:latest211?554:latest209?546:latest208?534:latest207?523:latest206?520:latest205?519:latest204?517:latest203||latest202||latest201?516:current?513:468);
 if(latest209||latest208||latest207||latest206||latest205||latest204||latest203||latest202||latest201){assertReady201Catalog(await json(schemaCatalogSql));assert.equal(await sql('SELECT count(*) FROM inventory_damage_events;'),'0');report.damageEvidenceEmpty=true;}
 if(latest209||latest208||latest207||latest206||latest205||latest204||latest203||latest202){assert.equal(await sql('SELECT count(*) FROM customer_collection_opening_allocations;'),'0');assert.equal(await sql('SELECT count(*) FROM customer_collection_operations;'),'0');report.openingCollectionsEmpty=true;}
 if(latest){assertReady200Catalog(await json(schemaCatalogSql));report.legacyCostWritersStillClosed=true;}
 if(current){assert.equal(report.reset.mainWarehousePreserved,true);assert.equal(await sql("SELECT id FROM public.warehouses WHERE code='WH-MAIN';"),warehouse);}
 if(latest209||latest208||latest207||latest206||latest205){const contexts=await call(`get_receiving_purchase_context(ARRAY[${q(product)}]::uuid[])`);assert.equal(contexts.products[0].lastPurchase,null);report.purchaseHistoryEmptyAfterReset=true;}
 if(latest209||latest208||latest207||latest206||latest205||latest204){const history=await call('get_sales_history_page()');assert.deepEqual(history.rows,[]);assert.equal(history.summary.salesInMinorUnits,0);report.historyEmptyAfterReset=true;}
 assert.equal((await client.auth.admin.getUserById(ownerId)).error,null);
 const factors=await ownerSession.auth.mfa.listFactors();assert.equal(factors.error,null);assert.ok(factors.data.totp.some(f=>f.id===ownerFactor.data.id&&f.status==='verified'),'VERIFIED_TOTP_MUST_SURVIVE_RESET');
 const deleted=await client.auth.admin.getUserById(employee.data.user.id);assert.ok(deleted.error,'STAFF_AUTH_MUST_BE_DELETED');
 if(latest207){assertReady207Catalog(await json(schemaCatalogSql));report.correction207CatalogPreserved=true;}
 if(latest209||latest208){assertReady208Catalog(await json(schemaCatalogSql));for(const t of ['supplier_replacement_cases','supplier_replacement_events','supplier_replacement_inventory_effects'])assert.equal(await sql('SELECT count(*) FROM '+t+';'),'0');const held=await call('get_supplier_replacements_page_v1()');assert.equal(held.pendingQuantity,0);assert.equal(Number(held.pendingValueInMinorUnitsExact),0);report.replacement208Empty=true;const wire=await ownerSession.rpc('get_supplier_replacements_page_v1');assert.equal(wire.error,null,'ACTUAL_OWNER208_REST_READ');assert.equal(wire.data.contractVersion,208);assert.equal(wire.data.pendingQuantity,0);assert.equal(Number(wire.data.pendingValueInMinorUnitsExact),0);report.rest208OwnerRead=true;}
 if(latest210){(latest213?assertReady213Catalog:assertReady210Catalog)(await json(schemaCatalogSql));const wire=await ownerSession.rpc('get_public_pos_receipt',{p_receipt_token:null});assert.equal(wire.error,null,'ACTUAL_OWNER210_REST_READ');assert.equal(wire.data.success,false);report.rest210ReceiptRead=true;}
 if(latest211){(latest213?assertReady213Catalog:assertReady211Catalog)(await json(schemaCatalogSql));assert.equal(await sql('SELECT count(*) FROM aftercare_supplier_links;'),'0');const wire=await ownerSession.rpc('get_aftercare_damage_candidates_v1',{p_order_id:null});assert.equal(wire.error,null,'ACTUAL_OWNER211_REST_READ');assert.deepEqual(wire.data,{contractVersion:211,candidates:[]});report.rest211AftercareRead=true;report.aftercare211Empty=true;}
 if(latest212){(latest213?assertReady213Catalog:assertReady212Catalog)(await json(schemaCatalogSql));const wire=await ownerSession.rpc('get_damage_history_page_v1',{});assert.equal(wire.error,null,'ACTUAL_OWNER212_DAMAGE_REST_READ');assert.equal(wire.data.contractVersion,212);assert.deepEqual(wire.data.rows,[]);assert.equal(wire.data.totalCount,0);report.rest212DamageRead=true;}
 if(latest209){(latest213?assertReady213Catalog:assertReady209Catalog)(await json(schemaCatalogSql));const wire=await ownerSession.rpc('get_public_storefront_catalog_page');assert.equal(wire.error,null,'ACTUAL_OWNER209_REST_READ');assert.deepEqual(wire.data.items,[]);report.rest209CatalogRead=true;}
 report.ok=true;report.storageBytesDeleted=true;report.ownerRetained=true;report.verifiedTotpRetained=true;report.staffDeleted=true;
}catch(error){report.ok=false;report.stage=stage;report.error=error.message.split('\n')[0];process.exitCode=1;}
finally{if(local)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true});report.endedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
