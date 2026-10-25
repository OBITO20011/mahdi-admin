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
  report={...restored,ok:true,fixtureOnly:true,archiveEncrypted:true,storageBytesRestored:true};
}catch(error){report.error=error.message;report.cause=error.cause?.message;process.exitCode=1;console.error(error);}
finally{
  if(local)await exec(process.execPath,['node_modules/supabase/dist/supabase.js','stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true});
  await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({ok:report.ok,output,...report}));
  // Local fixture archive only; never preserve an unencrypted extraction.
  for(const name of ['last-backup-status.json'])await rm(path.join(output,name),{force:true});
}
