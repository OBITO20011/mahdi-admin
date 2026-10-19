import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseServices,serviceInventory} from '../scripts/audit/service-access-inventory.mjs';
import {assessSavedCatalog} from '../scripts/audit/service-access-report.mjs';

test('service AST inventories RPC,storage,channels and secret NAMES only with actual role',()=>{
 const fixture="const rpcName='submit_guest_customer_order_v2';supabase.rpc('get_home_dashboard');callRpc(url,key,rpcName,body,fetchImpl);supabase.storage.from('product-images').upload(path,file);supabase.channel('live');Deno.env.get('SUPABASE_URL');";
 const admin=parseServices('src/example.ts',fixture),guest=parseServices('customer-web/src/example.ts',fixture),
  edge=parseServices('supabase/functions/submit-guest-order/index.ts',fixture),ai=parseServices('supabase/functions/admin-ai-assistant/index.ts',fixture);
 assert.equal(admin.rpc[0].role,'authenticated');assert.equal(guest.rpc[0].role,'anon');
 assert.equal(edge.rpc[0].role,'service_role');assert.equal(ai.rpc[0].role,'authenticated');
 assert.equal(edge.wrapperCalls[0].resolutions?.[0].name,'submit_guest_customer_order_v2');
 assert.equal(admin.storage[0].operation,'upload');assert.equal(admin.channels.length,1);assert.equal(admin.env[0].name,'SUPABASE_URL');
 assert.deepEqual(parseServices('src/example.ts',fixture.replaceAll(';',';\r\n')).rpc.map((r:{name:string|null})=>r.name),admin.rpc.map((r:{name:string|null})=>r.name));
});

test('saved schema catalog cannot certify bucket row presence or realtime publication membership',()=>{
 const result=assessSavedCatalog({policies:[{schema:'storage',table:'objects',name:'Public can read product images'}],tables:[{schema:'storage',name:'buckets'}]});
 assert.equal(result.storagePolicies.length,1);assert.equal(result.storageBucketRows,null);assert.equal(result.publicationMembership,null);
});

test('all real source RPC sinks and gateway resolutions have real role-dispatch/EXECUTE evidence',async()=>{
 const source=await serviceInventory(),stored=JSON.parse(await readFile('docs/operations/SERVICE_ACCESS_INVENTORY.json','utf8')),
  evidence=JSON.parse(await readFile('docs/operations/SERVICE_ACCESS_DIAGNOSTIC.json','utf8'));
 assert.deepEqual(stored,source);assert.deepEqual(evidence.sourceHashes,source.sourceHashes);
 assert.equal(evidence.ok,true);assert.equal(evidence.migrationCeiling,199);assert.equal(evidence.managedAccess,false);
 const sites=[...source.rpc,...source.gatewayRpc.map((r:{file:string;line:number;name:string|null;role:string;resolutions:{name:string}[]})=>({...r,id:r.file+':'+r.line}))];
 for(const site of sites)for(const name of site.name?[site.name]:site.resolutions.map((r:{name:string})=>r.name)){
  const rows=evidence.results.filter((r:{site:string;name:string})=>r.site===site.id&&r.name===name);
  assert.ok(rows.length>0,`MISSING_DISPATCH:${site.id}/${name}`);
  assert.deepEqual([...new Set(rows.map((r:{appRole:string})=>r.appRole))].sort(),site.role==='authenticated'?['admin','cashier','owner']:[site.role]);
  for(const r of rows){assert.ok(evidence.execute.some((e:{identity:string;role:string})=>e.identity===r.identity&&e.role===r.role));assert.match(r.command,/^SELECT public\./u);}
 }
 assert.equal(evidence.sevenFunctions.length,7);
 for(const f of evidence.sevenFunctions){
  assert.equal(f.triggerOnly,f.sites.length===0,'Six trigger functions are not frontend RPC calls');
  if(f.sites.length){assert.equal(f.identity,'authorize_admin_ai_assistant_request()');assert.equal(f.sites[0].role,'authenticated');
   assert.equal(f.effectiveLocal.find((e:{role:string})=>e.role==='authenticated').allowed,true);}
 }
 assert.equal(evidence.savedCatalogAssessment.publicationMembership,null);
 assert.equal(evidence.savedCatalogAssessment.storageBucketRows,null);
 assert.ok(evidence.results.some((r:{outcome:string})=>r.outcome==='body_validation_or_error'),'Do not relabel neutral-payload validation failures as functional PASS');
});

test('RPC diagnostic always rolls back successful invocations and never records results or calls managed services',async()=>{
 const source=await readFile('scripts/audit/run-service-access-diagnostic.mjs','utf8');
 assert.match(source,/PROBE_SUCCEEDED_ROLLBACK/u);assert.match(source,/EXCEPTION WHEN OTHERS/u);assert.match(source,/ROLLBACK;/u);
 assert.match(source,/\[198,199\]\.includes\(migrationCeiling\)/u);
 assert.match(source,/NAWASRAH_MAX_MIGRATION:String\(migrationCeiling\)/u);assert.doesNotMatch(source,/supabase\.co|readFile\([^\n]*\.env/u);
 const report=await readFile('docs/operations/TABLE_ACCESS_INVENTORY.md','utf8');
 assert.match(report,/ما يجب إعداده يدوياً في فرانكفورت قبل staging/u);
 assert.match(report,/CSP_CONNECT_SRC/u);assert.match(report,/publication/u);
});
