import {sourceBeforeEnvironments} from '../scripts/audit/source-before-environments.mjs';
import {resolveBuildEnvironment} from '../scripts/environments/environment.mjs';
import test from 'node:test';
import {restoreHomeDamage201SourceHashes} from '../scripts/audit/source-before-home-damage201.mjs';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {restoreStagingConfig,sourceBeforeStagingConfig} from '../scripts/audit/source-before-staging-config.mjs';
import {inventoryBeforeSales204 as inventory} from '../scripts/audit/source-before-sales-history204.mjs';
import {verifyProbeCoverage} from '../scripts/audit/table-access-probes.mjs';
const url='https://kzevmysfydaslxcerogt.supabase.co',key='sb_publishable_d4TElxRQFkC-AZko3_ASeg_YotqxGjV';
test('historical Frankfurt defaults remain exact through the environment inverse;no financial evidence is repinned',async()=>{
 const source=await inventory(),restored=await sourceBeforeStagingConfig(source.sources);
 for(const file of ['src/config/supabase-public-config.ts','customer-web/src/config/supabase-public-config.ts']){
  const text=sourceBeforeEnvironments(file,await readFile(file,'utf8'));assert.ok(text.includes(url));assert.ok(text.includes(key));
  const old=restoreStagingConfig(file,text);assert.ok(old.includes('https://acjtabdqqnpwhdvbvnyw.supabase.co'));
  for(const mutation of [text.replace(key,key+'x'),text.replace(url,url+'x'),text+'\n// unrelated drift'])assert.throws(()=>restoreStagingConfig(file,mutation));
  assert.notEqual(restored.find((s:{file:string;sha256:string})=>s.file===file)?.sha256,source.sources.find(s=>s.file===file)?.sha256);
 }
 const oldProof=JSON.parse(await readFile('docs/operations/TABLE_ACCESS_AFTER_198.json','utf8'));
 assert.deepEqual(restored,oldProof.sourceHashes);
 const current=JSON.parse(await readFile('docs/operations/TABLE_ACCESS_STAGING_198.json','utf8'));
 assert.equal(current.migrationCeiling,198);assert.equal(current.managedAccess,false);assert.equal(current.applicationReady,true);
 assert.deepEqual(current.sourceHashes,restoreHomeDamage201SourceHashes(source.sources));assert.deepEqual(verifyProbeCoverage(source,current.results),current.coverage);
 assert.ok(current.results.every((r:{sqlstate:string|null})=>r.sqlstate===null));
 const services=JSON.parse(await readFile('docs/operations/SERVICE_ACCESS_DIAGNOSTIC.json','utf8'));
 assert.deepEqual(services.oldReferences.filter((r:{category:string})=>['APP_FALLBACK','CSP_CONNECT_SRC'].includes(r.category)),[]);
});

for(const environment of ['production','staging'] as const)test('SEO uses the selected '+environment+' manifest for both RPCs;zero real network',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'nawasrah-seo-context-')),customer=path.join(dir,'customer-web'),selected=resolveBuildEnvironment({NAWASRAH_DEPLOYMENT_ENV:environment});
 try{
  await mkdir(path.join(customer,'scripts'),{recursive:true});await mkdir(path.join(customer,'dist'));await mkdir(path.join(dir,'scripts/environments'),{recursive:true});
  await copyFile('scripts/environments/environment.mjs',path.join(dir,'scripts/environments/environment.mjs'));
  await copyFile('customer-web/scripts/generate-seo-pages.mjs',path.join(customer,'scripts/generate-seo-pages.mjs'));
  const manifest=path.join(customer,'dist/nawasrah-environment.json');await writeFile(manifest,JSON.stringify(selected));
  await writeFile(path.join(customer,'dist/index.html'),'<html><head><title>shell</title></head><body></body></html>');
  const preload=path.join(dir,'guard.mjs'),calls=path.join(dir,'calls.json');
  await writeFile(preload,`import assert from 'node:assert/strict';import{writeFileSync}from'node:fs';
const calls=[];globalThis.fetch=async(target,init)=>{
 assert.ok(['${selected.url}/rest/v1/rpc/get_public_storefront_catalog_page','${selected.url}/rest/v1/rpc/get_public_storefront_offers'].includes(target),'NETWORK_BLOCKED:'+target);
 assert.equal(init.method,'POST');assert.equal(init.headers.apikey,'${selected.key}');assert.equal(init.headers.Authorization,'Bearer ${selected.key}');
 calls.push({target,body:JSON.parse(init.body)});writeFileSync(${JSON.stringify(calls)},JSON.stringify(calls));
 return new Response(JSON.stringify(target.endsWith('_offers')?[]:{items:[{id:'proof',sku:'proof',nameAr:'دليل',salePackagePriceInMinorUnits:1000,isAvailable:true}],categories:[],total:1}),{status:200});};`);
  const env={...process.env};delete env.NAWASRAH_SEO_AUDIT_API_URL;delete env.NAWASRAH_SEO_AUDIT_API_KEY;
  const run=()=>promisify(execFile)(process.execPath,['--import',pathToFileURL(preload).href,path.join(customer,'scripts/generate-seo-pages.mjs')],{cwd:customer,env,windowsHide:true});
  await run();const seen=JSON.parse(await readFile(calls,'utf8'));
  assert.deepEqual(seen.map((c:{target:string})=>c.target),[selected.url+'/rest/v1/rpc/get_public_storefront_catalog_page',selected.url+'/rest/v1/rpc/get_public_storefront_offers']);
  assert.deepEqual(seen[0].body,{p_limit:48,p_offset:0,p_category_id:null,p_search:null,p_availability:'available',p_sort:'recommended',p_brand_id:null,p_sale_unit_id:null,p_product_ids:null});
  assert.deepEqual(seen[1].body,{});assert.ok((await readFile(path.join(customer,'dist/product/proof/index.html'),'utf8')).includes(selected.storeOrigin+'/product/proof/'));
  await writeFile(manifest,JSON.stringify({...selected,url:'https://wrong.invalid'}));
  await assert.rejects(run,/BUILD_MANIFEST_MISMATCH/u,'unknown context cannot fetch an arbitrary API');
 }finally{await rm(dir,{recursive:true,force:true});}
});
