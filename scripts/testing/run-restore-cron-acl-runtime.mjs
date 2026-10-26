// Two disposable databases,no source archive/credential/project is accepted.
// A source-only extension installation script simulates managed initial grants.
// No pg_init_privs UPDATE or comparison exception is used.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes,createHash} from 'node:crypto';
import {mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {IMAGE,rolesSql,assertRestoreEvidence} from '../backup/complete-backup.mjs';
import {schemaCatalogSql} from './schema-catalog.mjs';
import {logicalRestoreDifferences} from './backup-restore-contract.mjs';
import {partitionRestoreToc,prepareRestoreExtensions} from '../backup/restore-platform.mjs';
import {cronSequenceAclSql,restoreCronSequenceAcl} from '../backup/restore-cron-acl.mjs';
import {aclEntries} from '../operations/managed-catalog-policy.mjs';
const exec=promisify(execFile),name='nawasrah-cron-acl-'+randomBytes(4).toString('hex');
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-cron-acl-proof-'));
const docker=args=>exec('docker',args,{windowsHide:true,timeout:180000,maxBuffer:8*1024**2});
const sql=async(db,text)=>(await docker(['exec',name,'psql','-h','/tmp/socket','-p','25435','-U','supabase_admin','-d',db,'-X','-q','-At','-v','ON_ERROR_STOP=1','-c',text])).stdout.trim();
const json=async(db,text)=>JSON.parse(await sql(db,text));
const initSql=`SELECT jsonb_agg(jsonb_build_object('name',c.relname,'acl',c.relacl,
 'initprivs',p.initprivs,'privtype',p.privtype,'member',e.extname) ORDER BY c.relname)
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 LEFT JOIN pg_init_privs p ON p.classoid='pg_class'::regclass AND p.objoid=c.oid AND p.objsubid=0
 LEFT JOIN pg_depend d ON d.classid='pg_class'::regclass AND d.objid=c.oid AND d.refclassid='pg_extension'::regclass AND d.deptype='e'
 LEFT JOIN pg_extension e ON e.oid=d.refobjid WHERE n.nspname='cron' AND c.relname IN ('jobid_seq','runid_seq');`;
const dataSql=`SELECT jsonb_build_object('rows',count(*),'hash',md5(string_agg(id::text,',' ORDER BY id))) FROM public.restore_fixture_item;`;
const evidence=async db=>({catalog:await json(db,schemaCatalogSql),tables:{'public.restore_fixture_item':await json(db,dataSql)},roles:await json(db,rolesSql),memberships:[],history:[],sequences:[],storage:[]});
let started=false,step='setup';
try{
 await docker(['run','--detach','--rm','--network','none','--name',name,'--entrypoint','sleep',IMAGE,'infinity']);started=true;
 await docker(['exec',name,'mkdir','-p','/tmp/socket']);await docker(['exec',name,'chown','postgres:postgres','/tmp/socket']);
 await docker(['exec','--user','postgres',name,'initdb','-D','/tmp/pgdata','-U','supabase_admin','--auth=trust']);
 await docker(['exec','--user','postgres',name,'pg_ctl','-D','/tmp/pgdata','-l','/tmp/probe.log','-o',"-p 25435 -k /tmp/socket -c listen_addresses='' -c shared_preload_libraries=pg_cron -c cron.database_name=postgres -c cron.launch_active_jobs=off",'-w','start']);
 // pg_cron permits contrib_regression as a second installation test database.
 await sql('postgres','CREATE DATABASE contrib_regression;');await sql('postgres','CREATE ROLE postgres;CREATE ROLE service_role;');
 const shared=(await docker(['exec',name,'pg_config','--sharedir'])).stdout.trim();
 const script=(await docker(['exec',name,'readlink','-f',shared+'/extension/pg_cron--1.5.2--1.6.4.sql'])).stdout.trim();
 const original=(await docker(['exec',name,'cat',script])).stdout;
 const file=path.join(output,'source-install.sql');
 const install=async initial=>{
  await writeFile(file,original+(initial?'\nGRANT ALL ON SEQUENCE cron.jobid_seq,cron.runid_seq TO postgres,service_role;\n':''));
  await docker(['cp',file,name+':'+script]);
 };
 step='source-initial-extension-grants';
 try{await install(true);await sql('postgres',"CREATE EXTENSION pg_cron WITH SCHEMA pg_catalog VERSION '1.6.4';");}
 finally{await install(false);}
 assert.equal(createHash('sha256').update((await docker(['exec',name,'cat',script])).stdout).digest('hex'),createHash('sha256').update(original).digest('hex'));
 // These final ACLs differ from the source init privileges,so dump ACL deltas
 // are tested as well as completely omitted initial grants.
 await sql('postgres','REVOKE USAGE ON SEQUENCE cron.runid_seq FROM service_role;GRANT USAGE ON SEQUENCE cron.jobid_seq TO postgres WITH GRANT OPTION;CREATE TABLE public.restore_fixture_item(id integer PRIMARY KEY);INSERT INTO public.restore_fixture_item VALUES(1),(2);CREATE SEQUENCE cron.other_seq;CREATE SEQUENCE public.other_seq;');
 const before=await evidence('postgres'),sourceInit=await json('postgres',initSql);
 assert.ok(sourceInit.every(r=>r.member==='pg_cron'&&r.privtype==='e'&&r.initprivs.some(p=>p.startsWith('postgres='))&&r.initprivs.some(p=>p.startsWith('service_role='))));
 assert.equal(before.catalog.extensions.find(e=>e.name==='pg_cron').version,'1.6.4');
 assert.equal(before.catalog.extensions.find(e=>e.name==='pg_cron').owner,'supabase_admin');
 await docker(['exec',name,'pg_dump','-h','/tmp/socket','-p','25435','-U','supabase_admin','-d','postgres','-Fc','--file=/tmp/source.dump']);
 const toc=(await docker(['exec',name,'pg_restore','--list','/tmp/source.dump'])).stdout,partition=partitionRestoreToc(toc);
 await writeFile(path.join(output,'schemas.list'),partition.schemas);await writeFile(path.join(output,'remaining.list'),partition.remainder);
 for(const part of ['schemas','remaining'])await docker(['cp',path.join(output,part+'.list'),name+':/tmp/'+part+'.list']);
 const restore=async part=>docker(['exec',name,'pg_restore','--use-list=/tmp/'+part+'.list','-h','/tmp/socket','-p','25435','-U','supabase_admin','-d','contrib_regression','--exit-on-error','/tmp/source.dump']);
 step='normal-restore-before-fix';await restore('schemas');
 const session={query:text=>sql('contrib_regression',text)};
 const available=await json('contrib_regression',"SELECT jsonb_agg(jsonb_build_object('name',name,'version',version)) FROM pg_available_extension_versions;");
 await prepareRestoreExtensions(session,before,available,partition.extensions);
 const targetInit=await json('contrib_regression',initSql);assert.ok(targetInit.every(r=>r.initprivs===null));
 await restore('remaining');const broken=await evidence('contrib_regression');
 const differences=logicalRestoreDifferences(before.catalog,broken.catalog);
 assert.equal(differences.length,2);
 for(const diff of differences){assert.equal(diff.section,'tables');assert.equal(diff.before.schema,'cron');assert.ok(['jobid_seq','runid_seq'].includes(diff.before.name));assert.deepEqual(Object.keys(diff.before).filter(k=>JSON.stringify(diff.before[k])!==JSON.stringify(diff.after[k])),['acl']);}
 assert.throws(()=>assertRestoreEvidence(before,broken),error=>error.diagnostic.comparisonCode==='RESTORE_CATALOG_ACL_OWNER_SETTINGS_DIFFER');
 // A session must persist across BEGIN/SET LOCAL ROLE/postcondition/COMMIT.
 const {SnapshotSession}=await import('../backup/snapshot-session.mjs');
 const persistent=new SnapshotSession('docker',['exec','-i',name,'psql','-h','/tmp/socket','-p','25435','-U','supabase_admin','-d','contrib_regression','-X','-q','-At','-v','ON_ERROR_STOP=1']);
 let proof;
 try{
  step='exact-final-acl-replay';proof=await restoreCronSequenceAcl(persistent,before);assert.equal(proof.reconciled.length,2);assert.deepEqual(proof.exceptionsApplied,[]);
  const after=await evidence('contrib_regression');assert.equal(assertRestoreEvidence(before,after).catalogAclOwnerSettingsMatch,true);
  const replay=await restoreCronSequenceAcl(persistent,before);assert.equal(replay.reconciled.length,0);
  const initAfter=await json('contrib_regression',initSql);assert.deepEqual(initAfter.map(r=>r.initprivs),targetInit.map(r=>r.initprivs),'INIT_PRIVS_MUST_NOT_BE_UPDATED');
  // Every captured role's effective sequence privileges+grant options now match.
  const rows=await json('contrib_regression',cronSequenceAclSql);
  for(const row of rows)assert.deepEqual(aclEntries(row.acl,row,'tables'),aclEntries(before.catalog.tables.find(t=>t.schema==='cron'&&t.name===row.name).acl,row,'tables'));
  step='unrelated-acl-negatives';
  for(const object of ['TABLE public.restore_fixture_item','SEQUENCE public.other_seq','SEQUENCE cron.other_seq']){
   await sql('contrib_regression',`GRANT SELECT ON ${object} TO service_role;`);
   assert.equal((await restoreCronSequenceAcl(persistent,before)).reconciled.length,0);
   const changed=await evidence('contrib_regression');assert.throws(()=>assertRestoreEvidence(before,changed),error=>error.diagnostic.comparisonCode==='RESTORE_CATALOG_ACL_OWNER_SETTINGS_DIFFER');
   await sql('contrib_regression',`REVOKE SELECT ON ${object} FROM service_role;`);assertRestoreEvidence(before,await evidence('contrib_regression'));
  }
  step='membership-preflight-negative';await sql('contrib_regression','REVOKE USAGE ON SEQUENCE cron.jobid_seq FROM postgres;ALTER EXTENSION pg_cron DROP SEQUENCE cron.runid_seq;');
  const aclsBefore=await json('contrib_regression',cronSequenceAclSql);
  await assert.rejects(restoreCronSequenceAcl(persistent,before),error=>error.diagnostic.category==='RESTORE_CRON_SEQUENCE_ACL_UNSUPPORTED');
  assert.deepEqual(await json('contrib_regression',cronSequenceAclSql),aclsBefore);
 }finally{await persistent.close();}
 const report={ok:true,network:'none',hostedConnectionsMade:false,sourceExtension:{name:'pg_cron',version:'1.6.4',owner:'supabase_admin'},
  syntheticSourceInstallationOnly:true,imageScriptRestored:true,sourceInitialGrantsRecorded:true,targetInitialPrivilegesDiffer:true,
  reproducedOnlyTwoSequenceAclDifferences:true,dumpExitOnError:true,finalCapturedAclReplayed:proof,strictFullCatalogAndDataMatch:true,
  pgInitPrivsNotModified:true,replayNoop:true,unrelatedAclDifferencesRejected:['public.restore_fixture_item','public.other_seq','cron.other_seq'],
  missingExtensionMembershipRejectedBeforeWrite:true,exceptionsApplied:[],containerRemoved:true,output};
 await writeFile(path.join(output,'proof.json'),JSON.stringify(report,null,2)+'\n');await writeFile(path.join(tmpdir(),'restore-cron-acl-proof-pointer.txt'),output);console.log(JSON.stringify(report));
}catch(error){console.error(JSON.stringify({ok:false,step,errorClass:error.code==='ERR_ASSERTION'?'ASSERTION_FAILED':'TOOL_FAILED',operator:error.operator,line:error.stack?.match(/run-restore-cron-acl-runtime\.mjs:(\d+):/u)?.[1]}));process.exitCode=1;}
finally{if(started)await docker(['rm','--force',name]);}
