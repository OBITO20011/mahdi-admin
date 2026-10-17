import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {assertReference150} from '../scripts/operations/frankfurt-reference150.mjs';
import {generateAclPlan,alignmentTransaction,predecessor139} from '../scripts/operations/frankfurt-acl-plan.mjs';
import {run} from '../scripts/operations/frankfurt-align-acl.mjs';
import {buildReference150} from '../scripts/operations/build-acl-reference150.mjs';
import {inventoryBefore198Presentation as inventory} from '../scripts/audit/source-before198-presentation.mjs';
import {readTables150} from '../scripts/testing/table-read-privileges150-contract.mjs';
import {migrationManifest,manifestDigest,sha256,canonicalLf} from '../scripts/testing/maintenance-db-contract.mjs';
import {schemaCatalogSql} from '../scripts/testing/schema-catalog.mjs';
import {businessCronJobs,assessBuildCron} from '../scripts/operations/build-cron-report.mjs';
import {heldTrigger} from '../scripts/operations/frankfurt-notification-hold.mjs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));

test('150 reference admission rejects the old138 target,missing reads,stale evidence and tampered history',async()=>{
 // Frozen150 admission remains tested against its actual historical manifest,
 // not a future ceiling's metadata. The public CLI moves to151 separately.
 const manifest=(await migrationManifest(root)).filter(m=>Number(m.name.slice(0,3))<=150),source=await inventory();
 const proofText=await readFile('docs/operations/TABLE_ACCESS_AFTER_150.json','utf8'),proof=JSON.parse(proofText);
 const catalog={tables:readTables150.map(name=>({name,schema:'public',owner:'postgres',kind:'r',rls:true,
  acl:['postgres=arwdDxtm/postgres','authenticated=r/postgres',...(name==='orders'?['service_role=r/postgres']:[])]})),
  defaultPrivileges:[{schema:'public',role:'postgres',type:'r',acl:['postgres=arwdDxtm/postgres']}]};
 const reference={format:3,migrationCeiling:150,manifest,manifestDigest:manifestDigest(manifest),
  appliedVersions:manifest.map(m=>m.name.slice(0,3)),catalog,catalogSha256:sha256(JSON.stringify(catalog)),catalogQuerySha256:sha256(schemaCatalogSql),
  readiness:{sourceHashes:source.sources,accessEvidenceSha256:sha256(canonicalLf(proofText)),coverage:proof.coverage,queries:proof.results.length,errors:0},
  cronAudit:{requiresOwnerReview:false},notificationSnapshot:{trigger:{schema:'public',table:'orders',name:heldTrigger,enabled:'O',
   definition:`CREATE TRIGGER ${heldTrigger} AFTER INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION notify_new_website_order_push()`},
   jobs:businessCronJobs.map((j,i)=>({id:i+1,name:j.name,command:'SELECT '+j.calls+';',active:true}))}};
 assert.equal(assertReference150(reference,manifest,proofText,source),reference);
 const old={...reference,format:2,migrationCeiling:138};
 assert.throws(()=>assertReference150(old,manifest,proofText,source),/READY150_REFERENCE_REQUIRED/u);
 for(const alter of [
  (r:typeof reference)=>{r.appliedVersions.pop();},
  (r:typeof reference)=>{r.manifestDigest='stale';},
  (r:typeof reference)=>{r.readiness.sourceHashes=[];},
  (r:typeof reference)=>{r.catalog.tables[0]!.acl=['postgres=arwdDxtm/postgres'];r.catalogSha256=sha256(JSON.stringify(r.catalog));},
  (r:typeof reference)=>{r.catalog.tables[0]!.acl.push('anon=r/postgres');r.catalogSha256=sha256(JSON.stringify(r.catalog));},
  (r:typeof reference)=>{r.catalog.tables[0]!.rls=false;r.catalogSha256=sha256(JSON.stringify(r.catalog));},
  (r:typeof reference)=>{r.catalog.defaultPrivileges[0]!.acl.push('anon=r/postgres');r.catalogSha256=sha256(JSON.stringify(r.catalog));},
 ]){const changed=structuredClone(reference);alter(changed);assert.throws(()=>assertReference150(changed,manifest,proofText,source));}
});

