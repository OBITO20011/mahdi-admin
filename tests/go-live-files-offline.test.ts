import{pathsBeforeD1Kit}from'../scripts/audit/source-before-d1-reference-kit.mjs';
import ts from 'typescript';
import {PRODUCT_WORKBOOK_COLUMNS,FLAVOR_WORKBOOK_COLUMNS} from '../src/features/goLive/productWorkbook';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,mkdirSync,rmSync,statSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeXlsx,readZip,createZip,readXlsxFirstSheet} from '../src/lib/xlsx';
import {GO_LIVE_COLUMNS,mapSheet,prepareProducts,prepareStock,prepareCustomers,prepareSuppliers} from '../src/features/goLive/goLiveImport';
import {OPENING_CHEQUE_COLUMNS,prepareOpeningChequeSheet} from '../src/features/goLive/openingChequesImport';
import {checkFiles,arabicReport,INPUT_FILES,normalizeName,normalizePhone,type Kind,type LocalReference,type FileInput} from '../scripts/operations/go-live-files/check';
import {sourceBeforeProductScale} from '../scripts/audit/source-before-product-scale.mjs';
const today='2026-11-04';
const reference=():LocalReference=>({format:1,asOf:today,categories:[{name:'سكر',active:true}],units:[{code:'PKT',name:'باكيت'},{code:'CTN',name:'طرد'}],products:[],customers:[{id:'customer1',name:'عميل مثال',phone:'0790000000',active:true}],suppliers:[{id:'supplier1',name:'مورد مثال',phone:'0780000000',active:true}],chequeKeys:[]});
const header=(kind:Kind)=>kind==='cheques'?OPENING_CHEQUE_COLUMNS.map(c=>c[1]):kind==='drawer'?['العهدة الافتتاحية (د.أ)']:GO_LIVE_COLUMNS[kind].map(c=>c.header);
const input=(kind:Kind,rows:string[][]):FileInput=>({name:INPUT_FILES[kind],bytes:writeXlsx([{name:'البيانات',rows:[header(kind),...rows]}])});
const product=['SUG-10','0001234567890','سكر مثال','سكر','PKT','CTN','10','CTN','12','15.000','10.000','1.001','0','لا'];
function fixture():Record<Kind,FileInput>{return{products:input('products',[product]),stock:input('stock',[['sug-10','','3','2']]),customers:input('customers',[['0790000000','عميل مثال','40.250','2025-01-02','']]),suppliers:input('suppliers',[['مورد مثال','0780000000','له','150.500','2025-01-02','']]),cheques:input('cheques',[['وارد','قيد الانتظار','بنك مثال','000001','2026-12-01','10.000','عميل مثال','0790000000','','','','','']]),drawer:input('drawer',[['25.500']])};}

test('offline checker reuses actual parsers, purchase parcel size and exact fils totals; identifier zeros survive',async()=>{
 const f=fixture(),r=await checkFiles(f,reference(),undefined,today);assert.equal(r.ok,true,JSON.stringify(r.issues));assert.equal(r.databaseWrites,0);
 assert.equal(r.totals.stockValueInMinor,'32032');assert.equal(r.totals.customerDebtInMinor,'40250');assert.equal(r.totals.supplierPayableInMinor,'150500');assert.equal(r.totals.chequesInMinor,'10000');assert.equal(r.totals.drawerInMinor,'25500');
 const rows=mapSheet('products',await readXlsxFirstSheet(f.products.bytes));assert.equal(prepareProducts(rows.rows).payload[0].barcode,'0001234567890');
 for(const [kind,fn]of [['customers',prepareCustomers],['suppliers',prepareSuppliers]]as const){const mapped=mapSheet(kind,await readXlsxFirstSheet(f[kind].bytes));assert.deepEqual(fn(mapped.rows,today).errors,[]);}
 assert.deepEqual(prepareOpeningChequeSheet(await readXlsxFirstSheet(f.cheques.bytes)).errors,[]);
 assert.equal(prepareStock(mapSheet('stock',await readXlsxFirstSheet(f.stock.bytes)).rows,[{productId:'1',sku:'SUG-10',unitsPerPackage:10,productName:'صنف',costPriceInMinorUnits:1001,eligible:true}]).payload[0].baseQuantity,32);
});

