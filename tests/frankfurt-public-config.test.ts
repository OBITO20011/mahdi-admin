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
import {inventory} from '../scripts/audit/table-access-inventory.mjs';
import {verifyProbeCoverage} from '../scripts/audit/table-access-probes.mjs';
const url='https://kzevmysfydaslxcerogt.supabase.co',key='sb_publishable_d4TElxRQFkC-AZko3_ASeg_YotqxGjV';
test('both public defaults Frankfurt;historical evidence admits exactly two literals and nothing else',async()=>{
 const source=await inventory(),restored=await sourceBeforeStagingConfig(source.sources);
 for(const file of ['src/config/supabase-public-config.ts','customer-web/src/config/supabase-public-config.ts']){
  const text=await readFile(file,'utf8');assert.ok(text.includes(url));assert.ok(text.includes(key));
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

test('unmodified SEO generator uses Frankfurt config and public key for both RPCs;zero real network',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'nawasrah-seo-default-'));
 try{
  await mkdir(path.join(dir,'scripts'));await mkdir(path.join(dir,'src/config'),{recursive:true});await mkdir(path.join(dir,'dist'));
  await copyFile('customer-web/scripts/generate-seo-pages.mjs',path.join(dir,'scripts/generate-seo-pages.mjs'));
  await copyFile('customer-web/src/config/supabase-public-config.ts',path.join(dir,'src/config/supabase-public-config.ts'));
  await writeFile(path.join(dir,'dist/index.html'),'<html><head><title>shell</title></head><body></body></html>');
  const preload=path.join(dir,'guard.mjs'),calls=path.join(dir,'calls.json');
  await writeFile(preload,`import assert from 'node:assert/strict';import{writeFileSync}from'node:fs';
const calls=[];globalThis.fetch=async(target,init)=>{
 assert.ok(['${url}/rest/v1/rpc/get_public_storefront_catalog_page','${url}/rest/v1/rpc/get_public_storefront_offers'].includes(target),'NETWORK_BLOCKED:'+target);
 assert.equal(init.method,'POST');assert.equal(init.headers.apikey,'${key}');assert.equal(init.headers.Authorization,'Bearer ${key}');
 calls.push({target,body:JSON.parse(init.body)});writeFileSync(${JSON.stringify(calls)},JSON.stringify(calls));
 return new Response(JSON.stringify(target.endsWith('_offers')?[]:{items:[{id:'proof',sku:'proof',nameAr:'دليل',salePackagePriceInMinorUnits:1000,isAvailable:true}],categories:[],total:1}),{status:200});};`);
  const env={...process.env};delete env.NAWASRAH_SEO_AUDIT_API_URL;delete env.NAWASRAH_SEO_AUDIT_API_KEY;delete env.VITE_PUBLIC_SITE_ORIGIN;
  const run=()=>promisify(execFile)(process.execPath,['--import',pathToFileURL(preload).href,path.join(dir,'scripts/generate-seo-pages.mjs')],{cwd:dir,env,windowsHide:true});
  await run();const seen=JSON.parse(await readFile(calls,'utf8'));
  assert.deepEqual(seen.map((c:{target:string})=>c.target),[url+'/rest/v1/rpc/get_public_storefront_catalog_page',url+'/rest/v1/rpc/get_public_storefront_offers']);
  assert.deepEqual(seen[0].body,{p_limit:48,p_offset:0,p_category_id:null,p_search:null,p_availability:'available',p_sort:'recommended',p_brand_id:null,p_sale_unit_id:null,p_product_ids:null});
  assert.deepEqual(seen[1].body,{});assert.match(await readFile(path.join(dir,'dist/product/proof/index.html'),'utf8'),/https:\/\/alnawasreh\.com\/product\/proof\//u);
  const config=path.join(dir,'src/config/supabase-public-config.ts');await writeFile(config,(await readFile(config,'utf8')).replace(url,'https://wrong.invalid'));
  await assert.rejects(run,/NETWORK_BLOCKED/u,'negative control:old/wrong source cannot pass by using an audit override');
 }finally{await rm(dir,{recursive:true,force:true});}
});
