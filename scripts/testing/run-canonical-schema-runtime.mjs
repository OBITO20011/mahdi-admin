import assert from 'node:assert/strict';
import {execFile, spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {promisify} from 'node:util';

// Only an explicitly named local test container can be targeted.
const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..');
const isolatedProjectId = 'nawasrah-canonical-schema-test';
const container = process.env.NAWASRAH_TEST_CONTAINER || `supabase_db_${isolatedProjectId}`;
assert.match(container, /^supabase_db_nawasrah-[a-z0-9-]+-test$/);
const sql = (input) => new Promise((resolve, reject) => {
  const child = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], {windowsHide: true});
  let out = ''; let err = '';
  child.stdout.on('data', b => { out += b; });
  child.stderr.on('data', b => { err += b; });
  child.on('error', reject);
  child.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(err)));
  child.stdin.end(input);
});
let isolatedProjectRoot = '';
if (process.env.NAWASRAH_SKIP_BOOTSTRAP !== '1') {
  const {stdout} = await execFileAsync(process.execPath, [path.join(scriptDirectory, 'bootstrap-isolated-supabase.mjs')], {
    cwd: projectRoot,
    env: {...process.env, NAWASRAH_ISOLATED_PROJECT_ID: isolatedProjectId},
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    timeout: 360_000,
  });
  const bootstrap = JSON.parse(stdout);
  assert.equal(bootstrap.ok, true);
  isolatedProjectRoot = bootstrap.isolatedProjectRoot;
}
const [warehouse, product] = JSON.parse(await sql(`SELECT json_build_array(gen_random_uuid(),gen_random_uuid());`));
const state = async () => JSON.parse(await sql(`SELECT json_build_object(
 'rows',(SELECT count(*) FROM public.inventory_balances WHERE warehouse_id='${warehouse}' AND product_id='${product}'),
 'quantity',(SELECT on_hand_quantity FROM public.inventory_balances WHERE warehouse_id='${warehouse}' AND product_id='${product}'),
 'reserved',(SELECT reserved_quantity FROM public.inventory_balances WHERE warehouse_id='${warehouse}' AND product_id='${product}'),
 'movements',(SELECT count(*) FROM public.inventory_movements WHERE warehouse_id='${warehouse}' AND product_id='${product}'),
 'bad_movements',(SELECT count(*) FROM public.inventory_movements WHERE warehouse_id='${warehouse}' AND product_id='${product}' AND balance_before+quantity<>balance_after),
 'audits',(SELECT count(*) FROM public.audit_logs WHERE entity_id='${product}' AND action='receive_inventory')
);`));
const receive = `SELECT public._receive_inventory_impl('${warehouse}','${product}',1,'canonical-test',NULL,'canonical test');`;
try {
  await sql(`INSERT INTO public.warehouses(id,code,name_ar) VALUES('${warehouse}','TEST-'||'${warehouse}','Canonical test');
    INSERT INTO public.products(id,sku,name_ar,cost_price_in_minor_units) VALUES('${product}','TEST-'||'${product}','Canonical test',1000);`);
  for (const expected of [20,40]) {
    const results = await Promise.all(Array.from({length:20}, () => sql(`BEGIN; ${receive} SELECT pg_sleep(0.03); COMMIT;`)));
    for (const result of results) {
      const payload = JSON.parse(result.split('\n').find(line=>line.startsWith('{')));
      assert.equal(payload.success,true);
      assert.equal(payload.received_quantity,1);
      assert.equal(payload.balance_after,payload.balance_before+1);
      assert.equal(typeof payload.message,'string');
    }
    assert.deepEqual(await state(), {rows:1,quantity:expected,reserved:0,movements:expected,bad_movements:0,audits:expected});
  }
  const before = await state();
  await assert.rejects(sql(`BEGIN; ${receive} SELECT 1/0; COMMIT;`), /division by zero/);
  assert.deepEqual(await state(),before);
  await assert.rejects(sql(`SELECT public._receive_inventory_impl('${warehouse}','${product}',0);`));
  assert.deepEqual(await state(),before);
  assert.equal(await sql(`SELECT count(*) FROM public.audit_logs WHERE entity_id='${product}' AND details->>'reference_type'='canonical-test';`),'40');
  assert.equal(await sql(`SELECT cost_price_in_minor_units FROM public.products WHERE id='${product}';`),'1000');
  const schema = JSON.parse(await sql(`SELECT json_build_object(
    'legacy',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('supplier_returns','supplier_return_items','stock_counts','stock_count_items')),
    'has_role',to_regprocedure('public.has_role(text)') IS NOT NULL,
    'triggers',(SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('trg_update_profiles_updated_at','trg_update_branches_updated_at','trg_update_warehouses_updated_at','trg_update_products_updated_at','trg_update_inventory_balances_updated_at')),
    'hardened',(SELECT proconfig=ARRAY['search_path=public'] AND NOT prosecdef FROM pg_proc WHERE oid='public.update_updated_at_column()'::regprocedure),
    'private',NOT has_function_privilege('authenticated','public._receive_inventory_impl(uuid,uuid,integer,text,uuid,text)','EXECUTE')
      AND NOT has_function_privilege('service_role','public._receive_inventory_impl(uuid,uuid,integer,text,uuid,text)','EXECUTE'),
    'trigger_private',NOT has_function_privilege('authenticated','public.update_updated_at_column()','EXECUTE')
      AND NOT has_function_privilege('service_role','public.update_updated_at_column()','EXECUTE')
  );`));
  assert.deepEqual(schema,{legacy:0,has_role:false,triggers:5,hardened:true,private:true,trigger_private:true});
  const [user, branch] = JSON.parse(await sql(`SELECT json_build_array(gen_random_uuid(),gen_random_uuid());`));
  const timestampTriggers = JSON.parse(await sql(`BEGIN;
    INSERT INTO auth.users(id,email) VALUES('${user}','canonical-schema-test@example.invalid');
    INSERT INTO public.profiles(id,full_name) VALUES('${user}','Canonical schema test');
    INSERT INTO public.branches(id,code,name_ar) VALUES('${branch}','TEST-BR-'||'${branch}','Canonical branch');
    UPDATE public.profiles SET updated_at='2000-01-01',full_name=full_name WHERE id='${user}';
    UPDATE public.branches SET updated_at='2000-01-01',name_ar=name_ar WHERE id='${branch}';
    UPDATE public.warehouses SET updated_at='2000-01-01',name_ar=name_ar WHERE id='${warehouse}';
    UPDATE public.products SET updated_at='2000-01-01',name_ar=name_ar WHERE id='${product}';
    UPDATE public.inventory_balances SET updated_at='2000-01-01',reserved_quantity=reserved_quantity WHERE warehouse_id='${warehouse}' AND product_id='${product}';
    SELECT json_build_object(
      'profiles',(SELECT updated_at>'2001-01-01' FROM public.profiles WHERE id='${user}'),
      'branches',(SELECT updated_at>'2001-01-01' FROM public.branches WHERE id='${branch}'),
      'warehouses',(SELECT updated_at>'2001-01-01' FROM public.warehouses WHERE id='${warehouse}'),
      'products',(SELECT updated_at>'2001-01-01' FROM public.products WHERE id='${product}'),
      'inventory_balances',(SELECT updated_at>'2001-01-01' FROM public.inventory_balances WHERE warehouse_id='${warehouse}' AND product_id='${product}')
    );
    ROLLBACK;`));
  assert.deepEqual(timestampTriggers,{profiles:true,branches:true,warehouses:true,products:true,inventory_balances:true});
  console.log(JSON.stringify({ok:true,firstBalance:20,existingBalance:20,rollback:true,timestampTriggers,schema}));
} finally {
  await sql(`DELETE FROM public.audit_logs WHERE entity_id='${product}';
    DELETE FROM public.inventory_movements WHERE product_id='${product}';
    DELETE FROM public.inventory_balances WHERE product_id='${product}';
    DELETE FROM public.products WHERE id='${product}';
    DELETE FROM public.warehouses WHERE id='${warehouse}';`);
  if (isolatedProjectRoot) {
    const cliPath = path.join(projectRoot, 'node_modules', 'supabase', 'dist', 'supabase.js');
    await execFileAsync(process.execPath, [cliPath, 'stop', '--no-backup', '--workdir', isolatedProjectRoot], {
      cwd: projectRoot,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      timeout: 120_000,
    });
  }
}
