// Existing219 RPC feasibility only. Fixed disposable database, no hosted inputs.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
import {schemaCatalogSql,catalogDifference} from './schema-catalog.mjs';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile),project='nawasrah-product-template-test';
assert.equal(process.argv.length,2,'LOCAL_FIXED_PROJECT_ONLY');
const executor=executorFor(['--container','supabase_db_'+project]);
const cli=path.join(root,'node_modules/supabase/dist/supabase.js'),out=await mkdtemp(path.join(tmpdir(),'nawasrah-product-template-'));
const id=n=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`,owner=id(1);
const q=v=>v===null?'NULL':"'"+String(v).replaceAll("'","''")+"'",j=v=>q(JSON.stringify(v))+'::jsonb';
const sql=async text=>{const r=await executeInput(executor,"SET statement_timeout='60s';SET lock_timeout='20s';\n"+text);assert.equal(r.code,0,r.stderr);return r.stdout.trim();};
const json=async text=>JSON.parse((await sql(text)).split(/\r?\n/u).filter(Boolean).at(-1));
const auth=text=>`BEGIN;SELECT set_config('request.jwt.claims',${q(JSON.stringify({sub:owner,role:'authenticated',aal:'aal2'}))},true);SET LOCAL ROLE authenticated;${text}COMMIT;`;
const rpc=call=>json(auth('SELECT public.'+call+';'));
let local,stage='bootstrap219';const results=[];
try{
 const{stdout}=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,timeout:900000,maxBuffer:8*1024**2,env:{...process.env,NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'219',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 local=JSON.parse(stdout).isolatedProjectRoot;assert.ok(local);assert.equal(await sql('SELECT count(*) FROM supabase_migrations.schema_migrations;'),'180');
 await sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
 const catalog=await json(schemaCatalogSql);
 stage='atomic family existing v2';
 const family=await rpc(`create_product_family_with_flavors_v2(p_sku:='TPL-FAMILY',p_name_ar:='عائلة وهمية',p_category_id:=${q(id(11))},p_unit_id:=${q(id(10))},p_purchase_unit_id:=${q(id(10))},p_units_per_purchase_unit:=12,p_default_purchase_price_in_minor_units:=6000,p_sale_unit_id:=${q(id(10))},p_units_per_sale_unit:=12,p_default_sale_price_in_minor_units:=9000,p_cost_price_in_minor_units:=500,p_warehouse_id:=${q(id(201))},p_flavors:=${j([{nameAr:'ليمون',barcode:'009900000001'},{nameAr:'برتقال'}])})`);
 assert.equal(family.success,true);const master=family.productId;
 const children=()=>json(`SELECT jsonb_agg(to_jsonb(p) ORDER BY flavor_name_ar) FROM products p WHERE flavor_master_product_id=${q(master)};`);
 let rows=await children();assert.equal(rows.length,2);assert.ok(rows.every(r=>r.barcode===null));
 const before=rows[0],flavor=before.id;
 stage='phase2 deterministic SKU through existing master v5';
 await rpc(`update_product_master_v5(p.id,p.updated_at,'TPL-FAMILY-برتقال',p.barcode,p.name_ar,p.description,p.category_id,p.brand_id,p.unit_id,p.purchase_unit_id,p.units_per_purchase_unit,p.default_purchase_price_in_minor_units,p.sale_unit_id,p.units_per_sale_unit,p.default_sale_price_in_minor_units,p.cost_price_in_minor_units,p.min_stock_level,p.max_stock_level,p.is_active,NULL,NULL) FROM products p WHERE id=${q(flavor)}`);
 stage='phase2 barcode through existing flavor v2';
 await rpc(`update_product_flavor_v2(p.id,p.updated_at,p.flavor_name_ar,'009900000002',NULL,p.is_active) FROM products p WHERE id=${q(flavor)}`);
 rows=await children();const after=rows.find(p=>p.id===flavor);assert.equal(after.sku,'TPL-FAMILY-برتقال');assert.equal(after.barcode,'009900000002');assert.equal(after.flavor_master_product_id,master);
 for(const field of ['cost_price_in_minor_units','wac_cost_in_minor_units_exact','default_sale_price_in_minor_units','units_per_sale_unit','default_purchase_price_in_minor_units','sale_price_in_minor_units','wholesale_price_in_minor_units'])assert.deepEqual(after[field],before[field],field);
 results.push({case:'atomic family then SKU/barcode with existing versioned RPCs',passed:true,zeroOpeningStock:await sql(`SELECT COALESCE(sum(on_hand_quantity),0) FROM inventory_balances WHERE product_id IN(SELECT id FROM products WHERE id=${q(master)} OR flavor_master_product_id=${q(master)});`)==='0',commercialAndCostUnchanged:true});
 stage='stale second phase rejected without write';const fp=await readApplicationFingerprint(executor);
 const stale=await executeInput(executor,auth(`SELECT public.update_product_flavor_v2(${q(flavor)},${q(before.updated_at)}::timestamptz,'مرفوض','BAD',NULL,true);`));assert.notEqual(stale.code,0);assert.match(stale.stderr,/PRODUCT_EDIT_CONFLICT/u);assert.deepEqual(await readApplicationFingerprint(executor),fp);
 assert.deepEqual(catalogDifference(catalog,await json(schemaCatalogSql)),[]);
 results.push({case:'stale metadata CAS refused;all application data/sequences and catalog unchanged',passed:true});
 await writeFile(path.join(out,'proof.json'),JSON.stringify({ok:true,results,history:180,ceiling:219,noHostedAccess:true},null,2)+'\n');console.log(JSON.stringify({ok:true,out,results}));
}catch(error){await writeFile(path.join(out,'failure.json'),JSON.stringify({ok:false,stage,message:error.message},null,2)+'\n');console.error(JSON.stringify({ok:false,stage,out,message:error.message}));process.exitCode=1;}
finally{if(local)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true,timeout:120000,maxBuffer:1024**2});}
