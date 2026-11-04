import{historicalProductWorkbookHashes}from'../scripts/audit/source-before-product-workbook.mjs';
import{historicalProductWorkbookSource,restoreProductWorkbookHashes}from'../scripts/audit/source-before-product-workbook.mjs';
import {historicalMobileBackRpcSite} from '../scripts/audit/source-before-mobile-back.mjs';
import {parseServices} from '../scripts/audit/service-access-inventory.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {sourceBeforeStoreScroll,restoreStoreScrollHashes} from '../scripts/audit/source-before-store-scroll.mjs';
import {inventory} from '../scripts/audit/table-access-inventory.mjs';import {serviceInventory} from '../scripts/audit/service-access-inventory.mjs';import {compareManagedCatalog} from '../scripts/operations/managed-catalog-policy.mjs';
const lf=(s:string)=>s.replaceAll('\r\n','\n'),hash=(s:string)=>createHash('sha256').update(s).digest('hex');
test('scroll fallback exact view binds actual main bytes and refuses any unknown source mutation',()=>{
 const pins=JSON.parse(readFileSync('scripts/audit/store-scroll-source-pins.json','utf8'));assert.equal(pins.baseline,'fceb062ecb42636f9edcc69d536278a5bad93785');
 for(const[file,pin]of Object.entries(pins.entries)as[string,{after:string;before:string|null;beforeText:string|null}][]){
  const current=lf(readFileSync(file,'utf8'));assert.equal(hash(current),pin.after,file);assert.equal(historicalProductWorkbookSource(sourceBeforeStoreScroll,file,current),pin.beforeText,file);
  if(pin.beforeText!==null){assert.equal(hash(pin.beforeText),pin.before);assert.equal(lf(execFileSync('git',['show',pins.baseline+':'+file],{encoding:'utf8',maxBuffer:32*1024**2})),pin.beforeText,file);}
  assert.equal(historicalProductWorkbookSource(sourceBeforeStoreScroll,file,current+'\nunknown-scroll\n'),current+'\nunknown-scroll\n',file);
 }
 assert.deepEqual(historicalProductWorkbookHashes(restoreStoreScrollHashes,restoreProductWorkbookHashes([{file:'unknown',sha256:'unapproved'}])),[{file:'unknown',sha256:'unapproved'}]);
});
test('current219 actual SDK/services use real changed sources, preserve the catalog and retain all role checks',async()=>{
 const current=JSON.parse(readFileSync('docs/operations/TABLE_ACCESS_AFTER_219.json','utf8'));
 const previous=JSON.parse(execFileSync('git',['show','fceb062:docs/operations/TABLE_ACCESS_AFTER_219.json'],{encoding:'utf8',maxBuffer:32*1024**2}));
 assert.deepEqual(current.sourceHashes,(await inventory()).sources);assert.equal(current.applicationReady,true);assert.equal(current.infrastructureOk,true);assert.equal(current.results.length,181);assert.ok(current.results.every((r:{sqlstate:null})=>r.sqlstate===null));
 const comparison=compareManagedCatalog(previous.catalog,current.catalog,{beforeBuildDate:previous.startedAt.slice(0,10),afterBuildDate:current.startedAt.slice(0,10)});assert.deepEqual(comparison.unexpected,[]);assert.deepEqual(comparison.expected,[]);
 const services=JSON.parse(readFileSync('docs/operations/SERVICE_ACCESS_DIAGNOSTIC.json','utf8'));assert.equal(services.ok,true);assert.deepEqual(services.sourceHashes,(await serviceInventory()).sourceHashes);assert.equal(services.results.length,598);
 const baselineServices=JSON.parse(execFileSync('git',['show','fceb062:docs/operations/SERVICE_ACCESS_DIAGNOSTIC.json'],{encoding:'utf8',maxBuffer:32*1024**2}));const oldSites=new Set(baselineServices.results.map((r:{site:string})=>r.site));const added=services.results.filter((r:{site:string})=>!oldSites.has(historicalMobileBackRpcSite(r.site,parseServices)));assert.equal(added.length,12);assert.ok(added.every((r:{site:string})=>/^src\/services\/supabase\/(?:productWorkbook|productFamilyBarcodes)\.service\.ts:\d+$/u.test(r.site)));
 assert.deepEqual(services.results.filter((r:{site:string})=>oldSites.has(historicalMobileBackRpcSite(r.site,parseServices))).map((r:{site:string;role:string;appRole:string;sqlstate:string|null;outcome:string})=>({site:historicalMobileBackRpcSite(r.site,parseServices),role:r.role,appRole:r.appRole,sqlstate:r.sqlstate,outcome:r.outcome})),JSON.parse(execFileSync('git',['show','fceb062:docs/operations/SERVICE_ACCESS_DIAGNOSTIC.json'],{encoding:'utf8',maxBuffer:32*1024**2})).results.map((r:{site:string;role:string;appRole:string;sqlstate:string|null;outcome:string})=>({site:r.site,role:r.role,appRole:r.appRole,sqlstate:r.sqlstate,outcome:r.outcome})));
});