test('missing files/reference, altered headers, invalid money/parcel/future dates keep row,column,Arabic remedy and fail closed',async()=>{
 const f=fixture();f.products=input('products',[[...product.slice(0,9),'1.0001',...product.slice(10)]]);f.customers=input('customers',[['','','2.000','2028-01-01','']]);const r=await checkFiles(f,null,undefined,today);assert.equal(r.ok,false);assert.ok(r.issues.some(i=>i.severity==='incomplete'));assert.ok(r.issues.some(i=>i.file===INPUT_FILES.products&&i.row===2&&i.column==='سعر بيع الطرد (د.أ)'));for(const i of r.issues){assert.ok(i.reason);assert.ok(i.column);assert.ok(i.fix);}
 const bad=input('products',[product]);bad.bytes=writeXlsx([{name:'البيانات',rows:[['عنوان خاطئ'],product]}]);const headers=await checkFiles({...fixture(),products:bad},reference(),undefined,today);assert.ok(headers.issues.some(i=>i.row===1&&i.column==='رؤوس الأعمدة'));
 const parcel=[...product];parcel[8]='1';parcel[13]='نعم';assert.ok((await checkFiles({...fixture(),products:input('products',[parcel])},reference(),undefined,today)).issues.some(i=>i.reason.includes('الطرد فقط')));
 assert.equal((await checkFiles({},reference(),undefined,today)).ok,false);
});

test('known references resolve unit code before name and require exact active unique category; no invented unit aliases',async()=>{
 const ref=reference();ref.units.push({code:'BAG',name:'باكيت'});let p=[...product];p[4]='باكيت';assert.equal((await checkFiles({...fixture(),products:input('products',[p])},ref,undefined,today)).ok,false);
 p=[...product];assert.equal((await checkFiles({...fixture(),products:input('products',[p])},ref,undefined,today)).ok,true);
 ref.categories[0].active=false;assert.ok((await checkFiles(fixture(),ref,undefined,today)).issues.some(i=>i.column==='القسم'));
});

test('duplicate SKU/barcode, stock missing/flavor-master/ambiguous and loose-count checks match current paths',async()=>{
 const second=[...product];second[0]='SKU2';const f=fixture();f.products=input('products',[product,second]);assert.ok((await checkFiles(f,reference(),undefined,today)).issues.some(i=>i.column==='الباركود'&&i.reason.includes('مكرر')));
 second[0]='sug-10';second[1]='other';assert.ok((await checkFiles({...fixture(),products:input('products',[product,second])},reference(),undefined,today)).issues.some(i=>i.reason.includes('SKU مكرر')));
 const ref=reference();ref.products.push({sku:'FLAV-1',barcode:'00055',name:'نكهة',unitsPerPackage:4,costInMinor:'500',eligible:true});let r=await checkFiles({...fixture(),stock:input('stock',[['00055','','1','2']])},ref,undefined,today);assert.equal(r.ok,true);assert.equal(r.totals.stockValueInMinor,'3000');ref.products[0].eligible=false;r=await checkFiles({...fixture(),stock:input('stock',[['00055','','1','2']])},ref,undefined,today);assert.equal(r.ok,false);
 for(const code of ['MISSING','00055']){const r=await checkFiles({...fixture(),stock:input('stock',[[code,'','1','10']])},reference(),undefined,today);assert.equal(r.ok,false);}
});

test('customer duplicates are same party/date/amount, not multiple distinct old debts; supplier same phone counts as one party',async()=>{
 const c=['0790000000','عميل مثال','40.250','2025-01-02',''];let r=await checkFiles({...fixture(),customers:input('customers',[c,c])},reference(),undefined,today);assert.ok(r.issues.some(i=>i.reason.includes('مكرر لنفس الطرف')));
 const d=[...c];d[3]='2024-01-01';r=await checkFiles({...fixture(),customers:input('customers',[c,d])},reference(),undefined,today);assert.equal(r.ok,true);assert.equal(r.totals.customerDebtInMinor,'80500');
 const a=['مورد مثال','0780000000','له','1.000','2025-01-01',''],b=['اسم آخر','0780000000','عليه','2.000','2025-01-01',''];assert.ok((await checkFiles({...fixture(),suppliers:input('suppliers',[a,b])},reference(),undefined,today)).issues.some(i=>i.reason.includes('مكرر لنفس الطرف')));
 assert.equal(normalizePhone('+962790000000'),'0790000000');assert.equal(normalizeName('أحمد الـعلي'),'احمدالعلي');
});

test('opening cheques require existing unique parties and bank-party-number uniqueness, no double counting as debt',async()=>{
 const c=['وارد','قيد الانتظار','بنك مثال','000001','2026-12-01','10.000','عميل مثال','0790000000','','','','',''];const r=await checkFiles({...fixture(),cheques:input('cheques',[c,c])},reference(),undefined,today);assert.ok(r.issues.some(i=>i.reason.includes('الشيك مكرر')));assert.equal(r.totals.customerDebtInMinor,'40250');
 const ref=reference();ref.chequeKeys=[{kind:'customer',partyId:'customer1',bank:'بنك مثال',number:'000001'}];assert.equal((await checkFiles(fixture(),ref,undefined,today)).ok,false);
 const f=fixture();delete (f as Partial<typeof f>).cheques;assert.equal((await checkFiles(f,reference(),undefined,today,{noOpeningCheques:true})).ok,true);assert.equal((await checkFiles(fixture(),reference(),undefined,today,{noOpeningCheques:true})).ok,false);
});

