import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {promisify} from 'node:util';
import path from 'node:path';
import {assertPackageDDbLint} from './package-d-db-lint-policy.mjs';

const exec=promisify(execFile);
const root=path.resolve(import.meta.dirname,'../..');
const before=process.env.NAWASRAH_PACKAGE_D_MODE==='before';
const ceiling=before?131:132;
const projectId='nawasrah-package-d-test';
const container=`supabase_db_${projectId}`;
const cli=path.join(root,'node_modules/supabase/dist/supabase.js');
const owner='92400000-0000-0000-0000-000000000001';
const claims=`SELECT set_config('request.jwt.claims','{"sub":"${owner}","role":"authenticated","aal":"aal2"}',false);`;
let workdir;
const sql=text=>new Promise((resolve,reject)=>{
  const child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-q','-At','-v','ON_ERROR_STOP=1'],
    {cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let out='',err='';
  child.stdout.on('data',s=>{out+=s;});child.stderr.on('data',s=>{err+=s;});
  child.on('error',reject);child.on('close',code=>code===0?resolve(out.trim()):reject(Error(`${code}: ${err}`)));
  child.stdin.end(`SET statement_timeout='60s';SET lock_timeout='30s';\n${text}`);
});
const json=async text=>JSON.parse((await sql(text)).split(/\r?\n/u).at(-1));
try{
  if(process.env.NAWASRAH_SKIP_BOOTSTRAP==='1'){
    assert.ok(process.env.NAWASRAH_PACKAGE_D_WORKDIR,'Owned workdir is required for cleanup');
    workdir=process.env.NAWASRAH_PACKAGE_D_WORKDIR;
  }else{
    const {stdout}=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{
      cwd:root,windowsHide:true,timeout:600000,maxBuffer:8*1024*1024,env:{...process.env,
        NAWASRAH_ISOLATED_PROJECT_ID:projectId,NAWASRAH_MAX_MIGRATION:String(ceiling),
        NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',NAWASRAH_SUPABASE_EXCLUDE:
        'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
    const built=JSON.parse(stdout);assert.equal(built.ok,true);workdir=built.isolatedProjectRoot;
  }
  // Fresh schema must retain the historical default. Tests may explicitly
  // exercise feature states later, but Migration132 cannot activate it.
  assert.equal(await sql('SELECT feature_state FROM public.configurable_parcel_feature_settings;'),'OFF');
  const fixture=(await readFile(path.join(root,'scripts/testing/phase3-configurable-parcel-contracts-runtime.sql'),'utf8')).replace(/\r\n?/gu,'\n');
  const first=fixture.indexOf('\nDO $$');const second=fixture.indexOf('\nDO $$',first+1);
  assert.ok(first>=0&&second>first);
  await sql(fixture.slice(0,second));
  // The public storefront chooses its earliest active warehouse. Make the
  // isolated fixture authoritative for that selector, not the seeded empty one.
  await sql("UPDATE warehouses SET created_at='1900-01-01' WHERE id='92400000-0000-0000-0000-000000000201';");
  const guards=await json(`SET nawasrah.package_d_mode='${before?'before':'after'}';\n`+
    await readFile(path.join(root,'scripts/testing/package-d-aftercare-guard-probes.sql'),'utf8'));
  for(const scenario of ['return','admin_return','replacement']){
    assert.equal(guards[scenario].rolledBack,true);
    assert.equal(guards[scenario].modernContractRejected,!before);
  }
  const outsideCallers=Number(await sql(`SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname NOT IN ('phase5_private','pg_catalog','information_schema') AND p.prosrc LIKE '%phase5_private%';`));
  assert.equal(outsideCallers,0,'Operational private-layer caller prevents removal');
  let configuration;
  if(!before){
    configuration=await json(`${claims} SET ROLE authenticated;
      SELECT public.save_product_parcel_configuration_v1('92400000-0000-0000-0000-000000000100',
        'configurable_mix',true,5,ARRAY['92400000-0000-0000-0000-000000000101']::uuid[]);`);
    assert.equal(configuration.success,true);
    assert.deepEqual(configuration.allowedProductIds,['92400000-0000-0000-0000-000000000101']);
    const options=await json(`${claims} SET ROLE authenticated;
      SELECT public.get_pos_configurable_parcel_options_v1('92400000-0000-0000-0000-000000000201');`);
    assert.deepEqual(options.options,[],'OFF must not expose creation capability');
    const acl=await json(`SELECT jsonb_build_object(
      'guard',has_function_privilege('authenticated','public.package_d_assert_modern_sale_internal(uuid,text)','EXECUTE'),
      'oldReturn',has_function_privilege('authenticated','public.package_d_settle_sales_return_before_guard_internal(uuid,text,jsonb,text,text,text,text)','EXECUTE'),
      'policyWrite',has_table_privilege('authenticated','public.product_parcel_allowed_components','INSERT'));`);
    assert.deepEqual(acl,{guard:false,oldReturn:false,policyWrite:false});
    const literal=value=>`'${String(value).replaceAll("'","''")}'`;
    const asOwner=query=>`${claims} SET ROLE authenticated; ${query}`;
    const reject=async(query,code)=>assert.rejects(sql(asOwner(query)),new RegExp(code,'u'));
    const snapshot=async()=>json(`SELECT jsonb_build_object(
      'orders',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM orders t),
      'orderItems',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM order_items t),
      'payments',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM customer_payments t),
      'shifts',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM cash_shifts t),
      'products',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM products t),
      'operations',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM business_operations t),
      'balances',(SELECT jsonb_agg(to_jsonb(t) ORDER BY warehouse_id,product_id) FROM inventory_balances t),
      'movements',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM inventory_movements t),
      'returns',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM sales_return_events t),
      'returnItems',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM sales_return_items t),
      'replacementItems',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM sales_replacement_items t),
      'replacementEvents',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM sales_replacement_events t),
      'returnEvidence',(SELECT jsonb_agg(to_jsonb(t) ORDER BY operation_id) FROM phase42_return_settlement_evidence t),
      'replacementEvidence',(SELECT jsonb_agg(to_jsonb(t) ORDER BY operation_id) FROM phase43_replacement_settlement_evidence t),
      'consumptions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM sales_aftercare_consumptions t),
      'returnEffects',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM phase42_return_inventory_effects t),
      'replacementEffects',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM phase43_replacement_inventory_effects t));`);
    const unchangedReject=async(query,code)=>{
      const previous=await snapshot();await reject(query,code);assert.deepEqual(await snapshot(),previous);
    };
    const family='92400000-0000-0000-0000-000000000100';
    const a='92400000-0000-0000-0000-000000000101';
    const b='92400000-0000-0000-0000-000000000102';
    const warehouse='92400000-0000-0000-0000-000000000201';
    const branch='92400000-0000-0000-0000-000000000200';
    const preserved=await json(asOwner(`SELECT save_product_parcel_configuration_v1('${family}','configurable_mix',true);`));
    assert.deepEqual(preserved.allowedProductIds,[a],'Three-argument API must not widen owner policy');
    await sql(asOwner("SELECT set_configurable_parcel_feature_state_v1('ENABLED');"));
    const enabledOptions=await json(asOwner(`SELECT get_pos_configurable_parcel_options_v1('${warehouse}');`));
    assert.deepEqual(enabledOptions.options[0].components.map(c=>c.productId),[a]);
    const publicOptions=await json(`SET ROLE anon; SELECT get_public_configurable_parcel_options(ARRAY['${family}']::uuid[]);`);
    assert.deepEqual(publicOptions.options[0].components.map(c=>c.productId),[a]);
    const revision=preserved.configuration.configuration_revision;
    const saleQuery=(lines,key,received=5000)=>`SELECT create_pos_sale_v2('${warehouse}','${branch}',NULL,'D runtime','cash',
      ${literal(JSON.stringify(lines))}::jsonb,0,${received},${literal(key)});`;
    const parcel=product=>[{commercial_line_kind:'configurable_parcel',family_product_id:family,
      parcel_configuration_id:preserved.configuration.id,configuration_revision:revision,
      parcel_instances:[{components:[{product_id:product,base_quantity:5}]}]}];
    await unchangedReject(saleQuery(parcel(b),'package-d-disallowed-flavor'),'PARCEL_COMPONENT_NOT_ALLOWED');
    const issued=await json(asOwner(saleQuery(parcel(a),'package-d-valid-parcel')));
    assert.equal(issued.success,true);
    const beforeReplay=await snapshot();
    const replay=await json(asOwner(saleQuery(parcel(a),'package-d-valid-parcel')));
    assert.equal(replay.operationId,issued.operationId);assert.deepEqual(await snapshot(),beforeReplay);
    await sql(`INSERT INTO warehouses(id,branch_id,code,name_ar,is_active)
      VALUES('92400000-0000-0000-0000-000000000299','${branch}','D-EMPTY','Empty D warehouse',true);`);
    const empty=await json(asOwner("SELECT get_pos_configurable_parcel_options_v1('92400000-0000-0000-0000-000000000299');"));
    assert.deepEqual(empty.options,[],'Other warehouse inventory cannot grant POS capacity');
    await unchangedReject(`SELECT create_pos_sale('${warehouse}','${branch}',NULL,'V1','cash','[]'::jsonb,0,0,'d-v1');`,'PACKAGE_D_POS_V2_REQUIRED');
    await unchangedReject(`SELECT return_completed_website_order('${issued.orderId}','V1','damaged','cash',NULL,NULL);`,'PACKAGE_D_MODERN_AFTERCARE_REQUIRED');
    await unchangedReject("SELECT create_customer_order(p_customer_full_name=>'D',p_customer_phone=>'0790000000',p_source=>'pos');",'PACKAGE_D_POS_V2_REQUIRED');
    const base=await json(asOwner(saleQuery([{commercial_line_kind:'base_unit',product_id:a,base_quantity:2}],
      'package-d-base-aftercare',2000)));
    const item=await sql(`SELECT id FROM order_items WHERE order_id='${base.orderId}';`);
    const replacementQuery=`SELECT settle_sales_replacement_v1('${base.orderId}','package-d-replacement',
      '${JSON.stringify([{sourceKind:'base_order_item',sourceId:item,quantity:1}])}'::jsonb,'D valid replacement',NULL);`;
    const replaced=await json(asOwner(replacementQuery));assert.equal(replaced.success,true);
    const replacementSnapshot=await snapshot();
    const replacementReplay=await json(asOwner(replacementQuery));
    assert.equal(replacementReplay.operationId,replaced.operationId);
    assert.deepEqual(await snapshot(),replacementSnapshot);
    // The current representative is a replacement for one unit; the other
    // original unit remains independently returnable. No aggregate capacity proof.
    const physical=quantity=>JSON.stringify([{root_source_kind:'base_order_item',root_source_id:item,
      source_kind:'base_order_item',source_id:item,product_id:a,quantity,
      sellable_restock_quantity:0,defect_non_sellable_quantity:quantity,customer_damage_quantity:0}]);
    const returnQuery=`SELECT settle_admin_sales_return_v1('${base.orderId}','package-d-return',
      '${JSON.stringify([{return_scope:'base_unit',order_item_id:item,quantity:1,stock_disposition:'damaged'}])}'::jsonb,
      '${physical(1)}'::jsonb,
      'D valid return','cash',NULL,NULL);`;
    const returned=await json(asOwner(returnQuery));assert.equal(returned.success,true);
    const returnSnapshot=await snapshot();
    const returnReplay=await json(asOwner(returnQuery));assert.equal(returnReplay.operationId,returned.operationId);
    assert.deepEqual(await snapshot(),returnSnapshot);
    await unchangedReject(`SELECT settle_admin_sales_return_v1('${base.orderId}','package-d-over-return',
      '${JSON.stringify([{return_scope:'base_unit',order_item_id:item,quantity:2,stock_disposition:'damaged'}])}'::jsonb,
      '${physical(2)}'::jsonb,
      'D oversubscription','cash',NULL,NULL);`,'PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED');
    const recovery = await exec(process.execPath, [path.join(root,'node_modules/tsx/dist/cli.mjs'),
      path.join(root,'scripts/testing/package-d-pos-recovery-runtime.ts'), container,
      preserved.configuration.id, String(revision)], {cwd: root, windowsHide: true, timeout: 120000,
      maxBuffer: 1024*1024});
    assert.equal(JSON.parse(recovery.stdout.trim()).ok, true);
    await sql(asOwner("SELECT set_configurable_parcel_feature_state_v1('OWNER_PILOT');"));
    const cashierClaims=claims.replaceAll(owner,'92400000-0000-0000-0000-000000000002');
    const cashier=await json(`${cashierClaims} SET ROLE authenticated; SELECT get_pos_configurable_parcel_options_v1('${warehouse}');`);
    assert.deepEqual(cashier.options,[]);
    await assert.rejects(sql(`${cashierClaims} SET ROLE authenticated; SELECT get_admin_parcel_configuration_context_v1();`),/FORBIDDEN|صلاحية|صلاحيات|ACCESS_DENIED/u);
    await assert.rejects(sql(`${cashierClaims} SET ROLE authenticated; SELECT set_configurable_parcel_feature_state_v1('ENABLED');`),/FORBIDDEN|صلاحية|صلاحيات|ACCESS_DENIED/u);
    await sql(asOwner("SELECT set_configurable_parcel_feature_state_v1('OFF');"));
  }
  let transitionGuards;
  if(before){
    const migration=await readFile(path.join(root,'supabase/migrations/132_package_d_system_unification.sql'),'utf8');
    const catalog=()=>json(`SELECT jsonb_build_object('private',to_regnamespace('phase5_private'),
      'newGuard',to_regprocedure('public.package_d_assert_modern_sale_internal(uuid,text)'),
      'oldWriter',(SELECT md5(string_agg(prosrc,E'\\n' ORDER BY oid)) FROM pg_proc
        WHERE proname='create_pos_sale' AND pronamespace='public'::regnamespace));`);
    const oldCatalog=await catalog();
    await assert.rejects(sql(`BEGIN; INSERT INTO phase5_private.reversal_coordinator_guards
      VALUES('92400000-0000-0000-0000-000000009991',pg_current_xact_id());\n${migration}`),/PACKAGE_D_PRIVATE_DATA_PRESENT/u);
    assert.deepEqual(await catalog(),oldCatalog,'Refused retirement must roll back earlier132 definitions');
    await assert.rejects(sql(`BEGIN; CREATE FUNCTION public.package_d_test_private_dependency()
      RETURNS BIGINT LANGUAGE sql AS 'SELECT phase5_private.money_v1(''1''::jsonb)';\n${migration}`),/PACKAGE_D_PRIVATE_CALLER_PRESENT/u);
    assert.deepEqual(await catalog(),oldCatalog,'Caller refusal must roll back the complete migration');
    await sql(migration);
    assert.equal(await sql('SELECT feature_state FROM configurable_parcel_feature_settings;'),'OFF');
    transitionGuards=await json("SET nawasrah.package_d_mode='after';\n"+
      await readFile(path.join(root,'scripts/testing/package-d-aftercare-guard-probes.sql'),'utf8'));
    for(const scenario of ['return','admin_return','replacement']){
      assert.equal(transitionGuards[scenario].rolledBack,true);
      assert.equal(transitionGuards[scenario].modernContractRejected,true);
    }
  }
  assert.equal(await sql("SELECT to_regnamespace('phase5_private') IS NULL;"),'t','Retired private schema must be absent');
  const {stdout:lint}=await exec(process.execPath,[cli,'db','lint','--local','--level','warning','--workdir',workdir],
    {cwd:root,windowsHide:true,timeout:120000,maxBuffer:1024*1024});
  const lintResult=assertPackageDDbLint(lint);
  console.log(JSON.stringify({ok:true,mode:before?'before':'after',freshRebuild:`001-${ceiling}`,
    guards,featureStateUnchanged:true,outsidePrivateCallers:outsideCallers,configuration,
    transitionGuards,dbLint:lintResult},null,2));
}finally{
  if(workdir)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',workdir],
    {cwd:root,windowsHide:true,timeout:120000,maxBuffer:1024*1024});
}
