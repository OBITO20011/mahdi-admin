// Owner-operated complete backup. No automatic entrypoint: callers must explicitly opt in.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,readdir,stat,rm,rename,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {SnapshotSession} from './snapshot-session.mjs';
import {assertApprovedBackupProject,assertBackupDatabaseProject} from './backup-public-config.mjs';
import {encryptFile} from './backup-crypto.mjs';
import {verifyBackupArchive} from './verify-backup.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {logicalRestoreDifferences,platformPostInitSql} from '../testing/backup-restore-contract.mjs';
import {sha256} from '../offsite-backup/offsite-core.mjs';
import {migrationManifest} from '../testing/maintenance-db-contract.mjs';
import {verifiedSupabaseCa} from './supabase-ca.mjs';
import {postgresDiagnostic,diagnosticError} from './postgres-diagnostic.mjs';

const exec=promisify(execFile);
const stripTransaction=sql=>sql.replace(/^BEGIN READ ONLY;/u,'').replace(/ROLLBACK;\s*$/u,'');
const qi=value=>'"'+String(value).replaceAll('"','""')+'"';
const tar=process.platform==='win32'?'tar.exe':'tar';
// Same reviewed image used by the pinned CLI bootstrap; no second older pull.
export const IMAGE='public.ecr.aws/supabase/postgres:17.6.1.158';
export const storageSql=`SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY name),'[]') FROM storage.objects o WHERE bucket_id='product-images';`;
export const rolesSql=`SELECT coalesce(jsonb_agg(jsonb_build_object('name',rolname,'super',rolsuper,'inherit',rolinherit,'createRole',rolcreaterole,'createDb',rolcreatedb,'login',rolcanlogin,'replication',rolreplication,'bypassRls',rolbypassrls,'limit',rolconnlimit,'until',rolvaliduntil,'config',rolconfig) ORDER BY rolname),'[]') FROM pg_roles;`;
export const membershipSql=`SELECT coalesce(jsonb_agg(jsonb_build_object('role',r.rolname,'member',m.rolname,'grantor',g.rolname,'admin',a.admin_option,'inherit',a.inherit_option,'set',a.set_option) ORDER BY r.rolname,m.rolname,g.rolname),'[]') FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles m ON m.oid=a.member JOIN pg_roles g ON g.oid=a.grantor;`;
export const historySql=`SELECT coalesce(jsonb_agg(version ORDER BY version),'[]') FROM supabase_migrations.schema_migrations;`;
export const sequencesSql=`SELECT coalesce(jsonb_agg(jsonb_build_object('schema',schemaname,'name',sequencename,'value',last_value) ORDER BY schemaname,sequencename),'[]') FROM pg_sequences WHERE schemaname NOT LIKE 'pg_%';`;
export function safeObjectName(name){
  assert.equal(typeof name,'string');assert.ok(name.length>0&&!name.includes('\\')&&!name.includes(':')&&!name.startsWith('/'));
  assert.ok(name.split('/').every(s=>s&&s!=='.'&&s!=='..'&&[...s].every(c=>c.charCodeAt(0)>=32)),'UNSAFE_STORAGE_NAME');return name;
}
async function files(root,dir=root){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){
  const full=path.join(dir,e.name);if(e.isDirectory())out.push(...await files(root,full));else{assert.ok(e.isFile());out.push({path:path.relative(root,full).replaceAll('\\','/'),size:(await stat(full)).size,sha256:await sha256(full)});}
}return out;}
const json=async(s,sql)=>JSON.parse((await s.query(sql)).trim());
export async function captureEvidence(session){
  const catalog=await json(session,stripTransaction(schemaCatalogSql));
  const tables={};
  // Same all-public-row/sequence oracle used by the accepted logical restore tests,
  // extended to Auth, Storage and actual migration history. Contains hashes, no raw rows.
  for(const table of catalog.tables.filter(t=>['public','auth','storage','supabase_migrations'].includes(t.schema)&&['r','p'].includes(t.kind))){
    const key=table.schema+'.'+table.name;
    tables[key]=await json(session,`SELECT jsonb_build_object('rows',count(*),'hash',md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''))) FROM ${qi(table.schema)}.${qi(table.name)} t;`);
  }
  return {catalog,tables,roles:await json(session,rolesSql),memberships:await json(session,membershipSql),history:await json(session,historySql),sequences:await json(session,sequencesSql),storage:await json(session,storageSql),preload:(await session.query('SHOW shared_preload_libraries;')).trim()};
}
export function assertRestoreEvidence(before,after){
  assert.equal(logicalRestoreDifferences(before.catalog,after.catalog).length,0,'RESTORE_CATALOG_ACL_OWNER_SETTINGS_DIFFER');
  for(const key of ['tables','roles','memberships','history','sequences','storage'])assert.deepEqual(after[key],before[key],'RESTORE_'+key.toUpperCase()+'_DIFFER');
  return {allRowsAndHashesMatch:true,allSequencesMatch:true,rolesAndMembershipsMatch:true,catalogAclOwnerSettingsMatch:true,historyMatch:true,storageMetadataMatch:true};
}
export function nativeSource({projectRef,connection,pgBin,password}){
  assertBackupDatabaseProject(connection,projectRef);
  const ca=verifiedSupabaseCa();
  const url=new URL(connection);url.searchParams.set('sslmode','verify-full');url.searchParams.set('sslrootcert',ca.path);url.searchParams.set('connect_timeout','15');
  const env={...process.env,PGPASSWORD:password,PGAPPNAME:'nawasrah-complete-backup',PGOPTIONS:'-c default_transaction_read_only=on -c statement_timeout=600000',LC_ALL:'C',LANG:'C',LANGUAGE:'C'};
  const bin=name=>path.join(pgBin,name+(process.platform==='win32'?'.exe':''));
  const run=async(tool,args,stage,timeout)=>{try{await exec(bin(tool),args,{env,windowsHide:true,timeout,maxBuffer:2**20});}
    catch(error){throw diagnosticError('NATIVE_BACKUP_TOOL_FAILED',postgresDiagnostic(error,{tool,stage}));}};
  return {session:()=>new SnapshotSession(bin('psql'),['-X','-q','-A','-t','-w','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','--dbname',url.href],env),
    dump:async(snapshot,destination)=>run('pg_dump',['-Fc','--no-password','--snapshot='+snapshot,'--file='+destination,url.href],'complete-dump',600_000),
    roles:async destination=>run('pg_dumpall',['--roles-only','--no-role-passwords','--no-tablespaces','--file='+destination,'--database='+url.href],'roles-dump',120_000),
    readObject:async name=>{const response=await fetch(`https://${projectRef}.supabase.co/storage/v1/object/public/product-images/${safeObjectName(name).split('/').map(encodeURIComponent).join('/')}`,{redirect:'error',signal:AbortSignal.timeout(60_000)});assert.equal(response.status,200,'STORAGE_DOWNLOAD_FAILED');return Buffer.from(await response.arrayBuffer());}};
}
export async function createCompleteBackup({projectRef,outputRoot,passphrase,retentionCount=30,source}){
  assertApprovedBackupProject(projectRef);assert.ok(passphrase?.length>=16);assert.ok(Number.isInteger(retentionCount)&&retentionCount>=2&&retentionCount<=365);
  assert.equal(path.basename(path.resolve(outputRoot)),'Frankfurt-'+projectRef,'BACKUP_ROOT_MUST_BE_PROJECT_ISOLATED');
  const createdAt=new Date().toISOString(),name='nawasrah-backup-'+createdAt.replaceAll(':','-').replace(/\.\d+Z$/u,'Z')+'.nwb';
  await mkdir(outputRoot,{recursive:true});const work=await mkdtemp(path.join(tmpdir(),'nawasrah-complete-'));
  const content=path.join(work,'contents');await mkdir(path.join(content,'database'),{recursive:true});
  let session,status,stage='snapshot',partial=path.join(outputRoot,name+'.partial');
  try{
    session=source.session();
    await session.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;');
    const snapshot=(await session.query('SELECT pg_export_snapshot();')).trim();assert.match(snapshot,/^[0-9A-F]+-[0-9A-F]+-[0-9]+$/u);
    stage='source-evidence';const before=await captureEvidence(session);assert.equal(before.history.at(-1),'214','COMPLETE_BACKUP_REQUIRES_REVIEWED_214');
    const expected=(await migrationManifest(path.resolve(import.meta.dirname,'../..'))).filter(m=>Number(m.name.slice(0,3))<=214).map(m=>m.name.slice(0,3));
    assert.equal(expected.length,176);assert.deepEqual(before.history,expected,'COMPLETE_BACKUP_HISTORY_HAS_GAPS_OR_UNREVIEWED_VERSION');
    // dump roles under a separate connection; concurrent role/DDL/Storage/sequence changes abort below.
    stage='roles-dump';await source.roles(path.join(content,'database','roles.sql'));
    stage='complete-dump';
    await source.dump(snapshot,path.join(content,'database','complete.dump'));
    stage='storage-download';const objects=[];
    for(const object of before.storage){const name=safeObjectName(object.name),bytes=await source.readObject(name);
      assert.equal(bytes.length,Number(object.metadata?.size),'STORAGE_SIZE_MISMATCH');
      const destination=path.join(content,'storage','product-images',...name.split('/'));await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,bytes);
      objects.push({name,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
    }
    await session.close();
    stage='consistency-postcheck';const fresh=source.session();try{await fresh.query('BEGIN READ ONLY;');
      assert.deepEqual(await json(fresh,storageSql),before.storage,'STORAGE_CHANGED_DURING_BACKUP_RETRY');
      assert.deepEqual(await json(fresh,rolesSql),before.roles,'ROLES_CHANGED_DURING_BACKUP_RETRY');
      assert.deepEqual(await json(fresh,membershipSql),before.memberships,'MEMBERSHIP_CHANGED_DURING_BACKUP_RETRY');
      assert.deepEqual(await json(fresh,sequencesSql),before.sequences,'SEQUENCES_CHANGED_DURING_BACKUP_RETRY');
      assert.deepEqual(await json(fresh,stripTransaction(schemaCatalogSql)),before.catalog,'DDL_CHANGED_DURING_BACKUP_RETRY');
    }finally{await fresh.close();}
    await writeFile(path.join(content,'database','source-evidence.json'),JSON.stringify(before)+'\n');
    const manifest={formatVersion:2,projectRef,createdAt,databaseFiles:['database/roles.sql','database/complete.dump','database/source-evidence.json'],storageBucket:'product-images',storageObjectCount:objects.length,storageObjects:objects,files:await files(content)};
    await writeFile(path.join(content,'manifest.json'),JSON.stringify(manifest)+'\n');
    stage='archive-encrypt-verify';const tarPath=path.join(work,'backup.tar');await exec(tar,['-cf',tarPath,'-C',content,'.'],{windowsHide:true});await encryptFile(tarPath,partial,passphrase);
    await verifyBackupArchive({archivePath:partial,passphrase});const archivePath=path.join(outputRoot,name);await rename(partial,archivePath);
    const prior=(await readdir(outputRoot)).filter(n=>/^nawasrah-backup-[0-9TZ-]+\.nwb$/u.test(n)).sort().reverse();
    for(const old of prior.slice(retentionCount))await rm(path.join(outputRoot,old));
    status={ok:true,projectRef,formatVersion:2,finishedAt:new Date().toISOString(),archiveName:name,archivePath,archiveBytes:(await stat(archivePath)).size,sha256:await sha256(archivePath),storageObjectCount:objects.length,historyCeiling:214,retentionCount};return status;
  }catch(cause){status={ok:false,projectRef,stage,finishedAt:new Date().toISOString(),error:'COMPLETE_BACKUP_FAILED_NO_SUCCESS_CLAIM',diagnostic:postgresDiagnostic(cause,{stage})};throw diagnosticError(status.error,status.diagnostic);}
  finally{await session?.close().catch(()=>{});await rm(partial,{force:true});await rm(work,{recursive:true,force:true});if(status)await writeFile(path.join(outputRoot,'last-backup-status.json'),JSON.stringify(status,null,2)+'\n');}
}

export async function restoreCompleteBackup({archivePath,passphrase,reportPath,readObjectAfterRestore}){
  const work=await mkdtemp(path.join(tmpdir(),'nawasrah-full-restore-')),content=path.join(work,'content');
  const container='nawasrah-full-restore-'+process.pid+'-'+randomBytes(4).toString('hex');let started=false,report;
  const docker=async args=>exec('docker',args,{windowsHide:true,timeout:600_000,maxBuffer:16*1024**2});
  const args=['exec','-i',container,'psql','-h','/tmp/socket','-p','25435','-U','supabase_admin','-d','postgres','-X','-q','-A','-t','-w','-v','ON_ERROR_STOP=1'];
  let session,stage='archive-verification';
  try{
    await verifyBackupArchive({archivePath,passphrase,extractTo:content});const manifest=JSON.parse(await readFile(path.join(content,'manifest.json'),'utf8'));
    assert.equal(manifest.formatVersion,2);assertApprovedBackupProject(manifest.projectRef);
    const before=JSON.parse(await readFile(path.join(content,'database','source-evidence.json'),'utf8'));assert.equal(before.history.at(-1),'214');
    assert.match(before.preload,/^[a-z_]+(?:,\s*[a-z_]+)*$/u);
    // No port, live volume or external network. No database URL is accepted by this API.
    stage='isolated-cluster-start';await docker(['run','--detach','--rm','--network','none','--name',container,'--entrypoint','sleep',IMAGE,'infinity']);started=true;
    await docker(['exec',container,'mkdir','-p','/restore','/tmp/socket']);await docker(['exec',container,'chown','postgres:postgres','/tmp/socket']);
    await docker(['cp',path.join(content,'database'),container+':/restore/database']);
    await docker(['cp',path.join(content,'storage'),container+':/restore/storage']);
    await docker(['exec','--user','postgres',container,'initdb','-D','/tmp/pgdata','-U','supabase_admin','--auth=trust']);
    await docker(['exec','--user','postgres',container,'pg_ctl','-D','/tmp/pgdata','-l','/tmp/restore.log','-o',`-p 25435 -k /tmp/socket -c listen_addresses='' -c shared_preload_libraries='${before.preload}' -c cron.database_name=postgres -c cron.launch_active_jobs=off -c wal_level=logical`,'-w','start']);
    session=new SnapshotSession('docker',args);
    stage='restore-roles';const roles=await readFile(path.join(content,'database','roles.sql'),'utf8');assert.equal((roles.match(/^CREATE ROLE supabase_admin;$/gmu)??[]).length,1);
    await session.query(roles.replace(/^CREATE ROLE supabase_admin;$/mu,'-- initdb bootstrap role; all ALTERs and memberships retained.'));
    await session.query('ALTER DATABASE postgres OWNER TO postgres;');
    stage='restore-complete-dump';await docker(['exec',container,'pg_restore','-h','/tmp/socket','-p','25435','-U','supabase_admin','-d','postgres','--exit-on-error','--no-password','/restore/database/complete.dump']);
    await session.query(platformPostInitSql(before.catalog));
    // Compare as the source postgres role, including hidden sequence values and privileges.
    stage='compare-data-catalog-acl';await session.query('SET ROLE postgres;BEGIN READ ONLY;');const after=await captureEvidence(session);const proof=assertRestoreEvidence(before,after);
    for(const object of manifest.storageObjects){
      const name=safeObjectName(object.name),file='/restore/storage/product-images/'+name;
      const {stdout}=await docker(['exec',container,'sha256sum','--',file]);assert.equal(stdout.slice(0,64),object.sha256,'RESTORED_STORAGE_BYTES_DIFFER');
      if(readObjectAfterRestore)assert.deepEqual(await readObjectAfterRestore(name),await readFile(path.join(content,'storage','product-images',...name.split('/'))));
    }
    stage='existing-integrity-checks';await session.query('ROLLBACK;RESET ROLE;BEGIN;');
    // Fresh existing "check" scanner ONLY on the network-isolated restored copy.
    // Roll it back: it must never mutate the backed-up source or become restored business data.
    await session.query('SELECT public.run_advanced_monitoring_checks();');
    const scan=await json(session,'SELECT public.get_advanced_monitoring_status();');
    await session.query('ROLLBACK;');
    const integrity=(scan?.checks??[]).filter(c=>c.key.startsWith('integrity:')).map(({key,status,issueCount})=>({key,status,issueCount}));
    assert.ok(integrity.length>5,'RESTORE_INTEGRITY_SCAN_MISSING');
    assert.ok(integrity.every(c=>c.status==='healthy'&&Number(c.issueCount)===0),'RESTORE_EXISTING_INTEGRITY_CHECK_FAILED');
    report={ok:true,projectRef:manifest.projectRef,mode:'isolated-complete-restore',postgresImage:IMAGE,completedAt:new Date().toISOString(),hostedConnectionsMade:false,network:'none',liveVolumesModified:false,historyCeiling:214,tablesCompared:Object.keys(before.tables).length,storageObjectsCompared:manifest.storageObjects.length,integrityChecks:integrity,...proof};return report;
  }catch(cause){report={ok:false,stage,mode:'isolated-complete-restore',completedAt:new Date().toISOString(),hostedConnectionsMade:false,error:'COMPLETE_RESTORE_FAILED',diagnostic:postgresDiagnostic(cause,{stage,tool:'docker'})};throw diagnosticError(report.error,report.diagnostic);}
  finally{await session?.close().catch(()=>{});if(started)await docker(['rm','--force',container]).catch(()=>{});await rm(work,{recursive:true,force:true});if(reportPath)await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');}
}
