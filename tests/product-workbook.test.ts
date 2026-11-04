import test from 'node:test';import assert from 'node:assert/strict';
import {PRODUCT_WORKBOOK_COLUMNS as C,FLAVOR_WORKBOOK_COLUMNS as F,prepareProductWorkbook,productWorkbookStockRows,deterministicFlavorSku,readProductWorkbook} from '../src/features/goLive/productWorkbook';
import {GO_LIVE_COLUMNS,templateRows} from '../src/features/goLive/goLiveImport';
import {writeXlsx,readXlsxFirstSheet,readZip,createZip} from '../src/lib/xlsx';
const product=(values:Record<string,string>={})=>C.map(c=>({sku:'SUG-10',barcode:'',name_ar:'سكر وهمي',category_name:'أغذية',base_unit_name:'باكيت',purchase_unit_name:'طرد',units_per_purchase_unit:'12',sale_unit_name:'طرد',units_per_sale_unit:'12',sale_package_price:'9.000',purchase_package_price:'6.000',cost_per_base_unit:'0.500',min_stock_level:'0',parcel_only:'لا',sale_method:'الاثنين',packet_price:'0.750',...values}[c.key]??''));
const flavor=(values:Record<string,string>)=>F.map(c=>values[c.key]??'');
const run=(p:Record<string,string>[]=[{}],f:Record<string,string>[]=[])=>(prepareProductWorkbook([C.map(c=>c.header),...p.map(product)],f.length?[F.map(c=>c.header),...f.map(flavor)]:[]));
test('new labels use exact existing money/parcel validation;packet price stays derived,not independent',()=>{
 const good=run();assert.equal(good.errors.length,0);assert.equal(good.products[0].data.sale_package_price_in_minor_units,'9000');assert.equal(good.products[0].data.cost_per_base_unit_in_minor_units,'500');
 assert.match(run([{packet_price:'0.751'}]).errors[0].message,/لا يطابق/u);
 assert.match(run([{packet_price:''}]).errors[0].message,/مطلوب/u);
 assert.match(run([{packet_price:'0.7501'}]).errors[0].message,/ثلاث/u);
 assert.equal(run([{sale_package_price:'10.000',packet_price:'0.833'}]).errors.length,0);
});
test('old headers and old ordinary-row contract remain accepted without inventing a price',()=>{
 const plan=prepareProductWorkbook(templateRows('products'));assert.equal(plan.errors.length,0);assert.equal(plan.products.length,1);
 assert.deepEqual(GO_LIVE_COLUMNS.products.map(c=>c.header),templateRows('products')[0]);
});
test('flavors get stable readable normalized SKU and inherit parent commercial data;no master opening stock',()=>{
 const p=run([{}],[{master_sku:'sug-١٠',name:'ليمون'},{master_sku:'SUG-10',name:'برتقال',barcode:'001234'}]);assert.equal(p.errors.length,0);assert.equal(p.products[0].flavors[0].sku,'SUG-10-ليمون');assert.equal(p.products[0].flavors[1].barcode,'001234');
 assert.equal(deterministicFlavorSku('sug-١٠',' ليمون '),deterministicFlavorSku('SUG-10','ليمون'));
 assert.ok([...deterministicFlavorSku('A'.repeat(64),'اسم طويل جداً')].length<=64);
 assert.match(run([{opening_stock:'1'}],[{master_sku:'SUG-10',name:'ليمون'}]).errors[0].message,/بلا باركود أو مخزون/u);
});
test('duplicates and collisions across both sheets fail before any RPC',()=>{
 for(const f of [[{master_sku:'MISSING',name:'ليمون'}],[{master_sku:'SUG-10',name:'ليمون'},{master_sku:'SUG-10',name:'ليمون'}],[{master_sku:'SUG-10',name:'ليمون',sku:'SUG-10'}]])assert.ok(run([{}],f).errors.length);
 const x=run([{barcode:'001234'},{sku:'B',barcode:''}],[{master_sku:'B',name:'نكهة',barcode:'001234'}]);assert.ok(x.errors.some(e=>e.message.includes('مكرر')));
});
test('missing stock warns,explicit zero is preserved;filled base quantity exports the existing parcels+loose shape',()=>{
 const a=run();assert.equal(a.errors.length,0);assert.equal(a.missingStock,1);assert.equal(productWorkbookStockRows(a).length,0);
 const b=run([{opening_stock:'14'}]);assert.deepEqual(productWorkbookStockRows(b),[{sku:'SUG-10',packageCount:1,looseUnits:2}]);
 assert.equal(run([{opening_stock:'0'}]).missingStock,0);
 assert.deepEqual(productWorkbookStockRows(run([{warehouse_code:'WH-2',opening_stock:'14'}])),[{sku:'SUG-10',warehouse:'WH-2',packageCount:1,looseUnits:2}]);
 const different=run([{units_per_purchase_unit:'24',opening_stock:'25'}]);assert.deepEqual(productWorkbookStockRows(different),[{sku:'SUG-10',packageCount:1,looseUnits:1}]);
 const f=run([{}],[{master_sku:'SUG-10',name:'ليمون',opening_stock:'25'}]);assert.deepEqual(productWorkbookStockRows(f),[{sku:'SUG-10-ليمون',packageCount:2,looseUnits:1}]);
});
test('named flavor sheet uses exact relationship/name;legacy first-sheet reader unchanged',async()=>{
 const bytes=writeXlsx([{name:'المنتجات',rows:[C.map(c=>c.header),product()]},{name:'النكهات',rows:[F.map(c=>c.header),flavor({master_sku:'SUG-10',name:'ليمون'})]},{name:'تعليمات',rows:[['ليست نكهة']]}]);
 const read=await readProductWorkbook(bytes);assert.deepEqual(await readXlsxFirstSheet(bytes),read.products);assert.equal(prepareProductWorkbook(read.products,read.flavors).products[0].flavors.length,1);
 const old=await readProductWorkbook(writeXlsx([{name:'البيانات',rows:templateRows('products')}]));assert.deepEqual(old.flavors,[]);
});


