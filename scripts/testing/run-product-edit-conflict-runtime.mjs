// Isolated runtime proof for migration 170 (product edit optimistic concurrency).
// Two real PostgreSQL sessions race on the same product: the second waits on
// the row lock, then is refused with the Arabic conflict and the current
// values; only a retry with the new version succeeds. No Production access.
import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {promisify} from 'node:util';
import path from 'node:path';
import {assertPackageDDbLint} from './package-d-db-lint-policy.mjs';

const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..');
const projectId=process.env.NAWASRAH_PRODUCT_EDIT_PROJECT_ID||'nawasrah-product-edit-conflict-test',container=`supabase_db_${projectId}`;
const cli=path.join(root,'node_modules/supabase/dist/supabase.js');
const id=n=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),admin=id(2),cashier=id(3),product=id(103),flavor=id(101),unit=id(10),category=id(11);
const q=v=>`'${String(v).replaceAll("'","''")}'`,j=v=>q(JSON.stringify(v))+'::jsonb';
const CONFLICT=/PRODUCT_EDIT_CONFLICT: عدّل مستخدم آخر هذا المنتج قبل قليل/u;
let workdir,stage='bootstrap001-170';

const psql=(text)=>new Promise((resolve,reject)=>{
  const started=Date.now();
  const child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-q','-At','-v','ON_ERROR_STOP=1'],
    {cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let out='',err='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>err+=chunk);
  child.on('error',reject);child.on('close',code=>resolve({code,out:out.trim(),err,ms:Date.now()-started}));
  child.stdin.end(`SET statement_timeout='60s';SET lock_timeout='30s';\n${text}`);
});
const sql=async text=>{const r=await psql(text);if(r.code!==0)throw Error(`${stage}: ${r.err.slice(-4000)}`);return r.out;};
const json=async text=>JSON.parse(await sql(text));
const claims=actor=>`DO $$BEGIN PERFORM set_config('request.jwt.claims',${q(JSON.stringify({sub:actor,role:'authenticated',aal:'aal2'}))},true);END$$;
  SET LOCAL ROLE authenticated;`;
const asUser=(actor,body,{commit=true}={})=>`BEGIN;${claims(actor)}${body}${commit?'COMMIT':'ROLLBACK'};`;
const rpc=(actor,call,options)=>json(asUser(actor,`SELECT public.${call};`,options));
const version=async target=>sql(`SELECT updated_at::text FROM products WHERE id=${q(target)};`);
const masterArgs=(expected,{name='صنف الكرتونة',sale=4500,cost=900,active=true}={})=>`update_product_master_v4(
  ${q(product)},${expected===null?'NULL':q(expected)}::timestamptz,'E-CARTON',NULL,${q(name)},NULL,${q(category)},NULL,
  ${q(unit)},${q(unit)},5,4000,${q(unit)},5,${sale},${cost},0,NULL,${active},NULL)`;
const v3Args=({name='صنف الكرتونة',sale=4500,cost=900,active=true}={})=>`update_product_master_v3(
  ${q(product)},'E-CARTON',NULL,${q(name)},NULL,${q(category)},NULL,
  ${q(unit)},${q(unit)},5,4000,${q(unit)},5,${sale},${cost},0,NULL,${active},NULL)`;
// Every editable/financial column except the version itself.
const row=target=>json(`SELECT to_jsonb(p)-'updated_at' FROM products p WHERE id=${q(target)};`);
const stock=()=>json(`SELECT jsonb_build_object(
  'balances',(SELECT COALESCE(jsonb_agg(to_jsonb(b)-'updated_at' ORDER BY b.warehouse_id,b.product_id),'[]') FROM inventory_balances b),
  'movements',(SELECT count(*) FROM inventory_movements),'orders',(SELECT count(*) FROM orders));`);
const detailOf=err=>{const line=err.split('\n').find(l=>l.startsWith('DETAIL:'));assert.ok(line,`conflict detail missing: ${err}`);
  return JSON.parse(line.slice('DETAIL:'.length).trim());};

try{
  const {stdout}=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{
    cwd:root,windowsHide:true,timeout:900000,maxBuffer:8*1024*1024,env:{...process.env,
      NAWASRAH_ISOLATED_PROJECT_ID:projectId,NAWASRAH_MAX_MIGRATION:'170',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
      NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
  const boot=JSON.parse(stdout);assert.equal(boot.ok,true);workdir=boot.isolatedProjectRoot;

  stage='fixture';
  await sql(`ALTER TABLE orders DISABLE TRIGGER trg_notify_new_website_order_push;SELECT cron.alter_job(jobid,active:=false) FROM cron.job;`);
  await sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
  for(const [actor,role] of [[admin,'admin'],[cashier,'cashier']])await sql(`
    INSERT INTO auth.users(id,aud,role,email) VALUES(${q(actor)},'authenticated','authenticated',${q(role+'@edit.example.test')});
    INSERT INTO profiles(id,full_name,is_active) VALUES(${q(actor)},${q(role)},true);
    INSERT INTO roles(code,name_ar) VALUES(${q(role)},${q(role)}) ON CONFLICT(code) DO NOTHING;
    INSERT INTO user_roles(user_id,role_id) SELECT ${q(actor)},r.id FROM roles r WHERE r.code=${q(role)};`);

  stage='ACL';
  const acl=await json(`SELECT jsonb_object_agg(sig,jsonb_build_object('authenticated',has_function_privilege('authenticated',sig,'EXECUTE'),
    'anon',has_function_privilege('anon',sig,'EXECUTE'),'definer',p.prosecdef,'config',p.proconfig))
    FROM (VALUES
      ('public.update_product_master_v4(uuid,timestamptz,text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,boolean,text)'),
      ('public.update_product_flavor_v2(uuid,timestamptz,text,text,text,boolean)'),
      ('public.update_product_master_v3(uuid,text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,boolean,text)'),
      ('public.update_product_flavor_v1(uuid,text,text,text,boolean)'),
      ('public.product_edit_assert_version_internal(uuid,timestamptz)'),
      ('public.product_edit_snapshot_internal(uuid)')) s(sig)
    JOIN pg_proc p ON p.oid=s.sig::regprocedure;`);
  const entries=Object.entries(acl);assert.equal(entries.length,6);
  for(const [sig,value] of entries){
    assert.equal(value.anon,false,sig);assert.equal(value.definer,true,sig);
    assert.deepEqual(value.config,['search_path=public, pg_temp'],sig);
    assert.equal(value.authenticated,/_v4\(|_v2\(/u.test(sig),`${sig} client EXECUTE`);
  }
  const bypass=await psql(asUser(owner,`SELECT public.${v3Args({name:'تجاوز'})};`));
  assert.notEqual(bypass.code,0);assert.match(bypass.err,/permission denied/u,'unversioned v3 must be closed to clients');
  const bypassFlavor=await psql(asUser(owner,`SELECT public.update_product_flavor_v1(${q(flavor)},'تجاوز',NULL,NULL,true);`));
  assert.notEqual(bypassFlavor.code,0);assert.match(bypassFlavor.err,/permission denied/u);
  const cashierTry=await psql(asUser(cashier,`SELECT public.${masterArgs(await version(product))};`));
  assert.notEqual(cashierTry.code,0);assert.doesNotMatch(cashierTry.err,CONFLICT,'role is checked before the version');
  const missing=await psql(asUser(owner,`SELECT public.${masterArgs(null)};`));
  assert.match(missing.err,/PRODUCT_EDIT_VERSION_REQUIRED/u);

  stage='wrapper parity with v3 (same input, same row)';
  // Same starting state each time (both transactions roll back). v3 runs as the
  // migration owner because clients no longer hold EXECUTE on it.
  const capture=body=>sql(`BEGIN;DO $$BEGIN PERFORM set_config('request.jwt.claims',${q(JSON.stringify({sub:owner,role:'authenticated',aal:'aal2'}))},true);END$$;
    ${body}RESET ROLE;SELECT (to_jsonb(p)-'updated_at')::text FROM products p WHERE id=${q(product)};ROLLBACK;`).then(out=>JSON.parse(out.split('\n').at(-1)));
  const viaV3=await capture(`SELECT public.${v3Args({name:'تطابق',sale:6000,cost:950})};`);
  const viaV4=await capture(`SET LOCAL ROLE authenticated;SELECT public.${masterArgs(await version(product),{name:'تطابق',sale:6000,cost:950})};`);
  assert.deepEqual(viaV4,viaV3,'v4 must write exactly what v3 writes');
  assert.equal(viaV4.name_ar,'تطابق');assert.equal(viaV4.default_sale_price_in_minor_units,6000);

  stage='two concurrent sessions on one version';
  const stockBefore=await stock();
  const opened=await version(product);
  const sessionA=psql(asUser(owner,`SELECT public.${masterArgs(opened,{name:'تعديل المالك',sale:4800})};SELECT pg_sleep(2);`));
  let lockHolder=0;
  for(let i=0;i<100&&!lockHolder;i++){
    lockHolder=Number(await sql(`SELECT count(*) FROM pg_stat_activity WHERE state='active' AND query LIKE '%pg_sleep(2)%' AND pid<>pg_backend_pid();`));
    if(!lockHolder)await new Promise(r=>setTimeout(r,50));
  }
  assert.equal(lockHolder,1,'session A must hold the row before B starts');
  const sessionB=psql(asUser(admin,`SELECT public.${masterArgs(opened,{name:'تعديل المدير',sale:5100})};`));
  let waiting=0;
  for(let i=0;i<60&&!waiting;i++){
    waiting=Number(await sql(`SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%تعديل المدير%' AND pid<>pg_backend_pid();`));
    if(!waiting)await new Promise(r=>setTimeout(r,50));
  }
  assert.equal(waiting,1,'session B must be blocked on session A row lock (real concurrency)');
  const [a,b]=await Promise.all([sessionA,sessionB]);
  assert.equal(a.code,0,a.err);assert.notEqual(b.code,0,'the second save must be refused');
  assert.match(b.err,CONFLICT);
  const current=detailOf(b.err);
  assert.equal(current.nameAr,'تعديل المالك');assert.equal(current.salePackagePriceInMinorUnits,4800);
  assert.equal(current.updatedAt.length>0,true);
  const afterRace=await row(product);
  assert.equal(afterRace.name_ar,'تعديل المالك','the refused save wrote nothing');
  assert.equal(afterRace.default_sale_price_in_minor_units,4800);

  stage='retry with the version from the conflict';
  const retried=await rpc(admin,masterArgs(current.updatedAt,{name:'تعديل المدير',sale:5100}));
  assert.equal(retried.success,true);assert.ok(retried.updatedAt);
  assert.equal((await row(product)).name_ar,'تعديل المدير');
  const staleAgain=await psql(asUser(owner,`SELECT public.${masterArgs(current.updatedAt,{name:'قديم'})};`));
  assert.match(staleAgain.err,CONFLICT,'the version moved again after the retry');
  const roundTrip=await rpc(owner,masterArgs(retried.updatedAt,{name:'تعديل المدير',sale:5100}));
  assert.equal(roundTrip.success,true,'the returned updatedAt is an exact round-trip version');

  stage='status/image/unit changes are versioned too';
  const hidden=await rpc(owner,masterArgs(roundTrip.updatedAt,{name:'تعديل المدير',sale:5100,active:false}));
  assert.equal((await row(product)).is_active,false);
  const staleStatus=await psql(asUser(admin,`SELECT public.${masterArgs(roundTrip.updatedAt,{name:'تعديل المدير',sale:5100,active:true})};`));
  assert.match(staleStatus.err,CONFLICT);assert.equal((await row(product)).is_active,false);
  await rpc(owner,masterArgs(hidden.updatedAt,{name:'تعديل المدير',sale:5100,active:true}));

  stage='admin page version round-trips into a save';
  const page=await rpc(owner,`get_admin_product_page(1,50,${q('E-CARTON')},NULL,'all','name')`,{commit:false});
  const listed=JSON.stringify(page).match(/"updated_at":"([^"]+)"/u)?.[1];
  assert.ok(listed,'product page exposes updated_at');
  assert.equal((await rpc(owner,masterArgs(listed,{name:'من القائمة',sale:5100}))).success,true);

  assert.deepEqual(await stock(),stockBefore,'edits and refused saves create no stock rows or movements');

  stage='a receipt that moves cost after the form opened blocks the stale save';
  const openedBeforeReceipt=await version(product);
  const costBefore=(await row(product)).cost_price_in_minor_units;
  const receipt=await rpc(owner,`create_direct_supplier_receipt_v2(p_supplier_id:=${q(id(301))},p_branch_id:=${q(id(200))},p_warehouse_id:=${q(id(201))},
    p_idempotency_key:='product-edit-receipt-000000000000000001',p_payment_method:='deferred',p_lines:=${j([{client_line_id:id(950),line_kind:'base_unit',
    commercial_quantity:10,base_unit_name:'باكيت',gross_amount_in_minor_units:20000,line_discount_in_minor_units:0,components:[{product_id:product,base_quantity:10}]}])})`);
  assert.equal(receipt.success,true);
  const costAfterReceipt=(await row(product)).cost_price_in_minor_units;
  assert.notEqual(costAfterReceipt,costBefore,'fixture receipt moved WAC cost');
  const staleCost=await psql(asUser(admin,`SELECT public.${masterArgs(openedBeforeReceipt,{name:'من القائمة',sale:5100,cost:900})};`));
  assert.match(staleCost.err,CONFLICT,'stale form must not overwrite the received cost');
  assert.equal((await row(product)).cost_price_in_minor_units,costAfterReceipt);
  assert.equal(detailOf(staleCost.err).costPriceInMinorUnits,costAfterReceipt);

  const stockAfterReceipt=await stock();

  stage='flavor edit: concurrent sessions';
  const flavorOpened=await version(flavor);
  const flavorA=psql(asUser(owner,`SELECT public.update_product_flavor_v2(${q(flavor)},${q(flavorOpened)}::timestamptz,'أ معدلة','FLV-A',NULL,true);SELECT pg_sleep(1.5);`));
  for(let i=0;i<100;i++){if(Number(await sql(`SELECT count(*) FROM pg_stat_activity WHERE state='active' AND query LIKE '%pg_sleep(1.5)%' AND pid<>pg_backend_pid();`)))break;
    await new Promise(r=>setTimeout(r,50));}
  const flavorB=psql(asUser(admin,`SELECT public.update_product_flavor_v2(${q(flavor)},${q(flavorOpened)}::timestamptz,'أ من المدير',NULL,NULL,false);`));
  const [fa,fb]=await Promise.all([flavorA,flavorB]);
  assert.equal(fa.code,0,fa.err);assert.match(fb.err,CONFLICT);assert.ok(fb.ms>=1000,'flavor session B waited for A');
  const flavorNow=detailOf(fb.err);assert.equal(flavorNow.flavorNameAr,'أ معدلة');assert.equal(flavorNow.isActive,true);
  const flavorRetry=await rpc(admin,`update_product_flavor_v2(${q(flavor)},${q(flavorNow.updatedAt)}::timestamptz,'أ من المدير',NULL,NULL,true)`);
  assert.equal(flavorRetry.success,true);assert.equal((await row(flavor)).flavor_name_ar,'أ من المدير');

  stage='stock untouched by flavor edits and conflicts';
  assert.deepEqual(await stock(),stockAfterReceipt);
  console.log(JSON.stringify({stage:'focused proofs',passed:true,realLockWait:true,conflictMessage:true,snapshotDetail:true,retry:true,
    v3Parity:true,statusVersioned:true,receiptCostProtected:true,flavor:true,aclClosed:true}));

  stage='database lint';
  const {stdout:lint}=await exec(process.execPath,[cli,'db','lint','--local','--level','warning','--workdir',workdir],
    {cwd:root,windowsHide:true,timeout:120000,maxBuffer:1024*1024});
  console.log(JSON.stringify({stage,passed:true,result:assertPackageDDbLint(lint)}));
  console.log(JSON.stringify({ok:true,mode:'PRODUCT_EDIT_CONFLICT_RUNTIME',productionAccess:0}));
}catch(error){console.error(JSON.stringify({ok:false,stage,message:error.message,productionAccess:0}));process.exitCode=1;}
finally{if(workdir&&process.env.NAWASRAH_KEEP_STACK!=='true')await exec(process.execPath,[cli,'stop','--no-backup','--workdir',workdir],{cwd:root,windowsHide:true,timeout:120000,maxBuffer:1024*1024});}
