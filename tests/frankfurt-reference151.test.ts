import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {assertReference151} from '../scripts/operations/frankfurt-reference151.mjs';
import {assertUpgradeHistory,upgradeVersions,upgradeLockKey} from '../scripts/operations/frankfurt-owner-upgrade.mjs';
import {buildReference151} from '../scripts/operations/build-acl-reference151.mjs';
import {inventory} from '../scripts/audit/table-access-inventory.mjs';
import {readTables150} from '../scripts/testing/table-read-privileges150-contract.mjs';
import {realtimePublicationSql,realtime151Tables} from '../scripts/testing/realtime151-contract.mjs';
import {businessCronJobs} from '../scripts/operations/build-cron-report.mjs';
import {heldTrigger} from '../scripts/operations/frankfurt-notification-hold.mjs';
import {schemaCatalogSql} from '../scripts/testing/schema-catalog.mjs';
import {sha256,manifestDigest,migrationManifest,canonicalLf} from '../scripts/testing/maintenance-db-contract.mjs';
import {forecast150} from '../scripts/operations/forecast-grants150.mjs';
import {aclEntries} from '../scripts/operations/managed-catalog-policy.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
test('151 admission rejects138/150,unproved membership,stale manifests and permission drift',async()=>{
 const manifest=await migrationManifest(root),source=await inventory();
 const proofText=await readFile('docs/operations/TABLE_ACCESS_AFTER_150.json','utf8'),proof=JSON.parse(proofText);
 const catalog={tables:readTables150.map(name=>({name,schema:'public',owner:'postgres',kind:'r',rls:true,columns:[{name:'id',generated:''},{name:'computed_fixture',generated:'s'}],
  acl:['postgres=arwdDxtm/postgres','authenticated=r/postgres',...(name==='orders'?['service_role=r/postgres']:[])]})),
  defaultPrivileges:[{schema:'public',role:'postgres',type:'r',acl:['postgres=arwdDxtm/postgres']}]};
 const realtimePublication={publication:{name:'supabase_realtime',owner:'postgres',allTables:false,insert:true,update:true,delete:true,truncate:true,viaRoot:false},
  tables:realtime151Tables.map(name=>({schema:'public',name,columns:['id'],filter:null}))};
 const reference={format:4,migrationCeiling:151,manifest,manifestDigest:manifestDigest(manifest),appliedVersions:manifest.map(m=>m.name.slice(0,3)),
  catalog,catalogSha256:sha256(JSON.stringify(catalog)),catalogQuerySha256:sha256(schemaCatalogSql),realtimePublication,
  realtimeQuerySha256:sha256(realtimePublicationSql),realtimeSha256:sha256(JSON.stringify(realtimePublication)),
  readiness:{sourceHashes:source.sources,accessEvidenceSha256:sha256(canonicalLf(proofText)),coverage:proof.coverage,queries:proof.results.length,errors:0},
  cronAudit:{requiresOwnerReview:false},notificationSnapshot:{trigger:{schema:'public',table:'orders',name:heldTrigger,enabled:'O',
   definition:`CREATE TRIGGER ${heldTrigger} AFTER INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION notify_new_website_order_push()`},
   jobs:businessCronJobs.map((j,i)=>({id:i+1,name:j.name,command:'SELECT '+j.calls+';',active:true}))}};
 assert.equal(assertReference151(reference,manifest,proofText,source),reference);
 for(const ceiling of [138,150])assert.throws(()=>assertReference151({...reference,migrationCeiling:ceiling},manifest,proofText,source),/READY151_REFERENCE_REQUIRED/u);
 for(const alter of [
  (r:typeof reference)=>{r.appliedVersions.pop();},
  (r:typeof reference)=>{r.realtimeQuerySha256='stale';},
  (r:typeof reference)=>{r.realtimePublication.tables.pop();r.realtimeSha256=sha256(JSON.stringify(r.realtimePublication));},
  (r:typeof reference)=>{r.realtimePublication.tables[0]!.columns=[];r.realtimeSha256=sha256(JSON.stringify(r.realtimePublication));},
  (r:typeof reference)=>{r.realtimePublication.tables[0]!.columns.push('computed_fixture');r.realtimeSha256=sha256(JSON.stringify(r.realtimePublication));},
  (r:typeof reference)=>{r.realtimePublication.publication.allTables=true;r.realtimeSha256=sha256(JSON.stringify(r.realtimePublication));},
  (r:typeof reference)=>{r.catalog.tables[0]!.acl.push('anon=r/postgres');r.catalogSha256=sha256(JSON.stringify(r.catalog));},
 ]){const changed=structuredClone(reference);alter(changed);assert.throws(()=>assertReference151(changed,manifest,proofText,source));}
});
test('offline150 forecast removes only the approved atoms;existing grants and service_role survive',()=>{
 const before={tables:readTables150.map(name=>({name,schema:'public',owner:'postgres',kind:'r',rls:true,
  acl:['postgres=arwdDxtm/postgres','authenticated=Dxtm/postgres','anon=rDxtm/postgres','service_role=arwdDxtm/postgres']})),
  defaultPrivileges:[{schema:'public',role:'postgres',type:'r',acl:['postgres=arwdDxtm/postgres','authenticated=arwdDxtm/postgres','anon=arwdDxtm/postgres','service_role=arwdDxtm/postgres']}],
  functions:[{schema:'public',identity:'fixture()',definition:'SELECT 1',owner:'postgres',acl:['postgres=X/postgres']} ]};
 const after=forecast150(before);
 assert.deepEqual(after.functions,before.functions);
 assert.deepEqual(before.tables[0]!.acl,['postgres=arwdDxtm/postgres','authenticated=Dxtm/postgres','anon=rDxtm/postgres','service_role=arwdDxtm/postgres']);
 for(const table of after.tables){
  const atoms=aclEntries(table.acl,table,'tables');
  assert.ok(atoms.some(a=>a.grantee==='anon'&&a.privilege==='SELECT'),'150 does not replace the later ACL alignment');
  assert.ok(atoms.some(a=>a.grantee==='authenticated'&&a.privilege==='SELECT'));
  assert.ok(!atoms.some(a=>['anon','authenticated'].includes(a.grantee)&&['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'].includes(a.privilege)));
  assert.deepEqual(atoms.filter(a=>a.grantee==='service_role'),aclEntries(before.tables[0]!.acl,before.tables[0],'tables').filter(a=>a.grantee==='service_role'));
 }
 assert.ok(!aclEntries(after.defaultPrivileges[0]!.acl,after.defaultPrivileges[0],'defaultPrivileges').some(a=>['anon','authenticated'].includes(a.grantee)));
});
test('upgrade history accepts only the approved prefix;no reserved branch or replay writes',()=>{
 assert.notEqual(upgradeLockKey,734034138,'outer guard cannot deadlock the separate ACL transaction');
 const base=Array.from({length:138},(_,i)=>String(i+1).padStart(3,'0'));
 for(let n=0;n<=3;n++)assert.deepEqual(assertUpgradeHistory([...base,...upgradeVersions.slice(0,n)]),upgradeVersions.slice(n));
 for(const history of [[...base,'150'],[...base,'139','140'],[...base,'139','150','151','152'],base.slice(1)])
  assert.throws(()=>assertUpgradeHistory(history));
});
test('151 builders and owner command fail closed on old references and never use implicit host overrides',async()=>{
 await assert.rejects(()=>buildReference151(['--apply']),/ONLY_LOCAL_OUTPUT_OPTION_SUPPORTED/u);
 await assert.rejects(()=>buildReference151(['--output','local-reference.json']),/READY151_FILENAME_REQUIRED/u);
 const source=await readFile('scripts/operations/frankfurt-owner-upgrade.mjs','utf8');
 assert.match(source,/upgradeVersions=Object.freeze\(\['139','150','151'\]\)/u);
 assert.match(source,/migration','repair','--linked','--status','applied'/u);
 assert.match(source,/WORKDIR138_BYTES_CHANGED/u);assert.match(source,/UNREVIEWED_WORKDIR_MIGRATION/u);
 assert.doesNotMatch(source,/\['link'|ALTER.*TRIGGER|cron\.alter_job|vault\.create_secret|functions','deploy/u);
 const verify=await readFile('scripts/operations/frankfurt-catalog-verification.mjs','utf8');
 assert.ok(verify.indexOf("'realtime-comparison.json'")<verify.indexOf("'REALTIME_PUBLICATION_MISMATCH'"));
});