test('images use actual SKU digit/case normalization, never names; variants in local reference match and duplicates fail',async()=>{
 const ref=reference();ref.products.push({sku:'FLAV-1',barcode:'',name:'نكهة',unitsPerPackage:4,costInMinor:'500',eligible:true});let r=await checkFiles(fixture(),ref,[{name:' sug-١٠.JPG',size:100},{name:'flav-۱.webp',size:100}],today);assert.equal(r.ok,true,JSON.stringify(r.issues));
 r=await checkFiles(fixture(),ref,[{name:'SUG-10.jpg',size:100},{name:'sug-۱۰.png',size:100},{name:'سكر مثال.jpg',size:100}],today);assert.ok(r.issues.some(i=>i.reason.includes('ملفان')));assert.ok(r.issues.some(i=>i.reason.includes('لا يوجد منتج')));
});

test('numeric identifier warnings inspect first actual sheet only; no loss is silently repaired',async()=>{
 const f=fixture(),zip=await readZip(f.products.bytes,()=>true);let xml=new TextDecoder().decode(zip.get('xl/worksheets/sheet1.xml'));xml=xml.replace(/<c r="B2"[^>]*>[\s\S]*?<\/c>/u,'<c r="B2"><v>1234567890</v></c>');zip.set('xl/worksheets/sheet1.xml',new TextEncoder().encode(xml));f.products.bytes=createZip([...zip].map(([name,data])=>({name,data})));const r=await checkFiles(f,reference(),undefined,today);assert.ok(r.issues.some(i=>i.column==='الباركود'&&i.severity==='warning'&&i.reason.includes('الأصفار البادئة')));
});

test('exact inventory total is BigInt even beyond Number safe range; Arabic report omits private cell values',async()=>{
 const p=[...product];p[6]='999999';p[11]='999999999.999';const f=fixture();f.products=input('products',[p]);f.stock=input('stock',[['SUG-10','','2000','0']]);const r=await checkFiles(f,reference(),undefined,today);assert.equal(r.ok,true);assert.equal(r.totals.stockValueInMinor,(1999998000n*999999999999n).toString());
 const report=arabicReport(r);for(const value of ['0790000000','عميل مثال','مورد مثال','000001','0001234567890'])assert.ok(!report.includes(value));assert.ok(report.includes('د.أ'));
});

