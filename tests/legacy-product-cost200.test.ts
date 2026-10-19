import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {assert200History} from '../scripts/operations/frankfurt-owner-upgrade200.mjs';
import {assertReady200Catalog} from '../scripts/operations/frankfurt-reference200.mjs';

test('200 admission rejects missing history,backfills,newer versions and reordered prefixes',()=>{
 const manifest=JSON.parse(readFileSync('docs/operations/LEGACY_PRODUCT_COST_200_EVIDENCE.json','utf8')).manifest;
 const base=manifest.filter((m:{name:string})=>!m.name.startsWith('200_')).map((m:{name:string})=>m.name.slice(0,3));
 const reference={prefixes:{'199':{appliedVersions:base}},appliedVersions:[...base,'200']};
 assert.deepEqual(assert200History(base,reference),['200']);assert.deepEqual(assert200History([...base,'200'],reference),[]);
 for(const bad of [base.slice(1),[...base,'201'],[...base,'200','201'],[...base.slice(0,-1),'198'],[...base.slice(0,-1),'152']])assert.throws(()=>assert200History(bad,reference));
});

test('200 catalog rejects implicit PUBLIC,client EXECUTE,body security and owner drift',()=>{
 const catalog=JSON.parse(readFileSync('docs/operations/TABLE_ACCESS_AFTER_200.json','utf8')).catalog;
 assertReady200Catalog(catalog);
 for(const name of ['update_product_master','update_product_master_v2']){
  for(const acl of [null,['=X/postgres'],['anon=X/postgres'],['authenticated=X/postgres'],['authenticated=X*/postgres']]){
   const changed=structuredClone(catalog),f=changed.functions.find((f:{identity:string})=>f.identity.startsWith(name+'('));
   f.acl=acl;assert.throws(()=>assertReady200Catalog(changed));
  }
  for(const mutation of [{owner:'authenticated'},{configuration:['search_path=public']},{definition:'SECURITY INVOKER'}]){
   const changed=structuredClone(catalog),f=changed.functions.find((f:{identity:string})=>f.identity.startsWith(name+'('));
   Object.assign(f,mutation);assert.throws(()=>assertReady200Catalog(changed));
  }
 }
});
