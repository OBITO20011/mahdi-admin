import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {bulkImagePins,sourceBeforeBulkProductImages} from '../scripts/audit/source-before-bulk-product-images.mjs';
import {inventory} from '../scripts/audit/table-access-inventory.mjs';
import {serviceInventory} from '../scripts/audit/service-access-inventory.mjs';
import {verifyProbeCoverage} from '../scripts/audit/table-access-probes.mjs';
const read=(file:string)=>readFileSync(file,'utf8').replaceAll('\r\n','\n');
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');

test('bulk image historical projection is exact and rejects a changed upload writer',()=>{
 for(const [file,pin]of Object.entries(bulkImagePins) as [string,{added?:boolean;after:string}][]){
  const actual=read(file);assert.equal(digest(actual),pin.after,file);
  const before=sourceBeforeBulkProductImages(file,actual);
  if(pin.added)assert.equal(before,null);else assert.equal(before,execFileSync('git',['show','f95ff0458f90298edc21e39859d3268c7f7ccac7:'+file],{encoding:'utf8',maxBuffer:8*1024**2}).replaceAll('\r\n','\n'),file);
 }
 assert.throws(()=>sourceBeforeBulkProductImages('src/services/supabase/product-images.service.ts',read('src/services/supabase/product-images.service.ts')+'\nvoid unapproved;\n'),/UNREVIEWED_SOURCE/u);
 assert.throws(()=>sourceBeforeBulkProductImages('src/features/products/bulkImages/api.ts',read('src/features/products/bulkImages/api.ts')+'\nvoid unapproved;\n'),/UNREVIEWED_SOURCE/u);
});

test('new image cleanup query and image-only writer have fresh unprojected actual role evidence',async()=>{
 const table=await inventory(),state=JSON.parse(read('docs/agent/project-state.json')),proof=JSON.parse(read(state.currentTableReadinessEvidence));
 assert.equal(proof.migrationCeiling,214);assert.equal(proof.applicationReady,true);assert.equal(proof.infrastructureOk,true);assert.equal(proof.managedAccess,false);assert.deepEqual(proof.sourceHashes,table.sources);assert.deepEqual(proof.coverage,verifyProbeCoverage(table,proof.results));
 const site=table.entries.find((entry:{function:string})=>entry.function==='isUploadedImageReferenced');assert.ok(site);assert.equal(site.table,'product_images');
 const rows=proof.results.filter((row:{id:string})=>row.id===site.id);assert.ok(rows.length>=3);assert.ok(rows.every((row:{sqlstate:string|null})=>row.sqlstate===null));
 const services=await serviceInventory(),rpc=(services.rpc as {id:string;name:string}[]).find(entry=>entry.name==='set_product_primary_image');assert.ok(rpc);
 const actual=JSON.parse(read('docs/operations/SERVICE_ACCESS_DIAGNOSTIC.json'));assert.deepEqual(actual.sourceHashes,services.sourceHashes);assert.equal(actual.ok,true);
 const calls=actual.results.filter((row:{site:string})=>row.site===rpc.id);assert.deepEqual(calls.map((row:{appRole:string})=>row.appRole).sort(),['admin','cashier','owner']);
 // This legacy image-only RPC uses P0001 for its role rejection. Neutral
 // dispatch is not a functional save;the mandatory fullstack suite exercises
 // real IDs,Auth/MFA,Storage and zero writes for every rejected role.
 const cashier=calls.find((row:{appRole:string})=>row.appRole==='cashier');assert.equal(cashier.sqlstate,'P0001');assert.equal(cashier.message,'ليس لديك صلاحية تحديث صورة المنتج.');
});

test('handover instructions include upload after products without changing the fixed Excel contract',()=>{
 for(const file of ['docs/handover/دليل-صاحب-المحل.md','docs/handover/دليل-صاحب-المحل.html'])assert.ok(read(file).includes('بعد إدخال المنتجات: رفع مجلد الصور'));
 for(const file of ['docs/handover/ورقة-يوم-التشغيل.md','docs/handover/ورقة-يوم-التشغيل.html'])assert.ok(read(file).includes('المنتجات والنكهات والطرق ← رفع مجلد الصور ← المخزون'));
 const instructions=read('docs/handover/templates/README.md');for(const text of ['SUG-10.jpg','PRG-BBQ.jpg','خلفية فاتحة','لا تطابق بالاسم'])assert.ok(instructions.includes(text));
 const base=JSON.parse(execFileSync('git',['show','f95ff0458f90298edc21e39859d3268c7f7ccac7:docs/handover/أدلة-المصادر.json'],{encoding:'utf8',maxBuffer:2*1024**2}));assert.deepEqual(JSON.parse(read('docs/handover/أدلة-المصادر.json')),base);
});
