// Optional local evidence reproduction. Never reads env files or linked project.
// Run: node --import tsx tests/handover-product-import.local.mjs
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {readXlsxFirstSheet} from '../src/lib/xlsx.ts';
import {mapSheet,prepareProducts} from '../src/features/goLive/goLiveImport.ts';
import {executorFor,executeInput} from '../scripts/operations/build-empty-supabase.mjs';
import {readApplicationFingerprint} from '../scripts/testing/backup-restore-contract.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const run=promisify(execFile),project='nawasrah-handover-docs-test',container='supabase_db_'+project;
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-handover-import-'));
const cli=path.join(root,'node_modules/supabase/dist/supabase.js');
const executor=executorFor(['--container',container]);
const owner='00000000-0000-4000-8000-000000000001';
const q=v=>"'"+String(v).replaceAll("'","''")+"'";
const json=v=>q(JSON.stringify(v))+'::jsonb';
const sql=async text=>{const r=await executeInput(executor,text);assert.equal(r.code,0,r.stderr);return r.stdout.trim();};
const rpc=async call=>JSON.parse(await sql(`BEGIN;DO $$BEGIN PERFORM set_config('request.jwt.claims',${q(JSON.stringify({sub:owner,role:'authenticated',aal:'aal2'}))},true);END$$;SET LOCAL ROLE authenticated;SELECT public.${call};COMMIT;`));
const report={ok:false,output,migrationCeiling:214,managedAccess:false,hostedConnections:0};let local;
try{
 const mapped=mapSheet('products',await readXlsxFirstSheet(await readFile(path.join(root,'docs/handover/templates/المنتجات.xlsx'))));
 assert.deepEqual(mapped.fileErrors,[]);const prepared=prepareProducts(mapped.rows);assert.deepEqual(prepared.errors,[]);assert.equal(prepared.payload.length,1);
 const boot=await run(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:{...process.env,NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'214',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 local=JSON.parse(boot.stdout).isolatedProjectRoot;
 await sql("SELECT cron.alter_job(jobid,active:=false) FROM cron.job;ALTER TABLE public.orders DISABLE TRIGGER trg_notify_new_website_order_push;");
 assert.equal(await sql('SELECT max(version) FROM supabase_migrations.schema_migrations;'),'214');
 assert.equal(await sql('SELECT count(*) FROM supabase_migrations.schema_migrations;'),'176');
 await sql(`INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) VALUES(${q(owner)},'authenticated','authenticated','handover-owner@example.test',NOW(),'{}','{}');
 INSERT INTO public.profiles(id,full_name,is_active) VALUES(${q(owner)},'مالك اختبار محلي وهمي',true);
 INSERT INTO public.roles(code,name_ar) VALUES('owner','المالك') ON CONFLICT(code) DO NOTHING;
 INSERT INTO public.user_roles(user_id,role_id) SELECT ${q(owner)},id FROM public.roles WHERE code='owner';
 INSERT INTO public.categories(code,name_ar) VALUES('DOC-EXAMPLE','قسم مثال');
 INSERT INTO public.units(code,name_ar) SELECT 'DOC-PACKET','باكيت' WHERE NOT EXISTS(SELECT 1 FROM public.units WHERE name_ar='باكيت');
 INSERT INTO public.units(code,name_ar) SELECT 'DOC-PARCEL','طرد' WHERE NOT EXISTS(SELECT 1 FROM public.units WHERE name_ar='طرد');`);
 const before=await readApplicationFingerprint(executor),rows=prepared.payload;
 const preview=await rpc(`import_go_live_products_v1('handover-document-preview-0000001',${json(rows)},true)`);
 assert.equal(preview.validCount,1);assert.deepEqual(preview.errors,[]);assert.deepEqual(await readApplicationFingerprint(executor),before,'PREVIEW_WRITES_NOTHING');
 const call=`import_go_live_products_v1('handover-document-import-0000001',${json(rows)},false)`;
 const saved=await rpc(call);assert.equal(saved.created.length,1);assert.equal(saved.idempotentReplay,false);
 const product=JSON.parse(await sql(`SELECT jsonb_build_object('sku',sku,'barcode',barcode,'name',name_ar,'purchaseSize',units_per_purchase_unit,'saleSize',units_per_sale_unit,'cost',cost_price_in_minor_units,'price',default_sale_price_in_minor_units,'parcelOnly',parcel_only,'stock',(SELECT COALESCE(sum(on_hand_quantity),0) FROM inventory_balances b WHERE b.product_id=p.id)) FROM products p WHERE sku='DOC-EXAMPLE-001';`));
 assert.deepEqual(product,{sku:'DOC-EXAMPLE-001',barcode:'0000000000000',name:'صنف وهمي — احذف المثال',purchaseSize:10,saleSize:10,cost:1000,price:15000,parcelOnly:false,stock:0});
 const after=await readApplicationFingerprint(executor),replay=await rpc(call);assert.equal(replay.idempotentReplay,true);assert.deepEqual(replay.created,saved.created);assert.deepEqual(await readApplicationFingerprint(executor),after,'REPLAY_WRITES_NOTHING');
 assert.equal(await sql('SELECT count(*) FROM orders;'),'0');assert.equal(await sql('SELECT count(*) FROM cash_shifts;'),'0');assert.equal(await sql('SELECT count(*) FROM inventory_movements;'),'0');
 Object.assign(report,{ok:true,actualXlsxDecoded:true,actualPrepareProducts:true,realSqlRpc:true,actor:'authenticated owner AAL2 fixture',previewErrors:0,previewZeroWrites:true,created:1,replayZeroWrites:true,productFieldsMatch:true,openingStock:0,orders:0,cashShifts:0,inventoryMovements:0});
}catch(error){report.error=error.message.slice(0,500);throw error;}
finally{if(local)await run(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true,maxBuffer:1024**2});report.endedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
