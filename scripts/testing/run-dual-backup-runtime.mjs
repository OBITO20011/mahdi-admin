// Complete production archive+restore path, disposable literal214 database only.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {SnapshotSession} from '../backup/snapshot-session.mjs';
import {createCompleteBackup,restoreCompleteBackup} from '../backup/complete-backup.mjs';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..'),project='nawasrah-dual-backup-test',container='supabase_db_'+project;
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-dual-backup-proof-'));let local,report={ok:false,hostedConnectionsMade:false};
try{
  const boot=await exec(process.execPath,['scripts/testing/bootstrap-isolated-supabase.mjs'],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:{...process.env,NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'214',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});local=JSON.parse(boot.stdout).isolatedProjectRoot;
  const args=['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-q','-A','-t','-w','-v','ON_ERROR_STOP=1'];
  const s=new SnapshotSession('docker',args);
  try{
    await s.query('ALTER TABLE orders DISABLE TRIGGER trg_notify_new_website_order_push;SELECT cron.alter_job(jobid,active:=false) FROM cron.job;');
    await s.query(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
    const id=n=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
    const auth=sql=>`BEGIN;SELECT set_config('request.jwt.claims','{"sub":"${id(1)}","role":"authenticated","aal":"aal2"}',true);SET LOCAL ROLE authenticated;${sql}COMMIT;`;
    await s.query(auth(`SELECT public.set_go_live_main_branch_v1('${id(200)}');SELECT public.open_cash_shift('${id(200)}',10000);`));
    await s.query(auth(`SELECT public.create_direct_supplier_receipt_v2(p_supplier_id:='${id(301)}',p_branch_id:='${id(200)}',p_warehouse_id:='${id(201)}',p_idempotency_key:='dual-backup-receiving-00001',p_payment_method:='deferred',p_lines:='[{"client_line_id":"${id(990)}","line_kind":"base_unit","commercial_quantity":20,"base_unit_name":"باكيت","gross_amount_in_minor_units":10000,"line_discount_in_minor_units":0,"components":[{"product_id":"${id(103)}","base_quantity":20}]}]'::jsonb);`));
    await s.query(auth(`SELECT public.create_pos_sale_v2('${id(201)}','${id(200)}',NULL,'زبون نقدي','cash','[{"commercial_line_kind":"base_unit","product_id":"${id(103)}","base_quantity":2,"price_authority":"server_catalog","line_discount_in_minor_units":0}]'::jsonb,0,2000,'dual-backup-sale-00001');`));
    await s.query("INSERT INTO storage.buckets(id,name,public) VALUES('product-images','product-images',true) ON CONFLICT(id) DO UPDATE SET public=true;INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('product-images','test/photo.png','{\"size\":8}'::jsonb);");
  }finally{await s.close();}
  const bytes=Buffer.from('image123');
  const source={session:()=>new SnapshotSession('docker',args),readObject:async name=>{assert.equal(name,'test/photo.png');return bytes;},
    roles:async destination=>{await exec('docker',['exec',container,'pg_dumpall','-U','supabase_admin','--roles-only','--no-role-passwords','--no-tablespaces','-f','/tmp/roles.sql'],{windowsHide:true});await exec('docker',['cp',container+':/tmp/roles.sql',destination],{windowsHide:true});},
    dump:async(snapshot,destination)=>{await exec('docker',['exec',container,'pg_dump','-U','postgres','-d','postgres','-Fc','--snapshot='+snapshot,'-f','/tmp/complete.dump'],{windowsHide:true,timeout:600_000});await exec('docker',['cp',container+':/tmp/complete.dump',destination],{windowsHide:true});}};
  const passphrase='local-disposable-backup-fixture-only';
  const backup=await createCompleteBackup({projectRef:'kzevmysfydaslxcerogt',outputRoot:output,passphrase,source});
  const restored=await restoreCompleteBackup({archivePath:backup.archivePath,passphrase,reportPath:path.join(output,'restore.json')});
  assert.equal(restored.ok,true);assert.equal(restored.storageObjectsCompared,1);assert.ok(restored.tablesCompared>50);
  report={...restored,ok:true,fixtureOnly:true,archiveEncrypted:true,storageBytesRestored:true,nonzeroFinancialFixture:{receivedQuantity:20,soldQuantity:2,remainingQuantity:18,supplierDebt:10000,salesCash:2000,openingCash:10000}};
}catch(error){report.error=error.message;report.cause=error.cause?.message;process.exitCode=1;console.error(error);}
finally{
  if(local)await exec(process.execPath,['node_modules/supabase/dist/supabase.js','stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true});
  await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({ok:report.ok,output,...report}));
  // Local fixture archive only; never preserve an unencrypted extraction.
  for(const name of ['last-backup-status.json'])await rm(path.join(output,name),{force:true});
}
