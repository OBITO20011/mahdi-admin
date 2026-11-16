// Fixed, fresh disposable223 database only. No supplied target or demo access.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {startPrices222Local} from './independent-prices222-local.mjs';
import {schemaCatalogSql,catalogDifference} from './schema-catalog.mjs';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';
import {readVerificationSourceFreeze,assertVerificationSourceFreeze} from './verification-source-freeze.mjs';
import {canonicalLf,sha256} from './maintenance-db-contract.mjs';

assert.equal(process.argv.length,2,'INVENTORY224_NO_TARGET_ARGUMENTS');
const root=path.resolve(import.meta.dirname,'../..'),output=path.join(root,'test-results/inventory224-runtime');
await mkdir(output,{recursive:true});
const report={ok:false,output,hostedAccess:false,ownerDemoAccess:false,cases:[]};
const id=n=>'92600000-0000-4000-8000-'+String(n).padStart(12,'0');
const q=value=>"'"+String(value).replaceAll("'","''")+"'";
const owner={sub:id(1),role:'authenticated',aal:'aal2'};
let local;
try{
 const freeze=await readVerificationSourceFreeze(root);
 local=await startPrices222Local(223,'reference');
 const sql=local.sql,json=async input=>JSON.parse((await sql(input)).split('\n').at(-1));
 const transaction=(body,{claims=owner,role='authenticated',readOnly=false,rollback=true}={})=>
  `BEGIN${readOnly?' READ ONLY':''};SELECT set_config('request.jwt.claims',${q(JSON.stringify(claims))},true);SET LOCAL ROLE ${role};SET LOCAL statement_timeout='8s';${body};${rollback?'ROLLBACK':'COMMIT'};`;
 const rpc=(call,options)=>json(transaction('SELECT public.'+call,options));
 const reader=(search='',filter='all',page=1,size=20)=>`lite3_counters224(${search===null?'NULL':q(search)},${q(filter)},${page},${size})`;
 await sql('SELECT cron.alter_job(jobid,active:=false) FROM cron.job;');
 const before=JSON.parse(await sql(schemaCatalogSql));
 await assert.rejects(rpc(reader()),/does not exist/u);
 report.cases.push({name:'RED: new reader absent on unchanged223',passed:true});
 const migration=canonicalLf(await readFile(path.join(root,'supabase/migrations/224_optional_quantity_inventory_reader.sql'),'utf8'));
 report.migrationSha256=sha256(migration);
 await sql(migration);
 await sql("INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('224','optional_quantity_inventory_reader','{}');");
 const after=JSON.parse(await sql(schemaCatalogSql)),delta=catalogDifference(before,after);
 assert.equal(delta.length,1);assert.equal(delta[0].section,'functions');assert.equal(delta[0].before,null);
 const added=delta[0].after;assert.equal(added.schema,'public');assert.equal(added.identity,'lite3_counters224(p_search text, p_filter text, p_page integer, p_page_size integer)');
 assert.equal(added.owner,'postgres');assert.deepEqual([...added.acl].sort(),['authenticated=X/postgres','postgres=X/postgres']);
 await writeFile(path.join(output,'catalog-delta.json'),JSON.stringify(delta,null,2)+'\n');
 report.cases.push({name:'Only one public reader added; every previous function/table/trigger/policy/index/config/ACL exact',passed:true});
 await sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
 await sql(`UPDATE public.products SET name_ar='عائلة  توداي',sku='NW-0268' WHERE id='${id(100)}';
 UPDATE public.products SET name_ar='توداي داكن',flavor_name_ar='داكن',sku='NW-0268-D',barcode='000987654321' WHERE id='${id(101)}';
 UPDATE public.products SET name_ar='توداي حليب',flavor_name_ar='حليب',sku='NW-0268-M',barcode='000987654322' WHERE id='${id(102)}';
 UPDATE public.products SET name_ar='باكيت   24 سادة',sku='NW-0500',barcode='000123456789' WHERE id='${id(103)}';
 INSERT INTO public.products(id,sku,name_ar,category_id,unit_id,purchase_unit_id,sale_unit_id,units_per_purchase_unit,units_per_sale_unit,
 default_purchase_price_in_minor_units,default_sale_price_in_minor_units,cost_price_in_minor_units,sale_price_in_minor_units,wholesale_price_in_minor_units,min_stock_level,is_active,is_flavor_master,wac_cost_in_minor_units_exact)
 SELECT '${id(104)}','NW-DISABLED','متوقف العدّ',category_id,unit_id,purchase_unit_id,sale_unit_id,1,1,0,1000,0,1000,1000,0,true,false,0 FROM public.products WHERE id='${id(103)}';
 INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 VALUES('${id(2)}','authenticated','authenticated','inventory-admin@example.test',now(),'{}','{}'),
 ('${id(3)}','authenticated','authenticated','inventory-cashier@example.test',now(),'{}','{}');
 INSERT INTO public.profiles(id,full_name,is_active) VALUES('${id(2)}','مدير اختبار',true),('${id(3)}','كاشير اختبار',true);
 INSERT INTO public.roles(code,name_ar) VALUES('admin','مدير الاختبار'),('cashier','كاشير الاختبار') ON CONFLICT(code) DO NOTHING;
 INSERT INTO public.user_roles(user_id,role_id) SELECT '${id(2)}',id FROM public.roles WHERE code='admin';
 INSERT INTO public.user_roles(user_id,role_id) SELECT '${id(3)}',id FROM public.roles WHERE code='cashier';`);
 await assert.rejects(rpc(reader()),/QUANTITY223_OFF_REQUIRED/u);
 await rpc('lite1_set_mode2(false)',{rollback:false});
 const initial=await rpc(reader());assert.deepEqual(initial.counts,{tracked:0,low:0,zero:0});assert.deepEqual(initial.items,[]);
 const set=async(product,enabled,quantity,threshold,revision=0)=>rpc(`lite3_set_counter223('${product}',${enabled},${quantity},${threshold},${revision},'${randomUUID()}','${id(10)}')`,{rollback:false});
 await set(id(101),true,0,0);await set(id(102),true,9,3);await set(id(103),true,2,3);
 await set(id(104),false,6,2);
 const inventory=await rpc(reader());assert.equal(inventory.total,3);assert.deepEqual(inventory.counts,{tracked:3,low:2,zero:1});
 assert.deepEqual(inventory.items.map(r=>r.status),['zero','low','available']);
 assert.deepEqual(inventory.items.map(r=>r.productId),[id(101),id(103),id(102)]);
 assert.equal(inventory.items[0].familyName,'عائلة  توداي');assert.equal(inventory.items[0].flavorName,'داكن');
 assert.equal(inventory.items[0].unitName,'باكيت');assert.equal(inventory.items[0].unitId,id(10));
 assert.equal(inventory.items[1].lastEvent.kind,'manual');assert.equal(inventory.items[1].lastEvent.delta,2);
 assert.equal(inventory.items[1].lastEvent.actorDisplayName,'مالك يوم الاختبار');
 assert.equal(inventory.items[1].revision,1);assert.ok(inventory.items[1].updatedAt);
 report.cases.push({name:'OFF enabled sellable counters, quantities/units/family/revision, global counts, deterministic zero/low/name order',passed:true});
 const inactive=await json(`BEGIN;UPDATE public.products SET is_active=false WHERE id='${id(101)}';
 SELECT set_config('request.jwt.claims',${q(JSON.stringify(owner))},true);SET LOCAL ROLE authenticated;
 SELECT public.${reader()};ROLLBACK;`);
 assert.deepEqual(inactive.counts,{tracked:2,low:1,zero:0},'INVENTORY224_INACTIVE_TRACKED_COUNTS');
 assert.equal(inactive.total,2);assert.ok(inactive.items.every(row=>row.productId!==id(101)));
 report.cases.push({name:'Inactive product with enabled zero counter is excluded from the list and all global summary counts',passed:true});
 for(const search of ['توداي','  عائلة\tتوداي  ','nw-٠٢٦٨','NW-۰۲۶۸','00098765432']){
  const found=await rpc(reader(search));assert.equal(found.total,2,search);assert.deepEqual(found.counts,inventory.counts);
 }
 for(const search of ['باكيت ٢٤','باكيت   24','٠٠٠١٢٣٤٥٦٧٨٩','NW-0500']){
  const found=await rpc(reader(search));assert.equal(found.total,1,search);assert.equal(found.items[0].productId,id(103));
 }
 const combined=await rpc(reader('توداي','zero'));assert.equal(combined.total,1);assert.equal(combined.items[0].productId,id(101));
 const missing=await rpc(reader('لا يوجد % صنف','low'));assert.equal(missing.total,0);assert.deepEqual(missing.items,[]);assert.deepEqual(missing.counts,inventory.counts);
 assert.equal((await rpc(reader('NW-DISABLED'))).total,0);
 assert.equal((await rpc(reader('','low'))).total,2);assert.equal((await rpc(reader('','zero'))).total,1);
 const pages=[];for(let page=1;page<=3;page++)pages.push((await rpc(reader('','all',page,1))).items[0].productId);
 assert.deepEqual(pages,inventory.items.map(r=>r.productId));assert.deepEqual((await rpc(reader('','all',10,1))).items,[]);
 report.cases.push({name:'Substring name/flavor/family/SKU/barcode search folds whitespace, case, Arabic/Persian digits; combined filters/pagination and global counts',passed:true});
 for(const [kind,qty,actor]of [['sale',1,id(1)],['cancel',4,null],['return',3,id(1)],['manual',7,id(1)]]){
  const input=`BEGIN;UPDATE sales_lite3.quantity_counters SET revision=2,quantity=${qty} WHERE product_id='${id(103)}';
  INSERT INTO sales_lite3.quantity_events(product_id,sku_snapshot,name_snapshot,unit_id,unit_name_snapshot,kind,source_type,source_id,
  quantity_before,quantity_after,requested_quantity,applied_quantity,shortage_quantity,revision_before,revision_after,configuration_before,configuration_after,created_by)
  VALUES('${id(103)}','NW-0500','باكيت 24 سادة','${id(10)}','باكيت',${q(kind)},'reader_fixture','${randomUUID()}',2,${qty},${qty},${Math.abs(qty-2)},0,1,2,'{}','{}',${actor?q(actor)+'::uuid':'NULL'});
  SELECT set_config('request.jwt.claims',${q(JSON.stringify(owner))},true);SET LOCAL ROLE authenticated;
  SELECT public.${reader('NW-0500')};ROLLBACK;`;
  const event=(await json(input)).items[0].lastEvent;assert.equal(event.kind,kind);assert.equal(event.delta,qty-2);assert.ok(event.at);
  assert.equal(event.actorDisplayName,actor?'مالك يوم الاختبار':null);
 }
 report.cases.push({name:'Latest manual/sale/cancel/return event uses signed actual delta and timestamp; absent actor remains null; fixtures roll back',passed:true});
 const master=await json(`BEGIN;INSERT INTO sales_lite3.quantity_counters(product_id,unit_id,enabled,quantity,low_threshold,revision)
 VALUES('${id(100)}','${id(10)}',true,0,1,1);SELECT set_config('request.jwt.claims',${q(JSON.stringify(owner))},true);
 SET LOCAL ROLE authenticated;SELECT public.${reader()};ROLLBACK;`);
 assert.deepEqual(master.counts,inventory.counts);assert.ok(master.items.every(r=>r.productId!==id(100)));
 report.cases.push({name:'A flavor master is excluded even if a malformed pre-existing private counter fixture is present',passed:true});
 for(const [role,claims]of [['anon',{role:'anon'}],['service_role',{role:'service_role'}],['authenticated',{...owner,aal:'aal1'}],
  ['authenticated',{...owner,sub:id(2)}],['authenticated',{...owner,sub:id(3)}]]){
  const deniedEmployee=role==='authenticated'&&claims.sub!==owner.sub;
  const expectedCode=deniedEmployee?'P0001':'42501';
  const expectedMessage=deniedEmployee?'ليس لديك صلاحية إدارة عدّاد الكمية الاختياري.':
   role==='authenticated'?'QUANTITY223_OWNER_AAL2_REQUIRED':'permission denied for function lite3_counters224';
  await sql(transaction(`DO $denial$ BEGIN BEGIN PERFORM public.${reader()};RAISE EXCEPTION 'INVENTORY224_UNEXPECTED_ACCESS';
   EXCEPTION WHEN OTHERS THEN IF SQLSTATE<>${q(expectedCode)} OR SQLERRM<>${q(expectedMessage)} THEN RAISE;END IF;END;END $denial$`,{role,claims}));
 }
 for(const call of [reader('','all',0),reader('','all',1,101),reader('','all',1,0),reader('','all',100001),reader('','unknown'),reader('x'.repeat(257))])
  await assert.rejects(rpc(call),/INVENTORY224_(?:PAGE|FILTER|SEARCH)_INVALID/u);
 report.cases.push({name:'Owner AAL2 only; anon/service_role/admin/cashier/owner-AAL1 denied; bounded valid filters/search/pages',passed:true});
 const fingerprint=await readApplicationFingerprint(local.executor);
 const privateState=()=>json("SELECT jsonb_build_object('counters',(SELECT jsonb_agg(to_jsonb(c) ORDER BY product_id) FROM sales_lite3.quantity_counters c),'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM sales_lite3.quantity_events e),'requests',(SELECT jsonb_agg(to_jsonb(r) ORDER BY key) FROM sales_lite3.quantity_requests r));");
 const privateBefore=await privateState();
 assert.deepEqual(await rpc(reader(),{readOnly:true}),inventory);
 assert.deepEqual(await rpc(reader('داكن','low'),{readOnly:true}),(await rpc(reader('داكن','low'))));
 assert.deepEqual(await privateState(),privateBefore);assert.deepEqual((await readApplicationFingerprint(local.executor)).tables,fingerprint.tables);
 const finalCatalog=JSON.parse(await sql(schemaCatalogSql));assert.deepEqual(finalCatalog,after);
 report.cases.push({name:'Real READ ONLY transactions succeed; repeated reads preserve all application/private rows, request keys and entire catalog',passed:true});
 assertVerificationSourceFreeze(freeze,await readVerificationSourceFreeze(root));
 Object.assign(report,{ok:true,publicFunctions:688,addedFunctions:1,catalogChanges:1,networkAttachments:local.networkAttachments});
}catch(error){report.error=String(error.stack).slice(0,6000);process.exitCode=1;}
finally{
 if(local)await local.stop();
 report.cleanup=true;
 await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}
