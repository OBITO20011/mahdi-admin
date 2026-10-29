import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readXlsxFirstSheet,readZip} from '../src/lib/xlsx';
import {GO_LIVE_COLUMNS,mapSheet,prepareProducts,prepareStock,prepareCustomers,prepareSuppliers} from '../src/features/goLive/goLiveImport';
import {OPENING_CHEQUE_COLUMNS,prepareOpeningChequeSheet} from '../src/features/goLive/openingChequesImport';

const folder='docs/handover/',templates=folder+'templates/';
const read=(file:string)=>readFileSync(folder+file,'utf8');
const digest=(s:string|Uint8Array)=>createHash('sha256').update(s).digest('hex');
type Kind='products'|'stock'|'customers'|'suppliers'|'cheques'|'drawer';
const files:Record<Kind,string>={products:'المنتجات.xlsx',stock:'البضاعة-الموجودة.xlsx',suppliers:'أرصدة-الموردين.xlsx',customers:'ديون-العملاء.xlsx',cheques:'شيكات-البداية.xlsx',drawer:'الدرج-الافتتاحي.xlsx'};
const evidence=JSON.parse(read('أدلة-المصادر.json'));

test('handover edition binds actual UI strings to the stated main source,not invented screens',()=>{
 assert.equal(evidence.baseline,'ad4bd1f8230758a707285ceb8f0042015d16b018');
 assert.equal(evidence.sources.length,33);
 let count=0;
 for(const item of evidence.sources){
  const source=execFileSync('git',['show',evidence.baseline+':'+item.file],{encoding:'utf8',maxBuffer:8*1024**2}).replaceAll('\r\n','\n');
  assert.equal(digest(source),item.sha256,item.file);
  for(const {label,line}of item.labels){assert.ok(source.includes(label),label);assert.equal(source.slice(0,source.indexOf(label)).split('\n').length,line);count++;}
 }
 assert.ok(count>=100);assert.equal(evidence.boundaries.applicationChanges,0);assert.equal(evidence.boundaries.hostedConnections,0);
});

test('every requested preparation XLSX opens through the application actual reader and keeps exact source headers',async()=>{
 assert.deepEqual(readdirSync(templates).filter(f=>f.endsWith('.xlsx')).sort(),Object.values(files).sort());
 for(const [kind,file]of Object.entries(files) as [Kind,string][]){
  const bytes=readFileSync(templates+file),sheet=await readXlsxFirstSheet(bytes);
  const expected=kind==='drawer'?['العهدة الافتتاحية (د.أ)']:kind==='cheques'?OPENING_CHEQUE_COLUMNS.map(c=>c[1]):GO_LIVE_COLUMNS[kind].map(c=>c.header);
  assert.deepEqual(sheet[0],expected,file);assert.equal(sheet.filter(r=>r.some(v=>v.trim()!=='')).length,2,'Exactly one synthetic data row,no explanatory row in imported data');
  assert.equal(digest(bytes),evidence.workbooks.find((w:{kind:Kind})=>w.kind===kind).sha256);
  assert.ok(bytes.length<5*1024**2);assert.equal(evidence.workbooks.find((w:{kind:Kind})=>w.kind===kind).importSupported,kind!=='drawer');
 }
});

test('product example imports without errors using actual mapSheet and prepareProducts;leading zeros survive',async()=>{
 const sheet=await readXlsxFirstSheet(readFileSync(templates+files.products)),mapped=mapSheet('products',sheet);
 assert.deepEqual(mapped.fileErrors,[]);const prepared=prepareProducts(mapped.rows);assert.deepEqual(prepared.errors,[]);assert.equal(prepared.payload.length,1);
 const row=prepared.payload[0];assert.equal(row.sku,'DOC-EXAMPLE-001');assert.equal(row.barcode,'0000000000000');assert.equal(row.sale_package_price_in_minor_units,'15000');assert.equal(row.cost_per_base_unit_in_minor_units,'1000');assert.equal(row.parcel_only,false);
 const invalid=structuredClone(mapped.rows);invalid[0].values.sale_package_price='15.0001';assert.ok(prepareProducts(invalid).errors.length>0);
 const parcel=structuredClone(mapped.rows);parcel[0].values.parcel_only='نعم';parcel[0].values.units_per_sale_unit='1';assert.ok(prepareProducts(parcel).errors.length>0);
});

