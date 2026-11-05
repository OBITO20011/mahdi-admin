import test from'node:test';import assert from'node:assert/strict';
import{normalizeImportDisplayText as norm}from'../src/features/goLive/importDisplayText';
import{mapSheet,prepareSuppliers,GO_LIVE_COLUMNS}from'../src/features/goLive/goLiveImport';
import{prepareProductWorkbook,PRODUCT_WORKBOOK_COLUMNS as C,FLAVOR_WORKBOOK_COLUMNS as F}from'../src/features/goLive/productWorkbook';
import{validateProductWorkbookReference}from'../src/features/goLive/productWorkbookReference';
test('NFKC descriptive fields only;barcode bytes and existing skuKey semantics are preserved',()=>{
 const p={sku:'RAW-١',barcode:'００0١',name_ar:'ﺑﺮﺍﻭﻧﻲ   وهمي',category_name:'ﺑﺮﺍﻭﻧﻲ',base_unit_name:'ﺑﺎﻛﻴﺖ',purchase_unit_name:'CTN',units_per_purchase_unit:'١٢',sale_unit_name:'CTN',units_per_sale_unit:'١٢',sale_package_price:'٦.٠٠٠',purchase_package_price:'٣.٠٠٠',cost_per_base_unit:'٠.٢٥٠',sale_method:'الاثنين',packet_price:'0.500',brand_name:'ﺑﺮﺍﻭﻧﻲ',description:' وصف   ﺑﺮﺍﻭﻧﻲ '};
 const plan=prepareProductWorkbook([C.map(c=>c.header),C.map(c=>p[c.key as keyof typeof p]??'')]);assert.deepEqual(plan.errors,[]);assert.equal(plan.products[0].data.name_ar,'براوني وهمي');assert.equal(plan.products[0].description,'وصف براوني');assert.equal(plan.products[0].data.barcode,p.barcode);assert.equal(plan.products[0].data.sku,'RAW-1');assert.equal(plan.products[0].data.sale_package_price_in_minor_units,'6000');assert.ok(plan.warnings.some(w=>w.message.includes('تطبيع 5 حقلاً')));
 const ref={categories:[{name:'براوني',active:true}],units:[{name:'باكيت',code:'PKT'},{name:'طرد',code:'CTN'}],brands:[{name:'براوني',active:true}],products:[]};assert.deepEqual(validateProductWorkbookReference(plan,ref),[]);assert.deepEqual(validateProductWorkbookReference(plan,{...ref,categories:[{name:'ﺑﺮﺍﻭﻧﻲ',active:true}]}),[]);
 assert.ok(validateProductWorkbookReference(plan,{...ref,categories:[...ref.categories,{name:'ﺑﺮﺍﻭﻧﻲ',active:true}]}).some(e=>e.message.includes('القسم')));
 assert.equal(norm('ﻻ  ﺑﺮﺍﻭﻧﻲ'),'لا براوني');
});
test('flavor duplicates and supplier duplicates are detected after normalization,not hidden by presentation forms',()=>{
 const m={sku:'TEST',name_ar:'أساسي',category_name:'قسم',base_unit_name:'PKT',purchase_unit_name:'CTN',units_per_purchase_unit:'12',sale_unit_name:'CTN',units_per_sale_unit:'12',sale_package_price:'6.000',cost_per_base_unit:'0.250',sale_method:'طرد'};
 const plan=prepareProductWorkbook([C.map(c=>c.header),C.map(c=>m[c.key as keyof typeof m]??'')],[F.map(c=>c.header),['TEST','ﺑﺮﺍﻭﻧﻲ','','F-1',''],['TEST','براوني','','F-2','']]);assert.ok(plan.errors.some(e=>e.message.includes('اسم نكهة مكرر')));assert.equal(plan.products[0].flavors[0].name,'براوني');
 const s={supplier_name:'ﺑﺮﺍﻭﻧﻲ  شركة',direction:'له',amount:'1.000',original_date:'2026-11-01'},rows=mapSheet('suppliers',[GO_LIVE_COLUMNS.suppliers.map(c=>c.header),...['ﺑﺮﺍﻭﻧﻲ  شركة','براوني شركة'].map(name=>GO_LIVE_COLUMNS.suppliers.map(c=>({...s,supplier_name:name}[c.key]??'')))]);assert.equal(rows.normalizedFields,1);assert.ok(prepareSuppliers(rows.rows,'2026-11-05').errors.some(e=>e.message.includes('المورد مكرر')));
 const stock=mapSheet('stock',[GO_LIVE_COLUMNS.stock.map(c=>c.header),['００١','ﺑﺮﺍﻭﻧﻲ  وهمي','١','٠']]);assert.equal(stock.rows[0].values.code,'００١');assert.equal(stock.rows[0].values.name,'براوني وهمي');assert.equal(stock.normalizedFields,1);
});
