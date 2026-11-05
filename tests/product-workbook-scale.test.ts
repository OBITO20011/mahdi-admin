import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {sourceBeforeProductScale} from '../scripts/audit/source-before-product-scale.mjs';
import {PassThrough} from 'node:stream';
import {consumeScaleUtf8} from '../scripts/testing/scale-utf8-stream.mjs';
import {productWorkbookScaleData} from '../scripts/testing/product-workbook-scale-data';
import {checkFiles,type Kind,type FileInput} from '../scripts/operations/go-live-files/check';
import {readProductWorkbook,prepareProductWorkbook,productWorkbookStockRows,PRODUCT_WORKBOOK_COLUMNS as C,FLAVOR_WORKBOOK_COLUMNS as F} from '../src/features/goLive/productWorkbook';
const root='scripts/testing/fixtures/product-workbook-scale';
test('real local transport decoder preserves Arabic JSON even with every byte split;old per-buffer decoding corrupts it',()=>{
 const text=JSON.stringify({name:'بيانات اختبار حتمية، ليست بيانات محل أو زبون. < > &',rows:Array(200).fill('نكهة وهمية')});const bytes=Buffer.from(text),stream=new PassThrough();let decoded='';consumeScaleUtf8(stream,(s:string)=>decoded+=s);for(let i=0;i<bytes.length;i++)stream.write(bytes.subarray(i,i+1));stream.end();assert.equal(decoded,text);assert.deepEqual(JSON.parse(decoded),JSON.parse(text));assert.notEqual([...bytes].map(b=>Buffer.from([b]).toString()).join(''),text);
});
test('historical checker view is bound to this exact report-only edit;unknown change remains visible',async()=>{
 const file='scripts/operations/go-live-files/check.ts',text=await readFile(file,'utf8'),before=execFileSync('git',['show','52c9a8b53f9e1d2bad504c88f9c6255547b09e7c:'+file],{encoding:'utf8',windowsHide:true});assert.equal(sourceBeforeProductScale(file,text),before);assert.equal(sourceBeforeProductScale(file,text+'\n//unknown'),text+'\n//unknown');assert.equal(sourceBeforeProductScale('src/lib/xlsx.ts',text),text);
});
const load=async(negative=false)=>{const inputs:Partial<Record<Kind,FileInput>>={};for(const[k,n]of Object.entries({products:negative?'المنتجات-وهمي-أخطاء.xlsx':'المنتجات-وهمي-1000.xlsx',customers:'ديون-العملاء.xlsx',suppliers:'أرصدة-الموردين.xlsx',drawer:'الدرج-الافتتاحي.xlsx'}))inputs[k as Kind]={name:n,bytes:await readFile(path.join(root,n))};return inputs;};
test('seeded fictional model and authored workbook agree on every cell and all1480 identities',async()=>{
 const m=productWorkbookScaleData();assert.deepEqual(m,productWorkbookScaleData());
 const decoded=await readProductWorkbook((await load()).products!.bytes);
 // Number formatting is intentionally different; compare authoritative normalized plan.
 const plan=prepareProductWorkbook(decoded.products,decoded.flavors),model=prepareProductWorkbook(m.positive[0].rows.map(r=>r.map(String)),m.positive[1].rows.map(r=>r.map(String)));
 assert.deepEqual(plan,model);assert.deepEqual(plan.errors,[]);assert.equal(plan.products.length,1000);assert.equal(plan.products.reduce((n,p)=>n+p.flavors.length,0),480);assert.equal(plan.missingStock,482);assert.equal(productWorkbookStockRows(plan).length,966);
 const identifiers=plan.products.flatMap(p=>[p.data.sku,...p.flavors.map(f=>f.sku)]);assert.equal(new Set(identifiers).size,1480);assert.equal(plan.products[701].data.barcode,'000123456789012345678901234567890123');
 assert.deepEqual(decoded.products[0],C.map(c=>c.header));assert.deepEqual(decoded.flavors[0],F.map(c=>c.header));
});
test('actual offline checker has no false errors;exact482 stock warning,integer-fils totals and both numeric barcode warnings',async()=>{
 const m=productWorkbookScaleData(),report=await checkFiles(await load(),m.reference,undefined,m.date,{noOpeningCheques:true});
 assert.equal(report.ok,true,JSON.stringify(report.issues));assert.equal(report.productCount,1480);assert.equal(report.totals.stockValueInMinor,'143633000');assert.equal(report.totals.customerDebtInMinor,'1000');assert.equal(report.totals.supplierPayableInMinor,'2000');
 assert.ok(report.issues.some(i=>i.severity==='warning'&&i.reason.startsWith('482 صنف بلا مخزون')));
 assert.ok(report.issues.some(i=>i.row===102&&i.column==='الباركود'&&i.severity==='warning'));
 assert.ok(report.issues.some(i=>i.row===481&&i.column.includes('النكهات')&&i.severity==='warning'));
 assert.deepEqual(report.issues.filter(i=>i.reason.startsWith('تم تطبيع')).map(i=>[i.file,i.reason.match(/\d+/u)?.[0],i.severity]).sort(),[['أرصدة-الموردين.xlsx','1','warning'],['المنتجات.xlsx','2','warning'],['ديون-العملاء.xlsx','1','warning']].sort());
 assert.equal(report.databaseWrites,0);
});
test('all7 intentional faults have exact sheet/row/correct field;extra duplicate finding is the same fault,never a false error',async()=>{
 const m=productWorkbookScaleData(),report=await checkFiles(await load(true),m.reference,undefined,m.date,{noOpeningCheques:true}),errors=report.issues.filter(i=>i.severity==='error');assert.equal(report.ok,false);
 for(const f of m.faults){const matching=errors.filter(e=>e.row===f.row&&e.reason.includes(f.reason));assert.equal(matching.length,1,f.id);if(f.sheet==='النكهات')assert.ok(matching[0].column.startsWith('النكهات / '),f.id);assert.ok(!matching[0].column.endsWith('السطر'),f.id);if(f.column==='packet_price')assert.equal(matching[0].column,'سعر بيع الباكيت المفرد (د.أ)');}
 assert.equal(errors.length,8);for(const e of errors)assert.ok(m.faults.some(f=>f.row===e.row&&(e.reason.includes(f.reason)||f.id==='cross-sheet-barcode'&&e.reason.includes('الباركود مكرر داخل'))),JSON.stringify(e));
});
