// Owner19Oct: prove the exposed199 cost bypass, then literal200 denial/internal parity.
// Disposable Docker only; no hosted executor, credentials or application secrets.
import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {schemaCatalogSql,catalogDifference} from './schema-catalog.mjs';
import {sha256,canonicalLf,migrationManifest} from './maintenance-db-contract.mjs';

const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile);
const project='nawasrah-legacy-product-cost-test',container='supabase_db_'+project;
const cli=path.join(root,'node_modules/supabase/dist/supabase.js');
const beforeOnly=process.argv.slice(2).includes('--prove-before-only');
assert.ok(process.argv.slice(2).every(a=>a==='--prove-before-only'),'UNKNOWN_OPTION');
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-legacy-product-cost-'));
const report={output,startedAt:new Date().toISOString(),managedAccess:false,proofs:[]};
const id=n=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),product=id(103),unit=id(10),category=id(11),branch=id(200),warehouse=id(201);
const q=v=>`'${String(v).replaceAll("'","''")}'`,j=v=>q(JSON.stringify(v))+'::jsonb';
let local,stage='bootstrap199';
const psql=input=>new Promise((resolve,reject)=>{
 const child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-q','-At','-v','ON_ERROR_STOP=1'],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
 let out='',err='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
 child.stdout.on('data',v=>out+=v);child.stderr.on('data',v=>err+=v);child.on('error',reject);
 child.on('close',code=>resolve({code,out:out.trim(),err}));child.stdin.end("\\set VERBOSITY verbose\nSET statement_timeout='60s';SET lock_timeout='30s';\n"+input);
});
const sql=async input=>{const r=await psql(input);assert.equal(r.code,0,r.err);return r.out;};
const json=async input=>JSON.parse(await sql(input));
const user=(actor,body,commit=false,role='authenticated')=>`BEGIN;SELECT set_config('request.jwt.claims',${q(JSON.stringify({sub:actor,role,aal:'aal2'}))},true) IS NOT NULL AS claims_set \u005cgset
SET LOCAL ROLE ${role};${body};${commit?'COMMIT':'ROLLBACK'};`;
const rpc=(actor,call,commit=false)=>json(user(actor,'SELECT public.'+call,commit));
const cost=()=>json(`SELECT jsonb_build_object('cost',cost_price_in_minor_units,'exact',wac_cost_in_minor_units_exact::text,'version',updated_at::text) FROM products WHERE id=${q(product)};`);
const snapshot=()=>sql(`SELECT md5(jsonb_build_object('products',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM products t),'stock',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM inventory_balances t),'moves',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM inventory_movements t),'audit',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM audit_logs t))::text);`);
const legacy=name=>`${name}(${q(product)},'E-CARTON',NULL,'حفظ قديم',NULL,${q(category)},NULL,${q(unit)},${q(unit)},5,4000,800,900,${name.endsWith('_v2')?'4500,':''}0,NULL,true,NULL)`;
const v4=(version,name='حفظ حديث')=>`update_product_master_v4(${q(product)},${q(version)}::timestamptz,'E-CARTON',NULL,${q(name)},NULL,${q(category)},NULL,${q(unit)},${q(unit)},5,4000,${q(unit)},5,6000,800,0,NULL,true,NULL)`;
try{
 const b=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:{...process.env,
  NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'199',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
  NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 local=JSON.parse(b.stdout).isolatedProjectRoot;
 stage='fixture';await sql('ALTER TABLE orders DISABLE TRIGGER trg_notify_new_website_order_push;SELECT cron.alter_job(jobid,active:=false) FROM cron.job;');
 await sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
 const actors=[[owner,'owner'],[id(2),'admin'],[id(3),'manager'],[id(4),'warehouse_keeper'],[id(5),'cashier']];
 for(const [actor,role] of actors.slice(1))await sql(`INSERT INTO auth.users(id,aud,role,email) VALUES(${q(actor)},'authenticated','authenticated',${q(role+'@legacy.example.test')});
 INSERT INTO profiles(id,full_name,is_active) VALUES(${q(actor)},${q(role)},true);INSERT INTO roles(code,name_ar) VALUES(${q(role)},${q(role)}) ON CONFLICT(code) DO NOTHING;
 INSERT INTO user_roles(user_id,role_id) SELECT ${q(actor)},id FROM roles WHERE code=${q(role)};`);
 await rpc(owner,`open_cash_shift(${q(branch)},1000000)`,true);
 for(const [n,gross] of [[1,20000],[2,30000]])assert.equal((await rpc(owner,`create_direct_supplier_receipt_v2(p_supplier_id:=${q(id(301))},p_branch_id:=${q(branch)},p_warehouse_id:=${q(warehouse)},p_idempotency_key:=${q('legacy-cost-receipt-'+n)},p_payment_method:='deferred',p_lines:=${j([{client_line_id:id(950+n),line_kind:'base_unit',commercial_quantity:10,base_unit_name:'باكيت',gross_amount_in_minor_units:gross,line_discount_in_minor_units:0,components:[{product_id:product,base_quantity:10}]}])})`,true)).success,true);
 const original=await cost();assert.equal(original.cost,2500);assert.equal(Number(original.exact),2500);
 const identities=await json("SELECT jsonb_object_agg(proname,oid::regprocedure::text) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('update_product_master','update_product_master_v2');");
 const before=await snapshot();stage='real authenticated bypass before200';
 for(const [actor,role] of actors.slice(0,4))for(const name of Object.keys(identities)){
  const result=await json(user(actor,`SELECT public.${legacy(name)} AS discarded \\gset
SELECT jsonb_build_object('cost',cost_price_in_minor_units,'exact',wac_cost_in_minor_units_exact::text) FROM products WHERE id=${q(product)}`));
  assert.deepEqual(result,{cost:800,exact:'2500.000000'});assert.equal(await snapshot(),before,'rollback restores every business row');
  report.proofs.push({name,role,before200:'cost800-exact2500',rolledBack:true});
 }
 report.before199Proven=true;
 stage='review other exposed legacy writers (proposals only)';
 for(const name of ['create_product_with_opening_stock','create_product_with_opening_stock_v2','create_product_with_opening_stock_v3']){
  const call=`${name}(p_sku:='LEGACY-PROBE',p_name_ar:='صنف اختبار قديم',p_category_id:=${q(category)},p_unit_id:=${q(unit)},p_purchase_unit_id:=${q(unit)},p_units_per_purchase_unit:=5,p_default_purchase_price_in_minor_units:=4000,p_cost_price_in_minor_units:=800,p_sale_price_in_minor_units:=900,p_warehouse_id:=${q(warehouse)},p_opening_quantity:=2)`;
  const r=await json(user(owner,`SELECT public.${call} AS result \\gset
SELECT jsonb_build_object('quantity',on_hand_quantity,'exact',wac_cost_in_minor_units_exact) FROM inventory_balances b JOIN products p ON p.id=b.product_id WHERE p.sku='LEGACY-PROBE'`));
  assert.equal(r.quantity,2);assert.equal(r.exact,null);assert.equal(await snapshot(),before);
  report.proofs.push({name,legacyOpeningStock:2,exactWac:null,rolledBack:true,proposalOnly:true});
 }
 const looseReceive=await json(user(owner,`SELECT public.receive_inventory(${q(warehouse)},${q(product)},2,'purchase_order',NULL,'legacy audit probe') AS discarded \\gset
SELECT jsonb_build_object('quantity',on_hand_quantity,'cost',cost_price_in_minor_units,'exact',wac_cost_in_minor_units_exact::text,'receipts',(SELECT count(*) FROM supplier_receipts),'poReceipts',(SELECT count(*) FROM purchase_receipts)) FROM inventory_balances b JOIN products p ON p.id=b.product_id WHERE p.id=${q(product)} AND warehouse_id=${q(warehouse)}`));
 assert.deepEqual(looseReceive,{quantity:22,cost:2500,exact:'2500.000000',receipts:2,poReceipts:0});assert.equal(await snapshot(),before);
 report.proofs.push({name:'receive_inventory',quantity22WithoutReceipt:true,wacUnchanged:true,rolledBack:true,proposalOnly:true});
 const modernOpening=await psql(user(owner,`SELECT public.create_product_with_opening_stock_v4(p_sku:='MODERN-PROBE',p_opening_quantity:=2)`));
 assert.notEqual(modernOpening.code,0);assert.match(modernOpening.err,/لا يُضاف مخزون/u);assert.equal(await snapshot(),before);
 report.proofs.push({name:'create_product_with_opening_stock_v4',openingStockDenied:true,zeroWrite:true});
 if(!beforeOnly){
  stage='literal200';const catalogBefore=await json(schemaCatalogSql),bytes=await readFile(path.join(root,'supabase/migrations/200_revoke_legacy_product_cost_writers.sql'),'utf8');
  report.migrationSha256=sha256(canonicalLf(bytes));await sql(bytes);
  const catalogAfter=await json(schemaCatalogSql),delta=catalogDifference(catalogBefore,catalogAfter);
  assert.equal(delta.length,2,'only two function ACL changes');
  for(const d of delta){assert.equal(d.section,'functions');assert.ok(Object.keys(identities).some(n=>d.before.identity.startsWith(n+'(')));
   assert.deepEqual({...d.before,acl:null},{...d.after,acl:null},'no body/owner/config/other metadata change');}
  assert.equal(await snapshot(),before,'migration performs no business write');
  stage='all client roles direct42501 and zero writes';
  for(const [actor,role] of [...actors,[null,'anon']])for(const name of Object.keys(identities)){
   const denied=await psql(user(actor,`SELECT public.${legacy(name)}`,false,role==='anon'?'anon':'authenticated'));
   assert.notEqual(denied.code,0);assert.match(denied.err,/42501:.*permission denied for function/u);
   assert.equal(await snapshot(),before);report.proofs.push({name,role,after200:'42501',zeroWrite:true});
  }
  for(const signature of Object.values(identities))assert.equal(await sql(`SELECT has_function_privilege('authenticated',${q(signature)},'EXECUTE') OR has_function_privilege('anon',${q(signature)},'EXECUTE');`),'f');
  stage='v4 traverses revoked internal chain';
  for(const [actor,role] of actors.slice(0,4)){
   const result=await rpc(actor,v4(original.version));assert.equal(result.success,true);assert.equal(result.costPreserved,true);
   assert.equal(await snapshot(),before);report.proofs.push({role,v4:true,costPreserved:true,rollback:true});
  }
  const result=await rpc(owner,v4(original.version),true);assert.equal(result.costPreserved,true);
  const edited=await cost();assert.equal(edited.cost,2500);assert.equal(Number(edited.exact),2500);
  const stale=await psql(user(owner,'SELECT public.'+v4(original.version)));assert.match(stale.err,/PRODUCT_EDIT_CONFLICT/u);
  stage='idempotent migration';const currentCatalog=await json(schemaCatalogSql),currentRows=await snapshot();await sql(bytes);
  assert.deepEqual(await json(schemaCatalogSql),currentCatalog);assert.equal(await snapshot(),currentRows);
  report.catalogDelta=delta.map(d=>({section:d.section,identity:d.before.identity,change:'ACL only'}));report.after200Proven=true;
 }
 report.manifest=(await migrationManifest(root)).filter(m=>Number(m.name.slice(0,3))<=(beforeOnly?199:200));report.ok=true;
}catch(error){report.ok=false;report.stage=stage;report.error=error.message;process.exitCode=1;}
finally{
 if(local)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true});
 report.endedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({ok:report.ok,stage,output,proofs:report.proofs.length,error:report.error,managedAccess:false}));
}