test('real CLI has zero network, read-only inputs and protected local report; invalid XLSX exits nonzero with fixed safe errors',()=>{
 const root=mkdtempSync(path.join(tmpdir(),'nawasrah-offline-files-test-'));try{const folder=path.join(root,'files');mkdirSync(folder);for(const[k,f]of Object.entries(fixture()))writeFileSync(path.join(folder,INPUT_FILES[k as Kind]),f.bytes);writeFileSync(path.join(folder,'reference.json'),JSON.stringify(reference()));const before=Object.fromEntries(Object.values(INPUT_FILES).map(f=>[f,readFileSync(path.join(folder,f)).toString('base64')]));
 const guard=path.join(root,'no-network.mjs');writeFileSync(guard,`globalThis.fetch=()=>{throw new Error('NETWORK_FORBIDDEN')};import http from 'node:http';import https from 'node:https';import net from 'node:net';for(const m of [http,https]){m.request=()=>{throw new Error('NETWORK_FORBIDDEN')};m.get=m.request;}net.connect=()=>{throw new Error('NETWORK_FORBIDDEN')};`);
 const output=path.join(root,'report');const r=spawnSync(process.execPath,['--import',pathToFileURL(guard).href,'--import','tsx','scripts/operations/go-live-files/cli.ts','--folder',folder,'--output',output],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr+r.stdout);const report=JSON.parse(readFileSync(path.join(output,'report.json'),'utf8'));assert.equal(report.offline,true);assert.equal(report.databaseWrites,0);assert.ok(!r.stdout.includes('0790000000'));assert.ok(!r.stdout.includes('40.250'));if(process.platform!=='win32')assert.equal(statSync(output).mode&0o777,0o700);
 for(const f of Object.values(INPUT_FILES))assert.equal(readFileSync(path.join(folder,f)).toString('base64'),before[f]);
 writeFileSync(path.join(folder,INPUT_FILES.products),'not xlsx');const bad=spawnSync(process.execPath,['--import',pathToFileURL(guard).href,'--import','tsx','scripts/operations/go-live-files/cli.ts','--folder',folder,'--output',path.join(root,'bad')],{encoding:'utf8',windowsHide:true});assert.equal(bad.status,1);assert.equal(JSON.parse(readFileSync(path.join(root,'bad','report.json'),'utf8')).ok,false);
 const ps=readFileSync('scripts/operations/check-go-live-files.ps1','utf8');assert.ok(ps.includes("'--import','tsx'"));assert.ok(!ps.includes('Invoke-WebRequest'));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('backend/financial sources and legacy import write/key/recovery branch remain exact;new workbook is a separate approved route',()=>{
 const productSql=readFileSync('supabase/migrations/209_product_sale_methods.sql','utf8'),units=readFileSync('supabase/migrations/160_go_live_setup_foundation.sql','utf8'),stock=readFileSync('supabase/migrations/047_inventory_opening_setup.sql','utf8');
 for(const marker of ['CHAR_LENGTH(v_sku) > 64','CHAR_LENGTH(v_name) > 200','WHERE barcode = v_barcode'])assert.ok(productSql.includes(marker));assert.ok(units.includes('upper(code) = upper(BTRIM(p_value))'));assert.ok(stock.includes("'unitsPerPackage', GREATEST(1, COALESCE(p.units_per_purchase_unit, 1))"));
 const baseline='376293af705837201e4c94b66967337baf524af6';
 const sqlDiff=execFileSync('git',['diff','--name-only',baseline,'--','supabase','src/services/supabase/goLive.service.ts','src/services/supabase/inventory-opening.service.ts','src/features/products/bulkImages'],{encoding:'utf8'});assert.deepEqual(pathsBeforeD1Kit(sqlDiff.trim().split('\n').filter(Boolean),baseline),[]);
 for(const file of ['src/features/goLive/goLiveImport.ts','src/features/goLive/openingChequesImport.ts'])assert.equal(sourceBeforeProductScale(file,readFileSync(file,'utf8')),execFileSync('git',['show',baseline+':'+file],{encoding:'utf8'}));
 const file='src/features/goLive/GoLiveSetupView.tsx';
 const legacySave=(text:string)=>{const sf=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let found:ts.Node|undefined;const visit=(n:ts.Node)=>{if(ts.isVariableDeclaration(n)&&n.name.getText(sf)==='ImportPanel'&&n.initializer){const nested=(child:ts.Node)=>{if(ts.isVariableDeclaration(child)&&child.name.getText(sf)==='save')found=child;ts.forEachChild(child,nested);};nested(n.initializer);}ts.forEachChild(n,visit);};visit(sf);assert.ok(found);return ts.createPrinter({removeComments:true}).printNode(ts.EmitHint.Unspecified,found,sf);};
 assert.equal(legacySave(readFileSync(file,'utf8')),legacySave(execFileSync('git',['show',baseline+':'+file],{encoding:'utf8'})),'legacy write/key/payload/recovery branch is exact');
});


test('enhanced workbook flavors,optional stock and image names are checked offline through the same purchase-pack path',async()=>{
 const values=Object.fromEntries(GO_LIVE_COLUMNS.products.map((c,i)=>[c.key,product[i]]));values.barcode='';
 const row=PRODUCT_WORKBOOK_COLUMNS.map(c=>({...values,sale_method:'الاثنين',packet_price:'1.250'}[c.key]??''));
 const flavors=[FLAVOR_WORKBOOK_COLUMNS.map(c=>c.header),...['ليمون','برتقال'].map((name,i)=>FLAVOR_WORKBOOK_COLUMNS.map(c=>({master_sku:'SUG-10',name,barcode:i?'':'000555',opening_stock:i?'':'14'}[c.key]??'')))];
 const f=fixture(),input={name:INPUT_FILES.products,bytes:writeXlsx([{name:'المنتجات',rows:[PRODUCT_WORKBOOK_COLUMNS.map(c=>c.header),row]},{name:'النكهات',rows:flavors}])};
 const r=await checkFiles({...f,products:input,stock:undefined},reference(),[{name:'SUG-10-ليمون.jpg',size:100}],today);
 assert.equal(r.ok,true,JSON.stringify(r.issues));assert.equal(r.productCount,3);assert.equal(r.totals.stockValueInMinor,'14014');assert.ok(r.issues.some(i=>i.severity==='warning'&&i.reason.includes('1 صنف بلا مخزون')));assert.ok(!r.issues.some(i=>i.reason==='لا يوجد منتج أو نكهة برمز اسم الملف.'));
 const duplicateStock=await checkFiles({...f,products:input},reference(),undefined,today);assert.ok(duplicateStock.issues.some(i=>i.reason.includes('أفرغ أحد المصدرين')));
});