test('real local214 product import evidence binds the exact workbook and reproducible isolated recipe',()=>{
 const proof=evidence.actualProductImport;
 assert.equal(proof.ok,true);assert.equal(proof.migrationCeiling,214);assert.equal(proof.managedAccess,false);assert.equal(proof.hostedConnections,0);
 assert.equal(proof.actualXlsxDecoded,true);assert.equal(proof.realSqlRpc,true);assert.equal(proof.previewErrors,0);assert.equal(proof.previewZeroWrites,true);
 assert.equal(proof.created,1);assert.equal(proof.replayZeroWrites,true);assert.equal(proof.productFieldsMatch,true);
 for(const field of ['openingStock','orders','cashShifts','inventoryMovements'])assert.equal(proof[field],0);
 assert.equal(proof.xlsxSha256,digest(readFileSync(templates+files.products)));
 const script=readFileSync('tests/handover-product-import.local.mjs','utf8').replaceAll('\r\n','\n');assert.equal(proof.scriptSha256,digest(script));
 assert.match(script,/nawasrah-handover-docs-test/u);assert.match(script,/--container/u);assert.match(script,/NAWASRAH_MAX_MIGRATION:'214'/u);
 assert.doesNotMatch(script,/readFile\([^\n]*(?:\.env|pooler-url|project-ref)|https:\/\//u);
});

test('stock,debt,supplier and opening-cheque examples use their actual parsers with exact accounting units',async()=>{
 const stock=mapSheet('stock',await readXlsxFirstSheet(readFileSync(templates+files.stock)));assert.deepEqual(stock.fileErrors,[]);
 const refs=[{productId:'00000000-0000-4000-8000-000000000001',sku:'DOC-EXAMPLE-001',productName:'صنف وهمي — احذف المثال',unitsPerPackage:10,eligible:true,costPriceInMinorUnits:1000}];
 const counted=prepareStock(stock.rows,refs);assert.deepEqual(counted.errors,[]);assert.equal(counted.payload[0].baseQuantity,32);
 const loose=structuredClone(stock.rows);loose[0].values.loose_units='10';assert.ok(prepareStock(loose,refs).errors.length>0);
 const customer=mapSheet('customers',await readXlsxFirstSheet(readFileSync(templates+files.customers)));assert.deepEqual(customer.fileErrors,[]);
 const debt=prepareCustomers(customer.rows,'2026-10-27');assert.deepEqual(debt.errors,[]);assert.equal(debt.payload[0].amount_in_minor_units,'40250');assert.equal(debt.payload[0].original_debt_date,'2025-01-02');
 const supplier=mapSheet('suppliers',await readXlsxFirstSheet(readFileSync(templates+files.suppliers)));assert.deepEqual(supplier.fileErrors,[]);
 const due=prepareSuppliers(supplier.rows,'2026-10-27');assert.deepEqual(due.errors,[]);assert.equal(due.payload[0].direction,'payable');assert.equal(due.payload[0].amount_in_minor_units,'150500');
 const sheet=await readXlsxFirstSheet(readFileSync(templates+files.cheques)),cheque=prepareOpeningChequeSheet(sheet);assert.deepEqual(cheque.errors,[]);assert.equal(cheque.rows[0].cheque_number,'000001');assert.equal(cheque.rows[0].due_date,'2026-12-01');assert.equal(cheque.rows[0].amount_in_minor_units,'10000');
 const moved=structuredClone(sheet);[moved[0][0],moved[0][1]]=[moved[0][1],moved[0][0]];assert.ok(prepareOpeningChequeSheet(moved).errors.length>0);
});

test('all workbook sheets have native RTL,frozen header,validations,formulas and exact cached review values',async()=>{
 for(const [kind,file]of Object.entries(files) as [Kind,string][]){
  const zip=await readZip(readFileSync(templates+file),()=>true),xml=(name:string)=>new TextDecoder().decode(zip.get(name));
  assert.ok(zip.has('[Content_Types].xml'));assert.ok(![...zip.keys()].some(n=>/vba|externalLinks/u.test(n)));
  const sheets=[...zip.keys()].filter(n=>/^xl\/worksheets\/sheet\d+\.xml$/u.test(n));assert.equal(sheets.length,kind==='products'?3:2);
  for(const sheet of sheets){const source=xml(sheet);assert.match(source,/<(?:\w+:)?sheetView\b[^>]*rightToLeft="1"/u);assert.match(source,/<(?:\w+:)?pane\b[^>]*state="frozen"/u);}
  const all=sheets.map(xml).join('\n');if(kind!=='drawer')assert.match(all,/<(?:\w+:)?dataValidation\b/u);assert.match(all,/<(?:\w+:)?f(?:\s[^>]*)?>/u);
  const styles=xml('xl/styles.xml');assert.match(styles,/#,##0\.000/u);if(['customers','suppliers','cheques'].includes(kind))assert.match(styles,/yyyy-mm-dd/u);
  const manifest=evidence.workbooks.find((w:{kind:Kind})=>w.kind===kind),review=xml('xl/worksheets/sheet2.xml');
  const cached=(ref:string)=>review.match(new RegExp('<(?:\\w+:)?c\\b[^>]*r="'+ref+'"[^>]*>([^]*?)<\\/(?:\\w+:)?c>','u'))?.[1].match(/<(?:\w+:)?v>([^<]*)<\/(?:\w+:)?v>/u)?.[1];
  assert.equal(cached('B'+manifest.totalRow),({products:'1',stock:'3',suppliers:'150.5',customers:'40.25',cheques:'10',drawer:'25.5'} as const)[kind]);
  if(kind==='stock'){assert.equal(cached('E'+(manifest.totalRow+4)),'32');assert.equal(cached('G'+(manifest.totalRow+4)),'32');assert.match(review,/\*[^<]*\+/u);}
  if(kind==='products')assert.equal(cached('B'+(manifest.totalRow+3)),'1.5');
 }
});

test('print documents are standalone A4 RTL and cover cutover,emergencies and genuine import boundaries',()=>{
 for(const title of ['دليل-صاحب-المحل','ورقة-يوم-التشغيل']){
  const html=read(title+'.html');assert.match(html,/<html lang="ar" dir="rtl">/u);assert.match(html,/@page\{size:A4/u);assert.doesNotMatch(html,/<script|<iframe|<link\b|<img\b|url\(/iu);
  assert.equal(evidence.print.find((p:{name:string})=>p.name===title).forbiddenNetworkRequests,0);
 }
 const guide=read('دليل-صاحب-المحل.md'),card=read('ورقة-يوم-التشغيل.md'),notes=read('templates/README.md');
 for(const required of ['الدين القديم ليس بيعاً','لا تستعمل استلام شراء للمخزون الافتتاحي','لا ترد مالاً عن حبة من طرد','نسيت كلمة المرور','النت انقطع','الطابعة ما طبعت','ممنوعات','مكان صورة'])assert.ok(guide.includes(required),required);
 assert.ok(notes.includes('لا استيراد لهذا الملف'));assert.ok(notes.includes('صافية بعد الشيكات'));assert.ok(notes.includes('تحضير وعدّ يدوي فقط'));
 for(const marker of ['D-1','T+1','T+7','T+14','Backup','RestoreRemote','PRELAUNCH_TRIAL_OPEN=false','RESET217','dry-run','apply','00:00','Asia/Amman','Push','cron','+962785857700','انشر','افحص','resume','سنغافورة'])assert.ok(card.includes(marker),marker);
 assert.equal(evidence.print.find((p:{name:string})=>p.name==='ورقة-يوم-التشغيل').pages,2);
 assert.equal((read('ورقة-يوم-التشغيل.html').match(/<article class="print-page">/gu)??[]).length,2);
 assert.doesNotMatch(card,/```|--owner-id|--project-ref|functions deploy|db reset|PGPASSWORD/u,'Sensitive commands stay in referenced runbooks');
 const order=['حفظ إعدادات المتجر','إيقاف استقبال طلبات','وقف كل الكتابات','نسخة فاصلة','PRELAUNCH_TRIAL_OPEN=false','حظر المعاينات','RESET217: dry-run','إدخال الحقيقي','Telegram: اختبار','Push:','تفعيل الفحص','واتساب الرسمي','كلمة المالك «انشر»','أول بيع حقيقي'];let previous=-1;for(const s of order){const at=card.indexOf(s);assert.ok(at>previous,s);previous=at;}
});
