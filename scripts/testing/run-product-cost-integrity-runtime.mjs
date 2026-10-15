// Isolated runtime proof for migration 171: saving a product with stock
// history never rewrites cost_price/exact WAC; sales cost at the true average;
// owner-only audited cost correction. No Production access.
import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {promisify} from 'node:util';
import path from 'node:path';
import {assertPackageDDbLint} from './package-d-db-lint-policy.mjs';

const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..');
const projectId='nawasrah-product-cost-integrity-test',container=`supabase_db_${projectId}`;
const cli=path.join(root,'node_modules/supabase/dist/supabase.js');
const id=n=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),admin=id(2),cashier=id(3),product=id(103),family=id(100),unit=id(10),category=id(11);
const branch=id(200),warehouse=id(201),customer=id(401),fresh=id(160);
const q=v=>`'${String(v).replaceAll("'","''")}'`,j=v=>q(JSON.stringify(v))+'::jsonb';
let workdir,stage='bootstrap001-171';

const psql=text=>new Promise((resolve,reject)=>{
  const child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-q','-At','-v','ON_ERROR_STOP=1'],
    {cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let out='',err='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>err+=chunk);
  child.on('error',reject);child.on('close',code=>resolve({code,out:out.trim(),err}));
  child.stdin.end(`SET statement_timeout='60s';SET lock_timeout='30s';\n${text}`);
});
const sql=async text=>{const r=await psql(text);if(r.code!==0)throw Error(`${stage}: ${r.err.slice(-4000)}`);return r.out;};
const json=async text=>JSON.parse(await sql(text));
const asUser=(actor,body,commit=true)=>`BEGIN;DO $$BEGIN PERFORM set_config('request.jwt.claims',${q(JSON.stringify({sub:actor,role:'authenticated',aal:'aal2'}))},true);END$$;
  SET LOCAL ROLE authenticated;${body}${commit?'COMMIT':'ROLLBACK'};`;
const rpc=(actor,call,commit=true)=>json(asUser(actor,`SELECT public.${call};`,commit));
const refused=async(actor,call,pattern)=>{const r=await psql(asUser(actor,`SELECT public.${call};`,false));
  assert.notEqual(r.code,0,`${call} must be refused`);assert.match(r.err,pattern);return r.err;};
const cost=target=>json(`SELECT jsonb_build_object('cost',cost_price_in_minor_units,'exact',wac_cost_in_minor_units_exact::text,
  'defaultPurchase',default_purchase_price_in_minor_units,'name',name_ar,'salePackage',default_sale_price_in_minor_units,'updatedAt',updated_at::text)
  FROM products WHERE id=${q(target)};`);
const balances=()=>json(`SELECT COALESCE(jsonb_agg(to_jsonb(b)-'updated_at' ORDER BY b.warehouse_id,b.product_id),'[]') FROM inventory_balances b;`);
const v4=(target,version,{name,purchase=4000,sale=4500,costParam=900,active=true})=>`update_product_master_v4(
  ${q(target)},${q(version)}::timestamptz,${q(target===product?'E-CARTON':'E-NEW')},NULL,${q(name)},NULL,${q(category)},NULL,
  ${q(unit)},${q(unit)},5,${purchase},${q(unit)},5,${sale},${costParam},0,NULL,${active},NULL)`;
const receive=(key,quantity,gross)=>rpc(owner,`create_direct_supplier_receipt_v2(p_supplier_id:=${q(id(301))},p_branch_id:=${q(branch)},
  p_warehouse_id:=${q(warehouse)},p_idempotency_key:=${q(key)},p_payment_method:='deferred',p_lines:=${j([{client_line_id:id(950+quantity),
  line_kind:'base_unit',commercial_quantity:quantity,base_unit_name:'باكيت',gross_amount_in_minor_units:gross,line_discount_in_minor_units:0,
  components:[{product_id:product,base_quantity:quantity}]}])})`);
const sell=(key,quantity)=>rpc(owner,`create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(customer)},'عميل الدين','debt',
  ${j([{commercial_line_kind:'base_unit',product_id:product,base_quantity:quantity,price_authority:'server_catalog',line_discount_in_minor_units:0}])},0,0,${q(key)})`);
const orderItems=orderId=>json(`SELECT jsonb_agg(jsonb_build_object('quantity',quantity,'unitCost',unit_cost_in_minor_units,'cogs',cogs_in_minor_units,
  'lineTotal',line_total_in_minor_units,'profit',profit_in_minor_units) ORDER BY id) FROM order_items WHERE order_id=${q(orderId)};`);

try{
  const {stdout}=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{
    cwd:root,windowsHide:true,timeout:900000,maxBuffer:8*1024*1024,env:{...process.env,
      NAWASRAH_ISOLATED_PROJECT_ID:projectId,NAWASRAH_MAX_MIGRATION:'171',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
      NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
  const boot=JSON.parse(stdout);assert.equal(boot.ok,true);workdir=boot.isolatedProjectRoot;

  stage='fixture';
  await sql(`ALTER TABLE orders DISABLE TRIGGER trg_notify_new_website_order_push;SELECT cron.alter_job(jobid,active:=false) FROM cron.job;`);
  await sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
  for(const [actor,role] of [[admin,'admin'],[cashier,'cashier']])await sql(`
    INSERT INTO auth.users(id,aud,role,email) VALUES(${q(actor)},'authenticated','authenticated',${q(role+'@cost.example.test')});
    INSERT INTO profiles(id,full_name,is_active) VALUES(${q(actor)},${q(role)},true);
    INSERT INTO roles(code,name_ar) VALUES(${q(role)},${q(role)}) ON CONFLICT(code) DO NOTHING;
    INSERT INTO user_roles(user_id,role_id) SELECT ${q(actor)},r.id FROM roles r WHERE r.code=${q(role)};`);
  // The golden-day fixture seeds an exact WAC of 0; this product starts as never received.
  await sql(`UPDATE products SET wac_cost_in_minor_units_exact=NULL WHERE id=${q(product)};`);
  // A brand-new product with no movement and no exact WAC.
  await sql(`INSERT INTO products(id,sku,name_ar,category_id,unit_id,purchase_unit_id,sale_unit_id,units_per_purchase_unit,units_per_sale_unit,
    default_purchase_price_in_minor_units,default_sale_price_in_minor_units,cost_price_in_minor_units,sale_price_in_minor_units,
    wholesale_price_in_minor_units,min_stock_level,is_active,is_flavor_master)
    VALUES(${q(fresh)},'E-NEW','صنف جديد',${q(category)},${q(unit)},${q(unit)},${q(unit)},5,5,4000,4500,800,900,900,0,true,false);`);

  stage='ACL';
  const acl=await json(`SELECT jsonb_object_agg(sig,jsonb_build_object('authenticated',has_function_privilege('authenticated',sig,'EXECUTE'),
    'anon',has_function_privilege('anon',sig,'EXECUTE'),'definer',p.prosecdef,'config',p.proconfig))
    FROM (VALUES('public.correct_product_cost_v1(uuid,numeric,text,text)'),('public.get_product_cost_state_v1(uuid)'),
      ('public.product_has_cost_history_internal(uuid)'),('public.product_cost_corrections_reject_mutation()'),
      ('public.update_product_master_v4(uuid,timestamptz,text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,boolean,text)')) s(sig)
    JOIN pg_proc p ON p.oid=s.sig::regprocedure;`);
  for(const [sig,value] of Object.entries(acl)){
    assert.equal(value.anon,false,sig);assert.equal(value.definer,true,sig);assert.deepEqual(value.config,['search_path=public, pg_temp'],sig);
    assert.equal(value.authenticated,!/_internal|reject_mutation/u.test(sig),sig);
  }
  const table=await json(`SELECT jsonb_build_object('rls',c.relrowsecurity,'anon',has_table_privilege('anon','public.product_cost_corrections','SELECT'),
    'authenticated',has_table_privilege('authenticated','public.product_cost_corrections','SELECT,INSERT,UPDATE,DELETE')) FROM pg_class c WHERE c.oid='public.product_cost_corrections'::regclass;`);
  assert.deepEqual(table,{rls:true,anon:false,authenticated:false},'corrections table is RPC-only');

  stage='two receipts at different prices give the true average';
  const shift=await rpc(owner,`open_cash_shift(${q(branch)},1000000)`);assert.ok(shift.id);
  const before=await cost(product);assert.equal(before.exact,null,'no exact WAC before the first receipt');
  assert.equal((await rpc(owner,`get_product_cost_state_v1(${q(product)})`,false)).hasCostHistory,false);
  assert.equal((await receive('product-cost-receipt-a-0000000000001',10,20000)).success,true);
  assert.equal((await receive('product-cost-receipt-b-0000000000001',10,30000)).success,true);
  const wac=await cost(product);
  assert.equal(Number(wac.exact),2500,'(10×2000+10×3000)/20');assert.equal(wac.cost,2500,'cost_price = ROUND(exact)');
  const state=await rpc(admin,`get_product_cost_state_v1(${q(product)})`,false);
  assert.equal(state.hasCostHistory,true);assert.equal(Number(state.wacCostExactInMinorUnits),2500);assert.equal(state.costPriceInMinorUnits,2500);
  await refused(cashier,`get_product_cost_state_v1(${q(product)})`,/صلاحية|صلاحيات|غير مصرح|ليس لديك/u);

  stage='the pre-171 path would have overwritten cost_price (bug reproduced, rolled back)';
  const legacy=await sql(`BEGIN;DO $$BEGIN PERFORM set_config('request.jwt.claims',${q(JSON.stringify({sub:owner,role:'authenticated',aal:'aal2'}))},true);
    PERFORM public.update_product_master_v3(${q(product)},'E-CARTON',NULL,'إعادة تسمية فقط',NULL,${q(category)},NULL,${q(unit)},${q(unit)},5,4000,${q(unit)},5,4500,800,0,NULL,true,NULL);END$$;
    SELECT cost_price_in_minor_units||'|'||wac_cost_in_minor_units_exact::text FROM products WHERE id=${q(product)};ROLLBACK;`);
  assert.equal(legacy.split('\n').at(-1),'800|2500.000000','old path: a rename rewrote cost_price to 800 while exact stayed 2500');
  assert.deepEqual(await cost(product),wac,'the demonstration was rolled back');

  stage='edits (name, sale price, default purchase price) keep cost and exact WAC';
  const stockBefore=await balances();
  const edited=await rpc(admin,v4(product,wac.updatedAt,{name:'صنف الكرتونة المعدل',purchase:4400,sale:6000,costParam:880}));
  assert.equal(edited.success,true);assert.equal(edited.costPreserved,true);
  const afterEdit=await cost(product);
  assert.equal(afterEdit.cost,2500);assert.equal(Number(afterEdit.exact),2500);
  assert.equal(afterEdit.defaultPurchase,4400,'default purchase price stays editable');
  assert.equal(afterEdit.name,'صنف الكرتونة المعدل');assert.equal(afterEdit.salePackage,6000);
  const again=await rpc(owner,v4(product,afterEdit.updatedAt,{name:'صنف الكرتونة',purchase:3900,sale:6000,costParam:0}));
  assert.equal(again.costPreserved,true);const afterSecond=await cost(product);
  assert.equal(afterSecond.cost,2500);assert.equal(Number(afterSecond.exact),2500);
  assert.deepEqual(await balances(),stockBefore,'edits never touch quantities');

  stage='a sale after the edits costs at the true average';
  const sale=await sell('product-cost-sale-a-00000000000000001',4);assert.equal(sale.success,true);
  const [line]=await orderItems(sale.orderId);
  assert.equal(line.quantity,4);assert.equal(line.unitCost,2500);assert.equal(line.cogs,10000,'4 × 2500');
  assert.equal(line.profit,line.lineTotal-10000,'profit = net - COGS at the true average');
  assert.equal(line.lineTotal,4800,'unit sale price = 6000/5 per piece');

  stage='new product without movement keeps the old behaviour';
  const freshBefore=await cost(fresh);
  assert.equal((await rpc(owner,`get_product_cost_state_v1(${q(fresh)})`,false)).hasCostHistory,false);
  const freshEdit=await rpc(owner,v4(fresh,freshBefore.updatedAt,{name:'صنف جديد',purchase:3500,sale:4500,costParam:700}));
  assert.equal(freshEdit.costPreserved,false);assert.equal((await cost(fresh)).cost,700,'cost still set from the form when there is no history');
  assert.equal((await cost(fresh)).exact,null);
  assert.equal((await rpc(owner,`get_product_cost_state_v1(${q(family)})`,false)).hasCostHistory,true,
    'a flavor family counts its flavors (fixture flavors carry an exact WAC)');

  stage='owner cost correction';
  const key='product-cost-correction-0000000001';
  const reason='تصحيح بعد جرد فاتورة المورد';
  await refused(admin,`correct_product_cost_v1(${q(product)},2600.5,${q(reason)},${q(key)})`,/صلاحية|صلاحيات|غير مصرح|ليس لديك/u);
  await refused(owner,`correct_product_cost_v1(${q(product)},2600.5,'قصير',${q(key)})`,/PRODUCT_COST_CORRECTION_REASON_REQUIRED/u);
  await refused(owner,`correct_product_cost_v1(${q(product)},2600.5,${q('س'.repeat(501))},${q(key)})`,/PRODUCT_COST_CORRECTION_REASON_REQUIRED/u);
  await refused(owner,`correct_product_cost_v1(${q(product)},-1,${q(reason)},${q(key)})`,/PRODUCT_COST_CORRECTION_VALUE_INVALID/u);
  await refused(owner,`correct_product_cost_v1(${q(family)},2600,${q(reason)},${q(key)})`,/PRODUCT_COST_CORRECTION_FLAVOR_MASTER/u);
  const itemsBefore=await orderItems(sale.orderId),stockBeforeCorrection=await balances();
  const corrected=await rpc(owner,`correct_product_cost_v1(${q(product)},2600.5,${q(reason)},${q(key)})`);
  assert.equal(corrected.success,true);assert.equal(corrected.idempotentReplay,false);
  assert.equal(Number(corrected.priorExactInMinorUnits),2500);assert.equal(corrected.newCostPriceInMinorUnits,2601);
  const afterCorrection=await cost(product);
  assert.equal(afterCorrection.exact,'2600.500000');assert.equal(afterCorrection.cost,2601,'both columns consistent: cost_price = ROUND(exact)');
  assert.deepEqual(await balances(),stockBeforeCorrection,'correction never touches quantities');
  assert.deepEqual(await orderItems(sale.orderId),itemsBefore,'past sales keep their cost');
  const replay=await rpc(owner,`correct_product_cost_v1(${q(product)},2600.5,${q(reason)},${q(key)})`);
  assert.equal(replay.idempotentReplay,true);assert.equal(replay.correctionId,corrected.correctionId);
  await refused(owner,`correct_product_cost_v1(${q(product)},2700,${q(reason)},${q(key)})`,/PRODUCT_COST_CORRECTION_KEY_CONFLICT/u);
  assert.equal(Number(await sql(`SELECT count(*) FROM product_cost_corrections WHERE product_id=${q(product)};`)),1);
  const audit=await json(`SELECT details FROM audit_logs WHERE action='CORRECT_PRODUCT_COST' AND entity_id=${q(product)};`);
  assert.equal(audit.reason,reason);assert.equal(Number(audit.new_exact_in_minor_units),2600.5);assert.equal(audit.prior_cost_price_in_minor_units,2500);
  for(const statement of [`UPDATE product_cost_corrections SET reason='تغيير السبب'`,`DELETE FROM product_cost_corrections`,`TRUNCATE product_cost_corrections`]){
    const r=await psql(statement+';');assert.notEqual(r.code,0,statement);assert.match(r.err,/PRODUCT_COST_CORRECTION_IMMUTABLE/u);
  }
  const direct=await psql(asUser(owner,`SELECT count(*) FROM public.product_cost_corrections;`,false));
  assert.match(direct.err,/permission denied/u,'the UI cannot read the table directly');
  const staleEditor=await psql(asUser(admin,`SELECT public.${v4(product,afterSecond.updatedAt,{name:'قديم',costParam:900})};`,false));
  assert.match(staleEditor.err,/PRODUCT_EDIT_CONFLICT/u,'an editor opened before the correction must reload first');
  const nextSale=await sell('product-cost-sale-b-00000000000000001',2);
  const [nextLine]=await orderItems(nextSale.orderId);
  assert.equal(nextLine.unitCost,2601);assert.equal(nextLine.cogs,5202,'later sales use the corrected cost');

  console.log(JSON.stringify({stage:'focused proofs',passed:true,wacFromTwoReceipts:2500,bugReproducedOnV3:true,editsKeepCost:true,
    saleCogsAtAverage:10000,newProductUnchanged:true,ownerCorrection:true,idempotent:true,audited:true,immutable:true,quantitiesUnchanged:true}));

  stage='database lint';
  const {stdout:lint}=await exec(process.execPath,[cli,'db','lint','--local','--level','warning','--workdir',workdir],
    {cwd:root,windowsHide:true,timeout:120000,maxBuffer:1024*1024});
  console.log(JSON.stringify({stage,passed:true,result:assertPackageDDbLint(lint)}));
  console.log(JSON.stringify({ok:true,mode:'PRODUCT_COST_INTEGRITY_RUNTIME',productionAccess:0}));
}catch(error){console.error(JSON.stringify({ok:false,stage,message:error.message,productionAccess:0}));process.exitCode=1;}
finally{if(workdir&&process.env.NAWASRAH_KEEP_STACK!=='true')await exec(process.execPath,[cli,'stop','--no-backup','--workdir',workdir],{cwd:root,windowsHide:true,timeout:120000,maxBuffer:1024*1024});}