test('duplicate named flavor worksheets and invalid required method fail closed',async()=>{
 await assert.rejects(readProductWorkbook(writeXlsx([{name:'المنتجات',rows:[C.map(c=>c.header),product()]},{name:'النكهات',rows:[F.map(c=>c.header)]},{name:'النكهات',rows:[F.map(c=>c.header)]}])));
 assert.ok(run([{sale_method:''}]).errors.some(e=>e.message.includes('طريقة البيع مطلوبة')));
 assert.ok(run([{sku:'A'.repeat(65)}]).errors.some(e=>e.message.includes('64')));
});
test('numeric flavor identifiers warn about lost leading digits without inventing replacements',async()=>{
 const bytes=writeXlsx([{name:'المنتجات',rows:[C.map(c=>c.header),product()]},{name:'النكهات',rows:[F.map(c=>c.header),flavor({master_sku:'SUG-10',name:'ليمون',barcode:'00123'})]}]);
 const files=await readZip(bytes,()=>true),xml=new TextDecoder().decode(files.get('xl/worksheets/sheet2.xml')).replace(/<c r="C2"[^>]*>[^]*?<\/c>/u,'<c r="C2"><v>123</v></c>');files.set('xl/worksheets/sheet2.xml',new TextEncoder().encode(xml));
 const read=await readProductWorkbook(createZip([...files].map(([name,data])=>({name,data}))));assert.equal(read.identifierWarnings.length,1);assert.equal(read.identifierWarnings[0].sheet,'النكهات');assert.equal(read.flavors[1][2],'123');
});


test('ambiguous duplicate headings and overlong flavor barcode are rejected during preview',()=>{
 const sheet=[C.map(c=>c.header).concat(C.at(-1)!.header),product().concat('1')];assert.ok(prepareProductWorkbook(sheet).errors.some(e=>e.message.includes('عنوان عمود مكرر')));
 assert.ok(run([{}],[{master_sku:'SUG-10',name:'ليمون',barcode:'A'.repeat(65)}]).errors.some(e=>e.sheet==='النكهات'&&e.message.includes('64')));
});


test('parcel-only and single-packet methods use the existing flags and sale size without changing purchase packs',()=>{const parcel=run([{sale_method:'طرد',packet_price:''}]);assert.equal(parcel.errors.length,0);assert.equal(parcel.products[0].data.parcel_only,true);const packet=run([{sale_method:'باكيت مفرد',units_per_sale_unit:'1',sale_package_price:'0.750',packet_price:'0.750'}]);assert.equal(packet.errors.length,0);assert.equal(packet.products[0].data.parcel_only,false);assert.equal(packet.products[0].data.units_per_purchase_unit,'12');assert.equal(packet.products[0].data.units_per_sale_unit,'1');assert.ok(run([{sale_method:'باكيت مفرد'}]).errors.length);});