test('offline139 prerequisite is exact and prevents transaction execution;other function/ACL/owner drift fails',async()=>{
 const text=canonicalLf(await readFile('docs/generated/DB_FUNCTIONS.md','utf8'));
 const historical=canonicalLf(await readFile('tests/fixtures/enqueue-order-push-before139.sql','utf8'));
 assert.equal(sha256(historical),predecessor139.definitionSha256);
 const current=text.match(/## enqueue_order_push_webhook\(p_payload jsonb\)[\s\S]*?```sql\n([\s\S]*?)\n```/u)?.[1];assert.ok(current);
 const latest={schema:'public',identity:predecessor139.identity,owner:'postgres',kind:'f',configuration:[],acl:['postgres=X/postgres'],definition:current};
 const before={...latest,definition:historical};
 const pending=generateAclPlan({functions:[latest]},{functions:[before]},{offlinePending139:true});
 assert.equal(pending.applicable,false);assert.equal(pending.prerequisites.length,1);
 assert.throws(()=>alignmentTransaction(pending),/PENDING_MIGRATION139_NO_ACL_TRANSACTION/u);
 assert.throws(()=>generateAclPlan({functions:[latest]},{functions:[before]}),/NON_ACL_APPLICATION_DRIFT/u);
 for(const altered of [{...before,definition:historical+' '},{...before,owner:'anon'},
  {...before,configuration:['search_path=public']},{...before,definition:current+' SELECT 99'}])
  assert.throws(()=>generateAclPlan({functions:[latest]},{functions:[altered]},{offlinePending139:true}));
 const sample=JSON.parse(await readFile('tests/fixtures/frankfurt-acl-samples.json','utf8'));
 const local={functions:[{schema:'public',identity:sample.function.identity,owner:'postgres',kind:'f',configuration:[],acl:['postgres=X/postgres'],definition:sample.function.localDefinition}]};
 const remote=structuredClone(local);remote.functions[0]!.acl.push('anon=X/postgres');
 const plan=generateAclPlan(local,remote,{offlinePending139:true});
 assert.equal(plan.applicable,true);assert.deepEqual(plan.prerequisites,[]);
 assert.ok(alignmentTransaction(plan).includes('REVOKE EXECUTE'));
 assert.throws(()=>alignmentTransaction({...plan,prerequisites:[{identity:predecessor139.identity}]}),/PENDING_MIGRATION139_NO_ACL_TRANSACTION/u);
 remote.functions[0]!.definition+=' SELECT 99';
 assert.throws(()=>generateAclPlan(local,remote,{offlinePending139:true}),/NON_ACL_APPLICATION_DRIFT/u);
 assert.ok(text.includes('order_push_webhook_url'));
});

test('owner apply is held before filesystem,network,password or transaction;139 cron audit has no old endpoint',async()=>{
 await assert.rejects(()=>run(['--apply']),/OWNER_HOLD_ALIGN_ACL_APPLY/u);
 const rows=businessCronJobs.map(j=>({name:j.name,command:'SELECT '+j.calls+';',schedule:'fixture',active:true}));
 const old=assessBuildCron(rows),current=assessBuildCron(rows,{migrationCeiling:150});
 assert.equal(old.orderInsertRisk.endpointProject,'acjtabdqqnpwhdvbvnyw');
 assert.equal(current.orderInsertRisk.endpointProject,null);assert.equal(current.orderInsertRisk.migration,'139');
 assert.equal(current.orderInsertRisk.endpointSetting,'Vault:order_push_webhook_url');
});

test('reference rebuild has a fixed disposable150 target and cannot write a historical reference or repository output',async()=>{
 await assert.rejects(()=>buildReference150(['--apply']),/ONLY_LOCAL_OUTPUT_OPTION_SUPPORTED/u);
 await assert.rejects(()=>buildReference150(['--output','local-reference.json']),/READY_REFERENCE_FILENAME_REQUIRED/u);
 await assert.rejects(()=>buildReference150(['--output',root+'/local-reference-001-139-150-ready.json']),/EXTERNAL_WORKDIR_REQUIRED/u);
 const source=await readFile('scripts/operations/build-acl-reference150.mjs','utf8');
 assert.match(source,/NAWASRAH_MAX_MIGRATION:'150'/u);assert.match(source,/flag:'wx'/u);
 assert.match(source,/functionReference\(executor,150\)/u);
 assert.doesNotMatch(source,/PGPASSWORD|SUPABASE_ACCESS_TOKEN|connectionFromLink|projects.*list|cliCall|readFile\([^\n]*\.env/u);
 const cli=await readFile('scripts/operations/frankfurt-align-acl.mjs','utf8');
 assert.ok(cli.indexOf("'catalog-comparison-before.json'")<cli.indexOf('const plan=generateAclPlan(reference.catalog,observed'));
});
