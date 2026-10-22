// 210 full logical restore: inherited platform parity contract, no schema exclusions.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {executeInput} from '../operations/build-empty-supabase.mjs';
import {logicalRestoreDifferences,platformPostInitSql,readApplicationFingerprint} from './backup-restore-contract.mjs';
import {schemaCatalogSql,catalogDifference} from './schema-catalog.mjs';
const exec=promisify(execFile);
export async function receipt210Restore({container,executor,output,replay}){
 const sql=async text=>{const r=await executeInput(executor,text);assert.equal(r.code,0,r.stderr);return r.stdout.trim();};
 const restoreData='/tmp/receipt210-restore-pgdata',restoreSocket='/tmp/receipt210-restore-socket';let restoreClusterStarted=false;
 try{
  assert.equal(container,'supabase_db_nawasrah-receipt210-test');
  const restoreAdmin=await exec('docker',['exec',container,'psql','-U','supabase_admin','-d','postgres','-X','-q','-At','-w','-c',
    'SELECT rolsuper FROM pg_roles WHERE rolname=current_user;'],{windowsHide:true});
  assert.equal(restoreAdmin.stdout.trim(),'t','LOCAL_PLATFORM_RESTORE_ROLE_REQUIRED');
  const preload=await sql('SHOW shared_preload_libraries;');
  assert.match(preload,/^[a-z_]+(?:,\s*[a-z_]+)*$/u,'RESTORE_PRELOAD_NAMES');
  const catalogBeforeRestore=JSON.parse(await sql(schemaCatalogSql));
  assert.ok(catalogBeforeRestore.extensions.every(extension=>extension.owner==='supabase_admin'),'RESTORE_EXTENSION_OWNER_NOT_SUPPORTED');
  const sourceExecutor={command:'docker',args:['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-q','-At','-w','-v','ON_ERROR_STOP=1']};
  const applicationBeforeRestore=await readApplicationFingerprint(sourceExecutor);
  const restoredCount=await sql('SELECT count(*) FROM supplier_replacement_cases;');
  await exec('docker',['exec',container,'pg_dump','-U','postgres','-d','postgres','-Fc','-f','/tmp/rehearsal.dump'],
    {windowsHide:true,maxBuffer:16*1024*1024,timeout:300000});
  await exec('docker',['exec',container,'pg_dumpall','-U','supabase_admin','--roles-only','--no-role-passwords','-f','/tmp/receipt210-roles.sql'],
    {windowsHide:true,maxBuffer:16*1024*1024,timeout:300000});
  await exec('docker',['exec','--user','postgres',container,'sh','-c',
    `mkdir -p ${restoreSocket} && initdb -D ${restoreData} -U supabase_admin --auth=trust >/tmp/receipt210-init.log && pg_ctl -D ${restoreData} -l /tmp/receipt210-restore.log -o "-p 25435 -k ${restoreSocket} -c listen_addresses='' -c shared_preload_libraries='${preload}' -c cron.database_name=postgres -c wal_level=logical" -w start`],
    {windowsHide:true,maxBuffer:16*1024*1024,timeout:120000});
  restoreClusterStarted=true;
  const target=['-h',restoreSocket,'-p','25435','-d','postgres'];
  const globals=await exec('docker',['exec',container,'cat','/tmp/receipt210-roles.sql'],{windowsHide:true,maxBuffer:16*1024*1024});
  // The initial superuser must retain the source grantor identity. Only its
  // duplicate CREATE is omitted;its ALTER attributes and ALL grants still run.
  assert.equal((globals.stdout.match(/^CREATE ROLE supabase_admin;$/gmu)??[]).length,1,'ONE_BOOTSTRAP_ADMIN_DECLARATION');
  const globalsResult=await executeInput({command:'docker',args:['exec','-i',container,'psql','-U','supabase_admin',...target,'-X','-q','-w','-v','ON_ERROR_STOP=1']},
    globals.stdout.replace(/^CREATE ROLE supabase_admin;$/mu,'-- Already created identically by initdb;ALTER follows.'));
  assert.equal(globalsResult.code,0,globalsResult.stderr);
  await exec('docker',['exec',container,'psql','-U','supabase_admin',...target,'-X','-q','-w','-v','ON_ERROR_STOP=1','-c',
    'ALTER DATABASE postgres OWNER TO postgres;'],{windowsHide:true,maxBuffer:16*1024*1024,timeout:120000});
  // Standard pg_restore creates as the restoration administrator,then restores
  // each original OWNER/ACL. --no-owner is deliberately NOT used. Switching the
  // creation session to pgbouncer would require nonexistent pre-restore DB grants.
  await exec('docker',['exec',container,'pg_restore','-U','supabase_admin',...target,'--no-password','--exit-on-error','/tmp/rehearsal.dump'],
    {windowsHide:true,maxBuffer:16*1024*1024,timeout:300000});
  const restoredExecutor={command:'docker',args:['exec','-i',container,'psql','-U','postgres',...target,'-X','-q','-At','-w','-v','ON_ERROR_STOP=1']};
  const restoredSql=async input=>{
    const result=await executeInput(restoredExecutor,input);
    assert.equal(result.code,0,result.stderr);return result.stdout.trim();
  };
  const rawRestored=JSON.parse(await restoredSql(schemaCatalogSql));
  await writeFile(path.join(output,'raw-restore-differences.json'),JSON.stringify(catalogDifference(catalogBeforeRestore,rawRestored),null,2)+'\n');
  const postInit=await executeInput({command:'docker',args:['exec','-i',container,'psql','-U','supabase_admin',...target,'-X','-q','-At','-w','-v','ON_ERROR_STOP=1']},platformPostInitSql(catalogBeforeRestore));
  assert.equal(postInit.code,0,postInit.stderr);
  assert.equal(restoredCount,await restoredSql('SELECT count(*) FROM supplier_replacement_cases;'));
  const restoredCatalog=JSON.parse(await restoredSql(schemaCatalogSql));
  const differences=logicalRestoreDifferences(catalogBeforeRestore,restoredCatalog);
  await writeFile(path.join(output,'logical-restore-differences.json'),JSON.stringify(differences,null,2)+'\n');
  assert.equal(differences.length,0,'FULL_LOGICAL_RESTORE_CATALOG_MUST_MATCH:'+output);
  assert.deepEqual(await readApplicationFingerprint(restoredExecutor),applicationBeforeRestore,'ALL_PUBLIC_DATA_AND_SEQUENCE_POSITIONS_RESTORED');

  await replay(restoredExecutor);
  assert.deepEqual(await readApplicationFingerprint(restoredExecutor),applicationBeforeRestore,'RESTORE_REPLAY_ZERO_PUBLIC_ROWS_OR_SEQUENCES');
  return {logicalCatalogDifferences:0,allPublicDataAndSequencesIdentical:true,replayZeroWrites:true};
 }finally{if(restoreClusterStarted)await exec('docker',['exec','--user','postgres',container,'pg_ctl','-D',restoreData,'-m','fast','-w','stop'],{windowsHide:true,timeout:120000});}
}
